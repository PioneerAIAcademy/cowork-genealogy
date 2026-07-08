# E2E research latency: analysis + improvement plan

**Status:** Superseded in part (2026-07-05) — original analysis retained below for provenance.
**Author:** analysis pass over `eval/runlogs/e2e/` (8 runs, Jun 16 – Jul 3 2026).
**One-line:** ~80% of an e2e research run's wall-clock is sequential *model* latency (thinking/generating between turns), not FamilySearch (2–4%); the durable levers are **running fewer full-question proof loops** and **cutting/absorbing model turns**.

> **UPDATE 2026-07-05 — what has since landed on `main`.** Most of this plan's "residual" is now merged; read this before acting on anything below.
> - **P0 instrumentation: DONE** — `make e2e-latency` + `make skill-latency` (#582/#583). Phase 0 re-measured the split as a cleaner **tool-vs-non-tool** breakdown: **~97–99% of an e2e run's active loop is model *generation*; tools are 1.5–3%** (sharpens the ~80% above). Measured docs: `research-latency-baseline-2026-07-05.md`, `578-skill-latency-effect-2026-07-05.md`.
> - **Skill output-economy / turn-reduction pass: MERGED** as **#578 (`37d8250d`)** — the branch this doc called `5bc2f081` / `perf/skill-latency` "in flight". Measured effect from unit runlogs: proof-conclusion −44%, timeline −32%, conflict-resolution −23%, locality-guide −14% tokens. **Do NOT re-do these.**
> - **Quick-wins A + B: MERGED** (`184f857d`) — `tree_edit` gained `add_source` / `update_source` (also fixing a latent proof-conclusion breakage), and the closed-enum values are pinned in the assertion-classification / record-extraction prose. See `research-latency-quick-wins-{spec,implementation-plan}.md`.
> - **`07b1bb68` image_read crash cap: on `main`** (was already true).
> - **gps-mentor repinned Opus → `claude-sonnet-5`** (2026-07-05) — realizes the cheaper-model half of the P2b lever below; the residual P2b lever is cutting the *gate count* (runs showed 4 vs the spec's 3).
> - **Still open (measurement-gated / not solo-landable):** confirm #578 compounds to *e2e wall-clock* (an in-flight kenneth-quass-death re-baseline); **P1** negative-result short-circuit and **P3** extraction subagent (both touch skill/orchestration → flip unit runlogs → owe a CRUD re-annotation).
>
> The original pre-optimization analysis follows unchanged for provenance.

> **UPDATE 2026-07-06 — root cause corrected + fixes implemented** (uncommitted; owner re-annotates the two non-exempt skill runlogs + re-runs e2e to verify).
> Three fresh e2e runs (all timed out) + a June-vs-now diff overturned the earlier framing: the timeouts are **not** #522 (refuted in all three), **not** slow extraction (**P3 dead** — extraction was fast everywhere), and **not** a persist bug. The June kenneth (32m PASS) ran only 6 skills and stopped after `person-evidence` — **no `research-exhaustiveness`, no `proof-conclusion`, zero gps-mentor gates** (it hand-`Edit`ed facts). The pipeline has since added the full formal apparatus + gps-mentor gating, pushing `proof-conclusion` (the **sole** tree-writer) to ~min 57 where the 60-min cap killed it mid-write → **found-but-lost** (a fully-correct run scored recall 0.0). **Pass vs fail = purely whether `proof-conclusion` finishes before the cap** (the 1-question re-run completed it → PASS; the 2-question run got starved → FAIL).
> **gps-mentor value finding:** the two pre-gates were **net-negative** in the runs — they forced over-searching an already-answered death, a conflict registration that failed schema validation twice, and elizabeth's fatal ~30-min second search loop — and missed the actual failure. `proof-critique` (the end gate) fired in only **1 of 4 runs** (minor). The mentor is a read-only reviewer mis-deployed as a *blocking pre-gate*, contradicting its own "You are NOT a gatekeeper" prompt.
> **Implemented — one behavior, identical interactive + autonomous (no mode split):**
> 1. Default wall-clock cap **3600 → 7200 (120 min)** (`orchestrator.py`; morris already used 4800).
> 2. **gps-mentor → one advisory `proof-critique` end-gate** (+ on-demand). Dropped both pre-gates; `address_first` is advisory everywhere — never forces rework or re-opens a resolved question. (`skills/research/SKILL.md`, `agents/gps-mentor.md`, `docs/specs/gps-mentor-agent-spec.md`.)
> 3. **`research-exhaustiveness`:** a *verified-inaccessible* direct source (transport-blocked image, or nil across all tools after bounded attempts) is **pursued-and-unavailable, not an open gap** → declare exhaustive + route to `proof-conclusion` (which sets the honest tier) instead of looping `research-plan`.
> 4. **`question-selection` §1b:** gate new-question creation on **answered at a defensible tier** (`probable`+), not `proved` — an independent *unanswered* sub-fact still gets a question; corroboration/tier-chasing of an *already-concluded* fact stops → `/research` writes `project.status=completed`.
> **Dropped (owner decisions):** persist-answer-first (would write *unproven* facts to the tree — rejected) and P3 (extraction subagent — adds the exact 100–268s round-trip already dominating runs).

> **UPDATE 2026-07-06 (later) — kenneth PASSES; the real e2e limiter was the *no-progress veto*, not the wall clock.**
> The first re-run under the new mentor/cap changes *still* failed — but at **17 min** (`natural_end`), not the 120-min cap: `proof-conclusion` never ran. Root cause was in the **harness**, not the skills. The autonomous-loop Stop hook's no-progress check (`stop_checker.py`) counted **only `mcp__` tool calls** as progress (`orchestrator.py` `pretool_hook` returned before the counter on non-mcp tools). A read-only `research-exhaustiveness` step that decides "not yet exhaustive" and writes nothing makes **zero mcp calls** → the harness declared the agent stuck and allowed the voluntary stop, mid-loop, right before `proof-conclusion` — a false-positive that killed a run which had already **found** the death (17 Sep 1982). Neither prior fail was ever nudge-cap-bound (one hit the wall clock, one this false-positive).
> **Fix (`orchestrator.py`):** a new `activity_count` counts **any** tool the agent issues (Skill/Read/mcp) toward the no-progress signal, while `tool_call_count` stays mcp-only for the tool-calls *budget cap*; also raised `max_continue_nudges` **5 → 20** (worst-case bound — the no-progress check is the real backstop, not the cap). All 40 e2e harness self-tests pass. This is a harness-fidelity fix touching **all** e2e fixtures, so the same veto may have been quietly ending other runs early.
> **Result:** the next kenneth run **PASSED** — recall **1.0/1.0**, proof_quality **3/3**, 2 proof summaries, both questions resolved, `completed` in **47 min**; `proof-conclusion` ran and persisted the facts.
>
> **Latency backlog — suggestions for later (ranked; from the passing-run trace):**
> 1. **`record_search` overflow → `bash grep` loop — SCOPED SEPARATELY** in [`record-search-compaction-scope.md`](./record-search-compaction-scope.md). Large results ship inline (156 KB), overflow context, and the agent greps the saved file: ~5–6 generation round-trips + ~350 KB token bloat per large-search run, **and** a production-correctness risk (the VM may block `bash`, stranding the agent). Highest ROI; being built first.
> 2. **Cut output tokens.** The dozen >1-min timeline gaps are *all* model generation — no tool or network stall anywhere. Continue prose concision: `proof-conclusion` echoing the narrative it just persisted, "Present" steps re-printing persisted content, verbose 7-point exhaustiveness dumps.
> 3. **Trim redundant round-trips.** The `proof_summary` write **failed schema validation** (missing `tier`/`vehicle`/…) → a `Grep` of the SKILL.md + a retry; a complete-write template or a preflight removes that turn. The early exhaustiveness *consult* (runs before the plan drains and predictably says "not yet") could be gated tighter.
> 4. **Keep batching writes.** 22 `research_append` + 10 `tree_edit` in the passing run; the batching keystone landed but more may coalesce.
> 5. **Model routing.** Cowork runs Opus by default and skill `model:` pins are inert there; the only Sonnet lever is moving mechanical work into *pinnable subagents* (as gps-mentor already is). Ties to Part VI.

---

## Part I — Why e2e runs are slow

Method: the harness records a `usage.timeline` of `[elapsed_s, kind]` per SDK message. The gap *before* an `assistant` message = model latency (think + generate + queue); the gap *before* a `tool_result` = tool execution. Decomposition across the 5 runs that carry a timeline:

| Run | Wall | Model (before-assistant) | Tool exec | Gaps ≥120s | Outcome |
|---|---|---|---|---|---|
| bottemiller | 60 min (cap) | **2737s / 76%** | 80s / 2% | 3 gaps / 637s | timeout, judged pass |
| elizabeth | 60 min (cap) | **2828s / 79%** | 102s / 3% | 3 gaps / 485s | timeout, **partial** |
| ivyl | 43 min | **2146s / 84%** | 48s / 2% | 3 gaps / 444s | **crash (1MB buffer)** |
| teitje | 49 min | **2374s / 81%** | 112s / 4% | 4 gaps / 681s | completed |
| spriggs-06-24b | 43 min | **1810s / 70%** | 45s / 2% | 3 gaps / 870s | completed (1 resume) |

**Root causes, ranked:**

1. **Model latency is the whole cost.** 76–84% before-assistant; tool execution 2–4%. `wall ≈ (full-question loops) × (sequential turns/loop) × (latency/turn)`. FamilySearch is *not* the bottleneck.
2. **A few giant stalls dominate — and are unattributed.** Gaps ≥120s are 13–34% of each run (single gaps of 150–606s). Timelines record message *arrival* only, so these can't be split into "long thinking over a big context" vs "transient API queue/retry." **This is the largest bucket we currently can't act on** — and it makes the prior "~43% transient stalls" hypothesis unverifiable from these logs.
3. **The per-question proof loop doesn't converge.** Each question re-runs plan→search→extract→classify→person-evidence→exhaustiveness→mentor-gates→proof (~40 min). 4/8 runs hit the 60-min cap, 1 crashed, 3 completed — a run buys ~1.5 questions. **elizabeth spent ~min 7–30 running the full proof apparatus (incl. 4 gps-mentor gates, ~11 min) on a gatekeeper question it had already said couldn't name the parents**, found the real answer in a later question at min 46, then timed out before proving it → graded *partial*.
4. **Excess agent-controlled turns.** Persistence 28–120 calls/run (recent runs already batch 35–65%); ToolSearch re-selection 9–18/run; 28–56 Reads/run; 14–18 duplicate identical calls; denied `Bash` retries (bottemiller 12× — `Bash` isn't in the allowlist).
5. **Payload/context growth.** ivyl escalated to over-broad searches (one `record_search` returned 283,687 chars) then uncapped `image_read`, blew the 1MB SDK buffer, and crashed. `research.json` grows to ~58KB and is re-read repeatedly.

---

## Part II — Do the runlogs contain enough to diagnose this? *Partly.*

**Sufficient** to establish *what* dominates (the 80/2–4 split, exact turn counts, the gap distribution). **Not sufficient** to decompose per-turn *latency*, and — the cruel irony — **the slowest runs are the least instrumented**: `duration_api_ms`, `num_turns`, and `total_cost_usd` are written only when a `ResultMessage` arrives, which a timeout or crash prevents. So all 4 timeout runs are dark on exactly the fields we need. Also: 3/8 runs have empty timelines (pre-instrumentation), and the richest artifact — the `.session.jsonl` the harness *copies* next to the runlog — **isn't committed**.

**What to add (ranked, code-grounded in `eval/harness/e2e/orchestrator.py`):**

1. **Per-turn API time + token counts, flushed incrementally** (not only on `ResultMessage`). The only way to split the giant gaps into context-think (→ context lever) vs transient queue/retry (→ backoff lever), and to confirm/kill the 43% hypothesis. Highest value — it decides which later fix matters.
2. **Phase/skill tag on each timeline entry** (track the active `Skill`) → wall-time-per-skill, to size the convergence opportunity (today reconstructed by hand from `Skill`-launch line numbers and server `performed` timestamps).
3. **Per-tool-call duration + result byte-size + a "consumed" flag** in each `tool_calls` entry, so a stall pins to a specific tool and oversized payloads are visible before they hurt.
4. **A distilled per-turn summary sidecar** committed next to the runlog (`run-<ts>.turns.json`) — *not* the multi-MB raw `session.jsonl`. Removes the timeout blindspot cheaply.

---

## Part III — Should we remove or double the run caps?

**No — don't raise the wall cap as a performance move; it's the one change that works against the goal.**

- **Only the wall-clock cap ever binds.** Across 8 runs: 4 timeouts, 1 crash, 3 completes — and **zero** hits on `max_turns` (250), `tool_calls` (300), or `max_cost` ($15). Completed runs used 59–129 turns and $3–7. Doubling turns/tool/cost caps changes nothing.
- **Raising the wall cap makes the metric lie.** On a timeout the judge still grades the final tree (bottemiller *passed* while timing out). Raise the cap → more runs reach `completed` → **pass rate goes up while user latency goes up.** For a latency proxy that's exactly backwards.
- **Since e2e is human-run (never CI), a *crash* is the worst outcome** — it wastes the babysitter's ~40 min and yields no gradable conclusion. The lever is crash-*prevention* (largely already shipped: image_read cap; residual = record_search inline bounding), not a bigger cap.

**What to actually do — caps as warnings, not errors (the agreed direction):**
- **Convert the wall-clock and progress-stall caps from auto-abort → warnings.** These are the caps whose auto-abort *destroys learning*: the run gets killed mid-research and the human babysitter loses the arc. Instead, **record the "exceeded 60 min" / "no progress 10 min" flag on the result (the smoke-alarm signal stays) but let the attended run continue** to a natural conclusion — or let the human decide to stop it. (The existing resume-on-stall already leans this way — it resumes rather than aborts on a stall; this extends the same philosophy to the wall cap.)
- **Keep a hard backstop on the runaway-protection caps** — cost, `tool_calls`, `max_turns`. Make these warn at the current value but hard-stop at a higher multiple (e.g. warn at $15, hard-stop at ~$50), so an *un*attended-moment infinite loop is still bounded. A pure warning with no ceiling risks a runaway spend/loop; a warn-then-hard-backstop keeps the "never lose a run to a soft limit" benefit without that risk.
- The **1 MB buffer crash is not a cap** and can't be a warning — it's an SDK hard limit, handled by payload bounding (image_read already capped on `main`; record_search residual in P2).
- **Run a one-time uncapped calibration pass** to de-censor the true latency tail (two old spriggs runs already ran 90–100 min — the real tail is past 60 min and currently invisible).
- **Consider lowering `progress_stall` (600s)** for faster stall→resume recovery — but only after Part II instrumentation shows the real max *healthy* gap, so you don't false-positive-resume genuine long thinking.
- **Add resume-from-last-good on a hard exception** (today only stalls/silence resume; a thrown exception aborts) — the natural companion to warning-not-erroring, so a mid-run failure doesn't lose the arc.

---

## Part IV — Other latency levers, with honest value (value-research pass)

Each idea was value-estimated against the runlog/transcript/code evidence, then adversarially ranked. **Bold = already shipped; don't re-fund.**

| Idea | Value | Confidence | Effort | Verdict |
|---|---|---|---|---|
| **Negative-result short-circuit / defer proof** (Part V-A) | **Medium** (≈30–38% wall on the firing run; converts a timeout-partial → likely pass) | Medium (single strong case) | Medium | **Top direct lever** — conditional (fires on non-answering gatekeeper questions) |
| Per-turn instrumentation (Part II) | Enabler | High | Small | **Do first** — prerequisite |
| Bound `record_search` inline output | Small, sure | High | Small | Recommend — extends existing `results-staging.ts` |
| Enum-hints in validator errors + cheap hygiene | Small | Medium | Small | Recommend — trivial |
| Guarded parallel subagents (multi-jurisdiction search) | Small (≈5–8% weighted; concentrated on 2–3 record-heavy runs, neutral/negative on 5/8) | Medium | Medium | Recommend-with-caveat — not a keystone |
| `record_to_assertions` scaffolding tool | Small (~20–50s, 1–4 turns/run; judgment dominates) | Medium | Medium | **Deprioritize** — GPS-quality risk, phase already batched |
| Make 39 tools resident to kill ToolSearch | Small (~3–6% wall; cache already 95–97% hit regardless) | High (that it's small) | Large / upstream-gated | **Deprioritize** as a latency fix |
| **Progressive disclosure (stream findings)** | ~0 wall, ~0–2 min perceived | High | — | **Already delivered** — Electron `watcher.ts` + web WS `sandbox_server.py` + inline chat narration (time-to-first-finding already ~4–9 min) |
| **image_read payload cap (crash fix)** | Prevents 1/8 crash | High | — | **Shipped on `main`** — `07b1bb68`, `MAX_INLINE_IMAGE_BYTES=700_000` |
| Reduce gps-mentor cost (fewer gates; cheaper model for light gates) | Small–medium (~3.5–4 min/question on the critical path today) | Medium | Small–medium | **Recommend** — newly actionable (Cowork honors agent models) |
| Mixed-model via **subagents** (Haiku for mechanical phases) | Cuts per-turn latency on mechanical turns | Medium | Medium | **Available — via agents, NOT skills.** Only reachable by moving a phase into a subagent + pinning its model (see P3). |
| record-extraction read-once, proof-conclusion batch edits, timeline parallel place calls, output-economy | Turn + token reduction | — | Medium | **In flight** on `perf/skill-latency` (unmerged) — don't duplicate; verify it moved the needle via P0 |

**Headline correction from the value pass:** the ideas I initially rated highest (record→assertion tool "flagship," progressive disclosure, cache hygiene) are small, already-shipped, or refuted by the data. The one lever that attacks the *actual* failure mode (timeout → ungraded/partial) is **convergence**.

---

## Part V — Moving LLM work into code

Principle: **the model's turns should be spent on judgment, not transcription, enumeration, or formatting** — but *scaffold-then-adjudicate*, never *code-replaces-LLM* (real records are messy). Grounded status:

- **A. Negative-result routing (orchestration, not a tool).** The biggest win here isn't moving a *computation* to code — it's moving a *control-flow decision* out of the model's improvised judgment into the `/research` orchestrator: "no candidate answer → log + next question; candidate exists → run proof." See Part VII P1.
- **B. Enum classification feedback → code.** The schema-rejection loops exist because the model guesses closed-enum values blind. Return the allowed values *in the validation error* (`validator.ts`). This moves the *feedback*, not the decision, into code. Cheap; catchable value ~1.5/run (small but trivial).
- **C. `record_to_assertions` scaffolding — deprioritized.** ~232 assertion/source ops/8 runs, but the phase is already batched and the *judgment* fields (which facts, which evidence classification) dominate the transcription; realistic saving ~20–50s/run against real GPS-quality risk. Not worth it now.
- **D. Timeline/chronology assembly — already parallelized** in `5bc2f081` (place calls issued in parallel per phase). Full move to a VM script is a small future option, not urgent.
- **E. Exhaustiveness candidate-source enumeration.** "What collections exist for this place+era+question-type" is a largely deterministic lookup (wiki/collections). A script could produce the checklist; the LLM prioritizes. Small, future.

---

## Part VI — Should we turn more skills into subagents?

**Yes, for a specific class — not wholesale.** A skill runs *inline* in the main agent's context (its record dumps and reasoning permanently bloat the main loop, and per-turn latency scales with context size — the dominant cost). A subagent runs in an *isolated* context and returns only a compact result. Three benefits stack; one is blocked:

- **Context isolation → lower per-turn latency** (heavy tokens never touch the main loop).
- **Parallelism → lower wall-time** (subagents run concurrently; inline skills can't).
- **Payload confinement → crash safety** (the 283KB/1MB payloads stay in the subagent).
- **Cheaper/faster-model pinning → AVAILABLE via subagents.** Cowork honors `model:` in **agents** (not skills), so a subagent phase can pin a faster model (e.g. Haiku for mechanical extraction) that an inline skill *cannot* get. This makes subagent-ification the **only** route to per-phase model control in Cowork — a distinct, real per-turn-latency lever, not just future-proofing.

**Costs:** each spawn re-boots a fresh context that **re-pays the ToolSearch tax** (so cut the tool set first, or spawns multiply overhead); subagents re-read state they need (only worth it for self-contained work); their narration is a **black box to the user** (keep user-facing phases inline); and concurrent subagents must not both write `research.json` (return entries for the parent to batch-persist).

**Decision rule:** convert when **context-heavy AND independent AND self-contained**; keep inline when it **co-edits the evolving project state** or **its narration is the user-facing story.**

| Skill | Verdict |
|---|---|
| **record-extraction** | **Convert — flagship.** Big payload in, compact assertions out; independent across records (parallelize); confines the dumps that bloat/crash the main loop. Already got "read-once" in `5bc2f081`; subagent-ification is the next step. |
| search-records / search-external-sites | Convert the *retrieval* part — filter a huge result set, return top candidates, don't dump raw. |
| assertion-classification | Fold *into* the extraction subagent (same record, back-to-back) — avoid a second handoff. |
| gps-mentor | **Already a subagent** — correct precedent. |
| research-plan, question-selection, research-exhaustiveness, proof-conclusion, `/research` | **Keep inline** — reason over/co-edit the whole state; narration is the story. |

---

## Part VII — Prioritized implementation plan

Sequenced by the adversarial ranking. **Instrument before you optimize** — the current numbers predate `5bc2f081`.

### P0 — Instrument + re-baseline *(enabler · small · high confidence · do first)*
- In `orchestrator.py::_run_agent`: (a) flush `usage` incrementally so a timeout/crash still reports `num_turns`/`duration_api_ms`/cost; (b) add a phase tag to each `timeline` entry (track the active `Skill`); (c) add `duration_ms` + `result_bytes` to each `tool_calls` entry; (d) emit a distilled `run-<ts>.turns.json` (per-turn api-ms/tokens/phase) from the already-located `session.jsonl` and commit *that*, not the raw file.
- Then **re-run 2–3 fixtures** (elizabeth, teitje, a record-heavy one) to get a post-`5bc2f081` baseline and split the giant gaps think-vs-transient.
- **Exit criteria:** timeout runs carry turn/cost/api-ms; per-skill wall-time is reportable; the 43% hypothesis is settled.

### P1 — Negative-result short-circuit / defer proof *(top direct lever · medium · medium effort)*
- In the `/research` orchestrator: when a question's retrieval yields **no candidate answer for the objective**, `research_log_append` a negative result and route to the next question, **deferring** exhaustiveness / proof-conclusion / gps-mentor gates until a candidate exists at the objective level (defer, don't eliminate — GPS rigor stays).
- Co-design with **question-selection** (root cause: it posed elizabeth's gatekeeper question). Consider not spawning full-proof-cycle gatekeeper questions at all.
- Gate on the agent's *explicit* "no candidate" signal (it already emits one).
- **Validate on an e2e re-run measured by P0.** This is rigor-critical — do not ship without the re-run.
- **Exit criteria:** on elizabeth-class runs, the min-46 breakthrough moves earlier and the run completes the answering question's proof inside the cap; answering-first runs (bottemiller) are unaffected.

### P2 — Cheap residuals *(parallel · small · small effort)*
- **Bound `record_search` inline output:** return a compact projection by default + the existing `staged.resultsRef` handle, so 70–150KB result sets stop landing in context. `results-staging.ts` + `stageSearchResults` are already wired to `research_log_append`; this is the inline-return tail.
- **Enum-hints:** add the allowed-values list to the ~4 validator error sites that omit it (`validation/validator.ts`), so the model stops guessing `conflict_type`/`tier`/`evidence_type`.
- (The "trust the delta, don't re-Read" and persistence-batching hygiene are **in flight on `perf/skill-latency`** — verify with P0 once merged, don't duplicate.)

### P2b — Reduce gps-mentor cost *(small–medium · small–medium effort · newly actionable)*
- gps-mentor is the only plugin agent, **pinned to `claude-sonnet-5`** (repinned from `claude-opus-4-8` on 2026-07-05), invoked **3–4 gates per answering question at ~40–84s each ≈ ~3.5–4 min/question**, on the critical path (the parent blocks on each gate). Cowork honors an agent's `model:`, so the repin is live — this **already banks the cheaper-model half of this lever**; the residual is the gate *count*.
- **(a) Cut gate count:** the spec has 3 checkpoints but runs show 4 (elizabeth, teitje) — re-checks, "second pass", "final critique after revisions". Consolidate the re-invocations. (P1 already removes gates entirely for non-answering questions; this addresses the answering-question path.)
- **(b) Right-size the model per gate:** run the lightweight readiness gates ("is there a candidate answer / are we ready to conclude?") on a faster model (Sonnet/Haiku) and reserve Opus for the substantive post-proof critique — split the agent, or use a per-invocation model override. Audit first whether every gate needs Opus-level review.

### P3 — record-extraction → parallel per-record subagent *(concentrated · small–medium · medium effort)*
- Define a `record-extraction` subagent; the orchestrator fans out one per found record on record-heavy questions. Extractors **return** their assertion/source entries for the parent to **batch-persist in one flush** (no concurrent `research.json` writes).
- **Pin it to a faster model (e.g. Haiku)** — Cowork honors agent models, so this is an *immediate* per-turn-latency win on the mechanical transcription, not just future-proofing. This is the only way to get cheaper compute on that phase (skills can't).
- **Sequence after** a tool-set trim (so each subagent boots without re-paying the full ToolSearch tax) — or accept the boot cost and measure.
- Value: context/payload isolation + parallelism + the Haiku model-pin. Concentrated on record-heavy runs; do after P0–P2.

### Do NOT fund (already done or refuted)
- image_read cap (`07b1bb68`, on `main`), progressive disclosure (streaming shipped on `main`).
- `record_to_assertions` tool (small, quality risk). Making 39 tools resident purely for latency (small win, large/upstream effort, cache already 95–97%).
- **Don't duplicate `perf/skill-latency`** (record-extraction read-once / proof-conclusion batching / timeline parallel / output-economy) — land + verify that branch instead.

---

## Appendix — Data & method

- **Source:** 8 runs under `eval/runlogs/e2e/` (bottemiller, elizabeth, ivyl, kenneth, spriggs ×3, teitje), Jun 16 – Jul 3 2026. 5 carry a `usage.timeline`; 3 (kenneth, spriggs-06-23, spriggs-06-24-05) predate that instrumentation.
- **Timeline decomposition:** gap before `assistant` = model latency; before `tool_result` = tool execution; `system:*` = init/status/task_notification.
- **Caps (defaults, `orchestrator.py::FixtureCaps`):** wall 3600s, inactivity 600s, progress_stall 600s, tool_calls 300, max_turns 250, cost $15, continue_nudges 5. Agent model `claude-sonnet-4-6`, judge `claude-haiku-4-5`.
- **Verified shipped:** `07b1bb68` (image_read cap), `5bc2f081` (skill perf pass), `apps/electron/src/main/watcher.ts` + `apps/server/app/sandbox_server.py` (streaming), `packages/engine/mcp-server/src/utils/results-staging.ts` (search staging).
- **Method note:** quantitative extraction was deterministic (Python over the runlog JSON); transcript characterization and value estimates were produced by a fan-out of subagents and an adversarial ranking pass, then reconciled against the code.
