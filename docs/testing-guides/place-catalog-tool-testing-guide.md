# Place Catalog Tool Testing Guide

This guide walks you through testing the `place_catalog` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the catalog tool does (30 seconds)

The `place_catalog` tool searches the FamilySearch Library catalog —
books, microfilms, manuscripts, maps, and periodicals. Most catalog
material is NOT indexed in record collections; it's the right surface
for locality research, unindexed-film discovery, and "what exists
for this place?" questions.

You pass at least one of: `placeId`, `keywords`, `surname`, or
`imageGroupNumber`. The tool internally resolves a `placeId` to one
or more catalog rep IDs, runs parallel searches, unions and deduplicates
the results, and then enriches each hit with three boolean flags:

- `record_searchable` — can be queried by `record_search`
- `fulltext_searchable` — can be queried by `fulltext_search`
- `image_searchable` — images are viewable via `image_read`

A typical user workflow:
```
User: "What catalog materials exist for Alabama?"
Claude: place_search("Alabama") → placeId "33"
Claude: place_catalog({ placeId: "33" }) → hits with 3 flags
```

---

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (327 total, including 30+ catalog tests). If
anything is red, fix it first.

### 2. You need a valid FamilySearch session

`place_catalog` requires authentication. You must be logged in via the
`login` tool. If you haven't tested OAuth yet, complete the
[OAuth Testing Guide](./oauth-tool-testing-guide.md) through at least
Layer 1 Part C before continuing.

You'll need:
- A FamilySearch developer app with a registered client ID
- The redirect URI `http://127.0.0.1:1837/callback` registered on your FS app
- A FamilySearch account you can log in with

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live API?

This bypasses the MCP harness entirely and calls the tool function
directly. It's the fastest way to catch API response shape mismatches,
WAF blocks, and rep-ID resolution failures.

### Steps

1. Make sure you're logged in (you should have
   `~/.familysearch-mcp/tokens.json` from a previous `login` call).
   If not, run the Inspector first:

   ```bash
   cd mcp-server
   npx @modelcontextprotocol/inspector node build/index.js
   ```

   Call `login`, complete the browser flow, then stop the Inspector.

2. Run the smoke test with a known placeId (Alabama = 33):

   ```bash
   cd mcp-server
   npx tsx dev/try-place-catalog.ts --place 33
   ```

3. You should see JSON output with:
   - `placeId: "33"` — echoed back
   - `totalHits` — a number > 0 (expect hundreds for Alabama)
   - `returnedCount` — up to 20 (default page size)
   - `hits` — array of objects, each with:
     - `id` — e.g. `"koha:1234567"`
     - `title` — catalog item title
     - `authors` — array of strings (may be empty)
     - `holdings` — array of strings (library call numbers)
     - `record_searchable`, `fulltext_searchable`, `image_searchable` — booleans
     - `score` — relevance score
     - `url` — `https://www.familysearch.org/search/catalog/<id>`

4. Try keyword search:

   ```bash
   npx tsx dev/try-place-catalog.ts --keywords "civil war"
   ```

   Should return catalog items related to "civil war".

5. Try surname search:

   ```bash
   npx tsx dev/try-place-catalog.ts --surname Butler
   ```

6. Try by image group number:

   ```bash
   npx tsx dev/try-place-catalog.ts --dgs 7937005
   ```

   Should return the specific catalog item associated with that film number.

7. Try combining place + surname:

   ```bash
   npx tsx dev/try-place-catalog.ts --place 33 --surname Griffin
   ```

   Should return Alabama-specific catalog items mentioning Griffin.

8. Try a place that has no catalog rep mapping (should throw a clear error,
   not crash silently):

   ```bash
   npx tsx dev/try-place-catalog.ts --place 99999999
   ```

   Expected: process exits with an error like "placeId 99999999 has no
   catalog rep mapping."

### What success looks like

You get back structured JSON with real catalog items, `url` fields that
open valid FamilySearch pages, and at least some hits where the three
flags are `true`.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("not logged in") | No valid session | Run `login` first via Inspector |
| 403 "blocked by security service" | Missing User-Agent header | Check `BROWSER_USER_AGENT` is sent on all fetch calls |
| `400 FamilySearch catalog rejected` | Wrong upstream query param | Verify `q.place_id` (not `q.placeRepId`) is used in `runCatalogSearch` |
| `placeId X has no catalog rep mapping` | Place too granular or wrong ID | Try a higher-level place (state or country) |
| `totalHits` is ~2M for any query | `m.queryRequireDefault=on` missing | Check URL construction in `runCatalogSearch` |
| All three flags are false on every hit | Item-detail endpoint failing | Check the `CATALOG_ITEM_BASE` URL constant |
| `koha:`/`olib:` prefix missing from id | Regex stripping too aggressively | Review `CATALOG_ID_PREFIX_RE` and `parseHit` |

