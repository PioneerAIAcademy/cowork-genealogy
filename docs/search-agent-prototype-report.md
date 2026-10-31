# Search Agent prototype — results

**2026-09-29 · Dallan Quass · for Richard and the FamilySearch leads he shares it with.** Evidence:
[the prototype plan](./plan/search-agent-prototype.md). What is left, and how to deploy:
[the handoff](./plan/familysearch-handoff.md).

- **Current stack:** today's product, run by the e2e harness.
- **Prototype:** the queue-and-worker system here.
- **D, P, R:** plan labels: build steps (D17 kill-resume acceptance, D18 cost and quality),
  probes (P1 resume, P2 no project directory, P3 Bedrock and gateway), risks.
- **Step ceiling:** the compose shim's 1,800 s per attempt, standing in for sqsd's
  `InactivityTimeout`. Passing it is a **crossing**: cut, redelivered, resumed. Production
  runs will not cross (handoff U5, U26).
- **Corpus:** the current stack's committed e2e run logs.
- **Fixture:** a benchmark task with a known answer. bagley (`bagley-father-1884`) and paerai
  (`paerai-teupooihi-spouse`) each have one expected finding, f1.
- **Judge:** Claude Haiku 4.5, grading each finding true, partial or false, and proof 1–3. A
  **blind human grade** does so without seeing it.
- **Delegation:** a call to a plugin subagent; a **foreground** one blocks the main thread.
- **Tool search:** the CLI loading tool schemas on demand.
- **The review:** FamilySearch's architecture review draft (ARB, SC-12457, 2026-09-07 copy).
- **TAP:** APT's Bedrock gateway: `fs-eng/tap-agentgateway` on Fargate, which every probe
  here used, and since its EKS port `fs-eng/tap-gateway`, which callers are moving to (APT-1880
  retires Fargate). A **local copy** runs its `/bedrock` route config on our machine.

## Bottom line

- **The go/no-go passed once.** D17, 2026-09-23, n=1 valid run after three that did not pass:
  killed mid-delegated write, resumed from Postgres in a fresh process, completed; nothing lost
  or doubled; no shell. Pre-merge build, not re-run on merged `main` since PR #2870 changed the
  resume path.
- **Resume re-decides; it does not replay.** A delegation in flight re-runs from its start; a
  kill loses its spend.
- **It supports, at n=1 and one patron,** the risky half: SDK resume as checkpoint, state in
  Postgres and S3, no shell, one shared tool server over HTTP.
- **It did not exercise the deployment:** compose, Anthropic API direct, one worker, one patron,
  no sign-in, no per-project authorization. Nothing ran through FamilySearch's deployed gateway;
  on AWS, then, only a hello-world Beanstalk worker and P3's Bedrock calls; research turns have
  run there since (U13, 2026-10-07/08 and 2026-10-10, n=1 per case; Other gaps below).
- **Real sqsd does not kill the worker when it cuts a POST;** the compose shim did, and every
  crossing so far relied on it; the passing run never crossed. A Beanstalk cut would run two CLIs
  on one session, so until the time limit lands sqsd is set to cut only a run past 10 h (U5).
- **Quality parity is not established:** prototype trees are judge-only, and the judge
  over-credited the same-week current-stack run.
- **Cost: 1.37× the current stack** (bagley, 2026-09-24, n=1 a side, tool search on).
  Production's tool-search-off cost is unmeasured.
- **The grain changed:** since PR #2870 one message is a multi-hour run (interim). Once
  [our cost-and-latency plan](./plan/cost-latency-10x.md) lands (not started, no date), every
  run ends at 1,800 s (handoff U26): the grain autoscaling, packing and retries are designed
  for. The patron's next message continues.

## What was built

| Component | Prototype | FamilySearch |
|---|---|---|
| Web tier | Stateless FastAPI: turns, queue messages, resumable SSE from Postgres, Stop. **No authentication.** | Beanstalk web tier |
| Queue | elasticmq; one message per turn, ids in the body; visibility 2,100 s, no redrive | SQS and DLQ |
| sqsd | A shim that also kills the worker at the ceiling | Beanstalk sqsd |
| Worker | Claude Agent SDK 0.2.128 / Claude Code CLI 2.1.220, resumed from Postgres; no `Bash` or web tools; a hook denies file reads and raw writes, logs calls, forces explicit background calls to the foreground | Beanstalk worker tier |
| Postgres 16 | Documents, blob index, SDK transcript, turns, events, tool-call log | RDS |
| S3 | MinIO, immutable objects | S3 |
| Tool server | 48 MCP tools (2026-09-29) over Streamable HTTP, one process for all patrons. A project request is refused 403 unless its bearer is the one the worker stamped on that open turn of that project (U4, 2026-10-13). | Beanstalk environment (handoff step 9; platform per F12) |
| Browser | `apps/web` on SSE; Vite dev server only | Static, behind the edge |

