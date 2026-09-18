# Prototype tool server (D16)

The genealogy engine (`packages/engine/mcp-server`) on **Streamable HTTP** for the
search-agent prototype (`docs/plan/search-agent-prototype.md`, Week 4, D16). It is a
third entrypoint over the one `createServer(principal)` in `src/server.ts`, never a
replacement: `build/index.js` keeps stdio and the `.mcpb` is unchanged,
`build/hosted-stdio.js` is the per-turn stdio fork on Postgres/S3 (D9–10), and
`build/http.js` runs the same tools over `node:http`. The store here is `FsProjectStore`
under `/projects`, exactly as the desktop runs it; how a shared HTTP server scopes
`PgS3ProjectStore` per request is the D9–10 worker half's question, not this service's.

## The contract

| Route | What |
|---|---|
| `POST /mcp` | Stateless Streamable HTTP, JSON responses (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). One `Server` + transport per request, closed after the response. |
| `GET` / `DELETE` / anything else on `/mcp` | `405`, `Allow: POST`, `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}` — answered by the entrypoint before any transport exists, so a client's post-initialize `GET` never gets a held-open SSE stream. The SDK client and the Claude Code CLI treat that 405 as "no server-push stream" and continue. |
| `GET /healthz` | `200 {"ok":true,"tools":<allToolSchemas.length>}` — the compose healthcheck and `make engine-smoke-http`'s readiness wait. |
| any other path | `404` JSON. |

**Header → principal.** `Authorization: Bearer <token>` becomes
`bearerPrincipal(token, baseConfig)` for the duration of that request; a missing or
malformed header becomes a bearer with an **empty** token, so FamilySearch tools answer
`HOSTED_REAUTH_INSTRUCTION` (`isError`). The server **never** binds `LOCAL` — that fallback
is the cross-patron impersonation door the principal seam exists to close. A bearer never
refreshes and never touches `~/.familysearch-mcp/tokens.json`.

`baseConfig` is `~/.familysearch-mcp/config.json`, read once at startup with
`loadConfig(LOCAL)`. In compose that is `./config.json` (`{"hosted": true}`) mounted
read-only; sidecar URLs keep the compiled defaults, and an `openRouterApiKey` goes in that
file, never in an env var. Per-user config overrides are out of scope (one patron).

**There is no auth on this service** beyond header → principal: identity is the web tier's
problem and out of the prototype's scope, so the service publishes on **loopback only**
(`127.0.0.1:8787`), the same rule as `../web`. Inside the compose network it is `tools:8787`.

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
  `read_only: true` with `/projects` and `/tmp` on tmpfs, no `depends_on`. The image is
  built from the **repo root** (`Dockerfile` here): the root `.dockerignore` already drops
  `node_modules`/`.claude`/`eval`/`releases`, and `src/` is compiled inside the image — the
  host's `build/` is never copied. `proto-up-core` and `proto-smoke` do not include it.
- **Host process**: `cd packages/engine/mcp-server && node build/http.js [--host 127.0.0.1] [--port 8787]`.
- **The transport smoke** — every advertised tool but the four exclusions, in
  `no-bearer` mode by default (`--bearer <token>`, or an unexpired
  `~/.familysearch-mcp/tokens.json`, switches to `bearer`):

  ```
  make engine-smoke-http                                            # builds, starts build/http.js on a free port, kills it after
  BASE=http://127.0.0.1:8787 PROJECT_ROOT=/projects make engine-smoke-http   # against the compose service
  cd packages/engine/mcp-server && npx tsx dev/smoke-http.ts --base URL --project-root PATH [--bearer TOKEN]
  ```

  `PROJECT_ROOT` is where the smoke's project is created — `/projects` inside the
  container; unset on the host, it picks a `mkdtemp`. The smoke fails if any advertised tool
  is neither called nor a named exclusion, or if a named exclusion is not advertised.

## The D9–10 consumer

The worker registers this service under the key `genealogy` (the same key `.mcp.json`, both
harnesses and the hosted control plane use, so every agent's `mcp__genealogy__…` spelling
resolves):

```python
mcp_servers={"genealogy": {"type": "http", "url": "http://tools:8787/mcp",
                           "headers": {"Authorization": "Bearer <patron token>"}}}
```

The bearer is per turn, read from the patron's row; nothing on this service caches it.

## Tests

`apps/server/tests/test_proto_config.py` (`make proto-test`): the service is read-only with
`/projects` on tmpfs, publishes on loopback only, has no `depends_on`, and `proto-up` waits
on it while `proto-up-core` does not. `packages/engine/mcp-server/tests/http/` covers the
server itself (405 guard, `/healthz`, no-`LOCAL`, per-request bearers).
