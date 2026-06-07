# Place Population Tool Testing Guide

This guide walks you through testing the `place_population` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the population tool does (30 seconds)

The `place_population` tool returns historical population data and indexed
record counts for a FamilySearch place. You pass it a `standardPlace` name like
`"Nigeria"` (the `standardPlace` field from `place_search`) and optionally
a year or year range, and it returns population data from multiple sources
(populstat, gapminder) and FamilySearch indexed birth record counts.

This is a **no-auth** tool — it calls the Pop Stats API, a separate
service that must be running on the host. No FamilySearch login needed.

The typical user workflow is:
```
User: "What was the population of Nigeria in 1960?"
Claude: place_search("Nigeria") → standardPlace "Nigeria"
Claude: place_population({ standardPlace: "Nigeria", year: 1960 }) → population data
```

For provinces/towns, the tool automatically resolves country-level data
(gapminder, indexed records) from the parent country:
```
User: "What's the population data for Badakhshan?"
Claude: place_search("Badakhshan") → standardPlace "Badakhshan, Afghanistan"
Claude: place_population({ standardPlace: "Badakhshan, Afghanistan" }) → province data + parent country data
```

**Important:** The Pop Stats API must be running for this tool to work.
Without it, you'll get: `"Population data service is unavailable."`

## Before You Start

### 1. Make sure the MCP server builds and all tests pass

```bash
cd packages/engine/mcp-server
npm install && npm run build
npm test
```

All tests should pass. If anything is red, fix it first.

### 2. Start the Pop Stats API

The population tool calls the Pop Stats API. Start it in a separate
terminal:

```bash
cd ~/familysearch/search-agent-tools/pop-stats-api
uv run uvicorn api.app:app --port 8000
```

Verify it's running:

```bash
curl "http://localhost:8000/population?place_id=1927069&year=1960"
```

You should get JSON with Nigeria's population data. Keep this terminal
open throughout testing.

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live
Pop Stats API?

This bypasses the MCP harness entirely and calls the tool function
directly. It's the fastest way to catch API response shape mismatches.

### Steps

1. Make sure the Pop Stats API is running (see "Before You Start").

2. Run the smoke tests:

   ```bash
   cd packages/engine/mcp-server
   npx tsx dev/try-population.ts "Nigeria"
   ```

   This calls `populationTool({ standardPlace: "Nigeria" })` — all data
   for Nigeria.

3. You should see JSON output with:
   - `place` — object with `place_id`, `name`, `level`
   - `population` — object keyed by source (`populstat`, `gapminder`)
   - `indexed_records` — object keyed by source (`familysearch_births`)

4. Try with a specific year:

   ```bash
   npx tsx dev/try-population.ts "Nigeria" --year 1960
   ```

   Should return 1960 data for Nigeria.

5. Try a province (parent resolution):

   ```bash
   npx tsx dev/try-population.ts "Badakhshan, Afghanistan" --year 1900
   ```

   This is Badakhshan, Afghanistan. Should return:
   - Province-level populstat data (with nearest-year fallback)
   - Country-level gapminder data with `level: "country"` and
     `place` pointing to Afghanistan
   - Country-level indexed records with parent place info

6. Try a year range:

   ```bash
   npx tsx dev/try-population.ts "Nigeria" --year-start 1900 --year-end 1950
   ```

   Should return multiple data points within that range.

### What success looks like

You get back structured JSON with real population data. The `source_url`
fields should be valid URLs (try opening one in your browser).

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Population data service is unavailable" | Pop Stats API not running | Start it: `uv run uvicorn api.app:app --port 8000` |
| "Population API error: 404" | `standardPlace` resolved to a place not in the Pop Stats database | Use a place name that matches the indexed data |
| Empty population/indexed_records | Place not in the database | Check `data/matches/` for places with data |
| Connection refused | Wrong port or API not running | Check the API is on port 8000 |

### When to move on

Move to Layer 1 once the smoke test returns real data for Nigeria and
a province.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd packages/engine/mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Look at the tools list. You should see **seven** tools:
- `wikipedia_search`
- `place_search`
- `login`
- `logout`
- `auth_status`
- `collections_search`
- `place_population`

If `place_population` is missing, check that `src/index.ts` imports and
registers it.

### Part A — Pop Stats API not running (error message)

1. Stop the Pop Stats API if it's running.

2. In the Inspector, call **`place_population`** with:

   ```json
   { "standardPlace": "Nigeria" }
   ```

