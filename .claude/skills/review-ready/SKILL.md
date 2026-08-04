---
name: review-ready
description: Use when the lead wants tasks vetted before juniors start them — "vet these before I hand them out", "are these tasks still a good idea", "is this safe for a junior", "review the fill-ready shortlist", "check the junior queue", or a bare "/review-ready". The gate between fill-ready (which ranks and promotes) and standup (which hands work out). Fans out one read-only task-reviewer agent per candidate issue, in parallel, each in fresh context — every agent reads the issue's cited code, the matching docs/architecture.md "If you're asked to…" block, §9.4's what-nothing-checks list, and the relevant ADRs, then returns a verdict, the exact body text to add, and any decision only the lead can make. Collates the verdicts, puts the strategic questions to the lead, and applies only what he approves. Do NOT use to choose what the team works on, to rank the Backlog, or to move anything on the board — that is fill-ready, which calls this skill on its shortlist. Never starts the work.
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash
  - Read
  - Grep
  - Glob
---

# Review tasks before juniors start them

`fill-ready` decides what the team starts. This decides whether those issues are
**safe to hand to a junior working with Claude Code**, whose failure mode is a
green, plausible, wrong PR rather than a stalled one.

Rationale, contracts, measurements and rejected alternatives:
`docs/specs/task-review-spec.md`. Read it before changing this skill or the
agent; do not re-derive what it settles.

**You propose, then apply what is approved.** No branches, no PRs, no code
edits, no eval runs, and no board moves — promotion and demotion belong to
`fill-ready`. What you apply is issue-body text, the `reviewed` label, and when
approved an assignee.

## 0. Board facts

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**.

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1000
```

## 1. Pick the candidates

**The normal case is `fill-ready`'s shortlist, before it promotes.** Its verdicts
feed that decision: a `senior` or `needs-a-decision` item never enters the
unassigned pool, so it is never promoted and then swapped back out. Reviewing
after promotion costs the same issue two deep reads — see the spec, §2.

Other entry points:

- **Issue numbers as arguments** (`/review-ready 945 1031 1094`) — review exactly
  those, in any column. This is also how a re-review is asked for.
- **Bare `/review-ready`** — the standing pool: unassigned `developer`-labeled
  items in Ready. A first run, or a run after a gap.
- **`--all`** — also include unassigned `genealogist` items. Off by default
  because the three passes are developer-shaped; the reason and what would change
  it are in the spec, §6. Say so if asked rather than re-arguing it.

### Review on entry, not daily

**Skip an item that already carries the `reviewed` label.** The board read in §0
answers this for every candidate at once — this is the whole standing-pool query:

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1000 | jq -r '
  .items[]
  | select(.status == "Ready" and (.assignees | length) == 0
           and (.labels | index("developer"))
           and ((.labels | index("reviewed")) | not))
  | .content.number'
```

Steady state is then the three to five items `fill-ready` shortlisted that
morning, not the pool. Getting this wrong costs ~110k tokens per needlessly
re-reviewed issue.

Also skip, and say why: a body that is empty or a single line. That is a
`fill-ready` rewrite verdict, not a review.

**Cap the fan-out at 20 per run** — one full standing pool. The cap binds only on
a first run or after a gap; the steady-state delta never approaches it. When it
does bind, take the unreviewed ones oldest first, and **say in the report exactly
which candidates you did not review** — a silent cap reads as "everything is
clear" when it is not.

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

Each agent returns its decisions already shaped for `AskUserQuestion` — header,
question, options with the consequence that decides each, recommended first.
**Pass them through verbatim.** Do not rewrite an option's description into your
own words: the agent read the spec, the ADRs and the code, and you did not.

Then do the three things it could not, because it saw one issue:

- **Merge identical forks.** When two issues ask the same question, ask it once
  as policy — one question, two issues unblocked.
- **Rank across issues**, not within one. `AskUserQuestion` takes four at a time;
  the fifth onward goes in the report as a numbered list to answer in prose.
- **Drop what the answer would not change.** A choice with a conventional default
  is not a question — state the default you are assuming and move on.

Settle the smaller forks yourself and list them as assumptions with "say if any
is wrong."

## 5. Apply what he approves

Per-verdict, and only after he says so. **Every verdict has a write** — a verdict
you cannot act on silently does nothing:

```sh
# ready-after-edit / needs-a-decision / stale-rewrite — put the agent's text in
gh issue view <N> --repo PioneerAIAcademy/cowork-genealogy --json body -q .body > body.md
# edit body.md, then:
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --body-file body.md

# senior — the lead's, per fill-ready §6. The label already exists and is in use;
# it is what makes the routing visible on the board rather than only in your report.
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy \
  --add-label senior --add-assignee DallanQ

# close
gh issue close <N> --repo PioneerAIAcademy/cowork-genealogy \
  --reason "not planned" --comment "<why>"

# every verdict except close, last — this is what §1 skips on next run
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --add-label reviewed
```

**Add the `reviewed` label last**, after the body write lands. Labelling first and
failing on the body leaves an issue that looks vetted and is not.

One-time, if the label does not exist yet:

```sh
gh label create reviewed --repo PioneerAIAcademy/cowork-genealogy \
  --description "Vetted by task-reviewer before junior handoff" --color 0E8A16
```

**For a `needs-a-decision` issue, splice in the chosen option's pre-written body
text.** The agent wrote one block per option precisely so this step is mechanical.
Do not compose your own version of the decision — you did not do the reading, and
a vague paragraph here is what makes Claude Code guess.

Two cases where it is not a splice:

- **He picked against the recommendation, and the agent flagged that option as
  changing the blast radius.** Re-run one `task-reviewer` on that issue alone,
  telling it the decision, and use what comes back. The site list it wrote was
  computed under a different assumption.
- **He answered something no option covered.** Same — re-run one agent with his
  answer, rather than guessing at the body text.

Five rules on the writes:

- **Edit the body, not a comment.** The junior reads the body. A finding in a
  comment thread is a finding that evaporates.
- **Prepend, never replace — except `stale-rewrite`.** Keep the original text
  below your addition under an `## Original issue` heading. A `stale-rewrite`
  replaces the ask, because the premise moved and the ask is now wrong; it keeps
  the original under the same heading.
- **Open the body with the marker**, for the junior who picks it up:

  ```
  > **Reviewed <YYYY-MM-DD> before junior handoff.** <one clause: decision
  > settled / no decision needed / premise was false>; the original body follows
  > under "Original issue".
  ```

  This is prose for a reader, not state. What §1 skips on is the `reviewed`
  label, so a later edit that displaces this line breaks nothing.
- **Carry the rationale to the destination the agent named** — a spec section, a
  comment at the constraining site. It is part of the task, not a nicety;
  `CLAUDE.md` keeps settled tradeoffs out of issue bodies for a reason.
- **Board moves are `fill-ready`'s.** On the normal path a `senior` verdict comes
  back before promotion, so there is nothing to move — you label and assign, and
  `fill-ready` ranks it into the lead's pool instead of the junior one. On a
  standing-pool run the item is already in Ready; report it for the swap.

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
