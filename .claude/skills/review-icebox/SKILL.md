---
name: review-icebox
description: Use when the lead wants the icebox pool swept — "review the icebox", "has anything thawed", "check the icebox", "anything in the icebox ready to promote", or a bare "/review-icebox" a couple of times a week. Reviews every open `icebox`-labelled issue in cowork-genealogy and asks one question per item: has anything changed in the repo, the board, or the milestones that makes this candidate real now? Most icebox bodies carry an explicit unblock condition — a trigger to watch, a blocking issue, a gate that must land — so the primary pass is checking those against current state, not aging items out. Verdicts are promote (drop the label so `/fill-ready` ranks it next run), close as not planned, or leave with a reason. Flags any item with no stated trigger, since that is the shape that rots. Proposes first and applies only what the lead approves; never starts the work itself, and never writes the project board.
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# Review the icebox

`icebox` means *a real candidate with no decision behind it*. Those issues are
deliberately held out of `/fill-ready`'s ranking so the daily fill isn't
re-litigating maybes. This skill is the counterweight: run it once or twice a
week so a candidate that has become real waits days, not months.

**You propose, then apply what is approved.** No branches, no PRs, no code edits.
You have no `Edit` or `Write` tool on purpose.

**Never write the project board.** Promotion here means removing a label;
`/fill-ready` moves columns. A `gh` token without the `project` scope fails a
board write while appearing to succeed.

## 0. Pool facts

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**.

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open \
  --label icebox --limit 300 \
  --json number,title,body,createdAt,updatedAt,labels,comments
```

The pool was seeded 2026-08-02 with 17 issues (#1141–#1157). Expect it to grow:
`CLAUDE.md` tells Claude and the junior developers to file follow-on work with
`--label icebox` whenever there is no decision behind it.

**Read the whole pool every run.** It is small, and the point of the exercise is
that a trigger can fire without anyone touching the issue — so `updatedAt` is not
a filter you can trust. If the pool ever exceeds ~40, say so in the report; that
is a signal the `icebox` label is being used as a dumping ground rather than for
genuine candidates.

## 1. The only question

> Has anything changed — in the repo, on the board, in the milestones, or in the
> field — that makes this candidate real now?

Not "is this a good idea." It was already judged a good idea, or it would have
been closed instead of iceboxed. Four things change the answer:

## 2. Trigger fired — the primary pass

Most icebox bodies name their own unblock condition. Check each against current
state, and **quote what you found**. Examples from the seed batch:

| Issue | Stated trigger | How to check it |
|---|---|---|
| #1157 `logIndex` | "File it only if a run is seen failing the cross-check" | Search recent e2e runlogs for a failing log↔assertion cross-check |
| #1150 outage window | "No corpus → close this" | Does a live-project corpus exist yet? |
| #1143 allowlist TOFU | Gated on open signup | Is public signup still a non-goal in `hosted-web-workbench-spec.md`? |
| #1142 `agent-smoke` in CI | Gated on CI holding an Anthropic key | Does any workflow now inject one? |
| #1147 relay compression | Needs genealogist scrutiny | Has that review happened? |

A trigger you cannot check from the repo is itself a finding — say so rather than
guessing, and propose rewriting the trigger into something checkable.

## 3. Blocker landed

Several items name a blocking issue. Resolve each:

```sh
gh issue view <N> --repo PioneerAIAcademy/cowork-genealogy --json state,closedAt,title
```

A closed blocker is the strongest promote signal in the pool — it means the
reason for iceboxing is gone and nobody noticed. Known chains in the seed batch:
**#1155 → #1073**, **#1153 → a retention gate**, **#1154 → the same gate**,
**#1145 → #913**.

Check the reverse too: an item may have acquired a *new* blocker since filing.
That is a leave, with the blocker named.

## 4. Milestone pull

The two committed dates are the in-house beta (Fall 2026) and the public
RootsTech rollout (**2027-03-04**, fixed). An icebox item that now gates either
one is not a maybe any more. Long-lead items are the ones to catch here — a
candidate that takes six weeks and gates a date needs promoting well before it
looks urgent.

## 5. Re-raise signal

If the same idea has come up again independently — a duplicate issue filed, an
alpha feedback case, a runlog showing the failure it predicts, a PR review
raising it — that is evidence the icebox call was wrong. Say where it resurfaced.

This is worth a real check, not a formality: the relay-compression idea (#1147)
had already been independently re-proposed once before it was iceboxed, which is
exactly what a recorded rejection is supposed to prevent.

## 6. Verdicts

One per item. Most runs, most items are **leave** — say it in one line and move
on. A long report means either the pool is genuinely thawing or the label is
being misapplied.

**Promote** — the candidate is real; `/fill-ready` should rank it from now on:

```sh
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --remove-label icebox
gh issue comment <N> --repo PioneerAIAcademy/cowork-genealogy \
  --body "Promoted out of the icebox: <what changed>."
```

Confirm the item still carries `developer` or `genealogist` — without one,
`/fill-ready` cannot route it and it lands in neither pool. Add the missing label
in the same edit.

**Close** — the premise is gone, the trigger can never fire, or it was superseded:

```sh
gh issue close <N> --repo PioneerAIAcademy/cowork-genealogy \
  --reason "not planned" --comment "<why>"
```

Reversible, and it preserves the rationale. Prefer it to leaving something in the
pool that everyone silently agrees is dead. **Deletion is irreversible and needs
the lead to say so for that specific issue** — never batch it, never infer it.

**Leave** — with the reason, in one line. If the reason is the same as last time,
that is fine and expected; do not manufacture a change.

## 7. No stated trigger

An icebox item whose body names no unblock condition has nothing to review
against, so it will be "leave" forever by default. That is the shape that rots.

Flag every one of them and propose the fix: either write a checkable trigger into
the body, or close it. Do not let the category grow silently — a pool where most
items have no trigger has become a to-do file with a URL, which is the failure
the repo's retired staging queue was closed for.

## 8. Verify before you repeat anything

An issue body is **a claim written on a particular day**, not current repo state.
Before repeating any factual claim from a body — a file path, a line number, a
measurement, a tool's behaviour — check it. Several seed issues already carry
figures that drift (skill body sizes, test counts, tool counts).

Cite what you verified, in the form `path:line` or a command and its output. If
you could not verify something, say so rather than repeating it with confidence.

## Output shape

1. **Thawed** — items to promote, most consequential first: issue, what changed,
   the evidence for it, and which `/fill-ready` pool it lands in. Empty is a
   perfectly good answer; say "nothing thawed" and why that is unsurprising.
2. **Close** — with the one-line reason each.
3. **Still frozen** — one line per item: the trigger, and that it has not fired.
   Keep it terse; this is the bulk of the pool and it should read as a checklist,
   not an analysis.
4. **No trigger** — items needing a trigger written or a close decision.
5. **Pool health** — size, oldest item, how many have no trigger, and whether the
   label looks like it is being used as a dumping ground.

Then stop and wait for approval. Apply only what he approves. Do not begin any of
the work.
