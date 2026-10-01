# U5: interim sqsd settings, SIGTERM exit, dead-letter close

**Status:** Built 2026-09-30 (branch u5-interim-sqsd); offline suites and every compose check pass; AWS confirmation in U13. `plan-critic` reviewed it twice: round 1 found
one blocking finding, round 2 found none, and all findings are applied. Handoff item U5 in
[`familysearch-handoff.md`](familysearch-handoff.md). Branch `u5-interim-sqsd` from
`origin/main` at `fbc5b2362` (U2 merged).

## The task in one sentence

Until U26 lands, sqsd should cut only a run past 10 h. A worker that is told to stop should
hand its message back for a quick resume. A turn whose message runs out of receives should be
closed with a named outcome, and the patron's held messages released, instead of staying open
for good.

## What U5's own PR can prove, and what waits for U13

The handoff's **Done when** is written against U13, the rehearsal deploy on AWS, which does not
exist yet. This PR proves each part offline (in CI) and on compose (with an sqsd-faithful
overlay, unbilled), and leaves the AWS confirmation to U13:

| Done-when clause | This PR | U13 |
|---|---|---|
| A run past 1,800 s completes on receive 1 | Template pins (config test). Compose: a `sleep 1850` stub under the sqsd overlay completes on receive 1 (opt-in, 31 min, unbilled). | The same, on Beanstalk sqsd |
| SIGTERM mid-turn exits and the redelivery resumes | A real SIGTERM to a real worker process, in CI. Compose: `docker restart` mid-`sleep`, then the redelivery completes. One short billed real turn with a SIGTERM (asked first). | A deploy mid-turn on Beanstalk. This also depends on sqsd outliving the app process during an app-version deploy, which is unmeasured. |
| `MaxRetries` 1 plus a 500 closes the turn and releases held messages | Offline unit tests. Compose: a `fail` stub with `SQSD_MAX_RETRIES=1` and a seeded held row. | The same, on Beanstalk |

## Current state (checked 2026-09-30, `fbc5b2362`)

- **No sqsd option file in the repo carries the interim values.** The only one is the
  probe's: `eb-worker-probe/.ebextensions/01-worker.config` has `1800/2100/10`, `HttpPath "/"`
  and no `ErrorVisibilityTimeout`. `deploy.sh` overrides it through the API with its own
  experiment defaults. The nginx template (`proxy_read_timeout 43200s`) already matches step 12.
- **The worker has no signal handling.** It is stdlib `ThreadingHTTPServer`, Python is PID 1
  (exec-form CMD, no init), and compose gives the worker no `stop_grace_period`. Python as PID 1
  with the default disposition ignores SIGTERM, so `docker stop` waits 10 s and then SIGKILLs.
  A SIGKILLed attempt's message returns only after `VisibilityTimeout`, which is 10 h at the
  interim values.
- **Nothing knows about `MaxRetries`.** The worker reads `X-Aws-Sqsd-Receive-Count` and never
  compares it with a limit. The shim has no retry limit, elasticmq has no DLQ (pinned by
  `test_elasticmq_has_no_redrive_policy`), and nothing consumes or sweeps anything.
