# Gated skill-improvement loop (components E, A, B)

*A thin slice that closes the smallest honest version of a SkillOpt-style
optimizer around the machinery we already have: **E** mine a unit test from a
real failure — typically one a human hits while doing research in Cowork — **B**
propose a small bounded edit, **A** measure it against the incumbent on held-out
tests — before a human adopts. (E/A/B are component names, not a running order;
see §3.)*

**Status:** draft, for team review (genealogist + developer + designer).
**Date:** 2026-07-16. **Branch:** `worktree-skillopt-eab-plan`.
**Review history:** v1 was put through an adversarial multi-lens review
(facts / feasibility / doctrine / methodology / completeness) with each finding
verified against the code; 33 confirmed findings are folded into this draft.
**Implementation status:** components **A** (the gate — `eval/harness/skill_gate.py`
+ `make gate-skill` + `tests/unit/test_skill_gate.py`) and **B** (the improver's
≤3-edit budget) **landed in PR 1**. Component **E** ships in **PR 2** as
**`mine-unit-test`** (`.claude/skills/mine-unit-test/`) — a sibling of
`draft-unit-test`, not a mode on it (§8).
**Related:** [`docs/skill-lifecycle.md`](../skill-lifecycle.md) (the loop this
plugs into), the vendored description optimizer (`eval/triggering/`), and
[microsoft/SkillOpt](https://github.com/microsoft/SkillOpt) (the inspiration).

---

## 1. Summary

We already run most of a SkillOpt loop by hand: the `skill-improver` agent is
the *reflect* stage, per-skill `rubric.md` + the LLM judge is the *loss*, the
`holdout` toggle is the *validation split*, and human `.ann` corrections are the
*ground-truth reward*. We even run a **fully automated** SkillOpt instance on one
axis already — `eval/triggering/run_loop` tunes each skill's **description**
against a held-out trigger set (`make optimize-skill`).

The one mechanism the **body** loop is missing is an **automated measurement of a
candidate SKILL.md against the incumbent on held-out tests** — nothing today runs
both and surfaces "did the named failure get fixed, and did anything regress?"
The senior does it by eye at release time.

This slice adds that measurement (**A**), the fuel it needs (**E** — a unit test
mined from a real failure, typically one a human notices during live Cowork
research), and a discipline that keeps each round small (**B** — an edit budget on
the improver). It is deliberately a **measurement-and-surfacing tool,
human-adopted, not an automated accept/reject oracle**: given an n=1
non-deterministic judge, the gate reports evidence and flags; a person decides
and releases (§5, §6.3).

**Where the fuel really comes from.** In practice teams rarely see a *recorded*
e2e failure — they fix the skill before the PR, so a harness miss is seldom left
behind. The real trigger is a **human noticing something wrong mid-research** in a
Cowork project (seeded with `make e2e-project`). That path is *better* fuel than a
recorded miss: the seeded project directory **is** the persisted research state,
so reconstructing the unit-test scenario is easy (it mostly dissolves the hardest
gap in §8.2), and the human already holds the "what should have happened" the
moment they notice it. The recorded-runlog path (`eval/runlogs/e2e/`) still works
as a secondary source. The team-facing, ordered how-to for this lives in
[`docs/e2e-testing-guide.md`](../e2e-testing-guide.md) ("From a noticed issue to a
fix"); this doc is the design behind it.

## 2. Why now / what we're borrowing

SkillOpt's crown jewel is the **validation gate with strict-improvement
acceptance** — a candidate ships only when it *measurably* beats the incumbent on
a held-out split. That works cheaply in the paper because its benchmarks
(SearchQA exact-match, SpreadsheetBench cell-compare) have a hard, automatable
reward. **Our reward is a fallible LLM judge over a multi-skill pipeline** — which
is exactly why we can't port the paper wholesale and why the human stays in the
loop. §5 makes that constraint first-class.

| SkillOpt mechanism | This slice |
|---|---|
| Validation gate (measure candidate vs incumbent on held-out) | **A** — `make gate-skill` |
| Edit budget / "learning rate" (cap edits per step) | **B** — improver ≤ 3 edits/round |
| Mine tasks from real sessions (SkillOpt-Sleep `mine`) | **E** — mine a unit test from a real noticed failure (Cowork-noticed or recorded) |
| Reflect → bounded edit → measure | already have (`skill-improver`) + A |
| Rejected-edit buffer, slow/meta memory, LR scheduler | **out of scope** (§4) |
| Automated *acceptance/adoption* | **out of scope** — the gate advises; the human adopts (§5) |

## 3. The loop

E, A, and B are **component names** (mine / gate / edit-budget). The **runtime
order is E → B → A** (mine, then the bounded edit, then the gate); the recommended
**build order is A → B → E** (§9). Here is the runtime flow:

*Precondition (checked once before piloting a skill, not a per-round stage):
rubric-critic has recently audited the skill's rubric — see §5 and §10.*

```
 issue noticed ─► classify ─► E: mine a unit ─► RUN it (make eval-skill) + ANNOTATE
  in Cowork       (lane gate:   test; localize    the failing dimension in the CRUD
  research        skill? tool?   to a sub-skill,   UI with a Did/Should/Gap comment
  (§8.0)          rubric? §8.0)  generalize)       (the human already has it) ── this
                                     │              is what lets the improver fire
                                     ▼
                        improver proposes ≤3 ranked edits (B)  ── names the
                                   │                              failing dimension
                                   ▼
                        human applies the edits to the working-tree SKILL.md
                                   │
                                   ▼
                        A: make gate-skill SKILL=x TEST=ut_<mined>
                                   │   runs the candidate (working tree) on {mined
                                   ▼   test} ∪ {holdout}; baseline = your step-4 run
                        comparison table ─► human reviews, judges by
                                   │        generalization-by-inspection,
                                   ▼        adopts; re-runs the Cowork
                             (sanity) e2e project to confirm ─► PR (never auto)
```

**Classify before you mine (the lane gate).** Not every noticed issue is a
skill-body problem. A tool bug (the sub-skill called the right tool and it
returned wrong data) is an **MCP PR + vitest**; a rubric/eval bug is a **rubric or
judge-prompt** fix; only a genuine craft/doctrine gap becomes a unit test and a
SKILL.md edit (§8.0). Skipping this is the documented anti-pattern — patching a
780-line prompt for a defect that lives in a tool or the rubric.

**The run + annotate stage is mandatory, not optional.** A freshly-mined test is
unrun and unannotated, and the improver *by design* proposes nothing from it: its
bar for a body edit is "recurs across ≥2 non-hold-out tests **OR** one human
correction with a specific comment," and it needs an *active, annotated* run-log
to act at all (`skill-lifecycle.md`: *"Against a stale or unannotated run-log it
proposes nothing"*). Because **E mines exactly one test**, the ≥2 branch cannot
fire — so the single-test path depends entirely on a human **Did/Should/Gap**
correction on the mined test's failing dimension. Skip the run+annotate stage and
the pilot dead-ends at "improver proposes nothing."

**Credit assignment is the hinge.** An e2e miss is a *whole-pipeline* failure; you
cannot backprop one recall score through a ~26-skill pipeline. So e2e is the
**reward oracle + attribution step**, not the optimization target.
`interpret-e2e-result` localizes the miss to a stage; **E** turns that into a
per-skill unit test; optimization then happens per-skill under **A**. This is
SkillOpt-Sleep's `harvest → mine → consolidate` shape.

## 4. Scope

**In scope:** the three components below, exercised end-to-end on **one pilot
skill**.

**Explicitly out of scope** (each a possible follow-up; deferred items go in
`docs/TODOs.md` per house convention, not just this §):

- Automated acceptance / auto-merge. The gate advises; the human adopts (§5).
- Joint optimization across the ~26-skill pipeline. We optimize one skill at a time.
- LR scheduler, warm-up, multi-epoch, rejected-edit buffer, cross-skill meta memory.
- A machine-appliable diff format from the improver. The human applies the ≤3
  edits by hand (they're reviewing them anyway) — see §7 and the §6.2 seam.
- A structured `skills_invoked` list on the e2e run-log (would mechanize E's
  localization; §8.2). Deferred.
- Wiring the gate's verdict into the CRUD-UI review/release trail (§6.3, §11).

## 5. The governing constraint: the reward is an LLM judge

This is the reason the design looks the way it does, so it comes before the
components.

The unit judge is **`claude-haiku-4-5-20251001`** and the SDK exposes **no
`temperature`** field (`eval/CLAUDE.md`: *"Variance leaks into single-run
outcomes"*). `runs_per_test` is policy-pinned to **1**. Consequences:

1. **The gate measures and surfaces; it does not automate acceptance.** A single
   judge sample per dimension is noisy. `skill-lifecycle.md` §6 is explicit: gate
   on *"did the dimension that was failing now pass, with nothing obvious
   regressing?"* — a human judgment, *"not a statistical bake-off,"* with
   generalization-by-inspection (not the holdout) as *"the primary overfitting
   guard at our test counts."* The accept rule (§6.3) honors that: it reports a
   coarse signal, and the human certifies.

2. **The incumbent baseline is the step-4 run, and it's human ground truth.** The
   **incumbent** scores come from the skill's most recent pre-edit run-log — the
   `make eval-skill` run the team did at **step 4** — with human `.ann` corrections
   overlaid (the genealogist's corrected score wins over the judge's). The
   **candidate** is the working tree with the edits applied, run fresh. **Only the
   candidate is re-run**; the incumbent is read from disk. This works because at
   step 4 the skill is still the incumbent and the mined test is already in the
   suite (added at step 3), so that run-log *is* the pre-edit baseline. No `git`, no
   snapshot reconstruction, one side to run — see §6.1.

3. **The old ground-truth asymmetry is resolved, not papered over.** Because the
   baseline is the *annotated* step-4 run, **both** the mined and the holdout
   dimensions carry the genealogist's corrected score on the incumbent side — there
   is no "the mined dimension has no history" hole (step 4 ran and annotated it).
   The remaining caveat is mundane: the **candidate** side is a single fresh
   judge draw, so a 1-point wobble is noise. That is exactly why the gate credits a
   fix only on a *pass* (score 3, §6.3) and leaves the call to the human.

4. **Never auto-adopt, and audit the rubric first.** The gate emits an advisory
   report to a scratch location; a person applies and releases. And **rubric-critic
   must have recently audited the pilot skill's rubric** — since the named
   dimension carries the whole "fix landed" signal, a non-discriminating named
   dimension makes the gate meaningless (`rubric-critic.md`: *"A skill-improver
   that optimizes toward a weak rubric hill-climbs noise."*). This is a DoD
   precondition (§10).

5. **Trust the judge for throughput, but bounded.** Teams reasonably let the
   (good-in-aggregate) judge score the improvement loop rather than annotating
   every iteration. That is fine **provided four guards hold**, because the judge's
   failure mode is *per-dimension, per-skill*: (a) **rubric-critic has cleared the
   skill's dimensions** (guard 4); (b) a fix must **reproduce on the incumbent then
   pass on the candidate** (§6.3), never be trusted on a lone candidate-side pass;
   (c) the improvement loop is **iteration-capped** — an unbounded loop-until-the-
   judge-is-happy reward-hacks the judge; (d) a **holdout the improver never sees**
   backstops generalization. The one thing never delegated to the judge is *what
   "fixed" means for the mined issue* — that is the human's Did/Should/Gap
   correction (§3, §8.4). The full-suite human annotation (the team's step 6 —
   "annotate the suite") then catches any dimension where the judge and a
   genealogist would disagree.

## 6. Component A — the gate (`make gate-skill`)

The highest-value, most self-contained piece. It formalizes the senior's "release
when the grades show a real improvement" into a reproducible measurement **without
removing the human.** It is independently useful even before E exists: hand-apply
any edit and gate it.

### 6.1 What it does

```
make gate-skill SKILL=<x> TEST=ut_<mined>
```

1. Resolves the **gate test set** = `{TEST}` (the mined, non-holdout motivating
   test — named explicitly because "motivating" is not a markable field) ∪
   `{the skill's holdout tests}` (ids read from `eval/tests/unit/<x>/*.json` where
   `test.holdout == true`).
2. Runs that set against the **candidate** (your working-tree SKILL.md, edits
   applied) via `run_one_test`, mock-backed — **one side, no tree copies, no `git`**.
3. Reads the **incumbent** scores for the same tests from the skill's most recent
   run-log (the step-4 pre-edit run), overlaying human `.ann` corrections, and joins
   `aggregated_dimensions[]` by `(source, name)`.
4. Prints a per-dimension comparison table + a coarse advisory signal (§6.3), and
   writes a `gate-report.md` (temp file, printed to stdout). It **errors clearly** if
   the skill has no baseline run-log or that run-log lacks the mined test — telling
   the user to run `make eval-skill SKILL=<x>` (step 4) first.

### 6.2 Mechanics (what's reused vs new)

The scoring machinery is entirely reused and **mock-backed** (every tool served
from `eval/fixtures/mcp/`, except the `LIVE_TOOLS` that read the workspace), which
is what makes it **drift-free and cheap** — the only cost is two LLM calls per test,
no live FamilySearch.

**Drive `run_one_test` directly — do not extend the `run_tests.py` CLI.** A
`--skills-dir`/`--holdout` CLI approach can't express the `{motivating test} ∪
{holdout}` union (`--test`/`--skill` are mutually exclusive), and a
holdout-filtered `--skill` run would be **mis-classified as releasable** and mint a
spurious `v{N}_<ts>.json`. `skill_gate.py` instead imports
`harness.orchestrator.run_one_test` and calls it per spec on the **working-tree
skill** (default `OrchestratorPaths`): an explicit spec list, never the releasable
code path, and it **writes no run-log**.

The **candidate-diff seam** (the E→B→A hand-off): the improver is report-only and
emits prose/diff *blocks*, not a `git apply`-able patch. So **the human applies the
≤3 edits to the working-tree SKILL.md** (they are reviewing them anyway) and runs
`make gate-skill`; the gate scores that working tree (candidate) and compares it to
the **step-4 baseline run-log** (incumbent). No new diff format, and the human
stays in the loop by construction.

Genuinely new pieces, all small:

| Piece | Where | Note |
|---|---|---|
| `skill_gate.py` driver | new, `eval/harness/` | Builds the `{TEST} ∪ {holdout}` spec list; runs it on the working-tree candidate via `run_one_test` (mock-backed); reads the incumbent scores from the skill's latest run-log (with `.ann` overlay); compares `aggregated_dimensions[]` and prints the table + signal + `gate-report.md`. Plain JSON-comparison — **no `git`/`tarfile`/tree-copy** (an earlier design had all three; the step-4-baseline model removed them). |
| `gate-skill` target | `Makefile`, beside `eval-skill` (253) / `optimize-skill` (279) | `make gate-skill SKILL=<x> TEST=<id> [DIMENSION=…]`; `$(ENGINE_BUILD)` prereq like `eval-skill`. A prose-only SKILL.md edit doesn't touch the compiled engine, so the harness's stale-build gate stays green (`_check_mcp_build_fresh` compares only `src/*.ts` vs `build/*.js` mtimes). |

**Safety.** The gate writes **no run-logs** and never mutates the working tree — it
runs the candidate against the real working-tree skill and reads only the committed
baseline run-log. There is nothing to isolate, so it is safe to run while other
worktrees are active.

### 6.3 The signal — measurement, not an automated verdict

Given n=1 and a non-deterministic judge, the gate **reports evidence and a coarse
signal; the human decides.** It does not emit a binary accept/reject that a merge
can key on.

**Primary signal — did the named fix land?**
- **Reproduction precondition:** the motivating failure must reproduce on the
  **incumbent (your step-4 baseline)** — the named dimension scored 1 or 2 there.
  If it already scored 3 at step 4, the gate reports **INCONCLUSIVE** ("failure did
  not reproduce — likely jitter or a too-weak test; re-mine or drop it"). Never
  credit a fix for a pass the incumbent already achieves.
- **Fix observed:** candidate named dimension = 3 while the baseline scored < 3.

**Secondary signal — no-regression (a weak sanity check, not a hard gate).**
Holdout dimensions are compared and any candidate-below-baseline drop is **flagged
for the human to eyeball**, never auto-rejected. Roughly 2–3 holdout tests × (3
base + up to 5 rubric) ≈ 12–24 dimensions are compared, and the candidate side is a
single fresh judge draw, so *some* one-point wobble is expected (a
multiple-comparisons problem); a lone 1-point drop is presumed noise unless it
reproduces or is explicable. Per `skill-lifecycle.md` §5, the **primary**
overfitting guard remains **generalization-by-inspection** — "does this edit read
as a general principle?" — with the holdout an explicitly *secondary, weak* check.

**Advisory recommendation (two states):**
- **LOOKS GOOD** — named fix landed (reproduced on the step-4 baseline, resolved on
  the candidate) and no unexplained holdout drop.
- **NEEDS YOUR EYES** — named fix didn't land or didn't reproduce, or a holdout
  dimension dropped that you should judge.

**Anti-hill-climb guard.** The improver never sees the holdout, but the *human*
does — and the natural "apply → gate → see holdout drop → revise → re-gate → watch
it recover" loop is textbook hill-climbing the holdout into a training signal. So:
**revise-and-re-gate at most once per round.** If a fix needs more revision than
that, stop tuning to the holdout number, decide on generalization-by-inspection,
and **rotate the holdout set** before the next round.

### 6.4 Cost, concurrency, runtime

- Per round = `{mined (1)} + {holdout (2–3)}` ≈ **3–4 candidate runs** (one side —
  the incumbent is read from the step-4 run-log, not re-run). At ~2–3 min/test
  that's **~8–12 min, ~$0.3–0.8/round** — half the old two-sided cost.
- **One process.** The candidate tests run sequentially through the harness in a
  single invocation. `eval/CLAUDE.md` + `skill-improver.md` are explicit that
  launching two harness processes at once fights for memory and SIGKILLs — so don't
  run a gate alongside a separate `make eval-skill`.

### 6.5 Precondition: holdout tests must exist

**The gate's no-regression check is inert for a skill without holdout tests.**
There are only **9 holdout tests across 4 skills** today (citation 2,
search-external-sites 2, search-images 3, validate-schema 2) of **343** total. So
either the pilot is one of those 4, or Phase 0 designates 2–3 holdouts for it
first. Two gotchas: (a) marking a test holdout is a *grading-relevant field*, so it
flips the skill's active run-log inactive — so mark holdouts **before** the step-4
`make eval-skill` run that becomes the baseline; (b) none of the 4 holdout skills
currently has a *released* `v{N}.json` — only candidate `v{N}_<ts>.json`. The design
doesn't depend on a release: the incumbent baseline is the **most recent run-log**
(released or candidate), and the `.ann` overlay uses its corrections.

## 7. Component B — the edit budget

A prose-only constraint on `.claude/agents/skill-improver.md`. Today §5 ("Cluster
and propose") and the "Proposed edits" report block have **no numeric cap** — the
`≥2-tests-or-one-comment` rule filters *which* clusters qualify, not *how many*
edits emit.

**The edit:** add a hard rule — *"Propose at most **3** ranked edits per round,
highest-impact first. If more qualify, list the rest under 'Deferred to next
round' and stop."* Placed in "Hard rules" so it reads as a contract, and surfaced
in the report block.

Small rounds are reviewable and **attributable** — when the gate moves you know
which edit moved it — and this matches existing doctrine ("subtract too; net length
flat-or-down"). It is **advisory** (the agent is report-only; nothing parses its
output), so **A is the real backstop**: a bloated round simply fails to show a
clean, attributable fix.

## 8. Component E — mining a unit test from a noticed failure

The fuel — the hard cases `skill-lifecycle.md` begs for, drawn from real research
rather than synthetic happy-paths. E ships as **`mine-unit-test`**
(`.claude/skills/mine-unit-test/`), a **sibling** of `draft-unit-test` (which
scaffolds from a **feedback case**). Same output format — anchored in
`unit-test-spec.md` — but a different input: the **research state where the failure
surfaced**. (A sibling, not a mode on `draft-unit-test`, keeps that
feedback-case-coupled skill and its triggering untouched.)

### 8.0 Step 0 — classify before mining (the lane gate)

**Before generating any unit test, classify the noticed issue** — because the
lane rule's most emphatic lane (tooling defect) has *no* cause in the e2e
taxonomy, so a tool bug otherwise sails straight into a prose edit (§8.3). Using
the project's `results/` sidecar files (the real tool responses) and the
transcript:

- **Tool defect** — the sub-skill called the right tool with the right args but
  the tool returned wrong/missing data, or rejected a valid payload → **MCP PR +
  vitest**, not a unit test.
- **Eval/rubric defect** — the skill did the right thing and a stale
  fixture/rubric would ding it → **rubric or judge-prompt** fix.
- **Craft gap / core doctrine** — the skill's prose genuinely steered the model
  wrong → **proceed to mine a unit test** (this component).

Only the third lane continues into §8.1. This is `skill-lifecycle.md` §5's lane
rule, applied at the moment of noticing.

### 8.1 What it does

`mine-unit-test` (`.claude/skills/mine-unit-test/`). Its **primary
input is the live Cowork research project** where the human noticed the issue —
the `make e2e-project` working directory (`research.json` + `tree.gedcomx.json` +
`results/`). That directory **is** the persisted state, so the scenario is largely
already built. The human's articulation of the issue supplies the
`agent_should_have` / `agent_did` that a feedback case would carry. Inputs:

- The Cowork project dir (research state at the point of failure) — the scenario
  source. *(Secondary: a recorded `eval/runlogs/e2e/<slug>/` run —
  `run-<ts>.final-tree.gedcomx.json`, `…final-research.json`, full tool responses
  in `run-<ts>.session.jsonl`; and `eval/tests/e2e/<slug>/expected-findings.json`
  where the miss is a `required:true` finding absent from the final tree.)*
- The human's noticed-issue description (or, on the recorded path,
  `interpret-e2e-result`'s attribution) — **which sub-skill owns it**.

Outputs land in the **same sinks** `draft-unit-test` writes
(`eval/tests/unit/<skill>/<slug>.json`, `eval/fixtures/scenarios/<slug>/`,
`eval/fixtures/mcp/<name>.json`, all `_draft`). **Then the mandatory run+annotate
stage** (§3): run the mined test, and annotate its failing dimension with the
Did/Should/Gap comment the human already holds — without it the improver proposes
nothing. (Also fixed in this PR: `draft-unit-test`'s stale `$REPO/plugin/skills/`
→ `packages/engine/plugin/skills/` path.)

### 8.2 The three hard gaps (why E is guided authoring, not a generator)

The readers converged on three places E cannot be fully mechanized:

1. **Localization.** The e2e run-log has **no structured `skills_invoked` list**;
   attributing a missed finding to *one* sub-skill means a human reading the
   transcript's `Skill` blocks, guided by `interpret-e2e-result`. (A structured
   field would mechanize this — deferred, §4.)
2. **Mid-flow state.** A unit test needs the state the sub-skill saw **mid-flow**;
   the e2e artifacts capture **end** state. Reconstructing the minimal scenario is
   the single hardest hand-authored step.
3. **Fixture fidelity.** The unit test must be mock-backed, but the failure came
   from **live** FamilySearch. Tool responses must be trimmed into
   `eval/fixtures/mcp/` entries with correct `args` predicates — the step
   `draft-unit-test` itself flags as "most often wrong."

**The human-noticed Cowork path shrinks gaps 1 and 2.** When a person hits the
issue live, they already know which sub-skill was running, so localization (gap 1)
is mostly given; and the seeded project directory *is* the state the sub-skill
saw, so scenario reconstruction (gap 2) is a copy, not an archaeology dig. Gap 3
(fixture fidelity) remains the real manual step — but the project's `results/`
sidecar files hold the actual tool responses to trim from. This is why §2 calls
the human-noticed path better fuel than a recorded miss.

### 8.3 Finer routing among skill-owned causes

Step 0 (§8.0) already diverts tool and eval/rubric defects. On the **recorded-
runlog path**, `interpret-e2e-result`'s cause taxonomy then splits the remaining
(skill-owned) failures — but note its taxonomy has **no tooling-defect cause**, so
a tool bug reads as "sub-skill regression"; that is exactly why the §8.0 lane gate
runs *first*. Among the causes:

- **agent reasoning regression** and **sub-skill regression** (tool already ruled
  out by §8.0) → mine a unit test.
- **`/research` skill regression** = "skipped a GPS step **or** picked the wrong
  sub-skill." **Split it:** "skipped a GPS step" is an orchestrator-body / core-
  doctrine issue (lane 4) — the description optimizer *cannot* fix it (it "tunes
  the description only … never runs the skill"); route it to a `research`-body edit.
  Only "picked the wrong sub-skill" (a triggering miss) → the **description
  optimizer** (`make optimize-skill`).
- **FamilySearch data drift** / **single-run jitter** → **discard** (log it). A
  first-run "evidence not recoverable" → a **fixture** bug, not a skill test.

This routing *applies* the lane rule to e2e; it isn't a new one.

### 8.4 Training vs. holdout: the pairing rule

The governing caveat says "keep holdout tests the improver never sees" — but the
improver also needs *non-holdout* evidence to form an edit. So:

- The **mined regression test is non-holdout** — it is the evidence (via its human
  Did/Should/Gap correction, §3), and the "named failing dimension" the gate
  checks for a fix.
- The **holdout set is separate** — 2–3 diverse, stable generalization checks the
  gate uses for the weak no-regression signal. If the pilot skill has none, Phase 0
  designates them before gating (§6.5).

**One miss is one data point.** The improver's bar (≥2 tests **or** one human
correction) means a single mined test licenses an edit *only through its human
correction* — and CLAUDE.md's own rule is "two near-duplicates is the signal … one
isn't." So E must **generalize** the miss into a skill-level behavior (the test
asks the *question*, it is not the *answer key*), and the human correction must name
a genuine prose gap, not a case-patch. If the miss looks like a one-off, log it and
wait for a second occurrence rather than manufacture a single-case edit.

## 9. Build sequence: A → B → E (inverts the runtime order)

The runtime order is **E → B → A** (§3). We recommend **building** it in reverse.
The one real trade-off is loop-order vs. risk-order, and risk-order wins:

- **A first.** Most self-contained, independently valuable (it gates *any*
  hand-applied edit), and it de-risks everything downstream. Validate it on an
  existing holdout-bearing skill with a trivial known-good edit before any mining
  exists.
- **B alongside A.** A five-line prose edit; ship it in A's PR so the first real
  round already sees bounded edits.
- **E last.** Heaviest and most manual (§8.2), and its output is worthless until A
  can consume it.

Building E first would yield mined tests with nothing to gate them *and* still
require bootstrapping holdouts before A could run — strictly more work, later
payoff.

## 10. Definition of Done

**A (gate):**
- `make gate-skill SKILL=<x> TEST=<id> [DIMENSION=…]` runs `{TEST} ∪ {holdout}` on
  the working-tree **candidate** (one side, mock-backed), reads the **incumbent**
  scores from the skill's most recent run-log (the step-4 run, human `.ann`
  overlaid), and prints a per-dimension comparison + a LOOKS-GOOD / NEEDS-YOUR-EYES
  / INCONCLUSIVE signal + a `gate-report.md`.
- Implemented as `eval/harness/skill_gate.py` (plain JSON comparison — no `git`,
  `tarfile`, or tree-copy) driving `run_one_test`; **no run-log is ever written**;
  safe under concurrent sibling worktrees. Unit-tested at
  `tests/unit/test_skill_gate.py`.
- The signal requires the failure to **reproduce on the step-4 baseline** before
  crediting a fix.
- **Precondition, checked before piloting:** rubric-critic has recently audited the
  pilot skill's rubric, and the skill has ≥2 holdout tests.
- Demonstrated: a hand-applied known-good edit on a holdout-bearing skill yields
  LOOKS GOOD; a deliberately-bad edit yields NEEDS YOUR EYES. (SkillOpt's own
  gate-safety test.)

**B (edit budget):**
- `skill-improver.md` caps proposals at ≤3 ranked edits/round with a "Deferred to
  next round" overflow; verified on one real run-log.

**E (mine):**
- `mine-unit-test` produces a `_draft`, mock-backed, **generalized** unit test +
  scenario + fixtures for one real noticed failure (Cowork-noticed or recorded),
  correctly localized (human-given on the Cowork path, or via `interpret-e2e-result`
  on the recorded path), with the lane-1 tool-defect check applied and non-body
  causes routed away (§8.3). The `draft-unit-test` stale `plugin/skills/` path is
  fixed.

**End-to-end pilot (the acceptance test for the whole idea):** on **one** pilot
skill = intersection of `{has ≥2 holdout tests}` and `{has a recent, cleanly-
attributable failure — noticed in Cowork research or recorded — that survives the
§8.0 lane gate}` (bootstrap holdouts in Phase 0 if empty): classify (§8.0) → mine
the failure → **run the mined test and annotate its failing dimension
(Did/Should/Gap)** → improver proposes ≤3 edits → human applies → `make gate-skill`
shows the named dimension reproduced on the incumbent and reached pass on the
candidate with no unexplained holdout regression → human adopts → re-run the Cowork
e2e project to confirm the issue is gone. One clean turn of the crank, end to end,
on real data.

## 11. Open decisions for the team

Most design questions are resolved above; these want a human call:

1. **Pilot skill.** Which of citation / search-external-sites / search-images /
   validate-schema has a recent, cleanly-attributable failure (noticed in Cowork or
   recorded) that survives the §8.0 lane gate? If none, which skill do we bootstrap
   holdouts for?
2. **Gate-report's home.** For the slice, the verdict is a printed table +
   `gate-report.md` in a scratch dir. Every other human-judgment step (annotate,
   compare, release) lives in the CRUD UI. Do we wire the gate verdict into that
   review trail now, or keep it terminal-only and defer the UI integration?
3. **Selection implementation.** `skill_gate.py` drives `run_one_test` directly with an
   explicit spec list (recommended — avoids the releasability/union pitfalls). Any
   reason to instead invest in a reusable `--holdout` selector on `run_tests.py`
   for other callers? (YAGNI says no until a second caller appears.)
4. **`skills_invoked` on the e2e run-log.** Build the structured field now to
   mechanize E's localization, or keep localization human-guided and defer?
   (Recommendation: defer.)

## Appendix — verified anchor points

All confirmed against the tree on `worktree-skillopt-eab-plan`:

- **Makefile:** `eval-skill` 253–270 (`cd eval/harness && uv run python
  run_tests.py --skill $(SKILL) …`, prereq `$(ENGINE_BUILD)`); `optimize-skill`
  279–292; `ENGINE_BUILD := $(ENGINE_DIR)/build/index.js`.
- **`run_tests.py`:** flags `--test / --skill / --tag / --tests-dir /
  --runlogs-root / --max-cost-usd (50) / --max-wall-clock-seconds (14400) /
  --concurrency`. **No** `--skills-dir`, `--holdout`, `--judge-model`. `--test`/
  `--skill` are a mutually-exclusive group; `is_releasable_invocation = mode ==
  "skill" and not has_tag_filter` (so a holdout-filtered `--skill` run would be
  mis-classified releasable — a reason `skill_gate.py` drives `run_one_test` directly).
- **`orchestrator.py`:** `run_one_test(spec, *, auth, paths, model, judge_model,
  timestamp)` returns a per-test entry (with
  `outcome_summary.aggregated_dimensions[]`) and **writes no run-log** — the gate
  calls it with default `OrchestratorPaths` (the working-tree skill) and reads the
  returned dimensions.
- **`workspace.build_workspace`:** copies **every** skill subdir into a fresh
  per-test tempdir workspace (cleaned up after) — the run leaves no artifacts.
- **`loader.py:93`:** `runs_per_test=int(raw.get("runs_per_test", 1))`; `holdout`
  is **not** parsed into `TestSpec` — survives only as `spec.raw['test']['holdout']`
  (so `skill_gate.py` reads it from the test JSON).
- **Judge:** unit `DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"` (e2e judge is
  `claude-opus-4-8`); dimension = `{source: base|rubric, name, score: 1|2|3|null,
  rationale}`; base dims `Correctness, Completeness, Tool Arguments` (only Tool
  Arguments nullable); **no `temperature`** set anywhere in `eval/harness/harness/`.
- **`runlog.aggregate_dimensions`:** modal across runs → `outcome_summary.
  aggregated_dimensions[]`; with `runs_per_test=1`, aggregated == the single run.
- **`versioning.py`:** released `v{N}.json`, candidate `v{N}_{ts}.json`, scratch
  `scratch_{ts}.json`. The gate's incumbent baseline is the **most recent
  non-scratch run-log** and its `aggregated_dimensions[]` (+ `.ann` overlay) — no
  snapshot or `git` needed.
- **Holdout corpus:** 9 tests across 4 skills, of **343** total unit tests.
- **`skill-improver.md`:** report-only (Read/Grep/Glob/Bash); §4 "Hold-out is
  sacred"; §5 clustering `≥2 non-hold-out tests OR one human correction`; §6 binary
  gate framing; **no** edit-count cap.
- **`interpret-e2e-result` causes:** agent reasoning regression, `/research` skill
  regression ("skipped a GPS step or picked the wrong sub-skill"), sub-skill
  regression, FamilySearch data drift, single-run jitter (+ a first-run set).
  **No tooling-defect cause** — hence the explicit lane-1 check in §8.3.
- **e2e artifacts:** `run-<ts>.{json,transcript.md,final-tree.gedcomx.json,
  final-research.json}` committed; `run-<ts>.session.jsonl` (full tool responses,
  gitignored; permission bits inherited from the SDK source file, not chmod'd);
  `run-<ts>.ann.json` (`per_finding`). Miss = `required:true` finding in
  `expected-findings.json` absent from the final tree.
- **`draft-unit-test`:** writes `eval/tests/unit/<skill>/<slug>.json`,
  `eval/fixtures/scenarios/<slug>/`, `eval/fixtures/mcp/<name>.json`, all `_draft`;
  never sets `holdout`; had a stale `$REPO/plugin/skills/` path at step 2 (fixed
  in this PR).
- **`mock_mcp`:** matches by `tool` + `args` (dotted paths; `~` prefix =
  case-insensitive substring; else exact; first match wins); `LIVE_TOOLS =
  {validate_research_schema, research_log_append, research_append, tree_edit,
  tree_correct, project_context}`.
