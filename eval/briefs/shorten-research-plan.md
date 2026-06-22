# Shorten: research-plan

**Bucket:** A (dead-mechanics removal) — but the largest of the three, with a
substantial planning-craft core
**Primary owner:** both (developer strips id-alloc / two-phase write mechanics /
post-validate / re-invocation boilerplate; **genealogist signs off on the
locality-survey, sequencing, and FAN/record-type judgment**)
**Current size:** 390 lines → **Target:** ~230–250 lines (~38% reduction)
**Tool migration:** **done** — calls the survey read tools (`wiki_search`,
`place_search`, `collections_search`, `place_population`, `external_links_search`,
`volume_search`, `wiki_place_page`) and `research_append` for the plan shell +
items. The "no separate post-write validate" note is already present (line 33).
**Still needed as a skill?** **Yes, unambiguously** — the locality survey,
record-type selection, sequencing logic, and re-plan/mode decisions are the whole
craft; the tool only allocates `pl_`/`pli_` ids and enforces one-active-plan.

## TL;DR
`research_append` now assigns the `pl_`/`pli_` ids, enforces one-active-plan-per-
question, validates-before-persist, and makes supersede-not-delete structural.
Cut the verbose `research_append({...})` shell + item JSON blocks, the
plan-item-field schema table (schema dup), the worked Example block, the
two-phase id-threading narration, and the Re-invocation section. **Do not touch**
§1a planning-mode decision, the locality-survey content, §3 record-type
principles, §4 sequencing, the re-plan/supersede flow, or the Rules/Decision-rules
tables — they map onto the three rubric dims and the tag-gated validators.

