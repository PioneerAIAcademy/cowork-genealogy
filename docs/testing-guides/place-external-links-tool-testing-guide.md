# Place External Links Tool Testing Guide

This guide walks you through testing the `place_external_links` tool after
it's built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What `place_external_links` does (30 seconds)

The `place_external_links` tool returns FamilySearch-curated third-party
genealogy resource URLs for a place and year range. You pass it a
FamilySearch place ID plus a `[startYear, endYear]` window, and it
returns every collection FS knows about whose date range overlaps that
window — plus undated wiki/website resources for that place.

Compared to the existing `collections` tool:

- `place_external_links` calls the **public** `/external/collections/search`
  endpoint — no OAuth required.
- Its primary input is a **place ID** (numeric string, e.g. `"1927089"`
  for France), not a place name.
- Output is `{ url, linkText }[]` plus paging metadata — no record
  counts, because the external endpoint doesn't expose them.

The typical workflow is:

```
[user request: "find me genealogy resources for France 1880-1950"]
        ↓
places({ query: "France" })  → placeId, place name, etc.
        ↓
place_external_links({ placeId, startYear, endYear })
                              → list of curated third-party URLs
```

The `places` tool (sibling in this server) is the upstream source of
place IDs. Claude should not guess place IDs — it should obtain them
from `places` or from the user.

## Before you start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (including 12 `place_external_links` tests). If
anything is red, fix it first.

### 2. No FamilySearch login is needed

The endpoint is public. Unlike `collections`, this tool does not call
`getValidToken()` and does not require an OAuth session.

### 3. You'll need a real FamilySearch place ID

For manual testing, the IDs below are stable:

| Place | Place ID |
|-------|----------|
| France | `1927089` |
| Canada | `1927164` |
| Iceland | `1927031` |

In production these come from the `places` tool.

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live API?

This bypasses the MCP harness entirely and calls the handler directly.
Fastest way to catch API-shape regressions or pagination bugs.

### Steps

1. Run a populated window:

   ```bash
   cd mcp-server
   npx tsx dev/try-place-external-links.ts 1927089 1880 1950
   ```

2. You should see JSON with:
   - `place: "France"`
   - `totalResults` around `221` (FS's data shifts slightly over time;
     ±10 is fine).
   - `matchedCount` smaller than `totalResults` — collections outside
     1880–1950 are filtered out.
   - `results[]` — array of `{ url, linkText }` items.

3. Try a different country:

   ```bash
   npx tsx dev/try-place-external-links.ts 1927164 1880 1950
   ```

   Should return `place: "Canada"` and `totalResults` ~470.

4. Try the validation guard:

   ```bash
   npx tsx dev/try-place-external-links.ts 1927089 1950 1880
   ```

   The script should fail loudly with an error mentioning `endYear must
   be greater than or equal to startYear`. **No network call** — the
   guard fires inside the handler before any fetch.

### What success looks like

You get back structured JSON with real curated URLs. Open one or two
in your browser to confirm they're not 404s.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| 403 "blocked by security service" | Browser-spoofed UA missing | Verify the `USER_AGENT` constant in `src/tools/place-external-links.ts` matches the one in `collections.ts` (Chrome UA). |
| `ETIMEDOUT` / `fetch failed` | Network or DNS issue | Try the live curl from the spec; if it fails too, fix WSL2 DNS or VPN. |
| Pagination loops forever | Bad stop condition | Check the loop in `src/tools/place-external-links.ts` — it should bail when `offset >= totalResults` or page is empty. |
| Output `matchedCount` is wrong | Overlap logic broken | Re-read `overlapsRange()` against the spec's "Overlap Logic" table. |

### When to move on

Move to Layer 1 once two different placeIds return real data and the
validation guard fires.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Look at the tools list. You should see **seven** tools:

- `wikipedia_search`
- `places`
- `login`
- `logout`
- `auth_status`
- `collections`
- `place_external_links`

If `place_external_links` is missing, check `src/index.ts` registration
(import + ListTools entry + CallTool block).

### Part A — Happy path

Call `place_external_links` with:

```json
{ "placeId": "1927089", "startYear": 1880, "endYear": 1950 }
```

Expected: JSON with `place: "France"`, `totalResults: ~221`,
`matchedCount: ~178+`, `results[]`.

### Part B — Sparse window

```json
{ "placeId": "1927089", "startYear": 1700, "endYear": 1750 }
```

Expected: smaller `matchedCount`. Mostly undated wiki entries plus a
handful of pre-1750 collections.

### Part C — Validation error

```json
{ "placeId": "1927089", "startYear": 1950, "endYear": 1880 }
```

Expected: a tool error with `isError: true` and a message containing
`endYear must be greater than or equal to startYear`.

### Part D — Empty result for unknown placeId

```json
{ "placeId": "999999999", "startYear": 1880, "endYear": 1950 }
```

Expected: a *successful* response (not an error) containing
`place: null, totalResults: 0, matchedCount: 0, results: []`.

### What success looks like (Layer 1)

