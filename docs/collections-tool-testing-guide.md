# Collections Tool Testing Guide

This guide walks you through testing the `collections` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the collections tool does (30 seconds)

The `collections` tool returns FamilySearch record collections that
match a place name. You pass it a query like `"Alabama"` and it
returns collections whose titles contain that string, with record
counts, person counts, image counts, and date ranges.

This is the first **authenticated** data tool — it requires a valid
FamilySearch login session (obtained via the `login` tool). Under the
hood it calls the lower-level FamilySearch search API to fetch all
~3400 collections in one call, caches for 1 hour, then filters
client-side by title.

The typical user workflow is:
```
User: "What collections cover Alabama?"
Claude: collections({ query: "Alabama" }) → 29 collections
```

For ambiguous place names, Claude can use `places` first to
disambiguate, then pass the resolved name to `collections`:
```
User: "What collections cover Madison?"
Claude: places("Madison") → multiple results → ask user which one
Claude: collections({ query: "Alabama" }) → Alabama collections
```

**Note:** The `places` tool and `collections` tool use different
place ID systems. The `query` parameter (place name) is the primary
way to search collections. A `placeIds` parameter exists for internal
collection IDs, but these are NOT the same IDs the `places` tool
returns.

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (including 13 collections tests). If anything
is red, fix it first.

### 2. You need a valid FamilySearch session

The `collections` tool requires authentication. You must be able to
log in via the `login` tool first. If you haven't tested OAuth yet,
complete the [OAuth Testing Guide](./oauth-tool-testing-guide.md)
through at least Layer 1 Part C before continuing.

You'll need:
- A FamilySearch developer app with a registered client ID
- The redirect URI `http://127.0.0.1:1837/callback` registered on
  your FS app
- A FamilySearch account you can log in with

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live API?

This bypasses the MCP harness entirely and calls the tool function
directly. It's the fastest way to catch API response shape mismatches.

### Steps

1. Make sure you're logged in (you should have `~/.familysearch-mcp/tokens.json`
   from a previous `login` call). If not:

   ```bash
   cd mcp-server
   npx @modelcontextprotocol/inspector node build/index.js
   ```

   Call `login` with your client ID, complete the browser flow, then
   stop the Inspector.

2. Run the smoke test:

   ```bash
   cd mcp-server
   npx tsx scripts/try-collections.ts Alabama
   ```

   This calls `collectionsTool({ query: "Alabama" })`.

3. You should see JSON output with:
   - `query: "Alabama"`
   - `matchingCollections` — a number > 0 (expect ~29)
   - `collections` — an array of objects, each with `id`, `title`,
     `dateRange`, `placeIds`, `recordCount`, `personCount`,
     `imageCount`, and `url`

4. Try another place:

   ```bash
   npx tsx scripts/try-collections.ts England
   ```

   Should return England-related collections.

5. Try a query that matches nothing:

   ```bash
   npx tsx scripts/try-collections.ts xyznonexistent
   ```

   Should return `matchingCollections: 0` and an empty `collections`
   array — no crash.

6. (Optional) Try the placeIds mode with internal IDs:

   ```bash
   npx tsx scripts/try-collections.ts --ids 33
   ```

   Should return the same Alabama collections.

### What success looks like

You get back structured JSON with real collection data. The `url`
fields should be valid FamilySearch links (try opening one in your
browser).

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("not logged in") | No valid session | Run `login` first via Inspector |
| 403 "blocked by security service" | Missing User-Agent header | Check that `User-Agent` header is set in `fetchAllCollections` |
| API returns unexpected shape | API types don't match reality | Compare the raw response to types in `src/types/collection.ts` and adjust |
| Empty results for known places | Title matching not working | Check that the query matches the collection title (case-insensitive) |
| `fetch` error or timeout | Network issue or wrong URL | Check the URL constant in `src/tools/collections.ts` |

### When to move on

Move to Layer 1 once the smoke test returns real collections for
Alabama.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Look at the tools list. You should see **six** tools:
- `wikipedia_search`
- `places`
- `login`
- `logout`
- `auth_status`
- `collections`

If `collections` is missing, check that `src/index.ts` imports and
registers it.

### Part A — Not authenticated (error message)

1. Wipe any existing session:

   ```bash
   rm -f ~/.familysearch-mcp/tokens.json
   ```

   On Windows PowerShell:

   ```powershell
   Remove-Item $env:USERPROFILE\.familysearch-mcp\tokens.json
   ```

2. In the Inspector, call **`collections`** with:

   ```json
   { "query": "Alabama" }
   ```

3. Expected response: an error with `isError: true` and a message like:

   ```
   User is not logged in to FamilySearch. Call the login tool to authenticate.
   ```

   This confirms auth error propagation works. The message is an
   LLM instruction — Claude will understand it means it should call
   `login` first.

### Part B — Authenticated (happy path)

1. In the Inspector, call **`login`** with your client ID. Complete the
   browser flow.

2. Call **`collections`** with:

   ```json
   { "query": "Alabama" }
   ```

3. Expected response: JSON with `query`, `matchingCollections`, and
   a `collections` array containing Alabama-related collections.

4. Try another place:

   ```json
   { "query": "England" }
   ```

   Should return England collections.

5. Try a query that matches nothing:

   ```json
   { "query": "xyznonexistent" }
   ```

   Should return `matchingCollections: 0` with an empty array — not an
   error.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without auth: clear error message directing to login.
- With auth: structured collection data returned.
- Non-matching queries: empty result, no crash.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check import + ListTools + CallTool blocks |
| Auth error despite being logged in | Token expired, cache issue | Log out and log in again |
| Unexpected error shape | API response doesn't match types | Check the smoke test output and adjust types |

