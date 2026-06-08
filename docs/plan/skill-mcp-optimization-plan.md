# Skill and MCP Endpoint Optimization Plan

**Project:** GeneFun AI genealogy research assistant
**Scope:** ~20 Claude Cowork Skills + ~20 FamilySearch MCP tool endpoints
**Timeline:** 1 month (4 weeks)
**Primary goal:** Optimize skill descriptions, skill bodies, and MCP tool descriptions through an LLM-judged evaluation harness with human verification
**Secondary goal:** Produce a runtime that could later serve non-Cowork users via FamilySearch

---

## 1. Architecture

The harness is built on the **Claude Agent SDK** with `setting_sources=["user","project"]` and `"Skill"` in `allowed_tools`. This reproduces Cowork's skill-loading and MCP-invocation behavior while exposing programmatic hooks needed for evaluation. We do not use Claude Code in headless mode as the primary integration (it shells out to a CLI and exposes less programmatic surface than the SDK), and we do not use the raw Messages API (it would require reimplementing the agent loop, compaction, and skill-loading semantics).

**Eval substrate:** Promptfoo with the `claude-agent-sdk` provider as the day-1 substrate. It already normalizes Skill tool invocations into `response.metadata.skillCalls`, supports MCP servers, and ships LLM-rubric assertions. Inspect AI is added later if we need capability benchmarks across model generations.

**Optimizer:** A port of Anthropic's `run_loop.py` / `improve_description.py` (from `anthropics/skills/skills/skill-creator/scripts/`) extended to detect `tool_use` events for both `Skill` and `mcp__familysearch__*` tools. Greedy hill-climb on the YAML `description` field with a 60/40 stratified split, 3 runs per query, 5-iteration cap, argmax test_score (tiebreak train_score). When this plateaus we graduate to `dspy.GEPA` with the MCP adapter.

**Sandboxing:** Hardened Docker container per evaluation session with `--cap-drop ALL --security-opt no-new-privileges --read-only --network none --pids-limit ...`, plus `@anthropic-ai/sandbox-runtime` (bubblewrap on Linux) wrapping the Bash tool. Per-VM-per-session is deferred until production deployment to non-Cowork users; for evaluation it's premature infrastructure.

**Observability:** OpenTelemetry export from the SDK to MLflow or Langfuse. Every tool_use, every cost.usd, every session_id captured. Non-negotiable — the optimizer needs traces.

---

## 2. Per-Artifact Deliverables

### Per skill

- **Eval queries (`evals.json`)** — 30+ realistic prompts split roughly 50/50 should-trigger and should-not-trigger, with negatives heavy on near-misses. Each query tagged with difficulty and category.
- **Grader assertions** per test case — 4–8 verifiable claims about the output. Programmatic checks (schema validation, format compliance, presence of fields) preferred over LLM-graded.
- **Comparator rubric extension** — 4–6 domain dimensions appended to the base rubric, scoped to the skill family.
- **Deterministic validators** — Python scripts run before any human or LLM judge: GedcomX schema validator, citation format checker, source-grounding check (every claim string-matches something in cited records), workflow-order check.
- **Cohort verification checklist** — 5–8 binary questions framed as verification of the LLM judge's call. Plus the fixed escalation taxonomy.
- **Golden traces** — ~50 expert-graded traces, mix of strong and weak outputs, each with documented reasoning. Used for cohort onboarding and continuously seeded for drift detection.
- **Reference / expected behavior** per test case — either a reference output or a written description of what good looks like.
- **Source fixtures** — actual records referenced by test cases, stored alongside the eval set for reproducibility.
- **Versioned artifact + changelog** — SKILL.md tracked in git with a short rationale for every change. The optimizer's proposer uses this history.

### Per MCP endpoint

Same list with these differences:

