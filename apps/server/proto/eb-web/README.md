# Beanstalk web-tier template

The Procfile and settings U12 bundles with the web tier (`../web/`) for a Beanstalk
web-server environment on the Python 3.12 AL2023 platform. Not deployed from here:
`make eb-bundles` copies this directory's files (not this README) to the root of
`releases/eb-web.zip`, and U13 is the first deploy.

| File | Role |
|---|---|
| `Procfile` | `python -m uvicorn web.app:app --host 127.0.0.1 --port 8000 --timeout-graceful-shutdown 10` |
| `.ebextensions/01-web.config` | `PORT`, `WEB_DIST_DIR`, the stream timings, the `PGSSL*` pair and `HealthCheckPath` |
| `.ebextensions/02-web-classic-elb.config` | Classic `ConnectionSettingIdleTimeout` 1800, alone in its file; ignored on an ALB |
| `.platform/hooks/prebuild/110_tools-proxy.sh` | With `TOOLS_UPSTREAM_URL` set, routes `/mcp`, `/.well-known/oauth-protected-resource/mcp` and `/img` to the tools tier; unset, does nothing |

`apps/server/tests/test_proto_bundles.py` pins the values against the bundle layout.

## Why these values

| Setting | Value | Why |
|---|---|---|
| Procfile `python` | `python -m uvicorn` | The platform's venv `python` (3.12). A bare AL2023 `python3` is 3.9, and `-m` binds uvicorn to the venv's interpreter. Without a Procfile the platform falls back to Gunicorn/WSGI. |
| `--host` | `127.0.0.1` | The app port stays behind nginx. |
| `--port` / `PORT` | `8000` | The Python platform's documented default upstream, so nginx reaches the tier even if a `PORT` property does not reconfigure it. A literal, because Procfile shell expansion is unconfirmed. |
| `--timeout-graceful-shutdown` | `10` | An open SSE stream would otherwise hold a deploy until systemd kills the process. |
| `WEB_DIST_DIR` | `web-dist` | The SSE build of `apps/web`, resolved against the tier root (`web/spa.py`). A missing dist refuses to start rather than serve nothing at `/`. Not `static/`, which the platform's nginx maps by default. |
| `POLL_S`, `SSE_PING_S` | `1`, `15` | The stream's poll and keep-alive. The ping stays under the edge alias's ~45 s idle cut (handoff F11), well inside nginx's read timeout (600 s, `01-web-uploads.conf`, set for the download), and the stream sends `X-Accel-Buffering: no`. The tier caps the ping at 15 s (`SSE_PING_MAX_S`), warning when a larger value is ignored. |
| `.platform/nginx/conf.d/01-web-headers.conf` | `large_client_header_buffers 4 32k` | Under an alias the tier receives the whole `.familysearch.org` cookie jar. nginx's default 8 KB per header line answered 400 to a Cookie header from ~8.3 KB, while the edge passes 13 KB. With 32k the edge is the binding limit: it refuses 14 KB in one header before the origin, and 18 KB across many cookies (handoff U28, 2026-10-31, n=1). `scripts/eb_bundles/verify.py` requires the file. |
| `.platform/nginx/conf.d/01-web-uploads.conf` | `client_max_body_size 26m`, `proxy_read_timeout 600s` | `POST /api/sessions/{id}/files` takes up to 25 MB (`UPLOAD_MAX_BYTES`) and the edge passes a 25 MiB body, but nginx's 1 MB default answered 413 to 1,100 KiB through the alias. With 26m a 25 MiB file reached the tier and 26.5 MiB got nginx's 413 (handoff U28, 2026-10-31, n=1). 26m leaves room for the multipart envelope. The project download is built before its first byte, and nginx's 60 s default read timeout would answer 504 on a large project first. The load balancer's idle timeout is unverified against a large download. `verify.py` requires the file. |
| `110_tools-proxy.sh` | `TOOLS_UPSTREAM_URL` unset: nothing | A connector deployment (the self-hosted beta's shape: chat off, `OAUTH_ISSUER` set) serves Claude's MCP endpoint and its sign-in on one origin, because the tools tier names its protected-resource metadata under the web tier's issuer. Set `TOOLS_UPSTREAM_URL` to the tools tier's internal `http(s)://host[:port]` (no path), and the hook writes `.platform/nginx/conf.d/elasticbeanstalk/10-tools-proxy.conf`, the same three paths malachi's edge routes to tools (`../malachi/nginx.conf`; a test fails if they differ). `/mcp` gets 1800 s timeouts and no buffering. The hook resolves the host per request through the instance's resolver, because a load balancer's addresses change. It runs at prebuild, before Beanstalk configures nginx from the staged files, and fails the deploy on a value with a path, query or user info. A configuration-only deploy does not re-run it, so change the value with an application deploy. Unset, which is the handoff's chat-on tier, nginx is as it was. `verify.py` requires the hook. On FamilySearch's platform (FS112 through Blueprint, 2026-11-25, n=1) the generated file took effect and the three paths reached the tools tier through the edge; a first deploy can bring web up before the tools tier's binding name exists, and the paths answer 502 until it does, then recover with no redeploy (handoff step 15). |
| `PGSSLMODE` / `PGSSLROOTCERT` | `verify-full` / `/var/app/current/certs/rds-global-bundle.pem` | libpq reads both natively. A DSN query string (`?sslmode=…&sslrootcert=…`) needs `?` and `&`, outside the environment-value character set. Keep `sslmode` out of the DSN: a DSN value overrides the environment. The CA bundle ships at `certs/` in the bundle. |
| `HealthCheckPath` | `/api/health` | Readiness: 503 until Postgres, the schema (the ledger at this build's level; `migrate.py` runs once per deploy, handoff step 6) and the allowlist are ok. |
| Logs | not set | Under Blueprint `StreamLogs: true` fails the launch (handoff step 14), so the deployer sets it; `rehearse.py` does. |

Under Blueprint the load balancer is Classic at 60 s (handoff F12), which `02-web-classic-elb.config` raises to 1,800 s for a proxied tool call and a slow download. On an ALB that file is ignored, and the ALB's 60 s default stands: a connector deployment on an ALB needs `aws:elbv2:loadbalancer` `IdleTimeout` 1800 set at API level.

Create the environment with `LoadBalancerType=application`
(`aws:elasticbeanstalk:environment`) on `create-environment`: the API default is `classic`,
and AWS documents that the type can be set neither from `.ebextensions` nor after creation.

Set at API level, never here: `PG_DSN`, `QUEUE_URL`, `PUBLIC_URL`, `SESSION_SECRET`,
`FS_TOKEN_ENC_KEY`, `FAMILYSEARCH_WEB_ENABLED`, `ALLOWED_EMAILS` and, for a connector
deployment only, `TOOLS_UPSTREAM_URL`. Write
`ALLOWED_EMAILS` **space-separated** on Beanstalk: a comma is outside the
environment-value character set, and `web/auth.py` splits on commas and whitespace alike.
`MIGRATE_PG_DSN` is set on no environment, here or at API level: it is the schema-owning
role's DSN, for the operator's step 6 run of the bundle's `migrate.py` only, and `PG_DSN`
may be DML-only (the grants: the handoff's step 6).
