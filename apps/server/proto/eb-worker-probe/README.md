# Elastic Beanstalk worker-tier probe

A hello-world worker for the Beanstalk **Worker** tier: it logs everything
`sqsd` sends it, sleeps 1500 s, and answers 200. Deployed by hand into the
personal AWS account (nothing in the repo depends on it; the compose stack under
`apps/server/proto/` is the development topology). It retires the four platform
constraints docker-compose cannot show. Cost while it runs: one t3.micro, about
one cent an hour. Tear it down when the answers are recorded.

| Question | Where the answer shows up |
|---|---|
| The sqsd contract: method, path, content type, user agent, the `X-Aws-Sqsd-*` headers | the `start` line in `web.stdout.log` |
| `InactivityTimeout`: does a 1500 s handler complete under 1800, and what happens to it under 300 | `start`/`end`/`client_gone` lines plus the sqsd log; receive count and the gap before redelivery |
| The 512 MB source-bundle cap | the console's upload dialog; optionally one oversized `create-application-version` |
| The `.ebextensions/*.config` prefix rule, and what wins when the API sets the same option | `describe-configuration-settings`; `sleep_s_source` on the `start` line |

## Files

| File | Role |
|---|---|
| `application.py` | stdlib WSGI app; threaded so `HttpConnections` POSTs really run concurrently; one JSON line per event on stdout |
| `Procfile` | `web: python application.py`; the platform's nginx proxies :80 to the app on `$PORT` (8000) |
| `.ebextensions/01-worker.config` | the sqsd options, `SLEEP_S=1500`, CloudWatch log streaming |
| `.platform/nginx/conf.d/01-worker-timeouts.conf` | raises nginx's 60 s `proxy_read_timeout`, see "nginx is in the path" |
| `deploy.sh` | aws CLI only; create or update everything, wait for Ready, print the queue URL |
| `teardown.sh` | terminate, delete the application, empty and delete the bucket |

Every resource is named `genealogy-proto-worker-probe` (the bucket gets the
account id appended). Both scripts take `--dry-run`, which prints the exact
command sequence and calls nothing, and `REGION` (default `us-east-1`).

## One-time IAM prerequisites

The API path does not create the two default roles the console wizard would.
`deploy.sh` checks for both and stops with a pointer here if either is missing.
If the account has ever created a Beanstalk environment from the console, they
exist already.

```sh
aws iam create-role --role-name aws-elasticbeanstalk-ec2-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier
aws iam create-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role
aws iam add-role-to-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --role-name aws-elasticbeanstalk-ec2-role

aws iam create-role --role-name aws-elasticbeanstalk-service-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"elasticbeanstalk.amazonaws.com"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"elasticbeanstalk"}}}]}'
aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy
```

## Deploy, redeploy, tear down

```sh
cd apps/server/proto/eb-worker-probe
./deploy.sh --dry-run                    # read the sequence first
./deploy.sh                              # ~5-8 min to Ready; prints the queue URL and the next commands
INACTIVITY_TIMEOUT_S=300 ./deploy.sh     # experiment 4: same environment, update-environment with the new value
./teardown.sh                            # everything but the shared IAM roles and EB's own bucket
```

`deploy.sh` is idempotent: the version label is a hash of the bundle's file
names and contents, so an unchanged tree re-uploads nothing and a changed one
becomes a new application version; an existing environment gets
`update-environment`, with `--version-label` only when the label changed. The
`.ebextensions` values are in the bundle, but `deploy.sh` also passes the sqsd
block as option settings, and an option set through the API **overrides the
same option in `.ebextensions`** (API/console > saved configuration >
`.ebextensions` > platform default). So `InactivityTimeout` is changed with
`INACTIVITY_TIMEOUT_S`, and editing `01-worker.config`'s sqsd values after the
first deploy changes nothing. `SLEEP_S` and the CloudWatch block come only from
the file.

## Reading the logs