- **Eval queries** target three axes: tool selection (should this tool be called?), argument quality (when called, are arguments well-formed?), response interpretation (did the agent use what came back correctly?).
- **Grader assertions** focus on: was the right tool called, with reasonable arguments, in the right sequence relative to other tools, with graceful handling of empty/error responses?
- **Comparator rubric** dimensions: tool selection appropriateness, argument construction quality, response interpretation, efficiency. Correctness and completeness still apply at the top.
- **Deterministic validators** focus on argument schema validity and tool-sequence patterns.
- **Mock fixtures** — canned response fixtures for FamilySearch endpoints, both for reproducibility and to test edge cases (empty results, partial records, ambiguous matches). A small live-API smoke suite is kept separate from the main fixture-based eval.
- **Expected tool-call sequences** — for multi-step queries, the canonical sequence the agent should follow.

### Built once, reused across all artifacts

- **Base Comparator rubric** (correctness + completeness + minimal presentation dimensions). Per-skill extensions append, not replace.
- **Pairwise prompt template** for the Comparator (A vs B blind comparison).
- **Direct-scoring prompt template** for per-trace LLM judging that the cohort verifies. Both templates consume the same rubric — they differ in usage mode, not dimensions.
- **Cohort training materials** — onboarding curriculum, calibration set (50 traces an expert grades with rationale), agreement-rate test.
- **Optimization loop scripts** — port of Anthropic's `run_loop.py` / `run_eval.py` / `improve_description.py`, generalized to handle both `Skill` and `mcp__familysearch__*` tool detections.
- **Trace/result storage schema** — JSONL with consistent fields (artifact, version, prompt, trace, judge_verdict, cohort_verdict, expert_verdict, agreement_flags, timestamp).
- **Eval viewer** — Anthropic's `generate_review.py` adapted for the cohort workflow (binary checklist + escalation taxonomy).
- **Escalation taxonomy** — fixed list of categories the cohort uses to flag issues.
- **Agreement-rate dashboard** — rolling agreement rate per cohort member against golden traces.

---

## 3. Evaluation Hierarchy

Defense in depth. Each tier catches what the tier above missed.

**Tier 1 — Deterministic checks (Python scripts).** Schema validity, format compliance, source-grounding, workflow order. Runs on every trace before any judge sees it. Removes 40–60% of trace-review work.

**Tier 2 — LLM judge.** Two modes using the same rubric. Direct scoring runs on every trace (per-dimension scores with rationale). Pairwise comparator runs on iteration comparisons (blind A/B between two configurations). The pairwise verdict is the iteration decision; the direct scores are what the cohort verifies.

**Tier 3 — Cohort verification.** Junior reviewers verify the LLM judge's direct-scoring verdicts. They produce a binary verdict ("does this LLM call look right?") plus structured flags from the escalation taxonomy plus free-text describing what's wrong. They never assign per-dimension scores or do pairwise comparisons themselves.

**Tier 4 — Expert review.** Senior genealogists handle calibration-set maintenance, escalations from cohort, spot-checks of cohort verdicts, final iteration decisions, and rubric evolution. Their work product is judgment, calibration, and rubric updates — not bulk grading.

The principle: when the human notices the same kind of issue across multiple test cases, **promote the finding down a tier**. Turn it into an assertion (so the Grader catches it), or add a dimension to the per-skill rubric extension (so the Comparator catches it), or write a deterministic validator (so Tier 1 catches it). If the human is still catching the same class of issue ten iterations in, the system isn't compounding.

---

## 4. Optimization Loops

Two loops run in parallel per artifact, with different cadences and different optimizers.

### Description optimization (automated, weekly)

Targets the YAML `description` field on skills and the `description` field on MCP tool definitions. Both control trigger/selection accuracy and are short enough for greedy hill-climb to work well. Anthropic's `run_loop.py` design verbatim:

- 30+ labeled queries (50/50 should-trigger / should-not-trigger)
- 60/40 stratified split into train and test
- 3 runs per query for variance
- 5 iterations max per pass
- Per iteration: proposer (LLM with FAILED-TO-TRIGGER + FALSE-TRIGGER lists, history, rubric) generates one candidate; evaluator scores against train and test; argmax test_score selects the winner
- Stopping rule: two consecutive iterations with no significant test-score gain

