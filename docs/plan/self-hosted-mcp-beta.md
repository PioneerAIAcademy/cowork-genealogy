# Self-hosted remote MCP server: a public beta, February to July 2027

**Status:** Draft (2026-10-26). Wave 1 and `project_list`'s desktop and worker halves shipped in PR #3852 (2026-10-26). The rest is filed as issues ("Who builds what"), not started: what is likely to go wrong only live is due by 14 December, for a dress rehearsal before the holidays, and the rest by 31 December. Launch is the week of 1 February. Waiting on FamilySearch's approval, as any app on its API must, and on issue #3529's probe.

## What this is

- A public beta of the research assistant as a remote MCP connector. Cowork users with a paid Claude plan add the connector, install the plugin from our GitHub marketplace, and sign in with FamilySearch. Nothing is installed locally.
- A web app shows each user's projects, takes uploads, links the user's own OpenRouter account for transcription, collects feedback and offers a download.
- It runs two of the three tiers in [the handoff plan](familysearch-handoff.md), configured for the beta: the Python web tier with chat switched off, and the MCP tool server. There is no worker and no queue, because Claude runs in Cowork.
- The beta's code is the handoff's code. Every remaining difference is listed under "Differences from the handoff", with its reason.
- The team builds the code, from one issue per item or part of an item, and Richard reviews every change to the handoff's code. Each change before launch is additive and keeps the handoff's behavior as the default, so nothing there needs rework; the two After-launch changes replace the worker's FamilySearch bearer and the grant refresher. The handoff plan's "Alignment with the self-hosted beta" section lists them.
- It deploys to the lead's own AWS account and Neon, and uses no FamilySearch AWS resources.
- It runs from the week of 1 February to July 2027. Then everything is deleted.
- The lead does what needs his AWS account, Neon or GeneFun: the domain and FamilySearch's approval (P0.1), the skeleton (P0.3), the loopback bounce (P0.4), the environments, monitoring and release (D1–D3), the private feedback repo, its Apps Script copy and `/triage-feedback` (D5), the policies (L1), every decision and checkpoint, the Phase 4 runs and the July purge. Every other item is an issue; "Who builds what" lists them.

## Decisions (lead, 2026-10-25 and 2026-10-26)

| Topic | Decision |
|---|---|
| Shape | Two of the handoff's tiers: the Python web tier (`eb-web.zip`, chat off) and the MCP tool server (`eb-tools.zip`). No worker, queue or model gateway. |
| Host | Two Elastic Beanstalk environments in the lead's account, Python 3.12 and Node 24, one t4g.small each, behind one shared Application Load Balancer and one hostname. |
| Database and storage | Neon Postgres (Launch plan) and one S3 bucket. Neon keeps each commit in three zones, the durability Multi-AZ RDS would give, for less. |
| Schema | The handoff's numbered files in `apps/server/proto/sql/`, plus new numbered files for the beta's tables. One schema for both. |
| Sign-in | Users sign in with FamilySearch every sitting; FamilySearch's sessions end after 8 idle hours or 24 hours. Claude's sign-in server lives in the web tier, on the Python MCP SDK's handlers, and shares one FamilySearch callback with browser sign-in. |
| Tokens | Our access tokens last up to 24 hours. No refresh token is issued if P0.2 shows Claude accepts that. |
| Front door | One door on the tool server. Every caller presents our own token, and the door loads that user's stored FamilySearch token and OpenRouter key. |
| Projects | `projectPath` carries an id the server mints. The user who first writes to it owns it. |
| Surface | Cowork tasks only, because the research workflow needs the plugin's agents. |
| Sign-up | From launch day, open to anyone with a paid Claude plan, under a user cap. Until then, an allowlist of the lead's and the acceptance accounts. Each user needs a FamilySearch account whose email no other user has. |
| Web app | One `apps/web` build with feature flags. The viewer polls for changes. |
| Uploads | Plain files: the original, plus a PDF's own text when the browser finds a text layer. Claude reads or transcribes them with existing tools. |
| Transcription | On each user's own OpenRouter account, behind a switch that goes on once FamilySearch's approval is in writing. |
| Feedback | The alpha's workflow. The web tier's bundler posts each bundle to a second copy of the Apps Script endpoint, which saves it to the team's Drive folder and opens an issue in a private repo in the PioneerAIAcademy org. |
| Download | A zip of the project's files, plus a print view in the viewer, at launch. |
| Retention | Everything is deleted in July 2027, sign-ins and OpenRouter keys included. Nothing is migrated. |
| Settings | Environment properties. A change restarts the app, so the lead makes it at a quiet hour. |
| Limits | Per user, 4 calls at a time and a pause when FamilySearch answers 429. One shared FamilySearch budget, a transcription cap and a manual block. Per-user budgets may come later. |
| Plugin | A GitHub marketplace, published by the lead's release command. |
| Policies | A short privacy policy and terms from GeneFun, Inc. |
| Other deployments | The desktop extension and the Fly-hosted alpha keep running through the beta, because many testers have no Cowork. |
| Older extensions | Not supported. The research router needs `project_list`; without it, the router says the genealogy tools are not connected and stops. |
| Issue #3836 | Ships as its own PR. Its read block fires only when the file is not there. |

## What does not change

- The desktop extension (`.mcpb`) and its local store, used by developers, genealogists and both eval harnesses.
- The Fly-hosted alpha (`apps/server/app`, E2B sandboxes).
- The handoff's worker, queue and chat routes, and its behavior with chat on, until the After-launch changes. The beta switches the chat features off; it does not remove them.
- The plugin's agents and skills, apart from the router's changes, G5's capture wording and the connector's tool spelling.

## Architecture

