# Research-Latency Baseline — 2026-07-05 (Phase 0)

**Status:** measured from committed e2e runs; the owed fresh kenneth run is now in
(§5). **A later per-skill attribution corrected two claims — see §7:** 2b is mostly a
harness/tool lever, not skill-prose, and the append-token hypothesis is refuted.
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
| `Read` | 40–56 | **mostly distinct-offset _paging_ of oversized `record_search` sidecars + load-bearing cold-entry reads; true re-reads only ~3.75/run** (offset-aware) | tool: bound `record_search` output (stops the paging); prose residue ~1–2/run, below the noise floor — **see §7** |
| `research_append` + `research_log_append` | 25–45 combined | one-entry-at-a-time appends | 1c is **shipped** (`ops[]` batch) but **under-adopted** — skill prose should batch |
| `ToolSearch` | 7–22 | deferred MCP-tool loading, one round-trip each — tools are **already declared** in each skill's `allowed-tools` | harness: preload declared `allowed-tools` (**not** prose-fixable) — **see §7** |

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
  - **2b (round-trip reduction)** — cuts turns (59–165). But the later attribution
    (§7) shows its two largest sources are **not** skill-prose: `ToolSearch`
    round-trips need a **harness** preload of already-declared `allowed-tools`, and
    the re-read count is mostly oversized-`record_search` sidecar paging that needs a
    **tool** output bound. The one skill-prose 2b item left is adopting the `ops[]`
    batch-append form.
  - **2c (auto-chaining)** — still a `plan-design-review` item, not a foregone win.

Net: **stop adding persistence tools for latency.** The one clearly skill-prose lever
is **2a**; the biggest **2b** wins are a harness preload + a bounded `record_search`
(§7), not prose.

## 5. The owed measurement — done, and its confound

Fresh kenneth-quass-death run (`run-2026-07-05_20-05-17`, **pass**, proof 2/3),
beside the Jun 16 point:

