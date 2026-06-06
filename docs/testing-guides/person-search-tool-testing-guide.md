# Person Search Tool Testing Guide

This guide walks you through testing the `person_search` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the person_search tool does (30 seconds)

The `person_search` tool searches the **FamilySearch Family Tree** for
people. You pass a surname plus at least one other clue — a given name,
a life-event year or place (birth/death/marriage/residence), or a
relative's name — and it returns a ranked list of candidate tree
persons. Each result carries a tree-person ID, a relevance `score` and
`confidence`, and the matched person as simplified GedcomX (name +
facts).

This is an **authenticated** tool — it requires a valid FamilySearch
login session (obtained via the `login` tool). Under the hood it calls
the documented FamilySearch platform endpoint
`GET /platform/tree/search` ("Search Tree Persons"). Unlike
`record_search` and `collections_search`, this endpoint is **not** behind
the Imperva WAF, so it needs **no** browser User-Agent header.

The output is deliberately **lean**: each result is just
`personId`, `score`, `confidence`, and the matched person's `gedcomx` —
no relatives. The typical workflow finds candidates, the user picks one,
then `person_read` expands the family:

```
User: "Find Abraham Lincoln, born 1809 in Kentucky, in the family tree."
Claude: person_search({ surname: "Lincoln", givenName: "Abraham",
                        birthYearFrom: 1809, birthYearTo: 1809,
                        birthPlace: "Kentucky" }) → ranked candidates
User picks "President Abraham Lincoln" (LZJW-C31)
Claude: person_read({ personId: "LZJW-C31", relatives: true }) → family
```

**The surname-plus-one rule.** A search must include `surname` **and**
at least one other search field. `surname` alone — or `surname` + only
`sex`, or `surname` + only an `*Exact` toggle — is rejected, because the
tree search is heavily fuzzy and an under-constrained query returns tens
of thousands of irrelevant matches.

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (including the `person_search` suite). If anything
is red, fix it first.

### 2. You need a valid FamilySearch session

