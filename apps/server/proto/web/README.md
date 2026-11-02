# Prototype web tier (D11–12) and the headless driver (D13)

The stateless tier between the browser and the queue for the search-agent prototype
(`docs/plan/search-agent-prototype.md`, Week 3). It never runs the SDK: the worker
(`../worker/worker.py`, D9–10) writes `map_message` output into `session_events` /
`session_activity`, and this tier reads those rows for the browser. `../drive.py` can
also stand in for the worker with seeded rows (`make proto-drive`).

It serves the paths `apps/web` already calls, so the SPA is reused verbatim with
`VITE_SESSION_TRANSPORT=sse` (`make web-proto`). With `WEB_DIST_DIR` set, the tier also
serves that SSE build itself at `/` (`web/spa.py`, below); the image and the Beanstalk
bundle both set it.

| Route | What |
|---|---|
| `POST /api/sessions/{id}/messages` `{text}` | Mints `turn_id` (UUID), writes the `turns` row and a `user_msg` event in one transaction, then `SendMessage` with `{turn_id, session_id, project_id, text, enqueued_at}`. 202 `{turn_id, seq, message_id}`; a failed send marks the turn `enqueue_failed` and answers 502. The `turn_id` is in the **body**, never the SQS `MessageId`. |
| `GET /api/sessions/{id}/events?after=N` | One-shot poll: `{events, activity, turn_active, next_after}`. `Last-Event-ID` beats `after`. |
| `GET /api/sessions/{id}/events/stream?after=N` | `text/event-stream`. `retry: 1000`; the catch-up rows after the cursor; the current documents once; then `status turn_active` if a turn is in flight; then a 1 s poll. `: ping` after 15 s idle. |
| `GET/POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/{id}`, `POST …/resume`, `POST …/continue`, `GET …/state` | Session CRUD in the SPA's `SessionSummary` shape; `DELETE` answers 409 while a turn may still be running (its `turn:<id>` backend is connected, or it was claimed in the last 2 min, or queued unclaimed in the last 15) and removes the SDK transcript (S3 objects are left to the orphan sweep, U19); a session the worker's retention retired (U19, idle past `RETENTION_SESSION_IDLE_S`) reads `status: retired`, answers 410 to a message, and `POST …/continue` opens a new session on its project; `/state` reads `documents` (`research.json`, `tree.gedcomx.json`). |
| `GET /api/projects` | Only the caller's projects: `[{id, label, updated_at}]`, with a research title or objective and an ISO-8601 time (each nullable). |
| `GET /api/projects/{id}/state` | Owner-checked `{label, research, gedcomx, sidecars: [], version}`; `ETag: "rN-tN"` from document versions, or an empty 304 when `If-None-Match` matches. |
| `GET /api/projects/{id}/sidecar/{log_id}` | Owner-checked search-result body, `{raw, mtime}`; 404 when absent. |
| `GET /api/projects/{id}/image?filename=` | Owner-checked persisted source page scan, `image/jpeg`; 404 when absent. |
| `GET /auth/config`, `GET /auth/me`, `POST /auth/dev-login`, `POST /auth/logout`, `GET /auth/familysearch/login`, `GET /callback` | Patron sign-in (U2, below). Every `/api/sessions` and `/api/projects` route needs the session cookie. Session routes answer 404 for a session on a project the caller does not own. |
| `GET /api/sessions/{id}/sidecar/{log_id}`, `GET …/image`, `GET …/logs`, `POST …/files` | Sidecars return `{raw, mtime}` and images return the persisted scan (404 when absent); logs answer 501; file uploads are stored and return `{path, sizeBytes}`. |
| `GET /`, each top-level file of the dist, `GET /assets/…` | The SPA, when `WEB_DIST_DIR` is set (below). `/docs`, `/redoc` and `/openapi.json` are off. |
| `GET /api/feedback/context?sessionId=`, `POST /api/feedback` | The SPA's feedback dialog (U20, below): the files and transcript size a report would carry; then the zip, stored in S3 under `feedback/` and sent nowhere. 200 `{ok, filename}`. |
| `POST …/interrupt` → 202 | Stop (PR #2870 item 1c). The worker owns the turn and no control channel reaches it, so this raises a flag on a control-plane row that the worker's `PreToolUse` hook reads before every tool call. |

The project routes give missing, foreign and NULL-owner projects the identical 404
`"Project not found"`, before validating a filename or log id or comparing an ETag.
Every `/api/projects` response a route or FastAPI produces, including errors and 304s,
carries `Cache-Control: private, no-store` and `Vary: Cookie` (merged with existing values).

## Sign-in and ownership (U2)

`web/auth.py` is a vendored port of the alpha's FamilySearch front door (PKCE, a signed
`wb_session` cookie, the email allowlist, Fernet encryption of the grant). Handoff:
U2 in `docs/plan/familysearch-handoff.md`.

