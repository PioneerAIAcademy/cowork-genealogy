# review-sources-kenneth-quass

**Ask:** "Review the sources attached to KNS4-P6W."

**Expected owner:** `source-evaluation`. **Expected save:** one new `log` entry with
`tool: "source-evaluation"`.

## Where it came from

A placeholder (issue #3527). Issue #3571 picks and adjudicates the real panel from
alpha feedback; replace or extend this fixture from its comment on issue #3527.

The `tool` value is provisional. Issue #3524 says the log entry's `tool` "names the
activity" but does not fix the string. Match it to what #3524 ships.

## Expected result today

Measured 2026-10-19 on `main`: FAIL on `save` only.

```
FAIL review-sources-kenneth-quass  expected=source-evaluation  first=source-evaluation  save=missing log tool=source-evaluation (new log tools: none)  delivered=no  stop=clean  failed=[save]
```

`owner` already passes. With no `/research` prefix the main thread matched the ask to
`source-evaluation`'s own description and spawned it without the router, so this
fixture cannot see the router gap issue #3526 fixes; #3526's own `routes-to:` unit
tests cover that (Done-when amended on issue #3527, 2026-10-19). It turns PASS when
issue #3524 (`source-evaluation` saves a log entry) lands.

## Starting state

Copied from `eval/tests/e2e/kenneth-quass-death/`, with the project `id` and
`objective` changed to a source review. The project has no questions, plans, log
entries or sources.

## Caps

`wall_clock_seconds: 1200`, `tool_calls: 60`, `max_turns: 60`, `max_cost_usd: 3`. One
source review of one person is a short job; the autonomous defaults (two hours, $15)
would let a turn that wrongly starts a research job run on and cost a full e2e run
before it fails.

## Cost

Measured 2026-10-19: $0.92 (`usage.whole_run_cost_usd_estimated`), 3 min 5 s, on
`claude-sonnet-4-6` at effort `high`. One run, so read it as an order of magnitude.
