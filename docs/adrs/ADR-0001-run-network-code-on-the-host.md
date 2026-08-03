# ADR-0001: Run all network code on the host and ship only offline code into the VM

> **Read before you:** add a feature that calls an external API · write a script
> that ships inside a skill or hook · wonder why a tool lives on the server
> instead of in a skill · debug a call that returns nothing with no error.

- **Status:** Accepted
- **Decided:** pre-2026-05 (reconstructed — this predates the specs directory)
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/mcp-server`, `packages/engine/plugin`
- **Related:** `docs/architecture.md` §2, `CLAUDE.md` § "Architecture you must understand"

## Context

Cowork runs Claude inside a sandboxed Linux VM whose egress allowlist does not
work for arbitrary domains. Code running in that VM cannot reliably reach the
network, and — this is the part that matters — **it does not fail loudly when it
tries.** The egress proxy blocks the call; the script sees a timeout or an empty
result, and the model narrates around it.

This product is almost entirely network work. It queries FamilySearch's search,
records, persons, places, and full-text APIs; a hosted wiki sidecar; a
population-statistics service; and an OpenRouter VLM for OCR. If the VM cannot
make those calls, the VM cannot be where that code lives.

The constraint is not ours to negotiate. It is a property of the platform we
ship into.

> **Sourcing gap, named honestly.** This is the load-bearing premise of the whole
> system, and **no dated observation of it exists in the repo** — no runlog, no
> probe, no verification note. It is asserted in `CLAUDE.md` and has been since
> the first architecture notes. Everything downstream is built on it and it has
> never been contradicted in practice, but "blocked calls fail silently" is a
> claim a reader cannot currently reproduce. If anyone re-observes it, date it
> here.

## Decision

**Every piece of code that touches the network runs on the host, inside the MCP
server. Everything shipped into the VM — skills, agents, hooks, and any bundled
Python — must work with no network at all.** The two halves share no files at
runtime and communicate only through MCP tool calls: structured JSON in,
structured JSON out.

Concretely this produces two artifacts from one repo: a TypeScript MCP server
packaged as a `.mcpb` desktop extension that runs on the user's machine, and a
Cowork plugin folder packaged as a `.zip` that runs in the VM. They are
developed together and versioned together because they are two halves of one
contract.

The operational test for any new feature is one question: **does this need the
network?** If yes, it is an MCP tool. If no — data processing, formatting,
templating, judgment — it can live in the VM.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Run everything in the VM**, calling APIs from skill scripts | The egress allowlist does not work for arbitrary domains, and blocked calls fail silently rather than erroring — the worst possible failure mode for an agent that will narrate a plausible result anyway | Platform constraint; `CLAUDE.md` has carried the warning since the repo's first architecture notes |
| **Proxy VM traffic through a host-side relay**, keeping logic in the VM | Moves the network boundary without removing it, and buys a second protocol to version alongside MCP. MCP already *is* the host↔VM channel — a relay would be a parallel one doing the same job worse | Argued, not measured |
| **Run everything on the host**, including the judgment work | The judgment work needs the session's own context — the conversation, the project state, the user's prior answers. A host-side process has none of that, and shipping it across the boundary on every call is the "hand the LLM a large document" anti-pattern this system spent two tool families removing | See ADR-0002 and `project-context-tool-spec.md` |
| **Ship a bundled HTTP client into the VM** with a pinned allowlist | The allowlist mechanism is the thing that does not work. A client cannot fix a proxy | Platform constraint |

## Consequences

**Gains.** Network failures surface at a tool boundary that validates and
returns structured errors, so the model gets an actionable message instead of
silence. Credentials — the FamilySearch OAuth tokens, the OpenRouter key — stay
on the host in `~/.familysearch-mcp/` and never enter the **Cowork** VM. And the
split forces every host capability through a declared, schema'd tool, which is
what makes the capability-binding layer (ADR-0004, ADR-0006) possible at all.

> **The hosted web workbench is the exception, and it matters.** There the MCP
> server runs *inside* the E2B sandbox, and the control plane deliberately
> injects credentials into it — `apps/server/app/fs_oauth.py` writes both
> `tokens.json` and `config["openRouterApiKey"]` under the sandbox HOME. So the
> "credentials never cross" property is a property of the **Cowork** topology,
> not of this decision. Do not carry it over when reasoning about the hosted
> path.

**Costs, knowingly accepted.** Three real ones:

1. **No runtime code sharing between the halves.** A structure needed on both
   sides is duplicated, not imported. `CLAUDE.md` names this explicitly as a
   thing not to try.
2. **Two artifacts, two install paths, one contract.** A change that spans the
   boundary needs both rebuilt, and the ways to do that differ per environment
   — the single most common way to spend an hour testing a fix that was never
   loaded.
3. **Skill scripts are stdlib-only Python.** No dependency the VM might lack, no
   pip install slowing every invocation. Today this costs nothing, because no
   skill ships a `scripts/` folder — the plugin's only Python is the guard hook.

**Risks.** The silent-failure mode still exists for anyone who forgets the rule:
a skill script that calls out gets blocked with no error. Nothing in CI detects
network code in a skill script, and **the only automated guard was removed** —
the `cowork-skill-builder` subagent refused to write one, and it was deleted as
stale on 2026-08-02 (#1161). Review is now the sole check.

## Enforcement

**Partial — the architectural rule is convention; only its packaging is tested.**

> `packages/engine/mcp-server/tests/packaging/plugin-hooks.test.ts` — asserts the
> hooks directory ships and runs the real guard script.
> `packages/engine/mcp-server/tests/packaging/manifest.test.ts` — asserts the
> advertised tool list matches the registry.

Neither catches the actual failure: **no test detects a network call in a skill
or hook script.** It would be a cheap lint (grep the plugin tree for `urllib`,
`requests`, `http.client`, `socket`, `fetch`) and does not exist.

## Revisit when

Cowork's egress allowlist becomes reliable for arbitrary domains — at which
point the question is not whether to move code into the VM (the credential
argument and ADR-0006's capability boundary still favour the host) but whether
the two-artifact build is still worth its cost.
