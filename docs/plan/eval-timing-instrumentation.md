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

## Weekly timing review (no re-run)

```
make eval-timings            # or: TOP=30 make eval-timings
```

`scripts/timing_report.py` scans the **latest** run log per skill (read-only,
no execution) and prints a per-skill table (makespan vs summed skill work,
API%, retries, cost) plus the slowest tests across all skills, each flagged by
*why* it's slow: `LONG` (≥ `--long-seconds`, default 300), `RETRY`
(`skill_attempts > 1` — the stall tax), `LOCAL?` (API% < 90 — wall-clock not
explained by model time). Pre-instrumentation run logs show `-` for the new
columns until that skill is re-run.

## First instrumented run — findings (question-selection + timeline, 21 tests)

The run flipped two of the working assumptions. The data:

- **It is 100 % model generation, not the stall tax.** Every test reported
  `API% ≈ 100%`, **0 transient retries** across all 21, judge ≈ 3.5 % of skill
  time, tools mocked (~0). There is essentially no local/stall/queue overhead
  to reclaim. The e2e "~43 % stalls" figure does **not** carry to the unit
  suite — almost certainly because back-to-back concurrent tests keep the
  prompt cache warm and avoid the cold-cache cliffs that hit long e2e
  sessions. **#2 (service tier / silence-watchdog retune) is retired for unit
  tests.** Measuring first is exactly what avoided building it.

- **One pathological test set the whole-suite makespan.** `ut_timeline_009`
  ran **1013 s / 9 turns** (~113 s/turn) — 4× the next-longest test — and alone
  capped the suite concurrency speedup at 4.0× (4111 s work ÷ 1013 s pole).
  LPT (#3) correctly put it in the first wave, so the suite wall-clock ≈ its
  own length; that is the optimum for a single long job, which only proves the
  ceiling is the longest *test*, not scheduling.

### Root cause of the outlier (generalizes to all negative tests)

`ut_timeline_009` is a **negative routing test**: "write a proof argument…"
should route to `proof-conclusion`, not build a timeline. It **passed**
(timeline did not activate; `skills_invoked == ['proof-conclusion']`). The
1013 s was **proof-conclusion executing its full real workload** — reading the
GPS reference + `research.json`, selecting a form, writing a 13,605-char proof
argument, validating the schema.

But the grading proves none of that work was needed: a negative test with a
non-empty `correct_skill` **passes the instant the correct alternative appears
in `skills_invoked`** (`_compute_outcome`, orchestrator.py ~L803), and the
PreToolUse hook records that name *before* the sub-skill runs. The downstream
skill's execution quality is its own positive tests' concern, explicitly
(orchestrator.py ~L798-800). So everything after the routing call is pure
waste for what the test asserts.

This is structural, not a timeline bug. **79 of 311 tests (25 %) are
negative**, and **24 route to an expensive skill** (proof-conclusion,
record-extraction, conflict-resolution, …) — those are the negative-test
outliers; all 79 pay *some* unnecessary downstream cost.

### General fix — short-circuit negative tests at the routing decision (IMPLEMENTED + VERIFIED)

For a negative test, once a skill in its `correct_skill` is invoked via the
`Skill` tool, the verdict is sealed. The PreToolUse hook (negative tests only)
now **denies that sub-skill launch and the consume loop stops the run** —
`skills_invoked` is already recorded, so grading still returns `pass`, but the
downstream skill never executes.

- **Loses no signal this test ever measured** — it asserts only the routing
  decision; the downstream skill's quality is graded by *its* positive tests.
- **Scope:** negative tests with a non-empty `correct_skill`
  (`routing_short_circuit_skills` plumbed orchestrator → `run_skill`). Positive
  tests and out-of-scope negatives (`correct_skill: []`) are untouched.
- **Implementation note (the risk, resolved):** the hook's
  `continue_: False` / `stopReason` does **not** terminate the run in this SDK
  — the agent just tries other tools (first verification: proof-conclusion
  denied, agent fell through to `project-status`, still 181 s). The deny is
  honored but the *stop* is not. Fix: the hook sets a `routing_resolved` flag
  and the message-consume loop returns on it (one message after the routing
  call). Any abort/error the SDK puts on the trailing message is cleared so the
  run ends clean.
- **Verified on `ut_timeline_009`:** **1013 s → 3.1 s** (~330×), $0.31 → $0.005,
  `outcome=pass`, `activated=False`, `skills_invoked=['proof-conclusion']`,
  `aborted_reason=None`. (`num_turns`/`duration_api_ms` are 0 for short-circuited
  runs — no `ResultMessage` — which `timing_report.py` treats as "no data," not
  a 0% / `LOCAL?` flag.)
- **Expected fleet effect:** all 79 negative tests stop at routing; biggest
  wins on the 24 that route to expensive skills.

**Positive-test outliers are a different, inherent problem.** proof-conclusion
and record-extraction are slow in their *own* positive tests because the model
must generate a large artifact — no harness lever removes that. The only
levers there are per-test scope reduction (#5) or accepting the cost; this is
not something a single switch fixes.

## Other next steps

- **#3 refinement.** Swap the cap-based LPT weight for the prior run log's
  actual `duration_ms` now that a baseline exists (sharper makespan; the caps
  ran 2–3× longer than actuals, so they rank coarsely). Also tighten the
  oversized `max_wall_clock_seconds` caps toward observed+margin.
- **#5 per-test cost.** Use `num_turns` + per-run output tokens to find chatty
  tests and over-scoped long poles. Product surface — measure before editing.
- **Surface the breakdown in the CRUD UI** (the TS types already carry the
  fields).
