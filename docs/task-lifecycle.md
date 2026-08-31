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

Two of them ship with Claude Code: `/code-review` and `/security-review`. The
other four ship with this repo, so cloning is the whole install —
`/critique-plan` and `/check-drift` in
[`.claude/commands/`](../.claude/commands/), `/review` and `/audit-merged-prs`
in [`.claude/skills/`](../.claude/skills/). Nothing here needs a plugin you have
to install.

If you have a personal plugin that defines one of these names, yours wins. Most
people don't — but if `/review` ever behaves unlike what's described here,
that's the first thing to check.

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
> blocks in `docs/architecture.md`, and `CLAUDE.md`. Also check whether any open
> PR already touches the files I'll change (`gh search prs`, or `gh pr list`) —
> a collision on a shared file means a rebase later, so flag it now. Summarize
> what you found in a few sentences. Then ask me the questions where a different
> answer would change what you build — skip anything with an obvious default,
> make the call and tell me what you chose.

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
go to the lead** — the task is underspecified, or a sub-scope should be split
into its own issue. Either way it's a task decision, not something a third
round of planning will fix.

**Check each finding before acting on it.** Some will be wrong. Open the file,
run the command, confirm the claim. This covers what the critic *proposes* as
much as what it criticizes: a suggested command, flag, or file name that you
repeat unchecked reads like an established thing to whoever you hand it to.

### 4. Implement

**If reality contradicts the plan, stop and re-plan.** Write the deviation into
`PLAN.md` — a sentence is enough — then continue, and carry it into the PR's
**Deviated from the plan** line at step 8. Both, because they have different
readers: `PLAN.md` is what step 6's drift check reads, and it is gitignored, so
it never reaches your reviewer. An undocumented deviation is invisible to
exactly the person whose job is catching it.

**Stop and go to the lead** — don't re-plan around it — if the change turns out
to do any of these:

- Changes `research.json` or simplified-GedcomX **schema** — a new field, a new
  value on a closed enum, or a tree-shape change. Site lists:
  [`CLAUDE.md`](../CLAUDE.md) § "Researcher profile in `research.json`".
- Touches `packages/engine/mcp-server/src/auth/`, or anything holding a credential.
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

### 6. Review your own diff

Two checks. The first needs a session that didn't write the code — open a new
terminal tab in the same folder and start `claude`. The second brings its own.

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

**Drift.** No bug-finder checks this — `/code-review` asks whether the code is
wrong, not whether it is the code you agreed to write. Normal tier only; Trivial
tasks have no plan to drift from.

```
/check-drift
```

It reads `PLAN.md` and your full diff against `main`, and reports what the
implementation did that the plan didn't call for, what the plan called for that
isn't there, and anything that contradicts it. Unlike `/code-review` it runs in
a read-only subagent, so it starts fresh wherever you invoke it — the authoring
session is fine.

You are hunting **implement-vs-plan drift**: code that looks fine and isn't the
code that was agreed. Verify each finding as in step 3, fix what's real, then
read the whole diff yourself.

Arrive at step 9 with this done. A reviewer's round should go to whether the
approach is right, not to what a free command would have caught.

### 7. Fold in what you can, then file the rest

**Fold first.** Most of what you turned up belongs in this PR, not in a new
issue — you have the context loaded and whoever picks up a ticket has to rebuild
it from nothing. An issue costs four people: someone to vet it, someone to
implement it, and two reviewers. Walk the steps in CLAUDE.md's "Work you find
along the way" and stop at the first that fits: fix it here, drop it if it's a
nit, or comment on the issue that already covers it. Filing is the last resort,
and it needs one of the four exemptions named there — in both the PR body and
the issue body.

What's genuinely left over becomes a GitHub issue, in this PR. Have Claude file
them:

> For each thing we decided not to do, first tell me whether it could be folded
> into this PR instead — name the files and roughly the lines. For the ones that
> genuinely can't, file a GitHub issue with `gh issue create`. A few sentences
> each: what the work is, why it's still open, and which CLAUDE.md exemption
> puts it out of scope for this PR. Open the body with a `**Touches:**` line
> naming the files it would change. Label it `developer` if it has a mechanical
> pass/fail — lints, CI, validators, harness/Python, MCP tools, refactors,
> tooling bugs — or `genealogist` for fixture adjudication, run-log annotation,
> record research, doctrine prose. Add `icebox` as well if it's a maybe rather
> than a decision. Don't run any `gh project` command.

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

Keep PRs small. A forty-file PR turns both review steps into rubber stamps.

### 9. Peer review, then senior review — on the paths that need it

