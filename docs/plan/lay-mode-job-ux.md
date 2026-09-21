# Research as a job — the agent runs, you watch and steer

> **Status:** NOT BUILT. Plan of 2026-09-21, for beta in Fall 2026. Written for one
> developer taking it over several weeks. Every phase is independently takeable and carries
> its own acceptance check.
>
> Supersedes the hand-back literal ruled 2026-09-07 (issues #2292, #1104, #2328) and the
> regex auto-continue of PR #2667. The board changes applied on 2026-09-20 are at the end.

## What you are building

Today a `/research` run stops about nine times to ask "Continue?". After this, the agent
works continuously until the job is done or it needs something only the user can supply.
The user watches a feed, sees the plan tick over, can type at any time, and presses **Stop**
if it is going the wrong way.

**Stop is the control surface.** Not an approval dialog, not a consent prompt. This is
deliberate and it is the core of the design: a non-genealogist cannot meaningfully approve a
list of record types and jurisdictions, and an experienced genealogist would rather see that
item 3 is wrong while items 1 and 2 are still running than tick a box beforehand. So there
is **no plan-approval gate**. Render the plan, start working, leave Stop available.

That serves both audiences at once. Someone who asks a question and comes back in an hour
gets an answer. Someone who watches learns the craft by reading the reasoning as it happens,
which is how a new developer learns from Claude Code.

## Before you start — read these

You are new to this repo. In order:

1. `CLAUDE.md` — the agent operating manual. What binds here: "Architecture you must
   understand", "Plugin hooks", "Code reuse".
2. `docs/architecture.md` — "The hosted web workbench", "Orchestration", and the
   "If you're asked to…" block for whatever you touch first.
3. `docs/plan/search-agent-prototype.md` — the prototype's step model and its residual-risk
   register. Phase 0 below is that document's open defects.
4. `packages/engine/plugin/skills/research/SKILL.md` — the orchestrator whose behaviour you
   are changing, even though you barely edit it.

## The three planes

| Plane | What it is | Stance |
|---|---|---|
| **Prototype** (`apps/server/proto/`) | Queue + worker + stateless web tier. **This becomes the production server** | Everything lands here first |
| **Alpha** (`apps/server/app/`) | E2B sandbox per session, on Fly. What alpha testers use today | Backport one hook so the feedback loop keeps running |
| **Cowork** | Desktop, for development and testing | Degraded is fine. Build nothing Cowork-specific |

**Cowork needs nothing.** It should behave like any other long-running agent: work
continuously, narrate, stop when done or when it needs you. That is its native behaviour and
it is already good. The plugin's job there is to not get in the way.

---

## Phase 0 — make continuous work sound (proto only, no UX)

Under one turn per step these were rare. Under continuous turns they are on every run.
**Nothing else here can be trusted until 0a lands.**

### 0a. A resumed attempt that runs zero model turns is a failure, not a completion

PR #2695's acceptance run on `bagley-father-1884`, 2026-09-20: attempt 1 was killed by the
shim at 1,800,092 ms with two `record-extractor` agents mid-persist. Attempt 2 resumed and
"completed" in 10 ms with **0 model turns** — the CLI answered the orphaned agents with a
synthetic no-response reply and `run_turn` took that as the turn finishing. `worker.py`
raises only on `result.is_error`, and a synthetic result is not an error. The fixture still
had `project.status: active`.

**Probe first — the guard is already gated on it.** `search-agent-prototype.md` records that
the 2026-09-20 ruling for exactly this rule "was gated on this probe confirming the
autonomous run's synthetic result; it did not, so the rule is not built." So the task is the
probe: `make proto-kill` kills during a main-thread `place_search`, and this failure needed a
subagent mid-persist. Write that variant and run it. The guard lands only if the probe
reproduces a zero-turn synthetic result with background agents in flight. If it does not,
report that and stop — the rest of phase 0 still stands.

**Then build:** in `apps/server/proto/worker/worker.py`, on a redelivered attempt
(`receive_count > 1`), a `ResultMessage` with `num_turns == 0` is a resume failure rather
than a completion.

**Bound the retry, and say what terminal looks like.** `elasticmq.conf` has **deliberately
no redrive policy**: "a message that fails on every delivery retries forever with back-off",
pinned by `test_proto_config.py`. The worker's failure path is a 500 → `requeue_backoff`,
capped at 300 s. The cause 0a names is a property of the stored transcript and is re-fed on
every resume, so if it is deterministic then a bare "retry" is an unbounded paid loop that
satisfies the acceptance line while never surfacing. Cap the attempts — `turns.receive_count`
already carries the number — and on exhaustion **fail the turn with an outcome the web tier
renders**. Measure whether the transcript is repaired between attempts rather than assuming
it.

**Acceptance:** a kill during a delegation resumes and finishes; no run records a
`num_turns == 0` attempt as a completion; and a deterministically failing turn stops after N
attempts with a visible outcome instead of retrying forever. Break each guard and watch it
fail.

### 0b. Put the step ceiling back to 1,800 s

It was overridden to 7,200 s for the D18 arm on 2026-09-20 because the run kept being cut,
and elasticmq's `defaultVisibilityTimeout` went to 7,500 s to match. The cut was a symptom of
0a, not a capacity finding.

**Build:** drop the override; return visibility to ~2,100 s. The compose default is already
`READ_TIMEOUT_S:-1800`.

**No exception for tests.** A test that never crosses the ceiling can never exercise resume,
and resume is now load-bearing on every production run. The crossing *is* the test.

### 0c. The `/v1` lock needs turn identity and a heartbeat

It claims a bare timestamp with no turn identity, a 600 s stale TTL and no heartbeat, against
a measured p99 segment of 1,488 s — so a healthy long turn already has its lock reclaimed
while it is still running. That was rare enough to defer when turns were short. Every turn is
long now.

**Acceptance:** a turn longer than the stale TTL keeps its lock; a dead worker's lock is
still reclaimable.

---

## Phase 1 — turn continuous work on

### 1a. Default the autonomous arm on (proto)

`make_stop_hook` in `apps/server/proto/worker/options.py` already vetoes the model's
voluntary yield, and `should_continue_run` allows the stop when `project.status ==
"completed"`, the nudge cap is spent, or the last nudge produced no tool call. It reads
`research.json` off the `documents` row at each stop. **This is the whole mechanism** — do
not build an MCP tool, a server-side turn router, or an injected "continue" message.

`AUTONOMOUS_MAX_NUDGES` defaults to `0` in compose, and with it unset there is no `Stop` key
at all. Default it on for the browser path.

### 1b. Two exceptions that allow the stop

`make_stop_hook` takes injectable callables — `research()`, `tool_count()`, `on_nudge()` —
all reading Postgres on the turn's connection. Add two more, each one clause in
`should_continue_run`:

1. **`pending_user_message()`** — the user has posted a message that is waiting. Allow the
   stop; their message becomes the next turn.
2. **`pending_decision()`** — the agent has asked something and has no answer yet. See 3a.

**Know how rarely these fire before you rely on them.** Measured over the 181 committed e2e
runs: the model voluntarily yields a **median of once per run**, mean 1.65, and **31% of
runs yield zero times** — the hook fires only at job end. Against a 53.9-minute median run,
anything gated on a yield is checked about once. That is fine for `pending_decision()`,
which the agent itself triggers. It is not fine for Stop.

### 1d. Build Stop — it is the control surface and it does not exist

`POST /api/sessions/{id}/interrupt` on the prototype returns **501**, "Interrupt is not
available in the prototype: the worker owns the turn". The whole design rests on Stop, so
this is phase 1 work, not a later nicety.

**Do not implement it as a yield-gated `hold` flag** — per the measurement above that is a
median of one check per run. Use the `PreToolUse` hook `build_worker_options` already binds
with `matcher=None`, which fires on **every** tool call; the corpus puts one model call plus
its tool calls at a median of 2.6 s. A deny carrying a stop reason halts within one tool
call and needs no new plane.

**Acceptance:** Stop pressed mid-run halts within seconds, the session shows as stopped
rather than failed, and a later message resumes it.

### 1c. Backport the hook to the alpha

Alpha testers are the feedback loop and should not go quiet for weeks.

**The alpha has its own ceiling and it is lower than the prototype's.**
`_RUNNING_TIMEOUT_S = 3600` in `apps/server/app/sandbox/e2b.py` is E2B's Hobby-tier
**maximum** — creating with 7,200 fails with a 400, and `set_timeout` past the ceiling
returns 204 and silently no-ops. It clocks **continuous runtime, not idleness**, and today
`set_timeout` has exactly one caller: `resume()`, on `/connect`. Against a corpus median run
of 53.9 minutes and p90 of 107.9, one continuous turn per job pauses mid-turn at or before
p90, and around half of runs come within minutes of it.

**Pick one before starting 1c and write it in the PR:**

- **(a) Pro tier** — the same comment records 86,400 s on Pro. A billing decision, not an
  engineering one.
- **(b) A heartbeat.** `set_timeout(_RUNNING_TIMEOUT_S)` from the control plane while a turn
  is active restarts the clock; only values *past* the ceiling no-op. This is the cheapest
  route and it is what `resume()` already does on every connect.
- **(c) Accept the pause** — but then **measure what it does to an in-flight turn first**.
  The CLI subprocess, the SDK stream and the browser socket are all in-process, and nothing
  in the repo records the outcome of pausing across them.

Until one is chosen, 1c is gated. What remains true: the alpha suspends rather than killing,
so this is a different failure from the prototype's kill-and-redeliver, and phase 0's resume
guard does not apply to it.

**Build:** `build_options` in `apps/server/app/agent/real_agent.py` already passes a `hooks=`
dict carrying `PreToolUse`. Add a `Stop` entry whose callback reads `/project/research.json`
(the runner already has `PROJECT_DIR`) and calls the same predicate.

**Lift `should_continue_run` to one home while you are there.** It lives in
`apps/server/proto/worker/options.py` and `eval/harness/e2e/stop_checker.py`; the alpha would
make three. It is a pure function. One copy, imported by all three — this is the duplication
shape issue #2476 exists to stop.

**Acceptance:** an alpha session runs a multi-step objective to a proof conclusion on one
user message *without the sandbox pausing mid-turn*. The e2e suite still passes against the
shared predicate.

---

## Phase 2 — the reading experience (renderer only; independent of 0 and 1)

### 2a. Identifiers become links, never refusals

Do not build a validator. Identifiers are **additive**: `q_001` beside "the question about
her parents" reads fine to a novice who ignores it and to a genealogist who clicks it. The
rule is *every paragraph must make sense with the identifiers deleted*, which no regex can
check.

The viewer already resolves ids. `ResearchDataState.getById(id)` returns `{ item, section }`;
`buildIndex` indexes every `research.json` section by id plus GedcomX persons, relationships
and sources; `CrossLink` does `getById` → `setActiveSection` → `scrollIntoView`;
`resolveFamilySearchTarget` handles arks and person ids behind the constrained
`openFamilySearch` channel; `Linkify` is already the component for agent-authored prose.

**Build:**

- `localities` is missing from `buildIndex` — one line, and the one schema-id class that
  will not resolve today.
- A CrossLink-aware `Linkify` in the chat pane. Two prerequisites: neither component is on
  `viewer-ui`'s public surface (`src/index.ts` exports `App`, the provider, the context and
  the external-link helpers), and the chat pane must sit inside the data provider. Both
  components stay in `viewer-ui` — shared workspace features live there, chat chrome in
  `apps/web`.
