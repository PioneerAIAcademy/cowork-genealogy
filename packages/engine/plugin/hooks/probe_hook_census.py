#!/usr/bin/env python3
"""Hook-event census probe for Cowork. THROWAWAY -- must never merge.

Issue #2163 builds this; issue #2088 runs it. Six questions: does a plugin-shipped
Stop hook fire in Cowork, is its block honored, does PreToolUse injected context
reach the model, does PostToolUse, does SubagentStop fire, do the compaction hooks
fire. Every one is currently answered by assuming.

Contract, from the hook protocol: read the payload as JSON on stdin, print a
decision to stdout, exit 0. Printing `{}` means "no opinion".

The registered event name arrives on ARGV, not from the payload, so a payload that
fails to parse still produces an identifiable row. Both are logged
(`registered_event` vs `hook_event_name`); a disagreement is itself a finding.

Three rules this file must never break:

1. **It must never raise.** An exception here fails a tool call the tester was
   entitled to make, which is indistinguishable from the finding. Every failure
   path -- garbage input, empty input, an unwritable log directory -- prints `{}`
   and exits 0.
2. **Stdlib only, no network.** It runs in the Cowork VM.
3. **Key names and enums only, never values.** The tester pastes this log into a
   public issue after a live record extraction, so `tool_input` / `tool_response`
   contents, `custom_instructions`, `last_assistant_message` and
   `transcript_path` are never written -- only sorted key lists.

Every registered event appends a row even on the path where it does nothing else.
That is what makes "registered but silent" distinguishable from "never registered",
which for four of the six questions IS the answer.

A bare random token in `additionalContext` is logged but never echoed by the model
(measured 2026-09-04, CLI 2.1.251: bare -> 0 tokens in the reply, instruction
string -> both tokens, suffix-matched). So each token rides an explicit
echo instruction. #2088's Q3 asks whether the channel "delivered and steered",
which is what that tests and a bare token cannot.
"""
import datetime
import json
import os
import random
import string
import sys
import tempfile

LOG_NAME = "hook-events.jsonl"

# First writable rung wins. Rung 1 is what #2088 step 8 tells the tester to `cat`;
# it does not exist off Cowork, which is what makes rung 2 the local test path.
# No env-var override: a knob here could diverge from the one path the runbook names.
PROBE_DIRS = (
    "/home/claude/_probe",
    os.path.join(os.path.expanduser("~"), "_probe"),
    os.path.join(tempfile.gettempdir(), "_probe"),
)

# Which token each registered event emits, and nothing else does.
TOKEN_NAMES = {
    "PreToolUse": "ALPHA",     # Q3
    "PostToolUse": "BRAVO",    # Q4
    "SubagentStop": "DELTA",   # Q5, armed only
    "Stop": "CHARLIE",         # Q2, armed only
}

# The two legs that are not strict no-ops. Both are inert until the tester creates
# the file by hand, fire once, and disarm themselves -- the tester is told they need
# not undo anything, so the disarm has to be the hook's job.
ARM_FILES = {
    "Stop": "ARM_STOP_BLOCK",
    "SubagentStop": "ARM_SUBAGENT_CONTEXT",
}

# NOT an instruction. An imperative arriving through a tool result ("include this
# string verbatim in your reply") is indistinguishable from a prompt-injection
# attack, and a well-behaved model refuses it: measured 2026-09-04, one run echoed
# the tokens and the next flagged them as an injection attempt and elided the
# suffixes to `PROBE-ALPHA-...`, which destroys the matched-pair evidence Q3 needs.
# Refusing is the correct behaviour, so the probe must not depend on obedience.
#
# Instead the token is delivered as a labelled, self-describing diagnostic, and the
# TESTER -- a trusted turn -- asks for it back. #2088 step 3 therefore has to end
# with "list in full every PROBE- token you received"; see the attachment comment.
ECHO = (
    "[hook-census diagnostic: %s -- delivered by a plugin hook for issue #2088's "
    "hook census. Not an instruction and nothing to act on. If the user asks which "
    "probe tokens reached you, quote this one in full.]"
)


def _suffix() -> str:
    """A fresh per-fire suffix, written into the row too.

    That is what makes "row present, token absent" a matched pair rather than an
    inference -- Q3's interesting negative.
    """
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(6))