- Tool appears in the Inspector.
- Parameters render with their descriptions.
- All four parts return the expected shapes.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tool missing from Inspector | Not registered in `index.ts` | Check the import, ListTools array, and CallTool block. |
| Validation error not shown clearly | Error wrapping wrong | The handler throws; the index.ts CallTool block should wrap with `isError: true`. |
| "Unknown tool" returned | Tool name mismatch | The schema's `name` and the CallTool `if` check must both be `"place_external_links"`. |

### When to move on

Move to Layer 2 when Parts A–D all behave as expected.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use this
tool from natural language?

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

3. Start Claude Code (`claude`).

4. Test with a natural-language prompt:

   > "Find FamilySearch resource links for place ID 1927089 between
   > 1880 and 1950."

5. Watch what Claude does:
   - Claude should call `place_external_links` with the three fields.
   - Claude should present the URLs (probably summarized or grouped),
     not dump raw JSON.
   - Claude should not invent a place ID.

6. Test a less explicit prompt:

   > "I'm researching France from 1880 to 1950. The FamilySearch place
   > ID is 1927089. What external genealogy resources are available?"

   Claude should still pick `place_external_links` — the description mentions
   place ID and year range explicitly.

### What success looks like

Claude calls the tool with correct inputs, doesn't try to guess place
IDs, and presents the URLs in a way the user can act on.

### What failure looks like

- Claude doesn't pick the tool → the description doesn't match the
  user's natural language. **Fix the description, not the user.**
- Claude tries to invent a place ID → strengthen the "do not guess"
  wording in the schema.