- **Lay verbs on the tool chips**, and make a chip resolve through the same path so a
  `record_read` chip opens the source card. `map_message()` already emits `tool_use` with a
  summary; `mcp__genealogy__record_read` is a wire format, not a name. Claude Code shows you
  `Read(src/foo.ts)`.

**File names, tool names and skill names are a writing-quality matter, not a defect.** Put
them in the narration guidance as guidance. If the model says "person-evidence" instead of
"linking the evidence to the people" the sentence is worse, not broken. Do not build a gate
for it, and do not file it as a bug.

### 2b. The feed and the research log are the same artifact

`research.json` has a `log` section; a research log is a GPS requirement and something
genealogists already keep. Anchor each step's paragraph to the log entry it produced.
Catching up after an hour becomes reading the log, the transcript becomes a deliverable, and
durability solves itself — the log is project state in Postgres, not an event buffer.

### 2c. Negative results are first-class

"We searched the 1880 census for that parish and she is not there" is reasonably-exhaustive
evidence and the thing that separates this from a search box. `log_outcome` already has a
`negative` value. Show those entries as findings, not as absence.

### 2d. Three small ones

- **Show the scans.** `getSourceImage` exists in the Electron transport and is absent in the
  web client. Seeing the census page with the family's line is the credibility moment.
