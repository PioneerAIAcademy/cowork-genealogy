# Prototype tool server (D16)

The genealogy engine (`packages/engine/mcp-server`) on **Streamable HTTP** for the
search-agent prototype (`docs/plan/search-agent-prototype.md`, Week 4, D16). It is a
second entrypoint over the one `createServer(principal)` in `src/server.ts`, never a
replacement: `build/index.js` keeps stdio and the `.mcpb` is unchanged, and
`build/http.js` runs the same tools over `node:http`. One process serves every patron's
turns, so the store is bound **per request**: a `PgS3ProjectStore` on the compose
Postgres/S3, selected by the `X-Genealogy-Project-Id` header.

## The contract

| Route | What |
|---|---|
| `POST /mcp` | Stateless Streamable HTTP, JSON responses (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). One `Server` + transport per request, closed after the response. |
| `GET` / `DELETE` / anything else on `/mcp` | `405`, `Allow: POST`, `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}` — answered by the entrypoint before any transport exists, so a client's post-initialize `GET` never gets a held-open SSE stream. The SDK client and the Claude Code CLI treat that 405 as "no server-push stream" and continue. |
| `GET /healthz` | Readiness: a fresh Postgres connection that sees the store tables (`documents`, `blobs`, `staging`, `projects`, and `turns`, which the claim fence and the project check read, with its `bearer_sha256` column from `012_turn_bearer.sql`) and `HeadBucket` on the bucket, under one 1.5 s deadline. `200` when both pass, `503` when either fails, same body either way: `{"ok":<bool>,"tools":<allToolSchemas.length>,"checks":{"postgres":{"ok":<bool>,"error"?:<label>},"s3":{…}}}`. `error` is a label only (an error code such as `ECONNREFUSED`, a name such as `TimeoutError`, `schema: missing <tables>`, or `schema: missing turns.bearer_sha256` on a database without 012), never a message; the message goes to stderr once per state change. A probe that rejects or outlives 2 s is `503` with no `checks`. A failing store never exits the process. The compose healthcheck and `make engine-smoke-http`'s readiness wait. |
| `X-Genealogy-Project-Id` (request header) | The project the request's tools run against, matched against `PROJECT_ID_RE` (`src/store/project-id.ts`). Exactly one value; malformed or duplicated → `400 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid X-Genealogy-Project-Id header."},"id":null}` before any transport exists. |
| `X-Genealogy-Turn-Id` + `X-Genealogy-Claim-Epoch` (request headers; required with a project, U4) | The claim fence (U6): the worker attempt's turn id (the `PROJECT_ID_RE` shape) and its `claim_epoch` (`[1-9][0-9]{0,17}`), both or neither. Exactly one of the two, a duplicated value, one that misses its pattern after trimming, or a fence without `X-Genealogy-Project-Id` → `400 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid claim fence: send X-Genealogy-Turn-Id and X-Genealogy-Claim-Epoch together, once each, with X-Genealogy-Project-Id."},"id":null}` before any transport exists. A project request without the pair passes the 400 checks and is refused `403` below: the turn id is the project check's key. |
| Project check (U4, every request with `X-Genealogy-Project-Id`) | After the `400` checks and before any store or transport, `authorizeAttempt` (`src/store/pg-s3-project-store.ts`) admits the request only if an **open** `turns` row with this turn id and project carries `bearer_sha256` equal to the sha256 (hex) of the request's bearer: `SELECT 1 FROM turns WHERE turn_id = $1 AND project_id = $2 AND bearer_sha256 = $3 AND completed_at IS NULL`. It does not test `claim_epoch`; supersession stays with the fence's in-band `StaleClaimError`. Refused (no fence, an empty bearer, or no such row) → `403 {"jsonrpc":"2.0","error":{"code":-32600,"message":"This bearer is not the grant of an open attempt on this project."},"id":null}`, the same body for every reason, and one stderr line `ev=tool_refused reason=<no_fence\|empty_bearer\|no_match> project_id=… turn_id=…` that never carries the bearer or its hash. The check itself failing (Postgres down) → `503 {"jsonrpc":"2.0","error":{"code":-32603,"message":"Project authorization is unavailable."},"id":null}` and `ev=tool_authorize_failed error=<code> project_id=…`, never an admission. A request with no project header is not checked. |
| any other path | `404` JSON. |

