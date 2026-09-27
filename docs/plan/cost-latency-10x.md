# Cut e2e research cost and latency as far as they go

**Status:** Not started. Owner: **Promise Igbojionu**, shepherding from 2026-09-27.
**No lead gates** — every ruling this plan once waited on has been
made. Update this line as waves land; delete this file when the work ships.

**Target.** A median e2e research run costs **$10.57** and takes **75.7 min**
(September regime). The bottom-up floor is **$0.60 / 5.5 min**; allowing 20k tokens of
genuine inference gives a manageable target of **$1.00 / 9 min**. That is ~10x on
cost and ~8x on latency. **Cost matters substantially more than latency.**

**How to use this.** Sections 1–9 are the operating half you live in. Appendix A is the evidence, and section 8 tells you how to re-derive any figure — which matters
because you did not measure them and will be challenged on them.

**Supersedes four documents. Repoint every Status line in the same PR as Wave 0.**
Promise would otherwise find five live-looking plans on one subject.

- `docs/plan/main-thread-residency-reduction.md` — Status says "Not started"; its
  instrumentation half is complete. Mark its levers absorbed or dropped.
- `docs/plan/research-latency-reduction-plan.md` — Status "DRAFT, for review".
- `docs/plan/research-performance-2026-07-27.md` — "PARTIALLY SHIPPED"; supersede the
  unshipped part only, and say which that is.
- The 2026-09-15 instrumentation plan, complete. **It has no citable path** — it lived
  in the root `PLAN.md`, which `.gitignore` excludes. Its output is the 13 committed
  runs carrying `result_chars` / `usage.message_usage` / `usage.thread_windows`.

---

## 1. The five levers, in priority order

Lead's ordering, 2026-09-25/27. Everything in this plan hangs off it.

1. **Reduce tool output, and eliminate tool calls entirely where possible.**
2. **Convert skills to agents**, getting their context off the main thread.
3. **Call agents and tools in parallel** as much as possible, to cut turn count.
4. **Drop model and reasoning effort as low as they go — for the research
   orchestrator as well as the agents.** The orchestrator's own model and effort is
   the bigger half: the main thread is **77–80% of wall clock**.
5. **Record extraction** — not this plan's work. **Issue #2937, John.** Named here
   only so the waves below are read as the rest of the programme, not all of it.

**The framing that makes the order make sense:** input is **72%** of the bill
(cache reads 42%, cache writes 30%; output is 27%), and **every token that enters
context costs ~$7.20/MTok carried** — $3.75 to write plus ~11.5 re-reads at $0.30.
An output token costs $15/MTok to generate *on top* of that. So a stored reasoning
token is ~$22/MTok, and the cheapest token is the one never generated.

**Turn count is the master variable.** Cost scales with assistant-message count at a
log-log exponent of **1.11** (r=0.657), and wall clock is
`output_tokens / ~50 tok/s + model_calls × prefill(prefix)`. Every lever above
reduces turns, tokens, or the unit price of both.

## 2. Baseline

MEASURED at the pinned sha `5e14a9967` unless noted.

| quantity | value | n |
|---|---|---|
| September median cost | **$10.57** (4 of 28 runs carry no cost) | 24 |
| September median wall | **75.7 min**; 236.5 tool calls | 28 |
| Whole corpus | $7.84–8.88 median cost, 59.6 min | 164–188 |
| Model calls per run | **174** (medians, which do not add: main 85, sub 75) | 13 |
| Peak main-thread window | 159,100–174,511, pinned at the ceiling | 18 |
| Compaction boundaries | 470 over 183 runs, median 2/run, ~130s each | 183 |
| Runs at or over their own wall cap | 23 (44 hit some cap; 24 ended `timeout`) | 188 |

All 4 September runs missing a cost ended `timeout`/`inactivity`, so the costed
median excludes exactly the expensive failures. **Every cost figure is a floor.**

## 3. The floor and the gap

**Floor: $0.60 / 5.5 min** — two independent derivations agreeing within 8%. Against
September that is 17.6x cheaper and 13.8x faster; the $1.00 target is 10.6x / 8.4x.

