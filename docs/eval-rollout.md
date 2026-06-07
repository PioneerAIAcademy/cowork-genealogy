# Eval Rollout Plan

**Status:** Active. This document tracks week-to-week execution of the eval pipeline. Edited frequently.

**Audience:** Senior engineer (you), junior dev/genealogist pairs, senior genealogists. Read this to know what's happening this week.

**Companion docs:**

- [`docs/gps/skill-mcp-testing-plan.md`](../gps/skill-mcp-testing-plan.md) — strategic plan. Rarely edited. Defines pipeline, roles, calibration mechanics, optimizer details. This rollout doc executes against that contract.
- [`docs/specs/unit-test-spec.md`](../specs/unit-test-spec.md) — test format + harness behavior.
- [`docs/specs/unit-test-spec-v2.md`](../specs/unit-test-spec-v2.md) — deferred features (v2.1, v2.2, v2.3).
- [`docs/specs/eval-crud-ui-spec.md`](../specs/eval-crud-ui-spec.md) — CRUD UI design.

---

## Status (last updated 2026-05-18)

**Current round:** pre-Round-1 (bootstrap)

**Active blockers** (see Open Blockers below for details):

- Judge prompt not yet calibrated against any human grades.
- Skill-specific validators only exist for 2 of 23 skills (conflict-resolution and record-extraction as examples).
- Onboarding-task corpus (3–5 skills × 2–3 senior-graded tests) not yet assembled.

**Calibration state:** unknown. No senior-graded runs have happened yet.

**Workflow update (2026-05-18):** The run-log model has been rebuilt around explicit versioning + self-contained snapshots — `v{N}.json` (released), `v{N}_<ts>.json` (candidate), `scratch_<ts>.json` (gitignored). Each run log embeds the skill-side files used. The CRUD UI now supports activate/release/delete + arbitrary-pair comparison + per-skill trend. See [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md). The per-PR review workflow plan §2.4, §2.8, §2.10 are superseded — see notes in that doc.

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

