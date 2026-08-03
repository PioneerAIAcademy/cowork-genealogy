# Task lifecycle

How a developer task gets from issue to merge. Skill-prose work from eval
results follows [`docs/skill-lifecycle.md`](./skill-lifecycle.md) instead.

> Plan before you code. Have the plan attacked before you code. Verify your own
> work before you ask anyone to look at it. Never ship a line you can't explain.

Why it is shaped this way: [ADR-0007](./adrs/ADR-0007-attack-the-plan-before-writing-code.md).

---

## Pick a tier

Say which one in your PR description.

| Tier | What it is | What you do |
|---|---|---|
| **Trivial** | Typo, comment, doc link, version bump, dead-code deletion, one-line fix with an obvious cause | Skip steps 1–3. Change, test, self-review, PR. |
| **Normal** | Everything else | All nine steps. |

**There is no risky tier, and that is deliberate.** Risk is classified once, at
triage, by `task-reviewer` — before the task reaches you. Work that is
schema-touching, credential-touching, plugin-agent-touching, or hard to undo
carries the `senior` label and is assigned to the lead, not to the unassigned
pool. So a task you were handed is a task somebody with the whole picture
already decided a junior can land. Why:
[ADR-0007](./adrs/ADR-0007-attack-the-plan-before-writing-code.md) §2.

What that leaves you is the **stop rule** in step 4 — the case triage cannot
see, because it only becomes visible once you are in the code.

---

## Ask early

**When you aren't confident, ask a senior. At any step, about anything.** A
question you can't answer, a mechanism you don't understand, a finding you can't
tell is real, a task that is turning out bigger than it looked — all of it. Ask
while you're still deciding, not after you've built.

This is not the step-4 stop rule and doesn't work like it. That rule hands the
task back; this one keeps it yours and brings help in. Asking is not a signal
that the work should be reassigned, and it will not be read as one.

Being handed a task means somebody decided it was landable by a junior. It does
not mean they decided it was easy, and it does not mean they knew which part
would be hard for *you* — triage sees the change, not the pairing. So the fact
that a task reached you is not evidence you should already know how to do it.

Two things make this specific rather than a platitude:

- **A senior is cheaper the earlier you ask.** Five minutes before you plan beats
  a review round on a branch built the wrong way, which beats three revision
  rounds in step 9.
- **Claude will not stall on the thing you're unsure about.** It will pick,
  confidently, and its choice will look settled in the diff — which is precisely
  why the thing you couldn't resolve needs a human before it becomes code, not
  after. The same reasoning is why `task-reviewer` escalates open decisions
  instead of guessing at them.

The one thing that is not fine is shipping past it — see "The rule that holds it
together."

---

## The loop

### 0. Branch in a worktree

```sh
git worktree add .claude/worktrees/<branch> -b <branch> origin/main
```

Never work on `main`. One task, one worktree, one PR. The `post-checkout` hook
links the shared gitignored files (`make install-hooks` once per clone).

### 1. Read the ground

Issue bodies here are pointers, not briefings. Before planning, read the issue,
the spec under [`docs/specs/`](./specs/) if the thing you're touching has one,
[`docs/architecture.md`](./architecture.md) (its "If you're asked to…" blocks
name the sites your change touches), [`CLAUDE.md`](../CLAUDE.md), and the code.

Point Claude at all of it, then ask it to ask you questions:

> Read this issue, the spec, and the code it touches. Before proposing
> anything, ask me the questions where a different answer would change what you
> build. Skip anything with an obvious default — make the call and tell me what
> you chose.

The last sentence is what stops you rubber-stamping twelve questions that had
ten obvious answers.

### 2. Write the plan to a file

`PLAN.md` at your worktree root. It is gitignored; don't commit it. Four things:

1. **What changes** — the file list, by path.
2. **What doesn't change** — the tempting adjacent thing you're not touching.
3. **The acceptance check** — a named test that fails today and passes after.
   "The tests pass" is not one; they pass right now.
4. **What you're deferring** — becomes issues in step 7.

A plan that stays in the chat can't be read by the critic, by your fresh-session
review, or by your reviewer.

### 3. Attack the plan

```
/critique-plan PLAN.md
```

Two rounds maximum. **If round two still returns a BLOCKING finding, stop and
go to the lead** — the task is underspecified, not the plan.

**Check each finding before acting on it.** Some will be wrong. Open the file,
run the command, confirm the claim. This covers what the critic *proposes* as
much as what it criticizes: a suggested command, flag, or file name that you
repeat unchecked reads like an established thing to whoever you hand it to.

### 4. Implement

**If reality contradicts the plan, stop and re-plan.** Update the plan (a
sentence in the PR body is enough), then continue — your reviewer is reviewing
against the plan, so an undocumented deviation is invisible to exactly the
person whose job is catching it.

**Stop and go to the lead** — do not re-plan around it — if the change turns out
to do any of these. Triage said a junior could land this; finding one of these
means triage was working from something the issue did not say, and the fix is to
the issue, not to your branch.

- Changes `research.json` or simplified-GedcomX **schema** — a new field, a new
  value on a closed enum, or a tree-shape change. Site lists:
  [`CLAUDE.md`](../CLAUDE.md) § "Researcher profile in `research.json`".
- Touches `packages/engine/mcp-server/src/auth/`, or anything holding a credential.
- Changes a **Cowork plugin agent** — `packages/engine/plugin/agents/`,
  `packages/engine/plugin/hooks/`, and especially `tools:`/`disallowedTools:`.
  (Claude Code subagents under `.claude/agents/` are not this.)
