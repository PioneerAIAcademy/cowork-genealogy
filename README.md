# Genealogy Research

A Claude Cowork plugin and desktop extension for genealogy research.
Wraps FamilySearch, Wikipedia, and Pop Stats APIs as MCP tools (running
on the host) and ships skills and slash commands (running inside the
Cowork VM) that teach Claude when to call them.

Repo layout:

- `mcp-server/` — TypeScript MCP server, packaged as a Claude Desktop
  Extension (`.mcpb`). Runs on the host.
- `plugin/` — Cowork plugin (skills + commands + templates), packaged
  as a `.zip`. Runs in the Cowork sandboxed VM.

## Architecture

The two artifacts are tightly coupled and ship from one repo because
they have to be developed together. They communicate only through MCP
tool calls — structured JSON in, structured JSON out. There are no
runtime file references between them.

The split exists because the Cowork VM has restricted egress: code
that needs the network has to live on the host (the MCP server).
Skills and bundled scripts inside the plugin must not make network
calls — they consume structured responses from MCP tools instead.

When adding a feature, the question is "does this need the network?"
If yes, it's an MCP tool. If no (data processing, formatting,
templating), it can be a skill script.

See [CLAUDE.md](./CLAUDE.md) for the full architecture / contribution
guide, code-reuse conventions, and the auth module overview.

## Tools

The MCP server exposes eight tools.

### `wikipedia_search` — no auth

Fetches an English Wikipedia article summary for a search term.
Returns the article's title, summary, page URL, and content extracts.
Useful for biographical and place context that shows up in genealogy
results. Spec: [`docs/specs/wikipedia-tool-spec.md`](./docs/specs/wikipedia-tool-spec.md).

### `places` — no auth

Searches or looks up FamilySearch places, with Wikipedia enrichment on
ID lookup. Two modes: `{ query: "England" }` returns ranked name-search
candidates; `{ query: "267" }` returns one place with full detail (the
numeric input is a `placeRepId` from a previous places call). Each
result exposes both `placeId` (the FamilySearch **Primary** identifier
— the canonical place ID, accepted by `population` and future
`tree`/`cets`) and `placeRepId` (the internal **rep** ID — accepted
by `places` lookup mode and used to build `familysearchUrl`). Other
fields: normalized + full hierarchical names, type (country / state /
county / etc.), coordinates, date range, and parent rep ID. Spec:
[`docs/specs/places-tool-spec.md`](./docs/specs/places-tool-spec.md).

### `population` — no auth (requires Pop Stats API)

