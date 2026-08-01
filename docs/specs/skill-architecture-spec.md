# Skill / Agent / Tool Architecture

**Status:** As built, verified against the repo 2026-08-01. Every claim below
was checked at a source site; nothing is carried forward unverified from the
pre-rewrite revision.

**What this is.** The one document that explains how the pieces *bind*: how a
user utterance reaches a skill, how the orchestrator picks the next one, how a
skill or agent is permitted to call a tool, what restrains each layer, and
where state lives. It is an explainer of bindings, not a catalog — the
user-facing tool/skill/agent catalog is [`README.md`](../../README.md); each
tool's behavioral contract is its own `docs/specs/<tool>-tool-spec.md`; the
rules for *changing* any of this safely live in the root
[`CLAUDE.md`](../../CLAUDE.md), which remains the operating manual. Where this
file and a per-tool spec disagree, the per-tool spec wins.

**The chain, end to end.** A user utterance matches a skill `description`
(§1a) → that skill is usually `research`, which routes by reading project
state and invokes sub-skills via the `Skill` tool and agents via `@plugin:`
delegation (§2) → each skill or agent may call only the tools its frontmatter
resolves (§3) → a `PreToolUse` hook denies the one route no allow-list can
close (§4) → all durable state lands in three project-folder locations
through validating writer tools (§5). §6 covers the case where even that is
not enough and the tool itself must be narrowed; §7 covers how each of the
four environments loads the pieces.

---

## 1. The three-way decomposition and the host/VM split

Cowork runs Claude inside a sandboxed Linux VM with no reliable network
egress (root `CLAUDE.md`, "Architecture you must understand"). That single
constraint forces the shape of everything else: code that needs the network
must run on the **host**, and everything shipped into the **VM** must work
without it. The repo therefore ships two artifacts:

- a TypeScript MCP server packaged as a `.mcpb` desktop extension (host);
- a Cowork plugin folder packaged as a `.zip` (VM) — skills, agents, hooks.

They communicate only through MCP tool calls; they share no files at runtime.

Three kinds of component, each placed by what it needs:

| Component | Where | What it is for |
|---|---|---|
| **MCP tools** — 47, enumerated in `allToolSchemas` (`packages/engine/mcp-server/src/tool-schemas.ts`) | host | Network access (FamilySearch, wiki sidecar, OpenRouter OCR) and **validate-before-persist** writes to project state. Invariants live here because a tool contract cannot be argued past (§6). |
| **Skills** — 27, `packages/engine/plugin/skills/*/SKILL.md` | VM, in-session | Judgment and procedure executed in the session's own context: GPS doctrine, routing, when-to-stop criteria. A skill folder may also carry `references/` (§1b) and `templates/`; a bundled `scripts/` would be stdlib-only Python, since the VM silently blocks network calls — no skill has one today, so `guard_project_files.py` is currently the plugin's only Python. |
| **Plugin agents** — 4, `packages/engine/plugin/agents/*.md` (`gps-mentor`, `record-extractor`, `image-reader`, `image-reader-opus`) | VM, fresh context | Heavy or capability-restricted work delegated out of the main thread: each spawns with **no session state**, only its own `tools:` allow-list and `disallowedTools:` denies (§3), and its own `model:` pin. |

Agent `model:` pins are the system's per-step model-routing mechanism —
`gps-mentor` pins `claude-sonnet-5`, `image-reader-opus` pins
`claude-opus-4-8`, the other two `claude-sonnet-4-6` (frontmatter of each
`agents/*.md`). Skill-level `model:` pins, by contrast, are read **only** by
the unit eval harness (`eval/harness/harness/orchestrator.py:201-208`); in
production a skill runs on the session's model.

Agent bodies are **self-contained**: no sibling reference files read at
runtime, no build-time assembly. Both alternatives were measured and
rejected — the on-demand `Read` failed silently in three distinct modes (root
`CLAUDE.md`, "No playbook/reference files for agents"). §1b is the skill-side
counterpart, and it lands the opposite way for a different reason.

### 1a. How a session enters a skill at all