### When to move on

Move to Layer 1 once you get real hits for Alabama with at least some
flags that differ (not all false).

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Check the tools list — you should see `place_catalog` among the registered
tools. If it's missing, check that `src/index.ts` imports, registers it
in the ListTools array, and has a handler block for it.

### Part A — Not authenticated (error propagation)

1. Wipe any existing session:

   ```bash
   rm -f ~/.familysearch-mcp/tokens.json
   ```

   On Windows PowerShell:

   ```powershell
   Remove-Item $env:USERPROFILE\.familysearch-mcp\tokens.json
   ```

2. Call **`place_catalog`** with:

   ```json
   { "keywords": "Alabama" }
   ```

3. Expected response: `isError: true` with a message:

   ```
   User is not logged in to FamilySearch. Call the login tool to authenticate.
   ```

### Part B — Validation errors

With or without auth, call `place_catalog` with:

```json
{}
```

Expected: `isError: true`, message contains
"at least one of placeId, keywords, surname, or imageGroupNumber is required".

```json
{ "keywords": "test", "count": 0 }
```

Expected: error containing "count must be between 1 and 100. Got: 0."

```json
{ "keywords": "test", "offset": -1 }
```

Expected: error containing "offset must be non-negative. Got: -1."

### Part C — Authenticated (happy path)

1. Call **`login`** from the Inspector. Complete the browser flow.

2. Call **`place_catalog`** with:

   ```json
   { "keywords": "civil war" }
   ```

   Expected: JSON with `totalHits > 0`, `hits` array with objects
   containing all required fields.

3. Call with `placeId`:

   ```json
   { "placeId": "33" }
   ```

   Expected: `placeId: "33"` echoed in output, Alabama-related hits.

4. Call with a very small `count` to test pagination:

   ```json
   { "placeId": "33", "count": 3 }
   ```

   Expected: exactly 3 hits returned, `returnedCount: 3`.

5. Call with `offset`:

   ```json
   { "placeId": "33", "count": 3, "offset": 3 }
   ```

   Expected: next page of 3 hits (different titles from the first page).

6. Call with `imageGroupNumber`:

   ```json
   { "imageGroupNumber": "7937005" }
   ```

   Expected: 1 or a small number of hits, the specific film identified.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without auth: clear error directing to login.
- Validation errors: exact spec-wording messages returned.
- With auth: structured catalog data; `placeId` echoed when provided,
  omitted when not; three flags present on each hit.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check import + ListTools array + CallTool handler block |
| `placeId` missing from output when passed | Echo not wired | Check `...(placeId ? { placeId } : {})` in return object |
| Flags always false | Enrichment failing silently | Add `console.error` in `enrichHit` temporarily to debug |
| `totalHits` ~2M | `m.queryRequireDefault=on` missing | Check `runCatalogSearch` URL params |

### When to move on

Move to Layer 2 when Part C works — structured catalog data returned
for a keyword search and a placeId search.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the
catalog tool from natural language?

### Steps

1. Open a terminal and create a scratch folder:

   ```bash
   mkdir -p ~/mcp-test-scratch
   cd ~/mcp-test-scratch
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

5. Test: locality catalog lookup

   > "What catalog materials does FamilySearch have for Alabama?"

   Watch what Claude does:
   - Claude should call `place_search("Alabama")` to get the placeId
   - Claude should call `place_catalog({ placeId: "33" })`
   - Claude should present the catalog hits with their searchability flags
   - Claude should point the user toward `record_search` for
     `record_searchable` hits, `fulltext_search` for `fulltext_searchable`,
     and `image_read` for `image_searchable`

6. Test: keyword-only catalog search

   > "Search the FamilySearch catalog for items about 'civil war'"

   Claude should call `place_catalog({ keywords: "civil war" })` (no
   place resolution needed).

7. Test: surname catalog search

   > "Are there any catalog items about the Griffin family?"

   Claude should call `place_catalog({ surname: "Griffin" })`.

8. Test: film lookup by image group number

   > "What catalog item is associated with image group number 7937005?"

   Claude should call `place_catalog({ imageGroupNumber: "7937005" })`.

9. Test: downstream tool chaining

   > "Search the Alabama catalog. For any records that are searchable,
   > show me what you find in the record search."

   Claude should:
   - Call `place_catalog({ placeId: "33" })`
   - Identify hits with `record_searchable: true`
   - Chain to `record_search` for those items

### What success looks like

Claude correctly selects `place_catalog` for catalog questions (not
`place_collections`, which covers a different data surface), identifies
the three flags, and chains to the appropriate downstream tool.

### What failure looks like

- Claude uses `place_collections` instead of `place_catalog` → the
  descriptions need to more clearly differentiate record collections
  (indexed) vs. catalog (unindexed physical material).
- Claude calls `place_catalog` but ignores the three flags → the
  description should emphasize that the flags tell it which downstream
  tool to use.
- Claude doesn't chain to `record_search` for searchable hits → the
  description or the skill instructions need to make this explicit.

### Troubleshooting

If you change server code:

1. Rebuild: `cd mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude uses `place_catalog` correctly from natural
language and chains to downstream tools for searchable hits.