## Why this skill is shortenable
The tool owns: `pl_`/`pli_` id allocation, the one-active-plan-per-question
invariant (it *rejects* a second active plan — the skill needn't enforce it),
validate-before-persist, atomic write, and supersede-via-update (no deletes).
Line 33 already states all of this once; the per-step JSON blocks and the
"the tool assigns the id… on `{ ok:false }`…" repeats in Steps 5/6/7 re-narrate it.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_research_plan.py`
  + universal):
  - `test_plans_no_deletions` — plans are cumulative; supersede via `status`.
  - `test_log_unchanged_by_research_plan` — research-plan appends **nothing** to
    the log (it's owned by the search-* skills).
  - `test_research_plan_no_new_plan` (tag `research-plan-no-new-plan`) — when an
    active plan exists, **review, don't create**.
  - `test_pli_006_status_unchanged` (tag `pli-006-status-unchanged`) — never flip
    an item's status without a log entry.
  - `test_research_plan_new_plan_for_q_001` (tag `research-plan-new-plan-for-q-001`)
    — exactly one new `pl_` for q_001; the prior plan (pl_002) untouched.
  - `test_new_plan_items_planned_status` (tag `new-plan-items-planned-status`) —
    new items default to `status:"planned"`.
  - Universal: ownership (writes only `plans`/`plan_items`); FK on
    `plans.question_id → questions`.
- **Rubric dims** (`eval/tests/unit/research-plan/rubric.md`):
  1. *Record type selection* — record_type matches the question's info need;
     per-item rationale names what the type yields.
  2. *Sequencing logic* — free/indexed before paid/unindexed; `fallback_for`
     chains explicit; `sequence` reflects a defensible order.
  3. *Jurisdiction accuracy* — jurisdictions correct for the period (boundary
     changes accounted for).
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** route to `question-selection`
  (`negative-question-selection` — "WHICH question" not "HOW"), `search-records`/
  `search-external-sites` (`negative-execute-search-request`), and
  `record-extraction` (`negative-record-extraction-request`).
- **Key test files:** `locality-survey-first-plan`, `plan-for-parentage-question`,
  `fallback-sequencing-plan`, `fan-pivot-plan`, `new-plan-after-census-exhausted`,
  `handle-negative-probate-result`, and the three `negative-*`.

## CUT — safe to remove
- **[203–245] the Phase-1 plan-shell + Phase-2 plan-item `research_append({...})`
  JSON blocks** — the schema documents `section`/`op`/`planId`/`entry`. Keep a
  2-line description of the two-phase write ("append the plan shell to `plans`;
  the tool returns its `pl_` as `entryId` — pass that as `planId` when you append
  each item to `plan_items`, in sequence order, omitting each item's `id`").
- **[247–259] "Plan item fields" enumeration** (record_type enum, jurisdiction,
  date_range, repository enum, rationale, fallback_for) — pure schema dup. The
  `record_type` / `repository` enums live in the tool schema; the rationale
  requirement is already a Rule. Keep only "rationale is mandatory" (it's a
  rubric dim) — drop the field list.
- **[265–297] the re-plan and termination `research_append({...})` update blocks**
  — collapse to: "supersede the old plan first (`op:"update"`, `status:
  "superseded"`) — the tool rejects a second active plan; then create the new one
  (Step 5). To terminate per BCG 18, update the plan `status:"exhausted"` and note
  the GPS can't be met." Keep the *judgment* (when to supersede vs. extend vs.
  exhaust); drop the JSON.
- **[318–337] the worked "Example" block** — a full Schuylkill survey + plan
  walkthrough. It's illustrative, not graded; the locality-survey tool list in §2
  and the rubric carry the behavior. Cut entirely (highest single-block saving),
  or keep 3 lines if the genealogist wants one concrete anchor.
- **[33 second half + 304–307] the "no separate post-write `validate_research_schema`
  step" statements** — say "the tool validates before persisting; on
  `{ ok:false, errors }` it writes nothing — surface and fix" **once** (keep line
  33's first half), and delete the Step-7 repeat.
- **[376–390] "Re-invocation behavior"** — boilerplate that restates §1a's
  modes. Its one real point (never two `active` plans for one question) is already
  a Rule and tool-enforced. Cut.

## KEEP — load-bearing judgment (do NOT cut)
- **§1a "Decide the planning mode"** (Review / Add-new / Supersede + the ambiguous-
  prompt heuristic) — backs `test_research_plan_no_new_plan` (review-don't-create)
  and `test_research_plan_new_plan_for_q_001` (add-new). **This is the highest-
  value protected section** and the single most-tested behavior.
- **§2 locality survey** — what the survey must answer + when to call
  `locality-guide` vs. inline + the `volume_search` / `external_links_search`
  guidance. Backs *Jurisdiction accuracy* and the `locality-survey-first-plan`
  test (which checks the plan cites survey evidence). Keep the tool-list code
  block (it's the call sequence the test grades), tighten prose around it.
- **§3 record-type selection principles** (topical breadth BCG 14, FAN cluster,
  occupation/institutional, boundary/destruction context) — backs *Record type
  selection* and the *FAN items required* rule.
- **§4 sequencing** (highest-probability / free-before-paid / original-before-
  derivative / narrow-before-broad / contingencies / FAN; plan-size 4–10) —
  backs *Sequencing logic* and `fallback-sequencing-plan` / `fan-pivot-plan`.
- **Step 6 re-plan/termination *judgment*** (supersede vs. extend vs. exhaust) —
  backs `new-plan-after-census-exhausted`; keep the decision, drop the JSON.
- **Rules + Decision-rules table** — the routing rows (vague question →
  question-selection; "start searching" → search-records/external-sites; exhausted
  → research-exhaustiveness; >12 items → split) back the three negative tests and
  the *Sequencing*/*Record type* dims. "Never modify items on existing plans"
  backs `test_pli_006_status_unchanged`. **Keep the table**, tighten wording.
- **Places line + §1 verify-the-starting-point (BCG 11)** — keep.
- **The new-items-default-to-`planned`** point — backs
  `test_new_plan_items_planned_status`. One sentence.

## TIGHTEN — keep the point, cut the words
- "One active plan per question / supersede on re-plan" appears in line 33, Step 5,
  Step 6, Rules, Decision-rules, and Re-invocation. State **once** (it's tool-
  enforced anyway) — keep it in Rules.
- The MCP-tools table (52–63) duplicates `allowed-tools` + the §2 call block.
  Trim to a one-line-per-tool list or fold into §2; don't keep both the table and
  the code block.
- "Rationale is mandatory" is in §4, the field table, and Rules — keep once.

## Suggested target structure (~240 lines)
1. Frontmatter + Narration + Places line + the single "writes go through
   `research_append`; tool does ids/one-active-plan/validate; on `{ ok:false }`
   surface-and-fix" paragraph (keep line 33's first half).
2. §1 understand context + verify-starting-point.
3. §1a planning mode (keep ~intact — most-tested).
4. §2 locality survey (keep the call block + "what the survey must answer").
5. §3 record-type principles + §4 sequencing (keep).
6. §5 write: 2-line two-phase description (no JSON, no field table).
7. §6 re-plan/termination: the judgment + one-line supersede/exhaust mechanics.
8. §7 present (bullets only).
9. Rules + Decision-rules table (dedup).
10. (Optional) 3-line example anchor if the genealogist wants one.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill research-plan
```
Watch the six tag-gated validators (esp. no-new-plan vs. new-plan-for-q-001 — the
review/add-new boundary) and the log-unchanged validator. Confirm the three
negative tests route away (question-selection / search-* / record-extraction) and
the three rubric dims pass.

## Owner notes
**Developer** safely cuts the two JSON blocks, the plan-item field table, the
Example walkthrough, the repeated id-alloc / validate / one-active-plan narration,
and Re-invocation. **Genealogist** owns §1a, §2, §3, §4, and the Decision-rules
table — the survey-then-sequence craft and the mode decision are the reason the
skill exists and they back the tag-gated validators and all three rubric dims.

*Rubric-review item (do NOT act on here):* the rubric is clean — no post-write
validate language. Nothing to flag.
