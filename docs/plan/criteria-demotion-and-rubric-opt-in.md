# Criteria demotion & opt-in rubric

Status: **draft for feedback** — not yet implemented.

## Decisions

Locked in before drafting. No alternatives considered further down.

1. **Field rename.** `additional_criteria` → `judge_context`. Updated
   in every place the key appears: schema, judge prompt renderer,
   CRUD UI form, test author docs, every test JSON. No alias, no
   compat shim.
2. **Validator scoping.** Test-specific (D)-bucket checks gate on a
   **tag** (e.g. `"slug-apostrophe"`). No `test_id` gating.
3. **Spec doc.** Update `docs/specs/unit-test-spec-v2.md` in place.
   No v3.
4. **Leakage detection.** Delete `harness/leakage.py`,
   `criteria_leakage_flags`, `tests/unit/test_leakage.py`, and the
   judge prompt's "Neutrality test" paragraph in **Phase 1**.
5. **Rubric editing.** Engineers edit `rubric.md` directly. No CRUD
   UI editor.
6. **Backward compatibility.** None. Existing runlogs get deleted,
   not migrated.

## Motivation

The eval framework currently grades each test along three dimension
sources:

- **base** (always) — `Correctness`, `Completeness`.
- **rubric** (per-skill) — domain-specific dimensions in
  `eval/tests/unit/<skill>/rubric.md`.
- **criteria** (per-test) — `additional_criteria[]` in each test JSON.

Reviewing the three layers against actual tests in
`eval/tests/unit/*/` surfaces three problems with the **criteria**
layer:

1. **It overlaps with the rubric.** Many criteria restate a rubric
   dimension scoped to one scenario (e.g. "Should save the summary
   to a file" duplicates `wiki-lookup`'s `File handling` dimension).
2. **It mixes three different jobs.** Each bullet is one of:
   - **(D) Deterministic** — checkable from
     `before_state`/`after_state`/`tool_calls`. These don't need
     an LLM.
   - **(R) Reasoning quality** — narrative probes the judge must
     read to grade.
   - **(V) Verdict-leaking** — embeds the expected answer. The
     judge prompt's "Neutrality test" paragraph exists specifically
     because authors keep writing these.
3. **Annotation tax.** GitHub Action Rule 3 requires every dimension
   reviewed before merge. Criteria inflates dim count by 2–4 per
   test; roughly half of all annotator clicks are spent on criteria.

The rubric layer is also doing double duty: it holds genuine
craft (`Source independence analysis`) alongside mechanical checks
(`Tool usage: exactly one call to wikipedia_search`) and restatements
of base (`Output formatting: title + extract + URL present`).

## Goal state

- **Criteria becomes judge context, not a scored source.** The
  `judge_context[]` array (formerly `additional_criteria[]`) still
  exists in the test JSON and is still rendered into the judge
  prompt — but only as background to ground the judge's rationales
  for base + rubric dimensions. The judge does not emit a
  `source: "criteria"` dimension.
- **Rubric is opt-in per skill.** A skill ships a `rubric.md` only
  when it has domain craft that base correctness/completeness is
  too coarse to capture. Mechanical skills (`wiki-lookup`,
  `convert-dates`, `validate-schema`) ship none.
- **Deterministic checks move to validators.** Every (D)-bucket
  criterion and every mechanical rubric dimension migrates into
  `eval/harness/validators/test_<skill>.py`, gated on tags.

Per-test graded dimension count drops from ~6–10 → ~2–5.

## Phase 1 — Infrastructure + wiki-lookup proof

Framework changes plus the `wiki-lookup` migration as the canonical
end-to-end proof. Same branch as Phases 2–4.

### 1.1 Judge prompt (`eval/harness/judge/prompt.md`)

- Remove `criteria` from the "three sources" list at the top.
- Rename **"Per-test additional criteria"** section to
  **"Per-test context"**. The slot becomes `{judge_context}`. New
  framing: *"The test author also expected the skill to do the
  following. Use these as context to ground your rationales for the
  base + rubric dimensions. **Do not emit separate dimensions for
  them.**"*
- **Delete the "Neutrality test" paragraph.** Its job is moot once
  criteria isn't scored.
- Update "How to report": dimensions are exactly base (2) +
  rubric (0–N).
- Render the "Skill rubric" section as
  `(none — base dimensions only)` when `rubric.dimensions` is empty.

### 1.2 Grading tool schema (`eval/harness/harness/judge.py`)

`GRADING_TOOL.input_schema.properties.dimensions.items.properties.source.enum`:
`["base", "rubric", "criteria"]` → `["base", "rubric"]`.

`render_prompt_parts` slot rename: `additional_criteria` →
`judge_context`. Function-argument name follows.

### 1.3 Run-log schema (`docs/specs/schemas/run-log.schema.json`)

- Delete the `criteria_leakage_flags` field outright.
- Update the dimension `source` enum to `["base", "rubric"]`.
- Rename any per-test embedded `additional_criteria` field to
  `judge_context`.

### 1.4 Annotation schema (`docs/specs/schemas/ann.schema.json`)

Drop `criteria` from the source enum on corrections entries.

### 1.5 Rubric loader (`eval/harness/harness/rubric.py`)

- `rubric.md` **missing** OR **present-but-empty** → return empty
  `Rubric` (no error). Today the parser throws in both cases.
- Drop the "must have at least one H2 dimension" check.
- Keep the `_MAX_DIMENSIONS = 5` cap.

### 1.6 Orchestrator (`eval/harness/harness/orchestrator.py`)

- Delete the `flag_verdict_shaped_criteria` call unconditionally.
- Stop populating `criteria_leakage_flags` on the run log.
- Pass `spec.judge_context` (renamed) to the judge — still
  rendered as context, just not scored.

### 1.7 Leakage module + tests

- Delete `eval/harness/harness/leakage.py`.
- Delete `eval/harness/tests/unit/test_leakage.py`.
- Remove every other import of `flag_verdict_shaped_criteria`.

### 1.8 CRUD UI (`eval/app/`)

- `lib/schema/unit-test.ts` — rename schema key
  `additional_criteria` → `judge_context`.
- `lib/schema/run-log.ts` — update source enum to
  `["base", "rubric"]`, rename embedded test field.
- `components/forms/TestForm.tsx` — rename form field and update
  label/help copy ("Judge context (background notes — not a
  separate scored dimension)").
- Every fixture under `eval/app/tests/` that includes the field —
  rename.
- Annotation review page already renders dimensions by source; no
  extra special-casing beyond the schema update.
- GH Action Rule 3 (every dimension reviewed) continues to
  work — just fewer cells per test.
- No rubric editor.

### 1.9 Harness + UI tests

- Update `eval/harness/tests/unit/test_judge.py` and any fixture
  run-logs that hard-code `source: "criteria"`.
- Update every harness/UI fixture that uses `additional_criteria`
  → `judge_context`. (See "Field rename impact" below for the
  full surface.)

### 1.10 Validator runner

`eval/harness/harness/validator_runner.py` — extend `available_args`
to include `test` (the parsed test JSON dict) so validators can gate
on `test.get("tags", [])`.

### 1.11 wiki-lookup as canonical proof

Migrate `wiki-lookup` end-to-end on the same branch:

- Delete `eval/tests/unit/wiki-lookup/rubric.md` (all four
  dimensions either subsumed by base or mechanical — see Phase 2
  triage table).
- Add tag-gated validators in
  `eval/harness/validators/test_wiki_lookup.py`:
  filename slug regex, "exactly one `wikipedia_search` call",
  file-actually-written, template-fields-present.
- Walk all 8 wiki-lookup tests through Phase 3 triage. Convert
  (D)-bucket bullets to validator-checking tags. Rewrite (V).
  Leave (R) under `judge_context`.

This proves the new pipeline works before scaling to the other 22
skills.

**Done state at end of Phase 1:** judge emits base + rubric only,
criteria is context, rubric.md is optional, leakage module gone,
harness + UI tests green, wiki-lookup fully migrated as proof.

## Phase 2 — Per-skill rubric decisions

One pass over the remaining 22 skills. For each `rubric.md`,
classify every H2 dimension:

| Verdict | Definition | Action |
|---|---|---|
| **Keep** | Encodes professional craft the skill prompt assumes but doesn't enumerate. | Leave dimension in `rubric.md`. |
| **Mechanical → validator** | Deterministically checkable from `before_state` / `after_state` / `tool_calls`. | Move to `eval/harness/validators/test_<skill>.py`. Delete dimension. |
| **Subsumed by base** | Restates `Correctness` or `Completeness` with no domain content. | Delete dimension. Base + context covers it. |
| **No rubric** | After removing mechanical + subsumed, nothing remains. | Delete `rubric.md` entirely. |

### What counts as craft?

Insert this paragraph into `unit-test-spec-v2.md` and reference it
from this phase:

> A rubric dimension is **craft** if grading it requires reading
> narrative output for genealogical judgment — e.g. weighing source
> independence, applying Evidence Explained citation form,
> distinguishing source/information/evidence layers per GPS. A
> dimension is **mechanical** if it can be expressed as
> `assert <shape> == <value>` against `after_state` or `tool_calls` —
> file existence, schema validity, exact call count, field equality.
> When in doubt: if two competent genealogists could defensibly
> grade the same output differently, it's craft; if they'd both
> produce the same boolean, it's mechanical.

### First-pass triage

| Skill | Current dims (where read) | Predicted verdict |
|---|---|---|
| `wiki-lookup` | Query formulation, Output formatting, File handling, Tool usage | **Delete rubric.** (Already done in Phase 1.) Query/Output → base. File handling → validator. Tool usage → validator. |
| `citation` | Evidence Explained compliance, Replication test, Source vs information distinction | **Keep all 3.** Pure craft. |
| `conflict-resolution` | Source independence analysis, Evidence weighing, Resolution completeness | **Keep all 3.** GPS craft. Existing structural validator stays; rubric dim grades narrative completeness. |
| `convert-dates`, `validate-schema` | (not read yet) | Likely **delete rubric** — almost certainly all validators. |
| `assertion-classification`, `proof-conclusion`, `person-evidence`, `record-extraction` | (not read yet) | Likely **keep** — taxonomy/GPS-heavy. |
| `init-project`, `tree-edit`, `project-status`, `hypothesis-tracking` | (not read yet) | Likely mix — structural → validators, narrative → keep. |
| `translation`, `historical-context`, `locality-guide` | (not read yet) | Likely **keep** — domain narrative. |
| `search-*`, `check-warnings`, `question-selection`, `timeline`, `research-plan` | (not read yet) | Inspect individually. |

Deliverable per skill: one-line commit log entry, e.g.
*"rubric.md: kept Source-independence + Evidence-weighing; moved
Resolution-completeness to validator `test_resolved_complete`;
deleted Tool-usage as subsumed by base."*

## Phase 3 — Per-test triage

For each test JSON, walk its `judge_context[]` (previously
`additional_criteria[]`) and bucket each bullet:

| Bucket | Examples | Action |
|---|---|---|
| **(D) Deterministic** | "saved filename should be `o-brien-surname.md`", "should create both research.json and tree.gedcomx.json validating against their schemas", "should NOT modify the assertions section", "Should set `preferred_assertion_id` to a_002" (state-shape, not judgment) | Migrate to a validator in `test_<skill>.py`, gated on a tag. Add the tag to the test's `tags[]`. Delete the bullet. |
| **(R) Reasoning quality** | "Should explain each genealogically significant term", "Should cite both informant proximity and temporal distance as factors", "Should flag the cultural mismatch" | **Keep in `judge_context` as background.** |
| **(V) Verdict-leaking** | "Should set `preferred_assertion_id` to a_002 (or a_009 — both say Ireland)", "Should identify the son-in-law James Brown as a secondary informant" | If the author wants the specific verdict checked → convert to a deterministic validator on `after_state`, gated on a tag. Otherwise rewrite as reasoning-shaped and keep in `judge_context`. |

### Decision rule for borderline criteria

- Turnable into `assert <state> == <value>` against `after_state`
  or `tool_calls` → **D**.
- Grading requires reading narrative output → **R**.
- A different defensible answer would be marked wrong → **V**.

### Worked example: `slug-normalization-obrien.json`

Single criterion: *"The saved filename should be exactly
`o-brien-surname.md` — apostrophe collapses to a hyphen…"* → **D**.

Add `"slug-apostrophe"` to the test's `tags[]`. Migrate to
`test_wiki_lookup.py`:

```python
def test_slug_apostrophe_collapses_to_hyphen(test, after_state):
    if "slug-apostrophe" not in test.get("tags", []):
        pytest.skip("not a slug-apostrophe scenario")
    files = after_state.get("files_written", [])
    assert any(f.endswith("o-brien-surname.md") for f in files)
```

Delete the bullet from `judge_context`. The test now grades on
base + the validator.

### Worked example: `birthplace-ireland-vs-pennsylvania.json`

- C1 (independence chain) → **R** — keep in `judge_context`.
- C2 (cite informant proximity + temporal distance) → **R** — keep.
- C3 (identify James Brown as secondary informant) → **V** with
  reasoning shape — rewrite to *"should classify the death-cert
  informant relationship in a way that explains its weight"* and
  keep.
- C4 (`preferred_assertion_id` set to a_002 or a_009,
  status `resolved`) → **D** — add `"resolved-flynn-birthplace"`
  to `tags[]`, write a tag-gated validator on `after_state`.

## Phase 4 — Bundle + re-run + review

One PR landing every phase. Sequence within the branch:

1. **Framework + wiki-lookup** (Phase 1). End-to-end proof on the
   smallest, most mechanical skill.
2. **Rubric + criteria migration for the other 22 skills**
   (Phases 2 + 3). Commit per skill so the diff is reviewable.
3. **Wipe** `eval/runlogs/unit/` (`rm -rf`).
4. **Regenerate every skill's `v1_<ts>.json` candidate.** Single
   harness pass per skill. All regenerated runlogs land in the
   same PR.
5. **Annotate** against the new dimension shape — much smaller
   per-test surface (only base + 0–3 rubric).
6. **Senior review on the bundled PR.** GH Action checks pass
   because every regenerated runlog is active and every dimension
   has a correction.

No separate cleanup PR — the leakage deletion already happened in
Phase 1.

## Effect on the annotator

Per-test graded dimensions drop from **~6–10 → ~2–5**:

- Mechanical skill (`wiki-lookup` after rubric deletion):
  **2 dims** (`Correctness`, `Completeness`) + validators.
  Annotator agrees-with-all or corrects 2 cells per test.
- Craft skill (`conflict-resolution`):
  **2 + 3 = 5 dims** per test.

`judge_context` still appears in the run log (test spec field
renamed but kept) and in the judge's rationales — visible to
reviewers as scenario context, not as score rows.

## Field rename impact

`additional_criteria` → `judge_context` must be applied in every
place below in the same PR. Listed to prevent partial execution.

- `eval/tests/unit/<skill>/*.json` — every test file (~100–150
  files).
- `docs/specs/schemas/unit-test.schema.json` — property key.
- `eval/app/lib/schema/unit-test.ts` — zod schema mirror.
- `eval/harness/harness/judge.py` — render slot, function arg.
- `eval/harness/judge/prompt.md` — section heading and `{}` slot.
- `eval/harness/harness/orchestrator.py` — passes the field to
  the judge.
- `eval/app/components/forms/TestForm.tsx` — author UI label and
  copy.
- `docs/specs/unit-test-spec-v2.md` — spec prose.
- Every fixture under `eval/app/tests/` and
  `eval/harness/tests/` referencing the field name.
- Run-log schema (`docs/specs/schemas/run-log.schema.json`) — if
  it embeds the per-test criteria, same rename.

## Decisions

See the **Decisions** block at the top of this document.
