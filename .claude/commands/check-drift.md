---
description: Check a finished implementation against the plan it was supposed to follow. Dispatches to the read-only drift-critic agent; never edits the plan or the code.
argument-hint: [path-to-plan] (defaults to PLAN.md)
---

Run the **`drift-critic`** agent against the plan named in `$ARGUMENTS` and the
current branch's diff.

Step 6 of [`docs/task-lifecycle.md`](../../docs/task-lifecycle.md). Dispatch —
do not do the comparison yourself. Rationale:
[ADR-0007](../../docs/adrs/ADR-0007-attack-the-plan-before-writing-code.md).

## Step 1 — Resolve the plan to a file

- `$ARGUMENTS` names a path that exists → use it.
- `$ARGUMENTS` names a path that does **not** exist → say so and stop.
- `$ARGUMENTS` empty → look for `PLAN.md` at the repo root.

**No `$ARGUMENTS` and no `PLAN.md` → say so and stop.** Do not fall back to the
PR body, a `docs/plan/` search, or the conversation. A Trivial task has no plan
by design, and a baseline you invent produces confident findings about an
agreement nobody made.

## Step 2 — Establish the diff base

Confirm all three, and tell the agent which are non-empty:

```sh
git diff origin/main...HEAD --stat
git diff HEAD --stat
git status --porcelain
```

If `origin/main` is stale, `git fetch origin` first — a diff against a
weeks-old base reports other people's merged work as unplanned.

## Step 3 — Find the approved-deviation record

Step 4 of the lifecycle permits re-planning, so a deviation that was written
down is not drift. Two places carry it:

- `PLAN.md` itself — revision notes, or a sentence in the affected section.
- The PR body, when a PR already exists: `gh pr view --json body -q .body`.

At step 6 there is usually **no PR yet**. When there is none, say so in the
dispatch — "no PR; `PLAN.md` is the only deviation record" — so the agent does
not read silence as approval.

## Step 4 — Dispatch

Call the Agent tool with `subagent_type: "drift-critic"`, passing the plan's
path, the three diff commands, and the deviation record from step 3. Do not
summarize the plan or the diff for it, and do not tell it where you think the
diff wandered — a pre-digest biases which parts it examines, and the parts you
already doubt are not the ones that need finding.

## Step 5 — Relay, and verify before acting

Print the findings substantially intact, with classes, severities, and the
verdict line.

**Then check each one before acting on it.** Open the file, run the command,
confirm the claim. This applies to the agent's *proposals* as much as its
criticisms: a suggested command, flag, or file name relayed without checking
reads like an established thing to whoever you hand it to.

Report what you rejected and why, alongside what you accepted.

**Do not apply the fixes yourself unless asked.** Each finding resolves one of
two ways, and only the author can say which: change the code back to the plan,
or write the deviation into `PLAN.md` because the plan was wrong.