Peer review is another developer, and it is now **sufficient to merge** on
files no rule in [`.github/CODEOWNERS`](../.github/CODEOWNERS) claims.
Senior review is a member of either senior team, or the lead, and branch
protection requires one on code and infrastructure file types —
`.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`/`.py`/`.json`/`.yml`/`.yaml`, repo-wide —
plus the genealogist-authored trees (plugin skills, plugin agents, eval
fixtures and tests, run logs), which are claimed by name so they stay
senior-reviewed where they happen to be `.py`, `.json`, or otherwise one of
those extensions.

**Every rule names both senior teams, so a senior of either kind can approve
any of it.** The team a rule names FIRST is the one whose judgment the path
normally wants — `.ts`/`.py`/`.json` and friends to `senior-developers`, the
skill, agent and eval trees to `senior-genealogists`. So the working split is
still **genealogists review skills and runlogs; developers review
infrastructure**; what the second team on each line buys is that a PR is never
stuck waiting on one specific team when a senior is already reading it. By the
time a senior looks at a PR everything mechanical should be settled, so their
time goes to whether the approach is right.

**Getting a senior to look is the author's job.** CODEOWNERS requests review
from both senior teams when the PR opens, so it is already in their GitHub
review-request queue; say when it is actually ready. There is no bot that
labels a PR ready and no queue to wait in.

**CODEOWNERS is the source of truth for which paths need a senior, not this
paragraph.** Read the file rather than trusting a path list here — it can
drift out of sync with what's actually enforced and this one can't.

**The senior developers are volunteers.** Their time is the scarcest thing in
this process. Turning up with `make test-all` green, `/code-review` run, and its
findings resolved is what keeps that gate spent on judgment.

**One senior approval covers a PR that spans both kinds of file.** GitHub
resolves CODEOWNERS per file, not per PR, and a rule's owners are an OR — so
a PR changing a `.ts` tool implementation alongside a `SKILL.md` is unblocked
by one approval from either senior team. It will carry both queue labels,
because each queue shows the paths it owns; that is a routing signal, not two
outstanding requirements.

**Peer-only merges aren't reviewed by a senior zero times — they're sampled
after merge, not before.** `/audit-merged-prs` is the lead's weekly pass
over recently-merged, peer-only-approved developer PRs: it samples a subset
and runs `/review` against each merge commit to catch what peer review
alone tends to miss — design drift, a missed multi-site edit, a check that
cannot fail. It reports and files issues; it never reverts or re-opens a
merged PR.

**Automatic Claude review is off** (`.github/workflows/claude-code-review.yml`,
disabled 2026-08-03) and this plan does not turn it back on. Nothing
reviews your PR before a human opens it, so step 6 is the only pass it
gets — arrive with it done. Peer review via `/review`, senior review on
CODEOWNERS-listed paths, and `/audit-merged-prs`'s weekly sampling are the
chosen replacement for the disabled bot, not another automated first pass.

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
3. **Review against what was agreed, not just the diff.** `/review` reads the
   diff; it can't tell you whether that was the right change to make. The PR's
   Summary, "Start here", and Plan sections are where the author says what they
   set out to do. Give Claude those, the issue, and the relevant spec, then ask
   directly: does this implementation match what was agreed, and what does it do
   that nobody asked for?
4. **Two things aren't yours to approve.** A diff that hits step 4's stop rule —
   schema, credentials, an ADR reversal, anything hard to undo — needs the lead,
   whatever the code looks like. And check `.github/CODEOWNERS`: on the paths it
   lists, your approval doesn't unblock merge. Say which is still owed rather
   than leaving the author to discover it at the merge button.
5. **Pushing a small fix to their branch is fine.** It costs nobody a
   reapproval: a push doesn't clear the approvals already on the PR, and nothing
   is required after it. That cuts both ways — whatever you push merges unread,
   so push only what you'd approve on sight, and leave anything bigger to the
   author.

### "It says approved, but it won't merge"

Three rules can each hold a green, approved PR. Check them in this order:

- **An unresolved conversation.** Every review thread must be marked resolved.
  Resolve the ones you answered; the reviewer resolves the ones they raised.
- **No senior has approved yet.** On the paths `.github/CODEOWNERS` claims, one
  of the two approvals must come from a senior team — either one. Four approvals
  from four juniors is still zero against that rule.
- **A review request left over from an older CODEOWNERS.** Owners are computed
  when the PR opens; editing `.github/CODEOWNERS` later never re-runs against an
  open PR, and GitHub never withdraws a request it has already made. So a PR can
  sit showing a team that owns none of its files. Check the current file before
  believing the request, and clear a dead one with
  `gh api -X DELETE /repos/{owner}/{repo}/pulls/{n}/requested_reviewers -f 'team_reviewers[]=<team>'`.

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

# 6. self-review
/code-review high                    # bugs; in a FRESH session — it forks the one it runs in
/check-drift                         # PLAN.md vs the diff; own subagent, so any session

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