A run reads **~113,000 tokens of its own instructions** to produce a **~3,100-token**
graded answer. **75%** of extracted assertions are never referenced. **42%** of
locality entries are never referenced.

The gap, $10.57 = $0.60 floor + ~$10.00 waste. Buckets close to within 3–9%:

| bucket | $/run | % | min | lever |
|---|---|---|---|---|
| Reasoning generated | $3.16 | 30% | 45.5 | 4 |
| Reasoning carried | $1.51 | 14% | — | 4 |
| Tool-result carry | $2.56 | 24% | — | 1 |
| Instruction + agent-body carry | $1.41 | 13% | — | 2 |
| Compaction rewrites | $1.12 | 11% | 4.7 | falls out of 1–3 |
| Non-reasoning output | $0.56 | 5% | 8.0 | issue #2937 (John) |
| floor | $0.60 | 6% | 5.5 | — |

**Levers 4, 1 and 2 are 81% of the bill between them**, and they are this plan's
whole cost story. The remaining 5% sits behind issue #2937 and is John's.

---

## 4. Wave 1 — plural reads and parallelism

**The finding that makes this the first wave: 16 of the 17 read and lookup tools can
only read one thing.** Only `source_attachments` accepts an array. `record_read`,
`wiki_read`, `person_read`, `same_person`, `person_warnings`, `person_quality`,
`sidecar_read`, `image_transcribe`, `image_read`, `place_search`, `research_query`,
`collection_read`, `person_ancestors`, `place_population`, `wiki_place_page` and
`place_distance` each take exactly one id, url or name.

**So the agent has no choice but to iterate.** Only **2.7%** of assistant messages
emit more than one tool call — that is not the model failing to batch, it is the tool
surface making batching impossible. The fix is a build, not a prompt.

MEASURED, Aug+Sep, n=56 runs: **64 singular-read calls per run**, and **52.8
back-to-back same-tool repeats per run** — calls made consecutively against one tool
because it could not be asked once. Against 174 model calls/run that is the largest
identified block of avoidable turns in the system.

| tool | median calls/run | back-to-back repeats |
|---|---|---|
| `research_query` | **40.5** | 1,842 |
| `record_read` | 10.0 | 234 |
| `wiki_place_page` | 4.0 | 197 |
| `wiki_read` | 3.0 | 110 |
| `person_warnings` | 3.0 | 205 |
| `same_person` | 1.0 | 226 |
| `image_transcribe` | 1.0 | 121 |

**Three mechanisms, in descending value:**

1. **Join / expand — eliminates the call.** `research_query`'s arg shapes are
   `{questionId}`×576, `{personId}`×330, `{planItemId}`×270: an agent walking a list
   it got from the previous call. A parameter returning plan items *with* their log
   entries *with* their assertions kills the class. Today the tool **explicitly
   rejects** a plural `sections`, and its own comment says *"`sections` is the mistake
   the model actually makes"* — the demand is already measured in the error path.
2. **Plural args — collapses N same-tool calls into one.** 52.8/run of measured
   headroom. Build in the order of the table above.
3. **Parallel tool calls — collapses N different-tool calls into one turn.** Unlocked
   by the first two: you cannot make the model batch by asking, but you can make
   batching the shape of the tool.

Also in this wave: **`tree_query`**, the missing sibling to `research_query`. Tree
reads are **64%** of the project-file reads that remain, and no projection exists.
And `image_transcribe`'s one-image-per-call limit is a **spec** constraint that the
`image-reader` agent body enforces — changing it is a spec change, not a schema one.

**Not a prompt change.** Per `CLAUDE.md`'s lane rule, a prose instruction to batch has
no scope and a tool's shape binds everywhere.

## 5. Wave 2 — tool output shaping

Lever 1's other half: what comes back. Tool-result carry is **24%** of the bill.

- **The wiki cluster has zero shaping affordances** — no limit, no offset, no
  staging, no digest — and `wiki_search` is the largest per-call payload in the
  system at p50 **37,109 chars**.
