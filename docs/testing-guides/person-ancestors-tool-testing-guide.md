# Person Ancestors Tool Testing Guide

This guide walks you through testing the `person_ancestors` tool after
it's built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the person_ancestors tool does (30 seconds)

The `person_ancestors` tool reads a person's **pedigree** from the
**FamilySearch Family Tree**. You pass one tree-person ID and it returns
that person plus up to N generations of ancestors as simplified GedcomX.

The key field is **`ascendancyNumber`** on each person — the classic
Ahnentafel numbering that encodes the tree: `1` is the starting person,
`2` is the father, `3` is the mother, and a person numbered *n* has
father *2n* and mother *2n + 1*. The `-S` suffix marks a spouse (the
root's spouse, `1-S`, comes back by default). The raw API returns **no
parent-child relationships**, so this number is the only thing that tells
you who descends from whom.

This is an **authenticated** tool — it requires a valid FamilySearch
login session (via the `login` tool). Under the hood it calls the
documented FamilySearch platform endpoint `GET /platform/tree/ancestry`
("Read Ancestry"). Like the other tree tools, this endpoint is **not**
behind the Imperva WAF, so it needs **no** browser User-Agent header.

The output is the simplified graph **directly** — `{ persons }` (plus
`relationships` only when you ask for marriage details), with **no
envelope**. The five optional parameters are LLM-toggleable:

```
User: "Show me four generations of Abraham Lincoln's ancestors."
Claude: person_ancestors({ personId: "LZJW-C31", generations: 4 })
        → a numbered pedigree (lean: names + ascendancy numbers, no dates)

User: "Include their birth and death dates."
Claude: person_ancestors({ personId: "LZJW-C31", generations: 4,
                           personDetails: true })  → each person now carries facts
```

| Parameter | Default | What it does |
|-----------|---------|--------------|
| `personId` (required) | — | The root tree-person ID |
| `generations` | `3` | How many generations up (integer **1–8**) |
| `spouse` | — | Also include this spouse's ancestry (an ID or `"UNKNOWN"`) |
| `personDetails` | `false` | Add a full `facts` array (Birth/Death/…) to each person |
| `marriageDetails` | `false` | Add `relationships` (Couple entries with marriage facts) |
| `descendants` | `false` | Add descendant detail for persons in the pedigree |

With `personDetails` off (the default), persons have only name, gender,
and `ascendancyNumber` — **no dates**. That's intentional: the endpoint
returns no facts unless asked.

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (including the `person_ancestors` suite). If
anything is red, fix it first.

### 2. You need a valid FamilySearch session

The `person_ancestors` tool requires authentication. You must be able to
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

1. Make sure you're logged in (you should have
   `~/.familysearch-mcp/tokens.json` from a previous `login` call). If
   not, log in via the dev helper (run it through `tsx` — the `.ts` file
   isn't executable; the `unused` arg is a throwaway the login tool
   ignores in favor of the bundled client ID):

   ```bash
   cd mcp-server
   npx tsx dev/try-login.ts unused
   ```

   Complete the browser flow.

2. Run the smoke test:

   ```bash
   cd mcp-server
   npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 2
   ```

   This calls `personAncestorsTool({ personId: "LZJW-C31", generations: 2 })`.