The outermost binding is not a routing table — it is text matching. A skill's
`description` frontmatter is what decides whether an utterance triggers it,
and an agent's `description` is what decides whether the Cowork orchestrator
auto-delegates to it (root `CLAUDE.md`, "Cowork plugin agents"). Both are
therefore product surface, not documentation: a description that under-triggers
makes a working skill unreachable, and one that over-triggers steals turns from
the right skill. Two constraints follow.

- **A 1024-character cap and no angle brackets, doubly linted.**
  `eval/harness/scripts/check_skill_frontmatter.py` fails the build on either,
  for every skill *and* agent, checking the **folded** value so a long
  multi-line description or a `<placeholder>` on a continuation line cannot
  escape to install time; it runs both from CI (`check-runlogs.yml`) and from
  `scripts/package-plugin.mjs` before it would build a zip Cowork rejects.
  `tests/packaging/skill-description-length.test.ts` re-checks the length from
  vitest. Note the two sites disagree on *why* 1024: the vitest comment calls
  it a runtime cap past which an entry silently fails to load, the Python
  checker calls it "a self-imposed standard, not a Cowork limit" — an
  attention budget, since every description is resident in the orchestrator's
  context on every turn. Nobody has reconciled them; treat 1024 as hard either
  way.
- **Descriptions are tuned empirically, not by taste.** `eval/triggering/`
  holds the vendored description optimizer; `docs/skill-lifecycle.md` owns the
  workflow. Editing a description is a change to triggering behavior and is a
  different lane from editing a skill body — and per root `CLAUDE.md`'s lane
  rule, prose edits never compensate for a tool or eval bug.

Most utterances should land on `research` (§2), whose description claims the
"drive the whole objective" intent and explicitly disclaims the single-step
ones. Sub-skills keep their own descriptions because a user may still invoke
any of them directly.

### 1b. `references/` — the fourth artifact, duplicated by necessity

21 of the 27 skills carry a `references/` folder (75 files total): loaded on
demand by the skill, in-session, for material too long to sit in the body.
Unlike agents (above), a skill *can* read its own sibling files reliably — the
failure is **across** skills. Claude Code's relative-path resolution from one
SKILL.md into another skill's folder is unreliable (issue #17741), so guidance
several skills must follow identically is **physically duplicated** into each
one rather than linked. Three families are duplicated today:
`validation-protocol.md` (12 copies), `places-guidance.md` (9),
`research-log-protocol.md` (3).

Duplication needs a drift lint, and only one family has one.
`tests/packaging/skill-guidance.test.ts` holds 8 copies of
`places-guidance.md` byte-identical to a canonical at
`packages/engine/plugin/references/places-guidance.md` — a path deliberately
**absent from `package-plugin.mjs`'s `INCLUDE`**, so the canonical is a
build-time lint anchor that never ships into the VM. The one specialized copy
(`research-plan`, which lost four place tools from its `allowed-tools` in
8bf43be2, so the canonical text would name tools it cannot call) is exempted
by name with a stated reason and gets only an exists-and-non-empty check.

**Known limit, and it is live.** Nothing lints the other two families, and
both have already drifted: the 12 `validation-protocol.md` copies span 10
distinct contents, the 3 `research-log-protocol.md` copies are 3 distinct
contents. Whether each divergence is deliberate specialization or silent rot
is not recorded anywhere. Editing a duplicated reference means editing every
copy by hand and knowing which ones are meant to differ. The two ways out —
lint a shared core plus a per-skill "who calls what" section, or derive each
copy at plugin-build time from the skill's `allowed-tools` — are recorded in
`docs/TODOs.md`.

## 2. Orchestration — the `research` skill

There **is** an orchestrator, and it is a skill:
`packages/engine/plugin/skills/research/SKILL.md`. It is deliberately thin —
"the GPS work itself happens in the sub-skills" — and it works by
state-driven routing:

1. **Project state, not conversation state, drives routing.** The
   orchestrator queries `research.json` through `research_query` (its
   `allowed-tools` frontmatter declares only `validate_research_schema` and
   `research_query`) and derives where the project is: which questions have
   plans, which log entries lack assertions, which conflicts are open, which
   proofs lack verdicts.
