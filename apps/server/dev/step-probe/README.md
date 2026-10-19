# Phase 0 probe: what can a hook see in live Cowork?

Phase 0 of [`docs/plan/research-step-mode.md`](../../../../docs/plan/research-step-mode.md).
No product code changes. Nothing here ships: it is a throwaway plugin that only
records.

PR 1's Cowork entry point is built on the nine answers below, so they are worth
measuring rather than assuming. One of them already has a partial answer pointing
the wrong way: `guard_project_files.py` says `cwd` is the sandbox and the
connected folder is not mounted, which would make item 7 a NO. That claim was
made about `device_commit_files` sessions, not about this, so it is measured.

## What it answers

| # | Question |
|---|---|
| 1 | `PreToolUse` fires on main-thread `Agent`/`Task`/`Skill` calls |
| 2 | `UserPromptSubmit` fires, and carries the prompt text |
| 3 | `prompt_id` is present, and what its semantics are |
| 4 | `transcript_path` is readable from inside the hook |
| 5 | A deny is honoured, and the model then reports and ends |
| 6 | Sibling calls in one turn are visible |
| 7 | The hook can read the project's `research.json` from its cwd |
| 8 | A file the hook writes is readable on its next call |
| **9** | **Can a plugin PreToolUse hook END a Cowork turn at all?** (the halt fields). Added 2026-10-19 and now the headline, see below |

## Run it

**1. Install as a plugin Cowork loads.** Copy this directory so the two files sit
at `<plugin>/hooks/`, since `hooks.json` resolves the command through
`${CLAUDE_PLUGIN_ROOT}/hooks/`:

```
step-probe-plugin/
  hooks/
    hooks.json
    probe_step_hooks.py
```

Point Cowork at `step-probe-plugin`. Do **not** add these hooks to the shipped
plugin: the `.*` matcher runs the recorder on every tool call, and the file would
ship.

**2. Drive one session** in a folder that holds a real project (items 7 and 8 are
about the project folder, so an empty one answers a different question):

1. Send a message that starts research, so a `Skill`/`Agent`/`Task` call happens
   on the main thread. This is item 1 and, through `PreToolUse`, the control.
2. Send a **second** message. Item 3's semantics need two turns: one turn can
   show a `prompt_id` exists but not whether it changes between turns.
3. Ask it to write a file named `STEP_PROBE_CANARY.txt`. That is item 5's
   trigger, and the only thing the probe denies. Note what the model does next:
   whether it surfaced `STEP_PROBE_CANARY_DENIED_BY_STEP_PROBE`, and whether it
   then ended rather than retrying by another route.
4. **Then give it TWO things to do, where the first mentions
   `STEP_PROBE_HALT`.** For example: "read STEP_PROBE_HALT.txt, then write
   notes.txt saying done." This is item 9, and it is now the headline question.
   Watch whether the SECOND task happens. If it does, the halt did not end the
   turn, exactly as a plain deny did not on the alpha
   (`apps/server/dev/probe_step_deny.py`, 2026-10-19). Two tasks, not one: with
   a single task the turn ends either way and the result proves nothing.

**3. Read it:**

```
python3 read_probe.py path/to/step-probe.jsonl
```

The log defaults to beside the script; `STEP_PROBE_LOG` overrides it.

## Reading the result

The reader prints `VOID` and exits 2 rather than printing answers when the log is
missing, empty, or has no `PreToolUse` lines. That is deliberate. Every answer
takes the form "the log does not contain X", which is a finding only when the log
contains something -- otherwise it describes a probe that was never installed.
`PreToolUse` is the control because ADR-0005 measured it firing in live Cowork on
2026-07-30. **An empty log formatted as negatives is a set of wrong beliefs**,
which is the failure this gate exists to prevent.

Two answers are worth reading closely because each can look like its opposite:

- **Item 8** is a counter, not a file-exists check. A file present on every call
  but always reading nothing back means each invocation got a fresh filesystem.
  That is a NO, and the counter is what distinguishes it.
- **Item 5** is scored `EMITTED`, not `YES`. The log can only show the probe
  *emitted* a deny. Whether the runtime honoured it, and what the model did
  afterwards, is read off the session.

`SessionStart` is registered as a second control. ADR-0005 found it does not fire
in Cowork; if lines appear, that contradicts a recorded measurement and is
re-measured rather than reworded.

## Then

Record the results in
[`ADR-0005`](../../../../docs/adrs/ADR-0005-ship-the-write-lockdown-as-a-plugin-hook.md),
as phase 0 asks. Delete this directory once they are recorded: the answers live
in the ADR, and a probe left in the tree reads as something that runs.

## Why item 9 is now the headline

The lead's steer on 2026-10-19 is that the alpha has 2-3 months left and the
future is Cowork plus the prototype. Cowork is the hard case, because it is the
one plane with no second lever:

- `hooks=` is an SDK argument Cowork does not let us set, so there is **no Stop
  hook** there at all;
- the shipped plugin matcher is
  `Write|Edit|NotebookEdit|.*device_commit_files|.*research_append`, which does
  **not** match `research_delivered` or `AskUserQuestion`. That is why
  `research-delivered.ts` says its inert arm is what runs in Cowork.

So in Cowork today nothing can end a turn. The matcher is ours to widen, which
is cheap. Whether the **halt fields are honoured** by a plugin hook there is not
ours to decide, is unmeasured, and decides whether step mode is buildable on the
plane that will carry the product.

Measured on the alpha, a plain deny does NOT end a turn: the model reports the
refusal and carries on with its remaining work. If the halt fields behave the
same way in Cowork, step mode needs a mechanism nobody has yet named.

## The hosted half

Phase 0 also asks whether a host-side deny binds alongside
`continue_policy.foreground_rewrite` on both hosted planes. That half is not this
kit -- `apps/server/dev/probe_hook_binding.py` already answers the binding
question for the hosted SDK loader (2026-09-09: it does bind), so what is left is
the interaction with `foreground_rewrite` specifically.