Returns historical population data and FamilySearch indexed birth-record
counts for a place. Calls the Pop Stats API, a separate FastAPI
service that must be running (see [Pop Stats API setup](#pop-stats-api-setup)).
Combines populstat (234 countries), gapminder, and FamilySearch indexed
births. Accepts `place_id` plus optional `year` or `year_start`/`year_end`
range. Province- and town-level queries fall back to country-level
sources where the country source covers the period. Spec:
[`docs/specs/population-tool-spec.md`](./docs/specs/population-tool-spec.md).

### `login` / `logout` / `auth_status` — OAuth 2.0 + PKCE

Auth tools for FamilySearch. `login` spins up a local HTTP callback
server on `127.0.0.1:1837/callback`, opens the user's browser to the
FamilySearch consent page, and exchanges the auth code for tokens.
The **first** call accepts `clientId` (a FamilySearch dev key) and
persists it to `~/.familysearch-mcp/config.json`; subsequent calls
read it from the file. Tokens land at `~/.familysearch-mcp/tokens.json`.
Both files are written with mode `0o600`. `auth_status` reports
session state without side-effects; `logout` clears the token file.
Spec: [`docs/specs/oauth-auth-spec.md`](./docs/specs/oauth-auth-spec.md).

### `collections` — auth required

Lists FamilySearch record collections for a place, with record,
person, and image counts. Accepts `query` (case-insensitive title
search — recommended) or `placeIds` (filter by internal
collection-place IDs, distinct from `places` tool IDs). Returns
matching collection IDs, titles, date ranges, place IDs, and counts.
Use this before `search` to find a `collectionId` to scope a search
to a specific collection. Spec:
[`docs/specs/collections-tool-spec.md`](./docs/specs/collections-tool-spec.md).

### `search` — auth required

Searches FamilySearch's historical record index for a specific person.
Anchor rule: at least one of `surname` or `recordCountry` must be
supplied (the API rejects unanchored queries). Accepts ~60 input
fields covering name (with alt-name UNION support and auto-pairing of
the missing alt half), life events (birth / death / marriage /
residence / any) with year ranges and place anchors, family members
(spouse / parents / other), record-source filters (`collectionId`,
`recordType`, `maritalStatus`, `isPrincipal`), and pagination. Returns
ranked persona results with names, key dates and places, source-
collection metadata, persistent ARK URLs, and `treeMatches[]`
(suggested matches to existing FamilySearch Family Tree people).
Spec: [`docs/specs/search-tool-spec-v2.md`](./docs/specs/search-tool-spec-v2.md).

## Build

```bash
cd mcp-server
npm install
npm run build
cd ..

# Build the desktop extension (output: releases/genealogy-mcp.mcpb)
./scripts/build-mcpb.sh

# Build the Cowork plugin (output: releases/genealogy-plugin.zip)
./scripts/package-plugin.sh
```

Both artifacts land in `releases/`. The directory is gitignored.

## Install the built artifacts

### Desktop extension (`.mcpb`)

1. Open Claude Desktop → **Settings → Extensions**.
2. Click **Install Extension…** and select `releases/genealogy-mcp.mcpb`.
3. The "Genealogy MCP" extension appears in the list.

### Cowork plugin (`.zip`)

1. Open Claude Desktop → **Cowork** tab.
2. Click **Customize** in the left sidebar.
3. Click **Browse plugins → Upload custom plugin**.
4. Select `releases/genealogy-plugin.zip`.

### Tested host platforms

End-to-end (host MCP + Cowork plugin + Claude Desktop bridge) is
verified on:

- Windows (native)
- WSL2 on Windows

Other host platforms (macOS, Linux native) are unverified. The MCP
server is plain Node/TypeScript and almost certainly runs anywhere
Node runs; the Cowork-side install path is what hasn't been
exercised.

## FamilySearch setup

The `collections` and `search` tools require authentication. Auth is
OAuth 2.0 + PKCE against FamilySearch.

1. Get a FamilySearch dev key (`clientId`) from the FamilySearch
   developer portal.
2. From a Cowork session, log in via the `login` tool — pass
   `clientId` on the **first** call:

   > "Log me in to FamilySearch. My client ID is YOUR-DEV-KEY."

   The tool persists `YOUR-DEV-KEY` to
   `~/.familysearch-mcp/config.json`, opens your browser to the
   consent page, and writes tokens to `~/.familysearch-mcp/tokens.json`.
3. Subsequent `login` calls read `clientId` from the config file — no
   need to pass it again. Use `auth_status` to check session state;
   `logout` to clear stored tokens.

**Secrets convention.** The `clientId` lives in
`~/.familysearch-mcp/config.json` and is the **sole source** — there
is no environment-variable fallback by design. If you add a new
authenticated provider, add its config field to `AppConfig` in
`src/types/auth.ts` and read it via `loadConfig()` (see
[CLAUDE.md → Auth architecture](./CLAUDE.md#auth-architecture-mcp-serversrcauth)).
Both `config.json` and `tokens.json` are written with mode `0o600`.

## Pop Stats API setup

The `population` tool calls the Pop Stats API, a separate FastAPI
service in the `search-agent-tools/pop-stats-api` repo. The API must
be running for the tool to work.

```bash
cd /path/to/search-agent-tools/pop-stats-api
uv sync                                  # first time only
uv run uvicorn api.app:app --port 8000
```

The default base URL is `http://localhost:8000`. Override with the
`POP_STATS_BASE_URL` environment variable if the API runs elsewhere.
This is the only environment variable the project consumes — secrets
go in the config file, not in env.

## Development

[CLAUDE.md](./CLAUDE.md) is the full developer guide — repo layout,
build commands, code-reuse conventions, how to add a new tool or
skill, the auth architecture, and the four-layer end-to-end testing
playbook. Specs in `docs/specs/` are the source of truth for tool
contracts; the `spec-review` agent in `.claude/agents/` audits
implementations against them. Probe scripts under
`mcp-server/dev/probe-*.ts` capture the live-API evidence trail
behind every behavioral claim in the specs.

## License

MIT.
