# MCPB Install Testing Guide

This guide walks **you (a developer/tester)** through verifying that the
`.mcpb` desktop extension builds, validates, and installs correctly. Run
it whenever you change the manifest, the build/verify scripts, the tool
registry, or anything that ships inside the bundle.

It is **not** end-user documentation — end-user install steps live in
[README.md](../../README.md) → "Installation (for end users)".

The contract these layers check is
[`docs/specs/mcpb-package-spec.md`](../specs/mcpb-package-spec.md).

Follow the layers in order. The first three are scriptable and run on any
machine (including WSL2/Linux). Layers 4–5 require Claude Desktop and are
the manual install/round-trip checks.

---

## Layer 1: Build the artifact

**What this tests:** The build script compiles, stages a production-only
tree, validates the manifest, and packs a `.mcpb`.

**Time needed:** 2 minutes

### Steps

```bash
cd /home/gennesis/cowork-genealogy
./scripts/build-mcpb.sh
```

### What success looks like

- `Manifest schema validation passes!`
- An `mcpb info` summary: `genealogy-mcp@0.1.0`, a package size of a few MB
  (production deps only), and a non-trivial `ignored (.mcpbignore) files`
  count.
- `Done. Created .../releases/genealogy-mcp.mcpb`

### What failure looks like

- A manifest validation error → the manifest violates the 0.3 schema; fix
  it and re-run. The unit guard `packages/engine/mcp-server/tests/packaging/manifest.test.ts`
  catches most of these earlier.
- `npm ci` fails in the stage → `package-lock.json` is out of sync; run
  `npm install` in `packages/engine/mcp-server/` and retry.

---

## Layer 2: Validate and inspect

**What this tests:** The manifest conforms to the schema and the packed
archive has no surprises.

**Time needed:** 2 minutes

### Steps

```bash
cd /home/gennesis/cowork-genealogy/packages/engine/mcp-server
npx mcpb validate manifest.json
npx mcpb info ../releases/genealogy-mcp.mcpb
```

### What success looks like

- `Manifest schema validation passes!`
- The archive's top-level entries are `manifest.json`, `package.json`,
  `build/`, `config/`, `node_modules/` — nothing else.

---

## Layer 3: Boot the packed server

**What this tests:** The packed bundle (not just the source tree) contains
every production dependency and actually starts, and the server advertises
exactly the tools the manifest declares.

**Time needed:** 1 minute

### Steps

```bash
cd /home/gennesis/cowork-genealogy
./scripts/verify-mcpb.sh
```

### What success looks like

- Every `present:` / `absent:` content check prints `ok`.
- `server booted; tools/list returned all 21 tools`
- `Verification passed.`

### What failure looks like

- A missing prod dependency → the unpacked server can't start; check that
  the dep is in `dependencies` (not `devDependencies`) in
  `packages/engine/mcp-server/package.json`.
- A forbidden path present (e.g. `node_modules/typescript`) → the staging
  step or `.mcpbignore` regressed.
- Tool mismatch → `manifest.tools` drifted from the registry; the script
  prints which names are missing/extra.

---

## Layer 4: Install in Claude Desktop

**What this tests:** Claude Desktop accepts the bundle and registers the
extension. **Prerequisite:** Claude Desktop installed (Windows or macOS).

**Time needed:** 5 minutes

### Steps

1. Copy `releases/genealogy-mcp.mcpb` to the machine running Claude Desktop
   (if you built in WSL2, copy it to the Windows side).
2. Open Claude Desktop → **Settings → Extensions**.
3. Click **Install Extension…** and select `genealogy-mcp.mcpb`.
4. Confirm **"Genealogy Research"** appears in the extensions list.

### What success looks like

- The extension installs without an error dialog. (Claude Desktop will
  note it is **unsigned** — that is expected; we do not sign the bundle
  yet. Approve/allow it.)
- Expanding the extension shows its tools.

### What failure looks like

- "Invalid extension" → the manifest or archive layout is wrong; re-run
  Layers 1–3.
- The extension installs but shows 0 tools → the server failed to start on
  the host; check Claude Desktop's MCP logs.

---

## Layer 5: Exercise a tool + full Cowork round-trip

**What this tests:** The installed host server actually responds, and the
host → VM → skill pipeline works end-to-end.

**Time needed:** 10 minutes

### Steps

1. In a Claude Desktop chat (with the extension installed), ask:

   > "Find FamilySearch info for Ohio."

   Claude should call `place_search` and report structured place data.

2. Install the Cowork plugin too (`releases/genealogy-plugin.zip`, see
   README → "Install the Cowork plugin"), then in a Cowork session ask:

   > "Look up Albert Einstein on Wikipedia."

   The `search-wikipedia` skill should call `wikipedia_search` and save a
   markdown file to your working folder.

### What success looks like

A tool call returns structured JSON and (for the skill path) a file is
written — proving host → MCP server → SDK bridge → VM → skill → file write.

---

## Known limitation: wiki-page tools need a local corpus

Two tools — `wiki_read` and `wiki_place_page` (all four sections:
`home`, `getting_started`, `online_records`, `research_tips`) — register
and are callable, but read a pre-crawled markdown corpus via
`wikiMarkdownDir` in `~/.familysearch-mcp/config.json`. That corpus is
**not bundled in the `.mcpb`**, so on a stock install those tools throw a
config-missing error at runtime. Shipping/hosting the corpus is tracked
separately. The other 17 tools work out of the box (the bundled
FamilySearch clientId covers the authenticated tools; `wiki_search` and
`place_population` use hosted services).

---

## Troubleshooting

**Changes don't take effect after re-installing.** The MCP server is a
*built* artifact. Rebuild (`./scripts/build-mcpb.sh`), then **fully quit
Claude Desktop** (system tray → right-click → Quit; closing the window is
not enough) before re-installing. See
[DEVELOPMENT.md](../../DEVELOPMENT.md) → "Deploying a code change to Claude
Desktop".

**`login` opens no browser tab.** Expected in sandboxed contexts — Claude
returns the authorization URL in its reply instead. See DEVELOPMENT.md →
"`login` doesn't open a browser tab".
