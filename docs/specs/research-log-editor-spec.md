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
    site: "ancestry" | "myheritage" | "findmypast" | "findagrave" | "newspapers" | "familysearch_web",
    urlGenerated: string,
    captureReceived: boolean,
    captureFilename?: string | null,
  } | null,
  // raw-results transport — host-staged handle (§5); null/omit for nil & external-site searches:
  stagedResultsRef?: string | null, // produced by the search tool (search-result-staging-spec.md)
})
```

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
| Staged payload has no `results` array | input error — the integrity check and D5 require `payload.results` (`validator.ts:1022,1029`) |
| `stagedResultsRef` given for a nil search (`results_examined: 0`, `outcome: negative`) | allowed but discouraged; the caller should omit results for nil searches per §5.4.1 |
| `projectPath` missing `research.json` / invalid JSON | input error; write nothing |
| Merge of appended entry fails project validation | **write nothing** (unlink staged sidecar); return `{ ok: false, errors }` |
| `stagedResultsRef` does not resolve under `projectPath/results/.staging/` | input error; write nothing |

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
