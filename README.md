# Genealogy Research

A Claude Cowork plugin and desktop extension for genealogy research.
This is the hello-world scaffold — the architecture is in place but
the only working feature is a "say hello" demo that proves all the
pieces wire together correctly.

## Architecture

This project ships two artifacts that work together:

1. **MCP Server** (`mcp-server/`) — A TypeScript MCP server packaged
   as a Claude Desktop Extension (.mcpb file). Runs on the host machine
   with full network access. Will eventually wrap genealogy APIs like
   FamilySearch and Ancestry. Right now it just exposes one tool: `hello`.

2. **Cowork Plugin** (`plugin/`) — Skills, slash commands, and templates
   that run inside Cowork's sandboxed VM. Teaches Claude when and how to
   use the MCP server's tools. Right now it has one skill (`say-hello`)
   and one command (`/hello`).

The two pieces communicate through MCP tool calls. The skill tells Claude
"call the hello tool", Claude makes the call, the call crosses the SDK
bridge from the VM to the MCP server on the host, the server returns a
greeting, and the skill instructs Claude to save it to the user's wiki
folder.

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

In a Cowork session, type `/hello Aunt Mary` or just say
"say hello to my Aunt Mary". Claude should call the hello tool and
write a greeting file to your selected wiki folder.

## Development

See [CLAUDE.md](./CLAUDE.md) for the developer guide.

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

Hello-world scaffold. The architecture is wired up end-to-end with
a trivial example. Real genealogy provider integrations come next.

## License

MIT
