# Beanstalk rehearsal (U13)

`rehearse.py` stands the search-agent prototype up in one AWS account, probes it and tears
it down. It is U13's rehearsal of the deployment guide in
`docs/plan/familysearch-handoff.md` (section 3), with web, worker and tools on Elastic
Beanstalk, RDS, S3, Secrets Manager and an SSM-only bastion, all in the default VPC of
us-east-1. It uses only the standard library and shells out to the `aws` CLI (2.x). Nothing
here is shipped: the directory is outside `scripts/eb_bundles/layout.py`'s `TEMPLATE_DIRS`
and the builder's rules. The tests are in `apps/server/tests/test_proto_rehearsal.py`, and
they run against a fake `aws`.

## Before the first run

- **`.local/`**, beside this file. It is gitignored, and a test pins that. Each file holds
  one value:
  - `account`: the 12-digit account the caller must be in. `--expect-account` overrides it.
  - `alert-email`: the address the budget alerts go to.
  - `allowed-emails`: the patrons who may sign in (space- or comma-separated).
  - `zone`, `host`: kept for when the hostname and certificate are decided.

  The account id, the zone and any hostname never go in a tracked file, a test, a commit
  message or a PR body. Write `<account>`, `<zone>` and `<host>` instead.
  `leak-check` enforces this.
- **A work dir** (`--work-dir`, required). It must be outside every git checkout (a
  `.claude/worktrees/*` checkout sits inside the main one), and new or empty: the tool marks
  the ones it makes and never adopts or chmods another directory. It holds the inventory, the
  option-settings files and the secret files, all at mode 0600. Delete it after `down`.
- **The bundles**: a CI `eb-bundles` artifact for a `main` sha (`gh run download`). Pass
  `--bundles-dir <dir>` to `up --phase versions`. It refuses a zip whose sha256 differs from
  `eb-bundles.json`, and a manifest built from a dirty tree.
- **The model key** comes from `ANTHROPIC_API_KEY` in the environment, else from
  `eval/.env` (`--env-file` overrides that). It is never printed, and it goes to Secrets
  Manager through a 0600 file.
- `session-manager-plugin` on the laptop, for the port forwards below.

## Rules it enforces

- **Account guard.** `sts get-caller-identity` must match the expected account before any
  other call. The region is pinned to us-east-1, and `--region` anything else is refused.
  `up`, `probe` and `down` need `--billed`.
- **Names and tags.** Everything is named `genealogy-u13-*`, IAM sits under `/genealogy-u13/`,
  and every create is tagged `genealogy:rehearsal=u13` and `genealogy:run=<run id>`. The
  run id is fixed by the first `up` and kept in the inventory.
- **Secrets** reach an environment only as `aws:elasticbeanstalk:application:environmentsecrets`
  ARNs. A secret value never appears in argv, an SSM parameter, dry-run output or a non-secret
  file. Option settings and secret strings go to the CLI only as `file://` paths in the work
  dir. `SESSION_SECRET`, `FS_TOKEN_ENC_KEY` (one secret, mapped on web and worker) and the
  DML password are random hex.
- **Option guard** (`check_options`). Outside a probe case, `up` refuses any of `layout.py`'s
  dev-only names or values, a secret-shaped name in the plain environment, a value outside
  Beanstalk's environment-value set, more than 4,096 bytes of properties, and any sign-in
  setting except from the `signin` phase. Everywhere, an sqsd option that has a mirror
  (`MaxRetries`, `VisibilityTimeout`, `RetentionPeriod`) is set together with its `SQSD_*`
  variable, at the same value.
- **`--dry-run`** on any subcommand calls nothing. It prints each command as a pasteable
  line and shows secrets as `file://` paths. It writes its JSON files under `<work-dir>/dry-run/`,
  never over the probe snapshots.

## Subcommands

| Command | What it does |
|---|---|
| `plan` | Prints names, phases and cases, then every command `up --phase all` would run. It makes no AWS call. |
| `up --phase <p>` | Runs one or more phases in the order given. `all` is the twelve below. |
| `status` | Prints yesterday's and today's daily cost (always), the budget's actual spend, each environment's status and health, and the RDS forward command. It exits 1 on drift between an environment and the option-settings file `up` wrote, or when a dev-only or `U13_PROBE_*` variable is live. |
| `probe --case <c>` | Applies cases (repeatable), holds, then restores in reverse order in `finally`. Enter, Ctrl-C, an exception or `--hold-s N` all lead to the restore, which first waits for the environment to leave `Launching` or `Updating`. |
| `down` | Tears everything down in order. It is idempotent. |
| `prove-empty` | Exits 1 if anything of the rehearsal remains. |
| `leak-check [--body <file>]` | The account-id leak check. It makes no AWS call. |