This loop runs unattended on Claude Code subscription auth (free, modulo subscription) or metered API. Cost roughly $25–50 per artifact per full optimization run. Kick off as a batch job; review winners weekly.

### Body optimization (human-in-the-loop, biweekly)

Targets the SKILL.md body (the prose that teaches Claude how to do the task). Anthropic's pattern is human-in-the-loop driven by `feedback.json` from the eval viewer. We extend it with the cohort layer:

1. Run skill against eval set with-skill and without-skill (or v(N) vs v(N-1) once we're past iter 1).
2. Tier 1 deterministic checks run on all traces.
3. Tier 2 LLM judge produces direct scores on every trace and pairwise verdicts on iteration comparisons.
4. Tier 3 cohort verifies LLM scores on individual traces; flags issues using escalation taxonomy.
5. Tier 4 expert reviews escalations and pairwise verdicts, produces rubric updates and feedback.
6. Claude reads feedback.json + traces + current SKILL.md + rubric, rewrites the body.
7. Re-run from step 1.

Stopping rule for body optimization: two consecutive iterations with no statistically significant improvement in dimensional scores or cohort verdict-agreement-with-LLM rate, AND novel-issue flag rate has plateaued. If only the first triggers, run a rubric review before stopping.

---

## 5. Cohort Workflow

The cohort consists of junior reviewers (West African dev cohort with basic genealogy training) working 20–40 hours/week. They cannot reliably do per-dimension scoring or pairwise comparison; they can reliably verify a structured LLM judgment and flag issues using a fixed taxonomy.

**What the cohort produces per trace:**

- Binary verdict: "does the LLM judge's call on this trace look right?" Y/N.
- If N, structured flag from the escalation taxonomy plus free-text describing what's wrong.

**What the cohort never produces:**

- Per-dimension scores. Those come from the LLM judge.
- Pairwise comparisons. Those come from the Comparator subagent.
- Novel rubric dimension proposals. Those come from expert review.

**The escalation taxonomy** (fixed list, all artifacts):

- Factual error not in record
- Citation missing or malformed
- Workflow step skipped
- Calibration off (over- or underconfident)
- Output doesn't address prompt
- Reasoning unclear — escalate
- Doesn't fit existing categories — describe (this is the rubric-gap detector)

**What the cohort *does* do beyond verification:** identifies patterns the LLM judge missed by writing specific free-text feedback, using the "doesn't fit" category when an issue genuinely doesn't slot into existing structured flags. The free-text, calibrated against expert text via LLM-similarity (see Section 7), is the signal that drives rubric evolution.

**Anti-fatigue rotation:** cohort members rotate across artifacts every 2–3 days. Same person on the same artifact for two weeks straight will drift toward leniency without noticing.

---

## 6. Expert Workflow

Two to three senior genealogists working 8 hours/week each (16–24 expert hours/week total). Their time breaks down approximately as:

- 4 hrs/week building and maintaining golden sets
- 6–8 hrs/week resolving cohort escalations
- 2 hrs/week spot-checking 10% of cohort verdicts to detect drift
- 1 hr/week rubric review (Section 8)
- 4 hrs/week making final iterate-or-ship calls per artifact
- ~3 hrs/week buffer for rubric refinement, training material updates, anything else

The calibration system itself takes 4–6 hours of expert time per week and is non-negotiable — without it, cohort verdicts aren't trustworthy and you might as well skip cohort review.

---

## 7. Calibration Systems

Calibration runs on three different signals separately because each has different mechanics: the binary verdict, the categorical flag, and the free-text feedback.

### Layer 1: Binary verdict and flag-category calibration (kappa-based)

**Onboarding gate.** Each cohort candidate independently produces a binary verdict and flag categorization on the same 50-trace expert-graded calibration set. Required to pass: 80% verdict agreement with expert + Cohen's kappa ≥ 0.5 on flag categories. Below threshold: more training and re-test on a fresh 50-trace set.

**Continuous golden seeding.** ~10% of every cohort batch is expert-graded traces inserted unannounced. Track each member's rolling verdict agreement and flag-category kappa over the trailing 50 golden traces. Drop below 75% verdict agreement or kappa 0.5 → pause, retrain on disagreements, re-certify.

**Critically, the golden set must include cases where the LLM judge got it wrong and the expert overrode.** Otherwise cohort members can game the metric by rubber-stamping the LLM. If a cohort member agrees with the LLM on those wrong-LLM goldens, they failed those traces.

**Inter-rater reliability.** ~20% of real traces get reviewed by two cohort members independently. Compute kappa between each pair weekly. Target kappa ≥ 0.5 between any two members. Disagreements escalate to expert; resolutions become new golden traces.

### Layer 2: Free-text feedback calibration (LLM-similarity-based)

Free-text doesn't have a built-in agreement metric, so we manufacture one.

**LLM-assisted semantic similarity** runs on every cohort feedback entry on golden traces. Both expert and cohort write feedback on the same trace; an LLM call takes both texts and judges three things: same root issue identified? similar severity? similar remediation? Output is a structured verdict with rationale. Aggregate per cohort member over rolling 50 golden traces. The metric to watch is "same root issue identified" — that's the one that matters.

**Worked-example onboarding** dramatically reduces noise. Before any cohort member writes real feedback, give them 20 expert-authored feedback samples on diverse traces, with annotations on why the expert focused on what they did. Show good and bad examples. Have them write feedback on 10 fresh traces and get line-by-line expert correction. Standardize on a feedback template: "What's wrong: ... Why it matters: ... What the agent should have done instead: ..."

**Expert weekly text-feedback spot review** (~30 min/week). Expert pulls a sample of 10–15 cohort feedback entries from the past week and reads them. Tracks per-member: what fraction of their feedback the expert validates as specific, accurate, and actionable. This is also the ground truth that calibrates the LLM-similarity judge itself.

### Layer 3: Discrepancy analysis (weekly expert ritual)

Expert pulls every disagreement between cohort and golden from the past week, looks for patterns, and updates two artifacts: rubric documentation (worked examples for the failure mode) and cohort training materials (added to next onboarding batch). This is the loop that makes the system learn — without it, the same blind spots get rediscovered forever.

### Layer 4: Vague-concern bucket (expert only)

Sometimes an expert just feels something is off and can't articulate it cleanly. Force-categorizing destroys the signal. Allow a "vague concern, can't articulate yet" flag separate from the novel-issue flag, with a short text field. **Scope this to experts only** — the cohort lacks the domain knowledge for their pre-articulable intuition to be reliable signal.

Calibration on vague concerns is **pattern-emergence over time**, not agreement rate:

- Track each expert's vague-concern flag rate (target middle band, flag outliers).
- Every 2–3 weeks, run an LLM-assisted clustering pass on accumulated vague concerns. Cluster-rich output means real pre-articulable signal — those clusters are candidate new rubric dimensions. Scattered, no-pattern output means it's mostly noise.
- Monthly retrospective: ask each expert to articulate their last 10 vague concerns now, with distance. If they can articulate ≥5, the bucket is doing what it's supposed to.
- When a new rubric dimension is added, look back at past 3 months of vague concerns. How many retrospectively map to the new dimension? High mapping rate validates the bucket is predictive.

---

## 8. Rubric Design and Evolution

### Base rubric (shared across all artifacts)

- **Correctness** — does the output do what was asked, with claims supported by sources?
- **Completeness** — did it cover everything the prompt or assertions required?

These re-anchor the Comparator any time it gets distracted by domain specifics. Drop or heavily downweight pure presentation dimensions (organization, clarity, polish) — for genealogy, a rough-but-rigorous output beats a polished-but-sloppy one.

### Per-skill-family extensions

4–6 domain dimensions per skill family. Reuse extensions across skills with similar output shape (one extension for citation-class skills, one for record-extraction-class skills, one for research-log-class skills) rather than per-skill snowflakes.

Example for record-extraction skills:

- Correctness (interpreted as: facts cited match the record; no fabricated details)
- Completeness (interpreted as: all extractable fields captured; no silent omissions)
- Citation discipline
- Evidence weighting (primary vs derivative; direct vs indirect)
- Identity resolution rigor
- Calibration of certainty

Six dimensions, two foundational and four domain-specific. Cap at 6–7 total. LLM judges given 15 weighted criteria produce noisier verdicts than ones given 5 well-chosen criteria.

### Promotion criteria for new dimensions

Add to rubric only when:

- 3+ recurring instances of the issue across different test cases.
- It's genuinely holistic (cross-cuts test cases, can't decompose into per-case pass/fail, requires reading the whole output to judge).
- You can articulate it as a rubric criterion with a worked example.

