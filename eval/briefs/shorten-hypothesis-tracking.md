# Shorten: hypothesis-tracking

**Bucket:** A (dead-mechanics removal)
**Primary owner:** both (developer strips the tool-mechanics narration and the
duplicated scope/ownership prose; genealogist signs off on the status-transition
and evidence-integrity judgment that stays)
**Current size:** 455 lines → **Target:** ~210–230 lines (~50% reduction)
**Tool migration:** **done** — calls only `research_append`
(`op: "append"` to create, `op: "update"` for status transitions and evidence
linkage). The Step-3 age arithmetic stays plain LLM reasoning (no calendar/compute
tool).
**Still needed as a skill?** **Yes** — the tool stores hypotheses but won't
decide *when* a claim warrants a hypothesis, *what* counts as supporting vs.
contradicting, or *whether* a transition to `supported` / `ruled_out` is
justified. That judgment is the whole skill, and it maps 1:1 onto the rubric.

## TL;DR
The migration is complete — don't change *what* it calls. Cut the two verbose
`research_append({ ... })` JSON blocks (the schema documents them), the repeated
"the tool assigns the `h_` id / validates-before-persist / no post-write
validate" narration (stated ~4 times), and the boilerplate Re-invocation
section. **Keep** the status-transition criteria, the read-only-vs-write
detection, the age-impossibility "act now" rule, and the ownership boundaries —
each backs a validator, a tag-gated check, or a rubric dim.

## Why this skill is shortenable
`research_append` now allocates the `h_` id, validates the entry (including
`ruled_out_reason` when ruled out — the validator also enforces it), and writes
atomically, writing nothing on `{ ok: false }`. A large fraction of the file
narrates that clerical work and the (now-removed) post-write
`validate_research_schema` step. That's dead: the tool guarantees it, and the
"Present" step (§7) still describes the validate-before-persist contract a
*second* time after §0/§1 already covered it.

