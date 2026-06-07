# Wiki Search Tool Testing Guide

This guide walks you through testing the `wiki_search` tool before
opening the PR. Follow each layer in order. Don't skip ahead — each
layer catches different problems.

## What the wiki_search tool does (30 seconds)

The `wiki_search` tool answers natural-language genealogy questions by
searching the FamilySearch Wiki. You pass it a query like
`"How do I find Italian birth records?"` and it returns up to 20
ranked wiki sections, each with the section text, page title, heading,
and a direct source URL.

This tool is a **thin HTTP wrapper**. The actual retrieval pipeline
(OpenAI embedding → Milvus hybrid search → VoyageAI rerank) lives in a
separate FastAPI server called `wiki-query-api`. The MCP tool just
POSTs the query to that server and returns the JSON unchanged.

Unlike `collections_search`, this tool **does not require FamilySearch
authentication** in v1. It does, however, require:

1. The `wiki-query-api` FastAPI server running locally (or wherever
   `wikiApiUrl` points).
2. A `wikiApiUrl` field in `~/.familysearch-mcp/config.json` pointing
   at it.

The typical user workflow is:
```
User: "How do I find Italian birth records?"
Claude: wiki_search({ query: "How do I find Italian birth records?" })
        → ranked wiki sections with source URLs
```

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd packages/engine/mcp-server
npm run build
npm test
```

All tests should pass (including the `wiki_search` unit tests). If
anything is red, fix it first.

### 2. Start the wiki-query-api FastAPI server

The `wiki_search` tool calls a separate Python server. You **must**
have it running before any of the layers below will work.

In a separate terminal, from the `wiki-query-api` repo:

```bash
cd /path/to/wiki-query-api
python scripts/wiki/30_serve.py
```

The server should start on `http://localhost:8000`. Confirm with:

```bash
curl http://localhost:8000/health
```

(or open the URL in a browser — you should get a 200, not a connection
refused).

Leave this server running for the rest of the testing session.

### 3. Configure the MCP to point at the API

Create or edit `~/.familysearch-mcp/config.json`:

```json
{
  "wikiApiUrl": "http://localhost:8000"
}
```

Lock it down:

```bash
chmod 600 ~/.familysearch-mcp/config.json
```

On Windows PowerShell:

```powershell
notepad $env:USERPROFILE\.familysearch-mcp\config.json
```

(Windows file ACLs handle the equivalent of `0600` automatically when
you create the file under your own profile.)

If the file already exists for FamilySearch auth (`clientId`), just
add the `wikiApiUrl` field alongside it. Don't replace the whole file.

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live
FastAPI server?

This bypasses the MCP harness entirely and calls the tool function
directly. It's the fastest way to catch upstream API shape mismatches
or config problems.

### Steps

1. Confirm the FastAPI server is running (see "Before You Start").

2. Run the smoke test:

   ```bash
   cd packages/engine/mcp-server
   npx tsx dev/try-wiki-search.ts "How do I find Italian birth records?"
   ```

3. You should see JSON output with:
   - `query` — echoes your question
   - `total_chunks_searched` — a large number (~1.2M)
   - `results` — an array of up to 20 objects, each with `rank`,
     `relevance_score`, `chunk_text`, `page_title`, `section_heading`,
     and `source_url`
   - `query_time_ms` — total latency
   - `timing` — `{ embed_ms, search_ms, rerank_ms }`

4. Try a different question:

   ```bash
   npx tsx dev/try-wiki-search.ts "How do I research German immigration to the US?"
   ```

   Should return German immigration / emigration wiki sections.

5. Try a deliberately weird query:

   ```bash
   npx tsx dev/try-wiki-search.ts "purple monkey dishwasher"
   ```

   Should return either an empty `results` array or only very
   low-relevance hits filtered out by the 0.5 reranker threshold —
   no crash, no error.

6. (Optional) Try the default query (no argument):

   ```bash
   npx tsx dev/try-wiki-search.ts
   ```

   Defaults to `"How do I find Italian birth records?"`.

### What success looks like

