# ADR-0002: Decompose into MCP tools, skills, and plugin agents by what each needs

> **Read before you:** add any new capability and wonder where it goes · decide
> between a skill and a subagent · consider adding a tool for something the model
> could just do · review a PR that puts judgment in a tool or an invariant in
> prose.

- **Status:** Accepted
- **Decided:** 2026-07-12 (the three-way split reached its current shape with the `record-extractor` agent, #650)
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/mcp-server/src/tools`, `packages/engine/plugin/skills`, `packages/engine/plugin/agents`
- **Related:** ADR-0001, ADR-0003, ADR-0006, `docs/architecture.md` §3

## Context

ADR-0001 splits the system by *where code can run*. That leaves a second
question it does not answer: within the VM half, what belongs in a skill body
and what belongs somewhere else?

Three pressures push in different directions.

**Context is the scarce resource.** Every skill `description` is resident in the
orchestrator's context on every turn. Every tool schema costs tokens. Plugin
markdown is already 912 KB, of which skill bodies are 7,730 lines. Anything that
grows without bound eventually evicts something that matters — and when a skill
body is evicted by compaction, the rules in it stop being followed (ADR-0003).

**Some work must not inherit the session's state.** Record extraction reads an
unfamiliar document and classifies it. Doing that in the main thread means the
extraction sees — and can be steered by — everything the session has already
concluded, which is exactly how a researcher talks themselves into a match.

**Some rules must not be arguable.** A boundary enforced by prose can be
prompted past. This was observed, not theorised: a delegation message pushed the
extractor outside its stated lane and it fabricated a match score.

## Decision

**Three kinds of component, each chosen by what the work needs:**

| Component | Where | Chosen when the work needs… |
|---|---|---|
| **MCP tool** | host | the network, or an invariant that must hold against any caller |
| **Skill** | VM, session context | judgment that depends on what the session already knows |
| **Plugin agent** | VM, **fresh context** | isolation from session state, a narrowed capability set, or a different model |

Today that is 47 tools, 27 skills, and 4 agents.

The dividing line between a skill and an agent is **not** size — it is whether
inheriting the conversation helps or hurts. `record-extractor` runs one agent per
record specifically so no record's extraction can see another's conclusions.
`gps-mentor` critiques a proof in fresh context so it cannot be persuaded by the
reasoning that produced it.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Two kinds only — tools and skills** (no agents) | Loses all three things agents provide: fresh context, a narrowable capability set, and per-step model routing. Model routing especially: skill `model:` pins are read only by the unit harness, so an agent is the *only* place a per-step model choice binds in production | `docs/architecture.md` §3.5; all 26 skill pins are dead lines (26 of the 27 skills carry one — `forget-and-rederive` never had one) |
| **One tool per provider/endpoint** (`familysearch_search`, `wiki_search`, …) | Tool count is context budget in every session. The generic-tool-with-a-provider-parameter shape keeps the catalog small; at 47 tools Cowork already defers the schemas past a size threshold | `CLAUDE.md` § "MCP server tools". ToolSearch measured ~11% of all tool calls — but that was measured while `ENABLE_TOOL_SEARCH` was set under an inverted reading of its polarity (#1110), so treat it as a snapshot pending re-measurement, not a stable property |
| **Put the GPS doctrine in tools** — make the tools enforce good research | Most of it is genuinely judgment. Of the orchestrator's 17 routing rows, only **6 are mechanically computable**, and those six were never the ones failing. The other 11 need an LLM | `docs/agentic-system-critique.md` §3 P2, row-by-row analysis |
| **Put the invariants in prose** — trust the skill bodies | Measured to decay. See ADR-0003 | 77% → 3% compliance after compaction |
| **Split agents further**, one per record type (a probate agent, a census agent) | Every agent body is a full prompt; N agents is N prompts to keep consistent. The per-type material is a table inside one body instead — and the attempt to externalise those tables failed measurably | Issue #702; `CLAUDE.md` § "No playbook/reference files for agents" and `docs/architecture.md` §3.4 (no ADR yet) |

## Consequences

**Gains.** Each layer can be reasoned about on its own terms: a tool has a
contract and a spec, a skill has a rubric and an eval suite, an agent has a
frontmatter capability list that CI lints. The seams are also where enforcement
lives — because a tool boundary is un-arguable, invariants that must hold across
hours can be moved there (ADR-0003), and because an agent's tool list is exact-
matched at spawn, capability can be narrowed per delegate (ADR-0006).

**Costs, knowingly accepted.**

1. **Three places to look, and the boundaries are not self-evident.** "Should
   this be a skill or an agent?" is a real question a newcomer will get wrong,
   and the answer (does inheriting session state help or hurt?) is not visible
   from the file tree.
2. **Delegation is not free.** An agent spawns with no session state, so
   everything it needs must be in its prompt or fetched through a tool. That is
   the point — but be careful attributing costs to it. `gps-mentor` read
   `research.json` front-to-back for 112 of 178 reads across 24 runs, and that
   was **not** an intrinsic cost of delegation: its `tools:` list, correct by
   every lint we have, simply lacked the projection tools (#1084/#1085, granted
   in #1082). The real cost of delegation is that a wrong capability grant is
   invisible until someone reads the runlogs.
3. **The orchestrator is a skill, so routing is prose**, and prose is the thing
   ADR-0003 says decays. This is a known tension, not a solved one — 11 of the 17
   rows genuinely cannot move.

**Risks.** The decomposition's weakest seam is that nothing verifies an agent's
declared tools actually bind at runtime — the lints stop at spelling. An agent
can be correctly declared, pass every check, and run without the capability.

## Enforcement

**Structural, not semantic — the layers are enforced; the placement judgement is not.**

> `packages/engine/mcp-server/tests/packaging/manifest.test.ts` — the advertised
> tool list matches `allToolSchemas`.
> `packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts` — agent
> capability declarations resolve in every environment.
> `packages/engine/mcp-server/tests/packaging/skill-description-length.test.ts` —
> the description budget that keeps skill count affordable.

**Nothing checks that a capability was put in the right layer.** A judgment rule
written into a tool, or an invariant left in prose, passes CI. Review is the only
guard.

## Revisit when

The skill count grows past the point where all 27 descriptions can sit in the
orchestrator's context alongside real work — at which point the routing layer
needs a different shape, and the "most utterances land on `research`" assumption
should be re-measured rather than re-asserted.