- **Show a queued message as queued** — "picked up at the next step" answers the whole
  typed-input latency complaint with a label.
- **Provenance on hover.** `person_evidence` already links a fact to its source.

---

## Phase 3 — the loop

### 3a. Decision records — the pause, and the question card

The agent needs one structured way to say *I need you*: which of these two John Smiths is
yours, or which lead to follow. These are the highest-value moments in the product, because
they are where the user's unique knowledge enters the research. Rendering them as prose the
user answers by typing wastes them.

**Do not add a `research.json` section.** The Stop hook reads Postgres through injectable
callables, so the pending question lives in a control-plane table and `pending_decision()`
reads it — no schema pair, no validator edit, no TS mirror, no ownership row, no
`research_append` enum, no fixture backfill.

The *resolved outcome* already has a home in `research.json`: a disambiguation is a
`hypotheses` or `conflicts` entry, a blocker is a `log` entry with a negative outcome. Only
the transient "waiting for an answer" state is new, and that is control-plane by nature.

**Build:** a prompt in plain language, optional structured options each with a label, a
rationale and an optional `ref` id the viewer resolves through `getById`, and an answer
field. Unanswered ⇒ the hook allows the yield ⇒ the web renders a **card**, built from the
existing `PersonCard` and `SidecarResultCard`.

