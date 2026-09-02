# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For developer-facing build, test, and feature-addition recipes, see
[DEVELOPMENT.md](./DEVELOPMENT.md). For how the system fits together and
which sites a given change touches, see
[docs/architecture.md](./docs/architecture.md) — its "If you're asked to…"
blocks are the map, and its "what nothing checks" section names the gaps that
let CI stay green while the thing is broken. This file
covers architecture, conventions, and rules — what Claude needs to know to
make correct changes; on conflict, this file wins.

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
instance).

**There is no public deployment yet, so the defaults are a developer's
personal host.** `DEFAULT_WIKI_API_URL` in `src/auth/config.ts` and
`DEFAULT_POP_STATS_URL` in `src/tools/place-population.ts` both point at
one machine's tailnet. The hosted path can now be redirected without an
engine rebuild — set `WIKI_API_URL` / `POP_STATS_URL` on the control
plane and `hosted_config()` writes them into the sandbox's config — but
the compiled-in defaults still apply everywhere else, including every
installed `.mcpb`. When one of those calls fails the agent gets an
actionable error and then quietly ships a thinner answer, so the user sees
nothing; `make e2e-wiki-failures` is what surfaces the current rate and its
causes. Do not write "end users do not need to set this" — that was true only
in the sense that they cannot.

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
  evidence trail behind each spec. Not shipped in any artifact. Internal and
  developer scripts go here, never in `packages/engine/mcp-server/scripts/`.
- `packages/engine/mcp-server/src/utils/` — Shared modules consumed by multiple
  tools. What is in there and when to reach for it: "Code reuse" below.
- `releases/` — Build output. Gitignored except for `.gitkeep`.
- `docs/plan/` — Implementation plans for work that is **not yet built**, and
  nothing else. An architecture note, a status log, a process doc, a measurement
  write-up, or a spec is not a plan; those go in `docs/` or `docs/specs/`.
  Update a plan's `**Status:**` line when the work lands — it is what tells the
  next reader whether the file describes pending work — and delete the plan once
  it ships. If its rationale is worth keeping, fold that into the spec.
- `docs/specs/` — Finalized specs (what the tool must do). Specs are the
  source of truth an implementation is checked against.
  This is the durable tier; a live tool must have a live spec.
- **Verification is automated, not a manual playbook.** New tools are
  verified by the eval harness (`eval/`, `make harness-test`,
  `make eval-skill SKILL=<name>`, `eval/tests/e2e/` — **not** `make test`,
  which is `test-js` + `server-test` and reaches neither the harness nor
  the engine) and by `packages/engine/mcp-server/dev/try-*.ts` smoke scripts — **not**
  by writing a per-tool testing guide. The three surviving guides in
  `docs/testing-guides/` cover setup paths the harness can't
  (`oauth-tool-testing-guide.md`, `mcpb-install-testing-guide.md`,
  `gps-mentor-agent-testing-guide.md`). Do not add new ones.

### Hosted web workbench (monorepo overlay)

This repo is also a pnpm + turborepo monorepo for the hosted web product —
`packages/schema`, `packages/viewer-ui`, `apps/electron`, `apps/web`,
`apps/server`. Two rules bind when you touch it:

- **Keep the engine out of the pnpm workspace.** `pnpm-workspace.yaml` carries a
  `!packages/engine/**` negation. Both shipped artifacts install their production
  tree with `npm ci --omit=dev` from
  `packages/engine/mcp-server/package-lock.json`, and no CI job builds either
  one, so that lockfile has to stay npm's — a break surfaces at release time,
  not in a green PR.
- **The web side depends on `packages/schema`, never on the engine.**

What each package is and how they bind: `docs/architecture.md`, "The hosted web
workbench". Commands: the `Makefile`.

## Work you find along the way

Implementing one task always turns up others. **Filing an issue is the last
resort, not the default** — an issue costs about four people: someone vets it
(`/review-ready`), someone implements it, and two review it. So the test is not
"is this issue justified?" — it is **"is the work big enough to carry
four-person overhead?"** A half-day genealogist deep dive carries it comfortably.
A change of four functions in one file does not; build that one.

Walk these in order and stop at the first that fits:

1. **Fix it in the current PR.** The default, and the right answer about two
   times in three. You already have the context loaded; whoever picks up the
   ticket has to rebuild it from nothing.
