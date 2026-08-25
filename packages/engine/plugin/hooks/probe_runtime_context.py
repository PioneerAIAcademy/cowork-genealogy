#!/usr/bin/env python3
"""DIAGNOSTIC PROBE — never merge to main. Records what the runtime resolved.

Two questions no offline check can answer, both recorded by observing a real
`PreToolUse` payload rather than by reading a declaration:

1. **Does an agent's frontmatter `effort:` bind?** `AgentDefinition.effort`
   exists in the pinned SDK, but the plugin ships agents as markdown and the
   hosted path stages them as files — the route with open upstream reports of
   `effort` being silently dropped while `model` from the same block is honored.
   The payload carries `effort`, so comparing the value seen inside a subagent's
   tool calls against the main thread's answers it directly.
2. **What does a session actually expose?** The server prefix on each tool name
   and whether an `agent_id` is present are the ground truth behind the
   tool-binding issues; every lint we have stops at the declared name.

**This never denies.** It returns an empty decision on every path, including
every failure path — an exception here would fail a tool call the user was
entitled to make. It is additive: `guard_project_files.py` and its matcher are
untouched, because that matcher is part of a guardrail rather than packaging.

`tool_input` is deliberately not recorded — it carries record content, and the
probe needs shapes rather than payloads.

Stdlib only, no network, `encoding="utf-8"` everywhere: this runs in the VM.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Written next to the project so a tester can find and attach it. Named to be
# obviously a diagnostic artifact rather than project state.
_OUT_DIRNAME = "_probe"
_OUT_FILENAME = "runtime-context.jsonl"

# Recorded verbatim when present. Everything else in the payload is reported
# only as a key name, so a field we did not anticipate still shows up.
_SCALARS = (
    "effort",
    "agent_id",
    "agent_type",
    "tool_name",
    "tool_use_id",
    "hook_event_name",
    "permission_mode",
    "session_id",
    "prompt_id",
    "cwd",
    "transcript_path",
)


def _out_path(payload: dict) -> Path:
    """Project dir when we can see it, else the system temp dir.

    Never raises: an unusable cwd falls back rather than failing the call.
    """
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd:
        candidate = Path(cwd) / _OUT_DIRNAME
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            if os.access(candidate, os.W_OK):
                return candidate / _OUT_FILENAME
        except OSError:
            pass
    return Path(tempfile.gettempdir()) / _OUT_FILENAME


def _record(payload: dict) -> None:
    row = {k: payload.get(k) for k in _SCALARS if k in payload}
    # The shape itself is a finding — `agent_id` is absent from the one payload
    # anyone has recorded, and whether it appears for a subagent is the question.
    row["_payload_keys"] = sorted(payload)
    line = json.dumps(row, ensure_ascii=False, sort_keys=True)
    with _out_path(payload).open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def main() -> None:
    try:
        raw = json.loads(sys.stdin.read() or "{}")
        payload = raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError, ValueError):
        payload = {}

    try:
        _record(payload)
    except Exception:  # noqa: BLE001 — a probe must never fail a tool call
        pass

    # Empty decision == allow. Same protocol as the guard's allow path.
    print(json.dumps({}))
    sys.exit(0)


if __name__ == "__main__":
    main()