- Adds an MCP tool, or changes an existing tool's contract.
- Reverses something in [`docs/adrs/`](./adrs/) or contradicts a `CLAUDE.md` rule.
- Is hard to undo: a data migration, a write to user state, anything
  user-facing or talking to an external service.

Saying so costs one message. It is not an admission that you got something
wrong — every stop is a signal that the `senior` triggers in
[`.claude/agents/task-reviewer.md`](../.claude/agents/task-reviewer.md) missed a
shape, which is the only feedback that gate gets.

Keep the diff scoped to the plan. Anything else you spot becomes step 7.

### 5. Verify it yourself

```sh
make test-all      # == scripts/test.sh. Typecheck + JS + server + engine + CRUD UI + harness.
```

Plus whatever you actually touched:

| If you changed | Also run |
|---|---|
| An MCP tool | `npx tsx dev/try-<tool>.ts` from `packages/engine/mcp-server/` against the live API — write one if it doesn't exist, and run `dev/try-login.ts` first for an authenticated tool. Then read your implementation against `docs/specs/<tool>-tool-spec.md`, quoting both sides. |
| Any file in a skill's run-log **snapshot** — `packages/engine/plugin/skills/<skill>/`, an agent it delegates to, `eval/tests/unit/<skill>/`, or a scenario/fixture it references | `make eval-skill SKILL=<name>`, and commit the run log **and its `.ann.json`**. `check-runlogs.yml` blocks merge otherwise — a comment or a typo counts, because the whole skill dir is in the snapshot. For a behaviour-neutral edit, ask a senior for the `eval-cosmetic-skip` label instead of burning a paid run. Rules and the exact snapshot set: [`eval/CLAUDE.md`](../eval/CLAUDE.md) § "Snapshot model" and § "GitHub Action rules". |
| Plugin agent frontmatter, hooks, or tool binding | `make agent-smoke`. **It exits 0 when it skips**, so confirm the output lists resolved agents rather than `1 skipped` — that means no API key was reachable. |
| An e2e fixture | `make e2e-validate TEST=<slug>` |
| Anything user-facing | Run it. `make server` / `make web`, or the Claude Desktop install path. |

Then exercise the thing you built, once, by hand.

### 6. Review your own diff, in a fresh session

Not the session that wrote the code — it will agree with you. Open a new one,
give it the plan and the diff, and ask:

> Here is the plan and here is the diff. Where do they diverge? What did the
> implementation do that the plan didn't call for, and what did the plan call
> for that isn't here?

You are hunting **implement-vs-plan drift**: code that looks fine and isn't the
code that was agreed. Fix what you find, then read the whole diff yourself.

### 7. File the follow-on work

Everything you decided not to do becomes a GitHub issue, in this PR. The rules
— which label, when to use `icebox`, how short to keep the body, why you must
not run `gh project` — are in [`DEVELOPMENT.md`](../DEVELOPMENT.md) §
"Follow-on work you find along the way".

Don't leave a `TODO` comment and don't start a to-do file. Reference the issue
numbers in your PR description.

### 8. Open the PR

Fill in the template; don't replace it. Don't tick a box for a command you
didn't run — if a check doesn't apply, say why rather than deleting it.

Credit your pair: [`DEVELOPMENT.md`](../DEVELOPMENT.md) § "Crediting a
co-author".

Keep PRs small. A forty-file PR turns both review steps into rubber stamps.

### 9. Peer review, then senior review

Peer review is another developer. Senior review is the lead, and it is the last
gate — by then everything mechanical should be settled, so his time goes to
whether the approach is right.

One or two revision rounds is normal. Three means something upstream was wrong,
usually the plan. Say so rather than grinding through a fourth.

---

## The rule that holds it together

**You must be able to explain every line you're shipping.** Not "Claude wrote it
and the tests pass." If a reviewer asks why a function takes that parameter, or
what happens when that value is null, you need an answer. If you don't have one,
go read it — or ask a senior — before you open the PR. Not knowing is normal and
costs nothing; shipping anyway is the failure.

---

## Reviewing someone else's PR

```sh
gh pr checkout <N>
```

Give Claude the PR description (which has the plan), the diff, and the relevant
spec. Then:

1. **Verify every finding before you post it** — proposals included. Open the
   file and check.
2. **Post it in your own words, and state the edit.** Quote what they wrote,
   give the replacement text. Never paste a Claude review verbatim.
3. **Review against the plan, not just the diff.** Does this implementation
   match what was agreed?

---

## Command card

```sh
# 0. branch
git worktree add .claude/worktrees/<branch> -b <branch> origin/main

# 2. write PLAN.md at the worktree root (gitignored)

# 3. attack the plan (max 2 rounds)
/critique-plan PLAN.md

# 5. verify
make test-all                        # everything; == scripts/test.sh
make eval-skill SKILL=<name>         # anything in a skill's run-log snapshot
make agent-smoke                     # plugin agent frontmatter / hooks / tool binding
make e2e-validate TEST=<slug>        # an e2e fixture changed

# 6. self-review, in a FRESH session
#    → "Here is PLAN.md and the diff. Where do they diverge?"

# 7. follow-on work
gh issue create --label developer --title "…" --body "…"

# 9. review someone else's PR
gh pr checkout <N>
```

## Where to read next

| You need | Read |
|---|---|
| Build, test, and feature-addition recipes | [`DEVELOPMENT.md`](../DEVELOPMENT.md) |
| Which sites a change touches | [`docs/architecture.md`](./architecture.md) |
| The rules that override normal defaults | [`CLAUDE.md`](../CLAUDE.md) |
| Why something is the way it is | [`docs/adrs/`](./adrs/) |
| Improving a skill from eval results | [`docs/skill-lifecycle.md`](./skill-lifecycle.md) |
| Contributing a skill or an MCP server | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