| | Jun 16 (pre-migration, pre-#578) | Jul 05 (post-migration, post-#578) | Δ |
|---|---|---|---|
| wall-clock | 32.5m | 50.3m | **+55%** |
| model-API % | 99.7% | 99.6% | flat |
| turns | 129 | 125 | −3% (flat) |
| output tokens | 105,544 | 131,635 | **+25%** |
| tok/turn | 818 | 1,053 | **+29%** |
| cost | $6.47 | $7.88 | +22% |
| top tools | `Edit:37, validate:15` | `research_append:24, research_log_append:7` | **different workflow** |

The naïve read — "latency *rose*, so the perf work regressed" — is wrong. **These
two runs are not a clean A/B for any single change**; at least three things moved
between them, and the confounds dominate:

1. **The persistence architecture migrated.** Jun 16 hand-wrote research.json via
   `Edit` (37×) + `validate_research_schema` (15×); Jul 05 uses the structured
   `research_append` (24×) + `research_log_append` (7×) tools. That is a different
   generation profile, not a prose change. **Hypothesis (now tested → refuted):** that
   a batched `research_append` serializes a large assertion payload *as tool-use input*
   — generated output tokens — and so *raises* tok/turn. Measured over both runs'
   committed `tool_calls` args, the migration **cut** persistence payload, not raised
   it: **33%→22%** of output tokens (34.7k→28.4k absolute), because `Edit` must
   regenerate the `old_string` locate-context on every write while `research_append`
   emits only the new entry. So the tok/turn rise (818→1,053) is **not** append
   serialization — it is the extra conflict-path research in point 2. Structured
   persistence was a token *win*. (§7.)
2. **Different research path.** The Jul 05 run hit a conflict (`conflicts=yes`,
   proof 2/3, exhaustiveness=partial) and did conflict-resolution + argument-form
   proof work the Jun 16 run did not. More work → more tokens, legitimately.
3. **Single-run variance + gen stalls.** No `temperature=0`; the Jul 05 timeline
   carries individual 206s / 177s / 164s generation gaps (one turn each) that read
   as API-side queueing on this run, not a systematic property. n=1 per side.

**So we still do not have a clean e2e measurement of #578 — and can't cheaply get
one**, because the only pre-#578 kenneth run also predates the migration. This is
the real lesson: **at e2e, confounds are unavoidable** (architecture, research path,
stalls, n=1), so e2e wall-clock is a *coarse multi-run trend*, not an attribution
tool. **Attributing a single SKILL.md edit needs the unit-level instrument**
(`make skill-latency`, PR #583) — identical test inputs, same skill, isolated. Use
e2e to watch aggregate drift; use unit to credit a specific edit. A genuine #578
e2e A/B would require two runs that differ *only* in #578 (both post-migration) —
worth one focused pair if a hard e2e number is ever needed.

The fresh run JSON is uncommitted at
`eval/runlogs/e2e/kenneth-quass-death/run-2026-07-05_20-05-17.json` (+ `.final-tree`,
`.final-research`, `.transcript.md`). It is **not** added to this PR — committing an
e2e run that produced a final tree triggers the same-PR grading gate
(`check-e2e-fixtures`), and that `.ann.json` is a calibration judgment for the
maintainer, not away-block work. Grade + commit it as a second canonical baseline if
wanted (`/grade-e2e-run`), or discard it — the numbers above are already captured here.

Reproduce the breakdown:
```
make e2e-latency TEST=kenneth-quass-death       # newest committed run
```

## 6. Reproduce

```
make e2e-latency            # all fixtures, human blocks
make e2e-latency MD=1       # Markdown comparison table (§2)
make e2e-latency TEST=<slug> # one fixture
```

## 7. Correction (2026-07-05, post-attribution)

A per-skill round-trip attribution over the same committed runs (offset-aware re-read
metric + an adversarially-verified audit of the six highest-footprint skills)
sharpened two claims above.

**§3/§4 — "2b is a skill-prose lever" was mostly wrong.**

- The `Read` count (40–56/run) is largely *not* redundant. Counting a re-read only
  when the same `(file, offset)` window repeats with no write since drops true-waste
  re-reads from ~11/run to **~3.75/run**. The rest is **distinct-offset paging** of
  `record_search` output that overflows to a multi-thousand-line `.txt` sidecar (each
  page read once), **load-bearing cold-entry reads** (a skill launched with only a
  `pli_00X` id must read research.json once to recover state), and **re-launches** of
  a skill for a different plan item (miscounted as "re-reading SKILL.md"). Adversarial
  verification left only ~1–2 prose-fixable reads/run.
- The **~12 `ToolSearch`/run** are **not** prose- or frontmatter-fixable: every
  reloaded tool is *already* declared in the skill's `allowed-tools`; the harness
  defers MCP tools regardless, so the reload is the mandatory first-load. Removing it
  needs a **harness** preload of declared `allowed-tools`, not a skill edit.
- 2b levers, ranked by **round-trip count**: **harness** (preload declared
  `allowed-tools`, ~12 round-trips/run) > **tool** (bound `record_search` output,
  stops sidecar paging) ≫ **skill prose** (~1–2 reads/run across four skills — below
  the cost of the re-annotation a SKILL.md edit triggers). The one clean skill-prose
  2b item is `ops[]` batch-append adoption. **Skill-prose effort belongs on 2a.**
  *By wall-clock, not count,* the harness lever is only ~3–6% (prior value research —
  ToolSearch turns are cheap and the context cache is 95–97% hit), and it is a
  **Cowork/SDK runtime** feature request, not repo work: we declare `allowed-tools`;
  the runtime decides preload vs. defer. The `record_search` output bound is the one
  2b lever that is both repo-implementable and non-trivial by wall-clock.

**§5 point 1 — the append-token hypothesis is refuted** (see the corrected point 1):
structured persistence *cut* the payload share of output tokens (33%→22%, 34.7k→28.4k
absolute), because `Edit` regenerates `old_string` locate-context on every write while
`research_append` emits only the new entry.

The attribution and payload figures are one-off analyses over each run's committed
`tool_calls` (full `args` included), not yet a `make` target; productionizing them as
`make e2e-payload` is a separate follow-up.