- **`record_search`'s inline stub is still p50 9,470 chars** with staging at 100%
  adoption. Staging is not the fix; the stub's own width is. Cap the inline list at
  12–15 and leave all 50 scored candidates in the sidecar — **do not** cut the
  `count` default, which shrinks the sidecar too and breaks the cut's own contract.
- **The tool-schema block is 129,279 bytes**, `record_search`'s alone 18,545. Trim
  narrative, never contract.
- **The write path costs more in args than in results.** `extraction_append`
  generates a median **9,036 chars of arguments** per call — those are output tokens
  at $15/MTok. Results are the cheaper half (result/arg 0.17–0.33).

**Wave 1 before Wave 2**: collapsing calls first means the payload work measures
against fewer, larger results rather than chasing a moving denominator.

## 6. Wave 3 — conversion (NOT YOURS — others do this)

> **This wave is not Promise's work.** Others run the skill→agent conversion, in
> parallel with Waves 1–2 from day one. It is here because **Wave 4 cannot start until
> it is complete** — a floor search run against a half-converted system measures a
> moving target, and a floor read taken before a skill's conversion is void. Track it;
> do not implement it.

**Conversion continues.** The standing ruling of 2026-09-22 stands — every skill
becomes an agent and the skill is deleted. An earlier revision of this plan asked to
pause it; that ask is **withdrawn** and the reasoning is in A4 item 1. The arithmetic
goes the other way: a 15,399-token agent body written fresh on ~2 spawns costs ~$0.12,
while the same body resident in main context for ~55 remaining model calls costs
~$0.25 in re-reads — and occupies 9% of the compaction window besides. The agent is
roughly half the cost, and the crossover is around 4 spawns/run.

The conversion cards carry `cluster:agent-conversion`.

**The design rule conversion should follow, with a number on it.** Orientation share
of an agent's tool budget: `image-reader` **0%**, `record-extractor` **33%**,
`proof-conclusion` **75%**, `research-exhaustiveness` **87%**. The cheap two take
their input **as arguments**; the expensive ones are handed an id and go fetch. **A
converted agent should be handed the state it needs, not a name to look it up by.**
Make that an acceptance criterion, not advice.

**Record extraction is out of scope here.** It is **issue #2937**, assigned to John —
convert the skill→agent pair into a tool pair so extraction costs a tool call rather
than a spawn. It matters to this plan for one reason: at **2.10 spawns/run × ~6
assistant messages** it is ~12.6 of 174 model calls, and turn count is the master
variable. Its token saving is small (all record-extractor generation is **$0.218/run**),
so do not count it toward the cost target. The evidence, the architecture and the three
writer-tool preconditions live on that card. Related: **issue #2818** goes the other
direction, **issue #2475** owns the precondition join, **issue #2256** the census year.

## 7. Wave 4 — the floor search

> **BLOCKED until Waves 1, 2 and 3 are all complete.** Lead ruling: tool-output
> reduction *and* skill→agent conversion both finish before the floor search begins.
> Measuring a model floor against unreduced payloads or a partly-converted skill set
> gives a number that expires the moment the other work lands.

**Set everything to Haiku with no reasoning effort, see what fails loudly, and raise
carefully.** *Everything* includes **the research orchestrator itself**, not just the
agents — and that is the larger half of the lever, because the main thread is 77–80% of
wall clock while per-agent pins reach only the ~20–23% that runs inside a subagent.
Nothing in this product has ever run below effort `high`: `effort_level` is `high` or
null across all 188 runs.

Context is not the blocker for the orchestrator. Haiku's 200k window gives the same
167,000 compaction trigger as today, and main peaks at 159–174k across all 18
instrumented runs. The risk that concentrates there is **routing judgement** — the
orchestrator decides which skill runs next from `research.json` state — so expect the
orchestrator to need a higher rung than the mechanical agents, and find out rather than
assume. Run the unit suites first to find the loud failures, get most passing,
then e2e against the panel corpus — not against a purpose-built baseline.

