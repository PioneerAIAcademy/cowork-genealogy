---
name: merge-issues
description: Use when the lead wants the Backlog merged down before anything is promoted — "merge the backlog", "merge issues", "these skills have too many issues", "cut the queue on record-extraction", "what should be merged", or a bare "/merge-issues". Owns merge doctrine for this repo; `/merge-recent-issues` and `/audit-board` both defer to it. Selects by eval-slot queue depth rather than by filing date: a skill whose snapshot has four or more issues waiting behind it pays a separate `make eval-skill` run and a full re-annotation for each one, and those issues are routinely filed weeks apart, so the daily recency pass cannot see them. Runs `slots.py` to compute the queues, then merges N-way — not pairwise — until every queue is at three or fewer or each survivor has a written reason. Inside a slot the burden is reversed: you justify each issue that survives, not each merge. Run it before `/fill-ready`, twice a week. Proposes first and applies only what the lead approves; never starts the work, and never writes the project board.
allowed-tools:
  - Agent
  - Read
  - Bash
  - Glob
  - Grep
---

# Merge issues

This skill **owns merge doctrine**. `/merge-recent-issues` is the daily catcher
for a new issue landing on an existing one; `/audit-board` is the weekly pass for
obsolescence, clusters and hygiene. Both defer here for *what merges*. If any of
the three disagrees, this file wins and the disagreement is a finding to report.

What only this pass can see: **N issues, filed weeks apart, queued on one skill's
eval slot.** The recency pass reads a 2-day window and those queues span 30–40
days of filing, so they are invisible to it by construction.

**You propose, then apply what is approved.** No branches, no PRs, no code edits.
You have no `Edit` or `Write` tool on purpose.

**Never write the project board.** Closing an issue auto-moves its card to Not
planned; nothing else here needs a column change. A `gh` token without the
`project` scope fails a board write while appearing to succeed.

## 0. Compute the queues

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 2000 > /tmp/board.json
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 400 \
  --json number,title,body,labels,assignees,createdAt > /tmp/open.json
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 200 \
  --json number,title,files > /tmp/prs.json
python3 .claude/skills/merge-issues/slots.py /tmp/board.json /tmp/open.json /tmp/prs.json
```

`--limit` truncates silently. The board carries well over 1200 items; a returned
count equal to the limit means rows were lost and every depth below is wrong.
The script says so itself at 2000, but check the issue and PR pulls by hand.

**Read the coverage block at the bottom before anything else.** It names two
buckets, and between them they are the part of the pool the script cannot judge:
issues with **no `**Touches:**` line**, which reach no queue at all, and issues
**in no section above** — a body naming only a broad container directory, or only
paths no second issue touches. Both are listed by number. Read them by hand and
say in the report how many you got through.

The pool is **non-icebox Backlog plus unassigned Ready**. An assigned card, an
In Progress card and a Review card are someone's work: never merge one, in either
direction. An *unassigned* Ready card is both in the pool and its slot's holder,
which makes it the natural target — it is furthest along.

A `cross-cutting` card is **not** in the pool — the label takes it out, whoever
ends up doing it — but it still sits in whatever slot its `**Touches:**` line
names. A non-icebox Backlog one prints as `occupant: #N`; one already in an
active column prints as a holder tagged `cross-cutting -- not a merge target`.
**Neither is a merge target, and neither is part of queue depth.** Never propose
merging into one or out of one. Depth stays "this many mergeable cards", which is
what `MUST CLEAR` acts on and what `audit-board`'s tax table copies out of these
blocks — so do not put an occupant in that column. Read them the other way: a
slot with an occupant has its next paid run already spoken for, which is worth
knowing before promoting a card into it.

The last section lists slots whose queue is too shallow to reach the sections
above — 0 or 1. Read the block, not the heading: a queue of 1 still lists a
mergeable card. It is the one place the script reports a slot that looks free and
is not.

**Re-check state at apply time, not just at compute time.** The pool is a snapshot
and a pass takes hours; a card can be assigned while you are still proposing. On
2026-09-16 issue #2535 was an unassigned Ready target when the queues were computed
and assigned before the merges were applied, which retires its whole group. Verify
`state` and `assignees` per issue immediately before writing — those two fields are
what the rule turns on, and they survive a `gh project` outage that takes the board
pull down.

## 1. The four verdicts

**Duplicate — close one into the other.** Two issues whose fix is the same edit
to the same lines. Prove it by opening the file both cite, not by comparing
titles. Keep the one further along and carry any detail the loser adds.

**Absorb — one is a strict subset.** The larger body usually says so already
("both are in scope here", "a generator would close both at once"). Verify the
claim, then either close the subset or narrow the superset so exactly one owns
the scope.

**Batch — separate issues, one paid run.** Use this only where the issues cannot
be one card. Inside a slot it is usually the wrong answer; see below.

**Split the lanes — only when each half finishes without the other**, and only
outside a slot. One test: can each half be finished, reviewed and merged without
waiting on the other? If yes, split at the lane boundary and move the content so
neither issue points at the other for something it needs. If no, merge and let
the card carry both labels.

