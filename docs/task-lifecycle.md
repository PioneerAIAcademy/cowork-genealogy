# Task lifecycle — how a developer task gets done here

**Audience:** developers on this project working with Claude Code.
**Scope:** developer tasks — code, tools, tests, CI, tooling. If your task is
improving a skill's prose from eval results, follow
[`docs/skill-lifecycle.md`](./skill-lifecycle.md) instead; that loop is
different and it wins for skill work.

The short version:

> **Plan before you code. Have the plan attacked before you code. Verify your
> own work before you ask anyone to look at it. Never ship a line you can't
> explain.**

Everything below is detail on those four.

---

## Why this shape

Working with Claude changes where the expensive mistakes happen. Writing code
is no longer the slow part; *deciding what code to write* is, and a wrong
decision now gets implemented very fast and very completely. A plan that is
wrong in one sentence becomes a branch that is wrong in forty files.

So the process front-loads scrutiny. The cheapest place to kill a bad approach
is a paragraph in a plan. The second cheapest is your own review of your own
diff. Peer review is third, and the lead's review is last and most expensive —
by the time it reaches him, everything mechanical should already be settled.

The second thing that changes: Claude is a fast, confident, and occasionally
wrong collaborator. Every step below that says "have Claude do X" is paired
with a step that says "and then check it." That pairing is the whole method.
Drop the checking half and this process is worse than no process, because it
produces work that *looks* reviewed.

---

## Pick a tier first

Not every task earns the same ceremony. Decide which of these you're in before
you start — and say which one in your PR description, so your reviewer knows
what they're getting.

| Tier | What it is | What you do |
|---|---|---|
| **Trivial** | Typo, comment, doc link, version bump, deleting dead code, a one-line fix with an obvious cause | Skip the plan. Make the change, run the tests, self-review, open the PR. Peer review still applies. |
| **Normal** | Most tasks. A bug fix, a new test, a tool change, a refactor inside one module | The full loop below. |
| **Risky** | See the trigger list | The full loop, **plus** the plan goes in a file and the lead reviews it *before* you write code. |

**A task is Risky if it does any of these:**

- Changes `research.json` or simplified-GedcomX **schema** — a new field, a new
  value on a closed enum, or a tree-shape change. These have fixed multi-site
  edit lists in [`CLAUDE.md`](../CLAUDE.md); getting one site wrong breaks
  writer tools silently.
- Touches **auth** (`packages/engine/mcp-server/src/auth/`) or anything holding
  a credential.
- Changes **agent frontmatter**, `tools:`/`disallowedTools:`, hooks, or
  anything that decides which tools an agent can reach. This is the class of
  change that has broken production while CI stayed green.
- Adds a **new MCP tool**, or changes an existing tool's contract.
- Is **cross-cutting** — more than about three modules, or both the engine and
  the web side.
- **Reverses a decision** already recorded in [`docs/adrs/`](./adrs/), or
  contradicts a rule in `CLAUDE.md`.
- Is **hard to undo**: a data migration, anything that writes user state,
  anything user-facing or that talks to an external service.

When in doubt, it's Risky. The cost of over-classifying is one extra review of
a document; the cost of under-classifying is discovering the problem in
production.

---

## The loop

### 0. Take the issue, and branch in a worktree

Work happens on a branch in a worktree, never on `main`:

```sh
git worktree add .claude/worktrees/<branch> -b <branch> origin/main
```

