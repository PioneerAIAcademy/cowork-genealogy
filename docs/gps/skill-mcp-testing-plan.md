# Skill and MCP Eval Plan

**Project:** GeneFun AI genealogy research assistant
**Scope:** ~20 skills + ~20 MCP endpoints
**Goal:** Systematically improve skill prompts, MCP tool descriptions, and grading rubrics through automated evaluation with human verification

**Document role:** This is the strategic plan — the design contract for the eval pipeline. It defines what we're building, who does it, and how the pieces fit together. It's rarely edited.

For week-to-week execution (current round, team assignments, calibration log, blockers, decisions), see [`docs/eval-rollout.md`](../eval-rollout.md). The rollout doc executes against the contract this plan defines.

---

## How It Works

The pipeline is a loop:

1. **LLM runs tasks** against eval test cases (unit tests per skill/endpoint, e2e tests from GPS proof statements)
2. **Deterministic checks** catch obvious failures (schema validation, citation format, source-grounding)
3. **LLM judges** grade the results using custom rubrics
4. **Junior genealogists** verify the LLM grades — correct mistakes, flag issues the rubrics missed
5. **Senior genealogists** review the juniors' corrections and calibrate quality
6. **Prompts and rubrics improve** — an LLM reads the test results + human corrections and proposes improvements to skill prompts, MCP descriptions, and grading rubrics
7. Repeat

Over time, the rubrics and judges get better (fewer human corrections needed) and the skills and tools get better (higher eval scores).

---

## What We Need to Build

### 1. E2E test cases from GPS proof statements

Find published GPS-compliant proof statements. Convert each into a test case: the research question, the records available, and the proven conclusion. These test our entire pipeline end-to-end.

### 2. Unit test cases per skill and per MCP endpoint

"In situation X, the skill/tool should do Y." Start with 30+ per artifact, split ~50/50 between should-trigger and should-not-trigger cases. Negatives should emphasize near-misses. Senior genealogists create the initial set; teams expand from there.

For MCP endpoints, unit tests cover three axes: tool selection (should this tool be called?), argument quality (are arguments well-formed?), and response interpretation (did the agent use the response correctly?).

### 3. Grading rubrics

Each skill/endpoint gets two layers:

- **Deterministic validators** (Python scripts): schema validation, citation format, source-grounding check, workflow-order check. These run first and remove 40-60% of review work.
- **LLM judge rubrics**: base rubric (correctness + completeness) plus 4-6 domain dimensions per skill family. Cap at 6-7 total dimensions — more makes the judge noisier. Reuse rubric extensions across skills with similar output shape rather than creating per-skill snowflakes.

### 4. Senior genealogist review

Hire 1-3 experienced genealogists. Their work spans four activities, each with its own cadence:

- **Seed golden traces incrementally.** Senior capacity is ~8 hr/wk per senior — a front-loaded "50 expert-graded traces per artifact across 23 artifacts" approach (~96 senior-hours) is not feasible before juniors start. Instead, seniors and juniors *both* grade a rotating sample of tests during Round 1 (see [`docs/eval-rollout.md`](../eval-rollout.md)). The senior-graded subset is the golden trace pool; it accumulates organically across rounds. Target ~10-15 senior-graded traces per skill by the end of Round 1, growing to ~50 over time. Junior calibration (Appendix B onboarding gate) uses the cross-skill golden pool, not a per-artifact gate.
- **Review test corpus quality.** Verify that additional criteria are genealogically accurate, that they don't *leak the answer* (see leakage check below), that negative-test boundaries are correct, and that scenarios/fixtures are realistic. Target: **every new test reviewed within one week of submission.** Below that cadence, the queue of unreviewed tests grows faster than seniors clear it and junior throughput stalls.

  **Leakage check.** The biggest validity threat to LLM-as-judge grading is when the test author embeds the expected answer in their `additional_criteria` — e.g., "Should resolve the conflict in favor of the Irish birthplace, citing informant proximity." The judge then "agrees" with the author by construction. For every test reviewed, the senior applies the **neutrality test** from `unit-test-spec.md` §5.4: *would a genealogist who reached the opposite conclusion still endorse this criterion as fair?* If not, the criterion gets rewritten to grade the reasoning rather than the verdict. 100% review on golden-set tests; sampled on the rest per the rule below.
- **Adjudicate annotation disagreements.** When juniors disagree about the LLM judge's grades, seniors make the final call. Target: **48 hours from escalation.**
- **Calibrate ongoing quality.** Track novel-issue flag rates (Appendix A), retire low-variance rubric dimensions (Appendix D), promote recurring issues into new validators or dimensions.

