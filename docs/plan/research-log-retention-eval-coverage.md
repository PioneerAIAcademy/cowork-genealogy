# Research-log retention — eval coverage and follow-up

**Status:** Implemented — §1–§4 done and verified. §5 (manual e2e) and
the harness run/grade/release loop remain — both need live APIs or the
human review cycle, not artifact authoring. Follow-up to commit
`dc6a825` (Parts 1 & 2 of `docs/plan/research-log-result-retention.md`).
**Date:** 2026-05-21
**Related:** `docs/plan/research-log-result-retention.md`, `eval/CLAUDE.md`,
`docs/specs/research-schema-spec.md`, `docs/testing-guides/`.

## Context

Parts 1 and 2 of the research-log result-retention feature shipped in
commit `dc6a825`: searches retain raw results in `results/<log_id>.json`
sidecar files, `validate_project.py` checks them, and person-evidence
scores identity matches with `match_two_examples`. The Python unit
tests for that code ship in the same commit.

What remains is **eval-suite coverage** — the skill-behavior tests that
exercise the retain→match flow through the harness — a validator
tightening, and a manual end-to-end pass.

Two contracts settled while planning this:

- **`record_id` for `record_search` records = the result's full
  `arkUrl`, copied verbatim** (the URL form). person-evidence and the
  D5 validator join an assertion to its record by exact string match
  on this value. record-extraction's `record_id` rule + example were
  fixed to the URL form (uncommitted — a small follow-up commit to the
  branch).
- **Backward compatibility is not a concern.** All existing run logs
  will be deleted and the eval suite regenerated, so this plan does not
  design around run-log staleness or scenario-snapshot drift.

## Already tested (in `dc6a825`)

- `validate_project.py` sidecar checks — `test_validate_project.py`,
  9 cases including the crafted truncated-sidecar D2 fixture.
- `workspace.py` copies the `results/` subtree — `test_workspace.py`.
- Full harness unit suite (292) green.

These cover the Python code, not skill behavior. The eval suite tests
whether the skills actually write well-formed sidecars and apply the
match policy.

## Resolved while planning (no longer open)

- **Mock-MCP matcher** — `fixtures.py` `matches()` is subset semantics
  (dotted paths, `~` substring). A loose `{primaryId1, primaryId2}`
  predicate matches regardless of the large `gedcomx` arguments.
- **Harness snapshot of `results/`** — `workspace.py` `snapshot_files()`
  rglobs the workspace; sidecars are captured generically. The
  input-copy side ships in `dc6a825`. No work item.
- **Validator call-log visibility** — `validator_runner.py` passes
  `tool_calls` to each validator alongside `before_state` / `after_state`
  / `skill_frontmatter`. "Tool was/wasn't called" is therefore a
  validator-checkable property.
- **Scenario approach** — a dedicated `flynn-record-matching` scenario
  (§2). Adding the case records to `mid-research-flynn` would distort
  its other tests' behavior; a dedicated scenario keeps it untouched.

## Remaining work

### 1. One captured payload + MCP fixtures

The harness aborts a run on any tool call with no matching fixture, so
every tool the new flow calls needs a fixture in `eval/fixtures/mcp/`.

- **Capture one real `record_search` response** — a multi-person Flynn
  household — via a `mcp-server/dev/try-*.ts` probe against the live
  API. It is the single source for both the MCP fixture *and* the
  scenario sidecar (§2). Hand-authoring `SimplifiedGedcomX` twice
  guarantees drift.
- **`record_search` fixture** — there is exactly one today
  (`record-search-1850-census-flynn.json`). Extend or replace it so it
  carries the real `RecordSearchToolResponse` shape: `results[]` with
  `gedcomx`, `primaryId`, `arkUrl`, `personId`.
- **`fulltext_search` fixture** — verify it carries `totalResults` so
  `results_available` can be populated.
- **`match_two_examples` fixtures** — one per person-evidence case that
  calls the tool (10, 12, 13). Each must use a **distinct
  `primaryId1` / `primaryId2` pair**: the fixtures share a tool, and a
  loose predicate that collided would let the first fixture win for
  every case.

### 2. Dedicated `flynn-record-matching` scenario  ✓ done

Build a dedicated scenario for the retention/match cases rather than
modifying `mid-research-flynn`. Adding the case records to
`mid-research-flynn` would change what its `timeline`,
`proof-conclusion`, and `conflict-resolution` tests see — behavior
distortion, distinct from the (now-moot) run-log snapshot concern. A
dedicated scenario keeps `mid-research-flynn` untouched.

`flynn-record-matching` holds four gathered-but-unlinked records, each
with a `results/<log_id>.json` sidecar:

