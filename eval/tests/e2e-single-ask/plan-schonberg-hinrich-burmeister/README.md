# plan-schonberg-hinrich-burmeister

**Ask:** "Please write the research plan for question q_001."

**Expected owner:** `research-plan`. **Expected save:** a new `plans` entry (`is_plan_ask: true`).
**Ends on an offer:** no — none of the measured turns wrote a "Continue with …?" line.

## Where it came from

Issue #4603's real-input check for research-plan: one planning turn on a real project with a saved
locality guide, so the planner reads real-sized collection lists rather than the unit fixtures'
toy ones. The project is e2e fixture `hinrich-burmeister-spouse`; the question is the one its committed run
`run-2026-11-12_19-53-05` selected.

A regression guard for the national fill, and the one fixture whose period has no census at all.

Not graded: "no `question-selection` spawn; no new question" (printed as `must_not`, and graded anyway
by `no_research_job`).

## Expected result today

PASS. Measured 2026-11-19, research-plan on `claude-sonnet-5-5` at `low`:

```
PASS plan-schonberg-hinrich-burmeister  expected=research-plan  first=research-plan  save=ok  stop=clean
    units: research-plan  extraction_append=0
```

8 plan items, 8 tool calls, no `collections_search`, about 63 seconds.

## Starting state

- `starting-research.json`: e2e fixture `hinrich-burmeister-spouse`'s own `starting-research.json`, plus
  - its run `run-2026-11-12_19-53-05`'s question as `q_001`, reset to `open` with an empty `search_stop`:
    "Who was the mother of the child Hinrich Burmeister baptised at Schönberg on 29 July 1687, son of Hinrich Burmeister of Schönberg (b. 1653)?"
  - that run's `localities` entry for Mecklenburg-Strelitz, Germany, 1683-1689, re-filled from FamilySearch's live catalog on
    2026-11-19 with `npx tsx dev/fill-locality-fixtures.ts --all <starting-research.json>`: 1 row the guide saved and 5 more Germany rows; Germany gets no national rows.
- `starting-tree.gedcomx.json`: the e2e fixture's own.

## Caps

`wall_clock_seconds: 900`, `tool_calls: 60`, `max_turns: 60`: one planning turn, measured at about a minute
and under ten tool calls. `max_cost_usd: 2` only labels a run (spec §6).

## Cost

Measured 2026-11-19: $0.42 (`usage.whole_run_cost_usd_estimated`). One run.
