# evaluate-sources-moses-watrous

**Ask:** "For PID GM5J-6WX, Moses was old enough to serve in the Civil War. But there are no sources that
claim that. His birth place on his profile also doesn't match the rest of the family. Can you evaluate the
sources linked to resolve his birth place and create a plan for finding out if he did serve in the Civil
War?"

**Expected owner:** `source-evaluation`. **Expected save:** one new `log` entry with
`tool: "source_evaluation"`. Not a plan ask: step mode delivers the first deliverable and offers the plan
("Continue with …?"), so `question-selection`, `research-plan`, a new question or a new plan fails.

## Where it came from

Row B1 of Issue #3571's adjudication on issue #3527 (2026-11-02): alpha feedback issue #3217 (`feedback-2026-10-06T21-04-13-092Z.zip`).

## Expected result today

FAIL on `no_research_job`. Measured 2026-11-02:

```
FAIL evaluate-sources-moses-watrous  expected=source-evaluation  first=source-evaluation  save=ok  delivered=no  stop=clean  failed=[no_research_job]
    units: source-evaluation > question-selection > question-selection > research-plan  extraction_append=0
    research job: question-selection, research-plan, new questions entry, new plans entry
```

The main thread never loaded the `research` router: it spawned `source-evaluation` from that agent's own
description, then ran `question-selection` and `research-plan` in the same turn. The "deliver the first,
offer the next" rule lives in `research/SKILL.md`, so it never applied. Tracked on issue #2813.

## Starting state

Starting tree: `person_read` of GM5J-6WX with relatives and sources, snapshotted 2026-11-02 through
`e2e.author`'s `fetch_person_read`, `normalize_tree` and `living_gate(drop_living=True, heuristic=True)`,
with no schema errors (`author snapshot` writes only under `eval/tests/e2e/`, so the same calls were made
directly). `starting-research.json` has the objective set and no questions, plans, log entries or sources. Moses Fish Watrous has 25 attached sources.

## Caps

`wall_clock_seconds: 2400`, `tool_calls: 150`, `max_turns: 150`: a source review over 25 attached
sources is larger than the 12-source `review-sources-kenneth-quass` placeholder (25 tool calls), so its
caps were not reused. The measured run used 38 tool calls. `max_cost_usd: 6` only labels a run (spec §6).

## Cost

Measured 2026-11-02: $2.55 (`usage.whole_run_cost_usd_estimated`), `claude-sonnet-4-6` at effort `high`.
One run, and it ran a plan it should not have.