---

## Choose Your Layer 3 Order

Layers 1 and 2 are platform-agnostic. Layer 3 splits by where the MCP
server runs — **both sub-layers are required**:

| Your dev environment | Run first | Then |
|----------------------|-----------|------|
| WSL2 | Layer 3a (WSL2) | Layer 3b (Native Windows) |
| Native Windows | Layer 3b (Native Windows) | Layer 3a (WSL2) |

---

## Layer 3a: Cowork via WSL2

**What this tests:** Does the full pipeline work in Cowork, talking
through the WSL2 bridge?

**Prerequisite:** Claude Desktop configured with a WSL2 MCP server entry:

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

Remove or rename any native Windows entry while testing this layer.

### Steps

1. FULLY restart Claude Desktop after any config or build change
   (system tray → right-click → Quit → reopen).

2. Open a Cowork session.

3. Check auth:

   > "What's my FamilySearch auth status?"

   If not logged in:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

4. Test the catalog workflow:

   > "What catalog materials does FamilySearch have for Alabama?"

5. Verify Claude calls `place_catalog` and returns structured catalog
   hits with the three boolean flags.

6. Test a second axis to verify the pipeline handles keyword search:

   > "Search the FamilySearch catalog for 'vital records'."

### What success looks like

Claude calls `place_catalog` and returns real catalog hits with flags,
running through the full Cowork → Claude Desktop → WSL2 → MCP server
pipeline.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Claude doesn't see the tools | Config typo or Desktop not fully restarted | Fully quit and reopen Claude Desktop |
| `ETIMEDOUT` or `fetch failed` | Node 22 networking bug in WSL2 | Switch to Node 20 |
| Auth error despite being logged in | Token file path mismatch | Check `~/.familysearch-mcp/tokens.json` exists in WSL2 |
| Enrichment very slow | Concurrency cap too low or too many hits | Try `count: 5` to limit enrichment work |

### When to move on

Move to Layer 3b once the catalog workflow works in Cowork via WSL2.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work running natively on Windows?

**Prerequisite:** Claude Desktop configured with a native Windows entry:

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

Remove or rename any WSL2 entry while testing this layer.

### Steps

1. Build on Windows:

   ```powershell
   cd C:\path\to\cowork-genealogy\mcp-server
   npm run build
   ```

2. FULLY restart Claude Desktop.

3. Open Cowork and test the same workflow as Layer 3a.

### What success looks like

Same results as Layer 3a, running natively on Windows.

### What failure looks like

| Problem | Fix |
|---------|-----|
| Build fails on Windows | Check for Linux-specific path separators |
| Server crashes on startup | Check for hardcoded POSIX paths |
| `npx` not found in config | Use `npx.cmd` on Windows |

### You're done when

The catalog workflow works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Smoke test (placeId) | `cd mcp-server && npx tsx dev/try-place-catalog.ts --place 33` |
| Smoke test (keywords) | `cd mcp-server && npx tsx dev/try-place-catalog.ts --keywords "civil war"` |
| Smoke test (surname) | `cd mcp-server && npx tsx dev/try-place-catalog.ts --surname Butler` |
| Smoke test (image group) | `cd mcp-server && npx tsx dev/try-place-catalog.ts --dgs 7937005` |
| Smoke test (combined) | `cd mcp-server && npx tsx dev/try-place-catalog.ts --place 33 --surname Griffin` |
| Run Inspector | `cd mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Wipe session (Linux/WSL) | `rm -f ~/.familysearch-mcp/tokens.json` |
| Wipe session (PowerShell) | `Remove-Item $env:USERPROFILE\.familysearch-mcp\tokens.json` |
| Reconnect in Claude Code | `/mcp` |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, WAF blocks, rep-ID resolution failures, flag logic |
| 1a - Inspector (no auth) | Auth error propagation | Missing/wrong error messages |
| 1b - Inspector (validation) | Input validation | Wrong error wording, missing validation |
| 1c - Inspector (happy path) | Tool through MCP protocol | Schema errors, placeId echo, serialization bugs |
| 2 - Claude Code | LLM tool selection + chaining | Bad descriptions, wrong downstream tool selection |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + token path issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
