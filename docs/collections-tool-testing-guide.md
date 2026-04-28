# Collections Tool Testing Guide

This guide walks you through testing the `collections` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the collections tool does (30 seconds)

The `collections` tool returns FamilySearch record collections that
cover given place IDs. You get it a list of place IDs (which you get
from the `places` tool), and it returns collections with record counts,
person counts, image counts, and date ranges.

This is the first **authenticated** data tool — it requires a valid
FamilySearch login session (obtained via the `login` tool). Under the
hood it calls the lower-level FamilySearch search API to fetch all
~5000 collections in one call, then filters client-side by place ID
chains.

The typical user workflow is:
```
places("Alabama") → get placeId 33 → collections([33]) → list of collections
```

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd ~/cowork-genealogy/mcp-server
npm run build
npm test
```

All tests should pass (including 8 new collections tests). If anything
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
   cd ~/cowork-genealogy/mcp-server
   npx @modelcontextprotocol/inspector node build/index.js
   ```

   Call `login` with your client ID, complete the browser flow, then
   stop the Inspector.

2. Run the smoke test:

   ```bash
   cd ~/cowork-genealogy/mcp-server
   npx tsx scripts/try-collections.ts 33
   ```

   This calls `collectionsTool({ placeIds: [33] })` for Alabama.

3. You should see JSON output with:
   - `placeIds: [33]`
   - `matchingCollections` — a number > 0
   - `collections` — an array of objects, each with `id`, `title`,
     `dateRange`, `placeIds`, `recordCount`, `personCount`,
     `imageCount`, and `url`

4. Try multiple place IDs:

   ```bash
   npx tsx scripts/try-collections.ts 33,325
   ```

   This should return collections for both Alabama (33) and
   England (325). The count should be higher than either alone.

5. Try a place ID that has no collections:

   ```bash
   npx tsx scripts/try-collections.ts 999999
   ```

   Should return `matchingCollections: 0` and an empty `collections`
   array — no crash.

### What success looks like

You get back structured JSON with real collection data. The `url`
fields should be valid FamilySearch links (try opening one in your
browser).

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("not logged in") | No valid session | Run `login` first via Inspector |
| API returns unexpected shape | API types don't match reality | Compare the raw response to `FSCollectionEntry` in `src/types/collection.ts` and adjust |
| Empty results for known places | placeId chain format doesn't match | Check what the API actually returns for `placeId` field vs what `parsePlaceIdChain` expects |
| `fetch` error or timeout | Network issue or wrong URL | Check the URL constant in `src/tools/collections.ts` |

### When to move on

Move to Layer 1 once the smoke test returns real collections for
place ID 33 (Alabama).

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd ~/cowork-genealogy/mcp-server
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

2. In the Inspector, call **`collections`** with:

   ```json
   { "placeIds": [33] }
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
   { "placeIds": [33] }
   ```

3. Expected response: JSON with `placeIds`, `matchingCollections`, and
   a `collections` array containing Alabama-related collections.

4. Try multiple IDs:

   ```json
   { "placeIds": [33, 325] }
   ```

   Should return collections covering Alabama and/or England.

5. Try a non-existent place ID:

   ```json
   { "placeIds": [999999] }
   ```

   Should return `matchingCollections: 0` with an empty array — not an
   error.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without auth: clear error message directing to login.
- With auth: structured collection data returned.
- Non-matching IDs: empty result, no crash.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check import + ListTools + CallTool blocks |
| Auth error despite being logged in | Token expired, cache issue | Log out and log in again |
| Unexpected error shape | API response doesn't match types | Check the smoke test output and adjust types |

### When to move on

Move to Layer 2 when Part B works — you can get collections for real
place IDs through the Inspector.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand the two-step workflow
(places → collections)?

### Steps

1. Open a terminal and create a scratch folder:

   ```bash
   mkdir -p ~/mcp-test-scratch
   cd ~/mcp-test-scratch
   ```