**Sampling, not exhaustive review.** ~24 senior-hours/week across 1-3 people is sufficient for 230-460 tests at ~3 min/test plus calibration overhead, but only with sampling:

- 100% of golden-set tests (the calibration backbone)
- 100% of negative tests (boundary accuracy matters disproportionately for the description optimizer)
- ~30% rotating sample of positive tests, weighted toward low LLM-judge confidence or junior disagreement
- 100% of escalations from juniors

Tests outside the sample run without senior pre-review. If they later surface issues in run results, they get pulled into the next review batch.

### 5. Unit test runner

Built on the Claude Agent SDK with `setting_sources=["user","project"]` and `"Skill"` in `allowed_tools`. This reproduces Cowork's skill-loading and MCP-invocation behavior while exposing programmatic hooks for evaluation. Mock fixtures for FamilySearch endpoints ensure reproducibility; a small live-API smoke suite is kept separate.

### 6. Review UI for junior genealogists

Interface where juniors see each trace + the LLM judge's scores and can:
- Give a binary verdict: "does this LLM grade look right?" Y/N
- If N, select a category from the escalation taxonomy + write free-text describing what's wrong
- Never assign per-dimension scores or do pairwise comparisons — that's the LLM judge's job

### 7. Hire and train junior genealogists

10 junior genealogists from West Africa, 2 per dev team. Each team of 4 takes one or more skills per week. Juniors must pass a calibration gate before starting real work (see Appendix B). Rotate juniors across artifacts every 2-3 days to prevent drift.

### 8. Prompt improver

A port of Anthropic's `run_loop.py` / `improve_description.py` extended for both `Skill` and `mcp__familysearch__*` tools. Two modes:

- **Description optimization** (automated): greedy hill-climb on the YAML `description` field. 30+ labeled queries, 60/40 train/test split, 3 runs per query, 5-iteration cap. Runs unattended.
- **Body optimization** (human-in-the-loop): the LLM reads test results + human corrections + current SKILL.md and rewrites the prompt. Re-run evals. Repeat until two consecutive iterations show no improvement.

### 9. Grader improver

Same loop as the prompt improver, but targeting the grading rubrics and LLM judge prompts. When juniors keep flagging the same issue category, that's signal to either add a deterministic validator, add a rubric dimension, or fix the judge prompt.

### 10. Periodic dev review of the test corpus

Quarterly (or after major schema/spec changes), devs audit the corpus for structural drift — independent of the per-test senior review above:

- Scenario files validate against current `research.schema.json` / `tree-gedcomx.schema.json`.
- MCP fixture response shapes match current API responses (regenerate any that have drifted; the `--capture` flag on the harness automates this).
- Skill-specific validators exist for every skill with non-trivial ownership rules; gaps get filled.
- Long-flaky or chronically aborted tests get triaged — either fixed, marked `xfail` with a reason, or retired.

This is structural maintenance, not per-test grading. Out-of-band from the weekly senior review cadence.

---

## Sequencing

### Phase 1: Foundation

- Define e2e and unit test formats (see `docs/specs/unit-test-spec.md`, `docs/specs/e2e-test-spec.md`).
- **Seed bootstrap scenarios.** Juniors reference scenarios from a dropdown; until each exists, tests that need them are blocked by the runnability gate (`unit-test-spec.md` §9). Devs create the following before juniors ramp:

  | Scenario | Needed for | Status |
  |---|---|---|
  | `mid-research-flynn` | Most skills that read mid-research state (assertions, sources, questions) | shipped |
  | `flynn-with-birthplace-conflict` | conflict-resolution positive tests | shipped |
  | `empty-project-just-created` | init-project follow-on tests; question-selection when the question list is empty (the skill should derive from the objective or decline) | Phase 1 |
  | `flynn-census-exhausted` | research-plan tests requiring "what's the next record set after census" | Phase 1 |
  | `flynn-resolved` | proof-conclusion + project-status tests requiring a completed project | Phase 1 |
  | `flynn-multi-conflict` | conflict-resolution prioritization tests (two unresolved conflicts, which to resolve first) | Phase 1 stretch |

  Stateless skills (wiki-lookup, translation, historical-context, locality-guide, convert-dates) need no scenario — they're immediately writable.