`StreamLogs: true` sends the instance logs to CloudWatch; the groups are named
after the file paths and are deleted with the environment.

```sh
ENV=genealogy-proto-worker-probe
aws logs describe-log-groups --log-group-name-prefix /aws/elasticbeanstalk/$ENV --query 'logGroups[].logGroupName'
aws logs tail /aws/elasticbeanstalk/$ENV/var/log/web.stdout.log --follow        # the app: start / end / client_gone
aws logs tail /aws/elasticbeanstalk/$ENV/var/log/aws-sqsd/default.log --follow  # sqsd: receive, post, timeout, retry
aws logs tail /aws/elasticbeanstalk/$ENV/var/log/nginx/access.log --follow      # the POST's status and duration
```

If a group is missing, the CLI path to the instance's log tail is
`aws elasticbeanstalk request-environment-info --environment-name $ENV --info-type tail`,
then `retrieve-environment-info` with the same arguments a minute later (it
returns a presigned URL to a text bundle).

Every app line is one JSON object: `listening`, `start` (all headers and the
body), `end`, `client_gone` (the caller had closed the connection before the
200 was written), `access`, `shutdown` (SIGTERM). Header names on the `start`
line are rebuilt from the WSGI environ, so an attribute sent as
`X-Aws-Sqsd-Attr-turn_id` is logged as `X-Aws-Sqsd-Attr-Turn-Id`; the wire
spelling is the one the docs give, `X-Aws-Sqsd-Attr-<name as sent>`.

## The experiments

`deploy.sh` prints the queue URL; `QUEUE` below is that value. The body
`{"sleep_s": N}` overrides `SLEEP_S` for one message.

**1. Plumbing (5 s).** Confirms sqsd reaches the app before spending 25 minutes.

```sh
aws sqs send-message --queue-url "$QUEUE" --message-body '{"sleep_s": 5}' \
  --message-attributes '{"turn_id":{"DataType":"String","StringValue":"t-1"}}'
```

Expect within seconds: `start` with `receive_count: 1`, `end` 5 s later with
`elapsed_s` ≈ 5, no `client_gone`, and the queue's `ApproximateNumberOfMessages`
back to 0 (`aws sqs get-queue-attributes --queue-url "$QUEUE" --attribute-names All`).

**2. The headers.** Read the same `start` line. Record `method`, `path`,
`content_type` (the `MimeType` option, default `application/json`),
`user_agent` (`aws-sqsd/<version>`), and every key under `sqsd_headers`:
`X-Aws-Sqsd-Msgid`, `X-Aws-Sqsd-Queue`, `X-Aws-Sqsd-First-Received-At`,
`X-Aws-Sqsd-Receive-Count`, `X-Aws-Sqsd-Attr-*` for the attribute above, and
anything else present (`X-Aws-Sqsd-Sender-Id` is documented; the app logs
whatever arrives). `First-Received-At` and `Receive-Count` are what the shim in
`apps/server/proto/shim/` has to reproduce.

**3. 1500 s under `InactivityTimeout` 1800.** The step-ceiling question.

```sh
aws sqs send-message --queue-url "$QUEUE" --message-body '{}'
```

Expect `start` (`sleep_s: 1500.0`, `sleep_s_source: "env"`), then 25 minutes
later `end` with `elapsed_s` ≈ 1500 and no `client_gone`; the nginx access log
shows the POST as 200 with a ~1500 s request time; the sqsd log shows one
receive and a successful post; the queue is empty and `receive_count` never
reached 2. A `client_gone` here, or a second `start` for the same msgid, means
something between sqsd and the app gave up first (see "nginx is in the path").

**4. Cut at 300 and redelivered.**

```sh
INACTIVITY_TIMEOUT_S=300 ./deploy.sh        # wait for Ready
aws sqs send-message --queue-url "$QUEUE" --message-body '{}'
```