The `post-checkout` hook links the shared gitignored files for you
(run `make install-hooks` once per clone if you haven't). One task, one
worktree, one PR. Two tasks in one branch means one reviewer has to hold both
in their head, and neither gets reviewed properly.

### 1. Read the ground, not just the ticket

Issue bodies here are deliberately thin — the project's convention is that
rationale lives in specs and in comments at the site it constrains, *not* in
the issue. So an issue is a pointer, not a briefing. Before planning, read:

- the issue,
- the spec, if the thing you're touching has one under
  [`docs/specs/`](./specs/),
- [`docs/architecture.md`](./architecture.md) — its "If you're asked to…"
  blocks tell you which sites your change touches,
- [`CLAUDE.md`](../CLAUDE.md) — project rules that override normal defaults,
- and the actual code.

Point Claude at all of it. Then **ask it to ask you questions.** Word it so you
get the useful ones:

> Read this issue, the spec, and the code it touches. Before proposing
> anything, ask me the questions where a different answer would change what
> you build. Skip anything with an obvious default — make the call and tell
> me what you chose.

That last sentence matters. Without it you get twelve questions of which ten
have obvious answers, you rubber-stamp all twelve, and the exercise taught you
nothing.

### 2. Write the plan

The plan is the artifact the rest of the process operates on. Four things,
always:

1. **What changes** — the actual file list. Not "update the validator," but the
   path.
2. **What doesn't change** — the tempting adjacent thing you're deliberately
   not touching. This is what stops scope creep during implementation.
3. **The acceptance check** — how we will know it worked, as something a
   person can run. The strong form is a *named test that fails today and
   passes after*. "The tests pass" is not an acceptance check; the tests pass
   right now.
4. **What you're deferring** — the things you'll file as issues in step 7.

**Where it lives**, by tier:

- **Normal:** the plan goes in the PR description when you open it. That's what
  lets a reviewer check the diff against your *intent* instead of guessing at
  it.
- **Risky:** a real file under [`docs/plan/`](./plan/), reviewed by the lead
  before you write code. Note the conventions on that directory: its
  `**Status:**` line is load-bearing, and the plan is **deleted when the work
  ships** — the spec and the code become the record. If the decision has a
  rejected alternative behind it, it wants an ADR too; see
  [`docs/adrs/README.md`](./adrs/README.md).

A plan that stays in the chat window doesn't exist. Nobody else can see it, so
nobody can catch you having built something else.

### 3. Attack the plan

Hand the plan to the `plan-critic` subagent:

> Use the plan-critic agent to review this plan.

It reads the plan *and the code the plan claims to touch*, and reports findings
with a severity and a concrete replacement. Its highest-value check is the
dullest one: verifying that every file, function, field, and command the plan
names actually exists. Plans written from an issue body invent call sites
constantly, and it is a cheap thing to catch and an expensive thing to miss.

**Two rounds maximum.** Round one finds real problems. Round two confirms
they're fixed and usually finds one more. Round three finds style opinions and
makes the plan longer without making it better — and reviewers, human or
otherwise, drift toward agreeing with whatever's in front of them the third
time they see it.

**If round two still returns a BLOCKING finding, stop and go to the lead.**
Two rounds of unresolved blocking findings is not a plan problem, it's a task
problem — the task is underspecified or the approach is wrong, and another
round of polishing won't fix either.

Read the findings yourself before acting on them. Some will be wrong. Deciding
which is part of the job, and it's the part that teaches you the codebase.

### 4. Implement

Then, and only then, write the code.

**One rule during implementation: if reality contradicts the plan, stop and
re-plan.** You will discover that the function doesn't work the way you
thought, or that the fix needs a change in a third module. That is normal. What
is not acceptable is quietly improvising around it — because your reviewer is
reviewing against the plan, and an undocumented deviation is invisible to
exactly the person whose job is to catch it. Update the plan (a sentence in the
PR body is enough for Normal tier), then continue.

Keep the diff scoped to the plan. If you spot something else worth fixing, it
becomes an issue in step 7, not a hitchhiker in this PR.

### 5. Verify it yourself

This step is not optional, and it is the one most often skipped. Your peer
reviewer is not your test suite.

```sh
make test-all        # typecheck + every suite; this is the floor
```

Plus whatever your change actually touches:

| If you changed | Also run |
|---|---|
| An MCP tool | `packages/engine/mcp-server/dev/try-<tool>.ts` against the live API, and re-read the tool's spec under `docs/specs/` against your implementation — quote both sides |
| A skill's `SKILL.md` | `make eval-skill SKILL=<name>` — and follow [`docs/skill-lifecycle.md`](./skill-lifecycle.md), which is the real process for this |
| Agent frontmatter, hooks, or tool binding | `make agent-smoke` — the only check that reads what the runtime actually resolved. No CI job covers this path. |
| An e2e fixture | `make e2e-validate TEST=<slug>` |
| Anything user-facing | Actually run it. `make server` / `make web`, or the Claude Desktop install path. |

Then **exercise the thing you built**, once, by hand. Not because the tests
might be wrong — because they might not be testing what you think.

### 6. Review your own diff, in a fresh session

The session that wrote the code is the worst available reviewer of it. It is
anchored on its own reasoning, it believes the plan was followed because it
believes it followed the plan, and it will confirm both if you ask.

So open a **new** session, give it the plan and the diff, and ask:

> Here is the plan and here is the diff. Where do they diverge? What did the
> implementation do that the plan didn't call for, and what did the plan call
> for that isn't here?

You can also run `/code-review` on the branch. Either way, you're hunting one
specific thing: **implement-vs-plan drift**. It is the most common failure mode
in agent-assisted work and it is nearly invisible in a diff read on its own,
because the code looks fine — it's just not the code that was agreed to.

Fix what you find. Then read the whole diff yourself, top to bottom.

### 7. File the follow-on work

Everything you decided not to do becomes a GitHub issue, in this PR:

```sh
gh issue create --label developer --title "…" --body "…"
```

- `--label developer` for anything with a mechanical pass/fail;
  `--label genealogist` for fixture adjudication, record research, doctrine
  prose.
- Add `--label icebox` if it's a maybe. The test: would you do it given a free
  afternoon? If yes it's not icebox.
- **Creating the issue is the whole job.** A CI workflow adds it to Backlog.
  Do not run `gh project` commands — a token without the `project` scope fails
  the board write *while still creating the issue*, which looks like it worked.
- Keep the body short: what the work is, and enough of why it's still open that
  nobody re-opens a settled question. Reasoning goes in the spec or a comment
  at the line it constrains — nobody re-reads an issue body after triage.
- **Reference the numbers in your PR description**, so your reviewer can see
  what you chose not to do.

**Don't leave a `TODO` comment instead.** A TODO isn't a queue — nobody is
assigned to it and nobody reads it. Same reason `docs/TODOs.md` was retired
(2026-08-02, after it reached 932 lines and 54 unassignable items). Don't
recreate that file under any name.

And don't over-file. Fifteen issues from one PR isn't thoroughness, it's noise
that someone has to triage. Use the free-afternoon test.

### 8. Open the PR

The description carries:

- **The tier** you picked.
- **The plan** (Normal tier) or a link to it (Risky tier).
- **What you verified** — which commands you ran, what you exercised by hand.
- **The follow-on issue numbers.**

Credit your pair in the commit — the GitHub **username**, bare, as the last
line:

```
Co-authored-by: their-github-username
```

We squash-merge, so your local commits are the only place that credit can come
from. A `commit-msg` hook and a CI check both nudge (neither blocks). AI
co-authors don't satisfy it — the point is recording the human.

Keep PRs small. A forty-file PR from one agentic session is not reviewable, and
an unreviewable PR silently cancels both of the review steps that follow.

### 9. Peer review, then senior review

**Peer review** is another developer on the team. **Senior review** is the
lead, and it's the last gate for developer tasks. By the time it gets to him,
everything mechanical — tests, spec compliance, style, plan drift — should
already be resolved. His time goes to whether the approach is right.

Expect revision rounds. One or two is normal. Three is a signal that something
upstream was wrong: usually the plan, sometimes the task. Say so rather than
grinding through a fourth.

---

## The rule that holds it together

**You must be able to explain every line you're shipping.**

Not "Claude wrote it and the tests pass." If a reviewer asks why a function
takes that parameter, or what happens when that value is null, you need an
answer. If you don't have one, you're not ready to open the PR — go read it,
and ask Claude to explain the parts you can't account for.

This is the load-bearing rule, and it's the reason the whole process works. The
lead can only be the last gate if everything before it was genuinely checked by
someone who understood it. A developer who becomes a conduit — passing Claude's
output to review without understanding it — moves all the real review onto one
person and quietly removes their own name from the work.

---

## Using Claude to review someone else's PR

You should. Just don't let it review *for* you.

```sh
gh pr checkout <N>
```

Then give Claude the PR description (which has the plan), the diff, and the
relevant spec, and ask for findings with severity and a suggested replacement.
`/code-review` does this on the current branch.

Three rules:

1. **Verify every finding before you post it.** Claude review output has false
   positives — a claim about a function three files away that turns out to be
   wrong, an "unhandled case" that's handled upstream. Open the file and check.
   Posting unverified findings wastes the author's time and burns your
   credibility fast.
2. **Post it in your own words, and state the edit.** Quote what they wrote,
   give the replacement text. "This will throw when `standardPlace` is
   unresolvable — resolve it before the map, or guard at line 40" beats a
   paragraph describing the shape of the problem. Never paste a Claude review
   verbatim; the author can run that themselves.
3. **Review against the plan, not just the diff.** You have their plan in the
   PR body. Ask the same question you ask of your own work: does this
   implementation match what was agreed?

The peer review that catches the most is usually the least clever one: read the
plan, read the diff, and ask what's in one and not the other.

---

## Failure modes to watch for

Every one of these has happened somewhere, to someone competent.

- **The plan lives only in chat.** Nobody can check the implementation against
  it, so nobody does.
- **Round three of plan review.** The plan gets longer, not better.
- **Skipping step 5** and letting the peer reviewer find that it doesn't build.
- **Reviewing your own diff in the session that wrote it.** It will agree
  with you.
- **Letting Claude apply review comments without re-reading the result.** The
  fix for one comment routinely breaks the thing another comment was about.
- **The hitchhiking refactor.** "While I was in there." It doubles the diff and
  hides the actual change.
- **"Claude said it was fine."** Not a review. Not a defense.
- **Filing fifteen follow-on issues** because it's one command.
- **A forty-file PR.** Both review steps become rubber stamps and everyone
  involved knows it.

---

## Command card

```sh
# 0. branch
git worktree add .claude/worktrees/<branch> -b <branch> origin/main

# 3. attack the plan (max 2 rounds)
#    → "Use the plan-critic agent to review this plan."

# 5. verify
make test-all                        # floor, always
make eval-skill SKILL=<name>         # a SKILL.md changed
make agent-smoke                     # agent frontmatter / hooks / tool binding
make e2e-validate TEST=<slug>        # an e2e fixture changed
cd packages/engine/mcp-server && npx tsx dev/try-<tool>.ts   # an MCP tool changed

# 6. self-review, in a FRESH session
/code-review

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