Real wiki sections come back, with `source_url` fields you can open in
a browser to verify the page exists.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `"wiki-query-api MCP not configured..."` | `wikiApiUrl` missing from config | Add it to `~/.familysearch-mcp/config.json` |
| `"Could not reach wiki-query-api at ..."` | FastAPI server isn't running | Start it (`python scripts/wiki/30_serve.py`) |
| `wiki-query-api error: 5xx` | Upstream server crashed mid-request | Check the FastAPI terminal for the traceback |
| Result shape doesn't match spec | Upstream API drifted | Compare to types in `src/types/wiki-search.ts` and adjust |
| Empty results for clearly relevant query | Reranker threshold too aggressive, or index empty | Verify the FastAPI was started with the indexed Milvus collection |
| Fast but irrelevant results | Embedding model mismatch upstream | Coordinate with upstream `wiki-query-api` repo |

### When to move on

Move to Layer 1 once the smoke test returns real, relevant wiki
sections for the Italian birth records query.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd packages/engine/mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

The first time you run this, npm will download the Inspector — it can
take 30–60 seconds. A browser tab should open automatically at a URL
like `http://127.0.0.1:6274`. If it doesn't open on its own, copy the
URL from the terminal output and paste it into your browser.

#### Networking gotchas worth knowing up front

The Inspector runs **two** local servers — both must be reachable
from your browser:

| Port | Role |
|------|------|
| 6274 | UI (the page you load in the browser) |
| 6277 | Proxy (the UI's JS calls this to talk to your MCP server) |

If 6277 is unreachable, the UI loads fine but Connect fails with
"Error Connecting to MCP Inspector Proxy" and the browser console
shows `ERR_CONNECTION_REFUSED` to `:6277/config` and `:6277/health`.

**Three things go wrong here, in order of frequency:**

1. **Missing auth token.** Inspector v0.15+ requires a session
   token. The terminal prints a URL like
   `http://127.0.0.1:6274/?MCP_PROXY_AUTH_TOKEN=<long-string>` —
   open that one. Visiting bare `127.0.0.1:6274` loads the UI but
   fails on Connect.

2. **`localhost` resolves to IPv6.** The proxy binds to IPv4 only
   (`127.0.0.1:6277`), but most browsers resolve `localhost` to
   IPv6 (`[::1]`). If the URL says `localhost`, change it to
   `127.0.0.1` in the address bar before pressing Enter.

3. **Browser is on a different machine than the Inspector.**
   Common when SSH'd into a remote dev box, or when the dev box is
   WSL2 and the browser is on Windows. The proxy binds to
   `127.0.0.1` on the *remote* machine, but the browser hits
   `127.0.0.1` on the *local* machine. Two loopbacks, two different
   things. Pick one of:

   - **SSH port-forward both ports.** Forwarding only 6274 isn't
     enough; the UI's JS also needs 6277:

     ```bash
     ssh -L 6274:127.0.0.1:6274 -L 6277:127.0.0.1:6277 user@dev-box
     ```

     In VS Code Remote: open the **Ports** panel, click "Forward a
     Port", add **6277** manually. 6274 is usually auto-forwarded.

   - **Bind the Inspector to all interfaces.** Restart with
     `HOST=0.0.0.0` and access via the remote box's real IP:

     ```bash
     HOST=0.0.0.0 npx @modelcontextprotocol/inspector node build/index.js
     ```

     Then browse to
     `http://<remote-machine-ip>:6274/?MCP_PROXY_AUTH_TOKEN=...`.
     Find the IP with `hostname -I` on the remote machine.

   To confirm the bridge works before clicking Connect, from the
   browser machine run:

   ```bash
   curl http://127.0.0.1:6277/health   # SSH-forwarded case
   curl http://<remote-ip>:6277/health # HOST=0.0.0.0 case
   ```

   Any 2xx (or even a 401) means the proxy is reachable. Connection
   refused means the port isn't bridged yet.

#### Configuring the connection

When the Inspector loads you'll see a left-hand form with **Transport
Type**, **Command**, and **Arguments** fields. Ideally these are
pre-filled from the CLI args. If you see `mcp-server-everything` or
some other placeholder in the Command field, the auto-fill didn't
happen — fill the fields in manually:

| Field | Value |
|-------|-------|
| Transport Type | `STDIO` |
| Command | `node` |
| Arguments | the **absolute path** to your built server, e.g. `/home/you/cowork-genealogy/packages/engine/mcp-server/build/index.js` (Windows: `C:\path\to\cowork-genealogy\packages\engine\mcp-server\build\index.js`) |

Use an absolute path. Relative paths are evaluated against the
Inspector's working directory, which isn't always the terminal you
launched it from.

Click **Connect**. The "Disconnected" indicator should switch to
"Connected" and the right side of the screen should show a tools
list.

#### Verify the tools list

Look at the tools list. You should see **seven** tools:
- `wikipedia_search`
- `place_search`
- `login`
- `logout`
- `auth_status`
- `collections_search`
- `wiki_search` ← the new one

If `wiki_search` is missing, check that `src/index.ts` imports and
registers it in both the `ListToolsRequestSchema` handler and the
`CallToolRequestSchema` handler.

### Part A — Config missing (error message)

1. Temporarily move the config file aside:

   ```bash
   mv ~/.familysearch-mcp/config.json ~/.familysearch-mcp/config.json.bak
   ```

   On Windows PowerShell:

   ```powershell
   Rename-Item $env:USERPROFILE\.familysearch-mcp\config.json config.json.bak
   ```

2. In the Inspector, call **`wiki_search`** with:

   ```json
   { "query": "How do I find Italian birth records?" }
   ```

3. Expected response: an error with `isError: true` and a message that
   tells Claude exactly what to do, something like:

   ```
   wiki-query-api MCP not configured. Create ~/.familysearch-mcp/config.json with { "wikiApiUrl": "http://localhost:8000" } and start the wiki-query-api server.
   ```

   This confirms the LLM-instruction error path works.

4. Restore the config:

   ```bash
   mv ~/.familysearch-mcp/config.json.bak ~/.familysearch-mcp/config.json
   ```

### Part B — Server not running (error message)

1. Stop the FastAPI server (Ctrl+C in its terminal).

2. In the Inspector, call **`wiki_search`** with:

   ```json
   { "query": "How do I find Italian birth records?" }
   ```

3. Expected response: an error with `isError: true` and a message like:

   ```
   Could not reach wiki-query-api at http://localhost:8000. Is the server running?
   ```

4. Restart the FastAPI server before continuing.

### Part C — Happy path

1. Confirm the FastAPI server is running.

2. In the Inspector, call **`wiki_search`** with:

   ```json
   { "query": "How do I find Italian birth records?" }
   ```

3. Expected response: structured JSON matching the spec — `query`,
   `total_chunks_searched`, `results` array, `query_time_ms`, `timing`.

4. Try a different question:

   ```json
   { "query": "How do I research my Irish ancestors?" }
   ```

   Should return Ireland-related wiki sections.

5. Try a query with no good matches:

   ```json
   { "query": "purple monkey dishwasher" }
   ```

   Should return either an empty `results` array or a very small one
   — not an error.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without config: clear error message telling Claude how to fix it.
- Without server running: clear error message telling Claude to start
  the server.
- With everything working: structured wiki search results returned.
- Irrelevant queries: empty result, no crash.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check import + ListTools + CallTool blocks |
| Cryptic error instead of LLM-instruction message | Error path threw a generic error | Check `getWikiApiUrl()` and the network catch in `wikiSearch()` |
| Schema validation error in Inspector | `inputSchema` mismatch | Match the `inputSchema` shape from `wiki-search.ts` |

### When to move on

Move to Layer 2 when Part C works — you can search the wiki for real
queries through the Inspector.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the
wiki_search tool from natural language?

### Steps

1. Open a terminal and create a scratch folder:

   ```bash
   mkdir -p ~/mcp-test-scratch
   cd ~/mcp-test-scratch
   ```

   On Windows PowerShell:

   ```powershell
   mkdir -Force $env:USERPROFILE\mcp-test-scratch
   cd $env:USERPROFILE\mcp-test-scratch
   ```

2. Register the server with Claude Code (if not already). **Replace
   `<ABSOLUTE_PATH_TO_REPO>` with the absolute path to your clone**
   — pasting the placeholder verbatim will register a non-existent
   file and `claude mcp list` will show `✗ Failed to connect`:

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node <ABSOLUTE_PATH_TO_REPO>/packages/engine/mcp-server/build/index.js
   ```
   
   /home/promise/familysearch/genealogy/cowork-genealogy/packages/engine/mcp-server

   Verify with:

   ```bash
   claude mcp list | grep genealogy-dev
   ```

   You want `✓ Connected`. If you see `✗ Failed to connect`, run
   `claude mcp remove genealogy-dev` and re-add with the correct
   path.

3. Confirm the FastAPI server is running on `localhost:8000`.

4. Start Claude Code:

   ```bash
   claude
   ```

5. Test a clear "how do I research" question:

   > "How do I find Italian birth records?"

6. Watch what Claude does:
   - Claude should call `wiki_search` with the query (verbatim or
     close to it).
   - Claude should present the results — wiki section titles, key
     snippets, and source URLs.
   - Claude should NOT call `wikipedia_search` — that's the wrong
     tool for FamilySearch Wiki guidance.
   - Claude should NOT call `place_search` or `collections_search` first — this
     question is about *how* to find records, not which collections
     exist.

7. Test a country-specific research question:

   > "I want to research my German ancestors. Where should I start?"

   Should call `wiki_search` and return Germany research-guidance
   sections.

8. Test a record-type question:

   > "How do I read old church records in Latin?"

   Should call `wiki_search` and return guidance on Latin paleography
   / church records.

9. Test an ambiguous question to see whether Claude picks the right
   tool:

   > "Tell me about Albert Einstein."

   Claude should pick `wikipedia_search` here, NOT `wiki_search`.
   This is a check that the descriptions don't bleed into each other.

10. Test a question Claude shouldn't answer with `wiki_search`:

    > "Show me FamilySearch collections for Alabama."

    Claude should pick `collections_search`, NOT `wiki_search`.

### What success looks like

Claude calls `wiki_search` for genealogy "how-to" questions, presents
the ranked wiki sections clearly with source URLs, and routes other
question types to the correct tool.

### What failure looks like

- Claude doesn't use `wiki_search` at all → the tool description
  doesn't match the user's natural language. Sharpen the
  `description` in `wiki-search.ts`.
- Claude uses `wiki_search` for biographical lookups (Einstein) →
  the description is overlapping with `wikipedia_search`. Add a
  "do NOT use this for general encyclopedia lookups" hint to the
  description.
- Claude uses `wikipedia_search` for genealogy research questions →
  the `wiki_search` description isn't strong enough. Add explicit
  trigger phrases ("how do I find", "research ancestors from", "what
  records are available for").
- Tool runs but returns an error → revisit Layer 1 first.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd packages/engine/mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude reliably picks `wiki_search` for genealogy
research questions and presents the results in a useful way.

---

## Choose Your Layer 3 Order

Layers 0–2 are platform-agnostic — everyone runs them. Layer 3 splits
by where Cowork's MCP server runs, and **both sub-layers are
required**:

| Your dev environment | Run first | Then |
|----------------------|-----------|------|
| WSL2 | Layer 3a (WSL2) | Layer 3b (Native Windows) |
| Native Windows | Layer 3b (Native Windows) | Layer 3a (WSL2) |

### Where the FastAPI server runs in Layer 3

The MCP server calls `wikiApiUrl` (`http://localhost:8000` by default).
That URL has to resolve from wherever the **MCP server** is running —
not from where Claude Desktop runs.

| MCP server runs on... | Start `wiki-query-api` on... | `wikiApiUrl` should be... |
|-----------------------|-------------------------------|----------------------------|
| WSL2 (Layer 3a) | WSL2 (same distro) | `http://localhost:8000` |
| Native Windows (Layer 3b) | Native Windows | `http://localhost:8000` |

Don't try to cross the boundary (e.g., MCP in WSL2 calling FastAPI on
Windows) — `localhost` doesn't reach across by default and you'll
spend an hour on networking instead of testing the tool.

