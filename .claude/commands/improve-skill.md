---
description: Propose evidence-cited SKILL.md body edits for one genealogy skill from its latest annotated eval run log. Dispatches to the report-only skill-improver agent; never edits the skill itself.
argument-hint: <skill-name>
---

Run the **`skill-improver`** agent against the skill named in `$ARGUMENTS`.

## Why this is a command and not a sentence

`skill-improver` is report-only by construction — its tools are
Read/Grep/Glob/Bash, it proposes at most 3 edits per round, and a human
applies them. Asking for it in prose relies on description matching, and a
miss doesn't fail loudly: you get main-context Claude, which *does* have
Edit and Write, doing the analysis instead. That silently drops both the
edit budget and the human-applies-them gate the improvement loop rests on.
So: dispatch explicitly, and do not do the work yourself.

## Step 1 — Check where you are

The agent reads run logs under `eval/runlogs/unit/<skill>/`. Those exist
only in a repo checkout.

Run `git rev-parse --show-toplevel` and confirm `eval/runlogs/unit/` exists
beneath it. If it doesn't — most likely you are in a feedback **case
folder** (`~/feedback/<slug>/`, which has its own `git init` baseline and
symlinked skills, so it looks repo-shaped but has no `eval/`) — stop and
tell the user to re-open Claude Code at the worktree root. Do not try to
resolve a path back to the repo; the case folder's `.feedback-repo-root`
marker points at the checkout, but running the improver across that seam
would read one tree's run logs while the user edits another's `SKILL.md`.

## Step 2 — Resolve the skill

If `$ARGUMENTS` is empty, list the directories under
`packages/engine/plugin/skills/` and ask which one.

Otherwise confirm both of these exist:

- `packages/engine/plugin/skills/$ARGUMENTS/SKILL.md`
- `eval/runlogs/unit/$ARGUMENTS/`

If the skill exists but has no run-log directory, it has never been
evaluated — say so and stop. There is nothing for the improver to read, and
it will correctly refuse. The fix is `make eval-skill SKILL=$ARGUMENTS`
first, then grade it in `make eval-ui`.

## Step 3 — Warn about the two preconditions that silently weaken the result

Check these yourself and report what you find *before* dispatching. Neither
blocks the run; both change how much the output is worth.

- **Annotations.** The newest `v{N}_<ts>.json` should have an `.ann.json`
  sibling. Without one the agent has judge scores but no human ground
  truth, and it will (correctly) refuse to propose edits on thin evidence.
- **Hold-out tests.** Grep the skill's tests under
  `eval/tests/unit/$ARGUMENTS/` for `"holdout": true`. If there are none,
  the anti-overfitting check is inert — the agent is instructed to downgrade
  its confidence and say so. Mention that the user can set 2–3 in the CRUD
  UI (`make eval-ui`), but that doing so **after** a baseline run and
  **before** `make gate-skill` invalidates the baseline the gate compares
  against. Setting hold-outs is a grading-relevant change; it belongs before
  the "before" run, not between it and the gate.

## Step 4 — Dispatch

Call the Agent tool with `subagent_type: "skill-improver"` and a prompt
naming the skill and anything Step 3 surfaced. Do not summarize the run log
for it — it reads its own evidence, and a pre-digest from you would bias
which failures it looks at.

## Step 5 — Relay, don't apply

Print the agent's report substantially intact: the proposed edits, the
evidence cited for each, the "Did NOT change" routing, and the deferred
list. Those routing decisions are the useful half — they say which findings
belong to the test author, the description optimizer, or the judge-prompt
review rather than to `SKILL.md`.

**Do not apply the edits.** Offer to, and wait. The human reviewing each
proposed edit against its cited evidence is the point of the loop, not
overhead in front of it.

After the user applies edits, the next step is
`make gate-skill SKILL=$ARGUMENTS TEST=<the mined test's id>` — and then a
full `make eval-skill SKILL=$ARGUMENTS` plus a grading pass, because the
`check-runlogs` CI gate requires the latest run log to be *active* against
the edited `SKILL.md` and fully annotated.