3. Expected response: an error with `isError: true` and a message like:

   ```
   Population data service is unavailable. Is the Pop Stats API running?
   ```

   This confirms the error handling works when the backend is down.

### Part B — Happy path

1. Start the Pop Stats API in a separate terminal.

2. In the Inspector, call **`place_population`** with:

   ```json
   { "standardPlace": "Nigeria" }
   ```

3. Expected response: JSON with `place`, `population`, and
   `indexed_records` sections.

4. Try with a year filter:

   ```json
   { "standardPlace": "Nigeria", "year": 1960 }
   ```

   Should return 1960-specific data.

5. Try a province:

   ```json
   { "standardPlace": "Badakhshan, Afghanistan" }
   ```

   Should return Badakhshan data with parent resolution for gapminder
   and indexed records.

6. Try with no standardPlace:

   ```json
   {}
   ```

   Should return an error: `"standardPlace is required"`.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without API: clear error about the service being unavailable.
- With API: structured population data returned.
- Missing standardPlace: validation error, no crash.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check import + ListTools + CallTool blocks |
| Unexpected error shape | API response doesn't match types | Check the smoke test output and adjust types |
| Timeout | Pop Stats API slow to start | Wait for "Database initialized" in the API terminal |

### When to move on

Move to Layer 2 when Part B works — you can get population data
through the Inspector.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the
population tool from natural language?

### Steps

1. Open a terminal and create a scratch folder:

   ```bash
   mkdir -p ~/mcp-test-scratch
   cd ~/mcp-test-scratch
   ```

