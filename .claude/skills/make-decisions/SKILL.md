---
name: make-decisions
description: Use when the architect wants to answer the questions the board has queued for him — "make decisions", "what needs my ruling", "drain the decision queue", "answer the needs-decision items", or a bare "/make-decisions". Reads every open `needs-decision` issue, presents each as a question with its options and a recommendation, records the ruling on the issue, and removes the label so the next `/fill-ready` can rank and promote it. Run it daily; it is cheap by design. Do NOT use to choose what the team works on or to move anything on the board — that is `/fill-ready`, which promotes the items this skill unblocks. Do NOT use to hunt for structural bets — that is `/find-big-wins`. Never promotes, never starts the work.
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# Make decisions

The `needs-decision` label is a queue of questions the board could not answer for
itself. `/triage-standup`, `/fill-ready` and `/review-ready` all fill it and run
daily. **This skill is the only thing that empties it.**

**Run this daily, and keep it cheap.** Most items arrive pre-prepared —
`/review-ready` writes the question, the options and its recommendation into the
body before labelling. Your job on those is to read, ask, and record. If you find
yourself sweeping the corpus, reading ADRs, or re-litigating whether the work is
worth doing, you have drifted into `/find-big-wins`. `/fill-ready` already ranked
these; the question is never "should we do this."

**Never move a card.** Removing the label is the whole delivery — the next
`/fill-ready` ranks the item in a junior pool and promotes it. Moving an item up
the board is `/fill-ready`'s job and never yours.

**`/find-big-wins` reads this queue but must never drain it.** A question that
keeps coming back is evidence for that skill that doctrine is missing. One
remover, or the two disagree about what is still open.

## 0. Two sweeps, first

```sh
R=PioneerAIAcademy/cowork-genealogy

# (a) ANSWERED — a ruling exists and the label is still on. This is your input,
# not a defect: rulings arrive at standup and in bare comments, through channels
# with no apply step. Close each one out in §3; the answer already exists, so it
# costs nothing. It IS a defect only for an item that was here last run too —
# that one survived a drain.
#
# `test` and not `startswith`: a real ruling comment carries a heading above the
# marker and a number after it, so an exact-prefix match reports zero forever.
# BOTH WORDS, BOTH MARKUPS — this reads what was written, not what we tell people
# to write: `**Ruling:**`, `## Decision:` and `**Decision (lead, <date>)` all
# occur. A `**Ruling`-only test missed two real rulings on 2026-08-13 (issues
# #1331, #1394). Here a miss is silent, because the query reports emptiness as
# health.
gh issue list --repo $R --state open --limit 200 \
  --label needs-decision --json number,title,comments \
  -q '.[] | select([.comments[].body
                   | test("(?m)^#{1,4} +(Ruling|Decision)\\b|\\*\\*(Ruling|Decision)\\b")] | any)
      | "#\(.number)  \(.title)"'

# (b) LABELLED, but no question was ever written. The label went on and the
# `## Decision needed` block did not, so there is nothing to present. Fix it in
# whichever skill dropped it.
gh issue list --repo $R --state open --limit 200 \
  --label needs-decision --json number,title,body \
  -q '.[] | select(.body | test("(?m)^#{1,4} +Decision needed\\b") | not)
      | "#\(.number)  \(.title)"'
```

Report each count as one line. Close out everything in (a) this run. For (b),
prepare the question yourself and name the skill that dropped it — that one is a
defect, because the label went on and the question did not.

## 1. Read the queue

```sh
gh issue list --repo $R --state open --limit 200 \
  --label needs-decision --json number,title,updatedAt,labels \
  -q '.[] | "\(.updatedAt[0:10])\t#\(.number)\t\(.title)"' | sort
```

**`senior` is not your queue.** Those are hard regardless of any open question
and go to a senior in the matching lane. Never carry both labels; `/fill-ready`
§ "Above the junior pools" owns the split.

## 2. Present each question

A pre-prepared item carries its own block; pass it through **verbatim** into
`AskUserQuestion` — header, question, options, recommended first. The
`task-reviewer` agent that wrote it read the spec, the ADRs and the code, and you
did not. Do not restate an option in your own words.

```
## Decision needed — <header>

<question, one sentence>

- **A — <label>** — <consequence that decides it>  *(recommended)*
- **B — <label>** — <consequence>

*Prepared by review-ready YYYY-MM-DD.*
```

An item from `/triage-standup` arrives unprepared. Prepare it the same way before
asking: the question in one sentence, the options, the consequence that decides
each, and your recommendation. Usually one of four shapes — a doctrine call after
which the rest is mechanical; a spec that has to exist before the code does; a
design fork closable by a cheap probe; or a blast radius nobody has written down,
which is the one that most often disappears once written.

**If preparing one would take more than a few minutes of reading, stop.** Leave
it labelled and name it in the report — nobody else prepares it for you. One
expensive item must not turn the daily run into the weekly one. An item you have
deferred twice is not a question that needs preparing; relabel it `senior`.

**Bring the counter-argument with the recommendation.** A recommendation with
nothing said against it is not a decision he can make; it is one he can only
ratify.

**Merge identical forks.** Two issues asking the same question get asked once as
policy — one question, two items unblocked.

`AskUserQuestion` takes four at a time; the rest go in prose.

## 3. Close it out in the same turn

**The moment he decides, apply it.** Four writes, in this order, before the next
item. An answer heard and not applied is worse than one never asked for.

```sh
# 1. the durable record — his answer, in his words, on the issue
gh issue comment <N> --repo $R \
  --body "**Ruling:** <his answer> — <the one-line reason, if he gave one>"

# 2. splice it into the body, replacing the `## Decision needed` block, so the
#    next reader gets the decision and not the open fork.
#    gh issue view <N> --json body -q .body > body.md, edit, then:
gh issue edit <N> --repo $R --body-file body.md

# 3. if the body carries a reviewed marker, refresh its clause in the same edit:
#    > **Reviewed <date> before junior handoff.** Decision recorded below; ...
#    Reader hygiene only — the `reviewed` LABEL is what `/fill-ready` skips on,
#    and a recorded ruling does not void it. Never write a marker onto an issue
#    that was never reviewed: that forges a review and wins a permanent skip.

# 4. the label comes off, and the item ranks in a junior pool like anything else
gh issue edit <N> --repo $R --remove-label needs-decision
```

The `**Ruling:**` comment is the record, not a queue. It exists so the next
reader — a junior picking the issue up, `/audit-board`, a later run of this skill
— sees the decision and its reasoning.

## 4. Answers that are not a choice between the options

- **"Neither — the real question is X."** Rewrite the `## Decision needed` block
  with the corrected question and **leave the label on**. It comes back next run.
- **"This is hard either way."** Swap `needs-decision` for `senior`. Never both.
- **"Don't do this."** Close it: `gh issue close <N> --repo $R --reason
  "not planned" --comment "<why>"`. The label goes with the issue.

## 5. Report

Short. Five lines and a list.

- The two sweep counts. For (a), flag anything that was also there last run.
  For (b), name the skill that dropped it.
- How many items were open at the start, and how many you closed out.
- Anything answered as `senior` or closed, one line each.
- Any question you had to prepare because it arrived unprepared.
- Items left waiting, oldest first, with their time in queue — measured from when
  the label went on, not from when the issue was filed. The two are unrelated:
  issue #607 was 48 days old and one day into the queue.

**A question that reaches you for the third time is not a decision.** Say so in
the report — it is doctrine nobody has written down, and it belongs to
`/find-big-wins` as a proposal, not here as a recurring ask.