This also routes around `AskUserQuestion`, whose behaviour in a headless hosted turn is
unmeasured. Our own envelope does not depend on finding out.

### 3b. Change review and reject

The agent writes into `tree.gedcomx.json` and `research.json`; the viewer shows current state
and never **what this session changed**. For a genealogist a wrong person-link is the thing
they care most about, and `tree_correct` and `tree_forget` exist as tools with no UI at all.

A "changes this session" view — persons added, facts attached, relationships made, sources
cited — with a reject on each row routing to the correction tool.

**Where the diff comes from is an open build decision, and it is not "document versions".**
`documents` is `PRIMARY KEY (project_id, name)` — one row per document, overwritten on every
write with `version = version + 1`. There is no history. `document_versions()` in the web
tier returns `{name: version_int}`, change-detection counters for the SSE loop holding no
prior bodies. Do not build a diff against a counter.

Pick one and write it as a build step before starting:

- **(a) Derive it from the turn's tool calls.** Check first whether `tool_calls` carries
  enough — `004_worker.sql` adds only `tool_use_id`, and there is no column holding the
  call's input.
- **(b) Add an append-only history table** under `apps/server/proto/sql/`, naming its columns
  and retention. That is a store PR landing before the UI, and it touches `ProjectStore`,
  `FsProjectStore`, `tests/store/conformance.ts` and `make proto-store-test`.

**Continuous work without a review surface is the part of Claude Code people would refuse to
use.** This is the highest-value item after phase 0.

### 3c. Show the plan, and let it tick

