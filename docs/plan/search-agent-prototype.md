# Search Agent prototype — hosted architecture, one month

**Status:** IN PROGRESS — P1, the three D1–2 probes, P3 and P2 measured 2026-09-10 (PR
#2406); D3 built 2026-09-11 (PR #2455); D4–5 built 2026-09-11 (PR #2495); FamilySearch's
gateway and SSE answers folded in 2026-09-11, with P3b and the corpus cache-window
measured the same day; the build continues on the re-decide branch · plan of 2026-09-09 ·
adversarially reviewed twenty-five rounds (`plan-critic`), then **cut**: the review
loop's own output — a turn-lock protocol, a five-arm shim and a ceiling guard with its
proof — grew to a third of the document and generated a blocking finding every round it
existed, while the architecture and risk sections did not move a word. It failed the
scoping test below and was deleted, every load-bearing figure
re-derived from the committed corpus at `e18d99b10`. Re-checked against `main` on
the morning of 2026-09-10, before the build started: the counts that moved since
`e18d99b10` (agents,
`fs` importers, vitest files), one that was a miscount (`getValidToken` call sites) and the
probe-readiness corrections are folded in below.

**Owner:** Dallan. **Timebox:** ~22 working days, solo; a few days' overrun accepted.
**Goal:** prove the risky half of the proposed FamilySearch architecture before
FamilySearch commits to it, and produce measurements nobody currently has.
**Becomes:** the basis of the real two-backend implementation. The engine work is
built to keep; the docker-compose scaffolding is throwaway.

---

## What this proves

A full research run, driven interactively in a browser, where project state lives
in Postgres and S3, the agent has no shell and no route to project state on disk, and
the turn is a durable unit of work on a queue — survives its worker being killed
mid-delegation and resumes without losing work.

Note the wording. The runtime keeps two writable ephemeral paths of its own (see
Container layout); the claim is that **the agent** cannot reach project state, not that
nothing on the filesystem is writable.

## The scoping test

**Does building this reduce uncertainty?** If a thing is known-pattern code with no
unknowns in it, building it in the prototype buys nothing — it is not a risk we are
carrying. Everything below is out on that test, not because it is unimportant.

## What it deliberately does not prove

- Deployment on FamilySearch infrastructure (Beanstalk, Blueprint, P20, the DTM).
- SSE through the FamilySearch edge — CloudFront, Imperva and HAProxy are not
  available for this work. **This is a written exception, not an oversight.**
  Zero FamilySearch pages mention `text/event-stream`, the HAProxy guide never
  mentions streaming or buffering, and every WebSocket deployment routes around
  the DTM. It stays open until FamilySearch can run the probe themselves. Their
  2026-09-11 answer narrows it (R3): HAProxy has no duration cap and DTM idles out at
  60 s, so the design answer is reconnect-and-resume on `Last-Event-ID` (D11–12), and
  what remains unprobed is CloudFront, Imperva and DTM under concurrency.
- Multi-patron token custody (the seam is built; the custody is not).
- Opaque session tokens in place of a live FamilySearch grant on every hop. Known
  pattern, no unknowns — fails the scoping test.
- **Content-level assertion deduplication.** Turn-scoped *batch* identity was to be
  built instead (days 6–8) and was cut on 2026-09-10 when P1 measured re-decide; it
  would have folded a byte-identical re-emission of a writer call. What
  neither covers is the model **re-deciding** — rephrasing the same claim on resume —
  and that stays open. Measured against the committed corpus, the best content key
  (record + role + persona + fact type + value + date + place) **would refuse 0 of
  8,171** assertions when compared against the *pre-call* document — 26 pairs do
  collide, but all 26 were written inside a single call, which a pre-call snapshot
  cannot see — while matching **0 of 86** assertions in the only available re-decide
  proxy (9 records extracted twice within one run, under different log entries). It is safe, and on the corpus it does not work; P1's forced kill (2026-09-10) is the
  one measured band where it would have matched — 17 of 20 ops — and the three
  rephrased values still get through. The residual risk is the one worth stating: in this domain a
  duplicated assertion reads as *independent corroboration*, so a re-decided
  duplicate could still inflate a proof conclusion.
- **Skill output files.** `search-wikipedia` and `search-familysearch-wiki` both
  require a file write into the working folder — `search-wikipedia` says "**You must
  actually write**", `search-familysearch-wiki` "**Actually invoke the file-write tool
  to save it**" — and
  cwd is `0555` here, so both fail with `EACCES`. The plan enumerates the three *read*
  classes the project directory takes with it; this is the *write* class, and it is out
  of scope. A store-backed output path is deferred.
- Research quality parity beyond a two-fixture eyeball.

---

## Architecture as prototyped

| Concern | Alpha today | Prototype |
|---|---|---|
| Compute | E2B microVM per session | Stateless web tier + queue + worker, all containers |
| Turn execution | Long-lived agent process in the sandbox | One patron turn per queue message; SDK resume is the checkpoint |
| Project state | Session filesystem is the only copy | Postgres jsonb documents, S3 blobs, behind one `ProjectStore` interface |
| Conversation | SDK on-disk transcript | SDK `SessionStore` backed by Postgres/S3, hydrated per turn |
| Agent shell | `Bash` under `bypassPermissions` | Removed via `disallowed_tools` on the worker's options — see below |
| Tool layer | Node forked over stdio in the sandbox | Same, stdio, writing to Postgres/S3 — HTTP transport swapped in week 4 |
| Transport | One WebSocket per session | SSE plus a 1 s Postgres poll |
| Model | Anthropic API direct | Bedrock direct (`CLAUDE_CODE_USE_BEDROCK`) for the prototype; production is the Messages-compatible Agent Gateway through `ANTHROPIC_BASE_URL` with the Bedrock flag unset (answered 2026-09-11; P3b) |
| OCR | OpenRouter running Gemini | Unchanged — a pure HTTP caller the substrate does not touch |
| Identity | FamilySearch OAuth + email allowlist | Unchanged |

### The step model

**One patron turn per queue message.** Not one model call. If the worker is killed
— by the step ceiling (enforced in the prototype by the sqsd shim, see D3), a deploy, or
a crash — the queue redelivers and the
SDK resumes from the transcript, which already contains the completed work.
Progress is monotone, so the ceiling is a *forced checkpoint*, not a failure.
Measured on Beanstalk 2026-09-11 (D3): sqsd cuts the POST at exactly `InactivityTimeout`,
tells the worker nothing, and lets the message return only when `VisibilityTimeout`
lapses — so the checkpoint costs `VisibilityTimeout − InactivityTimeout` of dead time,
and the shim's container kill is what the worker side needs on top.

This is why no explicit checkpointing at `Skill`/`Agent` boundaries is needed.
Earlier drafts of this plan had one; it was solving a problem resume already solves.

**The one case that would break it: a single tool call longer than the step ceiling can
never complete.** It is killed, redelivered, restarted, killed again, forever.

**No such call exists in the corpus.** Pairing every tool launch to its result across
the 51 instrumented runs gives 8,898 calls with **zero over 1800 s** — the longest is
`image_transcribe`, and the longest delegation is well inside the ceiling too. (The
exact maximum is sensitive to how interleaved calls are paired, so treat the
*conclusion* as the finding and not any single figure.) An earlier draft cited 2993 s
as a delegation; that was a **span containing many completed calls**, not one call, and
is withdrawn.

**Guard:** log every tool call's duration and **look at them** in the run's own output.
Nothing bounds a delegation — the longest observed is 832 s against an 1800 s ceiling —
so this is a tripwire for a future unbounded one, not a discriminating test. It is
deliberately *not* an automated assertion: an earlier draft specified one, then a proof
that it fired, then a synthetic queue profile so the proof could run, and each layer
generated the next round's defect. One engineer watching one run does not need three
layers of scaffolding around a constraint the local environment simulates anyway.

### Streaming

No token streaming. `map_message()` already produces exactly the right events —
`text`, `thinking`, `tool_use` with a human-readable summary, `tool_result`,
`task_started`, `task_progress`, `task_done` — and **subagent turns arrive on the
same stream** tagged with `parent_tool_use_id` and labelled with the agent's name.
Complete messages only: partial stream deltas carry no `parent_tool_use_id` (measured
2026-09-10, 545 stream events, none tagged), so per-subagent progress keys on messages.
Keep its event vocabulary; the only field added is `tool_use_id` on `tool_result` (see
D15), and otherwise change only where its output goes. That edit lands in
`apps/server/app/agent/real_agent.py`, is additive, and leaves the hosted UI alone —
`chatEvents.ts` folds `tool_result` by tool name.

Two tables, matching the existing `TRANSIENT_KINDS` split:

- **`session_events`** — append-only, durable. About 470 rows per run.
  Per-session `seq` from `UPDATE … RETURNING`, never `BIGSERIAL` (a sequence has
  gaps and is not per-session, so a client cursor would skip rows).
- **`session_activity`** — one row per session, `UPDATE`d in place, for
  `task_progress`. No insert storm, and a reconnecting browser reads current state
  instead of replaying a heartbeat.

The 1 s poll reads events after a cursor plus the activity row.

**Do not add a `PreToolUse` progress hook.** It sees tool inputs only — never the
narration or the thinking — which is the whole argument. (It *does* fire on delegated
calls: the shipped hook routes by caller identity off `agent_id`/`agent_type` in the
payload. An earlier draft said otherwise, which contradicted both D15 and acceptance
criterion 3.) Two `PreToolUse` hooks sit on P1's session. The shipped plugin hook's
matcher is `Write|Edit|NotebookEdit|.*device_commit_files|.*research_append`, so it
never fires on `extraction_append` — the call P1 kills on. The hosted `_pretool_hook`
the driver inherits from `build_options` has no matcher, fires on every tool including
that one, and allows it. P1's delegation evidence comes from the SDK stream's
`parent_tool_use_id`, not from either hook; the prototype's own deny-and-log hook at
D15 matches every tool the way the hosted one does today.

### Session store keying, and why `cwd` is pinned

**Key the store on `(session_id, subpath)` and discard `project_key`.** The SDK
computes it from `realpath(cwd)` and hands it over as an opaque field; a custom store
is free to ignore it, and a key-blind store was verified to resume correctly including
subagent transcripts. Session ids are UUID v4 — no collision risk. The only things
that lose meaning are `list_sessions` / `list_session_summaries`, neither of which we
need. Carry project scope in the store's constructor, not in the key.

**Pin `cwd` to a constant path in every worker (`/project`) anyway, but not for the
prompt cache — that reason is measured false.** On a resumed turn, production-shaped
(real plugin, the five agents then present, stdio MCP, tool search on), same-cwd and
different-cwd both
gave `cache_read = 17854`, delta 0. The cwd literal sits in the env block *after* the
cached breakpoint, in a ~12k tail that is rewritten every turn regardless. The real
reasons to pin it are duller: **the CLI refuses to spawn if cwd does not exist**, and
`project_key` derives from it. Keep the pin; do not spend a probe defending it, and do
not cite it against R2.

**The cwd is an empty, read-only anchor — nothing reads it, and the probed runs wrote
nothing into it.** A `0555` empty directory ran full turns including a delegation and a
390 KB spill, exit 0. Two skills *do* attempt a write there and fail with `EACCES` —
see "Skill output files" above.

### Container layout

| Mount | Mode | Why |
|---|---|---|
| `/project` (the `-w`) | **ro**, empty, same string every worker | Must exist or the CLI will not spawn. Nothing reads it. |
| `/opt/genealogy/plugin` | **ro** | 28 skills + their `references/`/`templates/` + `hooks/`. **Skills have no programmatic form** — the plugin must be on disk, at a fixed absolute path, because the path becomes conversation content. |
| `/opt/genealogy/plugin/agents/*.md` | **ro** | Parsed once at worker start into `agents={…}`. Never read at turn time. |
| `/opt/genealogy/engine`, `node`, `python3` | **ro** | Tool server; `python3` for the plugin hook. |
| `~/.familysearch-mcp/config.json` | **ro** | Sidecar URLs, OpenRouter key, `hosted: true`. No `tokens.json`. |
| `CLAUDE_CONFIG_DIR` | **rw**, fresh tmpfs per container | Transcript — the only source of store frames. **Never re-attach a warm one.** |
| `TMPDIR` | **rw**, tmpfs | Non-negotiable, and where the volume actually lands (below). |

**Why those two must be writable — and what that does *not* concede.** The store mirror
is downstream of a local file write. The SDK's own `append` docstring: *"Called AFTER
the subprocess's local write succeeds — durability is already guaranteed locally."* The
CLI writes a transcript line, then emits a frame naming the file it wrote; the batcher
maps that path back to a `SessionKey` and calls the store. **No local write, no frame,
nothing persisted.** Local disk is the *transport* into the store, not a competing copy
of state — so these paths must be **writable, not durable**, and a per-container tmpfs
discarded at turn end is exactly right. It holds the transcript, one subagent transcript
pair per delegation, the oversized-result spill, and a small config cache. None of it is
research data.

There is no way to switch it off: `--session-mirror` gates the *mirror*, not the write.
This is an inherited implementation artifact — sensible on a laptop, where local disk is
the durable store and the adapter is the secondary copy. **The CLI version comes from the SDK wheel** — `_find_cli` prefers the
bundled binary over PATH, and SDK 0.2.128 bundles Claude Code **2.1.220**. Pin the pair
as 2.1.220 / 0.2.128 and record it from `_cli_version.__cli_version__` at worker start.
**It is not a downgrade.** The 2026-08-30 `tools:`-omission measurement ran through
`make probe-agent-binding` on the `apps/server` venv, whose SDK already bundled 2.1.220
and whose `build_options` sets no `cli_path`, so it already ran on 2.1.220; the `2.1.251`
the repo recorded was the PATH `claude --version`, which the SDK never spawns. Re-run
2026-09-10 with the version and the resolved CLI path printed (2.1.220); the eight
citations in seven files — the probe docstring, `Makefile`, `CLAUDE.md`,
`docs/architecture.md`, ADR-0004, `docs/specs/research-append-tool-spec.md` and two in
`tests/packaging/agent-tool-names.test.ts` — are corrected in PR #2406.

**A second silent-loss mode with the same signature.** The batcher matches on path: if
the CLI's `CLAUDE_CONFIG_DIR` differs from the parent's, every frame is dropped with a
`logger.warning` whose text is *"subprocess CLAUDE_CONFIG_DIR likely differs from parent
(custom env / container?)"* — somebody hit this in a container before us. The same
assertion catches this and the read-only case: **frames appended > 0 per turn.**

**State it as "writable by the process, not writable by the agent."** The claim is not
that no path is writable — it is that **the agent has no route to project state**, which
lives in Postgres behind validating tools. Be precise about what is and is not denied:
`disallowed_tools=["Bash", "WebFetch", "WebSearch", "NotebookEdit"]` (the same list the
unit harness already ships as `DISALLOWED_BACKSTOP`). **`Write` and `Edit` stay
granted**, because they are whole-tool names and denying them would take the agent's
ability to write anything at all. So the model *can* write into the ephemeral tmpfs. That is not project state, it is discarded at turn
end, and the only thing it could corrupt is the run's own transcript. Do not claim the
model holds no tool that can put a byte in those directories; claim the boundary that
actually holds. "We removed the
writable filesystem" is the version a reviewer falsifies in one question.

`setting_sources=[]` **explicitly, never omitted.** Omitting it makes the SDK pass no
flag, so the CLI's own `user,project` default applies — and a `CLAUDE.md` or a
`.claude/agents/` in any *parent* of cwd is then loaded. Both were reproduced by probe;
`[]` suppresses both. No `/project/.claude/`, no `add_dirs`, no `git`.

### Removing the shell — the mechanism, because it is not the obvious one

**Set `disallowed_tools=["Bash", …]` on the worker's `ClaudeAgentOptions`.** This is
the only lever that reaches the main thread. A per-agent `tools:` allow-list is
*subtractive* and can only narrow what a subagent inherits — `CLAUDE.md` says so, and
the shipped hook's own docstring says it in the same words: *"A `PreToolUse` hook is
the only instrument that can restrain the MAIN THREAD."* Under `bypassPermissions`
`allowed_tools` is inert; `disallowed_tools` becomes `--disallowedTools`
(`subprocess_cli.py:503`).

**Prior art, and a caveat that comes with it.** `eval/harness/harness/skill_runner.py`
already ships `DISALLOWED_BACKSTOP = ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]`
as `disallowed_tools` under `bypassPermissions`, so the mechanism is in service here.
But that file also says *"disallowed_tools must actually block unlisted tools — verify
on every SDK version bump"*, and its verified range stops at `<0.2`. This plan pins
0.2.128. **Add to the D1–2 probes: confirm `disallowed_tools=["Bash"]` denies under
`bypassPermissions` on the pinned SDK/CLI pair.** Criterion 3's only mechanism is
otherwise first exercised at D17.

An earlier draft dropped acceptance criterion 3's shell half as "vacuous once `Bash` is
absent from `tools:`". That premise was false — `tools:` never removed it from the main
thread — so the plan claimed a shell-less agent, specified no mechanism for it, and
deleted the only check that would have caught the gap. **The criterion is restored**,
and it is falsifiable because the deny-and-log hook records every tool call.

### Auth

FamilySearch sign-in is unchanged. The patron's live access token travels to the tool
server **in a session header**, and stays a live credential on every hop for the
prototype.

**Refresh moves out of the tool server.** Today `getValidToken()` refreshes *and*
persists to `~/.familysearch-mcp/tokens.json`. In a header model the tool server has
nowhere to persist that the web tier would see, so: the **web tier owns the grant** in
Postgres, refreshes it, and hands the worker a fresh access token per turn. The tool
server never refreshes — it uses the bearer it is given. That also disposes of
"the grant expires mid-turn": a turn is minutes, the grant is 8 h idle.

**The token must travel with the request, not be looked up from process state.**
`STORAGE_DIR` is a module-level constant from `os.homedir()`; `getValidToken()` takes
no arguments and reads that one file; 16 modules call it. Put N patrons in one process
and B's refresh overwrites A's token, after which A silently acts as B — a successful
response carrying the wrong person's records, not an error. A header does not fix this
on its own: writing the header's value into the global rebuilds the identical race
behind a new front door.

**Take the type change: `getValidToken(subject)`, not an `AsyncLocalStorage` context.**
An async-local store is less code, but at n=1 a call site that never establishes the
context is indistinguishable from one that does — it just works, and stays wrong until
there are two patrons. An explicit parameter makes every unscoped call a **compile
error** at all 16 call sites in 16 files (an earlier draft's 19 counted three comment
lines). That is the difference between a
prototype that reduces uncertainty and one that hides it. About a day rather than
half. `loadConfig()`, `getWikiApiUrl()` and `getOpenRouterApiKey()` have the same shape
and move with it.

### Locking

`withProjectLock` serializes each writer tool's whole read-modify-write body against
every other writer for the same project. Its spec records the residual
(`docs/specs/research-append-tool-spec.md`, Concurrency):
*"this binds only within one MCP server process. Every deployment we run is one server
per session, so it holds there."* **One server per session is exactly what this
architecture removes** — and it is tool-server multiplicity that breaks it, not worker
multiplicity.

**In the Postgres backend, use `pg_advisory_xact_lock` keyed on the project id — and note
what that forces.** An *xact* lock lives only as long as its transaction, and
`withProjectLock` wraps the read, the mutation, `validateProject` (which itself reads
`research.json`, the tree and every sidecar) and the atomic write. All of that must run on
one connection, so **`ProjectStore` must expose a transaction scope and writer bodies must
run inside it**. That is an interface requirement on **D4–5**, a day before the lock is
scheduled: designing it in is free, retrofitting it is not. The file backend keeps its
in-process mutex.

**One turn per session, and the resume path.** The prototype runs **one worker**, so
concurrency between workers is a production concern, not a prototype one. The single rule
that matters here: a redelivered message carries the same `turn_id`, and that claim must
be granted immediately — that *is* the resume path, and refusing it stalls every
kill-resume iteration at D14 and D17.

**The shipped `/v1` lock has a real defect, and it is not ours to fix here.** It claims a
bare timestamp with no turn identity inside `POST /sessions/{id}/messages`, with a 600 s
stale TTL and **no heartbeat anywhere**, against an immovable 1800 s step ceiling and a
measured p99 segment of 1488 s — so a healthy long turn has its lock reclaimed while it is
still running. File it as a `nothing-checks` issue against `/v1`.

**Everything else about locking is deferred to R8, deliberately.** An earlier draft
specified a full protocol here — `claim_epoch` fencing, epoch-conditioned release,
completion-record-before-claim, a 409 refusal arm and four named residuals. That protocol
is textbook code with no unknowns in it, and this section's own conclusion is that the
prototype at n=1 with one tool-server process will never surface any of it. It failed the
scoping test at the top of this document and it generated a blocking review finding in
every round it existed. It belongs in code with tests, not in prose.

---

## Before Monday — 30 minutes; the quota request and the two emails have lead times

1. **Bedrock model access** in the personal AWS account — **done 2026-09-10**: a
   one-token `converse` on `us.anthropic.claude-sonnet-4-6` in `us-east-1` returned.
2. **Service Quotas increase request** for Claude input TPM. Takes days. A single
   session runs ~166k tokens/min against a 2M TPM default, so 50 concurrent
   sessions is not a default-quota workload.

3. **Two emails** (drafted separately): one to FS AI Platform covering the Agent
   Gateway's API surface, prompt-caching behaviour, token quota, and Guardrails
   coverage; one asking for an SSE probe through the real edge. Between them they
   close the entire top tier of the risk register below, and neither costs a day of
   the original twenty. **Answered 2026-09-11** — folded into R1–R3, R6, the new
   R10–R13, P3b and D11–12 below.

No FamilySearch OAuth ticket is needed: `http://127.0.0.1:1837/callback` is already
registered on the FS dev client. An Elastic Beanstalk hostname would not have been —
a second reason a full AWS deploy is out of scope.

---

## Probes — days 1–2, before the build proper

### P1. Cross-process resume (days 1–2) — **no fallback exists; this gates everything**

P1 runs **against a throwaway store** — a bare `docker run postgres` and a ~60-line
psycopg `SessionStore`, not the D3 compose skeleton or the D9–10 adapter, neither of
which exists yet. No minio: store entries are opaque JSON dicts that fit `jsonb`, and
the `apps/server` venv has psycopg but no S3 client. Define `list_subkeys` on the store
class itself — the SDK detects optional methods by comparing against the Protocol
default, so a store that inherits it never has its subagent transcripts materialized —
and pass it through the SDK's own `run_session_store_conformance` before a token is
spent. To reach a delegated `extraction_append` it needs a **scripted single-record
turn against a one-record fixture**; build that here and D15 reuses it. The driver is
`probe_agent_binding.py`'s `run_arm` under the prototype-set switch added at D1–2
(`agents=`, `setting_sources=[]`, `plugins=[…]`) — not the hosted set, which stages
agents into a writable project and reopens the parent-`CLAUDE.md` leak — with
`session_store` and `session_store_flush="eager"` added. Model cost is single-digit
dollars: a one-record turn is a fraction of a $7 full run.

**None of the live probes this plan cites as settled — the key-blind store resuming
with subagent transcripts, the read-only `CLAUDE_CONFIG_DIR` writing zero frames, the
`setting_sources` leak — is in the repo.** P1 started from zero committed evidence; what was
re-run lands under `apps/server/dev/p1/` in PR #2406.

Five variants, all resuming in a *different process* from that store:
clean handoff between turns; SIGKILL mid-delegation; SIGKILL mid-model-call; and — for
the re-issue-vs-re-decide measurement below, which a timed kill cannot reliably produce
— a **forced** stop in two arms, using a debug-env branch in the current engine that
sleeps before the commit, or holds the response after it, while the harness kills the
process group. `extraction_append` has no body
to sleep in — it is a one-line delegation to `researchAppend` — so the branch lives in
`research-append.ts`, keyed on the tool name it was called under, and the variable
reaches only the node child through the MCP server's `env`. Launch the driver from the
harness with `Popen(..., start_new_session=True)`: the SDK spawns the CLI in the
driver's process group, so a `killpg` on that group takes the driver and the CLI
without taking the harness. Expect the timed kills to miss:
the delegated write is a few seconds inside a one- to two-minute turn, and a miss is
not a failure.

**Measured 2026-09-10 (PR #2406; evidence under `~/.cache/cowork-genealogy/p1/`).** All
five variants — clean handoff, forced kill before the commit, forced kill after the
commit, mid-delegation, mid-model-call — passed every criterion below: a fresh process
loaded every frame from Postgres, materialized the subagent transcript through
`list_subkeys`, and continued the same session; zero mirror warnings under eager flush;
$0.65–$1 a run, each resume in a fresh process with an empty `CLAUDE_CONFIG_DIR`.
**The branch answer is re-decide.** The resumed main thread recognized
its completed calls (it did not re-write the research log) but did not continue the
in-flight delegation: it re-delegated to a new subagent, whose `extraction_append`
hashed differently — 17 of the 20 ops value-identical (the source op and 16 of the 19
assertions), three derived birth values rephrased, and the source entry's title and
notes reworded. Resume granularity is therefore the main-thread
tool call; a delegation in flight is redone, its cost lost and its result not. Killed
*after* the commit instead, the resumed turn read the project state and issued no
second write: 19 assertions before and after. The duplicate risk named under "Content-level
assertion deduplication" above did not materialise at n=1; on the before-commit arm a
content key would have matched the 17 value-identical ops and missed the three
rephrased ones.

Seven pass criteria, plus one measurement that sets a branch:

- The resumed run continues rather than restarting.
- **Loaded entry count > 0 before spawn.** `materialize_resume_session` returns `None`
  rather than raising, in five distinct cases. With an explicit `resume=<uuid>` that is
  still **loud** — the CLI prints "No conversation found with session ID" and exits 1 —
  so this counter is belt-and-braces rather than the main guard. The silent cases are
  the next two bullets.
- **RESTART ON A GENUINELY EMPTY DISK — a fresh container, no re-attached volume.**
  A store miss has three outcomes, not one. Empty disk → exit 1, loud. `continue_
  conversation` → silent fresh start (we do not use it). **Warm disk → the CLI finds
  the transcript locally and resumes from it, and the store is never used at all.**
  If D14 kills a container and restarts it on the same volume, P1 *and* the
  acceptance run can pass green with a completely broken `SessionStore`. That voids
  acceptance criterion 1 — the whole point of the prototype. The adapter's own
  entry counter is the only thing that catches it, which is why it must be a real
  counter and not an inference.
- **Appended frames are non-zero.** This is the real silent-loss mode. The CLI writes
  the transcript to local disk *first* and only then emits the frame the SDK batches
  to the store; a `CLAUDE_CONFIG_DIR` mismatch between SDK parent and CLI child makes
  the mirror batcher drop every frame with nothing but a WARNING. **If the local
  write fails, nothing reaches the store at all** — "no writable disk" silently means
  "no persistence", which is why this plan removes the writable *project* directory
  and not the whole filesystem. Proved against a real `SessionStore`: with a read-only
  `CLAUDE_CONFIG_DIR` the turn returns `is_error=False`, the correct answer and empty
  stderr, while writing **0 files and appending 0 frames**. Add `os.access(dir, W_OK)`
  at worker start.
- **Frames appended > 0 *strictly before the kill*, and the resumed turn's loaded entry
  count ≥ the count at kill time.** "Frames > 0 per turn" is not enough: under the
  SDK's default batching a single end-of-turn flush satisfies it while the mid-turn
  kill has lost everything. This assertion and `session_store_flush="eager"` are the
  same finding from two directions.
- **`list_subkeys` was called and returned ≥ 1 key** when a delegation ran, or the
  SDK materializes only the main transcript and the delegation is silently gone.
- **Does the resumed turn re-issue the interrupted call byte-identically, or does the
  model re-decide?** Record the canonical-JSON `sha256` of the interrupted
  `extraction_append` arguments and of whatever the resumed turn issues. **This decides
  whether the batch ledger covers the kill path at all**, and nothing in the SDK settles
  it — `session_resume` materializes the JSONL and hands `--resume` to the CLI with no
  dangling-`tool_use` handling, so re-issue-vs-re-decide is CLI behaviour. The plan's own
  evidence points the wrong way: the content key matched **0 of 86** in the re-decide
  proxy.
  Use the forced variant above — P1 cannot borrow D15's mechanism, which polls
  `committed_batches`, a table that was to land at D6–8 and is now cut.
  **Precondition before the hash comparison is readable:**
  assert the pre-kill subagent transcript's last entry is the `extraction_append`
  `tool_use` with no matching `tool_result`. A timed kill will not reliably produce that
  state — the window is seconds inside a minutes-long delegation — and a criterion
  recorded as "unexercised" passes go/no-go while deferring the answer to D15, which is
  exactly what this exists to prevent.
  If it re-decides, `args_hash` differs, `tryClaimBatch` returns no hit, and D15's
  assertions that `tryClaimBatch` hit exactly once and that the replayed result is
  byte-identical, D16's re-run, and acceptance criterion 6 all fail — for a
  reason already declared out of scope. **Branch:** on re-decide, the
  ledger's residual value — folding an SQS redelivery of an already-committed turn — is
  **itself unmeasured**, since that
  replays the same prompt against a complete transcript and whether the model re-issues
  byte-identically is the same coin this branch has just called against. Record it as an
  open question, not a retained benefit. **So on a re-decide answer the branch is to
  cut, not to keep:** drop the batch ledger from D6–8, the ledger exercise from D15 and
  the HTTP re-run from D16 — about a day and a half back, schedule ~22 — and replace criterion 6
  with P1's measurement reported as a finding. **Criterion 4 is unaffected** — it reads
  logged durations, never the ledger. Spending a day and a half on a mechanism whose
  only remaining benefit is unmeasured fails this plan's own scoping test. Finding that on day 2 is what makes the cut available; finding it at D15 means the
  ledger day and the dispatch extraction are already spent. **Taken 2026-09-10:
  re-decide.** The ledger, the D15 exercise and the D16 re-run are cut; criterion 6 is
  the measurement above.
- The resumed message list is accepted — i.e. a transcript ending on a `tool_use`
  block with no matching `tool_result` does not get rejected.

**If mid-delegation resume fails but between-delegation resume works:** checkpoint
at `Skill` and `Agent` launch via a `PreToolUse` hook. **The corpus only partly
supports it.** On the honest launch-only rule the segments are n=947, p99 1488 s, with
the longest at 3147 / 2515 / 2310 / 2149 s — four above the ceiling that the
hook cannot make completable, because a `PreToolUse` hook fires at launch and half the
boundaries in the naive count were return-side. Costs about a day, and buys less than
the withdrawn figures implied.

**If cross-process resume fails outright:** stop persisting the transcript and make
the research document the durable unit. One worker owns a turn; a kill loses the
turn; a sweeper re-enqueues from the last committed `research_append`. Conversational
continuity is lost, research is not. Cheaper to build than the transcript round-trip,
and arguably the stronger ARB answer: *what we guarantee is the research, not the
conversation.*

### P2. Does removing the filesystem cost research quality? (day 2, unattended, ~$8)

**Harness half landed 2026-09-10 (PR #2406):** `--deny-shell` and `--deny-project-reads`
on the e2e harness, exposed as `DENY_SHELL=1 DENY_PROJECT_READS=1` on `make e2e-run`,
with the predicate below and 41 unit tests. **Measured 2026-09-10 on rejnic-burial,
three valid runs, all with the shell denied:** the control (no predicate) came back
fail / recall 0.0 / proof quality 2 at $7.79 and 54 minutes; the treatment (predicate
on), twice: pass / 1.0 / 2 at $7.20 and 44 minutes, with three reads denied
(`research.json`, the tree, a `check-warnings` file) and the agent continuing through
`research_query`, and fail / 0.0 / 2 at $10.11 and 71 minutes with no file read
attempted. The July baseline was pass / 1.0 / 2. The verdict tracks whether a run
searches the FamilySearch Find a Grave index, which one treatment run did and neither
of the others; proof quality is 2 in all three. **Criterion 5 holds at n=3: no
measurable quality cost from removing project reads, and no run stranded on a spill
file** (two spill reads succeeded under the predicate; a spill `Read` failed and the
agent recovered through `Grep` in both unfixed arms, with or without the predicate). A
first treatment arm was void: it recorded zero path denials while reading
`research.json` twice, because macOS hands the harness its workspace as
`/var/folders/...` and the model reads `/private/var/folders/...`; the predicate now
compares `realpath`s (PR #2406). The runlogs stay out of the corpus: they carry the deny
flags, and the e2e panel would read the last of them as the fixture's state.

Run one fixture on the **current** stack with `Bash` denied and `Read`/`Grep`/`Glob`
restricted by the path predicate below, and compare the judge verdict against a
**same-day control run** with the same `Bash` deny and no path predicate — not against
the committed result, which predates weeks of skill and judge edits on every candidate
fixture, so a delta against it is not attributable to the predicate. About $4 a run on
rejnic-burial.

**`Bash` is only partly denied on the e2e path today.** The orchestrator passes no
`disallowed_tools`; under `dontAsk` the harness's CLI refuses any command outside its
read-only classifier (seven corpus denials: `python -c`, heredoc writes, `claude mcp
list`) and auto-approves the rest — the corpus carries an executed
`ls <ws>/research.json`. Closing that read-only gap is a half-hour build item for P2,
not a toggle; the only whole-tool deny in the repo is the unit harness's
`DISALLOWED_BACKSTOP`, and the e2e `pretool_hook` is the per-call prior art. Pick a
fixture with no `provided-documents/` directory (rejnic-burial, anders-monsen-ancestry,
spriggs-parents-1898 qualify): a fixture that
ships captures tells the agent to `Read` them, and the predicate would deny that and
manufacture a failure.

**Deny by path predicate, not by tool name, and state the predicate as globs.** A
blanket `Read` deny is wrong in both directions — the corpus contains substantial reads
of skill `references/` and of `results/` sidecars, neither of which is project state and
neither of which any MCP tool can serve today. Blanket-denying them manufactures a
failure that says nothing about the real change. And "deny the project directory, allow
the sidecars" cannot hold, because **sidecars live inside it** (`join(projectPath,
"results")`). So, explicitly:

- **deny** `<project>/**` **except `<project>/.claude/**`** — the whole project
  directory, because that is what the prototype removes. Denying only `research.json`
  and the tree models a strictly weaker condition than the design creates, so the probe
  would pass while the real run breaks.
- **allow** `<project>/.claude/skills/**/references/**` and
  `$CLAUDE_CONFIG_DIR/projects/**/tool-results/**`, with the root defaulting to
  `~/.claude` — the harness never sets `CLAUDE_CONFIG_DIR`, so taken literally the glob
  matches nothing and strands every spill read.
- A `Grep`/`Glob` call with no `path` means the project root and is denied; the corpus
  has 80 such `Glob` calls.
- Compare `realpath`s, never spellings: a symlinked workspace (`/var/folders` versus
  `/private/var/folders` on macOS) voided the first run.

**The plugin is a separate read-only root only in the prototype's container layout.**
On the current stack the e2e harness stages all 28 skills *inside* the project — of the
1,025 `references/` reads, 1,008 sit under the run's own `projectPath`, 1 outside it,
and 16 are in runs whose logs record no `projectPath` at all — so a
`<plugin>/skills/**` allow glob matches nothing and a bare `<project>/**` deny takes
every reference read with it. Hence the `.claude/` carve-out above.

**The two stacks spill to different places, and P2 runs on the old one.** On the
current stack every oversized-result spill lands under
`~/.claude/projects/<key>/<session>/tool-results/` — 739 reads across 66 of 161 runs,
and **zero** corpus paths contain `claude-resume`. That tree only exists on a *resumed*
turn, which is a prototype-only shape. Allow-listing `$TMPDIR/claude-resume-*` during
P2 would match nothing, deny every spill read, and strand the agent — manufacturing the
exact failure this predicate exists to avoid. The `claude-resume-*` glob belongs only
in the prototype's own predicate. And the current stack's CLI is **2.1.139** (the
harness SDK 0.1.81 bundles and prefers it; no committed runlog carries a CLI version),
so the spill behaviour P2 measures is 2.1.139's, not the pinned 2.1.220's, and the
write-up says so.

**Three** read classes disappear with the project directory. **Two of them have no MCP
tool at all** — `evaluations[].file_path` verdict bodies and `<project>/uploads/**`.
The third, `<project>/results/**` (226 reads), is **already served host-side**:
`record_read({recordId, resultsRef})` and `rank_search_matches({resultsRef})` both take
the handle, and `search-records/SKILL.md` already says "Do NOT `Read` the sidecar file
yourself" — so those 226 reads measure non-compliance with a shipped instruction, not a
gap.

**The first unserved class is `<project>/uploads/**`.** `POST /api/sessions/{id}/files`
writes into it and is the only way bytes enter a session; `image_read` and
`image_transcribe` take an `imageId`/`ark`, never a path. With `/project` empty and
read-only the prototype silently removes a shipped capability.

**The second is `<project>/evaluations/**`.** The gate itself survives — `research_query` filters `evaluations` by
`target_id` and `focus` and returns whole untouched entries, so the freshness check is
reachable too — but the **verdict body is not**: those live in the file, and `evaluations[].file_path`
is a required schema field. The documented fallback is to re-invoke `@plugin:gps-mentor`,
so every gated transition becomes a redundant paid delegation rather than a blocked
one. Correct, and expensive. 64 corpus reads target `<project>/evaluations/**`.
**And the gate itself is a filename glob**, not a query: `research/SKILL.md` says to
check `evaluations/` for a `proof-critique-<ps_id>-*.json` and for a
`<focus>-<target_id>-*.json` newer than the target's last change — two instructions
against a directory that will not exist, in a skill whose `allowed-tools` are only
`validate_research_schema` and `research_query`. Both sites must be rewritten to
compare `research_query({section:"evaluations", targetId, focus})` timestamps. Same
"the grant alone is inert" shape as `gps-mentor` below; add both to the D6–8 site
list.

**The reproducible counts**, over 161 runs and 4,950 `Read` calls, **matching on paths
normalised with `\` → `/`**: **1,025** under `**/references/**`, **226** under
`<project>/results/**`, **739** under `**/tool-results/**`, **64** under
`<project>/evaluations/**`. The normalisation is load-bearing, not cosmetic — a
posix-only matcher silently drops every Windows-path run and gives 608 / 173 / 678 / 51
instead. Earlier drafts quoted 816, 1,254 and 866; none reproduces under either rule.
One hour.

This exists because **"the agent never touched a project file" is satisfied by the
agent failing to read them.** Of 374 `Read` calls across the 24 most recently captured runs, 94 hit `research.json`
and 65 hit the tree. Without this probe the acceptance criterion can pass with a
materially worse agent. It also fires the oversized-tool-result experiment for free.

**Two corrections on the spill, both from live probes.** Above a 50,000-char cap the
CLI hands the model an absolute path and a 2 KB preview and **nothing else** — the
pinned CLI emits no `jq`/`grep`/`Read` suggestion, so there are no instructions to
lose, which is worse than having them. And on a **resumed** turn the spill lives inside
the `mkdtemp` tree the SDK rmtrees when the turn ends — so since every turn after the
first is a resumed turn, **every spill has a one-turn lifetime**, and its randomly named
path survives only as a dead absolute path in the transcript the next turn replays.
That is why the spill is a **measured** outcome — FamilySearch question 4, and P2's
second pass criterion — and not something a read tool can restore. If a path predicate is used anyway, it must name
`$TMPDIR/claude-resume-*/**/tool-results/**` — not `$CLAUDE_CONFIG_DIR`, which receives
nothing on a resumed turn.

**Pass:** judge verdict within noise of the same-day control, and the agent does not
strand itself on a spill file. **If it fails:** `sidecar_read` (already scheduled at
D6–8) does not answer it — the tool covers verdict bodies and text uploads, not the
spill. Re-scope from whichever dimension regressed. The site list below is kept because
D6–8 references it: the tool file, `tool-schemas.ts`,
an `index.ts` arm, `manifest.json`, a `dev/try-*.ts` smoke script, a `docs/specs/`
entry, a `README.md` catalog row, **both of `README.md`'s stated tool counts**, and
`tests/tools/sidecar-read.test.ts` — the 126 vitest files are this plan's regression
gate, so a tool without one erodes it. (`docs/architecture.md` also names an
`eval/fixtures/mcp/` fixture if a *skill* calls the tool; none does here — only the
`gps-mentor` agent — so state that rather than leaving it open.) The packaging suite enforces the schema, the
dispatch arm, the manifest, the README row and the README's stated count; the `dev/` script and the spec entry are
`DEVELOPMENT.md` rules with no check behind them. **Two further sites that nothing will
flag if you skip them**, both named in `docs/architecture.md`: catch `NoProjectError`
and return `noProjectResult()`, adding the tool to the hand-maintained `CALLS` array in
`tests/tools/no-project.test.ts`; and, if it signals by return value,
`OK_FALSE_IS_FAILURE` in `src/tool-result.ts` plus its `OK_FALSE_IS_FAILURE_LIVE`
mirror in `eval/harness/harness/mock_mcp.py`, whose intersection a drift lint pins.

**`sidecar_read` is scheduled, not contingent — D6–8, a day and a half.** It exists for
the two classes that genuinely have no tool: `evaluations[].file_path` verdict bodies
and **text** uploads under `<project>/uploads/**`. Not `results_ref` sidecars — already
served host-side (see above), and **not the spill**, which no read tool can serve
because the bytes are rmtree'd at turn end and, after D16, live in a different container
from the tool server. The spill stays a *measured* outcome, not a restored capability.

### P3. Bedrock feature parity (**days 1–2, ungated**)

**Moved forward, and the gate removed.** This is the second unknown that can invalidate
build work, and its old placement at day 16 meant discovering it after everything was
built against it. It needs the CLI, the plugin, the engine and an `ANTHROPIC_MODEL` set
to a Bedrock inference-profile id — not the store, the queue or the web tier. (Under
`CLAUDE_CODE_USE_BEDROCK` the CLI already resolves its own default to a region-prefixed
Bedrock id, Opus 5, so the pin is what selects Sonnet 4.6 for the cost figures, not what
makes Bedrock run. Pin the full id, never the `sonnet` alias, which resolves to Sonnet 4.5
on Bedrock. P3 sets it for its own run; D9–10 pins the same id in the worker env.)
Its old gate ("on the quota answer") does not bind either: one session at the measured
rate sits well inside a default TPM allowance. Only the concurrency/quota half stays at
D16. **Access is already granted**: on 2026-09-10 a one-token `converse` on
`us.anthropic.claude-sonnet-4-6` in `us-east-1` returned, so no form stands between P3
and its run.

**Go/no-go:** if Bedrock rejects the tool-search beta or does not honour the 1-hour TTL
with the flag below set, the prototype runs on the Anthropic API and the Bedrock answer
becomes a **written finding** rather than a build target. That is a better outcome than
a green prototype measured on a path production will not use.

**Measured 2026-09-10 (PR #2406, `make probe-bedrock-parity`, four arms, $0.99): the
go/no-go passes and Bedrock stays the build target.** Tool search is on and deferred on
Bedrock direct (`ToolSearch` in the init tools, MCP names absent, called once per arm,
`convert_calendar` reached). The 1-hour TTL is honoured behind the flag: the 1h arm
wrote 29,114 tokens as 1h cache and re-read all 29,114 seven minutes later, while the
default arm re-read only the 11,994-token shared prefix. Interleaved thinking appeared on
every Bedrock arm. The 1M context is accepted through the `[1m]` model suffix
(`contextWindow` 1,000,000, the beta re-sent in `body.anthropic_beta`). Server-side
context management is on the wire for the first-party control only, never on Bedrock,
which confirms the gate above. Wire facts come from the CLI's own debug log, which
records betas only at `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose`.

**The production path is not Bedrock direct (answered 2026-09-11).** The Agent
Gateway is Anthropic-Messages-compatible — agentgateway v1.4.1, `POST
/bedrock/v1/messages`, Messages→Converse and back including streaming and errors,
read from upstream source at the pinned tag; one curl against integ settles it, and a
miss is a three-line route addition. So the SDK runs unmodified with
`ANTHROPIC_BASE_URL` at the gateway and `CLAUDE_CODE_USE_BEDROCK` unset. On that path
the CLI believes it is talking to Anthropic, so none of the Bedrock stripping above
applies — and the CLI's own tool-search gate for a foreign base URL, read off 2.1.220 on
2026-09-10 as "off unless the host is `api.anthropic.com`", turned out on measurement to
fire **only when `ENABLE_TOOL_SEARCH` is unset**, which neither the prototype set nor
the hosted set leaves unset. What Messages→Converse loses is the open question: the
cache TTL (R2), tool-name rewriting, the thinking and beta headers, `count_tokens`
(falls to passthrough).
**P3b — measured 2026-09-11 (`make probe-gateway-path`, five arms through a local
passthrough proxy to `api.anthropic.com`, $0.86; code in PR #2406).** With
`ENABLE_TOOL_SEARCH=true` behind a non-Anthropic base URL, tool search is on: 26 init
tools as on first-party, `ToolSearch` present, no MCP name eager, first-call tokens
within 14 of the control. With it unset the gate fires as the code says: 73 tools in
the init list, 48 MCP names eager, the first call 71,524 tokens against 28,722 (+149%),
the arm 2.2× the control's cost. `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` is the
CLI's own escape and also works. On the wire the prototype set sends no `cache_control`
ttl (the API's 5-minute default) and no extended-cache-ttl beta; with
`ENABLE_PROMPT_CACHING_1H=1` every block carries `ttl: "1h"`, the beta is sent, and
usage reports the writes as 1 h — on an API key that flag is the only way to 1 h, since
the OAuth allow-list default never applies. **What a Messages gateway must pass
through for parity, read off eleven proxied calls:** the `advanced-tool-use-2025-11-20`
beta and the `tool_reference` content blocks tool search re-injects; `cache_control.ttl`
with the extended-cache-ttl beta if we set the flag (moot through this gateway, which
drops the ttl); the seven betas every call carries (advisor-tool, claude-code,
context-management, effort, interleaved-thinking, prompt-caching-scope,
thinking-token-count); a second model ID — every session opens with one
`claude-haiku-4-5-20251001` call for the session title, carrying
`structured-outputs-2025-12-15` — and a `HEAD /api/hello` with no auth header. The proxy shows what the CLI sends, not what agentgateway keeps: that
half is one curl against integ.

**Four unknowns — context management, the 1-hour TTL, whether Bedrock accepts the
body betas, and whether the engine survives a refusal. The first is settled by reading the
pinned CLI and confirmed from its debug log, never measured against Bedrock; the other
three are measured.**
Server-side context management (named twice in the architecture document as the
mitigation for conversation growth) is off on Bedrock in 2.1.220 by the CLI's own gate
— the beta is pushed only for first-party-class providers, and the env switch that
would enable it is dead code. The generic `ANTHROPIC_BETAS` override does force it onto
the wire, as a header plus a `context_management` body field, and nothing shows Bedrock
accepting it — confirm the gate from the CLI's debug log, do not measure it, and do not
set that override in the worker env. The 1-hour prompt-cache TTL on Bedrock is **opt-in
behind `ENABLE_PROMPT_CACHING_1H_BEDROCK`**;
the OAuth allow-list that gives first-party SDK sessions 1 h never applies there, and the
extended-cache-ttl header is never sent. A default-env run reports "unavailable" when
the answer is "behind a flag", so run both arms, and the D9–10 worker env carries the
flag. Only a second turn after a wait longer than five minutes proves the TTL is
*honoured* rather than echoed: expect `cache_read_input_tokens > 0` under the flag and
near zero without it. 96% of cache-creation tokens in the corpus are 1 h writes, and the
4.6× cost multiplier rests on it — but see the corpus cache-window measurement under
R2: on the autonomous corpus a 5-minute TTL loses 0.4–0.5% of cache reads, 1.5–1.7% of
run cost, and the corpus's own 1 h writes came from the operator's subscription, which
production on an API key never gets without the flag.

The last two are real measurements. The CLI does not strip features on Bedrock; it
moves interleaved thinking, the 1M-context beta and **tool search** (on in production
today, and `ToolSearch` is the third most-called tool in the corpus) out of the
`anthropic-beta` header and into `body.anthropic_beta`, and the tool-search gate has no
Bedrock arm at all. What is open is whether Bedrock *accepts* those body betas for the
chosen model. Read the wire list off the CLI's own debug log (`extra_args`'s
`debug-file`) rather than inferring it, and record whether the engine still works
without whichever Bedrock refuses.

---

## Schedule

### Week 1 — probe and seam

- **D1–2** P1, five variants including the forced stop in both arms: seven assertions
  plus the re-issue-vs-re-decide measurement. Go/no-go on the seven. **Done 2026-09-10:
  all five passed, branch re-decide** (see P1).
- **D1–2 (parallel)** The agent/skill registration probe: `plugins=[…]` **and**
  `agents={…}` **and** `setting_sources=[]` together — six agents resolving under
  which spelling, and all 28 skills resolving. A zero-token handshake on 2026-09-10
  already showed this option set registers all six under both the bare and the
  `genealogy-research:` spellings, and all 28 skills as `genealogy-research:<skill>`
  entries under `commands` — there is no `skills` key, and agent entries carry `name`,
  `description` and `model`, never `tools` or `prompt`, so the handshake cannot show
  what an agent binds. **Done 2026-09-10:** `image-reader`, delegated to by bare name
  under `agents=`, replied PONG (`make probe-registration`, $0.13); the loader lives at
  `apps/server/dev/p1/plugin_agents.py`. The probe belongs here by
  the plan's own logic for moving P3: it needs only the CLI, the plugin and the engine,
  and it can invalidate build work. Before the handshake, `setting_sources=[]` alongside
  `plugins=[…]` was a combination nothing in this repo had run, and its failure mode
  would have forced either staging skills inside `/project` or
  `setting_sources=["project"]`; the handshake retired that, and the billed
  delegation and the parser closed it.
- **D1–2 (parallel)** Confirm `disallowed_tools=["Bash"]` actually denies under
  `bypassPermissions` on the pinned pair. Record the result in the write-up. **Do not
  widen `_KNOWN_GOOD_SDK_RANGE`** in the harness: `eval/harness/pyproject.toml` caps it
  at `claude-agent-sdk<0.2`, so it can never install the pinned pair and the constant
  would record a fact its own check cannot evaluate — and the harness is not ported.
  Twenty minutes, and it is acceptance criterion 3's only mechanism. **Record which way
  it denies** — whether `Bash` is removed from the advertised pool or refused at call
  time. Criterion 3 reads differently under each: under a call-time deny a blocked shell
  attempt still logs a `Bash` call, which would red the criterion even though the
  mechanism worked. **Measured 2026-09-10: pool removal** — `Bash` is absent from the
  init tools list under `disallowed_tools`, and the call-denied arm emitted no `Bash`
  call (`make probe-bash-deny`, three sessions, $0.23).
  **Run
  `make probe-agent-binding` here too, not at D15** — not because `docs/architecture.md`'s
  CLI-or-SDK-moves rule binds (nothing moves; see D15), but by this plan's own reasoning
  for hoisting the registration probe: discovering a binding failure at D15 puts D9–D14
  on a wrong option set. **The CLI is pinned by the SDK wheel, not by what you install.**
  `_find_cli` returns the bundled binary before any PATH lookup, and SDK 0.2.128 bundles
  **Claude Code 2.1.220** — so the pinned pair is 2.1.220 / 0.2.128, installing 2.1.251
  in the worker container is a no-op, and overriding it needs
  `ClaudeAgentOptions.cli_path`. Record the version at worker start from
  `claude_agent_sdk._cli_version.__cli_version__`, never from `claude --version`, which
  reads a system binary the SDK never spawns — and is where the repo's `2.1.251` came
  from. The 2026-08-30 run already spawned 2.1.220, so this re-run records the version
  correctly rather than re-measuring after a downgrade: add the print, then fix the eight
  citations. The probe as shipped measures the hosted option set (`stage_plugin_agents`
  plus `setting_sources=["project"]`); add a switch so its six arms also run against the
  prototype's (`agents=`, `setting_sources=[]`, `plugins=[…]`), which is the set D9–D14
  run on. **Done 2026-09-10:** twelve arms, hosted and prototype identical — control
  CALLED, deny and omit BLOCKED, tool search off and on — with the version printed as
  2.1.220; the eight citations are corrected in PR #2406.
- **D1–2 (parallel)** P3's feature-parity half, ungated — tool search, and the 1-hour
  cache TTL under both flag arms; context management is confirmed off from the debug log,
  not measured. Its own go/no-go: if Bedrock rejects the tool-search beta or does not
  honour the 1-hour TTL under the flag, the prototype runs on the Anthropic API and
  Bedrock becomes a written finding. Taking it here is what lets D16 be cut without
  losing the answer. **Done 2026-09-10:** every question answered in Bedrock's favour
  (see P3); Bedrock stays the build target.
- **D2** P2 in parallel, unattended. **Harness ready 2026-09-10** (PR #2406:
  `DENY_SHELL=1 DENY_PROJECT_READS=1` on `make e2e-run`, 32 unit tests); the two runs
  are pending.
- **D3 (half day)** Standalone Beanstalk worker probe in the personal AWS
  account: a hello-world worker that sleeps 25 minutes. Answers the sqsd contract,
  `inactivity_timeout` behaviour, the 512 MB source-bundle cap and the
  `.ebextensions` prefix rule — the platform constraints that shape the step model and
  that docker-compose cannot show. Not the full AWS deploy, which stays cut.
  **Done 2026-09-11 (PR #2455, `apps/server/proto/eb-worker-probe/`; deployed in
  `us-east-1` on a t3.micro, Ready in 4.5 minutes, torn down after).** What sqsd
  3.0.5 actually does: it POSTs `/` as `application/json` with `X-Aws-Sqsd-Msgid`,
  `-Receive-Count`, `-First-Received-At`, `-Sent-At`, `-Queue`, `-Path` and
  `-Sender-Id` (a message attribute was not forwarded as an `-Attr-` header, n=1). A
  1500 s handler under `InactivityTimeout` 1800 completed: one delivery, 200, queue
  empty. Under `InactivityTimeout` 300 sqsd cut the connection at exactly 300 s
  (`socket-err … Errno::ETIMEDOUT - 300.003`; nginx logged 499), **the worker was never
  told** — it found the peer gone only when it wrote its reply at 1500 s — and sqsd did
  **not** release the message: it stayed invisible and came back exactly 2100 s after
  its first receive, as receive 2 with `First-Received-At` preserved. So the dead time after a forced checkpoint is
  `VisibilityTimeout − InactivityTimeout`, five minutes at 2100/1800; set the visibility
  timeout just above the ceiling. The worker tier always creates a dead-letter queue
  and `MaxRetries` governs it, so "no redrive policy" is not available there. A
  configuration-only `update-environment` took 78 s, restarted sqsd and left the app
  process running. API option settings override the same option in `.ebextensions`.
  nginx sits between sqsd and the app with a 60 s `proxy_read_timeout`; the bundle's
  `.platform` override to 36000 s was required, or nginx cuts first. The 512 MB bundle
  cap and the `.ebextensions/*.config` rule are documented and were not exercised.
- **D3** docker-compose skeleton: postgres, **elasticmq** (SQS API — not RabbitMQ,
  whose semantics differ and whose client code you would throw away), **minio**, and
  an **sqsd shim**. **Run the shim as its own compose service with the docker socket
  mounted, separate from the worker** — the topology has to be written down because
  two mechanisms depend on it: D14's kill must not take the shim down with it, and a
  whole-container loss must still redeliver.
  A co-located shim dies with the worker it is meant to supersede, and nothing then
  issues `ChangeMessageVisibility(0)` — every iteration would wait out a
  `VisibilityTimeout` set above the step ceiling.
  Give the worker service `restart: unless-stopped` — D14 kills the container, and every
  subsequent redelivery needs a worker to POST to.
  It **keeps N POSTs in flight** (real sqsd's `HttpConnections`) and the worker handles
  concurrent POSTs, so a patron follow-up is received while a turn is running rather than
  serialised behind it. The shim polls the queue, POSTs the body to the
  worker's HTTP handler, and acts on the POST outcome, since the worker is an HTTP handler and never
  holds the ReceiptHandle. **Three cases:** **2xx → delete** the message (this is what
  makes turn completion durable); **connection-level failure** (reset or refused, which a
  killed worker produces) **→ `ChangeMessageVisibility(0)`** so it redelivers immediately;
  **any other non-2xx → `ChangeMessageVisibility(0)` with back-off**, treated as a crashed
  turn — without it a 500 sits invisible for the full `VisibilityTimeout`. Set the read
  timeout at the step ceiling and no lower (a shorter one reads a legitimately long turn
  as a dead worker) and back off between retries. **The ceiling is enforced by that read
  timeout plus the container kill**, which is a property to observe rather than a
  mechanism to instrument: an earlier draft grew this to five arms, a `ceiling_kills`
  table and a Postgres client in the shim, all of it serving an automated assertion this
  plan no longer makes.
  Write the Postgres schema. Set `VisibilityTimeout` well above the step ceiling, and
  **configure no redrive policy at all** (on Beanstalk that choice does not exist — the
  worker tier creates a dead-letter queue and `MaxRetries` governs it, measured
  2026-09-11 — so the compose stack honours it and production sizes `MaxRetries`).
  `ChangeMessageVisibility` does not reset the
  receive count, so a container restart burns several receives on the requeue arm alone,
  and sizing `maxReceiveCount` against "two or three forced checkpoints" would
  dead-letter a legitimately long turn. **With no redrive policy a message that fails on every delivery
  retries indefinitely with back-off.** At n=1, with a patron watching an unanswered
  browser, that is an acceptable failure mode and a visible one; the logged tool-call durations make a looping
  call visible in the run output; nothing catches a message that makes the worker 500 on
  every delivery. A production
  deployment needs a redrive policy sized on receive counts, not on forced checkpoints. **Pin the step ceiling to 1800 s** and treat it as immovable:
  AWS permits 1–36,000 s, and leaving it open makes this a demo rather than a test.
  **Done 2026-09-11 (PR #2455).** Five services under `apps/server/proto/`; `make
  proto-smoke` passes all four cases (ok, fail with 5/10/20 s backoff, worker crash and
  restart, a 60 s turn under a 15 s ceiling override killed and redelivered); 46 offline
  tests pin the topology. One finding the real build keeps: a shim that exits mid
  long-poll leaves the receive open, and the next message sits invisible for the full
  visibility timeout — the shim drains on SIGTERM, requeues what the poll delivered,
  and `stop_grace_period` is pinned above the poll. The schema written here carries no
  `committed_batches`.
- **D4–5** `ProjectStore` interface + `FsProjectStore` + close the filesystem leaks +
  the import lint. **The port is 11 files, not 48 tools** — eleven modules import
  `fs`: four are leaks in tool files that should route through the utils
  (`person-warnings`, `rank-search-matches`, `research-append`, `research-log-append`),
  four are utils (`image-store`, `name-variants`, `project-io`, `results-staging`), two
  are auth, and the eleventh is the validator. `name-variants.ts` reads a bundled data
  file, not project state, and sits on the lint's exemption list beside `auth/config.ts`.
  Move today's bodies verbatim behind the interface; that keeps all 126 vitest files
  green as the regression gate for everything after.
  **`ProjectStore` exposes a transaction scope** — `withTransaction(fn)` — because the
  Postgres advisory lock on D6–8 requires the read, the validate and the write to share
  one connection. Designing it in on D4–5 is free; retrofitting it on D6–8 is not.
  **`src/validation/validator.ts` is the eleventh module and needs naming explicitly.**
  It imports `readFile, readdir` and resolves `research.json`, `tree.gedcomx.json` and
  every `results/` sidecar off `projectPath`. On the Postgres backend it would read
  files that do not exist, and `validate_research_schema` runs on every writer path —
  so a missed port here fails every write, not one tool. Give `validateProject` a
  store-backed reader, and name it in the lint's exemption list either way.
  **Done 2026-09-11 (PR #2495).** `src/store/`: a twelve-method `ProjectStore` keyed on
  `(projectPath, ref)` with `withTransaction`, and `FsProjectStore` carrying the bodies
  verbatim; the utils delegate; `atomicWriteJson`, `atomicWriteBoth` and `fileExists`
  take a project-relative ref (18 call sites in 7 tools, each a compile error until
  ported); the validator reads through the store rather than sitting on the exemption
  list, so the lint exempts four files, not eleven — the store, the two auth files and
  the bundled-data reader — and fails when an exemption stops being needed. A 16-case
  conformance suite waits for the next backend. All 129 vitest files green at the time
  (3,307 tests).
- **D5** the auth seam: `getValidToken(subject)` type change. The edit surface is
  larger than the `src/` count suggests — 33 further invocations in 27 files across
  `dev/` and `tests/` (the `vi.mock` stubs in `tests/` stay type-valid under a parameter
  addition), all inside `tsconfig.typecheck.json`, which `pretest` runs, so a red
  typecheck blocks `npm test` and with it the regression gate this plan leans on. Budget
  the full day and re-cost if `dev/` turns out to be the bulk.
  **Sequencing against open PRs (as of 2026-09-10):** the validator port collides with
  PR #2354 (the settled-conflict validator rule), the auth seam with PR #2338
  (`fetchWithRetry` at every network call site — 13 of the 16 token call-site files),
  the D6–8 tool counts with PR #2397 (the external-search-URL
  tool), and the worker loop and D15's `map_message` edit with PRs #2371 and #2348 on
  `real_agent.py`. None is merge-ready; rebase after they land or get a ruling before
  starting the day. **Re-checked 2026-09-11:** PR #2354, PR #2338 and PR #2348 have
  merged, so D4–5 start from current `main` with no ruling needed; PR #2397 (tool
  count 49→50) and PR #2371 (mid-turn `user_msg` queueing in the runner) are still
  open and collide only with D6–8 and D13–15.
  **Done 2026-09-11 (PR #2495).** Named `principal`, not `subject` — "subject" is the
  research subject everywhere in the code. `getValidToken(principal)`, the config
  getters and `saveConfig` take it; 27 tool entry points take it last; `src/index.ts`
  binds `LOCAL` once per request; a bearer principal is used as given, never refreshed,
  never persisted, and turns the four desktop session tools into answers. The re-cost
  warning came true in `tests/`, not `dev/`: 636 call sites in 83 files took the
  argument by codemod and typecheck caught the six the codemod missed. A stdio smoke
  (`make engine-smoke-stdio`) now drives the built server through the dispatch chain
  no vitest imports, including `project_create` and `tree_forget`.

### Week 2 — the durable core

- **D6–8** `PgS3ProjectStore`: jsonb documents, S3 blobs, and the **staging index in
  Postgres, not an S3 LIST** — staging sits on the return path of the most-called
  tool. **`pg_advisory_xact_lock` on the project id** in the Postgres backend (see
  Locking above); the file backend keeps its in-process mutex.
  **The turn-scoped batch ledger — cut 2026-09-10 (P1 measured re-decide); kept for
  the record through "measurably near zero":**
  `committed_batches(project_id, turn_id, tool_name, args_hash, applied_at, result_json)`
  with a unique index on the first four, written **inside the document write's
  transaction** and therefore under the same advisory lock. `ProjectStore` gains
  `tryClaimBatch` / `recordBatch`. **There is no writer dispatch to hook, and it is nine
  tools, not five.** `src/index.ts` is a flat chain of 48 `if (request.params.name ===
  …)` arms; `writerToolResult` is a result formatter, not a seam. The state writers are
  `research_append`, `extraction_append`, `research_log_append`, `tree_edit`,
  `tree_correct`, `materialize_facts`, `merge_tree_persons`, `tree_forget` and
  `project_create`. (**Six** more tools write under the project and are **not** in that set: `image_read`/`image_transcribe` overwrite `images/<key>.jpg` in place by
  filename, so a replay is harmless; but `rank_search_matches` **appends** to
  `results/match-scores.jsonl`, and `record_search`/`fulltext_search`/
  `external_links_search` stage under a **fresh UUID per call**, so a replay duplicates
  score-log lines and orphans a staging file — which `unloggedStagedSearches` then
  reports as an unlogged search on a correct system. Decide whether `rank_search_matches`,
  `record_search`, `fulltext_search` and `external_links_search` join `WRITER_TOOLS`, or
  whether the orphan is accepted, and say which.) Add a `WRITER_TOOLS` set naming those nine and extract the arms
  into a `Record<string, handler>` dispatch table (or wrap the nine explicitly), and
  **take `tryClaimBatch` on the OUTER tool name** — `extraction_append` delegates to
  `researchAppend` and `tree_correct` to `executeTreeOps`, so keying inside the shared
  core would collide two distinct tools.
  `args_hash` is `sha256` of canonical JSON with `projectPath` removed, sorted keys, and
  **no value normalisation at all** — nulls, empty arrays and array order preserved,
  since every normaliser is a place two legitimately distinct calls can be made to
  collide. **The web tier mints a `turn_id` UUID and puts it, with `project_id`, in the message
  body at enqueue.** It is **not** the SQS `MessageId`. Both are stable across
  redeliveries, but the `MessageId` is
  held only by the shim and never crosses the POST boundary, so a worker keyed on it
  could not compute its own `turn_id` at all. A body UUID needs no header plumbing and
  behaves identically under real sqsd. It **travels per-request, never read from process
  state** — stdio: env on the per-turn fork; HTTP:
  the same session header that carries the access token, and `tryClaimBatch` takes it as
  an argument. Environment-sourced works only while the tool server is forked per turn
  and breaks the day D16 lands: a shared HTTP server has one process environment for
  every turn of every patron, so every write keys under one stale `turn_id`, collides
  legitimate writes across turns, and hands back another turn's payload. Same failure
  the Auth section diagnoses for the token; apply it to both. **Never supplied by the
  model.** On a hit: write nothing, return the original call's payload verbatim.
  **Record at commit, never at receipt.** The corpus holds three runs
  (`hannah-earnest-children` 2026-08-23 #169→#185, `elena-asmundsdotter-origin`
  2026-08-25 #121→#140, `mary-mcandrew-son` 2026-08-23 #149→#166) where a
  rejected batch was repaired and re-issued byte-identically — all three the same
  `research_append {"section":"project","op":"update","fields":{"status":"completed"}}`,
  with the rejection reason recorded — and a receipt-time ledger destroys the
  successful copy of all three. Across the whole corpus there are **18** repeats under the ledger's
  own key (`projectPath` stripped) — 17 byte-identical, the 18th a run where the model
  named three different project paths — **among calls whose recorded args are
  non-empty** (13 further
  groups log `args: {}` — refusals, not writes). **14 record no tool outcome at all**
  and cannot evidence a rejection — an earlier draft cited three of those. And
  `is_error` is not a reliable outcome signal: `writerToolResult` leaves `isError`
  unset when `reason === "no_project"`, so a refused pair can read as two successes.
  That is what makes "record at commit" load-bearing rather than merely prudent. Of the four that do carry
  outcomes, three are the reject→repair→retry pattern named above and the fourth is a
  pair where both calls succeeded, an idempotent `project.update`. The ledger's
  false-fold risk is measurably near zero.
  **Update `docs/specs/research-append-tool-spec.md`'s Concurrency section** in the
  same change: it documents the in-process mutex and records "binds only within one
  MCP server process" as the residual, which stops being true for the Postgres
  backend. A live tool has a live spec; state both backends.
  Also here: **`sidecar_read`, a day and a half** (see P2) — the 49th tool, or the 50th if
  the open PR adding `build_external_search_url` lands first, serving
  `evaluations[].file_path` verdict bodies and **text** uploads under
  `<project>/uploads/**`. Image uploads are not restored — uploads are arbitrary bytes
  and the image tools take an `imageId`/`ark`, never a path — so photographed documents
  stay out of the prototype unless `image_transcribe` gains an upload key. `gps-mentor` reads `evaluations/` itself, so the site list
  includes granting it the tool in `packages/engine/plugin/agents/gps-mentor.md` in
  **all three server spellings**, which trips the `AGENT_PERMISSIONS` snapshot in
  `tests/packaging/agent-tool-names.test.ts` — one of the eight packaging stops named below.
  **And the grant alone is inert:** `gps-mentor.md` still instructs `Read` for a
  verdict body in two places, and `docs/specs/gps-mentor-agent-spec.md` repeats it in
  four. Both bodies must change, which puts five packaging tests in scope —
  `agent-tool-names`, `agent-delegation-framing`, `gps-mentor-craft-doctrine`,
  `skill-name-resolution` and `doc-links` (there is no per-agent unit suite; `eval/tests/unit/`
  holds skill directories only).
  **The ledger was a day, not half** — the dispatch extraction above was the bulk of it,
  and is cut with it. No schema change: the ledger was store state, not a `research.json` section, which keeps it off
  the four-site + `packages/schema` + `ownership.json` blast radius.
- **D9–10** Worker loop + `SessionStore` adapter + transcript hydrate/checkpoint.
  Pin `cwd`. **Do not set a per-session `CLAUDE_CONFIG_DIR` — the SDK discards it.**
  `apply_materialized_options` spreads its own override *after* `options.env`, so on
  every resumed turn (which is every turn after the first) the CLI is repointed at a
  fresh `mkdtemp` under `TMPDIR`. Size `TMPDIR` for one turn's transcript plus spill,
  not `CLAUDE_CONFIG_DIR`.
  **Set `session_store_flush="eager"`.** The default is `"batched"`, which flushes once
  per turn or at 500 entries / 1 MiB (`types.py:2100`). A SIGKILL never reaches
  `result`, and the parent's shielded `finally` flush does not run on a killed process
  group — so under the default a mid-turn kill loses **the entire turn's transcript**
  and resume restarts the turn instead of continuing it. An interactive turn is far
  below 500 entries, so the threshold never saves us. This is the single change that
  makes "progress is monotone" true rather than assumed. **Pin
  `claude-agent-sdk==0.2.128` as well as the CLI**, since the flush default is
  SDK-side.
  **Pin `ANTHROPIC_MODEL`, `CLAUDE_CODE_USE_BEDROCK` and `ENABLE_PROMPT_CACHING_1H_BEDROCK`
  explicitly here**, not at D16:
  unpinned defaults to Opus and every cost figure reported is wrong by several-fold,
  and the model pin belongs with the worker loop, which is where the first worker cost
  figures come from. Raise `max_buffer_size`. **Treat `system/mirror_error` as fatal** — the SDK drops
  that batch permanently, and its "local disk is durable anyway" reasoning stops
  being true when local disk dies with the worker.

### Week 3 — make it visible

- **D11–12** Web tier: `session_events` + `session_activity`, POST /messages,
  `GET /events?after=N`, SSE. **The worker** writes `map_message` output to `session_events` / `session_activity`
  directly — only it runs the SDK and sees the message stream, and criteria 3 and 4
  depend on those rows reaching Postgres without a hop that dies with the worker. The web
  tier only reads them for `GET /events?after=N`.
  **SSE is reconnect-and-resume by design (answered 2026-09-11):** every frame carries
  `id: <seq>`, the browser consumes with `EventSource`, a dropped connection comes back
  with `Last-Event-ID` and the server resumes from that cursor — the same read as
  `GET /events?after=N`. A `: ping` every 15 s keeps HAProxy's and DTM's inactivity
  timers (60 s at DTM) from firing. A duration cap at the edge then costs one
  reconnect, not the product. `fs-eng/bridge` runs this pattern over JetStream,
  load-tested at 100 subscribers / 50 events/s, and `fs-eng/help-research-only` raised
  its `SseEmitter` from 5 to 10 minutes because real multi-task turns were cut.
- **D13** Reuse `apps/web` with the WebSocket swapped for SSE. Plus the **80-line
  headless driver** — POST a message, poll events, assert on turn completion.
  Without it the acceptance test cannot be run until day 17.
- **D14** Kill-resume test **against the mock agent**, not a real fixture. Twenty
  debug iterations on a real run is $147 and 18 hours; the mock is ~90 s and free,
  and needs ~30 lines to fake a delegation. **Redelivery comes from the shim's
  `ChangeMessageVisibility(0)` on a failed POST** (D3), not from a shortened
  `VisibilityTimeout` — an earlier draft used a 30 s test profile, which is below the
  ~90 s mock iteration, so the message would go visible again mid-turn and — because a
  redelivery carries the same body and therefore the same `turn_id`, which the lock now
  grants immediately — a second worker would be handed the lock and start the
  same turn. The production `VisibilityTimeout` is asserted by a config
  test, not exercised in the loop. Kill the **worker container** — the shim is a separate
  service and survives to issue `ChangeMessageVisibility(0)`. Not `kill -9` on the
  worker PID, which orphans the `claude` child, which keeps
  running and makes the test pass for the wrong reason.
  **The mock carries completion only** — `mock_agent.py` writes `research.json` with
  `write_text` and emits synthetic `tool_use` events; it never calls the MCP server.
  The byte-identical tool-result and assertion-count checks that were to sit at the
  end of D15, and their receipt-time counterpart test, are cut (2026-09-10, P1:
  re-decide); the counterpart was the reject → repair → identical-retry regression
  replayed from the three corpus runs named in days 6–8, which needed no live agent.
- **D15** **Pass the six agents via `agents=`, and stop calling `stage_plugin_agents` from
  the prototype worker.**
  Probed live with the five bodies then present: all register under **bare** names with
  `plugins=[]` and `setting_sources=[]` (the 2026-09-10 handshake re-showed all six
  under `plugins=[…]`), `tools:` binds in both directions (a granted tool fires, an
  omitted one never appears), and a bogus entry still produces the verbatim
  "would be spawned with zero tools — refusing". `AgentDefinition`s travel on the
  `initialize` request and never touch disk, so the whole staging risk is deleted
  rather than asserted against — and the check becomes a `get_server_info()` startup
  precondition, before a token is billed — six bare names under `agents`, 28
  `genealogy-research:<skill>` entries under `commands`. Twenty minutes instead of an hour.
  (`agent-<id>.meta.json` records the `agentType` the runtime actually resolved, if a
  runtime assertion is still wanted.)
  **The registration probe moved to D1–2** (see Week 1) — the live probe above ran with
  `plugins=[]`, and the container layout needs the plugin on disk for its 28 skills, so
  the real configuration passes `plugins=[…]`. What remains here is the
  `agents=` switch-over and the smoke target. Keep the
  `get_server_info()` precondition either way; per the repo's own rule, a green check
  proves one configuration at one moment.
  **`stage_plugin_agents` stays in place; the prototype simply stops calling it.**
  Deleting it changes the live hosted control plane and reduces no prototype
  uncertainty. It lives in
  `apps/server/app/agent/real_agent.py` and three tests in
  `apps/server/tests/test_plugin_agents.py` call it directly, so deleting it is a
  hosted-control-plane change with a test surface. `CLAUDE.md` requires
  `make agent-smoke` when the hosted agent's configuration changes, and
  `docs/architecture.md` requires `make probe-agent-binding` when the CLI or SDK
  moves — nothing moves here; the D1–2 re-run is for the version print and the
  prototype option-set switch. `probe-agent-binding` runs at D1–2 (see Week 1);
  `agent-smoke` runs here.
  **Deny-and-log via a prototype-only `PreToolUse` hook passed on the worker's
  `ClaudeAgentOptions` (`hooks=`)**, logging every tool call to Postgres so the
  acceptance evidence is a query result rather than a claim. **Log the hook's decision
  alongside the call**, so criterion 3 can separate a denied attempt from an allowed
  read; without that column the query cannot express the criterion. **Do not widen the shipped
  hook.** `packages/engine/plugin/hooks/guard_project_files.py` also ships in the
  Cowork `.zip`, where it must stay stdlib-only and network-free — no Postgres driver
  and no egress in that VM — and widening its matcher to every tool would spawn a
  `python3` subprocess with a 20 s timeout on every call in every Cowork session. That
  is the standing rule below: a second entrypoint, never a replacement.
  **Log every tool call's duration** (the `PreToolUse` hook already writes a row; add the
  duration) and read them in the run output. No automated ceiling assertion, no
  `ceiling_kills` table, no two-direction proof — see the step model for why that
  scaffolding was cut.
  **Cut 2026-09-10 (P1: re-decide) — the closing half-day was the ledger exercise on
  the stdio configuration, gated on P1 coming back "re-issues byte-identically"; kept
  for the record:**
  **Mechanism: hang after commit.** A debug-env branch in the tool server holds the
  `extraction_append` response open once the `committed_batches` insert has committed;
  the harness kills the **worker container** (a bare `kill -9` on the worker PID orphans
  the `claude` child), the shim's failed POST triggers `ChangeMessageVisibility(0)`, and
  the turn resumes. No `tool_result` can have reached the store because none exists yet,
  so the window is commit-conditioned by construction and works identically over stdio and
  HTTP. A *timed* kill cannot test this: if the write never committed there is no ledger
  row and `before + 1` is the correct answer.
  Drive it with a scripted single-record turn against a one-record fixture, not a full
  research run. Assert the `committed_batches` row exists, `tryClaimBatch` hit exactly
  once on the resumed turn, no assertion id was allocated twice, and the replayed result
  is byte-identical to the first — the ledger's stated contract, asserted nowhere else.
  It was to precede the D16 swap, which was to re-run it over HTTP with `turn_id` from
  the session header instead of the environment.
### Week 4 — prove it and write it up

- **D16** Swap the tool server to Streamable HTTP **first**, then the transport smoke
  over every tool but the four auth exclusions — running it before the swap exercises
  stdio and leaves the day's
  actual change with no tool-level coverage, including `project_create` and
  `tree_forget`, which nothing else reaches. The four exclusions: `login` and `logout` write
  `tokens.json`, which the container layout omits; `configure_openrouter` calls
  `saveConfig` against a read-only mount; `auth_status` only *reads* tokens and would
  answer cleanly, but is excluded with the other auth tools. Name all four as expected
  exclusions or the run comes back red for the wrong reason. **P3's feature-parity
  half was taken at D1–2, so the Bedrock answer survives the swap being cut.**
  **Cut 2026-09-10 (P1: re-decide):** the ledger assertion re-run over HTTP with
  `turn_id` on the session header — the header-path proof D6–8 named as the
  production-shaped mechanism, same hang-after-commit mechanism as D15, about an hour
  on D15's harness — goes with the ledger. Then P3's quota/concurrency half. (The model
  pin sits at D9–10, with the worker loop, because that is where the first worker cost
  figures come from.)
- **D17** Real run, driven **interactively** (not `--autonomous`), killed **while a delegated
  `extraction_append` is in flight inside `@plugin:record-extractor`** — which puts a
  delegation in flight, the only thing criterion 1 requires. Six skills name an agent, and `person-evidence` has delegated to its own since
  2026-09-01 — but only `record-extraction`'s delegation puts `extraction_append` in
  flight, so time the kill on that one. An earlier draft timed it by "person-evidence is
  running", which at the time ran on the main thread; today it delegates, but not
  through `extraction_append`, so it still cannot time this kill. **Assert P1's `list_subkeys` criterion here too:** the
  resumed turn must show `list_subkeys` called and returning ≥ 1 key. Criterion 6 is a finding
  recorded under P1, not something this run proves. This is FamilySearch question 1. Iterate.
- **D18** Second run for the measurement: step durations, cache-read tokens, cost.
  Plus two fixtures run both sides for the quality eyeball — four runs, so ~$30 at the
  median and ~$60 at p90; half a day.
- **D19** `make proto-demo` — seeds a fixture and drives it end to end.
- **D20** Write-up.

**Runs ~22 days after the 2026-09-10 cut, and a few days over is acceptable (lead's
call, 2026-09-09).** The
arithmetic on top of the original 20, and it sums: **+0.5** the ledger (half a day → a
day, for nine writer tools plus the dispatch extraction), **+1** the auth seam (the
`getValidToken(subject)` type change, which no day previously carried), **+1.5**
`sidecar_read` — the tool plus the `gps-mentor` and `research/SKILL.md` body
rewrites the five packaging tests gate, **+0.5** the Beanstalk worker probe, **+0.5** the
D15 ledger exercise (cut below), **+0.5** the D1–2 probe growth folded in on
2026-09-10 (the registration probe's parser and billed delegation, P2's `Bash` deny,
the binding probe's prototype-set switch, P3's second TTL arm). The ceiling guard, its
`ceiling_kills` table and its two-direction proof are **cut**, returning about a day.
**On the re-decide answer (2026-09-10) the ledger day, the D15 exercise and the D16
re-run are cut, −1.5.**
**The D-labels above are the original 20 slots**, so the net added 2 days push the end
date out rather than renumbering: the real run lands nearer D20 than D17, and the
write-up after it. **The auth day is scheduled at D5**, alongside the store seam it belongs with.

Overrun being acceptable changes what gets cut, not the scoping test. Nothing is added
back that fails *does building this reduce uncertainty?* — so multi-patron custody
(~3.5 days of known-pattern code) stays out, and so does the consumer-side
source-grouping fix, whose real cost is a paid eval slot rather than engineer time.

**One thing comes back, because it now fits: a standalone Beanstalk worker probe
(half a day, week 1).** Deploy a hello-world worker that sleeps 25 minutes and log what
happens to it. That is the cheapest way to retire the sqsd contract, the
`inactivity_timeout` behaviour, the source-bundle cap and the `.ebextensions` prefix
rule — the constraints that shape the step model and that docker-compose cannot show.
It is not the full AWS deploy, which stays cut. **Done 2026-09-11; the measurements are
under D3.**

**What absorbs a probe failure.** (P1 passed on 2026-09-10, so neither fallback is
needed; kept for the record.) P1 has **two** fallbacks and they cost very differently. The first — checkpoint at
`Skill`/`Agent` launch — is about a day. **The second is not a day: it is a re-scope.**
If cross-process resume fails outright, the research document becomes the durable unit
and the transcript stops being persisted, which restructures D9–10, D14, D15 and D16 and
changes acceptance criteria 1 and 6. Budget it as a re-plan, not a slip, and treat P1's
day-2 answer as the fork in the whole month. P2 failing means re-scoping rather than building. So with
`sidecar_read` scheduled rather than contingent, the reserve is the accepted overrun,
not a cut. If two probes fire, the overrun grows before anything is
cut — that is the trade the lead has already accepted.

**Cut order if it goes badly wrong**, rather than as the plan: **D16's transport swap
only** — P3's quota/concurrency half stays, the latter being the
only prototype-side measurement of R2's throughput half and the reason the quota
request is a Before-Monday item. Cheapest to defer once the store seam is clean, and its
real teeth are ELB ceilings that do not exist locally — but cutting it also loses the
transport smoke (the only thing reaching `project_create` and `tree_forget`)
and the header-path proof of `turn_id`, which D6–8 called the production-shaped
mechanism — though that proof was the ledger re-run, cut with the ledger on
2026-09-10, so what the swap still carries is the smoke. Cut it knowing that. Then D18's second measurement run, keeping the
quality eyeball. **Never D19–20** — a prototype nobody can re-run is worth less than a
smaller one with a make target.

---

## Standing rules

**The prototype is a second entrypoint, never a replacement.** `src/index.ts` keeps
stdio and every tool — 49 with `sidecar_read`, 50 if PR #2397 lands first — including
`login`/`logout`/`auth_status`/`configure_openrouter`,
which are the only way a desktop `.mcpb` user authenticates. Neither shipped artifact
is built by any CI job — `mcpb` appears in the workflows exactly once, in a comment
saying not to fire it — so a break surfaces at release time rather than in a green PR.
**Append `make mcpb && make plugin` as a step to the required `vitest` job in
`.github/workflows/engine-tests.yml` before the store refactor starts.** That job already
carries Node 22, the pinned npm and the engine `npm ci`, and appending keeps the step
required without a ruleset edit. Break it two ways before merging — a malformed
`manifest.json`, which `mcpb validate` reds, and a `<` in one SKILL.md description, which
the plugin packager reds — and confirm it is green on a clean tree. Under an hour. No register
entry: the fix lands in the same PR, and the `nothing-checks` register is for gaps
that stay open.
**New dependencies go in with npm, not pnpm** — the engine is negated out of the
workspace and both artifacts install from its npm lockfile.

**One interface, two backends, and the tools never branch.** Otherwise the desktop
write path rots silently, because nothing in CI runs it.

**Prove totality with a lint, not with 48 ports.** `no-fs-outside-store.test.ts`,
modelled on the existing `no-bare-fetch.test.ts`, banning `fs` imports outside the
store, the four util modules, auth and `validation/validator.ts`. Per the repo rule,
break it three ways
before committing — an unquoted import, one inside a multi-line import list, and one
via `require` — then show it still accepts a legitimate variant such as a reflowed
import. That proves *no tool can reach the filesystem*; porting 48 tools proves 48
separate existentials. Pair it with one script that calls every non-auth tool through
the
transport once, which is the only thing that covers `project_create` and
`tree_forget` — the corpus never calls either.

**The eval harness is not ported.** With the two-backend interface it keeps working
unchanged on the file backend, which is what proves the skills and agents are not
broken. What it cannot exercise is the Postgres path, and that is what the prototype
itself is.

**Build the auth seam, not the custody.** The seam is the `getValidToken(subject)`
**type change** described under Auth — one day, scheduled at **D5**. Not
`AsyncLocalStorage`: that is half a day, but at n=1 a call site that never establishes
the context is indistinguishable from a correct one, which is the "hides uncertainty"
failure this prototype exists to avoid. One patron, one grant, for now. The naive
alternative is not an error but silent cross-patron impersonation: patron B's refresh
overwrites patron A's token file and A then acts as B.

**Expect the packaging tests to stop you eight times** (seven test files, one of which
fires twice). `manifest.test.ts` AST-matches the `request.params.name === "…"` chain in
`src/index.ts` to detect dispatch drift — the D6–8 dispatch extraction that would have
red-lined it went with the ledger on 2026-09-10 — and fails on the
`sidecar_read` addition; `readme-catalog.test.ts` fires twice on it — every registered
tool must appear in `README.md`, and the stated count must match reality; `README.md`
states it **twice** ("48 tools" and "48 MCP tools") and both move by one (48→49, or
49→50 if PR #2397 lands first); five more fire on the `gps-mentor.md` and
`research/SKILL.md` body rewrites rather than on the dispatch or manifest change:
`agent-tool-names`, `agent-delegation-framing`, `gps-mentor-craft-doctrine`,
`skill-name-resolution` and `doc-links`; the agent-tool-names test is a permission snapshot that fails on *any* change
to an agent's tools list, in all three server spellings.

---

## Acceptance

**Proved by the D17 interactive acceptance run** — a full research run with multiple
delegations (record extraction, image transcription), driven in a browser:

1. The worker is killed mid-delegation and the run resumes and completes.
2. Nothing is lost: the research document and the conversation both continue.
3. The deny-and-log query returns **zero `Bash` calls that executed and zero
   project-file reads that the hook allowed**. Under pool removal that is zero `Bash`
   rows; under a call-time deny it is zero `Bash` rows whose result is not a permission
   refusal — **measured 2026-09-10: pool removal**, so it is zero `Bash` rows. Under pool removal
   there are no refused `Bash` attempts to count; the denied reads are reported as a
   separate count. The logging needs the **tool input path** as well as the decision:
   "project-file read" cannot be classified without it, and reads of
   `/opt/genealogy/plugin/**/references/**` are allowed and expected — denied *attempts* are logged, expected, and reported as a
   separate count. The prototype's own hook is what denies project-file reads, so a
   denied attempt is near-certain: 27 of 28 skills carry a `**Narration:**` line telling
   the agent to read `researcher_profile.narration_guidance` from `research.json`, two
   say to read it outright, and every project tool takes `projectPath` as a required
   input, so the model always holds the path. Counting attempts would red the criterion
   while the boundary held — the attempt-vs-success distinction the plan drew for the
   `Bash` half before D1–2 measured pool removal, carried across — i.e. the *agent* reached no shell and no project state on disk. The runtime's own
   tmpfs writes are expected and are not research data.
4. **Tool-call durations were logged and read.** No call ran unbounded. This is an
   observation, not an automated gate — the longest call in the corpus is 844 s against
   an 1800 s ceiling, so it is satisfied by a wide margin today and exists as a tripwire
   for a future unbounded delegation.

**Proved separately, and the write-up must say so rather than implying one run covered
everything:**

5. **Removing the project directory costs no measurable research quality**: the judge
   verdict is within noise of a same-day control run on the same stack, and the agent
   does not strand itself on a spill file. Proved by P2 at D2 **on the current stack** — not the
   prototype, and not the D17 run. **Measured 2026-09-10: holds at n=3** (see P2).
6. **The D15 ledger exercise (stdio, `turn_id` env-sourced) and the D16 re-run (HTTP,
   `turn_id` header-sourced).** A turn killed after a writer's ledger row committed
   resumes without repeating the write: the `committed_batches` row for that
   `(project_id, turn_id, tool, args_hash)` exists (the unique index forecloses a
   second), `tryClaimBatch` hit exactly once on the resumed turn, no assertion id
   allocated twice, and the replayed call's result byte-identical to the first.
   **Measured 2026-09-10: the resumed turn re-decides**, so this is a finding, not an
   acceptance criterion — the ledger is cut and the measurement is recorded under P1.

**The go/no-go rule, which the criteria alone do not supply.** Three of the six carry
structural asterisks: criterion 5 is proved on the *current* stack at D2, criterion 4 is
an observation rather than a gate, and criterion 6 became a finding on day 2 —
re-decide, as this plan's own evidence (the content key matched 0 of 86 in the
re-decide proxy) expected. So the plan can finish
3-of-6 fully met without anything saying whether that is a pass.

It is. **Criteria 1, 2 and 3 are the go/no-go**: a killed turn resumes, nothing is lost,
and the agent reached no shell and no project state. Those three are what license the
sentence this prototype exists to write — *if the prototype works, the full solution will
work*. Criterion 4 is a tripwire, 5 is a quality check on a different stack, and 6 is a
measurement whose branch was decided on day 2: re-decide. **Report each of the six with the
configuration that proved it**, and do not let a green 4/5/6 stand in for a red 1/2/3.

Reproducible via `make proto-demo`.

---

## What to show FamilySearch

Cutting the AWS deploy makes the deliverable stronger. FamilySearch has thousands of
Beanstalk deployments and **zero** measurements of the six things this produces:

1. Does the Agent SDK resume across processes from an external store, including
   subagent transcripts, when killed mid-delegation? **Yes — measured 2026-09-10; the
   delegation itself is redone, not resumed.**
2. Does the prompt cache survive that resume, and what happens when the queue gap
   exceeds the TTL? (Their blocker worth 4.6×, answered with a number.) On the
   gateway path the TTL is five minutes whatever the client asks for (R2), so the
   number to carry is the corpus-derived cost of a five-minute window: **measured
   2026-09-11 over 148 runs — 0.4–0.5% of cache reads become writes, $20–23 on $1,298
   of runs (1.5–1.7%); human think time between turns is not in the corpus.**
3. Where can you actually checkpoint? Answered with the segment distribution rather
   than a grain chosen a priori.
4. What does an oversized tool result do with no shell? **Measured 2026-09-10 on the
   current stack: the agent `Read`s or `Grep`s the spill file; when `Read` of it fails it
   recovers through `Grep`, and it did not strand in any of four runs.**
5. Does it run on Bedrock direct, with tool search on, and does caching hit at 1 h?
   **Yes — measured 2026-09-10: tool search deferred, the 1 h TTL honoured behind its
   flag, interleaved thinking and the 1M context accepted; server-side context
   management is off there by the CLI's own gate.** Production is not Bedrock direct
   but the Messages-compatible gateway (answered 2026-09-11), where the 1 h TTL is
   dropped; P3b measured that path 2026-09-11: tool search stays on because the CLI's
   gate fires only with `ENABLE_TOOL_SEARCH` unset, which our option set never leaves
   unset, and the parity list a Messages gateway must pass is written down under P3.
6. How much turn-level idempotency a commit-time batch ledger buys: **none the model
   does not already provide** (measured 2026-09-10, n=1) — on resume it re-decides, so
   nothing folds byte-identically, and after a committed write it read the document
   and wrote nothing; a content key would have matched 17 of the 20 re-issued ops and
   missed the three rephrased ones.

Frame it as: *we built the risky half and measured it; the Beanstalk half is the part
FamilySearch already knows how to do.*

---

## Residual risk register — what a *successful* prototype still leaves open

Ranked by whether it could still kill the architecture after every acceptance
criterion is met. The prototype cannot reach any of these; the top three close with
emails rather than engineering.

### Could kill it

**R1 — The Agent Gateway's API surface. CLOSED 2026-09-11.** It is Anthropic-Messages-
compatible (agentgateway v1.4.1, `POST /bedrock/v1/messages`, Messages→Converse both
ways including streaming and errors), so the SDK runs unmodified with
`ANTHROPIC_BASE_URL` at the gateway. Read from upstream source at the pinned tag rather
than the deployed binary; one curl against integ confirms it, and a miss is a
three-line `ai.routes` addition. What replaces the risk is smaller: the CLI's
tool-search gate for a foreign base URL, measured 2026-09-11 (P3b), fires only with
`ENABLE_TOOL_SEARCH` unset and our option set pins it on, so tool search survives the
gateway from the client's side; what Messages→Converse keeps of the
`advanced-tool-use` beta, the `tool_reference` blocks, the seven other betas, the haiku
title call and `count_tokens` is the curl against integ. Native `bedrock-runtime` is
not a client surface, so the prototype's Bedrock-direct results (P3) describe the
model, not the production path. *Owner: us, one curl when integ access exists.*

**R2 — Prompt-cache health, which is also the throughput ceiling. SHARPENED 2026-09-11,
not closed.** Caching works through the gateway; the 1-hour TTL does not survive it.
agentgateway parses `cache_control` but keeps only its presence — Bedrock's
`CachePointType` has one variant — so `ttl: "1h"` is silently discarded, and whether
Bedrock honours 1 h on Converse at all is unconfirmed (P3 measured it honoured on the
InvokeModel path the CLI uses, behind the flag). Cache points are inserted and
`cacheRead`/`cacheWriteInputTokens` come back, but Converse usage has no 5m/1h split,
so the 96% figure cannot be reproduced on that path — say so before it becomes
unverifiable. Two measurements are ours. The cost of a five-minute window, **measured
2026-09-11 over the committed corpus (`make e2e-cache-window SINCE=all`, PR #2406):
148 runs; a call whose same-thread gap to the previous call exceeds 300 s has its read
re-priced as a 5-minute write; main-thread gaps over 300 s are median 0 per run, p90 2,
max 4, in 63 of 148 runs, none over 1,800 s; 0.4–0.5% of cache reads become writes,
$20–23 against $1,298 of runs (1.5–1.7%), per run median $0 / p90 $0.41–0.55 / max
$1.01.** That is the whole production delta: the corpus's writes were 1 h only because
the e2e harness runs on the operator's Claude subscription, whose OAuth allow-list grants
1 h; on an API key — the hosted path, and P3b's own first-party control — writes are
5-minute unless `ENABLE_PROMPT_CACHING_1H=1` is set, and asking for 1 h would have cost
this corpus $133 more in write premium than the $20 it saves in reads. So the number
the 4.6× rests on is not the TTL. Two cautions on the measurement: gaps are counted per
thread (a delegation window during which the main thread makes no call is a main-thread
gap — 71 of the 102 — and a thread-agnostic count would be 50), and the corpus's gap
structure was observed under a 1 h TTL, which is exactly what makes its long gaps
priceable as lost reads. What the corpus cannot size is a patron's think time between
turns — a turn arriving more than five minutes after the last model call re-writes the
whole context at the write rate, about $0.11 per 30k tokens, growing with context
length. The second measurement is still
open: the shared cap of four cache points, inserted system → messages → tools, where
with 49 tools the tool-definition point is the one dropped — the CLI sends three (two
on the system prompt, one on the last user message; P3b), so measure the fourth, do
not assume. A TTL can be carried upstream (FS has pushed to agentgateway
before) once Bedrock is shown to honour it in a sandbox account; the help-research team
has the same question open and places Converse `cachePoint` blocks directly.
Throughput: by design we own it — the gateway assumes `tap-gateway-invoke` in our
product account via STS, so quota, throttling and billing land with us — **but it is
not live**: the deployed route runs on the shared TAP task role, ETA December, so
anything measured in integ before then is the shared pool. Which account is unsettled
(the fulltext P25 accounts if the agent counts as the same product, else a new one via
a GEM intake). The burndown multiplier and whether cache reads are exempt are unknown
and the largest variable in the estimate (50 sessions is ~0.5M or ~8.1M TPM); the
information is in the responses, we test it ourselves. Do not let a `model:` be pinned
in our provider block — it overrides the client's model and breaks per-agent selection.
Gateway capacity is one 0.25 vCPU / 512 MB task per environment, `desiredCount: 1`,
no autoscaling, parsing and re-serialising every body for every tenant; per-account
credentials isolate token pools but not this — performance-test our load and they
scale accordingly. *Owner: us for the two measurements and the perf test; APT for the
per-account role and the TTL.*

**R3 — SSE through the FamilySearch edge. RESHAPED 2026-09-11.** Still no confirmed
record of `text/event-stream` through the full public edge. But HAProxy has no
total-duration cap: every relevant timeout is a per-cluster inactivity timer set through
their Fusion API, a 15 s heartbeat resets it, and nothing buffers response bodies —
a config request with an owner. DTM times out idle connections at 60 s. And a duration
cap is survivable anyway: with `id: <seq>` on every frame and `EventSource`, a cap is
an automatic reconnect with `Last-Event-ID` resumed from the `session_events` cursor
we already have (D11–12); reconnect-and-resume is the real solution and the cap an
optimisation. What is unsurvivable narrows to full response buffering, an idle timeout
shorter than the heartbeat, or the edge stripping or rewriting the content type —
CloudFront and Imperva. The real remaining risk is **concurrency**: DTM was not built
for many concurrent connections — ask the Help team how they worked that with
Platform, or whether they bypassed it. Prior art inside FS: `fs-eng/help-research-only`
(a sibling genealogy assistant on SPS/Beanstalk running `SseEmitter(600_000L)`, raised
from 5 to 10 minutes because real turns were cut; it hit Imperva 403s on outbound FS
API calls and solved them with internal `*.fslocal.org` DTM binding-set CNAMEs that
never cross the WAF; whether its frontend reaches it through the public edge is one
message to its owner) and `fs-eng/bridge` (Last-Event-ID resume over a JetStream
sequence, load-tested at 100 subscribers / 50 events/s with a chaos arm; routes
around DTM). If the probe is still commissioned it needs: ramped emit intervals
(5/15/30/60/120 s) to locate the idle threshold; per-layer arms (origin → HAProxy →
Imperva → CloudFront); timestamps at both ends; a chunked `text/plain` control; header
arms with and without `X-Accel-Buffering: no` and `no-transform`; capture of
`via`/`x-cache`/`x-iinfo`; an explicit `Last-Event-ID` reconnect arm, which matters
more than the duration arm; one 65-minute arm; and a mobile-API-path arm if mobile
patrons are in scope. *Owner: FS platform / DPF for the edge; us for D11–12.*

### Would force significant rework

**R4 — The grain the board approves is not the grain we tested.** The architecture
document proposes one model call per queue message; this plan validates one patron
turn. That is defensible, but it changes worker packing, the ~$0.04 compute estimate,
and — the one that bites — the `ApproximateNumberOfMessagesVisible` autoscaling
trigger, which **at turn grain goes to zero exactly when the system is saturated**.
Nearly free to close: state in the write-up which grain was validated, and flag the
scaling signal as needing a different metric. *Owner: us, one paragraph.*

**R5 — Research quality parity.** Our evidence is one probe fixture plus a two-fixture
eyeball. If removing the filesystem costs quality in a way that only shows at n=20,
nobody learns it until the 136-fixture corpus is re-baselined (94 of those fixtures have committed runs) — by which point the
substrate is committed and every green check stayed green. *Owner: us.*

**R6 — Bedrock Guardrails cannot see the vectors it is nominated to control. CONFIRMED
2026-09-11, and worse.** Nothing is evaluated on the input side: the Converse path sets
`guardrailConfig` but never emits a `guardContent` block, so no input is tagged — not
tool results, not user text, not the system prompt. The `promptGuard`/`ApplyGuardrail`
alternative keeps only the literal text parts of messages and system, so `tool_result`
and `tool_use` are dropped and tool definitions are never in scope; what is evaluated
is model output, plus user text on promptGuard. Not a configuration gap but the wrong
category of control — injection is an input-integrity problem on a channel neither
mechanism reads — so do not accept "tune the guardrail" as a plan. And it is not even
on: `guardrailIdentifier` is a placeholder in beta and prod, and their README warns
that enabling `PROMPT_ATTACK` 403s every request on v1.3.x. Exposure, from the corpus:
5,554 of 27,002 tool calls return externally-authored content — 20.6% of all calls,
35.8% of MCP calls, about 34 per run over 163 runs — mostly `record_search`,
`record_read`, `image_transcribe`, `wiki_place_page`, `fulltext_search`. The
gateway-side fix is theirs and small (emit `guardContent` for `toolResult`, or teach
promptGuard to walk tool-result parts) and covers every tenant; the semantic half is
irreducibly ours, and we already ship doctrine plus a regression test for it. The
argument nobody has made yet: the hosted design removes the shell, WebFetch/WebSearch
and the device bridge from the session that ingests record text, against a Cowork
census of 158 tools including Gmail send, Drive share and `device_bash` — the substrate
change is itself the mitigation. *Owner: APT for the gateway half (the question is
posted in their chat); InfoSec + us for the review.*

**R7 — Multi-patron token custody.** Known and mechanical (~3.5 days), but the naive
port is silent cross-patron impersonation rather than an error. The prototype builds
only the seam. *Owner: us.*

**R8 — Cross-instance write *and turn-claim* serialization.** Writes are addressed via
`pg_advisory_xact_lock`, but it stays on the register because n=1 cannot test it — the
failure needs two tool-server instances and a parallel write within one turn.
**Turn claiming is not addressed at all**: the prototype grants any claim carrying the
same `turn_id` immediately, with no fencing and no expiry. That is correct at one worker
and unsafe above it, and it is what the Locking section defers here.
**The trigger is the second worker, not a date** — this stays unreachable through the
prototype and through the early two-backend implementation, and becomes live the moment
the worker tier scales past one, which is the first thing horizontal scaling does.
**The fix is a `claim_epoch` fencing token**: minted fresh on every successful claim,
with the heartbeat and the release both conditioned on it still matching, so a
mismatched write is a no-op and that worker aborts. One column, two `WHERE` clauses,
roughly one to two days with a two-worker integration test. It is textbook, which is why
it was cut from the build plan rather than from this register.
*Owner: us; needs a two-instance test before production.*

**R9 — Blueprint provisioner coverage and the custom AMI check.** The architecture
document's own first blocker: with no FamilySearch-baked AMI for Python 3.12 / Node 24
on AL2023, test and prod deploys fail validation. Logistics rather than architecture,
but it can block for weeks. *Owner: FS platform + DTL.*

**R10 — No client auth on the LLM routes.** Today it is `TODO-TAP(authn)`; the interim
control is an ALB security-group CIDR allowlist behind an internal ALB, so our workers
must sit in an allowlisted range. APT-1512 is issuing API keys — ask to be in that
batch. *Owner: APT; us to ask.*

**R11 — Our prompts are logged.** Full prompts and completions go to Langfuse at 100%
sampling, gateway-wide; ours carry patron genealogical data and transcribed record
images. Start the InfoSec conversation rather than discover it in review. *Owner: us
to raise; InfoSec + APT.*

**R12 — The SCP and the non-AWS egress.** The SCP denies direct Bedrock invoke to every
principal in our account except `tap-gateway-invoke` and `bedrock-exception-*` — decide
now whether we want an exception role for local dev and smoke tests (P3's direct calls
would be denied there). It does not stop egress to non-AWS providers, which is where
the OpenRouter/Gemini `image_transcribe` path sits — talk to ACE about what they use
for image calls. *Owner: us.*

**R13 — Route changes are image rebuilds.** `config.yaml` is baked into the gateway's
Docker image and the GitOps end state is not live, so a route tweak is a rebuild and a
deploy through their pipeline — days, not minutes. Plan any `ai.routes` change with
that lead time. *Owner: APT.*

### Real but ordinary

The 60 s tool-server ELB against four tool budgets (OCR 180 s, image fetch 90 s,
wiki and collections 60 s each); CAS/TARS entitlement; the programmatic API's grant
problem; PRIA; the InfoSec MCP review; the Church AI Working Group; production
telemetry; database migrations; DR and `us-east-1` only; deletion crossing a backup
boundary; the `.mcpb` and Cowork artifacts, which no CI job builds until the
engine-tests step above lands; the eval harness
continuing to emulate production; the OCR provider and the record-custodian terms;
idle-session billing.

## Corrections to the architecture document

- **"Exactly 24 take a `projectPath` and 24 are pure HTTP callers" is 21 and 27** —
  21 take a `projectPath` and the other 27 do not; several of those 27 make no network
  call either, so "pure HTTP callers" is the wrong gloss for them too.
  The 24 is a file count that includes three helper modules exporting no tool. The
  argument survives; a reviewer who checks the number stops trusting the rest.
- **"This design removes the patron-token surface" is wrong** — the stateless design
  *concentrates* it into one shared tool server. The alpha's blast radius is one
  patron per sandbox. What the stateless design genuinely removes is a long-lived
  token file on disk and the shell that could read it; credit that instead.
- **The ARB question on prompt injection asks the board to bless a control that
  cannot see the threat.** Bedrock Guardrails does not evaluate tool results, tool
  definitions, or tool-call arguments — which is every vector the document names
  (transcribed images, record full text, fetched wiki pages, patron uploads). Worse,
  as deployed it evaluates nothing on input at all and is not enabled (R6).
- **Server-side context management, named twice as the conversation-growth
  mitigation, is off on Bedrock in the pinned CLI.** The beta is pushed only for
  first-party-class providers; the document needs a different mitigation on that path
  or a gateway that supplies one. Through the gateway the CLI does send the beta, and
  Messages→Converse has nowhere to put it — same outcome.
- **The 14.7% "reads its own conversation transcript" row is mislabelled.** It is the
  CLI's oversized-tool-output spill: 739 reads, 11.8% of the 6,247 filesystem
  operations, in 66 of 161 runs (separator-normalised). That is a runtime mechanism, not passive storage, and
  no MCP tool replaces it.

---

## Measurements this plan rests on

All from the committed corpus at `eval/runlogs/e2e/`, **measured at `e18d99b10`**
(the convention the two guardrail specs follow; `corpus-figures.test.ts` checks a
hex-shaped stamp near a figure in those specs only, and does not cover `docs/plan/`). 161 run logs across 94 fixtures; 51 carry the three-element timeline
that makes sub-run segmentation possible. Re-derive with a timeline parse over
`usage.timeline` plus `usage.continue_nudges`; **the derivation scripts must land in
`dev/` with this change, not in a session scratchpad a reviewer cannot reach.** Counts
that are not corpus figures were re-taken against `main` on 2026-09-10: agents,
`fs` importers and vitest files moved; the `getValidToken` 19 turned out to be grep lines, not calls.

| Measure | Value |
|---|---|
| Full run wall clock (`usage.duration_ms`, n=148) | median 53.9 min, p90 107.9 min, max 180.1 min |
| Voluntary yields per run under `--autonomous` | median 1, mean 1.65, max 20; 50 of 160 runs zero |
| Skill-only episodes (`Agent` launches ignored) | n=442, median 213 s, p95 1654 s, 19 over 1800 s (4.3%) |
| Skill-or-agent segments (launch-only) | n=947, median 142 s, p95 711 s, **p99 1488 s**, max 3147 s, 4 over 1800 s |
| Segments per run | median 16, range 6–75 |
| Inter-event gap | median 0.6 s, p99 104 s, max 826 s |
| One model call plus its tool calls | median 2.6 s, p99 148 s, max 893 s — zero over 1800 s |
| Cost per run | median $7.35, p90 $14.75 |

**Segmentation rule, stated because two earlier drafts got it wrong.** A segment starts
at a `Skill:` or `Agent` name on an **`assistant`** timeline row only, and a run's last
segment ends at its last timeline event. Each name appears twice in the timeline — 505
`Agent` on `assistant` rows and 505 on `tool_result` rows, 442/442 for `Skill`. One
draft counted `Agent` on both while collapsing `Skill` repeats (n=1448 / p99 1232 s /
max 2993 s); a second over-corrected by collapsing consecutive identical `Skill` labels
*and* extending each run's last segment to `wall_clock_seconds`, which inflated one
segment from 1327 s to 1944 s and invented a fifth over-ceiling case (n=942 / p99
1520 s / 5 over). **Both are withdrawn.** The row above is the rule applied without
either adjustment, and it reconciles: 505 + 442 = 947.

**Why the 442-row has more over-ceiling members than the 947-row that contains it.**
The episodes row takes boundaries at `Skill:` launches only. Dropping the 505 `Agent`
boundaries merges each delegation's time into its enclosing skill, so a 442-member
partition of the same wall clock has longer members — 19 over the ceiling against 4.
Not an arithmetic impossibility; two different partitions.

**What that does to the P1 fallback:** a `PreToolUse` hook fires at launch, so it
cannot create the **947 return-side boundaries** — half of a launch-and-return count of
1,894 — and four segments (3147 / 2515 / 2310 / 2149 s) remain above the ceiling where
the hook cannot make them completable.

**Caveat that shaped this plan.** The corpus is `/research --autonomous` driven by a
Stop hook that vetoes voluntary yields. Both mechanisms exist to *suppress* the turn
boundary, so the corpus contains one enormous turn per run and says nothing directly
about interactive turn length. Nothing committed samples interactive use — feedback
bundles are never committed. The skill-or-agent segment distribution is the best
available proxy, and it is the one this plan uses.