---

## Layer 3a: Cowork via WSL2

**What this tests:** Does the full pipeline work in Cowork, talking
through the WSL2 bridge?

**Prerequisite:** Claude Desktop installed with a WSL2 MCP server
entry. Example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "genealogy-wsl": {
      "command": "wsl.exe",
      "args": [
        "-d", "Ubuntu-22.04",
        "--cd", "/mnt/c/path/to/cowork-genealogy/packages/engine/mcp-server",
        "--",
        "/usr/bin/node",
        "build/index.js"
      ]
    }
  }
}
```

Adjust the distro name, path, and node path for your setup. Use
`wsl.exe -l` to find your distro name and `wsl.exe -- which node` to
find the node path.

**Important:** Remove or rename any native Windows MCP server entry
while testing this layer, so you know the WSL2 bridge is being used.

### Steps

1. In WSL2, start the FastAPI server:

   ```bash
   cd /path/to/wiki-query-api
   python scripts/wiki/30_serve.py
   ```

   Confirm `~/.familysearch-mcp/config.json` (inside WSL2) has
   `"wikiApiUrl": "http://localhost:8000"`.

2. FULLY restart Claude Desktop if you changed the server config or
   rebuilt (system tray → right-click → Quit → reopen).

3. Open a Cowork session.

4. Test a research question:

   > "How do I find Italian birth records?"

5. Verify Claude calls `wiki_search` and returns wiki sections with
   source URLs.

6. Test a second query to verify nothing breaks across calls:

   > "Now show me how to research my Irish ancestors."

### What success looks like

Claude calls `wiki_search({ query: "..." })` and returns ranked wiki
sections, running through the full Cowork → Claude Desktop → WSL2 →
MCP server → WSL2 FastAPI pipeline.

### What failure looks like

- Claude doesn't see the tool → config typo or Claude Desktop wasn't
  fully restarted.
- `Could not reach wiki-query-api at http://localhost:8000` →
  FastAPI isn't running inside WSL2, or `wikiApiUrl` points somewhere
  unreachable from WSL2.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- "wiki-query-api MCP not configured" → the WSL2 home folder is
  different from your Linux user folder; check the actual path of
  `~/.familysearch-mcp/config.json` from inside WSL2.

