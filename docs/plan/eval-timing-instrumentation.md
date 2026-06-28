# Eval skill-unit-test timing: instrumentation + scheduling

Status: implemented on branch `eval-timing-instrumentation` (changes below
landed and unit-tested); the "attack the stall tax" fixes are **data-gated**
and deliberately deferred until the new instrumentation produces a first run.

## Why

The skill unit tests have been slow since the start, and a chunk of tests
override the default 5-minute wall-clock cap. We wanted to (1) know which
tests override the cap, (2) check whether run logs carry enough timing detail
to find the cause, and (3) make whatever speedups and measurement
improvements we can now, before a re-run.

## Findings

### 1. Timeout overrides (89 of 311 unit tests carry an `execution` block)

Defaults (`eval/harness/harness/skill_runner.py`): `max_wall_clock_seconds=300`,
`sdk_message_silence_seconds=180`, `max_turns=20`.

81 tests raise the wall clock above the 300 s default:

| `max_wall_clock_seconds` | # tests | notes |
|---:|---:|---|
| 120 | 2 | *tighter* (`tree-edit/person-record-matches`, `person-person-matches`) |
| 300 | 5 | redundant (= default) |
| 480 | 22 | locality-guide, init-project, search-familysearch-wiki |
| 600 | 53 | record-extraction, proof-conclusion, conflict-resolution, timeline, search-full-text, research-plan |
| 720 | 2 | `locality-guide/ut_locality_guide_016`, `_021` |
| 900 | 1 | `proof-conclusion/reinvocation-update-in-place` |
| 1500 | 3 | `record-extraction/census-1850-subject-as-child-creates-sibling-stubs`, `person-evidence/negative-resolve-competing-identities`, `timeline/negative-proof-conclusion` |

The six ≥720 s tests are the makespan long poles. The documented reason for
the bumps (`skill_runner.py:60-69`): extended-thinking blocks of 100–160 s and
large structured-JSON Write turns (15+ assertions at once).

### 2. Run logs did NOT carry enough timing detail

What existed: per-run/per-test `duration_ms`, token counts, cost, tool-call
count. What was missing — and two of these the SDK already produced and we
were discarding in `orchestrator.py`:

- `num_turns` (SDK `ResultMessage.num_turns`) — dropped.
- `duration_api_ms` (SDK `ResultMessage.duration_api_ms`) — dropped. This is
  the field that separates API/network time from local overhead.
- judge call duration — never measured; and `totals.duration_ms` excluded the
  judge entirely (it sums only skill runs).
- real wall-clock — post-parallelism, `totals.duration_ms` is the *sum* of run
  durations, not the makespan, so "is concurrency helping?" was unanswerable.

Tool-call timing is genuinely not needed: tools are served by an in-process
mock, so MCP latency is ~0. The slowness is essentially all model time
(`question-selection` makes zero tool calls yet runs 60–239 s/test).

## What changed on this branch

### #1 — Instrumentation (keystone)

Per-run fields now persisted (all **optional** in the schema, so historical
run logs still validate):

- `duration_api_ms`, `num_turns` — recovered from the SDK `ResultMessage`
  (`orchestrator._execute_single_run`), previously discarded.
- `judge.duration_ms` — `perf_counter` around `_run_judge`.
- `skill_attempts` — attempts taken by `_execute_skill_with_retry`
  (1 = clean; >1 = transient-stall retries). The direct stall-tax signal.
- `started_at` / `ended_at` — epoch brackets around the whole run.

Roll-ups in `test_totals` and envelope `totals`: summed `duration_api_ms`,
`judge_duration_ms`, `num_turns`, and `wall_clock_ms` — the true makespan
`max(ended_at) − min(started_at)`, distinct from the summed `duration_ms`.

Touched: `eval/harness/harness/{runlog,orchestrator,skill_runner}.py`, both
schema trees (`docs/specs/schemas/run-log.schema.json` +
`packages/schema/schemas/run-log.schema.json`), and the CRUD-UI TS types
(`eval/app/lib/types.ts`).

### #3 — Longest-processing-time-first scheduling

`run_tests.py` now submits the heaviest tests first (weight estimated from
each test's `max_wall_clock_seconds` cap) so a long-pole test can't land in
the last wave and stretch the tail. Submission order changes only; output and
run-log order are unchanged (rebuilt from selection order). Zero added I/O.

### #4 — Several skills in one bounded pool

`--skill` now accepts multiple skills (`--skill a b c`, or
`make eval-skill SKILL="a b c"`). They share the single in-process thread pool
(RAM-aware 4–8, `--concurrency` to override) and each writes its own
releasable run log. This is the safe alternative to a shell loop of concurrent
`run_tests.py` invocations, which still SIGKILL under memory pressure.

### #2 — Stall-tax: measurement now, fix later

The *measurement* is in place (`duration_api_ms`, `skill_attempts`, and a
post-run **"Timing breakdown"** the harness prints: skill work vs wall,
API %, judge time, turns, transient retries). The *fix* is intentionally
deferred until a real run tells us where the time goes — committing to a
service-tier change or a silence-watchdog retune blind would be guessing. See
"Next" below.

Doc updates: `eval/CLAUDE.md` ("Serial execution" → "Concurrent execution";
new timing fields noted), `Makefile` (`eval-skill` multi-skill help).

## How to re-run

```
make eval-skill SKILL="timeline record-extraction proof-conclusion"   # one pool, longest-first
make eval-skill SKILL=locality-guide CONCURRENCY=8                     # bigger box / higher rate limit
```

Each run prints the Timing breakdown and writes per-skill run logs with the
new fields. Read the breakdown first.

## Next (data-gated, after the first instrumented run)

- **#2 fix.** If `skill_attempts > 1` is common or `duration_api_ms` is a small
  fraction of `duration_ms`, the stall tax dominates → evaluate a priority/
  service tier on the API and/or retuning the 180 s silence watchdog with a
  faster retry. The e2e analysis put ~43 % of wall-clock on transient Sonnet
  stalls; confirm the unit suite shows the same shape before acting.
- **#3 refinement.** Swap the cap-based weight for the prior run log's actual
  `duration_ms` once a baseline exists (better makespan; small added coupling).
- **#5 per-test cost.** Use `num_turns` + per-run output tokens to find chatty
  tests and over-scoped long poles. Product surface — measure before editing.
- **Surface the breakdown in the CRUD UI** (the TS types already carry the
  fields).
