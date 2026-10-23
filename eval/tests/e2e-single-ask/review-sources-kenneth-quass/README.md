# review-sources-kenneth-quass

**Ask:** "Review the sources attached to KNS4-P6W."

**Expected owner:** `source-evaluation`. **Expected save:** one new `log` entry with
`tool: "source_evaluation"`.

## Where it came from

A placeholder (issue #3527). Issue #3571 picks and adjudicates the real panel from
alpha feedback; replace or extend this fixture from its comment on issue #3527.

The `tool` value is `source_evaluation`, as issue #3524 ships it (the agent name in
snake_case, following `historical-context`'s `historical_context`).

## Expected result today

PASS. Measured 2026-10-22 on the issue #3524 branch, and again with that branch's
`agents/source-evaluation.md` replaced by `main`'s, which writes no log entry:

```
reverted:  FAIL review-sources-kenneth-quass  expected=source-evaluation  first=source-evaluation  save=missing log tool=source_evaluation (new log tools: none)  delivered=no  stop=clean  failed=[save]
restored:  PASS review-sources-kenneth-quass  expected=source-evaluation  first=source-evaluation  save=ok  delivered=no  stop=clean
```

`owner` already passes. With no `/research` prefix the main thread matched the ask to
`source-evaluation`'s own description and spawned it without the router, so this
fixture cannot see the router gap issue #3526 fixes; #3526's own `routes-to:` unit
tests cover that (Done-when amended on issue #3527, 2026-10-19).

## Starting state

Copied from `eval/tests/e2e/kenneth-quass-death/`, with the project `id` and
`objective` changed to a source review. The project has no questions, plans, log
entries or sources.

## Caps

`wall_clock_seconds: 1200`, `tool_calls: 60`, `max_turns: 60`. One source review of one
person is a short job (the first run took 3 minutes and 25 tool calls). The autonomous
defaults (two hours, 300 tool calls) would let a turn that wrongly starts a research job
run on for the price of a full e2e run before it ends. `max_cost_usd: 3` only labels a
run that went over; it does not stop one (spec §6).

## Cost

Measured 2026-10-19: $0.92 (`usage.whole_run_cost_usd_estimated`), 3 min 5 s of wall
clock (164 s of it in the SDK's `duration_ms`), on
`claude-sonnet-4-6` at effort `high`. One run, so read it as an order of magnitude.