2. **Drop it** if it is a nit — a wording preference, a tidier structure, a test
   you would like but nothing is broken without.
3. **Comment on the issue that already covers it.** One search, then stop:
   `gh issue list --state open --search "<path or symbol>"`, plus a grep of the
   `**Touches:**` lines.
4. **File a new issue**, in the same PR that defers it.

A follow-on PR, a Task, and a "known limitation" written into a docstring or a
PR body are all step 4 wearing a disguise — same debt, minus the tracking. If
you can describe the limitation precisely enough to document it, you understand
it well enough to fix it.

You may only reach step 4 by naming, in both the PR body and the issue body,
which of these is true: the fix needs a different reviewer or skill; it depends
on a decision only the lead can make **and he is not reachable** (a decision is a
question, not work — if you can ask, ask); it is a different skill's paid eval
slot; or it is too big for this PR **and you have opened the call sites and
counted**, stating the files and roughly the lines. "It feels out of scope" is
not a measurement. "I noticed it in passing" and "I'm not sure if this is in
scope" are not on that list at all — they are reasons to fix it now, or drop it.

**Creating the issue is the whole job: do not call the Projects API yourself**
(no `gh project` commands, no `addProjectV2ItemById`). A workflow files the card
into Backlog the moment the issue opens. A `gh` token without the `project`
scope — the default after `gh auth login` — fails a board write *while still
creating the issue*, which looks like success.

**Do not reintroduce a queue file under any name.** This replaced
`docs/TODOs.md`, retired 2026-08-02.

**Never write "does not close #N" in a PR body.** GitHub's closing-keyword
parser matches the substring `close #N` and has no notion of negation, so a
sentence disclaiming an issue closes it on merge. To say an issue is *not*
addressed, name it without the keyword — "issue #N stays open".

Label `developer` or `genealogist` by who does the work, and add
`nothing-checks` when the item **is a missing guard** — a way CI can be green
while the thing is broken. That label is the register `docs/architecture.md`
keeps under "What nothing checks", so an unlabelled gap is invisible to every
reader who goes looking there.

Everything else — the exact `gh issue create` line, the `**Touches:**` line, the
`icebox` label, what belongs in a body and what does not, and the hook that
gates filing — is in [`DEVELOPMENT.md`](./DEVELOPMENT.md) § "Follow-on work you
find along the way", which owns these rules.

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
explicitly specced otherwise. Where an agent has a spec it is
`docs/specs/<agent>-agent-spec.md`; not every agent has one.

**How each environment loads them, and why the hosted path is the odd one.**
Both eval harnesses stage `agents/*.md` into the workspace's `.claude/agents/`
(`eval/harness/harness/workspace.py`, `eval/harness/e2e/orchestrator.py`) and
load them via `setting_sources=["project"]`. Cowork loads the plugin as a
plugin. The hosted control plane does **both**: it passes
`plugins=[{"type": "local", …}]` for the *skills* and separately stages the
*agents* into the project (`real_agent.stage_plugin_agents`). That is not
redundancy — SDK plugin loading registers agents **only** under the namespaced
name `genealogy-research:<agent>`, while every SKILL.md delegates by the bare
name (`@plugin:record-extractor`), so without the staging the Task call errors
and the model silently falls back to a general-purpose stand-in that binds none
of the `tools:`/`disallowedTools:` below (issue #939; skills are unaffected —
the loader registers *those* under bare names). If you change how the hosted
agent is configured, run `make agent-smoke`: it is the only check that reads
what the runtime actually resolved, and no CI job covers this path.

**Dual-spelled tool names.** (Heading kept as a stable anchor — the
architecture guide and ADR-0004 both cite it by name — though the rule now
names three spellings.) In `tools:` — and in `disallowedTools:`, if one ever
comes back — every MCP tool **must** be listed **three times**, once under each
server spelling:

    - mcp__genealogy__record_read                            # harnesses, .mcp.json, hosted web
    - mcp__remote-devices__Genealogy_Research__record_read   # Cowork via the remote-device bridge
    - mcp__Genealogy_Research__record_read                   # Cowork, bare display_name spelling

