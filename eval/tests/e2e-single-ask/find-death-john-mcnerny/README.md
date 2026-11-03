# find-death-john-mcnerny

**Ask:** "I can't find John Mcnerny after the 1880 US Census. Can you find his death record near Venango County Pennsylvania?"

**Expected owner:** `search-records`. **Expected save:** a new source, or a new `log` entry with
`tool: "record_search"` and `outcome: "negative"`.

## Where it came from

Row A1 of Issue #3571's adjudication on issue #3527 (2026-11-02): the first ask in `feedback-2026-09-22T15-47-39-065238Z.zip` (issue #2813's evidence).
The row names no log tool; `record_search` is chosen because it is search-records' only search tool.
Not graded: "no search for a record already attached to KP9Y-74L" (printed as `must_not`).

## Expected result today

PASS. Measured 2026-11-02:

```
PASS find-death-john-mcnerny  expected=search-records  first=search-records  save=ok  stop=clean
    units: research > search-records  extraction_append=1
```

The save passed on a source, `src_001`, a GenealogyBank obituary index entry (Oil City, 20 July 1887) that
the main thread then disproved from its page image; eleven negative `record_search` entries would have
passed it too. The grade checks that a save happened, not that the source is his.

## Starting state

Starting tree: `person_read` of KP9Y-74L with relatives and sources, snapshotted 2026-11-02 through
`e2e.author`'s `fetch_person_read`, `normalize_tree` and `living_gate(drop_living=True, heuristic=True)`,
with no schema errors (`author snapshot` writes only under `eval/tests/e2e/`, so the same calls were made
directly). `starting-research.json` has the objective set and no questions, plans, log entries or sources. KP9Y-74L has no sources attached at all (checked 2026-11-02), so the row's "no search for a record already attached" cannot be broken here.

## Caps

`wall_clock_seconds: 1200`, `tool_calls: 60`, `max_turns: 60`: one search request. The measured run used
33 tool calls in under 12 minutes. `max_cost_usd: 3` only labels a run (spec §6).

## Cost

Measured 2026-11-02: $2.26 (`usage.whole_run_cost_usd_estimated`), about 12 minutes, `claude-sonnet-4-6` at
effort `high`. One run.
