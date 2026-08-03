# Architecture

**Status:** As built, verified against the repo 2026-08-02, then adversarially
fact-checked twice. Every count and file reference below was confirmed at a
source site. Where a claim could not be verified, it says so.

**Who this is for.** Two readers, and the doc is written for the first one:

1. **A developer — junior or senior — about to change something**, usually
   working with Claude. Each of §§3–9 ends with **"If you're asked to…"** blocks
   naming the sites a change touches, the hazards that are not obvious from
   reading the code, and — critically — **which of them nothing checks**.
2. **A developer new to the repo.** See the first-day path in §0.

**Who this is not for.** Genealogists working on skill prose and evals — that
is `eval/JUNIOR-WALKTHROUGH.md` (first PR) and `eval/SENIOR-WALKTHROUGH.md`
(reviewing and releasing). Different audience, different workflow.

---

## Find your block

| If you're asked to… | § |
|---|---|
| Add an MCP tool · Add a skill · Change a skill body · Add a plugin agent | [§3](#if-youre-asked-to) |
| Change routing · Add a sub-skill · **Fix a skill that isn't triggering** | [§4](#if-youre-asked-to-1) |
| Give an agent a new tool · Restrain something · Change `PROTECTED_PROJECT_FILES` · Add a hook | [§5](#if-youre-asked-to-2) |
| Add a field to `research.json` · Add an enum value · Add a tree field | [§6](#if-youre-asked-to-3) |
| Add a viewer feature · Change what the sandbox runs · Add a control-plane endpoint | [§7](#if-youre-asked-to-4) |
| Change hosted agent config | [§8](#if-youre-asked-to-5) |
| Verify a change · Debug a failing e2e run · Add a unit eval test · Write a spec | [§9](#if-youre-asked-to-6) |

> **Before you trust a green CI run, read [§9.4 — What nothing checks](#94-what-nothing-checks).**
> Fourteen things in this system have no automated guard, and several of them
> fail *silently* in production while CI stays green.

---

## 0. How to use this doc

### Read this first if the vocabulary is new

[`docs/gps-research-flow.md`](gps-research-flow.md) explains the **Genealogical
Proof Standard (GPS)** this entire system implements — define the question,
plan, search, extract, correlate, conclude — and the domain words this guide
uses freely: *assertion*, *source*, *proof summary*, *tier*, *exhaustiveness*,
*FAN*. Twenty minutes, and §§3–6 stop being opaque.

**Glossary** — terms used here that are not defined where they first appear:

| Term | Meaning |
|---|---|
| **Cowork** | Anthropic's sandboxed-VM product that runs Claude with a plugin. One of four environments this system runs in (§8). Not the same as Claude Code or Claude Desktop. |
| **MCP** | Model Context Protocol — the tool-call interface between the model and our host-side server. |
| **`.mcpb`** | The desktop-extension package format. Our MCP server ships as one; it installs into Claude Desktop and runs on the host. |
| **E2B** | Third-party microVM vendor. Hosts the per-session sandbox in the web product (§7). |
| **GedcomX** | The genealogy data interchange format. **Simplified** GedcomX is our reduced, snake_case subset — the schema of `tree.gedcomx.json` (`docs/specs/simplified-gedcomx-spec.md`). |
| **assertion** | One evidence claim extracted from one source, persisted in `research.json`. |
| **proof summary / `ps_id`** | The written argument resolving one research question, carrying a confidence **tier**: `proved`, `probable`, `possible`, `not_proved`, or `disproved` (a closed enum — `enums.schema.json`). "Tier ≥ probable" in §4 means `proved` or `probable`. |
| **sidecar** | A raw search payload stored at `results/<log_id>.json` instead of inside `research.json`, so the co-edited file stays small (§6.1). |
| **staging** | The host-side write of a sidecar into `results/.staging/` by the search tool that produced it, later finalized by `research_log_append` (§6.1). |
| **projection** | A compact, filtered read of a large document — what `project_context` and `research_query` return instead of the whole file (§6.3). |
| **compaction** | When a long session's context is summarized to fit the window. Skill bodies can be evicted by it — the reason §3.1 exists. |
| **fixture** | Two different things. `eval/fixtures/mcp/` holds **mocked tool responses** for unit runs; `eval/tests/e2e/<slug>/` holds a **benchmark case** (a starting project plus expected findings). |
| **run log / `.ann.json` / active** | A committed record of one eval run; its human annotation; and "active" meaning its snapshot hash still matches the current skill files. All three are load-bearing for the CI gate on skill PRs (§3 "Change a skill body"). |
| **rubric / judge / validator** | The unit-eval trio: per-skill grading criteria, the LLM grader, and a deterministic per-skill check (§9.3). |
| **shadow mode** | A guardrail that records violations without denying them, pending calibration. `guardrail-enforcement-spec.md` **§4** lists every guardrail's instrument, binding environment, and enforcing-vs-shadow status. |

### First day

0. **Prerequisites on PATH:** `make`, `node` + `npm`, `pnpm`, and `uv` — all
   four named by `scripts/test.sh`'s preflight.
1. `make install`, then **`make test-all`** — confirm green *before* you change
   anything, so a pre-existing failure isn't mistaken for yours. It is the
   whole gate (it delegates to `scripts/test.sh`, which the PR template names);
   nothing else needs running before a PR. See §9.1 for the per-suite targets.
2. Read [`docs/gps-research-flow.md`](gps-research-flow.md) (the domain).
3. Read §§1–3 here (the shape).
4. Open one skill (`packages/engine/plugin/skills/record-extraction/SKILL.md`),
   one agent (`packages/engine/plugin/agents/record-extractor.md`), and one tool
   spec (`docs/specs/record-search-tool-spec-v2.md`) side by side. That triangle
   is the whole system in miniature.
5. Then §§4–9.

### The three tiers, and what each one owns

Facts about this system live in one of three places:

| Tier | Owns | Read when |
|---|---|---|
| **`CLAUDE.md`** (repo root) | **The imperative.** "List both spellings." "Pass `encoding="utf-8"`." The rules you must follow to make a correct change. | Always — the only tier auto-loaded into every session. |
| **This guide** | **The map.** What the pieces are, how they bind, where a change lands, what nothing checks. It restates an imperative only where you need it to size a blast radius, and names `CLAUDE.md` as that rule's owner. **On conflict, `CLAUDE.md` wins.** | Before a change whose blast radius you don't already know. |
| [**`docs/adrs/`**](adrs/) | **The why.** One decision per file: forces, alternatives tried and rejected, consequences knowingly accepted. Its Context/Decision/Alternatives are frozen history; its `Applies to`/`Enforcement` pointers are live and CI-linted. | A rule looks arbitrary, or you want to change it. Index below. |

If this guide and a per-tool spec (`docs/specs/<tool>-tool-spec.md`) disagree,
**the spec wins** — it is the contract an implementation is checked against.

### Tense: "Today" vs "Direction"

This guide describes the system **as built**, in the present tense. Several
things it describes are known to be the wrong shape and are being moved. Those
carry an explicit callout:

> **Today:** how it works right now — build against this.
> **Direction:** where it is going, with the issue, plus the one instruction
> that keeps your change from making the move harder.

The analysis behind every `Direction` note is
[`docs/agentic-system-critique.md`](agentic-system-critique.md). This guide
carries the instruction, not the reasoning.

### ADR index

<!-- ADR-INDEX-START -->
One decision per file, in [`docs/adrs/`](adrs/). Read one when a rule looks
arbitrary, or when you want to change it. The **"read before you"** column is the
routing surface — find your task, then open that ADR.

| ADR | Decision | Read before you… |
|---|---|---|
| [0001](adrs/ADR-0001-run-network-code-on-the-host.md) | Run all network code on the host; ship only offline code into the VM | add a feature that calls an external API · write a script that ships in a skill or hook · debug a call that returns nothing with no error |
| [0002](adrs/ADR-0002-decompose-into-tools-skills-and-agents.md) | Decompose into MCP tools, skills, and plugin agents by what each needs | add any capability and wonder where it goes · choose between a skill and a subagent · add a tool for something the model could just do |
| [0003](adrs/ADR-0003-anchor-cross-turn-rules-structurally.md) | Anchor cross-turn rules structurally rather than in prose | write a new rule into a `SKILL.md` or agent body · fix a compliance failure by making an instruction clearer · reinforce a rule that keeps being violated |
| [0004](adrs/ADR-0004-dual-spell-mcp-tool-names-in-agent-frontmatter.md) | Dual-spell every MCP tool name in agent frontmatter | grant or deny a tool to a plugin agent · write a `ToolSearch` query · rename the desktop extension |
| [0005](adrs/ADR-0005-ship-the-write-lockdown-as-a-plugin-hook.md) | Ship the write lockdown as a plugin `PreToolUse` hook | add a guardrail · restrain the main thread · try to stop the agent doing something with an allow-list · change `PROTECTED_PROJECT_FILES` |
| [0006](adrs/ADR-0006-restrict-capability-by-tool-identity.md) | Restrict capability by tool identity, not by prompt or parameter | need a delegated agent to do *part* of what a tool can do · write "you must only use this for X" in an agent body · add a `mode` parameter to scope a writer tool |
| [0007](adrs/ADR-0007-attack-the-plan-before-writing-code.md) | Attack the plan before writing code, with a read-only critic; settle task risk at triage (§2) | wonder why `/critique-plan` is a command and not a sentence · want a third critique round · want to skip `PLAN.md` because the plan is in the chat · want per-task plans filed under `docs/plan/` · want to add a "Risky" tier back to the lifecycle · are about to hand a schema, auth, or plugin-agent change to a junior |

Conventions, and how to add one: [`docs/adrs/README.md`](adrs/README.md).
Not yet written: state and the writer/projection tools, self-contained agent
bodies, duplicated `references/`, the casing seam, model routing,
descriptions-as-triggering.
<!-- ADR-INDEX-END -->

---

## 1. Two products, one repo

This repo ships **two independent products** that share a schema and a research
engine.

| | **The engine** (Cowork plugin + desktop extension) | **The hosted web workbench** |
|---|---|---|
| **Artifacts** | a `.mcpb` desktop extension + a plugin `.zip` | a FastAPI control plane + a React client, deployed |
| **Where it runs** | user's machine (host) + the Cowork VM | Fly.io today, AWS in production |
| **Source** | `packages/engine/{mcp-server,plugin}` | `apps/{server,web,electron}`, `packages/{viewer-ui,schema}` |
| **Toolchain** | **npm** | **pnpm + turborepo** (`apps/{web,electron}`, `packages/*`); **uv / Python** (`apps/server`) |
| **Build** | `make mcpb`, `make plugin` | `make server`, `make web`, `make deploy` |
| **Covered by** | §§2–6, 8 | §7 |

**The engine is deliberately outside the pnpm workspace.** `pnpm-workspace.yaml`
carries a `!packages/engine/**` negation, so the engine stays npm-managed and its
release pipeline and CI are untouched by anything the web side does. The
dependency runs one way only: **the web side depends on `packages/schema`, never
on the engine.**

Memorable commands live in the **`Makefile`** (`make help` lists them). The
hosted POC runs entirely on mocks — `make server-mock` needs no E2B, Anthropic,
or OAuth credentials.

---

## 2. The constraint that shapes everything

Cowork runs Claude inside a **sandboxed Linux VM with no reliable network
egress.** Its allowlist does not work for arbitrary domains.
*(Imperative owned by `CLAUDE.md` § "Architecture you must understand".)*

Everything else in the engine follows from that one fact:

- Code that needs the network **must run on the host** → it is an MCP tool.
- Code shipped **into the VM** must work without it → skills, agents, hooks, and
  any bundled Python.
- The two halves **share no files at runtime.** They communicate only through
  MCP tool calls: structured JSON in, structured JSON out.

**The question to ask about any new feature: does this need the network?** If
yes, it is an MCP tool on the host. If no — data processing, formatting,
templating, judgment — it can live in the VM.

Two traps this sets:

- A skill or hook script that calls out to the network is **silently blocked** by
  the egress proxy. It does not error in a way you will recognize.
- Those scripts must be **stdlib-only Python**. Non-stdlib imports may not be
  present in the VM, and pip installs slow every invocation.

---

## 3. The engine's three-way decomposition

Three kinds of component, each placed by what it needs. *(Paths in this section
are relative to `packages/engine/mcp-server/` unless shown otherwise.)*

| Component | Count | Where | What it is for |
|---|---|---|---|
| **MCP tools** — `src/tools/`, advertised via `allToolSchemas` in `src/tool-schemas.ts` | **47** | host | Network access (FamilySearch, the wiki sidecar, OpenRouter OCR) and **validate-before-persist** writes to project state. Invariants live here because a tool contract cannot be argued past. |
| **Skills** — `packages/engine/plugin/skills/<name>/SKILL.md` | **27** | VM, in the session's own context | Judgment and procedure: GPS doctrine, routing, when-to-stop criteria. A skill folder may also carry `references/` (§3.3) and `templates/`. |
| **Plugin agents** — `packages/engine/plugin/agents/*.md` | **4** | VM, **fresh context** | Heavy or capability-restricted work delegated off the main thread. Each spawns with **no session state** — only its own `tools:` allow-list, any `disallowedTools:` denies (today only `record-extractor` has them), and its `model:` pin. |

The four agents are `gps-mentor`, `record-extractor`, `image-reader`, and
`image-reader-opus`.

> Plugin agents (`packages/engine/plugin/agents/`) are consumed by the **Cowork
> runtime** and are a different thing from Claude Code subagents
> (`.claude/agents/`, which are developer tooling for this repo — today
> `plan-critic`, `rubric-critic`, `skill-improver`, and `task-reviewer`). The
> dual-spelling rule in §5.2 applies to plugin agents only; these declare bare
> tool names.

### 3.1 The most important rule in this repo: anchor rules structurally

**A rule that must hold for hours needs a structural anchor. Prose alone
survives about three compactions.**

This is measured, not asserted. Across 309 turns of a real session
(`docs/plan/research-performance-2026-07-27.md` §5.3): **every rule with a
structural anchor held at 100%, and every rule that decayed had none.** The
ranking doctrine fell from **77% compliance to 3%** once compaction evicted the
skill body from context.

Two qualifications, both from the source:

- **The law runs one way only.** Three rules in that audit were unanchored, and
  one of them held anyway (its rate even rose). An anchor *guarantees* survival;
  the absence of one merely *permits* decay. "It's unanchored and it's fine" is
  not evidence against the law.
- **The audit measured one skill.** It covers `search-records`, whose body was
  resident for 228 of the 309 turns, and the source says explicitly that the
  criterion is general but the per-skill audit "should not be assumed" elsewhere.
  It also exempts plugin agents, which get fresh context per invocation and
  cannot decay this way.

A rule is **structurally anchored** if any of these holds:

1. **The tool rejects the violation.** (`research_append` refuses the write.)
2. **The output feeds a step that cannot proceed without it.**
3. **It leaves a durable trace the agent re-reads.** (A trace nothing re-reads
   is not an anchor.)

So when you are about to write a new rule, the question is *where it goes*, not
how to word it:

| The rule must hold… | Put it in | Example |
|---|---|---|
| across hours, many turns, past compaction | **a tool contract** — validate and reject | the write-boundary invariants in `research_append` |
| for the main thread, which no allow-list can narrow | **a `PreToolUse` hook** (§5.4) | the raw-write lockdown |
| for one delegated agent | **that agent's `tools:` / `disallowedTools:`**, or a narrowed tool (§5.3) | `extraction_append` |
| within a single skill invocation | **skill prose** — this is what prose is *for* | "consult the stop criteria before draining the plan" |

> **Direction (critique §3, P0).** Two gates are still prose that this same law
> says will decay — the **tree-encoding gate** and the **mentor gate** (§4). Both
> are computable from files `research_append` already loads and are being moved
> into the tool. **If you are adding a new cross-turn invariant, do not add it as
> prose.** If it cannot be anchored, say so in the PR and explain why.

### 3.2 How a session enters a skill: `description` is product surface

The outermost binding is **text matching**, not a routing table. A skill's
`description` frontmatter decides whether an utterance triggers it; an agent's
`description` decides whether the Cowork orchestrator auto-delegates to it.

That makes both fields product surface, not documentation. A description that
under-triggers makes a working skill unreachable; one that over-triggers steals
turns from the right skill.

- **1024-character cap, no angle brackets**, doubly linted:
  `eval/harness/scripts/check_skill_frontmatter.py` (CI **and** the plugin
  packaging script, checking the *folded* value so a long multi-line description
  cannot escape to install time) and
  `tests/packaging/skill-description-length.test.ts`. The two sites disagree
  about *why* 1024 — the vitest comment calls it a runtime cap, the Python
  checker calls it "a self-imposed standard, not a Cowork limit." **Nobody has
  reconciled them; treat 1024 as hard either way.**
- **Descriptions are tuned empirically, not by taste.** `eval/triggering/` holds
  the vendored description optimizer; `docs/skill-lifecycle.md` owns the
  workflow.

**A description is not the only binding between an utterance and a skill** — for
a sub-skill reached through `/research`, the routing table is. If something isn't
triggering, work out which one missed before you edit anything: see **"Fix a
skill that isn't triggering"** at the end of §4.

Most utterances should land on `research` (§4). Sub-skills keep their own
descriptions because a user may still invoke any of them directly.

### 3.3 `references/` — the fourth artifact, duplicated on purpose

21 of the 27 skills carry a `references/` folder — **75 files** — loaded on
demand, in-session, for material too long to sit in the skill body.

A skill can read its own sibling files; the failure is **across** skills. Claude
Code's relative-path resolution from one SKILL.md into another skill's folder is
unreliable (claude-code#17741). So guidance several skills must follow
identically is **physically duplicated** into each one rather than linked.

Three families are duplicated today, and only one is lint-guarded:

| File | Copies | Distinct contents | Lint |
|---|---|---|---|
| `validation-protocol.md` | 12 | **10** | **none** |
| `places-guidance.md` | 9 | 2 | `tests/packaging/skill-guidance.test.ts` |
| `research-log-protocol.md` | 3 | **3** | **none** |

The `places-guidance` lint holds 8 copies byte-identical to a canonical at
`packages/engine/plugin/references/places-guidance.md` — a path deliberately
**absent from `package-plugin.mjs`'s `INCLUDE`**, so the canonical is a
build-time anchor that never ships into the VM. The 9th copy belongs to
`research-plan`, which had three place tools dropped from its `allowed-tools`
in 8bf43be2 (and never held a fourth), so the canonical text would name tools it
cannot call. It is exempted **by name** and gets only an exists-and-non-empty
check — a regression inside it passes silently.

> **Today:** editing a duplicated reference means editing every copy by hand and
> knowing which divergences are deliberate. For `validation-protocol.md` and
> `research-log-protocol.md`, **nothing records which is which.**
> **Direction (#1112, critique §5.7):** either lint a shared core plus a
> per-skill "who calls what" section, or derive each copy at build time from the
> skill's `allowed-tools`. The cheaper move is to *shrink* them —
> `validation-protocol.md` largely restates rules `research_append`'s error
> contract already enforces at write time, and a rule the tool rejects can be one
> sentence. **Don't add a 13th copy without saying why in the PR.**

### 3.4 Agent bodies are self-contained — do not split them

Everything an agent needs at runtime lives inline in its `.md`. **No sibling
reference files read at runtime, no build-time assembly.** Both alternatives
were measured on `record-extractor` (issue #702) and reverted.
*(Imperative owned by `CLAUDE.md` § "No playbook/reference files for agents".)*

- **On-demand `Read` fails silently, in three modes.** With the files provably
  reachable, the agent read the playbook on some tests, ignored it on others, and
  over-applied it on others — 6/19 against a 12–14/19 baseline. No error is
  raised, and the unit harness records only MCP calls, so a skipped `Read` leaves
  **no trace at all.**
- **Build-time assembly** works mechanically but splits the reviewed artifact
  from the executed one. Here the prompt *is* the product: whoever edits a
  fragment must see the whole body it lands in, and seeing the real size is the
  pressure that produces a smaller prompt.

The cost is knowingly accepted: there is no per-record-type ownership surface, so
a probate specialist edits the same file as everyone else. **Revisit only with a
mechanism that cannot silently skip.**

### 3.5 Model routing

Per-step model routing exists **only through plugin agents.**

| Surface | Honored where | Today |
|---|---|---|
| **Agent `model:`** | Cowork, hosted, both harnesses | `gps-mentor` → `claude-sonnet-5`; `image-reader-opus` → `claude-opus-4-8`; `record-extractor` + `image-reader` → `claude-sonnet-4-6` |
| **Skill `model:`** | **the unit eval harness only** | 26 of 27 skills pin `claude-sonnet-4-6` — which *is* the harness default |
| **Reasoning effort** | session-wide; never set by `real_agent.build_options` | not a per-step lever |

> **Direction (critique §2.4, §5.3).** The 26 skill `model:` pins are **dead
> lines**, not a fidelity gap: they pin the value that is already the default, and
> only the unit harness reads them. They are slated for deletion because they make
> per-step routing look like it exists. **Do not add a `model:` pin to a new
> skill.** To route a step to a different model, delegate it to a plugin agent.

### 3.6 The lane rule — classify a finding before you edit prose

An e2e failure, an eval miss, or a user complaint is **not** automatically a
prose bug. Before editing any `SKILL.md` or agent body, classify it:

| Lane | Finding is… | Fix goes to |
|---|---|---|
| 1 | a tooling defect | an MCP tool PR |
| 2 | an eval defect (judge, rubric, or fixture is wrong) | an eval PR |
| 3 | a **record-type craft gap** — this census/probate/deed handled wrong, other types fine | **Depends on whose gap it is.** An *agent* finding → the table for that type inside the agent body (e.g. the census informant table in `agents/record-extractor.md`); agents carry no sibling reference files, by decision (§3.4). A *skill* finding → that skill's own `references/` file — skills do have them (§3.3). Either way a table edit is scoped: it changes one type and nothing else. |
| 4 | **core doctrine** — a rule that applies across record types or skills | the stewarded prose edit, gated by the unit suite. **Often the same file as lane 3; the difference is blast radius, not location.** If your edit changes behavior on records you didn't look at, it's lane 4. |
| 5 | a **triggering / routing miss** — the skill never ran | the `description` (§3.2) or the routing table (§4), **never the body**. See "Fix a skill that isn't triggering" at the end of §4. |

**Most findings are lanes 1–2, and prose edits never compensate for a tool or
eval bug.** Full version: `docs/skill-lifecycle.md` §5 and `CLAUDE.md`'s lane
rule — **note both define four lanes; lane 5 is this guide's addition** and has
not yet landed in either owner. On conflict, `CLAUDE.md` wins.

### If you're asked to…

**Add an MCP tool.** Mechanics: `DEVELOPMENT.md` "How to add a new feature".
Architecturally:

- **The spec comes first** — `docs/specs/<tool>-tool-spec.md`. A live tool must
  have a live spec, and the spec is what the implementation gets checked
  against. Copy `src/tools/wikipedia.ts` and its sibling four files as the
  template.
- **Four sites — but the drift test catches only one kind of miss.**
  `tests/packaging/manifest.test.ts` asserts `manifest.json`'s `tools` array ↔
  `allToolSchemas`. **It does not check the dispatch.** Forget the
  `if (request.params.name === "…")` block in `src/index.ts` and CI stays green,
  the tool is advertised to the model, and the first real call throws
  `Unknown tool: …` (`src/index.ts:736`).
- **Also touch, and nothing will tell you if you don't:** `src/types/<name>.ts`
  (shared response types), `dev/try-<name>.ts` (a one-shot live-API smoke script
  — your only real debugger when the MCP harness swallows errors),
  `tests/tools/<name>.test.ts`, `README.md`'s tool table, and — if a skill will
  call it — an `eval/fixtures/mcp/` fixture.
- **If it calls an external service:** the base URL/key is a field on `AppConfig`
  (`src/types/auth.ts`) plus a `get*` helper in `src/auth/config.ts`, read from
  `~/.familysearch-mcp/config.json`. **Never a `process.env` fallback** — the
  file is the sole source. Throw **LLM-instruction errors**: the message must
  tell Claude what to do next, not just what failed.
- **Reuse before you write:** `getValidToken()` for auth (never re-implement
  token plumbing), `place-resolver.ts` / `place-api.ts` for places, and
  `BROWSER_USER_AGENT` from `src/constants.ts` for any FamilySearch endpoint —
  FS sits behind Imperva and **403s non-browser UAs**.
- **Parameters are camelCase** (§6.4). Generic tools with a provider parameter,
  **not one tool per provider** — tool count is context budget in every session.
- If it ingests untrusted external text (OCR, full-text, record contents), see
  the prompt-injection gap in §9.4 — there is no doctrine to follow yet, so say
  what you did in the PR.
- **Nothing sees the new tool until you rebuild, and each environment differs.**
  Claude Code: `make engine-build`, then **start a fresh session** — `.mcp.json`
  points at the compiled `build/`, and a live session holds the old catalog. The
  harness targets (`harness-test`, `eval-skill`, `e2e-run`) carry `$(ENGINE_BUILD)`
  and rebuild for you. Cowork: `make mcpb` and reinstall the extension, then fully
  quit and reopen Claude Desktop. Hosted: `make sandbox-image` — the
  `genealogy-agent` image bakes its own engine and `make server-e2b` does **not**
  rebuild it (§7). `docs/skill-lifecycle.md` → "Rebuilding and reinstalling"
  covers the Claude Code and Cowork rows; the hosted row is only here.

> **On the User-Agent, the rule is conditional.** `genealogy-mcp-server/<version>`
> is what the four non-FamilySearch tools send today (`wikipedia`, `wiki_search`,
> `wiki_read`, `wiki_place_page`) and is correct for them. It is also exactly
> what Imperva 403s on any FamilySearch endpoint. So: **FamilySearch →
> `BROWSER_USER_AGENT`; anything else → the service's own convention.** The
> deleted `mcp-tool-scaffolder` subagent stated it unconditionally — because its
> canonical template was one of the non-FS tools — which is part of why it and
> its two siblings were removed (#1161).

**Add a skill.** Copy `packages/engine/plugin/skills/search-wikipedia/` — the
canonical minimal example of the full pipeline. Don't mutate it. Then:
`docs/skill-authoring-guide.md` for the body; the `description` is linted twice
at 1024 chars (§3.2); a skill meant to run inside `/research` also needs a
**routing row** (§4) or it will never be reached; no network in `scripts/`; no
`model:` pin. It does not exist in Cowork until `make plugin` + reinstall.

**Change a skill body.** **Classify the finding first (§3.6)** — most are tool or
eval bugs wearing prose costumes. If it really is prose: keep cross-turn rules
out of it (§3.1), then run `make eval-skill SKILL=<name>` — **and grade it.**

> Touching *anything* under `packages/engine/plugin/skills/**` — including a
> `references/` file or a comment — arms `.github/workflows/check-runlogs.yml`,
> which **blocks the PR** unless the newest full-skill run log's snapshot matches
> your branch and its `.ann.json` carries a correction for every dimension of
> every test. Annotations are written **only** through the CRUD UI (`make
> eval-ui`); hand-writing them is forbidden. A behavior-neutral edit can instead
> take the `eval-cosmetic-skip` label from a senior, which relaxes **the snapshot
> rule only** — the annotation rule still runs against the prior run log — and
> expires on every new push. **`research` and `forget-and-rederive` are exempt**
> (`RUNLOG_GATE_EXEMPT_SKILLS`), because neither has a unit suite. Full rules:
> `eval/CLAUDE.md` → "GitHub Action rules".

Remember the unit suite grades a *single invocation in fresh context* — it will
happily bless a cut that removes something only a multi-hour session needs.

**Add a plugin agent.** Write the body self-contained (§3.4), dual-spell every
tool (§5.2), and pin `model:` deliberately. Then run `make agent-smoke` (§8) —
and note that no CI job runs it.

---

## 4. Orchestration — the `research` skill

There **is** an orchestrator, and it is a skill:
`packages/engine/plugin/skills/research/SKILL.md`. It is deliberately thin —
"the GPS work itself happens in the sub-skills."

1. **Project state drives routing, not conversation state.** The orchestrator
   reads `research.json` through `research_query` and derives where the project
   is: which questions have plans, which log entries lack assertions, which
   conflicts are open, which proofs lack verdicts.
2. **A 17-row routing table maps state → next sub-skill**
   (`research/SKILL.md:128-146`). The table is the source of truth and is not
   duplicated here. Its `Invoke` column is **prose instruction**, not a literal
   tool call. Agents *are* delegated as `Task` calls using the bare
   `@plugin:<name>` form.
3. **Two modes.** Interactive surfaces meaningful decisions to the user.
   `--autonomous` runs the loop in one continuous turn: no clarifying questions,
   decisions logged to the audit-trail fields, and an explicit rule that
   **yielding the turn to announce a next step is a failure.**
4. **Completion is gated twice.** Before writing `project.status = "completed"`
   (its one direct write, via `research_append`): the **tree-encoding gate** —
   every tier-≥-probable conclusion must be encoded in `tree.gedcomx.json`; and
   the **mentor gate** — every `ps_id` a resolved question references must carry
   a `focus: "proof-critique"` verdict in `evaluations[]`, written by
   `@plugin:gps-mentor`. The mentor gate is mandatory to *invoke and record*; its
   recommendation stays advisory and never forces rework.
5. **Stop conditions:** `project.status == "completed"`, an explicit user halt,
   or a genuine logged blocker. Nothing else — finishing a sub-skill is mid-loop.

**Two contracts the orchestrator enforces on itself**, both load-bearing for
§§5–6: it never extracts records inline (every positive/partial log entry routes
through `record-extraction`, which delegates one `record-extractor` agent per
record), and it never writes identity links or eliminations inline
(`person-evidence`, `conflict-resolution`, `hypothesis-tracking` own those).

> **Direction (PR #1029, open).** That PR rewrites the routing table so every
> `Invoke` entry is a literal `Skill` tool call rather than prose. If it merges
> before you touch the table, expect the shape to differ.

> **Direction (critique §0.1, §3 P2).** Only **6 of the 17 rows are mechanically
> computable**, and those six were never the ones failing — the other 11 need
> judgment and belong in prose. So the routing table is **not** moving into a
> tool wholesale. The cheap 80% is folding `logIndex.hasLinkedAssertion` into
> `project_context`, which covers three rows with no new tool and no new prose
> rule to remember. **Don't propose "routing as a tool" as a fix for a routing
> failure without reading critique §3 P2 first** — it was the rev. 1 headline and
> was demoted after measurement.

> **Direction (critique §3 P1).** There is **no `eval/tests/unit/research/`
> suite.** The component that fails most is exercised only by live e2e runs. A
> router suite is planned, with two prerequisites: settling the router's
> `allowed-tools` and the agent-union semantics, and reconciling the two
> contradictory `address_first` verdict tables in the body
> (`research/SKILL.md:343-348` vs `:368-372`), which currently cannot tell a test
> which behavior is correct. One design hazard on top: #1012 — a `Skill()` callee
> can bind toolless in the unit path, so callee binding must be made real before
> routing can be graded.

### If you're asked to…

**Change routing.** Edit the table at `research/SKILL.md:128-146` — the source of
truth. There is **no unit suite** to catch you; the only instrument is a live e2e
run. Name the fixture you ran in the PR, or say you ran none.

The runlog CI gate does **not** apply here: `research` and `forget-and-rederive`
are in `RUNLOG_GATE_EXEMPT_SKILLS` (`eval/harness/scripts/check_runlogs.py`),
precisely because neither has a unit suite. The frontmatter lint still runs.

**Add a sub-skill to the loop.** It needs a routing row *and* a `description`
that doesn't collide with an existing skill's (§3.2). Check the negative routing
tests in the unit corpus.

**Fix a skill that isn't triggering.** First work out **which binding missed** —
they have different fixes, and only one of them is a description problem.

1. **Did the user go through `/research`?** Then the **routing table decides
   first** (`research/SKILL.md:128-146`) — check whether any row's state condition
   matches, and whether an earlier row shadows it. No unit suite covers this; a
   live `make e2e-run` is the only instrument. The sub-skill's `description` is
   still in play as the *tiebreaker*: the table explicitly says to "defer to each
   sub-skill's own 'Use when' guidance when state is ambiguous," and that text
   lives in the description frontmatter.
2. **Did the user address the skill directly?** Then it *is* the `description`
   (§3.2). Add the missed utterance to `eval/tests/unit/<skill>/` as a trigger
   query **first** — `make optimize-skill SKILL=<name>` builds its query set from
   that corpus, so tuning against an empty set does nothing. It makes real paid
   model calls, is not in CI, and only *proposes* text you then apply by hand.
3. **Did it trigger and then do the wrong thing?** That is not a triggering
   failure — classify it with §3.6.

Triggering is lane 5 in §3.6: it never fixes a body, and a body edit never fixes
it.

---

## 5. Capability binding — who may call what

Three surfaces declare this, and **they bind differently.** Confusing them is
the most expensive mistake in this layer, because two of the three fail
*silently*.

| Surface | Spelling | Binds in production? |
|---|---|---|
| Skill `allowed-tools:` | **bare** (`research_query`) | **No** — the hosted path runs `bypassPermissions` with no allowlist at all. Still enforcing in the unit harness. |
| Agent `tools:` / `disallowedTools:` | **dual-spelled**, matched exactly | **Yes** — and a deny binds even under `bypassPermissions`. |
| `PreToolUse` hook | n/a — matches on tool name + input | **Yes**, in Cowork and the hosted path. **Neither harness loads the plugin's hooks** (§5.4). |

### 5.1 Skill `allowed-tools` — declarative in production, enforcing in tests

A skill lists the MCP tools it calls **by bare name**. The unit harness compiles
this into the SDK session allowlist: a filesystem baseline
(`Read, Glob, Grep, Write, Edit, Skill, Task`) **plus** the skill's declared
tools qualified onto the server key, **plus the union of the `tools:` of every
plugin agent the skill references via `@plugin:`** — because a delegated agent's
MCP calls travel through the same session lists, so denying them would break the
delegation.

**This is not what restrains a production session.** But do not treat it as
decoration: in the unit harness an undeclared tool is **denied at call time**,
and the gap between a skill's own declaration and its agents' union is exactly
what the per-context policy uses to tell a legitimate direct call from a boundary
violation. **Declare accurately.**

### 5.2 Agent frontmatter: dual-spelled, exactly matched

*(Imperative owned by `CLAUDE.md` § "Dual-spelled tool names".)* Every MCP tool
in an agent's `tools:` — **and** `disallowedTools:` — appears **twice**:

```yaml
- mcp__genealogy__record_read
- mcp__remote-devices__Genealogy_Research__record_read
```

The MCP server's name belongs to whoever registers it, and the plugin — which
ships into the VM — cannot control that choice. `.mcp.json`, both harnesses, and
the hosted control plane register it under `genealogy`; Cowork reaches the
host-installed `.mcpb` through a remote-device bridge that namespaces it by
`manifest.json`'s `display_name` (`Genealogy Research` → `Genealogy_Research`).

Entries are matched **exactly** — no prefix fallback, no inherit-on-miss. When
*every* entry misses, the runtime refuses to spawn the agent at all ("would be
spawned with zero tools — refusing"). That is how #650/#698 broke all three
then-existing agents in Cowork **while CI stayed green**: they were qualified
against the harness's arbitrary dict key rather than the product's name. Listing
both spellings is safe because unrecognized entries are ignored so long as one
resolves.

`disallowedTools:` matters **more**, not less: a deny binds even under
`bypassPermissions` (the hosted path, #695), so it is the last line keeping
`record-extractor` off the broad `research_append` — and a deny naming one
spelling silently binds nothing wherever the server carries the other name.

**Two standing prohibitions:**

- **Never grant a server-level prefix** (`mcp__remote-devices`). That namespace
  also carries `device_bash`, `device_commit_files`, and `project_memory_write`
  — it would hand a read-only agent shell access to the host.
- **Never hardcode a qualified name in a `ToolSearch` query.** Search by bare
  name (`query: "+research_append"`), which matches whatever prefix the session
  exposes. `select:mcp__genealogy__…` resolves to nothing behind the Cowork
  bridge.

Built-in tools (`Read`) stay **bare** in agent frontmatter. Skill
`allowed-tools` stays **bare** everywhere.

All of this is CI-linted by `tests/packaging/agent-tool-names.test.ts`, which
derives the bridge prefix from `display_name` (so an extension rename fails
loudly in CI) and asserts all five registration sites still agree on `genealogy`.

> **Correction to three comments in the code (verified 2026-08-02).**
> `ENABLE_TOOL_SEARCH=true` **enables** deferred/tool-search mode. It does *not*
> eager-load schemas. Confirmed against the installed CLI (v2.1.220): a truthy
> value (`true|1|yes|on`) turns tool search **on**; `auto` / `auto:N` is adaptive;
> a **falsy** value (`false|0|no|off`) is what turns it **off**. Critically,
> **unset also means on** — deleting the variable does not eager-load anything.
> (It is additionally forced off on a non-first-party `ANTHROPIC_BASE_URL`, on
> Vertex, and under `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`.) **Five sites
> described the opposite and were corrected in #1173 and its follow-up** — the
> three harness/hosted comments plus `CLAUDE.md` and this repo's own packaging
> test. The flag **values** are unchanged; flipping them is separate work that
> has to re-measure the tool mix (#1110). The
> repo's own data corroborates: ToolSearch is **~11% of all tool calls** (387
> across 28 runs) *while the flag is set to `true`*. This does not change the
> bare-name rule above, which is correct either way. See critique §3 P1 and #1110.

### 5.3 Capability restriction by tool identity

Where a boundary must hold against a **misdirected caller**, this system narrows
the *tool*, not the prompt.

`extraction_append` is `research_append` restricted to the two sections
`record-extractor` owns (`sources`, `assertions`) — same implementation, gated
by a **second function parameter** (`researchAppend(input, { allowedSections, toolName })`)
that a tool caller structurally cannot reach, because dispatch builds only the
first argument from tool input.

The pattern comes from an observed failure: a delegation message prompted the
extractor past its prose lane and it fabricated a match score. The analysis:

| Lane | Holds? | Why |
|---|---|---|
| Prose in the agent body | **No** | a caller can prompt past it |
| A parameter on the tool input | **No** | the caller supplies the input |
| **Tool identity** | **Yes** | the agent's frontmatter omits the broad writer *and* denies it under both spellings |

Full rationale and error contract: `research-append-tool-spec.md` §11.

> **Open, and do not guess at it.** The same reasoning is wanted for identity
> scoring — a run should not be able to attach a persona from a new record to an
> existing tree person without a `same_person` attestation. The *direction* is
> settled (enforce structurally at the write boundary, not by post-run
> detection); the *mechanism* is not. **Three candidate discriminators have
> failed adversarial review.** The next deliverable is a gate spec satisfying
> five named design constraints, not a code change. **Read critique §3 P0 and §9
> before proposing a fourth.**

### 5.4 The write-lockdown hook

The plugin ships one `PreToolUse` hook (`packages/engine/plugin/hooks/hooks.json`
+ `guard_project_files.py`): it **denies raw `Write` / `Edit` / `NotebookEdit` on
`research.json` and `tree.gedcomx.json`**, matched on basename with both path
separators handled. The deny message names the sanctioned writer tools, and no
`stopReason` is set — a denied write is a recoverable mistake and the turn
continues. *(Imperative owned by `CLAUDE.md` § "Plugin hooks".)*

**Why a hook and not an allow-list:** allow-lists are **subtractive**. A
per-agent `tools:` list can only narrow what a subagent inherits from the
session, so no allow-list can restrain the **main thread**. A `PreToolUse` hook
is the only instrument that can.

**Why it ships in the plugin:** `hooks=` is an SDK argument the hosted control
plane can set and Cowork cannot be made to. A plugin-shipped `hooks/hooks.json`
binds in **both** — verified live in Cowork 2026-07-30. Cowork runs
`permission_mode: "default"`, the hosted path `bypassPermissions`; a hook binds
under both.

Two behaviors of the script that are deliberate:

- It is **stdlib-only and never raises.** Every failure path — unparseable
  stdin, missing fields — falls through to **allowing** the call, because an
  exception here would fail a tool call the user was entitled to make.
- **The `Bash` route is deliberately open.** The guard matches on `file_path`, so
  `cat >`, `sed -i`, and `python -c` all get through. Pattern-matching command
  text would false-deny a legitimate `python script.py research.json > out` while
  still missing a variable-built path, and **a false deny is the worse failure
  mode**. The rationale lives in `guardrail-enforcement-spec.md` §6 ("`Bash` is
  not covered"), to be revisited only if a bypass ever uses the shell.

Packaging is guarded: `package-plugin.mjs`'s `INCLUDE` must carry `"hooks"`, or
the directory never ships. Asserted by `tests/packaging/plugin-hooks.test.ts`,
which runs the real script.

**Three sibling implementations exist**, and **no test asserts they agree:**

- `packages/engine/plugin/hooks/guard_project_files.py` — ships in the VM
  (Cowork + hosted)
- `apps/server/app/agent/real_agent.py` — the hosted SDK hook
- `eval/harness/e2e/orchestrator.py` — the e2e harness's own hook

The unit harness stages **no** plugin hooks at all.

`guardrail-enforcement-spec.md` **§6** is the authority on this guardrail; **§4**
is the table of every guardrail's instrument, binding environment, and
enforcing-vs-shadow status.

> **Direction (#911).** Discriminating by *caller* is a hook's job, and the hook
> layer already does it once: `eval/harness/harness/context_policy.py` denies
> `image_read` when `agent_id` is absent. **The per-context policy design exists —
> don't re-derive it.** What is missing is a production port, gated on
> calibrating the shadow window first.

### If you're asked to…

**Give an agent a new tool.** Add it to `tools:` under **both** spellings. Then:

- **A `tools:` entry grants a capability; it does not create a behavior.** The
  agent will not call a tool its body never tells it to call. `record-extractor`
  has held `place_search` and `place_search_all` since #650 (2026-07-12), under
  both spellings since #742 (07-18), while its body tells it to *omit*
  `standard_place` (`record-extractor.md:361`) — dead grants that every lint
  passes. **Every tool addition is two edits: the frontmatter, and the
  instruction in the body that makes the call happen.**
- `tests/packaging/agent-tool-names.test.ts` checks the spelling and cannot see
  the body. **Nothing checks that the tool actually binds at runtime** (§9.4);
  `make agent-smoke` is the closest instrument and it verifies name resolution,
  not binding.
- **Rebuild only where it matters.** The unit harness and Claude Code read your
  working tree — no rebuild. Cowork runs the uploaded `.zip`: `make plugin`, then
  **remove the old plugin before uploading the new one** (Cowork tab, not the
  Code tab — separate plugin lists), then fully quit and reopen Claude Desktop.
  Full table: `docs/skill-lifecycle.md` → "Rebuilding and reinstalling", which
  opens by calling this "the single most common way to spend an hour testing a
  fix that was never loaded."

**Restrain something.** Pick the layer by *who* you are restraining: a subagent →
its `disallowedTools:` (both spellings) or a narrowed tool (§5.3); the main
thread → a `PreToolUse` hook (§5.4); a cross-turn invariant → the tool contract
(§3.1). **An allow-list can never restrain the main thread** — it can only
subtract from what the session already holds. Record the new guardrail's
instrument and its enforcing-vs-shadow status in
`guardrail-enforcement-spec.md` **§4**.

**Change `PROTECTED_PROJECT_FILES`.** Change **all three**:
`packages/engine/plugin/hooks/guard_project_files.py:36`,
`apps/server/app/agent/real_agent.py:130`, and
`eval/harness/e2e/orchestrator.py:175`. **No test will tell you that you missed
one.**

**Add a hook.** Register the matcher in `packages/engine/plugin/hooks/hooks.json`
— that is the step that matters. (`INCLUDE` in `package-plugin.mjs` already
carries `"hooks"`, so the directory ships; a script not named in `hooks.json`
does not run.) The script is stdlib-only Python, no network, and **must never
raise** — every failure path falls through to allowing the call. Model it on
`guard_project_files.py` and extend `tests/packaging/plugin-hooks.test.ts`, which
runs the real script.

> A plugin hook binds in Cowork and the hosted path and in **neither harness**.
> All three of the unit harness, the e2e harness, and the hosted control plane
> pass their *own* `hooks=` — and the unit harness's carries no protected-file
> rule at all. If the guardrail must hold in an e2e run or in production, port it
> there too, and expect the same three-copy divergence problem flagged above for
> `PROTECTED_PROJECT_FILES`.

---

## 6. State

### 6.1 Three persisted locations, all in the project folder

**There is no host-side store.** Cowork sessions are ephemeral; only the project
folder persists. There is no `~/.cowork-genealogy/` to write to.

| Location | What |
|---|---|
| `research.json` | the research document — questions, plans, log, assertions, conflicts, proofs, researcher profile |
| `tree.gedcomx.json` | the simplified GedcomX tree |
| `results/<log_id>.json` | search-result sidecars — raw payloads kept out of `research.json` so the co-edited file stays lean |

The two documents and the sidecars are **written by different mechanisms**, and
conflating them is the easy mistake. The documents go through validating writer
tools called by the model. A **sidecar is staged host-side by the search tool
that produced it** — `record_search`, `fulltext_search`, and
`external_links_search` write their payload into `results/.staging/` and return a
handle plus a **reduced** inline copy, which `research_log_append` later
finalizes. The reduction differs by tool: `record_search` drops `gedcomx`,
`collectionUrl`, and empty `treeMatches`, hoists `collectionTitle` into a
response-level map, and de-duplicates `events`; `fulltext_search` drops
`textDocument`; both leave
name/date/place stubs for triage. `external_links_search` reduces differently —
it caps the *number* of inline rows and leaves each row intact, because its
payload is curated third-party URLs with nothing to triage on. **The full payload travels
search tool → disk → log-append and never round-trips through the model**
(`search-result-staging-spec.md`).

### 6.2 Writes go only through validating writer tools

`research_append` (and its lane-scoped variant `extraction_append`, §5.3),
`research_log_append`, `tree_edit`, `tree_correct`, `merge_tree_persons`,
`tree_forget`, and `materialize_facts` each **validate the whole project in
memory and write nothing on failure.** The tools assign all ids; callers never
predict them.

`validate_research_schema` is a read-only check for files touched *outside* the
writer tools. Defensive validate passes between writer-tool steps are explicitly
**redundant**. The §5.4 hook backs this rule mechanically.

### 6.3 Reads are projections, never whole-file `Read`s

Two read-side tools exist so the model never re-ingests a monotonically growing
JSON document to answer a small question:

- **`project_context`** — a compact orientation snapshot for fresh-context agents.
- **`research_query`** — filtered section reads, for routing and review.

The principle, from `project-context-tool-spec.md`: the writer tools removed
"re-serialize large JSON to write"; the projection tools remove "re-read large
JSON to think." **Never design a flow that hands the LLM a large document to
edit and re-emit.**

> **Today:** `research_query` returns 50 items per call with a `truncated` flag
> and an `offset` parameter for paging past 50 (#1031 tool half), and covers
> **11 of the 15** `research.json` sections — missing `project`,
> `researcher_profile`, `known_holdings`, and `localities`. On the tree side,
> `project_context` returns a fixed projection of tree persons (id, name, gender,
> sourceRefs), but there is **no query surface over `tree.gedcomx.json`** the way
> `research_query` gives one over `research.json` — which is why `Read` is not
> revoked.
> **Direction (#1031, critique §2.9, §3 P2).** The tool half shipped: `offset`
> makes items 51+ reachable, closing the "no way to fetch past 50" correctness bug
> at the tool. What remains is the **skill half (#1183)** — the consumers must
> actually page. `proof-conclusion/SKILL.md` still says "no offset/pagination
> guessing," so its "collect every assertion" gate can under-read (it once saw 50
> of 57) until that line is rewritten. **If you consume `research_query`, check the
> `truncated` flag and page with `offset`** — a skill already ignored truncation
> once. `Read` is still the most-called tool in the system (544 calls across 28
> runs, against 246 `research_query` + 91 `project_context`).

### 6.4 The casing seam

Two conventions, split on a deliberate line — **not an inconsistency to fix.**
*(Imperative owned by `CLAUDE.md` § "Identifier casing".)*

- **API/wire surfaces are camelCase.** MCP tool parameters (`birthPlace`,
  `personId`), `~/.familysearch-mcp/config.json` keys, and the upstream **full**
  GedcomX from FamilySearch.
- **Persisted project documents are snake_case.** `research.json` and the
  **simplified** GedcomX (`assertion_id`, `couple_relationship`).

The MCP tool boundary is the seam, and it is exactly where every payload is
validated — input schemas on the way in, `validate_research_schema` with
`additionalProperties: false` (plus the closed per-object field allow-lists in
`src/validation/tree-shape.ts`) on the persisted side. **That strict validation
is what makes the split safe:** a casing slip fails loudly instead of silently
corrupting state. `src/utils/gedcomx-convert.ts` pays the rename cost once, in
tested code behind a spec.

The thing to avoid is mixing both conventions **within a single co-edited
document** — never mixing them across the repo, which is intentional.

### 6.5 State reaches the prompt too

26 of the 27 skills open with a `**Narration:**` line instructing Claude to read
`researcher_profile.narration_guidance` from `research.json` and apply it as that
invocation's narration style. `init-project` writes the profile from two
questions it answers from the opening message or from defaults — it **never
blocks** waiting for them.

It exists because of the same constraint as §3.3: with no plugin-level
`CLAUDE.md` auto-load and no shared reference loading, a cross-cutting
instruction has nowhere to live but each `SKILL.md`. So the *instruction* is
duplicated and the *value* it reads is centralized in project state.

### If you're asked to…

**Add a field or section to `research.json`.** Ten sites in the shipping product
— and **four of them are checked by nothing.** *(Unprefixed paths are under
`packages/engine/mcp-server/`. The eval CRUD UI carries a parallel scenario
viewer, `eval/app/components/scenario/`, that a field change also touches; it is
outside this list and outside every check.)*

| # | Site | What catches a miss |
|---|---|---|
| 1 | `docs/specs/schemas/research.schema.json` | `make engine-test` |
| 2 | the prose table in `docs/specs/research-schema-spec.md` | **nothing** |
| 3 | `src/validation/validator.ts` `RESEARCH_SHAPES` (hand-maintained — it does **not** load the JSON Schema) | `make engine-test` |
| 4 | `packages/schema/schemas/research.schema.json` | **`make harness-test`** only |
| 5 | `packages/schema/src/index.ts` — the TS `interface` | **nothing — and it has already drifted** (`Assertion` is missing `standard_place`) |
| 6 | `src/tools/research-append-examples.ts` — the worked-example registry | round-trip validity only |
| 7 | `packages/viewer-ui/src/components/sections/<X>Section.tsx` (+ `.module.css`) | **nothing** |
| 8 | the `SKILL.md` of whichever skill must populate it | **nothing** |
| 9 | *(required only)* `eval/fixtures/scenarios/*/research.json` + the eval Python stubs | eval suites fail until backfilled |
| 10 | *(required only)* `packages/viewer-ui/src/lib/__fixtures__/` | `make typecheck` |

Two things the site list alone won't tell you:

- **Sites 6, 7, and 8 are the "did this field ever become real" set** — 6 teaches
  the model the shape, 8 tells a skill to write it, 7 shows it to the researcher
  in both the Electron viewer and the web workbench. Only site 6 is checked at
  all, and only for round-trip validity — **nothing checks that 7 or 8 exist.** A
  change touching only 1–5 is a schema change, not a feature.
- **Run `make engine-test`, `make harness-test`, *and* `make typecheck`.** Only
  the second catches the `packages/schema` mirror, and only the third catches the
  viewer — and §9.1 files both under other headings, so they are easy to skip.

**Add a value to a closed enum** (e.g. `evidence_type`, `proof_tier`). The enum
lives in `enums.schema.json` (`$defs`), **not** `research.schema.json` (which
only `$ref`s it). Edit `enums.schema.json` in **both** schema trees, the TS union
in `packages/schema/src/index.ts`, `CLOSED_ENUMS` in `validator.ts`, and the
prose tables. `tests/packaging/enum-drift.test.ts` checks prose against the
schema.

> **Direction (critique §2.7, §3 P2; #1087/#1015/#1014).** These are **four-plus
> hand-maintained copies of one source**, and the mirrors are slated to be
> generated from `packages/schema` — which deletes the three-case table from
> `CLAUDE.md`. **Don't add a fifth copy.** If your change would, say so in the PR.

**Add a field to the tree (simplified GedcomX).** Everything above, **plus** the
closed per-object field allow-lists in `src/validation/tree-shape.ts`. The
validator enforces `additionalProperties: false` from those sets, so an unlisted
field makes **every writer tool reject the write.** Check whether the change
needs a heal rule in `tree-sanitize.ts` for pre-change trees.

---

## 7. The hosted web workbench

A second product: the same research engine, driven from a browser instead of
Cowork. Local-run recipes are in `DEVELOPMENT.md` ("Running the hosted web
workbench locally"); this section is the shape.

### 7.1 The pieces

| Package | What |
|---|---|
| `packages/schema` | **single source** of `research.json` + simplified-GedcomX TS types and JSON Schemas. Consumed by viewer-ui, web, and server. Mirrors the engine's schemas (§6.4). |
| `packages/viewer-ui` | the extracted renderer — App, **13 sections**, shared components, `ResearchDataProvider`. **Transport-agnostic** via a `ResearchTransport` interface (`src/transport.ts`). |
| `apps/electron` | the desktop viewer, consuming `viewer-ui` over an **IPC** transport. |
| `apps/web` | React + Vite client: login, session list, chat sidebar, and the shared viewer over a **WebSocket + REST** transport. |
| `apps/server` | the **FastAPI control plane** (Python/uv): auth + allowlist, session/sandbox orchestration behind a vendor-neutral `SandboxProvider`, and `app/agent/` (the in-sandbox `agent_runner`, mock + real). |

**The `ResearchTransport` seam is the reuse mechanism.** The provider talks only
to that interface — never to `window.api` or a socket directly — which is what
lets the same viewer run in Electron and in the browser. **Build shared workspace
features in `packages/viewer-ui`;** only chat and session-management chrome stays
in `apps/web`.

> The count is **13**. `CLAUDE.md` said 11 until 2026-08-02, when it was
> corrected; `hosted-web-workbench-spec.md` and `docs/plan/3-pane-workbench-ui.md`
> still carry 11 in places, but only where it is the historically correct count
> for the date they describe, and each says so at the site.

### 7.2 The sandbox is the per-session server

The decision that shapes this half: production runs on **AWS behind a load
balancer with no session stickiness.** With more than one control-plane instance
and no affinity, `/connect` can land on instance A and the next `/message` on
instance B, spawning a **second agent for the same session** — two agents writing
one project.

The resolution is to put the single per-session pump where there is exactly one
of it: **the sandbox itself.** The browser opens one authenticated WSS **directly
to the E2B sandbox**; the control plane is out of the streaming path entirely.

```
/connect  →  provider.resume(sandbox) + expose_port(8080) + mint_token(sandbox_id)
          →  { wssUrl, token }
browser   →  wss://{port}-{id}.e2b.app/?token=…
sandbox   →  verifies token → spawns agent_runner → streams agent_event + /project deltas
```

The control plane does auth, `/connect`, and file reads (`/state`, `/logs`,
sidecar, feedback) — **never the stream.** `SandboxProvider` (`app/sandbox/`) has
a `LocalProvider` for local dev and an `E2BProvider` for the hosted path
(`make server-e2b`, and the Fly deploy, run `SANDBOX_PROVIDER=e2b`).

An **earlier direction using Ably** as a broker was evaluated and dropped —
E2B's persistence model (`lifecycle: {onTimeout: 'pause'}`, preserving
filesystem, memory, and running processes) made the broker, the presence webhook,
and the idle-suspend reaper unnecessary. `docs/realtime-architecture.md` carries
the full analysis and is the closest thing this repo has to an ADR today.

### 7.3 What is built, and what is not

**Verified on `main` 2026-08-02:** the in-sandbox WS server
(`app/sandbox_server.py`), the E2B image, and the direct-WSS wiring all exist and
match the flow above. No Ably code remains in `apps/server/app` (one comment
reference in `sandbox/e2b.py`), and there is no idle-suspend loop.

**Known gaps**, from `docs/realtime-rearch-status.md`:

- FamilySearch tokens are not auto-injected into E2B — dev/real connect writes them.
- `wiki_read` / `wiki_place_page` need the pre-crawled markdown corpus baked into
  the image; it is not baked, so those two tools error there.
- E2B Hobby has a **1-hour hard continuous-session cap** that force-pauses even
  an active session (resume ~1s; a mid-turn pause breaks that turn).
- The **delete-janitor** for abandoned sandboxes is unimplemented — paused
  sandboxes are never reclaimed. *Compute* is gated: `WsSessionConnection`
  suspends reconnects while the tab is hidden, precisely so a backgrounded tab
  cannot silently resume a paused sandbox. What retained sandboxes cost while
  paused is a vendor billing question this repo does not answer.
- `ws_signing_key` defaults to a dev value; production needs a real one.

> **Both source docs were corrected 2026-08-02.** `docs/realtime-architecture.md`
> and `docs/realtime-rearch-status.md` used to carry a
> `**Branch:** hosted-web-workbench` line (the code is on `main`), and the status
> doc used to list the "C5 cleanup" (Ably backends, the old relay, the
> idle-suspend loop) as **still present** when it was already done. Both now say
> so. The one real remnant: `ably>=3.1.2` is still a declared dependency in
> `apps/server/pyproject.toml` with nothing importing it. **Still read those two
> docs for the reasoning, not as the current-state reference — this guide is.**

### If you're asked to…

**Add a viewer feature.** Build it in `packages/viewer-ui` unless it is chat or
session-management chrome. Reach state through `ResearchTransport`, never a
socket or `window.api` — otherwise it works in one app and silently breaks the
other. Both `apps/electron` and `apps/web` must still typecheck (`make typecheck`).

**Change anything the sandbox runs.** `make server-e2b` does **not** rebuild the
engine — the `genealogy-agent` image bakes its own. After changing
`app/sandbox_server.py` or `app/agent/*`, run `make sandbox-image` or the microVM
runs stale code.

**Add a control-plane endpoint.** `apps/server/app/v1.py` for the public REST
API (see `DEVELOPMENT.md` "Public `/v1` REST API"), `sessions.py` for session
lifecycle. Run `make server-test`. Keep the control plane out of the streaming
path.

---

## 8. Environments — who loads what

Four environments run the engine, and they load the plugin differently.

| Environment | Skills | Agents | Hooks | MCP server |
|---|---|---|---|---|
| **Cowork** | loaded as a plugin | plugin — bare `@plugin:` names resolve | **plugin's** | host `.mcpb` via the remote-device bridge |
| **Hosted control plane** (`app/agent/real_agent.py`) | `plugins=[{"type": "local", …}]` | **staged** into `<project>/.claude/agents/` | plugin's **+ its own `hooks=`** | own stdio registration under `genealogy` |
| **Unit harness** (`eval/harness/harness/workspace.py`) | staged into `.claude/skills/` | staged into `.claude/agents/` | **its own `hooks=`** — no plugin hooks, and **no write-lockdown rule at all** | mock server under `genealogy` |
| **E2e harness** (`eval/harness/e2e/orchestrator.py`) | staged | staged | **its own `hooks=`** | live server under `genealogy` |

**The hosted path does both** plugin-loading and agent-staging, and that is not
redundancy. SDK plugin loading registers agents **only** under the namespaced
name `genealogy-research:<agent>`, while every SKILL.md delegates by the **bare**
name. Without the staging, the `Task` call errors and the model **silently falls
back to a general-purpose stand-in that binds none of the agent's `tools:` or
`disallowedTools:`** (#939). Skills are unaffected — the loader registers those
under bare names.

Both harnesses load the staged files via `setting_sources=["project"]`.

Other environment differences that bite:

- **Permission mode.** Cowork runs `permission_mode: "default"`; the hosted path
  runs `bypassPermissions` — which is why denies and hooks matter more than
  allow-lists (§5).
- **The unit harness's baseline grants `Write`/`Edit` to every skill**, and while
  it does install its own `PreToolUse` hook (`Skill` tracking, the `image_read`
  context policy, call limits), that hook carries **no protected-file rule** — so
  §5.4's raw-write class is entirely ungated at call time there.
- **Tool deferral.** Cowork defers tool schemas above a size threshold and offers
  no control over it, so `ToolSearch` is the real load path there (§5.2).

### If you're asked to…

**Change how the hosted agent session is configured.** Run **`make agent-smoke`**.
It is the only check that reads what the hosted runtime actually *resolved* — the
SDK init handshake's agent list, no model call, bills nothing — and **no CI job
runs it.** It needs `ANTHROPIC_API_KEY` or an `eval/.env` entry; **without one it
skips silently**, which looks identical to passing.

---

## 9. Verification — how you know you didn't break it

### 9.1 What to run

| Command | Covers | **Does not cover** |
|---|---|---|
| **`make test-all`** (= `scripts/test.sh`) | **everything**: typecheck, JS workspace, `apps/server`, engine + packaging lints, CRUD UI, eval harness **including** the e2e-marked contract test. The target delegates to the script, so the two are one command; the PR template names it. Runs every suite before reporting, so one failure doesn't hide the next. | a live-API check of any single tool (`dev/try-<tool>.ts`), agent tool binding (`make agent-smoke`), skill behaviour (`make eval-skill`) |
| `make test` | JS workspace + server tests | **engine, packaging lints, harness** — an engine-only change gets *zero* coverage |
| `make engine-test` | `packages/engine/mcp-server` (vitest) + all packaging lints | the `packages/schema` mirror; anything needing a live API |
| `make harness-test` | `eval/harness` (pytest, excludes e2e) — **the sole gate on the `packages/schema` mirror** | engine unit tests, though it *does* execute the compiled `build/` — a broken engine fails here wearing the costume of a harness bug |
| `make typecheck` | the whole JS workspace (turbo) — the only gate on viewer code | Python |
| `make server-test` | `apps/server` (FastAPI, pytest) | the in-sandbox path on real E2B |
| **`make agent-smoke`** | that the hosted path resolves plugin agents under bare names | whether a granted tool actually **binds**; skips silently with no API key |
| `make eval-skill SKILL=<name>` | one skill's unit suite against mocked MCP fixtures | multi-turn decay — it grades a single invocation in fresh context |
| `make e2e-run TEST=<fixture>` | one fixture against **live FamilySearch**. Across all 111 committed costed runs: ~$7 median, $3–25 typical, 20–180 min (two outliers below $3, floor $0.06 — those are runs that died early) | everything outside that fixture. A capped or timed-out run is the expensive tail, not an exception — and most timed-out runs record *no* cost, so the mean is a floor. (`Makefile` says "~20-60 min, $3-10" over a narrower window.) |

### 9.2 The lint layer

Drift is CI-enforced, not conventional. In `packages/engine/mcp-server/tests/packaging/`:

| Test | Asserts |
|---|---|
| `manifest.test.ts` | `manifest.json`'s `tools` ↔ `allToolSchemas` — **not** the dispatch |
| `agent-tool-names.test.ts` | dual-spelling; derives the bridge prefix from `display_name`; all five registration sites agree on `genealogy`; no `select:mcp__…` in any plugin body |
| `plugin-hooks.test.ts` | `INCLUDE` carries `"hooks"`; runs the real guard script |
| `skill-description-length.test.ts` | the 1024-char cap |
| `skill-guidance.test.ts` | 8 `places-guidance.md` copies byte-identical to the canonical |
| `enum-drift.test.ts` | prose enum tables ↔ `enums.schema.json` |
| `adr-links.test.ts` | ADR required fields; every repo path cited in an ADR's **live** `Applies to` / `Enforcement` still resolves (the frozen-history sections are exempt) |
| `doc-links.test.ts` | every repo path, markdown link and `make` target cited by `docs/task-lifecycle.md` and by **`.claude/{agents,commands,skills}`** still resolves. These have no frozen-history half — every line is an instruction a model acts on. Shares its extraction rules with `adr-links.test.ts` via `repo-paths.ts` |

Plus, from `.github/workflows/check-runlogs.yml`:
`check_skill_frontmatter.py` (for **skills and agents**: description length and
angle brackets on the folded value, plus `name` — kebab-case, ≤64 chars, matching
the directory or file stem — also run by the packaging script),
`check_runlogs.py` (the blocking run-log/annotation gate on any skill change,
§3), and two **warn-only** lints
worth knowing because they fire right after the two most common tasks:
`check_tool_coverage.py` (a skill declares a tool with no fixture in its corpus —
what happens after you add a tool) and `check_rubric_tool_drift.py` (a tool named
in a rubric, `judge_context`, or an **agent body** that isn't in its declared
tools — what happens after you grant one). And
`eval/harness/tests/unit/test_schema_mirrors.py` for the `packages/schema` mirror.

### 9.3 The two eval tiers

- **Unit** (`eval/tests/unit/<skill>/`) — mocked MCP fixtures, a per-skill
  `rubric.md`, a deterministic validator per skill, an LLM judge, snapshot-hashed
  run logs, and 82 negative routing tests. 373 committed test definitions; across
  the 25 live suites the latest run logs total **372 rows, 339 passing (91%)**.
- **E2e** (`eval/tests/e2e/<fixture>/`) — live FamilySearch, 105 fixtures, blind
  human `.ann.json` annotations, and `calibrate_judge` measuring judge-vs-human
  agreement **offline** rather than inferring it from expensive live runs. Three
  axes since #1050: `verdict` (genealogical), `compliance` (guardrail), and
  `outcome` (the gate) — so a run whose answer is right but whose audit trail was
  not earned **fails**.

### 9.4 What nothing checks

**Read this before you trust a green CI run.**

| Gap | Consequence | Tracking |
|---|---|---|
| **No check proves a declared agent tool actually *binds* at runtime.** Every lint stops at spelling; the SDK handshake exposes only name/description/model. | `gps-mentor` read `research.json` front-to-back for 112 of 178 reads across 24 runs because its `tools:` — correct by every lint — lacked the projection tools. (Since granted; **the missing check is not**.) | #1084/#1085 |
| **Nothing asserts an MCP tool's dispatch exists.** | A tool ships advertised and throws `Unknown tool` on first call, CI green. | #1164 |
| **Nothing checks a `packages/schema` TypeScript interface against its JSON Schema.** | It had already drifted twice — `Assertion` and `TimelineEvent` were both missing `standard_place` (fixed in #1173; the missing *check* is not). | #1165 |
| **Nothing checks that a new `research.json` field is rendered, taught, or written** (sites 6–8 in §6). | The field validates and is never used by anything. | #1166 |
| **No test asserts the three write-lockdown copies agree.** | The next `PROTECTED_PROJECT_FILES` change can silently re-open the divergence. | critique §3 P3 |
| **No automated suite exercises a plugin hook *as a bound runtime hook*.** `plugin-hooks.test.ts` runs the guard script directly and asserts its decisions; nothing checks that Cowork or the hosted path actually route a `Write` through it. And the unit harness's own hook carries no protected-file rule at all, so the write lockdown is absent from that tier in either form. | A binding regression surfaces only in Cowork, which no CI job touches. | #1160 |
| **No unit suite for `research`** (the orchestrator) or `forget-and-rederive`. | The component that fails most is exercised only by live e2e. | critique §3 P1 |
| **`validation-protocol.md` (12 copies, 10 distinct) and `research-log-protocol.md` (3 copies, 3 distinct) are unlinted** and already drifted. | Nothing records which divergences are deliberate. | #1112 |
| **The `places-guidance.md` exemption is existence-only.** | A regression inside `research-plan`'s copy passes silently. | #1112 |
| **Nothing checks `README.md`'s tool/skill catalog** against the code. | Already rotted: **13 of 47 tools appear nowhere in it** — the entire structured-persistence writer surface plus both projection tools. Skills and agents are clean (27/27, 4/4). | #1137 |
| **No unit-side judge calibration.** `calibrate_judge` is e2e-only. | The unit judge's accuracy is unmeasured. | critique §2.8 |
| **No production telemetry.** `apps/server/app/obs.py` is PII-free stdout logging; `sandbox_server.py` keeps a capped in-memory *replay* buffer for reconnects, not a tool ledger. Every compliance rate, cost figure, and guardrail measurement in this repo is computed over `eval/runlogs/`. | You cannot answer "is this getting better for a real user?" | #1054 |
| **The compliance detectors are uncalibrated.** Three open defects, two unnamed false-positive classes, one false-negative blind spot. `is_error` is never populated, so a *failed* `Skill` call counts as a success. | **Do not quote the 8-of-25 violation rate without that caveat**, and do not graduate a gate on it. | #998, #999, #1006 |
| **No prompt-injection doctrine exists anywhere.** A grep of the whole plugin and MCP source returns **zero hits**, while untrusted free text reaches an agent holding `research_append` via `image_transcribe` OCR, `fulltext_search`, and every record the extractor reads. | Unmitigated, unmeasured. | #847 |
| **Nothing treats "the writer tools are absent" as a halt condition.** | Three runs once made zero MCP calls, wrote `research.json` raw 33 times, and burned their full budget. The raw-write path is closed since #984/#989; the silent failure is not. | #941 |
| **A `Skill()` callee can bind toolless** in the unit-harness path. | A delegated skill runs with zero tools. | #1012 |

### If you're asked to…

**Verify a change.** Match the instrument to the layer: a tool → `make engine-test`
plus `dev/try-<tool>.ts` against the live API; a schema field → `make engine-test`,
`make harness-test`, **and** `make typecheck`; a skill body → `make eval-skill`
plus the annotation gate (§3); routing or anything cross-skill → a live
`make e2e-run`, named in the PR; hosted agent config → `make agent-smoke`. Then
run `make test-all`, which the PR template requires. **If the thing you changed
appears in §9.4, say so in the PR** rather than implying CI covered you.

**Debug a failing e2e run.** Check the two setup gates first — `make e2e-preflight`
and `make e2e-login` (the FS token lasts ~24h, and its absence looks exactly like
an agent failure). Then `make e2e-view TEST=<slug>` loads the run into the viewer,
`make e2e-corpus` gives three-axis totals across every committed run, and the
`/interpret-e2e-result` skill exists to read the log for you. Mechanics:
`docs/e2e-testing-guide.md`. Before concluding the agent regressed, rule out the
four other causes: an eval defect, FamilySearch data drift, single-run jitter, and
a sub-skill regression rather than a routing one.

**Add or change a unit eval test.** `docs/specs/unit-test-spec-v2.md` is the
format; `eval/README.md` is the workflow; `eval/tests/unit/<skill>/` is where it
lives. A test is not just its definition: it usually needs a matching
`eval/fixtures/mcp/` response, a dimension in that skill's `rubric.md`, and a
check in `eval/harness/validators/`. `test.id` must be unique across the **whole**
corpus — a duplicate is a blocking CI failure — and `runs_per_test` is pinned to
1 by policy. 82 of the 373 definitions are **negative** tests that exist to prove
a skill does *not* trigger; add one whenever you widen a description.

**Write or update a spec.** `docs/specs/<tool>-tool-spec.md`, landed **before**
the tool. A spec is checkable when it states, per behavior: the exact input
shape, the exact output shape, and the error case *with its message text* — a reviewer has to be able to
quote both sides, so anything written as narrative rather than as a contract
cannot be cited against the code. Copy the shape of a recent one
(`docs/specs/project-context-tool-spec.md` is a good model).

---

## 10. Open questions

Things that are genuinely unsettled, as distinct from §9.4's missing guards.

1. **The `same_person` write-boundary gate** — direction settled, mechanism not;
   three discriminators have failed review. Details and the "don't re-derive"
   ledger: §5.3, and critique §3 P0 + §9.
2. **Whether the compliance-detector doctrine should follow the router's
   paraphrase or the owning skill's contract** (#1006). Until that is decided,
   "true or false positive" has no ground truth at all (critique §3 P0). **Do not
   quote "16 of 25" as the gate's *reach*** — critique §9 retracts that reading.
   16 is the count of violations one arm produced; the corrected reach is ≤9 of
   25 (≤14 of 45 on the full committed window). Note the critique carries two
   windows and two disjoint "9 of 25" figures — read its §0.2 before quoting
   either.
3. **Why the 1024-character description cap exists** — two lint sites give
   contradictory reasons (§3.2). Treat it as hard either way.
4. **`ENABLE_TOOL_SEARCH`** (#1110) — the polarity is settled as of 2026-08-02
   (§5.2) and all five inverted comments have been corrected. What remains is
   the **flip itself**, which changes behavior in both harnesses and the hosted
   path and requires re-measuring the tool mix before and after.

*(`research_query` pagination past 50 items — #1031 — has left this list: the
API shape is settled and the tool half shipped `offset`; the remaining skill
adoption is tracked work, #1183, not an open question. See §6.3.)*

---

## 11. Doc map — what is authoritative for what

| Question | Read |
|---|---|
| What is genealogical research, and what are all these words? | [`docs/gps-research-flow.md`](gps-research-flow.md) — **read this first** |
| How does a task get from issue to merge? | [`docs/task-lifecycle.md`](task-lifecycle.md) — the developer process (plan → attack → implement → verify → review). §0 "First day" above is the setup that precedes it. For skill-prose work, [`docs/skill-lifecycle.md`](skill-lifecycle.md) instead. |
| How do I build / run / test / deploy? | [`DEVELOPMENT.md`](../DEVELOPMENT.md) |
| What rule must I follow to make a correct change? | [`CLAUDE.md`](../CLAUDE.md) — the operating manual, auto-loaded every session |
| What does tool X do? | `docs/specs/<tool>-tool-spec.md` — **wins over this guide on conflict** |
| What tools / skills / agents exist, for a user? | [`README.md`](../README.md) |
| Why is it built this way? | [`docs/adrs/`](adrs/) — one decision per file, with the alternatives that were tried and rejected. Index in §0. For decisions with no ADR yet, the linked spec or [`docs/agentic-system-critique.md`](agentic-system-critique.md). |
| What is wrong with it, and what's next? | [`docs/agentic-system-critique.md`](agentic-system-critique.md) |
| Every guardrail, its instrument, its status | [`guardrail-enforcement-spec.md`](specs/guardrail-enforcement-spec.md) |
| The write boundary and the `extraction_append` lane | [`research-append-tool-spec.md`](specs/research-append-tool-spec.md) §11 |
| The persisted schemas | [`research-schema-spec.md`](specs/research-schema-spec.md), [`simplified-gedcomx-spec.md`](specs/simplified-gedcomx-spec.md) |
| The projection tools | [`project-context-tool-spec.md`](specs/project-context-tool-spec.md), [`research-query-tool-spec.md`](specs/research-query-tool-spec.md) |
| Per-agent contracts | [`gps-mentor-agent-spec.md`](specs/gps-mentor-agent-spec.md), [`image-reader-agent-spec.md`](specs/image-reader-agent-spec.md), [`image-reader-opus-agent-spec.md`](specs/image-reader-opus-agent-spec.md) (`record-extractor` has no standalone spec — its lane is `research-append-tool-spec.md` §11) |
| How do I write a skill? How does it get tuned, tested, and rebuilt? | [`skill-authoring-guide.md`](skill-authoring-guide.md), [`skill-lifecycle.md`](skill-lifecycle.md) |
| The eval harness — formats, workflow, run logs, CI rules | [`unit-test-spec-v2.md`](specs/unit-test-spec-v2.md), [`e2e-test-spec.md`](specs/e2e-test-spec.md), [`e2e-testing-guide.md`](e2e-testing-guide.md), `eval/README.md`, `eval/CLAUDE.md` |
| Setup paths the harness can't reach | `docs/testing-guides/` — OAuth tokens, `.mcpb` install, gps-mentor |
| A user submitted a feedback zip | [`alpha-feedback-guide.md`](alpha-feedback-guide.md), then [`feedback-case-spec.md`](specs/feedback-case-spec.md) |
| The hosted web product | [`hosted-web-workbench-spec.md`](specs/hosted-web-workbench-spec.md), [`sandbox-provider-spec.md`](specs/sandbox-provider-spec.md), [`realtime-architecture.md`](realtime-architecture.md) (reasoning, not current state) |
| I'm a genealogist, not a developer | `eval/JUNIOR-WALKTHROUGH.md`, `eval/SENIOR-WALKTHROUGH.md` |
| What work is queued but not yet started? | The **Backlog column** on the project board. The repo's staging queue was retired 2026-08-02 (#1163) — its 54 items became issues #1117–#1157. Deferred work goes straight to an issue; there is no staging file. |
