# Handing the search agent to FamilySearch

**Status:** Not started (2026-09-29).
**Owner:** Dallan. Written for Richard, the FamilySearch employee on the project. List 1 is Dallan's team's work; list 2 is FamilySearch's, routed through Richard; list 3 is for FamilySearch engineers.

See [the prototype report](../search-agent-prototype-report.md) (its legend defines D, P and R) and [the prototype plan](search-agent-prototype.md).

## Bottom line

- **Not ready.** Resume-after-kill passed once (D17, 2026-09-23, n=1) on docker-compose, one patron, Anthropic API direct and a pre-merge build, before PR #2870 changed the resume path; nothing prototype has run on AWS, no patron can sign in, and no deployment artifact exists.
- **Integration** needs U1–U14 and U23 (U4 only if exposed, U6 only if multi-instance) and F1, F3, F4, F12–F15, F18; **go-live** needs the rest and list 3 passing on FamilySearch integration. Only U3 (~3.5 days) and U6 (1–2 days) are sized, hence no date.
- **Long lead:** F12 (platform) and F14 (provisioning), not yet asked; R9: "can block for weeks". Go-live's long pole is F17's ARB review: unscheduled, waiting on U22 and U18's scaling metric and packing (which need U13).
- **First three actions:**
  1. **U1, send the asks:** every unsent list-2 ask. File the Bedrock quota increase once F5 names the account; it takes days.
  2. **Size U2–U13.** Start U2, and U3's dev-key token measurements.
  3. **Build U5.** U6 before any second instance.
- **Richard decides:** list-2 routing and F15's owner (U1); which tree U16 grades; whose key runs the SDK-bump probes (step 10).

## What the system is

| Part | Path | State |
|---|---|---|
| Engine hosted entrypoints, Postgres/S3 store, bearer principal | `packages/engine/mcp-server/src/{server.ts,http.ts,http-server.ts,store/,auth/principal.ts}` | **Keep.** Harden: U4, U8, U10, U19, U25. |
| Plugin: 27 skills, 8 agents, PreToolUse hook | `packages/engine/plugin/` | **Keep.** |
| Worker: SDK resume from Postgres, deny-and-log hooks | `apps/server/proto/worker/`, `apps/server/app/agent/{continue_policy,spend,real_agent}.py` | **Prototype-grade:** U5, U6, U7, U11, U26. |
| Web tier: REST, SSE, Stop | `apps/server/proto/web/app.py` | **Prototype-grade:** no auth (U2, [plan](u2-patron-sign-in.md)); uploads, images, logs 501 (U20). |
| Schema | `apps/server/proto/sql/001_schema.sql`…`007_session_usage_index.sql` | **Keep content.** Applied at service start until U9. |
| Browser client | `apps/web`, `VITE_SESSION_TRANSPORT=sse` | **Keep.** Not yet built for SSE or mounted (U12). |
| Compose, elasticmq, MinIO, Postgres container, sqsd shim | `apps/server/proto/{docker-compose*.yml,elasticmq.conf,shim/}` | **Local only.** Unlike the shim, sqsd never kills the worker (U5). |
| Operator token plumbing | `apps/server/proto/env.sh`, `.fs-token`, `dev/fs-token.ts` | **Dev only.** U2, U3 replace it. |
| Dockerfiles | `apps/server/proto/{worker,web,tools}/Dockerfile` | **Recipes** for U12 (images if F12 allows Docker). |

Two premises moved since the plan:

- **One message is a whole research run** (PR #2870, merged 2026-09-27; its acceptance run: 6 attempts, 150 min). The auth design assumed "a turn is minutes"; the grain moved further from the review's "one model call per message" (R4). Once [our cost-and-latency plan](cost-latency-10x.md) lands (not started, no date), U26 ends every run at 1,800 s.
- **Forced foreground delegation is the design** (lead ruling 2026-09-23, PR #2852, reaffirmed 2026-09-29): no agent outlives its turn. The rewrite covers a call with no flag too, which CLI 2.1.220 runs in the background (U27, done in this PR).

## 1. Preconditions Dallan's team implements and tests

**Blocks:** integ (test patrons), go-live (real patrons); exposed means reachable outside the worker security group. Step N means list 3's step N.

| # | Item | Risk | Blocks | Needs |
|---|---|---|---|---|
| U1 | Send every unsent list-2 ask, routed by Richard | List 2 stalls | integ | — |
| U2 | Patron sign-in, owner scoping | One shared user | integ | — |
| U3 | Multi-patron token custody | R7: impersonation | integ | U2, F15 |
| U4 | Tool server checks bearer against project | Open tool server | go-live; integ if exposed | F8, F13 |
| U5 | Interim sqsd settings, SIGTERM exit, dead-letter close | Two CLIs per session | integ | — |
| U6 | Claim fencing (`claim_epoch`), two-instance test | R8 | integ if multi-instance, else go-live | — |
| U7 | SigV4-signed SQS client | SQS rejects ours | integ | — |
| U8 | S3 on instance roles | Static keys required | integ unless F14 allows keys | — |
| U9 | Migrations runner | Start-up races | integ | — |
| U10 | Readiness, `TMPDIR`, transcript checks | Silent transcript loss | integ | — |
| U11 | Strip dev-only paths | Unauthenticated crash | integ | — |
| U12 | Beanstalk bundles, SPA mount, CI build | R9 | integ | — |
| U13 | Rehearsal deploy in our account, from list 3 only | Untested guide | integ | U2, U3, U5, U7–U12, U23; U4 if exposed; U6 if multi-instance |
| U14 | Gateway parity probe, one full run | R1, R10 | integ | F1, F3, F4, F13 |
| U15 | Engine suites and skill runs on Postgres | R14 | go-live (before beta) | — |
| U16 | Blind human grade, duplicate count, corpus re-baseline | R5: judge-only | go-live | U17; U25, U26 for the paired runs |
| U17 | Stop-hook parity | Skews U16 | before U16 | — |
| U18 | Scaling metric, packing, quota, load test | R2, R4 | go-live; metric, packing before F17 | U13; F1, F5; quota increase |
| U19 | Operational hardening | Nothing alerts | go-live | F14, F17 |
| U20 | Product gaps against the alpha | Lost features | go-live | F9 |
| U21 | Lead decisions: all seven decided 2026-09-29 | — | — | — |
| U22 | Correct the ARB draft (SC-12457) | Wrong premises | go-live; before F17's request | — |
| U23 | Live Stop, held release, $35 cap, Stop mid-delegation | Bounds untried | integ | — |
| U24 | Continuous-work behaviour | Turns overrun their deliverable | go-live | — |
| U25 | Hard image cap (issue #3010) | Image browsing unbounded | go-live (cost) | — |
| U26 | Session time limit: every run ends within 1,800 s | Multi-hour runs | go-live | `cost-latency-10x.md` lands |
| U27 | Foreground rewrite covers a flagless delegation | Delegation dies at turn end | **done in this PR** | — |

### Details

**U1.** Dallan sends the drafted APT message unless Richard says otherwise, after adding F4's Sonnet 5 and `model:` questions and F5's scaling question (plan "Open asks"; `cost-latency-10x.md`, 2026-09-27). **Done when:** all but F11 (after F10) and F17 (with U22) have sent dates, and ACE knows the role in F9 is withdrawn.

**U2.** Plan: [`u2-patron-sign-in.md`](u2-patron-sign-in.md). Its own PR, before U3's. Why: all calls run as one user; any client can attach any project. Port the E2B/Fly/Neon alpha's PKCE flow, encrypted token table and email allowlist into the web tier as a vendored module (the web image cannot import `app.*`); its `projects` table collides with ours. New `008_auth_owner.sql`: `users` (FamilySearch id pinned, so a second account with the same email is refused), `allowed_emails`, `familysearch_tokens` keyed by user with a `granted_at` that refresh never moves (U3's 24 h clock), and a nullable `projects.owner_id` (the engine creates projects without one). Refuse a `project_id` the caller does not own; `delete_session` drops project data only when no other session uses it. The web image builds from the repo root and carries `familysearch.json` (decided 2026-09-29). No refresh and no worker change: until U3 every patron's FamilySearch calls run on the operator's token, so the allowlist holds only staff entitled to it (a written rule, no code guard; decided 2026-09-29). Measured on the dev key whether a second sign-in revokes the first token: it does not (2026-09-29, n=1, 62 polls over 5 min on the same account); only a refresh revokes. **Done when:** a second user gets 404 on every session route; opening a session on another user's project is refused; sign-in completes on compose through the dev key's `127.0.0.1:1837` redirect (the rehearsal-host run moved to U13, decided 2026-09-29).

**U3.** Why: a naive port silently impersonates across patrons; a refresh revokes the prior access token at once (2026-09-23). Build list 3's step 19 (Grants) with a per-patron database lock, not issue #2887's in-process one. The lock is on U2's `familysearch_tokens` row; never refresh while that patron has a turn live, and the sign-in callback's grant rewrite takes the same lock. The worker reads the current grant each attempt (turn's project → `projects.owner_id` → `familysearch_tokens`) and fails loudly when there is none. Keep the token out of the queue body, which persists in `turns.message` and the DLQ; delete the `FS_ACCESS_TOKEN*` fallbacks (`worker/options.py`, `worker.py`'s `fs_access_token` read, the compose lines, `env.sh`'s `.fs-token` minting). End a run whose grant passes its 24 h maximum (F15, from `granted_at`) with a named outcome, shown to the patron over SSE. Measure first on the dev key: one token idle past 8 h, one past 24 h (no `expires_in` in the response); U2 measures second-sign-in revocation. **Done when:** one patron's two live sessions see no mid-attempt refresh; a resumed run has zero `reauth_hits`.

**U4.** Why: only network placement protects the tool server (step 9). Skip if F8 accepts isolation. **Done when:** a test refuses patron A's bearer naming patron B's project.

**U5.** What integration needs until U26. Why: sqsd cuts a POST silently and redelivers while the attempt runs on (step 11): two CLIs on one session. A dead-lettered turn stays open, holding its session and held messages (found by reading). Build: step 11's interim sqsd values, so sqsd cuts only a run past 10 h (D18's spend rates reach the untried $35 cap in ~3–4.5 h, U23; a crashed worker's message can take ~10 h to return); exit cleanly on SIGTERM; close a dead-lettered turn with a named outcome, releasing its held messages. **Done when**, in U13: a run past 1,800 s completes on receive 1; SIGTERM mid-turn exits and the redelivery resumes (answer 500 before exiting, or lower `VisibilityTimeout` for the test); `MaxRetries` 1 plus a 500 closes the turn and releases its held messages.

**U6.** Why: claims have no fencing or expiry; cross-instance write locking is untested. **Done when:** a two-worker test, with a parallel write through two tool servers, makes the stale epoch's writes no-ops.

**U7.** Why: `enqueue.sqs_call` is unsigned. **Done when:** in U13 the web tier enqueues and the worker releases a held message.

**U8.** Why: static keys are mandatory, the region and path-style hard-coded. Build it even if F14 allows keys. **Done when:** `make proto-store-test` passes on MinIO and U13's tools reach S3 keylessly.

**U9.** Why: every instance applies every schema file at start (review item 15); concurrent starts are untried. **Done when:** empty and 005-level databases reach 007, and simultaneous starts do not race.

**U10.** Why: health checks answer 200 when `prepare()`, Postgres or S3 fail; a read-only config dir (P1) or a mismatched child `CLAUDE_CONFIG_DIR` silently loses the transcript. **Done when** (offline): Postgres down fails all three checks; a bad `TMPDIR` blocks start; a model turn appending no entries fails non-200.

**U11.** Remove or gate: the D3 `behaviour` stub arms (crash is an unauthenticated `os._exit(1)`); `*-unknown` id defaults; `BLOCKED_TOOLS`, `LIVE_TREE_ARG_TOOLS`; token fallbacks (U3); `NullQueue` (U2 removes the auth stubs); the implicit `MODEL_PROVIDER=anthropic`; `GENEALOGY_DEBUG_HOLD_*`; `.fs-token` (not in `.dockerignore`); stale agent and skill counts. **Done when:** a crash POST answers 400; a packaging test rejects dev variables in production config.

**U12.** Why: none exist; the review rules Docker out, so start now. Build and test on Node 24 with npm 11.12.x; add `tsx` to engine devDependencies or compile the smoke (acceptance step 2). Vendored bundles must fit 512 MB; installed ones need registry egress. **Done when:** U13 passes.

**U13.** Why: the guide is untrusted until run. Correct list 3 wherever reality differs. Register the rehearsal host's callback on dev key `fs-internal-dev-key-000262` (else F15). Measure step 11's open items, `TMPDIR` size, closed-VPC CLI egress, TLS-enforcing Postgres, and recovery from a kill between a tool result spilling to `mkdtemp` and its read. Departures: stock Beanstalk, no gateway allowlist, self-provisioned stores, `MODEL_PROVIDER=anthropic` (so `ANTHROPIC_API_KEY` from secrets, egress to `api.anthropic.com`, acceptance step 1 expects `provider=anthropic`); our hostname and certificate; needs no list-2 answer. **Done when:** the acceptance test passes and FamilySearch sign-in completes on the rehearsal host (moved from U2).

**U14.** Why: the worker has used the gateway provider once (2 short turns, local copy of TAP's route, no kill; P3k, 2026-09-25); an unmapped agent model silently becomes a general-purpose stand-in (P3h). Run `probe_gateway_parity.py` on the integ route, adding deployed latency and which of four cache points survive. Then one gateway run on a page-scan fixture: a kill inside an image-reading delegation, a forced autocompact, `gps-mentor` on Sonnet 5, cost against a tool-search-on control (prices F2); compose on the VPN suffices (F13). **Done when:** the worker asserts at start that every agent model is in `GATEWAY_AGENT_MODELS` and fails loudly on any `general-purpose` delegation; the probe passes but for known items; the run meets D17 criteria 1–3.

**U15.** Why: the Postgres store test skips 37 of 41 cases in CI (2026-09-29); no workflow runs Postgres. Run the tool suites (1,939 cases, 2026-09-18) under a new `PROTO_STORE=pg` in CI, plus one paid harness run per skill. **Done when:** CI is green, nothing skips, per-skill run logs are committed.

**U16.** Why: no human has graded a prototype tree; the judge over-credited f1 on that fixture (issue #2904). **Tree:** the D17 and D18 exports are on Richard's machine (project files only; transcripts gone), and he decides. D18's `proj_bagley-father-1884_072ee7` pairs like-for-like with the blind-graded harness run of its week and commit (the report's 1.37×); else PR #2870's `proj_bagley-father-1884_40af16` (its author's machine; no same-week partner) or a ~$16 re-run on `main`. **Grade:** someone other than the grader copies the export's `tree.gedcomx.json` and `research.json` into `eval/runlogs/e2e/<fixture>/` as `run-<ts>.final-tree.gedcomx.json` and `run-<ts>.final-research.json`; the grade counts in calibration like any other. The grader names the stem and has not seen the judge's result (the report, this plan, the prototype plan, issue #2904, `proto-grade` or `proto-compare` output); `.claude/skills/grade-e2e-run/SKILL.md` has the rules. **Duplicates:** a dev script over each graded export applies PR #2850's `reextractionKey` with the log entry blanked, image-pass logs excluded; one non-image cross-log duplicate triggers widening the guard's key to ignore the log entry (1–2 days). Pin SDK and stop policy; run both sides under U25's cap and U26's limit. **Done when:** a blind `.ann.json`, more than one run per side, and the corpus (136 fixtures, 108 with runs, 2026-09-29) re-baselined; the duplicate count reported for each graded export.

**U17.** Why: the e2e harness's Stop hook still classifies hand-backs (the agent asking the patron), retired by issue #2292; it answered 1 of 3 bagley stops "Yes." where the worker sends `CONTINUE_REASON`. Delete the classifier or keep it deliberately. **Done when:** `test_continue_policy_parity.py` passes; no comment calls issue #2292 pending.

**U18.** Why: ~166k tokens/min per session versus a 2M TPM default (estimate, 2026-09-09); at run grain queue depth "goes to zero exactly when the system is saturated". Measure quota (P3). **Done when:** a proposed scaling metric; packing and the review's ~$0.04 compute estimate re-derived for U26's 1,800 s runs from U13's memory; a gateway load run records TPM, 429s, time to first byte, burndown multiplier, cache-read exemption.

**U19.** Why: "none exists and nothing alerts" (review item 13). Pool connections; add retention for `session_entries`, `session_events`, `tool_calls`; sweep S3 orphans; make `delete_session` remove the SDK transcript (keyed by another id) and the S3 objects (U2 stops it dropping a project other sessions share); alarm on DLQ depth, message age, `no_progress`, reauths, spend, long `Agent` calls; reprice cache writes ($6/M, 1 h) for the 5 min TTL. **Done when:** tests pass; U13 has the alarms.

**U20.** Gaps: uploads, image pane, logs answer 501, sidecar bodies 404; `search-wikipedia` and `search-familysearch-wiki` fail EACCES on the 0555 cwd (PR #2963 may fix one); `research/SKILL.md`'s `evaluations/` gates never match, so gated steps re-delegate to gps-mentor (unmeasured); after the $35 cap the SPA cannot continue the project; without OpenRouter (F9) `image_transcribe` needs a provider. **Done when:** each works here.

**U21.** Decided 2026-09-29 (lead):
1. **Image cap:** hard, for continuous single-turn research and cost (U25).
2. **No `bedrock-exception-*` role** (F9); `MODEL_PROVIDER=bedrock` deleted with this handoff.
3. **`TOOL_SERVER=stdio`, `src/hosted-stdio.ts`** deleted with this handoff; HTTP only.
4. **Forced foreground** is the design (PR #2852; U27).
5. **No content-level dedup** before go-live; U16 counts duplicates.
6. **Prototype grades** count in calibration (U16).
7. **The D17/D18 exports:** Richard decides (U16).

**U22.** Why: the 2026-09-07 draft carries none of the report's six corrections (the sixth is the grain). Add them and R6: no shell, WebFetch/WebSearch or device bridge where record text is read. Commit the scripts behind the report's measurement 3 and corrections 2 and 4 first; they never landed. **Done when:** all seven are in and the scripts are in git.

**U23.** Why: until U26, Stop and the $35 cap are the patron's only bounds on a run; all four have offline tests only. The hooks swallow Postgres errors, so during an outage Stop, the held-message handover and the cap fail open, silently. Also run PR #2870's owed probes: `make proto-probe-resume` (its kill now lands in a foregrounded delegation) and the two SDK questions under "Not covered". **Done when:** each is recorded on compose, then in U13.

**U24.** Why: since PR #2870 every browser turn, even a lookup, runs to the proof, the nudge cap or $35; outcome `decision` (ending to ask the patron) never fires; the web path skips the `research` router about half the time. Build "Before phase 2" of [`research-as-a-job-later.md`](research-as-a-job-later.md) (issue #2921, issue #2927, issue #2932). **Done when:** its Acceptance paragraph passes.

**U25.** Issue #3010. Why: nothing bounds image browsing; D18 paerai made 108 `image_transcribe` calls and passed $35 on the cap's meter. From the 21st distinct image per image group per project, `image_transcribe` and `image_read` refuse, on one shared count kept in the project store (the advisory threshold becomes a refusal). The refusal says to log the browse `partial`, try other routes, and link the next unread image in the final summary. Amends ADR-0011's read-tool carve-out and the spec's browse budget. `image-reader` relays a thrown error verbatim, so the cap needs no issue #1546 relay fix. **Done when:** the 21st image of one group is refused across a tools restart, and a delegated read relays it.

**U26.** Blocked on [`cost-latency-10x.md`](cost-latency-10x.md): its median e2e run is 75.7 min, so a 30-minute limit now would cut most runs. Every run (one patron message) ends within 1,800 s, terminated, not resumed. A lost worker instance ends the run too (lead, 2026-09-29): its redelivery arrives past the limit. Either way the patron's next message continues the conversation from Postgres, the resume D17 proved.
1. The clock starts at the first attempt (Postgres); a resume gets no fresh 1,800 s.
2. Near 1,500 s, `should_continue_run` stops nudging and asks for the summary; new delegations are denied.
3. At 1,800 s the worker stops the CLI, closes the turn `budget` with limit `time`, tells the patron where it stopped ("send another message to keep going"), and answers 200 so the message is deleted. A cut delegation's write rolls back (PR #2850).
4. A redelivery past the limit closes at once as `interrupted` and tells the patron to send another message; `MaxRetries` small.
5. sqsd `InactivityTimeout` just above the worker's deadline.
6. The e2e harness gets the same limit (U16).
7. The next message continues the conversation with a fresh 1,800 s.

**Done when:** acceptance step 5's time-limit form passes on U13's rehearsal host.

**U27.** Done in this PR. The hook rewrote only an explicit `run_in_background: true`, but CLI 2.1.220 backgrounds an `Agent` call with no flag, and the two extractors lost on 2026-09-21 had none. The worker now rewrites every delegation not explicitly `false`; `test_a_delegation_not_explicitly_foreground_is_rewritten` fails on the old rule.

## 2. Preconditions only FamilySearch can answer or do

| # | Who | Ask | Unblocks | Blocks | Status |
|---|---|---|---|---|---|
| F1 | APT (FS AI Platform) | Integ URL and consumer key (shared `claude-code` or ours); our workers in the APT-1512 key batch (R1, R10) | U14, U18 | integ | Batch: sent 2026-09-18, unanswered. URL, key: drafted, **not sent** |
| F2 | APT | A date for agentgateway ≥ v1.6.0: on v1.5.0 tool search fails on turn 2 (P3e), so it runs off, tripling the first call's cached context (≈25k → ≈76k tokens) and adding ≈+18% on one turn (P3f, P3i, local, n=1, 2026-09-25); full-run cost unmeasured (U14). (R1) | Tool search at production cost | go-live (cost) | Drafted, **not sent** |
| F3 | APT | `frontendPolicies.http.maxBufferSize: 33554432`: at the 2 MiB default a session 413s at its third page scan (P3l, local v1.5.0, 2026-09-25) or near ~480k tokens, before compaction (P3j arithmetic). Route changes take days (R13) | U14; image-heavy sessions | integ | Drafted, **not sent** |
| F4 | APT | If the model allowlist lands, admit `us.anthropic.claude-sonnet-4-6`, `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `us.anthropic.claude-sonnet-5` (P3h). Is Sonnet 5 enabled? Pin no `model:`; it overrides per-agent models (R2) | U14 | integ, once the allowlist lands | Allowlist: drafted, **not sent**. Sonnet 5, `model:`: not yet asked |
| F5 | APT | Our `tap-gateway-invoke` role and its account (P25, new via GEM, or the review's P20); where quota requests go; gateway scaling after our perf test (R2) | U18 | go-live | Role and account: sent 2026-09-18, unanswered, ETA December (R2). Scaling: not yet asked |
| F6 | APT | Will you emit `guardContent` for tool results, and when? `guardrailIdentifier` is a placeholder in beta and prod (R6) | ARB injection answer | go-live | Sent 2026-09-18, unanswered |
| F7 | InfoSec; APT | Langfuse keeps every prompt: patron names and record details as typed or narrated, not tool results or images (~700k characters for one 11-call turn at a local collector; P3l, 2026-09-25, n=1; a full run is many times that). Acceptable? What must APT add? Retention? APT: what did Langfuse store for U14's first call? (R11) | Security review | go-live | First ask (wrongly said images leave): sent 2026-09-18, unanswered. Correction, retention, check: **not sent** |
| F8 | InfoSec | MCP security review (review item 11): a live bearer on every hop, including plain HTTP worker-to-tools? An encrypted grant at rest? Tool-server network isolation enough? | U3 at go-live, U4 | go-live | Not yet asked |
| F9 | ACE; FS legal/records | Your image provider? The SCP does not block OpenRouter egress, but policy may; the review says "no FamilySearch approval and cannot ship". Custodian terms for third-party OCR (R12) | U20 | go-live; integ runs degraded | Provider: sent 2026-09-18, unanswered; `bedrock-exception-*` role withdrawn 2026-09-29 (U21), ACE not yet told. Terms: not yet asked |
| F10 | Help team (`fs-eng/help-research-only`) | How does your SSE emitter handle DTM concurrency, or do you bypass DTM? Does your frontend reach it through the public edge? (R3) | F11, step 16 | go-live | Sent 2026-09-18, unanswered |
| F11 | FS platform/DPF | The SSE edge probe (R3's arms, prototype plan), only if F10 says they bypass DTM | SSE through the edge | go-live | Not yet asked |
| F12 | FS platform, DTL | Which Beanstalk platforms (the review says Docker left the 1.1 allow-list)? An AL2023 AMI for Python 3.12, Node 24? Will Blueprint's worker tier take step 11's sqsd values and keep our `.ebextensions` and nginx overrides? (R9) | FS integ deploy; U12's form | integ | **Not yet asked** |
| F13 | FS platform/network; APT | Account and VPC; worker subnets on the gateway ALB allowlist (R10); step 2's egress; a PyPI/npm mirror? `*.fslocal.org` names to avoid Imperva 403s? HAProxy inactivity timer above 15 s, unbuffered (R3) | U4, U14, step 16 | integ | Not yet asked |
| F14 | FS platform (Blueprint) | Postgres 16 (RDS or Aurora), S3 bucket, worker queue and DLQ, secrets store, IAM roles; tool-server LB idle timeout ≥ 1800 s (60 s cuts OCR, rolls back writes). Static S3 keys allowed? | FS integ deploy; U19 | integ | **Not yet asked** |
| F15 | FS OAuth client owners (team unknown) | A client with `https://<integ host>/callback` (F18), later production. Confirm the lead's 8 h idle / 24 h max lifetime and revoke-on-refresh. Re-sign-in when a session's grant passes 24 h? | U2, U3; step 18 | integ; go-live (production) | Not yet asked |
| F16 | fs-eng | Host wiki-query-api and Pop Stats (issue #290, closed 2026-09-28: fs-eng's job); defaults point at a developer's Tailscale Funnel host (public, checked 2026-09-29), outside step 2's egress | `WIKI_API_URL`, `POP_STATS_URL` | go-live; meanwhile four tools fail and answers silently thin | Not yet asked |
| F17 | PM, ARB, InfoSec, Church AI Working Group | CAS/TARS for the email allowlist (review item 16); PRIA (10); AI Working Group (12); ARB review: grain (R4), 3 s SLA exception (9), us-east-1-only DR (18); backup retention and deletion; Dynatrace (13); API service identity (17); mobile scope (PM; F11's mobile arm) | U19 | go-live | Not yet asked; goes with U22's draft |
| F18 | FS platform/DPF | Web tier public hostname (integ, production), TLS certificate and HTTPS listener on its ALB, edge route (CloudFront, Imperva, HAProxy/DTM); F15's redirect uses it | U2, F15, steps 15–18 | integ | Not yet asked |

### Dependency order

```
U2 sign-in ─► U3 custody ─────────┐
U5 (interim), U7–U11, U23 ────────┤
U12 artifacts ────────────────────┴─► U13 rehearsal (our account) ─┐
F12 platform/AMI, F13 network, F14 provisioning, F18 host/TLS ─────┼─► FS integ deploy (list 3)
F1 + F3 + F4 + F13 gateway access ─► U14 gateway run ──────────────┘
F2 (≥ v1.6) ─► GATEWAY_TOOL_SEARCH=true            (cost; integ runs without it)
F9 image provider ─► keeps image_transcribe on OpenRouter, or new engine work (U20)
U13 rehearsal ─► U18 packing + scaling metric ─┐
U22 ARB corrections ───────────────────────────┴─► F17 ARB review ─► go-live
U6 fencing + U18 scaling metric ─► more than one instance
F5 role (ETA December) ─► U18 load test ─► go-live
cost-latency-10x.md ─► U26 time limit ─► go-live (U5's interim sqsd values until then)
U17 stop parity; U25 image cap, U26 for the paired runs ─► U16 quality ─► go-live
F6, F7, F8, F10 → F11, F16, U24, U25 ─► go-live
```

- F5's role (December) is the only dated FS input; a load test before it measures TAP's shared pool.

## 3. Deployment guide for FamilySearch

**Never run end to end on AWS; U13 makes it trustworthy.**

- **[compose]:** tested only under docker-compose or a local probe.
- **[EB probe]:** measured by the hello-world Beanstalk worker probe (sqsd 3.0.5, t3.micro, us-east-1, 2026-09-11, n=1).
- **[live run]:** exercised by the D17/D18 billed runs (compose, Anthropic API direct, one patron).
- **[untested]:** never executed anywhere.

### Prerequisites

1. **Answers:** F1, F3, F4, F12–F15, F18; F9 for image transcription; F16 for acceptance step 2. [untested]
2. **Network.** Private subnets for web, worker, tools; worker subnets inside the gateway ALB's CIDR allowlist. Egress: the gateway `/bedrock` route; `familysearch.org`, `api.familysearch.org`, `www.familysearch.org`, `sg30p0.familysearch.org`, `ident.familysearch.org`; `en.wikipedia.org`; `openrouter.ai` if F9 allows; F16's hosts; AWS `sqs`, `s3` (gateway endpoint; also serves app bundles), `logs`, `secretsmanager` (plus `kms` if customer-managed), `elasticbeanstalk`, `elasticbeanstalk-health`, `cloudformation`, via VPC endpoints or NAT; `pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org` or an F13 mirror, unless U12 vendors dependencies. The CLI's other egress in a closed VPC is unchecked (U13). The tool server sends a browser user agent to FamilySearch (Imperva). [untested]
3. **IAM.** Instance profile `aws-elasticbeanstalk-ec2-role` with `AWSElasticBeanstalkWorkerTier` and `AWSElasticBeanstalkWebTier`; `aws-elasticbeanstalk-service-role` with `AWSElasticBeanstalkEnhancedHealth` and `AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy`. [EB probe] Web: `sqs:SendMessage`. Worker: the worker-tier policy plus `sqs:SendMessage`. Tools: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`, and `s3:ListBucket` on `arn:aws:s3:::<bucket>`, without which a missing key is a 403 the store misreads. Each: `secretsmanager:GetSecretValue` on its own secrets (plus `kms:Decrypt` if customer-managed). [untested]
4. **Secrets:** `GATEWAY_API_KEY`; `OPENROUTER_API_KEY` (if F9 allows); Postgres credentials in `PG_DSN` and `GENEALOGY_PG_DSN`; `GENEALOGY_S3_ACCESS_KEY`, `GENEALOGY_S3_SECRET_KEY` (until U8); the grant-encryption key `FS_TOKEN_ENC_KEY` (U2, U3); the web tier's session-signing secret `SESSION_SECRET` (U2), never the alpha's public default; the web tier also takes `ALLOWED_EMAILS`, `PUBLIC_URL`, `WEB_ORIGIN` and `FAMILYSEARCH_WEB_ENABLED`, and refuses to start on https with a default secret. No service reads a secrets store: deliver each as an environment variable of its reader. The FamilySearch client id ships in `packages/engine/mcp-server/config/familysearch.json`; F15 replaces the dev key. [untested]

### Data stores

5. **Postgres 16.** Web, worker and tools share **one database**; the engine reads `documents`, `blobs`, `staging` but never creates them. [compose] **TLS** [untested]: RDS for PostgreSQL 15+ enforces it by default (`rds.force_ssl`). Web and worker (psycopg): add `sslmode=require` to `PG_DSN`. Tools (node-postgres): `GENEALOGY_PG_DSN=…?sslmode=verify-full&sslrootcert=<RDS CA bundle path>`, bundle shipped in the tools artifact; `sslmode=require` alone means `verify-full` there (pg-connection-string 2.14.0), and Node does not trust the RDS CA.
6. **Schema.** Apply `apps/server/proto/sql/001_schema.sql` through `007_session_usage_index.sql` in name order, once per deploy, before any service starts; all are idempotent. Until U9, web and worker also apply it at start, so their `PG_DSN` needs the schema-owning role: with a DML-only role the web tier fails to start and the worker logs it and carries on. [compose]
7. **S3 bucket.** Keys `<projectId>/<ref>/<uuid>`, immutable per write. Block public access; encrypt at rest. No orphan sweeper yet (U19). [compose]

### Queue

8. **Let the worker environment create its queue** and DLQ; `MaxRetries` governs the DLQ. [EB probe] Pass its URL as `QUEUE_URL` to web and worker. A pre-created queue (`WorkerQueueURL`) is [untested]. Requires U7.

### Tool server

9. **Tools environment** (Node platform; an image if F12 allows Docker). Image [compose]; platform bundle [untested] (U12).
   - **Build** in `packages/engine/mcp-server`: `npm ci && npx tsc`, then `npm ci --omit=dev`; `config/` beside `build/`. Recipe: `apps/server/proto/tools/Dockerfile`.
   - **Run** `node build/http.js --host 0.0.0.0 --port <port>`; no config file.
   - **Node ≥ 22, npm 11.12.x:** `npm install -g npm@11.12.1` (or `corepack enable`) before any `npm ci`, or the engine-strict `.npmrc` refuses Node 22's npm 10. Node 24 untested (U12).
   - **nginx:** the platform's 60 s `proxy_read_timeout` cuts longer tool calls; add step 12's override (≥ 1800 s). [untested]
   - **Health check** [untested]: `HealthCheckPath` (`aws:elasticbeanstalk:environment:process:default`) `/healthz`; only `/healthz` and `/mcp` exist. `/healthz` checks neither Postgres nor S3 (U10) [compose].

   **Variables:**

   - `GENEALOGY_PG_DSN`: required; the shared database.
   - `GENEALOGY_S3_ENDPOINT`, `GENEALOGY_S3_BUCKET`: required; step 7's bucket.
   - `GENEALOGY_S3_ACCESS_KEY`, `GENEALOGY_S3_SECRET_KEY`: required until U8. A missing required variable exits 2 before listening.
   - `GENEALOGY_ANCHOR_PATH`: `/project` (default)
   - `WIKI_API_URL`, `POP_STATS_URL`: F16's hosts; the default is outside step 2's egress.
   - `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`: only if F9 allows. Model default `google/gemini-3.7-flash`.

   **Never set in production:** `GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS`, `GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS`.

   **Network:** only the worker security group (worker, acceptance bastion) may reach tools; until U4 it checks nothing beyond two headers. Every worker-to-tools idle timeout ≥ 1800 s; a cut connection rolls the write back. [untested] **Scope:** one process serves every patron, binding the store per request from `X-Genealogy-Project-Id`: [live run] for one patron; isolation tested offline only.

### Worker tier

10. **Worker environment** (Worker tier, SQS/HTTP, Python 3.12). Image [compose]; platform bundle [untested] (U12).
    - **Dependencies:** `claude-agent-sdk==0.2.128`, `psycopg[binary]>=3.2,<4`. The SDK bundles CLI 2.1.220: 257 MB on macOS arm64, 272 MB on Linux arm64 (2026-09-29).
    - **Code:** `apps/server/app/` and `apps/server/proto/{worker/,sql/,enqueue.py}` as `<root>/app/` beside `<root>/proto/`, `<root>` on `PYTHONPATH`; `packages/engine/plugin/` at a fixed read-only path. **Run** `python3 proto/worker/worker.py` from `<root>`.
    - **Recipe:** `apps/server/proto/worker/Dockerfile`. No Node, engine build or S3 secret (on linux/arm64 it builds and CLI 2.1.220 starts; a full turn, x86_64 and the platform bundle are unchecked; U12).
    - Non-root: the CLI refuses `bypassPermissions` as root. [compose]
    - `/project` exists, empty and read-only (0555), or the CLI will not spawn. [live run]
    - `TMPDIR`: writable tmpfs for one turn's transcript plus spill (compose 1 GB, unmeasured), never persistent. [compose]
    - No system Claude Code; the SDK pins the CLI. An SDK bump re-runs `make probe-bash-deny`, `probe-registration`, `probe-agent-binding` and `probe_gateway_parity.py`. The first three read `ANTHROPIC_API_KEY`; whose key runs them, or a port to the gateway, is FamilySearch's call.
    - Ship plugin and worker together: `EXPECTED_AGENTS` (8) and `EXPECTED_SKILLS = 27` are literals; a mismatch refuses every turn with 500 before billing. [compose]

    **Variables:**

    - `PG_DSN`; `QUEUE_URL`: the shared database; step 8's queue, for held-message release
    - `PORT`; `WORKER_CWD`; `ENGINE_PLUGIN_DIR`; `TMPDIR`: default 8080; `/project`; the plugin path; the tmpfs
    - `MODEL_PROVIDER`: `gateway` [compose] only (P3k, local v1.5.0, 2 turns). `anthropic` [live run].
    - `GATEWAY_BASE_URL`: the `/bedrock` route root. Required under `gateway`.
    - `GATEWAY_API_KEY`: sent as `Authorization`, never `x-api-key`
    - `GATEWAY_TOOL_SEARCH`: `false` until F2 lands agentgateway ≥ v1.6
    - `TOOL_SERVER_URL`: `http://<tools host>/mcp`
    - `SESSION_SPEND_CAP_USD`: per-session bound, default 35
    - `PRICE_INPUT_PER_MTOK`, `PRICE_CACHE_WRITE_PER_MTOK`, `PRICE_CACHE_READ_PER_MTOK`, `PRICE_OUTPUT_PER_MTOK`: defaults 3.0, 6.0, 0.30, 15.0; recalibrate (U19)

    **Never set in production:** `ANTHROPIC_API_KEY`, `BLOCKED_TOOLS`, `FS_ACCESS_TOKEN`, `FS_ACCESS_TOKEN_FILE`, `AUTONOMOUS_MAX_NUDGES` (the web tier stamps it).

11. **sqsd options** (`aws:elasticbeanstalk:sqsd`; template `apps/server/proto/eb-worker-probe/.ebextensions/01-worker.config`). API option settings override the file [EB probe]; Blueprint's precedence is [untested] (F12).

    | Option | Value | Status |
    |---|---|---|
    | `HttpPath` | `/turn` | [untested]; the probe used `/`. Other paths 404, which sqsd retries into the DLQ. |
    | `HttpConnections` | `2` | [EB probe]. Memory at 2 concurrent turns unmeasured. |
    | `InactivityTimeout` | Interim (U5): `36000`, Beanstalk's maximum. After U26: just above the worker's 1,800 s deadline | [untested]; `1800` [EB probe] |
    | `VisibilityTimeout` | Interim `36300`; after U26 just above `InactivityTimeout`. SQS's maximum is `43200`. A crashed worker's message returns only after it | [untested]; `2100` over `1800` [EB probe] |
    | `MaxRetries` | Small: only crashes and deploys add receives | Mechanism [EB probe], value [untested]. Counts never reset. The probe used 10. |
    | `ErrorVisibilityTimeout` | Sized in U13 with `MaxRetries` | [untested]. AWS documents a retry of a non-200 after this delay (default 2 s). The worker answers 500 whenever it cannot claim the turn in Postgres, so at 2 s a failover can exhaust `MaxRetries` in seconds and dead-letter the turn. |

    Measured (2026-09-11, n=1): at `InactivityTimeout` sqsd cuts the POST **and tells the worker nothing**; the message returns after `VisibilityTimeout` (300 s dead at 2100 over 1800). Ids travel in the body (a message attribute was not forwarded); the worker reads `X-Aws-Sqsd-Msgid` and `X-Aws-Sqsd-Receive-Count`. A configuration-only update took 78 s, restarting only sqsd. **Not measured:** sqsd on a worker 500, an app-version deploy mid-turn, the 512 MB bundle cap, the `.ebextensions` naming rule.

12. **nginx override:** `.platform/nginx/conf.d/<name>.conf` with `proxy_read_timeout 43200s;`, or nginx cuts the POST at 60 s. It must exceed `InactivityTimeout`, or nginx's 504 redelivers mid-run. Template: `apps/server/proto/eb-worker-probe/.platform/nginx/conf.d/01-worker-timeouts.conf`. [EB probe] (Python platform).
13. **One instance each** for worker and tools until U6, not the review's 2. [compose]
14. **Logs:** `aws:elasticbeanstalk:cloudwatch:logs` `StreamLogs: true` on all three, `DeleteOnTerminate: false`, retention of FamilySearch's choosing. Groups: `/aws/elasticbeanstalk/<env>/var/log/web.stdout.log`, `…/aws-sqsd/default.log`, `…/nginx/access.log`. [EB probe] The worker logs JSON lines: `ev=start` names the provider; `ev=turn`, one per returning attempt, has on 200 `receive_count`, `resumed`, `list_subkeys`; a killed attempt writes none.

### Web tier

15. **Web environment** (Python 3.12, ALB). Code: `apps/server/proto/{web/,enqueue.py,sql/}`, built from the repo root so the image also carries `packages/engine/mcp-server/config/familysearch.json` (U2). Dependencies `fastapi`, `uvicorn[standard]`, `psycopg[binary]`, unpinned (pin in U12). Run `uvicorn web.app:app --host 0.0.0.0 --port <port>`. `HealthCheckPath` `/api/health`; `/` serves nothing until U12 mounts the SPA [untested]. Variables: `PG_DSN`, `QUEUE_URL`, `POLL_S=1`, `SSE_PING_S=15`, `AUTONOMOUS_MAX_NUDGES=60` (above the p99 of 51 steps, 189 e2e runs, 2026-09-27). [compose]
16. **SSE.** No response buffering on `/api/sessions/{id}/events/stream` in nginx or any proxy. Every idle timeout must exceed the 15 s ping; DTM idles out at 60 s. Fallback: `GET /api/sessions/{id}/events?after=N`. Direct [compose]; via ALB, nginx, CloudFront, Imperva, HAProxy or DTM [untested] (F10, F11).
17. **Browser client.** `vite build` `apps/web` with `VITE_SESSION_TRANSPORT=sse`, served same-origin (U12). [untested]

### Auth

18. **Redirect.** Register `https://<host>/callback` on the FamilySearch client (F15); set the tier's public URL (`PUBLIC_URL`) to that host. Sign-in is U2 (compose only); the host run is U13. [untested]
19. **Grants** (U3). The web tier holds each grant encrypted in Postgres and is its only refresher; the worker reads the current token each attempt. A refresh revokes the previous access token at once (2026-09-23): never refresh during a live attempt for that patron. [untested]

### Acceptance smoke test

Nothing scripts it against a deployed stack yet (`make proto-demo` and `make proto-audit` do on compose; U13 adapts them): run the SQL by hand.

1. **Health.** Web `/api/health`, tools and worker `/healthz` answer 200; tools reports `"tools":48`; `ev=start` shows `provider=gateway`. [compose]
2. **Tool transport.** From a worker-security-group bastion with Node ≥ 22, npm 11.12.x, `npm ci` run in a checkout's `packages/engine/mcp-server`, and registry access (`npx` fetches `tsx`; U12). If tools has `OPENROUTER_API_KEY`, write `{"openRouterApiKey":"set"}` to `~/.familysearch-mcp/config.json` and add `--host-config`.

   ```
   npx tsx dev/smoke-http.ts --base http://<tools host>:<port> --bearer <test patron token>
   ```

   It calls every tool but `login`, `logout`, `auth_status`. Pass: exit 0. Until F16 it exits 1 naming exactly `wiki_search`, `wiki_read`, `wiki_place_page`, `place_population`. [compose]
3. **One research turn.** As a test patron, open a session on a new project and ask a research question. The reply streams; the turn has `completed_at`; `research.json` is in `documents`. Then in psql after `\set s sess_…` (the web session id): [live run]

   ```sql
   -- criterion 3: both must be 0
   SELECT count(*) FROM tool_calls WHERE session_id = :'s' AND decision = 'allow' AND tool_name = 'Bash';
   SELECT count(*) FROM tool_calls WHERE session_id = :'s' AND decision = 'allow'
     AND tool_name IN ('Read','Grep','Glob') AND (input_path = '/project' OR input_path LIKE '/project/%');
   -- no silent stand-in for a plugin agent: must be 0
   SELECT count(*) FROM tool_calls WHERE session_id = :'s' AND agent_type = 'general-purpose';
   -- no FamilySearch call answered with the reconnect instruction: must be 0
   SELECT count(*) FROM session_events WHERE session_id = :'s' AND kind = 'tool_result'
     AND payload->>'summary' ~* 'Call the login tool|Reconnect FamilySearch|unauthori[sz]ed|\m401\M';
   ```

4. **Kill mid-delegation** (D17's equivalent). Set `GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS=20000` on tools for this test only, then unset it; without it `extraction_append` commits in ~68 ms (2026-09-20) and the kill lands after the commit. Run `/record-extraction` on a named record. When `tool_calls` shows an `agent_type = 'record-extractor'` row whose `tool_name` ends in `extraction_append`, terminate the worker instance within the hold.
   - Pass: `receive_count` ≥ 2; the redelivery's `ev=turn` has `resumed` true and `list_subkeys` ≥ 1; `completed_at` set, `outcome` not `no_progress`; `research.json` holds the source exactly once.
   - Void if the kill landed before the delegation started or after its `Agent` row had `duration_ms`; if any FamilySearch call got the reconnect instruction; or on more than one kill.
   - On Beanstalk, redelivery waits out `VisibilityTimeout`; lower step 11's interim values for this test.
   - [live run] on the 2026-09-23 pre-merge build only (D17, n=1, compose, `docker kill`); not re-run on current `main`; Beanstalk [untested].
   - Once U26 lands, the redelivery closes the run `interrupted` instead. Pass then: the patron's next message resumes the same SDK session (`resumed` true, `list_subkeys` ≥ 1) and `research.json` holds the source exactly once.
5. **No mid-run cut** (until U26): an autonomous run past 1,800 s completes on `receive_count` 1. Needs U5. [untested]
   **Time limit** (once U26 lands): by 1,800 s from its first attempt the run closes `budget` with limit `time`, the patron sees the stop event, the message is deleted, and a next message continues. [untested]

**Not covered** (never run live; U23 runs the first four): Stop during a run; held-message release; the $35 cap firing; Stop or cap during a foreground delegation, with PR #2870's owed SDK questions (does `continue_: False` suppress the Stop dispatch; does a subagent's halt stop the parent); the time limit (U26).

### Go-live gates

- The acceptance test passes on FamilySearch's integration environment.
- List 1 is closed, including U4, U6, U15–U20 and U22–U26.
- List 2 is answered: F2, F5–F10, F11 if F10 says they bypass DTM, F16 and F17.
- More than one worker or tools instance only after U6, and only once U18 has chosen the scaling metric.

## Not in scope

- The E2B/Fly/Neon alpha's token-refresh race (issue #2887): PR #2977 merged 2026-09-29 (engine 401 re-read; it re-reads only under `LOCAL`, so a bearer is unaffected), PR #2973 open.
- The eval harness: stays ours; U15, U16 port its measurements.
- `apps/server/dev/p1/` and `apps/server/proto/{seed,export,grade,compare,drive,smoke,turn}.py`: the re-run kit, never deployed.
- Opaque session tokens replacing the live bearer, unless F8 requires them.
- The turn-scoped batch ledger: cut 2026-09-10 (P1: a resumed turn re-decides).