- **Dev-login** (`POST /auth/dev-login {email}`) is opt-in: on only with `DEV_LOGIN=true`,
  FamilySearch sign-in off and `PUBLIC_URL` http, which is the default compose stack. No
  Beanstalk template may set a `DEV_` variable (U11), so a deployed host never offers it,
  even with `PUBLIC_URL` unset. Any email signs in, so
  two emails are two patrons. `seed.py`, `demo.py`, `turn.py` and `drive.py` sign in this
  way (`--email`, default `dev@localhost`), and `seed.py` hands the project the engine
  created, which has no owner, to that patron.
- **Ownership** is `projects.owner_id` (`sql/008_auth_owner.sql`). A NULL owner, which is
  what the engine writes, is visible to nobody. Opening a session on a supplied
  `project_id` works only if the caller owns it, or under dev-login if nobody does.
  Deleting a session drops the project's documents only with its last session.
- **FamilySearch sign-in**: export `SESSION_SECRET` and `FS_TOKEN_ENC_KEY` (each a random
  value, e.g. `openssl rand -hex 32`), then
  `docker-compose -f docker-compose.yml -f docker-compose.fs-signin.yml up -d web`; the
  overlay refuses to start without them, and the tier refuses a default. Keep the same
  `FS_TOKEN_ENC_KEY` exported for `make proto-up` (the worker decrypts grants with it) and
  `make proto-grant` (which encrypts with it), or turns end `signin_required`. The overlay
  publishes the tier on `127.0.0.1:1837`, the dev key's only registered redirect, and
  turns dev-login off. Put your FamilySearch email in `ALLOWED_EMAILS` first. Open the
  SPA at `http://127.0.0.1:5173` rather than `localhost`, because cookies are per host.
  `make e2e-login` and `make proto-grant` need the same port, so stop the override while
  either runs.
- **Environment**: `PUBLIC_URL`, `WEB_ORIGIN`, `SESSION_SECRET`, `FS_TOKEN_ENC_KEY`,
  `ALLOWED_EMAILS`, `FAMILYSEARCH_WEB_ENABLED`, `FAMILYSEARCH_CONFIG` (see the
  `web/auth.py` docstring). `ALLOWED_EMAILS` is comma- or space-separated; write it
  space-separated on Beanstalk, whose environment values cannot carry a comma. On an https `PUBLIC_URL`, or with
  FamilySearch sign-in on at any scheme, the tier refuses to start with a default or empty
  secret.
- **Path prefix (U28)**: `PUBLIC_URL` may carry a path, the prefix an edge strips before
  the origin (`https://<host>/service/search/agent-tools/<name>`). The routes stay at `/…`;
  the path scopes both cookies, the OAuth `redirect_uri` (`<PUBLIC_URL>/callback`), the
  callback's landing (`<prefix>/`) and the SPA's `<base href>`. A path outside unreserved
  segments, or any query or fragment, refuses to start. The first request whose
  `X-Orig-Base` differs logs `ev=prefix_mismatch`; `/api/health` reports `base_path`.

**Grants (U3).** Every turn's FamilySearch calls run on its project owner's grant, which
the worker reads from `familysearch_tokens` at the start of each attempt while it holds that
patron's attempt lock (`proto/grants.py`). This tier is the grant's only refresher:
`grant_refresh_loop` runs every `FS_GRANT_REFRESH_INTERVAL_S` (30) and refreshes the grant of
each patron with an open turn once its session is `FS_GRANT_REFRESH_AGE_S` (3600) old, only
when it can take the patron's attempt lock exclusively, so never under a live attempt (a
refresh revokes the previous access token at once). The worker's start gate holds an
attempt off a session older than `FS_GRANT_MAX_START_AGE_S` (26400) until that refresh
lands. A refusal from FamilySearch ends the patron's next turn `signin_required`, and a new
sign-in clears it. Sign-in is safe while a turn runs: the callback takes only the grant's
write lock, and a second sign-in does not revoke the first token (measured 2026-09-29). On
compose, `make proto-grant` stores the dev-login patron's grant once per stack.

## Feedback (U20)

`web/feedback.py` is the alpha's feedback bundle (`apps/server/app/feedback.py`) over this
tier's stores; `web/blobstore.py` is the S3 client, with the engine's `GENEALOGY_S3_*`
semantics. Handoff: U20 in `docs/plan/familysearch-handoff.md`; bundle contract:
`docs/specs/feedback-case-spec.md`.

