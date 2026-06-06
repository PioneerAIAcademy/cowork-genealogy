# MCPB Package — Build & Manifest Spec

## Overview

Defines what the host-side artifact — the Claude Desktop extension
`releases/genealogy-mcp.mcpb` — must contain and how it is built, so that
it installs cleanly in Claude Desktop and exposes the MCP server's tools.

The `.mcpb` is a ZIP archive of the compiled MCP server plus a
`manifest.json` that conforms to the official MCPB manifest schema. It is
built from `mcp-server/` with the official `@anthropic-ai/mcpb` CLI.

This spec is the source of truth the `spec-review` agent and
`mcp-server/tests/packaging/manifest.test.ts` check the manifest and build
against.

---

## Manifest contract

`mcp-server/manifest.json` MUST conform to MCPB manifest schema version
**`0.3`** (the current version as of 2025-12-02). Required and pinned
fields:

| Field | Requirement |
|-------|-------------|
| `manifest_version` | `"0.3"` |
| `name` | `"genealogy-mcp"` (machine-readable id) |
| `display_name` | `"Genealogy Research"` |
| `version` | Semver; MUST equal `mcp-server/package.json` `version` |
| `description` | Real one-line summary. MUST NOT contain `scaffold` or `hello-world` |
| `author` | Object with non-empty `name` (MUST NOT be `"Your Name"`), plus `url` |
| `repository` | `{ "type": "git", "url": "https://github.com/PioneerAIAcademy/cowork-genealogy" }` |
| `homepage` | Repository URL |
| `license` | `"Apache-2.0"` (matches `LICENSE`) |
| `keywords` | Includes `genealogy`, `familysearch`, `mcp` |
| `server` | See below |
| `tools` | Array of `{ name }` for every registered tool (see Tool list) |
| `compatibility` | See below |

The manifest MUST NOT declare a `user_config` block. Per-user settings
(`wikiApiUrl`, `wikiMarkdownDir`) are read only from
`~/.familysearch-mcp/config.json` (`src/auth/config.ts`); the project
convention forbids env-var injection, which is the only channel
`user_config` offers.

### `server`

```json
{
  "type": "node",
  "entry_point": "build/index.js",
  "mcp_config": {
    "command": "node",
    "args": ["${__dirname}/build/index.js"]
  }
}
```

`${__dirname}` is the MCPB-substituted absolute path to the installed
extension directory.

### `compatibility`

```json
{
  "platforms": ["darwin", "win32", "linux"],
  "runtimes": { "node": ">=18.0.0" }
}
```

A `claude_desktop` version constraint is intentionally omitted to avoid
falsely blocking installs.

### Tool list (`tools`)

Every tool registered in `src/index.ts`'s `ListTools` handler MUST appear
in `manifest.tools`, and no extras. As of this spec the set is the 19
tools below; the drift test enforces equality with `allToolSchemas`
(`src/tool-schemas.ts`):

```
wikipedia_search, place_search, login, logout, auth_status,
collections_search, collection_read, wiki_search, place_distance,
place_population, external_links_search, image_read, record_search,
same_person, person_read, fulltext_search, wiki_read, wiki_place_page,
validate_research_schema
```

---

## Bundle contract

The packed `.mcpb` MUST contain:

| Path | Why |
|------|-----|
| `manifest.json` | Install metadata + server config |
| `package.json` | Node entry-point resolution |
| `build/` | Compiled JS (`tsc` output); `build/index.js` is the entry point |
| `config/familysearch.json` | Bundled OAuth clientId — without it every authenticated tool breaks (guarded by `tests/auth/bundled-client-config.test.ts`) |
| `node_modules/` | **Production dependencies only** |

The packed `.mcpb` MUST NOT contain:

- `src/`, `tests/`, `dev/` (TypeScript source, tests, dev scripts)
- `tsconfig.json`, `vitest.config.ts`
- devDependencies (`typescript`, `vitest`, `@types/*`, `@anthropic-ai/mcpb`)
- `node_modules/.cache/`, `node_modules/.bin/`

Production-only `node_modules` is achieved by staging a clean tree and
running `npm ci --omit=dev` against it — never by mutating the developer's
`mcp-server/node_modules`. Source exclusions are enforced by
`mcp-server/.mcpbignore`.

---

## Build process

`scripts/build-mcpb.sh`:

1. `cd mcp-server && npm install && npm run build` — compile to `build/`.
2. Stage a temp dir (`mktemp -d`): copy `manifest.json`, `package.json`,
   `package-lock.json`, `build/`, `config/`, `.mcpbignore`.
3. `npm ci --omit=dev --ignore-scripts` inside the stage — production
   `node_modules` only (`--ignore-scripts` skips dependency lifecycle
   scripts for a deterministic, side-effect-free install).
4. `npx mcpb validate <stage>` — fails the build on a non-conformant
   manifest (`mcpb pack` also validates).
5. `npx mcpb pack <stage> releases/genealogy-mcp.mcpb`.
6. `npx mcpb info releases/genealogy-mcp.mcpb` — print the packed summary.

Output: `releases/genealogy-mcp.mcpb` (gitignored via `releases/*`).

---

## Verification

`scripts/verify-mcpb.sh` (run after build):

1. Unzip `releases/genealogy-mcp.mcpb` to a temp dir.
2. Assert every required bundle path is present and every forbidden path
   is absent (per the Bundle contract).
3. Launch `node build/index.js` from the unpacked dir and drive a
   JSON-RPC `initialize` → `initialized` → `tools/list` handshake over
   stdio. Assert the response lists exactly the 21 tools above.

This proves the packed artifact — not just the source tree — boots and
advertises its tools, which is the closest programmatic stand-in for an
end-user install (the GUI "Install Extension" step is a manual layer in
`docs/testing-guides/mcpb-install-testing-guide.md`).

---

## Versioning

`manifest.json` `version`, `mcp-server/package.json` `version`, and the
`new Server({ version })` literal in `src/index.ts` MUST stay in sync.
This spec's baseline is `0.1.0` (first real packaged release, replacing
the `0.0.1` scaffold).

---

## References

- MCPB manifest schema: https://github.com/anthropics/mcpb/blob/main/MANIFEST.md
- MCPB CLI commands: https://github.com/anthropics/mcpb/blob/main/CLI.md
- Bundled clientId convention: `CLAUDE.md` → "Secrets/config convention"
- Per-user config (`wikiApiUrl`, `wikiMarkdownDir`): `src/auth/config.ts`
