# sqsd shim (D3)

Stands in for Elastic Beanstalk's sqsd: long-polls the `turns` queue, POSTs each message body to `WORKER_URL` with the sqsd headers sqsd 3.0.5 was measured sending on Beanstalk on 2026-09-11 (`X-Aws-Sqsd-Msgid`, `-Queue`, `-First-Received-At`, `-Sent-At`, `-Receive-Count`, `-Path`, `Content-Type: application/json`; sqsd also sends `-Sender-Id`, which has no meaning here), keeps `HTTP_CONNECTIONS` POSTs in flight, and acts on each outcome per `decide.py` (pure; tests in `apps/server/tests/test_proto_decide.py`):

- **2xx → `DeleteMessage`.**
- **Connection-level failure** (refused, reset, read timeout) **→ `ChangeMessageVisibility(0)`** after `REQUEUE_PAUSE_S`; on a **read timeout** it first kills `WORKER_CONTAINER` over the docker socket **and starts it again** — `docker kill` counts as a manual stop, so `restart: unless-stopped` never brings it back on its own (probed 2026-09-11).
- **Any other non-2xx → `ChangeMessageVisibility(backoff)`**, doubling per receive count from `BACKOFF_BASE_S` to `BACKOFF_MAX_S`.

**Stopping is graceful** (SIGTERM/SIGINT): the flag is set, the in-flight long poll is allowed to return (≤ 20 s), anything it delivered goes straight back with `ChangeMessageVisibility(0)` (`{"ev":"requeue_on_stop"}`), in-flight POSTs get the rest of `STOP_GRACE_S` (30, matched by the compose `stop_grace_period`), then `{"ev":"stop"}` and exit. Exiting mid-poll instead would leave that poll open server-side and the next message invisible for the whole visibility timeout (probed 2026-09-11). **A handler that raises** does the same hand-back (`{"ev":"requeue_on_stop","reason":"error"}`): an exception between the POST and the delete would otherwise strand the message for the whole visibility timeout, and if only the delete failed the completed turn would re-run 35 minutes later (reproduced 2026-09-12: queue at visible 0 / in-flight 1 before the requeue, redelivered at once after it).

Every decision is one JSON line on stdout — `{"ev":"post","msgid","turn_id","receive_count","status"|"error","elapsed_ms","action":"delete"|"requeue"|"requeue_backoff","backoff_s","killed_worker"}` — read with `docker compose -f apps/server/proto/docker-compose.yml logs shim`.

Env: `QUEUE_URL` (required; the SQS endpoint is its scheme+host unless `SQS_ENDPOINT_URL` is set — credentials/region default to dummies elasticmq accepts), `WORKER_URL`, `WORKER_CONTAINER`, `HTTP_CONNECTIONS` (2), `READ_TIMEOUT_S` (1800, the step ceiling), `CONNECT_TIMEOUT_S` (5), `BACKOFF_BASE_S` (5), `BACKOFF_MAX_S` (300), `REQUEUE_PAUSE_S` (1), `STOP_GRACE_S` (30).

What real sqsd does that this shim compensates for (measured 2026-09-11): it cuts a POST at exactly `InactivityTimeout`, tells the worker nothing, and lets the message return only when `VisibilityTimeout` lapses — so the dead time after a forced checkpoint is `VisibilityTimeout − InactivityTimeout`. The shim's container kill plus `ChangeMessageVisibility(0)` is the local stand-in for both halves.
