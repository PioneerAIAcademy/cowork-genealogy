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

Several MCP tools call hosted sidecar services rather than public APIs:

- `wiki_search`, `wiki_read`, and `wiki_place_page` all call the hosted
  `wiki-query-api` (a FastAPI server in a sibling repo). `wiki_search`
  hits `POST /search` for RAG retrieval; `wiki_read` and `wiki_place_page`
  hit `GET /page/{title}` for a specific wiki page. The pre-crawled
  markdown corpus lives on the server, not on each developer's laptop.
- `place_population` calls the hosted Pop Stats API.

The MCP code is HTTP-only for all of these — it does not import or
depend on any Python code from those services. The base URL for the
wiki tools can be overridden per-user via `wikiApiUrl` in
`~/.familysearch-mcp/config.json` (useful for pointing at a local dev
instance); end users do not need to set this for normal operation.

## Repository layout

- `packages/engine/` — non-package container for the two engine dirs
  below (no `package.json` of its own; not a pnpm workspace member).
- `packages/engine/mcp-server/` — TypeScript source for the MCP server. Compiles to
  `packages/engine/mcp-server/build/`. The `.mcpb` is built from this.
- `packages/engine/plugin/` — The Cowork plugin folder. Packaged as a .zip directly,
  no compilation step.
- `scripts/` — Build scripts for both artifacts.
- `packages/engine/mcp-server/dev/` — Developer-only scripts: `try-*.ts` one-shot
  smoke tests that invoke a tool directly against live APIs (no MCP
  harness; useful for debugging a tool in isolation), plus
  `probe-*.ts` and `explore-*.ts` scripts that document the live-API
  evidence trail behind each spec. Not shipped in any artifact.
- `packages/engine/mcp-server/scripts/` — Reserved for future user-facing scripts.
  Currently empty. Do not put internal/developer scripts here; they
  belong in `packages/engine/mcp-server/dev/`.
- `packages/engine/mcp-server/src/utils/` — Shared utility modules consumed by multiple
  MCP tools. Houses `gedcomx-convert.ts` (round-trip between
  full GedcomX and the simplified format defined in
  `docs/specs/simplified-gedcomx-spec.md`; implementation spec at
  `docs/specs/gedcomx-convert-spec.md`) and `search-helpers.ts` (shared
  input validators and error parsing used by the search tools
  `record_search` and `person_search`; `parseUpstreamErrorBody` is also
  reused by `person_ancestors`).
- `releases/` — Build output. Gitignored except for `.gitkeep`.

### Hosted web workbench (monorepo overlay)

This repo is also a **pnpm + turborepo monorepo** for the hosted web product
(POC; see `docs/plan/hosted-web-workbench-POC-status.md`). The engine
(`packages/engine/{mcp-server,plugin}`) is deliberately **kept out of the pnpm
workspace** via the `!packages/engine/**` negation in `pnpm-workspace.yaml`,
and stays npm-managed, so the `.mcpb`/plugin release pipeline and CI are unchanged.
The web side depends on `packages/schema`, never on the engine.

- `packages/schema/` — single source of `research.json` + simplified-GedcomX TS
  types + JSON Schemas (seeded from the viewer). Consumed by viewer-ui, web, server.
- `packages/viewer-ui/` — the extracted renderer (App, 11 sections, shared
  components, `ResearchDataProvider`), transport-agnostic via a
  `ResearchTransport` (see `src/transport.ts`). Runs in Electron (IPC) and web (WS).
- `apps/electron/` — the former `cowork-genealogy-ui` Electron viewer, now an
  app package consuming `viewer-ui` via an IPC transport. `main/`/`preload/` as-is.
- `apps/web/` — React+Vite client: login, session list, chat sidebar + the
  shared viewer. WebSocket + REST transport.
- `apps/server/` — **FastAPI control plane** (Python/uv): auth + allowlist,
  session/sandbox orchestration via a vendor-neutral `SandboxProvider`
  (`LocalProvider` for local dev, `E2BProvider` for the hosted E2B path —
  `make server-e2b` and the Fly deploy run `SANDBOX_PROVIDER=e2b`), the viewer/chat
  WebSocket, and `app/agent/` (the in-sandbox `agent_runner` — mock + real modes).

Memorable commands live in the **`Makefile`** (`make install`, `make server`,
`make web`, `make test`, `make mcpb`, `make plugin`). The POC runs fully on
mocks (no E2B/Anthropic/OAuth needed).

