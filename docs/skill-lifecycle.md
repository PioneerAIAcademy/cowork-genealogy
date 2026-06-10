# The skill lifecycle — authoring, testing, and improving genealogy skills

This is the **start-here map** for the people who build and improve the
genealogy skills: how a skill goes from an idea to a tested, released,
continually-improved artifact. It is the **complete flow** end to end and the
entry point; it points at the detailed docs for each step rather than
restating them.

The work is done by a **genealogist and a developer pairing.**
Genealogists are learning to run tests; developers are learning
genealogy. Neither role does the whole loop alone — the genealogist owns
*what good looks like*, the developer owns *how the skill and harness
work*, and they decide together at the points that matter.

```
  1 create → 2 test → 3 review+annotate → 4 audit rubric → 5 improve body → 6 verify → 7 release
                                                                 │
                       8 optimize description  ◄── co-tune ──────┘

  One skill at a time. Body loop (5) = skill-improver, which proposes SKILL.md
  edits and routes test-data / triggering / rubric causes elsewhere.
  Description loop (8) = the vendored run_loop. Rubric audit (4) keeps the
  signal honest so (5) doesn't optimize toward a weak rubric.
```

| Role | Owns | Across the lifecycle |
|---|---|---|
| **Genealogist** | Correctness — does the skill do genealogy right? | Writes tests + rubric, runs the harness, annotates grades, judges whether a proposed edit is *genealogically* correct, blesses releases. |
| **Developer** | Mechanics — skills, scripts, harness, the loop. | Pairs on skill prose and scripts, runs the improver and the optimizer, builds the plugin, opens PRs, keeps the harness honest. |

If you're brand new, read the two walkthroughs first:
[`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md) (genealogist)
and [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md).

---

## The stages

### 1. Create / edit a skill

**Pair.** Write the SKILL.md to the prose standard in
[`docs/skill-authoring-guide.md`](skill-authoring-guide.md); for a new
tool-wrapping skill, scaffold it with the `cowork-skill-builder` agent
first. Architecture questions (should this even be a skill? which
category?) → [`docs/specs/skill-architecture-spec.md`](specs/skill-architecture-spec.md).
The genealogist drives the domain content; the developer drives shape,
frontmatter limits, and any `scripts/` helper.

### 2. Test

**Pair, genealogist-led.** Run the harness one skill at a time:

```bash
make eval-skill SKILL=<skill>     # from repo root: rebuilds the engine if stale, then runs
# manual equivalent: cd eval/harness && uv run python run_tests.py --skill <skill>
```

The harness drives the skill against mocked MCP tools in a seeded
scenario, an LLM judge grades each run, and it writes a candidate
run-log. Format, fixtures, scenarios, exit codes: [`eval/README.md`](../eval/README.md)
and [`docs/specs/unit-test-spec.md`](specs/unit-test-spec.md). Tests are
**slow (~2–3 min each) and cost money** — scope every run to one skill,
never run several invocations at once (they fight for memory and get
killed).

How to author a *good* test corpus is its own section below — it's the
single biggest lever on whether the rest of the loop works.

### 3. Review & annotate

**Genealogist.** Open the CRUD UI (`cd eval/app && npm run dev`), read
each run, and correct the judge's per-dimension scores into the
`.ann.json` sibling. This is where human judgment enters the system, and
it's what every later step trusts more than the raw judge score. The
per-PR cadence is [`docs/plan/per-pr-review-workflow.md`](plan/per-pr-review-workflow.md);
release/active/candidate mechanics are
[`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md).

**Write correction comments a machine can act on.** A comment is the
highest-signal input the improver gets, and "judge over-credited" is
useless to it. Use three parts:

> **Did:** what the skill actually did.
> **Should:** what it should have done.
> **Gap:** which SKILL.md guidance is missing, wrong, or being ignored.

Example: *"Did: labeled the conflicting birthplaces a soft conflict.
Should: a hard conflict — two primary informants disagree. Gap: the
skill body never says primary-vs-primary disagreement is hard."* That
comment is an edit waiting to happen; the first one isn't.

### 4. Audit the rubric (periodic; before a body-optimization push)

