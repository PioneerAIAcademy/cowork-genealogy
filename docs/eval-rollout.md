# Eval Rollout Plan

**Status:** Active. This document tracks week-to-week execution of the eval pipeline. Edited frequently.

**Audience:** Senior engineer (you), junior dev/genealogist pairs, senior genealogists. Read this to know what's happening this week.

**Companion docs:**

- [`docs/gps/skill-mcp-testing-plan.md`](../gps/skill-mcp-testing-plan.md) — strategic plan. Rarely edited. Defines pipeline, roles, calibration mechanics, optimizer details. This rollout doc executes against that contract.
- [`docs/specs/unit-test-spec.md`](../specs/unit-test-spec.md) — test format + harness behavior.
- [`docs/specs/unit-test-spec-v2.md`](../specs/unit-test-spec-v2.md) — deferred features (v2.1, v2.2, v2.3).
- [`docs/specs/eval-crud-ui-spec.md`](../specs/eval-crud-ui-spec.md) — CRUD UI design.

---

## Status (last updated 2026-05-15)

**Current round:** pre-Round-1 (bootstrap)

**Active blockers** (see Open Blockers below for details):

- CRUD UI Results section (annotation + cross-PR comparison view) not yet built — needed before juniors can productively annotate.
- Judge prompt not yet calibrated against any human grades.
- Skill-specific validators only exist for 2 of 23 skills (conflict-resolution and record-extraction as examples).
- Onboarding-task corpus (3–5 skills × 2–3 senior-graded tests) not yet assembled.

**Calibration state:** unknown. No senior-graded runs have happened yet.

---

## Round 1 plan

**Schedule:** 2-3 weeks. No rotation. Each team owns 1-3 skills the entire round.

**Team count:** 5 teams of 2 junior devs + 2 junior genealogists. Skill assignments TBD.

**Goal:** Establish the per-PR per-skill workflow end-to-end. Each team authors 8-12 unit tests per assigned skill, runs them via `RunTests.bat`, writes a single `.ann` file per run log with their corrected grades, and submits a PR per skill. Senior genealogists review every PR via GitHub + the CRUD UI comparison view. By end of round, the judge prompt has been edited at least once based on the monthly judge-prompt review of accumulated `.ann` files.

### Team assignments

| Team | Junior devs | Junior genealogists | Skills (1-3) |
|---|---|---|---|
| Team 1 | TBD | TBD | TBD |
| Team 2 | TBD | TBD | TBD |
| Team 3 | TBD | TBD | TBD |
| Team 4 | TBD | TBD | TBD |
| Team 5 | TBD | TBD | TBD |

### Skill seeding priority

When assigning skills to teams, prefer in order:

1. **Tractable skills with shipped scenarios** — wiki-lookup, conflict-resolution (scenarios shipped); the seed test corpora are usable starting points.
2. **Stateless skills** — translation, convert-dates, historical-context, locality-guide. No scenario dependency; teams can author tests immediately.
3. **Skills with newly-authored scenarios** — once `empty-project-just-created`, `flynn-census-exhausted`, `flynn-resolved`, and `flynn-multi-conflict` are in place: research-plan, question-selection, project-status, proof-conclusion.
4. **Skills depending on Phase-1-stretch scenarios** — assign last; may slip to Round 2.

### Per-PR review cadence (Round 1)

Each PR contains one updated skill prompt + tests + run log + `.ann` file per skill. The team submits when satisfied with their corrected grades on the run log. The senior reviews via GitHub: prompt diff, test diff, `.ann` corrections, and the side-by-side comparison view in the CRUD UI. Target: **1 business day** from PR open to senior response. If that slips, escalate to the volunteer pool (see Open Blockers below).

Most PRs should land in 1–2 review rounds; 3+ rounds is a signal to escalate to the senior engineer (the skill may be in unusual flux, or the team may be struggling).

The senior's accept criterion is holistic, not statistical: did the corrected grades improve over main, do the tests look reasonable, does the prompt make sense? The CRUD UI comparison view shows side-by-side weighted means + count histograms; a delta below 0.3 is flagged as "within typical run-to-run variation — interpret cautiously."

### Judge-prompt calibration

No more dual-grading. The team's `.ann` file is the trusted human signal; the senior reviewing each PR catches drift. Aggregated drift is detected by the **monthly judge-prompt review** (master plan §4) on the first Monday of each month: the designated owner aggregates the prior month's `.ann` files, computes per-dimension `llm_score - corrected_score` deltas, and edits `judge/prompt.md` when systematic patterns emerge. The bootstrap calibration cycle (Open Blockers below) feeds the first such review even before regular PRs accumulate.

