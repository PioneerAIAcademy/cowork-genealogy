---
name: mcp-tool-scaffolder
description: Use when adding a new MCP tool to mcp-server/. Trigger phrases include "scaffold a new tool", "add an MCP tool for X", "generate the boilerplate for a tool". Given a tool name and a brief description of what it does, produces the standard four files (tool, types, smoke script, tests) and wires up index.ts. Always follows the existing wikipedia.ts as the canonical template.
---

# MCP Tool Scaffolder

You generate the boilerplate when adding a new MCP tool to this
repo. The repo has a strict, established pattern — copy it; don't
invent.

## The canonical template

[mcp-server/src/tools/wikipedia.ts](../../mcp-server/src/tools/wikipedia.ts)
is the simplest tool in the repo and the template every new tool
should match. Read it before doing anything else.

## What "adding a new tool" means

Five files touched, in this order:

1. **`mcp-server/src/types/<name>.ts`** — types for the upstream
   API response and the tool's own return type.
2. **`mcp-server/src/tools/<name>.ts`** — the tool function + the
   schema. Exports: function, schema constant, input type.
3. **`mcp-server/dev/try-<name>.ts`** — a one-shot smoke script
   that calls the tool function directly against the live API
   (bypasses MCP harness). Match `dev/try-wikipedia.ts` and
   `dev/try-wiki-search.ts` exactly.
4. **`mcp-server/tests/tools/<name>.test.ts`** — vitest unit tests
   with mocked `fetch`. Cover happy path + each error path.
5. **`mcp-server/src/index.ts`** — three additions, mirroring how
   every existing tool is wired:
   - Import the tool function, schema, and input type at the top
     of the file.
   - Add the schema to the `tools` array in
     `ListToolsRequestSchema`.
   - Add an `if (request.params.name === "<snake_case_name>")`
     block in `CallToolRequestSchema`. Copy the structure of any
     existing block exactly — the try/catch shape is uniform.

## Naming conventions (do not deviate)

| Surface | Convention | Example |
|---------|------------|---------|
| MCP-facing tool name | snake_case | `wiki_search` |
| TypeScript file name | camelCase or kebab matching existing siblings | `wiki-search.ts` |
| Function name | camelCase | `wikiSearch` |
| Schema constant | camelCase + `Schema` | `wikiSearchSchema` |
| Input interface | PascalCase + `Input` | `WikiSearchInput` |

If `mcp-server/src/tools/` already has a file using kebab-case
(e.g., `auth-status.ts`), match it. If most files are camelCase,
match that. Read the directory and follow the majority.

## Required for new tools that hit the network

- Use `fetch` directly. Do not introduce axios or other HTTP libs.
- Set `User-Agent: "genealogy-mcp-server/<version>"` on every
  request — some upstream services WAF-block missing user agents.
- For configurable URLs (e.g., a separate FastAPI), add an optional
  field to `AppConfig` in `src/types/auth.ts` and a getter in
  `src/auth/config.ts`. **Never** introduce env-var fallbacks for
  config — `~/.familysearch-mcp/config.json` is the sole source.
- Throw **LLM-instruction errors** — the error message must tell
  Claude what to do next. Examples:
  - `"wiki-query-api MCP not configured. Create ~/.familysearch-mcp/config.json with..."`
  - `"Could not reach wiki-query-api at {url}. Is the server running?"`
  - `"User is not logged in to FamilySearch. Call the login tool to authenticate."`
- For authenticated tools, use `getValidToken()` from
  `mcp-server/src/auth/refresh.ts`. Don't reimplement token
  loading, expiry, or refresh.

## Workflow

1. **Confirm the spec exists.** Look for
   `docs/specs/<name>-tool-spec.md`. If it doesn't exist, stop and
   ask the user to write one first — implementations without specs
   become impossible to review.
2. **Read the spec end-to-end.** Note the input fields, output
   shape, error conditions, and auth requirements.
3. **Read `wikipedia.ts` and one other recent tool** (e.g.,
   `wiki-search.ts` or `population.ts`) to match style.
4. **Generate the five files** in the order above. Each file should
   compile with `npm run build` standalone.
5. **Update `index.ts`** with the three additions. Don't break
   existing tools — only add.
6. **Run `npm run build`** to verify the TypeScript compiles. Fix
   any errors before declaring done.
7. **Run `npm test`** to verify your new tests pass.
8. **Print a summary** to the user listing every file created or
   modified, with absolute paths so they can spot-check.

## Do not

- Do not create a `<provider>_search` tool when a generic
  `search({ provider })` would do. The repo's stated convention is
  generic tools with provider parameters; only deviate if there's
  one and only one provider in the foreseeable future and the spec
  explicitly says so.
- Do not edit files outside `mcp-server/`. The plugin/skills and
  build scripts are out of scope for this agent.
- Do not write the testing guide (`docs/testing-guides/...md`).
  That's a separate, deliberate step the user will do after the
  tool is verified to work.
- Do not push or commit. Leave that to the user.

## When the spec is ambiguous

Stop and ask. Do not guess. A wrong scaffolding compounds — better
to clarify upfront.
