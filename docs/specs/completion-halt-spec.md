# Completion halt spec

The completion halt ends a hosted turn when a main-thread proof-conclusion call
completes the project, on the agent's own `summary_for_user`. Its predicate,
`completion_halt_summary`, lives in `apps/server/app/agent/continue_policy.py` and is
shared by both hosted planes.

This contract used to sit inside the `research_delivered` tool spec. That tool was
deleted in step mode's phase 2 (`docs/specs/research-step-mode-spec.md`), and the halt, which
never depended on it, moved here.

## What it does

When the main thread's call to `proof-conclusion` completes the project, the turn ends there and the agent's `summary_for_user` is shown as the final
message, instead of the main thread's next model call paraphrasing it. That call only
restated the summary: across the four most recent completed projects it cost between
$0.28 and $0.43 and about 20 s each.

**The trigger.** A main-thread `Agent` call to `proof-conclusion`, after which
`project.status` is `completed` when it was not just before the call. Three details:

- The agent name is compared after its last `:`, so the bare name and any prefixed form
  (such as `genealogy-research:proof-conclusion`) both count, the same way the step
  boundary compares names.
- Only `proof-conclusion` can write `project.status`, so a project always completes
  inside that call.
- It fires on the change of status, not the state. A follow-up question in a project
  already completed never ends the turn; a project that was reopened and then completed
  again does.

**When there is no halt.** In each case the turn runs on as before:

- The call's `summary_for_user` is missing, or does not end on one of the two sentences
  `proof-conclusion` writes when it completes the project: "This research is finished. If
  you'd like a second opinion on it, just ask." or, when sources were left unsearched,
  "This research is finished for now. If you'd like a second opinion on it, just ask."
- The status could not be read before the call, or there is no `research.json`.
- On the worker, the store is found down at either read, the one before the call or the
  one after it. The worker then fails the attempt closed, as it does for any outage.
- The call came from a subagent.

If the main thread keeps talking after the halt, the summary is not added, and the
model's own message stays last. Text from a subagent does not count as the main thread
talking on.

**What the user sees.** The turn ends with the agent's `summary_for_user` as the final
message, with no further model call. It is shown as an ordinary message, because the
hook's `stopReason` never reaches the browser. The halted turn offers no next step, so no
reply buttons appear and no automatic follow-up turn is queued.

**Which planes.** The hosted control plane and the prototype worker, through one shared
predicate, `completion_halt_summary` in `continue_policy.py`. The worker records the turn
as `completed` itself, since no plane binds a Stop hook.

## Outcome precedence

- **A completion halt never overrides a reason already set.** It is recorded from the
  `PostToolUse` hook, after the call. If a halt during the call already set a reason (a
  Stop, the spend cap, a lost grant lock, a superseded attempt), that reason stands and
  the summary is not shown.
- **A subagent cannot trigger a completion halt.** It requires main-thread identity
  (`"agent_id" not in data`).
- **`delivered` is a legacy outcome.** Nothing writes it since `research_delivered` was
  deleted. The browser still labels the rows written before (`chatEvents.ts`), and
  `job_state.py` reads it as `stopped`.
