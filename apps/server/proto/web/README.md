# Prototype web tier (D11–12) and the headless driver (D13)

The stateless tier between the browser and the queue for the search-agent prototype
(`docs/plan/search-agent-prototype.md`, Week 3). It never runs the SDK: the worker
(D9–10) writes `map_message` output into `session_events` / `session_activity`, and this
tier reads those rows for the browser. Until the worker exists it is driven against rows
`../drive.py` inserts.

It serves the paths `apps/web` already calls, so the SPA is reused verbatim with
`VITE_SESSION_TRANSPORT=sse` (`make web-proto`).

| Route | What |
|---|---|
| `POST /api/sessions/{id}/messages` `{text}` | Mints `turn_id` (UUID), writes the `turns` row and a `user_msg` event in one transaction, then `SendMessage` with `{turn_id, session_id, project_id, text, enqueued_at}`. 202 `{turn_id, seq, message_id}`; a failed send marks the turn `enqueue_failed` and answers 502. The `turn_id` is in the **body**, never the SQS `MessageId`. |
| `GET /api/sessions/{id}/events?after=N` | One-shot poll: `{events, activity, turn_active, next_after}`. `Last-Event-ID` beats `after`. |
| `GET /api/sessions/{id}/events/stream?after=N` | `text/event-stream`. `retry: 1000`; the catch-up rows after the cursor; the current documents once; then `status turn_active` if a turn is in flight; then a 1 s poll. `: ping` after 15 s idle. |
| `GET/POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/{id}`, `POST …/resume`, `GET …/state` | Session CRUD in the SPA's `SessionSummary` shape; `/state` reads `documents` (`research.json`, `tree.gedcomx.json`). |
| `GET /auth/config`, `GET /auth/me`, `POST /auth/dev-login`, `POST /auth/logout` | Stubs: a fixed prototype user. **There is no auth on this tier** — identity is out of the prototype's scope and it binds to localhost. |
| `GET …/sidecar/{log_id}` → 404; `GET …/image`, `GET …/logs`, `POST …/files`, `POST …/interrupt` → 501 | Not in the prototype; each says why. |

## The row → wire contract (what the worker writes, what the SPA reads)

Only `session_events` frames carry `id: <seq>`, so `Last-Event-ID` is always a seq and
the transient frames below are never replayed — the same split as `TRANSIENT_KINDS` in
the hosted runner.

| Row | Frame |
|---|---|
| `session_events` `kind='user_msg'`, `payload {text, turn_id}` | `id: <seq>` · `{"type":"user_msg","text","turn_id","seq"}` |
| `session_events` `kind=<map_message kind>`, `payload` = the event's fields | `id: <seq>` · `{"type":"agent_event","event":{…payload,"kind":kind},"seq"}` |
| `session_activity.payload` (on `updated_at` change) | `{"type":"agent_event","event":{…payload,"kind":"task_progress"}}` |
| `documents` row (once at open, then on `version` change) | `{"type":"research_updated"\|"gedcomx_updated","name","data":<doc>}` |
| a `turns` row with `completed_at IS NULL` (at open, after the replay) | `{"type":"status","state":"turn_active"}` |

The `kind` column wins over a `kind` key inside `payload`. The D3 stub worker's
`turn_done {turn_id, receive_count}` row already fits.

**Why `turn_active` comes after the replay.** `ChatPane` clears busy on every
`turn_done`; a replayed one landing after the status would show idle while the agent
works. `sandbox_server.py` orders history → `chat_ready` → `turn_active` for the same reason.

**The `user_msg` echo.** The tier commits the row *before* the queue round trip and the
202, so the SPA's own message reaches its open stream — possibly before the 202 that names
its `seq`. `SseSessionConnection` holds live `user_msg` frames while its POST is in flight
and drops the one the 202's `seq` names; everything else relays.

## Running it

- **Self-contained** (`make proto-drive`) — **the mode the 17/17 acceptance ran in.**
  `drive.py --embedded-pg` starts a pip-installed PostgreSQL 16 (`pgserver`, in the
  `proto` dependency group — never installed by `uv sync` or CI; wheels exist for macOS
  arm64/x86_64 and Linux x86_64, **not** Linux aarch64), applies the schema and runs the
  tier in-process with **no queue**.