- **AI-assisted bulk authoring.** For initial test creation, an LLM generates draft tests from each skill's SKILL.md (reading "Use when," "Do NOT use when," and workflow description). A junior reviews and refines. This bootstraps the target 10-20 tests per skill faster than manual authoring. The drafts live as ordinary test JSON files in `eval/tests/unit/` once accepted; the LLM is a starting point, not an authoritative author.
- Build deterministic validators (universal + per-skill, per `unit-test-spec.md` §8).
- Port Anthropic's `run_loop.py` for description optimization.
- Write LLM judge rubrics for all 23 skills (`rubric.md` per skill).
- **Calibrate the judge model iteratively.** Don't try to build large per-artifact golden sets before juniors start. Instead, during Round 1 of the rollout (see [`docs/eval-rollout.md`](../eval-rollout.md)), seniors and juniors dual-grade a rotating sample of tests as juniors author them. Compute three agreement matrices each week: junior×senior, junior×Haiku, senior×Haiku. Target **≥80% senior×Haiku agreement** on the per-dimension scores; if Haiku falls below 80%, edit `eval/harness/judge/prompt.md` (changes `judge_prompt_hash` and invalidates prior runs — fine during calibration). If the prompt can't reach 80% across iterations, upgrade the judge model and record the choice in `judge_model` per `unit-test-spec.md` §10. The 80% threshold is an initial target from LLM-as-judge literature; re-evaluate after the first calibration cycle.

**Gate:** All 23 skills have a `rubric.md`; at least one calibration cycle has run and produced an agreement-matrix entry in the rollout calibration log; the senior×Haiku rate is either ≥80% or there's a written plan in the rollout log for closing the gap. Don't start the description optimizer until this gate clears — its candidate scoring assumes a calibrated judge.

### Phase 2: First iteration

- Juniors onboard: training, calibration test, certification
- Run top 10 artifacts through the eval pipeline
- Description optimization runs in parallel (automated, ~$25-50 per artifact)
- Body optimization iter-1 with junior verification + senior escalation
- Continue incremental golden-trace seeding during rotation (Round 2 onwards); aim for ~50 per skill across rounds rather than upfront

### Phase 3: Iterate and expand

- Top 10 artifacts iter-2 (pairwise comparison of iter-2 vs iter-1)
- Artifacts 11-20 iter-1
- Remaining artifacts iter-1
- Rubric review: triage novel-issue flags, retire low-variance dimensions, promote recurring issues

### Phase 4: E2E tests

Once unit tests are passing reasonably well, start executing e2e tests against GPS proof statements. Deterministic grading: how well our results matched the GPS proof results (records attached, information found). LLM grading: compare our proof statement to the human-written one.

---

## Team Structure

| Role | Count | Hours/week | Responsibilities |
|------|-------|------------|-----------------|
| Developers | 5 teams of 2 | Full-time | Build harness, run evals, implement improvements |
| Junior genealogists | 10 (2 per team) | 20-40 | Verify LLM grades, flag issues |
| Senior genealogists | 1-3 | ~8 each | Golden sets, calibration, escalations, final calls |

---

## Stopping Criteria

