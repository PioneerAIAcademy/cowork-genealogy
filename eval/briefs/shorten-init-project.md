# Shorten: init-project

**Bucket:** mixed — **B-dominant** (interview/survey craft) with a thin **A**
seam (one post-write `validate_research_schema` backstop, plus restated
schema/template/GedcomX mechanics)
**Primary owner:** both (genealogist owns the interview + pedigree-analysis
judgment; developer strips the schema/template/GedcomX restatement and the
post-write validate)
**Current size:** 490 lines → **Target:** ~300–330 lines (~33% reduction)
**Tool migration:** **n/a** — no new persistence tool. init-project is not in
`docs/specs/skill-rewrites-for-persistence-tools-spec.md` §4; it **writes
`research.json` and `tree.gedcomx.json` directly** (and calls `person_read` /
`person_search` / `place_search`). There is no `research_append` / `tree_edit`
path here, so there are **no dead mechanics to delete** — the cuts are
restatement and one backstop, not a migration.
**Still needed as a skill?** **Yes, unambiguously** — it's the only project
bootstrapper, it runs the researcher-profile interview that every other skill's
narration depends on, and it's the one skill that performs the GPS Step-2
preliminary survey. The negative test also makes its guard-clause routing
load-bearing.

## TL;DR
This is **not** a tool-migration trim. The win is smaller than the bucket-A
skills: cut the one post-write `validate_research_schema` call (Step 5, the
only real dead-mechanics item — every other skill dropped its backstop and so
should this), and compress the heavy schema/template/GedcomX restatement that
duplicates `templates/research.json` and `references/simplified-gedcomx-summary.md`.
**Keep the interview judgment, the conflict-handling rule, the stub-quality
rule, and the guard clause** — they map straight onto the rubric, the
init-project validators, and the negative test.

## Why this skill is shortenable
It's 490 lines because it re-narrates structures that already live elsewhere:
the `research.json` shape is in `templates/research.json` (which the skill is
told to fill in at Step 4), the GedcomX rules are in
`references/simplified-gedcomx-summary.md`, and the ID-prefix/sourcing
conventions are restated inline as JSON blocks. It also states the
existing-project decline **three times** (guard clause, Preconditions, Important
rules) and carries a Step 5 post-write validate that is now redundant with the
shared validation-protocol reference. None of that restatement steers the judge
— the judge never reads SKILL.md, and the validators already check the schema.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_init_project.py`
  + universal):
  - `test_both_project_files_created` — positive tests must produce **both**
    `research.json` and `tree.gedcomx.json`. (Keep "write both files.")
  - `test_init_empty_sections` (tag `init-empty-sections`) — every
    `research.json` array section must be empty at init time. (Keep "all other
    sections are empty arrays," Step 4.)
  - Universal `test_research_json_validates_schema` /
    `test_tree_gedcomx_json_validates_schema` — both files must pass the real
    schemas. **This is exactly why the in-skill Step-5 validate is dead weight:
    the harness validates the output regardless of whether the skill called
    `validate_research_schema`.**
  - Universal `test_ownership_table` — init-project owns `project` (research.json)
    and `persons`/`relationships`/`sources` (tree.gedcomx.json). It must not
    write the other research.json sections.
- **Rubric dims** (`eval/tests/unit/init-project/rubric.md`):
  1. *Stub person quality* — populate known fields, **omit** unknown fields, do
     not fabricate. (The single craft dim — protected by the stub-creation rule
     and the no-placeholder rule.)
  Plus base dims.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-add-question.json` (`ut_init_project_003`)
  — "add a research question to this *existing* project" must route to
  **question-selection**, not re-run init. This is what makes the **guard
  clause** load-bearing.
- **Key test files:** `new-project-from-tree.json` (ID + objective, fixture
  `person-read-flynn`; checks the user-fact-vs-FamilySearch conflict flag and
  unverified sourcing), `from-objective-only.json` (no ID; stub-from-objective,
  surname-only stub, no placeholder for the unknown grandmother),
  `new-project-from-search.json` (no ID → `person_search` then `person_read`),
  `negative-add-question.json`.

## CUT — safe to remove
- **[324–333] Step 5 "Validate"** — the lone dead-mechanics item. The harness
  validates both files itself; every migrated skill dropped its post-write
  `validate_research_schema`. Reduce to one line under Step 4: "After writing,
  if you added persons with facts, run **check-warnings** for genealogical
  impossibilities" (the genealogical step from `references/validation-protocol.md`,
  which is the part to keep). The schema check is the harness's / the user's
  audit, not a step here. **(~10 lines)** Also drop `validate-schema` from the
  Step-6 numbered list (line 423) and the duplicate Step-5 mention in the
  Example.
- **[49–61] "Preconditions"** — pure restatement of the guard clause at the top
  (24–27). The guard clause already says it imperatively; Preconditions repeats
  the same decline text and example. Delete the section; keep the one guard
  clause. **(~13 lines)**
- **[236–252, 283–291] the GedcomX structure block + ID-conventions list +
  "Simplified GedcomX rules" list** — duplicates
  `references/simplified-gedcomx-summary.md`. Replace with: "Write
  `tree.gedcomx.json` in the simplified format (see
  `references/simplified-gedcomx-summary.md`); use local `I` person ids (`I1`,
  `I2`, …) for everyone, including FamilySearch-seeded persons." Keep the
  pointer, drop the inline catalog. **(~25 lines)**
