# Research-Latency Baseline — 2026-07-05 (Phase 0)

**Status:** measured from committed e2e runs; one canonical fresh run still owed
(blocked on FamilySearch re-login — see §5).
**Feeds:** [`research-latency-reduction-plan.md`](./research-latency-reduction-plan.md) (this is its Phase 0 gate).
**Tool:** `make e2e-latency` (`eval/harness/e2e/latency_report.py`) — pure analysis
over committed run JSONs, no live run, no API. Reproduce any number below with it.

## 0. TL;DR

**Tool execution is not the problem. Model generation is the entire problem.**

Across every committed e2e run, tool execution is **0.8–1.9 minutes** — 1.5–3% of a
30–70 minute run. The other **97–99%** of the active agent loop is the model
generating (thinking + text + tool-use decisions). So:

- Faster or batched **tools** can reclaim **at most ~2 minutes** per run. Not the lever.
- The lever is **model-generation time**, which is `turns × output-tokens-per-turn`.
  Reduce **turns** (fewer round-trips) and **output per turn** (narration precision).
- This **confirms and sharpens** the roadmap's premise ("make the model generate
  less, in fewer round-trips") and **reprioritizes** its phases (§4).

## 1. Method

The orchestrator already persists everything needed into each committed result
JSON (`eval/runlogs/e2e/<slug>/run-*.json`, schema in `e2e/result.py`): SDK
`duration_ms` / `duration_api_ms`, `num_turns`, token counters, and (for runs
after ~2026-06) a per-message `timeline` of `[elapsed_s, kind]`. `latency_report.py`
derives two **independent** decompositions that corroborate each other:

1. **Usage-based** — `duration_api_ms / duration_ms` = fraction of the active SDK
   loop spent awaiting the model. Always present; SDK-internal, so unaffected by
   harness overhead.
2. **Timeline-based** — inter-message gaps split into **tool-execution** (gaps
   ending at a `tool_result`) vs **everything-else** (model generation, plus any
   stall/resume idle). Only the tool bucket is cleanly separable from a single
   session's timeline; we do **not** split model-vs-idle further (an earlier
   3-bucket attempt mis-scored interim `system:status` messages emitted
   mid-generation as "overhead"). Wall-clock beyond the timeline span is flagged
   as **stall/idle** (stall + resume + judge), which is neither model nor tool.

## 2. The data (latest committed run per fixture)

| fixture | verdict | wall | model-API %¹ | tool exec² | turns | out tok | tok/turn | cost |
|---|---|---|---|---|---|---|---|---|
| kenneth-quass-death (Jun 16, **pre-migration**) | pass | 32.5m | 99.7% | — ³ | 129 | 105,544 | 818 | $6.47 |
| morris-jenkins-marriage | pass | 67.6m | 97.5% | 1.9m (2.8%) | 165 | 140,443 | 851 | $9.72 |
| spriggs-parents-1898 | pass | 70.3m | 99.4% | 0.8m (1.7%) | 59 | 69,566 | 1,179 | $3.44 |
| teitje-harkema-parents-1833 | pass | 49.2m | 97.7% | 1.9m | 108 | 112,103 | 1,038 | $6.55 |
| bottemiller-parents | pass | 60.4m (timeout) | n/a⁴ | 1.3m | — | — | — | — |
| elizabeth-geach-parents | partial | 60.4m (timeout) | n/a⁴ | 1.7m | — | — | — | — |
| ivyl-greenley-daughter | pass | 43.0m | n/a⁴ | 0.8m | — | — | — | — |

¹ Of the **active SDK loop** (`duration_ms`), not raw wall-clock — see spriggs.
² Timeline `tool_result` gaps. The reclaimable ceiling for any tool-speed work.
³ The Jun 16 kenneth run predates the `timeline` field, so no timeline split;
  its 99.7% usage-based number is the cleanest single "it's all model" data point.
⁴ These three store a `timeline` but not the ResultMessage usage block, so
  usage-based %/turns/tokens are absent; their tool-execution time (≈1–1.7m)
  still confirms the headline.

