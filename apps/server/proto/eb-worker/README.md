# Beanstalk worker-tier template

The sqsd and nginx settings U12 bundles with the worker (`../worker/`) for the
Beanstalk worker tier. Not deployed from here: U12 builds the bundle and U13 is the
first deploy.

| File | Role |
|---|---|
| `.ebextensions/01-sqsd.config` | The interim sqsd options (handoff step 11; "Why these values" below) and the `SQSD_*` / `SWEEP_INTERVAL_S` values the worker reads for its last-receive close and dead-letter sweep |
| `.platform/nginx/conf.d/01-worker-timeouts.conf` | `proxy_read_timeout 43200s`, above `InactivityTimeout` (step 12) |

`apps/server/tests/test_proto_config.py` pins the values: `InactivityTimeout` at
Beanstalk's maximum, `VisibilityTimeout` above it and within SQS's 43200, each `SQSD_*`
equal to its sqsd option, `ErrorVisibilityTimeout` above the worker's stop grace, and
nginx above `InactivityTimeout`. Compose mirrors them with `../docker-compose.sqsd.yml`.

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
