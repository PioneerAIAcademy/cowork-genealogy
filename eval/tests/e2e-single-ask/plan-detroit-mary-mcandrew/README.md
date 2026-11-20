# plan-detroit-mary-mcandrew

**Ask:** "Please write the research plan for question q_001."

**Expected owner:** `research-plan`. **Expected save:** a new `plans` entry (`is_plan_ask: true`).
**Ends on an offer:** no — none of the measured turns wrote a "Continue with …?" line.

## Where it came from

Issue #4603's real-input check for research-plan: one planning turn on a real project with a saved
locality guide, so the planner reads real-sized collection lists rather than the unit fixtures'
toy ones. The project is e2e fixture `mary-mcandrew-son`; the question is the one its committed run
`run-2026-11-12_22-00-10` selected.

The case the fill was built for. Before it, Detroit's federal census items depended on whether the planner ran its own `collections_search({ standardPlace: "United States" })` (issue #4603: 5, 4 and 5 census items with the search, 4 without). In the measured run the plan's three census items name `United States, Census, 1880`, `1900`, `1910` and `1920` as name-searchable and the 1890 census as essentially lost, and no `collections_search` was called: the titles and counts came from `nationalCollections` alone. Check that again on any re-run; the grade does not.

Not graded: "no `question-selection` spawn; no new question" (printed as `must_not`, and graded anyway
by `no_research_job`).

## Expected result today

PASS. Measured 2026-11-19, research-plan on `claude-sonnet-5-5` at `low`:

```
PASS plan-detroit-mary-mcandrew  expected=research-plan  first=research-plan  save=ok  stop=clean
    units: research-plan  extraction_append=0
```

10 plan items, 8 tool calls, no `collections_search`, about 66 seconds.

## Starting state

- `starting-research.json`: e2e fixture `mary-mcandrew-son`'s own `starting-research.json`, plus
  - its run `run-2026-11-12_22-00-10`'s question as `q_001`, reset to `open` with an empty `search_stop`:
    "Who were all the children born to Mary E. McAndrew and John Mogan of Detroit?"
  - that run's `localities` entry for Wayne County, Michigan, United States, 1870-1930, re-filled from FamilySearch's live catalog on
    2026-11-19 with `npx tsx dev/fill-locality-fixtures.ts --all <starting-research.json>`: 12 rows the guide saved, 17 more Michigan rows and 11 core national rows (the federal censuses 1870-1930, the 1850-1880 mortality schedule, the SSDI, the WWI draft cards and the city directories).
- `starting-tree.gedcomx.json`: the e2e fixture's own.

## Caps

`wall_clock_seconds: 900`, `tool_calls: 60`, `max_turns: 60`: one planning turn, measured at about a minute
and under ten tool calls. `max_cost_usd: 2` only labels a run (spec §6).

## Cost

Measured 2026-11-19: $0.80 (`usage.whole_run_cost_usd_estimated`). One run.
