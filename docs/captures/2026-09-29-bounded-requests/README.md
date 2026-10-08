# Bounded requests — does a turn stop when the ask is met?

The two R2 acceptance scenarios, run live against the prototype on 2026-09-29. These
exercise the `delivered` exit end to end: tool → `PreToolUse` hook → `turns.outcome` →
browser label. 128 KB total; these runs are minutes, not hours, which is the point.

## Results

| Scenario | Outcome | Wall clock | Feed |
|---|---|---|---|
| "Create a research plan for **Mary E. McAndrew (G13G-P68)**, wife of John Mogan of Detroit, but leave it at that" | **`delivered`** | 18 min | `feed-leave-it-at-that.json` |
| "**Where are we?**" (2nd message, active project) | **`delivered`** | 1 min | `feed-ambiguous-and-where-are-we.json` (turn 2) |
| "Create a research plan for **Mary Hales** but leave it at that" | **`no_progress`** | 1 min | same file (turn 1) |

### "Leave it at that" — passes every clause

- ends with the **`delivered`** outcome;
- **a rendered plan**: `plans[0]` = `pl_001` with sequenced items carrying jurisdiction,
  date range, record type and real rationale (pli_001 reasons that Wayne County
  registration began 1833, predating statewide 1867, and bounds the search before October
  1876 from the first child's birth);
- **no research-log entries**: `log` is empty and `research_log_append` was never called.

### "Where are we?" — passes

Answered and stopped, `delivered`, no new log entry. This is #2921/#2932's complaint
directly: a status question no longer runs to the proof, the nudge cap or $35.

## The failure is kept on purpose, and it indicts the criterion

R2's own example is *"create a research plan for **Mary Hales**"* — no dates, no place, no
id. Run verbatim it matches **35,921** FamilySearch people, and the agent cannot plan for a
person it cannot identify.

Two separate things went wrong, and they should not be conflated:

1. **The criterion is under-specified.** As written it cannot test what it intends, because
   the bounded-request path is never reached. It should name a person the agent can
   identify. The passing run above is that same scenario with an identifiable subject.
2. **The agent stalled instead of asking.** Facing 35,921 matches it had the decision exit
   available — `AskUserQuestion`, which ends a turn as `decision` and reads *"Waiting on you"*
   — and did not use it. It stopped, took one nudge, produced no tool call, and ended
   `no_progress`: the researcher sees *"the agent stopped making progress"* when the truth
   was *"which Mary Hales?"*.

(2) is the **compliance half** of R1/R4, which the plan defers as unmeasured. It is now
measured, once: the delivery rule was followed in both runs that could act on it, and the
decision exit was not reached in the one run that needed it. One observation, not a rate.

## Incidental proof

`tool_calls` now records the callee: `Skill | genealogy-research:init-project`. Before R1's
ledger change every skill call was an indistinguishable `tool_name='Skill'` row, which is why
"did this run enter the router?" could not be answered from the corpus at all.