2. **A routing table maps state to the next sub-skill** — 17 rows at
   `research/SKILL.md:128-146`, from "objective but no questions →
   `question-selection`" down to the two-gate completion row. The rows are
   not duplicated here; the table is the source of truth. Sub-skills are
   invoked **programmatically via the `Skill` tool** (skill bodies name it
   explicitly, e.g. `check-warnings/SKILL.md:45`; both harnesses grant
   `Skill` in the session baseline), and agents via **`Task` delegation
   using the bare `@plugin:<name>` form** (e.g. `@plugin:gps-mentor`,
   `research/SKILL.md` "Mentor checkpoints").
3. **Two modes.** Interactive mode surfaces meaningful decisions to the
   user. `--autonomous` mode runs the loop in one continuous turn: no
   clarifying questions, decisions logged to the audit-trail fields, and an
   explicit rule that yielding the turn to announce a next step is a
   failure.
4. **Completion is gated twice.** Before the orchestrator may write
   `project.status = "completed"` (its one direct write, via
   `research_append`): (a) the **tree-encoding gate** — every tier-≥-probable
   conclusion must be encoded in `tree.gedcomx.json` as a relationship or
   fact, else `proof-conclusion` is re-invoked; (b) the **mentor gate** —
   every `ps_id` a resolved question references must have a
   `focus: "proof-critique"` verdict on record in `evaluations[]`, written by
   the `@plugin:gps-mentor` agent. The mentor gate is mandatory to *invoke
   and record*; its recommendation stays advisory and never forces rework.
5. **Stop conditions** (`research/SKILL.md` "When to stop"):
   `project.status == "completed"`, an explicit user halt, or a genuine
   logged blocker. Nothing else — finishing a sub-skill is mid-loop.

Two contracts the orchestrator enforces on itself are load-bearing for §§3–6:
it never extracts records inline (every positive/partial log entry routes
through `record-extraction`, which delegates one `record-extractor` agent per
record, classifications first-and-final), and it never writes identity links
or eliminations inline (`person-evidence`, `conflict-resolution`,
`hypothesis-tracking` own those). All file writes go through the validating
writer tools (§5); the routing hard-rules restate this because the prose and
the hook (§4) enforce the same line.

## 3. Tool binding and capability boundaries

Three different surfaces declare who may call what, and they bind differently.