- **Beanstalk probe** (D3, 2026-09-11, torn down): sqsd 3.0.5 cuts the POST at `InactivityTimeout` silently and redelivers after `VisibilityTimeout`: 300 s idle at 2,100 / 1,800. The worker tier always creates a DLQ.
- Measured on Beanstalk since (U13 rehearsal, 2026-10-07, n=1 per case, handoff U13): the bundle cap is 500 MiB; a worker 400 or 500 is redelivered after `ErrorVisibilityTimeout` and dead-lettered after exactly `MaxRetries` receives; every deploy stops sqsd first, so a message in flight across a deploy waits out `VisibilityTimeout`; `/tmp` is a tmpfs of half the RAM. During the acceptance turn (U13, 2026-10-08, n=1) the instances resolved, besides AWS service endpoints and RDS, `api.anthropic.com` and the CLI's Datadog telemetry intake from the worker, and FamilySearch, the wiki and Pop Stats sidecar host and `en.wikipedia.org` from tools; with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` on the worker the CLI made no lookups of the intake (64 worker lookups, 0 to it; without it every CLI start resolves it within ~17 s), so a closed VPC need allow only the Anthropic API for the CLI, given that variable (U13, 2026-10-08, n=1); a run in a VPC with no internet route is still untested. Two concurrent seeded `/research --autonomous` turns, overlapping 599 s with 58 subagent calls, peaked at 520.3 MB in the worker's `web.service` cgroup (all processes 1,279.4 MB; `MemAvailable` never below 6,635.8 MB), the measured peak under real load (U13, 2026-10-08, n=1).

**Since D17 and D18:** PR #2870 (merged 2026-09-27) runs a browser turn until the project completes, 60 continue-nudges, or $35 a session, with a zero-progress guard, Stop, held messages (sent mid-run, queued until it ends) and a 1,800 s step ceiling.

## Acceptance

| # | Criterion (1–3 are the go/no-go) | Result and evidence |
|---|---|---|
| 1 | Killed mid-delegation, resumes and completes | **Pass.** D17 final, 2026-09-23, n=1 |
| 2 | Nothing lost | **Pass.** Same run |
| 3 | Zero `Bash`, zero allowed project-file reads | **Pass.** Same run (2 `Glob`s denied) and five other audited runs. `disallowed_tools` removes `Bash` (`make probe-bash-deny`, 2026-09-10, pinned SDK/CLI only). |
| 4 | Tool durations logged, nothing unbounded | **Observed.** Same run: 120 timed calls, longest 893 s (`Agent`). D18 bagley waited 1,586 s on one delegation, 88% of 1,800 s. |
| 5 | No project directory costs no quality | **No cost detected, n=3, current stack only** (P2, 2026-09-10, CLI 2.1.139, judge only). The verdict tracked one record-index search, not the arm. |
| 6 | A batch ledger makes replay idempotent | **Became a finding** (P1, 2026-09-10, n=1): resume re-decides; ledger cut. |

