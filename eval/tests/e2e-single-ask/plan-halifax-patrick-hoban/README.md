# plan-halifax-patrick-hoban

**Ask:** "Please write the research plan for question q_001."

**Expected owner:** `research-plan`. **Expected save:** a new `plans` entry (`is_plan_ask: true`).
**Ends on an offer:** no — none of the measured turns wrote a "Continue with …?" line.

## Where it came from

Issue #4603's real-input check for research-plan: one planning turn on a real project with a saved
locality guide, so the planner reads real-sized collection lists rather than the unit fixtures'
toy ones. The project is e2e fixture `patrick-hoban-spouse`; the question is the one its committed run
`run-2026-11-12_20-49-46` selected.

Its census items cite the Canada censuses 1861-1891 by collection id, all from `nationalCollections` or the locality's own rows.

Not graded: "no `question-selection` spawn; no new question" (printed as `must_not`, and graded anyway
by `no_research_job`).

## Expected result today

PASS. Measured 2026-11-19, research-plan on `claude-sonnet-5-5` at `low`:

```
PASS plan-halifax-patrick-hoban  expected=research-plan  first=research-plan  save=ok  stop=clean
    units: research-plan  extraction_append=0
```

9 plan items, 7 tool calls, no `collections_search`, about 72 seconds.

## Starting state

- `starting-research.json`: e2e fixture `patrick-hoban-spouse`'s own `starting-research.json`, plus
  - its run `run-2026-11-12_20-49-46`'s question as `q_001`, reset to `open` with an empty `search_stop`:
    "Do independent records confirm or refute that Catherine Donovan was the wife of Patrick Hoban, born 1836 in Halifax, Nova Scotia?"
  - that run's `localities` entry for Halifax, Nova Scotia, Canada, 1836-1900, re-filled from FamilySearch's live catalog on
    2026-11-19 with `npx tsx dev/fill-locality-fixtures.ts --all <starting-research.json>`: 12 rows the guide saved, 5 more Nova Scotia rows and 10 core national rows (the Canada censuses 1851-1901, the 1871 mortality schedule and the country-wide baptism, marriage and death indexes).
- `starting-tree.gedcomx.json`: the e2e fixture's own.

## Caps

`wall_clock_seconds: 900`, `tool_calls: 60`, `max_turns: 60`: one planning turn, measured at about a minute
and under ten tool calls. `max_cost_usd: 2` only labels a run (spec §6).

## Cost

Measured 2026-11-19: $0.42 (`usage.whole_run_cost_usd_estimated`). One run.
