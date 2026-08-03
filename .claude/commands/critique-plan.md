---
description: Adversarially review an implementation plan before any code is written. Dispatches to the read-only plan-critic agent; never edits the plan or the code.
argument-hint: [path-to-plan] (defaults to PLAN.md)
---

Run the **`plan-critic`** agent against the plan named in `$ARGUMENTS`.

Step 3 of [`docs/task-lifecycle.md`](../../docs/task-lifecycle.md). Dispatch —
do not do the review yourself. Rationale:
[ADR-0007](../../docs/adrs/ADR-0007-attack-the-plan-before-writing-code.md).

## Step 1 — Resolve the plan to a file

Subagents start in fresh context and see **only** what the prompt hands them, so
the critic must get a path. A plan you describe instead of pointing at arrives
as your paraphrase, which is the one input it is told not to trust.

- `$ARGUMENTS` names a path that exists → use it.
- `$ARGUMENTS` names a path that does **not** exist → say so and stop. Do not
  fall back to a search: the user named a file, and guessing at a different one
  produces a critique of the wrong plan.
- `$ARGUMENTS` empty → look for `PLAN.md` at the repo root, then any
  `docs/plan/*.md` modified on this branch (`git diff --name-only main...`).
  Exactly one → use it, and say which. Several → ask which.
- Nothing found → the plan exists only in this conversation. Write it to
  `PLAN.md` (gitignored) first, then continue. Do not paste a summary into the
  agent prompt instead.

## Step 2 — Find the task it claims to satisfy

The critic checks the plan against the *task*, and reads the task itself rather
than trusting the plan's paraphrase of it.

Look for an issue number in the plan, the branch name, or the conversation. Pass
it if you find one. If there genuinely is no issue, say so in the dispatch —
"no issue; the task as stated by the user was: …" — so the critic knows the
acceptance bar came from a person and not a ticket.

## Step 3 — Say which round this is

Check the conversation for an earlier critique of the same plan and tell the
agent the round number.

If this would be **round three, stop and say so**. Two rounds of unresolved
blocking findings means the task is underspecified, and it goes to the lead.

## Step 4 — Dispatch

Call the Agent tool with `subagent_type: "plan-critic"`, passing the plan's
path, the task/issue, and the round number. Do not summarize the plan for it and
do not tell it what you think is weak — a pre-digest biases which parts it
examines, and the parts you already doubt are not the ones that need finding.

## Step 5 — Relay, and verify before acting

Print the findings substantially intact, with severities and the verdict line.

**Then check each one before acting on it.** Open the file, run the command,
confirm the claim. This applies to the agent's *proposals* as much as its
criticisms: a suggested command, flag, or file name relayed without checking
reads like an established thing to whoever you hand it to.

Report what you rejected and why, alongside what you accepted.

**Do not apply the fixes yourself unless asked.** The findings go back to the
plan's author, who revises and — if this was round one — dispatches once more.
