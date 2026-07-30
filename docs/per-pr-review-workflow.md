# Per-PR Review Workflow — Design Change Plan

**Status:** Draft for senior-engineer review (v3 — simplified).
**Date:** 2026-05-15
**Scope:** Eval pipeline workflow redesign — touches `unit-test-spec.md`, `eval-crud-ui-spec.md`, `skill-mcp-testing-plan.md`, `eval/CLAUDE.md`, the harness, the CRUD UI, plus one new GitHub Action.

This plan captures a deliberate shift in how skill evaluation is reviewed. Nothing is implemented yet — this document is the artifact for review and approval before doc rewrites and code begin.

---

## 1. Context

The current eval workflow (defined across `docs/specs/unit-test-spec.md` §10, `docs/skill-mcp-testing-plan.md` Appendix A–B, and `docs/specs/eval-crud-ui-spec.md` §6) assumes a scatter-gather pattern:

- Tests are authored continuously via the CRUD UI.
- Each run log can accumulate **multiple** `.ann.<username>.json` files (one per junior reviewer).
- Disagreements escalate to senior `.adj.<username>.json` adjudications.
- Calibration relies on a **50-trace expert-graded golden set** with rolling Cohen's-kappa checks (Appendix B).
- Juniors give binary `agree`/`disagree` per LLM judge dimension plus a free-text escalation category.

This plan replaces that with a **per-PR per-skill iteration model**:

1. A team (2 junior devs + 2 junior genealogists, per the Round 1 rollout) picks a skill.
2. The team authors/updates unit tests (CRUD UI), edits the skill prompt (text editor), runs the harness, and corrects LLM grades (CRUD UI).
3. The team submits one PR containing: updated skill prompt + added/updated/deleted tests + one run log + one `.ann` file (per skill touched).
4. A senior genealogist reviews via standard GitHub PR diff view + the CRUD UI. PR comments capture all feedback (skill prompt edits, test changes, grade corrections).
5. The team revises and re-submits.
6. The senior accepts when the corrected grades show meaningful improvement, the skill prompt looks good, and the tests look good — judging holistically.

**Net trade:**

| Gives up | Gains |
|---|---|
| Cohen's-kappa-based inter-rater reliability | Atomic per-PR audit trail |
| Multi-annotation per run log | Simpler senior tool surface (GitHub PR + CRUD UI) |
| Continuous-calibration `.adj` adjudications | Git-native review history |
| Escalation-taxonomy categorical feedback | Cleaner per-test trend lines |
| Front-loaded 50-trace golden set | Lower bootstrap cost |

The team has decided this trade is worth making. This plan documents the resulting changes.

---

## 2. Decisions

### 2.1 Numeric 1-3 grading: weighted mean + histogram

**Decision:** Each rubric dimension and each `additional_criterion` is scored on a **1-3 ordinal scale** (1 = fail, 2 = partial, 3 = pass). The LLM's enum output maps deterministically: `pass → 3`, `partial → 2`, `fail → 1`. Both LLM and human grades use the same scale.

Headline metric across a skill's run log:

- **Weighted mean** = `(3·n3 + 2·n2 + 1·n1) / total_dimensions`
- **Histogram** showing counts at each level, displayed alongside

The histogram is what makes bimodality visible — a skill with 5 fails + 5 passes has the same mean as 10 partials, but very different histograms. Single-metric reporting (mean alone, no histogram) is not used.

**Doc impact:** `unit-test-spec.md` §7 grading schema, §10 run log dimension shape; `eval-crud-ui-spec.md` §6 annotation view + comparison view.

### 2.2 One `.ann` file per PR per skill — single-annotator workflow

**Decision:** Each PR includes exactly one `.ann.json` file per skill touched, written by the team submitting the PR. No second-junior annotation. No `.adj.<username>.json` adjudication file. Senior feedback flows through PR comments, not a separate file. The team revises the `.ann` file in response to comments.

