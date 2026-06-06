# Image Search Tool Testing Guide

This guide walks you through testing the `image_search` tool after it's
built. Follow each layer in order. Don't skip ahead — each layer
catches different problems.

## What the image search tool does (30 seconds)

The `image_search` tool searches FamilySearch's Records Management
Service (RMS) for **image groups** — digitized volumes of historical
documents (microfilm rolls, book scans). It sits between
`collections_search` (which discovers *collections*) and `image_read`
(which reads a *single image*): `image_search` finds the *volumes* in
between.

It has two mutually-exclusive query modes:

1. **Place + date range** — pass a `placeId` (from `place_search`) plus
   an optional `fromDate`/`toDate`. The tool converts the `placeId` to
   one or more `placeRepId`s internally, queries RMS, and converts the
   coverage `placeRepId`s back to `placeId`s in the output.
2. **Image group number** — pass an `imageGroupNumber` (e.g.
   `"007621224"`). The tool appends a `*` wildcard and looks up that
   volume.

This is an **authenticated** tool — it requires a valid FamilySearch
login session (obtained via the `login` tool).

The typical user workflow is:
```
User: "What image groups cover Edensor, Derbyshire between 1730 and 1810?"
Claude: place_search("Edensor, Derbyshire") → placeId 6137147
Claude: image_search({ placeId: "6137147", fromDate: "1730-01-01", toDate: "1810-12-31" }) → 4 groups
```

## Before You Start

### 1. Make sure the server builds and all tests pass

```bash
cd mcp-server
npm run build
npm test
```

All tests should pass (including 19 image-search tests). The Inspector
and Claude Code both run the **compiled** `build/index.js`, so you must
`npm run build` after any code change.

### 2. You need a valid FamilySearch session

The `image_search` tool requires authentication. You must be able to log
in via the `login` tool first. If you haven't tested OAuth yet, complete
the [OAuth Testing Guide](./oauth-tool-testing-guide.md) through at least
Layer 1 Part C before continuing.

You'll need:
- A FamilySearch developer app with a registered client ID
- The redirect URI `http://127.0.0.1:1837/callback` registered on your
  FS app
- A FamilySearch account you can log in with

---

## Layer 0: Smoke-Test Script

**What this tests:** Does the tool function work against the live API?

This bypasses the MCP harness entirely and calls the tool function
directly. It's the fastest way to catch API response shape mismatches.

### Steps

1. Make sure you're logged in (you should have
   `~/.familysearch-mcp/tokens.json` from a previous `login` call). If
   not, run the Inspector (Layer 1 below), call `login`, then come back.

2. Run the smoke test in place + date mode:

   ```bash
   cd mcp-server
   npx tsx dev/try-image-search.ts --placeId 6137147 --from 1730-01-01 --to 1810-12-31
   ```

   Expect `totalGroups: 4`, with `DGS-004452257` (Edensor burial
   records, 1726–1812) among the groups and each coverage `placeId`
   resolved back to `6137147`.

3. Run the smoke test in image group number mode:

   ```bash
   npx tsx dev/try-image-search.ts --imageGroupNumber "007621224"
   ```

   Expect `totalGroups: 1`, group `007621224_005_M99P-2TQ` (Blount
   County, Alabama), with `custodians` populated and coverages resolved
   to `placeId 2303`.

### What success looks like

Structured JSON with real image-group data. The `imageGroupNumber`,
`coverages[].placeId`, `dateRange`, and `recordType` fields are all
populated.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth error ("not logged in") | No valid session | Run `login` first via Inspector |
| 403 Forbidden | Missing User-Agent / FS-User-Agent-Chain header | Check the headers in `callRms` in `src/tools/image-search.ts` |
| `placeId` is `""` in coverages | Reverse lookup failed | Confirm `/places/description/{repId}` is reachable; check `repIdToPlaceId` |
| "No place representations found" | Forward lookup returned no reps | Confirm the `placeId` is a Primary ID (not a `placeRepId`) |
| Wrong place in coverages | Forward/reverse endpoints swapped | `/places/{id}` reads a placeId; `/places/description/{id}` reads a placeRepId |

### When to move on

Move to Layer 1 once both modes return real groups.

---

## Layer 1: MCP Inspector

**What this tests:** Does the tool register correctly? Does it work
through the MCP protocol?

### Start the Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

Open the printed URL, click **Connect**, then **List Tools**. You should
see **`image_search`** in the list (the last of 27 tools). If it's
missing, check that `src/index.ts` imports and dispatches it and that
`imageSearchSchema` is in `src/tool-schemas.ts`.

### Part A — Place + date mode (happy path)

Call **`image_search`** with:

```json
{ "placeId": "6137147", "fromDate": "1730-01-01", "toDate": "1810-12-31" }
```

Expected: `totalGroups: 4`, including `DGS-004452257` (Burial Records,
1726–1812), with coverage `placeId` resolved to `6137147`.

### Part B — Image group number mode (happy path)

Call **`image_search`** with:

```json
{ "imageGroupNumber": "007621224" }
```

Expected: `totalGroups: 1`, group `007621224_005_M99P-2TQ` (Blount
County, Alabama), coverages resolved to `placeId 2303`.

