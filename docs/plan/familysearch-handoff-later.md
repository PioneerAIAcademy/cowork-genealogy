# A FamilySearch-hosted remote MCP server for Cowork users, at intent only

> **Status:** NOT AUTHORIZED. **Do not build from this file.** FamilySearch has not authorized
> it, and issue #3529's tests decide parts 3 and 5. This file records what and why, with
> acceptance criteria and nothing else. Written 2026-10-18. The current plan,
> [`familysearch-handoff.md`](familysearch-handoff.md), keeps the one thing this needs from it: the
> tools tier stays a separate service (its U21, item 3).

## What it is

- **Who:** patrons who already have a paid personal Claude account. They add FamilySearch's
  server to Claude as a custom connector and install the plugin in Cowork. No `.mcpb`.
- **Cowork only.** Cowork loads the plugin's skills, agents and `PreToolUse` hook (ADR-0005). The
  chat tabs of Claude Desktop and claude.ai are out of scope.
- **Projects live on FamilySearch's servers,** in the same Postgres and S3 as the web product. That
  is the condition of using FamilySearch's server. The plugin reads and writes project state only
  through the MCP tools, so it needs no storage change.
- **What FamilySearch pays for:** the tool servers only. The model runs in the patron's own Claude
  account, so there is no Bedrock spend, no gateway route and no Langfuse capture.
- **How Claude reaches it:** from Anthropic's cloud, `160.79.104.0/21`, for both the MCP server and
  FamilySearch's sign-in server, not from the patron's machine (claude.com/docs/connectors/building/authentication).

## Known about sign-in (2026-10-18)

- FamilySearch's sign-in server advertises `client_id_metadata_document_supported: true` and
  `none` in `token_endpoint_auth_methods_supported`, so Claude registers through a Client ID
  Metadata Document with no client created on FamilySearch's side. It also advertises S256 PKCE,
  `offline_access`, `/userinfo`, introspection and the token-exchange grant
  (`https://ident.familysearch.org/.well-known/oauth-authorization-server`; the same on `identbeta`).
- From a laptop, that URL answers 403 to the user agents `python-httpx`, `node` and `Claude-User`,
  and 200 to a browser user agent or none (Imperva; 2026-10-18, n=1 each).
- The MCP authorization spec requires a server to accept only tokens issued for itself, and forbids
  it passing the token it received on to an upstream API (modelcontextprotocol.io, specification
  2025-11-25, "Authorization"). Every FamilySearch tool today sends the bearer it was given to
  `api.familysearch.org`.

## The gate: issue #3529

| Test | Decides |
|---|---|
| 1. Sign-in completes through Imperva, and FamilySearch accepts Claude's client id | Asks 1 and 2 |
| 2. Claude's token reaches the FamilySearch API | Part 3 |
| 3. Our client can exchange Claude's token for its own | Part 3; ask 3 |
| 4. The connector's tool prefix in Cowork | Part 5 |
| 5. The `PreToolUse` hook fires on a connector's tool call | Part 5 |

## Parts

**1. A public mode for the tool server.** One flag per environment. The worker-facing
environment keeps U4's contract unchanged: the project header, the claim fence and the stamped
bearer. The public environment refuses those headers and binds the project from `projectPath`.
**Done when:** each environment refuses the other's requests, and a CI job smokes both modes, as
`make engine-smoke-http` smokes the worker mode on compose.

**2. Projects keyed by owner and `projectPath`.** The bearer resolves to a FamilySearch user id
through `/userinfo`, cached by the bearer's hash; that id is U2's `users` row and
`projects.owner_id`. Decide between keying a project by owner plus the local folder path Cowork
already passes, which needs no plugin change, and passing explicit project ids. Either way, add a
`project_list` tool so a patron can reattach a project from a second machine or a renamed folder.
Decide whether U2's email allowlist applies here, or F17's CAS/TARS answer replaces it.
**Done when:** two patrons passing the same `projectPath` get different projects; neither reaches
the other's; one patron reattaches a project on a second machine through `project_list`.

**3. OAuth resource server.** An unauthenticated request answers 401 with
`WWW-Authenticate: Bearer resource_metadata="…"`. The protected-resource metadata document gives
`resource` as the exact public URL, FamilySearch's issuer first in `authorization_servers`, and
`scopes_supported`. Upstream calls use a FamilySearch API token issued to our own client, obtained
with the token-exchange grant (`fsFetch` and the bearer principal change), unless FamilySearch
InfoSec accepts passthrough in writing. Optional: store-less tools answer before sign-in
(claude.com/docs/connectors/building/lazy-authentication).
**Done when:** a Cowork patron adds the connector, signs in on `identbeta`, and a `record_search`
succeeds; a token issued for another resource is refused 401.

**4. The public environment.** A second Beanstalk environment from `releases/eb-tools.zip`, in its
own VPC, reaching the shared RDS and S3. A public load balancer with TLS on a FamilySearch
hostname, inbound limited to `160.79.104.0/21`, a per-patron rate limit, and the tools tier's
1,800 s idle timeouts. **Done when:** list 3's checks pass on it, and a request from outside
Anthropic's range is refused.

**5. The plugin under a connector.** Add the connector's prefix to every agent's `tools:` and to
`packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts`. If the hook does not fire on a connector's tool call,
the protections it gives `research_append` (`owner_denied`, `AGENT_WRITABLE_SECTIONS`) must move
into the server before launch. Decide how these patrons get the plugin. **Done when:** every agent
spawns in Cowork with the connector's tools, and the hook's deny binds or its server-side
replacement does.

## FamilySearch asks, routed by Richard once authorized

1. **Imperva:** admit `160.79.104.0/21` to the sign-in server's discovery, authorize and token
   endpoints, and to the public MCP host.
2. **Sign-in team:** accept Claude's client id metadata document, if FamilySearch keeps an allowlist.
3. **Sign-in team and InfoSec:** issue tokens for the MCP server as a resource and allow our client
   to exchange them, or accept passthrough.
4. **Network:** a VPC for the public environment, with access to the shared RDS and S3.
5. **Platform:** the public hostname, TLS certificate and edge route.
6. **Legal and records:** patrons' research stored on FamilySearch's servers as the condition of
   use, with F17's retention and deletion answers applying to it.
