# Working agreement: Dallan and Richard

**Dallan is the architect.** Technical direction, doctrine, structural bets.
Holds the decisions.

**Richard is the development manager.** The board, the people, the daily cadence.
Holds the queue.

Richard does not wait on anything that is cheap to undo. The two pair on each
skill until Richard runs it alone.

---

## Who decides what

**Richard decides and applies immediately** — anything reversible with one `gh`
command:

- Which issues merge, which stay independent, which close as duplicates
- Promotion into Ready, and what loses a swap
- Lane labels, `reviewed`, `cluster:*`, board hygiene
- Standup topics, replies, and who work goes to
- Paid eval runs — he holds the same budget as Dallan
- The roster
- Splitting an issue, and sequencing between issues

**These queue for Dallan**, each with its default if it goes unanswered:

| Class | Default |
|---|---|
| Doctrine — what a skill, rubric, or spec should say | Stays as written |
| Architecture, schema, tool boundaries, API shape | No change |
| `icebox` vs. a real commitment | Icebox |
| Close as *not planned* with no successor issue | Leave open |
| `cross-cutting` assignment | Unassigned; does not start |
| Overturning a previous ruling | Ruling stands |
| Milestone gating | Not gating |
| Overriding someone's work; security triage | No action |
| Deleting an issue | Dallan only; never defaults |

A queue entry states the question in one sentence, the options, Richard's
recommendation, and the default. Five minutes to answer, or it was written wrong.

Richard can block Dallan on team capacity and on whether a task is safe for a
junior. A block names the risk, not the preference.

Dallan can claim the top of the Backlog for architecture and quality work.
Richard ranks it as a commitment.

When the same question reaches Dallan three times, it becomes written doctrine
instead of a decision.

---

## The week

| When | Who | What |
|---|---|---|
| Daily | Richard | `triage-standup` → `merge-recent-issues` → `fill-ready` (calls `review-ready`) |
| Daily | Dallan | `make-decisions` — answer what the day's reviews queued |
| Mon | Richard | `audit-board`, before that day's `fill-ready` |
| Mon | Dallan | `find-big-wins`, after `audit-board` |
| Tue / Fri | Dallan | `review-icebox` |
| Fri | Both | `audit-merged-prs` — Richard takes process compliance, Dallan takes architectural drift |
| Fri, 30 min | Both | The one live conversation of the week |

---

## Before Richard runs a skill alone

Every board skill ends by waiting for the lead to approve. Run by Richard they
produce a report and change nothing.

**Done:** `review-ready` writes its questions into the issues instead of asking
them, `/make-decisions` answers them daily, and nothing treats an
already-answered decision as a defect any more.

**Still open:** the terminal approval gate in `fill-ready`, `audit-board` and
`merge-recent-issues` — apply the reversible things now, queue the rest.

Then: give Richard a position in `fill-ready`'s routing, move roster maintenance
to whoever runs the skill, send replies in Richard's own name, and record the
per-run numbers the skills currently keep in someone's head.

Take Richard off the roster table; he attends standup and posts nothing, as
Dallan does.