### Part C — Input validation (each returns isError, no network call)

| Input | Expected error |
|-------|----------------|
| `{}` | `image_search requires either placeId or imageGroupNumber.` |
| `{ "placeId": "6137147", "imageGroupNumber": "007621224" }` | `Provide either placeId or imageGroupNumber, not both.` |
| `{ "placeId": "6137147", "fromDate": "1730" }` | `fromDate must be in YYYY-MM-DD format (e.g., '1730-01-01').` |
| `{ "imageGroupNumber": "007621224", "fromDate": "1730-01-01" }` | `fromDate and toDate require placeId.` |

### Part D — Not authenticated (optional)

Wipe the session, then call Part A again:

```bash
rm -f ~/.familysearch-mcp/tokens.json
```

Expected: an error with `isError: true` directing Claude to call
`login`. Re-run `login` afterward to restore the session.

### What success looks like (Layer 1)

- Tool shows up in the Inspector.
- Both query modes return structured data.
- Validation errors are clear and make no network call.

### When to move on

Move to Layer 2 when both happy paths and the validation checks pass.

---

## Layer 2: Claude Code as Client

**What this tests:** Does Claude understand when and how to use the tool
from natural language, and does it pass `placeId` (not `placeRepId`)?

> **Note:** Run this from a scratch directory, **not** from inside the
> dev repo. Inside the repo, Claude tends to shortcut to the
> `dev/try-image-search.ts` script via Bash instead of going through the
> MCP, which defeats the point of this layer.

### Steps

1. Register the local build (one-time):

   ```bash
   claude mcp add --transport stdio genealogy-dev -- node /path/to/cowork-genealogy/mcp-server/build/index.js
   ```

2. Start a fresh session in a scratch folder:

   ```bash
   mkdir -p ~/mcp-test-scratch && cd ~/mcp-test-scratch && claude
   ```

3. Type `/mcp` to confirm `genealogy-dev` is connected.

4. Make sure you have a valid session. If needed:

   > "Log me in to FamilySearch. My client ID is YOUR-KEY."

5. Test the place + date workflow:

   > "What image groups (digitized volumes) cover Edensor, Derbyshire between 1730 and 1810?"

   Claude should call `place_search` to resolve Edensor → `placeId
   6137147`, then call `image_search` with that `placeId` and the date
   range — **not** a `placeRepId`.

6. Test the image group number workflow:

   > "Look up image group number 007621224."

   Claude should call `image_search` with `imageGroupNumber: "007621224"`
   directly, with no `place_search` first.

### What success looks like

Claude picks the right tool, passes a `placeId` (not a `placeRepId`),
and presents the image groups clearly (group number, record type, date
range).

### What failure looks like

- Claude doesn't use `image_search` → the description doesn't match the
  user's natural language.
- Claude passes a `placeRepId` where a `placeId` is expected → the
  schema description should clarify the difference.
- Claude calls the tool but gets an auth error and doesn't recover →
  the auth error message should tell Claude to call `login`.

### Troubleshooting

If you change the server code:

1. Rebuild: `cd mcp-server && npm run build`
2. In Claude Code, type `/mcp` to reconnect.
3. Try again.

### When to move on

Move to Layer 3 when Claude successfully uses the tool from natural
language in both modes.

---

## Layer 3: Cowork

Layers 3a (WSL2) and 3b (Native Windows) follow the same pattern as the
other tool guides — see
[place-collections-tool-testing-guide.md](./place-collections-tool-testing-guide.md)
§ "Layer 3a/3b" for the Claude Desktop config and restart steps. Use
these prompts in a Cowork session once the server is wired up:

> "What image groups cover Edensor, Derbyshire between 1730 and 1810?"

> "Look up image group number 007621224."

Verify the same results as Layer 2, running through the full Cowork →
Claude Desktop → MCP server pipeline.

---

## Quick Reference: Commands

| What | Command |
|------|---------|
| Build server | `cd mcp-server && npm run build` |
| Run tests | `cd mcp-server && npm test` |
| Smoke test (place + date) | `npx tsx dev/try-image-search.ts --placeId 6137147 --from 1730-01-01 --to 1810-12-31` |
| Smoke test (image group no.) | `npx tsx dev/try-image-search.ts --imageGroupNumber "007621224"` |
| Run Inspector | `cd mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Wipe session (Linux/WSL) | `rm -f ~/.familysearch-mcp/tokens.json` |
| Wipe session (PowerShell) | `Remove-Item $env:USERPROFILE\.familysearch-mcp\tokens.json` |
| Reconnect in Claude Code | `/mcp` |

---

## Summary: What Each Layer Catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 - Smoke test | Direct function call vs live API | API shape mismatches, forward/reverse placeId conversion, WAF blocks |
| 1 - Inspector | Tool through MCP protocol | Schema errors, serialization bugs, validation gaps, auth propagation |
| 2 - Claude Code | LLM tool selection + presentation | Bad descriptions, `placeId`/`placeRepId` confusion |
| 3 - Cowork | Full pipeline | Bridge + token path + cross-platform issues |

**Don't skip layers.** Each one catches bugs the others miss.
