# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For developer-facing build, test, and feature-addition recipes, see
[DEVELOPMENT.md](./DEVELOPMENT.md). This file covers architecture,
conventions, and rules — what Claude needs to know to make correct
changes.

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

### External service dependencies

Two MCP tools call hosted sidecar services rather than public APIs:

- `wiki_search` calls the hosted `wiki-query-api` (a FastAPI server in
  a sibling repo) for RAG retrieval over the FamilySearch Wiki.
- `place_population` calls the hosted Pop Stats API.

The MCP code is HTTP-only for both — it does not import or depend on
any Python code from either service. The base URL for `wiki_search`
can be overridden per-user via `wikiApiUrl` in
`~/.familysearch-mcp/config.json` (useful for pointing at a local dev
instance); end users do not need to set this for normal operation.

## Repository layout

- `mcp-server/` — TypeScript source for the MCP server. Compiles to
  `mcp-server/build/`. The `.mcpb` is built from this.
- `plugin/` — The Cowork plugin folder. Packaged as a .zip directly,
  no compilation step.
- `scripts/` — Build scripts for both artifacts.
- `mcp-server/dev/` — Developer-only scripts: `try-*.ts` one-shot
  smoke tests that invoke a tool directly against live APIs (no MCP
  harness; useful for debugging a tool in isolation), plus
  `probe-*.ts` and `explore-*.ts` scripts that document the live-API
  evidence trail behind each spec. Not shipped in any artifact.
- `mcp-server/scripts/` — Reserved for future user-facing scripts.
  Currently empty. Do not put internal/developer scripts here; they
  belong in `mcp-server/dev/`.
- `mcp-server/src/utils/` — Shared utility modules consumed by multiple
  MCP tools. Currently houses `gedcomx-convert.ts` (round-trip between
  full GedcomX and the simplified format defined in
  `docs/specs/simplified-gedcomx-spec.md`; implementation spec at
  `docs/specs/gedcomx-convert-spec.md`).
- `releases/` — Build output. Gitignored except for `.gitkeep`.
- `docs/plan/` — Implementation plans for tools (how we intend to build).
- `docs/specs/` — Finalized specs (what the tool must do). Specs are the
  source of truth the `spec-review` agent checks implementations against.
- `docs/*-testing-guide.md` — Layered manual testing playbooks
  (Inspector → Claude Code → Cowork). Used to verify each new tool
  end-to-end before shipping.

## Tools and skills

For the user-facing tool catalog (purpose, auth, examples) and skill
catalog (descriptions, workflow), see `README.md`. This file is the
agent operating manual — it covers architecture, conventions, and how
to make changes, not what each individual tool/skill does.

Tools are registered in `mcp-server/src/index.ts` and live in
`mcp-server/src/tools/`. Per-tool behavioral contracts are in
`docs/specs/<tool>-tool-spec.md`. Implementation plans (including for
tools not yet built, such as `tree_attachments`) are in `docs/plan/`.
Skills live in `plugin/skills/<skill>/SKILL.md`.

## Researcher profile in `research.json`

Per-project context about the researcher (experience level, paid
subscriptions, derived narration guidance) lives in a
`researcher_profile` section of `research.json`. `init-project` writes
it after a short two-question interview at project start. Every
`SKILL.md` opens with a one-line `**Narration:**` instruction that
tells Claude to read `researcher_profile.narration_guidance` and apply
it as the narration style for that invocation.

Three architectural rules made this design necessary:

- **No cross-session storage on the host.** Cowork sessions are
  ephemeral; only the project folder persists. Anything that needs to
  live across sessions has to live in `research.json` or
  `tree.gedcomx.json`. There is no `~/.cowork-genealogy/` to write to.
