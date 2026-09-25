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
(`search-records`, `search-external-sites`, `search-full-text`, `record-extraction`).
The hand-write is the worst-case version of the problems the read/write direction
exists to kill:

- **The big-write failure is already documented.** The protocol tells the LLM to
  write sidecar payloads "in ~40-result chunks" because "reproducing a large
  payload into a single `Write` is reliable up to ~50 results"
  (`research-log-protocol.md` §"Result sidecar files"). That chunking dance is a
  workaround for LLM serialization stalling — exactly what a tool removes.
- **`returned_count` integrity is hand-maintained.** The validator hard-fails when
  `returned_count !== payload.results.length` (`validator.ts:1024`). The LLM must
  count its own results correctly; a tool computes it.
- **Three-way id wiring is hand-done and validator-enforced.** `results_ref` =
  `results/<log_id>.json`, sidecar `log_id` = log entry `id` = filename
  (`validator.ts:1012–1017`). A tool wires all three by construction.
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
| Append-only rule; nil searches still logged; outputs link back via `log_entry_id` | `search-records/references/research-log-protocol.md` |
| Log entry fields + `external_site` shape | `docs/specs/research-schema-spec.md` §5.4 |
| Sidecar shape `{ log_id, tool, retrieved, returned_count, payload }`; nil → no sidecar | `research-schema-spec.md` §5.4.1 |
| Required log fields, `log_outcome` enum, `external_site` required when `tool==="external_site"`, `EXTERNAL_SITE_VALUES` | `src/validation/validator.ts:431–453` |
| Sidecar checks: `log_id`↔entry↔filename, `returned_count`==`payload.results.length`, orphan detection, path-traversal guard, D5 persona resolution | `src/validation/validator.ts:953–1104` |
| The protocol reference duplicated across the four writing skills | `*/references/research-log-protocol.md` (4 copies) |

---

## 4. The tool

