# Genealogy Research

A Claude Cowork plugin and desktop extension for genealogy research.
The project ships two coupled artifacts from this single repo:

1. **MCP Server** (`mcp-server/`) — A TypeScript MCP server packaged
   as a Claude Desktop Extension (.mcpb). Runs on the host machine
   with full network access. Wraps genealogy and reference APIs
   (FamilySearch, Wikipedia) and exposes them as MCP tools.
2. **Cowork Plugin** (`plugin/`) — Skills, slash commands, and
   templates that run inside Cowork's sandboxed VM. Teaches Claude
   when and how to use the MCP server's tools.

The two communicate only through MCP tool calls — structured JSON in,
structured JSON out. The MCP server runs on the host because the
Cowork VM has restricted egress; anything that touches the network
has to live in the server.

## What it does today

The MCP server exposes ten tools:

| Tool | Purpose | Auth |
|------|---------|------|
| `wikipedia_search` | Wikipedia article summary lookup | None |
| `places` | FamilySearch place data + Wikipedia enrichment | None |
| `collections` | FamilySearch record collections for a place | OAuth |
| `search_wiki` | Natural-language search of the FamilySearch Wiki via a separate `wiki-query-api` server | None (v1) |
| `population` | Historical population data + indexed record counts | None |
| `external_links` | FS-curated third-party genealogy URLs by place + year | None |
| `search` | FamilySearch historical-record search for a person | OAuth |
| `login` | OAuth 2.0 + PKCE login to FamilySearch | — |
| `logout` | Clear stored FamilySearch tokens | — |
| `auth_status` | Report current FamilySearch session state | — |

The `population` tool calls the Pop Stats API — a separate FastAPI
service that must be running on the host. It combines data from
populstat (234 countries), gapminder, and FamilySearch indexed birth
records. See `docs/specs/population-tool-spec.md` for the full spec.

The remaining FamilySearch tools (`tree`, `cets`) are next — see
`PROJECT-GOAL.md` for the roadmap.

The plugin ships 21 GPS genealogy research skills covering the full
research cycle — from project initialization through proof conclusion.
See [`plugin/README.md`](./plugin/README.md) for the complete skill
catalog and recommended workflow.

## Installation (for end users)

You need to install both pieces:

### 1. Install the desktop extension

1. Download `genealogy-mcp.mcpb` from the latest release
2. Open Claude Desktop → Settings → Extensions
3. Click "Install Extension..." and select the .mcpb file
4. The "Genealogy MCP" extension should appear in your list

### 2. Install the Cowork plugin

1. Download `genealogy-plugin.zip` from the latest release
2. Open Claude Desktop → switch to Cowork tab
3. Click "Customize" in the left sidebar
4. Click "Browse plugins" → "Upload custom plugin"
5. Select the .zip file

### 3. Try it out

In a Cowork session, exercise any of:

> `/wiki Albert Einstein`

Triggers the `wiki-lookup` skill — calls Wikipedia, fills a
template, saves `albert-einstein.md` to your working folder.

> "Find FamilySearch info for Ohio."

Claude calls the `places` tool directly and reports what it learned.

> "Log me in to FamilySearch. My client ID is YOUR-DEV-KEY."

Exercises the OAuth flow. See `docs/testing-guides/oauth-tool-testing-guide.md` for
getting a FamilySearch dev key and walking through the full flow.

> "What FamilySearch record collections cover Alabama?"

Once logged in, Claude calls the `collections` tool and reports the
matching record collections with their record, person, and image
counts.

> "How do I find Italian birth records?"

Triggers the `search_wiki` tool — calls the separate `wiki-query-api`
FastAPI server, which runs RAG retrieval over the FamilySearch Wiki and
returns ranked sections with source URLs. Requires the upstream server
to be running locally (or pointed at via `wikiApiUrl` config); see
`docs/specs/search-wiki-tool-spec.md`.

> "What is the population of place ID 1927069 in 1960?"

Claude calls the `population` tool and returns Nigeria's historical
population data from multiple sources, plus FamilySearch indexed
birth record coverage. Requires the Pop Stats API to be running
(`http://localhost:8000` by default, configurable via
`POP_STATS_BASE_URL` env var).

> "Find Abraham Lincoln, born 1809 in Kentucky."

Claude calls the `search` tool with a tight birth-year range and
returns ranked persona records (name, dates and places, source
collection, and a clickable persistent URL). For collection-scoped
queries, Claude chains `collections` first to pick a `collectionId`,
then narrows the search.

## Development

See [CLAUDE.md](./CLAUDE.md) for the developer guide — architecture,
build commands, conventions for adding tools and skills.

### Quick start

```bash
# Build the MCP server desktop extension
cd mcp-server
npm install
npm run build
cd ..
./scripts/build-mcpb.sh

# Package the Cowork plugin
./scripts/package-plugin.sh

# Both artifacts will be in releases/
ls releases/
```

### Running the Pop Stats API (required for the population tool)

The `population` tool calls a separate Pop Stats API service. To run it:

```bash
cd /path/to/search-agent-tools/pop-stats-api
uv sync                                        # first time only
uv run uvicorn api.app:app --port 8000
```

The API base URL defaults to `http://localhost:8000`. Override with
the `POP_STATS_BASE_URL` environment variable if the API runs
elsewhere.

### Running the eval test suite

Skill evaluation lives under `eval/`. Quick start:

```bash
cd eval/harness
uv sync                                                  # first time only
uv run python run_tests.py --skill wiki-lookup           # run one skill's tests
uv run python run_tests.py --test ut_wiki_lookup_001     # run a single test
```

Run logs land under `eval/runlogs/unit/<skill>/<model>/<timestamp>.json`.
The harness has its own unit-test suite (`cd eval/harness && uv run pytest`).
See [`eval/README.md`](./eval/README.md) for the full guide including
prerequisites, useful flags, and Windows `.bat` shortcuts for non-technical
users.

## Project status

Foundation phases complete: OAuth authentication, public tools
(Wikipedia, FamilySearch places, population, external_links),
natural-language wiki search via the separate `wiki-query-api` RAG
server, and the first two authenticated tools (`collections`,
`search`). The remaining authenticated tools (`tree`, `cets`) are
next. See `PROJECT-GOAL.md` for full task progress.

## License

MIT
