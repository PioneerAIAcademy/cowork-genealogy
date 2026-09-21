# Prototype tool server (D16)

The genealogy engine (`packages/engine/mcp-server`) on **Streamable HTTP** for the
search-agent prototype (`docs/plan/search-agent-prototype.md`, Week 4, D16). It is a
third entrypoint over the one `createServer(principal)` in `src/server.ts`, never a
replacement: `build/index.js` keeps stdio and the `.mcpb` is unchanged,
`build/hosted-stdio.js` is the per-turn stdio fork on Postgres/S3 (D9–10), and
`build/http.js` runs the same tools over `node:http`. One process serves every patron's
turns, so the store is bound **per request**: a `PgS3ProjectStore` on the compose
Postgres/S3 — the same store `hosted-stdio.js` opens per turn — selected by the
`X-Genealogy-Project-Id` header.

## The contract

| Route | What |
|---|---|
| `POST /mcp` | Stateless Streamable HTTP, JSON responses (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). One `Server` + transport per request, closed after the response. |
| `GET` / `DELETE` / anything else on `/mcp` | `405`, `Allow: POST`, `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}` — answered by the entrypoint before any transport exists, so a client's post-initialize `GET` never gets a held-open SSE stream. The SDK client and the Claude Code CLI treat that 405 as "no server-push stream" and continue. |
| `GET /healthz` | `200 {"ok":true,"tools":<allToolSchemas.length>}` — the compose healthcheck and `make engine-smoke-http`'s readiness wait. |
| `X-Genealogy-Project-Id` (request header) | The project the request's tools run against, matched against `PROJECT_ID_RE` (`src/store/project-id.ts`). Exactly one value; malformed or duplicated → `400 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid X-Genealogy-Project-Id header."},"id":null}` before any transport exists. |
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
`createPgS3Backend` per process, from the five `GENEALOGY_*` store variables plus
`GENEALOGY_ANCHOR_PATH` (`readPgS3Env`, the same reader `hosted-stdio.js` uses; a missing
variable is one stderr line and exit 2 before `listen`). The projectPath every call passes
is the anchor (`/project`). With the header **missing**, the request is bound to an
`unboundProjectStore` whose every method rejects with an instruction naming the header:
tools that take no `projectPath` (`convert_calendar`, the FamilySearch searches, …) still
answer, and the project tools (`project_create`, `research_append`, …) return that
instruction as an `isError` result. The process store is the same unbound store, so no
path — inside a request or outside one — ever reaches `FsProjectStore`. Malformed → `400`,
above.

`baseConfig` is `~/.familysearch-mcp/config.json`, read once at startup with
`loadConfig(LOCAL)`, and then `WIKI_API_URL`, `POP_STATS_URL`, `OPENROUTER_API_KEY` and
`OPENROUTER_MODEL` from the environment over it — the same four `hosted-stdio.js` reads,
and only where set, so an absent one leaves the file's value and then the compiled
default. In compose the file is `./config.json` (`{"hosted": true}`) mounted read-only
and the four come from the `tools` service's environment: a container receives a secret
as environment, not as a file in an image, and since 2026-09-20 the worker's default is
this service, so `image_transcribe`'s key has to arrive here rather than in the per-turn
fork that used to carry it. One shared process, so these are per-stack rather than per
patron — which is what a one-patron prototype wants; per-patron config would have to
ride the request, as the bearer and the project id do.

**There is no auth on this service** beyond header → principal, and no check that the
bearer may reach the project id it names: identity is the web tier's problem and out of the
prototype's scope, so the service publishes on **loopback only** (`127.0.0.1:8787`), the
same rule as `../web`. Inside the compose network it is `tools:8787`.

Not built here (cut with the ledger, 2026-09-10): the `turn_id` header, the HTTP re-run of
the D15 ledger exercise. The four auth tools — `login`, `logout`, `configure_openrouter`,
`auth_status` — are advertised but inert over HTTP: every request is a bearer principal, so
`login` and `logout` answer the hosted-mode instructions (`isError` false) without touching
`tokens.json`, `configure_openrouter`'s `saveConfig` throws `HOSTED_CONFIG_READ_ONLY_MESSAGE`
before any write (the `read_only` rootfs and the `:ro` `config.json` mount are never
reached), and `auth_status` answers from the bearer alone; it is excluded with them so the
smoke names all four.

## Running it

- **Compose** (`make proto-up`, or `docker-compose -f apps/server/proto/docker-compose.yml up -d --build tools`
  on a machine without the compose plugin): service `tools`, container `proto-tools`,
  `read_only: true` with `/tmp` the only tmpfs, the worker's `GENEALOGY_*` block verbatim,
  `depends_on` `postgres` and `minio` `service_healthy`. The image is built from the
  **repo root** (`Dockerfile` here): the root `.dockerignore` already drops
  `node_modules`/`.claude`/`eval`/`releases`, and `src/` is compiled inside the image — the
  host's `build/` is never copied. `proto-up-core` and `proto-smoke` do not include it.
- **Host process**: `cd packages/engine/mcp-server && GENEALOGY_PG_DSN=… GENEALOGY_S3_ENDPOINT=… GENEALOGY_S3_BUCKET=… GENEALOGY_S3_ACCESS_KEY=… GENEALOGY_S3_SECRET_KEY=… node build/http.js [--host 127.0.0.1] [--port 8787]`
  — `make engine-smoke-http` does this against the compose store (`proto-up-store`,
  localhost:5434 / :9000).
- **The transport smoke** — every advertised tool but the four exclusions, in
  `no-bearer` mode by default (`--bearer <token>`, or an unexpired
  `~/.familysearch-mcp/tokens.json`, switches to `bearer`):

  ```
  make engine-smoke-http                                  # builds, starts build/http.js on the compose store on a free port, kills it after
  BASE=http://127.0.0.1:8787 make engine-smoke-http       # against the compose service
  cd packages/engine/mcp-server && npx tsx dev/smoke-http.ts --base URL [--project-id ID] [--project-path /project] [--host-config] [--bearer TOKEN]
  ```

  Every request carries `X-Genealogy-Project-Id: <--project-id>` — a fresh `smoke-<uuid>`
  by default, `SMOKE_PROJECT_ID=…` to override — and every call passes `--project-path`
  (the anchor, `/project`) as its `projectPath`; the Makefile prints the per-table psql
  counts under that id after the run. `--host-config` says the server's `baseConfig` is
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

Both headers are per turn (`proto/worker/options.py`, `tool_server_headers`): the bearer
from the patron's row, the project id from the turn — the same id the stdio fork gets as
`GENEALOGY_PROJECT_ID`. The project header is always sent; the bearer only when there is a
token. Nothing on this service caches either.

## Tests

`apps/server/tests/test_proto_config.py` (`make proto-test`): the service is read-only with
`/tmp` the only tmpfs (no `/projects`), publishes on loopback only, depends on `postgres`
and `minio` `service_healthy`, carries the worker's `GENEALOGY_*` values byte for byte (one
store, two readers), and `proto-up` waits on it while `proto-up-core` does not.
`apps/server/tests/test_proto_worker.py` pins the consumer's two headers.
`packages/engine/mcp-server/tests/http/` covers the server itself (405 guard, `/healthz`,
no-`LOCAL`, per-request bearers, per-request stores that cannot read each other, the
missing-header instruction, the malformed-header 400); `http-server-pg.test.ts` runs the
isolation case on the real Pg store under `make proto-store-test`.