3. You should see **8 persons**, each line showing its ascendancy number,
   ID, and name:

   ```
        1  LZJW-C31  President Abraham Lincoln
      1-S  LCHV-P5R  Mary Ann Todd
        2  9VMF-H1F  Thomas Herring Lincoln
        3  KN6W-CSY  Nancy Elizabeth Hanks
        4  LKBG-8W2  Capt Abraham Lincoln
        5  LXQL-TV6  Bathsheba Herring
        6  L1H7-RXW  Joseph Hanks
        7  PSPQ-97W  Ann Nanny Lee
   ```

   Confirm:
   - `1` is **President** Abraham Lincoln and `4` is **Capt** Abraham
     Lincoln — those titles are real `prefix` parts (check the full JSON:
     `names[0].prefix` should be `"President"` / `"Capt"`, with `given`
     `"Abraham"`).
   - `2`/`3` are the parents, `4`/`5` and `6`/`7` the grandparents.
   - In the full JSON the top-level keys are just `persons` — **no**
     `personId` / `generations` / `ancestorCount` envelope, and **no**
     `relationships` key (you didn't ask for marriage details).
   - With `--generations 2` and no `--person-details`, persons have
     **no** `facts`.

4. Add facts and marriage details:

   ```bash
   npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 2 --person-details --marriage-details
   ```

   Now each person should carry a `facts` array (Birth/Death), and a
   `relationships` list should appear with `Couple` entries — `person1`
   and `person2` are **bare tree IDs** (e.g. `9VMF-H1F`, not a URL) and
   each carries a Marriage fact.

5. Verify the generations range is enforced (no API call):

   ```bash
   npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 9
   ```

   Should error with *"generations must be an integer between 1 and 8."*

6. Verify a bad ID is handled:

   ```bash
   npx tsx dev/try-person-ancestors.ts XXXX-XXX
   ```

   Should error with *"Person XXXX-XXX not found in the FamilySearch
   Family Tree."* — no crash.

### What success looks like

You get back a numbered pedigree. The Lincoln query returns 8 persons at
`generations=2` with correct ascendancy numbers and prefixes, the lean
default has no dates, and `--person-details` / `--marriage-details` add
facts and couple relationships.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("call the login tool") | No valid session | Run `npx tsx dev/try-login.ts unused` first |
| "generations must be an integer between 1 and 8" on a valid number | Off-by-one or non-integer slipped through | Check `validateInput` in `src/tools/person-ancestors.ts` |
| Persons missing `ascendancyNumber` | Re-attach broken | Confirm `mapResponse` reads raw `display.ascendancyNumber` |
| An envelope appears (`personId`/`ancestorCount`) | Output shape regressed | Result must be `{ persons, relationships? }` only |
| Per-person `sources` present | Dangling-source strip removed | `delete sp.sources` in `mapResponse` |
| Couple `person1`/`person2` are URLs | Bare-ID strip missing | Check `shapeRelationship` / `bareId` |
| API returns unexpected shape | Types don't match reality | Compare raw response to `src/types/person-ancestors.ts` |

### When to move on

Move to Layer 1 once the smoke test returns the 8-person Lincoln pedigree
with correct ascendancy numbers and rejects `--generations 9`.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Look at the tools list and confirm **`person_ancestors`** is present. If
it is missing, check that it's imported and dispatched in `src/index.ts`,
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

2. In the Inspector, call **`person_ancestors`** with:

   ```json
   { "personId": "LZJW-C31" }
   ```

3. Expected response: an error with `isError: true` and a message
   directing you to call the `login` tool. This confirms auth error
   propagation works.

### Part B — Authenticated (happy path + validation)

1. In the Inspector, call **`login`** with your client ID. Complete the
   browser flow.

2. Call **`person_ancestors`** with:

   ```json
   { "personId": "LZJW-C31", "generations": 2 }
   ```

3. Expected response: JSON with a `persons` array of 8 entries. Ascendancy
   `1` is President Abraham Lincoln (with `names[0].prefix: "President"`),
   `1-S` is Mary Ann Todd, `2`/`3` are his parents. No envelope, no
   `relationships` key.

4. Verify the generations range. Call:

   ```json
   { "personId": "LZJW-C31", "generations": 9 }
   ```

   Expected: an error with the *"generations must be an integer between 1
   and 8"* message. Same for `"generations": 0`.

5. Add marriage details:

   ```json
   { "personId": "LZJW-C31", "generations": 2, "marriageDetails": true }
   ```

   Should return a `relationships` array of `Couple` entries with
   bare-ID participants and Marriage facts.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Without auth: clear error message directing to login.
- With auth + a valid query: a numbered pedigree.
- Out-of-range generations: rejected with the range message, no crash.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered | Check `index.ts`, `tool-schemas.ts`, `manifest.json` |
| Auth error despite being logged in | Token expired, cache issue | Log out and log in again |
| `generations: 9` returns data instead of erroring | Validation not enforced | Check `validateInput` |
| Unexpected error shape | API response doesn't match types | Check the smoke test output and adjust types |

### When to move on

Move to Layer 2 when Part B works — you can get a pedigree for a valid
query through the Inspector, and out-of-range queries are rejected.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the
person_ancestors tool from natural language — and does it toggle
`personDetails` / `marriageDetails` based on the request?

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

5. Test the pedigree query:

   > "Show me four generations of Abraham Lincoln's ancestors."
   > (If Claude needs the ID first, it may call `person_search`; or give
   > it `LZJW-C31` directly.)

6. Watch what Claude does:
   - Claude should call `person_ancestors` with `personId` and
     `generations: 4`.
   - Claude should present the pedigree using the ascendancy numbers
     (e.g. as a tree or a numbered list).

7. Test the `personDetails` toggle:

   > "Include their birth and death dates."

   Claude should re-call with `personDetails: true`, and the dates should
   now appear.

8. Test the `marriageDetails` toggle:

   > "When did each couple marry?"

   Claude should re-call with `marriageDetails: true` and read the
   marriage facts from the relationships.

### What success looks like

Claude calls `person_ancestors`, renders the pedigree from the ascendancy
numbers, and flips `personDetails` / `marriageDetails` on when the user
asks for dates or marriages.

### What failure looks like

- Claude asks for dates but doesn't set `personDetails` → the description
  isn't teaching the toggle clearly.
- Claude can't reconstruct the tree → the `ascendancyNumber` explanation
  in the description isn't landing.
- Claude calls `person_read` repeatedly to walk up the tree instead of
  `person_ancestors` once → the tools' roles aren't distinct enough.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully uses `person_ancestors` from
natural language and toggles the detail flags appropriately.

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

4. Test the pedigree workflow:

   > "Show me four generations of Abraham Lincoln's ancestors."

5. Verify Claude calls `person_ancestors` and presents the numbered
   pedigree.

6. Test a toggle:

   > "Add their birth and death dates."

   Verify Claude re-calls with `personDetails: true`.

### What success looks like

Claude calls `person_ancestors`, returns the Lincoln pedigree with
ascendancy numbers, and adds facts on request — all through the full
Cowork → Claude Desktop → WSL2 → MCP server pipeline.

### What failure looks like

- Claude doesn't see the tools → config typo or Claude Desktop
  wasn't fully restarted.
- Server error `ETIMEDOUT` or `fetch failed` → Node 22 networking
  bug; switch to Node 20.
- Auth error despite logging in → token file path mismatch between
  WSL2 and Windows.

### When to move on

Move to Layer 3b once the WSL2 bridge handles the pedigree workflow.

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

   > "Show me four generations of Abraham Lincoln's ancestors."

4. Verify the same results as Layer 3a, including the `personDetails`
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

The pedigree workflow (walk up N generations → add dates/marriages on
request) works in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Log in (dev) | `cd mcp-server && npx tsx dev/try-login.ts unused` |
| Smoke test (Lincoln, lean) | `cd mcp-server && npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 2` |
| Smoke test (facts + marriages) | `cd mcp-server && npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 2 --person-details --marriage-details` |
| Smoke test (range rejection) | `cd mcp-server && npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 9` |
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
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, ascendancy re-attach, envelope/source-strip regressions, range validation |
| 1 - Inspector (no auth) | Auth error propagation | Missing/wrong error messages |
| 1 - Inspector (with auth) | Tool through MCP protocol | Schema errors, validation enforcement, serialization bugs |
| 2 - Claude Code | LLM tool selection + detail toggles | Wrong tool, missing `personDetails`/`marriageDetails`, bad descriptions |
| 3a - Cowork WSL2 | Full path through WSL2 | WSL2 bridge + token path issues |
| 3b - Cowork Native | Full path on native Windows | Cross-platform bugs |

**Don't skip layers.** Each one catches bugs the others miss.