The `person_search` tool requires authentication. You must be able to
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
   npx tsx dev/try-person-search.ts Lincoln Abraham --birth-year 1809 --birth-place Kentucky
   ```

   This calls `personSearchTool({ surname: "Lincoln", givenName: "Abraham",
   birthYearFrom: 1809, birthYearTo: 1809, birthPlace: "Kentucky" })`.

3. You should see JSON output with:
   - `query` — an echo of the fields you supplied
   - `totalMatches` — a number > 0 (expect ~7 for this query)
   - `paginationCappedAt: 4999`
   - `results` — an array; the top result should have
     `personId: "LZJW-C31"`, a `score`, a `confidence`, and a `gedcomx`
     whose single person is **President Abraham Lincoln** with Birth
     (12 February 1809, Hardin, Kentucky) and Death (15 April 1865) facts
   - Place strings should be in **English** (e.g. `"Hardin, Kentucky, United States"`)

4. Confirm the lean shape: each result has only `personId`, `score`,
   `confidence`, and `gedcomx` — **no** relatives, and `gedcomx.persons`
   has exactly one person (the matched one).

5. Verify the surname-plus-one rule rejects an under-constrained search:

   ```bash
   npx tsx dev/try-person-search.ts Lincoln
   ```

   Should error with *"person_search requires a surname plus at least
   one other search field …"* — no API call made.

6. Try another person:

   ```bash
   npx tsx dev/try-person-search.ts Tippitt William --birth-year 1820
   ```

   Should return ranked candidates (or an empty `results` array if none
   match — no crash).

### What success looks like

You get back structured JSON with a ranked candidate list. The top hit
for the Lincoln query is `LZJW-C31` (President Abraham Lincoln), and you
can paste that `personId` into `person_read` to pull the full record.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("User is not logged in") | No valid session | Run `login` first via Inspector |
| "requires a surname plus at least one other search field" | Only `surname` supplied (or `surname` + only `sex` / an `*Exact` toggle) | Add a real second field — a given name, a year/place, or a relative's name |
| Place names come back non-English | (rare) reading the wrong field | The tool reads the as-entered `original` text; confirm `toSimplified` isn't switched to `normalized` |
| API returns unexpected shape | API types don't match reality | Compare the raw response to types in `src/types/person-search.ts` and adjust |
| Empty results for a known person | Query too loose, or the person isn't in the tree | Narrow with a birth year + place; `m.queryRequireDefault=on` is sent automatically |
| `fetch` error or timeout | Network issue or wrong URL | Check `FS_TREE_SEARCH_URL` in `src/tools/person-search.ts` |

### When to move on

Move to Layer 1 once the smoke test returns `LZJW-C31` for the Lincoln
query and rejects the surname-only query.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Look at the tools list and confirm **`person_search`** is present. If it
is missing, check that it's imported and dispatched in `src/index.ts`,
listed in `src/tool-schemas.ts`, and named in `manifest.json`.

### Part A — Not authenticated (error message)

1. Wipe any existing session:

   ```bash
   rm -f ~/.familysearch-mcp/tokens.json
   ```

   On Windows PowerShell:

   ```powershell
   Remove-Item $env:USERPROFILE\.familysearch-mcp\tokens.json
   ```

2. In the Inspector, call **`person_search`** with:

   ```json
   { "surname": "Lincoln", "givenName": "Abraham" }
   ```

3. Expected response: an error with `isError: true` and a message like:

   ```
   User is not logged in to FamilySearch. Call the login tool to authenticate.
   ```

   This confirms auth error propagation works. The message is an LLM
   instruction — Claude will understand it means it should call `login`
   first.

### Part B — Authenticated (happy path + validation)

1. In the Inspector, call **`login`** with your client ID. Complete the
   browser flow.

2. Call **`person_search`** with:

   ```json
   { "surname": "Lincoln", "givenName": "Abraham", "birthYearFrom": 1809, "birthYearTo": 1809, "birthPlace": "Kentucky" }
   ```

3. Expected response: JSON with `query`, `totalMatches`, and a `results`
   array whose top entry is `personId: "LZJW-C31"` with a one-person
   `gedcomx`.

4. Verify the surname-plus-one rule. Call:

   ```json
   { "surname": "Lincoln" }
   ```

   Expected: an error with `isError: true` and the *"requires a surname
   plus at least one other search field"* message. Same for:

   ```json
   { "surname": "Lincoln", "sex": "Male" }
   ```

   (`sex` does not count as the "other" field.)

5. Try a broader valid search:

   ```json
   { "surname": "Lincoln", "givenName": "Mary" }
   ```

   Should return candidates without error.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without auth: clear error message directing to login.
- With auth + a valid surname-plus-one query: ranked candidate data.
- Surname-only / surname+sex: rejected with the rule message, no crash.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered | Check `index.ts`, `tool-schemas.ts`, `manifest.json` |
| Auth error despite being logged in | Token expired, cache issue | Log out and log in again |
| Surname-only query returns results instead of erroring | Validation not enforced | Check `validateInput` in `src/tools/person-search.ts` |
| Unexpected error shape | API response doesn't match types | Check the smoke test output and adjust types |

### When to move on

Move to Layer 2 when Part B works — you can get tree-person candidates
for a valid query through the Inspector, and bad queries are rejected.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the
person_search tool from natural language — and does it chain into
`person_read`?

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

5. Test the tree-search query:

   > "Find Abraham Lincoln, born 1809 in Kentucky, in the family tree."

6. Watch what Claude does:
   - Claude should call `person_search` (NOT `record_search`) with
     `surname`, `givenName`, and the birth year/place.
   - Claude should present the candidates — name, dates, places, and the
     tree-person ID for each.

7. Test the chain into `person_read`:

   > "Show me that person's parents and children."

   Claude should call `person_read({ personId: "LZJW-C31", relatives: true })`.

8. Test a disambiguation-style query:

   > "Search the tree for a Mary Lincoln."

   Claude should call `person_search` with `surname` + `givenName`.

### What success looks like

Claude calls `person_search` with a surname plus a real second field,
presents the ranked candidates clearly, and — when asked for the family
— chains into `person_read` with the chosen `personId`.

### What failure looks like

- Claude uses `record_search` for a tree query → the tool descriptions
  don't draw the records-vs-tree line clearly enough.
- Claude calls `person_search` with only a surname → it should know the
  surname-plus-one rule from the description and add a second field.
- Claude has the `personId` but re-searches instead of calling
  `person_read` for the family → the chaining hint in the description
  isn't landing.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully uses `person_search` from
natural language and chains into `person_read`.

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

4. Test the tree-search workflow:

   > "Find Abraham Lincoln, born 1809 in Kentucky, in the family tree."

5. Verify Claude calls `person_search` and presents the candidates with
   tree-person IDs.

6. Test the chain:

   > "Show me his parents and children."

   Verify Claude calls `person_read` with the chosen `personId` and
   `relatives: true`.

### What success looks like

Claude calls `person_search`, returns `LZJW-C31` (President Abraham
Lincoln) among the candidates, then expands the family via `person_read`
— all through the full Cowork → Claude Desktop → WSL2 → MCP server
pipeline.

### What failure looks like

- Claude doesn't see the tools → config typo or Claude Desktop
  wasn't fully restarted.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- Auth error despite logging in → token file path mismatch between
  WSL2 and Windows.

### When to move on

Move to Layer 3b once the WSL2 bridge handles the person-search
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

   > "Find Abraham Lincoln, born 1809 in Kentucky, in the family tree."

4. Verify the same results as Layer 3a, including the `person_read`
   follow-up.

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

The person-search workflow (find candidates → expand with `person_read`)
works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Smoke test (Lincoln) | `cd mcp-server && npx tsx dev/try-person-search.ts Lincoln Abraham --birth-year 1809 --birth-place Kentucky` |
| Smoke test (rule rejection) | `cd mcp-server && npx tsx dev/try-person-search.ts Lincoln` |
| Smoke test (another person) | `cd mcp-server && npx tsx dev/try-person-search.ts Tippitt William --birth-year 1820` |
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
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, lean-output regressions, surname-plus-one rule, locale leaks |
| 1 - Inspector (no auth) | Auth error propagation | Missing/wrong error messages |
| 1 - Inspector (with auth) | Tool through MCP protocol | Schema errors, validation enforcement, serialization bugs |
| 2 - Claude Code | LLM tool selection + the person_read chain | Records-vs-tree confusion, missing chain, bad descriptions |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + token path issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