| Paths on the ALB | Goes to |
|---|---|
| `/healthz` and `/api/health` (the deep checks) | A fixed 404, from rules above every forwarding rule |
| `/mcp`, `/.well-known/oauth-protected-resource/mcp` | Tool server |
| Everything else: `/`, `/api/*`, `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, the consent page, `/callback`, `/openrouter/*`, `/privacy`, `/terms`, `/livez` | Web tier |

The rules are made by hand, and the runbook records them. The ALB's health checks reach each tier directly on `/livez`, which touches no store. The release reads the deep checks on the instances.

**A connector tool call:**
1. **The token.** Claude sends our token to `/mcp`. The door looks up the token's sha256 in the connector token table. An unknown, expired or ended token, or a blocked user, gets 401 with `WWW-Authenticate`.
2. **The principal.** The door builds the `bearer` principal from the user's id, stored FamilySearch token and OpenRouter key. Both are decrypted from the web tier's Fernet ciphertext.
3. **The project.** The door parses the body before the transport and refuses a batch. A `projectPath` must name a project the user owns, or a fresh id from `project_list` that nobody has written to. One store is bound to it, and the first write records the owner.
4. **Dispatch.** The per-user cap applies, `createServer(principal)` dispatches, and one log line records the user, the tool and any FamilySearch status.

**Sign-in, once a sitting.** Adding the connector, or a 401, sends the user through the web tier:
- the consent page names the client, links the policies and states the deletion date;
- FamilySearch's PKCE flow returns to `/callback`;
- the callback admits the user, under the allowlist before launch and the user cap after, stores the FamilySearch token, and issues our code to Claude.

**Data.**
- **Neon.** Each tier has one DSN with a DML-only role. The web tier uses the direct endpoint, because Neon's pooler refuses its connection-time `statement_timeout`; the tool server uses the pooled one. DSNs carry no query string. TLS comes from `PGSSLMODE` and `PGSSLROOTCERT`.
- **S3.** One bucket, with versioning.
- **Migrations.** The release applies `migrate.py` with the owner DSN from the lead's machine.

## Differences from the handoff

| Difference | Why |
|---|---|
| No worker, queue, model gateway or chat routes; the web tier runs with chat off. | Claude runs in Cowork and calls the tool server itself. |
| With chat off, sign-in asks for no `offline_access`, and only the connector flow creates users. With chat on, both work as today. | The beta refreshes nothing and signs users up through Claude. |
| With chat off, the browser session lasts 24 hours, each sign-in consumes a single-use state record, and `/` shows the onboarding page. With chat on, all three stay as today. | Users sign in every sitting, and a beta user starts from Claude, not from the web app. |
| One public tool-server environment, not one reachable only from the worker. | The beta has no worker. |
| A connector names its project in `projectPath` and sends no claim fence. The worker sends its project header and the fence. | Claude cannot set headers, and only the worker has attempts to fence. The door and the principal builder are one code path. |
| Stock Beanstalk with ACM, Route 53, CloudWatch and a DSN in an environment property, where the handoff's platform has its own deploy, logging and secrets. | Each platform adaptation is a setting, and the plain path keeps working. The beta's deploy proves it every release. |
| Neon instead of RDS: system CAs instead of the RDS bundle, roles made in SQL, and the direct endpoint for the web tier. | The same durability for less. |
| Open sign-up under a user cap from launch, not a staff allowlist. | A public beta. One admission check reads either setting. |
| The FamilySearch redirect URI is a setting. Before launch the lead signs in through a loopback bounce. | The redirect is configuration. |
| The web tier budgets its own FamilySearch sign-in calls, off unless set. | No edge sits in front of it to absorb a flood of sign-in attempts. |
| Each user's own OpenRouter key, not an operator key. | Who pays for transcription. |
| Feedback posts to the Apps Script endpoint, not to S3. Bundles carry no transcript. | The team triages beta feedback as it triages alpha feedback, and the chat stays in the user's Claude account. One bundler; the sink is a setting. |
| Connector-only limits: Cowork's per-call budgets, the shared FamilySearch budget, 4 calls at a time per user. | Only connector traffic shares one key and one address at open sign-up scale. |
| No token refresh. | Every sitting starts with sign-in. |
| The viewer polls; the handoff's chat streams. | No chat, so nothing to stream. |
| The plugin comes from the GitHub marketplace, not the worker's bundle. | Cowork installs plugins from marketplaces. |
| The July deletion, GeneFun's policies and the onboarding page. | A six-month beta from GeneFun, Inc. |

## Phase 0: gates (weeks 1–2: 26 Oct – 8 Nov)

**P0.1 Approval, domain and Richard.**
- Choose and buy the domain. If it is not bought by 1 November, build the skeleton on a domain the lead already holds. Moving later takes a new certificate, a zone, and the public-URL and issuer settings, done before D4's link is written.
- Send FamilySearch's approval request. It is tracked privately.
- Give Richard the list under "Changes to the handoff's code".

**Done when:** the request is sent, the skeleton has a domain, and Richard has the list.

**P0.2 The connector probe.** Rewrite issue #3529 to the connector side.
- **The probe server:** a dev-only server in `packages/engine/mcp-server/dev/`, built from the SDK's OAuth example and shaped like the real server.
  - It runs with no sessions, gives plain JSON responses and offers no `/register`.
  - Its metadata advertises client metadata documents, and its clients store fetches only claude.ai client documents.
  - It holds no credentials and no store. Every tool is a stub that keeps its real name and schema and returns fixed text, plus sleep tools and a large-result tool.
- **Where it runs:** through a tunnel in week 1. Item 4 runs on the P0.3 host, after P0.3's 250 s check passes.

Measure, in a Cowork task:
1. **The tool prefix** of a custom connector added through the prefilled link (`https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Genealogy%20Beta&connectorUrl=…`). Record it for a connector added again under another name, one renamed after adding, and one declared in a test plugin's `.mcp.json` `http` entry.
2. **Agents and approvals:** whether plugin agents spawn with the connector's tools, and which calls prompt for approval, from the main thread and from an agent.
3. **The hook:** whether the plugin's `PreToolUse` hook fires on a connector call.
4. **Limits:** the per-call timeout, using 60, 120 and 240 s sleeps, and the result-size limit.
5. **Tool delivery:** whether every advertised tool arrives on a fresh add.
6. **Sign-in:**
   - that Claude presents its client metadata document, recording its URLs for the allowlist;
   - the exact parameters Claude sends to `/authorize` and `/token`;
   - that it accepts a grant with no refresh token;
   - what the user sees when `/mcp` answers 401, on the main thread and inside an agent. E3's message and D4's reconnect line are written from these screens;
   - what a new task shows once our access token has expired: whether the connector's tools are listed, and any prompt;
   - whether a sign-in started in one Claude account can finish in another. If it can, report it to Anthropic, and the launch decision goes to the lead.
7. **Folder access:** whether the built-in `Read` can see the project folder, for issue #3836.
8. **Updates:** whether a version bump in a test marketplace reaches a second Claude account, and how.
9. **PDF text:** three real browser-saved Ancestry captures through pdf.js, checking for a text layer.

**Done when:** each item has a recorded result in a comment on issue #3529.

**P0.3 The skeleton.** In the lead's account:
- **Network.**
  - A Route 53 zone, an ACM certificate, and one ALB with a 443 listener.
  - The ALB's idle timeout is set by hand to 1,800 s, since Beanstalk cannot set it on a shared ALB.
  - The deep-check 404 rules go on now. Until the web environment joins, the listener's default action forwards to the tools environment. The other path rules go on when the web environment joins.
  - The runbook records every hand-made rule. Before rebuilding or terminating an environment, delete the rules that forward to it, and set the default action to a fixed 404 if it forwards there. After a rebuild, re-create them on the new target group, and point the default action back at it if it was moved.
- **Access:** a security group the lead owns, admitting 443 only from his address and Anthropic's 160.79.104.0/21 until the sign-in server deploys.
- **The tools environment:** Node 24, running the probe bundle with eb-tools' `.platform` and `.ebextensions` unchanged, under the immutable policy. Options set at creation, as on the web environment later:
  - `LoadBalancerType=application`, `LoadBalancerIsShared=true`, `SharedLoadBalancer=<ALB ARN>` and `aws:elbv2:listener:443` `Rules=default`;
  - `SecurityGroups` set to the lead's group (a shared ALB takes no `ManagedSecurityGroup`);
  - `IamInstanceProfile` set to the tools profile, as D1 describes it;
  - `HealthCheckPath=/livez`, enhanced health and a service role;
  - immutable deploys and `DeregistrationDelay=300`;
  - log streaming with 30-day retention;
  - managed platform updates at patch level, in a weekly window at a quiet hour;
  - one t4g.small.
- **Data:**
  - a Neon Launch project with 7-day history;
  - an S3 bucket with public access blocked, encryption, versioning, and a lifecycle rule that expires noncurrent versions after 7 days and removes expired delete markers;
  - `migrate.py` run from the lead's machine.

If the shared ALB refuses `02-tools-alb.config`, the Changes list gains a build option, off by default, that leaves that file out of the beta's `eb-tools.zip`.

**Done when:**
- `/livez` answers 200 through the ALB from the lead's machine, and 443 times out from other addresses.
- A second immutable deploy of the probe bundle succeeds.
- The ALB's idle timeout reads 1,800 s, and the probe's 250 s call returns 200.
- From the instance, a FamilySearch API call with `BROWSER_USER_AGENT` succeeds, and an invalid code posted to ident's token endpoint gets FamilySearch's `invalid_grant`, not an Imperva block.

**P0.4 The FamilySearch callback.** The beta's FamilySearch callback is the redirect setting (W2), `https://<host>/callback` by default, the web tier's existing path.

Before launch, the lead signs in through a loopback bounce:
- a 10-line listener on his `127.0.0.1:1837` sends `/callback` on to the host, with the query string unchanged;
- the redirect setting points at the loopback.

The bounce is not an access control. Until launch day, admission reads an allowlist holding the lead's and the acceptance accounts' emails.

**Done when (once the web tier is deployed):** the bounce signs the lead in, and an email off the allowlist is refused.

## Phase 1: shared code

### The tool server (`packages/engine/mcp-server`)

**E1 One front door.**
- **Where:** `src/http-server.ts`, `src/http.ts`, `src/auth/principal.ts`, a Fernet decryptor in `src/auth/`, `src/store/pg-s3-project-store.ts` (`touchProject`), `dev/smoke-http.ts`, the `engine-smoke-http` target, compose's tools service, and their tests. The handoff plan's acceptance step 2 changes with the smoke: its bearer becomes the one the seeded turn is stamped with, its no-bearer rule changes, and its role needs INSERT and DELETE on users and projects too.
- **What:**
  - **Looking up the caller.** A bearer is looked up by its sha256: in the connector token table, or as the stamp on the open turn the worker's fence names. The worker path keeps using its own bearer as today, so the handoff's tools tier needs no decryption key until its worker changes.
  - **The principal** is the existing `bearer` kind, carrying the user's id and the decrypted FamilySearch token and OpenRouter key. The decryptor is about 30 lines of `node:crypto`, pinned by a test vector the Python suite shares. Compose's tools service gets `FS_TOKEN_ENC_KEY`.
  - **The project** comes from `X-Genealogy-Project-Id` for the worker, or from `projectPath` for a connector. The door parses the body, refuses a batch, checks the one call's project and binds one store to it. The user must own it, and `touchProject` records the owner of a fresh id on its first write.
  - **No valid token** gets 401 with `WWW-Authenticate: Bearer resource_metadata=…`. A request carrying the worker's project header is on the worker path: only a stamp on its open turn admits it, and a refusal there stays 403, as today. Every other request needs a connector token. The door also serves the protected-resource metadata, naming the issuer from the shared issuer setting, and `/livez`.
  - **A call with no project** runs store-less under the user's principal, except `project_list` (E2).
  - **Logging:** one line per call with the user id, the tool and any FamilySearch status.
- **Done when:**
  - tests show two users isolated, both by id and by guessing;
  - an ended grant and a blocked user each get 401;
  - a two-call batch is refused, and a call naming another user's project writes nothing;
  - a connector token sent with the worker's headers is refused 403 and reads nothing;
  - a worker's stamped call still works;
  - `make engine-smoke-http` passes against compose's web and tools services. The smoke keeps today's stamped-turn client and runs every row through it: it seeds a user, a project that user owns, and an open turn stamped with the sha256 of the bearer it presents, the host's FamilySearch token when there is one. With none, the turn is stamped with a random bearer, and a FamilySearch row passes when it answers `isError` with text matching `401` or `login tool`, the ways the tools word FamilySearch's refusal; `reauth()` in `dev/smoke-calls.ts` changes with it, and the connector client runs no FamilySearch row. A connector client runs only with `--connector`, which the make target passes. It seeds a Fernet-encrypted FamilySearch token and a connector token for the same user, so it needs `FS_TOKEN_ENC_KEY` on the tools tier; without the flag, the smoke runs against a tools tier with no key.

**E2 Project tools.**
- **`project_list`** shipped in PR #3852 for the desktop extension and the worker ([its spec](../specs/project-list-tool-spec.md)). Left for the connector:
  - for a connector's `project_list` call, the door binds a store whose `listProjects()` names the projects the user owns (`projects.owner_id`, through `PgS3Backend`) plus one fresh `/proj_<16 hex>` path, and which serves those projects' reads;
  - each listed project carries its `projectUrl`.
- **`project_create` and `project_context`** return a `projectUrl`, the project's viewer link. `project_context` also lists uploads (name, time, and whether a text layer was stored), and returns an `uploadUrl` when the tools tier's uploads setting is on.
- **Settings.** The web tier's public URL, the uploads setting and E5's switch reach the server through `src/hosted-config-env.ts` into its base config, and compose's tools service passes each one. No getter reads `process.env`. A link is left out when its setting is unset.
- **Where:** `src/http-server.ts`, `src/server.ts` (the three tools' dispatch arms pass the principal), `src/store/pg-s3-project-store.ts`, `src/hosted-config-env.ts`, `src/types/auth.ts`, the three tools and their specs, and `dev/smoke-calls.ts`. In the unit harness, `_COMPILED_TOOLS_WITH_PRINCIPAL` in `eval/harness/harness/mock_mcp.py` gains the three tools, and the direct `projectCreate` call in `eval/harness/tests/unit/test_init_project_provenance_validators.py` passes one.
- **Done when:**
  - the packaging tests and the smoke pass, and `project_list` → `person_read` → `project_create` builds a project that the caller owns and that the next `project_list` returns;
  - through the connector client, a user who owns two projects gets both plus one fresh `/proj_` path, another user's project is never listed, and each listed project carries `projectUrl` with the public-URL setting set and none without it.

**E3 Session end and wording.**
- **Ending a session.** For connector callers, `fs-fetch`'s 401 handling calls a hook on the principal, which makes one `GET /platform/users/current` with the same token. Only a second 401 ends the user's grant; a 403 never does. That call returns its result plus the reconnect message, and later requests get 401 at the door.
- **The reconnect message** is written from P0.2 item 6's screens.
- **Wording.** `login`, `logout` and the missing-OpenRouter-key message are worded by `principal.surface`. The other "call the login tool" strings stay.
- **`auth_status`,** for connector callers, reports the account id and checks the session with the same `GET`.
- **The token exchange** sends `BROWSER_USER_AGENT`.
- **Done when:** tests pin the confirm-then-end rule, the 403 case and each wording.

**E4 Limits.**
- **Per user, for connector callers:** 4 calls at a time, and a pause for `Retry-After` when FamilySearch answers 429.
- **In `src/utils/http.ts`:** one process-wide FamilySearch budget, off unless set. A block or challenge page fails only its own call.
- **Process-wide, off unless set:** a cap on concurrent transcriptions, and one collections cache for the process in place of today's one slot per token.
- **Blocking:** `blocked_at` is checked at the door.
- **Done when:** tests show:
  - one user's limits leaving another's untouched;
  - a planted 429 pausing only its user;
  - the shared budget refusing a call past it;
  - a transcription past the cap being refused.

**E5 Fit for a connector.**
- **The transcription switch** is read from the principal's config (E2's settings path) by a getter in `src/auth/config.ts`. `image_transcribe` and `volume_bisect` call it beside `getOpenRouterApiKey`, before reading any bytes, and refuse when it is set off; `runOcr` stays principal-free. When it is unset (the `.mcpb`, the Fly sandbox and the harnesses), both run as today. D1 sets it off on the beta.
- **Time:** `image_transcribe`'s worst case stays under 240 s for connector callers: one download attempt, and an OCR budget set from P0.2's timeout.
- **`image_read`** is refused for connector callers.
- **Schema size:** `record_search`'s schema is trimmed below 16,384 bytes only if P0.2 shows a tool missing.
- **Done when:** tests show no OpenRouter request with the switch off, unchanged behavior with it unset, and pin the time budget.

### The web tier (`apps/server/proto/web`)

**W1 Settings for the beta.**
- **A chat switch,** on by default. With it off there is no `QUEUE_URL` requirement, no grant refresher, and no session or SSE routes.
- **Admission:** one check, called by the callback and by `current_user`. With `GENEALOGY_MAX_USERS` set, it ignores the allowlist: it admits an existing unblocked user, and a new user only while there are fewer users than the cap. Unset, it reads the allowlist on every request, as today.
- **Plumbing:** a connection pool (`psycopg-pool`) for queries, which checks each connection as it hands it out, since Neon closes idle ones; and `/livez`. The grant-lock connections stay their own.
- **Uploads and downloads:** an nginx file in `apps/server/proto/eb-web/` sets `client_max_body_size 26m` and `proxy_read_timeout 600s`. The template ships no nginx file today, so nginx's 1 MB default refuses uploads.
- **Neon:** the TLS root and the DSN come from environment properties.
- **Done when:**
  - Richard's suites pass with chat on;
  - with chat off, the tier starts with no queue, runs no refresher and serves no session route;
  - a 25 MB upload passes nginx on the deployed host.

**W2 Sign-in.**
- **Users** are keyed by FamilySearch id, with a unique index. Email stays required and unique: an identity with no email, or with one another user has, is refused with a message.
- **The browser session** stays the `wb_session` cookie. With chat off it lasts 24 hours; with chat on, 30 days, as today. `/logout` ends it on the server.
- **Requests:**
  - the consent POST needs a same-origin `Origin`, and a missing or null `Origin` is refused there;
  - `/token` takes no `Origin` check, because it carries no cookie and the code and the PKCE verifier authenticate it;
  - other cookie routes keep `SameSite=Lax`, as today.
- **With chat off,** sign-in asks for no `offline_access`.
- **The FamilySearch redirect URI** is a setting, and the web tier serves its FamilySearch callback at that setting's path, `/callback` by default.
- **Claude's authorization server** runs on the Python MCP SDK's handlers (`create_auth_routes`, with `mcp` moved from the dev group into `proto-web`):
  - **Metadata:** our own, advertising client metadata documents, `none` and `S256`, with no registration or revocation endpoint. The issuer is one setting, printed byte for byte the same by both tiers' metadata.
  - **Clients:** `/authorize` checks a fixed allowlist of Claude's client documents, recorded in P0.2. Each entry sets `token_endpoint_auth_method` none, `grant_types` `[authorization_code]` and the advertised scope.
  - **Consent:** the consent page names the client and its redirect host, links the policies, states the deletion date, records the terms acceptance and refuses framing.
  - **Codes and tokens:** stored only as hashes, and the code is deleted when it is exchanged. Access tokens last up to 24 hours, with no refresh token if the probe allows it.
- **One callback** serves both flows, told apart by the signed state cookie. With chat off, it consumes the single-use state record before it calls FamilySearch; with chat on, the signed state cookie alone guards it, as today. It then stores the FamilySearch token, encrypted with Fernet as today.
  - **Admission:** with chat off, it creates a user only in the connector flow, with the terms accepted, under the admission check. It refuses a blocked user.
  - **Newcomers:** a browser with no account sees the onboarding steps.
- **FamilySearch budget,** off unless set (D1 sets it when the web environment joins): the web tier's FamilySearch calls (the code exchange and the identity read) share one small process-wide budget. With chat off, a sign-in takes both its units only once its signed state cookie matches an unused state record, and before it consumes that record; a missing, mismatched or used state is refused without touching the budget. Past the budget, the callback answers 503 "busy, try again" with the state intact, so a reload retries.
- **Done when:**
  - a test drives the connector flow against a fake FamilySearch, replaying the `/authorize` and `/token` parameters P0.2 recorded: authorize, consent, callback, token, a tool call through compose's tools tier, and the 24-hour end;
  - a `/token` request with no `Origin` succeeds;
  - a replayed callback, a used code and a cross-site consent POST are each refused;
  - an email off the allowlist is refused before launch, and no user row is written;
  - with the budget set, a callback whose state is missing, mismatched or used leaves the budget untouched;
  - with the cap set and the allowlist empty, a new user signs in through the connector flow and its cookie reaches `/api/projects`; at the cap, a new user is refused with no row written, and an existing user still signs in;
  - the metadata carries the client-document flag and no registration endpoint, and a client off the allowlist is refused;
  - the web tier's issuer equals the tools tier's `authorization_servers[0]`, byte for byte.

**W3 Project routes.** Every route is keyed by project and owner-checked, and a missing project and someone else's get the same 404. A blocked user's session is refused on every route.
- **Viewer data:** `GET /api/projects`, `/api/projects/{id}/state` with an ETag from `documents.version`, sidecars and images.
- **Uploads:**
  - the original is stored, plus the browser's text layer as `uploads/<name>.txt`;
  - content is sniffed, and HEIC and TIFF are refused;
  - a multi-page PDF with no text layer is refused;
  - at most three uploads are in flight per process.
- **The download:**
  - a zip of everything `feedback.py`'s project walk returns, with no redaction;
  - it is built one object at a time in a temporary file under `/var/tmp`, on the instance's disk (AL2023's `/tmp` is held in memory), then streamed;
  - one download runs at a time per process.
- **Feedback:**
  - `feedback.py`'s bundler, keyed by project, with at most five a day per user, counted in memory;
  - with `FEEDBACK_URL` set, the posted zip is named `feedback-<account id>-<UTC time>.zip`; the S3 key keeps today's shape;
  - with `FEEDBACK_URL` set, the route skips the S3 store and posts the zip in the envelope the Apps Script reads (`filename`, `zipBase64` and the rest), through the `forward_stored_feedback` seam, which then takes the bytes;
  - with `FEEDBACK_URL` unset, today's S3 store stays the default.
- **OpenRouter linking:**
  - PKCE, with a random state kept beside the verifier in a cookie;
  - the callback refuses a missing cookie or a mismatched state;
  - the key is stored under the same Fernet key;
  - unlinking.
- **Pages:**
  - with chat off: `/privacy`, `/terms`, and the onboarding screen, which the SPA shows a signed-out browser whose link names no project (the server never sees a link's hash, so a project link goes to sign-in);
  - the account menu, which shows the account id, and with chat off a deletion code. The code is an HMAC of the user id under the session secret, shown only there.
- **Done when:**
  - a cookie for user A cannot reach user B's project by any route;
  - an upload's text reaches `sidecar_read`;
  - a submission reaches the Apps Script copy, and nothing lands in the bucket;
  - a download larger than the instance's free memory completes on the deployed instance, and its available memory stays flat.

**W4 The browser app (`apps/web`, `packages/viewer-ui`).**
- **One build,** carried in `eb-web.zip`, reads its feature flags from `/auth/config`: chat, uploads, OpenRouter linking and feedback. A flag that `/auth/config` does not send keeps today's behavior, so chat and feedback stay on.
- **Screens:**
  - a project list and the shared viewer, with a line in the header giving the deletion date when `/auth/config` reports chat off;
  - the upload page, with pdf.js text extraction and progress;
  - the OpenRouter page, which tells users to delete the key at OpenRouter when they are done;
  - the feedback form and the download button;
  - a print-the-whole-project view in `packages/viewer-ui`.
- **Updates:** an HTTP transport polls `state` every 3 s while the tab is visible, gets 304 when nothing changed, and stops after 10 quiet minutes, leaving a Refresh button.
- **Done when:** a transport test with fake timers passes, a Fly-alpha build keeps its chat and feedback, and the acceptance run's viewer steps pass.

### Schema and deletion

**S1 Schema.** New numbered files in `apps/server/proto/sql/`, from 016:
- a unique index on `users.familysearch_id`;
- `terms_accepted_at`, `blocked_at` and the encrypted OpenRouter key on `users`;
- the connector token table (hashes, user, expiry, ended);
- the authorization-code table;
- the single-use state record.

Creating the DML-only role is a runbook step.

**Done when:** `migrate.py` applies them on compose and on Neon, their digests are pinned, and both suites pass.

**S2 Deleting and blocking one user.**
- **Deleting.** `make beta-delete-user ACCOUNT=<id> CODE=<deletion code>` refuses a wrong code. Otherwise it deletes the user's rows and current objects; the bucket's lifecycle rule removes old versions within 7 days. A blocked user, who cannot open the account menu, is deleted on a request confirmed from the email on file.
- **Feedback.** The user's feedback in Drive and their private-repo issues are found by the account id in the zip names and deleted by hand.
- **Blocking.** `make beta-block-user ACCOUNT=<id>` sets `blocked_at` and `sessions_revoked_at`.

**Done when:**
- a test deletes a seeded user and finds none of their rows or current objects, and the bucket's lifecycle configuration holds the 7-day rule;
- a blocked user's cookie is refused on the upload, download, feedback and OpenRouter routes, and their token gets 401.

## Phase 2: the plugin (`packages/engine/plugin`)

**Wave 1** shipped in PR #3852. Unless the conversation names a `projectPath`, the research router calls `project_list` first. It then continues the listed project the message names, starts a project at `newProjectPath` for a person no listed project is about, or lists the projects and asks. It also:
- says the genealogy tools are not connected, and stops, when there is no `project_list` tool: after an expired connector sign-in, or with an older desktop extension;
- ends the reply that ends its turn with the project's `projectUrl`, when a tool returned one;
- carries G4's line.

Two hosted routing tests serve `project_list` from a fixture; every other research test gets the live desktop answer.

**Reconnect fallback (if P0.2 shows no reconnect prompt inside an agent).** When `project_list` answered `hosted` in this task, the router calls `auth_status` on the main thread before the first delegation of each reply. Only when the answer carries E3's reconnect message does it call `auth_status` once more, so the door's 401 reaches Cowork on the main thread, then give that message and stop. In folder mode it makes no call. It re-runs the router's suite once.

**Done when (if built),** in the router's suite with `auth_status` served from fixtures:
- a reply whose connector session has ended, in a new task or one reopened after eight idle hours, gets the reconnect line and no delegation;
- a folder-mode test that serves `auth_status` (`loggedIn` false, `hasRefreshToken` true) delegates as today and never calls it;
- the two hosted routing tests gain an `auth_status` fixture answering a live session.

**G3 Connector tool names (after P0.2).**
- **The rule:** a route is accepted if its prefix is predictable, and both sign-in and an agent's tool call work through it.
- **The work:** add its spelling to every agent's `tools:`. Update `tests/packaging/tool-names.ts`, `agent-tool-names.test.ts`, ADR-0004, CLAUDE.md's "Dual-spelled tool names" and `docs/architecture.md`.
- **Merging:** it merges under per-skill cosmetic labels, applied after its last push.
- **If the plugin-connector route wins,** `scripts/package-plugin.mjs` gains a marketplace mode that writes the `.mcp.json` entry.
- **Done when:** `agent-tool-names.test.ts` fails on an agent missing the connector spelling, and in the dress rehearsal every agent spawns holding the connector's tools.

**G4 Hook-only rules (decided the day P0.2 item 3 is recorded).** Four ownership rows are enforced only by the hook. If the hook does not fire on connector calls, the lead chooses between:
- launching with the gap recorded;
- first moving what the documents can decide into writer-tool checks.

Either way, the research skill's first line says that without an `Agent` tool, research runs only in a Cowork task, and stops. It shipped in PR #3852.

**G5 Capture wording (with W3's uploads).** `search-external-sites`' `capture` accepts three forms: an upload's `.txt`, read with `sidecar_read`; the upload itself, to be transcribed; or the text itself. The upload wording shows only when `project_context` returns an `uploadUrl`.

**Issue #3836**, agents reading project files directly, ships as its own PR.
- **Its read block** fires only when the file is not there, and the eval harnesses keep the strict version.
- **In connector mode** every direct read misses, so #3836 is an input to the dress rehearsal. If it has not merged by then, the rehearsal records which reads missed, and the 18 December checkpoint decides whether the launch waits for it.

## Phase 3: release and operations

**D1 Environments.** P0.3's two environments, both on the shared ALB.
- **When the web environment joins, by 11 December, these environment properties:**
  - the DSNs and the bucket;
  - `FS_TOKEN_ENC_KEY`, the same on both tiers, and the session secret;
  - the issuer and the web tier's public URL, on both tiers;
  - the client allowlist and the admission allowlist;
  - the chat switch, off, and `FAMILYSEARCH_WEB_ENABLED`;
  - the FamilySearch redirect setting, at the loopback (P0.4), and the sign-in budget;
  - `PGSSLROOTCERT=/etc/pki/tls/certs/ca-bundle.crt` on the web tier: AL2023's system bundle as a file, not libpq's `system` keyword, overriding the RDS bundle its `01-web.config` pins;
  - the transcription switch, off, on the tools tier.
- **Before the dress rehearsal:** the uploads setting. **In January:** `FEEDBACK_URL` and the limits.
- **Before gate 4's sign-in:** the redirect setting moves from the loopback to the beta's https redirect (P0.4).
- **Once FamilySearch's approval is in writing:** the transcription switch goes on (gate 4).
- **On launch day:** the user cap.
- **Instance profiles:** the tools tier's from P0.3, the web tier's when it joins. Each has `AWSElasticBeanstalkWebTier`, as the handoff's tiers have, the SSM agent's managed policy, and one inline statement denying `bedrock:*` and `aws-marketplace:*`, which the beta never uses. Then both gain object access and `s3:ListBucket` on the bucket.

**D2 Monitoring.**
- **Alarms:**
  - 5xx responses and tool refusals;
  - FamilySearch 403s and 429s, which the per-call log line ties to a user;
  - the 4xx rate on `/authorize` and `/token`, and failed code exchanges.
- **Other checks:**
  - uptime checks on `/livez` (web) and `/.well-known/oauth-protected-resource/mcp` (tools);
  - an AWS budget and a Neon usage alert.
- **Runbook:**
  - a Logs Insights query that ranks users by calls in the last hour;
  - for a flood of failed code exchanges from one address: a network ACL rule on the ALB's subnets, numbered below the allow rule, denying the address the ALB appended. That is the last `X-Forwarded-For` entry on the flood's callback lines in nginx's access log; never an earlier entry, which the client wrote, an address inside the VPC, or the log's first column, which is the load balancer.

**Done when:** each alarm fires on a planted event.

**D3 Release.** `make beta-release TAG=<tag>`, run by the lead. In order, it:
1. refuses unless HEAD is the tag;
2. runs the compose smoke on the web and tools tiers;
3. applies `migrate.py` with the owner DSN;
4. deploys the tool server, then the web tier;
5. checks three things, and on a failure redeploys that environment's previous version and stops:
   - the deep checks on each instance over SSM Run Command, as the handoff's `target.py` does: `/healthz` on tools and `/api/health` on web;
   - that the protected-resource metadata names `/mcp`;
   - that an unauthenticated `POST /mcp` answers 401;
6. publishes the connector build of the plugin, with a stamped version, to the marketplace repo, and attaches its zip to the release.

**D4 Onboarding page.**
1. Add the marketplace.
2. Add the connector through the prefilled link, keeping its name.
3. Sign in.
4. Link OpenRouter.
5. Open the project from Claude's link.

The page also says:
- **Cowork tasks only.**
- **No desktop extension.** Use a Claude account on which no computer runs the desktop extension: turn it off under Settings → Extensions on each computer, or join with a second Claude account.
- **Reconnecting:** what to expect at each sitting, written from P0.2 item 6.
- **Team and Enterprise plans:** an Owner adds the connector and makes the plugin available. Email us for help.

**D5 Feedback triage.**
- **In January,** the lead creates the private repo and the second Apps Script copy, with `GITHUB_REPO` set to that repo and `NOTIFICATION_EMAILS` unset. The private repo stays off the team's board, so no board skill or script lists a private issue.
- **`/triage-feedback`** also lists the private repo's open issues, after the board's Feedback column, and works each one as it works an alpha card: the same reading, checks and verdicts. Only where a verdict lands, and what it carries, change:
  - **Backlog:** the skill files a public issue carrying the instructions alpha triage would write, with a link to the private issue in place of alpha's original-feedback block. The Drive link, the zip name and the tester's own words stay on the private issue;
  - **Fold:** its comment on the open public issue links the private issue;
  - then it closes the private issue, pointing at the public one.

  Neither public text, nor a unit test mined from a beta case, names the zip or its case folder, the account id or anyone who may be living, or quotes the tester or the bundle beyond what the fix needs. The triager approves the triage text word for word before it is posted.

**L1 Policies.** A short privacy policy and terms, published by GeneFun, Inc. at `/privacy` and `/terms`, and accepted on the consent page.

The privacy policy covers:
- what is collected, and why;
- where it is stored: the United States;
- who receives it: AWS, Neon, Google and GitHub for feedback, Anthropic, OpenRouter and Google for transcription, FamilySearch, Wikipedia, and our wiki and population host;
- that our project team of about 35, volunteers included, reads feedback, and may turn it into a public test case with living people removed;
- the July 2027 deletion, which also covers the copies the team downloaded for triage, and how to ask for deletion sooner.

The terms say:
- this is a beta, with no warranty;
- what acceptable use is;
- FamilySearch's terms apply to FamilySearch content.

## Phase 4: launch gates (18–31 January)

1. **Security reviews** as each item merges: E1, E3, W2, W3 and W4, with `/security-review` and `/code-review ultra`.
2. **The acceptance run,** on a release candidate that carries issue #3836 if the launch waits for it, with a new Claude account and a new FamilySearch account on the allowlist:
   1. install, connect and sign in;
   2. research a person, and open the project from Claude's link;
   3. upload a capture, and send feedback;
   4. start a second project, then resume the first in a new task;
   5. let the session end, reconnect and continue;
   6. open a project link in a fresh browser;
   7. receive a new release.
3. **The restore drill:** restore a deleted project from Neon's history and S3 versions.
4. **FamilySearch's approval** is in writing, and an account other than the lead's signs in through the https redirect with no bounce. Then the transcription switch goes on, and the acceptance account links OpenRouter and transcribes a FamilySearch page image, by its imageId, within E5's time budget, and an uploaded page image unless uploads were cut.
5. **On launch day,** admission switches from the allowlist to the user cap. Then a FamilySearch account off the allowlist signs in and opens its project from Claude's link.

## Before July

The purge, rehearsed on a copy first:
1. Publish a marketplace release with no connector.
2. Switch off sign-in and `/mcp`.
3. Delete the Neon project, the bucket with every version, the log groups, each of the private repo's issues and then the repo (GitHub keeps a deleted repo restorable for 90 days, but not a deleted issue; an org owner first allows issue deletion), and the beta's bundles in the Drive folder, found by name, emptied from the Drive trash too. Undeploy the second Apps Script copy and revoke its GitHub token. Every member deletes the beta zips they downloaded, the feedback-case folders made from them, whose names carry the account id, and the private repo's notification emails.
4. Delete the hand-made ALB rules and set the default action to a fixed 404, then terminate both environments and the ALB.
5. Keep the domain through July 2028, pointed at a static end page.

## Changes to the handoff's code

The team makes each of these, from the issues under "Who builds what". Each is additive and keeps the handoff's behavior as the default, so Richard reworks nothing. Before each one, check for open PRs on the same files, keep the PR small, and ask Richard to review it. Each change also lists its new settings in the handoff plan's step 9 or 15, unset there; E1 and W1 add `/livez` there as a health path that touches no store.
- **Done:** PR #3852 added `project_list` (`src/tools/project-list.ts`, `src/server.ts`, `src/tool-schemas.ts`, `manifest.json`, `dev/smoke-calls.ts`, `dev/smoke-http.ts` and the stores) and the research router's project step, which `eb-worker.zip` carries. On the handoff's tools tier, `project_list` lists the worker's project. A worker bundle with the router's project step needs a tools tier that has `project_list`, so tools deploys first.
- **Web tier,** `apps/server/proto/web/` (`app.py`, `auth.py`, `feedback.py`, `spa.py`): W1, W2 and W3. Chat on stays the default.
- **Web bundle,** `apps/server/proto/eb-web/`: the nginx file.
- **Schema,** `apps/server/proto/sql/`: S1's new files, and `test_proto_migrate.py`'s pinned digests.
- **Dependencies,** `apps/server/pyproject.toml`, `apps/server/uv.lock` and `apps/server/proto/web/requirements.txt`: `mcp` and `psycopg-pool` join `proto-web`. `mcp` brings nine packages `proto-web` lacks: `httpx-sse`, `jsonschema` with `attrs`, `jsonschema-specifications`, `referencing` and `rpds-py`, `pydantic-settings`, `pyjwt` and `sse-starlette`. Before W2 merges, Richard checks every package the PR adds to `requirements.txt`, `psycopg-pool` included, against his build runner's package curation.
- **The tool server,** `packages/engine/mcp-server/`:
  - `src/`: `http-server.ts`, `http.ts`, `server.ts`, `hosted-config-env.ts`, `types/auth.ts`, `auth/principal.ts`, `auth/config.ts`, `auth/refresh.ts`, `store/pg-s3-project-store.ts`, `utils/fs-fetch.ts`, `utils/http.ts` and `utils/ocr.ts`, with the tools `login`, `logout`, `auth-status`, `collections-search`, `image-read`, `image-transcribe` and `volume-bisect` and the three project tools, for E1–E5;
  - `dev/smoke-http.ts`, `dev/smoke-calls.ts`, the Makefile's `engine-smoke-http` target, the compose tools service and `apps/server/proto/tools/README.md`, for E1's smoke and door.
- **The browser app,** `apps/web` and `packages/viewer-ui`: W4.
- **The plugin,** which `eb-worker.zip` carries: G3's spelling, G5's wording and the reconnect fallback.
- **If chosen or needed:** G4's writer-tool checks, in the writer tools they touch, and E5's `record_search` trim (`src/tools/record-search.ts`).

## Who builds what

The lead does the items "What this is" names. The team builds the rest from these issues; an issue labelled `senior` needs a senior developer. Each issue's "Blocked on" line orders them. Everything likely to go wrong only live, against Cowork, Claude, FamilySearch, OpenRouter or the deployed host, is due by 14 December, for the dress rehearsal before the holidays; the unit-testable rest is due 31 December.

| Item | Issue | Level | Due |
|---|---|---|---|
| S1 Schema | issue #3977 | junior | 20 Nov |
| E1 One front door | issue #3984 | senior | 7 Dec |
| E2 Project tools: links, uploads, settings | issue #3978 | junior | 7 Dec |
| E2 Project tools: the connector's `project_list` | issue #3991 | senior | 14 Dec |
| E3 Session end and wording | issue #3995 | senior | 14 Dec |
| E4 Limits: process-wide | issue #3979 | junior | 31 Dec |
| E4 Limits: per user | issue #3999 | senior | 31 Dec |
| E5 Fit for a connector | issue #3996 | junior | 14 Dec |
| W1 Settings: chat switch, admission, `/livez` | issue #3985 | senior | 30 Nov |
| W1 Settings: pool, TLS, nginx | issue #3980 | senior | 7 Dec |
| W2 Sign-in: users, sessions, state, redirect, budget | issue #3992 | senior | 7 Dec |
| W2 Sign-in: Claude's authorization server | issue #3997 | senior | 14 Dec |
| W3 Project routes: viewer data | issue #3981 | senior | 7 Dec |
| W3 Project routes: uploads and download | issue #3987 | senior | 14 Dec |
| W3 Project routes: feedback | issue #3986 | junior | 31 Dec |
| W3 Project routes: OpenRouter linking | issue #3988 | senior | 14 Dec |
| W3 Project routes: policy pages and account data | issue #3993 | junior | 14 Dec |
| W4 Browser app: flags, project links, list, polling | issue #3994 | junior | 14 Dec |
| W4 Browser app: print view | issue #3982 | junior | 31 Dec |
| W4 Browser app: onboarding (D4), account menu, upload, OpenRouter, download | issue #4001 | junior | 31 Dec |
| S2 Deleting and blocking one user | issue #4000 | senior | 31 Dec |
| G3 Connector tool names | issue #3989 | junior | 14 Dec |
| G5 Capture wording | issue #3990 | junior | 31 Dec |
| D3 step 6: the plugin's connector build and marketplace layout | issue #3983 | junior | 14 Dec |
| Reconnect fallback, if P0.2 calls for it | issue #4002 | senior | 14 Dec |
| After launch | issue #4003 | senior | after launch |

P0.2 is issue #3529. G4's writer-tool checks get an issue only if the lead chooses them; E5's `record_search` trim is in issue #3996, conditional on P0.2.

## After launch (February–March 2027)

The team makes these too, from one issue, with Richard reviewing:
- **The worker's half of the one door.**
  - The worker mints a per-attempt token, stamps its hash on the turn with `STAMP_BEARER_SQL`, and puts only that token in `mcp.json`. The door admits it as it admits today's stamp, on its open turn and project, then loads the FamilySearch token stored for the turn's project owner and applies E3's session-end hook, as it does for a connector token.
  - The tools tier gets `FS_TOKEN_ENC_KEY` and `SELECT` on `familysearch_tokens` and `users`.
  - The worker loses its grant decryption, the attempt-lock connection, the start gate and its wait, and `grant_lock_lost`. One check before the CLI starts confirms the grant has not ended, and the run stops as `signin_required` when a FamilySearch tool's error carries the hook's reconnect message; the same words inside a tool's data never stop it.
- **No refresh anywhere.** `grant_refresh_loop`, `refresh_tokens`, the refusal classifier, the marker and `offline_access` go. The message route checks the grant before queuing. A patron signs in again when FamilySearch ends the session, as a beta user does; W2's chat-on and chat-off difference for `offline_access` disappears, and so does the Differences table's "No token refresh" row.
- **Done when:**
  - U3's kill run passes without `--expect-grant-refresh`, whose flag and check in `apps/server/proto/turn.py` go with the refresher;
  - U4's compose check passes, its smoke seeding an encrypted FamilySearch token for the stamped turn's user;
  - a test against real Postgres shows two patrons' open turns each reaching FamilySearch with their own stored token.

## Timeline (proposed)

| Dates | Work |
|---|---|
| 26 Oct – 8 Nov | Phase 0 |
| 2 Nov – 14 Dec | The issues due by 14 December under "Who builds what", the sign-in chain first. G3 after P0.2; G4's checks, if chosen; the reconnect fallback, if P0.2 calls for it |
| By 11 Dec | The web environment joins the ALB, with D1's settings and profiles; P0.4's bounce |
| 14 – 18 Dec | The first live sign-in in Cowork, then the dress rehearsal |
| 2 Nov – 31 Dec | The issues due 31 December, all unit-testable |
| 4 – 17 Jan | The rest of D1; D2–D5; L1 |
| 18 – 31 Jan | Phase 4 |
| 1 – 7 Feb | Launch |

After the holidays the team is a skeleton crew, so everything likely to go wrong is tested before them.

**The dress rehearsal, 14–18 December:**
- deploy both tiers to the skeleton;
- install the connector build of the plugin from a test marketplace, on a separate Claude account, and check that a version bump reaches it;
- in a fresh Cowork task, sign in and run one research session from `init-project` to a proof summary, with issue #3836 merged if it is ready;
- let the session end, and reconnect;
- open the project from Claude's link in a fresh browser, upload a 25 MB capture, and download a project larger than the instance's free memory;
- link OpenRouter;
- record agent spawns, hook denials, approval prompts, timeouts and missed direct reads on issue #3529.

A plugin fix it turns up goes in a small follow-up PR.

**Checkpoint, 18 December.** Cuts are taken that day, while the whole team is here, if any of these hold:
- an issue due by 14 December has not merged (the reconnect fallback only if P0.2 called for it);
- the dress rehearsal has not passed, for a reason other than the reads issue #3836 covers;
- G4's choice is not made, or the writer-tool checks it chose have not merged;
- FamilySearch has not answered.

The lead also decides that day whether the launch waits for issue #3836, and whether to hold the date.

**Checkpoint, 18 January.** The same, if an issue due 31 December has not merged, if D1–D5 or L1 is not done, or if acceptance steps 1–3 fail on the release candidate installed from the marketplace. If the launch waits for issue #3836 and it has not merged, the lead decides that day whether to hold the date.

**Cut list, in order:**
1. The upload page becomes a bare file form that still runs pdf.js.
2. The feedback form becomes an email address.
3. Polling becomes a Refresh button.
4. Uploads move to March. The uploads setting goes off on both tiers, and pasting the text is the launch's capture path.

**Not cuttable:** sign-in, isolation between users, the policies, FamilySearch's approval and the connector's tool names.

## Risks

- **The probe.** Any of these would change G3, G4, D4, E3 or E5:
  - connector names that cannot be predicted;
  - a hook that does not fire;
  - approval prompts on every write;
  - no reconnect prompt inside an agent;
  - limits below the documented 240 s and about 150,000 characters.
- **The shared load balancer.** Its rules and idle timeout are set by hand outside Beanstalk. Rebuilding or terminating an environment needs the rules that forward to it removed and the default action pointed away first, and both restored afterwards; the runbook records the steps.
- **Two languages.** Node decrypts what Python encrypts. A shared test vector pins the format, and both tiers need the same key.
- **One instance per tier.** Immutable deploys, the 300 s drain, the uptime alarms and the release's rollback limit the damage.
- **Open sign-up through one key and one address.** The concurrency cap, the 429 pause, the shared budgets, the per-call log line and the manual block are launch gates.
- **Richard's path.** E1 changes the door his worker uses. It keeps admitting today's worker until the worker's half lands after launch.
- **Cost.** About $52–75 a month at 100–1,000 users: the earlier estimate of $36–59, plus about $16 for the second instance (list prices, not re-checked). Neon compute is the largest line. Transcription is each user's own cost.
