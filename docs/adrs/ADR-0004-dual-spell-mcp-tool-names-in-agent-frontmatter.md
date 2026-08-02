# ADR-0004: Dual-spell every MCP tool name in agent frontmatter

> **Read before you:** grant a tool to a plugin agent · deny a tool to a plugin
> agent · write a `ToolSearch` query in a skill or agent body · rename the
> desktop extension · wonder why every tool appears twice in a `tools:` list.

- **Status:** Accepted
- **Decided:** 2026-07-18 (#742, repairing #650/#698)
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/plugin/agents`, `packages/engine/mcp-server/manifest.json`
- **Related:** ADR-0002, ADR-0006, `docs/architecture.md` §5.2, issues #650, #698, #695, #939

## Context

An MCP server's name is chosen by **whoever registers it**, not by the server.
The plugin ships into the VM and cannot control that choice. In practice the same
47 tools appear under two different prefixes:

| Registrar | Prefix |
|---|---|
| `.mcp.json`, both eval harnesses, the hosted control plane | `mcp__genealogy__<tool>` |
| Cowork, reaching the host `.mcpb` through its remote-device bridge | `mcp__remote-devices__Genealogy_Research__<tool>` |

Cowork's bridge derives its segment from `manifest.json`'s `display_name`
("Genealogy Research" → `Genealogy_Research`), which is a *product* string —
chosen for the install dialog, not for us.

Agent frontmatter entries are matched **exactly**: no prefix fallback, no
inherit-on-miss. And the failure when every entry misses is not a degraded agent
— the runtime refuses to spawn it at all ("would be spawned with zero tools —
refusing").

That is not hypothetical, and the history is worth reading precisely — the usual
"#650/#698" shorthand compresses a there-and-back:

| | |
|---|---|
| **#650** (07-12) | the three then-existing agents ship qualified against the eval harness's `genealogy` key |
| **#657** (07-15) | moved to **bare** names, on the reasoning that "the `mcp__genealogy__` prefix breaks in Cowork" |
| **#698** (07-17) | moved back to qualified — bare leaves the subagent toolless in the SDK path |
| **#742** (07-18) | **both spellings**, which is the only state that works everywhere |

Two full reversals before the answer stuck, and **every test passed at every
step**. That is the argument for the lint, not the anecdote.

*Precision about "broken in Cowork":* the strongest documented observation
(`research-append-tool-spec.md` §11.1) is narrower than "all three dead" — it
records `image-reader` failing to resolve a tool, and a later live check in which
an agent with one of two entries unresolvable **spawned normally**. So the
zero-tools refusal above is the documented runtime rule, but the blast radius of
#650 specifically rests on a small number of live sessions rather than a
systematic sweep.

The deny side is sharper still. `disallowedTools:` binds **even under
`bypassPermissions`**, which is the hosted path's mode (#695), making it the last
line keeping `record-extractor` off the broad `research_append`. A deny naming
one spelling binds *nothing* wherever the server carries the other name — and
unlike a missing grant, a missing deny fails open and silently.

## Decision

**Every MCP tool in an agent's `tools:` — and in `disallowedTools:` — is listed
twice, once under each server spelling:**

```yaml
- mcp__genealogy__record_read
- mcp__remote-devices__Genealogy_Research__record_read
```

This is safe because unrecognized entries are ignored so long as at least one
resolves.

Three corollaries:

- **Never grant a server-level prefix** (`mcp__remote-devices`). That namespace
  also carries `device_bash`, `device_commit_files`, and `project_memory_write` —
  it would hand a read-only agent shell access to the host.
- **Never hardcode a qualified name in a `ToolSearch` query.** Search by bare
  name (`query: "+research_append"`), which matches whatever prefix the session
  exposes. Cowork defers tool schemas past a size threshold and offers no control
  over it, so `ToolSearch` is the real load path there — and
  `select:mcp__genealogy__…` resolves to nothing behind the bridge.
- **Built-in tools (`Read`) stay bare**, and skill `allowed-tools` stays bare
  everywhere — it is not an exact-match spawn filter.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **One qualified name** (whichever prefix the author happens to know) | The exact failure of #650/#698. Whichever one you pick is wrong in some environment, and CI — which registers under `genealogy` — cannot see it | #650/#698; all three agents broken in Cowork, CI green |
| **Bare names only** | Leaves the subagent toolless in the SDK path used by the unit harness. Bare works for skills' `allowed-tools` but not for the agent spawn filter | `CLAUDE.md` § "Dual-spelled tool names" |
| **Grant the server-level prefix** `mcp__remote-devices` and let everything through | That namespace carries `device_bash`, `device_commit_files`, `project_memory_write`. A read-only critique agent would get host shell access | `agent-tool-names.test.ts` header comment |
| **Make Cowork register the server under `genealogy`** | Not ours to set. The bridge namespaces by `display_name`, which is a user-facing product string | Platform behaviour |
| **Rename the extension** so both spellings collapse | `display_name` is what users see in the install dialog; optimising it for a namespacing artifact is the wrong trade. The lint instead *derives* the expected prefix from it, so a rename fails loudly in CI | `agent-tool-names.test.ts` |
| **Generate frontmatter at plugin-build time** from a single declaration | Splits the reviewed artifact from the executed one — the same objection that killed build-time assembly of agent bodies. An agent's capability list is security-relevant; a reviewer must see what actually ships | Issue #702 precedent |

## Consequences

**Gains.** Agents bind correctly in all four environments from one declaration,
and the rename hazard is caught by CI rather than in production. The underlying
namespacing hazard is documented across several frameworks including Anthropic's
own surfaces (claude-code#18763); what this adds is treating allow/deny binding
across spellings as a **CI-linted invariant**, which matters most on the deny
side where a miss is silent. (An earlier draft claimed no public precedent for
that. Dropped: a negative literature claim is unfalsifiable, an ADR is the wrong
place for one, and the decision is fully justified by #650/#698 without it —
critique §9 retracted a neighbouring novelty claim for the same reason.)

**Costs, knowingly accepted.**

1. **Every capability list is twice as long**, and the duplication looks like a
   mistake to anyone who has not read this ADR. `record-extractor`'s frontmatter
   is visibly repetitive.
2. **Adding a tool means remembering both lines.** The lint catches a missing
   second spelling; nothing catches a *pair* of correct entries for a tool the
   agent's body never uses — `record-extractor` has carried `place_search` and
   `place_search_all` under both spellings since 2026-07-18 while its body tells
   it to omit `standard_place`.
3. **A third registrar would need a third spelling**, and the failure mode would
   again be silent in whichever environment we did not think of.

**Risks.** The lint verifies *spelling*, not *binding*. An agent can be perfectly
declared under both names, pass every check, and still not hold the tool at
runtime — the SDK init handshake exposes only name, description, and model per
agent, so there is nothing to assert against (#1084/#1085). The sibling hazard is
agent *resolution*: a bare-name delegation silently falling back to a
general-purpose stand-in that binds none of the deny list (#939).

## Enforcement

> `packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts` —
> asserts both spellings are present for every MCP tool in `tools:` and
> `disallowedTools:`; **derives** the bridge prefix from `manifest.json`'s
> `display_name`, so renaming the extension fails in CI; asserts all five
> registration sites still agree on the `genealogy` key; and fails any
> `select:mcp__…` in a plugin body.

What it does **not** catch: whether a granted tool actually binds at runtime
(#1084/#1085); whether the agent's body ever tells it to call the tool; and a
third prefix nobody has registered yet.

## Revisit when

The runtime gains prefix-insensitive matching or an inherit-on-miss default — or
a check appears that can verify binding rather than spelling, at which point the
dual-spelling lint becomes a subset of a stronger one.
