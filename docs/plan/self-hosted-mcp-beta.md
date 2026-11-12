# Self-hosted remote MCP server: a limited beta

**Status:** Draft (2026-11-05). Shipped: `project_list`'s desktop and worker halves (PR #3852), E1's one front door (PR #4225), S1, W1, W2's first half (users by FamilySearch id, 24-hour sessions with the chat off, single-use state, the redirect setting and the sign-in budget; PR #4292), W3's viewer data, uploads, download, OpenRouter linking, the policy routes (their text is L1) and account data, E2's settings and the connector's `project_list`, E4's process-wide and per-user limits, E5's direct reads (issue #4311; its live connector check is owed), the connector plugin build, the probe's reconnect flags, G5's capture wording (PR #4387), D1's stack, and S2's block and delete targets. The rest is listed under "Who builds what". The live sittings measured the reconnect design under "When a FamilySearch session ends" (P0.2 items 10 and 11). FamilySearch's approval, as any app on its API needs, comes before launch.

## What this is

- A limited beta of the research assistant as a remote MCP connector, for people the lead invites. They install the plugin, connect it from the plugin's Connectors tab and sign in with FamilySearch. Nothing else is installed locally.
- MCP App cards show the research in the conversation ([the MCP App plan](mcp-app-viewer.md)). There is no browser viewer.
- It runs two of the three tiers in [the handoff plan](familysearch-handoff.md): the Python web tier with chat off, and the MCP tool server. There is no worker and no queue, because Claude runs in the user's own Claude app.
- The web tier serves sign-in, a few plain pages, uploads, the download and the policies.
- It runs on the lead's server, `malachi`, in Docker, with Postgres and MinIO, reached through Tailscale Funnel.
- A demo comes first, when it is ready. The beta starts when this launches and ends when FamilySearch hosts the open beta on its platform. There are no fixed dates. When it ends, everything is deleted and nothing migrates.
- The beta's code is the handoff's code. Every remaining difference is listed under "Differences from the handoff", with its reason.
- The lead's two agents build the remote server and the MCP App. The team builds the rest from issues. Richard reviews every change to the handoff's code. Each change is additive and keeps the handoff's behavior as the default, except where the handoff's alignment section says.
- The lead does what needs his accounts, his server or GeneFun: FamilySearch's approval (P0.1), the sign-in redirect (P0.4), the live sittings, the policies (L1), every decision and the final deletion.

## Decisions (lead, 2026-10-25 to 2026-11-12)

| Topic | Decision |
|---|---|
| Shape | Two of the handoff's tiers: the Python web tier, chat off, and the MCP tool server. No worker, queue or model gateway. |
| Host | `malachi`, in one standalone compose file, until FamilySearch hosts the open beta. |
| Database and storage | Postgres and MinIO in that compose stack, with their data under `/home/data`. |
| Data at rest | This is a beta, not production: nothing promises durability or encryption at rest, and `/home/data` is one unencrypted disk. FamilySearch tokens and OpenRouter keys are still encrypted by our code. Users are told not to store information about living people. |
| Schema | The handoff's numbered files in `apps/server/proto/sql/`, plus new numbered files for the beta's tables. One schema for both. |
| Sign-in | Claude's sign-in server lives in the web tier, on the Python MCP SDK's handlers, and shares one FamilySearch callback with browser sign-in. |
| Re-sign-in | Users sign in again when their FamilySearch session ends. Nothing refreshes a FamilySearch token on the server. |
| Tokens | One long connector token lifetime with no refresh token (lead, 2026-11-12). Sitting 2 held one for about 4 days. 30 days proposed; the length is the lead's call. |
| Front door | One door on the tool server. Every caller presents our own token, and the door loads that user's stored FamilySearch token and OpenRouter key. |
| Projects | `projectPath` carries an id the server mints. The user who first writes to it owns it. |
| Testing and deploys | One server and no test server. Everyone tests their own branch in their own Claude account first: skills, agents and hooks through their own plugin on the connector, tools through the branch's `.mcpb` in a Cowork task with a folder, cards in `make viewer`'s tab. What exists only on the connector is first tried on this server, so only the lead deploys, backs up first, undoes a bad deploy by redeploying the previous commit, and deploys nothing during the demo or its rehearsals. A test server comes when an hour's breakage would hurt users the lead cannot message. Recipes: `DEVELOPMENT.md`, "Testing a change before it reaches anyone". |
| UI | MCP App cards and a case file, in one connector named exactly "Genealogy Research". |
| Surface | claude.ai and Desktop Chat are the primary surfaces, because project data lives on the server and nothing sits on the user's disk. Cowork is no longer tested. An ordinary chat runs the plugin's agents and hook, measured in P0.2 item 12; an Incognito chat runs neither, and what research it should offer is undecided. |
| Sign-up | An allowlist the lead keeps. Each user needs a FamilySearch account whose email no other user has. Removing an email does not end a connector token; one SQL update does, if it is ever needed. |
| Web pages | Plain pages from the web tier. No SPA in the beta. |
| Uploads | Plain files, on a plain upload page: the original, plus a PDF's own text when the browser finds a text layer. Claude reads or transcribes them with existing tools. |
| Transcription | On a key the lead seeds per user with `make malachi-openrouter`. `OPENROUTER_LINKING_ENABLED` stays off, so only seeded users can transcribe. Until FamilySearch's approval is in, only the lead's own row is seeded. Users linking their own keys is kept for the open beta. There is no switch: all approvals come before launch. |
| Feedback | Users email the lead with the conversation pasted in, because the server stores only what the tools saved. `make malachi-export` pulls out their project. |
| Download | A zip of the project's files, linked from the signed-in page. |
| Retention | Everything is deleted when the beta ends, sign-ins and OpenRouter keys included. Nothing is migrated. |
| Settings | One env file on `malachi`, mode 600, outside the repo. |
| Limits | Per user, 4 calls at a time and a pause when FamilySearch answers 429. One shared FamilySearch budget and a transcription cap. A blocked user is refused at the door. |
| Plugin | One install (lead, 2026-11-12): the plugin's `.mcp.json` names the `Genealogy Research` server, so skills, agents, hook, connector and cards arrive together, with one connection for every surface (P0.2 item 14). A hand-installed zip for the demo and the first users, and a GitHub marketplace if the beta grows. |
| Policies | A short privacy policy and terms from GeneFun, Inc., in place before the first invited user. |
| Other deployments | The desktop extension, the Fly-hosted alpha, the handoff's chat screens and Electron keep running through the demo, with fixes only and no new features. The lead decides again after it. |
| Older extensions | Not supported. The research router needs `project_list`; without it, the router says the genealogy tools are not connected and stops. |
| Client | The server stays client-neutral, so a second client can use it. |
| One server | The public connector server and the worker's tool server stay as close to identical as possible: one `createServer`, with any difference at the door or named in this plan. |

## What does not change

- The desktop extension (`.mcpb`) and its local store, used by developers, genealogists and both eval harnesses.
- The Fly-hosted alpha (`apps/server/app`, E2B sandboxes), `apps/web`, `packages/viewer-ui` and Electron. Nothing is deleted.
- The handoff's worker, queue and chat routes, and its behavior with chat on. The beta switches the chat features off; it does not remove them.
- The plugin's agents and skills, apart from the router's changes, G5's capture wording, and E3's and E5's agent lines.

## Architecture

Funnel sends `https://malachi.taild68f1b.ts.net/` to 127.0.0.1:8006, where an nginx edge is the only published service. `/wiki` and `/pop-stats` keep their own Funnel mappings and do not pass through the edge.

| Paths on the edge | Goes to |
|---|---|
| `/healthz` and `/api/health` (the deep checks) | A fixed 404 |
| `/mcp`, `/.well-known/oauth-protected-resource/mcp`, and `/img` (token in the query) with the MCP App's fold | Tool server |
| Everything else: `/`, `/api/*`, `/auth/*`, `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, the consent page, `/callback`, `/privacy`, `/terms`, `/upload/*`, `/livez` | Web tier |

**A connector tool call:**
1. **The token.** Claude sends our token to `/mcp`. The door looks up the token's sha256 in the connector token table. An unknown, expired or ended token, or a blocked user, gets 401 with `WWW-Authenticate`.
2. **The principal.** The door builds the `bearer` principal from the user's id, stored FamilySearch token and OpenRouter key. Both are decrypted from the web tier's Fernet ciphertext.
3. **The project.** The door parses the body before the transport and refuses a batch. A `projectPath` must name a project the user owns, or a fresh id from `project_list` that nobody has written to. One store is bound to it, and the first write records the owner.
4. **Dispatch.** The per-user cap applies, `createServer(principal)` dispatches, and one log line records the user, the tool and any FamilySearch status.

**Signing in.** Adding the connector sends the user through the web tier:
- the consent page names the client, links the policies and says everything is deleted when the beta ends;
- FamilySearch's PKCE flow returns to `/callback`;
- the callback admits the user under the allowlist, stores the FamilySearch token, and issues our code to Claude.

**When a FamilySearch session ends.** The connector stays alive:
- the door checks only our connector token, so tools that need no FamilySearch token keep working, and so do the cards;
- a FamilySearch call answers 401, and the tool returns a message with a sign-in link, over HTTP 200;
- the user opens the link, signs in, and says "continue" in the same task. `store_grant` replaces the token, and the door reads it on the next call.

A 401 from the door itself brings up Claude's "Reconnect a connector to keep using it" card in the conversation: one click and a browser approval sign in again, and the open conversation continues (P0.2 item 11, seen in Desktop Chat). Even so, nothing answers 401 at the door because a FamilySearch session ended.

**Data.**
- **Postgres.** The web and tool tiers each use a DML-only role. `migrate` runs with the owner role and then grants that role its tables.
- **MinIO.** One bucket, on the compose network, with no published port.
- **Secrets.** Generated once into the env file and kept across deploys. Changing `FS_TOKEN_ENC_KEY` makes the door answer 401 to every user.

## Differences from the handoff

| Difference | Why |
|---|---|
| No worker, queue, model gateway or chat routes; the web tier runs with chat off. | Claude runs in the user's own Claude app and calls the tool server itself. |
| With chat off, sign-in asks for no `offline_access`, the callback stores no refresh token, and only the connector flow creates users. With chat on, all three work as today. | Nothing refreshes a FamilySearch token, and users sign up through Claude. |
| With chat off, the browser session lasts 24 hours, each sign-in consumes a single-use state record, and `/` serves a plain page. With chat on, all three stay as today. | A beta user starts from Claude, not from a web app. |
| One public tool-server path, not one reachable only from the worker. | The beta has no worker. |
| A connector names its project in `projectPath` and sends no claim fence. The worker sends its project header and the fence. | Claude cannot set headers, and only the worker has attempts to fence. |
| Docker compose on one server, with an nginx edge and an env file, where the handoff's platform has its own deploy, logging and secrets. | The limited beta runs on the lead's server. |
| MinIO instead of S3, with path-style addressing. | The store already takes an endpoint, and its conformance suite runs on MinIO. |
| The web tier budgets its own FamilySearch sign-in calls, off unless set. | No platform edge sits in front of it. |
| Keys seeded per user, not an operator key. | The door never hands a connector the operator's key. |
| Connector-only limits: Claude's per-call budgets, the shared FamilySearch budget, 4 calls at a time per user. | Only connector traffic shares one key and one address. |
| No token refresh. | Users sign in again when FamilySearch ends the session. |
| The plugin comes from a zip or a marketplace, not the worker's bundle. | Claude installs plugins that way. |
| The final deletion, GeneFun's policies and the onboarding page. | A limited beta from GeneFun, Inc. |

## Phase 0: gates

**P0.1 Approval.** FamilySearch's approval is tracked privately and comes before launch. Give Richard the list under "Changes to the handoff's code".

**P0.2 The connector probe (issue #3529).** A dev-only server, `dev/probe-connector-server.ts`: stub tools under the real names and schemas, its own sign-in, no credentials and no store. Run it in a zellij pane on `malachi`, on the root slot, before the edge binds 8006.

| Item | Result so far |
|---|---|
| 1. Tool prefix | It comes only from the connector's name. Under "Genealogy Research", agents get their tools; under any other name they spawn with only `Read`. |
| 2. Agents and approvals | Agents work under that name, in claude.ai and Desktop Chat too. In Desktop Chat, "Always allow" chosen at a prompt does not save; set on the connector's page it does, and it reaches agents, new conversations, a Desktop restart and a reconnect. Connecting it again from the plugin's Connectors tab after deleting it resets approvals. Still to measure: whether the hook's `permissionDecision: "allow"` removes the prompt, and an org account. |
| 3. Hook | The `PreToolUse` hook fires on connector calls. |
| 4. Limits | Through Funnel, in Desktop Chat: a call times out after 230 s (120 s finished, 240 s did not). A 40,000-character result reaches the model whole; at 100,000 only a 2 KB preview does and the rest goes to a file the model reads with a shell; at 160,000 the model gets an error and the file. |
| 5. Tool delivery | Every advertised tool arrives on a fresh add. |
| 6. Sign-in | Recorded: Claude's client document, the `/authorize` and `/token` parameters, and that it accepts a grant with no refresh token. Not measured: whether a sign-in started in one Claude account can finish in another. If it can, report it to Anthropic, and the launch decision goes to the lead. |
| 7. Folder access | `Read` cannot see the project folder. `search-images` and `search-hints` reach staged results through `sidecar_read` on the connector (2026-11-08), which asks for approval like any tool. |
| 8. Updates | Not measured: installing a newer zip over the old one, on a second Claude account. |
| 9. PDF text | Not measured: three real browser-saved Ancestry captures through pdf.js. |
| 10. Reconnect | With a live connector token and an expired FamilySearch session, the tools stay, the message and its link reach the user unchanged from the main thread, from an agent and in a new conversation, and "continue" works in the same conversation on the same token. The link is not clickable in a Desktop Chat reply, even in plain prose. Once, in Desktop 5.1231, Claude told the user to open it only if the address was their own server, partly because the stub's answers looked like a test connector. |
| 11. Long token | Holds: a token with no refresh token worked about 4 days later, through idle days and a Desktop update, in the open conversation and a new one. Claude sends an expired token, so the door decides expiry. When a token dies, a "Reconnect a connector to keep using it" card appears in the conversation (seen in Desktop Chat, 5.1231); one click and a browser approval sign in again, and the open conversation continues with its approvals kept. With a refresh token, Claude refreshes silently, in the open conversation, in an agent and in a new one. |
| 12. Surfaces | An ordinary chat at claude.ai or in Desktop is a cloud session from its first call (`CLAUDE_CODE_ENTRYPOINT=remote_cowork`), with the account's plugins synced, so the plugin's agents spawn on the first message (3 of 3 at claude.ai) and the hook binds; no conversation moved. An Incognito chat at claude.ai is a plain chat: no shell, no `Agent` tool and no hook, and the research skill declines. Cards draw on all three and in the iPhone app, which lists the connector but shows no plugin. |
| 13. Door refusals | Measured; the MCP App record's **Door refusals** block has each cell. A 400 keeps our message. On a 403 the host replaces it everywhere, and it reads as a firewall block. On a 503 the model's path drops it, while the card's call keeps it inside the error string. The connector works afterwards with no new sign-in. So on the connector path a `tools/call` refused for someone else's project, or by a failed lookup, is a tool error carrying our message (lead, 2026-11-12); a request with no tool call keeps its 403 or 503, a 400 is unchanged, and 401 stays HTTP. |
| 14. One install | Works. Connected from the plugin's Connectors tab, the `.mcp.json` server becomes an ordinary account connector (Web, Custom): it keeps the `mcp__Genealogy_Research__` names, agents spawn and cards draw at claude.ai and in Desktop Chat, one connection covers every surface including the phone, and it has the usual connector switch, which stays off in new conversations until switched back on. claude.ai labels its card rows "Unverified" (tooltip: "Custom · Not verified by Anthropic" and the host); Desktop shows no badge, and a hand-added connector showed none at claude.ai on 2026-11-08, so the cause is not separated from a claude.ai change. After the old connector was deleted, connecting through the plugin at the same URL kept its sign-in, so the real connector's first connection must show a fresh one. |
| 15. Server instructions | They are not in the model's context before a conversation's first tool call on any surface, and it has them after that. In Incognito the host attached them to the first tool result, and the model once withheld them as embedded text. A first research message calls `project_list` first at claude.ai and in Desktop Chat; in Incognito the research request called nothing, while the plan request called `project_list` first. A rule carried in a tool's answer only reaches a model that calls that tool. |

**When each runs:** sitting 1 ran on 2026-11-08 and sitting 2 on 2026-11-12, in Claude
Desktop 4.23118 and 5.1231. Items 6, 8 and 9 run before the first invited user.

**Done when:** each item has a recorded result in a comment on issue #3529.

**P0.3 The stack on `malachi`.** See D1.

**Done when:** `make malachi-check EDGE=off REACH=1` passes on `malachi`, and by hand, from the tools container with `BROWSER_USER_AGENT`, FamilySearch's hosts answer and an invalid code posted to ident's token endpoint gets FamilySearch's `invalid_grant`, not an Imperva block.

**P0.4 The sign-in redirect.** `FS_REDIRECT_URI` (W2) names it, the public URL plus `/callback` by default. Tracked privately, as P0.1 is.

**Done when:** an account on the allowlist signs in, an email off it is refused, and FamilySearch accepts an authorize request with no scope.

## Phase 1: shared code

### The tool server (`packages/engine/mcp-server`)

**E1 One front door.** Shipped in PR #4225.

**E2 Project tools.**
- **`project_list` for a connector (issue #3991).**
  - The door binds a store whose `listProjects()` names the projects the user owns, newest first, plus one fresh `/proj_<16 hex>` path, and which serves those projects' reads.
  - The list is bounded, and each entry's fields are cut short, so one `project_list` call cannot exhaust the tool server.
  - A cut-short list says so, so the router does not conclude a project is missing.
- **A fresh `/proj_` id** answers `no_project`, not "projectPath does not exist".
- **`projectUrl` goes.** `project_create`, `project_context` and `project_list` return no viewer link. `project_context` lists uploads and returns an `uploadUrl` when the tools tier's public-URL and uploads settings are both set.
- **A 16 MiB cap on a project document,** refused on write with a readable message, because one far larger document can kill a Postgres backend under a 2 GiB limit.
- **Done when:** `project_list` → `person_read` → `project_create` builds a project the caller owns and the next `project_list` returns; a user who owns two projects gets both plus one fresh path; another user's project is never listed; a fresh `/proj_` path answers `no_project`; a list past its bound says it was cut.

**E3 Sign-in link and wording (issue #3995).**
- **No ending step.** Nothing ends a connector token because of a FamilySearch 401.
- **The message.** A connector branch in `rejectedTokenMessage` gives a link to `<webPublicUrl>/auth/familysearch/login`, addressed to the user, with no stop order. `HOSTED_REAUTH_INSTRUCTION` stays for the worker, whose text `turn.py` and `worker/options.py` match.
- **`login`, `logout` and the missing-OpenRouter-key message** are worded by `principal.surface`, and `login` returns the same link.
- **`project_context`** carries `signInUrl` when the session has ended, from a `GET /platform/users/current` memoised briefly, so the next turn shows the link even if an agent's summary lost it. `docs/specs/project-context-tool-spec.md` changes with it.
- **`auth_status`,** for connector callers, reports the account id and checks the session with the same `GET`.
- **Sites that miss the message today:** `collections_search`'s bare 401, `match-by-id`'s 403 wording, and `rank_search_matches`, which should rethrow a rejected token.
- **Agents.** `search-records`' instructions tell it to replace the tool's message with "type `login`" (in sitting 1 it relayed the link unchanged), and `init-project` with "log in, and stop"; they relay it instead. `search-hints` leaves an item as it is on a sign-in message, so a lapsed session is not recorded as an inaccessible source. Wording follows sitting 1. Each edit owes `make eval-skill` or a senior's `eval-cosmetic-skip` label.
- **Comments.** Five still cite the dropped session-end rule: `src/auth/principal.ts`, `src/http-server.ts`, `src/store/pg-s3-project-store.ts`, `tests/utils/fs-fetch.test.ts` and `tests/http/http-server.test.ts`.
- **Done when:** tests pin each wording, and a dead token gives the link at every site above.

**E4 Limits.**
- **Process-wide:** shipped, off unless set.
- **Per user, for connector callers:** shipped (issue #3999). 4 calls at a time, and a pause for `Retry-After` when FamilySearch answers 429. A call over the cap waits; it is not refused.
- **Blocking:** shipped. `blocked_at` is checked at the door.
- **Done when:** one user's limits leave another's untouched, a planted 429 pauses only its user, and 12 parallel calls from one user all complete, with no more than 4 running at once.

**E5 Fit for a connector (issue #3996).**
- **Time:** `image_transcribe`'s worst case for a connector caller stays under the per-call limit P0.2 item 4 measured — 230 s, 2026-11-08: one download attempt, and an OCR budget set from a single 180 s overall budget that starts when the tool is entered.
- **`image_read`** is refused for connector callers, and `docs/specs/image-read-spec.md` says so.
- **The image cap** is keyed per user, so a connector call that names no project cannot spend a film's cap for everyone.
- **`TRANSCRIPTION_ENABLED` goes,** with its plumbing and its line in the handoff's step 9.
- **Direct reads (issue #4311), merged; one live connector session still owed.** `search-full-text` reads one hit with `sidecar_read`, and `translation` reads an upload with `image_transcribe` and `sidecar_read`; `Read` stays only for a path outside the project. The direct-read lint now flags a read of a `results/` ref. CI cannot show the new grants bind, so issue #4311 stays open until a connector session shows each agent's new tool call return a `tool_result`.
- **Done when:** tests pin the time budget, the refusal and the per-user cap, and `git grep -E 'TRANSCRIPTION_ENABLED|transcriptionEnabled' -- ':!docs/plan/self-hosted-mcp-beta.md'` returns nothing.

### The web tier (`apps/server/proto/web`)

**W1 Settings for the beta.** Shipped: the chat switch, admission (the allowlist; `GENEALOGY_MAX_USERS` stays unset), `/livez`, a checked connection pool and the TLS root.

**W2 Sign-in.**
- **Users** are keyed by FamilySearch id, with a unique index. Email stays required and unique: an identity with no email, or with one another user has, is refused with a message.
- **The browser session** stays the `wb_session` cookie. With chat off it lasts 24 hours; with chat on, 30 days, as today. `/auth/logout` ends it on the server, with every other session the user holds and their connector tokens, so signing out also disconnects Claude until the user reconnects, from the Reconnect card in the conversation or under Customize → Connectors.
- **Requests:**
  - the consent POST needs a same-origin `Origin`, and a missing or null `Origin` is refused there;
  - `/token` takes no `Origin` check, because it carries no cookie and the code and the PKCE verifier authenticate it;
  - other cookie routes keep `SameSite=Lax`, as today.
- **The FamilySearch redirect URI** defaults to `<public URL>/callback`, and `FS_REDIRECT_URI` overrides it.
- **Claude's authorization server (issue #3997)** runs on the Python MCP SDK's handlers (`create_auth_routes`, with `mcp` moved from the dev group into `proto-web`):
  - **Metadata:** our own, advertising client metadata documents, `none` and `S256`, with no registration or revocation endpoint. The issuer is one setting, printed byte for byte the same by both tiers' metadata.
  - **Clients:** `/authorize` checks a fixed allowlist of Claude's client documents, recorded in P0.2. Each entry sets `token_endpoint_auth_method` none, `grant_types` `[authorization_code]` and the advertised scope.
  - **Consent:** the consent page names the client and its redirect host, links the policies, says everything is deleted when the beta ends, records the terms acceptance and refuses framing.
  - **Codes and tokens:** stored only as hashes, and the code is deleted when it is exchanged. One constant sets the token's lifetime.
- **One callback** serves both flows, told apart by the signed state cookie. With chat off, it consumes the single-use state record before it calls FamilySearch; with chat on, the signed state cookie alone guards it, as today. It stores the FamilySearch token, encrypted with Fernet as today. With chat off it creates a user only in the connector flow, with the terms accepted, under the allowlist. A plain browser sign-in by an existing user replaces their FamilySearch token and leaves their connector token alone. It refuses a blocked user.
- **FamilySearch budget (issue #3992),** off unless set: the code exchange and the identity read share one small process-wide budget. A missing, mismatched or used state is refused without touching it. Past the budget, the callback answers 503 "busy, try again" with the state intact.
- **Done when:**
  - a test drives the connector flow against a fake FamilySearch, replaying the parameters P0.2 recorded: authorize, consent, callback, token, and a tool call through the tools tier;
  - a `/token` request with no `Origin` succeeds;
  - a replayed callback, a used code and a cross-site consent POST are each refused;
  - an email off the allowlist is refused, and no user row is written;
  - with the budget set, a callback whose state is missing, mismatched or used leaves the budget untouched;
  - the metadata carries the client-document flag and no registration endpoint, and a client off the allowlist is refused;
  - the web tier's issuer equals the tools tier's `authorization_servers[0]`, byte for byte;
  - with chat off, an existing user's plain browser sign-in replaces the FamilySearch token, leaves the connector token unchanged, and the next tool call uses the new token;
  - after `/auth/logout`, a tool call with that user's connector token gets 401 from the tools tier.

**W3 Project routes.** Shipped: uploads, the download, OpenRouter linking (off on `malachi`), the policy routes, the account data with its deletion code, and the viewer data routes, of which the beta uses only `GET /api/projects`, for W4's list. Project routes are keyed by project and owner-checked.

**W4 Plain pages (issue #4001).** Server-rendered pages with chat off, following `policies.py`:
- **`/`, signed out:** the onboarding steps in D4.
- **`/`, signed in:** the FamilySearch account's name, "go back to Claude and say continue", the account id and deletion code, and the user's projects, each with upload and download links.
- **`/upload/<project id>`:** pdf.js sends the text layer beside the original, with progress. Serve pdf.js from the tier. `uploadUrl` points here.
- **OpenRouter link and unlink,** shown only when linking is on.
- **Done when:** the done-when list on issue #4001 passes. Issue #3997 adds the bare landing first, because without it a sign-in ends on a 404.

### Schema and deletion

**S1 Schema.** Shipped: numbered files from 016.

**S2 Deleting and blocking one user.** Shipped: `make beta-block-user ACCOUNT=<id>` sets `blocked_at` and `sessions_revoked_at`. `make beta-delete-user ACCOUNT=<id> CODE=<deletion code>` refuses a wrong code, and otherwise prints what it would delete; with `CONFIRM=yes` it deletes the user's rows, objects and exports, and says that a backup already taken keeps them. Both run in the web image on `malachi` (`apps/server/proto/malachi/user_admin.py`).

## Phase 2: the plugin (`packages/engine/plugin`)

**Wave 1** shipped in PR #3852. Unless the conversation names a `projectPath`, the research router calls `project_list` first. It then continues the listed project the message names, starts a project at `newProjectPath` for a person no listed project is about, or lists the projects and asks. It says the genealogy tools are not connected, and stops, when there is no `project_list` tool.

**G3 Connector name (issue #3529 item 1).** The connector is named exactly "Genealogy Research", so `mcp__Genealogy_Research__…` is the bare spelling every agent already lists. No agent or test changes. Under any other name, agents spawn with only `Read`. The org admin page has no rename, and one org cannot add the same URL twice, so a wrong name means deleting and re-adding the connector. A user who also runs the `.mcpb` gets two servers on that prefix, so D4 tells them to turn it off.

**G4 Hook-only rules.** The hook fires on connector calls in a Cowork task (issue #3529 item 3) and in an ordinary chat (P0.2 item 12), so these rules hold there as they do on the desktop. An Incognito chat runs no hook and no agents, and the research skill there says research needs its agents, and stops. The Surface decision settles that line.

**G5 Capture wording (issue #3990).** Shipped in PR #4387. `search-external-sites`' `capture` accepts three forms: an upload's `.txt`, read with `sidecar_read`; the upload itself, to be transcribed; or the text itself. The upload wording shows only when `project_context` returns an `uploadUrl`.

**G6 The router PR (issue #4297).** Merges with the MCP App work before launch, in one paid `research` run: the card lines, removing `projectUrl`, showing `signInUrl`, logging an upload the main thread reads, an answer to "where is my report?", the agent lines that lean on the viewer, what `project_list`'s cut-short and error answers mean, the no-`Agent` line the Surface decision sets, and connector wording for an empty or unavailable connector that does not point at a desktop extension (in sitting 1 a chat told the user to "update its desktop extension"). Until then the card lines exist only in a variant plugin, which the demo may run at a pinned commit. Invited users get the zip `make plugin-connector` builds, which must then write the `.mcp.json` naming `Genealogy Research` at the public `/mcp` URL (the one-install decision); `make plugin` and the harnesses get none.

**Issue #3836**, agents reading project files directly, is closed: the tools, the agents' reads and the hook's deny have shipped. Issue #4311 moved the last two reads to tools.

## Phase 3: release and operations

**D1 The stack.** `apps/server/proto/malachi/`: a standalone compose file, nginx, an env template and `malachi.sh`.
- **Services:** postgres, minio, minio-init, migrate, web, tools and edge. Only the edge publishes, on 127.0.0.1:8006, and it starts last, because that port is public the moment it listens.
- **Data:** under `DATA_DIR`, `/home/data/genealogy-beta` on `malachi`.
- **Roles:** `dml_role.py`, in the `migrate` one-shot, creates the DML-only role.
- **DNS:** `tools` names public resolvers. The host's resolver gives the tailnet address, whose listener refuses a container, and public DNS gives the Funnel relay.
- **Off by default:** `OPENROUTER_LINKING_ENABLED` always, and `UPLOADS_ENABLED` until issue #4001 lands.
- **Settings:** compose sets `WEB_PUBLIC_URL` from `PUBLIC_URL`. W2's redirect and budget settings, `FS_REDIRECT_URI` and `GENEALOGY_SIGNIN_CALLS_PER_MINUTE`, are in compose and the env template, unset by default. Before invited users, set the FamilySearch budget, and the transcription cap at 5 or more.
- **Make targets:** `malachi-up`, `-check`, `-logs`, `-deploy REF=<sha>`, `-backup`, `-restore-check`, `-restore`, `-export`, `-openrouter EMAIL=`, `-prune`, `-down`, `-wipe` and `-rehearsal`; `beta-block-user ACCOUNT=` and `beta-delete-user ACCOUNT= CODE= [CONFIRM=yes]`.
- **Never** run `tailscale serve reset`, `tailscale funnel --https=443 off` or `make proto-up` with defaults on `malachi`, and do not reboot it for a test: `/wiki` and `/pop-stats` are production ingress for every installed `.mcpb`.

**D2 Monitoring.** Before invited users: a scheduled `make malachi-check` that emails the lead, and logs that survive a redeploy. The per-call log line ties a call to a user. `make malachi-backup` runs by hand, and nothing schedules it.

**Done when:** stopping `tools` emails the lead, and yesterday's `ev=tool_call` lines survive a redeploy.

**D3 Release.** `make malachi-deploy REF=<sha>` deploys one commit. Web, tools and the plugin zip come from the same commit; a demo zip may add the variant's router commit. Freeze tool schemas before warming approvals, because a change to a tool's metadata means removing and re-adding the connector. `make plugin-connector VERSION=x.y.z MARKETPLACE=<name>` builds `releases/genealogy-plugin-connector.zip`.

**D4 Onboarding page.**
1. Install the plugin once from the Plugins page. It follows the Claude account.
2. On the plugin's Connectors tab, connect `Genealogy Research` and sign in. That one connection covers claude.ai, Desktop and the phone, though the phone shows no plugin, so whether research runs there is not measured.

The page also says:
- **Where research runs,** from the Surface decision.
- **A paid Claude plan:** plugins need one.
- **Living people:** do not store information about living people.
- **This is a beta:** nothing promises your work survives, so download what you want to keep.
- **No desktop extension** on that Claude account: turn it off under Settings → Desktop app → Extensions on each computer, or use a second Claude account.
- **Signing in again:** when FamilySearch ends a session, the tool's message gives a sign-in link; sign in, then say "continue" and the call that failed runs again. In Desktop Chat the link is plain text and needs copying into a browser. When the connector token itself expires, Desktop Chat shows a "Reconnect a connector to keep using it" card in the conversation: click Reconnect, approve in the browser, and carry on. claude.ai and the phone were not tested.
- **Feedback:** where to email it, with the conversation pasted in.
- **Team and Enterprise plans:** an Owner makes the plugin available, which brings the connector with it. Not measured on an organization account.

**L1 Policies.** A short privacy policy and terms, published by GeneFun, Inc. at `/privacy` and `/terms`, accepted on the consent page.

The privacy policy covers:
- what is collected, and why;
- where it is stored: on the lead's server, with no promise of durability or encryption at rest;
- who receives it: Anthropic, OpenRouter and Google for transcription, FamilySearch, Wikipedia, and our wiki and population host;
- that the lead may read a user's project when they write in, and may turn a case into a public test with living people removed;
- that everything is deleted when the beta ends, how to ask for deletion sooner, and that a deletion does not reach a backup already taken.

The terms say:
- this is a beta, with no warranty and no promise that work survives;
- users do not store information about living people;
- what acceptable use is;
- FamilySearch's terms apply to FamilySearch content.

A public text or unit test drawn from a report names no account id or anyone who may be living, and quotes the user only as far as the fix needs.

**Done when:** neither page in `apps/server/proto/web/policies.py` says Placeholder, and neither promises durability or encryption at rest.

## Phase 4: launch gates

The first invited user waits for all of these.

1. **Security reviews** as each item merges: E2, E3, W2 and W4, with `/security-review` and `/code-review ultra`.
2. **The acceptance run,** with a new Claude account and a new FamilySearch account on the allowlist, on the zip users will install, built from the launch commit with the MCP App work and G6 merged. It runs in claude.ai chat and Desktop Chat:
   1. install the plugin, connect it from its Connectors tab and sign in;
   2. research a person, and see the cards and case file;
   3. upload a capture;
   4. start a second project, then resume the first in a new task;
   5. let the session end, sign in again from the link, and continue;
   6. install a newer zip over the old one.
3. **Approvals.** After "Always allow" once per tool, an agent's call to that tool does not prompt, in the same task or a new one. If it prompts, launch waits for a fix. Measured (P0.2 item 2): set on the connector's page it holds; chosen at a prompt in Desktop Chat it does not save. Whether D4 tells users to set it on the page is the lead's call.
4. **FamilySearch's approval** is in, and the cross-account sign-in test (P0.2 item 6) has passed. Then the lead seeds keys, and the acceptance account transcribes a FamilySearch page image and an uploaded page image within E5's time budget.
5. **What users rely on is done:** E3, E4's per-user limits, S2, G5, D2 and L1.

## Ending the beta

When FamilySearch hosts the open beta:
1. Tell the users, and give them time to download their projects.
2. Tell users to remove the connector and the plugin.
3. Stop the edge, then run `make malachi-wipe CONFIRM=yes`, and delete the backups, the env file, D2's logs and any exports the lead kept.
4. Delete the emailed reports, and any public text that names a user.

## Changes to the handoff's code

Each of these is additive and keeps the handoff's behavior as the default, except where the handoff's alignment section says. Before each one, check for open PRs on the same files, keep the PR small, and ask Richard to review it. Each change also lists its new settings in the handoff plan's step 9 or 15, unset there.
- **Done:** PR #3852's `project_list` and router step; W1; W3's routes; E1; E4's process-wide and per-user limits; S1's schema files.
- **Web tier,** `apps/server/proto/web/`: W2 and W4. With chat off, sign-in asks for no `offline_access` and the callback stores no refresh token. Chat on stays the default.
- **Dependencies,** `apps/server/pyproject.toml`, `apps/server/uv.lock` and `apps/server/proto/web/requirements.txt`: `mcp` joins `proto-web`. It brings nine packages `proto-web` lacks: `httpx-sse`, `jsonschema` with `attrs`, `jsonschema-specifications`, `referencing` and `rpds-py`, `pydantic-settings`, `pyjwt` and `sse-starlette`. Before W2 merges, Richard reviews the dependency change.
- **The tool server,** `packages/engine/mcp-server/`: E2, E3 and E5, and the MCP App's fold into `createServer`.
- **The plugin,** which `eb-worker.zip` carries: G5's wording, E3's and E5's agent lines, and G6.

## Who builds what

The lead's two agents hold the first group. The team builds the rest; an issue labelled `senior` needs a senior developer. Everything likely to go wrong only live is due by the pin, so the rehearsals test it.

| Item | Issue | Who | Due |
|---|---|---|---|
| W2 Claude's authorization server | issue #3997 | remote-server agent | 19 Nov |
| E3 Sign-in link and wording | issue #3995 | remote-server agent | 23 Nov |
| D2 Monitoring | none | remote-server agent | Before invited users |
| MCP App cards, case file and fold | [the MCP App plan](mcp-app-viewer.md) | MCP App agent | The demo |
| G6 The router PR | issue #4297 | MCP App agent | Before launch |
| W4 Plain pages (D4) | issue #4001 | team | 30 Nov |
| E5 Fit for a connector | issue #3996 | team | The pin |
| E5 Direct reads | issue #4311 | team, senior | Merged; live connector check owed |
| S2 Deleting and blocking one user | issue #4000 | team, senior | Before invited users |

P0.2 is issue #3529. Issue #3994, the browser app, is in the icebox until cards pass the live test behind sign-in.

## After launch

Issue #4003, in the icebox, holds the worker's half of the one door and server-side refresh. Its design is not settled.

## Timeline (proposed)

| When | Work |
|---|---|
| Sun 8 Nov | Sitting 1 |
| Thu 12 Nov | Sitting 2. A long token with no refresh, and one install, are decided; the length is the lead's call, and E3 follows from the results |
| By 13 Nov | E2 merged; the stack up on `malachi` with the edge off |
| About 19 Nov | The first live sign-in |
| About 23 Nov | A full run with cards, a planted dead token, and signing in again |
| By 1 Dec | Policy text and plain pages |
| Before the demo | The MCP App's M1, M2 and M3, with the new case file, then one pinned commit, schemas frozen, approvals warmed, and timed rehearsals |
| When it is ready | The demo, which has no date |
| After the demo | The lead decides what happens to the alpha, Electron and the handoff's chat screens |
| Before launch | The MCP App work and G6 merged |
| When Phase 4 passes | Launch: the first invited users |

**Cut list:** the upload page becomes a bare file form that still runs pdf.js.

**Not cuttable:** sign-in, isolation between users, uploads, the policies, FamilySearch's approval and the connector's name.

## Risks

- **The first real run.** No real token, plugin agent or hosted router has gone through the door together. Stage it: curl with a real token, then a seeded connector, then sign-in.
- **The long token.** Sitting 2 held one for about 4 days, and the tools stayed on a tool-level message. Past that is unmeasured; a refresh token on our own token works silently if it is ever needed.
- **Approvals.** A run makes over 100 tool calls, mostly in agents. "Always allow" set on the connector's page reaches agents; chosen at a prompt in Desktop Chat it does not save, so a user who only clicks the prompt is asked on every call.
- **The per-call limit.** Measured 2026-11-08 at 230 s (P0.2 item 4). `project_create` needs about 55 s; `image_transcribe` for a connector caller is now held to a 180 s budget (E5), leaving room for the trip both ways.
- **The wrong server.** A `.mcpb` left on shares the connector's prefix, so research can land on disk and look right. The first reply must say `hosted`.
- **One host.** A single server, with `/wiki` and `/pop-stats` on the same machine and the same Funnel. A lost disk loses users' research, and D4 and the terms say so.
- **Research in Incognito.** An ordinary chat runs the plugin's agents and hook (P0.2 item 12). An Incognito chat runs neither: the research skill declines, and the main thread can call `record_search` itself. A rule that must hold in every chat, Incognito included, has to be a tool rule.
- **A new account.** Research on the primary surfaces rests on plugin skills and agents reaching chat. If a new account gets neither, research does not run there at all, so acceptance step 2 is the main risk to the beta.
- **A test on the lead's account.** It runs a variant plugin, so cards working there say nothing about the zip users install. Only acceptance step 2 does.
- **One account's load.** E4's per-user cap holds an account to 4 tool calls running at a time, and its calls past that wait. Each waiting call has still passed the door (up to two lookups and its body read), and nothing bounds how many wait.
- **Code moving under a rehearsal.** One pinned commit for web, tools and the zip.
- **Richard's path.** E1 changed the door his worker uses. It keeps admitting today's worker.
- **Two languages.** Node decrypts what Python encrypts. A shared test vector pins the format, and both tiers need the same key.