If it's checkable per test case, make it an **assertion** instead — the Grader is cheaper, more reliable, and easier to debug than a Comparator with 15 dimensions.

If you can't articulate it cleanly yet, **leave it as expert vague-concern** until the pattern emerges through clustering. Premature promotion of a vague feeling makes the Comparator noisier.

### Rubric gap handling

The rubric will have gaps. The system needs to surface them.

**Novel-issue category in escalation taxonomy** is the smoke detector. Track its usage rate per artifact: spiking means the rubric is missing something.

**Weekly rubric review** (~1 hour expert time) triages every novel-issue flag through this decision tree:

- Existing rubric covers this but cohort missed how → coaching, not a rubric change.
- Existing LLM judge prompt misses it even though the rubric dimension exists → prompt fix with worked examples.
- Real gap, recurring failure mode no current dimension addresses → candidate for new rubric dimension (subject to promotion criteria above).

When adding a new dimension at the cap: retire the dimension where the LLM judge's scores have the lowest variance across traces *and* the lowest expert override rate. That one isn't doing work.

### Versioning discipline

Rubric changes are schema migrations, not rolling improvements. Tag every trace with the rubric version it was scored under. If you want to compare iterations across a rubric change, re-score the older baseline under the new rubric on a sample of traces. Don't pretend scores are continuous across versions.

