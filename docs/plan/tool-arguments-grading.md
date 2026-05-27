# Tool Arguments grading dimension

## Problem

The harness has a real gap in fixture-to-call alignment. Today fixtures
match calls by tool name and queue order; only 0 of 11 existing fixtures
use the optional `when` predicate. That means:

- A test that references the wrong fixture stem by typo loads cleanly
  and silently feeds the wrong response back to the skill. Runnability
  passes; file-creation validators pass; only tag-gated slug checks
  catch a fraction of the cases.
- An LLM that forms an off-base query (`query="potato"` instead of
  `query="Great Famine"`) still gets the canonical response from a
  single-fixture queue. Query-formation regressions are masked.
- The `input_schema` field on fixtures is informational only — the
  harness never validates that what Claude sent matches what the
  fixture expected.

The judge sees `tool_calls` with `args` and the matched fixture, but
its prompt does not explicitly grade "did the args make sense for this
call." There is no source of truth declared per fixture that says "I
expect calls that look like this."

## Approach

Make each fixture's argument shape the canonical expected — both for
dispatch matching and for LLM grading. Add a universal **Tool
Arguments** base dimension that the judge grades alongside Correctness
and Completeness. Render expected vs. actual args side-by-side in the
trace view so juniors can override the score from concrete evidence.

Decisions taken (per design discussion):

1. **Field rename:** fixture `when` → `args`. Same dotted-path matcher
   with `~` substring support; field is now required.
2. **Single source of truth:** the fixture's `args` is both the dispatch
   predicate and the grading target. No separate `expected_args` field.
3. **New base dimension:** "Tool Arguments." Source = `base`, not
   `rubric` — it does not consume the 3–5 rubric budget.
4. **LLM-judged:** the judge grades fail/partial/pass holistically
   across calls and across params within a call. Paraphrases and
   reasonable variations pass; meaningful mismatches fail.
5. **N/A for tests with zero MCP calls:** dimension score is `null` in
   the run log and annotation files. Only the Tool Arguments dimension
   may be null on a base dimension; Correctness and Completeness must
   still be integer 1–3.
6. **Fail when Claude calls a tool with no matching fixture
   (`fixture_not_found`):** Claude went off-script; that is a real
   signal even when the root cause is a missing fixture.
7. **Trace display:** per-param table (param | expected | actual |
   match indicator) — scannable for juniors, falls back gracefully
   when one side is missing a key.
8. **No backward compatibility / migration.** Existing run logs will
   be deleted. Every fixture in `eval/fixtures/mcp/` gets `args`
   populated as part of this change.

## Files touched

- 3 schema files (`mcp-fixture`, `run-log`, `ann`)
- 11 fixture JSONs in `eval/fixtures/mcp/`
- ~6 harness Python modules + their tests
- 1 judge prompt
- ~4 app TypeScript/TSX files
- 3 spec docs

## Implementation order

### 1. Schemas (foundation)

**`docs/specs/schemas/mcp-fixture.schema.json`**

- Rename `when` → `args`.
- Add `args` to `required`.
- Keep semantics: dotted-path keys; `~`-prefixed string values are
  case-insensitive substring matches.
- Update `description` to note the field is now load-bearing for
  grading, not just dispatch.

**`docs/specs/schemas/run-log.schema.json`**

- Change `judge_dimension.score` from `enum [1, 2, 3]` to a oneOf
  allowing nullable integer.
- Per-call `output.tool_calls` entries gain an `expected_args` field
  copied from the matched fixture's `args` (null when dispatch fell
  back to queue mode, which should no longer happen post-migration but
  is kept defensive).

**`docs/specs/schemas/ann.schema.json`**

- `corrected_score` becomes nullable (mirrors `llm_score`).

### 2. Fixture data

For each fixture in `eval/fixtures/mcp/`, add `args` declaring what
the test author expects Claude to pass:

- `wikipedia-search-great-famine-ireland.json` → `{"query": "~Great Famine"}`
- `wikipedia-search-obrien-surname.json` → `{"query": "~O'Brien"}`
- `wikipedia-search-schuylkill-county.json` → `{"query": "~Schuylkill County"}`
- `wikipedia-search-us-federal-census.json` → `{"query": "~US Federal Census"}`
- `wikipedia-search-albert-einstein.json` → `{"query": "~Albert Einstein"}`
- `wiki-search-irish-immigration.json` → `{"query": "~Irish immigration"}`
- `person-read-flynn.json` → `{"person_id": "LZNY-BRF"}`
- `place-search-schuylkill-county.json` → match on place name
- `place-external-links-schuylkill.json` → match on relevant id/place
- `fulltext-search-flynn-witnesses.json` → multi-arg (search terms)
- `record-search-1850-census-flynn.json` → multi-arg shape with
  collection, name, year — exemplar for multi-param grading

`~` prefix is used for fuzzy substring matching where the LLM
realistically passes paraphrases; bare equality is used for IDs.

### 3. Harness code

**`eval/harness/harness/fixtures.py`**

- Read `args` instead of `when`.
- `InvalidFixtureError` when `args` is missing or empty.
- `build_manifest` still partitions predicated vs. queue but
  post-migration every fixture is predicated.