The one legitimate not-a-merge is a **one-way mechanical dependency**: issue B
only needs to *apply* something issue A defines — a convention, a constant, a
helper. Do not merge and do not cross-reference. **Edit B's body** so it reads as
an instruction ("apply the convention issue #A defines") rather than a
coordination requirement.

## 2. Inside a slot, the burden is reversed

Outside a slot you prove the merge. **Inside one you prove each survivor.** Every
issue left on a queue at the end of this pass needs a written sentence saying why
it could not join one of the others. That sentence goes in the report.

This is the difference between this pass and the general rule, and it is
justified by Gate 4 rather than by taste: at most one issue touching a skill's
snapshot may be in Ready, In Progress or Review at a time, so a queue of eight
drains as eight sequential `make eval-skill` runs, each with a fresh `.ann.json`
carrying a correction entry for **every dimension of every test** — 27 tests for
`record-extraction`. The money is $8–12 a run. The binding cost is genealogist
hours, eight times over, on the same suite.

**The lane-split verdict does not apply inside a slot.** It asks whether each
half can finish without the other — but under Gate 4 neither half can be in an
active column while the other is, so independence buys no parallelism and costs a
second run. Two issues on one snapshot that are independent still merge. This is
the single largest source of false "keep them apart" verdicts.

**Reasons that never keep two issues on one slot apart.** Do not write any of
these as a survivor's reason:

| Not a reason | Why |
|---|---|
| Different lanes (`developer` / `genealogist`) | One card, both labels; the holder asks the other lane for their half |
| Different reviewer | Reviewers are assigned to PRs, not to issues |
| Different mechanism — two matchers, two code paths, two tools | An author's aesthetic, not a work boundary |
| Different acceptance criteria | A merged issue carries both |
| Different sections of the same SKILL.md | One edit, one run, one annotation pass |
| Different filers, filed weeks apart | Describes the board's history, not the work |
| "Related but distinct" / "cross-reference and note it" | Not verdicts |

**Reasons that do keep them apart.** These three, and nothing else:

1. **A blocker on one side.** Never park an unblocked issue behind a blocked one
   — check both bodies and resolve the blocker's state
   (`gh issue view <N> --json state`).
2. **One person cannot finish all of it in one sitting.** The one-sitting test
   below, which is what stops a queue becoming a tracker.
3. **A `needs-decision` label with no ruling yet**, where the other issue is
   startable today. Merging strands the startable half behind the lead's answer.
   `senior` is *not* on this list — it is orthogonal to `needs-decision` and
   never a reason to split a card.

## 3. Merge N-way, not pairwise

A queue of fifteen does not come down pairwise in one pass. Read the whole queue
at once and propose the **partition**: fifteen issues into four, naming which
issues form each group and which survives as the target.

**Fan out one agent per must-clear slot.** Each gets exactly that slot's issue
numbers, the doctrine in this file, and the instruction to return a partition
with per-group evidence. A slot is the natural boundary — its issues have to be
in one head, and no agent needs another slot's. Give each an explicit,
non-overlapping list; generate the partition of slots, do not eyeball it. A slot
appearing in two agents' lists produces two contradictory proposals for the same
queue.

Report coverage as a number and a rule: how many slots you cleared, how they were
chosen, and which agents failed. Never report a sample as the whole pass.

**Validate the returned partition before you act on it.** Agents that share an
issue across slots will both claim it, and an issue can only close once. Check
mechanically, not by eye: no issue appears as a loser twice, and no target is
also someone's loser. On 2026-09-16 issue #2562 came back claimed by two groups;
the tie broke on where its *acceptance criterion* lives (a test under
`eval/tests/unit/research-plan/`), not on which body mentioned it first.

**Budget the GitHub API.** Seven parallel agents each reading issue bodies and
comments will exhaust the hourly limit, and the secondary write limit trips before
any documented bucket shows it — `gh api rate_limit` reads full while every call
is refused. Prepare the merge content as files and apply it in one idempotent pass
rather than interleaving reads and writes; retrying during a secondary limit
extends it.

### The one-sitting test, which bounds all of this

**Does one person, doing this once, finish all of it?** If no, they are separate
issues no matter how alike the bodies read, and no queue depth changes that.

**Never replace N issues with one issue holding N rows.** No trackers, no
umbrellas, no index issues. A row cannot be assigned, cannot sit in a column,
cannot be closed, and does not appear in anyone's queue. One card that is done
when twenty independent adjudications are done is a card nobody can finish.

**Template-filled bodies are the trap, and this pass sees the most of them.** A
fleet of them looks like mass duplication and is not: twenty `test <slug>`
record-hint adjudications are twenty different people, twenty records and four
countries, and the shared text is `/resolve-record-hint` boilerplate. Each still
costs its own run, so merging them buys nothing. **Sharing a slot is necessary
and not sufficient** — the merge has to be coverable by *one* run.

If a set genuinely wants shared scheduling rather than merging, the tools are the
`cluster:*` label and the standing `next run: <skill>` issue, both owned by
`/audit-board`. Say so in the report and let that pass place them.