**Skill `allowed-tools` frontmatter: bare names, declared not enforced-in-prod.**
A skill lists the MCP tools it calls by bare name (`research_query`, not
`mcp__genealogy__research_query`). The unit harness compiles this into the
SDK session allowlist: baseline filesystem tools
(`Read, Glob, Grep, Write, Edit, Skill, Task` —
`eval/harness/harness/allowed_tools.py:59`) **plus** the skill's declared
tools qualified onto the server key, **plus the union of the `tools:` of
every plugin agent the skill references via `@plugin:`**
(`allowed_tools.py:61-68`) — a delegated agent's MCP calls travel through the
same session allow/deny lists, so denying them would break the delegation.
Skill frontmatter is not what restrains a production session: the hosted
path runs `bypassPermissions` with no allowlist at all
(`research-append-tool-spec.md` §11.4 — "the router (main thread) is
unrestrained in production"), so restraint there comes from agent lists,
denies, and hooks.

**Agent `tools:` and `disallowedTools:`: dual-spelled, exactly matched.**
Every MCP tool in an agent's frontmatter appears **twice**:

```
- mcp__genealogy__record_read
- mcp__remote-devices__Genealogy_Research__record_read
```

The MCP server's name belongs to whoever registers it, and the plugin —
which ships into the VM — cannot control that choice. `.mcp.json`, both
harnesses, and the hosted control plane register the server under the key
`genealogy`; Cowork reaches the host-installed `.mcpb` through a
remote-device bridge that namespaces it by `manifest.json`'s `display_name`
(`Genealogy Research` → `Genealogy_Research`). Entries are matched
**exactly** — no prefix fallback, no inherit-on-miss — and when *every*
entry misses, the runtime refuses to spawn the agent at all ("would be
spawned with zero tools — refusing"): that is how PR #650 / issue #698 broke
all three then-existing agents in Cowork while CI stayed green. Listing both
spellings is safe because unrecognized entries are ignored so long as one
resolves (verified live in Cowork; `research-append-tool-spec.md` §11.1).

`disallowedTools:` needs the dual spelling for a sharper reason: **a deny is
enforced even under `bypassPermissions`** — the hosted path's mode (issue
#695) — so it is the last line keeping `record-extractor` off the broad
`research_append`, and a deny naming only one spelling silently binds
nothing wherever the server carries the other name. All of this is CI-linted
by `packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts`,
which derives the bridge prefix from `display_name` (an extension rename
fails loudly) and asserts all five registration sites still agree on the
`genealogy` key. Built-in tools (`Read`) stay bare in agent frontmatter, and
skill `allowed-tools` stays bare everywhere.

**Two standing prohibitions.** (a) Never grant a server-level prefix
(`mcp__remote-devices`): that namespace also carries `device_bash`,
`device_commit_files`, and `project_memory_write`, so it would hand a
read-only agent shell access to the host (same test file, header comment).
(b) Never hardcode a qualified name in a ToolSearch query. Cowork defers the
genealogy tool schemas and offers no control over it, so ToolSearch is the
real load path there — and `select:mcp__genealogy__…` resolves to nothing
behind the bridge. Always search by bare name (`query: "+research_append"`),
which matches whatever prefix the session exposes. The same test fails any
`select:mcp__` in a plugin `.md` body.

> **Open question, flagged not settled.** Both harnesses and the hosted path
> set `ENABLE_TOOL_SEARCH=true`, and all three comment sites
> (`eval/harness/harness/auth.py`, `apps/server/app/agent/real_agent.py`,
> `tests/packaging/agent-tool-names.test.ts`) describe that as *eager-loading*
> the schemas to avoid deferral. The name reads the other way, and committed
> runlogs still show heavy ToolSearch use. Nobody has confirmed the polarity.
> It does not change the rule above — bare-name search is correct under either
> reading — but it does mean the three comments may be describing the opposite
> of what the flag does.

**Known limit:** every lint above stops at spelling. Nothing in the repo
verifies that a *granted* tool actually binds at runtime (the SDK handshake
exposes only name/description/model per agent); `make agent-smoke` (§7) is
the closest instrument, and it covers name resolution, not tool binding.

## 4. The write-lockdown hook

The plugin ships one `PreToolUse` hook
(`packages/engine/plugin/hooks/hooks.json` +
`hooks/guard_project_files.py`): it **denies raw `Write` / `Edit` /
`NotebookEdit` on `research.json` and `tree.gedcomx.json`**, matched on
basename with both path separators handled (the POSIX-only split was a
silent Windows no-op once — fixed by PR #984). The deny message names the
sanctioned writer tools, and no `stopReason` is set: a denied write is a
recoverable mistake and the turn continues.

Why a hook and not an allow-list: **allow-lists are subtractive.** A
per-agent `tools:` list can only narrow what a subagent inherits from the
session, so no allow-list can restrain the *main thread* — a `PreToolUse`
hook is the only instrument that can. And why it ships in the plugin:
`hooks=` is an SDK argument the hosted control plane can set and Cowork
cannot be made to; a plugin-shipped `hooks/hooks.json` binds in both
(verified live in Cowork 2026-07-30 — the hook loads, fires, and its deny is
honored, with the script's own reason text surfacing). Cowork runs
`permission_mode: "default"`, the hosted path `bypassPermissions`; a hook
binds under both.

The script is stdlib-only and **never raises** — every failure path
(unparseable stdin, missing fields) falls through to allowing the call,
because an exception here would fail a tool call the user was entitled to
make. Packaging is guarded: `scripts/package-plugin.mjs`'s `INCLUDE` list
must carry `"hooks"`, asserted by
`tests/packaging/plugin-hooks.test.ts` (which runs the real script).

Two facts to hold onto:

- **Three sibling implementations exist** — the plugin hook, the hosted SDK
  hook (`apps/server/app/agent/real_agent.py::_pretool_hook`), and the e2e
  harness copy (`eval/harness/e2e/orchestrator.py`). Each is tested
  independently and **no test asserts the three agree** — a known divergence
  risk the next time `PROTECTED_PROJECT_FILES` changes
  (`guardrail-enforcement-spec.md` §6, which is the authority on this
  guardrail and on the enforcing-vs-shadow status of every other one).
- **The `Bash` route is deliberately open**
  (`apps/server/app/agent/real_agent.py:132-139`): the guard matches on
  `file_path`, so `cat >`, `sed -i`, and `python -c` all get through.
  Pattern-matching command text would false-deny a legitimate
  `python script.py research.json > out` while still missing a variable-built
  path, and a false deny is the worse failure mode. Note the stated
  rationale — "skills run their stdlib-only scripts through `Bash`, so it
  cannot be revoked" — is currently hypothetical: no skill ships a `scripts/`
  folder today (§1). The conclusion stands on the false-deny argument alone.
  The gap is recorded in `docs/TODOs.md`, to be closed only if a bypass ever
  uses the shell.

## 5. State: three persisted locations, validating writers, projection reads

**All cross-session state lives in the project folder** — there is no
host-side store (root `CLAUDE.md`: Cowork sessions are ephemeral; only the
project folder persists). Three locations: `research.json` (the research
document), `tree.gedcomx.json` (simplified GedcomX), and the `results/`
directory of search-result sidecar files (`results/<log_id>.json`,
`research-schema-spec.md` §5.4.1 — raw search payloads kept out of
`research.json` so the co-edited file stays lean).

The two documents and the sidecars are written by different mechanisms, and
conflating them is the easy mistake: the documents go through validating
writer tools called by the model, while a sidecar is **staged host-side by the
search tool that produced it** — `record_search`, `fulltext_search`, and
`external_links_search` write their verbatim payload into `results/.staging/`
and return only a small handle, which `research_log_append` later finalizes
into `results/<log_id>.json` (`search-result-staging-spec.md`). The payload
travels search tool → disk → log-append and never round-trips through the
model. That is the same never-re-serialize principle as the projection reads
below, applied on the write side.

**Writes: only through validating writer tools.** `research_append` (and its
lane-scoped variant `extraction_append`, §6), `research_log_append`,
`tree_edit`, `tree_correct`, `merge_tree_persons`, `tree_forget`, and
`materialize_facts` each validate the **whole** project in memory and write
nothing on failure (e.g. `materialize-facts.ts` runs `validateParsed` over
research + tree before its single write). The tools assign all ids; callers
never predict them. `validate_research_schema` exists as a read-only check
for files touched *outside* the writer tools — defensive validate passes
between steps are explicitly redundant (`research/SKILL.md` step 4). The §4
hook backs this rule mechanically.

**Reads: projections, not whole-file `Read`s.** Two read-side tools exist so
the model never re-ingests a monotonically growing JSON document to answer a
small question: `project_context` (compact orientation snapshot for
fresh-context agents) and `research_query` (filtered section reads for
routing and review). The principle, stated in
`project-context-tool-spec.md`'s header: the writer tools removed
"re-serialize large JSON to write," the projection tools remove "re-read
large JSON to think." Never design a flow that hands the LLM a large
document to edit and re-emit. Known gaps are documented, not hidden:
`research_query` caps at 50 items with a `truncated` flag and no pagination,
covers ~11 of ~15 sections, and no MCP tool reads `tree.gedcomx.json` —
which is why `Read` is not revoked (`guardrail-enforcement-spec.md` §6,
"Deliberate gaps").

**State reaches the prompt, too.** 26 of the 27 skills open with a
`**Narration:**` line instructing Claude to read
`researcher_profile.narration_guidance` out of `research.json` and apply it as
that invocation's narration style (root `CLAUDE.md`, "Researcher profile").
`init-project` writes the profile from a two-question interview. It is the one
binding every skill shares, and it exists because of the same constraint as
§1b: with no plugin-level `CLAUDE.md` auto-load and no shared reference
loading, a cross-cutting instruction has nowhere to live but each `SKILL.md` —
so the *instruction* is duplicated and the *value* it reads is centralized in
project state.

**The casing seam.** API/wire surfaces are camelCase (tool parameters,
`~/.familysearch-mcp/config.json`, upstream full GedcomX); persisted project
documents are snake_case (`research.json`, simplified GedcomX). The MCP tool
boundary is the seam, and it is exactly where both directions are validated:
input schemas on the way in, `validate_research_schema` with
`additionalProperties: false` (and the closed per-object field allow-lists
in `src/validation/tree-shape.ts`) on the persisted side — a casing slip
fails loudly instead of corrupting state. `src/utils/gedcomx-convert.ts`
pays the rename cost once, in tested code. Schema details and
change-procedure live in `research-schema-spec.md`,
`simplified-gedcomx-spec.md`, and root `CLAUDE.md`'s three-case edit table —
not here.

## 6. Capability restriction by tool identity

Where a boundary must hold against a *misdirected caller*, this system
narrows the tool, not the prompt. `extraction_append` is `research_append`
restricted to the two sections the `record-extractor` agent owns (`sources`,
`assertions`) — same implementation, gated by a **second function
parameter** (`researchAppend(input, { allowedSections, toolName })`) that a
tool caller structurally cannot reach, because dispatch builds only the
first argument from tool input. The pattern, from the observed failure that
produced it (a delegation message prompted the extractor past its prose lane
and it fabricated a match score): prose in an agent body does not hold; a
parameter on the tool input does not hold (the caller supplies the input);
**tool identity holds** — the agent's frontmatter omits the broad writer and
additionally denies it under both spellings. Full rationale, error contract,
and what it deliberately does not fix: `research-append-tool-spec.md` §11.

## 7. How each environment loads the plugin

Four environments run this system; root `CLAUDE.md` ("Cowork plugin agents")
is the operational authority. Condensed:

| Environment | Skills | Agents | MCP server |
|---|---|---|---|
| **Cowork** | plugin, loaded as a plugin | plugin (bare `@plugin:` names resolve) | host `.mcpb` via the remote-device bridge (`mcp__remote-devices__Genealogy_Research__*`) |
| **Hosted control plane** (`apps/server/app/agent/real_agent.py`) | `plugins=[{"type": "local", …}]` | **staged** into `<project>/.claude/agents/` (`stage_plugin_agents`) | own stdio registration under `genealogy` |
| **Unit harness** (`eval/harness/harness/workspace.py`) | staged into `.claude/skills/` | staged into `.claude/agents/` | mock server under `genealogy` |
| **E2e harness** (`eval/harness/e2e/orchestrator.py`) | staged | staged | live server under `genealogy` |

The hosted path does **both** plugin-loading and agent-staging because SDK
plugin loading registers agents only under the namespaced
`genealogy-research:<agent>`, while every SKILL.md delegates by the bare
name — without staging, the Task call errors and the model falls back to a
general-purpose stand-in that binds none of the agent's `tools:` /
`disallowedTools:` (issue #939; skills are unaffected). Both harnesses load
the staged files via `setting_sources=["project"]`.

`make agent-smoke` is the only check that reads what the hosted runtime
actually *resolved* (the SDK init handshake's agent list — no model call),
and **no CI job runs it**. Run it after any change to how the hosted agent
session is configured.

---

## Related documents

- [`README.md`](../../README.md) — tool, skill, and agent catalogs; workflow.
- Root [`CLAUDE.md`](../../CLAUDE.md) — the operating manual: conventions,
  change procedures, and the full prose behind §§3–4 and §7.
- [`guardrail-enforcement-spec.md`](guardrail-enforcement-spec.md) — every
  guardrail, its instrument, and its enforcing/shadow status.
- [`research-append-tool-spec.md`](research-append-tool-spec.md) — the write
  boundary, its invariants, and the `extraction_append` lane (§11).
- [`research-schema-spec.md`](research-schema-spec.md) /
  [`simplified-gedcomx-spec.md`](simplified-gedcomx-spec.md) — the persisted
  state's schemas.
- [`project-context-tool-spec.md`](project-context-tool-spec.md) /
  [`research-query-tool-spec.md`](research-query-tool-spec.md) — the
  projection tools.
- [`gps-mentor-agent-spec.md`](gps-mentor-agent-spec.md),
  [`image-reader-agent-spec.md`](image-reader-agent-spec.md),
  [`image-reader-opus-agent-spec.md`](image-reader-opus-agent-spec.md) —
  per-agent contracts (`record-extractor` has no standalone spec; its lane
  is specified in `research-append-tool-spec.md` §11 and its body).
- [`docs/skill-authoring-guide.md`](../skill-authoring-guide.md) /
  [`docs/skill-lifecycle.md`](../skill-lifecycle.md) — how to write a skill
  and how its description gets tuned and tested (§1a).
- `docs/agentic-system-critique.md` — the measured read of these mechanisms
  and the prioritized work list.