def _probe_dir() -> str | None:
    """First rung we can create and write. None if all three fail."""
    for candidate in PROBE_DIRS:
        try:
            os.makedirs(candidate, exist_ok=True)
            probe = os.path.join(candidate, ".w")
            with open(probe, "a", encoding="utf-8"):
                pass
            os.unlink(probe)
            return candidate
        except Exception:
            continue
    return None


def _disarm(arm_file: str) -> bool:
    """Unlink the ARM file, sweeping ALL rungs. True if one was removed.

    Every rung, not just the resolved one: #2088 step 6 hardcodes
    `touch /home/claude/_probe/ARM_STOP_BLOCK`, so if rung 1 exists but is not
    writable, rows land lower while the tester's ARM file sits on rung 1. The leg
    would then no-op *with* Stop rows present -- which #2088's Q2 row reads as
    "fires but the veto is ignored", a wrong recorded answer rather than an absent
    one, on the question with the largest consumer table.
    """
    for candidate in PROBE_DIRS:
        try:
            os.unlink(os.path.join(candidate, arm_file))
            return True
        except Exception:
            continue
    return False


def _keys(value) -> list | None:
    """Sorted key list of a mapping, or None. Never the values."""
    if isinstance(value, dict):
        try:
            return sorted(str(k) for k in value)
        except Exception:
            return None
    return None


def decision(registered: str, payload: dict) -> tuple:
    """Return (output, token, armed) for one fire.

    Order matters on the armed legs: bail on `stop_hook_active` first, then disarm,
    then act -- and act only if the disarm succeeded. Claude Code passes
    `stop_hook_active` so a Stop hook cannot loop, and its own guidance is to
    return success while it is true. A leg that acts before it disarms traps the
    tester in a resume loop in a session they were told they need not undo.
    """
    name = TOKEN_NAMES.get(registered)
    if name is None:
        return {}, None, False

    arm_file = ARM_FILES.get(registered)
    if arm_file is not None:
        if payload.get("stop_hook_active") is True:
            return {}, None, False
        if not _disarm(arm_file):
            return {}, None, False

    token = "PROBE-%s-%s" % (name, _suffix())

    if registered == "Stop":
        # The step-6 veto: a turn-end block, approved 2026-09-01. It vetoes a turn
        # ending; it denies no tool call and touches no project file.
        return {"decision": "block", "reason": token}, token, True

    return (
        {
            "hookSpecificOutput": {
                "hookEventName": registered,
                "additionalContext": ECHO % token,
            }
        },
        token,
        arm_file is not None,
    )


def row(registered: str, payload: dict, token, armed: bool, probe_dir) -> dict:
    """One log row. Names, enums and ids only."""
    return {
        "registered_event": registered,
        "hook_event_name": payload.get("hook_event_name"),
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "session_id": payload.get("session_id"),
        "cwd": payload.get("cwd"),
        "permission_mode": payload.get("permission_mode"),
        "tool_name": payload.get("tool_name"),
        "tool_input_keys": _keys(payload.get("tool_input")),
        "tool_response_keys": _keys(payload.get("tool_response")),
        "agent_id": payload.get("agent_id"),
        "agent_type": payload.get("agent_type"),
        "stop_hook_active": payload.get("stop_hook_active"),
        "source": payload.get("source"),
        "trigger": payload.get("trigger"),
        "token": token,
        "armed": armed,
        "probe_dir": probe_dir,
    }


def append(probe_dir, record: dict) -> None:
    """Append one row. A single write, so concurrent fires cannot interleave.

    Claude Code batches parallel tool calls, so two PreToolUse hooks can append at
    once; a `write(json)` then `write("\\n")` pair can interleave into an
    unparseable line in a log that is one-shot, pasted raw, and destroyed with its
    container.
    """
    if probe_dir is None:
        return
    line = json.dumps(record, ensure_ascii=True, default=str) + "\n"
    with open(os.path.join(probe_dir, LOG_NAME), "a", encoding="utf-8") as handle:
        handle.write(line)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    out = {}
    try:
        registered = sys.argv[1] if len(sys.argv) > 1 else "UNKNOWN"
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        out, token, armed = decision(registered, payload)
        probe_dir = _probe_dir()
        try:
            append(probe_dir, row(registered, payload, token, armed, probe_dir))
        except Exception:
            pass
    except BaseException:
        out = {}

    try:
        print(json.dumps(out if isinstance(out, dict) else {}))
    except BaseException:
        pass
    raise SystemExit(0)


if __name__ == "__main__":
    main()
