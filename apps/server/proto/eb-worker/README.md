# Beanstalk worker-tier template

The sqsd and nginx settings U12 bundles with the worker (`../worker/`) for the
Beanstalk worker tier. Not deployed from here: U12 builds the bundle and U13 is the
first deploy.

| File | Role |
|---|---|
| `.ebextensions/01-sqsd.config` | The interim sqsd options (handoff step 11; `docs/plan/u5-interim-sqsd.md` D1) and the `SQSD_*` / `SWEEP_INTERVAL_S` values the worker reads for its last-receive close and dead-letter sweep |
| `.platform/nginx/conf.d/01-worker-timeouts.conf` | `proxy_read_timeout 43200s`, above `InactivityTimeout` (step 12) |

`apps/server/tests/test_proto_config.py` pins the values: `InactivityTimeout` at
Beanstalk's maximum, `VisibilityTimeout` above it and within SQS's 43200, each `SQSD_*`
equal to its sqsd option, `ErrorVisibilityTimeout` above the worker's stop grace, and
nginx above `InactivityTimeout`. Compose mirrors them with `../docker-compose.sqsd.yml`.

`../eb-worker-probe/` is the 2026-09-11 measurement and stays as it was; its
`deploy.sh` overrides its own `.ebextensions` with experiment values.
