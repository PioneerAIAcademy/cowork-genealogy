# Record Search Tool Testing Guide

This guide walks you through testing the `record_search` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the search tool does (30 seconds)

The `record_search` tool queries FamilySearch's historical-record index
for a specific person. You pass clues — a name, a year, a place,
the name of a parent or spouse — and get back a ranked list of
records that might describe that person, with the key facts on
each record (name, dates, places, family) plus links the user can
click.

Like `place_collections`, it requires a valid FamilySearch login session
(obtained via the `login` tool). Under the hood it calls the
lower-level service endpoint
`/service/search/hr/v2/personas`, which exposes a much larger
corpus than the public `/platform/records/personas` endpoint and
plays nicely with `f.collectionId`. This makes the
`places → collections → search` chain possible.

The typical user workflow is:

```
User: "Find Abraham Lincoln, born 1809 in Kentucky."
Claude: search({ surname: "Lincoln", givenName: "Abraham",
                 birthYearFrom: 1809, birthYearTo: 1809,
                 birthPlace: "Kentucky" }) → ranked results
```

For collection-scoped queries, Claude chains:

```
User: "Find John Smith in Alabama marriage records from the 1830s."
Claude: collections({ query: "Alabama" }) → pick a marriage collection
Claude: search({ surname: "Smith", givenName: "John",
                 collectionId: <id>,
                 marriageYearFrom: 1830, marriageYearTo: 1839 })
```

### Anchor rule (you'll bump into this)

A search must include at least one of: `surname` **or**
`recordCountry`. Searches with only a given name, only a place,
only a collection ID, etc. are rejected before they hit the
network — the upstream throttles unanchored queries because
they're expensive.

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (including 40 search tests). If anything is
red, fix it first.

### 2. You need a valid FamilySearch session

The `record_search` tool requires authentication. You must be able to
log in via the `login` tool first. If you haven't tested OAuth
yet, complete the [OAuth Testing
Guide](./oauth-tool-testing-guide.md) through at least Layer 1
Part C before continuing.

You'll need:
- A FamilySearch developer app with a registered client ID
- The redirect URI `http://127.0.0.1:1837/callback` registered on
  your FS app
- A FamilySearch account you can log in with

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live
API?

This bypasses the MCP harness entirely and calls the tool function
directly. It's the fastest way to catch API response shape
mismatches.

### Steps

1. Make sure you're logged in (you should have
   `~/.familysearch-mcp/tokens.json` from a previous `login`
   call). If not:

   ```bash
   cd mcp-server
   npx @modelcontextprotocol/inspector node build/index.js
   ```

   Call `login` with your client ID, complete the browser flow,
   then stop the Inspector.

2. Run the smoke test:

   ```bash
   cd mcp-server
   npx tsx dev/try-record-search.ts Lincoln Abraham
   ```

   This calls `recordSearchTool({ surname: "Lincoln", givenName:
   "Abraham" })`.

3. You should see JSON output with:
   - `query` — echo of the input you sent
   - `totalMatches` — a number > 0 (Abraham Lincoln has thousands
     of indexed records)
   - `paginationCappedAt: 4999`
   - `returned` — number of results in this page (≤ 20)
   - `offset: 0`
   - `hasMore: true`
   - `results` — an array of objects, each with `personId`,
     `personName`, `score`, `confidence`, `arkUrl`,
     `collectionId`, `collectionTitle`, `collectionUrl`, and
     (often) `treeMatches`

4. Try a tighter query that should return Abraham Lincoln near
   the top:

   ```bash
   npx tsx dev/try-record-search.ts Lincoln Abraham --birth-year 1809 --birth-place Kentucky
   ```

5. Try a country-anchored search (no surname):

   ```bash
   npx tsx dev/try-record-search.ts --given Mary --country "United States"
   ```

   Should succeed (recordCountry qualifies as the anchor).

6. Try a UNION across maiden + married name:

   ```bash
   npx tsx dev/try-record-search.ts Lincoln --alt Todd --given Mary
   ```

   The tool auto-fills `givenNameAlt = "Mary"` so the API
   receives a properly paired alternate-name set.

7. Try a collection-scoped search (use a collection ID you got
   from the `place_collections` tool — e.g. `1743384` is Alabama
   marriages, but check first):

   ```bash
   npx tsx dev/try-record-search.ts Smith --collection 1743384 --marriage-year 1830 1850
   ```

8. Confirm the anchor rule rejection:

   ```bash
   npx tsx dev/try-record-search.ts --given John
   ```

   Should error out with "record_search needs at least one anchor:
   surname or recordCountry."

### What success looks like

