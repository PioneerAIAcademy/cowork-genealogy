---
name: review-ready
description: Use when the lead wants tasks vetted before juniors start them — "review the Ready column", "vet these before I hand them out", "are these tasks still a good idea", "review what fill-ready just promoted", "check the junior queue", or a bare "/review-ready". The gate between fill-ready (which ranks and promotes) and standup (which hands work out). Fans out one read-only task-reviewer agent per candidate issue, in parallel, each in fresh context — every agent reads the issue's cited code, the matching docs/architecture.md "If you're asked to…" block, §9.4's what-nothing-checks list, and the relevant ADRs, then returns a verdict, the exact body text to add, and any decision only the lead can make. Collates the verdicts, puts the strategic questions to the lead, and applies only what he approves. Never starts the work, and never promotes or demotes a board item itself.
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash
  - Read
  - Grep
  - Glob
---

# Review the Ready column before juniors start

`fill-ready` decides what the team starts. This decides whether those issues are
**safe to hand to a junior working with Claude Code**, whose failure mode is a
green, plausible, wrong PR rather than a stalled one.

**You propose, then apply what is approved.** No branches, no PRs, no code
edits, no eval runs, and no board moves — promotion and demotion belong to
`fill-ready`. What you apply is issue-body text and, when approved, an
assignee.

## 0. Board facts

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**.

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1000
```

## 1. Pick the candidates

Default, when invoked bare: **unassigned `developer`-labeled items in Ready.**
Those are the junior pool by definition — nobody is on them, and whoever picks
one reads only that issue.

Other entry points:

- **Issue numbers as arguments** (`/review-ready 945 1031 1094`) — review exactly
  those, in any column.
- **Straight after `fill-ready`** — review what it just proposed, before the lead
  approves the promotions. Its verdicts then feed back into that decision.
- **`--all`** — include unassigned `genealogist` items. Off by default: their
  failure mode is adjudication quality, not a wrong merge, and it is caught
  downstream by review rather than by CI.

**Cap the fan-out at 12 per run.** Above that, take the ones nobody has reviewed
before, oldest first, and **say in the report exactly which candidates you did
not review** — a silent cap reads as "everything is clear" when it is not.

Skip an item and say why when: it already carries a `task-reviewer` verdict in a
comment and its body has not changed since; or its body is empty (that is a
`fill-ready` rewrite verdict, not a review).

## 2. Fan out — one agent per issue, all in one message

Launch every `task-reviewer` **in a single message with multiple tool uses** so
they run concurrently. One agent per issue, never one agent for several: fresh
context per issue is what stops issue 7's reasoning contaminating issue 8's.

Each agent gets only:

```
Review issue #<N> in PioneerAIAcademy/cowork-genealogy for handoff to a junior
developer working with Claude Code. Follow your instructions exactly and return
your report in the specified format.
```

Do **not** pass your own opinion of the issue, its board rank, or another
agent's findings. An agent told what to expect finds it.

Do not review the issues yourself while the agents run. Wait.

## 3. Collate

Read every report. Then, in your own voice:

- **Group by verdict**, most consequential first: `close` and `stale-rewrite`
  (the board is wrong), then `senior` and `needs-a-decision` (the routing is
  wrong), then `ready-after-edit`, then `ready`.
- **Cross-check the agents against each other.** They ran blind, so two agents
  proposing edits to the same file, or naming the same open PR, is a collision
  neither could see. Say so.
- **Do not re-argue a verdict you have not checked.** If one looks wrong, spend
  the two minutes to verify it and say what you found — do not soften it.
- **Count the routing damage.** How many unassigned `developer` items in Ready
  turned out to be `senior` or `needs-a-decision`? That number is the report's
  headline: it is how much of the junior pool was not actually pickable, and it
  is the argument for whatever `fill-ready` does next week.

## 4. Put the decisions to the lead

Every `needs-a-decision` verdict becomes a real question, with the options the
agent found and its recommendation. Use `AskUserQuestion`, at most four at a
time, most consequential first. Anything beyond four goes in the report as a
numbered list for him to answer in prose.

A question is worth asking here only if the answer **changes what the junior
builds**. A choice with a conventional default is not a question — state the
default you are assuming and move on.

## 5. Apply what he approves

Per-verdict, and only after he says so:

```sh
# ready-after-edit — put the agent's text into the body
gh issue view <N> --repo PioneerAIAcademy/cowork-genealogy --json body -q .body > body.md
# edit body.md, then:
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --body-file body.md

# senior — the lead's, per fill-ready §6
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --add-assignee DallanQ

# close
gh issue close <N> --repo PioneerAIAcademy/cowork-genealogy \
  --reason "not planned" --comment "<why>"
```

Three rules on the writes:

- **Edit the body, not a comment.** The junior reads the body. A finding in a
  comment thread is a finding that evaporates.
- **Prepend, never replace.** Keep the original text below your addition, so the
  next reader can see what the issue asked for before the review touched it.
- **Board moves are `fill-ready`'s.** A `senior` verdict on an item sitting in
  the unassigned pool is reported and assigned; moving it back to Backlog is a
  `fill-ready` swap, and saying so is the whole handoff.

Deleting an issue needs the lead to say so for that specific issue. Never batch
a delete under a general approval.

## Output shape

1. **Headline** — how many candidates, how many came back not-pickable
   (`senior` + `needs-a-decision`), and how many you did not get to.
2. **Not-pickable** — the `senior` and `needs-a-decision` items, each with the
   one-line reason and where it should go instead.
3. **Wrong on the board** — `close` and `stale-rewrite`, with the evidence.
4. **Body edits proposed** — a table: issue, verdict, the one-clause reason, and
   what the edit adds (missing sites / the instrument / the hidden cost / the
   inoculating sentence). Full text below the table, not in it.
5. **Clean** — the `ready` items, one line each including the one thing each
   agent would still improve.
6. **Cross-issue** — collisions the individual agents could not see, and any open
   PR touching the same files.
7. **Questions** — via `AskUserQuestion`, then the overflow as a numbered list.

Then stop. Apply only what he approves.
