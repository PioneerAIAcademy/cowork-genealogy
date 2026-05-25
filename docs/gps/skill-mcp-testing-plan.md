# Skill and MCP Eval Plan

**Project:** Cowork Genealogy — an AI genealogy research assistant
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

Per the per-PR review workflow (`docs/plan/per-pr-review-workflow.md`), senior genealogists review **every PR** at 100% coverage. Their work spans these activities:

- **Review each PR.** Each PR contains an updated skill prompt, tests, one run log, and one `.ann` annotation file (per skill touched). The senior reads the prompt diff, the test diff, the team's corrected grades, and the side-by-side comparison view (PR's run log vs main's) in the CRUD UI. Decision is holistic: did the skill improve, are the tests reasonable, are the grade corrections sound? Feedback comes as GitHub PR comments. Target: **1 business day** turnaround. If that slips, the team escalates to the senior volunteer pool (see Team Structure below).
- **Leakage check on test additions.** The biggest validity threat to LLM-as-judge grading is when the test author embeds the expected answer in their `additional_criteria` — e.g., "Should resolve the conflict in favor of the Irish birthplace, citing informant proximity." The judge then "agrees" with the author by construction. For every test reviewed, the senior applies the **neutrality test** from `unit-test-spec.md` §5.4: *would a genealogist who reached the opposite conclusion still endorse this criterion as fair?* If not, the criterion gets rewritten to grade the reasoning rather than the verdict.
- **Monthly judge-prompt review.** On the first Monday of each month, the designated review owner (a senior genealogist, with senior engineer pairing for the first 1-2 cycles) aggregates the prior month's `.ann` files and computes `llm_score - corrected_score` deltas grouped by `(dimension_source, dimension_name)`. Systematic deltas trigger an edit to `eval/harness/judge/prompt.md`; the new `judge_prompt_hash` is recorded in `docs/eval-rollout.md` calibration log. See plan §2.6.

100% PR coverage replaces the prior sampling-based review model. At 3 seniors × 8 hr/wk + a volunteer pool, the team can absorb ~20 PRs/week. If review SLA slips, the senior engineer (who is also the hiring manager) brings additional capacity online — either more paid seniors or expanded volunteer participation.

### 5. Unit test runner

Built on the Claude Agent SDK with `setting_sources=["user","project"]` and `"Skill"` in `allowed_tools`. This reproduces Cowork's skill-loading and MCP-invocation behavior while exposing programmatic hooks for evaluation. Mock fixtures for FamilySearch endpoints ensure reproducibility; a small live-API smoke suite is kept separate.

### 6. Review UI for junior genealogists

The CRUD UI (spec: `docs/specs/eval-crud-ui-spec.md`) is where juniors:

- Author and edit unit tests (form maps to the unit-test JSON schema; no raw JSON editing).
- View run logs (the harness writes them to disk via `RunTests.bat`; the CRUD UI auto-refreshes on tab focus).
- Annotate run logs with **per-dimension numeric corrections** on a 1–3 scale (3=pass, 2=partial, 1=fail). The LLM judge's score is shown alongside an editable corrected-score field that defaults to the LLM's score; the junior changes only the dimensions they disagree with. Optional per-dimension comment field for the rationale on disagreement. The UI writes one `.ann.json` file per PR per skill.
- Compare the PR's run log against main's most recent run log for that skill, side-by-side (weighted mean + count histogram). Tests whose `test_content_hash` differs between the two are flagged as excluded from the headline comparison.

The CRUD UI is not the gate — the senior's PR-merge action is. The UI shows numbers; the senior reads them holistically alongside the prompt diff, test diff, and `.ann` file.

### 7. Hire and train junior genealogists

10 junior genealogists, 2 per team across 5 teams. Each team owns 1–3 skills per round; rotation schedule lives in `docs/eval-rollout.md`. New juniors complete an **onboarding task** (Appendix B) before being assigned skills.

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

  Stateless skills (search-wikipedia, translation, historical-context, locality-guide, convert-dates) need no scenario — they're immediately writable.

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
| Developers | 5 teams of 2 | Full-time | Build harness, build CRUD UI, run evals, implement improvements |
| Junior genealogists | 10 (2 per team) | 20-40 | Author tests, run the harness, correct LLM grades, submit PRs |
| Senior genealogists | 1-3 | ~8 each | Review every PR (target 1 business day), apply leakage check on new tests, run the monthly judge-prompt review |
| Senior volunteer pool | flexible | ad hoc | Absorb PR-review overflow when paid seniors are saturated; maintained outside this document |