**Why:** The team's senior capacity (3 seniors × 8 hr/wk + volunteer-pool overflow, see §2.9) covers ~20 PRs/week with the option to scale. Inter-rater reliability via paired annotations isn't computable here; that loss is accepted in favor of workflow simplicity.

**Doc impact:** `eval/CLAUDE.md` annotation conventions; `eval-crud-ui-spec.md` §6 adjudication view (deleted); `unit-test-spec.md` §10 cross-references.

### 2.3 `.ann` file format

**Decision:** JSON, named `<run-log-timestamp>.ann.json` to mirror the run-log filename. Every dimension of every test in the run log gets an entry. The LLM score and the corrected score are stored side-by-side. Agreement is computed as `corrected_score == llm_score`; no separate flag.

```json
{
  "run_log": "2026-05-14T10-30-15-000Z.json",
  "annotator": "team-3",
  "corrections": [
    {
      "test_id": "ut_record_extraction_001",
      "dimension_source": "rubric",
      "dimension_name": "assertion atomicity",
      "llm_score": 3,
      "corrected_score": 2,
      "comment": "Skill conflated head-of-household and informant — should have been split."
    },
    {
      "test_id": "ut_record_extraction_001",
      "dimension_source": "base",
      "dimension_name": "Correctness",
      "llm_score": 3,
      "corrected_score": 3,
      "comment": null
    }
  ]
}
```

`comment` is optional — expected when scores disagree, omitted when they match. The CRUD UI generates the file; humans never hand-author it. The UI defaults each entry's `corrected_score` to the LLM's score; the junior changes only the dimensions they disagree with.

**Doc impact:** `unit-test-spec.md` §10 (new subsection); `eval-crud-ui-spec.md` §6; `eval/CLAUDE.md` annotation conventions.

### 2.4 Tests are mutable; content hash auto-excludes from comparison

> **Superseded by `docs/plan/eval-runlog-versioning.md` §A2/A4/A7.**
> The per-test `test_content_hash` field is gone. The whole-snapshot
> model replaces it: each run log embeds the normalized contents of
> every skill-side file used in the run, and the comparison view
> diffs the two snapshots to decide which tests are "edited."

**Decision:** Junior genealogists may update existing tests freely. The harness writes a `test_content_hash` field per test in every run log — SHA-256 over **the resolved test**, computed as:

- the test JSON minus the cosmetic fields `name`, `description`, `tags`
- plus the contents of the referenced scenario directory (`research.json` + `tree.gedcomx.json`)
- plus the contents of each referenced MCP fixture file

Inputs are normalized for whitespace and key order before hashing. The exclusion-based phrasing (exclude cosmetic fields, include everything else) is intentional: future schema additions are caught by default, and edits to a referenced scenario or fixture correctly invalidate the test's hash even though the test JSON itself didn't change.

The cross-PR comparison view (§2.10) auto-excludes tests whose hash differs between the PR's run log and main's. The senior sees the hash-change in the GitHub PR diff and decides what to do:

- If the comparison gap matters, they ask the junior to revert the hash-affecting change via PR comment.
- Otherwise the exclusion stands for one PR. After landing, the test's hash on main matches itself and the test is comparable in the next PR.

**Doc impact:** `unit-test-spec.md` §10 (`test_content_hash` per-run field); `eval-crud-ui-spec.md` §3 (edit flow shows hash-change warning), §6 (comparison view marks excluded tests).

### 2.5 Onboarding via selection, not a gate

**Decision:** Onboarding is a **selection task**, not a pass/fail gate. The team hires the top 10 junior genealogists (2 per team × 5 teams) by exact-match agreement with senior reference grades:

1. Senior genealogists pick 3-5 skills, 2-3 unit tests each (= 6-15 tests, ~40-100 dimension-grades total).
2. Senior genealogists grade each test on the 1-3 scale; these become the reference grades.
3. Each applicant independently grades the same tests.
4. Senior ranks applicants by exact-match agreement with the reference.
5. **Top 10 are hired.** No floor — if the top 10 turn out to be weak in practice, the team handles it later (additional training via PR comments, or another hiring round).