### When to move on

Move to Layer 3b once the WSL2 bridge handles the wiki_search
workflow.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work running natively on
Windows?

**Prerequisite:** Claude Desktop configured with a native Windows MCP
server entry:

```json
{
  "mcpServers": {
    "genealogy-native": {
      "command": "node",
      "args": [
        "C:\\path\\to\\cowork-genealogy\\packages\\engine\\mcp-server\\build\\index.js"
      ]
    }
  }
}
```

**Important:** Remove or rename any WSL2 MCP server entry while
testing this layer.

### Steps

1. In a Windows shell, start the FastAPI server:

   ```powershell
   cd C:\path\to\wiki-query-api
   python scripts\wiki\30_serve.py
   ```

   Confirm `%USERPROFILE%\.familysearch-mcp\config.json` has
   `"wikiApiUrl": "http://localhost:8000"`.

2. Make sure the native Windows build is up to date:

   ```powershell
   cd C:\path\to\cowork-genealogy\packages\engine\mcp-server
   npm run build
   ```

3. FULLY restart Claude Desktop.

4. Open Cowork and test:

   > "How do I find Italian birth records?"

5. Verify the same results as Layer 3a.

### What success looks like

Same results as Layer 3a, but running natively on Windows.

### What failure looks like

Same issues as Layer 3a, plus potential cross-platform problems:

| Problem | Fix |
|---------|-----|
| Build fails on Windows | Check for Linux-specific code |
| Server crashes on startup | Check for hardcoded paths |
| `npx` not found in config | Use `npx.cmd` on Windows |
| Config file not found | Confirm path is `%USERPROFILE%\.familysearch-mcp\config.json` (not `~/.familysearch-mcp/`) |

### You're done when

The wiki_search workflow works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd packages/engine/mcp-server && npm run build` |
| Run tests | `cd packages/engine/mcp-server && npm test` |
| Start FastAPI server | `cd /path/to/wiki-query-api && python scripts/wiki/30_serve.py` |
| Smoke test (default query) | `cd packages/engine/mcp-server && npx tsx dev/try-wiki-search.ts` |
| Smoke test (custom query) | `cd packages/engine/mcp-server && npx tsx dev/try-wiki-search.ts "your question"` |
| Run Inspector | `cd packages/engine/mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Edit config (Linux/WSL) | `nano ~/.familysearch-mcp/config.json` |
| Edit config (PowerShell) | `notepad $env:USERPROFILE\.familysearch-mcp\config.json` |
| Reconnect in Claude Code | `/mcp` |
| Claude Desktop config | Settings → Developer → Edit Config |
| Claude Desktop logs | Settings → Developer → View Logs |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 - Smoke test | Direct function call vs live FastAPI | Upstream API shape mismatches, config errors, server-not-running |
| 1A - Inspector (no config) | Config-missing error path | Wrong/cryptic error message |
| 1B - Inspector (no server) | Network-error error path | Wrong/cryptic error message |
| 1C - Inspector (happy path) | Tool through MCP protocol | Schema errors, serialization bugs |
| 2 - Claude Code | LLM tool selection + presentation | Bad descriptions, tool overlap with `wikipedia_search` / `collections_search` |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + localhost reachability inside WSL2 |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
