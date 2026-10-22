# `research_log_append` — research log editor — Spec

> **Status:** New (2026-06-19). Same direction as `merge-gedcomx-spec.md`: replace
> hand-written persistence with a structured read/write MCP tool that owns id
> assignment, timestamping, integrity, validation, and atomic writes. Depends on
> the in-memory validator from `validate-project-refactor-spec.md`. Payload
> transport is **decided: Option B** (host-side staging); the producer half is
> `search-result-staging-spec.md`, a hard dependency that lands with this tool (§5).

A tool that **appends one entry to `research.json` `log[]`** and, when a search
retained raw results, writes its `results/<log_id>.json` sidecar — atomically and
schema-valid. The log is append-only by GPS rule, so the tool deliberately offers
**no update or delete** — "editor" here means *append entries + their sidecars*.

---

## 1. Why this exists

Every search produces a log entry (`research-log-protocol.md` Rule 1), so this is
the highest-volume write in the system, performed today by hand across four skills
(`search-records`, `search-external-sites`, `search-full-text`, `record-extraction` — the last since retired).
The hand-write is the worst-case version of the problems the read/write direction
exists to kill:

- **The big-write failure is already documented.** The protocol tells the LLM to
  write sidecar payloads "in ~40-result chunks" because "reproducing a large
  payload into a single `Write` is reliable up to ~50 results"
  (`research-log-protocol.md` §"Result sidecar files"). That chunking dance is a
  workaround for LLM serialization stalling — exactly what a tool removes.
- **`returned_count` integrity is hand-maintained.** The validator hard-fails when
  `returned_count !== payload.results.length` (`validateSidecars`, the
  `"payload may be truncated"` check). The LLM must
  count its own results correctly; a tool computes it.
- **Three-way id wiring is hand-done and validator-enforced.** `results_ref` =
  `results/<log_id>.json`, sidecar `log_id` = log entry `id` = filename
  (`validateSidecars`, the `"does not match log entry id"` / `"does not match
  filename"` checks). A tool wires all three by construction.
- **Append-only is a convention, not a guarantee.** Rule 3 says never modify a log
  entry; nothing structurally prevents a stray `Edit`. A tool that only appends
  makes the rule structural.
- **Timestamps are guessed.** `performed` / `retrieved` are ISO 8601 with timezone;
  the LLM does not natively know the time (the harness injects the date). The host
  stamps them.

---

## 2. Scope

In scope: the `log[]` section of `research.json` and the `results/` sidecar files
(`research-schema-spec.md` §5.4, §5.4.1). One operation: **append**.

Out of scope: the other `research.json` sections (a broader `research_append` tool
is a separate effort — the log is split out because of its two-file atomic write
and the sidecar integrity check, which no other section has), any log
update/delete (forbidden by Rule 3), and `tree.gedcomx.json`.

---

## 3. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| Append-only rule; nil searches still logged | `search-records/SKILL.md` Step 5 (formerly `references/research-log-protocol.md`, now deleted) |
| Outputs link back via `log_entry_id` | `agents/record-extractor.md` + `research-schema-spec.md` §`sources`/§`assertions`. Never `search-records`' rule: this skill writes the log entry, and the **extracting** agent stamps the back-reference onto each source and assertion |
| Log entry fields + `external_site` shape | `docs/specs/research-schema-spec.md` §5.4 |
| Sidecar shape `{ log_id, tool, retrieved, returned_count, payload }`; nil → no sidecar | `research-schema-spec.md` §5.4.1 |
| Required log fields, `log_outcome` enum, `external_site` required when `tool==="external_site"`, `EXTERNAL_SITE_VALUES` | `validateResearch`'s log loop (`"tool is 'external_site' but external_site object is null"`, `EXTERNAL_SITE_VALUES`) |
| Sidecar checks: `log_id`↔entry↔filename, `returned_count`==`payload.results.length`, orphan detection, path-traversal guard, D5 persona resolution | `validateSidecars` (`src/validation/validator.ts`) |
| The protocol reference formerly duplicated across the writing skills | `*/references/research-log-protocol.md` — **0 copies**; it ran 4 → 3 → 1 → 0, the last going when its analytical rules moved into the body. Citations to it elsewhere in this spec are historical: those rules are `search-records/SKILL.md` Step 5, and the mechanical half was always `research_log_append`'s |

---

## 4. The tool

```typescript
research_log_append({
  projectPath: string,            // dir holding research.json + results/
  tool: string,                   // "record_search" | "fulltext_search" | "image_search"
                                  //   | "person_read" | "external_site" | ...
                                  //   Omit it with a stagedResultsRef and the tool fills it from the
                                  //   staged envelope. Missing required fields are refused together,
                                  //   in one error, before any other check.
  query: object,                  // freeform — enough to reproduce the search; may not name a
                                  //   filter its staged search never sent (§8.3). Omit it with a
                                  //   stagedResultsRef and the tool fills it from the staged search
  outcome: "positive" | "negative" | "partial" | "error",
  resultsExamined: number,
  planItemId: string | null,      // pli_ reference, or null for ad-hoc (see planItemId validation below)
  resultsAvailable?: number | null,
  notes?: string | null,
  externalSite?: {                // REQUIRED when tool === "external_site"; else null/omit
    site: "ancestry" | "myheritage" | "findmypast" | "findagrave" | "newspapers" | "familysearch_web"
          | "chronicling_america" | "digital_newspaper_archive" | "archives_gov" | "archive_org"
          | "billiongraves" | "digitalarkivet" | "antenati" | "library_archives_canada"
          | "american_ancestors" | "italian_genealogy" | "archion" | "matricula",
    urlGenerated: string,
    captureReceived: boolean,
    captureFilename?: string | null,
  } | null,
  // raw-results transport — host-staged handle (§5); null/omit for nil & external-site searches:
  stagedResultsRef?: string | null, // produced by the search tool (search-result-staging-spec.md)
})
```