**Header → principal.** `Authorization: Bearer <token>` becomes
`bearerPrincipal(token, baseConfig)` for the duration of that request; a missing or
malformed header becomes a bearer with an **empty** token, so FamilySearch tools answer
`HOSTED_REAUTH_INSTRUCTION` (`isError`). The server **never** binds `LOCAL` — that fallback
is the cross-patron impersonation door the principal seam exists to close. A bearer never
refreshes and never touches `~/.familysearch-mcp/tokens.json`.

**Header → store.** `X-Genealogy-Project-Id: <id>` becomes
`new PgS3ProjectStore(backend, { projectId: id, anchorPath })` for the duration of that
request, bound with `runWithProjectStore` so every `getProjectStore()` call in the tool
body, the utils and the validator resolves to it (`src/store/project-store.ts`). One
`createPgS3Backend` per process, from the `GENEALOGY_*` store variables plus
`GENEALOGY_ANCHOR_PATH` (`readPgS3Env`): `GENEALOGY_PG_DSN` and `GENEALOGY_S3_BUCKET`
required; `GENEALOGY_S3_ACCESS_KEY` + `GENEALOGY_S3_SECRET_KEY` an optional pair — both set
signs with them, neither set leaves the S3 client to the AWS SDK default chain (environment,
`~/.aws` shared config/SSO, web identity, then ECS/EC2 instance metadata — so a host-process
run on a laptop with `~/.aws` signs with the developer's profile); `GENEALOGY_S3_REGION` (default `us-east-1`);
`GENEALOGY_S3_ENDPOINT` (unset on AWS: the regional endpoint); `GENEALOGY_S3_FORCE_PATH_STYLE`
(`true`/`false`, default `true` when an endpoint is set and `false` otherwise). A missing
required variable, exactly one of the two keys, or a path-style value other than
`true`/`false` is one stderr line and exit 2 before `listen`; otherwise one stderr line names
the credential mode (`static keys` or `SDK default chain`), the region and the endpoint. The
same process runs the S3 orphan sweep (`src/store/s3-orphan-sweep.ts`, U19), which deletes an
object no `blobs` or `staging` row points at once it is older than `GENEALOGY_ORPHAN_GRACE_S`
(default 86400, at least 3600), every `GENEALOGY_ORPHAN_SWEEP_INTERVAL_S` (default 3600, `0` off, at most 2147483: Node's
timer limit); either one not a whole number of seconds, a grace under 3600 or an interval over
2147483 also exits 2. The projectPath every call passes
is the anchor (`/project`). With the header **missing**, the request is bound to an
`unboundProjectStore` whose every method rejects with an instruction naming the header:
tools that take no `projectPath` (`convert_calendar`, the FamilySearch searches, …) still
answer, and the project tools (`project_create`, `research_append`, …) return that
instruction as an `isError` result. The process store is the same unbound store, so no
path — inside a request or outside one — ever reaches `FsProjectStore`. Malformed → `400`,
above.

**Header → fence.** `X-Genealogy-Turn-Id: <turn>` with `X-Genealogy-Claim-Epoch: <n>` adds
`fence: { turnId, claimEpoch }` to that request's store. A fenced store writes only inside a
transaction — `writeJson`, `writeBytes` and `remove` get one of their own instead of
autocommitting — and that transaction runs `CLAIM_PRECHECK_SQL` right after `BEGIN` and
`CLAIM_FENCE_SQL` (the same `turns` lookup on turn, project and epoch, `FOR SHARE`) right
before `COMMIT`. When a newer claim of the turn has moved `claim_epoch` on, the write rolls
back (the objects it put are deleted) and the tool answers `isError` with `StaleClaimError`'s
text: "This turn was taken over by a newer attempt (turn <id>: claim epoch <n> is no longer
current), so this write was rolled back and nothing was saved. Stop working on this turn."
The share lock conflicts with the claim's row lock, so a commit racing an in-flight claim
waits for it and then re-reads the epoch. Reads are never fenced. Without the pair the store
autocommits exactly as before. The worker sends the pair on every call
(`options.tool_server_headers`).

