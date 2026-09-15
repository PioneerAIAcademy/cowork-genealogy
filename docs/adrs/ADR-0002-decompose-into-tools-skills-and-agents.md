# ADR-0002: Decompose into MCP tools, skills, and plugin agents by what each needs

> **Read before you:** add any new capability and wonder where it goes · decide
> between a skill and a subagent · consider adding a tool for something the model
> could just do · decide where a step that fetches or transcribes a document
> belongs · review a PR that puts judgment in a tool or an invariant in
> prose.

- **Status:** Accepted
- **Decided:** 2026-07-12 (the three-way split reached its current shape with the `record-extractor` agent, #650)
- **Last updated:** 2026-09-11 (the front-door rule for skill–agent pairs, and
  the acquisition seam — issues #2489/#2490). Previously 2026-08-09 (ToolSearch
  share re-measured; #1110 closed)
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

Today that is 49 tools, 28 skills, and 6 agents.

The dividing line between a skill and an agent is **not** size — it is whether
inheriting the conversation helps or hurts. `record-extractor` runs one agent per
record specifically so no record's extraction can see another's conclusions.
`gps-mentor` critiques a proof in fresh context so it cannot be persuaded by the
reasoning that produced it.

### A skill that fronts an agent is a front door, not a layer

Three skills exist only to front an agent — to let a user invoke it without
knowing the agent's name, and to give it a unit-eval suite. The orchestrator
reaches the agent **directly** — the skill is not a layer in front of it, so a
rule stated only in the skill body is off during production research.

`research/SKILL.md`'s routing table has not caught up: its Invoke cells still
spell bare skill names, and `gps-mentor` is the only agent it delegates to by
name. The table is behind this decision, not an argument against it — issue
#2490 adds the first row that names an agent.

Everything load-bearing therefore goes in the agent, and the routing skill
carries only five things: frontmatter, the narration line, resolution of the
user's words into the agent's arguments, the delegation, and the relay.
`docs/skill-to-agent-pair-conversion.md` owns that list and the falsifiable check
behind it — delete the routing skill and the agent must reach the same outcome
from its arguments alone. A sentence in a routing skill that would change the
outcome if deleted is in the wrong file.

Expect more agents named directly in the orchestrator's routing table. The pairs
are the direction of travel, not three special cases.

### The acquisition seam: the host fetches, the model gets a reference

**Whatever a step acquires, the host fetches and stages; the model receives a
digest and a reference, never the payload.** The three search tools already work
this way — the sidecar is written host-side and `record-extractor` reads it back
by `resultsRef`, so a search result never crosses the main-thread window.

Ruled 2026-09-11: every acquisition lane joins them (issue #2489). A page
transcription, a `record_read`-fetched record and an uploaded PDF all become
staged artifacts, and the engine gains a PDF reader, leaving at most one medium
only the model can read — a page the user has open in the Claude window, which
is unverified (issue #2207).

The placement rule that follows is why this sits here rather than in a tool
spec: **acquisition is a tool call behind an agent, never a skill body.** Two
things force it. The payload must not accumulate in the main-thread window,
which only a fresh context prevents; and a prose instruction to delegate does
not bind, measured at 37% bypass (ADR-0009, the 2026-09-11 rows).

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Two kinds only — tools and skills** (no agents) | Loses all three things agents provide: fresh context, a narrowable capability set, and per-step model routing. Model routing especially: skill `model:` pins are read only by the unit harness, so an agent is the *only* place a per-step model choice binds in production | `docs/architecture.md` §3.5; the 26 skill pins were dead lines and were deleted in 2026-08 — no skill pins a model today |
| **One tool per provider/endpoint** (`familysearch_search`, `wiki_search`, …) | Tool count is context budget in every session. The generic-tool-with-a-provider-parameter shape keeps the catalog small; at 49 tools Cowork already defers the schemas past a size threshold | `CLAUDE.md` § "MCP server tools". ToolSearch is **8.5%** of all tool calls (2,023 of 23,798 across the 145 committed e2e runs, re-measured 2026-08-09) — with `ENABLE_TOOL_SEARCH` on, which the 2026-08-02 polarity check confirmed is what `true` means. Treat it as a snapshot of the deferral-on configuration, not a stable property |
| **Put the GPS doctrine in tools** — make the tools enforce good research | Most of it is genuinely judgment. Of the orchestrator's 17 routing rows, only **6 are mechanically computable**, and those six were never the ones failing. The other 11 need an LLM | Row-by-row analysis in the 2026-07-30 review; the "routing as a tool" headline it demoted is the first row of `docs/adrs/ADR-0009-refuted-agent-design-claims.md` |
| **Put the invariants in prose** — trust the skill bodies | Measured to decay. See ADR-0003 | 77% → 3% compliance after compaction |
| **Give one existing skill every image** — `search-images` already browses volumes and delegates page reads | Its own routing block redirects "I already have the image" *away*, so widening it inverts its front door; and a pasted ARK or an uploaded file is not a browse. Deciding which page to open is a different job from acquiring one | Issues #2450, #2121 |
| **A new acquisition *skill*** carrying the fetch and triage logic in its body | Not an alternative to an agent once the front-door rule above holds — a pair is both, and the load-bearing half is the agent either way. What is left to choose is scope, not shape | Issue #2490 |
| **No agent — let any caller call `image_transcribe` directly** | Deletes the only named destination for "read this image". An agent `description` is resident in context, while the genealogy tool schemas are deferred behind ToolSearch in Cowork, on the hosted path and in both harnesses, so a bare tool is a strictly weaker front door | `CLAUDE.md` § "Never hardcode a qualified name in a ToolSearch query" |
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