**The rungs are model switches, not effort dials.** Haiku 4.5 **rejects** the `effort`
parameter — it is the one current model still on `budget_tokens`, and omitting
thinking gives zero reasoning. So the ladder is
`Haiku-no-thinking → Sonnet-5 low → Sonnet-5 medium`, and each step up is a model
change. Whether agent frontmatter can express a thinking budget at all is
**UNVERIFIED** — it takes `model:` and `effort:`, and no `thinking:` has been seen.

**Context is not the constraint.** Haiku's 200k window gives the same 167,000
compaction trigger as today, and main peaks at 159–174k across all 18 instrumented
runs. Per-agent windows are **not recorded** (`thread_windows` carries main only), so
verify before assuming Haiku is safe inside an agent.

**Nothing in this product has ever run below effort `high`** — `effort_level` is
`high` or null across all 188 runs. This is the largest untouched lever and Wave 4 is
the first time it is pulled.

**Accuracy** is Promise's judgement call. No invented trade rate.

## 8. Prerequisites, measurement, and how to re-derive

**Gating Wave 4 only:**

- **Production cannot set effort.** `real_agent.build_options` sets `model=` and
  `permission_mode=` and never `effort`; `SandboxSpec` has no field for it; and
  `_agent_env` sets `MODEL` and not effort. All three sites need the change, and
  `make agent-smoke` will **not** prove it — it never boots a sandbox. Verify on a
  **freshly created** E2B session; these sandboxes are persistent and resume.
- **`EFFORT_LEVEL` is not wired into `eval/RunE2E.bat`** — it threads `DENY_SHELL`
  and `DENY_PROJECT_READS` only, so the Windows genealogists cannot run an arm.
  **Wire it with a paired CI guard** (`check_added_runlogs_effort_high`, modelled on
  `check_added_runlogs_not_1m` in `eval/harness/scripts/check_e2e_fixtures.py`): panel
  runs come from that entry point, the operator is told to commit the log, and the
  corpus has no effort check, so a stray `EFFORT_LEVEL=low` would shift every
  repo-wide median silently.
- **Issue #2582** — per-subagent token accounting. `usage.usage` is main-thread only,
  so every cost figure here is priced off a residual. Already Promise's card, and his
  first task. **Fold in** per-message wall timestamps and a message id on the
  assistant timeline row: `_usage_key` is already in hand at the write site, both
  halves edit the same instrumentation, and under merge doctrine they are one PR.
- **Per-thread windows for subagents**, so Wave 4's Haiku arms can be verified.

**The replay harness — Promise's first build after issue #2582.** Re-issue a committed
runlog's tool calls against a candidate tool implementation and diff the payload
sizes. **Zero model calls**, repeatable, and it measures exactly what Waves 1–2
change. This is the fast loop; `make gate-skill` cannot be it, because the unit plane
is **structurally blind to skill-body changes in either direction**
(`docs/specs/unit-test-spec.md`, ADR-0003) — it sees a model or effort change but
cannot gate a prose cut.

**A warn-only cost budget in CI.** The Jul→Sep regression happened invisibly because
nothing measures model calls, tool-result bytes or turn count. Three fields in the
runlog summary plus a warn-only check makes every future PR's cost visible.

**Re-deriving any figure here:**

- **Audit the instrument before aggregating.** Print a record's key set first.
  `proof_quality` is a dict with a `.score` key, not a scalar; `tool_calls` is
  all-thread, not main-thread; `.ann.json` `per_finding` is a dict keyed `f1..fn`.
- **Field availability is uneven:** `timeline` 183 runs, `subagents` 98,
  `tool_calls[].agent_type` 49, `skills_hash` 39, `result_chars` 13. Say which n.
- **Use `wall_clock_seconds`** (188/188), never `duration_ms` (absent on the longest
  July timeouts; reports 16s for a 2,531s resumed run).
- **188 is the count at `5e14a9967`**; HEAD is larger and grows weekly with panel
  filing. Re-derive at the pin or re-pin and restate.
