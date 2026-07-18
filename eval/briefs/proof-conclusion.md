# Deep-Dive Brief — `proof-conclusion`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy with near-zero MCP fixture cost — it's a `validate_research_schema`-only skill. The day is GPS proof-writing craft plus crafting new project-state scenarios for the untested confidence tiers; the dominant gaps are the lower tiers (especially Disproved), the proof-vehicle choice, and the conclusion write (setting `primary` on the concluded value) plus its upload gate.
**Files:** SKILL.md (376 lines) · references ×2 (269 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
GPS Step 5 (Soundly Reasoned, Coherently Written Conclusion). It selects the confidence tier (Proved / Probable / Possible / Not Proved / Disproved), chooses the proof vehicle (Statement / Summary / Argument), and writes a self-contained narrative markdown conclusion that can be uploaded to FamilySearch. Evidence facts already sit on the tree (materialized continuously at identity-link time by person-evidence, un-`primary` and carrying their source-refs); proof-conclusion's tree act is to **set `primary`/`preferred` on the concluded value** at Probable or higher — via `tree_correct` `update_fact` on an existing evidence fact, or `tree_edit` `add_fact` (`primary: true`, multi-ref) for a synthesized conclusion (spec §7.1) — and to **gate upload** to concluded facts only. At Possible / Not Proved / Disproved it reaches no conclusion, so it sets no `primary` and makes no tree write during its run. It calls `validate_research_schema`.

## Where everything lives
- `plugin/skills/proof-conclusion/SKILL.md`
- `plugin/skills/proof-conclusion/references/gps-proof-writing.md` (255 lines)
- `plugin/skills/proof-conclusion/references/validation-protocol.md` (14 lines)
- `eval/tests/unit/proof-conclusion/` — `write-parentage-proof.json`, `proved-tier-with-exhaustive-search.json`, `negative-project-status.json`, `rubric.md`
- Scenarios used: `mid-research-flynn-no-proof`, `flynn-research-complete-no-proof`, `mid-research-flynn`.

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_proof_conclusion_001 | Write a PROBABLE-tier proof for the Flynn parentage question; tier justification | positive |
| ut_proof_conclusion_002 | Write a PROVED-tier proof for the completed father-identification research (exhaustive search) | positive |
| ut_proof_conclusion_003 | "Quick rundown of what's been done" → routes to `project-status` | negative |

> Coverage shape: only the two top tiers (Probable, Proved) are tested. The whole lower half of the tier scale — Possible, Not Proved, and especially **Disproved** — is untested, as is the proof-vehicle choice (Statement vs. Summary vs. Argument) and the conclusion write (set `primary` on an existing evidence fact, or add a synthesized multi-ref fact). The "sets `primary` only at Probable+" invariant — and its negative, no conclusion write at Possible/Not-Proved — is ungraded.

## Gaps — new tests to add
**Positive (the untested tiers + the proof-vehicle axis + the conclusion write):**
- **Possible tier** — evidence that's suggestive but thin; require the Possible label AND that no `primary`/conclusion is set in `tree.gedcomx.json` during the run (proof-conclusion sets `primary` only at probable+).
- **Not Proved tier** — exhaustive search that fails to resolve; require honest "Not Proved" framing and no tree write.
- **Disproved tier** — evidence that actively refutes the hypothesis; require a Disproved conclusion. This is the strongest tier-logic miss.
- **Proof-vehicle choice** — a question whose evidence warrants a full **Argument** (vs. the Statement/Summary in the existing tests); grade that the vehicle matches the evidence shape.
- **Conclusion write at Probable+** — assert the conclusion at Probable/Proved actually sets `primary` on the concluded fact in `tree.gedcomx.json` (via `tree_correct` `update_fact`, or a synthesized `tree_edit add_fact` with multi-refs), the positive side of the invariant `_001`/`_002` don't explicitly grade.

**Negative (boundaries from the description):**
- → `project-status`: "Quick rundown of what's been done" — **covered** (`ut_proof_conclusion_003`).
- → `conflict-resolution`: "These two sources disagree on the birth year — reconcile them first."
- → `question-selection`: "What should I research next now that this is done?"
- → `assertion-classification`: "Is this death-cert informant primary or secondary for the father's name?"

## ⚠️ Known issues
- **Three of five tiers untested** (Possible, Not Proved, Disproved) — the conclusion-classification logic, the skill's core judgment, is only half-covered.
- **The conclusion write is ungraded** — neither that Probable+ sets `primary` on the concluded value in `tree.gedcomx.json` nor that Possible/Not-Proved sets none during the run. This is the skill's one mutation invariant and there's no test pinning it.
- **Proof-vehicle choice (Statement / Summary / Argument)** is described but never exercised.
- Two of three named neighbors (`conflict-resolution`, `assertion-classification`) have **no negative test**; only `project-status` is covered.

## Fixture work
Fixtures are light/none — this is a `validate_research_schema`-only skill, so there are no MCP fixtures to build. The cost is **new project-state scenarios**: existing scenarios (`mid-research-flynn-no-proof`, `flynn-research-complete-no-proof`) support the two top tiers, but Possible / Not-Proved / Disproved each need a scenario whose evidence shape justifies that tier (thin, exhausted-but-unresolved, and refuting, respectively). The conclusion-write tests assert against `tree.gedcomx.json` post-state (a `primary` value now set on the concluded fact), so the scenarios need a pre-state tree that already carries the materialized (un-`primary`) evidence facts person-evidence produces. Neighbor negatives are pure routing prompts.

## Definition of done
Add the lower-tier scenarios (Possible / Not-Proved / Disproved) → add those three tier positives + the Argument-vehicle test + the conclusion-write assertions → add the `conflict-resolution` and `assertion-classification` negatives → extend the rubric to grade tier selection, vehicle choice, and the two-path conclusion write (set `primary` / synthesized fact) plus upload gating → full harness pass + CRUD review + PR.
