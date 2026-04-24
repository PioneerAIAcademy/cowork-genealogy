# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `PROJECT-GOAL.md` for the current implementation focus and task progress.**

## Build Commands

```bash
cd mcp-server && npm install && npm run build       # Build MCP server
cd mcp-server && npm test                            # Run all tests (vitest)
cd mcp-server && npx vitest run tests/tools/places.test.ts   # Run a single test file
cd mcp-server && npx vitest run -t "test name"       # Run tests matching a name
./scripts/build-mcpb.sh                              # Package .mcpb extension (→ releases/)
./scripts/package-plugin.sh                          # Package plugin .zip (→ releases/)
```

Quick manual smoke-test against live APIs (bypasses the MCP harness):

```bash
cd mcp-server && npx tsx scripts/try-wikipedia.ts "Albert Einstein"
cd mcp-server && npx tsx scripts/try-places.ts "Ohio"
```

## What this project is

A Claude Cowork plugin + desktop extension for genealogy research.
We ship two separate artifacts from this single repo:

- A TypeScript MCP server packaged as a `.mcpb` desktop extension
  (runs on the host)
- A Cowork plugin folder packaged as a `.zip` (runs in the Cowork VM)

These two pieces are tightly coupled and must be developed together,
which is why they live in one repo.

## Architecture you must understand before changing anything

Cowork runs Claude inside a sandboxed Linux VM. The VM has restricted
network access — its egress allowlist is broken for arbitrary domains.
This means **code that needs to make external API calls cannot run
inside the VM**. It must run on the host.

The MCP server runs on the host (full network access). Skills and
their bundled scripts run inside the VM (no reliable network access).
They communicate only through MCP tool calls — structured JSON in,
structured JSON out. They cannot share files at runtime.

When adding a feature, ask: "Does this need the network?" If yes, it's
an MCP tool. If no (it's data processing, formatting, or templating),
it can be a skill script.

## Repository layout

- `mcp-server/` — TypeScript source for the MCP server. Compiles to
  `mcp-server/build/`. The `.mcpb` is built from this.
- `plugin/` — The Cowork plugin folder. Packaged as a .zip directly,
  no compilation step.
- `scripts/` — Build scripts for both artifacts.
- `mcp-server/scripts/` — `try-*.ts` one-shot smoke-test scripts that
  invoke a tool directly against live APIs (no MCP harness). Useful for
  debugging a tool in isolation.
- `releases/` — Build output. Gitignored except for `.gitkeep`.
- `docs/plan/` — Implementation plans for tools (how we intend to build).
- `docs/specs/` — Finalized specs (what the tool must do). Specs are the
  source of truth the `spec-review` agent checks implementations against.

## Implemented tools

Registered in `mcp-server/src/index.ts`. Source in `mcp-server/src/tools/`.

### `wikipedia_search`

Fetches a Wikipedia article summary. No auth. See
`docs/specs/wikipedia-tool-spec.md`.

### `places`

Returns FamilySearch place data enriched with Wikipedia summaries. No auth
(uses the public FamilySearch places endpoints).

```typescript
places({ query: "England" })      // Search by name
places({ query: "267" })          // Lookup by place ID
```

Returns: `placeId`, `name`, `fullName`, `type`, `latitude`, `longitude`,
`dateRange`, `parentPlaceId`, `wikipedia` enrichment, and URLs. Plan in
`docs/plan/places-tool.md` / `places-tool-v2.md`.

## Important conventions

### MCP server tools

Tools are defined in `mcp-server/src/tools/`. Each tool exports a
single function and its schema. The entry point in `src/index.ts`
imports them and registers them with the MCP server.

Use generic tool names with provider parameters when scaling, not
one tool per provider. For example, when we add real APIs, use
`search({ provider: "familysearch", ... })`, not `familysearch_search`.
This keeps the tool count low and Claude's context window lean.

### Skills

Skills live in `plugin/skills/<skill-name>/`. Each skill has:

- `SKILL.md` — The instructions Claude reads. Includes frontmatter
  with `name`, `description`, and (if needed) `allowed-tools`.
- `templates/` — Markdown templates Claude fills in
- `references/` — Reference docs Claude loads on demand
- `scripts/` — Python scripts (stdlib only) for data processing.
  Remember: these run in the VM with no network access.

The `description` in SKILL.md frontmatter is critical — it determines
when Claude triggers the skill. Be specific about what kinds of user
requests should activate it.

### Slash commands

Commands in `plugin/commands/<name>.md` give users explicit triggers
for skills. They're shortcuts users can type instead of describing
what they want.

## How to add a new feature

Example: adding a "list providers" feature.

1. Add the tool to the MCP server:
   - Create `mcp-server/src/tools/list-providers.ts`
   - Register it in `mcp-server/src/index.ts`
   - Run `npm run build` in `mcp-server/`

2. Add or update a skill that uses it:
   - Create `plugin/skills/list-providers/SKILL.md`
   - In the SKILL.md, instruct Claude to call the new tool
     when the user asks what providers are available

3. (Optional) Add a slash command:
   - Create `plugin/commands/providers.md`

4. Rebuild both artifacts:
   ```bash
   cd mcp-server && npm run build && cd ..
   ./scripts/build-mcpb.sh
   ./scripts/package-plugin.sh
   ```

5. Manually test by installing both artifacts in Claude Desktop.

## What NOT to do

- Don't try to share code at runtime between the MCP server and the
  skills. They're isolated. Duplicate the structures in both places
  if needed.
- Don't put network-calling code in skill scripts. It will be silently
  blocked by the VM's egress proxy.
- Don't add Python dependencies that aren't in the standard library
  to skill scripts. The VM may not have them, and pip installs slow
  down skill execution.
- Don't create one MCP tool per provider/endpoint. Use generic tools
  with parameters to keep the tool count manageable.
- Don't reference files across the `mcp-server/` and `plugin/`
  directories at runtime. Build-time references via the build scripts
  are fine, runtime references are not.

## End-to-end testing

After building both artifacts and installing them in Claude Desktop,
exercise an MCP tool from inside a Cowork session (e.g. ask Claude to
look up a place: "Find FamilySearch info for Ohio"). Claude should call
the `places` tool, get structured JSON back, and — if a skill tells it
to — write a file to the selected folder. If that round-trip works, the
full pipeline is wired: host → MCP server → SDK bridge → VM → Claude →
file write.

**Known drift:** the `say-hello` skill and `/hello` command in `plugin/`
still reference the removed `hello` MCP tool. They'll fail until the
skill is retargeted at a real tool or removed. Don't treat them as a
working example when adding new skills — use the conventions below.
