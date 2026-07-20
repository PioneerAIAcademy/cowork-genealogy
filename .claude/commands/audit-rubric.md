---
description: Audit one genealogy skill's eval rubric and judge quality from its run logs — flags non-discriminating, flaky, unexercised dimensions and systematic judge-vs-human divergence. Dispatches to the read-only rubric-critic agent.
argument-hint: <skill-name>
---

Run the **`rubric-critic`** agent against the skill named in `$ARGUMENTS`.

## Why this is a command and not a sentence

A skill-improver that optimizes toward a weak rubric hill-climbs noise, so
this audit is what makes the *next* step trustworthy — run it before
`/improve-skill` on any skill you haven't audited recently.

`rubric-critic` is read-only by construction: rubric dimensions are
senior-owned and the judge prompt is project-global on a separate cadence,
so the agent emits suggestions for review and never edits either. Asking for
it in prose relies on description matching, and a miss hands the job to
main-context Claude — which has Edit and Write and no such prohibition.
Dispatch explicitly, and do not do the analysis yourself.

## Step 1 — Check where you are

The agent reads `eval/runlogs/unit/<skill>/` and
`eval/tests/unit/<skill>/rubric.md`. Both exist only in a repo checkout.

Run `git rev-parse --show-toplevel` and confirm `eval/runlogs/unit/` exists
beneath it. If it doesn't, you are probably in a feedback **case folder**
(`~/feedback/<slug>/` — its own `git init` baseline and symlinked skills
make it look repo-shaped, but it has no `eval/`). Stop and tell the user to
re-open Claude Code at the worktree root.

## Step 2 — Resolve the skill

If `$ARGUMENTS` is empty, list the directories under
`eval/tests/unit/` and ask which one.

Otherwise confirm both exist:

- `eval/tests/unit/$ARGUMENTS/rubric.md`
- `eval/runlogs/unit/$ARGUMENTS/`

If there is no `rubric.md`, there is nothing to audit — say so and stop.

## Step 3 — Report what limits the read

Check and state these before dispatching. Neither blocks the run; both
bound how strong a conclusion the agent can draw.

- **How many run logs / versions exist.** Count the `v{N}*.json` files
  (ignore `scratch_*.json`). Variance and trend *across versions* is this
  agent's strongest signal — a single run supports only a low-confidence
  read, and the agent will say so.
- **Whether `.ann.json` siblings exist.** Without them the judge-vs-human
  divergence check — the flag that distinguishes a miscalibrated judge from
  a genuinely failing skill — cannot run at all. The other three flags
  still work from judge scores alone.

## Step 4 — Dispatch

Call the Agent tool with `subagent_type: "rubric-critic"` and a prompt
naming the skill plus what Step 3 found. Don't pre-read the run logs and
summarize them — the agent reads across versions deliberately, and a digest
from you would flatten exactly the variance it is looking for.

## Step 5 — Relay and route

Print the dimension scorecard and the flags intact. Every flag carries a
destination — a **rubric edit** (senior-owned) or a **judge-prompt review**
(project-global cadence) — and that routing is the output's whole value.
Keep the "What looks healthy" section too; it tells the senior what not to
touch.

**Do not edit `rubric.md` or `eval/harness/judge/prompt.md`**, and do not
offer to. Both are owned outside this loop. If the audit shows the rubric is
sound, say so plainly and note that `/improve-skill $ARGUMENTS` can be
trusted to optimize toward it.