You get back structured JSON with real persona data. The `arkUrl`
fields should resolve to real FamilySearch persona pages (try
opening one in your browser). For famous queries (Lincoln,
Washington), `treeMatches` should contain at least one suggestion
with high stars.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("not logged in") | No valid session | Run `login` first via Inspector |
| 403 "blocked by security service" | Missing User-Agent header | Check that `User-Agent` header is set in `recordSearchTool` |
| 401 "session not accepted" | Token expired/invalid | Log out and log in again |
| 400 with "rejected the query" | Bad parameter combination | Read the detail; the upstream usually names the offending term |
| Empty `results` for a famous person | URL builder dropped a key term | Re-run with fewer parameters; bisect to find the bad one |
| `fetch` error or timeout | Network issue or wrong URL | Check the URL constant in `src/tools/record-search.ts` |

### When to move on

Move to Layer 1 once the smoke test returns real Lincoln results
**and** the anchor-rule error fires correctly.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it
work through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Look at the tools list. You should see **seven** tools:

- `wikipedia_search`
- `place_search`
- `login`
- `logout`
- `auth_status`
- `place_collections`
- `place_population`
- `record_search`

If `record_search` is missing, check that `src/index.ts` imports and
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

2. In the Inspector, call **`record_search`** with:

   ```json
   { "surname": "Lincoln", "givenName": "Abraham" }
   ```

3. Expected response: an error with `isError: true` and a message
   like:

   ```
   User is not logged in to FamilySearch. Call the login tool to authenticate.
   ```

   This confirms auth-error propagation works. The message is an
   LLM instruction — Claude will understand it means it should
   call `login` first.

### Part B — Validation errors (no network call)

Validation should fail before authentication is even checked.

1. Call **`record_search`** with no anchor:

   ```json
   { "givenName": "John" }
   ```

   Expected: error matching `at least one anchor: surname or
   recordCountry`.

2. Call with `count` out of range:

   ```json
   { "surname": "Lincoln", "count": 200 }
   ```

   Expected: error matching `count must be between 1 and 100`.

3. Call with pagination cap exceeded:

   ```json
   { "surname": "Lincoln", "offset": 4998, "count": 3 }
   ```

   Expected: error matching `offset + count must be <= 4999`.

4. Call with a half-paired year range:

   ```json
   { "surname": "Lincoln", "birthYearFrom": 1809 }
   ```

   Expected: error matching `birthYearFrom and birthYearTo must
   be provided together`.

5. Call with `recordSubdivision` but no `recordCountry`:

   ```json
   { "surname": "Smith", "recordSubdivision": "Alabama" }
   ```

   Expected: error matching `recordSubdivision requires
   recordCountry`.

### Part C — Authenticated (happy path)

1. In the Inspector, call **`login`** with your client ID.
   Complete the browser flow.

2. Call **`record_search`** with:

   ```json
   {
     "surname": "Lincoln",
     "givenName": "Abraham",
     "birthYearFrom": 1809,
     "birthYearTo": 1809,
     "birthPlace": "Kentucky"
   }
   ```

3. Expected response: JSON with `totalMatches > 0`, a populated
   `results` array, and Abraham-Lincoln-named records near the
   top. `collectionId`, `collectionTitle`, and (for many) at
   least one `treeMatches` entry should be populated.

4. Try a country-anchored search:

   ```json
   { "recordCountry": "United States", "givenName": "John" }
   ```

   Should succeed with a large `totalMatches`.

5. Try a UNION search:

   ```json
   {
     "givenName": "Mary",
     "surname": "Lincoln",
     "surnameAlt": "Todd"
   }
   ```

   The auto-pair should fill `givenNameAlt = "Mary"` server-side.
   Results should include records under both surnames.

6. Try a collection-scoped search (replace `<id>` with one from
   the `place_collections` tool):

   ```json
   {
     "surname": "Smith",
     "givenName": "John",
     "collectionId": <id>,
     "marriageYearFrom": 1830,
     "marriageYearTo": 1850
   }
   ```

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without auth: clear error directing to `login`.
- Validation errors fire before any network call.
- With auth: structured persona data with persistent URLs and
  tree-match suggestions.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check import + ListTools + CallTool blocks |
| Auth error despite being logged in | Token expired, cache issue | Log out and log in again |
| Validation error reaches the network | Validation called too late | `validateInput` must run before `getValidToken()` |
| `treeMatches` always empty | Hint-ID parsing wrong | Confirm hints look like `ark:/61903/4:1:GQWZ-GPX` and `parseTreePersonId` strips through the last `:` |

### When to move on

Move to Layer 2 when Part C works — you can get Lincoln results
through the Inspector with all the expected fields populated.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use
the search tool from natural language?

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

5. Test a natural-language person search:

   > "Search FamilySearch for Abraham Lincoln, born 1809 in
   > Kentucky."

6. Watch what Claude does:
   - Claude should call `record_search` with `surname: "Lincoln"`,
     `givenName: "Abraham"`, a tight `birthYearFrom`/`birthYearTo`
     pair, and `birthPlace: "Kentucky"`.
   - Claude should present the top results — name, dates, source
     collection, persistent URL.

