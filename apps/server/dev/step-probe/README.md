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

**1. Build the plugin folder:**

```
python3 setup.py ~/step-probe-plugin
```

It assembles the layout, checks `python3` really launches Python 3 (on stock
Windows that name resolves to a Microsoft Store alias, and `hooks.json` shells
that exact name), and self-tests all three arms. It prints `READY` only if the
halt arm actually emits a CLI-readable stop, so a broken install fails there
rather than looking like negative answers later.

The layout it produces, if you would rather do it by hand:

```
step-probe-plugin/
  .claude-plugin/plugin.json     <- required, or the plugin will not install
  hooks/hooks.json
  hooks/probe_step_hooks.py
```

`hooks.json` resolves its command through `${CLAUDE_PLUGIN_ROOT}/hooks/`, so the
two hook files must sit under `hooks/`. The manifest is named `step-probe` so it
cannot collide with `genealogy-research`.

Point Cowork at `step-probe-plugin`. Do **not** add these hooks to the shipped
plugin: the `.*` matcher runs the recorder on every tool call, and the file would
ship.

**2. Drive one session** in a folder that holds a real project (items 7 and 8 are
about the project folder, so an empty one answers a different question):

1. Ask, in words, for a skill by name: "Use the research skill to continue
   researching this project." This is item 1. A research question alone is not
   enough: on 2026-10-19 the model answered one with direct tool calls and made
   no `Skill`/`Agent`/`Task` call at all, which leaves item 1 unexercised. A
   typed `/research` may not be enough either, since a slash command can expand
   into the message without the model ever calling `Skill`.
1b. **For the `Agent`/`Task` half of item 1, ask for an AGENT by name and then
   LET IT FINISH.** For example: "Use the convert-dates agent to convert 12
   February 1750 from Julian to Gregorian." A skill call alone does not settle
   this: on 2026-10-19 the `Skill` half was confirmed and the `Agent`/`Task`
   half was left open because the operator interrupted nine seconds in, before
   anything spawned. Do not interrupt this one. The spawn is the measurement,
   so a turn that is cut before it cannot answer.

   Pick an agent whose work is short and needs no network, so the turn ends on
   its own: `convert-dates` is the cheapest. Check the log afterwards for a
   `PreToolUse` line whose `tool_name` is `Agent` or `Task`.

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
   **The skipped second task is not the evidence on its own:** the halt's reason
   text tells the model to end its turn, so a model obeying a plain deny would
   skip it too. What separates them is whether the model replies at all. Step 3
   is the control: its deny also says to end the turn, and the model replies and
   `Stop` fires. A halt the runtime honours leaves no reply and no `Stop` line.

**3. Read it:**

```
python3 read_probe.py path/to/step-probe.jsonl
```

The log defaults to beside the script; `STEP_PROBE_LOG` overrides it.

**The log is written inside the VM, not on your machine.** Cowork runs the plugin
from its own copy, so `~/step-probe-plugin` on the host stays empty. At the end of
the session, ask it to find the log and copy it into the connected folder:

```
find / -name step-probe.jsonl 2>/dev/null
```

**`read_probe.py` does not score item 9, but the log shows it.** Find the line
carrying `STEP_PROBE_HALT` and read the rest of that `prompt_id`: a later
`PreToolUse` means the halt leaked; a `Stop` line means the model ended the turn
itself (its `last_assistant_message` says what it told the researcher); neither
means the runtime ended it. Confirm with the operator that they did not press
stop, which also leaves no `Stop` line.

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

`SessionStart` is registered as a second control. ADR-0005 found it did not fire
in Cowork on 2026-07-30; the 2026-10-19 run saw it fire on startup and on resume.
Both are recorded in ADR-0005.

## Then

**Recorded 2026-10-19** in
[`ADR-0005`](../../../../docs/adrs/ADR-0005-ship-the-write-lockdown-as-a-plugin-hook.md),
"What the step-mode phase-0 probe found", every item. Item 1 is a yes for
`Skill`; `Agent`/`Task` was not exercised, because the re-run was interrupted
before any spawn. Once that is measured or judged unnecessary, delete this
directory: the answers live in the ADR, and a probe left in the tree reads as
something that runs.

## Why item 9 is now the headline

**Answered 2026-10-19: the halt ends a Cowork turn** (ADR-0005). The first bullet
below was also wrong: a `Stop` hook registered in a plugin's `hooks.json` fires in
Cowork. It is `hooks=`, the SDK argument, that Cowork does not let us set. The
section is kept as the reasoning the probe was built on.

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
