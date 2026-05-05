# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `PROJECT-GOAL.md` for the current implementation focus and task progress.**

## Build Commands

```bash
cd mcp-server && npm install && npm run build       # Build MCP server
cd mcp-server && npm test                            # Run all tests (vitest)
cd mcp-server && npx vitest run tests/tools/places.test.ts   # Run a single test file
cd mcp-server && npx vitest run -t "test name"       # Run tests matching a name
./scripts/build-mcpb.sh                              # Package .mcpb extension (→ releases/)
./scripts/package-plugin.sh                          # Package plugin .zip (→ releases/)
```

Quick manual smoke-test against live APIs (bypasses the MCP harness):

```bash
cd mcp-server && npx tsx dev/try-wikipedia.ts "Albert Einstein"
cd mcp-server && npx tsx dev/try-places.ts "Ohio"
```

## What this project is

A Claude Cowork plugin + desktop extension for genealogy research.
We ship two separate artifacts from this single repo:

- A TypeScript MCP server packaged as a `.mcpb` desktop extension
  (runs on the host)
- A Cowork plugin folder packaged as a `.zip` (runs in the Cowork VM)

These two pieces are tightly coupled and must be developed together,
which is why they live in one repo.

## Architecture you must understand before changing anything

Cowork runs Claude inside a sandboxed Linux VM. The VM has restricted
network access — its egress allowlist is broken for arbitrary domains.
This means **code that needs to make external API calls cannot run
inside the VM**. It must run on the host.

The MCP server runs on the host (full network access). Skills and
their bundled scripts run inside the VM (no reliable network access).
They communicate only through MCP tool calls — structured JSON in,
structured JSON out. They cannot share files at runtime.