`baseConfig` is `~/.familysearch-mcp/config.json`, read once at startup with
`loadConfig(LOCAL)`, and then the seven keys `PER_USER_ENV` names (`WIKI_API_URL`,
`POP_STATS_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `WEB_PUBLIC_URL`,
`UPLOADS_ENABLED`, `TRANSCRIPTION_ENABLED`) from the environment over it
(`src/hosted-config-env.ts`), and only where set, so an absent one leaves the file's value
and then the compiled default. A switch other than `true`/`false`, or a `WEB_PUBLIC_URL`
that is not a plain http(s) URL, exits 2 before listening. In compose the file is
`./config.json` (`{"hosted": true}`) mounted read-only and the seven come from the `tools` service's environment: a container receives a secret as
environment, not as a file in an image. One shared process, so these are per-stack rather
than per patron — which is what a one-patron prototype wants; per-patron config would have
to ride the request, as the bearer and the project id do.

**Owner check (U4).** The service has no identity of its own: it checks only that the
bearer is the one the worker stamped on the open turn it names, of the project it names. The
worker writes that stamp (`STAMP_BEARER_SQL`, the sha256 of the grant token it hands the
CLI) after `acquire_grant` and before the CLI exists, and every claim of an open turn clears
it in the same `UPDATE` that mints the epoch, so an older attempt's token stops passing once
a newer claim exists. The turn row is the web tier's and the grant the project owner's (U4's
worker half), so the stamp is the owner's token by construction; a NULL-owner project is
never stamped and matches nobody. There is no opt-out. The service still publishes on
**loopback only** (`127.0.0.1:8787`), the same rule as `../web`. Inside the compose network
it is `tools:8787`.

Not built here (cut with the ledger, 2026-09-10): the `turn_id` header, the HTTP re-run of
the D15 ledger exercise. The three auth tools — `login`, `logout`,
`auth_status` — are advertised but inert over HTTP: every request is a bearer principal, so
`login` and `logout` answer the hosted-mode instructions (`isError` false) without touching
`tokens.json`, and `auth_status` answers from the bearer alone; it is excluded with them so the
smoke names all three.

## Running it

- **Compose** (`make proto-up`, or `docker-compose -f apps/server/proto/docker-compose.yml up -d --build tools`
  on a machine without the compose plugin): service `tools`, container `proto-tools`,
  `read_only: true` with `/tmp` the only tmpfs, the `GENEALOGY_*` store block,
  `depends_on` `postgres` and `minio` `service_healthy` and `migrate`
  `service_completed_successfully`, so `up -d --build tools` also runs the one-shot
  `migrate` service (U9) first; the tools tier itself runs no DDL. The image is built
  from the **repo root** (`Dockerfile` here): the root `.dockerignore` already drops
  `node_modules`/`.claude`/`eval`/`releases`, and `src/` is compiled inside the image — the
  host's `build/` is never copied. `proto-up-core` and `proto-smoke` do not include it.
- **Host process**: `cd packages/engine/mcp-server && GENEALOGY_PG_DSN=… GENEALOGY_S3_ENDPOINT=… GENEALOGY_S3_BUCKET=… [GENEALOGY_S3_ACCESS_KEY=… GENEALOGY_S3_SECRET_KEY=…] node build/http.js [--host 127.0.0.1] [--port 8787]`
  (the keys are an optional pair: omit both to sign through the AWS SDK default chain)
  — `make engine-smoke-http` does this against the compose store (`proto-up-store`,
  localhost:5434 / :9000).
- **Bundle** (`make eb-bundles` → `releases/eb-tools.zip`, U12). The Beanstalk source
  bundle for the Node.js AL2023 platform (24, or 22: npm never runs there because
  `node_modules/` ships). At its root: `build/` from `npm run build` (so
  `build/build-info.json` stamps the real sha), `config/`, a production `node_modules/`
  with the optional `pg` and AWS SDK packages kept, `package.json` (for
  `"type": "module"`), the compiled smoke under `smoke/`
  (`packages/engine/mcp-server/tsconfig.smoke.json`), the RDS CA bundle at
  `certs/rds-global-bundle.pem`, and `../eb-tools/`'s `Procfile`, `.ebextensions/` and
  `.platform/` copied verbatim. The Procfile runs `node build/http.js --host 127.0.0.1
  --port 8080`, equal to the template's `PORT`; the template sets
  `PGSSLMODE=verify-full` and `NODE_EXTRA_CA_CERTS` at the CA's absolute path, so TLS is
  configured without a query string in `GENEALOGY_PG_DSN`. The store variables and the
  seven config overrides above stay API-level settings. The image (`Dockerfile`) and the
  bundle both run Node 24.
- **The transport smoke** — every advertised tool but the three exclusions, in
  `no-bearer` mode by default (`--bearer <token>`, or an unexpired
  `~/.familysearch-mcp/tokens.json`, switches to `bearer`). It needs the database the
  server reads (`--pg-dsn`, else `GENEALOGY_PG_DSN`; exit 2 without either), because the
  project rows must pass the owner check:

  ```
  make engine-smoke-http                                  # builds, starts build/http.js on the compose store on a free port, kills it after
  BASE=http://127.0.0.1:8787 make engine-smoke-http       # against the compose service
  node smoke/dev/smoke-http.js --base URL --pg-dsn DSN [--project-id ID] [--project-path /project] [--host-config] [--bearer TOKEN]   # from an unzipped eb-tools.zip: Node >= 22, no checkout, npm or registry
  ```

  Two clients. The first sends no project header and the real bearer when there is one; it
  lists the tools and runs every row that passes no `projectPath` (the FamilySearch and
  store-less tools). The second runs every row that passes `--project-path` (the anchor,
  `/project`) as its `projectPath`: it sends `X-Genealogy-Project-Id: <--project-id>` — a
  fresh `smoke-<uuid>` by default, `SMOKE_PROJECT_ID=…` to override — and the fence of a
  `turns` row the smoke seeds open at epoch 1 and stamped with a synthetic random bearer's
  sha256, which it deletes on every exit path (SIGINT and SIGTERM included). Both Makefile
  arms pass `--pg-dsn` (`PROTO_PG_DSN`, or `NODE_PG_DSN`, the URL form node-postgres parses, on the `BASE=` arm), and the Makefile
  prints the per-table psql counts under that id after the run, `turns` 0 once the seeded
  row is gone. `--host-config` says the server's `baseConfig` is
  this host's `~/.familysearch-mcp/config.json` (the default arm; not the `BASE=` arm,
  whose compose `config.json` is `{"hosted": true}`). The smoke fails if any advertised
  tool is neither called nor a named exclusion, or if a named exclusion is not advertised.

## The D9–10 consumer

The worker registers this service under the key `genealogy` (the same key `.mcp.json`, both
harnesses and the hosted control plane use, so every agent's `mcp__genealogy__…` spelling
resolves):

```python
mcp_servers={"genealogy": {"type": "http", "url": "http://tools:8787/mcp",
                           "headers": {"Authorization": "Bearer <patron token>",
                                       "X-Genealogy-Project-Id": "<project id>"}}}
```

The URL is the worker's `TOOL_SERVER_URL`, required with no default (U11); compose sets
the value above. Both headers are per turn (`proto/worker/options.py`, `tool_server_headers`): the bearer
from the patron's row, the project id from the turn. The project header is always sent; the
bearer only when there is a token. The fence pair (U6) rides with them, and the attempt stamps
its bearer's sha256 on the turn before the CLI starts, so its requests pass the owner check. Nothing on this service caches either. This is the
worker's only tool server; the worker itself carries no Node, no engine and no S3
credentials.

## Tests

`apps/server/tests/test_proto_config.py` (`make proto-test`): the service is read-only with
`/tmp` the only tmpfs (no `/projects`), publishes on loopback only, depends on `postgres`
and `minio` `service_healthy` and on `migrate` completing
(`test_migrate_is_the_only_schema_applier`), reads the Postgres the worker reads
(`GENEALOGY_PG_DSN` is the worker's `PG_DSN`) under the worker's anchor
(`GENEALOGY_ANCHOR_PATH` is its `WORKER_CWD`), and `proto-up` waits on it while
`proto-up-core` does not.
`apps/server/tests/test_proto_worker.py` pins the consumer's two headers.
`packages/engine/mcp-server/tests/http/` covers the server itself (405 guard, `/healthz` 200/503 from the readiness report and the spawned server's 503 with both stores unreachable,
no-`LOCAL`, per-request bearers, per-request stores that cannot read each other, the
missing-header instruction, the malformed-header 400, the owner check's 403 and 503 and its
log line); `http-server-pg.test.ts` runs the isolation case, every owner-check outcome
(another patron's project, turn or bearer, no bearer, no fence, a NULL-owner project, a
completed turn, a re-claim not yet stamped, a refresh between attempts) with the refused
project's rows unchanged, a healthy `/healthz`, and `/healthz` 503 on a database without
`bearer_sha256`, on the real Pg store under `make proto-store-test`.
`apps/server/tests/test_proto_fencing_pg.py` drives the worker's stamp through two real
tool-server processes.
`tests/store/pg-s3-project-store.test.ts` covers the probe itself (deadline, single flight,
no S3 retry, label-only errors, the missing-schema and saturated-pool cases).