2. Register the server with Claude Code (if not already):

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node /home/<your-wsl-user>/cowork-genealogy/mcp-server/build/index.js
   ```

3. Start Claude Code:

   ```bash
   claude
   ```

4. Make sure you have a valid session. If needed:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

5. Test the natural two-step workflow:

   > "What FamilySearch record collections cover Alabama?"

6. Watch what Claude does:
   - Claude should call `places` with query "Alabama" to get the
     place ID (33).
   - Claude should then call `collections` with `placeIds: [33]`.
   - Claude should present the results — collection names, record
     counts, date ranges.

7. Test a multi-place query:

   > "Find collections that cover England."

8. Test a place that Claude needs to disambiguate:

   > "What collections are available for Madison?"

   Claude should call `places("Madison")`, see multiple results
   (Madison County in various states, Madison city, etc.), and either
   pick the most relevant one or ask you to clarify.

### What success looks like

Claude chains `places` → `collections` without being told the
explicit steps. It presents the collection data clearly.

### What failure looks like

- Claude calls `collections` without calling `places` first → the
  tool descriptions may need to be stronger about the workflow.
- Claude doesn't use `collections` at all → the tool description
  doesn't match the user's natural language.
- Claude passes a place name instead of IDs to `collections` → the
  `placeIds` parameter description needs clarification.
- Claude calls `collections` but gets an auth error and doesn't
  recover → the auth error message should tell Claude to call `login`.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd ~/cowork-genealogy/mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully drives the places →
collections workflow from natural language.

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

**Prerequisite:** Claude Desktop installed, configured with the
`genealogy-dev` server entry pointing to WSL2 (see the
[OAuth Testing Guide](./oauth-tool-testing-guide.md) Layer 3a for
setup instructions — the config is the same).

### Steps

1. FULLY restart Claude Desktop if you changed the server config
   or rebuilt.

2. Open a Cowork session.

3. Make sure you're logged in:

   > "What's my FamilySearch auth status?"

   If not logged in:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

4. Test the collections workflow:

   > "What FamilySearch collections cover Alabama?"

5. Verify Claude:
   - Calls `places` to resolve "Alabama" → place ID 33
   - Calls `collections` with `[33]`
   - Presents collection names, record counts, date ranges

6. Test a second query to verify caching doesn't break anything:

   > "Now show me collections for England."

### What success looks like

Same as Layer 2, but running through the full Cowork → Claude
Desktop → WSL2 → MCP server pipeline.

### What failure looks like

- Claude doesn't see the tools → config typo or Claude Desktop
  wasn't fully restarted.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- Auth error despite logging in → token file path mismatch between
  WSL2 and Windows.

### When to move on

Move to Layer 3b once the WSL2 bridge handles the full places →
collections workflow.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work running natively
on Windows?

**Prerequisite:** See the [OAuth Testing Guide](./oauth-tool-testing-guide.md)
Layer 3b for the full native Windows setup (copy project, npm install,
npm run build, update Claude Desktop config). The same setup applies
here.

### Steps

1. Make sure the native Windows build is up to date:

   ```powershell
   cd C:\Users\<your-windows-user>\cowork-genealogy\mcp-server
   npm run build
   ```

2. Update Claude Desktop config to point to the native build (see
   OAuth guide Layer 3b for the exact config).

3. FULLY restart Claude Desktop.

4. Open Cowork and test:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."
   > "What FamilySearch collections cover Alabama?"

5. Verify the same workflow works as in Layer 3a.

### What success looks like

Same results as Layer 3a, but running natively on Windows.

### What failure looks like

Same issues as Layer 3a, plus potential cross-platform problems.
See the OAuth guide's Layer 3b troubleshooting table.

### You're done when

The places → collections workflow works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Smoke test (Alabama) | `cd mcp-server && npx tsx scripts/try-collections.ts 33` |
| Smoke test (multi) | `cd mcp-server && npx tsx scripts/try-collections.ts 33,325` |
| Run Inspector | `npx @modelcontextprotocol/inspector node build/index.js` |
| Wipe session | `rm -f ~/.familysearch-mcp/tokens.json` |
| Reconnect in Claude Code | `/mcp` |
| Claude Desktop config | Settings → Developer → Edit Config |
| Claude Desktop logs | Settings → Developer → View Logs |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, placeId parsing |
| 1 - Inspector (no auth) | Auth error propagation | Missing/wrong error messages |
| 1 - Inspector (with auth) | Tool through MCP protocol | Schema errors, serialization bugs |
| 2 - Claude Code | LLM chaining (places → collections) | Bad tool descriptions, workflow confusion |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + token path issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
