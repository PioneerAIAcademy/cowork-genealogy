# Research as a job — the agent runs, you watch and steer

> **Status:** NOT BUILT. Plan of 2026-09-21, for beta in Fall 2026. Written for one
> developer taking it over several weeks. Every phase carries its own acceptance check.
>
> **Dependencies, because the phases are not independent:** 1a needs S2 · 2a needs S1 and S3
> · 3a needs 1b · 1d needs the E2B tier choice. **S1, S2 and S3 are the longest-lead items** —
> each is a paid eval run plus a genealogist annotation pass, one per skill at a time — so
> start them first even though they are numbered last.
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
autonomous run's synthetic result; it did not, so the rule is not built."

**Most of the probe already exists.** `--kill-on` and `--kill-after-s` are implemented in
`turn.py` and documented in the Makefile as the D18 resume probe, and `--kill-on Agent` was
already run on 2026-09-20 — it resumed cleanly, because it killed a *foreground* delegation.
Three things are missing:

1. **A selector that matches the `Agent` call's input**, `run_in_background: true`, read from
   `session_entries.entry`. `tool_calls` carries no input column — `004_worker.sql` adds only
   `tool_use_id` — so matching by tool name alone cannot find the case.
2. **Something that makes it fire.** `run_in_background` is model-chosen; nothing in the
   plugin sets it. It appears in **19 of 714** committed runs and in **none of the eight**
   `bagley-father-1884` runs. So a crafted message asking for two record extractions at once,
   via `--text-file`, and `AUTONOMOUS_MAX_NUDGES > 0`, which `make proto-kill` leaves at 0.
3. **The fallback, named here rather than left to the PR.** If it will not fire on demand
   after a reasonable attempt — each try is a billed run of roughly an hour — the accepted
   evidence is a unit test in `apps/server/tests/test_proto_worker.py` feeding `run_turn` a
   synthetic `ResultMessage(num_turns=0, is_error=False)` on a `receive_count > 1` attempt.
   Do not spend more than two billed attempts chasing the live case.
4. **Only then the guard.**

**Then build:** in `apps/server/proto/worker/worker.py`, on a redelivered attempt
(`receive_count > 1`), a `ResultMessage` with `num_turns == 0` is a resume failure rather
than a completion.

**Bound the retry, and say what terminal looks like.** `elasticmq.conf` has **deliberately
no redrive policy**: "a message that fails on every delivery retries forever with back-off".
The worker's failure path is a 500 → `requeue_backoff`, capped at 300 s. The cause 0a names
is a property of the stored transcript, re-fed on every resume, so if it is deterministic a
bare "retry" is an unbounded paid loop that satisfies the acceptance line while never
surfacing.

**Do not cap on `receive_count`.** A read timeout requeues and SQS increments it, so it
counts a legitimate ceiling crossing and a deterministic failure with the same number — and
per 0b a healthy run crosses two to three times. Any cap safe at p90 is 4 or more and bounds
nothing; any cap that bounds the loop kills the 39% of healthy runs that need three attempts.

**Cap zero-progress attempts instead.** A redelivered attempt counts against the cap only
when it did no work: `num_turns == 0`, or no new `tool_calls` rows above
`turns.entries_seq_before`. Any attempt that did work resets the counter. **N = 2.** This
needs a new `turns` column — `receive_count` cannot carry it, and `elasticmq.conf` already
notes that `ChangeMessageVisibility` never resets it.

**On exhaustion, answer 200 and write the outcome yourself.** `worker.py` raises on
`result.is_error` *before* `complete()`, and `serve_real_turn` turns any raise into a 500,
which `decide.py` maps to a requeue — with no redrive policy, forever. A terminal failure
that surfaces as an error is redelivered and re-runs the model, which is the exact loop this
guard exists to prevent.

**Acceptance:** a kill during a delegation resumes and finishes; no run records a
`num_turns == 0` attempt as a completion; and a deterministically failing turn stops after N
attempts with a visible outcome instead of retrying forever. Break each guard and watch it
fail.

