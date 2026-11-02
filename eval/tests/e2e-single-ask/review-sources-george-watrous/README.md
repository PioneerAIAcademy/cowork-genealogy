# review-sources-george-watrous

**Ask:** "Review the sources attached to KNDB-F71."

**Expected owner:** `source-evaluation`. **Expected save:** one new `log` entry with
`tool: "source_evaluation"`.

## Where it came from

Row C1 of Issue #3571's adjudication on issue #3527 (2026-11-02), the chosen "review the sources attached to <PID>" ask. It replaces the
`review-sources-kenneth-quass` placeholder (same ask, and that fixture's revert proof for issue #3524 is in
its git history).

A regression guard for issue #3524: it fails on `save` if `source-evaluation` stops writing its log entry.
It is **not** a guard for issue #3526's router row: with no `/research` prefix the main thread spawns
`source-evaluation` from its own description without the router (Done-when amended on issue #3527,
2026-10-19), so #3526's `routes-to:` unit tests cover that.

## Expected result today

PASS. Measured 2026-11-02:

```
PASS review-sources-george-watrous  expected=source-evaluation  first=source-evaluation  save=ok  delivered=no  stop=clean
    units: source-evaluation  extraction_append=0
```

## Starting state

Starting tree: `person_read` of KNDB-F71 with relatives and sources, snapshotted 2026-11-02 through
`e2e.author`'s `fetch_person_read`, `normalize_tree` and `living_gate(drop_living=True, heuristic=True)`,
with no schema errors (`author snapshot` writes only under `eval/tests/e2e/`, so the same calls were made
directly). `starting-research.json` has the objective set and no questions, plans, log entries or sources. George Hugh Watrous (1814-1897) has 29 attached sources, among them an 1870
census indexed as "George H Watsons" (`M9QR-VCL`).

## Caps

`wall_clock_seconds: 2400`, `tool_calls: 150`, `max_turns: 150`: 29 sources, more than double the
placeholder's 12. The measured run used 19 main- and sub-thread tool calls in about 11 minutes.
`max_cost_usd: 6` only labels a run (spec §6).

## Cost

Measured 2026-11-02: $2.43 (`usage.whole_run_cost_usd_estimated`), about 11 minutes, `claude-sonnet-4-6`
at effort `high`. One run.
