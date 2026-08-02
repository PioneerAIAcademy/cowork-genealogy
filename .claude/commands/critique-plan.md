---
description: Adversarially review an implementation plan before any code is written. Dispatches to the read-only plan-critic agent; never edits the plan or the code.
argument-hint: [path-to-plan] (defaults to PLAN.md)
---

Run the **`plan-critic`** agent against the plan named in `$ARGUMENTS`.

Step 3 of [`docs/task-lifecycle.md`](../../docs/task-lifecycle.md).

## Why this is a command and not a sentence

The session you are in **wrote the plan**. Asking it in prose to "review this
plan" relies on description matching, and a miss doesn't fail loudly — you get
main-context Claude, which is anchored on its own reasoning and holds Edit and
Write, grading its own work. It will agree with itself, and it may start
implementing. Dispatching explicitly is what buys the fresh context that makes
the review worth anything.

So: dispatch, and do not do the review yourself.

## Step 1 — Resolve the plan to a file

Subagents start in fresh context and see **only** what the prompt hands them.
A plan described rather than pasted arrives as your paraphrase — which is
exactly the input the critic is told not to trust.

- `$ARGUMENTS` empty → look for `PLAN.md` at the repo root, then any
  `docs/plan/*.md` modified on this branch (`git diff --name-only main...`).
- Found exactly one → use it, and say which.
- Found none → the plan exists only in this conversation. Write it to
  `PLAN.md` first (it is gitignored), then continue. Do not paste a summary
  into the agent prompt instead.
- Found several → ask which.

## Step 2 — Find the task it claims to satisfy

The critic checks the plan against the *task*, not against itself, and is told
to read the task rather than trust the plan's paraphrase of it.

Look for an issue number in the plan, the branch name, or the conversation. If
you find one, pass it. If there is genuinely no issue, say so in the dispatch —
"no issue; the task as stated by the user was: …" — so the critic knows the
acceptance bar came from a person and not a ticket.

## Step 3 — Say which round this is

The lifecycle caps this at **two rounds**. Round one finds real problems; round
two confirms the fixes and usually finds one more; round three yields style
opinions and a longer plan.

Check the conversation for an earlier critique of the same plan and tell the
agent which round it is. If this would be round three, **stop and say so**: two
rounds of unresolved blocking findings means the task is underspecified, not
the plan, and it goes to the lead.

## Step 4 — Dispatch

Call the Agent tool with `subagent_type: "plan-critic"`, passing the plan's
path, the task/issue, and the round number. Do not summarize the plan for it,
and do not tell it what you think is weak — a pre-digest biases which parts it
examines, and the parts you already doubt are not the ones that need finding.

## Step 5 — Relay, and verify before acting

Print the findings substantially intact, with severities and the verdict line.

**Then check each one before acting on it.** Some will be wrong. Open the file,
run the command, confirm the claim. This applies to the agent's *proposals* as
much as its criticisms: a suggested command, flag, or file name relayed without
checking reads like an established thing to whoever you hand it to, and this is
how invented names enter a document. Deciding which findings are real is the
part of the job that teaches you the codebase — do not skip it because the
output is confident and well-formatted.

Report what you rejected and why, alongside what you accepted. A review where
everything was correct is a review that wasn't checked.

**Do not apply the fixes yourself unless asked.** The findings go back to the
plan's author, who revises and — if this was round one — dispatches once more.
