# Deep-Dive Brief — `hypothesis-tracking`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy, fixture-light. The substance is GPS hypothesis lifecycle craft — testable claims, for/against linkage, status thresholds, competing-candidate elimination, and the lead-vs-hypothesis distinction. Mechanics are near-zero: one `validate_research_schema` call (required even on read-only reviews), no MCP search fixtures. New tests are project-state SCENARIOS.
**Files:** SKILL.md (345 lines) · references ×2 (243 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
GPS Steps 3–4 (hypothesis management). Creates and updates hypotheses — testable claims about identity, parentage, and relationships — links supporting/contradicting assertions, and drives status transitions (`active → supported`, or `active → ruled_out` with a **mandatory** `ruled_out_reason`). It distinguishes **leads** (claims from compiled sources — convert to a hypothesis and verify before trusting) from hypotheses from conclusions, and tracks competing candidates as a group sharing `related_question_ids`. Two hard invariants: it **never touches the `conflicts` section** (that's conflict-resolution's), and it carries a **hard STOP guard** — a conflict-RESOLUTION request gets exactly one redirect sentence and **no file reads, no skill invocation**. It calls `validate_research_schema` after **every** task, including read-only status reviews.

## Where everything lives
- `plugin/skills/hypothesis-tracking/SKILL.md`
- `plugin/skills/hypothesis-tracking/references/hypothesis-gps-guidance.md` (229 lines) — leads vs. hypotheses, the three assumption categories, evidence integrity, compiled-source verification
- `plugin/skills/hypothesis-tracking/references/validation-protocol.md` (14 lines) — the validate-every-time step
- `eval/tests/unit/hypothesis-tracking/` — `review-parentage-hypothesis.json`, `new-hypothesis-from-conflict.json`, `negative-conflict-resolution.json`, `rubric.md`
- Scenarios used: `mid-research-flynn`, `flynn-multi-conflict`, `flynn-with-birthplace-conflict`

## Current tests (3)
| id | covers | type | fixtures |
|----|--------|------|----------|
| ut_hypothesis_tracking_001 | Review the status of the Thomas Flynn parentage hypothesis h_001 (read-only review still validates) | positive | validate-research-schema |
| ut_hypothesis_tracking_002 | Generate a new hypothesis to test against identity conflict c_002 | positive | validate-research-schema |
| ut_hypothesis_tracking_003 | A conflict-resolution request must NOT trigger hypothesis-tracking — exercises the hard STOP guard | negative | — |

> The **status-transition lifecycle is under-tested**: no test drives a hypothesis to `supported` or `ruled_out`, none exercises competing-candidate tracking with both for/against columns, and none does a lead→hypothesis conversion from a compiled source. The two positives are "review" and "create"; the middle and end of the lifecycle are blank.

## Gaps — new tests to add
**Positive (the lifecycle and the lead distinction are the gap):**
- **Transition to `supported`** — a hypothesis with at least one direct-evidence supporter and no unresolved contradictions; must satisfy all three SKILL thresholds, not move on indirect evidence alone (rubric "Status transitions" partial case).
- **Transition to `ruled_out`** — affirmative refutation (timeline impossibility + negative probate evidence) with a specific `ruled_out_reason`; the rubric's fail case is "ruled out for lack of evidence," so a clean refutation test is needed to anchor pass.
- **Competing-candidate elimination** — two-plus candidate fathers sharing `related_question_ids`, one ruled out, one remaining; the same assertion supporting one and contradicting another.
- **Lead → hypothesis conversion** — a compiled-source claim (FamilySearch/Ancestry tree) marked as needing verification, not accepted as fact.
- **`conflicts`-section immutability** — a request that tempts editing a conflict entry; the skill must create only in `hypotheses` and leave `conflicts` untouched.

**Negative (boundaries from the description):**
- → `conflict-resolution`: "Resolve this birthplace conflict" — **already covered** by ut_hypothesis_tracking_003 (the hard STOP guard).
- → `timeline`: "Build a timeline of Patrick's documented events." (no negative test yet).
- → `proof-conclusion`: "Write the final proof conclusion for the parentage question." (no negative test yet).

## ⚠️ Known issues
- **Status-value drift across the docs.** The SKILL prose and the rubric both say `active / supported / ruled_out`, but the "Re-invocation behavior" block writes a `superseded_by` field and the description string says `active → supported → ruled_out` while step 5 also implies a `superseded` state — confirm the schema's enum and reconcile, so transition tests grade against the real value set.
- **Id-prefix drift.** SKILL JSON examples use `h_001`/`h_002` but "Re-invocation behavior" says hypotheses use `hyp_` ids. Pin one before authoring the lifecycle tests.
- **Validate-on-read-only is easy to miss in grading.** The required `validate_research_schema` call on a pure review (ut_hypothesis_tracking_001) isn't a named rubric dimension — it rides under base Completeness.

## Fixture work
No MCP search fixtures — `validate_research_schema` only (the listed `validate-research-schema` fixture is the schema validator, not a network mock). `mid-research-flynn` and the two `flynn-multi-conflict` / `flynn-with-birthplace-conflict` scenarios already back the current tests. Net-new is **scenario state**, not mocks: a hypothesis pre-loaded with a direct-evidence supporter and zero contradictions (for `supported`), one whose candidate is refuted by dated probate/timeline assertions (for `ruled_out`), a two-candidate cluster sharing a question, and a compiled-source lead stub (for the conversion test).

## Definition of done
Pin the status enum + id prefix → add the `supported` / `ruled_out` / competing-candidate / lead-conversion / conflicts-immutability positives (with their scenario stubs) → add the timeline and proof-conclusion negatives → rubric/SKILL polish → full harness pass + CRUD review + PR.