### 0b. Put the step ceiling back to 1,800 s

It was overridden to 7,200 s for the D18 arm on 2026-09-20 because the run kept being cut,
and elasticmq's `defaultVisibilityTimeout` went to 7,500 s to match. The cut was a symptom of
0a, not a capacity finding.

**Build:** change the literal `7200` to `1800` in the `proto-demo-auto` recipe in the
`Makefile`. **Do not delete the line** — the next line sizes `--deadline-s` off it as
`2 * READ_TIMEOUT_S + 300`, and POSIX arithmetic reads an unset name as 0, so deleting it
gives a five-minute deadline on an hour-long billed run. Then set `defaultVisibilityTimeout`
to 2,100 s in `apps/server/proto/elasticmq.conf` and update its header comment.
`test_proto_config.py` asserts the export is present and reads it for the visibility check;
re-point `_exported_ceiling_s` now that the ruling is 1,800 with no exception.

**What it costs, and it is not what an earlier draft said.** The ceiling bounds one queue
message, and under continuous turns one queue message is a whole run — so the number that
matters is run length, not segment length. Measured over the 134 committed e2e runs that
reached `completed`:

| | |
|---|---|
| median | 53.5 min |
| p90 | 83.3 min |
| longest | 168.8 min |
| exceed 1,800 s | **94.0%** |
| exceed 3,600 s, so more than two attempts | 38.8% |
| exceed 3,900 s, the demo's current deadline | 32.1% |

**Resume is the normal path, not the exception** — the median run needs two attempts, p90
three, the longest in the corpus six. That is why 0a gates this phase.

**Re-size the demo's wait in the same edit.** `--deadline-s` is `2 * READ_TIMEOUT_S + 300`,
which is 3,900 s at the new ceiling, and 32% of *successfully completed* runs exceed it —
`demo.py` turns that into a hard `TimeoutError` and a FAIL. Make it `6 * READ_TIMEOUT_S + 300`
and say why: the demo has to span six attempts, not one resume.

**The test list:** `test_proto_config.py` needs **no edit** — its `_exported_ceiling_s()` is a
regex reader over the recipe, so it tracks the Makefile, and hardcoding 1,800 into it would
destroy the derivation. What reds is `test_proto_demo.py`, both the `== 7200 > STEP_CEILING_S`
assertion, whose inequality is now false, and the deadline regex. Also stale: the Makefile
help text and comment block, and `elasticmq.conf`'s header, which names 7,200 twice.

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

**Blocked on S2.** Until that lands, the skill's continuous-work branches are gated on the
literal string `--autonomous` in the user message, and the browser posts raw text straight
through `begin_turn`. So either S2 lands first, or the web tier prefixes the flag — decide,
do not leave it implied.

**Two carriers, both missing today.**

- **The cap.** `AUTONOMOUS_MAX_NUDGES` is a module global read once at worker startup, and
  the same worker serves the browser and `make proto-demo`, which must stay a one-turn run.
  There is no "browser path" the worker can see. Carry `max_nudges` on the queue message body
  beside the access token — set by the web tier in `begin_turn`, read in `run_turn` — so the
  demo keeps 0.
- **Size it on step count, at least 30, not on the nudge histogram.** The corpus figures
  below describe `--autonomous` runs under a harness that forbids yielding. Production
  between 1a and S2 is a regime nobody has measured.

### 1b. Two exceptions that allow the stop

`make_stop_hook` takes injectable callables — `research()`, `tool_count()`, `on_nudge()` —
all reading Postgres on the turn's connection. Add two more, each one clause in
`should_continue_run`:

1. **`pending_user_message()`** — the user has posted a message that is waiting. Allow the
   stop; their message becomes the next turn.
2. **`pending_decision()`** — the agent has asked something and has no answer yet. See 3a.