### When to move on

Move to Layer 2 when Part B works — you can get collections for real
place names through the Inspector.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the
collections tool from natural language?

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

2. Register the server with Claude Code (if not already):

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node /path/to/cowork-genealogy/mcp-server/build/index.js
   ```

3. Start Claude Code:

   ```bash
   claude
   ```

4. Make sure you have a valid session. If needed:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

5. Test the collections query:

   > "What FamilySearch record collections cover Alabama?"

6. Watch what Claude does:
   - Claude should call `collections` with `query: "Alabama"`.
   - Claude should present the results — collection names, record
     counts, date ranges.
   - Claude should NOT need to call `places` first (the query
     parameter takes a name directly).

7. Test another place:

   > "Find collections that cover England."

8. Test a place that might need disambiguation:

   > "What collections are available for Madison?"

   Claude may call `places("Madison")` first to disambiguate, then
   call `collections` with the resolved state or country name.

### What success looks like

Claude calls `collections({ query: "Alabama" })` and presents the
collection data clearly — categorized, with counts and date ranges.

### What failure looks like

- Claude doesn't use `collections` at all → the tool description
  doesn't match the user's natural language.
- Claude tries to pass place IDs from the `places` tool → the schema
  description should clarify these are different ID systems.
- Claude calls `collections` but gets an auth error and doesn't
  recover → the auth error message should tell Claude to call `login`.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully uses the collections tool
from natural language.

---

## Choose Your Layer 3 Order

Layers 1 and 2 are platform-agnostic — everyone runs them. Layer 3
splits by where Cowork's MCP server runs, and **both sub-layers are
required**:

| Your dev environment | Run first | Then |
|----------------------|-----------|------|
| WSL2 | Layer 3a (WSL2) | Layer 3b (Native Windows) |
| Native Windows | Layer 3b (Native Windows) | Layer 3a (WSL2) |

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
        "--cd", "/mnt/c/path/to/cowork-genealogy/mcp-server",
        "--",
        "/usr/bin/node",
        "build/index.js"
      ]
    }
  }
}
```

Adjust the distro name, path, and node path for your setup. Use
`wsl.exe -l` to find your distro name and `wsl.exe -- which node`
to find the node path.

**Important:** Remove or rename any native Windows MCP server entry
while testing this layer, so you know the WSL2 bridge is being used.

### Steps

1. FULLY restart Claude Desktop if you changed the server config
   or rebuilt (system tray → right-click → Quit → reopen).

2. Open a Cowork session.

3. Make sure you're logged in:

   > "What's my FamilySearch auth status?"

   If not logged in:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

4. Test the collections workflow:

   > "What FamilySearch collections cover Alabama?"

5. Verify Claude calls `collections` with `query: "Alabama"` and
   presents collection names, record counts, and date ranges.

6. Test a second query to verify caching doesn't break anything:

   > "Now show me collections for England."

### What success looks like

Claude calls `collections({ query: "Alabama" })` and returns 29
Alabama collections, running through the full Cowork → Claude
Desktop → WSL2 → MCP server pipeline.

### What failure looks like

- Claude doesn't see the tools → config typo or Claude Desktop
  wasn't fully restarted.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- Auth error despite logging in → token file path mismatch between
  WSL2 and Windows.

### When to move on

Move to Layer 3b once the WSL2 bridge handles the collections
workflow.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work running natively
on Windows?

**Prerequisite:** Claude Desktop configured with a native Windows
MCP server entry:

```json
{
  "mcpServers": {
    "genealogy-native": {
      "command": "node",
      "args": [
        "C:\\path\\to\\cowork-genealogy\\mcp-server\\build\\index.js"
      ]
    }
  }
}
```

**Important:** Remove or rename any WSL2 MCP server entry while
testing this layer.

### Steps

1. Make sure the native Windows build is up to date:

   ```powershell
   cd C:\path\to\cowork-genealogy\mcp-server
   npm run build
   ```

2. FULLY restart Claude Desktop.

3. Open Cowork and test:

   > "What's my FamilySearch auth status?"

   If not logged in:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

   Then:

   > "What FamilySearch collections cover Alabama?"

4. Verify the same results as Layer 3a.

### What success looks like

Same results as Layer 3a, but running natively on Windows.

### What failure looks like

Same issues as Layer 3a, plus potential cross-platform problems:

| Problem | Fix |
|---------|-----|
| Build fails on Windows | Check for Linux-specific code |
| Server crashes on startup | Check for hardcoded paths |
| `npx` not found in config | Use `npx.cmd` on Windows |

### You're done when

The collections workflow works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Smoke test (Alabama) | `cd mcp-server && npx tsx scripts/try-collections.ts Alabama` |
| Smoke test (England) | `cd mcp-server && npx tsx scripts/try-collections.ts England` |
| Smoke test (internal IDs) | `cd mcp-server && npx tsx scripts/try-collections.ts --ids 33` |
| Run Inspector | `cd mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Wipe session (Linux/WSL) | `rm -f ~/.familysearch-mcp/tokens.json` |
| Wipe session (PowerShell) | `Remove-Item $env:USERPROFILE\.familysearch-mcp\tokens.json` |
| Reconnect in Claude Code | `/mcp` |
| Claude Desktop config | Settings → Developer → Edit Config |
| Claude Desktop logs | Settings → Developer → View Logs |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, WAF blocks, title matching |
| 1 - Inspector (no auth) | Auth error propagation | Missing/wrong error messages |
| 1 - Inspector (with auth) | Tool through MCP protocol | Schema errors, serialization bugs |
| 2 - Claude Code | LLM tool selection + presentation | Bad descriptions, workflow confusion |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + token path issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