- **`record_basis` exists on only 296 assertions.** It replaced the old field
  name on 2026-09-18 and the runlogs are deliberately unmigrated; the
  retired enum was question-relative, so the semantics differ.
- **Line numbers rot.** Citations here name a function, constant or argument wherever
  one exists. One anchor drifted 46 lines in 55 commits. Grep the symbol.
- **The compaction stall is not where you would look.** The `compact_boundary` row has
  a ~0.1s gap; the 120.8s summarization sits in the **preceding `system:status` gap**.

## 9. Not in your lane

Two items belong to this programme but not to you. They are named so they are not lost,
and neither blocks a wave.

- **Informant rules for the 8 undocumented record types** — birth registration, probate,
  obituary, compiled, land, military, immigration, directory. Genealogist work: 10.1% of
  corpus assertions sit on record types the extractor has no rule for. Half a day per
  type.
- **`recall_required` cannot detect a run that stops researching early.** It measures
  recovery of a *planted* finding, which is largely a first-30-tool-call property, so
  every cost cut is scored against a metric blind to its main risk. This belongs on the
  `nothing-checks` register whether or not anyone acts on it.

**Everything else here is yours to build directly.** File a card only when the work is
genuinely someone else's or genuinely too big for the PR in front of you — per
`CLAUDE.md`, an issue costs about four people, and this plan is not a filing exercise.


---

# Appendix A — the evidence

## A1. The two equations

- `wall ≈ (output_tokens / ~50 tok/s) + (model_calls × prefill(prefix))`. API time is
  ~98% of wall; tool execution 3.6%; startup 10.3s. Prefill is ~20% of wall and scales
  with **prefix size × call count**, not a flat per-message constant.
- **Carried-token price ~$7.20/MTok** — cache write $3.75 plus ~11.5 re-reads at $0.30
  (10.05M cache reads ÷ 876k cache writes). Output adds $15/MTok to generate.

> **PRICE BASIS.** The carry arithmetic uses the **5-minute** cache-write rate, which
> is what production runs. The $10.57 baseline is **corpus basis**: `_PER_MTOK` in
> `eval/harness/e2e/pricing.py` prices `cache_creation` at **$6.00**, the 1-hour rate,
> because that calibrates recorded cost to 0.90x. On the production basis the baseline
> is nearer **~$9.7**, which closes ~8% of the "10x" with no work — and makes the
> $1.00 target 9.7x. Counter-effect, so the correction is not one-sided: a 5-minute
> TTL causes extra writes from expiry (~1.6% measured). **State the basis next to any
> figure, and price every rung on one.**

**Scaling, log-log over 173 runs:** cost vs assistant-message count **1.11**
(r=0.657); cache writes **1.35**; output vs messages **0.25** (r=0.068) — output is
essentially independent of message count, so turn cuts and effort cuts are orthogonal
and multiply cleanly.

**Message attribution** (Aug+Sep, n=51 — the timeline only records `Skill:<name>` from
August): main thread 72.2%, inside agent spans 27.8%. Largest consumers
`search-records` 21.8%, `person-evidence` 10.7% skill + 7.5% agent, `locality-guide`
8.8%. Worst messages-per-spawn: person-evidence **37**, proof-conclusion 23,
research-exhaustiveness 21, against image-reader **2**. Attribution persists the last
`Skill:` seen, so per-skill shares are **upper bounds** — a median 20.3% of main
messages follow the last Skill call.

## A2. Spending more does not buy quality

Across 160 costed runs split into thirds by cost, median `recall_required` is **1.00
in all three** ($5.41 / $7.85 / $12.72). Within a fixture, across 50 discordant pairs,
the dearer run passed 25 times and the cheaper run passed 25 (sign test p=1.00). In 8
of 11 fixtures with ≥3 costed runs the cheapest run is a pass. So ~40% of cost
variance is process waste with no quality attached.

## A3. Retractions — do not re-derive these