- **Compose** (`make proto-up`): the `web` service on `127.0.0.1:8085`, `QUEUE_URL` pointed
  at the queue the shim reads, `PG_DSN` at the compose postgres. Startup applies
  `../sql/*.sql` (all idempotent), so a volume that predates `003_web.sql` gets its
  columns without a `make proto-down`. **Verified on a Docker machine 2026-09-14** (in
  review; no CI job runs any proto compose target, so this stays a hand check): the image
  builds and the service comes up healthy, `make proto-smoke` passes 14/14 through the new
  `proto-up-core`, dropping the three columns from a live volume and restarting `proto-web`
  puts them back, and a turn round-trips POST → `SendMessage` → shim → worker →
  `turn_done` → SSE frame. `make proto-drive BASE=http://localhost:8085` drives that stack
  in worker mode — it proves the tier, not the resume, since the D3 stub's turn ends inside
  stream A (the driver says so in its own table).
- **From the venv** (`make proto-web`): the same tier via `uvicorn --app-dir proto
  web.app:app` against the compose postgres (`:5434`) and elasticmq (`:9324`).
- **The SPA** (`make web-proto`, Chrome on `127.0.0.1:5173`) — **verified in review on
  the compose stack 2026-09-14**: the auth stubs answer, sessions list and create, two
  messages round-trip POST → queue → shim → worker → `turn_done` → SSE with exactly two
  user bubbles in the DOM (the echo drop), the spinner clears on `turn_done`, and a reload
  halfway through a hand-seeded 25 s turn replays the whole transcript with no duplicates
  and comes back on **Stop** — the `status turn_active` frame landing after the replay.
  Tool chips, the thinking block, the phase rail and the live session title all render off
  SSE frames. Still to come: a real worker's turn driving the SPA (D17), which is also the
  run where the driver's strong "B resumed at A's last seq + 1" check returns.

`QUEUE_URL` unset → `NullQueue`: the turn is recorded (a `turns` row, a `user_msg` event)
and never enqueued, logged loudly at start. Under `NullQueue` nothing completes a turn, so
a posted turn stays `turn_active` until a script closes it (the driver's seeder does, through
`worker.complete()` itself).

Env: `PG_DSN`, `QUEUE_URL` (a full queue URL, the shim's shape), `POLL_S` (1),
`SSE_PING_S` (15).

## The driver (`../drive.py`)

The lead's acceptance for D13, zero model cost: post, stream, drop the connection
mid-turn, reconnect with `Last-Event-ID`, miss nothing.

```
uv run --group proto python proto/drive.py --embedded-pg                   # make proto-drive
uv run python proto/drive.py --base http://localhost:8085 --pg-dsn postgresql://postgres:proto@localhost:5434/proto
uv run python proto/drive.py --base … --pg-dsn … --worker                  # D17: a real worker
```

Default mode (`--seed`) runs a thread that inserts what the worker will write: ~40
`session_events` through `next_session_seq`, a few `session_activity` updates, one
`documents` upsert, then the worker's own `complete()` (imported from
`../worker/worker.py`: the `turn_done` event and `turns.completed_at` in one commit) —
pausing past the ping interval once so a `: ping` is observable. **`--seed` is refused
when the tier reports a live queue** unless `--allow-live-queue`: on a compose stack the
stub worker completes the enqueued turn within milliseconds and races the seeder. A
stack with a worker is what `--worker` is for. Every stream read has a wall-clock
deadline, so a stop condition that never comes is a FAIL, not a hang.

Stream A reads eight id-frames (or the turn's `turn_done`, if the turn is shorter) and leaves the `with` block without draining (httpx closes the connection);
stream B opens with `Last-Event-ID: <A's last>` **and** `?after=0`, reads until the turn
is complete and A ∪ B holds everything `GET /events` can see, and the checks compare the
two exactly.

Measured 2026-09-14 (`make proto-drive`, no Docker on the machine): 17/17 — 42 events
dense 1..42, A cut after 8, B resumed at 9, A ∩ B empty, one ping, activity and document
frames without ids, `turn_active` after the catch-up rows and false at the end.

## Tests

`tests/test_proto_web.py` (`make proto-test`, and `make server-test` runs it): pure
helpers, the routes over `httpx.ASGITransport` with a fake store and queue, the stream
generator pulled directly (httpx runs an ASGI app to completion, so an endless stream
cannot be tested through the route), and the compose/schema shape.