7. Test a chained workflow:

   > "Find John Smith in Alabama marriage records from the
   > 1830s."

   - Claude should call `collections({ query: "Alabama" })` to
     find a marriage collection.
   - Then call `record_search` with `surname: "Smith"`, `givenName:
     "John"`, the chosen `collectionId`, and a marriage-year
     range covering 1830–1839.

8. Test an alt-name UNION:

   > "Look for Mary Todd Lincoln by both her names."

   - Claude should call `record_search` with `surname: "Lincoln"`,
     `givenName: "Mary"`, `surnameAlt: "Todd"` (the auto-pair
     fills `givenNameAlt`).

9. Test a tree-match-aware query:

   > "Show me records that already suggest a Family Tree match."

   - Claude should call `record_search`, then filter or highlight
     entries with non-empty `treeMatches`.

### What success looks like

Claude picks `record_search` from natural-language queries, builds
plausible parameter sets, and presents the results clearly —
person name, birth/death info, collection, and the clickable
`arkUrl` (and where applicable, the `treeMatches`).

### What failure looks like

- Claude doesn't use `record_search` at all → tool description doesn't
  match the user's natural language.
- Claude tries to pass a place ID from the `place_search` tool to
  `collectionId` → schema description should clarify these are
  different ID systems.
- Claude calls `record_search` and gets the anchor-rule error but
  doesn't recover → the error message should make it obvious to
  add `surname` or `recordCountry` and retry.
- Claude calls `record_search` with a date instead of a year (e.g.
  `birthYearFrom: "12 February 1809"`) → schema description
  should say "4-digit year".

### Troubleshooting

If you change the server code:

1. Rebuild: `cd mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully runs both a single-call
person search and the `places → collections → search` chain from
natural language.

---

## Choose Your Layer 3 Order

Layers 1 and 2 are platform-agnostic — everyone runs them. Layer
3 splits by where Cowork's MCP server runs, and **both sub-layers
are required**:

| Your dev environment | Run first | Then |
|----------------------|-----------|------|
| WSL2 | Layer 3a (WSL2) | Layer 3b (Native Windows) |
| Native Windows | Layer 3b (Native Windows) | Layer 3a (WSL2) |

---

## Layer 3a: Cowork via WSL2

**What this tests:** Does the full pipeline work in Cowork,
talking through the WSL2 bridge?

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

**Important:** Remove or rename any native Windows MCP server
entry while testing this layer, so you know the WSL2 bridge is
being used.

### Steps

1. FULLY restart Claude Desktop if you changed the server config
   or rebuilt (system tray → right-click → Quit → reopen).

2. Open a Cowork session.

3. Make sure you're logged in:

   > "What's my FamilySearch auth status?"

   If not logged in:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

4. Test a natural-language search:

   > "Find Abraham Lincoln, born 1809 in Kentucky."

5. Verify Claude calls `record_search` with the expected parameters and
   presents the results.

6. Test the chained workflow to verify the chain works through
   the bridge:

   > "Find John Smith in Alabama marriage records from the
   > 1830s."

### What success looks like

Claude calls `record_search` (and where appropriate, `place_collections`
first) and returns ranked records, running through the full
Cowork → Claude Desktop → WSL2 → MCP server pipeline.

### What failure looks like

- Claude doesn't see the tools → config typo or Claude Desktop
  wasn't fully restarted.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- Auth error despite logging in → token file path mismatch
  between WSL2 and Windows.

### When to move on

Move to Layer 3b once the WSL2 bridge handles a person search
and a chained collection-scoped search.

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

   > "Find Abraham Lincoln, born 1809 in Kentucky."

4. Verify the same results as Layer 3a.

5. Then run the chained workflow:

   > "Find John Smith in Alabama marriage records from the
   > 1830s."

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

Both a single-call person search and the
`places → collections → search` chain work in Cowork on native
Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Smoke test (Lincoln) | `cd mcp-server && npx tsx dev/try-record-search.ts Lincoln Abraham` |
| Smoke test (with year+place) | `cd mcp-server && npx tsx dev/try-record-search.ts Lincoln Abraham --birth-year 1809 --birth-place Kentucky` |
| Smoke test (collection-scoped) | `cd mcp-server && npx tsx dev/try-record-search.ts Smith --collection <id> --marriage-year 1830 1850` |
| Smoke test (country anchor) | `cd mcp-server && npx tsx dev/try-record-search.ts --given Mary --country "United States"` |
| Smoke test (alt-name UNION) | `cd mcp-server && npx tsx dev/try-record-search.ts Lincoln --alt Todd --given Mary` |
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
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, WAF blocks, URL builder mistakes |
| 1 - Inspector (no auth) | Auth error propagation | Missing/wrong error messages |
| 1 - Inspector (validation) | Pre-network input validation | Anchor rule, year-range pairing, pagination cap |
| 1 - Inspector (with auth) | Tool through MCP protocol | Schema errors, serialization bugs |
| 2 - Claude Code | LLM tool selection + chain workflow | Bad descriptions, workflow confusion, parameter shape mistakes |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + token path issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