**Escalation path:** if a PR's review age exceeds 1 business day, the team @-mentions the senior volunteer pool. Volunteers absorb overflow without taking on the monthly judge-prompt review or other paid-senior responsibilities. When volunteer escalations become routine, the hiring manager brings on another paid senior. Personnel details (who's in the pool, training materials) are handled outside this plan; see `docs/eval-rollout.md` Open Blockers.

---

## Stopping Criteria

Stop iterating on an artifact when:
- Two consecutive iterations produce no significant improvement in LLM-judge scores or junior-agreement-with-LLM rate
- Novel-issue flag rate has plateaued (juniors aren't surfacing new failure categories)

If only the first triggers, run a rubric review before stopping — you may be at a local optimum but missing a rubric gap.

---

## Appendix A: (Reserved)

The earlier "escalation taxonomy" (a fixed list of categories juniors used when flagging LLM judge disagreement) was tied to a binary agree/disagree annotation model. Under the per-PR review workflow (plan §2.3), juniors record per-dimension numeric corrections (`llm_score` vs `corrected_score`) plus an optional free-text comment per dimension. There is no escalation taxonomy — the dimension+comment pair carries the signal, and the senior reads each PR.

Cross-PR drift is detected by the **monthly judge-prompt review** (plan §2.6), which aggregates `llm_score - corrected_score` deltas across all `.ann` files from the prior month, grouped by `(dimension_source, dimension_name)`. Systematic deltas trigger judge-prompt edits.

---

## Appendix B: Onboarding Selection Task

Under the per-PR review workflow (plan §2.5), onboarding is a **selection task**, not a pass/fail calibration gate. The team hires the top 10 junior genealogists by exact-match agreement with senior reference grades:

1. **Senior genealogists assemble the onboarding corpus.** Pick 3–5 skills, 2–3 tests each (6–15 tests total, ~40–100 dimension-grades across rubric + per-test criteria). The tests should cover a representative mix of analytical reasoning, structured extraction, and stateless lookup so the corpus discriminates across skill types.
2. **Senior genealogists grade the corpus.** Each senior independently grades the tests on the 1–3 scale (3=pass, 2=partial, 1=fail). Consolidated senior grades become the reference.
3. **Applicants grade the same corpus.** Each junior-genealogist applicant independently grades the tests via the CRUD UI (or a simplified mock — they don't need full repo access yet).
4. **Rank applicants by exact-match agreement.** For each applicant, compute exact-match rate (fraction of dimensions where their score equals the reference). Sort applicants descending.
5. **Top 10 are hired.** No fixed floor — if the top 10 turn out to be weak in practice (PR comments routinely correct them), the team handles it via additional training or a second hiring round, rather than dropping the floor at selection time.

**No Cohen's kappa, no inter-rater reliability calibration, no rolling continuous-calibration golden set.** The per-PR workflow uses a single-annotator model (one team writes the `.ann` per PR), and there's no source of paired-annotation data on which kappa could be computed. Calibration happens continuously through senior PR comments: every disagreement between a junior's correction and the senior's read becomes training.

This is a deliberate trade-off — losing kappa-based reliability in exchange for a workflow the team can execute at its actual capacity. See plan §5 for the full risk discussion.

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
4. Junior team writes a `.ann` correcting LLM grades; senior reviews
5. LLM reads the senior-reviewed corrections + traces + current SKILL.md, rewrites the body
6. Open the result as a PR through the standard per-PR workflow; re-run from step 1

### Optimizer run logs

Optimizer passes (both modes) write run logs to a separate subdirectory:

```
eval/runlogs/optimizer/<skill>/<model>/<timestamp>.json
```

These are **excluded** from cross-PR comparison (plan §2.10), from the `.github/workflows/check-runlogs.yml` Action's runlog-count check (plan §2.8), and from `.ann` annotation. The optimizer's internal scoring is self-contained; only the resulting SKILL.md edit goes through the standard per-PR workflow.

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