Bare names do not work (they leave the subagent toolless in the
unit-harness SDK path), but neither does a single qualified name. The MCP
server's name is chosen by whoever registers it, and the plugin — which
ships into the VM — cannot control that choice. `.mcp.json`, both
harnesses, and the hosted web control plane register it under the key
`genealogy`. Both Cowork spellings derive from `manifest.json`'s
`display_name`; only the bridged form is namespaced under `remote-devices`.
Which spelling a Cowork session exposes has been **observed to move**: three
censuses found every genealogy tool under
`mcp__remote-devices__Genealogy_Research__…` ("via your device") with the
bare `mcp__Genealogy_Research__…` spelling absent — macOS and Windows on
2026-08-15, and a second Windows session via issue #1732 on 2026-08-19 — yet
issue #1341 recorded the bare spelling live on 2026-08-04/05, refusing `record-extractor` with the
bridged spelling among its *unrecognized* entries. The registrar moved
between those dates (or the configurations differ in a way nobody has
identified — same conclusion). **Run mode is a per-task setting nothing in
the plugin can see, and the spelling exposed is not stable over time.** No
single spelling resolves everywhere; listing all three is insurance against a
moving target, not defensive redundancy.

Entries are matched **exactly** — no prefix fallback, no inherit-on-miss.
When every `tools:` entry misses, the runtime refuses to spawn the agent at
all ("would be spawned with zero tools — refusing"), which has broken every
agent in Cowork twice while CI stayed green. Listing every spelling is safe
because unrecognized entries are ignored so long as at least one resolves.

**No agent declares `disallowedTools:` any more — omit the tool instead.**
Under `bypassPermissions` **both** bind: a tool merely omitted from `tools:` is
absent from the agent, exactly as a denied one is (`make probe-agent-binding`,
2026-08-30, Claude Code 2.1.251 / SDK 0.2.128). Every deny we shipped named a
tool already absent from the list above it, so all five were deleted as
restatements. What keeps `record-extractor` off the broad `research_append` is
`research_append` not being in its `tools:`.

**To take a capability away from an agent, remove it from `tools:`.** The
regression a deny insured against — someone later adding the tool back — is
caught by the permission snapshot in
`tests/packaging/agent-tool-names.test.ts`, which fails on any change to an
agent's list.

Re-adding a deny is allowed but needs a reason the omission cannot serve, and
the test asks for one. If you add one: all three spellings (one naming a single
spelling binds nothing under the others, and unlike a missing grant **a missing
deny fails open and silently**), and **never a tool the same agent grants** —
the deny is applied *before* the zero-tools spawn check, so it can make the
runtime refuse the agent outright rather than merely narrowing it. Why, the two
incidents, and what the probe retired: ADR-0004.

### Plugin hooks (`packages/engine/plugin/hooks/`)

The plugin ships a `PreToolUse` hook — the **only** guardrail that reaches
Cowork. `hooks=` is an SDK argument the hosted control plane can set and Cowork
cannot be made to; a plugin-shipped `hooks/hooks.json` binds in both. Cowork runs
`permission_mode: "default"`, the hosted path runs `bypassPermissions`, and a
hook binds under both.

**`SessionStart` hooks do not fire in Cowork.** Nothing depends on one today, so
do not put per-session setup — seeding state, injecting project context — in
one: it would silently not run. `PreToolUse` does fire. Both were probed live;
where an upstream issue thread says otherwise, the probe wins. Dates, probes and
thread numbers: ADR-0005.

Hook scripts run in the VM: **stdlib-only Python, no network** — the same rule
as skill `scripts/`. A hook must never raise; every failure path falls through
to allowing the call, because an exception here fails a tool call the user was
entitled to make. `scripts/package-plugin.mjs`'s `INCLUDE` list must carry
`"hooks"` or the directory never ships, which looks identical to the runtime
refusing to load it — asserted by `tests/packaging/plugin-hooks.test.ts`.

**Allow-lists are subtractive; hooks are not.** A per-agent `tools:` list can
only narrow what the session already holds — the session's tool set is always a
superset — so no allow-list can deny the *main thread* a tool one of its
subagents needs. Discriminating by caller is a `PreToolUse` hook's job, and the
shipped hook already does it: it routes `research_append` by caller identity
(`owner_denied`, `AGENT_WRITABLE_SECTIONS`) — don't re-derive that. The one arm
that stayed harness-only is the tool-level one, which denies `image_read` when
`agent_id` is absent (`eval/harness/harness/context_policy.py`); porting it was
**declined by lead ruling 2026-08-17**, so it is not pending work. ADR-0006
records why.

