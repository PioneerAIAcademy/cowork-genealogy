#!/usr/bin/env python3
"""Phase 0 of `docs/plan/research-step-mode.md`: what can a hook see in live Cowork?

Step mode needs a hook to know, every turn, which step the run is on. That needs
facts nobody has measured in Cowork: whether `UserPromptSubmit` fires at all
(`SessionStart` does not -- ADR-0005), whether a `prompt_id` is carried, whether
a hook can read the project from its own working directory, and whether a file
it writes survives to its next call. PR 1's Cowork entry point is built on the
answers, so guessing them wrong is a rewrite.

This script ANSWERS NOTHING ITSELF. It is a recorder: every hook invocation
appends one JSON line to the log, with the whole payload plus the few facts that
can only be learned from inside the hook (what `cwd` actually is, whether the
project is readable from there, whether the previous line's file came back). The
reader (`read_probe.py`) turns that log into the eight answers.

THE CONTROL, AND WHY THERE HAS TO BE ONE

"`UserPromptSubmit` never fired" and "the probe was never installed" produce the
same empty log. So does "the probe raised on its first call". Without something
already known to fire, an empty log reads as eight negative findings when it is
really one installation failure -- the exact shape ADR-0005 warns about, where a
hook that stopped binding is indistinguishable from a hook with no opinion.

`PreToolUse` is that control: ADR-0005 measured it firing in live Cowork on
2026-07-30, under either matcher form, with its deny honoured. So:

    PreToolUse lines present, UserPromptSubmit absent -> a real negative.
    No lines at all                                   -> VOID. Not a finding.

`read_probe.py` enforces that distinction rather than leaving it to the reader.

NEVER RAISES, ALWAYS ALLOWS

Same contract as the shipped guard: read JSON on stdin, print a decision, exit 0.
Printing `{}` is "no opinion". Every failure path here falls through to allowing
the call and to recording what went wrong in the line, because a probe that
breaks a session is a probe nobody finishes running, and a probe that swallows
its own failure is worse than no probe.

The ONE exception is the deny arm, which exists to answer item 5 (are denies
honoured, and does the model then report and end?). It fires only on a tool call
carrying `CANARY`, so it cannot touch real work: see `_canary_deny`.

Stdlib only -- it runs in the VM, which has no third-party packages.
"""
import json
import os
import sys
import time

# Where the log goes. An env var so the probe can be pointed at a readable
# location on whichever plane it runs; the default is beside this script, which
# is inside the plugin root and therefore writable in the sandbox.
LOG_PATH = os.environ.get(
    "STEP_PROBE_LOG",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "step-probe.jsonl"),
)

# Item 8: a file the hook writes, read back on the next call. Written beside the
# log for the same reason. The VALUE is a counter, so the reader can tell "the
# file came back" from "a stale file from a previous session came back" -- a
# fresh file reading 1 on every call means each invocation got a clean
# filesystem, which is a different answer from the file persisting.
STATE_PATH = os.environ.get(
    "STEP_PROBE_STATE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "step-probe-state.json"),
)

# The deny arm's trigger (item 5). A tool call is denied ONLY when this string
# appears in its input. Deliberately not a path or a tool name: the probe must
# be incapable of denying real work, and a sentinel the operator types is the
# only trigger that cannot be hit by accident.
CANARY = "STEP_PROBE_CANARY"

# The SECOND canary, and the one that now matters most. The lead's 2026-10-19
# steer is that the alpha has 2-3 months left and the future is Cowork plus the
# prototype, so the question moved: not "does a deny bind in Cowork" (ADR-0005
# answered that on 2026-07-30) but "can a PLUGIN PreToolUse hook END A COWORK
# TURN at all".
#
# It was the whole mechanism question for Cowork, which was believed to have no
# other lever: `hooks=` is an SDK argument Cowork does not let us set, and the
# shipped matcher (`Write|Edit|NotebookEdit|.*device_commit_files|.*research_append`)
# does not match `research_delivered` or `AskUserQuestion` -- which is why
# `research-delivered.ts` says its inert arm is what runs in Cowork.
#
# ANSWERED 2026-10-19 (ADR-0005): the halt ends a Cowork turn. The run also found
# that a plugin `hooks.json` Stop hook DOES fire in Cowork, so "no other lever"
# was wrong: only the SDK's `hooks=` is out of reach.
CANARY_HALT = "STEP_PROBE_HALT"

# Printed in the deny reason so the model's own report can be attributed to THIS
# hook rather than to a tool's own refusal. probe_hook_binding.py's arm B is the
# precedent: a deny that cannot be attributed proves nothing, because the tool
# may have refused for its own reasons and the prose looks identical.
DENY_REASON = (
    f"{CANARY}_DENIED_BY_STEP_PROBE. This is a phase-0 measurement, not a real "
    "restriction. Report that this specific deny reached you, then end your turn "
    "without retrying and without using another tool to accomplish the same thing."
)


HALT_REASON = (
    f"{CANARY_HALT}: this step is complete. Report what you did, then end your turn."
)


