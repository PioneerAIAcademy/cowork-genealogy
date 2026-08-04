---
name: review
description: Use before merging a PR in this repo — "review this PR", "review #1219", "code review", "check my diff", "is this ready to merge", or a bare "/review". Reads the reviews already on the PR (a teammate's, not just a bot's), diffs the branch against the merge with main rather than against its own head, applies the structural checklist below, and verifies every claim by running the real suites — including breaking a new lint to watch it fail. Reports findings, applies the mechanical fixes, and asks about the rest. Do NOT use to vet an issue before work starts (that is review-ready), to audit the whole board (audit-board), or to interpret an eval run (interpret-e2e-result). Never merges.
allowed-tools:
  - AskUserQuestion
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
---

# Pre-merge PR review

Find what tests do not catch, then prove each finding by running something.

**You report and fix; you never merge.** `gh pr merge` is the lead's. Push only
what the author approves, and only to their branch.

**Scope: one PR's diff.** For uncommitted work use `/code-review`; for a deep
cloud pass use `/code-review ultra`. Anything the user adds after the number
(`/review 1219 focus on the schema half`) is an instruction — honour it on top
of the passes below, never instead of them.

The checklist categories, the confidence gate and the fix-first split are
adapted from gstack (MIT, © 2026 Garry Tan, https://github.com/garrytan/gstack);
the PR-context fields and the no-checkout fallback from Claude Code's built-in
`/review`. The rest is this repo's.

---

## 1. Read the reviews already on the PR

**First, before reading any code.** Humans review here — four different people
on the last five PRs — and their notes are not in the diff.

With no PR number: `gh pr list` and ask which one. Do not guess from the
current branch.

```sh
PR=<number>; R=PioneerAIAcademy/cowork-genealogy
gh pr view $PR --json title,body,author,state,isDraft,labels,baseRefName,headRefName,\
headRefOid,reviewDecision,mergeStateStatus,isCrossRepository,additions,deletions,changedFiles
gh api repos/$R/pulls/$PR/reviews  --jq '.[] | "\(.user.login) \(.state) @\(.commit_id[0:8])\n\(.body)\n---"'
gh api repos/$R/pulls/$PR/comments --jq '.[] | "\(.user.login) \(.path):\(.line)\n\(.body)\n---"'
gh api repos/$R/issues/$PR/comments --jq '.[] | "\(.user.login)\n\(.body)\n---"'
```

`additions + deletions` and `changedFiles` size the passes below. `author` and
`isCrossRepository` say whether this is a teammate's branch or a fork — a fork
cannot be checked out as a local branch, see §2. `labels` carry this repo's
routing (`developer` / `genealogist`, and `eval-cosmetic-skip`, which bypasses a
run-log gate and is worth a second look when present).

A review's `commit_id` is the commit it read. **Compare it to `headRefOid`.** If
they differ, the review may be answering a diff that no longer exists — say so
rather than treating it as current, and re-check each note against the code as
it stands now. A review whose approval was dismissed by a later push shows as
`reviewDecision: REVIEW_REQUIRED`; the PR needs a fresh one regardless of what
you find.

Every existing note gets one of: **still stands** (fold into your findings),
**already resolved** (say by which commit), or **no longer applies** (say what
changed). Never silently drop one.

## 2. Pick the depth, then get the diff

**Full pass** is the default. **Short pass** — §1, §3, §5, §6, §7, §8, skipping
the worktree, the test-merge and the suites — when *all* of these hold:

- under 50 changed lines, **and**
- no file under `packages/`, `apps/`, `eval/harness/`, `scripts/` or
  `.github/workflows/`, **and**
- nothing that a lint or a test reads: no schema, no `manifest.json`, no
  `SKILL.md`, no agent `.md`, no fixture, no run log.

Prose-only and docs-only PRs are the case this exists for. **Say which pass you
ran, in the report.** If any condition is unclear, run the full pass — the cost
of being wrong here is a gate that did not fire.

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
not explain, and any stated requirement the diff does not address. Informational
— it never blocks.

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

A fresh worktree has no compiled engine output, so harness tests fail there
until `npm run build` has run in `packages/engine/mcp-server` — environmental,
not a regression.

**A new lint must be watched failing.** Break the thing it claims to catch, run
it, paste the failure, restore. A lint nobody has seen fail is not evidence.
Say plainly when you skipped this.

## 5. What to look for

Read the whole diff first. Do not flag anything the diff already fixes.

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
- Agent `tools:`/`disallowedTools:` entries not dual-spelled.
- A `research.json` or tree-schema change that misses one of its edit sites.
- Docs that describe changed behaviour and were not updated.
- Duplicated logic where something equivalent already exists (CLAUDE.md
  § "Code reuse").
- **Cost, in the two places it is real here.** An MCP tool called once per item
  where a batched call exists — that is what regressed e2e latency when
  `materialize_facts` shipped unbatched. And prose added to a `SKILL.md` or an
  agent body, which is billed on every run of that skill forever; ~98% of e2e
  wall-clock is model generation, so a paragraph is not free. Ordinary
  application-code micro-performance is not worth a finding.

**Do not flag:** harmless redundancy that aids readability; "add a comment
explaining this threshold"; tightening an assertion that already covers the
behaviour; consistency-only edits; eval threshold changes.

## 6. Confidence, and the gate on it

Score every finding 1–10 and show it: `[CRITICAL] (8/10) path:line — problem`.

**Quote the line that motivates it, or do not report it.** "Field X doesn't
exist" requires quoting the class body where it would live. "This could be
null" requires quoting the initialisation. A finding you cannot anchor to
`file:line` plus its verbatim text is unverified: drop it to 4–5 and leave it
out of the main report. Do not inflate the score to get around this.

9–10 means you read the code and can demonstrate the bug. 7–8 is a strong
pattern match. 5–6 ships with "verify this is real". Below 5 stays out.

## 7. Fix, then ask

Apply the mechanical fixes directly — dead code, a wrong path, a missing
`encoding="utf-8"`, a stale comment contradicting the code. One line each:
`[FIXED] path:line — what changed`.

Everything else goes to the author in one `AskUserQuestion`: anything touching
behaviour, any design call, anything over ~20 lines, and every critical finding.
Give the recommended fix in full so the answer is yes or no.

Work in the PR's worktree, never on `main`. Leave the changes uncommitted unless
the author asks you to push — and if they do, push to their branch, never
force, and never merge.

## 8. Report

Sections and bullets, in this order. A junior should be able to act on it
without opening the diff.

```
Review: PR #N — <branch>, <full pass | short pass>, <X> commits behind main

Does: <what the diff actually does, 1-2 lines>
Intent: <what it was for> — <matches / drifts, how>
Existing reviews: <who, state, @commit> — <stands / resolved / no longer applies>
Verified: <suites run, with counts — or "not run", and why>

[CRITICAL] (N/10) path:line — problem
  <the quoted line>
  Fix: <the change>

[FIXED] path:line — what changed
```

End with what you did not check and why — a short pass, a skipped suite, a fork
you could not check out, a finding you could not anchor. A review that lists no
gaps is claiming a completeness it did not earn.