Do **not** reach for a server-level prefix grant (`mcp__remote-devices`):
that namespace also carries `device_bash`, `device_commit_files`, and
`project_memory_write`, so it would hand a read-only agent shell access to
the host.

Built-in Cowork tools that are not MCP tools — `Read` — stay bare. Skills'
`allowed-tools` frontmatter also stays **bare** (it is not an exact-match
spawn filter); only agent `tools:`/`disallowedTools:` carry every spelling.
Enforced by `tests/packaging/agent-tool-names.test.ts`, which derives both
`display_name`-based prefixes from the manifest so renaming the extension fails
loudly in CI instead of silently in production, and throws on an unrecognized
prefix rather than slicing it against another prefix's length.

**No CI job can verify that a granted tool actually binds.** Only a
live Cowork session can, and only for the spelling that session exposes — the
bare form was live in #1341 but absent in the later censuses, so a green check
proves binding for one spelling at one moment, not in general.

**Never hardcode a qualified name in a ToolSearch query.** Cowork defers the
genealogy tool schemas above a size threshold and offers no control over it, so
ToolSearch is the real load path there. Search by bare tool name —
`query: "+research_append"` — which matches whatever prefix the session exposes.
The same packaging test fails any `select:mcp__…` in a plugin body.

**`ENABLE_TOOL_SEARCH=true` turns tool search ON, not off** — and unset also
means on, so both harnesses and the hosted path run *with* deferral. The
bare-name rule above holds either way. Full polarity, what now depends on
deferral being on, and what flipping it would cost: `docs/architecture.md`,
"Agent frontmatter: spelled per registrar, exactly matched".

**No playbook/reference files for agents — an agent body is self-contained.**
Everything an agent needs at runtime lives inline in its `.md`. Do **not**
split per-topic reference material (e.g. per-record-type extraction tables)
into sibling files for the agent to `Read` on demand, and do **not** assemble
them into the body at build time. Both were measured and reverted; revisit only
with a mechanism that cannot silently skip. What each alternative measured,
and the ownership cost knowingly accepted: `docs/architecture.md`, "Agent
bodies are self-contained — do not split them".

## Handling user feedback submissions

When a user submits a feedback zip via the Cowork viewer, the workflow
to triage it lives at `docs/alpha-feedback-guide.md` (a worked story,
start to finish). The skill-improvement half it hands off to is
`docs/skill-lifecycle.md`. The underlying spec
(rationale, contracts, lints) is at
`docs/specs/feedback-case-spec.md`. Point the user at the workflow
doc first; only reach for the spec when they're modifying the
workflow itself or building one of its skills.

## Researcher profile in `research.json`

Per-project context about the researcher (experience level, paid
subscriptions, derived narration guidance) lives in a
`researcher_profile` section of `research.json`. `init-project` writes
it after a short opening-turn interview, asked non-blocking alongside
the project's research objective at project start. Every
`SKILL.md` opens with a one-line `**Narration:**` instruction that
tells Claude to read `researcher_profile.narration_guidance` and apply
it as the narration style for that invocation.

Three architectural rules made this design necessary:

- **No cross-session storage on the host.** Cowork sessions are
  ephemeral; only the project folder persists. Anything that needs to
  live across sessions has to live in the project folder — `research.json`,
  `tree.gedcomx.json`, or the `results/` directory of search-result
  sidecar files (`results/<log_id>.json` — `research-schema-spec.md`,
  "Sidecar result files"). There is no
  `~/.cowork-genealogy/` to write to.