def _read_text(path):
    """`(ok, detail)` -- never raises, and the detail says WHICH failure it was.

    "could not read" collapses three different answers (no such file, present
    but unreadable, present and unparseable) that mean different things for
    item 7: a missing research.json says the folder is not mounted, a permission
    error says it is mounted and walled off.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return True, len(fh.read())
    except FileNotFoundError:
        return False, "FileNotFoundError"
    except PermissionError:
        return False, "PermissionError"
    except OSError as exc:
        return False, f"OSError:{type(exc).__name__}"
    except Exception as exc:  # noqa: BLE001 - a probe must not raise, ever
        return False, f"{type(exc).__name__}"


def _bump_state():
    """Item 8. Returns `(seen_before, value_written, detail)`.

    `seen_before` is the value this call READ, so `None` means the file was not
    there. The counter is what separates "the file persisted" from "a fresh file
    every call": a log whose every line reads `seen_before: null` and writes 1
    means no write survived, even though a file exists on disk each time.
    """
    prior = None
    detail = ""
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            prior = json.load(fh).get("calls")
    except FileNotFoundError:
        detail = "absent"
    except Exception as exc:  # noqa: BLE001
        detail = f"read_failed:{type(exc).__name__}"

    nxt = (prior + 1) if isinstance(prior, int) else 1
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"calls": nxt}, fh)
    except Exception as exc:  # noqa: BLE001
        detail = (detail + " " if detail else "") + f"write_failed:{type(exc).__name__}"
    return prior, nxt, detail


def _project_visible(cwd):
    """Item 7: can the hook read the project from its working directory?

    The shipped guard's own comment says `cwd` is the sandbox and the connected
    folder is NOT mounted, which would make this a no. That is a claim about
    `device_commit_files` sessions specifically, and it has not been measured
    for the step hook's purpose, so it is measured rather than assumed.
    """
    out = {"cwd": cwd}
    for name in ("research.json", "tree.gedcomx.json"):
        ok, detail = _read_text(os.path.join(cwd, name))
        out[name] = {"readable": ok, "detail": detail}
    try:
        out["cwd_entries"] = sorted(os.listdir(cwd))[:40]
    except Exception as exc:  # noqa: BLE001
        out["cwd_entries"] = f"listdir_failed:{type(exc).__name__}"
    return out


def _canary_halt(payload):
    """True when this call carries the halt sentinel. Same shape as `_canary_deny`."""
    try:
        return CANARY_HALT in json.dumps(payload.get("tool_input", {}))
    except Exception:  # noqa: BLE001
        return False


def _canary_deny(payload):
    """True when this call carries the sentinel. Item 5's trigger, and nothing else.

    Scans the SERIALISED input so the sentinel is found wherever the operator put
    it (a file path, a prompt, a tool argument) without this script needing to
    know each tool's argument shape.
    """
    try:
        return CANARY in json.dumps(payload.get("tool_input", {}))
    except Exception:  # noqa: BLE001
        return False


def main():
    raw = ""
    payload = {}
    parse_error = ""
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        if not isinstance(payload, dict):
            parse_error = f"payload is {type(payload).__name__}, not dict"
            payload = {}
    except Exception as exc:  # noqa: BLE001
        parse_error = f"{type(exc).__name__}: {exc}"

    cwd = ""
    try:
        cwd = os.getcwd()
    except Exception as exc:  # noqa: BLE001
        cwd = f"getcwd_failed:{type(exc).__name__}"

    prior, nxt, state_detail = _bump_state()

    # The transcript, item 4. Recorded as readability plus size, never content:
    # a transcript carries the whole session and this log is committed to a PR.
    transcript_path = payload.get("transcript_path")
    transcript = {"present": bool(transcript_path)}
    if isinstance(transcript_path, str) and transcript_path:
        ok, detail = _read_text(transcript_path)
        transcript.update({"readable": ok, "detail": detail})

    line = {
        "ts": time.time(),
        # The whole payload, so a field nobody thought to ask about (item 3's
        # prompt_id among them) is in the record rather than needing a re-run.
        "payload": payload,
        "payload_keys": sorted(payload.keys()),
        "hook_event_name": payload.get("hook_event_name"),
        "tool_name": payload.get("tool_name"),
        "session_id": payload.get("session_id"),
        "prompt_id": payload.get("prompt_id"),
        "has_prompt_text": isinstance(payload.get("prompt"), str)
        and bool(payload.get("prompt")),
        "agent_id": payload.get("agent_id"),
        "agent_type": payload.get("agent_type"),
        "transcript": transcript,
        "project": _project_visible(cwd),
        "state": {"read": prior, "wrote": nxt, "detail": state_detail},
        "pid": os.getpid(),
        "parse_error": parse_error,
        "raw_len": len(raw),
    }

    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(line) + "\n")
    except Exception:  # noqa: BLE001 - recording must never break the session
        pass

    # Checked FIRST: the halt arm is the stronger claim, and a payload carrying
    # both sentinels should exercise it rather than the deny.
    if _canary_halt(payload):
        # The prototype's `_halt` shape: the SDK's turn-ending pair PLUS a deny.
        # `options.py:441` builds exactly this, and `:363-367` records that the
        # pair ends the turn only AFTER the call runs. Both halves are printed
        # here so Cowork is measured against the real shape, not a guess at it.
        print(
            json.dumps(
                {
                    # `continue`, NOT `continue_`. The Python SDK renames
                    # `continue_` -> `continue` in `_convert_hook_output_for_cli`
                    # (`_internal/query.py:62-74`), and that runs only on CALLBACK
                    # output. This is a COMMAND hook: its stdout goes straight to
                    # the CLI with no SDK in the path, so `continue_` would be an
                    # unrecognised key and the stop silently dropped. Item 9 would
                    # then have measured a plain deny and reported "a halt does not
                    # end a Cowork turn" when no halt was ever sent -- the exact
                    # silent false negative the VOID gate exists to prevent.
                    # The prototype's `_halt` (`options.py:442`) spells it
                    # `continue_` and is CORRECT, because it is a callback.
                    # Caught by Praise on the hand-install, 2026-10-19.
                    "continue": False,
                    "stopReason": HALT_REASON,
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": HALT_REASON,
                    },
                }
            )
        )
        return

    if _canary_deny(payload):
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": DENY_REASON,
                    }
                }
            )
        )
        return

    print("{}")


if __name__ == "__main__":
    main()