1. **"The skill→agent conversions caused the Jul→Sep regression, costing +20.7 min and
   +$3.22/run."** Withdrawn. The wall regression is real (+32% within six paired
   fixtures, 5 up / 1 down) but the conversions' attributable share is **0–25%** of
   wall (band across three methods 0–60%), and the **cost rise does not survive a
   within-fixture control** (median ratio 0.98) — most of the +43% was which fixtures
   ran in September. The conversions are not statistically identified: 08-21 carries
   both the proof-conclusion conversion and the `research_query` router-paging commit.
2. **"Subagent tool calls went 0 / 31 / 104.5."** That measured when
   `tool_calls[].agent_id` began being written — absent on **0 of 132** July runs. July
   ran subagents heavily (371 `extraction_append` calls across 99 runs).
3. **"Main-thread tool calls flat at 136.5 / 137 / 130."** Follows from 2 — that was
   July's *total* read as its main thread. Re-measured with an instrument present in
   all months, main really is flat, but the number offered for it was wrong.
4. **"Main-thread repriced $5.61 → $6.16 against actual $7.40 → $10.60, so the entire
   increase is subagent spend."** `usage.usage` is main-thread only by known defect
   (issue #2582). That gap is the defect restated.
5. **"376 assistant messages × 3.46 s."** 376 is a **content-block** count; model
   calls are **174**. There is no flat per-message tax.
6. **"The slowdown is 44%."** It is **37.6%** on `wall_clock_seconds`.
7. **"Compaction is ~4% of wall / the boundary pause is ~0."** The stall is in the
   **preceding `system:status` gap**; ~130s per boundary, ~282s/run.
8. **"Tool results are 318k tokens/run against a 165k ceiling."** That is the
   **all-thread** figure. Main-thread is median **134k** — under the ceiling.
9. **"`make gate-skill` is the continuous proxy the ladder needs."** The unit plane is
   structurally blind to skill-body changes in **either** direction.
10. **"Repinning `record-extractor` is a free current-PR fix."** `snapshot.py` folds
    every `@plugin:<agent>.md` into that skill's snapshot, so one `effort:` line buys
    a paid run plus annotation.
11. **"One line in `real_agent.py` makes session effort settable in production."**
    Three sites, and `make agent-smoke` proves none of them.
12. **"`DENY_PROJECT_READS` is an eval-harness flag" — and then its own retraction.**
    The retraction was wrong: read-blocking is a harness flag **and** an invariant of
    the **search-agent prototype worker**, whose docstring says it is *"the prototype
    option set … not the hosted one"*. **Production has no read denial.** A bare
    `options.py` matches two files.
13. **"Four floor searches are void before their skill's deletion" — then "only two"
    — and the second was wrong too.** All four are gated: **issue #2272** by issue #2821
    (*"delete the thin routing skill"*, `cluster:agent-conversion`), **issue #2269** by issue
    issue #2738 (*"land this first"*, *"before issue #2269"*). Its *"This card is startable"*
    is dated two weeks before the sequencing. Moot now that this plan supersedes them.
14. **"94 runs are censored at the wall cap."** That is the count of runs over an hour.
    At or over their own cap: **23**; any cap: 44; `timeout`: 24.
15. **"HEAD's `skills_hash` appears in zero of 188 runs."** `skills_hash` is on **39**
    of 188 (none before August), carrying 26 distinct hashes, none HEAD's.
16. **"`EFFORT_LEVEL`'s absence from `RunE2E.bat` is documented as deliberate."** The
    deliberate-omission comment covers **`CONTEXT_1M` only**, and `Makefile` asks for
    the two to be kept in sync. Treat it as an unreviewed gap.
17. **"The 167,000 ceiling is a Claude Code constant."** It is a constant of
    **2.1.139**, the CLI bundled with the harness's SDK 0.1.81. The hosted plane
    bundles 2.1.193/2.1.220, where that identifier does not exist.
18. **"The corpus is 192 runs, not 188."** **188 is correct at the pin**; HEAD is
    larger. And `usage.cli_version` is null on every run, so an SDK regression inside
    the Jul→Sep window cannot be excluded.
19. **"Scoped extraction saves −$2.00/run"** and **"two-layer extraction is a cost
    lever."** Both retracted — all record-extractor generation is $0.218/run and
    classification is ~9% of a record's output. Extraction is a turns, latency and
    determinism item, which is why it is issue #2937 and not a wave here.
20. **"10,514 assertions."** **10,626** across 194 files. And `record_basis` exists on
    only **296** — renamed on 2026-09-18, runlogs unmigrated, and
    the retired enum was question-relative.
21. **"Agent narration never reaches the user."** Subagent text rides the same SDK
    stream tagged with `parent_tool_use_id` and did reach users until commit
    `175cded1a` (2026-09-18) started dropping it in the hosted web app.

## A4. Measured dead ends — do not re-propose these

Each cost real money or real effort to establish. They are recorded so nobody, including
a future reviewer, spends that again.

- **The 1M context window is a net loss, not a saving.** Once the context cuts land,
  compactions go to zero on their own and 1M buys nothing while still charging the
  carried premium: **+$1.00 to +$2.20/run**. `check_added_runlogs_not_1m` also rejects
  such a run from the committed corpus, so it is not comparable to the panel.
- **Reverting the three skill→agent conversions.** The arithmetic favours agents
  (section 6), and the attributable share of the Jul→Sep regression was 0–25% of wall
  with the cost rise not surviving a within-fixture control.
- **Memoising repeat tool calls: $0.065/run.** Below noise. The win is in collapsing the
  calls (Wave 1), not in caching their results.
- **Capping research-exhaustiveness spawns makes a run unfinishable.** No counting
  mechanism exists, and `OWNED_DECLARATIONS` in `guard_project_files.py` routes
  `declared: true` to that agent alone, so a capped question can never be declared and
  `project.status` never reaches `completed`.
- **A purpose-built e2e baseline.** The panel corpus is the comparison set.
- **An invented accuracy trade rate.** Promise's judgement, by lead ruling.

## A5. Hazards — read before touching these

- Deleting `agents/image-reader.md` reds two record-extraction unit fixtures that grade
  the `@plugin:image-reader` delegation **by name**, plus the agent-list equality
  assertion in `tests/packaging/agent-tool-names.test.ts`.
- The harness's `DENY_PROJECT_READS=1` **strands `search-images`** — it grants `Read`
  but no `research_query`, `project_context` or `sidecar_read` — and breaks the 14
  fixtures shipping `provided-documents/`. Zero committed runs exercise the flag.
- Deleting the gps-mentor gate requires moving **four sites together** in
  `skills/research/SKILL.md`; leaving the completion precondition makes
  `project.status = "completed"` unreachable and the run walls at the cap.
- Granting `search-images` an MCP read route needs **all three server spellings** plus
  the `AGENT_PERMISSIONS` snapshot in the same commit.
- Experiment runs write into `eval/runlogs/e2e` by default — corpus pollution.

## A6. Statistical power

Pooled within-fixture SD of human per-finding recall **0.269**; judge
`recall_total` 0.334. At 80% power: 3 runs/arm on one fixture detects a **0.615**
recall drop; 3 runs × 3 fixtures detects **0.355**; detecting 0.20 needs **28
runs/arm**, 0.10 needs **113**. So a three-run arm is a **collapse detector, not a
measurement**, and the repo's "3 runs, all pass" convention false-fails a genuinely
0.90-quality config **27%** of the time. Score on `judge_output.recall_required`, never
`outcome` or `verdict` — `compliance: fail` is the norm and forces `outcome: fail`
regardless of research quality.

Fixture selection: `cruz-corona-ancestry` scores `[0.6, 0.833, 1.0, 1.0, 1.0, 1.0]`
over 6 graded runs, so it moves in both directions and is a good candidate.
`paerai-teupooihi-spouse`'s sole run is **$4.94**, not $10.57 — never quote a
within-fixture number against the corpus median. Shortlist with volume and spread:
`spriggs-parents-1898` (n=9), `anders-monsen-ancestry` (7), `cruz-corona-ancestry` (6),
`william-ferber-origins` (5), `elena-asmundsdotter-origin` (4), `ferber-death` (4).