**Know how rarely these fire before you rely on them.** Measured for this plan over the 181 committed e2e run logs carrying a nudge count: the model voluntarily yields a **median of once per run**, mean 1.65, and **31% of
runs yield zero times** — the hook fires only at job end. Against a 53.9-minute median run,
anything gated on a yield is checked about once. That is fine for `pending_decision()`,
which the agent itself triggers. It is not fine for Stop.

### 1c. Build Stop — it is the control surface and it does not exist

`POST /api/sessions/{id}/interrupt` on the prototype returns **501**, "Interrupt is not
available in the prototype: the worker owns the turn". The whole design rests on Stop, so
this is phase 1 work, not a later nicety.

**Do not implement it as a yield-gated `hold` flag** — per the measurement above that is a
median of one check per run. Use the `PreToolUse` hook `build_worker_options` already binds
with `matcher=None`, which fires on **every** tool call; the corpus puts one model call plus
its tool calls at a median of 2.6 s.

**On the alpha, Stop already exists — use it.** `RealAgent.interrupt()` calls the SDK
control channel and is already wired to the Stop button through the runner. The work below is
for the **prototype**, where the worker owns the turn and no control channel reaches it.

**On the prototype, return `{"continue_": False, "stopReason": …}`, not `_deny(...)`.**
`_deny` returns a `permissionDecision: "deny"` — a tool result the model reads and argues
with, not a halt. The SDK's halt fields are separate.

**The halted turn must answer 200.** Same trap as 0a: `worker.py` raises on `result.is_error`
before `complete()`, `serve_real_turn` turns a raise into a 500, and `decide.py` requeues a
non-2xx with no redrive policy. A stop that surfaces as an error is redelivered and re-runs
the model forever.

**And the Stop hook must not undo it.** `should_continue_run` has exactly four paths that
allow a stop — MCP unavailable, project completed, budget spent, no progress — and none of
them is "the user stopped". Add a third injectable, `stopped()`, as the **first** clause,
ahead of `project_completed`. Do not rely on the no-progress escape instead: a denied call
still writes a `tool_calls` row and `count_tool_calls` counts rows, so the counter moves and
that escape never fires.

**Where the flag lives:** a control-plane row keyed by session, written by
`POST /api/sessions/{id}/interrupt` (today 501), read by both hooks on the turn's connection.

**Terminal state:** `complete()` hardcodes `outcome = 'ok'`. A stop needs its own
`turns.outcome` of `stopped`, carried on the `turn_done` payload and through `row_to_wire`,
or the browser renders a stop as a normal completion.

**Two things to measure before relying on this.** Whether `continue_: False` also suppresses
the Stop hook dispatch — if it does, `stopped()` is belt and braces; if not, it is
load-bearing. And whether a **subagent's** `continue_: False` halts the parent session or
only that subagent: the hook binds with `matcher=None` so it fires on delegated calls too,
and if only the subagent halts, Stop pressed during a `record-extractor` delegation does not
stop the run.

**Acceptance:** Stop pressed mid-run halts within seconds, the session shows as stopped
rather than completed or failed, and a later message resumes it.

### 1d. Backport the hook to the alpha

Alpha testers are the feedback loop and should not go quiet for weeks.

**The alpha has its own ceiling and it is lower than the prototype's.**
`_RUNNING_TIMEOUT_S = 3600` in `apps/server/app/sandbox/e2b.py` is E2B's Hobby-tier
**maximum** — creating with 7,200 fails with a 400, and `set_timeout` past the ceiling
returns 204 and silently no-ops. It clocks **continuous runtime, not idleness**, and today
`set_timeout` has exactly one caller: `resume()`, on `/connect`. Against a corpus median run
of 53.9 minutes and p90 of 107.9, one continuous turn per job pauses mid-turn at or before
p90, and around half of runs come within minutes of it.

**Pick one before starting 1d and write it in the PR:**

- **(a) Pro tier** — the same comment records 86,400 s on Pro. A billing decision, not an
  engineering one.