## The floor: what the unit tests actually grade
- **Deterministic validators**
  (`eval/harness/validators/test_hypothesis_tracking.py` + universal
  ownership/foreign-key):
  - `test_hypotheses_no_deletions` — append-only; status changes supersede
    deletion. *(Tool enforces; don't break the rule.)*
  - `test_hypotheses_assertion_refs_resolve` — every
    `supporting_assertion_ids` / `contradicting_assertion_ids` entry must point
    at a real assertion.
  - `test_new_hypotheses_have_claim` — every new hypothesis needs a non-empty
    `claim`.
  - `test_ruled_out_requires_reason` — `ruled_out`/`status:"ruled_out"` ⇒
    `ruled_out_reason` populated. *(Tool also enforces this; keep the "reason is
    mandatory" rule because the **judge** grades the reason's quality.)*
  - Tag-gated: `test_h001_status_unchanged_when_review` (h_001 + status-review →
    status must not change without refuting evidence);
    `test_new_hypothesis_added_for_c002` (c_002 + new-hypothesis → ≥1 new hyp,
    status `active`); `test_h001_not_ruled_out_when_adding_identity_hypotheses`
    (c_002 + new-hypothesis → must not flip h_001 to ruled_out).
  - Universal ownership table: hypothesis-tracking writes **only** the
    `hypotheses` section of `research.json` — not `conflicts`, `questions`, or
    `tree.gedcomx.json`.
- **Rubric dims** (`eval/tests/unit/hypothesis-tracking/rubric.md`):
  *Claim clarity*, *Evidence linkage*, *Status transitions*.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** the corpus has **no `type: negative` file** (all
  13 tests are `type: positive`; the filename `negative-conflict-resolution.json`
  is actually ut_003, a *positive* evidence-linkage test). Routing-out is still
  graded inside the positive corpus via the Step-0 scope gate and the
  description's "Do NOT use when…" — and conflict-resolution's negative tests
  redirect *toward* the right neighbor. So keep one tight scope statement, but
  don't over-invest in elaborate redirect prose for negatives that don't exist.
- **Key test files:** `review-parentage-hypothesis.json` (ut_001, read-only
  review, h_001 status unchanged), `new-hypothesis-from-conflict.json` (ut_002,
  c_002 → new active hyps), `ut_…_004`/`_009` (rule-out via timeline /
  age-arithmetic biological impossibility), `ut_…_005`/`_007`/`_008`/`_013`
  (creation: from-scratch, compiled-source lead, third candidate, alternative
  relationship), `ut_…_006` (read-only competing summary), `ut_…_010` (link
  contradicting, no status change), `ut_…_011`/`_012` (refuse promotion / refuse
  downgrade guardrails).

## CUT — safe to remove
- **[lines 117–132] the full create `research_append({ ... })` JSON block** —
  the tool's schema documents `section`/`op`/`entry`. Keep at most a one-line
  call signature; the *claim requirements* below it (134–137) are the
  load-bearing part, keep those.
- **[lines 158–167] the link-evidence `research_append({ op:"update" })` JSON
  block** — same: keep "update in place by `entryId`, only the changed fields"
  as one line; drop the block.
- **[lines 252–270] the ruled-out `research_append({ ... })` JSON block** — keep
  "transition with `op:"update"`; when ruling out, `ruled_out_reason` is required
  and must be specific" as prose; drop the JSON.
- **[line 39] the validate-before-persist / "no separate post-write
  `validate_research_schema`" paragraph** — fold the *one* useful clause ("on
  `{ ok:false, errors }` it writes nothing; surface and fix, don't retry
  blindly") into a single short line and delete the rest. It is restated at §7.
- **[lines 334–340] §7 "Present" preamble** — re-narrates the
  validate-before-persist contract a second time **and contradicts §39** (says
  "retry the call" where §39 says "do not retry blindly"). Cut the preamble; keep
  the example presentation block (342–364) but trim it (see TIGHTEN).
- **[lines 441–456] "Re-invocation behavior"** — boilerplate. The one real point
  ("update an existing `h_` in place; don't write a second `h_` for the same
  claim") belongs as one line under Important rules; the "Writes:" enumeration is
  dead (the schema/validators own it).
- **[lines 389–391] "Out-of-scope requests"** — verbatim repeat of Step 0. Delete
  the duplicate; Step 0 already states it.

## KEEP — load-bearing judgment (do NOT cut)
- **Step 0 scope gate (22–33)** — protects routing/scope (vs conflict-resolution,
  timeline, proof-conclusion). Keep, but it can be tightened (see TIGHTEN), and
  it makes the separate §389 redundant.
- **Read-only detection (41–49)** — protects ut_001/ut_006 and
  `test_h001_status_unchanged_when_review` (a review must not mutate
  `research.json`). Load-bearing for Correctness on the read-only tests.
- **"New hypotheses always start as `active`" (105–111)** — backs
  `test_new_hypothesis_added_for_c002`'s active-status assert and the *Status
  transitions* rubric dim (don't pre-declare `supported`).
- **Claim requirements (134–137) + source-awareness / leads-vs-hypotheses
  (86–103, 98–103)** — directly grades against *Claim clarity* (specific,
  testable, names persons) and the compiled-source-lead tests (ut_007).
- **Step 3 status-transition criteria (197–250)** — the `supported` ALL-of and
  `ruled_out` ANY-of lists, the "don't downgrade for census age rounding" rule,
  and the "act on impossibilities immediately (unless read-only)" rule. These map
  straight onto *Status transitions* and back ut_004/ut_009/ut_011/ut_012. **This
  is the reason the skill exists.** Keep the reasoning; only the JSON example
  inside it is cut.
- **Age arithmetic stays plain LLM reasoning** — there is no compute tool for
  this; ut_009 grades the by-hand biological-impossibility reasoning. Do **not**
  add a tool call here, and don't strip the worked impossibility logic in §3.
- **"`confident` (match_score ≥ 0.80) → treat identification as settled" (242–
  246)** — the trigger that lets a ruling proceed; keep.
- **Ownership boundaries (406–410): never modify `conflicts`, `questions`, or
  `tree.gedcomx.json`** — back the universal ownership-table validator and the
  c_002 tests (must not flip h_001, must not write conflicts). Keep all three,
  tightened to one line each.
- **Scope discipline "only modify what the user asked" (395–404)** — backs the
  c_002 `test_h001_not_ruled_out…` assert. Keep, tightened.
- **Evidence integrity (430–439)** — "never ignore conflicting evidence; record
  in `contradicting_assertion_ids` first, resolve later" + unstated-assumptions
  check. Backs *Evidence linkage* and ut_010. Keep.
- **`ruled_out_reason` mandatory (415–417)** — the validator enforces presence,
  but the **judge** grades whether the reason is an *affirmative refutation*
  (rubric *Status transitions* fail = "ruled out for lack of evidence"). Keep the
  rule; it's not pure mechanics.
- **References pointer (56–59)** to `references/hypothesis-gps-guidance.md` —
  leads-vs-hypotheses + assumption categories the judge expects. Keep one line.

## TIGHTEN — keep the point, cut the words
- State the `research_append` contract **once**, near the top: "All `hypotheses`
  writes go through `research_append` (it assigns the `h_` id, validates, writes
  atomically; on `{ ok:false }` nothing is written — surface the errors and fix
  the input, don't retry blindly). No separate `validate_research_schema` step."
  Then delete the repeats at §39, §1, §7.
- The Step-0 table and the description's "Do NOT use…" say the same routing three
  ways. Keep the Step-0 table (it's the operative gate); the description stays
  (judge reads it for triggering) but delete the standalone §389 "Out-of-scope"
  section.
- §4 "Handle competing hypotheses" and §5 "Update existing hypotheses" overlap
  with §2/§3 — collapse to: "Competing candidates: one hypothesis per candidate,
  share `related_question_ids`, the same assertion may support one and contradict
  another, rule out as evidence accumulates." Drop the worked h_001/h_002/h_003
  prose enumeration; the §366 table already illustrates it.
- Trim the §342–364 presentation example to a compact shape (it's illustrative,
  not graded line-by-line).
- Merge the two near-identical "FAN evidence is regular assertions" statements
  (190–194 and 418–420) into one.

## Suggested target structure (~220 lines)
1. Frontmatter (unchanged) + Narration line.
2. Step 0 scope gate (kept, tight).
3. One-line `research_append` contract + read-only detection.
4. When to use / leads-vs-hypotheses / decision rule (compressed).
5. Create: claim requirements + "start as `active`" + source-awareness
   (one minimal call signature, no JSON block).
6. Link evidence: supporting vs contradicting + FAN-is-regular + design-to-refute
   (one line on the update call).
7. Status transitions: the `supported` ALL-of / `ruled_out` ANY-of lists +
   no-downgrade-for-rounding + act-on-impossibility + confident-link rule + the
   age-arithmetic-stays-LLM note. (The full kept judgment; one tiny ruled-out
   example, no full JSON.)
8. Competing hypotheses (collapsed) + the elimination table (keep one).
9. Connect-to-downstream (timeline / conflict-resolution / proof-conclusion) —
   3 short lines.
10. Present (trimmed example).
11. Important rules + Evidence integrity — ownership boundaries, scope
    discipline, ruled_out_reason mandatory, claims-not-facts, status≠proof-tier.
    State each once.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill hypothesis-tracking
```
Watch the three rubric dims (Claim clarity, Evidence linkage, Status
transitions) across all 13. Confirm the tag-gated asserts stay green: ut_001
(h_001 status unchanged on review), ut_006 (read-only summary writes nothing),
ut_002 (new active hyps for c_002, h_001 not ruled out), and the guardrails
ut_011/ut_012 (refuse promotion / refuse downgrade). Confirm ut_004/ut_009
still rule out *with* an affirmative-refutation `ruled_out_reason`.

## Owner notes
**Developer** safely cuts the three JSON blocks, the repeated tool-mechanics
narration, the §7 preamble, the duplicated §389 scope section, and the
Re-invocation boilerplate. **Genealogist** owns Step 3 (status-transition
criteria, no-downgrade-for-rounding, act-on-impossibility) and Evidence
integrity — these are craft and back ut_004/ut_009/ut_011/ut_012 and the
*Status transitions* / *Evidence linkage* dims. Don't let a mechanical pass
thin them.

**Fix in this PR:** the *Status transitions* dim cites "research-schema-spec.md
§5.9"; the description cites "GPS Step 3-4." Confirm §5.9 still exists and
matches the skill's status values (`active` / `supported` / `ruled_out`), and
**fix the stale `proved` reference in the validator docstring**
(`eval/harness/validators/test_hypothesis_tracking.py` ~line 33) — `proved` is
in the docstring but **not** in SKILL.md's state diagram, so align the docstring
to the three real statuses. (The validator file isn't in the per-skill snapshot,
so editing the docstring doesn't flip run logs — it's a clean same-PR cleanup.)
Senior confirms the §5.9 spec reference.