- Claude confuses `place_external_links` with `collections` → tighten the
  description to clarify they return different things (collections are
  FS's own collections; place_external_links are third-party URLs FS curates).

### Troubleshooting

If you change the server code:

1. Rebuild: `cd mcp-server && npm run build`.
2. In Claude Code, run `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude consistently uses the tool from
natural-language prompts that mention a place ID and year range.

---

## Choose Your Layer 3 Order

Layers 1 and 2 are platform-agnostic. Layer 3 splits by where the MCP
server runs. Both sub-layers are required:

| Your dev environment | Run first | Then |
|----------------------|-----------|------|
| WSL2 | Layer 3a (WSL2) | Layer 3b (Native Windows) |
| Native Windows | Layer 3b (Native Windows) | Layer 3a (WSL2) |

---

## Layer 3a: Cowork via WSL2

**What this tests:** Does the full pipeline work in Cowork through the
WSL2 bridge?

**Prerequisite:** Claude Desktop installed.

### Where the config file actually lives

Claude Desktop reads its MCP server config from
`claude_desktop_config.json`. Two important things about the path:

- **The MSIX/Microsoft Store install of Claude Desktop redirects
  `%APPDATA%\Claude\` to a per-package sandbox at**
  `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\`. Editing
  the unredirected path has no effect — Desktop only reads the redirected
  one. Logs (`logs/mcp-server-<name>.log`) also live under the redirected
  path.
- **Don't open the file directly. Use the Edit Config button** in
  Settings → Developer. That button always opens the file Desktop actually
  reads, regardless of install method.

### Editing the config (in-app)

1. In Claude Desktop, open **Settings → Developer**.
2. Click **Edit Config**. The OS opens
   `claude_desktop_config.json` in your default editor.
3. Add a `mcpServers` entry alongside any existing top-level keys (e.g.
   `preferences`). Don't replace the file — merge into it.

```json
{
  "mcpServers": {
    "genealogy-wsl": {
      "command": "wsl.exe",
      "args": [
        "-d", "Ubuntu",
        "--cd", "/home/<you>/cowork-genealogy/mcp-server",
        "--",
        "/home/<you>/.nvm/versions/node/<version>/bin/node",
        "build/index.js"
      ]
    }
  }
}
```

Adjust three things to match your machine:

- **`-d Ubuntu`** — your WSL2 distro name. Run `wsl.exe -l` from
  PowerShell. If it's `Ubuntu-22.04`, `Ubuntu-24.04`, etc., use that
  exact value.
- **`--cd /home/<you>/cowork-genealogy/mcp-server`** — absolute WSL2 path
  to the built `mcp-server/` folder. Don't use the `/mnt/c/...` Windows
  path; that's slower and more permission-prone.
- **Node binary path** — run `which node` inside WSL2. nvm-installed Node
  lives at `/home/<you>/.nvm/versions/node/<version>/bin/node`; system
  Node is at `/usr/bin/node`. Use whichever your `which node` returned.

### Encoding gotcha

The file must be **UTF-8 without BOM**. If you save through the Edit
Config button, the OS handles this correctly. If you ever need to write
the file via PowerShell, **don't use `Set-Content -Encoding UTF8`** —
PowerShell 5.x emits a BOM and Desktop will fail to parse the file with
`"Unexpected token "*" ... is not valid JSON"`. Either use the Edit
Config button or write from the WSL2 side via the
`/mnt/c/Users/<you>/AppData/Local/Packages/Claude_<id>/LocalCache/Roaming/Claude/`
mount.

### Steps

1. Save the config file.

2. **Fully quit** Claude Desktop. System tray icon (bottom-right of
   taskbar, expand `^` if hidden) → right-click → Quit. Closing the
   window is not enough; the app keeps running. Wait 5 seconds.

3. Reopen Claude Desktop.

4. **Verify in Settings → Developer** that `genealogy-wsl` appears as
   connected. If it doesn't, check the log file at
   `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\logs\mcp-server-genealogy-wsl.log`
   for the actual error.

5. Open a Cowork session inside Claude Desktop.

6. Test:

   > "Find FamilySearch external links for place ID 1927089 between
   > 1880 and 1950."

7. Verify Claude calls `place_external_links` and presents the URLs.

### What success looks like

Claude calls `place_external_links` and returns curated URLs, running through
Cowork → Claude Desktop → WSL2 → MCP server.

### What failure looks like

| Symptom | Likely cause | Fix |
|---|---|---|
| Desktop shows a JSON parse-error dialog on launch | File has a BOM or stray character at the start | Re-save through Edit Config, or rewrite from WSL2 side without BOM |
| Server doesn't appear in Settings → Developer | Config edit landed in the unredirected `%APPDATA%\Claude\` path that MSIX Desktop ignores | Use the Edit Config button to open the right file |
| `wsl.exe: command not found` in log | Desktop's MSIX sandbox can't find wsl.exe on PATH | Use full path: `"command": "C:\\Windows\\System32\\wsl.exe"` (note doubled backslashes for JSON) |
| `Cannot find module ... build/index.js` | `--cd` path wrong, or `mcp-server/build/` doesn't exist | From WSL2: `ls /home/<you>/cowork-genealogy/mcp-server/build/index.js` |
| `ETIMEDOUT` / `fetch failed` from the server itself | WSL2 networking issue | Verify the smoke-test script (`npx tsx dev/try-place-external-links.ts ...`) works inside WSL2 first |

### When to move on

Move to Layer 3b once the WSL2 bridge handles a full request.

---

## Layer 3b: Cowork via Native Windows

**What this tests:** Does the full pipeline work running natively on
Windows (no WSL2 hop)?

**Prerequisite:** Node 20+ installed natively on Windows (from
nodejs.org, not via WSL2) and on the user PATH.

### Editing the config

Use the same **Settings → Developer → Edit Config** flow as Layer 3a
(see that section for the path-redirection and BOM gotchas).

Add a native Windows entry alongside (or in place of) the WSL2 entry:

```json
{
  "mcpServers": {
    "genealogy-native": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\cowork-genealogy\\mcp-server\\build\\index.js"
      ]
    }
  }
}
```

Notes on the entry:

- **Doubled backslashes** in the path. JSON requires `\\` to encode a
  literal backslash; `C:\path` is invalid JSON.
- **`"command": "node"`** assumes `node` is on Desktop's PATH. If
  Desktop can't find it, use the absolute path:
  `"command": "C:\\Program Files\\nodejs\\node.exe"`.
- Remove or rename the WSL2 entry while testing this layer so you know
  the native path is being exercised.

### Steps

1. Build natively from PowerShell (not WSL2):

   ```powershell
   cd C:\absolute\path\to\cowork-genealogy\mcp-server
   npm install
   npm run build
   ```

2. Edit Claude Desktop config (see above), save.

3. Fully quit Claude Desktop from the tray, wait 5 seconds, reopen.

4. Verify the server appears in Settings → Developer.

5. Test the same prompt as Layer 3a.

### What success looks like

Same results as Layer 3a, running natively on Windows.

### What failure looks like

| Problem | Fix |
|---------|-----|
| Build fails on Windows | Look for hardcoded path separators. |
| Server crashes on startup | Check for hardcoded `~` or POSIX paths. |
| `npx` not found in config | Use `npx.cmd` on Windows. |

### You're done when

The same prompt returns curated URLs in Cowork on native Windows.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run all tests | `cd mcp-server && npm test` |
| Smoke test (France) | `cd mcp-server && npx tsx dev/try-place-external-links.ts 1927089 1880 1950` |
| Smoke test (Canada) | `cd mcp-server && npx tsx dev/try-place-external-links.ts 1927164 1880 1950` |
| Run Inspector | `cd mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Reconnect in Claude Code | `/mcp` |
| Claude Desktop config | Settings → Developer → Edit Config |
| Claude Desktop logs | Settings → Developer → View Logs |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 — Smoke script | Direct function call vs live API | API shape mismatches, WAF blocks, pagination bugs |
| 1 — Inspector | Tool through MCP protocol | Schema errors, validation routing, error-message wording |
| 2 — Claude Code | LLM tool selection from natural language | Bad descriptions, parameter-name confusion |
| 3a — Cowork WSL2 | Full path through WSL2 bridge | Bridge config, node path, build artifacts |
| 3b — Cowork Native | Full path on native Windows | Cross-platform path bugs, line endings, `npx.cmd` |

**Don't skip layers.** Each one catches bugs the others miss.
