---
name: audit-merged-prs
description: Use when the lead wants a weekly sample of recently-merged developer PRs that did not require senior review — "audit merged PRs", "spot-check last week's merges", "sample the peer-reviewed PRs", "weekly PR audit", or a bare "/audit-merged-prs". Pulls every developer-labeled PR merged in the last 7 days whose diff touched no `senior-developers`-owned path in `.github/CODEOWNERS`, samples a subset, and runs `/review` against each merge commit to surface what peer review may have missed: design drift, a missed multi-site edit, a check that cannot fail, cost regressions. Reports findings and any pattern worth turning into a new CODEOWNERS path or a `/review` checklist addition. Do NOT use to review a PR before merge (that is `/review`), to decide what the team works on next (`fill-ready`), or to audit the issue board (`audit-board`).
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# Audit merged PRs

`docs/task-lifecycle.md` step 9 requires a `senior-developers` approval only
on the paths `.github/CODEOWNERS` lists as high blast-radius. Everything
else merges on a peer approval alone — which is the point, since one senior
cannot review every PR for 10+ developers and also do strategic work. But a
peer approval is not a senior's judgment, and CODEOWNERS only routes a
senior to paths flagged high-risk *in advance*. It cannot catch a wrong
abstraction, an architectural drift, or a "peer approved it without reading
it closely" pattern on a path nobody flagged.

This skill is that compensating control: the senior's one weekly touchpoint
on the PRs they did not personally gate. Sampling **after** merge, not
gating **before** it, is deliberate — it is what keeps the senior's time
from being re-consumed by the exact bottleneck this whole review split
exists to relieve.

**You propose, then apply what is approved.** No reverts, no follow-up
commits to someone else's merged branch, no re-opening a PR. You have no
`Edit` or `Write` tool on purpose.

**Sample, never audit the full pool.** Reviewing every peer-only-approved
PR every week recreates the original bottleneck one week later. State the
sample size or fraction you used in the report; a lead-set default lives in
§2.

## 0. Pool facts

Repo `PioneerAIAcademy/cowork-genealogy`.

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state merged \
  --label developer --search "merged:>=$(date -d '7 days ago' +%Y-%m-%d)" \
  --limit 100 --json number,title,author,mergedAt,mergedBy,files,reviews,mergeCommit