---

## 9. Four-Week Sequencing

### Week 1: Setup and calibration

- Spike a `claude_agent_sdk.query()` call loading existing skills via `setting_sources=["project"]` + `mcp_servers={...}`. Confirm Cowork-equivalent behavior on 5 representative queries.
- Stand up Promptfoo with `claude-agent-sdk` provider against same queries; confirm `response.metadata.skillCalls` populates.
- Build deterministic validators for all artifacts (this can run in parallel with everything else).
- Senior genealogist (priority focus this week, full hours): build golden sets for the 10 highest-priority artifacts, ~50 traces each.
- Cohort onboards: worked-example training, calibration test, certification.
- LLM judge rubric written and validated against expert calls on the golden set.
- Port Anthropic's `run_loop.py` / `run_eval.py` / `improve_description.py` adapted for both Skill and MCP tool detection.

**Threshold to advance:** Promptfoo green on 30 queries. All cohort members certified. Golden sets locked for top 10 artifacts. If golden-set construction slips, everything cascades — resist any temptation to start "real" review until the golden set is ready.

### Week 2: Top-priority artifacts iter-1

- Cohort begins verifying LLM-judge calls on artifacts 1–10 iter-1.
- Description optimization runs on artifacts 1–10 (automated, ~$25–50 per artifact, kicked off as batch).
- Body optimization iter-1 on artifacts 1–10 with cohort verification + expert escalation.
- Experts handle escalations, build golden sets for artifacts 11–20.
- Discrepancy analysis Friday afternoon.

### Week 3: Top-priority iter-2 + tier-2 iter-1

- Artifacts 1–10 iter-2 (cohort verifies improvements; pairwise Comparator on iter-2 vs iter-1).
- Artifacts 11–20 iter-1 (cohort verifies; description optimization in parallel).
- Experts handle escalations, finalize golden sets for artifacts 21–40.
- Rubric review Friday afternoon: triage novel-issue flags from past two weeks.