- `docs/plan/` — Implementation plans for work that is **not yet built**.
  A plan is deleted once the work ships: the spec, the code, and any
  `docs/TODOs.md` entries become the record. Do not keep shipped plans
  as historical artifacts — if a plan's rationale is worth preserving,
  fold it into the spec instead.
- `docs/specs/` — Finalized specs (what the tool must do). Specs are the
  source of truth the `spec-review` agent checks implementations against.
  This is the durable tier; a live tool must have a live spec.
- **Verification is automated, not a manual playbook.** New tools are
  verified by the eval harness (`eval/`, `make test`, `eval/tests/e2e/`)
  and by `packages/engine/mcp-server/dev/try-*.ts` smoke scripts — **not**
  by writing a per-tool testing guide. The three surviving guides in
  `docs/testing-guides/` cover setup paths the harness can't
  (`oauth-tool-testing-guide.md`, `mcpb-install-testing-guide.md`,
  `gps-mentor-agent-testing-guide.md`). Do not add new ones.

## Tools and skills

For the user-facing tool catalog (purpose, auth, examples) and skill
catalog (descriptions, workflow), see `README.md`. This file is the
agent operating manual — it covers architecture, conventions, and how
to make changes, not what each individual tool/skill does.

Tool implementations live in `packages/engine/mcp-server/src/tools/`. Their schemas are
listed in `packages/engine/mcp-server/src/tool-schemas.ts` (`allToolSchemas`, the single
source of truth for the advertised tool list); `src/index.ts` imports that
list and dispatches calls. Per-tool behavioral contracts are in
`docs/specs/<tool>-tool-spec.md`, and a spec can land before the tool
does. Implementation plans for unbuilt work are in `docs/plan/`.
Skills live in `packages/engine/plugin/skills/<skill>/SKILL.md`. The `init-project`
skill uses `person_search` to find a person in the FamilySearch tree
when the user doesn't have a FamilySearch ID to provide.

The host artifact is the `.mcpb` desktop extension, built from
`packages/engine/mcp-server/` with the `@anthropic-ai/mcpb` CLI. Its `manifest.json` is the
install contract — including a `tools` array that must stay in sync with
`allToolSchemas` (enforced by `tests/packaging/manifest.test.ts`). See
`docs/specs/mcpb-package-spec.md`.

### Cowork plugin agents

Cowork plugin agents live in `packages/engine/plugin/agents/`. These are agent `.md` files
consumed by the Cowork runtime — they are distinct from Claude Code
subagents (`.claude/agents/`). Each plugin agent has YAML frontmatter
(`name`, `description`, `model`, `tools`) followed by the full agent
system prompt. The `description` field determines when the Cowork
orchestrator auto-delegates to the agent. Agents run in fresh context
(no main-session state bleeds in) and are read-only by convention unless
explicitly specced otherwise. The first such agent is `gps-mentor`
(spec: `docs/specs/gps-mentor-agent-spec.md`).

**Qualified tool names.** In the `tools:` frontmatter, MCP tools **must**
be listed under their fully-qualified `mcp__genealogy__*` names, never the
bare tool name. A bare name leaves the subagent toolless in the
unit-harness SDK path (only the e2e harness tolerated bare names, via its
ToolSearch prefix allowlist); qualifying makes an agent behave identically
across Cowork, the e2e harness, the unit harness, and the hosted web SDK
path. Built-in Cowork tools that are not MCP tools — `Read` — stay bare.
All three current agents follow this (`gps-mentor`, `image-reader`,
`record-extractor`).

## Handling user feedback submissions

When a user submits a feedback zip via the Cowork viewer, the workflow
to triage it lives at `docs/feedback-workflow.md`. The underlying spec
(rationale, contracts, lints) is at
`docs/specs/feedback-case-spec.md`. Point the user at the workflow
doc first; only reach for the spec when they're modifying the
workflow itself or building one of its skills.

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
  live across sessions has to live in the project folder — `research.json`,
  `tree.gedcomx.json`, or the `results/` directory of search-result
  sidecar files (`results/<log_id>.json`, see
  `docs/specs/research-schema-spec.md` §5.4.1). There is no
  `~/.cowork-genealogy/` to write to.
