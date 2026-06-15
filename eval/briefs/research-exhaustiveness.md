# Deep-Dive Brief — `research-exhaustiveness`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy, fixture-light — and the **thinnest coverage in this batch (2 tests)**. The work is the *fill-in* job: writing the affirmative-path positive that actually exercises the five threshold questions and the 7-point stop criteria, which no current test does. One `validate_research_schema` call; no MCP fixtures.
**Files:** SKILL.md (158 lines) · references ×1 (142 lines) · tests ×2 · rubric ✓ (27 lines).

## What this skill does
GPS Step 1 (Reasonably Exhaustive Research) — the gate immediately before `proof-conclusion`. Evaluates whether research on **one** question is reasonably exhaustive: gathers the question's log entries and assertions, applies five threshold questions, then assesses the 7-point stop criteria (`goal_alignment`, `repository_breadth`, `original_substitution`, `independent_verification`, `evidence_class`, `conflict_resolution`, `overturn_risk`). It then **either writes the `exhaustive_declaration` object and sets `status: "exhaustive_declared"` on the question, or declines and names the gap** — writing nothing else (no new questions, no tree changes). Fires only when the question's plan items are all `completed`/`skipped`; refuses while any are `in_progress`. Calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/research-exhaustiveness/SKILL.md`
- `plugin/skills/research-exhaustiveness/references/research-exhaustiveness.md` (142 lines — five threshold questions, overturn-risk test, termination criteria)
- `eval/tests/unit/research-exhaustiveness/` — `decline-incomplete-research.json`, `negative-next-question.json`, `rubric.md`
- Scenarios used: `flynn-census-exhausted`, `mid-research-flynn`

## Current tests (2)
| id | covers | type |
|----|--------|------|
| ut_research_exhaustiveness_001 | Key record types unsearched → DECLINE to declare; writes no `exhaustive_declaration` | positive |
| ut_research_exhaustiveness_002 | "What should I research next?" → routes to `question-selection` | negative |

> Coverage shape (inverted): the **affirmative path is completely untested**. The only positive is a *decline*, so the skill's core write — `declared: true` with a fully-populated `stop_criteria` object — never happens in the corpus, and the five threshold questions / 7-point criteria are never exercised on a *passing* case. The rubric's "Stop criteria coverage" dimension (all seven keys present) can't be earned by any current test. This skill needs the most new positives in the batch.

## Gaps — new tests to add
**Positive (the affirmative declaration + honesty edges):**
- **Declare exhaustive on a complete question** — a scenario where census + vital + probate are all searched with independent informants; the skill must write `declared: true`, set `status: "exhaustive_declared"`, and fill **all seven** `stop_criteria` keys with log-grounded assessments. This is the skill's headline job and has zero coverage.
- **Honest early termination** — user wants to stop for resource reasons with a real gap remaining; the skill records `declared: false` with an honest justification, *not* a workaround that flips the flag. Directly targets the Declaration-honesty rubric dimension.
- **Refuse-while-in-progress** — a question with an `in_progress` plan item; the skill must refuse to declare and recommend finishing the in-flight work (an explicit edge case in SKILL.md, untested).
- **Already-declared, no re-declare** — `declared: true` already present; the skill reports the existing declaration and points at `proof-conclusion` instead of re-writing (re-invocation edge case, untested).

**Negative (boundaries from the description):**
- → `question-selection`: "What should I research next?" — **already covered** by ut_002.
- → `research-plan`: "Plan more searches for the parentage question — what records are left?"
- → `proof-conclusion`: "Write up the proof argument for the parentage question now."

## ⚠️ Known issues
- **Inverted positive coverage** is itself the issue: no test ever writes a `declared: true` declaration, so a regression that silently breaks the affirmative write (or drops a `stop_criteria` key) would pass the suite. Fix by adding the affirmative-declaration positive first.

## Fixture work
Fixtures are **light/none** — `validate_research_schema` is the only allowed tool and isn't mocked. Every new test is scenario-only. The affirmative-declaration positive needs a scenario whose question has a *fully* searched log (multiple independent sources, originals substituted, conflicts resolved); `flynn-census-exhausted` is a decline-state scenario, so this likely needs a new "exhausted-and-complete" Flynn scenario or a `flynn-resolved`-style state pre-loaded with completed plan items and the assertions to back each stop criterion. The refuse-while-in-progress and already-declared cases pre-load the matching `research.json` state. No `eval/fixtures/mcp/` work.

## Definition of done
Add the affirmative-declaration positive (the priority) → add honest-early-termination, refuse-while-in-progress, and already-declared positives → add the `research-plan` and `proof-conclusion` negatives (question-selection already covered) → confirm the Stop-criteria-coverage rubric dimension is now exercised on a passing case → full harness pass + CRUD review + PR.