### Week 4: Tier-2 iter-2 + tier-3 iter-1

- Artifacts 11–20 iter-2.
- Artifacts 21–40 iter-1 (single iteration only this month).
- Experts make final iterate-or-ship calls on all artifacts.
- Final discrepancy analysis and rubric versioning.

This yields two iterations on top 20 artifacts and one iteration on bottom 20, with calibrated review throughout. Order artifacts by importance — Tier 1 skills (`gedcomx`, `research-file`, `research-log`, `record-extraction`, `assertion-classification`, `citation`) and the most-frequently-called MCP endpoints get the two iterations.

---

## 10. Cost Estimates

### Per-session runtime (during eval and during user research sessions)

Sonnet 4.6 with prompt caching enabled, three profiles:

| Session profile | Tool calls/hr | Input tokens | Output tokens | API cost/hr |
|---|---|---|---|---|
| Light | ~20 | ~300k (80% cached) | ~30k | ~$0.70 |
| Moderate | ~50 | ~1M (75% cached) | ~75k | ~$2.00 |
| Heavy | ~100+ | ~3M (70% cached) | ~150k | ~$5.50 |

Plus infrastructure: ~$0.05/hr per hardened Docker container.

### Optimization loop

- Description optimization: ~120 `claude -p` calls per iteration × 5 iterations = ~600 calls per artifact per pass. Per call ~30k input + 2k output with caching. **~$25–50 per artifact per full optimization run.**
- Body optimization: dominated by trace generation + LLM judge calls. Roughly 50 traces × 2 configurations × ($0.50 trace + $0.10 judge) = ~$60 per iteration per artifact.
- Total over the month for 40 artifacts × 1.5 average iterations: roughly **$3,000–5,000 in API spend**.

### Human time

- Cohort: 5 people × 30 hrs/week × 4 weeks = 600 hours total. At local rates, budget accordingly.
- Experts: 3 × 8 × 4 = 96 hours total.

### What moves these numbers most

1. **Prompt caching discipline** — keep system prompt + skill descriptions stable across the session and you save 80–90% on the largest token bucket. Lose cache hits and costs 3–5x.
2. **Tool-result truncation** — FamilySearch person details with full source lists can hit 5k+ tokens each. Truncate or summarize before returning to the model.
3. **Model routing** — most genealogy turns are Sonnet/Haiku-class work. Reserve Opus for ambiguous identity resolution.

---

## 11. Convergence and Stopping Criteria

### Per-artifact stopping rule

Stop iterating on an artifact when **both** conditions hold:

- Two consecutive iterations produce no statistically significant improvement in either LLM-judge dimensional scores or cohort verdict-agreement-with-LLM rate.
- Novel-issue flag rate has plateaued (cohort isn't surfacing new categories of failure).

If only the first triggers, you may be at a local optimum but missing a rubric gap. Run a rubric review before stopping.

### Per-rubric stopping rule

Stop adding rubric dimensions when:

- Cap of 6–7 dimensions reached and retiring the weakest doesn't improve discriminating power.
- New candidate dimensions consistently fail the 3-instances-across-different-test-cases threshold.

### Project-level stopping rule

Stop the harness when:

- All Tier 1 artifacts have converged per the per-artifact rule.
- Rubric versions have stabilized for ≥2 weeks.
- Cost-per-marginal-improvement has crossed a threshold you set up front.

### When to graduate from greedy hill-climb to GEPA

- Triggering accuracy plateaus below 0.85 across most skills with 5 iterations of greedy hill-climb.
- ≥50 labeled traces per skill accumulated as feedback corpus.
- Multiple coupled artifacts (skill + MCP tool descriptions that interact) where joint optimization would beat per-artifact greedy.

---

## 12. Risks and Mitigations

**Skills behavior on Linux Agent SDK has known bugs** (issue #268: hardcoded macOS paths in skill discovery). Verify the container image resolves `~/.claude/skills/` correctly before trusting any results.

**`run_loop.py` will silently use `ANTHROPIC_API_KEY`** if it's set, bypassing Claude Code subscription auth and racking up charges. Lock down env-var passing in the container entrypoint.

**`allowed-tools` SKILL.md frontmatter is silently ignored in the SDK** (Cowork honors it, the SDK doesn't). Audit existing skills for this assumption; enforce tool gating via `allowedTools` + `permissionMode: "dontAsk"`.

**Cohort drift across the month.** Calibration system catches this, but the rotation rule (cohort members move across artifacts every 2–3 days) is the primary defense. Don't let any single member sit on one artifact for two weeks.

**Expert disagreement on golden traces.** Genealogy has legitimate methodological splits. Process: independent grading, then reconciliation meeting, document either house standard or split-acceptable cases. Don't average expert scores or default to senior expert; that creates fragile golden traces.

**Rubric drift through gradual addition without retirement.** Cap is enforced; weekly rubric review tracks which dimensions are doing work. Retire dimensions where the LLM judge's variance is low and expert overrides are rare.

**Anti-gaming on golden traces.** Cohort can game by always agreeing with the LLM judge. Counter: golden set must include known-bad LLM verdicts. If cohort agreed with the LLM there, they failed.

**Week 1 slippage.** If golden-set construction doesn't complete by end of Week 1, every subsequent week cascades. Senior genealogist treats Week 1 as their only priority. No "real" review begins until golden sets are locked.

---

## 13. Out of Scope

This plan deliberately does not cover:

- Production deployment to non-Cowork users (FamilySearch product offering). That migration to Anthropic Managed Agents or a Firecracker-based fallback is the Stage 3 follow-on, not this month's work.
- Joint optimization across coupled artifacts via GEPA. Greedy hill-climb is the right starting point; GEPA waits until ≥50 labeled traces per artifact and clear evidence of coupling.
- Per-VM-per-session sandboxing. Containers are correct for the eval phase; VMs are right for production multi-tenant.
- Automated body-optimizer for SKILL.md prose. Anthropic's pattern is human-in-the-loop driven by feedback.json, and our cohort layer extends that — not replaces it.
- Rubric generation on the fly per call (AdaRubric-style). Worth experimenting with later once we have a corpus of comparisons under static rubrics to validate against. Not Week 1–4 work.
- Custom Grader or Comparator subagent prompts beyond the rubric extension. Anthropic's defaults are good; what we customize is what they look at, not how they think.

---

## 14. References for the Underlying Methodology

The skill-creator workflow itself is documented in `anthropics/skills/skills/skill-creator/` on GitHub, including the `agents/grader.md`, `agents/comparator.md`, and `agents/analyzer.md` subagent prompts. Anthropic's official Agent Skills documentation lives at `platform.claude.com/docs/en/agents-and-tools/agent-skills`. Third-party writeups by mager.co, tessl.io, smartscope.blog, and several dev.to authors cover the user experience of running skill-creator and are consistent with the official docs.

The cohort layer, calibration system, rubric-gap handling, and free-text similarity calibration are not documented as a unified pattern in any single source. They synthesize from: standard ML annotation practice (Argilla, Label Studio, Surge AI documentation on annotation quality control); inter-rater reliability literature (Cohen's kappa methodology); qualitative research methodology (constant comparison, theoretical sampling); and recent agent-eval research (AdaRubric arXiv:2603.21362 for adaptive rubrics; LH-Bench arXiv:2603.22744 for expert-authored rubrics; GEPA arXiv:2507.19457 for reflective prompt evolution).

For deeper grounding on individual components: Snow et al. "Cheap and Fast — But is it Good?" (EMNLP 2008) for foundational work on calibrating non-expert annotators; the Inspect AI and Promptfoo documentation for the eval substrate; the DSPy GEPA documentation including the MCP adapter for the auto-optimization angle.