- **(b) A heartbeat.** `set_timeout(_RUNNING_TIMEOUT_S)` from the control plane while a turn
  is active restarts the clock; only values *past* the ceiling no-op. This is the cheapest
  route and it is what `resume()` already does on every connect.
- **(c) Accept the pause** — but then **measure what it does to an in-flight turn first**.
  The CLI subprocess, the SDK stream and the browser socket are all in-process, and nothing
  in the repo records the outcome of pausing across them.

Until one is chosen, 1d is gated. What remains true: the alpha suspends rather than killing,
so this is a different failure from the prototype's kill-and-redeliver, and phase 0's resume
guard does not apply to it.

**Build:** `build_options` in `apps/server/app/agent/real_agent.py` already passes a `hooks=`
dict carrying `PreToolUse`. Add a `Stop` entry whose callback reads `/project/research.json`
(the runner already has `PROJECT_DIR`) and calls the same predicate.

**Share it between the alpha and the prototype; keep the harness's copy separate.** The
worker already imports from the alpha — `options.py` takes `direct_project_file_write` and
`worker.py` takes `map_message`, both from `app.agent.real_agent` — so one copy under
`apps/server/app` serves both planes. What is genuinely separate is `eval/harness`: the
worker image does not copy `eval/`, and a test asserts those two trees never import each
other.

So: two copies, not three. Pin them with an AST-lifting parity test, the pattern
`eval/harness/tests/unit/test_write_lockdown_parity.py` already uses for exactly this
problem.

**Acceptance:** an alpha session runs a multi-step objective to a proof conclusion on one
user message *without the sandbox pausing mid-turn*. The e2e suite still passes against the
shared predicate.

---

## Phase 2 — the reading experience (renderer only; independent of 0 and 1)

### 2a. Identifiers become links, never refusals

**Blocked on S1 and S3.** The shipped narration guidance still bans identifiers, so until
those land there is nothing in the prose for a linkifier to link, and issue #2493's
acceptance corpus would be measured against text containing none.

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

**Name the writer, or `pending_decision()` can never be true.** The Stop hook's callables
are reads on the worker's connection. The agent's only writers are the genealogy MCP tools,
and `PgS3ProjectStore` writes `documents`, `blobs` and `staging` only — there is no path from
the agent to an arbitrary control-plane table, and 3a deliberately closes the
`AskUserQuestion` route as well. Pick one:

- **(a) The worker's `PreToolUse` hook writes the row** when it sees a designated tool call.
  It already writes `tool_calls` rows on the turn's connection through its `record` callable,
  so this costs nothing new and leaves the engine untouched. **Recommended.**
- **(b) A `decision_ask` MCP tool** — which means `allToolSchemas`, a `server.ts` arm,
  `manifest.json`, a `dev/smoke-calls.ts` row and a `ProjectStore` method. The expensive one.

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

**S2 is the gate on 1a, not a follow-up to it.** Injecting `--autonomous` is the zero-slot
way to switch production to continuous mode, but it inherits `research/SKILL.md`'s rule to
suppress preambles and "narrate only at phase boundaries (or not at all)" — so defaulting the
arm on before S2 lands a silent feed. This is why S1, S2 and S3 start first despite being
numbered last.

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
Stop hook there without retiring the arm gives it two continuation mechanisms; decide in 1d's
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
- **No effective cost ceiling, and the nudge cap is not one.** Of the 181 corpus runs, 36
  had to be killed by a harness cap production does not have — 24 on wall clock, median 120
  minutes, and 12 on cost, median $16.72 — and the **highest nudge count among all 36 was 5**.
  A cap of 30 would have stopped none of them, because the cap is consulted only at a
  voluntary yield and 31% of runs never yield. Either carry the harness's own caps (cost,
  tool calls, model turns, progress stall) on the queue body and enforce them in the
  `PreToolUse` hook, which fires every few seconds, or state in writing that an unattended run
  has no effective bound. The forecast in 3c makes spend legible; it does not cap it.
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