### The target

Every slot the script marks **MUST CLEAR** leaves this pass either at three or
fewer, or with a written survivor reason for each issue above three. State both
numbers at the top of the report: queues cleared, and queues you could not clear
with the reason. **A shortfall is a finding, not a silence.**

The target binds what you propose, not what the lead accepts.

## 4. Prove it before proposing

**Open the files the issues name.** Framing resemblance is the dominant false
positive and it is convincing — two issues both described as "a prose lint with a
file-and-line allow-list" routinely share no mechanism, one comparing hashes
across duplicated copies and the other matching a banned phrase.

Per proposed group:

1. **Same fix site?** Open the file. Quote the lines.
2. **All unblocked, or all blocked the same way?** Rule 1 above.
3. **Does one person finish the merged card in one sitting?** Say why.
4. **How many runs does this buy back?** Group of four into one: three runs and
   three annotation passes. That number is the proposal's justification — state
   it per group, and total it.

An issue body is **a claim written on a particular day**. Verify any factual
claim — a path, a line number, a measurement, a tool's behaviour — before
repeating it, and cite what you checked.

**The queue itself is a claim too.** `slots.py` reads one line out of each body,
so a body that defeats the parser reaches the wrong queue and every depth below it
is wrong. Two shapes do it: a review banner that mentions `**Touches:**` inline
while discussing it, and a rescoped card whose superseded body keeps a stale line
under an `## Original issue` fold. Both were live on 2026-09-16. When an issue's
queue membership looks wrong, read its body's Touches lines — plural — before
trusting the slot, and treat a disagreement as a defect in the instrument rather
than a judgment call.

**Do not re-litigate a pair `/merge-recent-issues` judged independent** without
reading its reasoning in the issue comments first, and only overturn it with
something that pass could not see — which here is the queue, not the pair.

## 5. Applying an approved merge

Four steps. Skipping any one of them loses something.

1. **Fold the content into the target**, under a heading naming each source issue
   and the date. Carry the detail each absorbed issue adds — its evidence, its
   acceptance criteria, its sequencing gate, its extra `Touches:` paths. A merge
   that drops the losers' specifics is a close and should have been reported as
   one. Merge the `**Touches:**` lines into one union line: the next run of this
   skill reads it.
2. **Retitle the target** if its title no longer covers the merged scope. A title
   describing a quarter of the work is how the rest gets forgotten.
3. **Move every assignee and any label the target lacks.** An absorbed issue with
   an assignee has someone expecting to do it — `gh issue edit <target>
   --add-assignee <login>` — and say so in the report. A `nothing-checks`,
   `needs-decision` or `cluster:*` label on a loser must survive too.
4. **Close each loser with the reasoning, not just a pointer.**

```sh
gh issue close <N> --repo PioneerAIAcademy/cowork-genealogy \
  --reason "not planned" \
  --comment "Merged into issue #<target>.

<why these are one piece of work — the shared snapshot, the run they now share>"
```

Write the comment for someone who filed the issue and will wonder where it went.
"Duplicate of #N" is not enough; name what they share, and say plainly that nothing
was dropped and that they should reopen if they find otherwise.

**A blocker cleared is a finding, and the board does not know it.** Verifying a
merge means reading each card's blockers, which routinely turns up holds that were
discharged weeks ago — on 2026-09-16, issue #2253's hold was a test that now passes
in the newest committed run, and issues #2393, #2076 and #2251 had all been freed by
cards that closed (#2262's two blockers had closed as well). Nobody learns this
from a merge that does not happen. Post the correction as a comment on the
unblocked issue, naming the run log or the closed issue you checked, and list it in
the report's findings — a card sitting behind a dead blocker is invisible in
exactly the way a deep queue is.

If the target's body carries a banner asserting the two are separate, **rewrite
it in the same pass**. A stale "keep these apart" note outliving the merge is
worse than no note.

**Never write "does not close #N"** anywhere. GitHub's parser matches the
substring `close #N` and has no notion of negation.

## 6. Output shape

Open with the arithmetic: queues at or above the threshold, how many you cleared,
the runs bought back, and the gap where one remains.

1. **Merges** — one block per group: the members, the target, the shared slot and
   the lines you read, the verdict, runs bought back, assignees and labels moving.
2. **Survivors** — every issue left on a must-clear queue, one line each, with the
   reason from the table of three. This section is the one the lead checks.
3. **Body edits** — one-way mechanical dependencies, with the exact replacement
   sentence.
4. **Outside the slots** — merges from the file-convergence section, kept separate
   because they buy a reviewer and a rebase, never a run.
5. **Hand to `/audit-board`** — sets that want a `cluster:*` label or a `next run:`
   issue rather than a merge.
6. **Blockers found discharged** — every hold you checked and found already
   cleared, with what you read. These leave the pass as comments on those issues,
   and they are often worth more than the merges.
7. **Not checked** — both coverage buckets you did not get through (no
   `Touches:` line, and in no section above), and any slot whose agent failed.

Then stop and wait for approval. Apply only what he approves. Do not begin any of
the work the issues describe.