This is a one-time activity per applicant. Ongoing calibration drift is caught via PR comments — when a senior disagrees with a junior's correction, the comment becomes training.

**Why no floor:** Adds complexity for a failure mode the team isn't worried about. If weak juniors do get through, PR comments surface the problem quickly and the team can act.

**Doc impact:** `skill-mcp-testing-plan.md` Appendix B (full rewrite — selection task, not gate).

### 2.6 Monthly judge-prompt review

**Decision:** On the first Monday of every month, the **senior genealogist** designated as the review owner (with senior engineer pairing for the first 1-2 cycles) reviews the prior month's PR `.ann` files. The procedure:

1. Aggregate `(llm_score - corrected_score)` deltas grouped by `(dimension_source, dimension_name)` across all `.ann` files from the month.
2. Dimensions with systematic deltas (e.g., LLM grades 0.5+ levels higher than humans across 5+ PRs) trigger a `judge/prompt.md` edit.
3. The edit increments `judge_prompt_hash` (already tracked per run log).
4. Log the cycle in the calibration log: sample size, agreement rates per dimension, action taken, hash diff.

The corrected_score is the *final* human verdict after senior PR review. If a junior over-corrected and the senior restored the original, the final delta is zero and the entry naturally contributes nothing to drift — no special handling needed.

**Doc impact:** `skill-mcp-testing-plan.md` senior responsibilities (new calibration log template + recurring calendar entry).

### 2.7 Cross-skill PRs

**Decision:** A PR typically touches one skill. A PR that touches a shared reference (a GPS framing block, a shared rubric pattern) may touch any number of skills; it includes one run log + one `.ann` file per affected skill. No cap.

**Why no cap:** Forcing a multi-skill refactor into multiple PRs adds partial-landing risk (first PR breaks because the second hasn't landed yet) without saving senior time. The total review burden is the same either way; better to keep it atomic.

**Doc impact:** `unit-test-spec.md` §10 (run-log location convention).

### 2.8 GitHub Action: runlog discipline

> **Superseded by `docs/plan/eval-runlog-versioning.md` §C6.**
> The "≤1 added run log per skill" rule becomes "≤1 *newly-added-or-
> renamed-into-place* released `v{N}.json` per skill" (the rename
> matters because release is a candidate → released git rename — the
> earlier `--diff-filter=A`-only check missed it). Two new blocking
> rules join Rule 1: the latest full-skill run log must be active on
> skill-side files (snapshot matches working tree) and its `.ann.json`
> must have an entry for every dimension. Plus one warn-only check on
> `judge_prompt_hash` drift.

**Decision:** A new workflow at `.github/workflows/check-runlogs.yml` runs on every PR. It enforces **at most one run log added per skill subdirectory** under `eval/runlogs/unit/<skill>/<model>/`. Optimizer runs at `eval/runlogs/optimizer/` are excluded.

Failure messages tell the team how to fix (delete extra run logs from the branch).

Pre-commit hooks aren't used — juniors may not install them; CI enforcement is the only reliable mechanism.

**Doc impact:** New file (`.github/workflows/check-runlogs.yml`); brief reference in `eval/CLAUDE.md`.

### 2.9 Senior escalation + hiring trigger

**Decision:**

- If a PR's review age exceeds **1 business day**, the team escalates to a **senior volunteer pool** maintained outside this document.
- If escalations to the volunteer pool become routine, the senior engineer (also the hiring manager) hires another paid senior genealogist. No specific threshold — by-eye judgment.

Personnel — who's in the volunteer pool, response-time expectations, training materials — are handled by the senior engineer outside this plan. This document specifies only the trigger and the workflow mechanism.

**Doc impact:** `skill-mcp-testing-plan.md` Team Structure (volunteer-pool concept added — names handled separately).

### 2.10 Cross-PR comparison: side-by-side display, senior judges

