---
name: review
description: Use before merging a PR in this repo — "review this PR", "review PR 1219", "code review", "check my diff", "is this ready to merge", or a bare "/review". Reads the PR and its CI checks, diffs the branch against the merge with main rather than against its own head, applies the structural checklist below, and verifies every claim by running the real suites — including breaking a new lint to watch it fail. Read-only: it writes the edits out for you to post in your own words, and never touches the code. Do NOT use to vet an issue before work starts (that is review-ready), to audit the whole board (audit-board), or to interpret an eval run (interpret-e2e-result). Never edits, never merges.
allowed-tools:
  - AskUserQuestion
  - Bash
  - Read
  - Grep
  - Glob
---

# Pre-merge PR review

Find what tests do not catch, then prove each finding by running something.

**Read-only. You never edit the code and you never merge.** What this produces
is an *input* to your review, not your review: you post it in your own words
(`docs/task-lifecycle.md` § "Reviewing someone else's PR"). Never paste this
output verbatim.

**Scope: one PR's diff.** For uncommitted work use `/code-review`; for a deep
cloud pass use `/code-review ultra`. Anything the user adds after the number
(`/review 1219 focus on the schema half`) is an instruction — honour it on top
of the passes below, never instead of them.

The checklist categories and the confidence gate are adapted from gstack (MIT,
© 2026 Garry Tan, https://github.com/garrytan/gstack); the PR-context fields and
the no-checkout fallback from Claude Code's built-in `/review`. The rest is this
repo's.

---

## 1. Read the PR and its checks — not the reviews yet

**Deliberately not the existing reviews.** Reading a teammate's "approved" before
you have formed your own view is how a second review becomes an echo of the
first. They come back in §7, after your findings exist.

With no PR number: `gh pr list` and ask which one. Do not guess from the
current branch.

```sh
PR=<number>; R=PioneerAIAcademy/cowork-genealogy
gh pr view $PR --json title,body,author,state,isDraft,labels,baseRefName,headRefName,\
headRefOid,reviewDecision,reviewRequests,mergeStateStatus,isCrossRepository,\
additions,deletions,changedFiles
gh pr checks $PR                      # did CI pass on THIS head?
```

**Read the PR body's template fields before the diff.** **Start here** names
where the real decision lives. **Unsure about** is the highest-signal line on the
page and the one most often skipped — whatever the author could not resolve is
where the bug is. **Didn't change**, **Acceptance check** and **Deviated from the
plan** are what you review against; `PLAN.md` is gitignored, so those lines are
the only form the plan reaches you in. An empty **Acceptance check**, or one that
says "the tests pass", is itself a finding.

`additions + deletions` and `changedFiles` size the passes below. `author` and
`isCrossRepository` say whether this is a teammate's branch or a fork — a fork
cannot be checked out as a local branch, see §2. `labels` carry this repo's
routing (`developer` / `genealogist`, and `eval-cosmetic-skip`, which relaxes the
run-log gate, is senior-only, and is worth a second look when present).

**A red or missing check outranks anything you find by reading.** The required
ones are `pytest`, `runlogs`, `e2e-fixtures`, `vitest`, `lockfile-drift`, `scan`.
Report any that failed, and any that never ran on the current head — a check that
did not run is not a check that passed.

**Then check whether a review round is already open, and stop if it is.** A
second review is for a PR whose first round has been answered — not a second
opinion delivered on top of an unaddressed one.

```sh
gh api repos/$R/pulls/$PR/reviews \
  --jq '[.[] | select(.state != "COMMENTED")] | group_by(.user.login) | map(last)
        | .[] | "\(.user.login) \(.state)"'
gh api graphql -F owner=PioneerAIAcademy -F name=cowork-genealogy -F number=$PR -f query='
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100){ pageInfo{hasNextPage} nodes{ isResolved } } } } }' \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length'
```

If any reviewer's latest standing is `CHANGES_REQUESTED`, or any review thread is
unresolved, **stop**. Report which, and that the PR is not ready for another
review. Reviewing anyway produces a second copy of findings the author has not
answered yet, and spends the scarcer reviewer to do it.

Unresolved threads block merge here too (ruleset `protect-main`,
`required_review_thread_resolution: true`), so stopping is not what keeps a
half-answered PR out of `main` — it is what keeps the second reviewer from
spending a pass on findings nobody has answered. An outstanding
`CHANGES_REQUESTED` blocks neither, which is why you check both.

This does not apply when you *are* the first review: no prior standing, nothing
to wait on, carry on.

These two queries return review **states and counts, never bodies**. That is
deliberate — knowing a round is open costs you nothing, whereas reading what the
last reviewer concluded before forming your own view is the anchoring problem
above. The bodies wait until §7.

**Say who still has to approve — and work it out from the paths, not from
`reviewRequests`.** That field is computed when the PR is opened or pushed to,
not read live, so it lags any CODEOWNERS change until someone pushes again.
Read `.github/CODEOWNERS`, match it against the changed paths (last rule wins),
and treat `reviewRequests` as a hint that may be stale. Your approval may not be
the one that unblocks merge, and saying so is part of the review. Confirm the
owners actually resolve:

```sh
gh api repos/$R/codeowners/errors --jq '.errors[] | "line \(.line): \(.kind) — \(.source)"'
```

An `Unknown owner` line means that path's review requirement is silently not
enforced. Report it.

## 2. Pick the depth, then get the diff

**Full pass** is the default. **Short pass** — §1, §3, §5, §6, §7, §8, §9,
skipping the worktree, the test-merge and the suites — only when **both** hold:

- under 50 changed lines, **and**
- every changed path is under `docs/` or a top-level `*.md`, and none is under
  `packages/`, `apps/`, `eval/`, `scripts/` or `.github/`.

Run `git diff --name-only $DIFF_BASE` and check the list; do not decide from
memory of what the PR is "about". Prose-only PRs are the case this exists for.
**Say which pass you ran, in the report.** If anything is unclear, run the full
pass — the cost of being wrong here is a gate that did not fire.

Anything else: a branch behind `main` can be green on its own head and red once
merged, so review the merge.

```sh
git fetch origin main --quiet
git worktree list | grep <branch> || git worktree add .claude/worktrees/pr$PR <branch>
cd .claude/worktrees/pr$PR
git rev-list --count HEAD..origin/main        # commits behind
DIFF_BASE=$(git merge-base origin/main HEAD)
git diff "$DIFF_BASE" --stat && git diff "$DIFF_BASE"
```

If the branch is behind at all, **test-merge before trusting any suite**:

```sh
git merge origin/main --no-commit --no-ff    # resolve conflicts only far enough to run
<run the suites from §4>
git merge --abort
```

This is not optional caution. PR #1219 passed 261/261 on its own head while a
lint it added went red against `main`.

**A fork PR (`isCrossRepository: true`) has no local branch.** Fetch it into one
rather than skipping the merge check:

```sh
git fetch origin pull/$PR/head:pr-$PR && git worktree add .claude/worktrees/pr$PR pr-$PR
```

If even that is unavailable — no checkout of this repo to hand — fall back to
`gh pr diff $PR` for the diff, and this for surrounding code (the API returns
base64, so the decode is not optional):

```sh
gh api "repos/$R/contents/<path>?ref=<sha>" --jq '.content' | base64 -d
```

Then say plainly in the report that §2 and §4 did not run. An unverified review
is worth having; one that hides that it is unverified is not.

## 3. Say what it does, then what it was for

Read the PR body and `git log origin/main..HEAD --oneline`, then open the report
with one or two lines on **what this PR actually does** — written from the diff,
not from the PR body. Getting that wrong in public is the cheapest possible
signal that the rest of the review is unreliable, which is why it goes first.

Then compare it to the stated intent: name any file changed that the intent does
not explain, and any stated requirement the diff does not address. Check it
against **Acceptance check** and **Didn't change** specifically — a diff that
touched the thing the author said they left alone is a finding. Informational —
it never blocks.

## 4. Verify by running, not by reading

Never write "tests cover this" or "this is probably fine". Run it, or mark it
unverified.

```sh
cd packages/engine/mcp-server && npx vitest run            # engine
cd packages/engine/mcp-server && npx tsc --noEmit -p tsconfig.json
npx turbo test typecheck --force                           # web workspace
cd eval/harness && uv run --frozen pytest -q               # harness
cd apps/server && uv run pytest -q                         # control plane
```

A fresh worktree has no compiled engine output, so `eval/harness`'s CLI tests
fail there until `npm run build` has run in `packages/engine/mcp-server` —
environmental, not a regression. The `post-checkout` hook links the rest.

**"Pre-existing failure" is not a finding and not an excuse.** A test that does
not run is indistinguishable from a test that passes. Diagnose it to a cause —
missing build, a dependency in `package.json` but not installed, a stale
lockfile — and say what the cause is. If you cannot, say the suite is unverified
and why.

**Every number you report is a claim.** Counts, "N call sites affected", "this
is the only consumer" — run the query that covers the whole set before writing
it down, and check a `--limit` against the returned length. A truncated list
reads exactly like a complete one.

**A new lint must be watched failing.** Break the thing it claims to catch, run
it, paste the failure, restore. A lint nobody has seen fail is not evidence.
Note that most lints read the working tree, not the commit, so an untracked file
can mask the failure you are trying to demonstrate. Say plainly when you skipped
this.

**One run, not three.** If a suite result looks like sampling noise, that is
itself the finding — the test is too sensitive and needs an issue. Never ask an
author to re-run a paid eval to settle it. If a re-run genuinely is needed, name
the **directory** it must run from (almost always the PR's worktree, not the
primary checkout) alongside the command; a run from the wrong tree produces a
run log that matches a different tree state and wastes the run.

## 5. What to look for

Read the whole diff first. Do not flag anything the diff already fixes.

**Stop and go to the lead** — these are not yours to approve, whatever the diff
looks like. Say so in the report and name which one:

- Changes `research.json` or simplified-GedcomX **schema** — a new field, a new
  value on a closed enum, or a tree-shape change.
- Touches `packages/engine/mcp-server/src/auth/`, or anything holding a
  credential.
- Reverses something in `docs/adrs/` or contradicts a `CLAUDE.md` rule.
- Is hard to undo: a data migration, a write to user state, anything
  user-facing or talking to an external service.

These mirror step 4 of `docs/task-lifecycle.md`, where the *author* is told to
stop. The finding is the diff doing one of them while the PR's **Deviated from
the plan** line is silent — meaning nobody raised it.

**Critical**

- **Enum and value completeness.** A new enum value, status or type constant
  must be traced through every consumer — `Grep` for its siblings and *read*
  each hit. In this repo one enum change touches `enums.schema.json` in both
  schema trees, the TS union in `packages/schema/src/index.ts`, `CLOSED_ENUMS`
  in `validator.ts`, and the prose tables. See CLAUDE.md § "Researcher profile".
- **LLM output trust boundary.** Model-generated values written to
  `research.json` or the tree without shape or enum validation.
- **A check that cannot fail.** A lint, guard or test that passes in the case it
  exists to catch — a stale allow-list, an unreachable regex, an early `return`
  that skips the assertion, a `|| true` on the one command that matters. This is
  the highest-value finding in this repo and the easiest to miss, because it
  looks exactly like coverage.
- **Shell and subprocess.** `shell=True` with interpolation; `eval`/`exec` on
  model output.
- **Race conditions.** Read-check-write with no atomic guard.

**Informational**

- Python file I/O missing `encoding="utf-8"` — every `open`/`read_text`/
  `write_text`, tests included. Breaks the Windows genealogists.
- Skill scripts that need the network, or non-stdlib imports (the VM has
  neither).
- Agent `tools:` entries missing any of the three server spellings. (No agent
  declares `disallowedTools:` — a deny only restates the omission, and one that
  names a granted tool can make the runtime refuse the agent.)
- A `research.json` or tree-schema change that misses one of its edit sites.
- Docs that describe changed behaviour and were not updated.
- Prose added to a doc juniors read (`DEVELOPMENT.md`, `docs/task-lifecycle.md`,
  README-style guides) whose whole job is justification — history, what-we-tried,
  why-it-is-this-way. Rationale belongs in an ADR or a spec. A clause that
  changes what the reader *does* stays.
- An ADR amended by strikethrough or a dated "update" section instead of being
  rewritten to say what is true now — and any `Alternatives considered` row
  deleted rather than demoted into.
- Duplicated logic where something equivalent already exists (CLAUDE.md
  § "Code reuse"), or a second mechanism doing a job the first already does.
- **Cost, in the two places it is real here.** An MCP tool called once per item
  where a batched call exists — that is what regressed e2e latency when
  `materialize_facts` shipped unbatched. And prose added to a `SKILL.md` or an
  agent body, which is billed on every run of that skill forever; ~98% of e2e
  wall-clock is model generation, so a paragraph is not free. Ordinary
  application-code micro-performance is not worth a finding.

**Do not flag:** harmless redundancy that aids readability; "add a comment
explaining this threshold"; tightening an assertion that already covers the
behaviour; consistency-only edits; eval threshold changes.

**Never propose git ceremony.** Not "split this into two PRs", not "move that
hunk to its own branch", not an integration branch, not a follow-on PR. If good
work in one PR spans two issues, the issues merge — the PR does not split. And a
small related fix belongs *in this PR*, not in an issue filed against it: the
branch is already open and already being reviewed. File an issue only for work
that is genuinely large, blocked, or needs a decision nobody here can make.

## 6. Confidence, and the gate on it

Score every finding 1–10 and show it: `[CRITICAL] (8/10) path:line — problem`.

**Quote the line that motivates it, or do not report it.** "Field X doesn't
exist" requires quoting the class body where it would live. "This could be
null" requires quoting the initialisation. A finding you cannot anchor to
`file:line` plus its verbatim text is unverified: drop it to 4–5 and leave it
out of the main report. Do not inflate the score to get around this.

9–10 means you read the code and can demonstrate the bug. 7–8 is a strong
pattern match. 5–6 ships with "verify this is real". Below 5 stays out.

## 7. Now read the reviews already on the PR

Your findings exist; reconcile them.

```sh
gh api repos/$R/pulls/$PR/reviews  --jq '.[] | "\(.user.login) \(.state) @\(.commit_id[0:8])\n\(.body)\n---"'
gh api repos/$R/pulls/$PR/comments --jq '.[] | "\(.user.login) \(.path):\(.line)\n\(.body)\n---"'
gh api repos/$R/issues/$PR/comments --jq '.[] | "\(.user.login)\n\(.body)\n---"'
```

Every existing note gets one of: **still stands** (fold into your findings),
**already resolved** (say by which commit), or **no longer applies** (say what
changed). Never silently drop one.

A review's `commit_id` is the commit it read. **Compare it to `headRefOid`.** If
they differ, say which commit the approval read and re-check each note against
the code as it stands now.

One ruleset setting decides what a stale approval is worth here, and it is
permissive. `dismiss_stale_reviews_on_push: false` means a push does **not**
clear existing approvals — they keep counting toward the two required, and
nothing re-requests review. **Nothing takes their place.** An approval that read
a commit three pushes ago still clears the merge gate, and the merge box says
approved.

So the `commit_id` check above is the only thing standing between a stale
approval and main. Run it on every approval on the PR, not just the ones you
doubt, and report each one whose commit is not `headRefOid` — naming what
landed after it that nobody has read.

## 8. Write the edits — don't make them

**You do not touch the branch.** No commits, no pushes, no fixes applied in
passing, not even a typo. Every finding leaves here as text the author can act
on.

State each one as a diff, including the mechanical ones:

```
You wrote:      <the line, verbatim>
Change it to:   <the exact replacement text>
```

Two quotes, no paragraph between them explaining the gap. If you cannot write
the replacement line, you do not understand the change well enough to ask for
it — say that instead of describing the problem around it.

**Mergeability is the filter.** Before including a finding, ask whether it blocks
merge. If it doesn't, cut it. Nits read as gatekeeping and bury the one thing
that actually has to change. The reader is a junior developer working with Claude
Code: short sentences, one idea each, no file:line asides in the prose, no
internal mechanism names they will not act on.

**Leave your verification evidence out of the author's copy.** The reproduction,
the mutation check, the counts — those belong in the report to whoever asked for
the review. The author needs the delta.

Use one `AskUserQuestion` only if a finding turns on a design call the reviewer
cannot make alone.

## 9. Report

Sections and bullets, in this order. A junior should be able to act on it
without opening the diff. Label every `#NNN` as **issue #N** or **PR #N** —
GitHub draws both from one number sequence, and a bare number sends the reader
to the wrong list.

```
Review: PR #N — <branch>, <full pass | short pass>, <X> commits behind main

Does: <what the diff actually does, 1-2 lines>
Intent: <what it was for> — <matches / drifts, how>
Checks: <pass/fail per required check, and any that did not run on this head>
Still needs: <code-owner teams GitHub is waiting on, or "nothing">
Verified: <suites run, with counts — or "not run", and why>
Existing reviews: <who, state, @commit> — <stands / resolved / no longer applies>

[LEAD] path:line — <which stop-rule condition, and whether the PR declared it>

[CRITICAL] (N/10) path:line — problem
  You wrote:    <the quoted line>
  Change it to: <the replacement>
```

When §1's gate stopped you, the whole report is four lines — do not pad it out
with a review you were told not to do:

```
Review: PR #N — not ready for a second review.

Open round: <reviewer> requested changes @<commit> / <N> unresolved threads
Waiting on: the author
Re-run this once they have answered it.
```

End with what you did not check and why — a short pass, a skipped suite, a fork
you could not check out, a finding you could not anchor. A review that lists no
gaps is claiming a completeness it did not earn.