**`eval/harness/harness/mock_mcp.py`**

- Add `expected_args` to each call_log entry, copied from the matched
  fixture's `args`. Null when dispatch was queue-mode.

**`eval/harness/harness/runnability.py`**

- Add a check: every referenced fixture file must contain a non-empty
  `args` object. Fail-fast at gate time.

**`eval/harness/harness/orchestrator.py`**

- Thread `expected_args` through to the run-log assembly and the judge
  prompt rendering.

**`eval/harness/harness/runlog.py`**

- Emit `expected_args` per tool call in `output.tool_calls`.
- Accept nullable score on dimension entries.

**`eval/harness/harness/judge.py`**

- Expect 3 base dimensions back. Accept `null` score for
  Tool Arguments when zero MCP calls; require integer 1–3 for the
  other two base dimensions.

**`eval/harness/tests/`**

- Update fixture/mock tests for renamed `args` field and required
  presence.
- Add tests: `expected_args` is plumbed into the call log; dimension
  parsing accepts null only for Tool Arguments; runnability fails on
  fixture missing `args`.

### 4. Judge prompt

**`eval/harness/judge/prompt.md`**

- Add `## Tool Arguments` block under the base rubric:
  - **pass:** every MCP call passed args matching the fixture's
    declared `args` semantically (paraphrase / case variation OK).
  - **partial:** at least one call had a meaningful mismatch on a
    non-critical arg, or one of multiple calls was off while others
    were correct.
  - **fail:** a critical arg was wrong (wrong identifier, wrong
    subject), or a call landed in `fixture_not_found`.
  - **n/a (null):** zero MCP calls in the test.
- Update "How to report" to require 3 base dimensions and to permit
  null on Tool Arguments only.
- Update the `{tool_calls}` rendering instructions so each call shows
  `expected: {...}` / `actual: {...}` blocks.

### 5. CRUD app

**`eval/app/lib/types.ts`**

- Add optional `expected_args` to the tool-call entry type.
- Update `RunLogDimension` so `score` and corresponding annotation
  `corrected_score` may be null.

**`eval/app/app/results/[...id]/page.tsx`** (trace view)

- For each MCP call, render a per-param table: param name | expected
  | actual | match indicator. Match indicator = check / x / dash
  ("expected absent" or "actual absent").
- Below the table, surface the Tool Arguments LLM score and the
  rationale entry that mentions this call.

**`eval/app/app/fixtures/[name]/page.tsx`** (fixture editor)

- Make `args` a first-class form field (JSON or key/value editor).
- Validate non-empty on save.

**Annotation flow** (wherever dimension corrections happen) — Tool
Arguments dimension appears in the dimension list with the new
nullable score handling. Juniors can override LLM score including
setting/unsetting N/A.

**`eval/app/lib/schema/unit-test.ts`** — pick up any test-side schema
changes that ripple through.

### 6. Sample test exemplars

No test JSON changes required — the fixtures above already cover:

- Single-string-arg: `wiki-lookup/historical-event-great-famine.json`
  + `wikipedia-search-great-famine-ireland.json`.
- Slug normalization on quirky characters:
  `wiki-lookup/slug-normalization-obrien.json` +
  `wikipedia-search-obrien-surname.json`.
- Multi-param tool with several declared args:
  `search-records/execute-census-search.json` +
  `record-search-1850-census-flynn.json`.

### 7. Spec docs

**`docs/specs/unit-test-spec.md`**

- §3.2 — rename `when` → `args`; declare required; remove "omit for
  fixtures that should match any call" language.
- §6 (or wherever base dimensions are listed) — add Tool Arguments
  alongside Correctness and Completeness; describe N/A.
- §15 — update call-log shape to include `expected_args`.
- Clarify that Tool Arguments is a base dimension and does not consume
  the 3–5 rubric budget.

**`eval/CLAUDE.md`**

- One-line note that argument grading is now a base dimension.

**`docs/specs/eval-crud-ui-spec.md`**

- Update trace-view and fixture-editor sections with the new field
  and per-param table.

### 8. Validation order

1. Land schema changes + fixture updates as one unit.
2. Land harness + judge prompt + harness tests; run
   `cd eval/harness && uv run pytest`.
3. End-to-end harness run against `wiki-lookup` and `search-records`;
   verify the run log carries `expected_args`, the judge emits a Tool
   Arguments dimension, and N/A appears for negative tests with zero
   calls.
4. Land app changes; load a new run log in the CRUD UI; verify the
   per-param table renders and annotation overrides work.
5. Delete old run logs.

## Out of scope

- Backward compatibility with old fixtures or old run logs.
- URL-capture fixture authoring (referenced in the spec but separate
  workstream).
- Optimizer changes — the optimizer dirs are excluded from comparison
  and not annotated, so the new dimension doesn't affect them in v1.

## Risk

The new base dimension will become noisy for skills where args quality
is trivially passing (single-string `wikipedia_search` queries). That
is acceptable in v1: the signal is binary (catches the wiring-bug
class) and the rubric budget is unaffected because this is a base
dimension. If signal dilution becomes an issue in practice, a future
change could weight dimensions in dashboard aggregation.
