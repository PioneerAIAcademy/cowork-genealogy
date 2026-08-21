"""Adapt a hosted feedback bundle's session transcript into the harness's own
`tool_calls` shape, so the guardrail detectors in `harness.skill_invocation` can
be replayed over real submitted sessions (issue #1558).

The bundle's `session-log.jsonl` is a **raw Claude Code transcript** — the
feedback endpoint (`apps/server/app/feedback.py::_filter_transcript`) drops lines
by `type`/`cwd` but appends each surviving line verbatim, so each line is
`{"type": "user"|"assistant", "message": {"content": [blocks]}, ...}` with
`tool_use` blocks on assistant messages and `tool_result` blocks on user
messages. This walks those blocks into the flat
`{"tool", "args", "response_summary", "is_error"}` entries the detectors read
(documented at `harness/skill_invocation.py:9-14`), mirroring
`e2e/orchestrator.py`'s message loop and result join (`apply_tool_result`).

Pure and stdlib-only (keeps callers' "no Claude Agent SDK import" posture). Reads
only the path handed in, via `parse_jsonl` (never raises on a truncated final
line). **No bundle-derived data may be committed** — this only ever runs over
bundles unpacked outside the repo (root `CLAUDE.md`; `docs/alpha-feedback-guide.md`).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from e2e.subagent_capture import parse_jsonl

# The marker line `_filter_transcript` prepends when it trims a >20 MB log
# (`apps/server/app/feedback.py`). A session invoked before the cut is invisible,
# so a violation in a truncated session is unattributable — callers bucket these
# separately rather than reading a finding from them.
_TRUNCATION_TYPE = "_truncation_note"


def adapt_bundle_transcript(path: Path) -> dict[str, Any]:
    """Return `{"tool_calls", "truncated", "session_ids"}` for one bundle's
    `session-log.jsonl`.

    - `tool_calls`: one entry per assistant `tool_use` block, with `is_error`
      joined from the matching user `tool_result` (by `tool_use_id`).
    - `truncated`: the log carried a `_truncation_note` line.
    - `session_ids`: distinct `sessionId`s seen, in first-seen order — a resumed
      session can fork its id, so callers must not assume one transcript is one
      session.
    """
    tool_calls: list[dict[str, Any]] = []
    by_tool_use_id: dict[str, dict[str, Any]] = {}
    session_ids: list[str] = []
    seen_sids: set[str] = set()
    truncated = False
    # Records the adapter actually recognised (a user/assistant line with a
    # `message.content` list). Zero of these WITH non-blank lines present means
    # the transcript could not be adapted — a shape mismatch #1558 item 3
    # requires naming — which is distinct from a session that simply made no
    # tool calls (adapted fine, just quiet). An empty `tool_calls` can't tell
    # those two apart; this can.
    adapted_records = 0

    for rec in parse_jsonl(path):
        if not isinstance(rec, dict):
            continue
        if rec.get("type") == _TRUNCATION_TYPE:
            truncated = True
            continue

        sid = rec.get("sessionId")
        if isinstance(sid, str) and sid not in seen_sids:
            seen_sids.add(sid)
            session_ids.append(sid)

        message = rec.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        adapted_records += 1

        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "tool_use":
                entry: dict[str, Any] = {
                    "tool": block.get("name", ""),
                    "args": dict(block.get("input") or {}),
                    "response_summary": None,
                    # Default False; the matching tool_result flips it (below).
                    # `is_error` on a tool_result may be absent, explicitly
                    # false, or true — measured across real transcripts, all
                    # three occur. `bool(block.get("is_error"))` reads every one
                    # correctly; the default here must stay False so a missing
                    # key reads as success, not be left unset (the #999
                    # regression, re-created if this default is dropped).
                    "is_error": False,
                }
                tool_calls.append(entry)
                block_id = block.get("id")
                if isinstance(block_id, str):
                    by_tool_use_id[block_id] = entry
            elif btype == "tool_result":
                tid = block.get("tool_use_id")
                entry = by_tool_use_id.get(tid) if isinstance(tid, str) else None
                if entry is not None:
                    entry["is_error"] = bool(block.get("is_error"))

    return {
        "tool_calls": tool_calls,
        "truncated": truncated,
        "session_ids": session_ids,
        "adapted_records": adapted_records,
    }