`research-plan` already writes a structured plan: each `plan_item` carries `sequence`,
`record_type`, `jurisdiction`, `date_range`, `repository`, `rationale` and `fallback_for`.
Render it as a checklist:

> 3. **1880 US Census** — Cook County, Illinois, 1875–1885, FamilySearch. *We need to place
>    the family before the move.* If she is not there → the parish register.

**No approval gate.** Show it, start work, let `plan_item.status` tick over. That ticking is
the progress bar, and it is better liveness than a spinner because it says what is happening
and what is left. A plan of known length also makes a forecast real — "about 40 minutes,
about $5" before, "two items left" during.

Add a **"review this plan"** affordance for users who want one. An action, not a checkpoint.

### 3d. Dead ends become next actions

A genuine blocker — "the parish registers for that town are not digitised" — is a real
research finding and currently the moment a user churns. The locality-guide and wiki tools
hold what makes it actionable: write to this archive, order this film, visit this repository.
Render a blocker as a card with next actions, not as an apology.

---

## Phase 4 — the cold start

`init-project` asks one open question — the research objective — and a novice does not know
what one is. The highest-traffic screen in the product is a blank text box.

Replace it: *who do you want to learn about?* → name and rough birth year → candidate person
cards from `person_search` → pick one. Then read the tree and **offer the gaps you can see** —
no parents, no death date, no marriage — as three concrete objectives, with "something else"
as the escape. The agent knows what is missing; asking the user to name it asks them for the
one thing they cannot supply.

---

## Phase 5 — the prose (paid, one slot at a time)

Each consumes its skill's eval snapshot: one `make eval-skill` run plus a genealogist
annotation pass. **Only one item per skill may sit in an active column at a time.** Re-check
holders before starting; those below were true on 2026-09-20.

| PR | Slot | What |
|---|---|---|
| S1 | `init-project` | The narration guidance; the cold start (phase 4) |
| S2 | `research` | Make the continuous-work branches unconditional; apply the `proof-conclusion`-writes-status ruling |
| S3 | `question-selection` | Drop the literal. The `q_001` gloss mandate **stays** — ruled 2026-09-20, and links now make it useful |
| S4 | `research-plan` | The execution offer becomes "render the plan and start" |
| S5 | `record-extraction` | A batch is one step; re-key or retire the relay-leak validator |

**The narration guidance is one line and the highest-leverage line in the product.**
`init-project` writes it verbatim into every project and 27 of 28 skills read it from
`research.json` at runtime, so one slot changes narration everywhere. In full, at
`init-project/SKILL.md:46`:

> Plain language for someone who has never done genealogy. **No identifiers, file names, tool
> names or field names.** Do not narrate between actions; report once when the step is done:
> what was found, in one paragraph, and what happens next in one sentence.

**Two clauses change, not one, and getting this wrong costs a second slot on the same skill.**
Delete "Do not narrate between actions" — in this architecture the text between tool calls
**is** the feed. And replace "No identifiers…" with the additive form: identifiers are
allowed and glossed, file, tool and skill names are discouraged as writing quality. If only
the first clause goes, the shipped guidance still bans identifiers, 2a's linkifier has
nothing to link, and issue #2493's acceptance corpus lands against prose containing none.

**A sequencing trap.** Injecting `--autonomous` is the zero-slot way to switch production to
continuous mode, but it inherits `research/SKILL.md`'s rule to suppress preambles and
"narrate only at phase boundaries (or not at all)". **S2 lands before the arm is defaulted
on**, or the first window ships a silent feed.

**The router's three no-yield sites are now correct and stay** — the autonomous-mode section,
step 3's "Iterate — without yielding", and the closing paragraph of "When to stop".