- **The pass:** `sess_f1741b2fa383478b`, bagley, three turns, $8.44 (killed attempt excluded), Sonnet 4.6; `main` plus unmerged PR #2850 and PR #2852 and a since-withdrawn token broker.
- **Kill:** 5 s into the first `extraction_append` in the `record-extractor` subagent (20 s debug hold). The redelivery resumed the session, re-ran the delegation ($2.90, 1,579 s of 1,800); the killed write rolled back; no duplicate, no 401.
- **Narrower than the acceptance text:** REST, not the browser (no item re-runs it there); no image transcription (U14).
- **2026-09-21 (browser):** criterion 1 failed: the kill hit background delegations and the redelivery did nothing (PR #2719 now re-prompts such a redelivery once).
- **Re-run 1:** criterion 2 failed: a triple write (the tool server ignored the MCP abort; the CLI's MCP timeout retried). PR #2850 refuses a repeat under the same log entry and rolls back disconnected writes. Voided by a token refresh.
- **Re-run 2:** criterion 2 held across two ceiling kills; stopped by hand.
- **Background delegations die at every turn end, kill or not** (2026-09-23). The worker forces every delegation to the foreground (PR #2852): **the design** (lead ruling 2026-09-23, reaffirmed 2026-09-29). Since the handoff PR that includes a call with no flag, which CLI 2.1.220 backgrounds by default (handoff U27).
- **After:** PR #2870's `make proto-demo-auto` (2026-09-24, PR branch, Anthropic API, 1,800 s): one message, 150 min, 6 attempts, 5 clean crossings, completed, judge recall 1.00. Judge only, n=1, no mid-delegation kill.

### The validated grain

- Validated: **one queue message per patron turn**, now often a whole research run (PR #2870); the review proposes one model call. The time limit (handoff U26) changes the grain again: a run of at most 1,800 s, ended, not resumed.
- **Visible queue depth is a poor scaling signal:** it reads zero while every worker is busy and rises only once patrons wait. Proposed instead (handoff U18, [capacity](./search-agent-capacity.md)): slot utilisation, visible plus in-flight messages over instances × `HttpConnections`, with scale-in protection the worker sets on itself.
- **Packing and the review's ~$0.04 compute estimate,** re-derived at U26's grain (U18, estimates): 8 turns on a t3.xlarge, now measured for CPU, memory and Postgres (U18, 2026-10-10, n=1: 0.89 cores average against a 1.6-core credit baseline), and 4 on a t3.large, still an estimate; the review's figure is the worker slot alone, and the 1,800 s cap leaves slot-time per session unchanged.
- **Until U26 lands, sqsd must cut only a run past 10 h:** `InactivityTimeout` at Beanstalk's 36,000 s maximum, so receives after the first come only from a crash, a deploy or SIGTERM, or a 500 (an API error, Postgres down at claim, a `ResumeFailure`); a crashed worker's message can take ~10 h to return (handoff U5, which builds these values: `VisibilityTimeout` 36,300, `MaxRetries` 5, `ErrorVisibilityTimeout` 300, handoff step 11).

## Six measurements

| # | Question | Answer | Date, configuration, n |
|---|---|---|---|
| 1 | Resume mid-delegation from an external store? | **Yes; the delegation re-runs.** | P1, 2026-09-10: 5 variants, n=1 each, probe driver, SDK 0.2.128 / CLI 2.1.220. Worker: D17, n=1, foreground only. |
| 2 | Cache across resume and past the TTL? | Resume reads it (P3k). Via agentgateway the TTL is 5 min regardless (P3j). The review's 4.6× cost blocker rests on 1-hour writes, which the gateway never gives; at 5 minutes the corpus loses 2.2–2.3% of run cost (below). | P3j/P3k: 2026-09-25, local agentgateway v1.5.0, TAP's route |
| 3 | Where to checkpoint? | **The patron turn.** No tool call exceeds 1,800 s; skill/agent segments p99 1,488 s, 4 over 1,800 s. | Corpus at `e18d99b10` (2026-09-07): 8,898 calls, 51 instrumented runs, 947 segments, autonomous only; `apps/server/dev/review_figures_runlogs.py` |
| 4 | Oversized result, no shell? | Spilled to a file; the agent `Read`s or `Grep`s it, never stranded. | P2, 2026-09-10, **current stack**, n=3. Prototype on Beanstalk: the spill file lives only for its attempt; killed between the spill and its read, the redelivery found the file gone, re-ran the call and answered correctly, then closed `no_progress` after two empty nudges, a recorded departure (U13, 2026-10-08, n=1, 1 try). |
| 5 | Bedrock? | Direct: yes. TAP's route, local copy: yes, tool search off (broken before agentgateway v1.6.0-alpha.1; TAP's Fargate stack pins v1.5.0, its EKS stack runs v1.6.0 since 2026-10-12; on a local copy of that route tool search passed a two-turn check, 2026-10-24, n=1; the deployed gateway is unmeasured). Off cost +18% on one turn (P3i), 2.2× on P3b's short arm. | P3 2026-09-10; P3b 2026-09-11 (passthrough proxy to the Anthropic API); P3f/P3i 2026-09-25; n=1 per arm. **Not the deployed gateway.** |
| 6 | Commit-time ledger? | **Buys nothing.** After a commit, resume wrote nothing; before it, resume re-decided (17 of 20 ops identical, 3 rephrased). | P1, 2026-09-10, n=1 |

## Cost and quality (D18, 2026-09-24)

Prototype: `main` at `2a553477f` (before PR #2870), Anthropic API (tool search on), 5-minute TTL, 7,200 s ceiling.
Current stack: 1-hour TTL, foreground by default (CLI 2.1.139). Same week and engine/plugin commit; SDK 0.1.81 /
CLI 2.1.139 against 0.2.128 / 2.1.220. Its Stop hook nudged the agent on with a bare "Yes." 1
time in 3; the worker never does (removed from the harness by handoff U17, 2026-10-06).

| | **bagley, current, 09-24** | **bagley, prototype** | paerai, current, 09-21 | paerai, prototype |
|---|---|---|---|---|
| f1: judge / blind human (proof) | true / **partial (3)** | true / **none** | true / true (2) | true / none |
| Cost | $11.85 | $16.29 | $4.94 | ~$32.21 |
| Wall clock | 4,544 s | 5,151 s, completed | 1,903 s | >14,400 s, active |
| Calls / delegations | 336 / 13 | 317 / 21 | 140 / 8 | 517 / 46 |

- **1.37×:** cache writes 1.56 M against 1.03 M tokens (21 delegations against 13, each a fresh cache, plus 272k main-thread rewrites); output 464k against 261k. Delegation count drives most of it and may be sampling; the research skill's `evaluations/` gates (since removed, PR #3040), CLI version and stop policy are unmeasured. The 1,800 s time limit (U26) would have stopped it well before 5,151 s.
- **Since bagley's $5.29 current-stack run of 07-31,** the plugin added $6.56 (60%) and the prototype $4.44 (40%).
- **paerai's ~6.5× is not an architecture figure:** 108 `image_transcribe` calls the baseline never made. The demo driver reported FAIL; its judge "true" was graded while the run was still active. A hard cap now refuses the 21st image of a group (handoff U25, PR #3111, issue #3010); the run predates it.
- The $35 bound would have stopped paerai only on the old meter, which priced cache writes at the 1-hour $6/M. Repriced to the 5-minute $3.75/M used here (handoff U19), paerai reads ~$32.21 at the snapshot, under the bound, and the run was still active, so whether it would have reached $35 is unknown. What bounds a run like it now is U25's image cap; U26's 1,800 s limit, once it lands, ends it far sooner (paerai passed 14,400 s). It first fired live on 2026-10-05 (compose, n=1 per case, handoff U23): at $35 on injected usage, and at a lowered $1 on the real meter, which read $1.05 where the CLI reported $0.72; at the 5-minute rate it reads $0.71 (U19).
- **Main-thread cache rewrites**, while a foreground delegation idles it past the 5-minute TTL, cost 5.8% of bagley (3, 272k tokens) and 20.7% of paerai (17, 1.94 M); the corpus (177 runs, 2026-09-24, autonomous only), re-priced from 1 h to 5 min, 2.2–2.3%. Each patron pause over 5 min adds ~$0.11 per 30k tokens of context. At a 1-hour TTL bagley is +12%, paerai −6%: the lever is the idle main thread. **Not forced foreground:** the corpus delegated in the foreground too (81 of 1,585 delegations in the background, in 20 of 194 runs, 2026-09-29). D18's excess fits more and longer delegations (21 against 13 on bagley, 46 against 8 on paerai).

## The gap: quality parity

- **The judge over-credited the current stack.** Its 2026-09-24 bagley run, graded blind:
  f1 **partial**, proof 3; the judge said true (issue #2904). The tree has two David Bagleys, the
  linked one factless despite a sourced 1777 birth, and lost the mother link to Sarah Sally
  Andrews.
- **No human has graded a prototype tree.** Its bagley tree differs on exactly those
  points: one David, with birth, 1854 death and four census residences; the mother link kept,
  plus a duplicate. A difference to grade, not a result.
- **The evidence is thin.** n=1 per side, one finding per fixture. Graders split on the
  factless-David rule (partial 07-27, true 07-31, partial 09-24), so one comparison may
  re-measure the rubric.
- **The trees are on Richard's machine.** The D17 and D18 exports (`proj_bagley-father-1884_072ee7`,
  `proj_paerai-teupooihi-spouse_1a8734`, `proj_bagley-father-1884_7b4922`), project files only;
  the transcripts are gone. D18's `_072ee7` was picked for the grade (2026-10-12, PR #3323).
  PR #2870's `proj_bagley-father-1884_40af16` is on its author's machine.

**What closes it** (ours, handoff U16):

1. **A blind human grade of one prototype bagley tree:** D18's `_072ee7`, the like-for-like
   pair, graded blind (PR #3358, 2026-10-13): `f1` true, proof quality 2 (thin: a Jr./Sr. competitor
   in the run's own data never weighed); its harness pair was graded `partial`, 3. Done; still n=1.
2. **A paired sample:** several fixtures and runs a side; same commit, week, CLI, stop policy,
   image cap and time limit. ~$15–30 a run.
3. **Before beta (R5), re-baseline the corpus on the prototype:** 108 of 136 fixtures have runs
   (2026-09-29); ~$800 a pass at the $7.35 median (`e18d99b10`) before the 1.37×, plus grading.
   Arithmetic.

**Other gaps:**

- **Deployed gateway:** no research run; the worker ran two short turns on a local copy (P3k). Local copies add +0.35 s first byte per call, ~7–14 s a turn (P3g, 2026-09-25). TAP's auth, guardrails, capacity and deployed latency unmeasured. U14.
- **Unmapped model id:** silently becomes a general-purpose stand-in that ignores the agent's `tools:`, and the turn reports success (P3h). U14. The worker remaps its staged agents' models, but also loads the plugin, which registers `genealogy-research:<agent>` with the bare model; on a local copy of the EKS route the main thread picked that name once, its subagent got a 400 and the main thread did the work itself, closing `ok` (2026-10-24, n=1; handoff F4). PR #3830 gives the plugin copy the worker loads Bedrock ids.
- **Prototype on AWS, research turns run:** the U13 rehearsal (2026-10-07, n=1) deployed the CI bundles to Beanstalk with RDS: every tier signs with its instance role, tools reaches S3 keylessly, the migrations runner ran against RDS under `verify-full`, and FamilySearch sign-in completed through the dev key's loopback callback. The acceptance turn (U13, 2026-10-08, n=1), `bagley-father-1884` autonomous, ran 13,565 s on receive 1 and completed at the $35 spend cap, with `completed_at` set, `research.json` in `documents` and every acceptance-3 query 0. Mid-turn the attempt's shared advisory lock was held on a dedicated direct connection, beside the turn's own connection named `turn:<id>`. The tree-read block was a prompt instruction only, a departure: the worker refuses `BLOCKED_TOOLS` without `DEV_PATHS`, which the Beanstalk templates refuse (U11); the six `person_*` tools it names were called 0 times each over 558 tool calls. On AWS since (U13, 2026-10-08, n=1 per case): a SIGKILL mid-delegation inside a tools commit hold came back after `ErrorVisibilityTimeout` (294 s), resumed and wrote the source exactly once; a SIGTERM outside a deploy was answered and redelivered after ~306 s, and receive 2 resumed; `MaxRetries` 1 plus a 500 closed the turn `retries_exhausted` and released the held message, the DLQ unchanged because the worker answers 200 on the last receive; a kill-resume with a grant refresh forced between attempts had 0 reauth hits and resumed; a message held mid-turn was released when the turn closed. The SIGTERM case's second run, the dead-letter case's released turn and the refresh case's resumed turn then closed `no_progress`, a recorded departure: the deployed web tier turns the nudge arm on for every message (`AUTONOMOUS_MAX_NUDGES` 60), and with nudges on (measured at caps 60 and 3) a project-less probe session gets two empty nudges and the continue policy closes it `no_progress` (still so with the cap at 3); compose's kill recipes run with nudges off (`AUTONOMOUS_MAX_NUDGES=0`); the mid-delegation turn was stopped to cap spend once the nudges drove it into locality research. Since (2026-10-10, n=1 per case): https served without sign-in through an imported self-signed certificate (U13); U6's `claim_epoch` migrations applied on its first AWS deploy, with no superseded attempt logged; and 1, 4 and 8 concurrent turns on one t3.xlarge averaged 0.107, 0.448 and 0.89 cores, under its 1.6-core credit baseline, with no surplus credits charged (U18).
- **One patron, no sign-in:** any bearer reached any project until U4; a refresh revokes the prior token at once, so two turns on one grant break each other; token custody (R7) assumed minute-long turns. U2–U4 (U2, U3 and U4 built; U4's tool-server half built ahead of F8, 2026-10-13).
- **No time limit:** nothing ends a run by time; a cut attempt would keep running beside its redelivery, though since U6 (`claim_epoch`, 2026-10-09, n=1) its close, transcript and tool-server commits are no-ops and it halts at its next tool call; a dead-lettered turn holds the session; the cross-instance tool-server write lock is untested. U5, U26.
- **Postgres backend (R14):** the engine suite runs on `PgS3ProjectStore` in CI (`vitest-pg`, U15): 6,802 cases on head `bce24a20d` (2026-10-12), none skipped, 29 run on the file store by name (`fileStoreOnly`). All 30 unit suites ran on it once (U15, 2026-10-12, n=1 per test): 440 tests, 0 store faults in 1,384 live tool calls.
- **Throughput:** Bedrock counts input + cache write + 5× output for Sonnet 4.6 and exempts cache reads (documented; read back in our test account, 2026-10-09, n=1 per arm), so a session settles at ~26–43k tokens/min, not the ~166k that counted every token. 50 sessions ≈ 2M TPM against a 6M default; the 700M per-day default (~12 sessions around the clock) binds first. The throttle counts the `max_tokens` reservation (the CLI sends 32,000): in our test account 200 simultaneous tiny calls at `max_tokens` 64,000 throttled 24 and 7, at 50 none, so onset sits near twice the TPM quota in reserved tokens (2026-10-24, n=2). The gateway is one 0.25 vCPU task, no autoscaling (2026-09-11). U18, [capacity](./search-agent-capacity.md).
- **Re-logged duplicates:** PR #2850 refuses a re-extraction of the same record, person and fact type under the same log entry, even reworded: the measured resume shape (P1, D17). Under a new or missing log entry it gets through; never seen on a resume, and a corpus replay's 27 such misses (194 runs, 2026-09-29) left no duplicate. Over the six prototype exports kept locally in `apps/server/proto/exports/` (gitignored; pass each `proj_*` directory to the script), 0 (2026-10-13, U16).
- **Missing against the current stack:** the image provider (F9). Uploads, images and stored search results landed with PR #3662 (2026-10-21), continuing a capped project with PR #3577 (2026-10-20). U20.
- **Silent transcript loss:** a config-dir mismatch persists nothing; the turn now closes `transcript_lost`, answers 500, and `/healthz` answers 503 (U10). A partial loss (one dropped frame) is still silent.
- **Stop, held messages, the $35 cap:** recorded live on compose 2026-10-05 (n=1 per case), main thread and mid-delegation (handoff U23); a Postgres error now fails the attempt closed (500, redelivered) instead of letting the call through. Live, both paths failed closed: a terminated connection in the receive loop, and a cancelled query inside the halt check; a 120 s freeze stalled the attempt without letting a call through (the stall itself is U19's). On Beanstalk with RDS and real SQS (U13, 2026-10-08, n=1 per case; handoff U23) 12 of 13 cases passed: Stop and the cap halted on the main thread and mid-delegation, held messages were released, and all four outage cases run failed closed (500 `AdminShutdown` or `StoreUnavailable`) and was redelivered; on the real meter a $1 cap halted a real turn at $1.07, the turn costing $1.29. The resume probe resumed, but its turn researched on until Stop at the deadline; re-run twice with the nudge arm off (U13, 2026-10-10, n=1 each; 2/4 and 2/3 as scored), it did the same, so the cause is not the nudge arm (measured) but, inferred, the probe text's open ending.
- **Dev-only paths ship:** an unauthenticated crash stub, fixture tree-read block, debug holds. U11 (built, PR #3162: the stub arms and the tree-read block need `DEV_PATHS=true`, and a packaging test refuses dev variables in the Beanstalk templates).

## What the prototype deliberately did not test

- **Deployment on FamilySearch infrastructure** (Beanstalk, Blueprint, P20, DTM).
- **SSE through the edge** (CloudFront, Imperva, HAProxy, DTM under concurrency): a written exception, ranked among the plan's architecture-killing risks. `Last-Event-ID` resume with a 15 s ping passed locally against a seeded stand-in worker (`make proto-drive` 17/17, 2026-09-14). Since (2026-10-23, n=1 per path, handoff F11): another FamilySearch service's SSE stream passed unbuffered through `www` (CloudFront, Imperva, DTM), a service group and the origin, and held 65 minutes through `www` (the service-group stream was cut once at 1,690 s, cause unknown); concurrency and the idle threshold are still untested.
- **Load, concurrency, multiple workers:** also ranked among those risks. Since: up to 8 concurrent turns on one worker (U18, 2026-10-10, n=1 per count); still no load run and no second worker.
- **Content-level deduplication:** no working design; the best key matched 0 of 86 assertions (`1871c733b`). Not required before go-live (handoff U21).
- **Opaque session tokens, store-backed skill output:** known patterns.

## Corrections to the architecture review

The review (not in this repo) carries none of these; handoff U22 applies them.

1. **"Removes the patron-token surface" is wrong:** it concentrates it in one tool server.
   Credit removing the on-disk token file and the shell.
2. **Bedrock Guardrails cannot see the injection vectors:** Converse emits no `guardContent`,
   and `guardrailIdentifier` is a placeholder in beta and prod. 19.4% of tool calls return
   text a third party wrote (5,234 of 27,002, 163 runs, `d016032e5`; the tool set is in
   `review_figures_runlogs.py`). The 5,554 first quoted came from a set never written down.
3. **Server-side context management is off on Bedrock** and cannot pass Messages→Converse.
   Client-side `/compact` worked through a local v1.5.0 gateway (2026-09-25, n=1); autocompact
   was not forced.
4. **The 14.7% "reads its own transcript" row** is the oversized-output spill: 739 reads, 11.8%
   of 6,247 filesystem operations, 66 of 161 runs (`e18d99b10`; `review_figures_runlogs.py`).
5. **"24 take a `projectPath`, 24 are pure HTTP"** was 21 and 27 of 48 tools at `e18d99b10`,
   and is 27 and 26 of 53 at `19ea6d089` (`packages/engine/mcp-server/dev/count-projectpath-tools.ts`). Several that
   take none make no network call either.
6. **State the grain** ([above](#the-validated-grain)).

## Open questions for FamilySearch

Numbers are the handoff's; Richard routes them to FamilySearch. "Sent" means sent 2026-09-18; none had a reply as of 2026-09-28, and none is recorded since. Rechecked against TAP's EKS gateway config on 2026-10-14: F2 is done and F4 answered (below), and F1, F3, F5 and F13 are reworded. Rechecked against fs-eng's own repos on 2026-10-23: F10 answered, F11's edge arms measured, F11 and F18 narrowed; F12 answered by a Blueprint deploy on 2026-10-24. Measured on a local copy of the EKS gateway's v1.6.0 GA on 2026-10-24: F3 not needed there, F7 corrected. Read against TAP's ALB config on 2026-10-31: F3's ALB point answered by configuration; F13's internal-names point measured from FS112 and dropped. Measured on a local copy of the EKS route on 2026-10-31: F7's per-run volume. Measured by deploy in FS112 on 2026-10-31: F11's idle threshold on a service group and an alias, F12's own bundles and an ALB, F14's two scaling triggers with a turn in flight, F18's prefix on a service group and an alias; F7 re-run locally with tool search on and an image.

**Sent or drafted:**

- **F1, APT:** a consumer key, and the shared `/bedrock` route or our own product route and Langfuse lane (Atrium's pattern); our workers in the APT-1512 batch. The URL is known: `tap-gateway.fs108-trusted-agentic-platform-int.um.fslocal.org`. Unblocks U14, U18. Batch sent; key and route drafted, not sent.
- **F3, APT:** `maxBufferSize` 32 MiB; at 2 MiB a session dies at its third page scan on v1.5.0. **Not needed on EKS:** on v1.6.0 GA with the EKS route and no `maxBufferSize`, 12 scans (11.9 MB) all answered 200 (2026-10-24, local copy, n=1). The EKS ALB in front has no WAF and an IP target group, so no body limit by configuration (read 2026-10-31); a keyless 64 MiB POST reached the gateway, which refuses on headers before the body crosses, so the end-to-end check waits on F1's key. Send only if our workers land on the Fargate gateway. Drafted, not sent. FYI: the gateway also drops forced `tool_choice` and the 1 h TTL (upstream agentgateway issue #3670).
- **F5, APT:** the EKS gateway invokes Bedrock as its own role in TAP's account, with no per-consumer role, so: is our invoke role (ETA December) still planned, or is TAP's shared pool the design? Where quota goes, gateway scaling; the account's applied quotas, the per-day quota raised with TPM, metric access for the load run. Unblocks U18. Account and role sent; the rest not yet asked. The config answers the rest: no per-route rate limit or retry policy, and usage traced but not `max_tokens`.
- **F6, APT:** `guardContent` for tool results: yes or no, and when? Unblocks the ARB injection answer. Sent.
- **F7, InfoSec:** Langfuse keeps prompts at 100%: acceptable, and what retention? P3l (2026-09-25, local collector, n=1): tool results and images don't leave; patron names and record details do (~700k characters per 11-call turn). Re-measured on v1.6.0 GA (2026-10-24, local copy, n=1 per arm): so do the model's tool calls with their arguments (`gen_ai.tool_calls`), so every search's names, places and ids leave. A whole run, measured (2026-10-31, local copy, bagley to `completed`, n=1): about 17 million characters in 166 spans, 0.8 M of it distinct, with 239 tool calls and their arguments, the extracted assertions among them. With tool search on, the production setting: about 12.6 million in 117 calls on another fixture (2026-10-31, n=1). A page image did not reach the export: it was OCR'd on the host, and only what the model narrated of it left. The sent ask wrongly said images leave. Unblocks security review. Correction and retention not sent.
- **F9, ACE and FS legal:** may OCR stay on OpenRouter; record-custodian terms. Unblocks U20. Provider sent; the `bedrock-exception-*` role in the same ask withdrawn 2026-09-29, ACE not yet told; terms not yet asked.

**Answered without asking (2026-10-14, 2026-10-23):**

- **F2:** agentgateway v1.6.0 runs on TAP's EKS gateway since our PR fs-eng/tap-gateway#46 merged 2026-10-12. Tool search through it is unmeasured: U14.
- **F4:** no model allowlist exists, no `model:` is pinned and Sonnet 5 is aliased, so our ids pass. Sonnet 5 enabled is inferred; U14's first call shows it.
- **F10 (sent 2026-09-18; no reply needed):** the Help team's stream is a plain `SseEmitter`, published through the `www` alias, so through DTM; it has no load test and says nothing about concurrency, which moves to F11.
- **F12, by deploy (2026-10-24):** a Python 3.12 `Beanstalk Worker v1_1` deployed Green through Blueprint in FS112 (`fs-eng/search-agent-tools`): sqsd delivered, a 90 s turn and nginx's 43,200 s override held, a 500 was retried every 300 s and dead-lettered after 5. Three changes for us: `worker_options` override the bundle's sqsd file and `RetentionPeriod` comes out 1,209,600; CloudWatch log streaming fails the launch, so the bundles no longer set it; load-balanced services get a Classic load balancer at 60 s (our tools tier's new Classic file, or an ALB chosen through `stack_options`, carried a 90 s request). FamilySearch's build runner built all three bundles with Node 24 beside Python, once PR #3821 cleared Artifactory curation. Our own web and tools bundles deployed there too (2026-10-31): both boot without a database; Blueprint's load-balancer health check, not the bundle's, gates the deploy on a Classic load balancer (the tools tier passes it on `/livez`), an ALB honours the bundle's own health path and idle timeout, and the platform's nginx refuses uploads over 1 MiB (issue #3980).

**Not yet asked:**

- **F8, InfoSec:** live bearer on every internal hop, grant at rest, a sha256 of the live bearer on `turns`, tool-server isolation: acceptable? Unblocks U3.
- **F11, FS platform:** how many concurrent long-lived connections DTM and HAProxy carry, and may we load-test SSE through `www`? The edge arms are measured (2026-10-23, n=1 per path): no layer buffers or rewrites an SSE stream. A service group cuts a silent stream at about 295 s, the `integration` alias (CloudFront, Imperva, DTM) at about 45 s, and the alias does not buffer our stream (2026-10-31); our ping is 15 s.
- **F13, FS network:** measured from an FS112 Blueprint instance (2026-10-24): every public host the tiers call connects, TAP's EKS gateway does not, though it does from the VPN (the Fargate one connects from both), and `ident`'s discovery endpoint 403s a non-browser user agent there but not from the VPN (its token endpoint takes either). So the ask narrows to admitting our workers' VPC to the EKS gateway; also VPC, egress and gateway allowlists (the gateway admits the VPN /14 and named security groups in its own shared VPC, so our VPC decides the ask), HAProxy idle timer. Internal names past Imperva dropped (2026-10-31): `ident`'s internal name resolves from FS112 but does not connect, and the browser user agent (PR #3819) already avoids the 403. Unblocks U14.
- **F14, Blueprint and the DBAs:** Postgres (a product-account database must be encrypted, and no `fh-postgres-NNp` parameter group exists in one, so the DBAs create it first; credentials arrive only through SAS, handoff U29), S3, SQS and DLQ, secrets (SAS), IAM; every worker-to-tools idle timeout, including the tool-server LB, ≥ 1,800 s; static S3 keys? For the scaling metric (U18): two Simple Scaling policies on different SQS metrics (deployed 2026-10-31: they scaled a worker 1→3→1 on their own, and held scale-in for the 43 minutes one long turn was alone in flight), a custom or metric-math metric, worker-set scale-in protection, the T3 credit mode (measured: `unlimited`). Unblocks any deploy.
- **F15, FS OAuth owners (team unknown):** an integ client with our https redirect (F18), later production. The lifetimes are documented and revoke-on-refresh was measured, so only the client is asked. Unblocks U2, U3.
- **F16, fs-eng:** host `wiki-query-api`; Pop Stats is already hosted in FS112 by `fs-eng/search-agent-tools` (2026-10-24). Unblocks four tools, which until then call a developer's personal host.
- **F17, ARB, InfoSec, PRIA, AI Working Group, PM:** ARB scheduling, SLA exception, retention, DR, telemetry, service identity, CAS/TARS entitlement for the email allowlist, mobile. Unblocks go-live. Goes with U22.
- **F18, FS platform and URI Naming Council:** an `Alias v1_0` path under `integration`, `beta` and `www.familysearch.org`, or a `CDN Service` host of our own? The binding supplies the host, TLS and edge route; an alias or a service group needs our path-prefix work (handoff U28): a service group and an alias both strip the prefix and send `X-Orig-Base`, and a nested name deployed under both (2026-10-31). Unblocks integ sign-in.

Retention (U19): a session's delete takes its SDK transcript under both ids (PR #3356), and its
project's rows only with the project's last session (U2); the S3 orphan sweep deletes the objects
nothing points at once they pass its grace (PR #3394). Retention is built and ships off (PR #3369): a
session idle past `RETENTION_SESSION_IDLE_S` with no open turn loses its transcript, events and
tool calls and answers a new message 410. The period is F17's. Our own decisions: handoff U21, all made 2026-09-29.

## Where the evidence is

- **The plan:** every run, session id, probe and R1–R14. Where stale, this report follows the
  code: ceiling 1,800 s, Anthropic API default, gateway tool search off.
- **Code:** `apps/server/proto/`, driven by the `proto-*` Make targets, `proto-up` first; billed
  runs need `ANTHROPIC_API_KEY` and `make e2e-login`. Re-run the four probes in handoff step 10
  on any SDK or CLI change.
- **Probes:** `apps/server/dev/p1/` (`probe_gateway_parity.py` checks TAP's integ route);
  `apps/server/proto/eb-worker-probe/`.
- **In git:** `eval/runlogs/e2e/bagley-father-1884/run-2026-09-25_01-42-24.*` (with its
  `.ann.json`) and `paerai-teupooihi-spouse/run-2026-09-21_16-47-07.*`. The scripts behind
  measurement 3 and corrections 2, 4 and 5 are `apps/server/dev/review_figures_runlogs.py` and
  `packages/engine/mcp-server/dev/count-projectpath-tools.ts` (U22).
- **Local only:** prototype exports (D17 and D18 on Richard's machine), P1 and P2 evidence.