**Pair.** Before trusting the improver to optimize toward a rubric, make sure
the rubric *discriminates*. The **rubric-critic** agent (read-only) reads a
skill's run logs (best across versions) + `.ann` corrections + `rubric.md` and
flags non-discriminating dimensions (always 3 or always 1), flaky dimensions,
dimensions no test exercises, and systematic judge-vs-human disagreement.
Invoke it in Claude Code: *"audit the rubric for `<skill>`"*. It only
*suggests* — rubric edits are the senior's, judge-prompt edits a separate
cadence. A skill-improver that hill-climbs a weak rubric optimizes noise, so
run this periodically and whenever a dimension looks off.

### 5. Improve the skill body

**Pair.** Cluster the failures across the skill's tests and revise the
SKILL.md prose to fix them — explaining the *why*, not bolting on
another MUST (see the authoring guide). The legacy single-case path is
[`docs/feedback-workflow.md`](feedback-workflow.md); the **skill-improver**
agent (report-only) assists by reading the latest annotated run-log,
clustering, and proposing an evidence-cited diff for the pair to approve.
Invoke it in Claude Code: *"improve `<skill>` from its eval results"*. It
**routes by cause** — a correction that actually points at a test-data gap, a
triggering miss, or a rubric problem goes to the test author / description
optimizer (step 8) / rubric review (step 4), not into a body edit; only a
body-located cause becomes SKILL.md prose. Either way the discipline is the same:

- **Generalize, don't patch the case.** The test is the question, not the
  answer key. Ask "does this edit read as a general principle?" An edit
  that only helps the Flynn scenario is a regression in disguise. This —
  not a statistical hold-out — is the primary overfitting guard at our
  test counts.
- **Hold out a few tests.** Mark ~2–3 of the skill's tests `holdout: true`
  (see the test schema). The improver never reads them while forming an
  edit; they exist only to check the edit helped cases it wasn't written
  from. Keep them stable — don't rewrite a holdout test to make it pass.
- **Trust the human over the judge.** Where a correction comment
  disagrees with the judge, the comment governs the edit. Don't tune the
  skill toward judge quirks — that's the judge prompt's problem, on a
  separate cadence.
- **Subtract, too.** If a run shows the skill sending the model down
  unproductive paths, delete the offending instruction. Net SKILL.md
  length should trend flat or down, not always up.

### 6. Verify the fix

**Pair.** We are early in the cycle — **catching big problems, not
polishing small ones** — so verification is cheap and qualitative, not a
statistical bake-off:

- **Re-run only the affected tests** while iterating (`--test <id>`);
  reserve the full `--skill` run for the release candidate.
- **One run is enough for a big fix.** A real problem is a dimension that
  fails *consistently* (a 1, not a flicker); a single run sees that.
  Don't require multiple runs to chase small score deltas you can't trust
  — the harness has no `temperature=0`, so treat a sub-noise movement as
  noise, not victory. (Bump `runs_per_test` only when you genuinely need
  to measure a marginal change later.)
- **Gate on the named problem, not the mean.** The question is "did the
  dimension that was failing now pass, with nothing obvious regressing?"
  — a binary a single run answers — not "did the weighted mean rise by
  X."

### 7. Release

**Genealogist blesses, developer ships.** The GitHub Action requires the
latest full-skill run-log to be active and fully annotated before the
senior clicks Release. Mechanics: `eval/README.md` → "Run log naming"
and the versioning plan.

### 8. Optimize the description (separate, automated loop)

**Developer.** The skill body (steps 5–7) and the skill *description* are
two different loops. The description drives Cowork's auto-delegation and is
tuned by the description optimizer (skill-creator's `run_loop`, vendored under
`eval/triggering/`) against should-trigger / should-not-trigger query sets —
derived for free from your positive and negative tests. Run it on demand (real
`claude -p` calls — network + model cost, **not** CI):

```bash
make optimize-skill SKILL=<skill>   # build the query set from the tests, then run the optimizer
```

It tunes the **description only** — it never runs the skill or an MCP tool.
Apply the proposed `best_description` as a human-reviewed SKILL.md edit. Plan:
[`docs/plan/skill-mcp-optimization-plan.md`](plan/skill-mcp-optimization-plan.md);
vendoring notes: `eval/triggering/VENDORED.md`. (Folding the optimizer's output
into `eval/runlogs/optimizer/` is a planned fast-follow; today it prints
`best_description` + an HTML report.)

**Co-tune the two.** A body change can invalidate the old description's
triggers, and a skill that never activates can't be body-improved. After
a body edit lands, re-run the description optimizer; after a description
change, re-run the body suite to confirm no behavioral regression. Do
body first, then description.

