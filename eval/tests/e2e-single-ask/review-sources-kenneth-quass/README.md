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

FAIL until both of these land on `main`:

- issue #3526 — the router names `source-evaluation` as the owner of a source review;
- issue #3524 — `source-evaluation` saves a log entry inside a project.

Either one alone still fails on the other half.

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

Unmeasured until the first run. Record `usage.whole_run_cost_usd_estimated` from the
run log here, with the date.
