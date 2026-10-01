# Search Agent prototype — results

**2026-09-29 · Dallan Quass · for Richard (FamilySearch) and the FamilySearch leads he shares it with.** Evidence:
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
- **TAP:** APT's Bedrock gateway (`fs-eng/tap-agentgateway`). A **local copy** runs its
  `/bedrock` route config on our machine.

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
  on AWS, only a hello-world Beanstalk worker and P3's Bedrock calls.
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
| Tool server | 48 MCP tools (2026-09-29) over Streamable HTTP, one process for all patrons. **Nothing checks a bearer may reach the project it names.** | Beanstalk environment (handoff step 9; platform per F12) |
| Browser | `apps/web` on SSE; Vite dev server only | Static, behind the edge |

- **Beanstalk probe** (D3, 2026-09-11, torn down): sqsd 3.0.5 cuts the POST at `InactivityTimeout` silently and redelivers after `VisibilityTimeout`: 300 s idle at 2,100 / 1,800. The worker tier always creates a DLQ.
- Untested on Beanstalk: bundle cap, worker 5xx, deploy mid-message, closed-VPC egress, memory, tmpfs.

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
- **Visible queue depth is a poor scaling signal:** it reads zero while every worker is busy and rises only once patrons wait. No alternative is chosen.
- **Packing and the review's ~$0.04 compute estimate** need re-deriving at U26's grain (a run of at most 1,800 s).
- **Until U26 lands, sqsd must cut only a run past 10 h:** `InactivityTimeout` at Beanstalk's 36,000 s maximum, so receives after the first come only from a crash, a deploy or SIGTERM, or a 500 (an API error, Postgres down at claim, a `ResumeFailure`); a crashed worker's message can take ~10 h to return (handoff U5, which builds these values: `VisibilityTimeout` 36,300, `MaxRetries` 5, `ErrorVisibilityTimeout` 300, handoff step 11).

## Six measurements

| # | Question | Answer | Date, configuration, n |
|---|---|---|---|
| 1 | Resume mid-delegation from an external store? | **Yes; the delegation re-runs.** | P1, 2026-09-10: 5 variants, n=1 each, probe driver, SDK 0.2.128 / CLI 2.1.220. Worker: D17, n=1, foreground only. |
| 2 | Cache across resume and past the TTL? | Resume reads it (P3k). Via agentgateway the TTL is 5 min regardless (P3j). The review's 4.6× cost blocker rests on 1-hour writes, which the gateway never gives; at 5 minutes the corpus loses 2.2–2.3% of run cost (below). | P3j/P3k: 2026-09-25, local agentgateway v1.5.0, TAP's route |
| 3 | Where to checkpoint? | **The patron turn.** No tool call exceeds 1,800 s; skill/agent segments p99 1,488 s, 4 over 1,800 s. | Corpus at `e18d99b10` (2026-09-07): 8,898 calls, 51 instrumented runs, 947 segments, autonomous only |
| 4 | Oversized result, no shell? | Spilled to a file; the agent `Read`s or `Grep`s it, never stranded. | P2, 2026-09-10, **current stack**, n=3. Unmeasured on the prototype, where a resumed turn's spill file lives only for that turn (U13). |
| 5 | Bedrock? | Direct: yes. TAP's route, local copy: yes, tool search off (broken before agentgateway v1.6.0-alpha.1; TAP pins v1.5.0). Off cost +18% on one turn (P3i), 2.2× on P3b's short arm. | P3 2026-09-10; P3b 2026-09-11 (passthrough proxy to the Anthropic API); P3f/P3i 2026-09-25; n=1 per arm. **Not the deployed gateway.** |
| 6 | Commit-time ledger? | **Buys nothing.** After a commit, resume wrote nothing; before it, resume re-decided (17 of 20 ops identical, 3 rephrased). | P1, 2026-09-10, n=1 |

## Cost and quality (D18, 2026-09-24)