```

(On macOS/BSD `date`, use `date -v-7d +%Y-%m-%d` instead — the harness this
skill runs in may differ from the lead's shell.)

## 1. Filter to the peer-only pool

Read `.github/CODEOWNERS` fresh every run — **do not hardcode its path list
in this skill file.** CODEOWNERS is the single source of truth for which
paths are `senior-developers`-owned (`docs/task-lifecycle.md` step 9 says
the same); a copy here would drift the moment someone edits the real file.

For each PR in the pool from §0, check whether any file in `.files[].path`
falls under a `senior-developers`-owned path. If yes, drop it — that PR
already got a senior's eyes at merge time via branch protection, and
auditing it again duplicates work rather than covering a gap. Keep only
PRs where **no** file matched a `senior-developers` path.

**Also check `.reviews` for evidence of an actual senior approval**, not
just CODEOWNERS ownership — the bypass-actor pattern documented in this
plan's PR description (two bypass actors on `protect-main` with
`bypass_mode: "always"`) means some PRs merge with `reviewDecision:
REVIEW_REQUIRED`, i.e. no real peer approval either. A PR with zero
reviews is not merely "peer-only" — it is **unreviewed**, and that is a
stronger finding than anything `/review` would surface. Flag these
separately in the report; don't fold them into the ordinary sample silently.

## 2. Sample, don't audit all

Default sample size: **~20% of the week's peer-only pool**, rounded up,
with a floor of 1 and no fixed ceiling — confirm this against the lead's
actual standing preference before the first run, since it is a time
tradeoff only they can size against their available hours.

Bias the sample toward, in this order:

1. **PRs with zero reviews** (from §1) — always include every one of these;
   they are not a sample, they are the finding.
2. **PRs from newer contributors** — cross-reference `.author.login` against
   `gh api repos/PioneerAIAcademy/cowork-genealogy/pulls --state all --json author --jq` history; a contributor with few merged PRs has had less exposure to this repo's own recurring failure modes (CLAUDE.md's multi-site edit lists, the dual/triple-spelled tool-name rule) that senior review would normally have caught them on.
3. **PRs with no review comments at all**, only an approval — the "LGTM
   without reading it closely" pattern; an approval with zero inline
   comments on a non-trivial diff is a weak signal, not proof of a careful
   read.
4. **PRs touching a file three or more other recent PRs have also
   touched** — drift risk; nobody reviewing any single one of them saw the
   cumulative change.

State which of these four reasons pulled each sampled PR into the report —
"random" is not an allowed reason; every inclusion should be traceable to
one of the four, or to being outside the sample and included only because
it was zero-review (which bypasses sampling entirely per point 1).

## 3. Run `/review` against each sampled PR

The PR is already merged, so there is no open branch to check out. Diff the
merge commit against its own first parent:

```sh
git fetch origin main --quiet
git log -1 --format=%P <merge-commit-sha>   # first token is the first parent
git diff <first-parent-sha> <merge-commit-sha>
```

Invoke `/review` against this diff the same way it reviews any PR — this
reuses the existing skill and checklist rather than re-implementing it
(CLAUDE.md § "Code reuse"). Treat its output exactly as `docs/task-lifecycle.md`
§ "Reviewing someone else's PR" already instructs for a live PR: **an
input, verify every finding before repeating it, never paste it verbatim.**

## 4. Report, do not act

Like `audit-board` and `review-icebox`, this skill proposes and never
applies. Specifically:

- **No reverts.** A finding here is retrospective — the PR already merged
  and other work may already build on it. Reverting is the lead's call,
  never this skill's.
- **No follow-up commits** pushed to the author's now-merged branch.
- **No re-opening the PR.**

A confirmed finding becomes one of:

- **A comment on the merged PR**, clearly tagged as retrospective (e.g.
  prefixed `[audit-merged-prs, retrospective]`) so nobody mistakes it for
  an active review blocking anything.
- **A new GitHub issue**, `developer`-labeled, for anything that rises
  above cosmetic — per this repo's "deferring work creates an issue"
  convention (`CLAUDE.md` § "Repository layout").

Confirm with the lead which channel to use before the first real run if it
is not already decided — this skill defaults to "PR comment for anything
the author could plausibly fix in five minutes, issue for anything larger,"
but that split is a proposal, not doctrine.

## 5. Surface patterns across the sample

This is what separates the skill from running `/review` N times by hand.
After all sampled PRs are reviewed, look across them:

- **Do two or more sampled PRs miss the same class of thing?** That is the
  signal the CODEOWNERS path list is incomplete — propose the specific
  path to add, with the evidence (which PRs, which files).
- **Does `/review`'s own checklist need a new category?** If a real bug
  slipped through that `.claude/skills/review/SKILL.md` § "What to look
  for" does not name, propose the addition there — quoting the finding
  that motivated it, per that skill's own confidence-gate discipline.
- **Is the zero-review count from §1 growing or shrinking week over
  week?** A rising count means the bypass-actor pattern is spreading past
  its original cases, which is a process question for the lead, not
  something this skill can act on.

Both proposals are decisions for the lead — list them explicitly, don't
apply them. Adding a CODEOWNERS path or editing `/review`'s checklist is
exactly the kind of change `docs/task-lifecycle.md` step 4 says to route
through a human rather than resolve silently.

## 6. Verify before you repeat anything

Every claim carried into the report — a file path, a PR number, a review
state, a `/review` finding — gets checked against the actual repo or `gh`
output before it is repeated. This matters most for `/review`'s own
findings, which are explicitly "an input to your review, never your
review" per `docs/task-lifecycle.md`; this skill inherits that same
discipline for its own output to the lead.

## Cost

Each `/review` run against a sampled PR is a real Claude Code session cost,
same as any other skill invocation. Unlike the disabled
`claude-code-review.yml` (a shared, recurring managed-service cost that
failed on an expiring token), this has no standing liability — but sampling
N PRs/week is still N sessions/week. State the sample count and an estimate
of session cost in the report so the lead can size the sample deliberately,
rather than defaulting to "review everything," which just re-creates the
time cost this whole review split exists to remove.

## Output shape

1. **Zero-review PRs** — every one from §1, regardless of sample size; the
   strongest finding this skill can surface, and never subject to sampling.
2. **Sampled PRs and why each was pulled in** — one of the four reasons
   from §2, plus the `/review` findings for each, verified per §6.
3. **Cross-cutting patterns** — from §5, only the ones with a real finding
   behind them across two or more PRs.
4. **Decisions for the lead** — new CODEOWNERS paths to consider, `/review`
   checklist additions to consider, and the zero-review-count trend.
5. **What this run cost** — sample size, PRs sampled vs. pool size, session
   count.

Then stop and wait for approval. Apply only what the lead approves — a
`gh pr comment`, a `gh issue create`, or nothing.