### Round 1 deliverables

By end of Round 1:

- [ ] 50-100 tests across 5-15 skills (8-12 tests × ~5-10 skills).
- [ ] Onboarding-task corpus assembled and senior-graded; first cohort of 10 junior genealogists selected.
- [ ] First monthly judge-prompt review completed and the resulting `judge/prompt.md` edit landed.
- [ ] At least 1 merged PR per skill in scope (full workflow exercised: prompt edit + tests + run log + .ann + senior review).
- [ ] Decision log entries (below) capturing what we learned.

---

## Rotation schedule (Round 2 onwards)

**Cadence:** 4-5 skills per team per week. Each team owns its assigned skills for the full week. Rotate on Mondays.

23 skills / 5 teams ≈ 4-5 skills/team. After 5 weeks, every team has touched every skill once. After ~10 weeks, every team has done two passes — first pass authors tests, second pass refines based on annotations.

The exact pairing depends on what Round 1 learns about which skills clump together (e.g., search-records + search-full-text + record-extraction often cluster because tests for one inform the others).

| Week | Team 1 | Team 2 | Team 3 | Team 4 | Team 5 |
|---|---|---|---|---|---|
| Round 2, week 1 | TBD | TBD | TBD | TBD | TBD |
| Round 2, week 2 | TBD | TBD | TBD | TBD | TBD |
| ... | | | | | |

Fill in as Round 1 wraps up.

---

## Bootstrap deliverables (one-time, before Round 1 starts)