### `up` phases

| Phase | Creates |
|---|---|
| `guard` | The `DAILY` cost budget `genealogy-u13`. Its limit is the trailing 30-day maximum daily `UnblendedCost` plus $15, with ACTUAL alerts at max + $5 and at the limit. Every run recomputes it and prints the trailing min and max. |
| `iam` | The service role and four instance roles and profiles (web, worker, tools, bastion), each with `AmazonSSMManagedInstanceCore`. Web gets `sqs:SendMessage`. Tools gets the data bucket's object actions and `s3:ListBucket`. Each tier can read its own secrets. |
| `net` | Security groups `web`, `worker`, `tools`, `tools-alb` (80 from `worker`) and `rds` (5432 from the three tier groups), in the default VPC. |
| `stores` | RDS PostgreSQL 16.13 `db.t4g.micro`: private, encrypted, with an RDS-managed master secret, a subnet group and a parameter group. Also the data bucket, with the public-access block and SSE. |
| `secrets` | The six secrets, created from 0600 files. |
| `bastion` | A t3.micro AL2023 instance in the `worker` group, reachable only over SSM. |
| `versions` | The storage location, recording whether this run created the bucket. Then the application, and the three application versions (`--process`). |
| `tools` | The tools environment on Node.js 24, with an internal application load balancer. |
| `worker` | The worker environment, with both namespaces of `eb-worker/.ebextensions/01-sqsd.config` set at API level in one file. |
| `queue` | Reads the worker's `WorkerQueue` URL and sets it as `QUEUE_URL` (the two-step: the worker exits 2 at `step=queue_url` until then). |
| `web` | The web environment, with an internet-facing application load balancer and `QUEUE_URL`. It has no `PUBLIC_URL`, no sign-in and no dev login on first boot. |
| `migrate` | Over SSM on the web instance, under a transient policy whose `Resource` is exactly the master secret and web's DSN secret, removed in `finally`. Runs `migrate.py`, creates or updates the DML role and its grants, then runs `migrate.py --status`. |
| `signin --mode loopback` (optional) | `PUBLIC_URL=http://127.0.0.1:1837`, `FAMILYSEARCH_WEB_ENABLED=true` and `ALLOWED_EMAILS` (space-separated) on web. `--mode off` removes them. `--mode https` is refused until the hostname and certificate are decided. |
| `resolver` (optional) | A Route 53 Resolver query log on the default VPC, written to `/genealogy-u13/resolver`, to record which hosts the tiers resolve. |

Every tier gets its security group and instance profile through
`aws:autoscaling:launchconfiguration`, along with `InstanceTypes`, ASG 1/1,
`ManagedActionsEnabled=false` and enhanced health. `--env <tier>:NAME=VALUE` adds a non-secret
operator setting, which the same guard checks.

### Loopback sign-in

The dev key's registered callback is `http://127.0.0.1:1837/callback`. After
`up --phase signin`, forward laptop port 1837 to the web instance's 8000:

```
aws ssm start-session --target <web instance id> \
  --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=8000,localPortNumber=1837
```

Then open `http://127.0.0.1:1837`.

### Postgres from the laptop

```
aws ssm start-session --target <bastion id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host=<rds endpoint>,portNumber=5432,localPortNumber=15432
```

psycopg takes `host=<rds endpoint> hostaddr=127.0.0.1 port=15432`, with `PGSSLMODE=verify-full`
and the RDS CA. node-postgres needs a `127.0.0.1 <rds endpoint>` line in `/etc/hosts`.
`status` prints the forward. The tool never edits `/etc/hosts`.

## Probe cases

Each case is a closed entry in `CASES`. Only a case may set a dev-only name, a
secret-shaped name or a value outside the character set, and only with a literal public or
dummy value. A case's snapshot is the option-settings file `up` wrote for that environment.
A touched name that is in the snapshot is set back to its snapshot value. One that is not
goes to `--options-to-remove`, so the bundle's template value (if any) applies again.