The app still sleeps 1500 s. Expect: `start` (receive 1); at ≈300 s the sqsd
log gives up on the connection; then a second `start` with the **same msgid and
`receive_count: 2`**. The gap between the cut and the second `start` is the
measurement: ≈2 s means sqsd released the message (`ErrorVisibilityTimeout`,
default 2, is what applies); ≈2100 s means it merely let `VisibilityTimeout`
lapse. Meanwhile the first handler thread is still sleeping and logs `end` at
1500 s followed by `client_gone` — the worker never learns it was abandoned,
which is what the compose shim's container kill compensates for. Each retry is
cut the same way, so after two or three receipts purge both queues
(`aws sqs purge-queue --queue-url ...`; the dead-letter queue is the second
entry in `describe-environment-resources`, and after `MaxRetries` 10 receipts
the message would land there on its own). Record: the exact sqsd log wording at
the cut, the redelivery gap, and whether `receive_count` climbed by one per cut.

**5. Update while a message is in flight** (optional, same deploy). Send a
`{}` message, then run `INACTIVITY_TIMEOUT_S=1800 ./deploy.sh` while it sleeps.
Record whether the app is restarted for a configuration-only update (a
`shutdown` line with `reason: SIGTERM`) and how long the in-flight message takes
to come back (`receive_count: 2`).

**6. The `.ebextensions` prefix rule and precedence.**

```sh
aws elasticbeanstalk describe-configuration-settings --application-name $ENV --environment-name $ENV \
  --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:sqsd' || Namespace=='aws:elasticbeanstalk:application:environment']"
```

`SLEEP_S=1500` there, and `sleep_s_source: "env"` on the `start` line, prove
the file was processed (the sqsd values shown come from `deploy.sh`'s option
settings, not the file — see "Deploy, redeploy, tear down"). To watch the rule
bite: rename the file to `.ebextensions/01-worker.cfg`, run `./deploy.sh` (new
label), and expect `SLEEP_S` gone from the query and `sleep_s_source:
"default"` on the next `start`. The documented rule the rename confirms: files
must sit in `.ebextensions/` at the bundle root, end in `.config`, be YAML or
JSON, and are applied in alphabetical order (hence the `01-` prefix). Rename it
back and redeploy.

**7. The 512 MB bundle cap.** Documented: a zip or war, ≤ 512 MB, with no
parent directory (the zip's root holds `application.py`, `Procfile`,
`.ebextensions/`, `.platform/` — `unzip -l` on the bundle shows this). Confirm
the number from the console: Applications → the probe → Application versions
→ Upload and deploy shows the limit next to the file chooser. To see it
enforced rather than stated, upload one oversized object and try
`create-application-version` on it:

```sh
head -c 600m /dev/urandom > big.bin && zip big.zip big.bin      # incompressible on purpose
aws s3 cp big.zip s3://genealogy-proto-worker-probe-<account-id>/big.zip
aws elasticbeanstalk create-application-version --application-name $ENV --version-label big --source-bundle S3Bucket=genealogy-proto-worker-probe-<account-id>,S3Key=big.zip
```

**8. nginx is in the path.** sqsd POSTs to `http://localhost:80`, the platform's
nginx, which proxies to the app on :8000 with a default `proxy_read_timeout` of
60 s. `.platform/nginx/conf.d/01-worker-timeouts.conf` raises it to 36000 s
(`InactivityTimeout`'s maximum) so nginx is never the binding constraint. If
experiment 3 shows a `504` in the nginx access log at ≈60 s and a second
`start` shortly after, the override did not apply: check
`/aws/elasticbeanstalk/$ENV/var/log/nginx/error.log` and `eb-engine.log`.
Record which of nginx and sqsd cut first in experiment 4 — with the override,
it must be sqsd.

## Recording the answers

Put the observed values (headers, the redelivery gap, the cut wording, the
precedence result) into the D3 entry of `docs/plan/search-agent-prototype.md`
so the shim and the step model are built against measurements, then run
`./teardown.sh`.