- **Owner first.** Both routes answer 404 for a session the caller does not own, a
  missing `sessionId` included, before the body is validated: a foreign session is never
  a 422. An owned session with a bad body is 422; a field over 10,000 characters, 400.
- **What it bundles.** `documents` rows (as the engine's `readText` renders them) and
  `blobs` bytes from S3, skipping dot segments (`results/.staging/`), stale copies (named)
  and blobs over 25 MiB. The alpha's 35 MiB selection runs on `blobs.bytes` before any
  `GetObject`; a blob that cannot be read is named and the report still lands. The
  transcript comes from `session_entries`, streamed 500 rows at a time under one 20 MiB
  budget. Living people, API keys, bearer tokens and the owner's current FamilySearch
  tokens are redacted.
- **Where it goes.** `feedback/<owner_id>/<project_id>/feedback-<ts>-<8 hex>.zip` in
  `GENEALOGY_S3_BUCKET`, `ContentType: application/zip`, and nowhere else:
  `forward_stored_feedback` is the seam for whatever the lead decides. The U19 orphan
  sweep leaves the prefix alone; on the rehearsal a lifecycle rule expires it at 90 days.
  No bucket: `POST` answers 503 and `/context` still works. A failed `PutObject` is 502.
  One build at a time per process.
- **Environment.** `GENEALOGY_S3_BUCKET` (required for `POST`), `GENEALOGY_S3_REGION`
  (`us-east-1`), `GENEALOGY_S3_ENDPOINT` (unset on AWS; path style when set),
  `GENEALOGY_S3_ACCESS_KEY` + `GENEALOGY_S3_SECRET_KEY` (both, or neither for the instance
  role; one alone refuses to start). Compose and `make proto-web` point it at MinIO's
  `projects` bucket. To read a bundle: `mc alias set proto http://localhost:9000 proto protoproto`,
  `mc cp proto/projects/feedback/<owner>/<project>/<file> .` (or `aws s3 cp` on AWS), then `make feedback-case ZIP=<file>`.

## The row → wire contract (what the worker writes, what the SPA reads)

Only `session_events` frames carry `id: <seq>`, so `Last-Event-ID` is always a seq and
the transient frames below are never replayed — the same split as `TRANSIENT_KINDS` in
the hosted runner.

| Row | Frame |
|---|---|
| `session_events` `kind='user_msg'`, `payload {text, turn_id}` | `id: <seq>` · `{"type":"user_msg","text","turn_id","seq"}` |
| `session_events` `kind=<map_message kind>`, `payload` = the event's fields | `id: <seq>` · `{"type":"agent_event","event":{…payload,"kind":kind},"seq"}` |
| `session_activity.payload` (on `updated_at` change) — the whole transient event, `kind` included (`text_delta`, `thinking_delta`, `task_progress`) | `{"type":"agent_event","event":{"kind":"task_progress",…payload}}` — the payload's own `kind` wins |
| `documents` row (once at open, then on `version` change) | `{"type":"research_updated"\|"gedcomx_updated","name","data":<doc>}`; any other root document (e.g. `external-collections.json`) is `"document_updated"` |
| a `turns` row with `completed_at IS NULL` (at open, after the replay) | `{"type":"status","state":"turn_active"}` |

The `kind` column wins over a `kind` key inside `payload`. The worker's
`turn_done {turn_id, receive_count}` row (and the D3 stub arms' identical one) fits.

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
  arm64/x86_64, Linux x86_64 and Windows x86_64, **not** Linux aarch64), migrates it
  (`migrate.migrate`, the runner step 6 uses) and runs the tier in-process on the
  driver's own **`NullQueue`** (nothing is enqueued).
- **Compose** (`make proto-up`): the `web` service on `127.0.0.1:8085`, `QUEUE_URL` pointed
  at the queue the shim reads, `PG_DSN` at the compose postgres. Startup applies no
  schema (U9): the one-shot `migrate` service runs `../migrate.py` first and the tier
  waits for it, so a volume that predates a file gets it without a `make proto-down`;
  the tier only compares the ledger with `../sql/` and reports `schema` on
  `/api/health`. **Verified on a Docker machine 2026-09-14** (in review; no CI job runs
  any proto compose target, so this stays a hand check): the image builds and the service
  comes up healthy, `make proto-smoke` passes 14/14 through the new `proto-up-core`,
  dropping the three columns from a live volume and restarting `proto-web` put them back
  (the start-time apply that did it is gone since U9), and a turn round-trips POST →
  `SendMessage` → shim → worker → `turn_done` → SSE frame. `make proto-drive BASE=http://localhost:8085` drives that stack
  in worker mode — it proves the tier, not the resume, since the D3 stub's turn ends inside
  stream A (the driver says so in its own table).
- **From the venv** (`make proto-web`): the same tier via `python proto/web/app.py`
  against the compose postgres (`:5434`), migrated first (`make proto-migrate`; until then
  `schema` reads `schema: unmigrated`), and elasticmq (`:9324`). Compose and the venv
  both sign SendMessage (U7) with dummies elasticmq ignores: compose through the default
  chain's `AWS_*` env, the venv recipe with a static `GENEALOGY_SQS_*` pair, so neither
  reads `~/.aws` or probes IMDS.
- **The SPA** (`make web-proto`, Chrome on `127.0.0.1:5173`) — **verified in review on
  the compose stack 2026-09-14**: the auth stubs answer, sessions list and create, two
  messages round-trip POST → queue → shim → worker → `turn_done` → SSE with exactly two
  user bubbles in the DOM (the echo drop), the spinner clears on `turn_done`, and a reload
  halfway through a hand-seeded 25 s turn replays the whole transcript with no duplicates
  and comes back on **Stop** — the `status turn_active` frame landing after the replay.
  Tool chips, the thinking block, the phase rail and the live session title all render off
  SSE frames. Still to come: a real worker's turn driving the SPA (D17), which is also the
  run where the driver's strong "B resumed at A's last seq + 1" check returns.

- **The SPA from the tier** (`WEB_DIST_DIR`). `web/spa.py` serves the SSE build of
  `apps/web` at `/`, and the compose image carries it (a `node:24-slim` stage runs
  `VITE_SESSION_TRANSPORT=sse vite build`). It mounts no catch-all: `/` serves
  `index.html`, each top-level file of the dist gets its own route and each top-level
  directory a static mount, so every API status (405, the trailing-slash 307, a POST
  404) is what it was without the SPA. `index.html` and the root files are `no-cache`;
  the content-hashed `/assets/*` are `immutable`. A relative value resolves against the
  tier root (`web/`'s parent). Unset or empty serves no SPA, which is what the tests and
  `make proto-web` run. Set to a missing directory, one without `index.html`, or a dist
  with a top-level `api`, `auth` or `callback`, the tier refuses to start. `make web-proto`
  still serves the SPA from Vite's dev server.
- **Bundle** (`make eb-bundles` → `releases/eb-web.zip`). The same `/app` layout as the
  image (`web/`, `enqueue.py`, `grants.py`, `migrate.py`, `sql/`, `config/familysearch.json`,
  `web-dist/`) plus vendored wheels, the RDS CA bundle at `certs/`, and `../eb-web/`'s Procfile and
  `.ebextensions` at the root. Beanstalk runs
  `python -m uvicorn web.app:app --host 127.0.0.1 --port 8000` with `WEB_DIST_DIR=web-dist`;
  why each setting: `../eb-web/README.md`.

`QUEUE_URL` unset or empty refuses to start (a `RuntimeError` from the lifespan, U11): a
tier with no queue records a turn and nothing ever runs it. The driver's embedded tier is
the one queue-less mode, and it passes `drive.py`'s own `NullQueue` to `create_app`: the
turn is recorded (a `turns` row, a `user_msg` event) and never enqueued, and stays
`turn_active` until the seeder closes it through `worker.complete()` itself.

Env: `PG_DSN`, `QUEUE_URL` (a full queue URL, the shim's shape; required), `POLL_S` (1),
`SSE_PING_S` (15, capped at 15), `WEB_DIST_DIR` (unset: no SPA), `GENEALOGY_SQS_ACCESS_KEY` +
`GENEALOGY_SQS_SECRET_KEY` (both or neither; neither signs with the default AWS chain, the
instance profile on AWS; one alone refuses to start) and `GENEALOGY_SQS_REGION` (else the
`QUEUE_URL` host's region). The start line names the mode, never a key:
`queue: <url>; sqs credentials: <mode>; region <r>`.

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
`tests/test_proto_projects_pg.py` checks project ownership, labels, document times and
document versions against real Postgres; it skips without `PROTO_TEST_PG_DSN` outside CI.
The grant custody (U3): `tests/test_proto_grants.py` (the pure decisions and the numbers the locks rest on,
offline) and `tests/test_proto_grants_pg.py` (the lock interleavings against real Postgres;
it skips in `make proto-test` without `PROTO_TEST_PG_DSN`, and `make proto-grants-test` and CI
run it for real). Feedback (U20): `tests/test_proto_feedback.py` (the routes over a fake store
and bucket, and parity with the alpha's copy) and `tests/test_proto_feedback_pg.py` (the
transcript reads against real Postgres, run like the grants suite).