- **[393–422] the full `research.json` JSON block in the Example** — duplicates
  `templates/research.json`, which Step 4 already says to use. Collapse the
  Example's step 5 to one line: "Write `research.json` from
  `templates/research.json` with the `project` + `researcher_profile` fields
  filled in." **(~30 lines)**
- **[475–490] "Re-invocation behavior"** — boilerplate; the guard clause + one
  Important-rules line ("never overwrite an existing project; refresh only
  `researcher_profile` on explicit request") already cover it. **(~16 lines)**
- **[264–273] the inline `sources`/`facts` JSON examples** under "Sourcing
  FamilySearch-derived facts" — the rule (one `S1` for the FS tree, attach a
  `quality: 1` ref to every imported fact) is what matters; the JSON literals
  duplicate the GedcomX reference. Keep the prose rule, drop the two code
  blocks. **(~10 lines)**

## KEEP — load-bearing judgment (do NOT cut)
- **Guard clause (24–27)** — protects the `negative-add-question` routing test.
  This is the single most important line to keep verbatim-ish. (Consolidate the
  three copies into this one.)
- **Researcher-profile interview (69–138)** — the experience-level questions,
  the subscription normalization/alias table, and the **level → `narration_guidance`
  verbatim table**. This is the design the project CLAUDE.md ("Researcher
  profile in research.json") and every other skill's `**Narration:**` line
  depend on. The single-turn-eval fallback (skip → `intermediate`/`none`
  defaults) must stay — the positive tests are single-turn and would otherwise
  stall. Tighten prose, keep all substance.
- **Stub-quality rules** — "populate known fields, omit unknown, no placeholder
  unknown-person stubs, **a known surname alone qualifies**" (462–469) — this is
  rubric dim 1 *and* the `from-objective-only` judge_context (surname-only
  Donovan-father stub; no stub for the unknown grandmother). Keep.
- **User-fact-vs-FamilySearch conflict handling (225–230)** — graded directly by
  `new-project-from-tree`'s judge_context (objective uses the user's stated PA;
  stub uses FamilySearch's Ireland; flag the discrepancy, never frame the user's
  statement as an error). Keep.
- **Unverified-sourcing rule** — "it IS sourced to the FS tree, but use
  `quality: 1` (questionable)" (281) — graded by `new-project-from-tree`. Keep
  the rule (drop the JSON literals, see CUT).
- **Searching-by-name flow** — `person_search` surname-plus-one, present
  candidates, single-turn top-pick fallback, fall back to stubs only on no
  candidates (174–201) — exercised by `new-project-from-search`. Keep; tighten.
- **Pedigree analysis / preliminary survey (Step 6)** — gap/error/context
  detection + the **tree summary table**. This is the GPS Step-2 deliverable and
  the `from-objective-only` judge_context explicitly protects historical-context
  analysis from being mis-scored as fabrication. Keep the substance; the table
  format can be one example row, not a spec.

## TIGHTEN — keep the point, cut the words
- State the existing-project decline **once** (guard clause). Remove the
  Preconditions and Important-rules repeats.
- The Step-1 objective guidance restates "objectives are broad / classify as
  relationship-or-event / don't add an `objective_type` field" across several
  paragraphs (150–172) — compress to 2–3 sentences.
- "Important rules" (429–473) overlaps Steps 2–6 heavily (treat-as-unverified,
  include-relatives, no-ID-search-first, no-placeholder). Fold each rule into
  the step that owns it and keep "Important rules" to the few cross-cutting ones
  (recording conventions, never-overwrite).

## Suggested target structure (~310 lines)
1. Frontmatter + guard clause (the one decline) + Narration + Places line.
2. 2-sentence purpose (bootstraps the two files; this is GPS Steps 1–2,
   FamilySearch tree = the preliminary survey, treat as unverified).
3. Researcher-profile interview — **kept nearly intact** (questions, normalize
   table, narration-guidance table, single-turn fallback).
4. Step 1: get objective (compressed) + searching-by-name flow.
5. Step 2: `person_read` + the user-fact-vs-FS conflict rule.
6. Step 3: write `tree.gedcomx.json` (pointer to the GedcomX reference, local-id
   note, the `quality:1` sourcing rule — no JSON literals).
7. Step 4: write `research.json` from the template (project + researcher_profile
   fields; all other sections empty) + one line "run check-warnings if facts
   were added."
8. Step 5 (was 6): pedigree analysis + tree summary table + next-step suggestion.
9. Trimmed "Important rules" (cross-cutting only) + short Example.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill init-project
```
Watch: `test_both_project_files_created` and `test_init_empty_sections` stay
green (don't let the JSON-block cuts drop the "all sections empty" instruction);
the *Stub person quality* dim stays at pass on `from-objective-only`
(surname-only stub kept, no placeholder grandmother); `negative-add-question`
still routes to question-selection (guard clause intact); and
`new-project-from-tree` still flags the PA-vs-Ireland conflict and uses
`quality:1` sourcing.

## Owner notes
**Developer** safely removes Step 5's `validate_research_schema`, the
Preconditions duplicate, the inline JSON/GedcomX/template blocks, and
Re-invocation boilerplate — all restatement or one backstop, no judgment. The
**genealogist must sign off on the interview, the stub-quality / no-placeholder
rules, the conflict-handling rule, and the pedigree-analysis content** — those
are the craft this skill exists for, and the bucket is B-dominant precisely
because there's no tool to lean on. Be honest in review that the % cut here is
modest compared with the migrated skills: most of the file is judgment or
survey, not dead mechanics.