**The literal retires with S1 and S3, and it has more sites than the test.** Every one:
`apps/server/app/agent/hand_back.py` (the pattern, the compiled regex, the ends-with
predicate), `runner.py` (the auto-continue arm), `apps/server/app/config.py` — note
`auto_continue` already defaults to **`True`** with a 30-step cap, and `sandbox/e2b.py` and
`sandbox/local.py` carry it into the sandbox — `apps/server/tests/test_hand_back_parity.py`,
`apps/web/src/components/chatEvents.ts`, `eval/harness/e2e/stop_checker.py`, and the two
skill bodies.

**Reconcile 1c with that default.** The alpha already auto-continues on the literal. Adding a
Stop hook there without retiring the arm gives it two continuation mechanisms; decide in 1c's
PR whether the arm is disabled at the same time or left until S1 and S3 remove its trigger.

`test_every_shipped_hand_back_literal_classifies` ends on `assert seen >= 2` and exactly two
skills carry the literal, so **the first of S1/S3 reds it**. Relax the floor to zero in phase
0; keep the per-literal assertion inside the loop.

---

## What this plan does not do

- **No proof export.** The proof goes to FamilySearch by upload, later.
- **No confidence meter.** Tempting, and the same additive pattern as the links. Hold it
  until change review exists: a score on conclusions the user cannot inspect or reject is
  worse than none.
- **No leaf-skill changes.** `translation` has a gating validator on two consent offers and
  `search-external-sites` asks for repository access. Both are correct when invoked directly.
- **No cost ceiling.** The nudge cap is the only bound on an unattended chain. The forecast
  in 3c makes spend legible; it does not cap it.
- **Nothing binds the reassigned status write.** After S2 `proof-conclusion` owns it by prose
  alone — the plugin hook's owned-sections map has no `project` row. Worth a card.
- **Nothing for Cowork.** Unlinked ids render there as plain text, exactly as today.

## Decisions already made — do not re-open

| | |
|---|---|
| Retiring the literal | Ruled. Prose is flaky; the Stop hook is the mechanism |
| No plan-approval gate | Ruled 2026-09-21. Stop is the control surface |
| `q_` and `ps_` in user-facing text | Allowed, ruled 2026-09-20. The gloss mandate stays |
| The tool-chip row | Stays, and becomes navigation (2a) |
| Binding the rule to `research_append` | **No.** Links, not refusals |
| Proto is production | Alpha is backported; Cowork is degraded |
| The step ceiling | 1,800 s, no test exception |

**Still open:** whether `question-selection` returning "objective answered" on an
already-resolved question needs a mechanism — raise it, do not invent one.

## The board, as of 2026-09-20

| Card | State |
|---|---|
| issue #2292 | Retitled; it is S1/S3/S4's wording card. Its 2026-09-09 first-delegation ruling survives |
| issue #1104 | Closed not planned. Cowork needs no Stop hook |
| issue #2328 | Closed completed by PR #2675 |
| issue #2088 | `high-priority` dropped; the census survives for ADR-0003 |
| issue #2493 | Becomes the acceptance corpus for the linkifier. "Should the rule bind the writer tools" is answered **no** |
| issue #1998 | Merge with S5, or sequence it. The plan-item progress bar in 3c answers a silent extraction batch |
| issue #2660 | Its closure cited the Continue button, which phase 2 deletes. Comment when it lands |
| PR #2695 | Its mechanism is this plan's mechanism. Its two D18 findings are phase 0 |
| **new** | File the `/v1` lock (0c), and emission — nothing on any plane can prove a paragraph reached the reader |

## What would show it worked

- A hosted session whose only input is one person and one chosen objective runs to a proof
  conclusion with **no further input**, and the chat shows one plain paragraph per step.
- A run whose worker is killed at the ceiling resumes and finishes, and a `num_turns == 0`
  resume is never recorded as a completion.
- A typed message is answered at the next step boundary, not at job end, and shows as queued
  until then.
- Every identifier in the feed is either a working link or harmless prose.
- A two-step run renders two log entries, two feed paragraphs, and two ticked plan items.
- A wrong person-link can be rejected from the viewer in one click.
- Stop halts a run within seconds of being pressed, not at the next yield, and the session
  resumes afterwards.