- **No shared SKILL.md reference loading.** Claude Code's relative-
  path resolution from SKILL.md is unreliable (issue #17741). Shared
  reference docs across skills are duplicated, not linked from a
  `packages/engine/plugin/references/` location.
- **No plugin-level CLAUDE.md auto-load.** Anthropic's plugin docs are
  explicit that `<plugin>/CLAUDE.md` is not loaded as context.
  Cross-cutting instructions go in each `SKILL.md`, not in a single
  plugin-level file.

Net effect: shared per-project state goes in `research.json`. Its schema is
specified as JSON Schema under `docs/specs/schemas/` and mirrored independently
in `packages/schema/` (JSON Schema + hand-maintained TypeScript types in
`src/index.ts`, consumed by viewer-ui/web/server). The engine's runtime check is
the hand-maintained `validate_research_schema` (`validator.ts`) — it does **not**
load the JSON Schema, so it must be edited too. There are three kinds of schema
change, with different (and easy-to-undercount) site lists:

- **New field or section:** `docs/specs/schemas/research.schema.json`, the prose
  table in `docs/specs/research-schema-spec.md`, the validator
  (`packages/engine/mcp-server/src/validation/validator.ts`), **and** the web
  mirror (`packages/schema/schemas/research.schema.json` + the matching `interface`
  in `packages/schema/src/index.ts`). A *required* field additionally breaks
  `eval/fixtures/scenarios/*/research.json` and the eval Python stubs, which fail
  validation until backfilled.
- **New value on a closed enum** (e.g. `evidence_type`): the enum lives in
  `enums.schema.json` (`$defs`), **not** `research.schema.json` (which only
  `$ref`s it). Edit `enums.schema.json` in *both* schema trees (`docs/specs/schemas/`
  and `packages/schema/schemas/`), the matching TS union in
  `packages/schema/src/index.ts`, the `CLOSED_ENUMS` set in `validator.ts`, and the
  prose tables/discussion in `research-schema-spec.md`. Worked blast-radius and
  rationale: `docs/plan/no-evidence-evidence-type-decision.md`.
- **Tree-schema (simplified-GedcomX) change** — a new/renamed field on tree
  persons, names, facts, relationships, or sources: in addition to the spec
  (`docs/specs/simplified-gedcomx-spec.md`) and the schema mirrors above, the
  **closed per-object field allow-lists** in
  `packages/engine/mcp-server/src/validation/tree-shape.ts` must be edited —
  the validator enforces `additionalProperties: false` from those sets, so an
  unlisted field makes every writer tool (`tree_edit`, `tree_correct`, the
  merge tools, `research_append`'s tree write) reject the write. The legacy
  healer (`tree-sanitize.ts`) reads the same sets; check whether the change
  needs a heal rule for pre-change trees.

The interview lives in `init-project/SKILL.md`.

## Auth architecture (`packages/engine/mcp-server/src/auth/`)

All authenticated tools (`collections_search`, `collection_read`, `record_search`,
`record_read`, `person_search`, `person_read`, `person_ancestors`, `fulltext_search`,
`image_search`, `image_read`, `volume_search`, `same_person`, `person_record_matches`,
`record_person_matches`, `person_person_matches`, `record_record_matches`, and
`source_attachments`) must go through this module — do not re-implement token plumbing.

- `config.ts` — OAuth URLs, callback port, scopes, a per-user
  config store at `~/.familysearch-mcp/config.json` (`loadConfig` /
  `saveConfig`, used only for tunables like `wikiApiUrl`), and
  `getClientId()` which reads the bundled
  `packages/engine/mcp-server/config/familysearch.json` at runtime. The bundled file
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
   `packages/engine/mcp-server/config/familysearch.json`. Holds the FamilySearch
   OAuth `clientId`. Committed to git, packaged into the `.mcpb`,
   read at runtime by `getClientId()`. Users and the LLM never see
   it. To rotate, edit the file and re-ship.

2. **Per-user, on the user's machine:** `~/.familysearch-mcp/`
   directory, `mode: 0o600`. Holds `tokens.json` (OAuth tokens from
   `login`) and `config.json` (per-user tunables like `wikiApiUrl`).
   `loadConfig` / `saveConfig` read and write the per-user JSON.
   **Do not** introduce env-var fallbacks — the files are the sole
   sources. New per-user keys go on `AppConfig` in `src/types/auth.ts`
   and are read via `loadConfig()`.

Currently recognized fields in `~/.familysearch-mcp/config.json` (per-user):

| Field | Used by | Required | Notes |
|-------|---------|----------|-------|
| `wikiApiUrl` | `wiki_search`, `wiki_read`, `wiki_place_page` | When using any wiki tool | Base URL of the upstream `wiki-query-api` FastAPI. Local dev: `"http://localhost:8000"`. Read by `getWikiApiUrl()` in `src/auth/config.ts`. Trailing slash is stripped. |
| `openRouterApiKey` | `image_transcribe` | When transcribing images | OpenRouter API key for host-side VLM OCR. Read by `getOpenRouterApiKey()` in `src/auth/config.ts` (config-only — never `process.env`). Written by the `configure_openrouter` tool. The e2e harness bridges it from `eval/.env`; the hosted server bridges it from its own env into the sandbox's config.json. Throws an LLM-instruction "no key" error when absent so Claude can prompt the user. |
| `openRouterModel` | `image_transcribe` | Optional | Override the OCR model. Read by `getOpenRouterModel()` in `src/auth/config.ts`; defaults to `DEFAULT_OPENROUTER_MODEL` (`qwen/qwen3-vl-235b-a22b-instruct`) when absent. |
| `learningCenterDir` | (future) | Optional | Path to the pre-crawled learning center markdown files. Read by `getLearningCenterDir()` in `src/auth/config.ts`. Returns `null` when absent (not an error). |
| `libraryDir` | (future) | Optional | Path to the pre-crawled library markdown files. Read by `getLibraryDir()` in `src/auth/config.ts`. Returns `null` when absent (not an error). |

Each `get*` helper throws an LLM-instruction error when its required
field is missing — the error message tells Claude what to put in the
file so end users can be guided to fix it.

## Important conventions

### Identifier casing: API surfaces vs. persisted documents

There are two casing conventions in this repo, split on a deliberate
line — not an inconsistency to "fix":

- **API/wire surfaces use camelCase.** MCP tool parameters
  (`birthPlace`, `personId`, `collectionId`), `~/.familysearch-mcp/config.json`
  keys (`wikiApiUrl`, `popStatsUrl`), and the upstream **full**
  GedcomX returned by FamilySearch (`sourceDescriptions`, `resourceId`)
  are all camelCase.
- **Persisted project documents use snake_case.** `research.json` and
  the **simplified** GedcomX (`tree.gedcomx.json`) use snake_case
  throughout (`assertion_id`, `couple_relationship`, `standard_date`).

The MCP tool boundary is the seam between the two, and it is exactly
where every payload gets validated — MCP input schemas on the way in,
`validate_research_schema` (with `additionalProperties: false`) on the
persisted side. That strict validation is what makes the split safe: a
casing slip fails loudly and immediately instead of silently corrupting
state.

Rules that follow from this:

- A new MCP tool parameter is **camelCase**. A new field on
  `research.json` or simplified GedcomX is **snake_case**.
- `gedcomx-convert.ts` renames upstream camelCase to simplified
  snake_case; that rename cost is paid once, in tested code behind a
  spec, and is the reason simplified GedcomX stays snake_case rather
  than mirroring its upstream parent — it must match `research.json`,
  which the agent co-edits in the same skill.
- Python skill scripts read snake_case JSON natively, which is the
  other reason persisted documents are snake_case.
- The thing to avoid is mixing both conventions **within a single
  co-edited document** — never mixing them across the repo, which is
  intentional.

### MCP server tools

Tools are defined in `packages/engine/mcp-server/src/tools/`. Each tool exports a
single function and its schema. Add the schema to `allToolSchemas` in
`src/tool-schemas.ts` (the list `src/index.ts` advertises and the
packaging drift test checks), add the call dispatch to `src/index.ts`,
and add the tool name to `manifest.json`'s `tools` array.

Use generic tool names with provider parameters when scaling, not
one tool per provider. For example, when we add real APIs, use
`search({ provider: "familysearch", ... })`, not `familysearch_search`.
This keeps the tool count low and Claude's context window lean.

### Skills

Skills live in `packages/engine/plugin/skills/<skill-name>/`. Each skill has:

- `SKILL.md` — The instructions Claude reads. Includes frontmatter
  with `name`, `description`, and (if needed) `allowed-tools`.
- `templates/` — Markdown templates Claude fills in
- `references/` — Reference docs Claude loads on demand
- `scripts/` — Python scripts (stdlib only) for data processing.
  Remember: these run in the VM with no network access.

The `description` in SKILL.md frontmatter is critical — it determines
when Claude triggers the skill. Be specific about what kinds of user
requests should activate it.

**Lane rule for skill findings.** Before editing any SKILL.md (or plugin
agent body) to fix an e2e/eval/user finding, classify the finding:
(1) tooling defect → MCP tool PR; (2) eval defect (judge/rubric/fixture
wrong) → eval PR; (3) record-type craft gap → that type's
playbook/table; (4) core doctrine → the stewarded prose edit, gated by
the unit suite. Most findings are lanes 1–2; prose edits never
compensate for a tool or eval bug. Full version:
`docs/skill-lifecycle.md` §5.

### Python file I/O: always pass `encoding="utf-8"`

Every Python `read_text()` / `write_text()` / `open()` on a text file
**must** pass `encoding="utf-8"`. A bare call uses the platform default —
cp1252 on Windows — and crashes with `UnicodeDecodeError` on the em-dashes
and smart quotes that SKILL.md, the test JSON, and `research.json`
routinely contain. It works on macOS/Linux (utf-8 default) but breaks for
the Windows-based genealogist team, and it has bitten us repeatedly (the
eval-harness scripts, `eval/triggering/`). This applies to **every** Python
call with no exceptions — harness/dev scripts, GH-action checks, stdlib-only
skill `scripts/`, the `apps/server/` FastAPI control plane, **and test files**
(`tests/`, `*_test.py`, `test_*.py`) alike. It applies even when the result is
immediately handed to `json.loads(...)` — `read_text()` decodes before
`json` ever sees the bytes, so `json.loads(p.read_text(encoding="utf-8"))`,
never `json.loads(p.read_text())`. Pass it as a keyword (`encoding="utf-8"`),
not positionally, so a `read_text(` / `open(` grep that excludes `encoding=`
reliably finds every offender. For a vendored third-party script, apply the
patch and record it under a "Local divergences from upstream" note so it
survives re-vendoring.

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
  string — `collections_search`, `record_search`, `external_links_search`,
  `image_read`, `image_search`, `record_read`, and `fulltext_search` already do.
- **`src/utils/place-resolver.ts`** — the shared resolver between a
  `standardPlace` name and FamilySearch IDs: `resolveStandardPlace`,
  `standardPlaceToRepId`, `repIdToStandardPlace`, `standardPlaceToPlaceId`
  (null when candidates disagree), `placeIdToRepIds` (anonymous, `string[]`),
  `standardPlaceToCoords`, plus `withRetry` / `mapWithConcurrency`. Tools that
  take a `standardPlace` at the LLM boundary resolve IDs through this module
  (e.g. `volume_search`, `place_population`, `external_links_search`,
  `place_distance`, `wiki_place_page`); skills/persisted artifacts use only the
  name. It builds on the low-level fetchers in `src/utils/place-api.ts`.
- **`src/utils/place-api.ts`** — the low-level FamilySearch Places API
  fetchers (raw HTTP, no caching): `searchPlace`, `getPlaceById`,
  `getPlaceByPrimaryId`, `getPlaceRepIds`, `getPlaceCandidateNames`,
  `getPlaceWikipediaUrl` (the place's curated `WIKIPEDIA_LINK` attribute),
  `extractPrimaryId`. Both `place-resolver.ts` and `place-search.ts` build on
  these (no util→tool dependency). A new tool needing a place fetcher imports
  from here (or, for resolution, from the resolver above) — don't re-fetch.
  `place-search.ts` re-exports them for back-compat; `collections-search.ts`
  exports `fetchAllCollections` and `filterByQuery`.

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
  `dev/try-<name>.ts`, `tests/tools/<name>.test.ts`) and wires it into
  `src/tool-schemas.ts`, `src/index.ts`, and `manifest.json`. Follows
  `wikipedia.ts` as the canonical template. Requires the spec exist first.
- **`cowork-skill-builder`** — generates a Cowork skill that wraps
  an existing MCP tool, following `packages/engine/plugin/skills/search-wikipedia/` as
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
- Don't reference files across the `packages/engine/mcp-server/` and `packages/engine/plugin/`
  directories at runtime. Build-time references via the build scripts
  are fine, runtime references are not.

## Working reference skill

The `search-wikipedia` skill in `packages/engine/plugin/` is the canonical minimal
example of the full plugin pipeline — it calls the `wikipedia_search`
MCP tool, populates a markdown template, and saves the result to a
file. Copy this structure when wiring a new skill to one of the other
tools. Don't mutate `search-wikipedia` itself; create a new skill
folder.