**spriggs is the instructive outlier:** 70.3m wall, but only 22.0m active SDK loop
and **27.3m stall/idle** (it stalled once and resumed — a 606s `tool_result →
system:init` gap). Its wall-clock is inflated by *idle*, not work. Stalls are a
**reliability** issue (already mitigated by `RESUME_ON_STALL`), not a
latency-tuning target — no amount of tool or prompt work reclaims idle time.

## 3. What actually drives the model-generation time

Two knobs, both visible above:

- **Output tokens per turn: 818–1,179.** Every token is generated
  serially — this is the per-turn cost. Directly attacked by **narration/thinking
  precision** (Phase 2a).
- **Turns: 59–165.** Each turn is a full model round-trip that re-reads the
  (cached) context and generates. Fewer turns → fewer generation cycles.
  Attacked by **round-trip reduction** (Phase 2b).

Round-trip hotspots, from the per-run tool-call histograms (`make e2e-latency`
prints top tools):

| pattern | typical count / run | nature | lever |
|---|---|---|---|
| `Read` | 40–56 | re-reading files often already in context (research.json, tree, templates) | 2b: "you already have X — don't re-Read" (skill prose) |
| `research_append` + `research_log_append` | 25–45 combined | one-entry-at-a-time appends | 1c is **shipped** (`ops[]` batch) but **under-adopted** — skill prose should batch |
| `ToolSearch` | 7–22 | deferred MCP-tool loading, one round-trip each | 2b: preload the tools a skill will need |

## 4. Implications for the roadmap (the reprioritization)

Measured against `research-latency-reduction-plan.md`:

- **Phase 1a (`tree_edit add_source`/`update_source`) — SHIPPED.** Verified in
  `tree-edit.ts` + `SimplifiedSourceDescription.author`.
- **Phase 1c (`research_append` batch) — SHIPPED as `ops[]`.** But the data shows
  25–45 append calls/run, so the batch form is **under-adopted in skill prose**.
  The remaining 1c win is **adoption** (a 2b/2a prose change), not tool code.
- **Phase 1b (`project`/`researcher_profile` writer) — NOT a latency lever.**
  It targets a one-time-at-project-creation write; against a budget that is
  97–99% model generation spread over 59–165 turns, it saves ≈0 latency. Keep it
  **only** if wanted for ergonomics/consistency (the structured-persistence
  initiative), not as latency work. **Deprioritized here.**
- **Phase 1d (`init-project` migration) — depends on 1b; same deprioritization**
  for latency.
- **Phase 2 is where the time is** (now un-gated by this measurement):
  - **2a (narration/thinking precision)** — cuts output-tokens/turn (818–1,179).
    Highest-leverage single lever. Quality-sensitive → must be verified by
    per-skill unit-eval re-runs before landing.
  - **2b (round-trip reduction)** — cuts turns (59–165): stop re-reading files
    already in context; preload expected tools to kill `ToolSearch` round-trips;
    adopt the `ops[]` batch-append form.
  - **2c (auto-chaining)** — still a `plan-design-review` item, not a foregone win.

Net: **stop adding persistence tools for latency; spend the effort on 2a + 2b**,
both of which are skill-prose changes.

## 5. The one owed measurement (blocked)

A fresh **post-migration** kenneth-quass-death real run, to sit beside the Jun 16
pre-migration point (32.5m / 129 turns / 818 tok/turn) and confirm the persistence
migration's effect on the canonical fixture. Blocked only on an interactive
FamilySearch re-login (the token is >24h old; `e2e-preflight` is green on
everything else — built server, `ANTHROPIC_API_KEY`, deps). To run it:

```
make e2e-login                                 # browser OAuth, ~24h-lived
make e2e-run  TEST=kenneth-quass-death          # ~20–60 min, $3–10
make e2e-latency TEST=kenneth-quass-death       # breakdown of the fresh run
```

This does **not** change the §4 conclusions — the model-vs-tool split is already
unambiguous across seven runs. It refines the canonical before/after for the
migration, and gives 2a/2b a fixed reference to measure against.

## 6. Reproduce

```
make e2e-latency            # all fixtures, human blocks
make e2e-latency MD=1       # Markdown comparison table (§2)
make e2e-latency TEST=<slug> # one fixture
```
