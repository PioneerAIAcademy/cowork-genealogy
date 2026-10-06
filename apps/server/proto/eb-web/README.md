# Beanstalk web-tier template

The Procfile and settings U12 bundles with the web tier (`../web/`) for a Beanstalk
web-server environment on the Python 3.12 AL2023 platform. Not deployed from here:
`make eb-bundles` copies this directory's files (not this README) to the root of
`releases/eb-web.zip`, and U13 is the first deploy.

| File | Role |
|---|---|
| `Procfile` | `python -m uvicorn web.app:app --host 127.0.0.1 --port 8000 --timeout-graceful-shutdown 10` |
| `.ebextensions/01-web.config` | `PORT`, `WEB_DIST_DIR`, the stream timings, the nudge cap, the `PGSSL*` pair, `HealthCheckPath` and log streaming |

`apps/server/tests/test_proto_bundles.py` pins the values against the bundle layout.

## Why these values

| Setting | Value | Why |
|---|---|---|
| Procfile `python` | `python -m uvicorn` | The platform's venv `python` (3.12). A bare AL2023 `python3` is 3.9, and `-m` binds uvicorn to the venv's interpreter. Without a Procfile the platform falls back to Gunicorn/WSGI. |
| `--host` | `127.0.0.1` | The app port stays behind nginx. |
| `--port` / `PORT` | `8000` | The Python platform's documented default upstream, so nginx reaches the tier even if a `PORT` property does not reconfigure it. A literal, because Procfile shell expansion is unconfirmed. |
| `--timeout-graceful-shutdown` | `10` | An open SSE stream would otherwise hold a deploy until systemd kills the process. |
| `WEB_DIST_DIR` | `web-dist` | The SSE build of `apps/web`, resolved against the tier root (`web/spa.py`). A missing dist refuses to start rather than serve nothing at `/`. Not `static/`, which the platform's nginx maps by default. |
| `POLL_S`, `SSE_PING_S` | `1`, `15` | The stream's poll and keep-alive. The ping stays under nginx's 60 s read timeout, and the stream sends `X-Accel-Buffering: no`, so no nginx file ships. |
| `AUTONOMOUS_MAX_NUDGES` | `60` | The operator's nudge cap, stamped on every queue message. |
| `PGSSLMODE` / `PGSSLROOTCERT` | `verify-full` / `/var/app/current/certs/rds-global-bundle.pem` | libpq reads both natively. A DSN query string (`?sslmode=…&sslrootcert=…`) needs `?` and `&`, outside the environment-value character set. Keep `sslmode` out of the DSN: a DSN value overrides the environment. The CA bundle ships at `certs/` in the bundle. |
| `HealthCheckPath` | `/api/health` | Readiness: 503 until Postgres, the schema (the ledger at this build's level; `migrate.py` runs once per deploy, handoff step 6) and the allowlist are ok. |
| Logs | `StreamLogs: true`, `DeleteOnTerminate: false` | Retention is FamilySearch's call. |

Create the environment with `LoadBalancerType=application`
(`aws:elasticbeanstalk:environment`) on `create-environment`: the API default is `classic`,
and AWS documents that the type can be set neither from `.ebextensions` nor after creation.

Set at API level, never here: `PG_DSN`, `QUEUE_URL`, `PUBLIC_URL`, `SESSION_SECRET`,
`FS_TOKEN_ENC_KEY`, `FAMILYSEARCH_WEB_ENABLED` and `ALLOWED_EMAILS`. Write
`ALLOWED_EMAILS` **space-separated** on Beanstalk: a comma is outside the
environment-value character set, and `web/auth.py` splits on commas and whitespace alike.
`MIGRATE_PG_DSN` is set on no environment, here or at API level: it is the schema-owning
role's DSN, for the operator's step 6 run of the bundle's `migrate.py` only, and `PG_DSN`
may be DML-only (the grants: the handoff's step 6).