---

## Authoring a test corpus that the loop can actually use

Test *count* is a floor, not the goal — aim for **8–12 tests per skill**,
but spend them on **coverage, not repetition**. Eight easy happy-path
tests can't tell a good skill from a bad one. Each skill's set should
span:

- **Positive** — the skill should fire and do the task well (happy path
  *and* messier variants).
- **Negative / routing** — a near-miss that should go to a *different*
  skill. Mine these from the "Do NOT use when…" clauses in the
  description (see the authoring guide); build them from both directions
  of each confusable pair.
- **Edge cases** — the messy genealogy realities: conflicting records,
  missing data, ambiguous places, multi-person households.
- **At least one hard case** — something the skill currently gets wrong.
  A corpus with no failures has nothing to improve against.

Then mark **2–3 diverse, representative tests `holdout: true`** up front.
Authoring the hold-out into the corpus now is far cheaper than carving it
out after the improver has already been trained against everything.

Keep `judge_context` / criteria **neutral** — grade the reasoning, not a
preferred verdict (see `unit-test-spec.md` §5.4). A criterion the test's
own author would only endorse if they reached one particular conclusion
is leakage, and it's the biggest validity threat to LLM-as-judge.

---

## Is the loop working?

The real metric isn't pass rate — it's whether the system **compounds.**
If the pair keeps catching the *same class* of issue ten iterations in,
the loop isn't learning: the fix belongs further upstream (a rubric
dimension, a validator, the authoring guide), not in yet another
case-specific prose patch. Promote recurring findings down a tier rather
than re-fixing them. (`skill-mcp-optimization-plan.md` carries the
promotion criteria.)

## Status

Every step in the flow above is built and on the
`skill-authoring-and-improvement-framework` branch:

- **Author** — the authoring guide + a blocking frontmatter lint (CI).
- **Test** — `make eval-skill SKILL=<name>` (rebuilds the engine, then runs the harness).
- **Review** — the CRUD-UI annotation loop + the `holdout` test flag.
- **Audit** — the `rubric-critic` agent.
- **Improve** — the `skill-improver` agent (report-only; proposes evidence-cited
  SKILL.md edits and routes non-body causes elsewhere; the pair applies,
  re-runs, commits — it never edits files itself).
- **Optimize** — `make optimize-skill SKILL=<name>` (vendored `run_loop`, on-demand).

**To try the skill-improver on skill `X`:** it needs an *active* run log
(its snapshot matches the working tree) that is *annotated*. So first
`make eval-skill SKILL=X` (it rebuilds the engine first) on current code, annotate that
candidate in the CRUD UI, then in Claude Code ask to "use the
skill-improver agent on X". Against a stale or unannotated run log it
returns no edits and asks you to re-run — that is correct behavior, not a
failure. The developer applies the approved diffs, re-runs the affected
tests, and the pair decides whether to keep them.

Fast-follows (not blockers for team testing): folding the optimizer's output
into `eval/runlogs/optimizer/`. The real next phase is the teams exercising all
of this on real skills. The legacy single-case path is
[`docs/feedback-workflow.md`](feedback-workflow.md).

## Doc index

| You want to… | Read |
|---|---|
| Write a SKILL.md well | [`docs/skill-authoring-guide.md`](skill-authoring-guide.md) |
| Understand skill architecture / categories | [`docs/specs/skill-architecture-spec.md`](specs/skill-architecture-spec.md) |
| Run the harness / read a run-log | [`eval/README.md`](../eval/README.md) |
| Write a test | [`docs/specs/unit-test-spec.md`](specs/unit-test-spec.md) |
| Audit a skill's rubric quality | the `rubric-critic` agent — `.claude/agents/rubric-critic.md` |
| Improve a SKILL.md body from eval results | the `skill-improver` agent — `.claude/agents/skill-improver.md` |
| Optimize a skill's description | `make optimize-skill SKILL=<name>`; `eval/triggering/` + `VENDORED.md` |
| Triage a user feedback report | [`docs/feedback-workflow.md`](feedback-workflow.md) |
| Know the per-PR + release cadence | [`docs/plan/per-pr-review-workflow.md`](plan/per-pr-review-workflow.md), [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md) |
| Understand the optimizers | [`docs/plan/skill-mcp-optimization-plan.md`](plan/skill-mcp-optimization-plan.md) |
| Do your first PR (genealogist / senior) | [`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md), [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md) |