Prototype: `main` at `2a553477f` (before PR #2870), Anthropic API (tool search on), 5-minute TTL, 7,200 s ceiling.
Current stack: 1-hour TTL, foreground by default (CLI 2.1.139). Same week and engine/plugin commit; SDK 0.1.81 /
CLI 2.1.139 against 0.2.128 / 2.1.220. Its Stop hook nudged the agent on with a bare "Yes." 1
time in 3; the worker never does.

| | **bagley, current, 09-24** | **bagley, prototype** | paerai, current, 09-21 | paerai, prototype |
|---|---|---|---|---|
| f1: judge / blind human (proof) | true / **partial (3)** | true / **none** | true / true (2) | true / none |
| Cost | $11.85 | $16.29 | $4.94 | ~$32.21 |
| Wall clock | 4,544 s | 5,151 s, completed | 1,903 s | >14,400 s, active |
| Calls / delegations | 336 / 13 | 317 / 21 | 140 / 8 | 517 / 46 |

- **1.37×:** cache writes 1.56 M against 1.03 M tokens (21 delegations against 13, each a fresh cache, plus 272k main-thread rewrites); output 464k against 261k. Delegation count drives most of it and may be sampling; the research skill's `evaluations/` gates (U20), CLI version and stop policy are unmeasured. The 1,800 s time limit (U26) would have stopped it well before 5,151 s.
- **Since bagley's $5.29 current-stack run of 07-31,** the plugin added $6.56 (60%) and the prototype $4.44 (40%).
- **paerai's ~6.5× is not an architecture figure:** 108 `image_transcribe` calls the baseline never made. The demo driver reported FAIL; its judge "true" was graded while the run was still active. A hard cap is decided, not built (handoff U25, issue #3010).
- The $35 bound would have stopped paerai: its meter prices cache writes at the 1-hour $6/M, not the gateway's 5-minute $3.75/M used here. It never fired live (repricing U19; live test U23).
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
  the transcripts are gone. He decides their use (handoff U16). PR #2870's
  `proj_bagley-father-1884_40af16` is on its author's machine.

**What closes it** (ours, not started, handoff U16):

1. **A blind human grade of one prototype bagley tree:** one genealogist session on a tree
   Richard picks (D18's `_072ee7` is the like-for-like pair; `_40af16` or a ~$16 re-run the
   fallbacks). Still n=1.
2. **A paired sample:** several fixtures and runs a side; same commit, week, CLI, stop policy,
   image cap and time limit. ~$15–30 a run.
3. **Before beta (R5), re-baseline the corpus on the prototype:** 108 of 136 fixtures have runs
   (2026-09-29); ~$800 a pass at the $7.35 median (`e18d99b10`) before the 1.37×, plus grading.
   Arithmetic.

**Other gaps:**

- **Deployed gateway:** no research run; the worker ran two short turns on a local copy (P3k). Local copies add +0.35 s first byte per call, ~7–14 s a turn (P3g, 2026-09-25). TAP's auth, guardrails, capacity and deployed latency unmeasured. U14.
- **Unmapped model id:** silently becomes a general-purpose stand-in that ignores the agent's `tools:`, and the turn reports success (P3h). U14.
- **No prototype image on AWS:** unsigned SQS, static-key S3, schema applied at start, no bundles. U7–U9, U12, U13.
- **One patron, no sign-in:** any bearer reaches any project; a refresh revokes the prior token at once, so two turns on one grant break each other; token custody (R7) assumed minute-long turns. U2–U4.
- **No time limit or fencing:** nothing ends a run by time; a cut attempt would keep running beside its redelivery; a dead-lettered turn holds the session; the cross-instance tool-server write lock is untested. U5, U6, U26.
- **Postgres backend (R14):** 4 of 41 store cases run in CI (2026-09-29); tool suites and evals use files. U15.
- **Throughput:** ~166k tokens/min a session (2026-09-09 estimate); 50 sessions ≈ 0.5M–8.1M TPM, up to 4× the 2M default, depending on burndown and cache-read counting. The gateway is one 0.25 vCPU task, no autoscaling (2026-09-11). U18.
- **Re-logged duplicates:** PR #2850 refuses a re-extraction of the same record, person and fact type under the same log entry, even reworded: the measured resume shape (P1, D17). Under a new or missing log entry it gets through; never seen on a resume, and a corpus replay's 27 such misses (194 runs, 2026-09-29) left no duplicate. U16 counts them.
- **Missing against the current stack:** uploads, images, logs, stored search results, two wiki skills, `evaluations/` gates, continuing a capped project. U20.
- **Silent transcript loss:** a config-dir mismatch persists nothing; `/healthz` answers 200 regardless. U10.
- **Stop, held messages, the $35 cap:** offline tests only; while Postgres is down all three fail open, silently (the hooks swallow its errors). U23.
- **Dev-only paths ship:** an unauthenticated crash stub, fixture tree-read block, token fallbacks (one persists in `turns.message`, SQS and the DLQ), debug holds. U11.

## What the prototype deliberately did not test

- **Deployment on FamilySearch infrastructure** (Beanstalk, Blueprint, P20, DTM).
- **SSE through the edge** (CloudFront, Imperva, HAProxy, DTM under concurrency): a written exception, ranked among the plan's architecture-killing risks. `Last-Event-ID` resume with a 15 s ping passed locally against a seeded stand-in worker (`make proto-drive` 17/17, 2026-09-14).
- **Load, concurrency, multiple workers:** also ranked among those risks.
- **Content-level deduplication:** no working design; the best key matched 0 of 86 assertions (`1871c733b`). Not required before go-live (handoff U21).
- **Opaque session tokens, store-backed skill output:** known patterns.

## Corrections to the architecture review

The review (not in this repo) carries none of these; handoff U22 applies them.

1. **"Removes the patron-token surface" is wrong:** it concentrates it in one tool server.
   Credit removing the on-disk token file and the shell.
2. **Bedrock Guardrails cannot see the injection vectors:** Converse emits no `guardContent`,
   and `guardrailIdentifier` is a placeholder in beta and prod. 20.6% of tool calls return
   externally authored content (5,554 of 27,002, 163 runs, `d016032e5`).
3. **Server-side context management is off on Bedrock** and cannot pass Messages→Converse.
   Client-side `/compact` worked through a local v1.5.0 gateway (2026-09-25, n=1); autocompact
   was not forced.
4. **The 14.7% "reads its own transcript" row** is the oversized-output spill: 739 reads, 11.8%
   of 6,247 filesystem operations, 66 of 161 runs (`e18d99b10`).
5. **"24 take a `projectPath`, 24 are pure HTTP"** was 21 and 27 at `e18d99b10`; there are 48
   tools now. Recount.
6. **State the grain** ([above](#the-validated-grain)).

## Open questions for FamilySearch

Numbers are the handoff's; Richard routes them inside FamilySearch. "Sent" means sent 2026-09-18; none had a reply as of 2026-09-28.

**Sent or drafted:**

- **F1, APT:** integ gateway URL and key; our workers in the APT-1512 batch. Unblocks U14, U18. Batch sent; URL and key drafted, not sent.
- **F2, APT:** a date for agentgateway ≥ v1.6.0 (tool search). Unblocks production cost. Drafted, not sent. FYI: the gateway also drops forced `tool_choice` and the 1 h TTL (upstream agentgateway issue #3670).
- **F3, APT:** `maxBufferSize` 32 MiB; at 2 MiB a session dies at its third page scan. Unblocks U14 and image-heavy sessions. Drafted, not sent.
- **F4, APT:** admit our three model ids; is Sonnet 5 enabled; pin no `model:`. Unblocks U14. Allowlist drafted, not sent; rest not yet asked.
- **F5, APT:** which account, the invoke role (ETA December), where quota goes, gateway scaling. Unblocks U18. Account and role sent; scaling not yet asked.
- **F6, APT:** `guardContent` for tool results: yes or no, and when? Unblocks the ARB injection answer. Sent.
- **F7, InfoSec:** Langfuse keeps prompts at 100%: acceptable, and what retention? P3l (2026-09-25, local collector, n=1): tool results and images don't leave; patron names and record details do (~700k characters per 11-call turn). The sent ask wrongly said images leave. Unblocks security review. Correction and retention not sent.
- **F9, ACE and FS legal:** may OCR stay on OpenRouter; record-custodian terms. Unblocks U20. Provider sent; the `bedrock-exception-*` role in the same ask withdrawn 2026-09-29, ACE not yet told; terms not yet asked.
- **F10, Help team:** how they handle DTM concurrency for SSE. Unblocks F11. Sent.

**Not yet asked:**

- **F8, InfoSec:** live bearer on every internal hop, grant at rest, tool-server isolation: acceptable? Unblocks U3, U4.
- **F11, FS platform:** the SSE edge probe, only if F10 says they bypass DTM.
- **F12, FS platform and DTL:** which Beanstalk platform and AMI; does Blueprint keep our sqsd and nginx overrides? Unblocks any FamilySearch deploy (R9: "weeks").
- **F13, FS network:** VPC, egress and gateway allowlists, internal names past Imperva, HAProxy idle timer. Unblocks U14.
- **F14, Blueprint:** Postgres, S3, SQS and DLQ, secrets, IAM; every worker-to-tools idle timeout, including the tool-server LB, ≥ 1,800 s; static S3 keys? Unblocks any deploy.
- **F15, FS OAuth owners (team unknown):** production client and redirect; confirm the 8 h / 24 h lifetime and revoke-on-refresh; re-sign-in past 24 h? Unblocks U2, U3.
- **F16, fs-eng:** host `wiki-query-api` and Pop Stats. Unblocks four tools, which until then call a developer's personal host.
- **F17, ARB, InfoSec, PRIA, AI Working Group, PM:** ARB scheduling, SLA exception, retention, DR, telemetry, service identity, CAS/TARS entitlement for the email allowlist, mobile. Unblocks go-live. Goes with U22.
- **F18, FS platform:** web hostname, TLS, edge route. Unblocks integ sign-in.

Retention cannot be met as built (found by reading; U19): deleting a session drops its whole
project, even if other sessions share it, yet keeps the SDK transcript (keyed by another id)
and the S3 objects. Our own decisions: handoff U21, all made 2026-09-29.

## Where the evidence is

- **The plan:** every run, session id, probe and R1–R14. Where stale, this report follows the
  code: ceiling 1,800 s, Anthropic API default, gateway tool search off.
- **Code:** `apps/server/proto/`, driven by the `proto-*` Make targets, `proto-up` first; billed
  runs need `ANTHROPIC_API_KEY` and `make e2e-login`. Re-run the four probes in handoff step 10
  on any SDK or CLI change.
- **Probes:** `apps/server/dev/p1/` (`probe_gateway_parity.py` checks TAP's integ route);
  `apps/server/proto/eb-worker-probe/`.
- **In git:** `eval/runlogs/e2e/bagley-father-1884/run-2026-09-25_01-42-24.*` (with its
  `.ann.json`) and `paerai-teupooihi-spouse/run-2026-09-21_16-47-07.*`.
- **Local only:** prototype exports (D17 and D18 on Richard's machine), P1 and P2 evidence. The scripts behind measurement 3 and
  corrections 2 and 4 never landed (U22).
