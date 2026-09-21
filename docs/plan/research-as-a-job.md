# Research as a job — phases 0 and 1

> **Status:** NOT BUILT. Plan of 2026-09-21, for beta in Fall 2026. **This is the whole of
> what to build now**, and it is several weeks of work. Phases 2 to 5 of the wider design are
> in `research-as-a-job-later.md` at intent only; they get their own detailed pass once this
> lands, when the surfaces they touch can actually be opened.
>
> Hardened over four adversarial review rounds. Supersedes the hand-back literal ruled
> 2026-09-07 (issues #2292, #1104, #2328) and the regex auto-continue of PR #2667.

## What you are building

Today a `/research` run stops about nine times to ask "Continue?". After this, the agent
works continuously until the job is done or it needs something only the user can supply.
The user watches a feed, can type at any time — which 1b has to build, because the shipped UI
silently drops input while a turn runs — and presses **Stop** if it is going the wrong way.

**Stop is the control surface.** Not an approval dialog, not a consent prompt. A
non-genealogist cannot meaningfully approve a list of record types and jurisdictions, and an
experienced genealogist would rather see that item 3 is wrong while items 1 and 2 are still
running than tick a box beforehand. So there is **no plan-approval gate** anywhere in this
design.

That serves both audiences at once. Someone who asks a question and comes back in an hour
gets an answer. Someone who watches learns the craft by reading the reasoning as it happens.

**Dependencies.** 1a needs S2 · 1d needs the E2B tier choice. **S2 is a paid eval run plus a
genealogist annotation pass on the `research` skill**, one item per skill at a time, so start
it first even though it is described last.

## Before you start — read these

You are new to this repo. In order:

1. `CLAUDE.md` — the agent operating manual. What binds here: "Architecture you must
   understand", "Plugin hooks", "Code reuse".
2. `docs/architecture.md` — "The hosted web workbench" and "Orchestration".
3. `docs/plan/search-agent-prototype.md` — the prototype's step model and its residual-risk
   register. Phase 0 is that document's open defects.
4. `packages/engine/plugin/skills/research/SKILL.md` — the orchestrator whose behaviour you
   are changing, even though you barely edit it.

Run the stack with `make proto-up`, and the checks with `make proto-smoke`, `make proto-test`
and `make proto-demo`. `make proto-kill` is the resume probe 0a extends.

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
  There is no "browser path" the worker can see. Add `AUTONOMOUS_MAX_NUDGES` to the **`web`**
  service's environment in `docker-compose.yml` — today it carries only `PG_DSN`, `QUEUE_URL`,
  `POLL_S` and `SSE_PING_S`. `begin_turn` reads it from its own environment and stamps
  `max_nudges` on the queue body; `run_turn` prefers the body's value and falls back to the
  module global. `make proto-demo` gets 0 and `make proto-demo-auto` gets 40 because each
  recipe recreates the web container with its own export — **not** because the web tier can
  tell who is calling. Do not put it on `MessageBody`: that tier has no auth, so a client
  could set its own nudge budget.
- **Size it on step count, at least 30, not on the nudge histogram.** The corpus figures
  below describe `--autonomous` runs under a harness that forbids yielding. Production
  between 1a and S2 is a regime nobody has measured.

### 1b. Two exceptions that allow the stop

`make_stop_hook` takes injectable callables — `research()`, `tool_count()`, `on_nudge()` —
all reading Postgres on the turn's connection. Add two more, each one clause in
`should_continue_run`:

**First, make it possible to type at all.** `ChatPane` returns early on `if (!trimmed ||
busy)`, and while a turn runs the Send button is *replaced* by Stop. `busy` clears on
`turn_done`, which under continuous turns is the end of the whole job — a median of 53
minutes. So the plan's promise that the user can type at any time is **false of the shipped
UI**, and typing plus Enter does nothing, silently. Drop the `|| busy` guard, render Send
*alongside* Stop during a turn, and give the sent message the "picked up at the next step"
label — "picked up at the next step". Without this, `pending_user_message()` is never true.

**Second, nothing serializes two turns on one session.** `post_message` enqueues
unconditionally; the `turn_active()` helper exists but only the SSE replay and
`session_state` call it, never the POST. `choose_sdk_session_id` coalesces to one
`sdk_session_id` per session, so two concurrent turns resume the *same* SDK session. Hold the
POST while `turns.completed_at IS NULL` for that session, record the held text in a
control-plane row, and enqueue it when the turn ends. Say whether that row is a `turns` row
with a `queued` outcome or its own table, and name the SSE frame the browser renders for it.

Then the two exceptions:

1. **`pending_user_message()`** — reads the held row above. Allow the stop; that message
   becomes the next turn.
2. **`pending_decision()`** — the agent has asked something and has no answer yet. The
   decision mechanism itself is phase 3 (`research-as-a-job-later.md`); build the callable
   and the clause now, reading a row that phase will write, and leave it returning false
   until then.

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

**Terminal state, and it is bigger than Stop.** `complete()` hardcodes `outcome = 'ok'` and
the `turn_done` payload carries only `{turn_id, receive_count}`, so **every** way a run ends
looks like success — including the two ways an unattended run actually ends, budget spent and
no progress. To a genealogist a half-finished run then reads as "nothing more was found".
Port `terminal_reason` from the harness beside `should_continue_run`, carry it as
`turns.outcome` — `completed | budget | no_progress | stopped | mcp_unavailable` — through
`turn_done` and `row_to_wire`, and say what the browser renders for each.

**And the nudge budget resets on every attempt.** `make_stop_hook`'s state is created inside
`run_turn`, while the tool counter spans attempts. Since 0b makes resume the normal path —
median two attempts, longest six — a cap of 30 is 30 *per attempt*. Either seed the state
from a `turns.nudges` column on redelivery, or write down that the cap is per attempt.

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

## The one prose change these phases need

`research/SKILL.md` is a paid eval slot: one `make eval-skill SKILL=research` run plus a
genealogist annotation pass. Only one item per skill may be in an active column at a time, so
this is the longest-lead item here. Start it first.

**S2 — `research`:**

- Make the continuous-work branches unconditional, so they no longer depend on the literal
  string `--autonomous` appearing in the user message.
- **Add a fourth stop condition** for the later decision work: *you need something only the
  user can supply — emit the decision call, then yield.* The shipped prose currently says
  "In autonomous mode, do not stop just because a decision is hard. Make the call, log the
  rationale, and continue", and names three stop conditions as the only ones. Keep the "do not
  stop because a decision is hard" sentence so "hard" does not become the excuse.
- Apply the 2026-09-01 ruling that `proof-conclusion` writes `project.status`, not the router.
  The router's `allowed-tools` grants two read tools while a routing row mandates the write,
  so the file contradicts itself; three planes already encode the ruling. Grep `project.status`
  **and** `research_append` across the plugin and the architecture guide — two further live
  sites sit inside `research/SKILL.md` itself.

**The router's three no-yield sites are otherwise correct and stay** — the autonomous-mode
section, step 3's "Iterate — without yielding", and the closing paragraph of "When to stop".

**One path the ruling does not settle:** `question-selection` returning "objective answered"
on an already-resolved question. Raise it; do not invent a mechanism.

## Decisions already made — do not re-open

| | |
|---|---|
| Retiring the "Next: … Continue?" literal | Ruled. Prose is flaky; the Stop hook is the mechanism |
| No plan-approval gate | Ruled 2026-09-21. Stop is the control surface |
| `q_` and `ps_` in user-facing text | Allowed, ruled 2026-09-20 |
| Proto is production | Alpha is backported; Cowork is degraded |
| The step ceiling | 1,800 s, no test exception |

## What would show phases 0 and 1 worked

- A hosted session whose only input is one objective runs to a proof conclusion with **no
  further input**.
- A run whose worker is killed at the ceiling resumes and finishes, and a `num_turns == 0`
  resume is never recorded as a completion.
- A deterministically failing turn stops after two zero-progress attempts with a visible
  outcome, instead of retrying forever.
- Stop halts a run within seconds of being pressed, not at the next yield, the session shows
  as stopped rather than completed, and a later message resumes it.
- A message typed mid-run is accepted, shown as queued, and answered at the next step
  boundary.
- A capped or stalled run is visibly distinguishable from a finished one.
- An alpha session runs a multi-step objective to a proof conclusion without the sandbox
  pausing mid-turn.