- **A dead-lettered turn wedges its session permanently.** `completed_at` and `outcome` stay
  NULL and no `turn_done` is written. `turn_active` is then true forever, every new message is
  held as `outcome='queued'`, neither releaser (`release_queued_turn` in the worker, the web
  tier's rescue) ever runs, Stop has no reader, and the browser shows "working" indefinitely.
- **A related strand, found by reading:** if the post-`complete()` release fails (a SQL error
  in `take_queued_turn`, outside `release_queued_turn`'s `try`), the attempt answers 500. The
  redelivery then answers 200 `already_completed` without releasing, so the held row stays
  stranded until the patron posts again.

## Design decisions

### D1. The interim sqsd values, and whether compose mirrors them

**Values** (new template, see "What changes"):

| Option | Value | Why |
|---|---|---|
| `HttpPath` | `/turn` | The worker 404s every other path. |
| `HttpConnections` | `2` | Unchanged from step 11. |
| `InactivityTimeout` | `36000` | Beanstalk's documented maximum (options table: "1 to 36000"). |
| `VisibilityTimeout` | `36300` | `InactivityTimeout` + 300. SQS's maximum is 43200. |
| `MaxRetries` | `5` | See below. |
| `ErrorVisibilityTimeout` | `300` | See below. |
| `RetentionPeriod` | `345600` | The AWS default, written down because the sweep (D3) reads it. |

- **`MaxRetries` 5.** Receives after the first now come only from a crash, a deploy or
  SIGTERM (D2), or a 500. The 500s cover an API error surfacing as `ResultMessage.is_error`,
  Postgres being unavailable at claim, and a single `ResumeFailure` below 0a's cap. Five
  allows four recoveries per run. The $35 cap, which is cumulative per session, bounds the
  spend of those resumes, not this number. A message that uses up all five is closed by D3.
- **`ErrorVisibilityTimeout` 300** has to exceed three things:
  - **The worker's stop grace**, so a redelivery never meets the old process's CLI. Compose
    grace is 30 s (D2). Beanstalk's is unmeasured; systemd's default is 90 s. U13 measures it.
  - **A deploy window.** A configuration-only update measured 78 s. An app-version deploy is
    unmeasured.
  - **A Postgres failover.** At AWS's 2 s default, the worker's claim-failure 500 would spend
    all five receives in ten seconds and dead-letter the turn.

  Five receives × 300 s tolerates about 20 minutes of errors. U13 re-sizes both numbers
  (step 11 already says so).
- **The worker is told the same values** through `SQSD_MAX_RETRIES`, `SQSD_VISIBILITY_TIMEOUT_S`
  and `SQSD_RETENTION_PERIOD_S` (D3 needs them). They go in the same template's
  `aws:elasticbeanstalk:application:environment` block. A config test pins each one equal to
  its sqsd option, so the two cannot drift inside the template. Whether FamilySearch's
  Blueprint keeps them together is F12's question. If they differ at runtime, the failure is
  safe. A worker value below sqsd's closes one receive early. A value above sqsd's disables
  the fast close, and the sweep's retention backstop still closes the turn.
- **The two-CLIs hazard at 10 h is not closed by construction.** A run still alive at 36,000 s
  would be cut, and its message would return 300 s later while it runs on. The premise that
  makes this acceptable for the interim is D18's spend rate: the $35 cap is reached in about
  3–4.5 h. U26's deadline is the fix by construction. Copying it here at 35,700 s would build
  U26 step 3 twice.

**Compose keeps its 1,800 s ceiling kill by default, and gains an sqsd-faithful overlay.**

- **The base profile is unchanged.** `READ_TIMEOUT_S` stays 1800, the shim still kills the
  worker at the ceiling and requeues at 0, elasticmq visibility stays 2100, and there are
  unlimited retries. This is what D17/D18, PR #2870's acceptance run, `proto-demo(-auto)`,
  `proto-kill` and `proto-probe-resume` ran on, and every pin in `test_proto_config.py`,
  `test_proto_demo.py` and `test_proto_d17.py` stays green untouched. It is also the
  checkpoint exercise U26 will want.
- **New overlay, `docker-compose.sqsd.yml`**, following `docker-compose.ceiling.yml`'s
  precedent. It makes the shim behave like measured sqsd:
  - `KILL_ON_READ_TIMEOUT=false`. At `READ_TIMEOUT_S` the shim abandons the POST, as sqsd does:
    no kill and no requeue, so the message returns when its visibility lapses.
  - `VISIBILITY_TIMEOUT_S` is passed on `ReceiveMessage`. sqsd's option overrides the queue's
    own visibility (Beanstalk docs), so this mirrors it.
  - `ERROR_VISIBILITY_S`: a fixed wait after a non-2xx replaces the doubling backoff.
  - `SQSD_MAX_RETRIES`: a receive with `ApproximateReceiveCount > SQSD_MAX_RETRIES` is sent to
    a new `turns-dlq` queue and deleted from `turns`, then logged `ev=dead_letter`.
  - The overlay also passes `SQSD_*` to the worker.

  The overlay's defaults are the production interim values. `smoke.py` overrides them through
  the environment for its quick cases.
- **The DLQ move is emulated in the shim** rather than with elasticmq's native
  `deadLettersQueue`, whose `maxReceiveCount` would be fixed in the mounted conf. One variable
  then drives both the shim and the worker, exactly as `MaxRetries` drives both sqsd and the
  worker's close. `turns-dlq` is a plain second queue with no redrive, so
  `test_elasticmq_has_no_redrive_policy` still holds. The base profile keeps
  `SQSD_MAX_RETRIES=0`, meaning unlimited.

### D2. SIGTERM: answer 500 at once, then stop the CLI, then exit

**"Finish the current tool call, then exit" is rejected** for three reasons:

- The halt carrier fires only at the next tool call, and a foreground delegation is one call
  that measured 1,586 s (D18).
- Whether a subagent's halt stops the parent is one of PR #2870's unanswered SDK questions.
- Beanstalk's stop grace is unknown (U13). An attempt that overruns it is SIGKILLed with no
  answer, and its message waits out `VisibilityTimeout`, which is 10 h.

Resume re-decides rather than replays (report, Bottom line), so a drain buys nothing a resume
does not already give.

**Sequence:**

1. A SIGTERM or SIGINT handler sets a `SHUTDOWN` event and starts a shutdown thread.
   `server.shutdown()` cannot be called from the `serve_forever` thread.
2. Every in-flight `POST /turn` answers **500** at once: `{"ok": false, "error": "worker
   shutting down", "shutdown": true}`. This includes the stub arms, since
   the compose check relies on `sleep`. It works because the handler now waits on
   either the attempt finishing or `SHUTDOWN`, and the attempt runs on its own **daemon**
   thread, so an uncancellable `time.sleep` stub cannot hold the interpreter open. The
   handler also checks `SHUTDOWN` again after `claim()` and before it starts an attempt.
   - **A POST that arrives after `SHUTDOWN`** answers 503 without claiming, except on the
     last receive: there it closes the turn under D3 and answers 200. Otherwise that
     receive would be spent with no row recording it, and only the 4-day backstop would see
     the dead letter.
   - **On the last receive** (`receive_count >= SQSD_MAX_RETRIES`), an in-flight handler also
     closes the turn under D3 and answers 200 instead of 500. A 500 there would dead-letter
     the turn and leave it for the 10 h sweep. That close's held-message release waits until
     the attempt's cleanup has run (step 4), so the held turn never starts while the old
     CLI is still alive.
3. The shutdown thread cancels each in-flight attempt. It does this through an
   `anyio.CancelScope` wrapped around `run_turn`'s body, called as
   `loop.call_soon_threadsafe(scope.cancel)`. A bare `task.cancel()` would not do: the
   SDK's `close()` docstring says a raw asyncio cancellation skips its SIGTERM-then-SIGKILL
   escalation.
   - `run_turn`'s existing `finally` then runs `client.disconnect()`, which closes stdin,
     then sends SIGTERM, then SIGKILL, 5 s apart.
   - The CLI's socket to the tool server closes, and PR #2850 rolls back any
     `extraction_append` whose transaction has not committed.
   - The escalation is still best-effort. The backstops are the SDK's `atexit` reaper
     (SIGTERM only) and the container or cgroup kill at the end of the grace period.
4. The thread waits for two things, bounded together by `SHUTDOWN_GRACE_S` (default 20 s):
   every in-flight handler has written its reply, and every attempt's `finally` has run.
   Handler threads are daemons, so without the first wait a 500 could be lost as
   `connection_reset`. The thread then runs any release deferred from step 2, calls
   `server.shutdown()`, and `main()` returns. The worker exits 0, so the SDK's `atexit`
   sends SIGTERM to any CLI child still alive. It logs `ev=shutdown` with the turn ids it
   answered.

**Why the 500 comes before the CLI stops:**

- The 500 is what saves the 10 h wait, so it must not sit behind a cleanup that can take 15 s
  against an unknown grace.
- A write landing between the 500 and the CLI's death is the same case as a SIGKILL after
  COMMIT, which D17 exercised and PR #2850's precondition de-duplicates.
- The redelivery arrives no earlier than `ErrorVisibilityTimeout` (300 s), which is longer
  than the grace, so the old CLI is gone by then.

**An in-flight `extraction_append`** ends one of two ways:

- **Rolled back**, when the CLI's socket closes before COMMIT. This includes the debug holds,
  which sit inside the transaction.
- **Committed without a `tool_result` in the transcript**, when the socket closes after COMMIT.
  The resumed attempt re-decides and the reextraction precondition refuses the duplicate.
  This is exactly the kill case, so no new engine work is needed.

**Compose:** the worker service gets `stop_grace_period: 30s`. This is above
`SHUTDOWN_GRACE_S` plus a margin, pinned by a config test.

### D3. Dead-letter close: a last-receive close plus a sweep

The worker never sees the DLQ. The three options, weighed:

- **The last receive knows it is last.** Assuming, as the Beanstalk docs state and U13
  verifies, that sqsd delivers receives 1..`MaxRetries` and moves the message on the receive
  after, a worker holding receive `SQSD_MAX_RETRIES` knows no further delivery will come. When
  such an attempt is about to answer non-200 (exception, `ResumeFailure`, SIGTERM), it closes
  the turn instead and answers 200, so the message never reaches the DLQ. This is instant, and
  it is exactly the handoff's "`MaxRetries` 1 plus a 500". It cannot cover a crash or SIGKILL
  on the last receive, because no worker code runs.
- **A DLQ consumer** needs an SQS client with DLQ permissions, and that client is U7 (SigV4). It
  also needs a new process. Rejected for now.
- **A sweep** covers the crash case. It is a daemon thread in the worker, every
  `SWEEP_INTERVAL_S` (default 300), and it closes open, non-held turns that no delivery can
  reach any more. A row qualifies when `completed_at IS NULL AND outcome IS DISTINCT FROM
  'queued'`, plus either of:
  - **Fast (exact when configured):** `receive_count >= SQSD_MAX_RETRIES AND claimed_at < now()
    - (SQSD_VISIBILITY_TIMEOUT_S + 60 s)`. The last receive's visibility has lapsed, so the
    message has gone to the DLQ, or will on its next receive.
  - **Backstop (always):** `COALESCE(claimed_at, enqueued_at) < now() - SQSD_RETENTION_PERIOD_S`.
    SQS has deleted the message whatever the configuration, which covers a mis-set
    `SQSD_MAX_RETRIES` and a turn never claimed because Postgres was down.

  Rows are taken `FOR UPDATE SKIP LOCKED`, so a second instance (after U6) cannot close one
  twice. Turn ids in this process's in-flight registry are skipped.

  **Each path is on only when configured.** This keeps the base compose profile, which runs
  on the developer's persistent `proto-pgdata` volume, from closing old smoke leftovers and
  releasing held messages into paid turns.
  - The fast path is off unless `SQSD_MAX_RETRIES > 0`.
  - The backstop is off unless `SQSD_RETENTION_PERIOD_S` is set.
  - `SWEEP_INTERVAL_S=0` turns the whole sweep off.
  - The sweep thread starts only when the interval is above 0 and at least one path is on.

  The Beanstalk template sets both paths and a 300 s interval. Base compose sets neither
  path. The sqsd overlay defaults `SWEEP_INTERVAL_S` to `0`, so neither smoke runs nor the
  billed run sweep the dev database. The only case that turns the sweep on is
  `crash_last_receive`, and it runs with the worker's `QUEUE_URL` empty.

  **Only whoever closes the row releases.**
  - `complete(only_if_open=True)` returns `None` when no row matched.
  - `run_turn` and `close_turn` call the release only when their own `complete()` closed the
    row. Otherwise a SIGTERM racing the attempt's own close could enqueue two held messages
    on one session.
  - Every release site goes through one helper, `release_next_held(conn, session_id)`. The
    helper releases nothing while the session has an active non-held turn (the
    `TURN_ACTIVE_SQL` predicate), then calls `release_queued_turn`.

  A last receive lost to a claim failure (Postgres down) writes no row. Only the backstop
  closes that turn.

**Chosen: the last-receive close plus the sweep.**

- **The latency split.** A worker that is alive on its last receive closes at once. A crash on
  the last receive closes about 10 h later, the same delay any crashed message already has at
  these values.
- **The sweep is the whole fix.** Without it, "dead-letter close" would cover only half the
  dead letters, and a session wedged permanently is the harm U5 names.

**The close is one function, `close_turn(conn, turn, receive_count, *, outcome, cause,
sdk_session_id)`:**

1. It calls `complete()` with a new keyword-only `only_if_open=True`, which adds
   `AND completed_at IS NULL` and skips the `turn_done` insert when no row matches.
   - `sdk_session_id` comes from the attempt, or from a `sessions` join in the sweep. Without
     it, the closed row's token columns would stay NULL even though its attempts billed.
   - `run_turn`'s own `complete()` and the stub `ok`/`sleep` arm's `complete()` also pass
     `only_if_open=True`. On SIGTERM's last receive, an attempt that reaches `complete()`
     before its cancel lands would otherwise overwrite `retries_exhausted` with `ok` and
     write a second `turn_done`.
   - This changes no existing behaviour: a turn that has already completed never reaches
     either call, because `serve_real_turn` checks `already_completed` first. A redelivered
     stub `ok` now writes no second `turn_done`.
   - The parameter's default stays `False`.
2. If step 1 closed the row, it then calls `release_next_held`, once, which is today's
   hand-over: the oldest held
   message is enqueued, and each later one is released at the end of the turn before it. That
   goes through `take_queued_turn`'s statement, byte-for-byte the web tier's, so
   `test_the_rescue_claim_is_the_workers_own_statement` stays the guard.

**Named outcome: `retries_exhausted`.** A new constant beside `NO_PROGRESS_OUTCOME`.

- It is neither `dead_letter` (on the fast path the message never reaches the DLQ) nor
  `interrupted` (reserved by U26 step 4 for a redelivery past the time limit).
- `detail` carries `cause`: `error`, `shutdown` or `sweep`. Error text stays in the log line,
  never in the patron's `turn_done` payload.
- Patron label, in `apps/web/src/components/chatEvents.ts`: "This run was interrupted too many
  times and has stopped. Send a message to carry on." `outcome` is free text in SQL, and no
  schema enum lists turn outcomes. `packages/schema` has none (checked), so no schema change is
  needed.

**The stranded release, fixed in the same PR.** `serve_real_turn`'s `already_completed` branch
calls `release_next_held`. Its active-turn guard stops a released held turn that is already
running from getting a sibling released beside it. `take_queued_turn`'s statement is not
touched.

## What changes

**Worker** (`apps/server/proto/worker/worker.py`):
- D2's SIGTERM handler, shutdown thread and in-flight registry. `run_turn` registers
  `(loop, cancel scope)` once it enters the scope, then checks `SHUTDOWN` again, so a SIGTERM
  in that gap cannot leave a CLI spawning after shutdown. The handler waits for the attempt
  or `SHUTDOWN`. After shutdown it answers 503.
- D3's `close_turn`, the last-receive branch in `serve_real_turn` and in the `fail` stub arm,
  the sweep thread, and the guarded `already_completed` release.
- `complete(..., only_if_open=False)`.
- `SQSD_*`, `SHUTDOWN_GRACE_S` and `SWEEP_INTERVAL_S`, read at start. `ev=start` logs them.
- New log lines `ev=shutdown`, `ev=close` (outcome, cause) and `ev=sweep` (count).
- Docstrings and comments that say `receive_count` counts "healthy ceiling crossings" (lines
  204–207, 459, 564–566, 885–887, 1084) now also name crash, deploy and SIGTERM receives.

**Shim** (`apps/server/proto/shim/`):
- `decide.py` gains:
  - `abandon`, a read timeout under `kill_on_read_timeout=False`: no kill, no requeue.
  - A fixed `error_visibility_s` that overrides the backoff when set.
  - `should_dead_letter(receive_count, max_retries)`, true when
    `receive_count > max_retries > 0`. It is a pre-POST check, separate from `decide()`,
    which maps a POST outcome.
- `shim.py` gains:
  - The four environment variables.
  - `VisibilityTimeout` on `ReceiveMessage` when set.
  - The DLQ send followed by the delete.
- `README.md`: the overlay and the new variables.

**Compose and queue** (`apps/server/proto/`):
- `docker-compose.yml`:
  - Worker `stop_grace_period: 30s`.
  - `SQSD_MAX_RETRIES: "${SQSD_MAX_RETRIES:-0}"` on worker and shim, plus the other `SQSD_*`
    with defaults that keep today's behaviour.
  - Header comment.
- New `docker-compose.sqsd.yml`: D1's overlay.
- `elasticmq.conf`: a `turns-dlq` queue, no redrive, with a comment.

**Beanstalk template** (new `apps/server/proto/eb-worker/`):
- `.ebextensions/01-sqsd.config`: D1's table plus the `SQSD_*` environment block.
- `.platform/nginx/conf.d/01-worker-timeouts.conf`: `proxy_read_timeout 43200s`, copied from
  the probe.
- `README.md`: a few lines on what U12 bundles.

The probe's files stay as the 2026-09-11 evidence record. `deploy.sh` overrides its
`.ebextensions` through the API with experiment values and `HttpPath "/"`, so production
values in that file would misstate what the probe runs.

**Compose checks** (`apps/server/proto/smoke.py`): new cases, each recreating the shim and
worker with the overlay and restoring the base profile in a `finally`, as `case_ceiling` does.
Postgres keeps old smoke leftovers on its persistent volume, so every case first counts
sweep-candidate rows outside its own session and prints the count. The overlay's header
warns that its sweep acts on the whole database.
- `sigterm`: set `ERROR_VISIBILITY_S=45`, which is above `SHUTDOWN_GRACE_S` plus restart time
  (pinned). Send `sleep 120`, then `docker restart -t 30 proto-worker` at 10 s. Expect:
  - the shim logs a 500 `requeue_backoff`, not `connection_reset`;
  - the worker logs `ev=shutdown`;
  - the first receive after the 500 completes `ok`.
- `dead_letter`: set `SQSD_MAX_RETRIES=1` and `SWEEP_INTERVAL_S=0` (sweep off), seed a held row
  on session S, then send a `fail` stub on S. Expect:
  - outcome `retries_exhausted`, cause `error`, and a `turn_done`;
  - the held row is released (outcome NULL, then completed by its own `ok` stub body);
  - the message deleted, not dead-lettered.
- `crash_last_receive`: set `SQSD_MAX_RETRIES=1`, `SQSD_VISIBILITY_TIMEOUT_S=30`,
  `SWEEP_INTERVAL_S=10`, and the worker's `QUEUE_URL` empty. The case has no held row, and an
  empty `QUEUE_URL` means a swept leftover can never enqueue a paid turn. It says up front
  that it will also close stale open turns outside its session, and prints their ids. Send a
  `crash` stub. Expect:
  - the shim logs `ev=dead_letter` on receive 2;
  - the sweep closes the turn `retries_exhausted`, cause `sweep`, within about 2 min.

  This is the live check of the sweep's real SQL on real Postgres.
- `past_ceiling`, **opt-in** (`--case past_ceiling`, about 31 min). It is in `choices` but
  not in the default `CASES` tuple, so `make proto-smoke` stays short: a `sleep 1850` under the
  overlay's production values completes on receive 1 with no `read_timeout`.

**Billed check** (`apps/server/proto/turn.py`): the `--kill` arm gains
`--kill-signal term|kill` (default `kill`, today's behaviour). `term` runs
`docker restart -t 30` instead of `kill` plus `start`. `RESUMED_FAILED_OUTCOMES`
(`turn.py:262`) gains `retries_exhausted`, and `test_proto_kill.py:247` is updated to match.
One short `proto-kill` on current `main`, under the overlay. The overlay reads
`ERROR_VISIBILITY_S` and `SWEEP_INTERVAL_S` from the shell. `proto-turn` runs
`$(PROTO_COMPOSE) up -d --build`, so the overlay has to be passed in `PROTO_COMPOSE` or the
base profile comes back:

```sh
ERROR_VISIBILITY_S=45 make proto-kill ARGS="--kill-signal term" \
  PROTO_COMPOSE="docker-compose -f apps/server/proto/docker-compose.yml -f apps/server/proto/docker-compose.sqsd.yml"
```

It should show:
- `ev=shutdown`;
- the shim's 500;
- `resumed` true and `list_subkeys` ≥ 1 on the first receive after the 500;
- `outcome` not in `RESUMED_FAILED_OUTCOMES`.

I will ask before running it.

**Web** (`apps/web/src/components/chatEvents.ts`): the `retries_exhausted` label.

**Docs:**
- `familysearch-handoff.md`:
  - U5 status.
  - Step 10: the `SQSD_*` variables, and `ev=shutdown`, `ev=close` and `ev=sweep` under step
    14's log list.
  - Step 11: values, statuses, the template path moved to `eb-worker/`, and the
    MaxRetries/ErrorVisibilityTimeout reasoning.
  - Step 12: the template path.
  - The acceptance step 4 note, marked [untested]: with U5, a SIGTERM redelivers after
    `ErrorVisibilityTimeout`, provided sqsd outlives the app process during the deploy;
    only a SIGKILL waits out `VisibilityTimeout`.
  - Table row "Compose … sqsd shim": the overlay.
- `docs/search-agent-prototype-report.md:93`: one clause.
- In passing: `proto/demo.py:19-21`'s stale "7200 s" and `search-agent-prototype.md:1244`'s
  "36000 s" for nginx (the file says 43200).

## What doesn't change

- **The compose base profile and every 1,800 s / 2,100 s pin**:
  - `STEP_CEILING_S`;
  - the elasticmq visibility test;
  - `test_proto_demo.py`'s `READ_TIMEOUT_S` export;
  - `test_proto_d17.py`'s token min-life.

  D17/D18 and `make proto-demo-auto` keep running where they ran.
- **The held-message claim statement** (`take_queued_turn` and `claim_queued_turn`), and the
  web tier's rescue.
- **Claim fencing** (U6), **the SigV4 client** (U7), **stub arm gating** (U11), **the
  1,800 s time limit and `interrupted`** (U26), **DLQ depth alarms** (U19).
- **The engine.** PR #2850's rollback already covers a SIGTERM's socket close.
- **The probe's `eb-worker-probe/` files.**

## Acceptance checks (fail today, pass after)

**Offline, in `make proto-test` and CI:**

- `test_proto_config.py`:
  - `test_sqsd_template_holds_the_interim_values`: 36000 equals Beanstalk's maximum; 36300 is
    above it and ≤ 43200; `MaxRetries` 5; `ErrorVisibilityTimeout` 300; `HttpPath` equals the
    worker's path.
  - `test_sqsd_template_env_matches_its_sqsd_options`.
  - `test_worker_nginx_read_timeout_exceeds_inactivity`.
  - `test_error_visibility_exceeds_the_worker_stop_grace`, for the template and the overlay.
  - `test_worker_stop_grace_covers_shutdown_grace`.
  - `test_sqsd_overlay_touches_only_sqsd_variables`.
  - `test_base_profile_keeps_unlimited_retries`.
  - `test_base_profile_disables_the_sweep`: no `SQSD_MAX_RETRIES` above 0 and no
    `SQSD_RETENTION_PERIOD_S` in base compose.
  - `test_smoke_error_visibility_exceeds_shutdown_grace`.
  - `test_sqsd_overlay_disables_the_sweep_by_default`.
- `test_proto_decide.py`:
  - `test_read_timeout_abandons_without_kill_when_disabled`;
  - `test_fixed_error_visibility_replaces_backoff`;
  - `test_receive_past_max_retries_dead_letters`;
  - `test_max_retries_zero_never_dead_letters`.
- `test_proto_worker.py`:
  - `test_last_receive_error_closes_retries_exhausted_and_releases`, which answers 200, runs
    `complete(only_if_open=True)` and calls `release_queued_turn` once;
  - `test_error_below_max_retries_still_answers_500`;
  - `test_max_retries_unset_never_closes`;
  - `test_close_failure_still_answers_500`;
  - `test_only_if_open_close_skips_a_completed_turn`;
  - `test_sweep_sql_selects_exhausted_and_expired_turns_only`, a statement-shape test on a
    recording connection;
  - `test_already_completed_releases_a_stranded_held_turn`;
  - `test_already_completed_does_not_release_beside_an_active_turn`;
  - `test_shutdown_answers_500_then_cancels_the_attempt`, in-process;
  - `test_shutdown_on_last_receive_closes_instead`;
  - `test_post_after_shutdown_answers_503`;
  - `test_post_after_shutdown_on_last_receive_closes`;
  - `test_attempt_completing_after_a_last_receive_close_writes_nothing`;
  - `test_sweep_is_off_unless_configured`, including `SWEEP_INTERVAL_S=0`;
  - `test_losing_the_close_race_does_not_release`;
  - `test_release_next_held_refuses_beside_an_active_turn`;
  - `test_shutdown_waits_for_replies_before_exit`, for a POST still inside `claim()`.
- **New `test_proto_shutdown.py`:** `test_sigterm_answers_inflight_500_and_exits_0`.
  - It starts the real `worker.main()` in a subprocess. A harness script first replaces
    `prepare`, `psycopg.connect` (with a fake connection that satisfies `claim`,
    `turn_completed` and `choose_sdk_session_id`) and the attempt, which blocks. CI has no
    Postgres.
  - It POSTs `/turn`, sends a real SIGTERM, and asserts a 500 with `shutdown: true`, then exit
    code 0 within `SHUTDOWN_GRACE_S`.
  - Today, as a non-PID-1 subprocess, the worker dies with -15 and no reply. The PID-1 case
    (SIGTERM ignored) is covered only by the compose `sigterm` case.
  - It is added to the `proto-test` recipe.
- `test_proto_kill.py`: `--kill-signal term` runs `docker restart -t 30`, and the default is
  unchanged. `retries_exhausted` counts as a failed resume.
- `apps/web` `chatEvents.test.ts`: `retries_exhausted` has a label.

**Compose, unbilled:** `make proto-smoke` passes the new `sigterm`, `dead_letter` and
`crash_last_receive` cases, plus the existing four. `past_ceiling` is run once and recorded in
the PR (run 2026-09-30: passed).

**Billed, asked first:** the one `proto-kill --kill-signal term` above.

**Break proofs**, in both directions, for each new guard:
- Revert the signal handler, and the subprocess test fails. Route any release site around `release_next_held`, and the AST test fails. With a handler that exits without
  answering, it fails on the missing 500.
- Set the template's `SQSD_MAX_RETRIES` to 4, and the env-match test fails. Reflowing the YAML
  still passes.
- Drop `only_if_open`, and the skip test fails.
- Remove the active-turn guard, and the sibling-release test fails.

## What's deferred, and where it is already tracked

None of this needs a new issue; each item is already a handoff item.
- **U13:** every AWS confirmation.
  - Beanstalk's stop grace.
  - Whether sqsd outlives the app process during an app-version deploy. If not, the 500
    reaches nobody and the message waits out `VisibilityTimeout`.
  - Whether sqsd delivers exactly `MaxRetries` receives.
  - sqsd's behaviour on a 500 (step 11's "Not measured").
  - Whether the 12 h visibility cap counts from the first-ever receive.
  - Re-sizing `MaxRetries` and `ErrorVisibilityTimeout`.
- **U26:** a deadline below `InactivityTimeout`, which closes the two-CLIs hazard by
  construction.
- **U19:** a DLQ depth alarm and a `retries_exhausted` count alarm.
- **U11:** gating the stub arms. D3 routes the `fail` arm through `close_turn` only so compose
  can test it.
- **U6:** fencing, for when the sweep meets a second instance. `SKIP LOCKED` prevents a double
  close, but fencing is still needed.

## Deviations during implementation

Recorded 2026-09-30, from the build and from a six-lens review. The review confirmed 22
findings, and each was checked by two refuters.

- **The held-release statement also sets `claimed_at = now()`.** This applies to both
  `take_queued_turn` and the web tier's `claim_queued_turn`, which stay byte-identical. The
  retention backstop dates a row by `COALESCE(claimed_at, enqueued_at)`. Without this, a held
  message typed more than 4 days ago and released during a sweep would be closed before it
  ran. No consumer reads `claimed_at` as the worker's claim, and the worker's claim overwrites
  it anyway.
- **SIGTERM releases are gated and bounded.**
  - A deferred release runs only once that session's attempt has actually finished. If it
    hasn't, the worker logs `ev=deferred_release_skipped` and the row stays held for the web
    tier's rescue.
  - Releases are bounded by `RELEASE_BUDGET_S` (6 s): a 2 s Postgres connect timeout and a
    3 s SQS timeout. That needed a new keyword-only `timeout` on `enqueue.sqs_call`.
  - `shutdown()` waits and releases a second time after `server.shutdown()`, and `main()`
    joins the shutdown thread.
  - The compose stop grace (30 s) is pinned to be at least `SHUTDOWN_GRACE_S` +
    `RELEASE_BUDGET_S` + 2.
- **A last-receive close that loses the race** answers 200 `already_completed` with the row's
  real outcome, and it still releases.
- **The sweep passes no `sdk_session_id` for a turn that was never claimed.** Such a turn has
  `entries_seq_before` NULL and would otherwise get the whole session's token totals.
- **Only turns answered 500 are listed in `ev=shutdown`'s `answered`.**
- **The `sleep` stub waits on `SHUTDOWN`** instead of calling `time.sleep`. The stub arms moved
  into `serve_stub_turn`. `connect=` defaults go through a `pg_connect` wrapper so the
  subprocess harness can patch the connection.
- **Shim, under the overlay:**
  - A refused or reset connection also waits `ERROR_VISIBILITY_S`, as sqsd would, instead of
    requeuing at 0.
  - With `SQSD_MAX_RETRIES > 0`, the shim checks at startup that `DLQ_URL` is reachable and
    exits 2 if it isn't.
  - The error-requeue path now pauses `REQUEUE_PAUSE_S`.
- **Base compose** also sets the worker's `SWEEP_INTERVAL_S` to 0 and gives the shim
  `DLQ_URL`. A shell that exports `SQSD_MAX_RETRIES` then can neither start the sweep nor
  crash-loop the shim.
- **Smoke.** `smoke.py` honours `PROTO_COMPOSE`, which this laptop needs because it has no
  `docker compose` plugin. Its preflight checks that `turns-dlq` exists. `sqsd_profile`
  always restores the base profile. `crash_last_receive` runs with `ERROR_VISIBILITY_S=5`.
- **New guards beyond the acceptance list:**
  - an AST test that `release_queued_turn` is called only inside `release_next_held`;
  - tests of the post-registration `SHUTDOWN` re-check, the stub arm's `only_if_open`, and the
    sweep thread's real call;
  - `test_no_compose_file_overrides_the_worker_shutdown_grace`.
- **`make proto-kill` now pins `AUTONOMOUS_MAX_NUDGES` to 0 by default**, as
  `make proto-demo` does and as `turn.py`'s docstring already said. The web tier stamps its
  own cap of 60 (item 1a), so the first billed SIGTERM run (2026-09-30, $0.13) resumed
  correctly but was nudged as an autonomous run on receive 2, ended `no_progress` with no
  project, and failed the kill check. This existed before U5; a `docker kill` would hit it
  too. Pinned by `test_proto_kill_pins_a_one_turn_run_unless_the_caller_sets_nudges`.

## Results, 2026-09-30

- **Offline:** `make test-all` passes. `make proto-test` passes.
- **Compose, `make proto-smoke` from this worktree:** 29/29 checks. That covers the existing
  `ok`, `fail`, `crash` and `ceiling` cases and the new `sigterm`, `dead_letter` and
  `crash_last_receive`. The opt-in `past_ceiling` passed 2/2: a 1,850 s POST completed on
  receive 1, with no read timeout.
- **Billed, `proto-kill --kill-signal term` under the overlay:** 9/9 checks after the
  nudge-cap fix, at $0.085.
  - The SIGTERM got a 500 with `shutdown: true`; `ev=shutdown` reported drained in 2.5 s.
  - The shim requeued after 45 s.
  - Receive 2 resumed the same SDK session and closed `ok`.