2. Register the server with Claude Code (if not already):

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node /home/judmc/familysearch/cowork-genealogy/packages/engine/mcp-server/build/index.js
   ```

3. Start Claude Code:

   ```bash
   claude
   ```

4. Test the population workflow:

   > "What was the population of Nigeria in 1960?"

5. Watch what Claude does:
   - Claude should call `place_search` with `"Nigeria"` to get the place ID.
   - Claude should call `place_population` with the place ID and year 1960.
   - Claude should present the results — population figures from
     different sources, indexed record counts.

6. Test a province:

   > "What population data is available for Badakhshan, Afghanistan?"

   Claude should call `place_search` then `place_population`, and note that
   gapminder/indexed records come from the parent country.

7. Test a year range:

   > "Show me Nigeria's population from 1900 to 1950."

### What success looks like

Claude calls `place_search` → `place_population` and presents the data clearly,
citing sources and noting when data comes from a parent country.

### What failure looks like

- Claude doesn't use `place_population` at all → the tool description
  doesn't match the user's natural language.
- Claude tries to call `place_population` without calling `place_search` first →
  it guessed a `standardPlace` name instead of looking it up.
- Claude gets "service unavailable" → Pop Stats API isn't running.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd packages/engine/mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully uses the population tool
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

**Prerequisites:**
- Claude Desktop installed on Windows
- Pop Stats API running in WSL2 on port 8000

### Setup

1. Get your WSL distro name. In PowerShell:

   ```powershell
   wsl.exe -l
   ```

2. Get the full path to Node in WSL2:

   ```bash
   which node
   ```

   **WARNING:** Node 22 has networking issues in WSL2 that cause fetch
   requests to time out. Use Node 20 instead:

   ```bash
   nvm install 20
   nvm use 20
   which node
   ```

3. In Claude Desktop, go to **Settings → Developer → Edit Config**.
   Add the `mcpServers` section (keep any existing settings):

   ```json
   {
     "mcpServers": {
       "genealogy-dev": {
         "command": "wsl.exe",
         "args": [
           "-d", "Ubuntu",
           "--cd", "/home/judmc/familysearch/cowork-genealogy/packages/engine/mcp-server",
           "--",
           "/home/judmc/.nvm/versions/node/v20.19.5/bin/node",
           "build/index.js"
         ]
       }
     }
   }
   ```

   **IMPORTANT:** Replace `Ubuntu` with your actual distro name from
   step 1. Use the full path to Node from step 2.

4. FULLY restart Claude Desktop:
   - System tray (bottom right) → right-click Claude icon → Quit
   - Reopen Claude Desktop from the Start menu

5. Look for the **hammer/tools icon** in the chat input area. Click it
   to see available tools — `place_population` should be listed.

   If the hammer icon doesn't appear, check the logs:

   ```powershell
   Get-ChildItem -Path "$env:LOCALAPPDATA\Claude\logs" -Filter "mcp*" -ErrorAction SilentlyContinue
   ```

### Steps

1. Make sure the Pop Stats API is running in WSL2.

2. Open a Cowork session.

3. Test the population workflow:

   > "What was the population of Nigeria in 1960?"

4. Verify Claude calls `place_search` → `place_population` and presents the data.

5. Test a second query:

   > "What population data is available for Afghanistan?"

### What success looks like

Claude calls `place_population({ standardPlace: "Nigeria", year: 1960 })` and
returns Nigeria's population data, running through the full Cowork →
Claude Desktop → WSL2 → MCP server → Pop Stats API pipeline.

### What failure looks like

- Claude doesn't see the tools → config typo or Claude Desktop
  wasn't fully restarted. Check distro name matches `wsl.exe -l`.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- "Population data service is unavailable" → Pop Stats API not
  running in WSL2, or MCP server can't reach localhost:8000.
- No MCP log files at all → the server never started. Verify the
  config paths are correct.

### Debugging

Test that the MCP server can start manually from WSL2:

```bash
cd /home/judmc/familysearch/cowork-genealogy/packages/engine/mcp-server
node build/index.js
```

It should hang waiting for input (Ctrl+C to exit). If it crashes,
fix the error before continuing.

Test that `wsl.exe` can invoke it from PowerShell:

```powershell
wsl.exe -d Ubuntu --cd /home/judmc/familysearch/cowork-genealogy/packages/engine/mcp-server -- /home/judmc/.nvm/versions/node/v20.19.5/bin/node build/index.js
```

Should also hang. If it errors, the problem is in the config.

### When to move on

Move to Layer 3b once the WSL2 bridge handles the population
workflow.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work running natively
on Windows?

**Prerequisites:**
- Node.js installed on Windows (not just in WSL2)
- Pop Stats API accessible (running in WSL2 on localhost:8000 —
  WSL2 ports are forwarded to Windows by default)

### Steps

1. Open PowerShell and verify Node is installed:

   ```powershell
   node --version
   ```

   If not installed, download from https://nodejs.org/

2. Build the MCP server from Windows:

   ```powershell
   cd \\wsl$\Ubuntu\home\judmc\familysearch\cowork-genealogy\packages\engine\mcp-server
   npm install
   npm run build
   ```

3. Update Claude Desktop config (**Settings → Developer → Edit Config**):

   ```json
   {
     "mcpServers": {
       "genealogy-native": {
         "command": "node",
         "args": [
           "\\\\wsl$\\Ubuntu\\home\\judmc\\familysearch\\cowork-genealogy\\packages\\engine\\mcp-server\\build\\index.js"
         ]
       }
     }
   }
   ```

   **NOTE:** Remove the WSL2 entry while testing this layer.

4. FULLY restart Claude Desktop.

5. Open Cowork and test:

   > "What was the population of Nigeria in 1960?"

6. Verify the same results as Layer 3a.

### What success looks like

Same results as Layer 3a, but running natively on Windows.

### What failure looks like

Same issues as Layer 3a, plus potential cross-platform problems:

| Problem | Fix |
|---------|-----|
| Build fails on Windows | Check for Linux-specific code |
| `npx` not found in config | Use `npx.cmd` on Windows |
| Can't reach Pop Stats API | Verify WSL2 port forwarding works |

### You're done when

The population workflow works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd packages/engine/mcp-server && npm run build` |
| Run tests | `cd packages/engine/mcp-server && npm test` |
| Start Pop Stats API | `cd pop-stats-api && uv run uvicorn api.app:app --port 8000` |
| Smoke test (Nigeria) | `cd packages/engine/mcp-server && npx tsx dev/try-population.ts "Nigeria"` |
| Smoke test (year) | `cd packages/engine/mcp-server && npx tsx dev/try-population.ts "Nigeria" --year 1960` |
| Smoke test (province) | `cd packages/engine/mcp-server && npx tsx dev/try-population.ts "Badakhshan, Afghanistan" --year 1900` |
| Run Inspector | `cd packages/engine/mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Reconnect in Claude Code | `/mcp` |
| Claude Desktop config | Settings → Developer → Edit Config |
| Claude Desktop logs | Settings → Developer → View Logs |
| Check WSL distro name | `wsl.exe -l` (in PowerShell) |
| Get Node path (WSL) | `which node` |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, connection issues |
| 1 - Inspector (no API) | Error handling when backend is down | Missing/wrong error messages |
| 1 - Inspector (with API) | Tool through MCP protocol | Schema errors, serialization bugs |
| 2 - Claude Code | LLM tool selection + presentation | Bad descriptions, workflow confusion |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + port forwarding issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