Stop iterating on an artifact when:
- Two consecutive iterations produce no significant improvement in LLM-judge scores or junior-agreement-with-LLM rate
- Novel-issue flag rate has plateaued (juniors aren't surfacing new failure categories)

If only the first triggers, run a rubric review before stopping — you may be at a local optimum but missing a rubric gap.

---

## Appendix A: Escalation Taxonomy

Fixed list juniors use when flagging issues:

- Factual error not in record
- Citation missing or malformed
- Workflow step skipped
- Calibration off (over- or underconfident)
- Output doesn't address prompt
- Reasoning unclear — escalate
- Doesn't fit existing categories — describe

The last category is the rubric-gap detector. Track its usage rate per artifact; spikes mean the rubric is missing something.

---

## Appendix B: Calibration System

### Onboarding gate

Each junior independently grades a 50-trace expert-graded calibration set. Must achieve 80% verdict agreement with expert + Cohen's kappa >= 0.5 on flag categories. Below threshold: more training, re-test on a fresh set.

### Continuous calibration

~10% of every batch is expert-graded traces inserted unannounced. Track each junior's rolling agreement over trailing 50 golden traces. Drop below 75% agreement or kappa 0.5: pause, retrain, re-certify.

Critical: the golden set must include cases where the LLM judge got it wrong and the expert overrode. Otherwise juniors can game by rubber-stamping the LLM.

### Inter-rater reliability

~20% of real traces get reviewed by two juniors independently. Compute kappa between pairs weekly. Target kappa >= 0.5. Disagreements escalate to expert; resolutions become new golden traces.

### Free-text feedback quality

LLM-assisted semantic similarity compares junior and expert feedback on golden traces. Track "same root issue identified" as the primary metric. Standardize on a feedback template: "What's wrong: ... Why it matters: ... What the agent should have done instead: ..."

---

## Appendix C: Optimization Loop Details

### Description optimization (automated)

Targets the YAML `description` field on skills and MCP tool definitions. Port of Anthropic's `run_loop.py`:

- **30+ labeled queries (50/50 should-trigger / should-not-trigger).** Per `unit-test-spec.md` §12, the hand-authored corpus targets 10-20 tests per skill — the optimizer fills the gap. The proposer LLM generates synthetic should-trigger / should-not-trigger queries inline at optimization time using the skill's SKILL.md, current rubric, and existing test patterns as seed material. Synthetic queries are **ephemeral**: they live in memory during the optimization run, are not checked into `eval/tests/unit/`, and do not need to pass through the senior review queue. If a synthetic query surfaces a useful boundary case the hand-authored corpus missed, a junior can promote it into a regular test afterward.
- 60/40 stratified train/test split (stratified by should-trigger vs should-not-trigger)
- 3 runs per query for variance (override `runs_per_test: 3` on the tests being scored against during the pass; revert to N=1 afterward — see `unit-test-spec.md` §7)
- 5 iterations max per pass
- Per iteration: proposer LLM generates candidate from failed-trigger and false-trigger lists; evaluator scores; argmax test_score selects winner
- Stop: two consecutive iterations with no test-score gain

Cost: ~$25-50 per artifact per full optimization run.

### Body optimization (human-in-the-loop)

1. Run skill against eval set (current version vs previous version)
2. Deterministic checks on all traces
3. LLM judge scores every trace + pairwise comparison between versions
4. Juniors verify LLM scores; flag issues
5. Seniors review escalations, produce feedback
6. LLM reads feedback + traces + current SKILL.md, rewrites the body
7. Re-run from step 1

---

## Appendix D: Rubric Design

### Base rubric (all artifacts)

- **Correctness** — does the output do what was asked, with claims supported by sources?
- **Completeness** — did it cover everything the prompt or assertions required?

### Per-skill-family extensions (4-6 domain dimensions)

Example for record-extraction skills:
- Correctness (facts cited match the record; no fabricated details)
- Completeness (all extractable fields captured; no silent omissions)
- Citation discipline
- Evidence weighting (primary vs derivative; direct vs indirect)
- Identity resolution rigor
- Calibration of certainty

### Adding new dimensions

Add to rubric only when:
- 3+ recurring instances across different test cases
- It's genuinely holistic (can't decompose into per-case pass/fail)
- You can articulate it as a rubric criterion with a worked example

If it's checkable per test case, make it a deterministic assertion instead.

When adding at the cap: retire the dimension with lowest score variance and lowest expert override rate.

---

## Appendix E: Cost Estimates

### API costs

| Item | Cost |
|------|------|
| Description optimization per artifact | ~$25-50 |
| Body optimization per iteration per artifact | ~$60 |
| Total for 40 artifacts x 1.5 avg iterations | ~$3,000-5,000 |

### Key cost levers

1. **Prompt caching** — keep system prompt + skill descriptions stable across sessions. Lose cache hits and costs 3-5x.
2. **Tool-result truncation** — FamilySearch person details can hit 5k+ tokens. Truncate before returning to the model.
3. **Model routing** — most turns are Sonnet/Haiku-class work. Reserve Opus for ambiguous identity resolution.

---

## Appendix F: Tech Stack

- **Eval substrate:** Claude Agent SDK with `setting_sources=["user","project"]` + MCP server configuration
- **Optimizer:** Port of Anthropic's `run_loop.py` / `improve_description.py` extended for Skill and MCP tool detection
- **Sandboxing:** Hardened Docker containers (`--cap-drop ALL --security-opt no-new-privileges --read-only --network none`)
- **Observability:** OpenTelemetry export to MLflow or Langfuse — every tool_use, cost, and session_id captured

### Known risks

- Skills behavior on Linux Agent SDK has known bugs (issue #268: hardcoded macOS paths). Verify skill discovery in the container before trusting results.
- `run_loop.py` will silently use `ANTHROPIC_API_KEY` if set, bypassing subscription auth. Lock down env-var passing in the container entrypoint.
- `allowed-tools` SKILL.md frontmatter is silently ignored in the SDK (Cowork honors it). Enforce tool gating via `allowedTools` + `permissionMode: "dontAsk"`.
