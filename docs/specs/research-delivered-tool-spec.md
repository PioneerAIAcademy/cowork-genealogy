# `research_delivered` tool spec

**Status:** LIVE as of 2026-09-29. Carrier ruled by the user, 2026-09-29
(`docs/plan/research-as-a-job-phase2.md`, R4).

## What it is

A **signal, not an action.** The agent calls it to say it has delivered what the current
message asked for and is stopping on purpose. It writes no project state and touches no
network.

## Why it is a tool and not a sentence

Since continuous work shipped, the Stop hook vetoes every voluntary stop until
`project.status` is `completed`. So a request bounded to one deliverable — "create a plan
but leave it at that", a single christening lookup, "where are we?" — runs
on to the proof, the nudge cap or the spend bound. The finish line has to belong to the
request that named it.

A hook can match a **tool name** exactly. It cannot rely on prose the model may not honour,
and prose triggering has been measured flipping about half the time. That is the same reason
the decision exit matches `AskUserQuestion`.

## Why it is not `AskUserQuestion`

An ask carries `questions` and **waits for an answer**; a delivery waits for nothing. One
tool carrying both speech acts leaves the hook with no discriminator, which the original
plan never specified. They are separate tools on purpose.

The asymmetry is worth naming: the decision exit reuses a **built-in** the model already
has, so it cost nothing. `delivered` has no built-in equivalent, so it costs a real MCP
tool and the full site list.

## Contract

| | |
|---|---|
| Name | `research_delivered` |
| Input | `summary` (string, required) — one sentence naming what was delivered |
| Output | `{ acknowledged: true, summary, note }` |
| Network | none |
| Project state | none |
| Auth | none |

## Behaviour by environment

- **Hosted (the prototype worker).** The `PreToolUse` hook matches the tool's name and
  halts the turn *before* the tool executes, so the body never runs. The turn's outcome is
  `delivered` and the browser renders *"Done — that's what you asked for. Send a message to
  carry on."*
- **Cowork and the unit harness.** No hook binds, and the tool is advertised to all 27
  skills. The body runs and returns a harmless, truthful acknowledgement — it must not
  error, and must not claim an effect it did not have. Its `note` is true in both
  environments: where the run is managed the turn has already ended and nobody reads it;
  where it is not, the run genuinely carries on.

## Outcome placement

`delivered` sits **after** `pending_decision` and **before** `project_completed` in
`should_continue_run` / `terminal_reason`. A delivery arriving with a patron message
already queued reads as `queued` — the researcher has moved the conversation on — and one
arriving with a pending decision reads as `decision`. A delivery on a project that happens
to be complete still reads as `delivered`, because the ask was met first.

It is a **new** enum value, never a label on `ok`. `ok` means "a turn ended with no
terminal reason" and the browser deliberately renders it as nothing; a delivery is the
opposite — it has something to report.

## What is NOT in scope

The tool delivers the *signal*. Whether the model calls it at the right moments is a
separate, unmeasured question — the enforcement half — and no skill body instructs its use
yet. Adding that instruction is a body edit gated by the usual eval slot.
