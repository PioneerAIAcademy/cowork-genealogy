# ADR-0004: Spell every MCP tool name under all three server registrations

> The filename still reads `dual-spell`. It is a permanent slug, kept so existing
> links resolve; the decision below is the current one.

> **Read before you:** grant a tool to a plugin agent · deny a tool to a plugin
> agent · write a `ToolSearch` query in a skill or agent body · rename the
> desktop extension · wonder why every tool appears three times in a `tools:` list.

- **Status:** Accepted
- **Decided:** 2026-07-18 (#742, repairing #650/#698)
- **Last updated:** 2026-08-30 (the deny's justification was measured and half of it was false; grant/deny overlap is now a lint)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/plugin/agents`, `packages/engine/mcp-server/manifest.json`
- **Related:** ADR-0002, ADR-0006, `docs/architecture.md` §5.2, issues #650, #698, #695, #939, #1341

## Context

An MCP server's name is chosen by **whoever registers it**, not by the server.
The plugin ships into the VM and cannot control that choice. In practice the same
47 tools appear under three different prefixes:

| Registrar | Prefix |
|---|---|
| `.mcp.json`, both eval harnesses, the hosted control plane | `mcp__genealogy__<tool>` |
| Cowork **in the cloud**, reaching the host `.mcpb` through its remote-device bridge | `mcp__remote-devices__Genealogy_Research__<tool>` |
| Cowork **on the user's own computer**, reaching the same `.mcpb` directly | `mcp__Genealogy_Research__<tool>` |

Both Cowork forms derive the segment from `manifest.json`'s `display_name`
("Genealogy Research" → `Genealogy_Research`), which is a *product* string —
chosen for the install dialog, not for us. Only the cloud form is namespaced,
because only it has a bridge to traverse. **Run mode is a per-task setting**, so
which of the two is live is not a property of the install.

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
| **#742** (07-18) | **both spellings** — correct for the two registrars known at the time |
| **#1341** (08-05) | **all three** — Cowork on the user's own computer is a third registrar; `record-extractor` was refused there, and the three agents whose entries are all MCP follow by the same rule |

Two full reversals before the answer stuck, and **every test passed at every
step**. That is the argument for the lint, not the anecdote.

*Precision about "broken in Cowork":* the strongest documented observation
(`research-append-tool-spec.md` §11.1) is narrower than "all three dead" — it
records `image-reader` failing to resolve a tool, and a later live check in which
an agent with one of two entries unresolvable **spawned normally**. So the
zero-tools refusal above is the documented runtime rule, but the blast radius of
#650 specifically rests on a small number of live sessions rather than a
systematic sweep.

The deny side needs the same treatment, though **for a weaker reason than this
ADR originally gave.** It said `disallowedTools:` binds even under
`bypassPermissions` while an omission alone does not, making the deny "the last
line" keeping `record-extractor` off the broad `research_append`. The first half
is true; the second is false. Probed 2026-08-30 against Claude Code 2.1.251 /
SDK 0.2.128 (`make probe-agent-binding`, reproduced twice): under
`bypassPermissions` a tool merely **omitted** from `tools:` is absent from the
agent, exactly as a denied one is. The omission is the load-bearing half; the
deny restates it.

The claim spread to `CLAUDE.md`, `docs/architecture.md`, ADR-0006, ADR-0011, two
specs, the packaging test and three agent bodies, and seven of those cited issue
#695 for it. That issue is the birkeland lane breach and says nothing about
`bypassPermissions`, denies, or omissions — a citation chain that never
terminated in evidence.

**So all five deny blocks were deleted in the same change.** Each named a tool
already absent from its agent's `tools:`, so each was a restatement — 83 lines of
triple-spelled YAML a reader has to check against the list above it. The
regression a deny insured against, someone later adding the tool back, is caught
by the permission snapshot in `agent-tool-names.test.ts`, which fails on any
change to an agent's list.

The spelling rule below still governs a deny, because one may return for a reason
the omission cannot serve. It just has nothing to govern today.

**One thing the probe found that changes an instruction: never name a tool in
both lists.** The deny is applied *before* the zero-tools spawn check. A probe
agent granting one tool under all three spellings plus `ToolSearch`, and denying
that same tool, was refused outright — "would be spawned with zero tools —
refusing. Its tools list resolved to nothing: unrecognized [ToolSearch]" — with
the three MCP entries not named, because the deny had already removed them.

## Decision

**Every MCP tool in an agent's `tools:` is listed three times, once under each
live server spelling — as would every entry of a `disallowedTools:` block, if one
ever returned:**

```yaml
- mcp__genealogy__record_read                            # harnesses, .mcp.json, hosted web
- mcp__remote-devices__Genealogy_Research__record_read   # Cowork in the cloud (bridged)
- mcp__Genealogy_Research__record_read                   # Cowork on the user's own computer
```

The last two both derive from `manifest.json`'s `display_name`; only the bridged
one is namespaced under `remote-devices`. **Which one is live depends on where the
Cowork task runs**, which is a per-task setting the plugin cannot see, so an agent
needs all three.

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
  `select:mcp__genealogy__…` resolves to nothing in either Cowork mode.
- **Built-in tools (`Read`) stay bare**, and skill `allowed-tools` stays bare
  everywhere — it is not an exact-match spawn filter.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Two spellings** (harness + bridge), the original form of this ADR | Missed Cowork's on-computer registration, which uses `display_name` with no `remote-devices` segment. `record-extractor` was refused outright — "would be spawned with zero tools — refusing", naming all 16 declared entries as unrecognized — in the mode that reaches the host extension directly. Three of the four agents declare only MCP tools, so the same applies to them; `gps-mentor` declares a bare `Read`, so it would spawn holding that alone | #1341 |
| **One qualified name** (whichever prefix the author happens to know) | The exact failure of #650/#698. Whichever one you pick is wrong in some environment, and CI — which registers under `genealogy` — cannot see it | #650/#698; all three agents broken in Cowork, CI green |
| **Bare names only** | Leaves the subagent toolless in the SDK path used by the unit harness. Bare works for skills' `allowed-tools` but not for the agent spawn filter | `CLAUDE.md` § "Dual-spelled tool names" |
| **Grant the server-level prefix** `mcp__remote-devices` and let everything through | That namespace carries `device_bash`, `device_commit_files`, `project_memory_write`. A read-only critique agent would get host shell access | `agent-tool-names.test.ts` header comment |
| **Make Cowork register the server under `genealogy`** | Not ours to set. The bridge namespaces by `display_name`, which is a user-facing product string | Platform behaviour |
| **Rename the extension** so both spellings collapse | `display_name` is what users see in the install dialog; optimising it for a namespacing artifact is the wrong trade. The lint instead *derives* the expected prefix from it, so a rename fails loudly in CI | `agent-tool-names.test.ts` |
| **Generate frontmatter at plugin-build time** from a single declaration | Splits the reviewed artifact from the executed one — the same objection that killed build-time assembly of agent bodies. An agent's capability list is security-relevant; a reviewer must see what actually ships | Issue #702 precedent |

## Consequences

**Gains.** Agents bind correctly in every environment from one declaration,
and the rename hazard is caught by CI rather than in production. The underlying
namespacing hazard is documented across several frameworks including Anthropic's
own surfaces (claude-code#18763); what this adds is treating allow/deny binding
across spellings as a **CI-linted invariant**, which matters most on the deny
side where a miss is silent. (An earlier draft claimed no public precedent for
that. Dropped: a negative literature claim is unfalsifiable, an ADR is the wrong
place for one, and the decision is fully justified by #650/#698 without it —
ADR-0009's rev. 3 table retracted a neighbouring novelty claim for the same
reason.)

**Costs, knowingly accepted.**

1. **Every capability list is three times as long**, and the duplication looks like a
   mistake to anyone who has not read this ADR. `record-extractor`'s frontmatter
   is visibly repetitive.
2. **Adding a tool means remembering all three lines.** The lint catches a missing
   spelling; nothing catches a *complete set* of correct entries for a tool the
   agent's body never uses — `record-extractor` has carried `place_search` and
   `place_search_all` under both original spellings since 2026-07-18, and all three
   since 2026-08-05, while its body tells
   it to omit `standard_place`.
3. **A third registrar would need a third spelling**, and the failure mode would
   again be silent in whichever environment we did not think of. **That happened,
   in #1341**, and it was silent for exactly the predicted reason: the lint derived
   its expected prefixes from the two registrars we knew about, so it agreed with
   the omission and stayed green. A fourth would do the same. `bareName()` now
   throws on an unrecognized prefix instead of slicing it against another prefix's
   length, which turns the next instance from a wrong bare name into a named
   failure.

**Risks.** The lint verifies *spelling*, not *binding*. An agent can be perfectly
declared under every name, pass every check, and still not hold the tool at
runtime — the SDK init handshake exposes only name, description, and model per
agent, so there is nothing to assert against (#1084/#1085). The sibling hazard is
agent *resolution*: a bare-name delegation silently falling back to a
general-purpose stand-in that binds none of the deny list (#939).

## Enforcement

> `packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts` —
> asserts all three spellings are present for every MCP tool in `tools:` and
> `disallowedTools:`; **derives** both `display_name`-based prefixes from
> `manifest.json`, so renaming the extension fails in CI; asserts all five
> registration sites still agree on the `genealogy` key; throws rather than
> mis-slicing on an unrecognized prefix; fails any `select:mcp__…` in a
> plugin body; and fails any agent that names a tool in **both** `tools:` and
> `disallowedTools:`, which can make the runtime refuse the agent outright.

> `make probe-agent-binding` (`apps/server/dev/probe_agent_binding.py`) — a
> live, billed probe rather than a check: spawns a probe agent under the exact
> hosted options and reads whether a real tool call landed, off the
> `tool_result` rather than the agent's prose. Six arms — granted, granted **and**
> denied, omitted — each with tool search off and on. Run it when the CLI or the
> SDK moves, or before adding a deny on the strength of it binding.

What no CI job catches: whether a granted tool actually binds at runtime
(#1084/#1085); whether the agent's body ever tells it to call the tool; and a
**fourth** prefix nobody has registered yet. Only a live session can, and only in
the run mode being tested — a cloud-mode check would have passed throughout
#1341. The probe above closes the first of these for the **hosted** options only;
Cowork in either run mode still has no instrument but a live session.

## Revisit when

The runtime gains prefix-insensitive matching or an inherit-on-miss default — or
a check appears that can verify binding rather than spelling, at which point the
multi-spelling lint becomes a subset of a stronger one.