When adding a feature, ask: "Does this need the network?" If yes, it's
an MCP tool. If no (it's data processing, formatting, or templating),
it can be a skill script.

## Repository layout

- `mcp-server/` — TypeScript source for the MCP server. Compiles to
  `mcp-server/build/`. The `.mcpb` is built from this.
- `plugin/` — The Cowork plugin folder. Packaged as a .zip directly,
  no compilation step.
- `scripts/` — Build scripts for both artifacts.
- `mcp-server/dev/` — Developer-only scripts: `try-*.ts` one-shot
  smoke tests that invoke a tool directly against live APIs (no MCP
  harness; useful for debugging a tool in isolation), plus
  `probe-*.ts` and `explore-*.ts` scripts that document the live-API
  evidence trail behind each spec. Not shipped in any artifact.
- `mcp-server/scripts/` — Reserved for future user-facing scripts.
  Currently empty. Do not put internal/developer scripts here; they
  belong in `mcp-server/dev/`.
- `releases/` — Build output. Gitignored except for `.gitkeep`.
- `docs/plan/` — Implementation plans for tools (how we intend to build).
- `docs/specs/` — Finalized specs (what the tool must do). Specs are the
  source of truth the `spec-review` agent checks implementations against.
- `docs/*-testing-guide.md` — Layered manual testing playbooks
  (Inspector → Claude Code → Cowork). Used to verify each new tool
  end-to-end before shipping.

## Implemented tools

Registered in `mcp-server/src/index.ts`. Source in `mcp-server/src/tools/`.

### `wikipedia_search`

Fetches a Wikipedia article summary. No auth. See
`docs/specs/wikipedia-tool-spec.md`.

### `places`

Returns FamilySearch place data enriched with Wikipedia summaries. No auth
(uses the public FamilySearch places endpoints).

```typescript
places({ query: "England" })      // Search by name
places({ query: "267" })          // Lookup by place ID
```

Returns: `placeId`, `name`, `fullName`, `type`, `latitude`, `longitude`,
`dateRange`, `parentPlaceId`, `wikipedia` enrichment, and URLs. Plan in
`docs/plan/places-tool.md` / `places-tool-v2.md`.

### `login` / `logout` / `auth_status`

OAuth 2.0 + PKCE flow against FamilySearch. `login` spins up a local
HTTP server on `127.0.0.1:1837/callback`, opens the user's browser, and
exchanges the auth code for tokens. `auth_status` reports session state;
`logout` deletes the token file. Spec: `docs/specs/oauth-auth-spec.md`.

The first-ever call must pass `clientId` (a FamilySearch dev key);
subsequent calls read it from the on-disk config (see below).

### `collections`

Returns FamilySearch record collections for a place, with record, person,
and image counts. **Requires auth** (uses `getValidToken()`). Spec:
`docs/specs/collections-tool-spec.md`.

```typescript
collections({ query: "Alabama" })    // Search by place name (recommended)
collections({ placeIds: [33] })      // Filter by internal collection IDs
```

The `query` parameter searches collection titles (case-insensitive). This
is the primary input — the `places` tool and `collections` tool use
different place ID systems, so pass a place name, not a places-API ID.

Returns: `query`, `matchingCollections`, and `collections[]` with `id`,
`title`, `dateRange`, `placeIds`, `recordCount`, `personCount`,
`imageCount`, and `url`.

## Specced tools (not yet implemented)

### `search`

Searches FamilySearch's historical record index for a specific
person. **Spec'd, implementation pending.** Source of truth:
`docs/specs/search-tool-spec-v2.md`.

The v2 spec targets the `/service/search/hr/v2/personas` endpoint
(the same `service/search/hr/v2/` family as `collections`) rather
than the documented `/platform/records/personas` covered by v1
(`docs/specs/search-tool-spec.md`). The switch was made because the
service endpoint exposes ~100× the corpus and `f.collectionId`
actually narrows results — making the `places → collections →
search` workflow possible. v1 remains in the repo as the platform-
endpoint reference.

When implementing, requires auth (`getValidToken()`) and a
browser-style `User-Agent` header (same WAF workaround as
`collections`). Surfaces the documented anchor rule, year-only
date inputs, and `treeMatches` derived from `entry.hints`. Probe
scripts under `mcp-server/dev/probe-svc-*.ts` are the evidence
trail for every behavioral claim in the spec.

## Auth architecture (`mcp-server/src/auth/`)

All future authenticated tools (`collections`, `search`, `tree`, `cets`)
must go through this module — do not re-implement token plumbing.

- `config.ts` — OAuth URLs, callback port, scopes, and a file-backed
  config store at `~/.familysearch-mcp/config.json`. `getClientId()` is
  the single source of the FamilySearch client ID; it throws an
  LLM-instruction error if the file is missing.
- `pkce.ts` — `generatePKCE()` and `generateState()`, stdlib `crypto` only.
- `tokenManager.ts` — `saveTokens` / `loadTokens` / `clearTokens` /
  `isExpired` against `~/.familysearch-mcp/tokens.json`. All file ops
  return `null` rather than throwing on missing/corrupt input.
- `refresh.ts` — **`getValidToken()` is the single entry point** for
  authenticated tools. It loads tokens, auto-refreshes if expired, and
  throws an LLM-instruction error ("Call the login tool to
  authenticate.") when no valid session is available.
- `login.ts` — Full OAuth flow (HTTP callback server + browser launch +
  code exchange + token save). Returns `LoginResult`, never throws.

### Secrets/config convention

Both `config.json` and `tokens.json` live under `~/.familysearch-mcp/`
and are written with `mode: 0o600`. **Do not** introduce env-var
fallbacks for secrets — the config file is the sole source. New
provider keys should be added as fields on `AppConfig` in
`src/types/auth.ts` and read via `loadConfig()`.

## Important conventions

### MCP server tools

Tools are defined in `mcp-server/src/tools/`. Each tool exports a
single function and its schema. The entry point in `src/index.ts`
imports them and registers them with the MCP server.

Use generic tool names with provider parameters when scaling, not
one tool per provider. For example, when we add real APIs, use
`search({ provider: "familysearch", ... })`, not `familysearch_search`.
This keeps the tool count low and Claude's context window lean.

### Skills

Skills live in `plugin/skills/<skill-name>/`. Each skill has:

- `SKILL.md` — The instructions Claude reads. Includes frontmatter
  with `name`, `description`, and (if needed) `allowed-tools`.
- `templates/` — Markdown templates Claude fills in
- `references/` — Reference docs Claude loads on demand
- `scripts/` — Python scripts (stdlib only) for data processing.
  Remember: these run in the VM with no network access.

The `description` in SKILL.md frontmatter is critical — it determines
when Claude triggers the skill. Be specific about what kinds of user
requests should activate it.

### Slash commands

Commands in `plugin/commands/<name>.md` give users explicit triggers
for skills. They're shortcuts users can type instead of describing
what they want.

## Code reuse

Before writing new logic, check whether something equivalent already
exists. If it does, call it. If it's close but not quite, extend the
existing function (add a parameter, widen the return type) rather
than create a parallel copy. If you find yourself pasting code from
one tool into another, stop — lift the shared piece into a proper
module instead.

Where to look first:

- **`src/auth/`** — `getValidToken()` is the only correct way to
  read a FamilySearch access token. Don't re-implement token
  loading, expiry checks, or refresh. The same applies to anything
  else here (PKCE, config loading, token storage).
- **`src/auth/config.ts`** — `loadConfig()` / `getClientId()` is
  the single source for app config. New provider keys go on
  `AppConfig` in `src/types/auth.ts`, not into env vars or
  ad-hoc files.
- **`src/types/`** — shared API response and tool I/O types live
  here. If a second tool touches the same upstream API, put the
  response shape here so both stay in sync.
- **Exported helpers in `src/tools/`** — for example, `places.ts`
  exports `searchPlace`, `getPlaceById`, and `getWikipediaSummary`,
  and `collections.ts` exports `fetchAllCollections`,
  `filterByQuery`, and `filterByPlaceIds`. A new tool that needs
  place lookup or Wikipedia enrichment should call these, not
  re-fetch.

Soft caveat: don't pre-extract for hypothetical reuse. Wait for the
second concrete need before factoring code into a shared module —
premature abstractions calcify around the first caller's assumptions
and make the next use case harder to fit. Two near-duplicates is the
signal to consolidate; one isn't.

## How to add a new feature

Example: adding a "list providers" feature.

1. Add the tool to the MCP server:
   - Create `mcp-server/src/tools/list-providers.ts`
   - Register it in `mcp-server/src/index.ts`
   - Run `npm run build` in `mcp-server/`
   - Create `mcp-server/dev/try-list-providers.ts` — a one-shot
     smoke script that invokes the tool directly against live APIs.
     Follows the pattern of `try-wikipedia.ts` / `try-places.ts`.
     Critical for debugging when the MCP harness hides real errors.

2. Add or update a skill that uses it:
   - Create `plugin/skills/list-providers/SKILL.md`
   - In the SKILL.md, instruct Claude to call the new tool
     when the user asks what providers are available

3. (Optional) Add a slash command:
   - Create `plugin/commands/providers.md`

4. Rebuild both artifacts:
   ```bash
   cd mcp-server && npm run build && cd ..
   ./scripts/build-mcpb.sh
   ./scripts/package-plugin.sh
   ```

5. Manually test by installing both artifacts in Claude Desktop.

## How to test a new tool end-to-end

For non-trivial tools, write a testing guide at
`docs/<tool>-tool-testing-guide.md` modeled on
`docs/oauth-tool-testing-guide.md` and
`docs/wikipedia-tool-testing-guide.md`. The four layers we
standardized on:

1. **MCP Inspector** — verifies the tool registers and behaves with
   no/dummy/real input.
2. **Claude Code** — verifies the tool description is good enough
   that the LLM picks it from natural language.
3. **Cowork via WSL2** — verifies the WSL2 → Claude Desktop bridge.
4. **Cowork via native Windows** — verifies the install path real
   users will take.

Both Layer 3 sub-layers are required for ship-readiness regardless
of which is your dev environment.

## What NOT to do

- Don't try to share code at runtime between the MCP server and the
  skills. They're isolated. Duplicate the structures in both places
  if needed.
- Don't put network-calling code in skill scripts. It will be silently
  blocked by the VM's egress proxy.
- Don't add Python dependencies that aren't in the standard library
  to skill scripts. The VM may not have them, and pip installs slow
  down skill execution.
- Don't create one MCP tool per provider/endpoint. Use generic tools
  with parameters to keep the tool count manageable.
- Don't reference files across the `mcp-server/` and `plugin/`
  directories at runtime. Build-time references via the build scripts
  are fine, runtime references are not.

## End-to-end testing

After building both artifacts and installing them in Claude Desktop,
exercise an MCP tool from inside a Cowork session (e.g. ask Claude to
look up a place: "Find FamilySearch info for Ohio"). Claude should call
the `places` tool, get structured JSON back, and — if a skill tells it
to — write a file to the selected folder. If that round-trip works, the
full pipeline is wired: host → MCP server → SDK bridge → VM → Claude →
file write.

**Working reference skill:** the `wiki-lookup` skill and `/wiki`
command in `plugin/` are a working reference example showing the
full plugin pipeline — they call the `wikipedia_search` MCP tool,
populate a markdown template, and save the result to a file. Copy
this structure when wiring a new skill to one of the other tools
(`places`, OAuth tools). Don't mutate `wiki-lookup` itself; create
a new skill folder.