- **No shared SKILL.md reference loading.** Claude Code's relative-
  path resolution from SKILL.md is unreliable (issue #17741). Shared
  reference docs across skills are duplicated, not linked from a
  `plugin/references/` location.
- **No plugin-level CLAUDE.md auto-load.** Anthropic's plugin docs are
  explicit that `<plugin>/CLAUDE.md` is not loaded as context.
  Cross-cutting instructions go in each `SKILL.md`, not in a single
  plugin-level file.

Net effect: shared per-project state goes in `research.json`. Schema
extensions (new `researcher_profile` fields, new project sections)
require updates to three places: `docs/specs/schemas/research.schema.json`,
the prose table in `docs/specs/research-schema-spec.md`, and the
validator at `plugin/skills/validate-schema/scripts/validate_project.py`.
The interview lives in `init-project/SKILL.md`.

## Auth architecture (`mcp-server/src/auth/`)

All authenticated tools (`place_collections`, `record_search`,
`tree_read`, and `fulltext_search`) must go through this module — do not
re-implement token plumbing.

- `config.ts` — OAuth URLs, callback port, scopes, a per-user
  config store at `~/.familysearch-mcp/config.json` (`loadConfig` /
  `saveConfig`, used only for tunables like `wikiApiUrl`), and
  `getClientId()` which reads the bundled
  `mcp-server/config/familysearch.json` at runtime. The bundled file
  is the **sole** source of the FS client ID — no env-var fallback,
  no per-user override. On missing/corrupt bundled file it throws an
  installation-framed error (not an LLM-actionable one), since the
  file ships with the `.mcpb` and is always present under normal
  install.
- `pkce.ts` — `generatePKCE()` and `generateState()`, stdlib `crypto` only.
- `tokenManager.ts` — `saveTokens` / `loadTokens` / `clearTokens` /
  `isExpired` against `~/.familysearch-mcp/tokens.json`. All file ops
  return `null` rather than throwing on missing/corrupt input.
- `refresh.ts` — **`getValidToken()` is the single entry point** for
  authenticated tools. It loads tokens, auto-refreshes if expired, and
  throws an LLM-instruction error ("Call the login tool to
  authenticate.") when no valid session is available.
- `login.ts` — Full OAuth flow (HTTP callback server + browser launch +
  code exchange + token save). Returns `LoginResult`, never throws.

### Secrets/config convention

Two distinct config sources:

1. **Bundled, shipped with the MCP server:**
   `mcp-server/config/familysearch.json`. Holds the FamilySearch
   OAuth `clientId`. Committed to git, packaged into the `.mcpb`,
   read at runtime by `getClientId()`. Users and the LLM never see
   it. To rotate, edit the file and re-ship.

2. **Per-user, on the user's machine:** `~/.familysearch-mcp/`
   directory, `mode: 0o600`. Holds `tokens.json` (OAuth tokens from
   `login`) and `config.json` (per-user tunables like `wikiApiUrl`,
   `wikiMarkdownDir`). `loadConfig` / `saveConfig` read and write
   the per-user JSON. **Do not** introduce env-var fallbacks — the
   files are the sole sources. New per-user keys go on `AppConfig`
   in `src/types/auth.ts` and are read via `loadConfig()`.

Currently recognized fields in `~/.familysearch-mcp/config.json` (per-user):

| Field | Used by | Required | Notes |
|-------|---------|----------|-------|
| `wikiApiUrl` | `wiki_search` | When using `wiki_search` | Base URL of the upstream `wiki-query-api` FastAPI. Local dev: `"http://localhost:8000"`. Read by `getWikiApiUrl()` in `src/auth/config.ts`. Trailing slash is stripped. |
| `wikiMarkdownDir` | `wiki_read`, `wiki_country_*` | When using any wiki page tool | Path to the pre-crawled wiki markdown files (e.g. `.../wiki/02_markdown/20260416_160227/`). Read by `getWikiMarkdownDir()` in `src/auth/config.ts`. |
| `learningCenterDir` | (future) | Optional | Path to the pre-crawled learning center markdown files. Read by `getLearningCenterDir()` in `src/auth/config.ts`. Returns `null` when absent (not an error). |
| `libraryDir` | (future) | Optional | Path to the pre-crawled library markdown files. Read by `getLibraryDir()` in `src/auth/config.ts`. Returns `null` when absent (not an error). |

Each `get*` helper throws an LLM-instruction error when its required
field is missing — the error message tells Claude what to put in the
file so end users can be guided to fix it.

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

## Code reuse

Before writing new logic, check whether something equivalent already
exists. If it does, call it. If it's close but not quite, extend the
existing function (add a parameter, widen the return type) rather
than create a parallel copy. If you find yourself pasting code from
one tool into another, stop — lift the shared piece into a proper
module instead.

Where to look first:

- **`src/auth/`** — `getValidToken()` is the only correct way to
  read a FamilySearch access token. Don't re-implement token
  loading, expiry checks, or refresh. The same applies to anything
  else here (PKCE, config loading, token storage).
- **`src/auth/config.ts`** — `loadConfig()` / `getClientId()` is
  the single source for app config. New provider keys go on
  `AppConfig` in `src/types/auth.ts`, not into env vars or
  ad-hoc files.
- **`src/types/`** — shared API response and tool I/O types live
  here. If a second tool touches the same upstream API, put the
  response shape here so both stay in sync.
- **`src/constants.ts`** — `BROWSER_USER_AGENT` is the Mozilla
  browser UA every tool that hits a FamilySearch endpoint must
  send. FS sits behind Imperva, which 403s non-browser UAs
  (including `fs-search-agent` from the FS-internal API
  examples). Import this constant instead of hardcoding the
  string — `place_collections`, `record_search`, `place_external_links`,
  `image_read`, and `fulltext_search` already do.
- **Exported helpers in `src/tools/`** — for example, `place-search.ts`
  exports `searchPlace`, `getPlaceById`, and `getWikipediaSummary`,
  and `place-collections.ts` exports `fetchAllCollections`,
  `filterByQuery`, and `filterByPlaceIds`. A new tool that needs
  place lookup or Wikipedia enrichment should call these, not
  re-fetch.

Soft caveat: don't pre-extract for hypothetical reuse. Wait for the
second concrete need before factoring code into a shared module —
premature abstractions calcify around the first caller's assumptions
and make the next use case harder to fit. Two near-duplicates is the
signal to consolidate; one isn't.

## Subagents

Three project subagents live under `.claude/agents/`. Claude Code
invokes them automatically when their description matches the
request, or you can call them explicitly with the Agent tool.

- **`spec-review`** — read-only. Compares an MCP tool implementation
  against its `docs/specs/<tool>-tool-spec.md` and reports drift,
  quoting both sides. Use it before every PR that touches a specced
  tool.
- **`mcp-tool-scaffolder`** — generates the standard four-file
  scaffolding (`src/types/<name>.ts`, `src/tools/<name>.ts`,
  `dev/try-<name>.ts`, `tests/tools/<name>.test.ts`) and wires up
  `mcp-server/src/index.ts`. Follows `wikipedia.ts` as the canonical
  template. Requires the spec exist first.
- **`cowork-skill-builder`** — generates a Cowork skill that wraps
  an existing MCP tool, following `plugin/skills/search-wikipedia/` as
  the reference. Refuses to put network code in skills (architectural
  rule: skills run in the VM with no egress).

Each agent's `description` field tells Claude when to invoke it.

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

## Working reference skill

The `search-wikipedia` skill in `plugin/` is the canonical minimal
example of the full plugin pipeline — it calls the `wikipedia_search`
MCP tool, populates a markdown template, and saves the result to a
file. Copy this structure when wiring a new skill to one of the other
tools. Don't mutate `search-wikipedia` itself; create a new skill
folder.
