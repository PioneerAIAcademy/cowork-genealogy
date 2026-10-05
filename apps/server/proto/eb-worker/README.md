# Beanstalk worker-tier template

The Procfile, sqsd, runtime and nginx settings, and the predeploy hook, that the U12
builder (`scripts/eb_bundles/build.py`) copies verbatim to the root of
`releases/eb-worker.zip` with the worker (`../worker/`) for the Python 3.12 AL2023
platform. This README is not shipped. Not deployed from here: U13 is the first deploy
(`docs/plan/familysearch-handoff.md`, step 10).

| File | Role |
|---|---|
| `Procfile` | `web: python proto/worker/worker.py`, no arguments: the worker reads `PORT` from the environment. `python` is the platform venv's 3.12 (a bare AL2023's `/usr/bin/python3` is 3.9). Mandatory: without one the platform falls back to Gunicorn/WSGI. |
| `.ebextensions/01-sqsd.config` | The interim sqsd options (handoff step 11; "Why these values" below) and the `SQSD_*` / `SWEEP_INTERVAL_S` values the worker reads for its last-receive close and dead-letter sweep |
| `.ebextensions/02-worker.config` | `PORT=8000` (the platform's default nginx upstream; the code default is 8080), `ENGINE_PLUGIN_DIR=/opt/genealogy/plugin`, `WORKER_CWD=/project`, `TMPDIR=/tmp`, `PGSSLMODE=verify-full` and `PGSSLROOTCERT` at the bundle's `certs/rds-global-bundle.pem`, one instance (`asg` 1/1), CloudWatch log streaming kept after terminate. No option is also set in `01-sqsd.config`. |
| `.platform/hooks/predeploy/01-worker-layout.sh` | Root, before the Procfile starts, idempotent: moves `./plugin` to `/opt/genealogy/plugin` (root-owned, dirs 0755, files 0644, built beside the live copy and renamed in), creates `/project` root-owned 0555 and fails if it is not empty, fails unless `/tmp` is a tmpfs, and makes the staging app directory root-owned and not group/other-writable. Git mode 100755. |
| `.platform/nginx/conf.d/01-worker-timeouts.conf` | `proxy_read_timeout 43200s`, above `InactivityTimeout` (step 12) |

`apps/server/tests/test_proto_config.py` pins the values: `InactivityTimeout` at
Beanstalk's maximum, `VisibilityTimeout` above it and within SQS's 43200, each `SQSD_*`
equal to its sqsd option, `ErrorVisibilityTimeout` above the worker's stop grace, and
nginx above `InactivityTimeout`. Compose mirrors them with `../docker-compose.sqsd.yml`.
`apps/server/tests/test_proto_bundles.py` pins the rest: the Procfile has no arguments
and the template sets `PORT=8000`, `ENGINE_PLUGIN_DIR` is the hook's destination, the CA
path equals `scripts/eb_bundles/layout.py`'s, every environment value is inside
Beanstalk's character set with no secret or dev-only variable, no option is set in two
files, and the hook carries `set -euo pipefail` and the git exec bit.

- **Not in the bundle:** `PG_DSN`, `QUEUE_URL`, `MODEL_PROVIDER` and every key, all
  API-level settings (among the keys `FS_TOKEN_ENC_KEY`, the web tier's grant key, the same
  value: the worker decrypts each patron's grant with it, U3), and `PYTHONPATH` and `HOME`, which the worker does not need (it puts
  its own root on `sys.path`).
- **The plugin hook's interpreter.** The worker puts its own interpreter's directory first
  on the CLI child's `PATH`, and at start refuses (exit 2, `ev=prepare step=hook_python`)
  a first `python3` there that is missing or below 3.10; `ev=start` logs `hook_python`.
- **Why the hook chowns staging** (R-b in the U12 plan): a `/var/app/current` the agent
  could write would let one patron's turn rewrite the code another's loads.
- **One user per turn** (U3): the hook creates `genealogy-turn-0` and `-1` (group
  `genealogy-turn`; `WORKER_TURN_USERS` in `02-worker.config` names the same two) and a
  `web.service` drop-in that runs the worker as root, so it can launch each turn's CLI as
  its own slot user. The kernel then keeps one patron's turn out of another's files and the
  worker's `/proc`. Whether the drop-in survives the platform's own unit rewrite, and that
  a slot user cannot read `/opt/elasticbeanstalk/deployment/env`, are U13 measurements. Whether Beanstalk re-chowns it after predeploy is a U13 measurement.

`../eb-worker-probe/` is the 2026-09-11 measurement and stays as it was; its
`deploy.sh` overrides its own `.ebextensions` with experiment values.

## Why these values

Interim, until U26's deadline: sqsd cuts only a run past 10 h. U13 re-sizes
`MaxRetries` and `ErrorVisibilityTimeout` once it has measured them on AWS.

| Option | Value | Why |
|---|---|---|
| `HttpPath` | `/turn` | The worker 404s every other path. |
| `HttpConnections` | `2` | Unchanged from step 11. |
| `InactivityTimeout` | `36000` | Beanstalk's documented maximum ("1 to 36000"). |
| `VisibilityTimeout` | `36300` | `InactivityTimeout` + 300. SQS's maximum is 43200. |
| `MaxRetries` | `5` | See below. |
| `ErrorVisibilityTimeout` | `300` | See below. |
| `RetentionPeriod` | `345600` | The AWS default, written down because the worker's sweep reads it. |

- **`MaxRetries` 5.** Receives after the first come only from a crash, a deploy or
  SIGTERM, or a 500. The 500s cover an API error surfacing as `ResultMessage.is_error`,
  Postgres being unavailable at claim, and a single `ResumeFailure` below the
  zero-progress cap. Five allows four recoveries per run. The $35 cap, cumulative per
  session, bounds the spend of those resumes, not this number. A message that uses up
  all five is closed `retries_exhausted` by the worker.
- **`ErrorVisibilityTimeout` 300** has to exceed three things:
  - **The worker's stop grace**, so a redelivery never meets the old process's CLI.
    Compose's is 30 s. Beanstalk's is unmeasured; systemd's default is 90 s.
  - **A deploy window.** A configuration-only update measured 78 s. An app-version
    deploy is unmeasured.
  - **A Postgres failover.** At AWS's 2 s default, the worker's claim-failure 500 would
    spend all five receives in ten seconds and dead-letter the turn.

  Five receives × 300 s tolerates about 20 minutes of errors.
- **The worker is told the same values** (`SQSD_MAX_RETRIES`,
  `SQSD_VISIBILITY_TIMEOUT_S`, `SQSD_RETENTION_PERIOD_S`) in the same template's
  environment block. If they differ at runtime the failure is safe: a worker value below
  sqsd's closes one receive early; one above it disables the fast close, and the sweep's
  retention backstop still closes the turn.
- **The two-CLIs hazard at 10 h is not closed by construction.** A run still alive at
  36,000 s would be cut, and its message would return 300 s later while it runs on. This
  is acceptable for the interim because D18's spend rate reaches the $35 cap in about
  3–4.5 h. U26's deadline is the fix.