```typescript
research_log_append({
  projectPath: string,            // dir holding research.json + results/
  tool: string,                   // "record_search" | "fulltext_search" | "image_search"
                                  //   | "person_read" | "external_site" | ...
  query: object,                  // freeform — enough to reproduce the search
  outcome: "positive" | "negative" | "partial" | "error",
  resultsExamined: number,
  planItemId: string | null,      // pli_ reference, or null for ad-hoc (see planItemId validation below)
  resultsAvailable?: number | null,
  notes?: string | null,
  externalSite?: {                // REQUIRED when tool === "external_site"; else null/omit
    site: "ancestry" | "myheritage" | "findmypast" | "findagrave" | "newspapers" | "familysearch_web"
          | "chronicling_america" | "digital_newspaper_archive" | "archives_gov" | "archive_org"
          | "billiongraves" | "digitalarkivet" | "antenati" | "library_archives_canada"
          | "american_ancestors" | "italian_genealogy",
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
introducing a new invariant. The §8.2 census check is the exception to per-op
ordering: it runs over every op before any op is applied, so its refusal
consumes no staged file.

**Success response.** `{ ok: true, logId, performed, resultsRef, returnedCount,
filesWritten, validation: { valid: true, warnings } }` for a single call, or
`{ ok: true, results: [...], filesWritten, validation }` for a batch. Either may
carry `escalationDue: string`, present only when §8.1's nil-escalation note fires.

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
`resultsExamined > 0` must carry `outcome: "positive"`: the entry grades the
curated-links FETCH, not whether any link fit the plan item (that goes in
`notes`). Enforced mechanically because the prose instruction in SKILL.md was
measured to be ignored often enough to need a hard gate: 4 of 66
`external_links_search` entries across the five run logs this branch commits,
in three tests and three of the five logs (measured 2026-09-10).

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
`log_id` + recompute `returned_count` + write + unlink) and **the payload never
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
   assigned `log_id`, write it, and unlink the staged file (a host-side byte move —
   see `search-result-staging-spec.md` §6). Nil searches and external-site searches
   write **no** sidecar and set `results_ref: null` (`research-schema-spec.md`
   §5.4.1).
3. **Validate** with `validateParsed(research, tree, { projectPath })`
   (`validate-project-refactor-spec.md`). The in-memory `research` already holds the
   appended entry referencing the new sidecar, and the sidecar is now on disk — so
   the sidecar checks (`returned_count`, `log_id` match, orphan, D5) all run against
   the would-be-committed state. `tree.gedcomx.json` is read unchanged for cross-file
   checks.
4. If valid → commit `research.json` (temp + rename). If invalid → **unlink the
   sidecar just written** and write nothing to `research.json`; return
   `{ ok: false, errors }`.

This yields the never-invalid guarantee. Known minor: a crash between steps 2 and 4
can leave an orphan sidecar (written, not yet referenced on disk); the next
`validate_research_schema` surfaces it as an orphan error, and a re-run is safe
(the tool allocates a fresh `log_id`). Acceptable for v1; an in-memory-sidecar
validation path (validate before any disk write) is the future cleanup.

**Validation cost.** Step 3 runs the *full* project validator, and `validateSidecars`
(`validator.ts:953`) reads every `results/` sidecar payload and re-resolves every
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

The caller still makes every analytical call (was the outcome negative? is this
absence meaningful? which plan item?). The tool removes only the error-prone
clerical work.

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
| `tool === "external_links_search"`, `resultsExamined > 0`, `outcome !== "positive"` | input error; write nothing — the entry grades the fetch, not the search |
| Staged payload has no `results` array | input error — the integrity check and D5 require `payload.results` (`validator.ts:1022,1029`) |
| `stagedResultsRef` given for a nil search (`results_examined: 0`, `outcome: negative`) | allowed but discouraged; the caller should omit results for nil searches per §5.4.1 |
| `projectPath` missing `research.json` / invalid JSON | input error; write nothing |
| `projectPath` is a real directory holding **neither** project file | write nothing; `{ ok: false, reason: "no_project", errors }` — the user is not in a research project, so this is an answer rather than a failure and is **not** marked `isError`. This is the search-logging path, so it is the one that decides whether a standalone search says anything useful. A directory holding exactly one of the two files is a *broken* project and stays loud. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| Appended entry introduces a project-validation error | **write nothing** (unlink staged sidecar); return `{ ok: false, errors }`. A pre-existing error the append did not introduce rides as a warning |
| `stagedResultsRef` does not resolve under `projectPath/results/.staging/` | input error; write nothing |
| `notes` states the household structure of a census that carries no relationship-to-head column, without hedging it — the census the note names, or, for a `record_search` entry, the one its staged response shows | input error; write nothing, and in a batch no op's staged file is consumed. The message names the missing column and quotes a compliant rewording, so the caller can re-send. See §8.2 |

### 8.1 Non-blocking warnings (never fail the op)

Two advisories ride `validation.warnings` on a successful write. **These two**
are warnings rather than preconditions — they never touch `ok`, because a hard
block on either would trip the false-deny asymmetry
(`guardrail-enforcement-spec.md` §10), turning a lossy-but-recoverable session
into an availability regression. Neither is decidable from the note: both rest
on project-wide state (what else has been logged, what has been persisted) that
the caller may be about to supply in the next call.

This is not a blanket rule against preconditions on this tool — §8.2 is one that
does block, and the distinction is what makes it legitimate.

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
  Tool-neutral message.
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

### 8.2 The one precondition that does block: undocumented census structure

A note that states the family structure of a census whose schedule has **no
relationship-to-head column**, without marking it as inferred, is refused and
nothing is written.

This clears the §8.1 bar for a reason the other two cannot: it is decidable from
the note and the staged search response the entry is logged with, both already
in the project folder, which is ADR-0011's test for a writer-tool precondition.
No later call can change the answer. The refusal is also always actionable — the
note becomes compliant by saying what is true ("family structure inferred from
surname, ages and order, not stated"), so it costs a turn rather than losing
work. A batch runs the check on every op before any op is applied, so a refusal
consumes no op's staged file and a corrected re-send still finds them all.

Scope, and why it is this narrow:

- **The year binds to the census, never to the note.** A census note almost
  always carries birth years older than the census itself, so a whole-note year
  test refuses the documented censuses it is meant to allow. Only a year
  syntactically attached to the word "census" counts.
- **The jurisdiction binds the same way.** The doctrine is US-federal, where
  1880 is the dividing line. England & Wales and Scotland gained the column in
  1851, so a post-1851 British census is documented and must pass. A named
  jurisdiction with no documented threshold skips the rule rather than guessing.
  The jurisdiction must touch the census token: most non-US words in real notes
  are birthplaces on a US schedule ("1850 US Census, Schuylkill County ... born
  Ireland"), which stays refused.
- **Undecidable inputs keep the prior behaviour** rather than failing open: when
  no year binds to a census at all, the whole-note test still applies.
- **The staged search decides when the note does not.** For a `record_search`
  entry with a `stagedResultsRef`, the check reads the staged rows'
  `collectionTitle` — FamilySearch's own words, which the caller does not author.
  When every titled row is a US federal census before 1880 (matched by title
  shape, never by the note's census patterns, which read an unqualified census as
  US and would take "Ecuador, Census, 1737-1990" for one), the note is judged
  whatever word it uses, provided it binds no census year of its own and
  contains one of those census years. A bound year keeps precedence, so no
  note-only verdict moves. A mixed search (1850 and 1880 rows) does not decide,
  because the note may describe the other row; nor does "the top-ranked row",
  which is the best match only when ranking ran. The year in the note is what
  ties it to that census: a parish-register note logged against an 1850 census
  search is not refused for a household the census never showed. Other search
  tools carry no collection title and keep the note-only rule.
- **"Indexed" beside a role word is a hedge** ("Role indexed as 'Head'"), as it
  is in the eval-plane validator. Flagging a *name* as indexed is not.

Measured over the 3,882 distinct `notes` arguments in the committed run logs
(measured at dc9766b15; re-derive with `dev/measure-census-hedge-refusals.ts`
rather than quote — the corpus moves with every committed run, and shrinks as
well as grows, because a re-run replaces a skill's run log), the note-only rule
refuses 216 (5.6%). Against the rule before the staged-search trigger (the
script's `--baseline` flag, given a copy of the earlier module), 4 notes
are newly allowed, all by the "indexed" hedge, and none newly refused. Of the
1,789 staged `record_search` entries with a note, 662 pair to the search
response that staged them (e2e run logs keep only a truncated summary, so the
rest cannot be paired); the staged search newly refuses 4 of those 662 and
frees none. Two are the `ut_search_records_h4k` note quoted below and the other two
are different notes of the same shape, a flat household claim with no census
word. A census named before
1800 is refused too, which the pre-binding whole-note year test (`18[0-7]\d`)
could not see and which the rule is squarely for -- the 1790-1840 US schedules
name only the head of household.

The lead rejected a tool-boundary content gate on 2026-08-27 on three grounds:
a 41% refusal rate, non-generalizability outside the US, and the signal being
author-supplied and optional. `requirePre1880CensusHedge`'s docstring in
`research-log-append.ts` carries the second verbatim, with the issue it was
ruled on. The binding above answers the first two — the rate
is 5.6% of notes, and non-US censuses that carry the column are excluded. The
staged search answers most of the third for `record_search`: the census is read
from FamilySearch's response, not from the caller. What still stands is the tie:
a note that omits the census year is not refused, and neither is a note logged
by any other tool or with no staged response. This narrows a common failure
rather than closing a hole.

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
  stays silent below the threshold, and stays silent once any source or assertion
  exists. Both keep `ok: true` and leave the log entry written.
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
- `record-extraction` — uses it for the `user_provided` log entry it writes when no
  search skill logged the record (`research-log-protocol.md` §"When record-extraction
  writes log entries").
- Downstream skills are unaffected: they still link to a log entry via
  `log_entry_id` on sources/assertions (the reverse-lookup provenance model is
  unchanged).