1. **Tractable skills with shipped scenarios** — search-wikipedia, conflict-resolution (scenarios shipped); the seed test corpora are usable starting points.
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
| CRUD UI: Results section (annotation + comparison view + trend + activate/release/delete) | Senior engineer | ✅ done 2026-05-18 | Integrated test-centric scoring view with 📋 copy-as-PR-comment per dimension; arbitrary-pair compare with "what changed" panel; per-skill trend; activate / release / delete actions. See [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md). |
| Run-log versioning (v{N} / v{N}_<ts> / scratch_) + self-contained snapshots | Senior engineer | ✅ done 2026-05-18 | Harness writes multi-test envelopes per skill at `eval/runlogs/unit/<skill>/<filename>` (no model dir). Snapshot embeds every skill-side file; `judge_prompt_hash` tracked separately. See [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md). |
| `.github/workflows/check-runlogs.yml` | Senior engineer | ✅ done 2026-05-18 | Now enforces three rules: ≤1 added released `v{N}.json` per skill (`--diff-filter=AR`), latest full-skill run log is active on skill-side files, latest `.ann.json` is complete. Plus warn-only judge-prompt-hash drift. Implementation: `eval/harness/scripts/check_runlogs.py`. |
| ~~`test_content_hash` in run logs~~ | Senior engineer | ✅ done, **superseded** | Replaced 2026-05-18 by the whole-snapshot model. The per-test hash field is gone; equivalence is now snapshot-vs-snapshot at the file level. |
| `ann.schema.json` | Senior engineer | ✅ done | Schema for `.ann` files the CRUD UI writes. Now **sparse**: corrections only for explicitly-reviewed dimensions; completeness gate enforced by GH Action rule 3. |
| 4 remaining Phase-1 scenarios | Senior engineer | ✅ done | `empty-project-just-created`, `flynn-census-exhausted`, `flynn-resolved`, `flynn-multi-conflict` shipped |
| Example skill-specific validator (#2) | Senior engineer | ✅ done | `test_record_extraction.py`; second example after `test_conflict_resolution.py` |
| Example 8-test corpus | Senior engineer | ✅ done | search-wikipedia has 8 tests total (1 seed + 7 new) |
| Subscription-preferred auth | Senior engineer | ✅ done | `auth.py` updated; ~/.claude/ preferred for skill runner; judge still uses API key |
| AI-authored bootstrap test corpus | Senior engineer (via Claude Code) | ✅ done | ~18 calibration-suitable tests across conflict-resolution, record-extraction, question-selection, research-plan, project-status, historical-context. Combined with the 8 search-wikipedia tests, ~26 traces available for the first monthly judge-prompt review |
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

**Context:** Week-1 calibration needs ≥20 senior-graded traces to produce a statistically meaningful agreement matrix, but only 8 substantial unit tests exist (the search-wikipedia corpus). The other 23 skills have minimal 1-test seed corpora. We need ~18 more tests for week 1.

**Decision:** Have Claude Code author 3 tests each (2 positive + 1 negative) for 6 skills with ready scenarios: conflict-resolution, record-extraction, question-selection, research-plan, project-status, historical-context. Senior engineer does a quick structural cleanup; senior genealogist applies the §5.4 neutrality check *during* grading rather than as a separate review pass. The 6 skills cover the major grading-challenge surfaces (analytical reasoning, structured extraction, planning, summary, stateless lookup).

**Alternatives considered:** Senior genealogists author tests (rejected — 8 hr/wk capacity is too scarce; would consume the entire week-1 budget). Wait for juniors to onboard and author tests (rejected — bootstrap is chicken-and-egg; AI-assisted authoring breaks it). Senior engineer writes by hand (rejected — better use of senior-eng time is CRUD UI work).

**Revisit:** if the AI-authored tests prove low-quality during week-1 calibration (leakage in `additional_criteria`, redundant scenarios), tighten the cleanup pass. If they grade reliably, formalize the AI-assisted bootstrap path in master plan §2.

### 2026-05-13 — Week-1 calibration target is 20-25 traces, not 50

**Context:** Master plan Appendix B onboarding gate is "50-trace calibration set." Doing 50 traces in week 1 needs ~6 hours of senior grading time with no buffer for leakage review or judge-prompt iteration. With ~8 hr/wk senior capacity per senior, theoretically possible but practically fragile.

**Decision:** Tier the calibration corpus by week. Week 1: 20-25 traces (initial judge prompt iteration). Week 2: 35-40. Week 3-4: complete 50-trace set, juniors take the formal gate. Senior dual-grading proceeds incrementally rather than as a single front-loaded effort.

**Alternatives considered:** Drop the formal 50-trace gate entirely (rejected — meaningful junior-onboarding floor). Compress to a 25-trace gate (rejected — kappa with 25 has too much variance).

**Superseded 2026-05-15** by the per-PR review workflow plan. There is no longer a "50-trace formal gate" — onboarding is a one-time selection task (3–5 skills × 2–3 senior-graded tests = 6–15 tests, ~40–100 dimension-grades), the top 10 applicants by exact-match agreement are hired, and no Cohen's kappa is computed (the single-annotator model has no paired data). See master plan Appendix B.

**Revisit:** end of week 4 once juniors have taken the gate against the full 50.

### 2026-05-18 — Run-log versioning + self-contained snapshots

**Context:** The per-PR workflow needed an explicit notion of "the version of this skill we ship" plus a way to detect when the skill files in the repo no longer match what was tested. Original `test_content_hash` covered per-test equivalence but didn't anchor a release concept or surface drift between repo state and the latest run log.

**Decision:** Restructure run logs as multi-test envelopes per skill, embedding a full snapshot of skill-side files (`packages/engine/plugin/skills/<skill>/**`, tests + rubric, referenced scenarios + fixtures). Three filename kinds: `v{N}.json` (released), `v{N}_<ts>.json` (candidate), `scratch_<ts>.json` (gitignored). The CRUD UI detects "active" lazily on the per-skill page by diffing the latest run log's snapshot against the working tree. Senior releases a candidate via a CRUD-UI rename. The `judge/prompt.md` is tracked outside the snapshot via `judge_prompt_hash` so judge edits don't clobber every skill on activate. GH Action enforces three rules per touched skill: ≤1 added released file (via `--diff-filter=AR`), latest full-skill run log is active on skill-side files, latest `.ann.json` is complete. `judge_prompt_hash` drift is warn-only.

**Alternatives considered:** Keep per-test files + content_hash (rejected — no place to hang version/release concepts; can't express "the suite state of this skill at version N"). Embed snapshots as sidecar directories rather than inline JSON (rejected — adds a second filesystem object per run log to track; inline JSON is 30–200KB which is fine). Auto-seed `.ann.json` on re-run (rejected — diluted the quality gate; "Agree with all" per test makes a clean run ~10–20 clicks). Carry-forward score corrections across iterations (rejected, same reason). Block on `judge_prompt_hash` drift (rejected — judge-prompt edits happen on a separate cadence; every-PR blocking would force coordinated re-runs across all skills).

**Revisit:** if junior workflow shows friction around the completeness gate (e.g., consistent partial-review pushes that get rejected by Rule 3), revisit auto-seeding. If snapshot sizes balloon past ~500KB per run log on any skill, revisit content-addressed blob storage.

### 2026-05-13 — Subscription-preferred auth for skill runner

**Context:** Operators using Claude Code subscription don't want the harness to silently bill their API key.

**Decision:** `auth.py::resolve_auth` returns `skill_runner_mode="subscription"` when `~/.claude/` exists. API key is still recorded for the judge (which has no subscription path). Strict isolation (env scrubbing) explicitly out of scope.

**Alternatives considered:** Strict isolation via SDK transport patch (rejected: high cost, low marginal benefit — operators can put the key in `eval/.env` instead of the shell to avoid the inheritance gotcha).

**Revisit:** if the inheritance behavior bites in practice.

---

## Open blockers

Append-only inbox of things blocking progress. Move to done state inline; don't delete.

### Active

- **Senior volunteer pool not yet populated.** Owner: senior engineer (also hiring manager). The per-PR workflow targets 1-business-day senior review; overflow goes to a volunteer pool maintained outside this document. Names + contact details need to be assembled before Round 1 hits steady state.
- **Judge prompt has never been calibrated against human grades.** Owner: senior engineer + senior genealogist. ETA: first monthly review cycle, once the onboarding-task corpus or Round 1 PRs produce `.ann` files. Blocks: trusting any judge-driven pass-rate metric.
- **Team assignments not yet made.** Owner: senior engineer. ETA: before Round 1 kickoff. Blocks: actually starting Round 1.
- **Cowork `model:` frontmatter smoke test not yet run.** Owner: senior engineer. The plan locks in `model:` in `packages/engine/plugin/skills/<skill>/SKILL.md` frontmatter as the per-skill model setting (documented for Claude Code at `code.claude.com/docs/en/skills`; expected to work in Cowork via the Agent Skills standard). Verify naturally on first real Cowork run with a skill that sets `model:`.

### Resolved

- ✅ **Run-log versioning + CRUD UI + GH Action three-rule enforcement.** 2026-05-18 — `docs/plan/eval-runlog-versioning.md`. Single PR with three commits: harness schema (snapshot, versioning, multi-test envelope), CRUD UI lib + pages (read-side), CRUD UI writes + GH Action. 342 tests passing across harness (pytest) and UI (vitest).
- ✅ **CRUD UI: Results section.** 2026-05-18 — integrated test-centric view, sparse-`.ann.json` semantics, copy-as-PR-comment button, arbitrary-pair compare, per-skill trend, activate/release/delete.
- ✅ **Historical run logs cleared.** 2026-05-18 — deleted as part of the snapshot-schema cutover (no migration needed pre-Round-1).
- ✅ **Per-PR review workflow plan landed.** 2026-05-14 — `docs/plan/per-pr-review-workflow.md`. §2.4, §2.8, §2.10 superseded 2026-05-18 by `eval-runlog-versioning.md`.
- ✅ **`test_content_hash` in run logs.** 2026-05-15. **Superseded 2026-05-18** by the snapshot model.
- ✅ **Run-log timestamp simplified.** 2026-05-15 — dropped milliseconds; collision check added.
- ✅ **GitHub Action `check-runlogs.yml`.** 2026-05-15 — initial ≤1-added rule. Expanded 2026-05-18 to three blocking rules + one warn-only.
- ✅ **`ann.schema.json` defined.** 2026-05-15 — `.ann` file schema. Sparse semantics adopted 2026-05-18.
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
