# Research log result retention + `match_two_examples` wiring

**Status:** Implemented (2026-05-21) — Parts 1 and 2 complete and
unit-tested. Remaining: the eval scenario fixtures and skill-behavior
eval cases (see Tests).
**Date:** 2026-05-21
**Related:** `docs/specs/research-schema-spec.md`, `docs/specs/schemas/research.schema.json`,
`docs/specs/match-two-examples-tool-spec.md`, `mcp-server/src/types/record-search.ts`,
`plugin/skills/person-evidence/SKILL.md`, `plugin/skills/record-extraction/SKILL.md`,
`plugin/skills/search-records/SKILL.md`, `plugin/skills/search-full-text/SKILL.md`,
`plugin/skills/validate-schema/scripts/validate_project.py`,
`eval/harness/harness/workspace.py`, `TODOS.md`.

## Context

`research.json` holds only *analytical state*: log entries keep `query` +
`outcome` + a `results_examined` count; assertions keep the extracted
facts. The raw result of every search is discarded.

That discard is a Genealogical Proof Standard (GPS) problem. Element 1
("reasonably exhaustive research") and Element 5 ("soundly reasoned
conclusion, resolving conflicts") both require earlier results to stay
**re-examinable** — a later step has to be able to go back and refute an
earlier one. If only extracted assertions survive, the full-text snippets
triaged past, the census households not extracted, and negative-search
result sets are all gone.

The fix: **the research log retains everything a search gathered.** A
concrete consumer of that retained data is the `match_two_examples` MCP
tool — it scores whether two record extractions describe the same
person, and wiring it into the person-evidence (identity-resolution)
skill requires the record's GedcomX, which is currently not persisted.

This **supersedes** the in-conversation `records[]`-section proposal (a
new top-level section holding adopted records' GedcomX). Results attach
to log entries instead — see Decisions.

## Scope

One PR. The work has two parts — sidecar result retention, then
`match_two_examples` wiring on top of it — and the Part 1 / Part 2
sections below are the build order, not separate deliverables. The
courier-fidelity spike (next section) runs first and gates the whole PR:
if it fails, the storage mechanism changes before anything else is
built.

## Decisions

1. **Results live on log entries, not a separate `records[]` section.**
   Every search already writes a log entry. An assertion already carries
   `log_entry_id`, so it already points at its evidence.

2. **Pure sidecar storage.** The raw payload goes to a per-log-entry file
   `results/<log_id>.json` in the project folder. The log entry keeps
   only lightweight metadata inline. Rationale: `research.json` is read
   by every skill at startup; inlining every record GedcomX and full-text
   snippet from a months-long project would bloat that hot path without
   bound. No structured per-result summary is inlined — `query` already
   locates a search and assertions are already the curated inline summary
   of what mattered; the existing `notes` field carries a one-line human
   summary.

3. **Search skills are the writers.** The skill that runs the search
   (search-records, search-full-text) writes the log entry and its
   sidecar at search time. No skill mutates another skill's sidecar.

4. **Payloads are loosely typed.** The sidecar `payload` is the verbatim
   MCP tool response. The schema does not strictly type it per tool —
   record GedcomX shape varies by collection, and the MCP tools validate
   structure on the way out.

5. **`image_read` gets no sidecar.** `image_read` returns the record
   image as a multimodal content block — Claude views it directly and
   produces the transcription. There is no tool-returned text to retain,
   and a multimodal image block cannot be serialized into a JSON payload.
   The image stays re-fetchable via its URL (preserved in the log
   entry's `query`). The **full verbatim transcription** — Claude's own
   product, so no courier-fidelity concern — is retained on the
   `source` entry in `research.json` (see Data model). This satisfies
   the requirement to retain OCR'd image text without a tool-payload
   sidecar.

6. **The `record_role → GedcomX person-id` binding lives on the
   assertion** as a new optional field `record_persona_id`.

7. **`person_evidence.match_score` is reactivated** — it already exists
   in the schema (`number 0-1 | null`); its prose description is
   corrected from "reserved" to its real meaning.

The 2026-05-21 eng review refined the verification mechanism (D2),
failure visibility (D4), validator checks (D5), and the test set — folded
into the sections below.

## Data flow

```
SEARCH TIME                                  │  ANALYSIS TIME
                                             │
search-records / search-full-text            │
  │ calls record_search / fulltext_search    │
  ▼                                          │
log_entry ───────────────┐                   │
  query, outcome,        │ results_ref       │
  results_examined,      ▼                   │
  results_available    results/<log_id>.json │
  notes (1-line)         { log_id, tool,     │
                           retrieved,        │
                           returned_count,   │
                           payload }         │
                                             │
record-extraction                            │
  │ reads payload, extracts assertions       │
  ▼                                          │
assertion                                    │
  log_entry_id ──────► which sidecar         │
  record_id ─────────► which record in it    │
  record_persona_id ─► which person          │
                                             │
                                             │  person-evidence
                                             │   │ log_entry_id → sidecar payload
                                             │   │ payload[record_id].gedcomx = gedcomx1
                                             │   │ record_persona_id          = primaryId1
                                             │   │ tree subset                = gedcomx2
                                             │   ▼
                                             │  match_two_examples
                                             │   → score → pe_.match_score
```

## The courier-fidelity problem

**This is the largest practical risk in this work and must be settled
before implementation.**

An MCP tool result reaches disk only one way: MCP host → Claude's
context → a `Write` tool call Claude generates → `results/<log_id>.json`.
Claude is the courier. Nothing guarantees byte-fidelity — for a large
payload (a 20-record `record_search` response, a 100-snippet
`fulltext_search` response) Claude can silently truncate, elide
("…47 more results…"), or paraphrase when reproducing it into the
`Write` call. The whole "re-examinable" motivation collapses if the
retained payload is a lossy paraphrase.

The MCP server does not write the file itself: the current architecture
isolates the MCP server (host) from the skills (VM) — they communicate
only through tool calls, the server is never told the project's path,
and the host and VM see the connected folder at different paths.

**Mitigation (verification by intra-payload consistency — eng review D2):**

1. The sidecar records a top-level `returned_count` — the number of
   results the tool said it returned. This is a single integer, which
   couriers reliably even when the full payload does not.
2. After the skill writes the sidecar, `validate_project.py` (the
   validate-schema script, already invoked after every write) checks
   **intra-payload consistency**: the sidecar's `returned_count` must
   equal the actual length of its results array. Truncation that drops
   array entries is caught; truncation that drops the tail including the
   count is caught (missing/short count). No external manifest, and no
   new bundled script — the check rides in the validator that already
   runs.
3. On mismatch the skill re-writes the sidecar once. If it still fails,
   the skill sets `results_ref: null`, flags the log entry's `notes`,
   **and surfaces the failure to the user** (eng review D4) — e.g.
   "couldn't reliably retain the results of search log_007; N results
   were returned but the saved copy didn't verify." A retention gap in
   an audit-trail system must be announced, not buried.

Residual risk: Claude truncating *and* consistently editing
`returned_count` down to match — a more deliberate corruption than plain
truncation, and less likely. Accepted, with the D2 check and chunked
writes as backstop.

**Gating spike — completed 2026-05-21.** A script generated realistic,
varied `fulltext_search` sidecar payloads; each was `Read` into context,
then `Write`-reproduced to a new path and byte-diffed against the
script-generated original:

| Trial | Size | Single-shot `Write` |
|-------|------|---------------------|
| 5 results | 6.9 KB | byte-identical (SHA256 match) |
| 25 results | 34 KB | byte-identical (SHA256 match) |
| 50 results | 68 KB / 1,143 lines | byte-identical (SHA256 match) |

Single-shot `Write` fidelity is **byte-perfect through 50 results /
68 KB**. The 100-result / 137 KB case was not separately measured — it
does not change the write strategy below.

**Write strategy (evidence-based):**

- Payloads up to **~40 results** (a safety margin below the
  proven-faithful 50): the search skill writes the sidecar
  **single-shot**. This covers the common case — `record_search`
  defaults to 20 results, `fulltext_search` to 5.
- Payloads above ~40 results: write in **~40-result chunks** (appended),
  each chunk inside the proven-faithful range.
- The D2 intra-payload consistency check verifies the assembled file
  either way — the always-on backstop, since a focused spike is a mild
  best case versus a real run where the `Write` is incidental.

If the D2 check ever fails in real runs despite chunking, the deeper
fallback is **MCP-side persistence** — the MCP server writing the file
itself. That is a large architecture change that **may not be feasible
in Cowork at all** (see the isolation note above); the
`record_read`-by-ARK tool in `TODOS.md` is the related escape hatch for
the match path specifically.

## `record_search` payload shape (resolved)

From `mcp-server/src/types/record-search.ts`:
`RecordSearchToolResponse.results: RecordSearchResult[]`, where each
`RecordSearchResult` carries:

- `gedcomx?: SimplifiedGedcomX` — the record's full simplified-GedcomX,
  passed directly as `match_two_examples` `gedcomx1`.
- `primaryId?: string` — the `id` of the focus person inside
  `gedcomx.persons[]`; passed as `primaryId1`.
- `arkUrl?: string`, `personId: string` — stable identifiers.

So the match wiring needs no hand-reconstruction; Part 2 reads
`gedcomx` + `primaryId` straight from the sidecar payload.

## Data model

### New `results/` directory

The project folder gains a `results/` directory alongside
`research.json` and `tree.gedcomx.json` — one file per search log entry.

Sidecar file `results/<log_id>.json`:

```jsonc
{
  "log_id":         "log_005",
  "tool":           "record_search",
  "retrieved":      "2026-05-04T14:30:00Z",
  "returned_count": 12,           // number of results in payload (D2 check)
  "payload":        { /* verbatim MCP tool response, loosely typed */ }
}
```

`log_id` / `tool` / `retrieved` make the file self-describing.
`returned_count` is the integer the intra-payload consistency check
compares against the payload's actual result-array length. `payload` is
whatever the tool returned.

**Nil searches write no sidecar.** When a search returns zero results,
the log entry's `outcome` + `results_available: 0` + `results_examined:
0` already prove the nil; a sidecar would hold nothing of evidentiary
value. `results_ref` is null in that case. (A search that *returned*
results but examined-and-rejected them is **not** nil — those examined
results are retained, because a later step may disagree with the
rejection.)

### `log_entry` — schema additions

`docs/specs/schemas/research.schema.json`, `#/$defs/log_entry`:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `results_ref` | string or null | no | Relative path to the sidecar, e.g. `results/log_005.json`. Null for nil searches and for log entries whose payload could not be faithfully retained. |
| `results_available` | integer or null | no | Total hits reported upstream (e.g. `fulltext_search` `totalResults`). Distinct from `results_examined`. Null when the tool reports no total. |

Existing fields keep their meaning: `results_examined` = how many
results the skill triaged; `notes` = the one-line human summary.
`additionalProperties: false` stays; both new fields are optional, so
existing projects validate unchanged.

### `assertion` — schema addition

`#/$defs/assertion`:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `record_persona_id` | string or null | no | The GedcomX person `id`, within this assertion's log-entry payload, identifying which persona the assertion is about. Null for FTS-, image-, and PDF-sourced assertions (no structured GedcomX persona). |

`record_persona_id` is required because `match_two_examples` needs
`primaryId1` — the specific person inside the record. A
`RecordSearchResult` exposes `primaryId` for the *focus* persona only;
for non-focus roles in a multi-person record (a census household's
spouse, child_1, …) `primaryId` does not identify them, so
`record_persona_id` is what disambiguates which `gedcomx.persons[]`
entry the assertion's persona is. **Invariant:** for the focus role,
`record_persona_id` must equal the result's `primaryId`.
record-extraction sets it when it assigns `record_role`.

An assertion is then fully self-resolving for matching: `log_entry_id`
(which sidecar) + `record_id` (which record in the payload) +
`record_persona_id` (which person in that record).

### `source` — full transcription retention

The full verbatim image transcription is retained on the `source`
entry (existing `notes`, or a dedicated field — decide in Part 1). This
is Claude-authored text, so it has no courier-fidelity risk.

### `person_evidence` — no schema change

`match_score` (`number 0-1 | null`) already exists.

### External-site captures — unchanged

External-site results are already retained via
`external_site_detail.capture_filename` (the captured PDF/HTML file).
That mechanism stays; the sidecar is for structured tool payloads.

## Part 1 — sidecar result retention

1. **Schema / spec / validator** (the "three places" per CLAUDE.md):
   - `research.schema.json` — add `results_ref` + `results_available` to
     `log_entry`; add `record_persona_id` to `assertion`; add the
     transcription field to `source` if a dedicated field is chosen.
   - `research-schema-spec.md` — update the `log_entry`, `assertion`, and
     `source` prose tables; add a "Sidecar result files" section;
     correct the `match_score` row to a real description.
   - `validate_project.py` — extend with:
     - accept the new fields;
     - each non-null `results_ref` points at an existing JSON-parseable
       file;
     - **orphan sidecars** — a `results/` file with no matching log
       entry;
     - each sidecar's internal `log_id` matches its filename;
     - **intra-payload consistency (D2)** — `returned_count` equals the
       payload's actual result-array length;
     - **deep cross-checks (D5)**, in `validate_cross_file`: every
       assertion with a non-null `record_persona_id` resolves to a real
       person `id`, and its `record_id` resolves to a real record, in
       the referenced sidecar.
2. **Search skills** — search-records and search-full-text write
   `results/<log_id>.json` (with `returned_count`) — single-shot for
   ≤~40 results, in ~40-result chunks above that (see the
   courier-fidelity section) — set `results_ref` / `results_available` /
   `results_examined`, write the one-line `notes` summary, and on a
   verification failure surface it to the user (D4).
3. **`research-log-protocol.md`** — there are **four** byte-identical
   copies (search-records, search-full-text, record-extraction,
   search-external-sites; no shared reference loading, per CLAUDE.md).
   Add the sidecar section to **all four**, kept byte-identical (D3). The
   section is written to be universally accurate: it states that
   tool-payload searches write a sidecar **and** that external-site
   captures retain via `capture_filename` instead — so the doc is
   correct for search-external-sites too.
4. **Harness** — `eval/harness/harness/workspace.py` copies exactly
   `("research.json", "tree.gedcomx.json")` by name (~line 53);
   `results/` must be added there. Confirmed code change. Separately, the
   snapshot function's exclusion list (~line 136) skips those two files
   because they are captured separately — `results/` sidecars would flow
   through as generic captured files; verify that is acceptable rather
   than adding `results/` to the exclusion.
5. **CLAUDE.md** — the rule *"Anything that needs to live across
   sessions has to live in `research.json` or `tree.gedcomx.json`"* is no
   longer accurate; update it to admit the `results/` sidecar files.

## Part 2 — `match_two_examples` wiring

1. **Resolve the record.** For an assertion with a non-null
   `record_persona_id`: `log_entry_id` → `results_ref` → sidecar
   `payload` → the `RecordSearchResult` matching the assertion's
   `record_id` → its `gedcomx` (`gedcomx1`) + `record_persona_id`
   (`primaryId1`).
2. **Build the tree side.** person-evidence constructs a **subset**
   simplified-GedcomX for `gedcomx2` — the candidate tree person plus
   immediate family (parents, spouse, children) — **not** the whole
   `tree.gedcomx.json`. `match_two_examples` expects a record-sized
   document; a months-long project's full tree may be slow or rejected.
   (`tree.gedcomx.json` is already simplified-GedcomX, so no format
   conversion is needed — only subsetting.)
3. **Call `match_two_examples`** and persist its `score` (0–1) to
   `person_evidence.match_score`.
4. **Threshold policy — score is an input, never a substitute.**
   `match_two_examples` scores on name + date + place only. Identity
   confidence is set by **correlation analysis** — name, dates, places,
   relationship fit, household composition, occupation, and the GPS
   independence rule (related information forms one evidence unit). The
   score modulates confidence *within* what correlation supports; a
   qualitative conflict (a contradicting birthplace, an impossible
   relationship) **caps** confidence regardless of score — a high score
   never auto-links past a conflict. When no score is available
   (FTS-, image-, PDF-sourced assertions, or older projects with no
   sidecar), correlation analysis stands alone. Match scoring works
   **only** for `record_search`-sourced assertions.
5. **No `allowed-tools` change.** person-evidence has no `allowed-tools`
   frontmatter, and `search-records` already calls `match_two_examples`
   with none — that is the convention, and `allowed-tools` is not
   enforced as a sandbox anyway.

## Tests

The plan ships with full coverage — every new codepath has a test
written alongside the feature.

**Validator unit tests** (`validate_project.py`):

| # | Path | Test |
|---|------|------|
| 1 | new fields accepted | `results_ref` / `results_available` / `record_persona_id` validate |
| 2 | `results_ref` → file exists | dangling ref is an error |
| 3 | orphan sidecar | `results/` file with no log entry is flagged |
| 4 | `log_id` ↔ filename | mismatch is an error |
| 5 | intra-payload consistency (D2) | a hand-crafted **truncated** sidecar fixture (`returned_count` 12, 9 results) is caught |
| 6 | deep cross-checks (D5) | dangling `record_persona_id` and `record_id` absent from the sidecar are both caught |

**Harness unit test:** `workspace.py` copies `results/` into a
materialized scenario. *Do not skip this* — without it, eval scenarios
silently lack sidecars and every match test passes vacuously.

**Eval cases** (`[→EVAL]` — SKILL.md changes are prompt changes):

| # | Path |
|---|------|
| 7 | search-records / search-full-text write a correct sidecar + log fields |
| 8 | nil search → no sidecar, `results_ref: null` |
| 9 | record-extraction sets `record_persona_id` (focus role == `primaryId`) |
| 10 | person-evidence: `record_search`-sourced assertion → `match_score` persisted |
| 11 | person-evidence: FTS/image/PDF assertion → qualitative fallback, no score |
| 12 | **★ CRITICAL** — high `match_two_examples` score + a contradicting birthplace → **not** auto-linked (proves the D4-feedback "conflict caps confidence" safety property) |

**Fidelity-failure path:** you cannot deterministically force Claude to
truncate a payload, so do not try to induce a real courier failure. The
D2 detection is covered by validator unit test #5 (crafted truncated
fixture); the D4 surface-to-user step is a skill instruction.

**Fixtures:** add a `match_two_examples` MCP fixture under
`eval/fixtures/mcp/`; add a `results/` directory to the
mid-research-flynn scenario; update existing search-records /
search-full-text / person-evidence eval fixtures for the new log fields
(drift, not a behavior regression — the schema change is additive).

## Failure modes

| # | Failure | Test | Error handling | Silent? |
|---|---------|------|----------------|---------|
| 1 | Courier truncation | #5 intra-payload check | D4 surface + `results_ref: null` | No |
| 2 | Dangling `record_persona_id` | #6 cross-check | validation error | No |
| 3 | Orphan sidecar | #3 orphan check | validation error | No |
| 4 | person-evidence hits `results_ref: null` | #11 fallback case | hybrid policy → qualitative | No |
| 5 | Whole tree → `match_two_examples` rejected/slow | #12 + subset case | tree subset (Part 2 step 2) | No |
| 6 | Harness doesn't copy `results/` | harness unit test | — | **Would be silent if the test is skipped** |

No critical gaps, provided failure mode 6's harness unit test is
honored.

## NOT in scope

- **MCP-side persistence** — deeper fallback only if chunked writes
  prove unreliable in real runs; may be infeasible in Cowork.
- **`record_read`-by-ARK tool** — captured in `TODOS.md`.
- **Collapsing the 4× `research-log-protocol.md` duplication** —
  pre-existing constraint (CLAUDE.md / Claude Code issue #17741).
- **External-site (PDF) payload sidecars** — external sites already
  retain via `capture_filename`.
- **Re-running searches to refresh stale results** — retention is a
  point-in-time snapshot by design.

## What already exists (reused, not rebuilt)

`log_entry` written by every search skill (extended), `assertion.log_entry_id`
(the assertion→search bridge, reused), `match_score` on `person_evidence`
(already in schema, reactivated), `match_two_examples` (exists;
`search-records` already calls it), `RecordSearchResult.gedcomx` +
`.primaryId` (ready-made match inputs, no reconstruction),
`validate_cross_file` in `validate_project.py` (home for the D5 checks),
`external_site_detail.capture_filename` (external-site retention,
untouched). No parallel machinery is built.

## Worktree parallelization

| Lane | Modules | Depends on |
|------|---------|------------|
| A — schema | `research.schema.json` → `research-schema-spec.md` → `validate_project.py` | — |
| B — harness | `workspace.py` | — |
| C — search skills | `search-records/`, `search-full-text/`, 4× `research-log-protocol.md` | Lane A |
| D — match wiring | `person-evidence/`, `record-extraction/` | Lanes A, C |

Execution: **(A ‖ B in parallel) → C → D → eval fixtures.**
A and B are independent; everything else is sequential — the schema is
the spine. The courier-fidelity spike that previously gated this work is
complete (see the courier-fidelity section).

## Open items

- **`record_id` ↔ `RecordSearchResult` join key** — record-extraction
  stores `record_id` as the record's canonical identifier; confirm
  whether that equals `RecordSearchResult.arkUrl` or `.personId` so
  Part 2 can join an assertion to the right result in the sidecar.
- **Harness snapshot behavior** — confirm `results/` subtrees are
  captured acceptably by `workspace.py`'s snapshot function.
- **`source` transcription field** — existing `notes` vs a dedicated
  field; decide in Part 1.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 5 issues (D1 scope, D2–D5), 0 critical gaps, 16 test gaps assigned |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — (no UI) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0 — every review decision (D1–D8) was answered.
- **VERDICT:** ENG CLEARED — ready to implement. Eng review found no
  critical gaps, and the courier-fidelity spike that gated the work is
  complete (single-shot writes byte-perfect to 50 results / 68 KB).
