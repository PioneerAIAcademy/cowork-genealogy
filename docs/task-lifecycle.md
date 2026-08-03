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

---

## Ask early

**When you aren't confident, ask a senior. At any step, about anything.** A
question you can't answer, a mechanism you don't understand, a finding you can't
tell is real, a task that is turning out bigger than it looked — all of it. Ask
while you're still deciding, not after you've built. Post a message to the
familysearch channel.

Asking doesn't hand the task back — it stays yours. (Step 4's stop rule is the
one that hands it back.)

Two things worth knowing:

- **A senior is cheaper the earlier you ask.** Five minutes before you plan beats
  a review round on a branch built the wrong way, which beats three revision
  rounds in step 9.
- **Claude will not stall on the thing you're unsure about.** It will pick,
  confidently, and its choice will look settled in the diff. So resolve it with a
  human before it becomes code, not after.

---

## The commands in this document

Every slash command below ships with Claude Code, except `/critique-plan`, which
lives in this repo at [`.claude/commands/`](../.claude/commands/). Nothing here
needs a plugin you have to install.

If you have a personal plugin that defines one of these names, **yours wins** —
which is worth knowing before you wonder why `/review` did something else.

---

## The loop

### 0. Create a branch

```sh
git fetch origin
git checkout -b <branch> origin/main
```

Never work on `main`. One task, one branch, one PR.

### 1. Have Claude read the ground

Issue bodies here are pointers, not briefings — most of what you need is in the
specs and the code. Don't go read it all yourself; have Claude do it:

> Read GitHub issue #N and the code it touches. Also read: the spec in
> `docs/specs/` if one covers what I'm changing, the "If you're asked to…"
> blocks in `docs/architecture.md`, and `CLAUDE.md`. Summarize what you found in
> a few sentences. Then ask me the questions where a different answer would
> change what you build — skip anything with an obvious default, make the call
> and tell me what you chose.

Read the issue yourself too, and read Claude's summary. You should be able to
say what the task is in a sentence before you plan it.

### 2. Write the plan to a file

`PLAN.md` at the repo root. It is gitignored; don't commit it. Four things:

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

**Stop and go to the lead** — don't re-plan around it — if the change turns out
to do any of these:

- Changes `research.json` or simplified-GedcomX **schema** — a new field, a new
  value on a closed enum, or a tree-shape change. Site lists:
  [`CLAUDE.md`](../CLAUDE.md) § "Researcher profile in `research.json`".
- Touches `packages/engine/mcp-server/src/auth/`, or anything holding a credential.
- Widens what a Cowork plugin agent is allowed to call — the `tools:` or
  `disallowedTools:` lists in `packages/engine/plugin/agents/`. Editing an
  agent's prompt is ordinary work; changing its permissions is not.
- Reverses something in [`docs/adrs/`](./adrs/) or contradicts a `CLAUDE.md` rule.
- Is hard to undo: a data migration, a write to user state, anything
  user-facing or talking to an external service.

Saying so costs one message, and it isn't a mark against you — it means the task
was scoped from something the issue didn't say.

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
| An HTTP route or `apps/server/` auth/allowlist code, anything that reads a token or writes to `~/.familysearch-mcp/`, or anything that renders user-supplied data in the viewer | `/security-review` |

Then exercise the thing you built, once, by hand.

### 6. Review your own diff, in a fresh session

Not the session that wrote the code — it will agree with you. Open a new
terminal tab in the same folder, start `claude`, and do both halves there.

**Bugs.** In the fresh session:

```
/code-review high
```

It reads your branch's commits ahead of upstream plus anything uncommitted. Run
it in the fresh session and not the authoring one: in a terminal it forks the
session it is invoked from, so from the authoring session it inherits the
reasoning it is supposed to be checking.

**Check each finding before you act on it**, exactly as in step 3 — `high` casts
a wider net than `low` or `medium` and includes findings it is less sure of.
Don't pass `--fix`: you have to be able to explain every line you ship, and
those edits also land outside `/rewind`. Don't pass `--comment` either — review
comments go up in your own words.

**Drift.** No bug-finder checks this. You don't have to paste anything — the
fresh session is on your branch and can read both sides off disk:

> Read `PLAN.md`, then read my full diff against `main` — committed and
> uncommitted. Where do they diverge? What did the implementation do that the
> plan didn't call for, and what did the plan call for that isn't here?

You are hunting **implement-vs-plan drift**: code that looks fine and isn't the
code that was agreed. Fix what you find, then read the whole diff yourself.

Arrive at step 9 with this done. A reviewer's round should go to whether the
approach is right, not to what a free command would have caught.

### 7. File the follow-on work

Everything you decided not to do becomes a GitHub issue, in this PR. Have Claude
file them:

> File a GitHub issue with `gh issue create` for each thing we decided not to
> do. A few sentences each: what the work is, and why it's still open. Label it
> `developer` if it has a mechanical pass/fail — lints, CI, validators,
> harness/Python, MCP tools, refactors, tooling bugs — or `genealogist` for
> fixture adjudication, run-log annotation, record research, doctrine prose. Add
> `icebox` as well if it's a maybe rather than a decision. Don't run any
> `gh project` command.

The board takes care of itself — a workflow files the card. Don't leave a `TODO`
comment and don't start a to-do file. Put the issue numbers in your PR
description; the lead reads every issue.

### 8. Open the PR

Fill in the template; don't replace it. Don't tick a box for a command you
didn't run — if a check doesn't apply, say why rather than deleting it.

**"Start here" is the line that earns its keep.** A diff is flat — that line is
what tells a reviewer, human or model, which few lines carry the decision among
the ones that carry the mechanics. Write it for someone who has not seen your
branch.

Credit your pair: [`DEVELOPMENT.md`](../DEVELOPMENT.md) § "Crediting a
co-author".

Keep PRs small. A forty-file PR turns both review steps into rubber stamps.

### 9. Peer review, then senior review

Peer review is another developer. Senior review is a senior developer or the
lead, and it is the last gate — by then everything mechanical should be settled,
so their time goes to whether the approach is right.

**The senior developers are volunteers.** Their time is the scarcest thing in
this process. Turning up with `make test-all` green, `/code-review` run, and its
findings resolved is what keeps that gate spent on judgment.

`.github/workflows/claude-code-review.yml` posts an automated pass on every PR. Treat it as a peer
whose findings you verify, not a gate — it can be wrong, and a senior's review
still has to happen.

One or two revision rounds is normal. Three means something upstream was wrong,
usually the plan. Say so rather than grinding through a fourth.

---

## Know what you're shipping

Be ready to explain your diff. A reviewer will ask things like why a function
takes that parameter, or what happens when that value is null — "Claude wrote it
and the tests pass" isn't an answer.

So before you open the PR, read the diff and pick out anything you couldn't
explain. Ask Claude to walk you through it; ask a senior if that doesn't settle
it. Not knowing is normal. Opening the PR without finding out is the problem.

---

## Reviewing someone else's PR

```sh
gh pr checkout <N>
```

For a fast first pass, `/review <N>` reads the PR once, read-only. Treat what it
returns as an input to your review, never as your review.

1. **Verify every finding before you post it** — proposals included. Open the
   file and check.
2. **Post it in your own words, and state the edit.** Quote what they wrote,
   give the replacement text. Never paste a Claude review verbatim.
3. **Review against the plan, not just the diff.** `/review` can't see the plan.
   Give Claude the PR description (which has it), the diff, and the relevant
   spec, then ask directly: does this implementation match what was agreed?

`.github/workflows/claude-code-review.yml` has already posted an automated pass on the PR. Read it
before you start — but verify anything you repeat, the same as your own
findings, and don't treat it as having covered the ground you're responsible
for.

---

## Tagging `@claude` on an issue or PR

Writing `@claude <instruction>` runs Claude Code in CI against this repo. It
works in an issue comment, an issue body or title, a PR review comment, and a PR
review body. It can read the code and the CI results for that PR, reply in
thread, and push a branch.

```text
@claude why is `runlogs` failing on this PR?
@claude update this PR's description to match the final diff
```

Use it for a question you would otherwise answer by hand, and for mechanical
edits. Don't use it to implement a task — a task goes through the loop above,
starting at step 0 with a branch and a plan.

Each tag bills a shared subscription seat, so it costs the team whether or not
the answer was useful. One tag with the whole question beats five refining it.

Config: [`.github/workflows/claude.yml`](../.github/workflows/claude.yml).

---

## Command card

```sh
# 0. branch
git fetch origin && git checkout -b <branch> origin/main

# 2. write PLAN.md at the repo root (gitignored)

# 3. attack the plan (max 2 rounds)
/critique-plan PLAN.md

# 5. verify
make test-all                        # everything; == scripts/test.sh
make eval-skill SKILL=<name>         # anything in a skill's run-log snapshot
make agent-smoke                     # plugin agent frontmatter / hooks / tool binding
make e2e-validate TEST=<slug>        # an e2e fixture changed
/security-review                     # route, auth, token, or user state touched

# 6. self-review, in a FRESH session — not the one that wrote the code
/code-review high                    # bugs; verify each finding, no --fix/--comment
#    → "Read PLAN.md and my full diff against main. Where do they diverge?"

# 7. follow-on work — ask Claude to file it; don't run gh yourself
#    → "File a GitHub issue for each thing we decided not to do. Label it
#       developer or genealogist. Don't run any gh project command."

# 9. review someone else's PR
gh pr checkout <N>
/review <N>                          # one read-only pass; an input, not your review

# any time — runs Claude in CI, bills a shared seat
@claude <instruction>                # in an issue or PR comment
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
