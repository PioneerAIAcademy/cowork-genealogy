# `research_delivered` tool spec

**Status:** LIVE. Carrier ruled by the **user**, 2026-09-29 (recorded in commit
`c7b63b350`: "Ruled (user, 2026-09-29): a second dedicated tool, not AskUserQuestion").
Not a lead ruling: CLAUDE.md reserves `(lead, …)` for a call Dallan answered himself.

## What it is

A **signal, not an action.** The agent calls it to say it has delivered what the current
message asked for and is stopping on purpose. It writes no project state and touches no
network.

## Why it is a tool and not a sentence

Since continuous work shipped, the Stop hook vetoes every voluntary stop until
`project.status` is `completed`. So a request bounded to one deliverable — "create a plan
but leave it at that", a single christening lookup, "where are we?" — runs on to the proof,
the nudge cap or the spend bound. The finish line has to belong to the request that named
it.

A hook can match a **tool name** exactly. It cannot rely on prose the model may not honour,
and prose triggering has been measured flipping about half the time.

## Why it is not `AskUserQuestion`

An ask carries `questions` and **waits for an answer**; a delivery waits for nothing. One
tool carrying both speech acts leaves the hook with no discriminator. They are separate
tools on purpose.

## Input

| Field | Type | Required | Meaning |
|---|---|---|---|
| `summary` | string | yes | One sentence naming what was delivered, in the researcher's terms. |

## Output

```json
{
  "acknowledged": true,
  "summary": "<the summary, trimmed>",
  "note": "Delivery recorded. Where this run is managed, the turn ends here; otherwise it carries on."
}
```

## Two environments, one truthful reply

- **Hosted (the prototype worker).** A `PreToolUse` hook matches `DELIVERED_TOOL`
  (`mcp__genealogy__research_delivered`) and ends the turn **before the tool body runs**.
  The turn's `outcome` is `delivered` and the browser renders "Done — that's what you asked
  for. Send a message to carry on." Nothing reads the tool's return value.
- **The hosted ALPHA (`real_agent.py`).** It registers the same MCP server, so the tool is
  advertised and callable there, but it has neither `DELIVERY_GUIDANCE` nor a hook arm: its
  Stop hook vetoes the exit like any other yield, and alpha testers keep phase-1 behaviour
  until the alpha is retired (ruled: `docs/plan/research-as-a-job-later.md`, "Before phase 2").
  A call there is the inert acknowledgement below, not a stop.
- **Cowork and the e2e harness.** No such hook binds, and the tool IS advertised (the
  e2e orchestrator binds the real engine server and grants `mcp__genealogy` as a
  server-prefix wildcard). So it must not error and must not claim an effect it did not
  have: it returns the acknowledgement above and the run genuinely carries on. That inert
  behaviour is the intended one for these environments, not an oversight.
- **The unit harness.** Not advertised at all: that harness binds a mock server which
  registers only fixture-backed tools plus `LIVE_TOOLS` (`eval/harness/harness/mock_mcp.py`),
  and this tool is in neither set.

The `note` is worded to be true in both places, which is why it is hedged rather than
asserting the turn ended.

## When the agent is told to call it

The instruction rides the worker's per-turn system prompt (`DELIVERY_GUIDANCE` in
`apps/server/proto/worker/options.py`), **not** any skill body — the hook that gives this
tool its meaning exists only on the hosted path, so a skill-body rule would teach every
skill to call a tool that is inert in Cowork and in the harness that grades them.

It carries two exclusions, both load-bearing:

- **Not when the research objective itself is finished.** That run ends on its own and its
  outcome is `completed`; reporting `delivered` there would mislabel a finished project.
- **Not in place of asking the researcher a question.** An ask waits for an answer; a
  delivery waits for nothing.

## Outcome precedence

It is a **new** enum value, never a label on `ok`. `ok` means "a turn ended with no
terminal reason" and the browser deliberately renders it as nothing; a delivery is the
opposite, it has something to report. Reusing `ok` would either silence the delivery or
give every unremarkable turn a label.

**The worker records `delivered` from its `PreToolUse` hook**, not from the shared
continue-policy. `on_delivered()` writes `terminal["reason"]` directly
(`apps/server/proto/worker/worker.py`), and that happens *after* `halt()` has run. So the
precedence is the hook's ordering, not a clause list:

- **A Stop wins.** The researcher's own stop is checked first and returns before the
  delivered arm is reached.
- **A spend cap wins**, for the same reason: it is part of `halt()`.
- **A queued patron message wins once the turn has made at least one tool call.** The
  queued check is gated on `counters["tool_calls"] >= 1`, so a delivery made as the
  turn's *first* tool call records `delivered` even with a message waiting.
- **`decision` cannot fire at all yet.** The worker passes `pending_decision=lambda: False`
  (phase 3 is unbuilt), so no path produces it.
- **A subagent cannot deliver.** The arm requires main-thread identity
  (`"agent_id" not in data`); a subagent's call falls through to the inert tool body.

The shared `continue_policy` carries `TERMINAL_DELIVERED` as the value's definition and
nothing more: it has no `delivered` parameter and no clause, because no caller would pass
one. An earlier revision added both; they were removed on review as dead code.
