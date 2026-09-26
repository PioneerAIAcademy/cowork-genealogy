# Cut e2e research cost and latency by ~10x

**Status:** Not started. Owner: **Promise Igbojionu**, shepherding from 2026-09-25.
Nothing here is filed as an issue yet; section 5 says what becomes one and what does
not. **Phase 1 onward** is blocked at the hard gate in section 2; **Phase 0 is not** and can start now. Update this line as
phases land; delete this file when the work ships.

**What this is.** A measured plan to take a median e2e research run from **$10.60 /
75.7 min** (the September regime) toward a bottom-up floor of **$0.60 / 5.5 min**.
The evidence is in the appendix; sections 1–8 are the operating half and are what
you work from day to day.

**How to use it.** Read sections 1–8 once. Then live in section 4 (the sequence) and
section 7 (the weekly checkpoint). Reach for the appendix only when someone
challenges a number — section 6 tells you how to re-derive any figure here yourself,
which matters because you did not measure them.

**Supersedes four documents. Repoint every one of their Status lines in the same PR as
Phase 0a** — per `CLAUDE.md` the Status line is what tells the next reader whether a file
describes pending work, and Promise would otherwise find four live-looking plans on one
subject:

- `docs/plan/main-thread-residency-reduction.md` — Status still reads "Not started"; its
  instrumentation half is complete and its lever 1 is a `cluster:pair-conversion` card
  (issue #2117). Mark its levers absorbed or dropped.
- `docs/plan/research-latency-reduction-plan.md` — Status "DRAFT, for review".
- `docs/plan/research-performance-2026-07-27.md` — Status "PARTIALLY SHIPPED"; supersede
  the unshipped part only, and say which that is.
- The 2026-09-15 instrumentation plan, which is complete. **It has no path to cite** —
  it lived in the root `PLAN.md`, which `.gitignore` excludes. Its output is the 13
  committed runs carrying `result_chars` / `usage.message_usage` /
  `usage.thread_windows`, and most measurements here rest on them. Its output is
the 13 committed e2e runs carrying `result_chars` / `usage.message_usage` /
`usage.thread_windows`, and most measurements here rest on them.

---

## 1. The brief, in one paragraph

Cost and latency are the two things blocking beta; research accuracy is good enough.
The lead wants both minimised — not brought under a bar — with **cost reduction
substantially more important than latency**, and he will accept some accuracy loss
to get there. The chosen strategy is **floor-first**: apply every safe cut at once,
measure quality at the floor, then add capability back and keep only what
demonstrably buys quality. The output is a Pareto frontier; the lead picks the knee.
Turn count is the master variable — it is the top term in latency and, through cache
reads, the top term in cost.

## 2. HARD GATE — nothing below starts until the lead rules

Two of these are reversals of standing decisions and **only the lead can make them.**
Do not begin Phase 1 without them.

| # | Decision | Why it blocks | Default if unanswered |
|---|---|---|---|
| G1 | **Pause `cluster:pair-conversion`?** — **43 open cards, 16 `high-priority`** (`gh issue list --label cluster:pair-conversion --state open`). Do not read this as the four cards an earlier draft named: **issue #2490 is not in the label at all** (it carries `cluster:acquisition`), so a by-label pause both misses it and sweeps 40 cards nobody has reviewed. Decide whether the pause is by-label or by-hand, and review the 16 `high-priority` titles before ruling | Reverses the standing ruling of 2026-09-22 ("every skill becomes an agent and the skill is deleted"). **Evidence downgraded 2026-09-25 — read A3 item 1 before ruling.** Jul→Sep the corpus lost +20 min and +$2.85/run, but the three conversions' attributable share is **ESTIMATED at 0–25% of the wall** (central ~15%; honest band across three attribution methods is 0–60%) and **20–35% of the cost**. The cost rise does **not** survive a within-fixture control (median ratio 0.98). The conversions are **not statistically identified**: 08-21 carries both the proof-conclusion conversion and the `research_query` router-paging commit, 09-01 carries both person-evidence and the tree-encoding gate, and ~120 other plugin commits landed between | **No pause.** The evidence no longer supports a reversal. Prefer the $40 test in Phase 1b first |
| G2 | **Un-gate `cluster:agent-floor-search`?** | Only coherent if G1 passes. **All FOUR floor searches are gated behind a deletion-and-conversion card, three of which carry `cluster:pair-conversion`** — so G2 is *more* coupled to G1, not less. Verified at the primary bodies: **issue #2239** (*"a floor read off the suite before that conversion is voided by it"*); **issue #2268** (*"First delete the thin skill"*); **issue #2272**, blocked by **issue #2821** — titled *"person-evidence: **delete the thin routing skill** and convert its suite to delegation"*, carrying `cluster:pair-conversion`, first line a lead note of 2026-09-23: *"blocks the person-evidence floor search (issue #2272)"*; and **issue #2269**, sequenced behind **issue #2738** (*"its sweep should run against this card's post-deletion suite, so land this first"*, line 1; *"Order: … before issue #2269"*, line 102). **Un-gating issue #2272 and issue #2269 burns two paid eval slots on suites that issue #2821 and issue #2738 rewrite — the readings are void on arrival.** A by-label un-gate still misses both: issue #2269 carries no cluster label, issue #2272 lacks `cluster:agent-floor-search`.
*(A previous revision claimed only two were gated, taken from a relayed quotation rather than the bodies. Both halves were wrong: issue #2269's "This card is startable" is dated 2026-09-09 and clears a different blocker (issue #2257), two weeks before the 09-23 sequencing; and issue #2738's "does not block issue #2269" is scoped to the `_d3c` fixture's fix, not to ordering.)* | **Stays gated.** Existing sequencing stands |
| G3 | **The accuracy trade rate.** Proposed: *no skill suite loses more than one dimension against its committed baseline, and no fixture loses more than 10% of expected-finding recovery* | Every Phase 1–2 arm is scored against it. Eleven floor-search cards are already blocked on this one answer | **Ask again.** Do not invent a rate; an arm scored against an invented bar is unfalsifiable |
| G4 | **What metric catches a run that stops researching early?** | `recall_required` measures recovery of a *planted* finding — largely a first-30-tool-call property. It is blind to the floor's main risk | **Ask again.** Without it every number downstream is decoration |
| G5 | **Reopen ADR-0003's "Cutting prose stays declined" (2026-08)?** | The body-diet rung reverses it. The ADR's reopen trigger is explicit: *"a measurement showing body size costs something material end to end — not on a byte count."* State whether A2's "instruction + agent-body carry $1.41/run, 13%" is that measurement. If it is, the ask is to **amend the ADR in place**, not to ignore it | **Stays declined.** Drop the body-diet rung |

G3, G4 and G5 are questions, not work. Per `CLAUDE.md`, if you can ask, ask.

## 3. Your slate

Cleared by the lead on 2026-09-25 so you can focus on this plan. **Take no new
issues.**

| item | what to do |
|---|---|
| **issue #2582** token `usage` excludes subagent tokens | **Your first task — this is Phase 0a.** Re-scoped from a card you hold to step one of the plan. No branch or commits exist yet, so scope it to serve the plan: see 4.0a |
| **issue #2225** + PR **issue #2728** (ready) + PR **issue #2727** (draft) | **Finish.** Real work in flight on two branches. issue #2681's fix rides inside issue #2727 |
| **issue #2798** validate-schema → agent | **Dropped — but it is a `cluster:pair-conversion` card, so this drop is downstream of G1 and should not land before the lead rules.** No branch, no commits, no PR. Also the weakest card on the merits: `validate-schema` is invoked **0 times in 188 e2e runs** while its tool is called 56 times directly |
| **issue #2683** check-warnings narration | **Dropped.** The only commits touching it are the revert that created it. Five rewordings already failed; it is lane-4 prose on a skill that is 0.1% of assistant messages |

**Watch item.** issue #2225 pulls against this plan — it carries *more* data
(`sourceClusters`, `conclusionScores`, resolved facts, the source-conflict list) on
two tools the cost programme wants smaller. The lead has ruled it proceeds anyway,
on the grounds that the gains come from fewer turns, cheaper models and less
thinking effort, and it can be undone later. **Measure its payload delta after
issue #2728 lands** so that "undo it later" stays an informed option rather than a guess.

## 4. The sequence

### Phase 0 — free or near-free, no paid runs

> **Two of the acceptance checks below (0a, 0b) can only be read off a run.** Neither
> buys one: read them off the **next scheduled weekly panel run**, not a funded arm,
> and state how many runs each needs before it counts. 0b's 5.9% → ? delta is a rate
> on a small denominator; if one run cannot resolve it, say how many can.

- **0a — issue #2582, scoped to serve the plan.** Record per-subagent input/cache tokens
  and fix the existing `output_tokens` field. **Fold in** per-message wall
  timestamps and a message id on the assistant timeline row: `_usage_key` is already
  in hand at the write site, and both halves edit the same instrumentation in
  `eval/harness/e2e/orchestrator.py`, so under `CLAUDE.md`'s merge doctrine they are
  one PR, not two. *Acceptance:* a committed run where per-thread token totals
  reconcile to `total_cost_usd`, and per-message context joins to per-turn timing.
- **0b — parallel-call guidance in the tool schema *descriptions*** of
  `research_query`, `record_read`, `wiki_read`. 24.4% of all tool calls, 79.2%
  collapsible. *Acceptance:* multi-tool model calls rise above the 5.9% baseline.
- **0c — run `make e2e-thinking-probe`** (~1 min). It already defaults to sonnet-5
  and already sweeps effort medium, so it needs no edit and no task. *Acceptance:*
  reports ACTED, not RAN AWAY, at effort medium. This settles whether the
  `record-extractor` repin is safe — **but the repin itself is not free**, see 5.
- **0d — wire `EFFORT_LEVEL` into `eval/RunE2E.bat`, AND add a CI guard. Two edits,
  not one — this is an issue, not a current-PR fix.** **`EFFORT_LEVEL` is absent from the `.bat` with no recorded rationale** — the
  deliberate-omission comment at `:53-60` covers **`CONTEXT_1M` only**, and
  `Makefile:879` asks for the two to be kept in sync, so treat it as an unreviewed
  gap. The guard must land with the wiring for a structural reason: panel runs come
  from this entry point and `:64-66` tells the operator to commit the log. `CONTEXT_1M` is
  backed by `check_added_runlogs_not_1m`
  (`check_added_runlogs_not_1m` in `eval/harness/scripts/check_e2e_fixtures.py`); **`EFFORT_LEVEL` has no such
  guard** — that file runs four checks and **zero** read effort. Concrete failure: a
  genealogist leaves `EFFORT_LEVEL=low` in their shell, runs a panel fixture,
  commits it as instructed, and every repo-wide median shifts silently — breaking
  the invariant A3 item 6 rests on. Add `check_added_runlogs_effort_high` reading
  `usage.effort_level` under `--diff-filter=AR`, proven to fail two ways per
  `CLAUDE.md`'s lint rule. **If the guard is not wanted, do not wire the flag** —
  run the arm from the Makefile, as `CONTEXT_1M` does.
- **0e — carry `EFFORT` end to end in production.** `effort=` in
  `real_agent.build_options` **plus** an `effort` field on `SandboxSpec`
  (`SandboxSpec` in `apps/server/app/sandbox/base.py`) **plus** a row in `_agent_env`
  (`_agent_env` in `apps/server/app/sandbox/e2b.py`, which today sets `MODEL` and nothing
  else). *Acceptance:* read the **resolved** effort, not the env var. Both harnesses bind
effort by writing `{"effortLevel": …}` into `.claude/settings.json`
(the `effortLevel` write in `eval/harness/e2e/orchestrator.py`); feeding `ClaudeAgentOptions.effort`
from an env var is a path **nothing has exercised**, and the probe 0c runs warns that
the CLI resolves its own effort from the *setting*, not from `CLAUDE_EFFORT`
(the `CLAUDE_EFFORT`-is-output-only note in `try_record_extractor_thinking.py`). If it silently fails to bind, every
measurement says the cut landed while production is unchanged. Either assert the
resolved value off the SDK init handshake (the way `make agent-smoke` reads the agent
list), **or** simply write `effortLevel` into the sandbox's `.claude/settings.json` —
the mechanism both harnesses already prove. Also note these sandboxes are persistent
and *resume*, so only a **freshly created** session picks up a new env.
  `make agent-smoke` does **not** prove this — it never boots a sandbox.
- **0f — price every add-back rung from the committed corpus.** The frontier's
  x-axis needs zero live runs. *Acceptance:* every rung has a $ and a min figure
  before any arm is run.

### Phase 1 — ~$16–20 (two runs), one sitting, FLAGS ONLY

```
make e2e-run TEST=paerai-teupooihi-spouse                    # fresh HEAD baseline
make e2e-run TEST=paerai-teupooihi-spouse EFFORT_LEVEL=low
```

No prompt edit, no worktree, no engine build, no snapshot collision, fully
corpus-comparable. `EFFORT_LEVEL=low` is the single largest measured cut with zero
research risk.

> **`paerai-teupooihi-spouse`'s sole committed run is $4.94, not $10.60.** Phase 1
> numbers are **within-fixture only** and must never be quoted against the corpus
> median — that would read as a 2x win that is entirely fixture selection, the same
> error this plan flags for Phase 2. The baseline doubles as a **drift tripwire**: `skills_hash` is recorded on **39 of
188** runs (none before August), carrying **26 distinct hashes**, none of them HEAD's.

Score on `judge_output.recall_required`. **Never** on `outcome` or `verdict` —
`compliance: fail` is the norm (10 of the 12 most recent runs) and it forces
`outcome = fail` regardless of research quality.

- *Acceptance:* `recall_required` at `EFFORT_LEVEL=low` >= the fresh baseline's, and
  `total_cost_usd` lower.
- *Kill criterion:* required recall drops at all — the ladder then starts from
  `medium` instead of `low`.
- **Read this as a screen, not a measurement.** At n=1 it can only detect a
  collapse (appendix A8). Nothing later may treat it as a measurement.

### Phase 1b — $40, and it may moot G1 entirely

Run four fixtures once each on a branch that **only** fixes `research_query` to
accept `sections[]` (section 5, issue 1). No revert, no ruling needed.

- *If* the calls collapse to **≤10 from a median of 56** and wall drops 6+ min, the paging loop was
  the bigger term, the conversion question shrinks to a ~$0.8/run cost question, and
  **nobody needs to reverse a standing ruling over it.**
- *If not*, fund the 12-run A/B ($120: three paired fixtures × two arms × two runs,
  reverting the three agents to skills at today's sha). Pre-register the bar: **if
  reverting buys back less than 5 min/run median, G1 defaults to no pause.** Two runs
  per arm still cannot resolve a 3-minute effect — `hannah-earnest-children` run
  three times in one July day spans 51.1 / 67.9 / 92.7 min — so that bar is the
  honest limit of what $120 decides.

### Phase 2 — conditional, scoped only after Phase 1 and G3/G4

Prompt edits and engine cuts, on fixtures **that can move in both directions**. The
measured `recall_required` at the pin says only two of the three proposed fixtures
are ceiling-bound. **`cruz-corona-ancestry` scores `[0.6, 0.833, 1.0, 1.0, 1.0, 1.0]`
over 6 graded runs** — median 1.0 but demonstrably able to move in both directions, so
**keep it**. `creszentia-haas-birth` and `paerai-teupooihi-spouse` are at 1.0 on **n=1
each**, which this plan forbids reading as a measurement (Phase 1, A6).
**Shortlist with volume and spread, already computed — do not re-derive:**
`spriggs-parents-1898` (n=9), `anders-monsen-ancestry` (n=7),
`cruz-corona-ancestry` (n=6), `william-ferber-origins` (n=5),
`elena-asmundsdotter-origin` (n=4), `ferber-death` (n=4).

**Open affordability question, unresolved:** the add-back ladder has no cheap proxy.
`make gate-skill` runs on the unit plane, which is **structurally blind to
skill-body changes in either direction** (`docs/specs/unit-test-spec.md:44`,
ADR-0003) — it can see a model or effort change but cannot gate a prose cut. So the
scoped-extraction and body-diet rungs need a cheap **e2e**-plane proxy that does not
exist. Either build one, or stop at the floor screen and say so.

### Confirmation — define this before Phase 1 starts

**The plan's own objective currently has no acceptance check.** Every phase item has
one; "10x" does not. Fix that before spending, or the terminal report is a handful of
single runs on fixtures re-selected for recall headroom, compared against a 28-run
median on a different fixture mix and a different price basis.

- **Fixture set: FROZEN, and enumerate it by slug before Phase 1 starts.** "The same
  set the median was taken over" is not reproducible — the corpus grows weekly under
  panel filing. Four runs landed between the pin and 2026-09-25 alone
  (`anders-monsen-ancestry` 09-24, `catharina-gosner-daughter` 09-23 ×2,
  `cruz-corona-ancestry` 09-21). Pin the sha (`5e14a9967`), list the slugs, and state
  the rule for new panel runs: exclude them, or re-pin and re-state both medians.
- **State the two medians separately with their own n** — **$10.57 over 24 runs**
  (4 of the 28 carry no cost) and **75.7 min over 28**. The **$10.60** used as the
  headline throughout this plan rounds that $10.57.
- **Baseline:** **re-measured at HEAD on that set**, not carried from the corpus.
  `skills_hash` is on 39 of 188 runs, 26 distinct hashes, none HEAD's.
- **Basis:** both sides on one cache-write rate (see the price-basis note in A1).
- **n:** enough to clear A6's power floor, or state plainly that it cannot and that
  section 7 reports a *screen result*, not a *position*.
- **Cost: price it here in dollars before Phase 1 starts.** At ~$5–11/run a
  confirmation set is plausibly larger than all four phase budgets combined
  ($16–20 + $40 + $120 + $64), and section 8 makes overspend a lead decision — so it
  cannot stay unbudgeted.
- **Pick ONE price basis for the objective and restate the target on it.** A2 quotes
  10.6x off the corpus basis while the price-basis note says production is ~$9.7 —
  on which $1.00 is already 9.7x, i.e. the goal. On production basis the target is
  **$9.7 → $0.97**. Say which basis the objective is measured on.

If that is unaffordable, say so in this subsection and change section 7's weekly line
from "position" to "screen result".

## 5. What becomes an issue, and what does not

**The line is `CLAUDE.md`'s four-person test — is the work big enough to carry a
vetter, an implementer and two reviewers — not who happens to do it.** A one-line
fix stays a current-PR fix even when a genealogist makes it; a half-day deep dive
earns a card even when you make it yourself.

**Current-PR fixes, never issues:** 0b, and the runlog-root threading — `--runlog-root` **already exists** (the `--runlog-root` argument in `eval/harness/e2e/run_e2e.py`, with a default); only the `Makefile:911` recipe fails to pass it, so `$(if $(RUNLOG_ROOT),--runlog-root $(RUNLOG_ROOT),)` is the whole fix. That is not a four-person card.
**Now an issue, not a current-PR fix:** 0d — it needs a CI guard, see section 4.
**Already a card, re-scoped:** 0a (issue #2582).
**Comment on the existing card, do not file:** the effort/model A/B belongs on
**issue #1136**, whose own body says *"do not file the A/B as a separate issue"*. It is
iceboxed and held by the lead personally, so it needs an un-icebox ruling, not a new
issue.

**File these** (seven rows; an eighth — corpus pollution via `--runlog-root` — was demoted to a current-PR fix above) — an independent coverage audit (40 agents, every verdict
adversarially overturned once) found **15 of 20 plan items covered by no existing
issue, 4 partially, 1 fully**, so this is new work rather than duplication. Its
coverage verdicts were **not** re-verified item by item here; spot-check before
filing.

| # | Title | Lane | Measured effect | **Touches** (spec required per `DEVELOPMENT.md:240`) |
|---|---|---|---|---|
| 1 | `research_query`: accept `sections[]` instead of a round trip per section | developer | −$1.28/run, −6.5 min. **median 56 calls/run, mean 60.2, 88% inside agents** (September, n=28 at `5e14a9967`; HEAD median is 54 and drifts). The tool **explicitly rejects** `sections` today (the `sections` rejection in `research-query.ts`) and its own comment at `:225` says *"`sections` is the mistake the model actually makes"* — the demand is already measured in the error path. **Not a free widening:** `SECTION_FILTERS` (`SECTION_FILTERS` in `research-query.ts`) allow-lists filter keys **per section** and treats a filter valid elsewhere as a hard error, and `offset` paginates one section — so `sections[]` must decide filter scope, pagination scope, and a section-keyed response shape every caller reads | `docs/specs/research-query-tool-spec.md` |
| 2 | Plural args on `record_read` / `wiki_read` / `same_person` / `person_warnings` | developer | −$0.55/run, −3.5 min, net of a measured 28% haircut for calls already issued in parallel | `person-warnings-tool-spec.md`, `same-person-tool-spec.md`, `wiki-page-tool-spec.md` |
| 3 | `record_search`: cap the **inline stub** at 15, leave all 50 in the sidecar | developer | −$0.62/run. Do **not** cut the `count` default — that shrinks the sidecar too and breaks the cut's own contract | `record-search-tool-spec-v2.md` |
| 4 | Trim the tool-schema block | developer | −$0.16/run. `record_search`'s schema alone is 18,545 of 129,228 bytes. Trim narrative, never contract | every trimmed tool's spec |
| 5 | `search-images` has no read route in the **search-agent prototype worker** | developer | `apps/server/proto/worker/deny.py` denies `Read`/`Grep`/`Glob` under the anchor unconditionally (`make_pretool_hook` in `apps/server/proto/worker/options.py`, via `deny.py`) — and that is correct by design: its docstring says the prototype agent *has no project folder*, `cwd` is an empty anchor and the project lives in Postgres behind the MCP tools, so such a read *is always a mistake*. `search-images` grants `Read` but no `research_query` / `project_context` / `sidecar_read`, while its body orders three `research.json` reads. **The fix is to grant it an MCP read route, not to restore `Read`.** Prototype only — see A7 item 13. **The fix lands in every plane** (Cowork, both harnesses, hosted) for a prototype-only defect, and this is the one row with no cost or latency figure — say why a 10x plan files it, or file it elsewhere | `packages/engine/plugin/agents/search-images.md` (all **three** server spellings) + `packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts` (`AGENT_PERMISSIONS` snapshot, same commit) |
| 6 | `eval/RunE2E.bat`: wire `EFFORT_LEVEL` with a paired `check_added_runlogs_effort_high` guard | developer, `nothing-checks` | Unblocks the largest lever for the Windows panel runs. The guard must land with the wiring — the corpus has no effort check, and a stray `EFFORT_LEVEL=low` would shift every repo-wide median silently | `eval/RunE2E.bat`, `eval/harness/scripts/check_e2e_fixtures.py` |
| 7 | `recall_required` cannot detect a run that stops researching early | developer, `nothing-checks` | Blocks G4. Every cost cut is otherwise scored against a metric blind to its main risk | `docs/specs/e2e-test-spec.md` |

**Costed but not yet filed — it needs its dependency priced first.** Scoped
extraction (−$2.00/run) reds the suite it would be measured against: **19 of the 31**
`eval/tests/unit/record-extraction/*.json` fixtures pin `expected_classifications`
positively, and issues issue #2654 and issue #2238 both hold that suite fixed as their pass bar.
The lead approved $64 to test scoped extraction before this was known. Re-price
before filing.

## 6. How to re-derive any number here

You did not measure these and you will be challenged on them. Every figure is
recomputable from `eval/runlogs/e2e/*/run-*.json` at sha `5e14a9967`.

- **Audit before aggregating.** Print a record's key set first. Several figures in
  earlier drafts were wrong because a field was aggregated without being inspected —
  `proof_quality` is a dict with a `.score` key, not a scalar; `tool_calls` is
  all-thread, not main-thread; `.ann.json` `per_finding` is a dict keyed `f1..fn`.
- **LINE NUMBERS ROT — prefer the symbol.** This plan was written at `5e14a9967` and
  main moves roughly 50 commits a week. One citation had already drifted by 55 commits
  (`project_read_denied` moved from line 281 to 327 in
  `apps/server/proto/worker/options.py`). Citations here name a **function, constant or
  argument** wherever one exists; where a bare line number survives, re-derive it at the
  pin before quoting it, and grep the symbol rather than trusting the number.
- **188 is the count at `5e14a9967`; HEAD is 192 and grows weekly.** Re-derive at
  the pin, or re-pin and restate every figure that depends on it.
- **Field availability is uneven:** `timeline` 183 runs, `subagents` 98, `skills_hash` 39,
  `tool_calls[].agent_type` 49, `result_chars` 13. Say which n a figure rests on.
- **Use `wall_clock_seconds`** (188/188), never `duration_ms` (175/188; absent on
  the longest July timeouts, and it reports 16s for a 2,531s resumed run).
- **24 runs ended in `timeout` and 44 hit some cap** — not 94, which is the count of
  runs longer than an hour and is not censoring (the wall cap is 7200s on 144 of 188).
  **All 4 September runs missing a cost are `timeout`/`inactivity`**, so the costed
  median excludes exactly the expensive failures. Committed runlogs are converged
  states — failed and abandoned runs are invisible. Every figure is a floor.
- **The compaction stall is not where you would look for it.** The
  `system:compact_boundary` row has a ~0.1s gap; the 120.8s summarization sits in
  the **preceding `system:status` gap**. Probing the obvious way measures zero.

## 7. Weekly checkpoint

Report five lines to the lead each week:

1. Which phase, and which gate is currently blocking.
2. Cost and wall **within the fixture under test**. Quote a corpus position only once a confirmation run has been made — never from a Phase 1 or Phase 2 fixture.
3. Dollars spent on arms this week, against the plan total.
4. Any number in the appendix you have re-derived and found wrong.
5. One line on whether the kill switch below has tripped.

**Kill switch.** If Phase 1 shows required recall dropping at `EFFORT_LEVEL=medium`
as well as `low`, the reasoning bucket — 44% of cost and 66% of wall — is not
recoverable, the floor is far above $1.00, and most of this plan dies. Say so
immediately rather than grinding through Phase 2; the engine cuts (issues 1–4)
survive independently and are worth landing on their own.

## 8. Decision boundary

**Yours:** the order of Phase 0 items; how to scope issue #2582; which fixtures to
re-select for Phase 2; whether an engine cut is a current-PR fix or a card; when to
stop a rung that is not paying.

**The lead's:** G1–G5 (G5 reverses ADR-0003, so it is lead-only by this plan's own argument); any reversal of a standing ruling; un-iceboxing issue #1136;
anything that spends more than the phase budget; filing a card that reverses a
documented decision.

**If the lead is unreachable for a week:** proceed with Phase 0 only. It is free,
reverses nothing, and every item in it is worth having regardless of how G1–G4 land.
Do not start Phase 1 on a default.

---

# Appendix — the evidence

## A1. Measured baseline and the physics

All MEASURED at sha `5e14a9967` over `eval/runlogs/e2e/*/run-*.json` unless noted.

| quantity | value | n |
|---|---|---|
| September regime (current, post-conversion) | **$10.57 median cost (n=24 — 4 of the 28 carry no cost), 75.7 min, 236.5 tool calls (n=28)** | 24 / 28 |
| Whole corpus | $7.84–$8.88 median cost, 59.6 min | 164–188 |
| Runs at or over their own wall cap | **23** | 188 |
| Runs hitting any cap (wall, cost, tool, turn) | **44** | 188 |
| Runs ending `stop_reason: timeout` | **24** | 188 |
| Model calls per run | **174** (medians, which do not add: main 85, sub 75) | 13 |
| Peak main-thread window | 164,448–170,975, pinned at the ceiling | 13 |
| Compaction boundaries | 470 over 183 runs, median 2/run | 183 |

**The two governing equations.**

- `wall ≈ (output_tokens / ~50 tok/s) + (model_calls × prefill(prefix))`.
  API time is ~98% of wall; tool execution is 3.6%; startup is 10.3s. Prefill is
  ~20% of wall and scales with **prefix size × call count**, not a flat per-message
  constant.
- **Every token that enters context costs ~$7.20/MTok carried** — $3.75 to write
**(5-minute rate — see the basis note below)**
  plus ~11.5 re-reads at $0.30 (10.05M cache reads ÷ 876k cache writes). An output
  token costs **$15/MTok to generate on top**. A stored reasoning token is ~$22/MTok.

> **PRICE BASIS — read before quoting any figure here.** The carry arithmetic above
> uses the **5-minute** cache-write rate ($3.75/MTok), which is what **production**
> runs. The **$10.60 baseline is corpus-basis**: `eval/harness/e2e/pricing.py:42`
> prices `cache_creation_input_tokens` at **$6.00**, the 1-hour rate, because that
> calibrates recorded cost to 0.90x. So the baseline and the floor are on **different
> bases**, and on the production basis the baseline is nearer **~$9.7**, closing ~8%
> of the "10x" with no work. Counter-effect, so the correction is not one-sided: a
> 5-minute TTL causes extra writes from expiry (~1.6% measured). **Every add-back
> rung priced in 0f must use one basis, and must say which.**

**Cost split:** cache_read 42%, cache_write 30%, output 27% — input is ~72% of the
bill. Output tokens cost 50x more each, but input volume is 72x, hence 1.44:1.

**Scaling (MEASURED, log-log over 173 runs):** total cost vs assistant messages
exponent **1.11 (r=0.657)**; cache_write **1.35**; output vs messages **0.25
(r=0.068)** — output is essentially **independent** of message count, so turn cuts
and effort cuts are orthogonal and multiply cleanly.

**Message attribution** (Aug+Sep, n=51 — the timeline only records `Skill:<name>`
from August, so July cannot be attributed): main thread 72.2%, inside agent spans
27.8%. Largest consumers: `search-records` 21.8%, `person-evidence` 10.7% skill +
7.5% agent, `locality-guide` 8.8%. Worst messages-per-spawn: person-evidence **37**,
proof-conclusion 23, research-exhaustiveness 21, against image-reader **2**.
Caveat: attribution persists the last `Skill:` seen, so per-skill figures are
**upper bounds** (a median 20.3% of main messages follow the last Skill call).

---

## A2. The floor and the gap

**Bottom-up floor for one median research question: $0.60 and 5.5 minutes**
(two independent derivations agreeing within 8%). Realistic target allowing 20k
tokens of genuine inference: **$1.00 / 9 min**.

Against September: **17.7x cheaper, 13.8x faster** at the floor; **10.6x / 8.4x**
at the realistic target. The target is reachable on the arithmetic.

Context: a run reads **~113,000 tokens of its own instructions** to produce a
**~3,100-token** graded answer. **74% of extracted assertions are never cited.**
**42% of locality entries are never referenced.**

**Gap decomposition** from the September median $10.60 (buckets sum to within 3–9%):

| bucket | $/run | % | min | attacked by |
|---|---|---|---|---|
| Reasoning generated (193k tok x $15) | $3.16 | 30% | 45.5 | session effort |
| Reasoning carried (193k x $7.20) | $1.51 | 14% | — | same cut, second bill |
| Tool-result carry (326k x $7.20) | $2.56 | 24% | — | `research_query` batching, `record_search` stub, read-blocking |
| Instruction + agent-body carry (180k x $7.20) | $1.41 | 13% | — | cache-stable spawn prefix, schema trim, agent deletion |
| Compaction rewrites (143k x $7.20) | $1.12 | 11% | 4.7 | context reduction (NOT the 1M window) |
| Non-reasoning output (34.5k x $15) | $0.56 | 5% | 8.0 | scoped extraction |
| **floor** | **$0.60** | 6% | 5.5 | — |

---

## A3. Decided

1. **The Jul→Sep regression is real; its attribution to the three conversions is NOT measured.**
   *(Rewritten 2026-09-25 after the lead challenged the mechanism. The original
   claim and its evidence were both wrong — see A7 items 15–18.)*
   **What survives, ESTIMATED:** within the six fixtures with runs on both sides of
   the window, pooled median wall went **58.1 → 76.9 min (+32%)**, 5 fixtures up and
   1 down — so the slowdown is real and is *not* fixture mix, caps, deleted runlogs
   or model drift (all four controlled, two of which move the gap the wrong way for
   the confound). **Cost does not survive the same control**: pooled median
   $10.54 → $9.82, per-fixture ratio 0.98, 2 up / 3 down — most of the headline +43%
   is which fixtures ran in September.
   **What the conversions can be held to:** main-thread output tokens stayed flat
   (107.7k → 105.8k) while subagent output went 18.9k → 81.4k, and the three
   converted agents are 38.4k of that +62.5k (61%). That is a clean theory of added
   **cost** (~$0.6–1.0/run) and a weak theory of added **wall**, because 33% of
   spawns run concurrently and the blocked-wall attributed to those three is flat
   (6.0 → 5.8 mean min/run).
   **The confound that cannot be separated:** `research_query` paging is 54 of the
   +95 tool-call growth, and its router commit landed the **same day** as the first
   conversion. 88% of September's `research_query` calls are inside agents, so "the
   agents are slow" and "the paging loop is slow" are the same calls seen from two
   angles. Only new runs can separate them.
   **Superseded claim — RETRACTED, kept only as a record of what was believed. Do not quote it; the corrections are A7 items 15–18:** Median wall
   55.0 → 64.9 → 75.7 min (+37.6%). Traced to proof-conclusion (PR #1819, 08-21),
   research-exhaustiveness (issue #1847, 08-23), person-evidence (issue #1853, 09-01).
   Delegation is **purely additive**: main-thread tool calls flat 136.5/137/130
   while subagent calls went 0/31/104.5; main-thread generation flat ~43 min while
   subagent wall-time went 7.1 → 22.6 min. Cost: main-thread repriced $5.61 → $6.16
   (+10%) against actual $7.40 → $10.60 (+43%) — the entire increase is subagent
   spend `usage.usage` does not count (issue #2582).
2. **Spending more does not buy quality.** Within a fixture, 50 discordant pairs:
   dearer passed 25, cheaper passed 25 (sign test p=1.00). Across 160 costed runs
   split into thirds by cost, median `recall_required` is **1.00 in all three
   thirds** ($5.41 / $7.85 / $12.72). In 8 of 11 fixtures with >=3 costed runs the
   cheapest run is a pass. **MEASURED.**
3. **Turn count is the master variable** — top term in latency and, via cache reads,
   the top term in cost. Cost scales at exponent 1.11 with message count.
4. **The ~167,000 ceiling is a Claude Code constant, not a model limit.**
   `iX()` returns `ie6=200000` for `claude-sonnet-4-6`; trigger = 200000 −
   min(32000,20000) − 13000 = **167,000**. **MEASURED** against Claude Code
   **2.1.139** — the CLI bundled with the harness's SDK 0.1.81, which produced the
   corpus. **The hosted plane bundles 2.1.193 / 2.1.220 (SDK 0.2.128), where that
   minified identifier does not exist**, so the derivation cannot be replayed there
   as written. Re-derive before quoting this ceiling for production — and note A7
   item 21: `usage.cli_version` is null on all 188 runs, so the corpus cannot
   confirm which CLI produced it.
5. **1M context is standard-priced** on Sonnet 4.6 and Sonnet 5 — verified live
   against the Anthropic pricing page 2026-09-23, "Long context pricing": *"A
   900k-token request is billed at the same per-token rate as a 9k-token request."*
   **No premium tier exists.** This closes the open question from the prior plan.
6. **Session (main-thread) effort is NOT settable in production.**
   `apps/server/app/agent/real_agent.py` sets `model=` and `permission_mode=` and
   never `effort`. Only the harnesses write `effortLevel` into
   `.claude/settings.json`. Agent frontmatter `effort:` DOES bind and overrides the
   session value (`docs/architecture.md:546`, verified live 2026-08-25).
   `effort_level` is `high` or null in all 188 runs — **nothing has ever run below
   high.**
7. **Score on `judge_output.recall_required`**, never `outcome` or `verdict`.
   `compliance: fail` is the norm (10 of the 12 most recent runs) and it forces
   `outcome = fail` regardless of research quality.
8. **The free-replay set banks $2.72/run and 9.6 min** — $10.60 → $7.88,
   75.7 → 66.1 min — and the money is in **call collapse**, not payload trimming.

---

## A4. Rejected, with reasons

- **The 1M context window.** Wrong sign: once the context cuts land, compactions
  go to zero on their own and 1M buys nothing while still charging the carried
  premium — **+$1.00 to +$2.20**, not −$1.12. Also `check_e2e_fixtures.py`
  (`check_added_runlogs_not_1m`) rejects any run with non-empty `usage.betas`, so
  such a run is not corpus-comparable.
- **Wholesale deletion of delegation.** Highest risk, weakest independent evidence,
  and it double-counts: subagent output is 85% reasoning, so the effort cut already
  harvests most of it. The strand estimates summed to ~$16 of savings from a $10.60
  run.
- **Memoisation of repeat tool calls.** $0.065/run — below noise.
- **Capping research-exhaustiveness spawns.** No counting mechanism exists anywhere
  (the plugin hook is stateless, `hooks.json` does not match `Task`), and
  `OWNED_DECLARATIONS` in `guard_project_files.py` `OWNED_DECLARATIONS` routes `declared: true` to that
  agent alone — a cap makes the run unable to reach `project.status = completed`.
- **Three-run fresh baselines on three fixtures.** ~$33 to re-establish what the
  corpus already pins.
- **1-hour cache TTL.** +$0.88/run; `eval/harness/e2e/pricing.py` prices
  `cache_creation` at the 1h rate because that calibrates to recorded cost, meaning
  the corpus ran 1h and production already runs the cheaper 5m.

---

## A5. Known hazards — things that break on contact

Each was read from code, not inferred:

- Deleting `agents/image-reader.md` reds two record-extraction unit fixtures that
  grade the `@plugin:image-reader` delegation **by name**, plus
  `tests/packaging/agent-tool-names.test.ts`'s agent-list equality assertion.
- `DENY_PROJECT_READS=1` (the **harness** flag) **strands `search-images`** — it grants `Read` but no
  `research_query`, `project_context` or `sidecar_read`. It also breaks the 14
  fixtures shipping `provided-documents/`, where the harness instructs the agent to
  read files it then denies. Zero committed runs have ever exercised this flag.
- Deleting the gps-mentor gate requires moving **four sites together** in
  `skills/research/SKILL.md` (the routing row, the completion precondition, the
  hard-gate paragraph, the checkpoint table); leaving the precondition makes
  `project.status = "completed"` unreachable and the run walls at the cap.
- Floor runs write into `eval/runlogs/e2e` by default — corpus pollution.
- `EFFORT_LEVEL` is **not wired into `eval/RunE2E.bat`** — CONFIRMED: it threads
  `DENY_SHELL` (`:51`) and `DENY_PROJECT_READS` (`:52`), and mentions `CONTEXT_1M`
  only in a comment (`:53`), while `Makefile:911` carries all four. The
  Windows-based genealogist team cannot run the largest lever at all until this is
  fixed. Wiring it needs a paired CI guard (`check_added_runlogs_effort_high`) — see 0d. It is an issue, **not** a one-liner.

---

## A6. Statistical power — read before designing any arm

Pooled within-fixture SD of human per-finding recall = **0.269** (df=47); judge
`recall_total` = 0.334 (df=55). At 80% power:

| design | detects |
|---|---|
| 3 runs/arm, one fixture | **0.615** recall drop |
| 3 runs/arm x 3 fixtures | **0.355** |
| to detect 0.20 | **28 runs/arm** |
| to detect 0.10 | **113 runs/arm** |

**The proxy I proposed in revision 1 does not work for half the ladder — RETRACTED.**
`make gate-skill` runs on the unit plane, and the unit plane is **structurally
blind to skill-body changes in either direction**, not merely underpowered:
`docs/specs/unit-test-spec.md:44` and ADR-0003's "Shorten skill bodies" row both
state it, with a measurement behind it — a test grades a **single invocation in
fresh context**, so it cannot see multi-hour retention, which is where a large body
earns or wastes its tokens (over one 309-turn session `search-records` was resident
for 228 of 309 turns; its unanchored `count: 50` rule decayed from 100% to 45%).

The distinction that survives: `gate-skill` **can** see a model or effort change,
because that alters behaviour within a single invocation. It **cannot** gate a
prose or body cut. So it is a usable proxy for the effort/model rungs and useless
for the scoped-extraction and body-diet rungs. Those need a cheap **e2e**-plane
proxy plus the corpus arithmetic, and **no such proxy exists today** — that is
unasked work, not a power study.

So 3 runs per arm is a **collapse detector, not a measurement**. The repo's "3 runs,
all must pass" rule is a convention, not a derivation: against a genuinely
0.90-quality config it false-fails **27%** of the time. The add-back ladder needs to
resolve ~10-point differences and **cannot be run at this power**. Either the ladder
uses a continuous cheaper proxy, or it is not affordable as designed.

---

## A7. Retractions — corrections made during this analysis

A critic should not re-derive these. Each was believed, then measured and found wrong.

1. **"376 assistant messages x 3.46 s/message = 12-22 min/run."** 376 is a
   **content-block** count; the SDK emits one row per block. Real model calls are
   **174/run**. There is no flat per-message tax.
2. **"The slowdown is 44%."** It is **37.6%**. `duration_ms` is absent on the 13
   longest Jul runs (all timeouts) and reports 16s for a 2,531s resumed run. Use
   `wall_clock_seconds` (present 188/188).
3. **"Compaction is ~4% of wall / the boundary pause is ~0."** The stall sits in
   the **preceding `system:status` gap**, not at `compact_boundary` (0.1s). Total
   ~130s per boundary, ~282s/run (7.9%).
4. **"Tool results are 318k tokens/run against a 165k ceiling."** That is the
   **all-thread** figure. Main-thread is median **134k** — under the ceiling.
5. **"The 1M route is the model string, not a beta."** Both exist. The harness
   wires the **beta** (`orchestrator.py:1393` `_BETAS_1M`, `--context-1m`);
   production would use the **model string** (`real_agent.py` passes `MODEL`).
6. **"Agent narration never reaches the user."** Wrong as stated. Subagent text
   rides the same SDK stream tagged with `parent_tool_use_id` and DID reach users
   until commit `175cded1a` (2026-09-18) started dropping it in the hosted web app.
7. **"Effort is a modest cost lever because output is 27% of the bill."**
   Understated: effort also pulls down turn count, which multiplies cache reads.
8. **"Haiku rejecting `effort` compromises per-agent effort."** It does not.
   Per-agent `effort:` binds and overrides session effort. Haiku 4.5 is the lone
   model that rejects the parameter; omitting `thinking` on Haiku means **no
   reasoning at all**, which may be ideal for mechanical agents.
9. **"`make gate-skill` is the continuous proxy the ladder needs."** Added in
   revision 1, retracted in revision 2. The unit plane is structurally blind to
   skill-body changes in **either** direction (`unit-test-spec.md:44`, ADR-0003).
   It can see a model or effort change; it cannot gate a prose cut.
10. **"Repinning `record-extractor` is a free Phase 0 current-PR fix."**
   `eval/harness/harness/snapshot.py` folds every `@plugin:<agent>.md` a skill
   delegates to into that skill's run-log snapshot, so one `effort:` line flips
   `record-extraction` inactive and buys a paid `make eval-skill` run plus an
   annotation pass. Issues issue #2238 and issue #1848 both already say so. Only the
   one-minute `make e2e-thinking-probe` is free.
11. **"One line in `real_agent.py` makes session effort settable in production."**
   Half a fix. `SandboxSpec` (`SandboxSpec` (`base.py`)) carries `model` and no `effort`, and
   `_agent_env` (`_agent_env` (`e2b.py`)) sets `MODEL` and nothing else, so the edit would
   read a variable no hosted session ever sets — and `make agent-smoke` would pass
   anyway, because it never boots a sandbox.
12. **"Pausing the conversions and un-gating the floor searches are scheduling
   tweaks."** They reverse the standing ruling of 2026-09-22 and must be decided
   together (the hard gate, section 2).
13. **"`DENY_PROJECT_READS` is an eval-harness flag" — THIS ENTRY WAS ITSELF WRONG
   and is withdrawn (2026-09-25). The original belief was closer to correct.**
   Read-blocking is (a) an eval-harness flag and (b) an invariant of the
   **search-agent prototype worker**, whose module docstring states it is *"the
   prototype option set … not the hosted one in
   `app.agent.real_agent.build_options`"*. **Nothing under `apps/server/app/` calls
   `project_read_denied`** — `real_agent._pretool_hook` has exactly two arms, raw
   project-file writes and a Bash exfil guard. **Production has no read denial.**
   *Lesson: a bare `options.py` matches two files. Always use the full
   repo-relative path.*
14. **"25 of 28 skills still instruct a whole-file `research.json` Read."**
   Main-thread whole-file reads are essentially gone — 1.1/run in September, from
   19.0 in July. What remains is **tree** reads (64%), and there is **no tree
   projection tool**.

---

15. **"Subagent tool calls went 0 / 31 / 104.5."** That measures when
    `tool_calls[].agent_id` started being written, not when subagents started
    running. Present on **0 of 132** July runs, 21/23 August, 28/28 September. July
    ran subagents heavily — `extraction_append`, a 98.8%-subagent tool, appears 371
    times across 99 July runs, and `subagents[]` is non-empty on 55 of them.
16. **"Main-thread tool calls flat at 136.5 / 137 / 130."** Follows from 15: that is
    July's **total** read as July's main thread. The correct July split is roughly
    111–126 main / 20–21 sub. Re-measured with an instrument present in all three
    months (`subagents[].turns[].blocks`), main-thread work really is flat — so the
    conclusion survives, but the number offered for it was measuring something else.
17. **"Main-thread repriced $5.61 → $6.16 against actual $7.40 → $10.60, so the
    entire increase is subagent spend."** `usage.usage` is main-thread-only by known
    defect (issue #2582). That gap is the defect restated, not independent evidence.
18. **"The conversions cost +$3.22/run."** Not supported. Within-fixture the cost
    rise is ~0 (median ratio 0.98). The conversions' share of what remains is
    ESTIMATED at $0.6–1.0/run.
19. **Unconverted agents grew just as much**, which is fatal to reading subagent
    growth as conversion evidence: `record-extractor`'s mean subagent output went
    12.1k → 23.5k tokens/run and its spawn rate 1.73 → 3.53 — with no conversion, its
    agent file having landed 2026-07-12, five weeks before the window.
20. **The August step is timed backwards.** The 58.5 → 78.7 min jump rests on five
    runs, and the two large ones (08-17 at 78.7, 08-18 at 119.8, both
    `stribling-father-1821`) landed **before** proof-conclusion converted on 08-21.
    The three post-conversion August runs median 64.9 min.
21. **`usage.cli_version` is null on every run**, so an SDK or Claude Code
    regression inside the window **cannot be excluded** as a cause.
    *(An earlier draft listed "the corpus is 192 runs, not 188" here as a correction.
    It is not one: **188 is correct at the pinned sha `5e14a9967`**; HEAD is 192
    because four runs landed after the pin.)*

## A8. If you doubt this document, check these first

- Do the gap buckets in A2 actually sum, and do they reconcile to a
  recorded `total_cost_usd`?
- Is the floor in A2 derived from the work, or back-fitted from observed
  runs? Three of its inputs are ESTIMATED (system prompt, instruction slice,
  `record_read` size).
- Does every file path, line number, Makefile flag and env var named here exist?
  All Makefile targets and flags named here were confirmed at `Makefile:321`
  (`agent-smoke`), `:390` (`hook-smoke`), `:703` (`engine-smoke-http`), `:787`
  (`gate-skill`), `:870` (`e2e-thinking-probe`), `:879` (`e2e-run`), and `:911`
  (the `EFFORT_LEVEL` / `DENY_PROJECT_READS` / `CONTEXT_1M` / `AGENT_MODEL`
  wiring). Source-file line numbers inside `packages/engine/` were reported by
  subagents and are **not** all independently confirmed.
- Is the Phase 1 acceptance check genuinely falsifiable at n=1, given A6 (statistical power)?
  (I believe it is a screen, not a measurement, and the plan says so — check that
  no later step quietly treats it as a measurement.)
- A1's attribution caveat: per-skill shares are upper bounds. Is any
  conclusion resting on a per-skill share as if it were exact?
- A6 now says no cheap e2e-plane proxy exists. If that is right, is the
  add-back ladder affordable at all, or does the plan need to stop at the floor
  screen and say so plainly?
- The coverage audit (revision 2) was produced by another agent. Its six
  corrections were re-verified here against `snapshot.py`, `base.py`, `e2b.py`,
  `unit-test-spec.md`, ADR-0003, the 31 record-extraction fixtures,
  `proto/worker/deny.py`, `agents/search-images.md`, and the four floor-search
  issue bodies. Its **coverage verdicts** (15/20 not covered) were **not**
  re-verified item by item — spot-check them before filing anything.
