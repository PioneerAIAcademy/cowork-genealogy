# Captured feed — a hosted reader's view, 2026-09-29

The artifact the *Before phase 2* item "capture a real feed" asks for. **No committed run
showed what a hosted reader sees** before this: every e2e fixture pins `narration_guidance`
to "concise", every e2e run enters as `/research --autonomous`, and the unit harness binds
no Stop hook.

## How it was made — the conditions are the point

| | |
|---|---|
| Session | **Fresh**, created through `POST /api/sessions`, not seeded from a fixture — so the opener fires and `init-project` writes the shipped novice profile |
| First message | The web client's opener prefix, then the researcher's own words. **No slash command** |
| Tree reads | **Not blocked.** `BLOCKED_TOOLS` unset — a browser user blocks nothing |
| Continuous work | On. The web tier stamped its 60-nudge cap per message |

Seeding a fixture would have defeated all of this: it copies the fixture's "concise" profile
and the session is opened from the list, so the opener never fires.

## The objective, and why this one

> Did Mary E. McAndrew (G13G-P68) and her husband John Mogan of Detroit have any children
> besides the five already in the tree?

Verified against live FamilySearch before starting: exactly those five children are on the
tree, so the question **cannot be answered by reading it**. The true answer is that the
record hint is a *false match* belonging to a different Detroit family — so the run has to
reason its way to "no" rather than accept a suggestion.

A `strip`-genre e2e fixture would NOT have worked here, and this is the trap to remember:
those hide the answer by having the HARNESS block tree reads, and a browser session blocks
nothing. The answer has to be absent from the live tree as a property of the question.

## What happened

| | |
|---|---|
| Outcome | `completed` — the research finished |
| Wall clock | **133 minutes** |
| Feed events | 2,697 (282 narration paragraphs, 1,009 tool calls, 326 thinking) |
| Sub-agents | 36, all completed |
| Deliveries | **5** |

**Read the duration and nudge fields carefully.** `turns.claimed_at` is the LAST claim, so
`completed_at - claimed_at` reads 13 minutes, not 133; and the nudge cap is per ATTEMPT, so
the count appears to go backwards across redeliveries. The true elapsed time is
`max(ts) - min(ts)` over the events.

`receive_count=5` is not a fault: the queue's visibility timeout expires on a 133-minute
turn and the resume guard (`005_resume_guard.sql`) handles each redelivery. Zero errors, the
worker healthy throughout. That makes this evidence for phase 2's "the job outlives the tab"
section — a real job outlived its own queue delivery four times and still completed.

`thinking` is 65% of the bytes and is kept: the chat client accumulates it, so it is part of
what the reader sees.
