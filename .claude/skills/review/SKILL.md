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

The checklist categories, the confidence gate and the fix-first split are
adapted from gstack (MIT, © 2026 Garry Tan, https://github.com/garrytan/gstack).
The rest is this repo's.

---

## 1. Read the reviews already on the PR

**First, before reading any code.** Humans review here — four different people
on the last five PRs — and their notes are not in the diff.

```sh
PR=<number>; R=PioneerAIAcademy/cowork-genealogy
gh pr view $PR --json title,body,baseRefName,headRefName,headRefOid,reviewDecision,isDraft
gh api repos/$R/pulls/$PR/reviews  --jq '.[] | "\(.user.login) \(.state) @\(.commit_id[0:8])\n\(.body)\n---"'
gh api repos/$R/pulls/$PR/comments --jq '.[] | "\(.user.login) \(.path):\(.line)\n\(.body)\n---"'
gh api repos/$R/issues/$PR/comments --jq '.[] | "\(.user.login)\n\(.body)\n---"'
```

A review's `commit_id` is the commit it read. **Compare it to `headRefOid`.** If
they differ, the review may be answering a diff that no longer exists — say so
rather than treating it as current, and re-check each note against the code as
it stands now. A review whose approval was dismissed by a later push shows as
`reviewDecision: REVIEW_REQUIRED`; the PR needs a fresh one regardless of what
you find.

Every existing note gets one of: **still stands** (fold into your findings),
**already resolved** (say by which commit), or **no longer applies** (say what
changed). Never silently drop one.

## 2. Diff against the merge, not the branch

A branch behind `main` can be green on its own head and red once merged.

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

## 3. Scope check

Read the PR body and `git log origin/main..HEAD --oneline`. State in two lines
what was asked for and what the diff does, then name any file changed that the
stated intent does not explain, and any stated requirement the diff does not
address. Informational — it never blocks.

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

```
Review: PR #N — <branch>, <X> commits behind main

Existing reviews: <who, state, @commit> — <stands / resolved / no longer applies>
Scope: <asked for> → <delivered>
Verified: <suites run, with counts>

[CRITICAL] (N/10) path:line — problem
  <the quoted line>
  Fix: <the change>

[FIXED] path:line — what changed
```

End with what you did not check and why. A review that lists no gaps is
claiming a completeness it did not earn.