| Case | Sets | Measures |
|---|---|---|
| `env_chars`, `env_4096` | `U13_PROBE_*` with `?`, `&`, `,`; 5,000 bytes of padding (web) | Which characters and how many bytes Beanstalk's environment properties accept |
| `tools_single`, `tools_classic`, `ebext_naming` | A throwaway `genealogy-u13-x-*` tools environment: SingleInstance; no `LoadBalancerType`; a zip copy with `.ebextensions/03-u13.yaml`. Each is terminated when the case ends. | Whether tools runs without a load balancer or on the default one; which `.ebextensions` file names apply |
| `graviton_boot` | A throwaway worker on t4g.large (arm64), with its own queue and no turn | Whether the worker bundle boots on arm64 |
| `tools_no_pgsslmode` | `PGSSLMODE=disable` on tools | What tools does when RDS TLS is turned off |
| `tools_no_dsn`, `tools_bad_path_style`, `tools_half_s3_pair` | Removes the `GENEALOGY_PG_DSN` mapping; `GENEALOGY_S3_FORCE_PATH_STYLE=maybe`; a dummy `GENEALOGY_S3_ACCESS_KEY` | Tools' start refusals |
| `worker_half_sqs`, `web_half_sqs`, `sqs_region_contradicts` | A dummy `GENEALOGY_SQS_ACCESS_KEY`; `GENEALOGY_SQS_REGION=us-west-2` | The SQS-settings start refusals |
| `fast_errors` | `ErrorVisibilityTimeout=10` (it has no mirror) | How soon a failed turn is redelivered |
| `maxretries_2`, `maxretries_1` | `MaxRetries` and `SQSD_MAX_RETRIES`, 2 or 1 | Whether sqsd delivers exactly `MaxRetries` receives |
| `tmpdir_bad` | `TMPDIR=/nonexistent` | What the worker does without a usable `TMPDIR` |
| `worker_no_provider`, `worker_no_tool_url`, `worker_blocked_tools`, `worker_no_queue_url`, `worker_default_enc_key`, `web_no_queue_url` | One start refusal each | The worker's and web's start refusals |
| `default_session_secret` | Web's `SESSION_SECRET` set to the public dev default in place of its mapping | That web refuses a default secret with sign-in on |
| `kill_window` | `InactivityTimeout=1200`, `VisibilityTimeout=1500` and `SQSD_VISIBILITY_TIMEOUT_S=1500` | The redelivery window for a kill that also stops sqsd |
| `debug_hold` | `GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS=20000` on tools | The hold acceptance step 4 kills the worker within |
| `refresh_age_0` | `FS_GRANT_REFRESH_AGE_S=0` on web | A FamilySearch grant refresh on every turn |
| `cap_1usd` | `SESSION_SPEND_CAP_USD=1` on the worker | That the session spend cap stops a turn |
| `idle_session_60s` | The parameter group's `idle_session_timeout=60000`. It waits for `in-sync`, then restores with `reset-db-parameter-group`. Never during the acceptance turn. | What a Postgres idle-session timeout does to the tiers' pools |

## Teardown

`down` runs these steps in order. Each step waits, and each tolerates a resource that is
already gone:

1. Terminate every environment Beanstalk still lists in the application, throwaways
   included, then wait on those and every recorded one.
2. Terminate the bastion.
3. Delete RDS with no final snapshot (an instance already deleting is waited on), then its
   subnet group and parameter group.
4. Delete the application. If this run created the Beanstalk storage bucket, empty all of
   it (object versions too), delete its policy, then delete the bucket. Otherwise delete
   only `genealogy-u13/` and the keys that name a recorded environment id.
5. Force-delete the secrets.
6. Empty and delete the data bucket.
7. Delete the security groups `rds`, then `tools-alb`, `web`, `worker` and `tools`, retrying
   on DependencyViolation for up to 10 minutes.
8. Delete the instance profiles, then the roles. Service-linked roles are left in place.
9. Delete the budget.
10. Remove the Resolver query log (disassociate, delete) and its log group.
11. Delete the `/aws/elasticbeanstalk/genealogy-u13-*` log groups.

Then remove the `/etc/hosts` line and delete the work dir. `prove-empty` checks the tag
index (re-polled after `--repoll-s`, since it lags deletes), the application and
environments, the recorded stacks, load balancers and queues, Elastic IPs, instances,
security groups, the RDS trio, the secrets, the data bucket, the storage bucket (`head-bucket`
must answer 404 when this run created it; anything else counts as not empty), the IAM path,
the budget, the Resolver config and both log-group prefixes.

## Leak check

```
python apps/server/proto/eb-rehearsal/rehearse.py leak-check --work-dir <dir> --body <pr-body.md>
```

It reads every value in `.local/` and refuses an empty file, since an empty pattern
matches every line. It writes the patterns to `<work-dir>/leak-patterns` and runs
`git grep -F --untracked` over the repo (ignored files stay excluded). It then scans each
`--body` file, the commit messages in `<base>..HEAD` (`--base`, default `main`), and every
line those commits added or removed, so a value committed and scrubbed later still counts. A
hit prints its file and line (or commit and file), never the value, and exits 1. With no `.local/` it refuses, so a fresh
worktree cannot pass it. Run it before every push.