- **No shared SKILL.md reference loading.** Claude Code's relative-
  path resolution from SKILL.md is unreliable (upstream Claude Code issue
  #17741). Shared
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
  in `packages/schema/src/index.ts`, where optionality follows `required` and
  nullability follows the schema's own type: a field absent from `required` takes
  a `?`, a required one does not, and `| null` is added only where the schema's
  type actually has a null branch. A drift test asserts the `?` in both
  directions, so either mistake there fails CI; the `| null` half is unchecked,
  which is why it is stated here). A *required* field additionally breaks
  `eval/fixtures/scenarios/*/research.json` and the eval Python stubs, which fail
  validation until backfilled. A new **section** (a top-level property, or a new
  entry in `research_append`'s `section` enum) additionally needs a row in
  `docs/specs/schemas/ownership.json` saying who may write it — declare it
  `owner: null` with a reason rather than guessing; a packaging test fails until
  the row exists.
- **New value on a closed enum** (e.g. `evidence_type`): the enum lives in
  `enums.schema.json` (`$defs`), **not** `research.schema.json` (which only
  `$ref`s it). Edit `enums.schema.json` in *both* schema trees (`docs/specs/schemas/`
  and `packages/schema/schemas/`), the `CLOSED_ENUMS` set in `validator.ts`, and the
  prose tables/discussion in `research-schema-spec.md`. **Do not hand-edit the TS
  union**: `packages/schema/src/enums.generated.ts` is emitted from that package's
  own `enums.schema.json` by `packages/schema/scripts/gen-enums.mjs`, chained into `build`,
  `typecheck` and each app's `dev`, and gitignored (ADR-0008 tier 2). Every
  closed enum in `enums.schema.json` is generated, with no exceptions —
  `gen-enums.mjs` throws rather than let a hand-written union shadow a generated
  one. Removing or renaming a
  value additionally requires a repo-wide grep for the old value: the full-list
  lint catches an added value, but a rename or removal can leave a stale
  single-value mention in prose that no lint sees. Worked blast-radius and
  rationale: `docs/specs/research-schema-spec.md`, the `no_evidence` note in
  the enum section.
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

Every tool that calls a FamilySearch endpoint must get its token through this
module — do not re-implement token plumbing. To see which tools those are today,
`grep -rl getValidToken src/tools/ src/utils/`.

Four rules hold across the module:

- **`getValidToken()` (`refresh.ts`) is the single entry point.** It loads
  tokens, auto-refreshes if expired, and throws an LLM-instruction error
  ("Call the login tool to authenticate.") when there is no valid session.
- **The bundled `config/familysearch.json` is the sole source of the FS client
  ID** — no env-var fallback, no per-user override. A missing or corrupt file
  throws an installation-framed error, not an LLM-actionable one: it ships with
  the `.mcpb` and is always present under a normal install.
- **Token file ops return `null` rather than throwing** on missing or corrupt
  input (`tokenManager.ts`), and `login.ts` returns a `LoginResult` rather than
  throwing. Keep new code in this module to that shape.
- **Stdlib `crypto` only** in `pkce.ts`.

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
| `wikiApiUrl` | `wiki_search`, `wiki_read`, `wiki_place_page` | When using any wiki tool | Base URL of the upstream `wiki-query-api` FastAPI. Local dev: `"http://localhost:8000"`. Read by `getWikiApiUrl()` in `src/auth/config.ts`. Trailing slash is stripped. Defaults to `DEFAULT_WIKI_API_URL`. |
| `popStatsUrl` | `place_population` | Optional | Base URL of the Pop Stats API. Read directly in `src/tools/place-population.ts`; defaults to `DEFAULT_POP_STATS_URL` when absent. |
| `hosted` | `login` and the auth errors | Set by the hosted control plane, not by the user | `true` marks a sandbox where the loopback OAuth flow cannot complete, so auth errors point at the web app's "Reconnect FamilySearch" button instead of the `login` tool. Absent on the desktop `.mcpb`. Written by `hosted_config()` in `apps/server/app/fs_oauth.py`. |
| `openRouterApiKey` | `image_transcribe` | When transcribing images | OpenRouter API key for host-side VLM OCR. Read by `getOpenRouterApiKey()` in `src/auth/config.ts` (config-only — never `process.env`). Written by the `configure_openrouter` tool. The e2e harness bridges it from `eval/.env`; the hosted server bridges it from its own env into the sandbox's config.json. Throws an LLM-instruction "no key" error when absent so Claude can prompt the user. |
| `openRouterModel` | `image_transcribe` | Optional | Override the OCR model. Read by `getOpenRouterModel()` in `src/auth/config.ts`; defaults to `DEFAULT_OPENROUTER_MODEL` (`google/gemini-3.7-flash`) when absent. |

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

**No explanatory prose in a `SKILL.md` or an agent `.md`.** Every line in those
files is a billed prompt token on every invocation. No comments, no rationale,
no note of what was tried before. Write the instruction; the reasoning behind it
goes in the skill's spec or its rubric.

**Lane rule for skill findings.** Before editing any SKILL.md (or plugin
agent body) to fix an e2e/eval/user finding, classify the finding:
(1) tooling defect → MCP tool PR; (2) eval defect (judge/rubric/fixture
wrong) → eval PR; (3) record-type craft gap → that type's
playbook/table; (4) core doctrine → **first ask whether it can be a tool
rule**, and only then the stewarded prose edit, gated by the unit suite. Most
findings are lanes 1–2; prose edits never compensate for a tool or eval bug.

**Lane 4 means prose is the last resort, not the destination.** Apply ADR-0011's
first question — *can this be decided by reading the project documents alone?*
If yes it is a writer-tool precondition, where it binds everywhere and cannot be
argued with. A prompt has no scope: rewording one rule in a body routinely
breaks a neighbouring test, and a rule the model reads is not a rule the model
follows. The measurement behind that: `docs/skill-lifecycle.md`, "Improve the
skill".

### A new lint must be proven to fail

Before committing a lint, validator, or CI check, break the repo so the check
fires and watch it fail. A check that cannot fail reads as coverage and is worse
than no check at all. The three ways one silently passes here: a grep whose
pattern excludes its own tree, a `git grep` that skips untracked files, and a
field-name match that collides with an unrelated key.

### A measurement that disagrees with belief is re-measured, not reworded

When a recorded measurement contradicts what you believe, re-probe until the two agree.
Do not reword prose until the guard goes green, and do not add a provenance escape hatch
so the belief can sit beside a verdict that denies it. A verdict stuck at `OPEN` or
`NOT MEASURED` is a measurement-design task, not a re-run. The guard that matches wording
rather than meaning is `measured-figures.test.ts`; its failure message says the same.

### The eval harness emulates production's permission model

Grant what production grants. Both production paths hold every MCP tool the server
advertises — the hosted control plane runs `bypassPermissions` with no allowlist, and
Cowork loads the plugin whole. A skill's `allowed-tools` is a **grant, not a
restriction**: the field that removes a tool from the pool is `disallowed-tools`, which
no skill here declares, so a deny list derived as the complement of a grant inverts the
field's meaning. The unit harness grants every registered MCP tool to every skill, and
`compute_allowed_tools` survives only to feed an advisory validator — do not rebuild a
narrowing on top of it.

The boundary, so this is not over-applied: emulate production's *permission model*,
construct the test's *inputs* freely. A deny that hides the answer from the agent — the
e2e tree-read block, a fixture's `blocked_tools` — is a fixture and stays. A deny that
changes what the agent may *do* is a distortion and goes. Denies production genuinely has
stay too: the protected-file write lockdown mirrors the shipped plugin hook, and agent
frontmatter binds even under `bypassPermissions` — both a `disallowedTools:` deny and a
plain omission from `tools:` (measured; see "Dual-spelled tool names" above).

### Python file I/O: always pass `encoding="utf-8"`

Every Python `read_text()` / `write_text()` / `open()` on a text file
**must** pass `encoding="utf-8"` — and so must every `subprocess.run` /
`check_output` / `Popen` / `call` / `check_call` that runs in text mode
(`text=`, `universal_newlines=` or `errors=`), which decodes the child
process's output with the same platform default. A bare call uses the platform default —
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
not positionally: the repo-wide guard is an AST lint that requires the
`encoding=` keyword (`eval/harness/tests/unit/test_encoding_lint.py`). It parses
rather than greps because a grep is wrong in both directions here — a per-line
grep *false-flags* a compliant call whose `encoding=` sits on a later physical
line, and a file-level grep *misses* a bare offender inside a multi-line call. For a vendored third-party script, apply the patch and record it
under a "Local divergences from upstream" note so it survives re-vendoring.

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
- **`src/utils/http.ts`** — `fetchWithTimeout()` is the only correct way to call
  an external service. Node's global `fetch` never times out on its own; a
  stalled upstream connection (FamilySearch/Imperva, the wiki-query-api
  sidecar, OpenRouter) hangs the call forever otherwise. Every tool that touches
  the network calls this instead of the global `fetch` directly; it is the
  only file allowed to (enforced by `tests/packaging/no-bare-fetch.test.ts`).
  Default timeout 30s; pass a longer one as the third argument (180s for
  `image_transcribe`'s OCR call, 90s for `fs-image-fetch.ts`'s multi-MB scan,
  60s for `wiki_search`, `collections_search` and `wikipedia_search`). Size a
  raise from the measured e2e corpus, not by guessing — the worked method is in
  `docs/specs/image-transcribe-tool-spec.md`. The
  budget covers headers **and** body — size it for the whole transfer, not the
  round-trip to first byte. A body still streaming when the clock fires is
  aborted mid-read, and the wrapper turns that into the same readable error,
  so call sites never handle it themselves.
- **`src/utils/place-resolver.ts`** — the shared resolver between a
  `standardPlace` name and FamilySearch IDs: `resolveStandardPlace`,
  `standardPlaceToRepId`, `repIdToStandardPlace`, `standardPlaceToPlaceId`
  (null when candidates disagree), `placeIdToRepIds` (anonymous, `string[]`),
  `standardPlaceToCoords`, plus `withRetry` / `mapWithConcurrency`. Tools that
  take a `standardPlace` at the LLM boundary resolve IDs through this module
  (e.g. `volume_search`, `place_population`, `external_links_search`,
  `place_distance`, `wiki_place_page`); skills/persisted artifacts use only the
  name. It builds on the low-level fetchers in `src/utils/place-api.ts`.
- **`src/utils/gedcomx-convert.ts`** — the round-trip between full GedcomX and
  the simplified format (`docs/specs/simplified-gedcomx-spec.md`; implementation
  spec `docs/specs/gedcomx-convert-spec.md`). Don't hand-map between the two.
- **`src/utils/search-helpers.ts`** — shared input validators, output shaping and
  error parsing for `record_search`, `person_search`, `collections_search` and
  `volume_search`. `parseUpstreamErrorBody` is also used by `person_ancestors`,
  and `formatYearRange` is the single date-range format shared by
  `collections_search` and `volume_search`.
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

Project subagents live under `.claude/agents/`. Claude Code invokes them
automatically when their description matches the request, or you can call them
explicitly with the Agent tool.

- **`plan-critic`** — read-only. Adversarially reviews an implementation plan
  *before* any code exists: verifies every file/function/command the plan names
  actually exists, checks the plan against the documented multi-site edit lists,
  and rejects plans with no falsifiable acceptance check. Step 3 of
  [`docs/task-lifecycle.md`](./docs/task-lifecycle.md), capped at two rounds
  (ADR-0007). `/critique-plan [path]`.
- **`drift-critic`** — read-only. The step-6 counterpart: reads the plan and the
  branch's full diff (including untracked files) and reports what the
  implementation did that the plan didn't call for, what the plan called for
  that isn't there, and what contradicts it. Not a bug finder — `/code-review`
  owns correctness. A deviation recorded in `PLAN.md` or the PR body is not
  drift. `/check-drift [path]`.
- **`rubric-critic`** — read-only. Audits a skill's eval rubric and judge
  quality from its run logs; flags non-discriminating, flaky, and unexercised
  dimensions. `/audit-rubric <skill>`.
- **`skill-improver`** — report-only. Proposes evidence-cited `SKILL.md` edits
  from a skill's latest annotated run log. `/improve-skill <skill>`.
- **`task-reviewer`** — read-only. Vets one Backlog/Ready issue before it is
  handed to a junior working with Claude Code: staleness, whether the premise
  was already refuted, whether the population it rests on has any instances at
  all, the blast radius the issue omits, what verifies the change, and which
  decisions are the lead's. Fanned out one-per-issue by
  the `review-ready` skill; never edits an issue, the board, or any code.
  Spec: `docs/specs/task-review-spec.md`.

There is no scaffolding subagent for tools, skills, or spec review. Use the
templates directly:

- **A new MCP tool** — copy `src/tools/wikipedia.ts` and its sibling four files.
  The full site list is in `DEVELOPMENT.md` → "How to add a new feature" and
  `docs/architecture.md` → "The engine's three-way decomposition".
- **A new skill** — copy `packages/engine/plugin/skills/search-wikipedia/`, and
  keep its rule: **no network in skill `scripts/`.**
- **Checking an implementation against its spec** — read it against
  `docs/specs/<tool>-tool-spec.md` yourself, or ask a general-purpose subagent
  to, quoting both sides. The spec is the source of truth.

## Reviewing a PR

Use `/review` (`.claude/skills/review/`). It ships with the repo, so cloning is
the whole install — do not reach for a `/review` from any other toolchain, which
teammates do not have and which reads neither this repo's suites nor the human
reviews on the PR.

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
