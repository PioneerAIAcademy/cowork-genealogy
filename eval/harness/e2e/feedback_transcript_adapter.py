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

A bundle also carries a transcript per subagent (`_feedback/subagents/`, and
`_feedback/sessions/<sid>/` for any session other than the newest), because two
guardrail owner arms do their protected write from inside an agent. Use
`adapt_bundle` for the whole bundle — it SPLICES each child's calls in at the
spawning `Agent` call, which `adapt_bundle_transcript` alone cannot do and which
appending would get wrong in the one direction that manufactures findings.

Pure and stdlib-only (keeps callers' "no Claude Agent SDK import" posture). Reads
only the paths handed in, via `parse_jsonl` (never raises on a truncated final
line). **No bundle-derived data may be committed** — this only ever runs over
bundles unpacked outside the repo (root `CLAUDE.md`; `docs/alpha-feedback-guide.md`).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from e2e.subagent_capture import parse_jsonl

# The marker line `_filter_transcript` prepends when it trims a >20 MB log
# (`apps/server/app/feedback.py`). A session invoked before the cut is invisible,
# so a violation in a truncated session is unattributable — callers bucket these
# separately rather than reading a finding from them.
_TRUNCATION_TYPE = "_truncation_note"


def _response_summary(content: Any) -> str | None:
    """The tool_result's content as a string, for `did_not_land`'s no-project
    clause. That clause is a SUBSTRING match on the bare name `no_project`, not
    a parse — `response_summary` arrives single-encoded, double-encoded and
    truncated across the corpus, so serialising the block whole is both
    sufficient and closer to what the orchestrator stores (a response under 500
    chars goes through VERBATIM as the raw MCP envelope). Returns None only for
    a genuinely absent content, so an absent field stays distinguishable from an
    empty one."""
    if content is None:
        return None
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content)
    except (TypeError, ValueError):
        return str(content)


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
                # `input` is untrusted JSON from the hosted SDK line shape. It is
                # normally an object, but a number/bool/list is valid JSONL, and
                # `dict(42)` raises TypeError — which is NOT in the (ValueError,
                # OSError) the scanner catches, so one bad block would take the
                # whole directory scan down. Coerce a non-dict to {}.
                inp = block.get("input")
                entry: dict[str, Any] = {
                    "tool": block.get("name", ""),
                    # The block's own id. A subagent's `agent-*.meta.json` names
                    # the `Agent`/`Task` call that spawned it by this id, and
                    # that is the only way to SPLICE its calls in at the right
                    # index instead of appending them (see `adapt_bundle`).
                    "tool_use_id": block.get("id"),
                    "args": inp if isinstance(inp, dict) else {},
                    # Filled in from the matching tool_result below. It must NOT
                    # stay None: `did_not_land`'s second clause reads this field
                    # for the no-project answer (issue #1695), which is
                    # deliberately the one failure that does NOT set `is_error`
                    # (`tool-result.ts`), and Phase 1b put twelve tools on that
                    # return shape. With None the clause can never fire over a
                    # bundle, so a `research_append` that wrote nothing is
                    # counted as a landed protected write and manufactures a
                    # violation — that function's own docstring says so.
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
                    entry["response_summary"] = _response_summary(block.get("content"))

    return {
        "tool_calls": tool_calls,
        "truncated": truncated,
        "session_ids": session_ids,
        "adapted_records": adapted_records,
    }


# --- the whole bundle: one group per session, children spliced --------------
#
# A bundle now carries a subagent's transcript as its own file, because two
# guardrail owner arms do their protected write from inside an agent (#1880).
# Those calls must be SPLICED into the parent's list at the index of the
# `Agent`/`Task` call that spawned them, never appended:
# `find_unguarded_protected_writes` scans the 40 entries BY INDEX before each
# write for the `Skill` call that authorised it, and the summons lives in the
# parent stream while the write lives in the child's. Appending puts the write
# far from its own summons and reports a violation that never happened — a
# fabricated non-zero, which is worse than a known zero because it is the
# number people act on.

_ACTIVE_GROUP = "active"


def _parse_meta(path: Path) -> dict[str, Any] | None:
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None
    return meta if isinstance(meta, dict) else None


def _splice_after(base: list[dict[str, Any]], child: list[dict[str, Any]], anchor: Any) -> bool:
    """Insert `child` immediately after the entry whose `tool_use_id` is
    `anchor`. The index is resolved HERE, on every call: several transcripts can
    anchor into the same turn, and each insertion shifts every later index, so a
    precomputed position is the natural wrong implementation."""
    if not isinstance(anchor, str):
        return False
    for i, entry in enumerate(base):
        if entry.get("tool_use_id") == anchor:
            base[i + 1 : i + 1] = child
            return True
    return False


def _group_dirs(bundle_dir: Path) -> list[tuple[str, Path, Path]]:
    """`(group name, parent transcript, subagents dir)` per session in the bundle.

    The active session keeps the historical names; any other session ships under
    `_feedback/sessions/<sid>/` WITH its own parent, because a child is only
    anchorable beside the parent holding the call that spawned it."""
    fb = bundle_dir / "_feedback"
    groups = [(_ACTIVE_GROUP, fb / "session-log.jsonl", fb / "subagents")]
    sessions = fb / "sessions"
    if sessions.is_dir():
        for child in sorted(p for p in sessions.iterdir() if p.is_dir()):
            groups.append((child.name, child / "session-log.jsonl", child / "subagents"))
    return groups


def adapt_bundle(bundle_dir: Path) -> dict[str, Any]:
    """Every transcript in one bundle, as one adapted list per session group.

    Returns `groups` — `[{"name", "tool_calls"}]` — and detectors must run
    **per group**, never over the concatenation: one session's `Skill` call
    must not vouch for another session's write, which appending would let it do
    within the 40-entry window (a false NEGATIVE, quieter than a false positive
    and just as wrong). `tool_calls` is the flattened list, for counts only.

    Nothing is filtered by `agentType`. The failure this evidence is most needed
    for is a silent fallback to a general-purpose stand-in that binds none of
    the declared agent's tools (#939), and an allow-list drops exactly that
    transcript.

    Decoding errors are caught PER FILE. `scan_feedback_bundle` wraps its call
    because one cp1252 byte once killed a whole directory scan; catching around
    the whole set instead would let one bad subagent file discard the parent's
    findings.
    """
    bundle_dir = Path(bundle_dir)
    groups: list[dict[str, Any]] = []
    session_ids: list[str] = []
    seen_sids: set[str] = set()
    truncated = False
    adapted_records = 0
    unanchored: list[str] = []
    unreadable: list[str] = []
    anchored_agents: set[str] = set()
    subagent_transcripts = 0

    for name, parent_path, subagents_dir in _group_dirs(bundle_dir):
        if not parent_path.is_file():
            continue
        try:
            parent = adapt_bundle_transcript(parent_path)
        except (ValueError, OSError):
            unreadable.append(f"{name}/session-log.jsonl")
            continue
        calls: list[dict[str, Any]] = parent["tool_calls"]
        truncated = truncated or parent["truncated"]
        adapted_records += parent["adapted_records"]
        for sid in parent["session_ids"]:
            if sid not in seen_sids:
                seen_sids.add(sid)
                session_ids.append(sid)

        children: list[tuple[int, str, Path, dict[str, Any] | None]] = []
        if subagents_dir.is_dir():
            for path in sorted(subagents_dir.glob("*.jsonl")):
                meta = _parse_meta(path.with_suffix(".meta.json"))
                depth = (meta or {}).get("spawnDepth")
                # A missing or non-integer depth sorts last, after every
                # well-formed one, so it can still anchor into what landed.
                order = depth if isinstance(depth, int) else 1 << 30
                children.append((order, path.stem, path, meta))

        # Ascending depth is what makes nesting work for free: by the time a
        # depth-2 transcript is placed, its spawning call is already in the list.
        for _order, stem, path, meta in sorted(children, key=lambda c: (c[0], c[1])):
            subagent_transcripts += 1
            try:
                child = adapt_bundle_transcript(path)
            except (ValueError, OSError):
                unreadable.append(f"{name}/subagents/{path.name}")
                continue
            anchor = (meta or {}).get("toolUseId")
            if not _splice_after(calls, child["tool_calls"], anchor):
                # No meta, or an id matching nothing here. EXCLUDED and named —
                # never appended.
                unanchored.append(stem)
                continue
            truncated = truncated or child["truncated"]
            adapted_records += child["adapted_records"]
            agent_type = (meta or {}).get("agentType")
            if isinstance(agent_type, str) and agent_type:
                anchored_agents.add(agent_type.split(":", 1)[-1])

        groups.append({"name": name, "tool_calls": calls})

    return {
        "groups": groups,
        "tool_calls": [c for g in groups for c in g["tool_calls"]],
        "truncated": truncated,
        "session_ids": session_ids,
        "adapted_records": adapted_records,
        "unanchored_subagents": unanchored,
        "unreadable_transcripts": unreadable,
        "anchored_agents": sorted(anchored_agents),
        "subagent_transcripts": subagent_transcripts,
    }
