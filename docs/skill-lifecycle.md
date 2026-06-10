# The skill lifecycle — authoring, testing, and improving genealogy skills

This is the **start-here map** for the people who build and improve the
genealogy skills: how a skill goes from an idea to a tested, released,
continually-improved artifact. It orients you and points at the detailed
docs — it does not restate them.

The work is done by a **genealogist and a developer pairing.**
Genealogists are learning to run tests; developers are learning
genealogy. Neither role does the whole loop alone — the genealogist owns
*what good looks like*, the developer owns *how the skill and harness
work*, and they decide together at the points that matter.

```
        create ──► test ──► review & annotate ──► improve ──► release
          ▲                                          │
          └──────────────── (description optimize) ◄─┘
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
cd eval/harness
uv run python run_tests.py --skill <skill>
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

### 4. Improve the skill body

**Pair.** Cluster the failures across the skill's tests and revise the
SKILL.md prose to fix them — explaining the *why*, not bolting on
another MUST (see the authoring guide). Today this is the manual edit
step in [`docs/feedback-workflow.md`](feedback-workflow.md); the
**skill-improver** agent (report-only; see Status) assists by reading
the latest annotated run-log, clustering, and proposing an evidence-cited
diff for the pair to approve. Either way the discipline is the same:

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

### 5. Verify the fix

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

### 6. Release

**Genealogist blesses, developer ships.** The GitHub Action requires the
latest full-skill run-log to be active and fully annotated before the
senior clicks Release. Mechanics: `eval/README.md` → "Run log naming"
and the versioning plan.

### 7. Optimize the description (separate, automated loop)

**Developer.** The skill body (steps 4–6) and the skill *description* are
two different loops. The description drives Cowork's auto-delegation and
is tuned automatically by the description optimizer (a port of
skill-creator's `run_loop`) against should-trigger / should-not-trigger
query sets — which it can derive for free from the positive and negative
tests you already wrote. Plan:
[`docs/plan/skill-mcp-optimization-plan.md`](plan/skill-mcp-optimization-plan.md).
Optimizer run-logs land in `eval/runlogs/optimizer/` (excluded from the
release gate and comparisons).

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

In place: the authoring guide; the harness + CRUD-UI review loop; the
`holdout` test flag; a blocking frontmatter lint in CI; and the
**skill-improver** agent — a report-only proposer that reads a skill's
latest active, annotated run log and returns evidence-cited SKILL.md edits
for the pairing developer to apply in-session, re-verify, and commit. It
does not edit files itself.

**To try the skill-improver on skill `X`:** it needs an *active* run log
(its snapshot matches the working tree) that is *annotated*. So first
`uv run python run_tests.py --skill X` on current code, annotate that
candidate in the CRUD UI, then in Claude Code ask to "use the
skill-improver agent on X". Against a stale or unannotated run log it
returns no edits and asks you to re-run — that is correct behavior, not a
failure. The developer applies the approved diffs, re-runs the affected
tests, and the pair decides whether to keep them.

Still to come: a rubric-quality critic, and the body↔description co-tune
with the description optimizer. The manual edit path is
[`docs/feedback-workflow.md`](feedback-workflow.md).

## Doc index

| You want to… | Read |
|---|---|
| Write a SKILL.md well | [`docs/skill-authoring-guide.md`](skill-authoring-guide.md) |
| Understand skill architecture / categories | [`docs/specs/skill-architecture-spec.md`](specs/skill-architecture-spec.md) |
| Run the harness / read a run-log | [`eval/README.md`](../eval/README.md) |
| Write a test | [`docs/specs/unit-test-spec.md`](specs/unit-test-spec.md) |
| Triage a user feedback report | [`docs/feedback-workflow.md`](feedback-workflow.md) |
| Know the per-PR + release cadence | [`docs/plan/per-pr-review-workflow.md`](plan/per-pr-review-workflow.md), [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md) |
| Understand the optimizers | [`docs/plan/skill-mcp-optimization-plan.md`](plan/skill-mcp-optimization-plan.md) |
| Do your first PR (genealogist / senior) | [`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md), [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md) |