| Item | Owner | Status | Notes |
|---|---|---|---|
| CRUD UI: Results section (annotation + comparison view) | Senior engineer | not started | Blocks junior workflow. Authoring + Fixtures CRUD can lag. Spec: `docs/specs/eval-crud-ui-spec.md` |
| `.github/workflows/check-runlogs.yml` | Senior engineer | ✅ done | Enforces ≤1 added run log per skill subdirectory per PR. See plan §2.8 |
| `test_content_hash` in run logs | Senior engineer | ✅ done | Harness writes SHA-256 of the resolved test per plan §2.4 |
| `ann.schema.json` | Senior engineer | ✅ done | Schema for `.ann` files the CRUD UI writes |
| 4 remaining Phase-1 scenarios | Senior engineer | ✅ done | `empty-project-just-created`, `flynn-census-exhausted`, `flynn-resolved`, `flynn-multi-conflict` shipped |
| Example skill-specific validator (#2) | Senior engineer | ✅ done | `test_record_extraction.py`; second example after `test_conflict_resolution.py` |
| Example 8-test corpus | Senior engineer | ✅ done | wiki-lookup has 8 tests total (1 seed + 7 new) |
| Subscription-preferred auth | Senior engineer | ✅ done | `auth.py` updated; ~/.claude/ preferred for skill runner; judge still uses API key |
| AI-authored bootstrap test corpus | Senior engineer (via Claude Code) | ✅ done | ~18 calibration-suitable tests across conflict-resolution, record-extraction, question-selection, research-plan, project-status, historical-context. Combined with the 8 wiki-lookup tests, ~26 traces available for the first monthly judge-prompt review |
| Onboarding-task corpus | Senior genealogist | not started | 3–5 skills × 2–3 senior-graded tests (6–15 tests, ~40–100 dimension-grades). Used to rank junior-genealogist applicants by exact-match agreement and hire the top 10. See master plan Appendix B |
| First monthly judge-prompt review | Senior genealogist + senior engineer | not started | Aggregate the `.ann` files produced by the first round of PRs (or the senior's own grading of the bootstrap corpus if PRs haven't accumulated); compute `llm_score - corrected_score` deltas per dimension; edit `judge/prompt.md` if systematic patterns emerge. Senior applies §5.4 neutrality check to `additional_criteria` during the same review |
| 21 missing skill-specific validators | Junior devs (templated) | not started | Each ~30-80 lines, modeled on the two examples |
| Junior genealogist hiring | Senior genealogist | not started | Run the onboarding-task corpus; rank applicants by exact-match agreement; hire top 10 (no fixed floor — handle weak juniors via PR-comment training if needed) |
| Team assignments | Senior engineer | not started | Fill in the Round 1 table above |

---

## Calibration log

Append-only. One entry per monthly judge-prompt review cycle (first Monday of each month per master plan §4). Cycle owner: designated senior genealogist (with senior engineer pairing for the first 1-2 cycles).

### Template

```
### YYYY-MM-DD — Monthly judge-prompt review

**Window:** PRs merged between YYYY-MM-DD and YYYY-MM-DD.

**Sample:** N .ann files across M skills.

**Per-dimension drift (top deltas):**
- <dimension_source>/<dimension_name>: mean(llm_score - corrected_score) = +/- X.XX, n = N
- ...

**Action taken:** judge-prompt edit / rubric edit / training note / no action. If an edit landed, link the commit.

**Hash diff:** judge_prompt_hash before → after. rubric_hash if changed.

**Notes for next cycle:** what to watch for, follow-ups, escalations to the rubric owner.
```

### (no entries yet)

---

## Decision log

Append-only. Captures non-obvious decisions and why, so context isn't lost between rotations.

### Template

```
### YYYY-MM-DD — <decision>

**Context:** what prompted the decision.

**Decision:** what we chose.

**Alternatives considered:** what we rejected and why.

**Revisit:** date or trigger condition.
```

### 2026-05-13 — N=1 default for runs_per_test

**Context:** v1 harness has multi-run capability but cost is a concern. Sonnet at temperature=0 plus tool-selection nondeterminism still produces some variance.

**Decision:** N=1 default; bump to N=3 only during description-optimizer passes and golden-set calibration.

**Alternatives considered:** N=3 default with the variance-detection benefit (rejected: ~2.5× cost during routine work, juniors don't need variance detection while learning the harness).

**Revisit:** before launching the first description-optimizer pass.

### 2026-05-13 — Iterative judge calibration, not front-loaded golden sets

**Context:** Master plan originally called for ~50 expert-graded traces per artifact before juniors start grading. With ~8 hr/wk senior capacity total, that's 23 × 50 ≈ 1150 traces upfront, which is not realistic.

**Decision:** Calibrate the judge iteratively. Have seniors and juniors both grade a rotating sample of Round 1 tests; use the agreement matrix to iterate on `judge/prompt.md` every 2-3 weeks. Lock the prompt only after agreement plateaus.

**Alternatives considered:** Reduce per-skill golden-set size to 10-15 (still ~280 hours of senior time upfront — not feasible). Use AI-assisted senior grading to bootstrap (rejected: defeats the calibration purpose).

**Revisit:** if Round 1 produces a stable judge-vs-senior agreement rate, document the rate as the production target and move calibration to maintenance cadence.

**Superseded 2026-05-15** by the per-PR review workflow plan. The "iterative calibration" intent stands but the mechanism changed: dual-grading is gone; the single source of human signal is the team's `.ann` file per PR; aggregated drift is detected by the **monthly judge-prompt review** (master plan §4) on the first Monday of each month, not via a junior×senior agreement matrix.

### 2026-05-13 — Bootstrap calibration corpus authored by Claude Code

**Context:** Week-1 calibration needs ≥20 senior-graded traces to produce a statistically meaningful agreement matrix, but only 8 substantial unit tests exist (the wiki-lookup corpus). The other 23 skills have minimal 1-test seed corpora. We need ~18 more tests for week 1.

**Decision:** Have Claude Code author 3 tests each (2 positive + 1 negative) for 6 skills with ready scenarios: conflict-resolution, record-extraction, question-selection, research-plan, project-status, historical-context. Senior engineer does a quick structural cleanup; senior genealogist applies the §5.4 neutrality check *during* grading rather than as a separate review pass. The 6 skills cover the major grading-challenge surfaces (analytical reasoning, structured extraction, planning, summary, stateless lookup).

**Alternatives considered:** Senior genealogists author tests (rejected — 8 hr/wk capacity is too scarce; would consume the entire week-1 budget). Wait for juniors to onboard and author tests (rejected — bootstrap is chicken-and-egg; AI-assisted authoring breaks it). Senior engineer writes by hand (rejected — better use of senior-eng time is CRUD UI work).

**Revisit:** if the AI-authored tests prove low-quality during week-1 calibration (leakage in `additional_criteria`, redundant scenarios), tighten the cleanup pass. If they grade reliably, formalize the AI-assisted bootstrap path in master plan §2.

### 2026-05-13 — Week-1 calibration target is 20-25 traces, not 50

**Context:** Master plan Appendix B onboarding gate is "50-trace calibration set." Doing 50 traces in week 1 needs ~6 hours of senior grading time with no buffer for leakage review or judge-prompt iteration. With ~8 hr/wk senior capacity per senior, theoretically possible but practically fragile.

**Decision:** Tier the calibration corpus by week. Week 1: 20-25 traces (initial judge prompt iteration). Week 2: 35-40. Week 3-4: complete 50-trace set, juniors take the formal gate. Senior dual-grading proceeds incrementally rather than as a single front-loaded effort.

**Alternatives considered:** Drop the formal 50-trace gate entirely (rejected — meaningful junior-onboarding floor). Compress to a 25-trace gate (rejected — kappa with 25 has too much variance).

**Superseded 2026-05-15** by the per-PR review workflow plan. There is no longer a "50-trace formal gate" — onboarding is a one-time selection task (3–5 skills × 2–3 senior-graded tests = 6–15 tests, ~40–100 dimension-grades), the top 10 applicants by exact-match agreement are hired, and no Cohen's kappa is computed (the single-annotator model has no paired data). See master plan Appendix B.

**Revisit:** end of week 4 once juniors have taken the gate against the full 50.

### 2026-05-13 — Subscription-preferred auth for skill runner

**Context:** Operators using Claude Code subscription don't want the harness to silently bill their API key.

**Decision:** `auth.py::resolve_auth` returns `skill_runner_mode="subscription"` when `~/.claude/` exists. API key is still recorded for the judge (which has no subscription path). Strict isolation (env scrubbing) explicitly out of scope.

**Alternatives considered:** Strict isolation via SDK transport patch (rejected: high cost, low marginal benefit — operators can put the key in `eval/.env` instead of the shell to avoid the inheritance gotcha).

**Revisit:** if the inheritance behavior bites in practice.

---

## Open blockers

Append-only inbox of things blocking progress. Move to done state inline; don't delete.

### Active

- **CRUD UI: Results section (annotation + comparison view + recent run logs widget + refresh-on-focus).** Owner: senior engineer. ETA: TBD. Blocks: starting Round 1 with non-trivial junior productivity. Workaround: juniors annotate run logs as raw JSON for the first week if necessary. Spec: `docs/specs/eval-crud-ui-spec.md` §6.
- **Senior volunteer pool not yet populated.** Owner: senior engineer (also hiring manager). The per-PR workflow targets 1-business-day senior review; overflow goes to a volunteer pool maintained outside this document. Names + contact details need to be assembled before Round 1 hits steady state.
- **Judge prompt has never been calibrated against human grades.** Owner: senior engineer + senior genealogist. ETA: first monthly review cycle, once the onboarding-task corpus or Round 1 PRs produce `.ann` files. Blocks: trusting any judge-driven pass-rate metric.
- **Team assignments not yet made.** Owner: senior engineer. ETA: before Round 1 kickoff. Blocks: actually starting Round 1.
- **Historical run logs are pre-workflow.** Per plan §2.13, start fresh — historical run logs under `eval/runlogs/unit/` remain on disk for archeology but do not feed cross-PR comparison. First run log per skill under the new workflow becomes the implicit baseline.

### Resolved

- ✅ **Per-PR review workflow plan landed.** 2026-05-14 — `docs/plan/per-pr-review-workflow.md`.
- ✅ **`test_content_hash` in run logs.** 2026-05-15 — harness writes SHA-256 of resolved test per plan §2.4.
- ✅ **Run-log timestamp simplified.** 2026-05-15 — dropped milliseconds; collision check added.
- ✅ **GitHub Action `check-runlogs.yml`.** 2026-05-15 — enforces ≤1 added run log per skill subdirectory per PR.
- ✅ **`ann.schema.json` defined.** 2026-05-15 — `.ann` file schema for the CRUD UI to write against.
- ✅ **4 remaining Phase-1 scenarios.** 2026-05-13 — shipped.
- ✅ **Subscription auth.** 2026-05-13 — `auth.py` updated.
- ✅ **Second example skill-specific validator.** 2026-05-13 — `test_record_extraction.py`.

---

## v2 batches — when do they unblock the rollout?

Tracked here so the rollout doc surfaces the trigger for each batch. Implementation lives in [`docs/specs/unit-test-spec-v2.md`](../specs/unit-test-spec-v2.md).

| Batch | What | Trigger |
|---|---|---|
| v2.1 | Multi-run / flaky / xfail · parallel execution · suite budget + sidecar | First description-optimizer pass is on the calendar |
| v2.2 | Per-skill `allowed_tools` enforcement · stability floor · multi-turn dialogue | After Round 1 produces real-world friction with v1's permissive cuts |
| v2.3 | Gemini Flash judge · run-log dedup | Only if Haiku judge cost becomes painful |

None of these block Round 1 or Round 2 of the rollout.

---

## How to use this doc

- **Weekly check-in:** add an entry to the calibration log (if a calibration cycle ran), the decision log (if a non-obvious choice was made), or move a blocker to resolved.
- **Round transitions:** fill in the rotation schedule, update the status header date.
- **Don't restate the master plan.** Cross-reference instead. If you find yourself explaining *why* something works the way it does (rather than *what* happened this week), that probably belongs in the master plan.
