# `research_delivered` tool spec

**Status:** LIVE. Carrier ruled by the lead, 2026-09-29.

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
- **Cowork and the unit harness.** No such hook binds. The tool is still advertised to
  every skill, so it must not error and must not claim an effect it did not have. It
  returns the acknowledgement above and the run genuinely carries on.

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

`delivered` sits **after** `pending_decision` and **before** `project_completed` in both
`should_continue_run` and `terminal_reason`
(`apps/server/app/agent/continue_policy.py`). So:

- a delivery arriving with a patron message already queued reads `queued` — the researcher
  moved on;
- a delivery arriving with a pending decision reads `decision`;
- a delivery on a project that happens to be complete still reads `delivered`, because the
  bounded ask was met first;
- the researcher's own Stop outranks everything, including a delivery — the hook's halt
  check runs before the delivered arm.
