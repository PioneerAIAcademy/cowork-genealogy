# Beanstalk tools-tier template

The Procfile and settings the U12 builder (`scripts/eb_bundles/build.py`) copies verbatim
to the root of `releases/eb-tools.zip`, the tool server (`../tools/`) for the Node.js
AL2023 platform. This README is not shipped. Not deployed from here: U13 is the first
deploy (`docs/plan/familysearch-handoff.md`, step 9).

| File | Role |
|---|---|
| `Procfile` | `web: node build/http.js --host 127.0.0.1 --port 8080`. Mandatory: without one the platform runs `npm start`, which is the stdio server. Loopback, so only nginx reaches the port. |
| `.ebextensions/01-tools.config` | `PORT=8080` (equal to the Procfile's `--port`), `PGSSLMODE=verify-full` and `NODE_EXTRA_CA_CERTS` at the bundle's `certs/rds-global-bundle.pem`, `HealthCheckPath: /healthz`, one instance (`asg` 1/1), CloudWatch log streaming kept after terminate |
| `.ebextensions/02-tools-alb.config` | ALB `IdleTimeout` 1800, alone in its file (below) |
| `.platform/nginx/conf.d/01-tools-timeouts.conf` | `proxy_read_timeout` and `proxy_send_timeout` 1800 s, nginx's 60 s default being shorter than a tool call |

`apps/server/tests/test_proto_bundles.py` pins them: the Procfile's shape and `--port`
against `PORT`, every environment value inside Beanstalk's character set, no secret or
dev-only variable, the CA path equal to `scripts/eb_bundles/layout.py`'s, the health path,
the logs block, `asg` 1/1, and nginx at 1800 s or more.

- **TLS without a query string.** Beanstalk documents environment values as excluding
  `? & % #`, so `GENEALOGY_PG_DSN` carries no `sslmode`; a DSN `sslmode` would override
  `PGSSLMODE`. Against an RDS Proxy or a non-RDS CA, override both at API level.
- **`02-tools-alb.config` is a file of its own** because a validation error drops the whole
  file. In a SingleInstance environment there is no load balancer: whether Beanstalk
  ignores the namespace or rejects the deploy is a U13 measurement, and if it rejects, the
  setting moves to an API-level one.
- **Application Load Balancer, chosen at creation.** `create-environment` must pass
  `Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application`
  (and `EnvironmentType` `LoadBalanced`). The API default is `classic`, whose 60 s idle
  timeout `02-tools-alb.config` cannot raise, and AWS documents that the type can be set
  neither from `.ebextensions` nor after creation.
- **Not in the bundle:** `GENEALOGY_PG_DSN`, `GENEALOGY_S3_BUCKET` (both required, or
  `build/http.js` exits 2 before listening), the other `GENEALOGY_S3_*` variables, and the
  config overrides in `../tools/README.md`. Each is an API-level setting.
- **The instance count** is a default; an API-level `aws:autoscaling:asg` setting wins.
