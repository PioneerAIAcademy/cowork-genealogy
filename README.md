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

The MCP server exposes six tools:

| Tool | Purpose | Auth |
|------|---------|------|
| `wikipedia_search` | Wikipedia article summary lookup | None |
| `places` | FamilySearch place data + Wikipedia enrichment | None |
| `login` | OAuth 2.0 + PKCE login to FamilySearch | — |
| `logout` | Clear stored FamilySearch tokens | — |
| `auth_status` | Report current FamilySearch session state | — |
| `collections` | FamilySearch record collections for a place | Yes |

The remaining FamilySearch tools (`search`, `tree`, `cets`) are next —
see `PROJECT-GOAL.md` for the roadmap.

The plugin ships one working reference skill (`wiki-lookup` /
`/wiki`) demonstrating the end-to-end pipeline.

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

Exercises the OAuth flow. See `docs/oauth-tool-testing-guide.md` for
getting a FamilySearch dev key and walking through the full flow.

> "What FamilySearch record collections cover Alabama?"

Once logged in, Claude calls the `collections` tool and reports the
matching record collections with their record, person, and image
counts.

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

## Project status

Foundation phases complete: OAuth authentication, public tools
(Wikipedia, FamilySearch places), and the first authenticated tool
(`collections`). The remaining authenticated tools (`search`, `tree`,
`cets`) are next. See `PROJECT-GOAL.md` for full task progress.

## License

MIT