> **Superseded by `docs/plan/eval-runlog-versioning.md` §B3.**
> The auto-pick-two-most-recent default is gone. The new comparison
> page accepts arbitrary `(recent, previous)` run-log ids (default:
> latest candidate vs latest released) and compares **corrected**
> scores from `.ann.json`, with snapshot-aware per-test exclusion and
> a "what changed" panel diffing the two snapshots. The 0.3
> within-variance advisory persists. Senior judges, no statistical gate.

**Decision:** The CRUD UI's comparison view shows, for each skill, the PR's weighted mean + histogram and main's weighted mean + histogram **side-by-side**. The senior reads both and makes a holistic judgment about whether the PR is an improvement — they also have the prompt diff, the test diff, and the `.ann` file as context.

There is no statistical gate, no noise-band calculation, no `--baseline-noise` mode, no `compare.py` module, no N=5 reruns. The senior is the gate; the numbers are diagnostic.

**Single-sample noise advisory.** The LLM judge is pinned to `temperature=0`, so it grades a given transcript identically every time. The **skill model** is not pinned (the SDK exposes no temperature), so a no-op rerun still produces a different transcript and can flip a fraction of per-dimension scores. To prevent over-reading small movements, the comparison view **marks per-skill weighted-mean deltas below 0.3 as "within typical run-to-run variation — interpret cautiously."** The marker is advisory, not enforcing — the senior decides what to make of it. Either party (junior or senior) can re-run the harness for a second sample by running the Python script (§2.12); if the two samples agree directionally, the change is more likely real.

**Why:** Statistical noise bands matter when human judgment can't be trusted to spot real vs noise. With senior PR review on every merge and rich context (prompt diff, test diff, `.ann` file), the human is already evaluating multiple signals — the comparison numbers are one more input, not the decision. The 0.3 marker is unprincipled but anchors the senior's judgment against ambient noise; if "I still can't tell signal from noise" becomes a recurring senior complaint, add proper noise bands in v2.

**Doc impact:** `eval-crud-ui-spec.md` §6 (comparison view: side-by-side weighted mean + histograms, plus the 0.3-delta within-variance marker).

### 2.11 Optimizer runs are quarantined

**Decision:** Description-optimizer and body-optimizer runs (master plan Appendix C) live under `eval/runlogs/optimizer/<skill>/<model>/<timestamp>.json` — distinct from `eval/runlogs/unit/`. They are:

- Excluded from the GitHub Action's runlog-count check (§2.8).
- Excluded from the cross-PR comparison view (§2.10).
- Not annotated (`.ann` files don't apply — no human in the loop for description optimization).
- Retained for the description optimizer's internal scoring only.

When body-optimizer runs produce a candidate SKILL.md edit, that edit goes through the standard per-PR workflow.

**Doc impact:** `unit-test-spec.md` §10 (run-log directory convention); `skill-mcp-testing-plan.md` Appendix C.

### 2.12 Junior workflow sequence

**Decision:** Document the procedure as a copy-pasteable numbered list in `eval/CLAUDE.md`:

> 1. Pull latest main. Edit `packages/engine/plugin/skills/<skill>/SKILL.md` and/or tests via the CRUD UI.
> 2. Run the harness for the skill:
>    ```bash
>    make eval-skill SKILL=<name>   # rebuilds the engine if stale, then runs
>    # or: cd eval/harness && uv run python run_tests.py --skill <name>
>    ```
>    The harness writes the run log to `eval/runlogs/unit/<skill>/<model>/<timestamp>.json`.
> 3. Open the CRUD UI Results section. Pick the new run log. Review LLM scores per dimension per test.
> 4. Enter corrections for every dimension. The CRUD UI writes `<timestamp>.ann.json` alongside the run log.
> 5. Commit all artifacts: SKILL.md edits, test changes, run log, `.ann` file. Push the PR.
> 6. Respond to senior PR comments by re-running steps 2-5 and pushing **a new commit per revision** (don't amend). Squash on merge.

Most PRs land in 1-2 review rounds. 3+ rounds is a signal to escalate — the skill may be in unusual flux or the team may be struggling; flag it to a senior engineer.

**Doc impact:** `eval/CLAUDE.md` step-by-step.

### 2.13 Judge-crash handling + start-fresh on run logs

**Two small decisions:**

- **Judge crashes → re-run before annotation.** When the LLM judge fails entirely on any test in the run (missing API key, transient API error, parse failure after the harness's built-in retries), the resulting run log has dimensions with no `llm_score`. The CRUD UI refuses to open such a run log for annotation, displaying a clear message that the team must re-run the harness first. Persistent crashes (re-runs keep failing) escalate to the senior engineer rather than landing partial PRs. Judge crashes are expected to be rare given the harness's existing retry-with-backoff.
- **Existing run logs:** Start fresh. Historical run logs under `eval/runlogs/unit/` from before this workflow lands remain on disk for archeology but do not feed cross-PR comparison.

**Doc impact:** `unit-test-spec.md` §7 (judge-crash → re-run requirement); `eval-crud-ui-spec.md` §6 (annotation view refuses partial-judge run logs).

---

## 3. Document rewrites required

| Document | Sections to edit | Type |
|---|---|---|
| `docs/specs/unit-test-spec.md` | §7 (1-3 grading, judge-crash decision), §10 (run log: `test_content_hash` per test, `.ann` schema, run-log-per-skill rule, optimizer dir) | Substantial |
| `docs/specs/eval-crud-ui-spec.md` | §3 (edit flow with hash-change warning, default corrected_score = llm_score), §6 Results section (numeric per-dimension annotation, comparison view with side-by-side weighted mean + histograms + 0.3-delta within-variance marker + hash-change markers, annotation view refuses partial-judge run logs), §6 Adjudication view (delete) | Substantial |
| `docs/skill-mcp-testing-plan.md` | Appendix A (drop escalation taxonomy), Appendix B (onboarding selection task, full rewrite), Appendix C (optimizer output location), Team Structure (volunteer pool concept), §4 Senior review (drop sampling math) | Substantial |
| `eval/CLAUDE.md` | `.ann` per-PR convention, drop `.adj` convention, junior workflow sequence (§2.12), CI-enforcement note | Small-medium |
| `eval/harness/harness/runlog.py` | Add `test_content_hash` per run (covers test JSON + resolved scenario + referenced fixtures) | Small |
| `.github/workflows/check-runlogs.yml` | New workflow | New |

---

## 4. Things explicitly NOT changing

Captured here so reviewers don't propose reverting decisions already weighed:

- **No Cohen's kappa, no inter-rater reliability mechanics.** Senior PR review replaces paired-annotation calibration.
- **No `.adj` adjudication files.** Senior feedback flows through PR comments.
- **No multi-annotator-per-PR mode.** One team, one PR, one `.ann` per skill.
- **No pre-commit hooks.** Juniors may not install them. CI enforcement only.
- **No backward-compatibility shims.** Nothing in production yet; clean break is fine.
- **No side-channel override files.** The `.ann` file is the human verdict. PR comments + git + senior judgment handle every case. No `.overrides.json`, no `senior_override` flags.
- **No statistical comparison gate.** No noise bands, no sign tests, no `--baseline-noise` mode. The senior is the gate; the numbers are diagnostic.
- **No onboarding pass/fail floor.** Top 10 by exact-match agreement get hired; quality is handled afterward via PR comments.

---

## 5. Risks and trade-offs

Honest about what we're giving up:

1. **No inter-rater reliability signal.** Cannot compute junior×junior agreement. Calibration drift between juniors is invisible until a senior catches it in PR review. Mitigation: onboarding selection (§2.5) front-loads quality; monthly judge-prompt review (§2.6) catches LLM drift; PR-comment training catches human drift continuously.

2. **Senior capacity has no slack.** 24 hr/wk + volunteer pool covers the expected load, but a sustained spike will saturate. Mitigation: 1-business-day trigger + volunteer escalation + by-eye hiring trigger (§2.9).

3. **Numeric 1-3 scale loses ordinal information.** Reporters who mean different things by "partial" can both grade 2. Mitigation: rubric `partial` criteria are spelled out per dimension in `unit-test-spec.md` §7; the histogram (§2.1) makes distributions visible.

4. **Cross-PR comparison auto-excludes hash-changed tests.** A junior who changes a test's `user_message` while keeping `test_id` constant has the test excluded from comparison — the headline weighted mean is computed only on stable tests. The senior sees the hash-change warning in the CRUD UI; if it matters they ask the junior to revert via PR comment, otherwise they accept one PR of thinner comparison data. After the PR lands, the test's hash on main matches itself and the test becomes comparable again.

5. **Senior judgment, not statistics, is the gate.** No defensible "this delta is real" calculation. A senior could rubber-stamp a regression by assuming it's noise. Mitigation: the senior also sees the prompt diff, test changes, and `.ann` file — multiple signals, not just the weighted mean. If "can't tell signal from noise" becomes a recurring complaint, add noise bands in v2.

6. **Monthly judge-prompt review depends on one person.** Same senior every month for consistency, but bus-factor of one. Mitigation: the procedure (deltas grouped by dimension) is mechanical enough that a backup senior can pick it up; the monthly calendar entry includes a brief HOW.

---

## 6. Implementation order

1. **Land doc changes first** — `unit-test-spec.md`, `skill-mcp-testing-plan.md`, `eval/CLAUDE.md`, `eval-crud-ui-spec.md`. ~1-2 days.
2. **GitHub Action** (`check-runlogs.yml`). Independent of CRUD UI; protects from day one.
3. **Harness change**: add `test_content_hash` field per test in run logs. Small.
4. **CRUD UI rewrites**: numeric annotation view, side-by-side comparison view (weighted mean + histogram + hash-change markers), adjudication view deletion. This is the biggest implementation cost.
5. **Onboarding-task materials**: 3-5 skills × 2-3 senior-graded tests with reference grades; selection procedure written up. (Personnel materials — volunteer pool, training — handled outside this plan.)

Realistic timeline: 1-2 weeks of focused work, mostly CRUD UI. Doc-only changes are 1-2 days.

---

## 7. Revisit clauses

Trigger conditions that force a return to this plan:

- **If median PR-review age exceeds 3 business days for 3 consecutive weeks** despite the volunteer pool, revisit whether 100% PR coverage is the wrong model.
- **If the top-10 onboarding selection produces a cohort that needs more than ~20% of PR comments dedicated to grading drift**, revisit the selection methodology — possibly add a floor, possibly expand the onboarding task.
- **If seniors routinely complain "I can't tell signal from noise in the comparison view"**, add a noise-band gate (deferred from this plan).
- **If monthly judge-prompt review never triggers an edit for 3 consecutive months**, either the judge is fully calibrated (good) or the procedure isn't surfacing real drift (bad — investigate by sampling).

Each trigger gets logged as a decision-log entry when fired, with the resulting plan change recorded.

---

## 8. Net summary for the reviewer

This plan is a workflow simplification, not a methodology overhaul. The eval pipeline's *what* (skills graded against rubrics, multi-layer validation, deterministic + LLM judge + human verification) doesn't change. Only the *how* of human verification changes — from a scatter-gather multi-annotator model with formal calibration mechanics to a per-PR single-annotator model with senior judgment doing the work that statistical machinery would otherwise do.

The biggest cost is **giving up Cohen's-kappa-based reliability signals** and **giving up a defensible statistical comparison gate**. The biggest gain is **a workflow the team can actually execute** — fast PR turnaround, no complex statistics, no side-channel files, no override mechanisms. Senior judgment is the spine.

Load-bearing decisions: per-PR workflow (§1), 1-3 numeric grading (§2.1), single `.ann` per skill (§2.2–§2.3), content-hash auto-exclusion (§2.4), senior judgment as the comparison gate (§2.10).

Approve, request specific changes, or push back on any of the §2 decisions, §4 non-changes, or §7 revisit clauses before doc rewrites begin.