- `log_001` — a clean 1850-census match (`MXHY-TP4`).
- `log_002` — a conflict record (`CFLT-9K2`, birthplace Germany).
- `log_003` — a transcription-variant record (`VRNT-7M3`, "Flinn").
- `log_004` — a full-text probate hit (`FTXT-Q88`, no GedcomX persona).

Assertions `a_001`–`a_004` are unlinked, `person_evidence` empty;
`record_persona_id` is set (`P1`/`CP1`/`VP1`) on the record_search
records and null on the full-text one; `record_id` is the full `arkUrl`
verbatim. Sidecar `gedcomx` is trimmed to focus + minimal relatives so
the files stay small in run-log snapshots. The scenario passes both
`validate_project.py` and the harness jsonschema gate.

### 3. Eval cases — validator-gated, released per skill

Author the cases below in `eval/tests/unit/<skill>/`. Make the
**deterministic validator** (`eval/harness/validators/test_<skill>.py`,
which receives `before_state` / `after_state` / `tool_calls` /
`skill_frontmatter`) the **primary gate** — every case here is a
file-state or call-log property. The LLM judge grades only the soft
dimensions (narration, rationale quality); eval has no `temperature=0`,
so single-run judge scores carry variance and must not gate a
mechanical property.

A releasable run is a full `--skill <name>` run (per `eval/CLAUDE.md`
"Releasable invocations") — you cannot release just one new case. So
per skill the operation is one activity: add the case JSON(s) → run
`--skill <skill>` once (all cases) → correct grades → release.

| Case | Skill | Validator assertion |
|------|-------|---------------------|
| 7a | search-records | a `results/<log_id>.json` sidecar exists; log entry has `results_ref` / `results_available` / one-line `notes`; sidecar `returned_count` == `len(payload.results)` |
| 7b | search-full-text | same, for a `fulltext_search` payload |
| 8 | search-records | nil search → no sidecar written, `results_ref: null` |
| 9 | record-extraction | `record_persona_id` set; focus role's value == the result's `primaryId`; `record_id` == the result's `arkUrl` **verbatim** |
| 10 | person-evidence | `tool_calls` contains `match_two_examples`; `pe_.match_score` persisted |
| 11 | person-evidence | FTS-sourced assertion → `tool_calls` has **no** `match_two_examples`; `match_score` null |
| 12 | person-evidence | high score + a contradicting core identifier → **no `confident` link** created (capped, user pause) |
| 13 | person-evidence | low score + a strong *qualitative* match (transcription-variant name) → link **still** created — the low score did not override correlation |

Cases 12 and 13 are the two directions of the hybrid threshold policy —
the safety property of the whole feature. Author them first; back each
with a deterministic validator check, not the judge alone. (Case 11
represents the no-score path; the image and PDF paths are the same
"`record_persona_id` is null → no score" branch and need no separate
case.)

**Run logs.** All existing run logs are being deleted, so every skill's
eval run is generated fresh — there is no stale-log special case.
Author the cases for search-records, search-full-text,
record-extraction, and person-evidence, and produce a released
`--skill` run for each. validate-schema and search-external-sites need
no eval-case work for this feature.

### 4. Validator D5 tightening

With `record_id` = the full `arkUrl` settled, tighten
`validate_project.py`'s D5 check: find the `RecordSearchResult` whose
`arkUrl` equals the assertion's `record_id` (exact match), and verify
`record_persona_id` resolves within **that** result — not just
somewhere in the payload. Add a test to `test_validate_project.py`.
The code carries a comment marking the spot.

### 5. Manual end-to-end pass — must exercise the chunked write

Run the layered playbook in `docs/testing-guides/` for the retain→match
flow against the real APIs. **Critically, include a >40-result
search** so the chunked-write path runs for real: the mock harness uses
small fixtures and never chunks, so this manual pass is the only place
the chunk protocol (single-shot ≤40 results, ~40-result chunks beyond,
the `returned_count` integrity check) is exercised. It is also the only
check against the real `match_two_examples` API and real `Write`
fidelity in a Cowork-like environment.

## Suggested order

1. Capture the real `record_search` payload (§1).
2. Build the `flynn-record-matching` scenario (§2).
3. Author the eval cases (§3) — cases 12 and 13 first.
4. Validator D5 tightening (§4) — independent; any time.
5. Manual end-to-end pass with a >40-result search (§5) — last.

## Open items

- Which record to probe for the §1 capture — pick a Flynn
  1850-census-style record that yields a multi-person household, so the
  scenario can exercise focus *and* non-focus personas.
