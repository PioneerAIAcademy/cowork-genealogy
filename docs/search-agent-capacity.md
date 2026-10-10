# Search agent capacity: quota, scaling, packing, compute

**2026-10-09, handoff U18; §3's CPU run 2026-10-10.** For Richard and the FamilySearch leads
he routes it to. It covers U18's offline half: the model quota, a scaling metric, worker
packing and the compute cost at U26's 1,800 s grain, plus packing's CPU run on AWS (§3).
The gateway load run is still open. It waits on F1
and F5 ([the handoff](./plan/familysearch-handoff.md)). The review is FamilySearch's
architecture review draft (SC-12457, 2026-09-07 copy, not in this repo). Rates are tokens a
minute per session, not per run. Settled means after a call ends. Unless marked
"measured", a figure is an estimate.

## Bottom line

- **The quota premise was wrong in both directions.** The handoff compared ~166k tokens a
  minute per session with a 2M TPM default. On Bedrock, cache reads do not count against
  TPM, and output counts 5× for Sonnet 4.6. Counted that way, a session settles at
  ~26–43k a minute (estimate: the e2e corpus, n=88, and two single runs). The published default for Sonnet 4.6 is 6M TPM, not 2M.
- **The binding quota is tokens per day, not TPM.** The default is 700M per account and
  Region, across all models. That covers ~12 sessions running around the clock, or ~550
  runs of 1,800 s a day. The quota increase has to name it.
- **The throttle decides on a reservation that nobody has measured.** Bedrock reserves
  input + `max_tokens` when a call starts. Our CLI's `max_tokens` on the gateway path is
  unknown.
- **Scaling metric:** slot utilisation, `(Visible + NotVisible) / (instances ×
  HttpConnections)`, with scale-in protection that the worker sets on itself. There is a
  two-alarm fallback if Blueprint can express only one SQS metric per policy. Visible
  depth alone cannot scale in.
- **Packing:** memory allows ~10 turns on a t3.large and ~21 on a t3.xlarge. Propose
  `HttpConnections` 4 and 8 respectively. 8 on a t3.xlarge is measured: 0.89 cores
  average, under its 1.6-core credit baseline, with no surplus credits charged (U18,
  2026-10-10, n=1). 4 on a t3.large is not measured.
- **Compute:** the review's ~$0.04 is the worker slot alone. The 1,800 s cap leaves
  slot-time per session unchanged. At 8 slots per t3.xlarge a 75.7-minute session holds
  ≥ $0.026 of slot-time. The whole fleet at 50 concurrent runs is ~$0.06 a session, under
  1% of model cost. Below ~30 concurrent runs, the always-on floor of ~$0.95–1.14/h
  dominates.

## 1. Model quota

### How Bedrock counts

From AWS's quota documentation ([token burndown][burndown], [runtime metrics][metrics],
fetched 2026-10-09):

- **Settled charge:** input + cache write + output × burndown. **Cache reads are not
  counted.** Per AWS's worked example, the same settled figure is deducted from the per-day
  quota too.
- **Burndown:** 5× for Anthropic models version 4.7 and below (Sonnet 4.6, Sonnet 4.5,
  Haiku 4.5). 10× for Sonnet 5, Opus 5, Opus 5.5 and Fable 5.1. 15× for Claude 4.8.
  `gps-mentor` runs on `claude-sonnet-5`, so its output counts at 10×.
- **Throttling** is decided on a reservation made when a call starts: input + cache write
  + `max_tokens`. The unused part is returned at the end. An unset `max_tokens` reserves
  the model's maximum output.
- **Metrics** (`AWS/Bedrock`, dimension `ModelId`, the inference-profile id for
  cross-region calls, 1-minute): `EstimatedTPMQuotaUsage` (the settled charge; AWS says it
  ignores the reservation), `InvocationThrottles`, `InvocationClientErrors` (where a
  quota rejection lands), `TimeToFirstToken` (streaming calls only), and the four token
  counts.

**Measured in our test account** (2026-10-09, n=1 per arm,
`global.anthropic.claude-sonnet-4-6`, `apps/server/dev/probe_bedrock_quota.py`). Each call
ran alone in its own minute:

| Arm | Input | Cache write | Cache read | Output | `EstimatedTPMQuotaUsage` |
|---|---|---|---|---|---|
| Output | 26 | 0 | 0 | 1,203 | 6,041 = 26 + 5 × 1,203 |
| `maxTokens` 8,000, 4-token reply | 14 | 0 | 0 | 4 | 34 |
| Cache write | 13 | 8,814 | 0 | 4 | 8,847 |
| Cache read | 13 | 0 | 8,814 | 4 | 33 |
| Uncached | 8,829 | 0 | 0 | 4 | 8,849 |

The metric applies the documented formula exactly. It shows how AWS estimates the
charge, not what it throttles on. Throttle onset and the reservation need the load run's
throttle arms (§5).

### Defaults, and what an account actually gets

| Quota (Sonnet 4.6, us-east-1) | Published default | Adjustable |
|---|---|---|
| Cross-region TPM (`us.*` profiles; the worker's) | 6,000,000 | yes |
| Cross-region RPM | 10,000 | yes |
| Global cross-region TPM (`global.*`) | 6,000,000 | yes |
| In-Region on-demand TPM / RPM | 3,000,000 / 5,000 | no |
| Cross-Model Max Tokens Per Day (all models, per account and Region) | 700,000,000 | Support case only |

Source: [the AWS General Reference quota table][gr] (fetched 2026-10-09). Read through
Service Quotas the same day, our test account's Sonnet 4.6 TPM is at the 6M default. Its
per-day quota has been raised to 3 trillion. So per-day values vary by account, and only
the account F5 names can show ours. Where the handoff's 2M came from is unrecorded. It
may have been an applied value in the account P3 used.

### Tokens a minute per session

| Source | Settled (5× output, reads exempt) | All tokens at 1× |
|---|---|---|
| e2e corpus, whole run, **estimate** (n=88, Sonnet 4.6, 1 h cache TTL) | median 25,617, p90 30,174 | median 177,502 |
| e2e corpus, whole run, exact (n=2 complete, 2026-10-05) | 25,302–25,961 | 169,548–228,012 |
| e2e corpus, two more runs lacking main-thread output (lower bounds) | ≥ 12,891, ≥ 17,042 | ≥ 108,723, ≥ 131,536 |
| e2e corpus, main thread only, exact (n=158) | median 18,942 | median 159,881 |
| D18 bagley attempt, 1,804 s, 5-minute TTL (n=1) | 42,659 | 154,248 |
| U13 acceptance turn, 13,565 s, 5-minute TTL, worker meter (n=1) | 37,111 | 111,817 |

- **Where 166k came from:** the main-thread all-tokens median of the corpus as it stood on
  2026-09-09 (165,897, n=131). That is the billing view. Cache reads are 94% of it, and
  Bedrock does not count them.
- **The hosted path settles higher than the corpus.** Through the gateway the cache TTL
  is 5 minutes (R2), so more reads become writes, and writes count. Cache writes are 10–18% of
  input-side tokens on the two 5-minute runs, against ~7% on the corpus. Plan on **~40k a minute** per session until the
  load run measures it.
- **Peaks:** a session's busiest minute is 4.1–6.1× its mean in the settled view on the
  two complete runs (104k–150k), and up to 6.9× on two runs that lack main-thread output.
  At 40k a minute that is ~160–280k.

Corpus figures: `python3 apps/server/dev/tpm_runlogs.py .` at `eb77ba74d` (the `b5-cr`
rows are the settled view). The corpus ran on the e2e harness with 1-hour cache writes and
no time limit.

### What that means at the review's targets

| Concurrent sessions | Settled TPM on means (40k) | Tokens a day if sustained around the clock |
|---|---|---|
| 50 | 2.0M | 2.9B |
| 150 | 6.0M | 8.6B |
| 500 | 20M | 29B |

- **TPM:** 50 sessions fit the 6M default on means. 150 sit at it. 500 need ~3.3×. Peaks
  do not line up across sessions, so the aggregate peak minute falls between N × mean and
  N × peak. With 50 sessions that is 2.0M–14M.
- **Tokens per day:** 700M is ~12 sessions sustained, or ~550 D18-shaped 1,800 s runs (1.28M
  settled each). At the review's sustained 50, the per-day quota runs out in ~6 hours.
  **File the increase for both.** AWS raises the per-day quota only through the Support case
  that goes with a TPM request. It gives priority to accounts already using their
  allocation, so the load run's CloudWatch history is the evidence.
- **Reservation:** unmeasured. The worker sets no `max_tokens`
  (`CLAUDE_CODE_MAX_OUTPUT_TOKENS` is unset), and the CLI's own default on the gateway path
  is unknown. If a call reserves 32,000, a session making 4 calls a minute reserves ~128k
  against ~40k settled. Fifty such sessions would hold ~6.4M at the peak. This arm decides
  whether the 6M default throttles 50 sessions.
- **Several quotas are in play:** Sonnet 4.6 (`us.anthropic.claude-sonnet-4-6[1m]`, main
  thread and most agents), Sonnet 5 (`gps-mentor`, at 10× burndown) and Haiku 4.5 (the CLI's
  small model, `GATEWAY_SMALL_MODEL`). Each has its own TPM row. All three draw on one
  per-day quota.
- **Before F5 the quota is not ours.** Until our `tap-gateway-invoke` role exists (ETA
  December), every call goes through TAP's shared pool (R2). Other tenants draw on the same
  quota, and its CloudWatch sits in TAP's account.

## 2. The scaling metric

At run grain, a running turn is a message sqsd holds in flight, which SQS counts as
`ApproximateNumberOfMessagesNotVisible` (NV). `ApproximateNumberOfMessagesVisible` (V) stays
at 0 until every slot is busy and patrons wait. That is R4's flaw: V is a late but correct
signal to scale out, and useless for scaling in, because it reads 0 both when the tier is
idle and when it is full. Held messages live only in Postgres (`queued` turns), never in
SQS, which is right: they cannot run until their session's turn ends.

**Primary, on stock Beanstalk, once U6 lifts the 1/1 instance limit:**

- **Target tracking on slot utilisation:** `(FILL(V,0) + FILL(NV,0)) / (HttpConnections ×
  MAX(GroupInServiceInstances, 1))`, Maximum per minute. Target 0.75 (provisional),
  instance warmup 180 s.
- **Where it lives:** `.ebextensions` `Resources` (`AWS::AutoScaling::ScalingPolicy` on
  `AWSEBAutoScalingGroup`, with the queue from `AWSEBWorkerQueue`), because
  `aws:autoscaling:trigger` cannot name an SQS metric. It needs `GroupInServiceInstances`
  collection, and Beanstalk's default trigger pushed out of range.
- **Scale-in protection, set by the worker on itself.** Scaling in mid-turn costs the run:
  a SIGTERM answer, a ≥ 300 s redelivery, a resume and a context re-write. And if
  termination stops sqsd before the worker, as every deploy does, the message waits out
  `VisibilityTimeout` instead. So the worker turns protection off after ~120 s with no
  turn, turns it back on before it claims one, and answers 503 while its instance is
  `Terminating`. The 503 path already exists for SHUTDOWN. This needs
  `autoscaling:SetInstanceProtection` on its own group and `NewInstancesProtectedFromScaleIn`.
- **Phantoms only over-provision.** NV also counts a message a deploy or crash left
  invisible, until `VisibilityTimeout` passes: 36,300 s now, just above 1,800 s after U26.
  It also counts a 500'd message, for `ErrorVisibilityTimeout` (300 s). Whether sqsd reads
  ahead beyond `HttpConnections` is undocumented, and one message on the rehearsal host
  would tell. Later, a busy-slot fraction the worker publishes, from its turn-user pool
  rather than `_INFLIGHT`, which counts attempts, removes the phantoms.

**Fallback, if Blueprint's `Simple Scaling v1_0` takes one SQS metric per policy:**

- **Out:** V ≥ 1 (Maximum, 60 s) for 2 of 2 points; +50% (at least 1); cooldown 240 s.
- **In:** NV ≤ 0 for 15 of 15 points; back to the minimum; cooldown 900 s. So it scales in
  only when the whole tier is idle. Before U26 a deploy phantom blocks this for ~10 h, and
  after U26 for ~32 min.
- The same worker-set protection.

**Quota is admission, not scaling.** Adding workers adds no model capacity. Past the
quota it adds 429s, which the CLI retries inside the turn. Bound `MaxSize` ≤ 0.8 × TPM
quota / (per-session settled mean, ~40k, × `HttpConnections`), about 15 instances at 6M
and 8 slots, and alert on `InvocationThrottles`
rather than scaling on it. Alerts, not scaling: V ≥ 1 for 5 minutes at `MaxSize`, the
DLQ, and protected but idle instances.

## 3. Packing

From U13's M49 (2026-10-08, n=1, t3.large, `HttpConnections` 2): two seeded autonomous
turns overlapping 599 s with 58 subagent calls peaked at 520.3 MB in `web.service`. The
largest single process was `claude` at 347.5 MB. `MemAvailable` never fell below
6,635.8 MB. Light turns peaked at 471.3 MB.

From U18's CPU run (2026-10-10, n=1 per count): `concurrent_rss_heavy` on one t3.xlarge
(4 vCPU, 15.4 GiB, credit mode `unlimited`, the first time the mode was recorded) under the
`worker_xlarge` case (worker bundle from PR #3302, the cases' tooling), slots set by
`slots_4` and `slots_8`, 1 turn at the default 2. Windows
were 900 s at 0 turns and 1,800 s otherwise. Every turn was seeded on one patron's
FamilySearch grant, all ran at once, and each was received once. bounds passed 12/12, 19/19,
28/28 and 40/40. Across 8 concurrent sessions on one patron: 0 rate-limit tool results and 0
reauth hits (bounds does not log CLI-internal retries). Model spend $58.89 against the ~$64
estimate.

`web.service` cgroup (`cpu.stat`) and host samples. RSS is a whole-host total; Postgres is
`pg_stat_activity` across the whole database (web, tools, worker and RDS internals, excluding
bounds' own), with the `turn:`-tagged connections in brackets:

| Turns | CPU avg, cores (core-s) | CPU peak, cores | load1 peak | steal | Peak total RSS | cgroup RSS | Largest process | Min available | Postgres peak (turn) | Model spend |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.000 (0.2) | 0.002 | 0.36 | 0.08% | 604 MB | 67 MB | 130 MB (CloudWatch agent) | 15.0 GB | 7 (0) | $0 |
| 1 | 0.107 (192.5) | 0.252 | 0.52 | 0.18% | 959 MB | 307 MB | 349 MB `claude` | 14.8 GB | 10 (1) | $4.75 |
| 4 | 0.448 (807.3) | 1.055 | 1.92 | 0.5% | 2,010 MB | 1,020 MB | 366 MB `claude` | 14.1 GB | 17 (4) | $17.62 |
| 8 | 0.89 (1,603.2) | 1.987 | 2.26 | 0.85% | 3,361 MB | 1,925 MB | 362 MB `claude` | 13.2 GB | 25 (8) | $36.52 |

CloudWatch, worker instance. "avg" is the mean of the 5-minute Average points; "max" is the
largest Maximum statistic, not a 5-minute average:

| Turns | `CPUUtilization` avg | `CPUUtilization` max | `CPUCreditBalance` | `CPUSurplusCreditsCharged` | RDS CPU avg / max |
|---|---|---|---|---|---|
| 0 | 1.1% | 1.2% | 44 → 60 | 0 | 4.4% / 5.5% |
| 1 | 4.1% | 7.7% | 67 → 104 | 0 | 4.6% / 6.3% |
| 4 | 12.7% | 25.2% | 282 → 309 | 0 | 5.0% / 7.1% |
| 8 | 23.3% | 46.4% | 241 → 255 | 0 | 5.5% / 8.6% |

- **Per turn:** one `claude` process. Subagents run inside it, MCP goes over HTTP to tools,
  and plugin-hook interpreters are short-lived. Plan on **512 MB a turn**, a round
  allowance for growth to 1,800 s that was not measured over time, and ~700 MB fixed per
  instance. With 25% headroom, memory allows **~10 turns on a t3.large and ~21 on a
  t3.xlarge**. `/tmp` (half the RAM) peaked at 40 MB for two turns. Against that allowance
  (1.2 / 2.75 / 4.8 GB at 1 / 4 / 8 turns), the measured peak total RSS was lower at every
  count: 0.96 / 2.0 / 3.4 GB (U18, 2026-10-10, n=1).
- **CPU:** about 0.11 cores a turn, roughly linear (U18, 2026-10-10, n=1; tables above). A
  t3.xlarge's credit baseline is 40% of its 4 vCPU, 1.6 cores. At 8 turns the average was
  under it, and one Maximum reading (46.4%) went over it, during the opening burst. No
  surplus credits were charged at any count. One Python process upserts
  every streamed delta for every slot. Each U26 continuation restarts the CLI and reloads
  the transcript.
- **Proposal:** `HttpConnections` **4 on a t3.large, 8 on a t3.xlarge**, below the memory
  ceilings. 8 on a t3.xlarge is confirmed for CPU, memory and Postgres at n=1 (U18,
  2026-10-10): `CPUUtilization` averaged 23.3% against the 40% baseline, with a peak of
  46.4% (CloudWatch Maximum statistic) in the opening burst. 4 on a t3.large is not measured:
  its 0.6-core baseline is above the 0.448 cores measured at 4 turns on the t3.xlarge, but
  that is inference. Fewer slots also means fewer runs cut by a deploy or a
  lost instance (U13 M35). If sustained CPU exceeds the T3 baseline, move to a
  non-burstable 4 vCPU / 16 GiB type rather than cutting slots.
- **The measurement that confirmed it for the t3.xlarge** (run 2026-10-10, tables above):
  a U13 `concurrent_rss_heavy` at 4 and 8 slots on a t3.xlarge, held for the full 1,800 s,
  after 0-turn and 1-turn baselines. It recorded cgroup
  `cpu.stat`, load average, per-process RSS and CPU time, CloudWatch `CPUUtilization` and
  `CPUCreditBalance`, and a `pg_stat_activity` count. Estimated model spend: ~$21 at 4 slots,
  ~$43 at 8; measured $17.62 at 4, $36.52 at 8 and $58.89 with the 1-turn baseline.
- **Postgres:** each turn holds two connections for its whole life: the turn's own, and the
  grant connection holding the patron's session-level advisory lock, which a transaction
  pooler cannot share. The session store opens one more per append. Plan on ~3N + 3 per
  worker instance at N slots. Fifty concurrent runs need ~150 worker connections plus web
  and tools. U13's db.t3.micro allows ~112 by the RDS formula (not measured); a
  db.r7g.large is far above. Measured at 8 turns (U18, 2026-10-10, n=1): the whole-database
  peak was 25 connections, one of them `turn:`-tagged per turn, below the 27 this estimates
  for one worker at N=8; the per-worker 3N + 3 itself was not isolated.
- **Changing the slot count:** the predeploy hook creates eight slot users,
  `genealogy-turn-0` to `-7`. `HttpConnections` (step 11) and `WORKER_TURN_USERS` must name
  the same N, the first N of those eight: `02-worker.config` sets 2 and 2, and the U13
  rehearsal's `slots_4` and `slots_8` probe cases set both at API level in one configuration
  update (`check_options` refuses a pair that disagrees). `test_proto_bundles.py` pins the
  template's users as a prefix of the hook's, their count to `HttpConnections`, and the
  hook's count to the largest slot case. Past eight, grow the hook's list first: a name the
  hook never creates refuses start. More connections than users answers 500 and spends a
  `MaxRetries` receive.

## 4. Compute cost

Prices (us-east-1 Linux on-demand, AWS price maps, 2026-10-09): t3.large $0.0832/h,
t3.xlarge $0.1664/h, m7i.xlarge $0.2016/h.

- **The review's ~$0.04 / $0.08 / $0.13** is the worker slot alone: $0.1664 ÷ 4 slots, held
  for the review's own durations of 55.7, 108.2 and 180.4 minutes, gives $0.0386, $0.0750
  and $0.1251. Its prose mentions a web and tools share, which would add ~$0.03 at the
  median. It prices no database and no always-on floor.
- **Slot-time at 8 slots per t3.xlarge** (the same per slot as 4 per t3.large): $0.0208 per
  slot-hour. A full 1,800 s run costs $0.0104. A 75.7-minute session (the current median,
  `cost-latency-10x.md`) costs ≥ $0.026. U26 splits that session into 3 or 4 runs (each
  winds down near 1,500 s) without shortening its slot-time. The saving against the review
  comes from packing, not from the cap.
- **Whole fleet at 50 concurrent runs,** sustained: 9 workers at a 0.75 slot target, 3 web
  and 3 tools on t3.large, and a db.r7g.large-class database. That is ~$2.5/h, ~$0.06 a
  session, under 1% of model cost. At the review's 4-slot packing it is ~$0.10.
- **Always-on floor:** 2 workers, 2 web, 2 tools and one database writer come to
  ~$0.95–1.14/h, ~$700–835 a month, before load balancers, queue, storage and transfer. It
  dominates per-session compute below ~30 concurrent runs: ~$1.20–1.44 a session at one
  concurrent run, ~$0.14 at 10. The database price is a stand-in: Aurora r7g.large was not
  found.
- **What this does not move:** model spend is still essentially all of the cost. Two
  effects move it the other way. Each U26 continuation re-writes an expired cache and ends
  with a forced summary, which raises model cost per session (unmeasured). And T3 Unlimited
  credits would add up to ~70% to a worker instance if turns burn CPU; at 8 turns on a
  t3.xlarge they did not: no surplus credits were charged (U18, 2026-10-10, n=1).

## 5. The load run (still open)

It needs F1 (integ URL and key) and F5 (our `tap-gateway-invoke` role and its account, with
read access to its `AWS/Bedrock` metrics and the gateway's ECS metrics). Before F5, only
non-throttling steps may run, with APT's agreement.

- **Calibration** (~$12, single tenant only):
  - Burndown and cache-read accounting in the metric. Done above, in our test account.
  - The reservation: bursts of K calls at `max_tokens` 32,000. Throttling should begin
    near K × 32k = TPM.
  - Cache reads held above the TPM quota for 3 minutes. No 429 means they are exempt from
    the throttle too.
  - Optional (~$20): output held at 5 × O ≈ 1.3 × TPM.
- **Ramp** (~$157): 1 → 4 → 8 → 16 real 1,800 s runs through the worker on the gateway,
  with starts staggered. Stop at > 1% 429s, any 503/529, or a doubled p90 time to first byte.
  Record, per minute:
  - settled, reserved and billed TPM, from a client ledger that keeps each call's
    `max_tokens` and usage;
  - 429s, separating Bedrock's `ThrottlingException` from anything the gateway adds;
  - time to first byte against `TimeToFirstToken`;
  - the gateway task's CPU and memory (one 0.25 vCPU task today);
  - V, NV and the age of the oldest message;
  - worker cgroup memory and CPU, which also confirm §3.
- Draw the 50-session figure from the ramp plus the reservation arm. A 50-session step
  alone would cost ~$270.

## 6. Asks this adds to F5 and F14

- The applied quotas in our account, for Sonnet 4.6, Sonnet 5, Haiku 4.5 and Cross-Model
  Max Tokens Per Day. Who files the increase, and that the per-day quota goes in the same
  Support case.
- Read access to `AWS/Bedrock` in that account, and to the gateway's ECS metrics and
  access log for the load run.
- Does agentgateway retry 429s itself, apply a per-consumer limit, or log each request's
  `max_tokens` and usage?
- F14, Blueprint: can `Simple Scaling v1_0` carry two policies on different SQS
  metrics, name a custom metric, or take a metric-math target? Can the worker role call
  `SetInstanceProtection` on its own group? Which T3 credit mode applies?

[burndown]: https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html
[metrics]: https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html
[gr]: https://docs.aws.amazon.com/general/latest/gr/bedrock.html