**Batch form (`ops[]`, added 2026-07-26).** Pass `ops: [{ tool, query, outcome,
resultsExamined, ... }, ...]` instead of the top-level fields to log several
searches in one validate-once/write-once call, mirroring `research_append`/
`tree_edit`/`materialize_facts`'s `ops[]` convention: one `research.json` read,
every op applied to the same in-memory document (log ids assigned in order),
one final `validateParsed`, one atomic write. All-or-nothing: any op's failure
writes nothing and is reported as `ops[i]: <msg>`. The one thing this tool's
batching does differently from its siblings: finalizing a staged sidecar is a
**real file write** that happens as each op is applied, not a pure in-memory
mutation held until the final commit — so a batch call tracks every sidecar it
creates and unlinks all of them (not just the failing op's) on any later
failure, extending the single-call path's existing orphan-cleanup rather than
introducing a new invariant. **No refusal consumes a staged file**: finalize only
writes the sidecar, and the staged files are removed after `research.json` commits,
so a corrected re-send finds every one. Several checks run over every op before any
op is applied: the staged ref itself (it exists under `results/.staging/` and its
`tool` matches), a staged ref named by two ops (`ops[j]: stagedResultsRef '…' is also
ops[i]'s` — with removal deferred, both would finalize it), the §8.2 census check,
and the §8.3 query check. So a bad ref in op[1] is refused before op[0] writes a
sidecar.

**Success response.** `{ ok: true, logId, performed, resultsRef, returnedCount,
filesWritten, validation: { valid: true, warnings } }` for a single call, or
`{ ok: true, results: [...], filesWritten, validation }` for a batch. Either may
carry `escalationDue: string`, present only when §8.1's nil-escalation note fires,
and `next: string`, present only when the call logged a report-only agent's own
entry (`source_evaluation`, `check_warnings`, `translation`, `convert_dates`,
`validate_schema`): it tells the agent to return the report it just logged, in
full, as its reply — not a note that it was logged, and not a pointer to text it
wrote before the call, which the caller never receives (#3524).

**camelCase at the boundary; snake_case on disk.** The tool renames on persist
(`planItemId → plan_item_id`, `resultsExamined → results_examined`,
`resultsAvailable → results_available`, `externalSite → external_site` with
`urlGenerated → url_generated`, `captureReceived → capture_received`,
`captureFilename → capture_filename`) — the standard repo seam.

**`planItemId` validation.** Must be a plan-item id (`^pli_`, from the active
research plan) or `null` for an opportunistic/ad-hoc search. The literal string
`"null"` is coerced to `null` (a common model slip). Any other non-`pli_` value —
most often a question id (`q_...`) stuffed into the slot — is **rejected** with an
actionable error (`{ ok: false, errors: [...] }`) rather than persisted: an
invalid `plan_item_id` otherwise passes `validate_research_schema` (which
historically skipped this field) but hard-fails the JSON-Schema validator
downstream. Rejecting is preferred over silently nulling, which would discard the
caller's expressed intent. `validate_research_schema` now also enforces the
`^pli_` prefix on a log entry's `plan_item_id`, matching the JSON Schema and the
sibling reference fields.

**A superseded plan's items are refused.** When the plan that owns `planItemId`
has `status: "superseded"`, the op is rejected: research-plan replaced that plan,
and a search counted toward one of its items counts toward a strategy nobody is
running. The error names the superseded plan and, for the same question, the
active plan and its next open item (`in_progress` before `planned`). When there
is no active plan, or it has no open item, the error says so and points at
`planItemId: null` or research-plan. In a batch, one such op refuses the whole
call and writes nothing.

An item on a `completed` plan is **not** refused, and neither is an id no plan
owns (that is the validator's reference check). Over the committed e2e corpus,
replayed against the state each call saw
(`eval/harness/scripts/measure_superseded_log_items.py`, 2026-10-12 at
`08e7ba018`), 696 successful calls were replayable and 1,490 were not, their
responses stripped. Of the 1,283 replayable ops naming a plan item, 1,239 were
on an active plan, 0 on a superseded one, and 44 on a completed one. All 44 are
in two runs, and in both the question had no active plan, so a refusal there
would leave the caller nowhere to log. Widening the rule to every non-active
plan waits for a run that shows a completed-plan write is wrong.

**`externalSite.urlGenerated` validation.** Must be an absolute `http(s)` URL —
it is the string the skill presents as the clickable link and persists into
`research.json`, the same caller-composed shape `build_external_search_url`
refuses as `invalid_base_url`. Trimmed before both the check and the write.

**`resultsExamined` validation.** Must be a non-negative integer. A numeric
string (`"5"`, the same stringified-argument slip `resultsAvailable` is coerced
for) is coerced first; `NaN`, a negative or a fraction is rejected with an
actionable error rather than persisted (`NaN` would otherwise land as `null` and
fail only in the schema validator downstream). `validate_research_schema`
enforces the same bound on the persisted `results_examined` for every writer.

**`external_links_search` outcome consistency.** An entry for that tool with
`resultsExamined > 0` is persisted as `outcome: "positive"`: the entry grades the
curated-links FETCH, not whether any link fit the plan item (that goes in
`notes`). The prose instruction in SKILL.md was measured to be ignored often
enough to need a mechanical rule: 4 of 66 `external_links_search` entries across
the five run logs committed on 2026-09-10, in three tests and three of the five
logs.

The tool **corrects** a non-positive outcome rather than refusing the call. The
right value is decidable from the call itself, so a refusal bought nothing but a
retry — and, re-measured 2026-10-01, the Tool Arguments point in every partial
run of three search-external-sites tests. The correction is never silent: the
response carries a warning naming the outcome sent and the reason ("outcome set
to 'positive' (was 'negative'): … this entry grades the fetch, not the search —
put the record-type mismatch in 'notes'"). It is scoped to exactly this case:
a zero-link `external_links_search` entry keeps the outcome the caller sent, and
no other `tool` value is touched.

**The tool assigns (caller never supplies):** the log entry `id` (next `log_`
above the current max), `performed` (now, ISO 8601 + tz), `results_ref`
(`results/<log_id>.json` when a sidecar is written, else `null`), and the entire
sidecar envelope — `log_id`, `retrieved`, and `returned_count` (counted from the
payload, never trusted from the caller). Because `results_ref` is tool-constructed
as `results/<log_id>.json`, the validator's path-traversal guard is satisfied by
construction.

**Return value (compact — never echoes the payload):**

```typescript
{ ok: true,
  logId: string,
  performed: string,
  resultsRef: string | null,
  returnedCount: number | null,
  filesWritten: string[],                 // ["research.json"] or ["research.json","results/log_NNN.json"]
  validation: { valid: true, warnings: string[] } }
// on failure: { ok: false, errors: string[] }  — nothing written
```

The skill narrates from this ("logged as log_007; retained 12 results") without
holding the payload.

---

## 5. Payload transport — Option B (host-side staging)

The sidecar payload is the **verbatim response of the search tool**
(`record_search` / `fulltext_search`), which already ran on the host. It must reach
`results/<log_id>.json` **without the LLM re-serializing it** — re-emitting the big
payload is the exact failure this whole read/write direction exists to kill (it is
why the merge tools read the tree from disk rather than take it as an argument).

**Decision: host-staged handle (Option B).** When a search tool is given the
`projectPath`, it writes its raw payload to a staging file
(`results/.staging/<token>.json`) and returns `{ stagedResultsRef, returnedCount }`
alongside the model-facing results. `research_log_append` takes `stagedResultsRef`;
the server finalizes that file into `results/<log_id>.json` (wrap with the assigned
`log_id` + recompute `returned_count` + write, then remove the staged file once
`research.json` commits) and **the payload never
round-trips through the model.** This is the symmetric analog of the merge tools
reading the tree from disk, and it composes with validation: the staged file becomes
the on-disk sidecar, so validate-before-persist sees it.

The producer half — the optional `projectPath` + staging behavior on `record_search`
/ `fulltext_search` — is specced in **`search-result-staging-spec.md`** and is a
**hard dependency**: it lands with this tool (not after), because the end-to-end
finalize round-trip can only be tested once both exist.

*Rejected — inline `payload` (Option A).* Passing the full payload as a tool
argument is atomic (no cross-turn chunking), so for large result sets it is **worse**
than today's chunked `Write`: it buys id/timestamp/integrity/atomicity but not the
no-big-write win that is the headline reason for the tool. *Rejected — server-side
payload token (Option C).* A host-side cache avoids re-serialization too, but its
cross-turn lifetime needs managing; a staging *file* (B) survives turns for free.

---

## 6. Persistence — append-only, validate-before-persist, atomic

Sequence:

1. Read `research.json` from `projectPath`. Build the new log entry; **append** it
   to `log[]` in memory (existing entries are read-only — the tool never indexes
   into or rewrites them).
2. If results are retained (`stagedResultsRef` given), materialize the sidecar at
   `results/<log_id>.json`: read the staged file, recompute `returned_count` from
   `payload.results.length` (never trusted from the caller), wrap it with the
   assigned `log_id`, and write it (a host-side byte move — see
   `search-result-staging-spec.md` §6). The staged file is **kept** here; it is
   removed only after step 4 commits. Nil searches and external-site searches
   write **no** sidecar and set `results_ref: null` (`research-schema-spec.md`
   §5.4.1).
3. **Validate** with `validateParsed(research, tree, { projectPath })`
   (`validate-project-refactor-spec.md`). The in-memory `research` already holds the
   appended entry referencing the new sidecar, and the sidecar is now on disk — so
   the sidecar checks (`returned_count`, `log_id` match, orphan, D5) all run against
   the would-be-committed state. `tree.gedcomx.json` is read unchanged for cross-file
   checks.
4. If valid → commit `research.json` (temp + rename), then remove each staged file
   the call finalized. If invalid → **unlink the sidecar just written**, write
   nothing to `research.json`, and leave every staged file; return
   `{ ok: false, errors }`.

This yields the never-invalid guarantee. Known minor: a crash between steps 2 and 4
can leave an orphan sidecar (written, not yet referenced on disk); the next
`validate_research_schema` surfaces it as an orphan error, and a re-run is safe
(the tool allocates a fresh `log_id`). Likewise, on the file backend a crash
between the step-4 commit and the staged-file removal leaves a staged file whose
search is already logged; `unloggedStagedSearches` then reports it as unlogged, and
logging it again would write a duplicate entry. Acceptable for v1; an in-memory-sidecar
validation path (validate before any disk write) is the future cleanup.

**Validation cost.** Step 3 runs the *full* project validator, and `validateSidecars`
(`validateSidecars`) reads every `results/` sidecar payload and re-resolves every
assertion's persona (D5) on each call. Because `research_log_append` is the
highest-volume write in the system, each append is therefore O(sidecars +
assertions) of disk reads — O(n) per append, O(n²) over a project's life. For
realistic sizes (tens to low-hundreds of searches) this is acceptable and is the
boring, safe choice. **Gate, don't pre-optimize:** before shipping, measure one
append's validate at ~200 log entries / 200 sidecars; if it clears ~100 ms, note the
scaling cliff and move on. If it does not, the fix is incremental validation of just
the newly appended entry + its sidecar (not a full re-validation) — build that only
if the measurement demands it.

**Retention failure simplifies.** The protocol's "if the integrity check keeps
failing, set `results_ref` null and tell the user" guidance
(`research-log-protocol.md` §"If retention fails") goes away: the tool either
retains faithfully (it counts and writes deterministically) or fails the whole
append atomically on a real I/O error. The skill's "≤40 results, chunk above that"
rule is no longer needed (under Option B it never applied).

---

## 7. What the tool owns vs. what the caller decides

| Owned by the tool (mechanical) | Decided by the caller (judgment) |
|--------------------------------|----------------------------------|
| `id`, `performed`, `results_ref` | `tool`, `query`, `outcome`, `results_examined` |
| sidecar `log_id`, `retrieved`, `returned_count` | `results_available`, `notes`, `plan_item_id` |
| camelCase→snake_case rename; append-only; atomic write + validate | `external_site` details; whether results were retained |
| `query` and `tool` when omitted with a staged handle (filled from the staged search) | the **values** in an explicit `query` |
| no explicit `query` names a filter its staged search never sent (§8.3) | which descriptive, non-filter context to record |

The caller still makes every analytical call (was the outcome negative? is this
absence meaningful? which plan item?). The tool removes only the error-prone
clerical work.

**Why the tool owns "no never-sent filter" but not the values** (lead ruling,
2026-09-22). A log entry is an audit trail, and one claiming a filter the search
never sent — `recordType: "marriage"` for a call that sent no record type — tells
the next reader the search was narrower than it was, so a negative result looks
more conclusive than it is. The staged payload carries the producing tool's own
echo of what it sent, so the question is decidable from the project documents
alone, which is ADR-0011's test for a writer-tool precondition, and warn-only is
foreclosed by ADR-0011's advisory-versus-precondition ruling. Two alternatives
were set aside:

- **Overwrite `query` with the staged echo.** It would make the defect
  unproducible, and it would also destroy the evidence of it: once the tool
  silently corrects the field, the corpus can never again measure how often a
  caller misstates its filters. It would be the first writer tool to correct
  model content rather than refuse it, and it demotes a documented parameter.
- **Refuse any key the staged echo lacks, or any differing value.** Most
  differing values are place normalization — `residencePlace: "Pennsylvania,
  United States"` logged for `"Pennsylvania"` sent — not a claim about a filter,
  and a semantic gate prefers a false allow (ADR-0011 limit 1). The eval's
  `report_*` observers in `test_search_records.py` and
  `test_search_external_sites.py` watch that class instead.

**What counts as a filter** (decided 2026-09-24): an input parameter of the
producing tool's own schema, read from the schema object rather than a hand
list, so it cannot drift. Descriptive context the tool has no parameter for
(`name`, `collection`, `note`) is never refused. Nor is host plumbing
(`projectPath`, `subjectId`) or a paging or response-shape control (`count`,
`offset`, `includeFacets`), which changes which page comes back but not which
records match: the corpus replay's one refusal of that kind was `offset: 0`
logged for a call that sent none, which is the default, not a misstatement. An
`*Exact` flag logged as `false` claims nothing either, since `record_search`
sends it only when true. And "sent" means what reached the search, not the
bare echo: `record_search` fills the missing half of an alternate name before
it searches (`applyAltNameAutoPair`), so a log naming that half is true.

---

## 8. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `tool === "external_site"` but `externalSite` missing/null | input error; write nothing |
| `externalSite` given but `tool !== "external_site"` | input error (the schema requires `external_site: null` otherwise) |
| `externalSite.site` not in the enum | input error |
| `outcome` not in `{positive,negative,partial,error}` | input error |
| `externalSite.urlGenerated` not an absolute `http(s)` URL | input error; write nothing |
| `resultsExamined` not a non-negative integer (after coercing a numeric string) | input error; write nothing |
| `tool === "external_links_search"`, `resultsExamined > 0`, `outcome !== "positive"` | written with `outcome: "positive"`, plus a warning naming the outcome sent — the entry grades the fetch, not the search |
| Staged payload has no `results` array | input error — the integrity check and D5 require `payload.results` (`validateSidecars`, the `"payload has no 'results' array — cannot verify retrieval integrity"` check) |
| `stagedResultsRef` given for a nil search (`results_examined: 0`, `outcome: negative`) | allowed but discouraged; the caller should omit results for nil searches per §5.4.1 |
| `query` is prose rather than an object, on a read-style entry (`record_read`, `image_transcribe`, `image_read`) | **not reached** — the MCP input schema rejects it first. An ARK is dense with `:` and `/`, so a sentence containing one fails JSON parsing and the call is refused *before* the tool runs: nothing is logged and the turn is spent. This is why `search-records`' Step 5 prescribes a canonical key per read-style tool (`{"recordId": …}`, `{"recordIds": [...]}`, `{"imageArk": …}`). The mechanism belongs here rather than in the body, per CLAUDE.md's no-explanatory-prose rule; as of 2026-10-03 the body still restates it, and moving it out edits a snapshot input, so it waits on the next paid `search-records` eval release |
| `projectPath` missing `research.json` / invalid JSON | input error; write nothing |
| `projectPath` is a real directory holding **neither** project file | write nothing; `{ ok: false, reason: "no_project", errors }` — the user is not in a research project, so this is an answer rather than a failure and is **not** marked `isError`. This is the search-logging path, so it is the one that decides whether a standalone search says anything useful. A directory holding exactly one of the two files is a *broken* project and stays loud. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| Appended entry introduces a project-validation error | **write nothing** (unlink the new sidecar; every staged file is kept); return `{ ok: false, errors }`. A pre-existing error the append did not introduce rides as a warning |
| `stagedResultsRef` does not resolve under `projectPath/results/.staging/` | input error; write nothing |
| `stagedResultsRef` names no staged file — already logged by an earlier successful call, pruned after 24h, or never staged | input error, raised before any op is applied; write nothing. The message says each staged ref can be logged once: do not log it again if the search already has an entry, otherwise re-run the search |
| a batch names one `stagedResultsRef` in two ops | input error `ops[j]: stagedResultsRef '…' is also ops[i]'s`, raised before any op is applied; write nothing. Compared on the resolved path, so two spellings of one file collide |
| `notes` states the household structure of a census that carries no relationship-to-head column, without hedging it — the census the note names, or, for a `record_search` entry, the one its staged response shows; a staged `record_search` or `record_read` response whose titles are all British also supplies the jurisdiction of a census the note names without one | input error; write nothing, and in a batch no op's staged file is consumed. The message quotes the census and up to eight of the phrases it read as structure, names the missing column and quotes a compliant rewording, so the caller can fix the note in one try. See §8.2 |
| an explicit `query` on a staged `record_search` or `fulltext_search` entry names a filter key, with a value, that the staged search never sent | input error; write nothing, and in a batch no op's staged file is consumed. The message names each key and the value the call claimed, and says how to re-send: drop the key, omit `query` so the tool fills it, or re-run the search with the filter. No override. See §8.3 |
| `notes` (single-entry, or any op's) arrives JSON-escaped: no real newline once leading and trailing whitespace is ignored, at least two literal `\n`, and at least one literal `\n` that opens a table row (`\|`) or heading (`#`) | decoded, then handled as if sent decoded, with no warning. It decodes only `\n \r \t \" \\ \/ \uXXXX`; any other backslash (`\|`, `\*`, `\'`) is kept as sent. A second pass runs if the result still looks escaped, and no more than two. A trailing `"` is dropped first when it is the only unescaped quote in the note, since it is the escaped string's own closing quote. The decode runs before every precondition and before persistence, so the census check (§8.2) and validation judge the stored text. `unescapeJsonNotes` |

### 8.1 Non-blocking warnings (never fail the op)

Two advisories ride `validation.warnings` on a successful write. **These two**
are warnings rather than preconditions — they never touch `ok`, because a hard
block on either would trip the false-deny asymmetry
(`guardrail-enforcement-spec.md` §10), turning a lossy-but-recoverable session
into an availability regression. Neither is decidable from the note: both rest
on project-wide state (what else has been logged, what has been persisted) that
the caller may be about to supply in the next call.

This is not a blanket rule against preconditions on this tool — §8.2 and §8.3
are two that do block, and the distinction is what makes them legitimate.

- **Unretained results:** a `STAGING_SEARCH_TOOLS` search that reported
  `resultsAvailable > 0` but passed no `stagedResultsRef` discarded its verbatim
  response. Fires per offending entry.
- **Logging without persistence:** once **≥3** positive-outcome
  searches have been logged while the project still holds **zero** sources and
  **zero** assertions, the session is finding records and persisting no evidence
  (feedback bundle-2 shape: 26 log entries, 0 sources, 0 assertions). Gated on
  both being empty so it owns a distinct shape from `research_append`'s
  sources-without-assertions warning (which fires once ≥3 sources exist); it
  self-silences the instant any source or assertion lands, and fires on every
  qualifying `research_log_append` call while the two-empty state holds.
  Tool-neutral message. Reference lookups (`REFERENCE_LOOKUP_TOOLS`: `wiki_search`,
  `wiki_read`, `wikipedia_search`, `historical_context`, and the report-only agents'
  reports `source_evaluation`, `check_warnings`, `translation`, `convert_dates`,
  `validate_schema`) are not counted: their `positive` entries carry a looked-up
  article, overview or report in `notes`, not a record to persist. The pre-1880
  census hedge is unaffected.
  It cannot reach a session that logs nothing at all (bundle 3) — that shape has
  no tool-boundary trigger.

A third advisory rides a top-level `escalationDue` string rather than
`validation.warnings`, the shape of `record_search`'s `rankingSkipped` and
`nilSearchNeedsLog`, and like them it never touches `ok`:

- **Nil escalation:** once a call's nil entries bring a plan item to **3** nil
  `record_search` / `fulltext_search` entries (`outcome: negative`,
  `results_examined: 0`, no `results_available` above 0, counting this call's),
  `escalationDue` says the
  escalation trigger has fired, that the plan item goes to external sites next,
  and that a zero-result search is not a sign of an expired session. It fires
  only when the plan item's `record_type` is `census`, its plan's question is
  `open` or `in_progress`, and no entry for the plan item is `positive`,
  `partial` or an `external_site` search. The census scope is deliberate: a nil
  on a low-index record type (probate) is an index-coverage gap whose next step
  is full text, and index coverage is not in `research.json`. Everything it
  reads is, which is why this is a tool note and not prose — a prose version of
  the same trigger was measured and made a correct search give up early. A
  call that brings several plan items to the threshold gets one line per item.

### 8.2 A precondition that blocks: undocumented census structure

A note that states the family structure of a census whose schedule has **no
relationship-to-head column**, without marking it as inferred, is refused and
nothing is written.

This clears the §8.1 bar for a reason the other two cannot: it is decidable from
the note and the staged search response the entry is logged with, both already
in the project folder, which is ADR-0011's test for a writer-tool precondition.
No later call can change the answer. The refusal is also always actionable — the
note becomes compliant by saying what is true ("family structure inferred from
surname, ages and order, not stated"), so it costs a turn rather than losing
work. A batch runs the check on every op before any op is applied, so the refusal
comes before any op writes a sidecar. (No refusal consumes a staged file in any
case — see §4, batch form.)

Scope, and why it is this narrow:

- **The year binds to the census, never to the note.** A census note almost
  always carries birth years older than the census itself, so a whole-note year
  test refuses the documented censuses it is meant to allow. Only a year
  syntactically attached to the word "census" counts.
- **A census word binds a year on one side only.** A word with a year before it
  does not also take a single year after it: in "1900 census 1853/Maine", "the
  1900 census, 1853 Maine" and "1900 census (1853, Maine)" the 1853 is a birth
  year, and read as an 1853 census it refused "Mogom household, 1880 census: …
  1900 census 1853/Maine", a note about the 1880 census. A run of two or more
  years after it still binds ("Searched 1880 census, 1870 and 1860"), and a word
  with no year before it still takes the one after ("US Census 1870"). A year
  straight after a vital-event marker — `b.`, `born`, `bapt.`, `bp.`, `chr.`,
  `d.`, `died`, `m.`, `married`, `bur.` — never binds, even before "census", so
  "Patrick Flynn b. 1840 United States Census, 1850" is the 1850 census. The
  one-letter markers count in lower case only, so an initial ("John B. 1850
  census") is not one. What this gives up: a single year after a bound word is
  never read as a census, even when it is one ("1880 census (1870, Pike
  County)"), and losing it can put a note under the head-only rule below:
  "1840 census, 1850: John Smith household" reads as 1840 alone and passes. In
  the committed corpus (2026-10-18) two notes bind differently from `main` and
  neither verdict moves: "1881 census, 1891 census" loses a duplicate 1891, and
  "Milan Raney (b. 1891, 1910 census)" no longer reads the birth year as a census.
- **The jurisdiction binds the same way.** The doctrine is US-federal, where
  1880 is the dividing line. England & Wales and Scotland gained the column in
  1851, so a post-1851 British census is documented and must pass. A named
  jurisdiction with no documented threshold skips the rule rather than guessing.
  The jurisdiction must touch the census token: most non-US words in real notes
  are birthplaces on a US schedule ("1850 US Census, Schuylkill County ... born
  Ireland"), which stays refused.
  **An unqualified mention takes its jurisdiction from the staged payload**
  (decided at review-ready 2026-10-14). An unqualified census reads as US, so
  "1851 census, Trowbridge: Job Purnell head of household, wife Ann." logged
  against an English search was refused as a US census. When the entry's staged
  payload (`record_search` rows' `collectionTitle`, or a `record_read` record's
  `sd_c_` collection description) has at least one titled row and every titled
  row starts with a British name (England, Wales, Scotland, Great Britain, United
  Kingdom — so not "New England" or "British Columbia"), an unqualified mention
  takes the 1851 threshold. A mention that names its own jurisdiction keeps it,
  and "US", "U.S.", "USA", "United States", "federal", "census of the U.S." and
  any `pre-<year>` or `before <year>` census all name the US — so "pre-1851
  census" against English rows still reads as US, as it does on `main`. Anything else — a US row, a mixed payload,
  another jurisdiction, no titles — changes nothing. This supplies the
  jurisdiction; it does not skip the check, so an 1841 mention against English
  rows stays refused ("still refuses an 1841 England census" in
  `pre1880-census-hedge.test.ts`), now in British words. The rejected option
  skipped the note-only path whenever no staged row was a US federal census: it
  accepts "1841 England census … wife" and frees none of the church-records
  notes, whose payload names no census.
- **A 1790–1840 US census names only the head.** Those schedules name the head
  of each household and count everyone else in age-and-sex tallies, so a head
  named off one is what the census states. When every census that fired is a US
  one of 1790, 1800, 1810, 1820, 1830 or 1840 — or, when the note binds none,
  every year of the staged payload is — a claim that names only the head is
  excused: `household of ⟨X⟩`, `⟨X⟩'s household`, `⟨X⟩ household`, `heads a
  household`, `household headed by ⟨X⟩`, `Household head ⟨X⟩`, `head of
  household`, `as head` and `(head)`, but not `as the head's …`. So a nil ("No
  Geach household indexed in the 1830 U.S. census") passes too. Every other
  claim still refuses: a kinship word before a name (`with wife Mary`), any
  other `as` or bracketed role, `in … household`, `household includes`, a
  roster, `living with` / `enumerated with`, named co-residents, and against a
  staged payload the punctuated plural and the possessive.

  A note whose head claim is excused is also read for anyone else, sentence by
  sentence, skipping a sentence that names another record type or the tree. Any
  of these refuses it:
  - a relationship word, in any case, with no name after it and after
    his/her/their too (`Wife Mary.`, `wife and 3 children in tallies`, `his wife
    Mary`, `father of Patrick`, `grandson Amos`);
  - a capitalised run after `with`, `includes`, `including`, `contains`,
    `comprises`, `holds` or `enumerated in`/`with`, unless the run is a place
    (`includes Amos Whitfield`, but not `enumerated in Fallsbury Township`);
  - two or more names with ages (`John (40), Mary (38), Thomas (12)`);
  - a name put on a tally (`Mary Flynn is the female 30-40`); the head's own
    tally reads the same way and is refused too;
  - `⟨Name⟩ enumerated in it`;
  - two or more names in a bracket straight after the household name: `Thomas
    Flynn household (Mary, Patrick, Bridget)`, `Household of Thomas Flynn
    [Mary, Patrick]`, `Thomas Flynn's household (Mary; Patrick)`.

  The bracket is split on commas, semicolons, `&` and `and`. A lower-case label
  opening it (`members:`, `incl.`) comes off, and so does each item's aside in
  brackets and one person's age or birth (`age 38`, `b. 1802`; a tally's `aged
  30-40` stays). A name is one to three capitalised words with no digit and no
  `Census`. The bracket is not read when any item is a place (a state or
  country name, or a place word such as `County`, `Twp` or `PA`, not counting
  the head's own name, so `Household of Thomas Ward (Mary Ward, Patrick Ward)`
  still reads), when every name in it is the head's own (`Household of David
  Bagley (Bagley, David)`, the head written surname-first), when it lists
  spellings, or when it holds one item, which may be the head or a place. So
  `(Cincinnati, Hamilton, Ohio)`, `(Dwelling 84, Family 91)`, `(Birmingham)`,
  `(XHRB-V42, XHRB-V4V)` and a source citation pass. With no lexicon of names,
  two capitalised words that are not people still read as names and refuse: a
  place list with no state or place word (`(Cincinnati, Hamilton)`), a tally
  with no counts (`(Free White Males, Free White Females)`), and variant
  spellings with no `spellings` word (`(Flinn, Flynne)`). The refusal quotes
  the bracket, so adding the state, the counts or the word clears it. On an
  1850 schedule the household name already refuses the note, so the bracket is
  not read there.

  A relationship word is read whatever it qualifies, so "spouse field absent"
  beside a head claim is refused too, and the refusal quotes the word. A note
  that makes no head claim is not read this way, and keeps the verdict the
  older arms give it: read regardless, these refused 8 committed notes and 1
  paired payload op that `main` accepts, every one a search note that mentions
  a relative ("check age columns for male child ~5", "if Nehemiah is
  Elizabeth's father", "consistent with Peter Geach dying circa 1839-1840"). A
  hedge clears any of them, as it clears the same note on an 1850 census. These
  shapes still pass:
  - "Thomas Flynn, Household head; his son Patrick is the male 5-10". It makes
    no head claim, and `his son` is the older arms' tree-side carve-out, so the
    1850 note passes the same way.
  - names with bare numbers, `(Mary 38, Patrick 12)`. A schedule locator is
    written the same way (`(Dwelling 84, Family 91)`), and nothing short of a
    lexicon tells the two apart.
  - a list after a comma or a dash (`Thomas Flynn household, Mary, Patrick and
    Bridget`, `Thomas Flynn household — Mary, Patrick`). Only a bracket marks
    where a list ends, and after a household name the committed run logs put
    places and commentary there: 54 of their distinct notes have a comma there
    and 10 a dash (2026-10-19), and none of them lists people.
  - names joined by slashes, `(Mary/Patrick/Bridget)`: a slash joins variant
    spellings as often as people.
  - a single name, `(Mary Flynn)`.

  `pre1880-census-hedge.test.ts` pins each of these, and each refusal above.

  A note that also names an 1850–1870 census keeps the full rule for
  it, and any other year ("1801 census", which the US did not take) or a British
  mention is unchanged. The refusal says why in head-only words. This revises the
  2026-10-14 ruling that this check does not change (lead, 2026-10-18): that
  ruling was made for survey-surname tables (survey-surname-agent-spec.md, "The
  hedge line") and did not consider these shapes. Measured with
  `dev/measure-census-hedge-refusals.ts` against `main` at 0ae117dd2
  (2026-10-19), together with the binding above, the reading for anyone else,
  the bracket reading and the two roster fixes below: **0** notes and **0**
  paired payload ops newly refused, **5** notes newly freed — four nil searches
  for an 1830 or 1840 household and one 1840 hit that names only its head,
  through the FamilySearch record title it quotes. That hit's one relationship
  word, "the father named in the 1884 death records", sits in a sentence about
  another record. The bracket reading alone changes no committed note's
  verdict, in either direction, against this branch without it.
- **Undecidable inputs skip** rather than guessing: when no year binds to a
  census at all, the note-only gate does not fire — the same behaviour as an
  undocumented jurisdiction. What this gives up: an unhedged pre-1880 US census
  note whose phrasing the adjacency patterns above do not cover (e.g. "The
  federal census shows Daniel in one dwelling with Margaret and sons Thomas and
  Stephen; marriage 1871, Adams County"). The staged-payload trigger still fires
  for `record_search` entries. Decided (lead, 2026-09-29).
- **The staged search decides when the note does not.** For a `record_search`
  entry with a `stagedResultsRef`, the check reads the staged rows'
  `collectionTitle` — FamilySearch's own words, which the caller does not author.
  When every titled row is a US federal census before 1880 (matched by title
  shape, never by the note's census patterns, which read an unqualified census as
  US and would take "Ecuador, Census, 1737-1990" for one), the note is judged
  whatever word it uses, provided it binds no census year of its own. A bound
  year keeps precedence, so no note-only verdict moves on the census years (a
  British payload can still re-jurisdiction an unqualified bound year — see the
  jurisdiction bullet above). A mixed search (1850 and
  1880 rows) does not decide, because the note may describe the other row; nor
  does "the top-ranked row", which is the best match only when ranking ran.
  Other search tools carry no collection title and keep the note-only rule;
  `record_read` feeds only the jurisdiction above, never the census years.
- **The note does not have to repeat the census year** (2026-10-02). Until then
  the payload tie also required one of its years to appear in the note text,
  which hid real misses: `ut_search_records_001` ("…in household of Thomas
  Flynn") and `_017` ("…in household of William Mullen") each carry a *birth*
  year and no census year, wrote flat, and were caught by the eval validator
  after the write instead of refused at it. This is **not** the whole-note
  fallback the lead declined on 2026-09-29, which read any
  `18[0-7]\d` out of the note: this branch reads no year out of the note at all.
- **A note ABOUT another record type is carved out, positionally.** The payload
  cannot prove the note is about a census row — `stagedPre1880UsCensusYears`
  counts only rows carrying a `collectionTitle`, so an untitled parish-register
  row can share a staged payload with the titled 1850 rows that produced the
  years. Where the note *names another source before the claim it qualifies*,
  the payload stops deciding and the note must bind its own census year. The
  order is what carries it: a note about a parish register leads with it, while
  a census note that mentions one later ("…in the Household of Nancy Doss.
  Cross-check the parish register next.") is still a census note. The carve-out
  is a list of phrases that **name a record** (`will of`, never a bare `will`,
  which the ordinary verb matched and which cancelled the gate outright), each
  carrying its plural (`church records`, `marriage records`), and it is anchored
  on the earliest of the household and kinship claims rather than on the
  household word alone.
- **A household word is not a household claim, and the test is grammatical.**
  `household` and `dwelling` are ordinary nouns for the concept as much as for a
  particular one, so one of them counts only in a relation that puts someone in
  it: `household of ⟨X⟩`, `in … household`, `⟨X⟩'s household`, `household
  includes`, `heads a household`, or a noun compound (`Thomas Flynn household`).
  Without this the payload trigger refused notes that assert nothing:
  `ut_search_records_027`'s "Spouse field absent in index — reading full record
  to view household members and marriage indicator" only says what it is about
  to read, and "no Stribling appeared as a household head on any readable page"
  is a negative result. The relational phrases (`co-resident`, `enumerated
  with`, `living with`) are exempt, because they predicate co-residence on their
  own. The plural `co-residents` counts only with the people named after it
  (`sidecar co-residents are Henry and Margaret Ackerman only`, which walked
  through when only the singular was read), so "no co-residents listed",
  "co-residents not checked" and "Co-residents: None listed" stay notes about
  the search.

  On the kinship side: a role labelling a named person (`Amos (head), Nancy
  (wife)`); a role stated with `as` (`Mary Flynn listed as wife`, `Thomas Flynn
  as head`), but only in a sentence that names no other record type and does not
  mention the tree, since "the death records naming Sarah A. Bagley as mother" is
  what those records state and "recorded in the tree as wife of Thomas" is what
  the tree states;
  and `Household head ⟨Name⟩`, which wants the name, so "no Stribling appeared
  as a household head" stays a negative result. Against a staged pre-1880
  payload only: a plural role parted from its names by punctuation (`plus sons,
  Thos T McElwee and Stephen McElwee`) and a possessive (`are Amos's children`).
  In a note alone those two refused a search plan ("Searched 1850 census for
  children, Mary and John: nil") and a christening aside (`JPW's children were
  christened`). The singular roles keep needing a space (`Groom's father:
  Christopher Jespersen` is a marriage record's field label). `spouse` is not a
  role word at all: adding it newly refused 6 notes and 3 payload ops, every one
  a search anchor ("with spouse Unna", "added spouse anchor Juana Flores"). Every
  one of these narrowings comes from the corpus re-measure or review, where the
  wider form refused exactly the note quoted.

  **A household phrase followed by a roster is a claim too**, because it places
  people in the household exactly as `household includes ⟨X⟩` does: `Household
  shows George, Henry, and Margaret Ackerman`, `household members George, Henry
  Ackerman, and Margaret`, `Household per sidecar: George, Henry, Margaret`,
  `Household indexed as George, Henry, and Margaret Ackerman`. All four are real
  `ut_search_records_027` notes that passed this gate unhedged. Up to three
  lower-case words of any kind may sit between the noun and the list: a list of
  linking verbs was tried first, and each round of runs found a wording it
  lacked, while the list's own shape is what carries the claim. A pasted
  transcription with no household phrase in front of it is not affected, so the
  transcription paragraph below still holds. The roster arm reads case under the
  compound arm's terms — one of three conditions: the household phrase, two or
  more capitalised runs joined by a comma or `and`, and at least two of them
  naming no place — no place marker (`Household shows Bucks Co., PA …`), no
  plural place noun after the list (`household search of Fayette, Greene and
  Washington counties`), and not
  a state or common emigrant-country name (`Household search covered Ohio,
  Indiana and Kentucky`). The states that are also given names (`Virginia`,
  `Georgia`, `Florida`, `Nevada`) are left off that list on purpose: a missing
  place refuses a note the caller can rewrite, a person wrongly listed would
  cancel the deny silently. A list introduced as spellings, variants, surnames
  or forms (`Household spellings tried: Flynn, Flinn and Flynne`) is a list of
  names searched, not of people; `names` is not among those words, because
  `Household names: George, Henry and Margaret` is a roster. Two more lists are
  not of people: one straight after `household in`, `at` or `near` (`household
  in Norwalk, Fairfield, CT`), and a FamilySearch record title, which names the
  head and then the collection (`Household of David Bagley, United States,
  Census, 1840`: neither `United States` nor a run with `Census` in it is a
  person). A roster written in lower case is missed.

  **Capitalisation is never the test.** The first version asked whether a
  capital sat within 24 characters of the noun, which is not a test for a name
  and failed in both directions at once: it missed `amos whitfield in household
  of nancy doss` and `Amos in the doss household`, and it fired on `no household
  found in Pike County` and `Bucks Co., PA household: no Whitfield found`. The
  compound arm is the one clause that still reads case, and there it is one of
  three conditions — the run must also name no place (`Co`, `County`, `Twp`, a
  two-letter state abbreviation…), must survive having its leading
  non-name tokens stripped (sentence-opening determiners, and the ordinary
  words that start these notes' sentences: `Census`, `Federal`, `State`,
  `Found`, `Reading`, `Result`), and the noun must carry no abstract complement
  (`household records`, `household composition`).

  **Every clause and guard goes red when it alone is removed**, which is
  checked by `dev/mutate-census-hedge.ts` rather than asserted. Run it rather
  than trusting this sentence: it takes each one out in turn, including which
  arms count as naming only the head, and exits non-zero on any the suite does
  not notice. Two rounds of this card shipped a mechanism no test exercised,
  each time because a note written for one clause incidentally satisfied a
  neighbour, so reading the tests does not substitute. A green row means the
  clause needs a test **or** is inert — one
  was deleted on that finding rather than given a test it could not fail.

  **The sweep proves it ran before it reports.** Its first version launched
  vitest through `npx` and read any unparsable output as a red, so on Windows —
  where `execFileSync("npx", …)` throws `ENOENT` — it printed "18 of 18 pinned"
  and exited 0 having run no tests, in the script this paragraph tells you to
  trust over the prose. It now runs the unmutated suite first and stops if that
  cannot run or is already red, counts a mutation as red only on a parsed
  failure count, treats anything else as an error, and launches vitest as plain
  `node node_modules/vitest/vitest.mjs` so there is no `.cmd` to resolve. Those
  guards are themselves broken five ways and each exit non-zero: an unrunnable
  runner, a missing vitest, a baseline already red, an unpinned clause, and a
  stale sweep entry whose substring no longer matches the source.

  **Negation and intent are not read.** A note that names a household in one of
  these relations is refused however it frames it: with a staged pre-1880
  payload, "Searched Whitfield household in Dodge Precinct: nil", "plan to check
  the Thomas Flynn household" and "no co-resident spouse found" are all refused,
  and none asserts a household. The corpus nils pass only because they name
  nobody ("No matching household found"), which is an accident of phrasing
  rather than a rule. The refusal costs a turn and is actionable, so the limit
  is tolerable where a silent miss would not be; closing it is a widening of a
  deny and needs the corpus re-measure, not a keyword list.

  **Relations are read sentence by sentence**, because one does not reach across
  a full stop: in "…not indexed in FamilySearch. Rebecca's 1840 household cannot
  be confirmed" the `in` belongs to the first sentence and the noun to the
  second. The split is on a terminator followed by a space, so `Bucks Co., PA`
  and `Sarah A. Mullen` are not cut at their abbreviating periods.
- **"Indexed" beside a role word is a hedge** ("Role indexed as 'Head'").
  Flagging a *name* as indexed is not.
- **The refusal quotes what it fired on**: the census as the note wrote it
  ("1850 census", "pre-1880 census"), or the staged census years when the
  payload decided, and the phrases it read as structure, as written ("wife
  Mary", "household of", "William Mullen household") but with the note's own
  double quotes taken out, each once and none that sits inside a longer one,
  up to eight. Without them
  the caller had to guess which words to change, and a birth year read as a
  census year ("census 1853") was invisible.
- **The hedge is accepted however it is hyphenated.** The refusal message spells
  it "relationship-to-head column"; the hedge patterns accepted only spaces, so
  a caller who hedged in the exact words they were handed was refused a second
  time with no wording in the message that would clear it.
- **"No relationships stated" and "does not record … relationship" are hedges.**
  A `ut_search_records_027` note saying both was graded compliant on every
  dimension.
- **"pre-1880 census" binds as a census before 1880.** Read as 1880, which has
  the column, it skipped the whole note whatever else the note asserted. The
  prefix takes a year off the year it touches only: "before 1880 and 1880
  census" is a pre-1880 census and the 1880 one.
- **This function is the only copy of the rule.** `search-records`'
  `test_pre1880_census_structure_marked_inferred` used to grade notes with wider
  word lists of its own, so a note this gate accepted could still fail grading,
  with nothing at write time to tell the model — `ut_search_records_027` flapped
  on exactly that. A replay of this function in its place could not fail, since
  a refused note is never logged. The validator now checks only what the model
  can still get wrong: that every search whose note this gate refused is logged
  again afterwards. `test_mock_mcp` proves the eval's write path runs this check
  on a staged 1850 search, and widening what counts as a claim is done here,
  measured and mutation-tested.

Measured over the 4,322 distinct `notes` arguments in the committed run logs
(2026-10-04; re-derive with
`dev/measure-census-hedge-refusals.ts` rather than quote — the corpus moves with
every committed run, and shrinks as well as grows, because a re-run replaces a
skill's run log), the note-only rule refuses 146 (3.4%). Of the 1,998 staged
`record_search` entries with a note, 861 pair to the search response that staged
them (e2e run logs keep only a truncated summary, so the rest cannot be paired);
the staged search refuses 29 of those 861 (3.4%), of which 7 are refused only
because of the payload.

Against `main` — the baseline that matters, since it is what ships today — the
whole of this section's change newly refuses **0 notes and 3 payload ops**, and
newly frees **41 distinct notes** — 41 on the note-only axis and 11 on the
payload axis, every one of the 11 already among the 41, so they are repeats of
the same strings rather than a separate population. All three newly refused are
flat "in household of ⟨Name⟩" claims logged against an 1850 payload, the shape
the rule exists for.

The roster arm, the named plural `co-residents`, the `as`-role and `Household
head ⟨Name⟩` shapes, the payload-only punctuated plural and possessive, the two
"no relationship" hedges and the `pre-1880` binding, measured together against
`main` at 7f482e579 (2026-10-12), newly refuse **0** and newly free **0** notes
or paired payload ops in the committed corpus. Each closes a wording seen in uncommitted
`ut_search_records_027` scratch runs, or one the eval validator caught before it
became a replay of this check; the corpus measures that none of them reaches a
note it did not already judge the same way.

Every one of the 41 freed was read, and the right summary is that **none is an
unhedged claim** — not that none names anyone. Most are search plans, nil
results, candidate lists and negative findings. Two groups are not, and both
are deliberate:

- **Four John Baker notes** list eight household members by name and are freed
  because each ends "No relationship-to-head column in 1870 census". They were
  refused before only because the hedge detector did not accept the hyphenated
  spelling the refusal message itself prints.
- **Three verbatim transcriptions** — the pasted Thomas Flynn 1850 listing, the
  pasted Silas Kerrigan 1860 listing and the Josiah Barnes 1855 result — give a
  household's members with ages, birthplaces and occupations and assert **no
  relationship**: no "wife", no "son", and the brackets hold an age rather than
  a role. On a pre-1880 schedule co-residence *is* stated and only kinship is
  not, so recording the one without the other is the compliant shape, not a
  violation of it.

An earlier version of this round freed two more that **were** unhedged claims,
and both are now refused: "wife is listed as Mary A. Ranny" on an 1870 schedule
(a rejection note, which this spec's own §8.2 position says still writes the
claim) and "children Thomas (b.1829), Mary (b.1830) … confirms Thomas and
Elizabeth Young as a married couple" on an 1841 England schedule. The first
needed a report verb between the role and the name, the second needed
`children` in the kinship list.

Two earlier versions of this test were measured and discarded, and both failures
are worth keeping. Requiring a name of the *whole* anchor set freed "1860
census: Elijah Wilkins … with Sarah Wilkins … as co-resident spouse. Children:
Margaret E (1841)", a real violation — which is why the relational phrases are
exempt. Dropping the noun-compound arm freed eleven more, including "Thomas
Flynn household, Dwelling 84, Family 91" — which is why that arm exists despite
being the one clause that still reads case. Both cases are pinned in
`pre1880-census-hedge.test.ts`.

Against the fallback-present baseline (before the 2026-09-29 change deleted the
whole-note `18[0-7]\d` test), 46 notes were newly freed and 0 newly refused
(note-only); 12 payload ops newly freed and 0 newly refused. A census
named before 1800 is still refused — it is caught by the year-binding branch,
not by the deleted fallback.

The lead rejected a tool-boundary content gate on 2026-08-27 on three grounds:
a 41% refusal rate, non-generalizability outside the US, and the signal being
author-supplied and optional. `requirePre1880CensusHedge`'s docstring in
`research-log-append.ts` carries the second verbatim, with the issue it was
ruled on. The binding above answers the first two — the rate
is 3.4% of notes, and non-US censuses that carry the column are excluded. The
staged search answers most of the third for `record_search`: the census is read
from FamilySearch's response, not from the caller. What still stands is the
reach: a note logged by any other tool, or with no staged response, is judged on
its own text alone (a staged `record_read` only supplies the jurisdiction of an
unqualified mention, never the census year) and keeps every limit above — chiefly that an unbound census
year skips the rule. This narrows a common failure rather than closing a hole.

The trigger word was the same hole, and more broadly. On note text alone the
rule fires on `\bcensus\b`, so a note that describes a pre-1880 census household
without ever using the word passed. That is not hypothetical: "1 result
returned: Amos Whitfield, b. 1817, Georgia, in Pike, Kentucky, 1850. Indexed
within the Household of Nancy Doss" is a real note, the recorded
`ut_search_records_h4k` failure in the 2026-09-15 17:48 `search-records` run,
which the eval-plane validator `test_pre1880_census_structure_marked_inferred`
failed and the tool allowed. It is refused now when logged with the staged 1850
census it came from; without a staged response it still passes, and
`pre1880-census-hedge.test.ts` pins both, as it pins the plural-only hole.


### 8.3 A precondition that blocks: a filter the search never sent

An explicit `query` that names a filter its staged search never sent is refused
and nothing is written. The ground truth is the staged payload's `query`, which
`record_search` and `fulltext_search` fill with their own echo of the call's
arguments (`search-result-staging-spec.md` §6), so the caller does not author it.
Those two are the only producers judged: `external_links_search`,
`image_transcribe`, `record_read` and `person_read` stage no `echoQuery` of
their arguments, and
`person_search` does not stage.

A key is refused only when all four hold: it is an input parameter of the
producing tool's schema; it is a filter (§7); the caller gave it a value (`null`,
`""` and an `*Exact: false` claim nothing); and the search did not send it at all
— the staged `query`, with `record_search`'s alternate-name pairing applied. A key
the search sent with a different value is allowed. No staged handle means no
ground truth, so a nil search, which stages nothing, is never judged; an omitted
`query` is filled rather than judged; an unreadable staged file is left for
finalize to report. The check runs over every op before any op is applied, so
the refusal comes before any op writes a sidecar.

Measured at a1960c5af with `dev/measure-log-query-claims.ts`, which pairs each
logged op to the call whose response staged its handle and judges it with the
tool's own `neverSentFilterClaims` against that call's arguments. Re-derive
rather than quote; a re-run replaces a skill's run log. Of the staged ops with an
explicit query, 358 pair to their search, and the rule refuses 18 of them: 15
distinct claims, the rest re-sends of a call refused for another reason. Every
one was read, and every one is a true positive — a claimed `collectionId`,
`recordType`, `sex` or `recordCountry` the search never sent, a mother-name
filter logged for a search on the primary name, or a place logged under
`residencePlace`/`birthPlace` for a search that sent it as `anyPlace`. All 18
are in e2e and exploratory run logs; the 121 paired unit-eval ops refuse none.
The unit-eval entries that do misstate a filter are, on inspection, ones whose
`query` the tool FILLED: the caller omitted it, and the staged payload it was
filled from had been built by the eval mock from a fixture's recorded query
rather than the call's arguments. That was a harness artifact, and it is gone
going forward (next paragraph). Entries with no staged handle — nil searches —
stay visible only to the eval's `report_*` observers.

The unit harness stages the call's arguments, not a fixture's canned query: the
eval mock echoes the args into `query` for these two tools, as production does,
or this check would refuse honest entries in every unit eval whose fixture was
recorded for different arguments.
---

## 9. Test plan (vitest)

- **Positive search with sidecar** — appends one `log_` entry; `results_ref` =
  `results/<log_id>.json`; sidecar `returned_count` equals payload results length;
  `log_id` matches entry and filename; project validates.
- **Nil search** — `outcome: negative`, `results_examined: 0`, no payload → no
  sidecar, `results_ref: null`; entry validates.
- **External-site search** — `tool: external_site` with `externalSite`; no sidecar;
  `external_site` object persisted; rejects when `externalSite` absent.
- **Id assignment** — appending to a log with `log_001..log_009` yields `log_010`
  (max + 1, not count + 1).
- **Append-only** — existing entries are byte-unchanged after an append.
- **Integrity guard** — a payload whose `results` length disagrees with the count
  the tool would write can never be persisted (the tool computes the count, so this
  is structurally impossible; assert the written count always matches).
- **Validate-before-persist** — an append that would invalidate the project writes
  nothing and returns `{ ok: false, errors }`; no orphan sidecar remains.
- **Atomicity** — simulated failure after the sidecar write leaves `research.json`
  unchanged and the sidecar removed (or surfaced as an orphan on re-validate).
- **Orphan recovery** — a crash injected between the sidecar write (step 2) and the
  `research.json` commit (step 4) leaves an orphan sidecar; `validate_research_schema`
  flags it; a re-run allocates a fresh `log_id` and succeeds with no orphan left.
- **camelCase→snake_case** — persisted entry uses snake_case keys throughout.
- **Non-blocking warnings (§8.1)** — the unretained-results warning fires when a
  staging search tool reports `resultsAvailable > 0` with no `stagedResultsRef`
  and stays silent for a nil search; the logging-without-persistence nudge fires
  once ≥3 positive searches are logged with zero sources and zero assertions,
  stays silent below the threshold, stays silent once any source or assertion
  exists, and does not count reference-lookup entries. Both keep `ok: true` and leave the log entry written.
- **Nil escalation (§8.1)** — `escalationDue` appears on the third nil against a
  census plan item with an open question, single or batched; stays absent at two,
  for a probate plan item, once the plan item has a positive or partial entry or
  an `external_site` entry, when the question is resolved or declared exhaustive,
  for a null `planItemId`, for nil `external_links_search` fetches, for a
  search whose results were left unexamined, and when the call itself logs no
  nil; a batch reaching the threshold on two plan items names both.
- **Census check on the staged search (§8.2)** — every payload staged by
  `stageSearchResults` from the real `record_search` fixture shape, never
  hand-built: an unhedged household note with no census word is refused on a
  staged 1850 US census (no sidecar written, staged file kept) and allowed on an
  England and Wales 1851 census, a mixed 1850/1880 search, `fulltext_search` and
  `external_links_search` payloads, and a nil search; a parish-register note is
  allowed on an 1850 census; a missing staged file reports finalize's error, not
  the census refusal; a staged handle spelled `./results/.staging/...` or as an
  absolute path is judged the same as the plain one; a batch refusal of op 1 leaves op 0's staged file in place.
- **Never-sent filter check (§8.3)** — refused, with nothing written and the
  staged file kept: an explicit `recordType` the staged `record_search` never
  sent, several keys at once (all named), a stringified `query`, the same in a
  batch (no op's staged file consumed), and a `fulltext_search` `place`.
  Allowed: a key sent with a different value, a descriptive key, host plumbing,
  paging left at its defaults, `null` and `""` values, an empty `query`, a query
  that echoes the call, an omitted `query` (filled, plumbing stripped), no staged
  handle, a staged payload with no `query`, and an `external_links_search`
  handle.
- **JSON-escaped notes (§8)** — decoded and stored with real newlines, single
  and batched: `\n`, `\"`, `\t` and `\uXXXX` escapes, a whole household table, a
  table escaped twice, one with a single real leading or trailing newline, an
  escaped heading-only note, and a leaked closing quote (dropped). Partly
  escaped tables decode around a raw quote or tab and keep `\|`, `\'`, `\*`,
  `\_` and a lone trailing backslash. Left unchanged: a note with a real newline
  inside, Windows paths and prose that name `\n`, escaped prose with no table or
  heading, a single literal `\n|`, a plain note whose only quote mark ends it,
  and the empty string. The census check judges the decoded text: a hedged
  escaped table passes and an unhedged one is refused, with or without a
  trailing real newline.

---

## 10. Non-goals

- No log update or delete (Rule 3).
- Not the broader `research_append` (sources/assertions/etc.) — separate spec.
- Does not change the search tools' model-facing output. (The producer-side staging
  behavior is specced in `search-result-staging-spec.md`.)
- No new validation rules; reuses the existing validator via `validateParsed`.

---

## 11. Consumers

- `search-records`, `search-external-sites`, `search-full-text` — replace their
  hand-written log + sidecar step with a `research_log_append` call. Their
  `research-log-protocol.md` references shrink to "call the tool" + the analytical
  rules (when to log negative, what to put in `query`/`notes`).
- `extraction_append` — calls it in code: a `record_read` entry for each
  `recordIds` record it reads, and an `image_transcribe` or `user_provided` entry
  for each `documents` source.
- Downstream skills are unaffected: they still link to a log entry via
  `log_entry_id` on sources/assertions (the reverse-lookup provenance model is
  unchanged).
