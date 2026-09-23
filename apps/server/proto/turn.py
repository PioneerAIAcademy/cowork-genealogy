#!/usr/bin/env python3
"""D9-10 acceptance: two real turns through web tier -> queue -> shim -> worker, the
second resuming the first's SDK session in a fresh worker process. Billed (two short
Sonnet turns); needs a stack with ANTHROPIC_API_KEY in the worker's environment
(``make proto-turn`` exports it from the host env or eval/.env before `up`).

    uv run python proto/turn.py [--base http://127.0.0.1:8085] [--pg-dsn ...] [--deadline-s 300]

Turn 1 asks for a calendar conversion that needs ``convert_calendar``; turn 2 asks the
model to repeat the date it just converted -- answerable only from the resumed
transcript. Every claim is a Postgres row (PASS/FAIL table, exit 1 on any FAIL, 2 when
the tier is unreachable):

  turn 1   >= 1 agent_event row; a tool_use and a tool_result naming convert_calendar;
           session_entries > 0 for sessions.sdk_session_id; tool_calls >= 1 with the
           convert_calendar row decision allow; turns.completed_at set; cost_usd > 0;
           the token columns summed from session_entries (output_tokens > 0, and the
           input side non-empty)
  turn 2   session_entries grew; the reply text mentions 1751; completed; cost_usd > 0;
           token columns filled for this turn alone (output_tokens > 0)

``--kill`` (D14, ``make proto-kill``) runs one turn instead: a ``place_search`` question,
the worker container killed the moment the call's ``tool_calls`` row appears (its
PreToolUse hook, before the tool runs) and started again, the shim's redelivery resumed
in the fresh process. Checks: redelivered (receive_count >= 2); completed with cost;
the same SDK session (``sessions.sdk_session_id`` unchanged) with ``session_entries``
grown past the kill; a ``place_search`` call completed with a duration (criterion 4);
its result carried no reconnect instruction (the bearer reached the tool server); the
reply names Nauvoo. ``--session <id>`` runs it on a seeded session (proto/seed.py).

The kill is generalised for the resume probes (D18): ``--kill-on <bare tool name>``
(default ``place_search``; ``Agent`` lands it during a delegation), ``--kill-after-s
<n>`` (default 0, the moment the row appears; ~15 s puts a subagent mid-work) and
``--text ...`` / ``--text-file <path>`` for the message. ``--background-only`` (with
``--kill-on Agent``) waits for an ``Agent`` call whose transcript input carries
``run_in_background: true`` and ignores foreground delegations -- the only way to land
the kill on the case the worker's resume rule exists for (D17, 2026-09-21). The two checks that are about
the default text (the bearer, Nauvoo) run only with the default text; the rest stay.
Whatever the checks say, an evidence block follows ``turn_done``: the ``turns`` row, the
``tool_calls`` and ``session_entries`` rows written after the kill (the CLI's own words
on resume, so they survive ``proto-down -v``), research.json's array-section sizes
before the kill and after ``turn_done``, and the ``text`` events after the kill.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import psycopg

Check = tuple[str, bool, str]

TEXT_1 = "What is 4 April 1751 in the Gregorian calendar? Use convert_calendar and answer in one line."
TEXT_2 = "Repeat the date you just converted, in one line."
TOOL = "convert_calendar"

TEXT_KILL = ("Use place_search to find the standardized FamilySearch place name for Nauvoo, Illinois, "
             "then answer in one line with the name it returned.")
KILL_TOOL = "place_search"
# What a FamilySearch tool answers when its bearer is empty or rejected.
REAUTH = re.compile(r"reconnect|log ?in|authenticat|unauthori[sz]ed|\b401\b", re.I)


def post_message(client: httpx.Client, base: str, session_id: str, text: str) -> str:
    r = client.post(f"{base}/api/sessions/{session_id}/messages", json={"text": text})
    r.raise_for_status()
    return r.json()["turn_id"]


def wait_turn_done(client: httpx.Client, base: str, session_id: str, turn_id: str, deadline_s: float) -> tuple[int, float]:
    """Poll GET /events until the turn's turn_done; ``(seq, elapsed_s)``."""
    after = 0
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        page = client.get(f"{base}/api/sessions/{session_id}/events", params={"after": after}).json()
        for ev in page["events"]:
            event = ev.get("event") or {}
            if ev.get("type") == "agent_event" and event.get("kind") == "turn_done" and event.get("turn_id") == turn_id:
                return ev["seq"], time.monotonic() - t0
        after = page["next_after"]
        time.sleep(1.0)
    raise TimeoutError(f"no turn_done for {turn_id} within {deadline_s:.0f}s")


def post_and_wait(client: httpx.Client, base: str, session_id: str, text: str, deadline_s: float) -> tuple[str, int, float]:
    """POST one message and wait for its turn_done; ``(turn_id, seq, elapsed_s)``."""
    turn_id = post_message(client, base, session_id, text)
    seq, elapsed = wait_turn_done(client, base, session_id, turn_id, deadline_s)
    return turn_id, seq, elapsed


def db(dsn: str, sql: str, params: tuple) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute(sql, params).fetchall()


def one(dsn: str, sql: str, params: tuple) -> Any:
    rows = db(dsn, sql, params)
    return rows[0][0] if rows else None


def run(base: str, dsn: str, deadline_s: float) -> tuple[list[Check], dict[str, Any]]:
    checks: list[Check] = []
    figures: dict[str, Any] = {}
    with httpx.Client(timeout=30.0) as client:
        session = client.post(f"{base}/api/sessions", json={"title": "proto-turn"}).json()
        session_id = session["id"]
        figures["session_id"] = session_id

        # -- turn 1 ------------------------------------------------------------------
        try:
            turn1, seq1, wall1 = post_and_wait(client, base, session_id, TEXT_1, deadline_s)
        except Exception as exc:  # noqa: BLE001 - a timeout is a FAIL, not a crash
            checks.append(("turn 1 reached turn_done", False, f"{type(exc).__name__}: {exc}"))
            return checks, figures
        checks.append(("turn 1 reached turn_done", True, f"{wall1:.0f}s"))
        figures["turn1"] = {"turn_id": turn1, "wall_s": round(wall1, 1)}

        agent_rows = one(dsn, "SELECT count(*) FROM session_events WHERE session_id = %s AND kind NOT IN ('user_msg', 'turn_done')", (session_id,))
        checks.append(("turn 1: >= 1 agent_event row", agent_rows >= 1, f"rows={agent_rows}"))
        tool_use = one(dsn, "SELECT count(*) FROM session_events WHERE session_id = %s AND kind = 'tool_use' AND payload->>'tool' LIKE %s", (session_id, f"%{TOOL}"))
        tool_result = one(dsn, "SELECT count(*) FROM session_events WHERE session_id = %s AND kind = 'tool_result' AND payload->>'tool' LIKE %s", (session_id, f"%{TOOL}"))
        checks.append((f"turn 1: tool_use and tool_result rows name {TOOL}", tool_use >= 1 and tool_result >= 1, f"tool_use={tool_use} tool_result={tool_result}"))
        sdk_session_id = one(dsn, "SELECT sdk_session_id FROM sessions WHERE session_id = %s", (session_id,))
        checks.append(("turn 1: sessions.sdk_session_id set", bool(sdk_session_id), f"sdk_session_id={sdk_session_id}"))
        entries1 = one(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_session_id or "",))
        checks.append(("turn 1: session_entries > 0 for the SDK session", entries1 > 0, f"entries={entries1}"))
        calls = one(dsn, "SELECT count(*) FROM tool_calls WHERE turn_id = %s", (turn1,))
        allowed = one(dsn, "SELECT count(*) FROM tool_calls WHERE turn_id = %s AND tool_name LIKE %s AND decision = 'allow'", (turn1, f"%{TOOL}"))
        checks.append((f"turn 1: tool_calls >= 1, the {TOOL} row decision allow", calls >= 1 and allowed >= 1, f"tool_calls={calls} allowed={allowed}"))
        row = db(dsn, "SELECT completed_at, outcome, cost_usd, num_turns, duration_ms FROM turns WHERE turn_id = %s", (turn1,))
        completed1, _, cost1, num1, dur1 = row[0] if row else (None, None, None, None, None)
        checks.append(("turn 1: turns.completed_at set", completed1 is not None, f"row={row}"))
        checks.append(("turn 1: turns.cost_usd > 0", cost1 is not None and float(cost1) > 0, f"cost_usd={cost1}"))
        tokens1 = tokens(dsn, turn1)
        checks.append(("turn 1: token columns summed from session_entries", tokens_filled(tokens1), f"tokens={tokens1}"))
        figures["turn1"].update({"cost_usd": float(cost1) if cost1 is not None else None, "num_turns": num1,
                                 "duration_ms": dur1, "events": agent_rows, "entries": entries1, "tool_calls": calls,
                                 "tokens": tokens1})

        # -- turn 2: the cross-process resume --------------------------------------------
        try:
            turn2, seq2, wall2 = post_and_wait(client, base, session_id, TEXT_2, deadline_s)
        except Exception as exc:  # noqa: BLE001
            checks.append(("turn 2 reached turn_done", False, f"{type(exc).__name__}: {exc}"))
            return checks, figures
        checks.append(("turn 2 reached turn_done", True, f"{wall2:.0f}s"))
        figures["turn2"] = {"turn_id": turn2, "wall_s": round(wall2, 1)}

        entries2 = one(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_session_id or "",))
        checks.append(("turn 2: session_entries grew", entries2 > entries1, f"{entries1} -> {entries2}"))
        user_seq = one(dsn, "SELECT max(seq) FROM session_events WHERE session_id = %s AND kind = 'user_msg' AND payload->>'turn_id' = %s", (session_id, turn2))
        texts = db(dsn, "SELECT payload->>'text' FROM session_events WHERE session_id = %s AND kind = 'text' AND seq > %s ORDER BY seq", (session_id, user_seq or 0))
        reply = " ".join(t[0] or "" for t in texts)
        checks.append(("turn 2: the reply mentions 1751", "1751" in reply, f"reply={reply[:200]!r}"))
        row2 = db(dsn, "SELECT completed_at, cost_usd, num_turns, duration_ms FROM turns WHERE turn_id = %s", (turn2,))
        completed2, cost2, num2, dur2 = row2[0] if row2 else (None, None, None, None)
        checks.append(("turn 2: completed with cost_usd > 0", completed2 is not None and cost2 is not None and float(cost2) > 0, f"row={row2}"))
        tokens2 = tokens(dsn, turn2)
        # The two turns' output columns must fit inside the session's whole output: a turn 2
        # summed from seq 0 would carry turn 1's tokens again and overshoot it.
        session_output = one(dsn, SESSION_OUTPUT_SQL, (sdk_session_id or "",)) or 0
        before1 = one(dsn, "SELECT entries_seq_before FROM turns WHERE turn_id = %s", (turn1,))
        before2 = one(dsn, "SELECT entries_seq_before FROM turns WHERE turn_id = %s", (turn2,))
        own = (tokens1.get("output_tokens") or 0) + (tokens2.get("output_tokens") or 0) <= session_output
        checks.append(("turn 2: token columns cover this turn alone",
                       tokens_filled(tokens2) and own and before1 is not None and before2 is not None and before2 > before1,
                       f"output {tokens1.get('output_tokens')} + {tokens2.get('output_tokens')} vs session {session_output}; "
                       f"entries_seq_before {before1} -> {before2}"))
        figures["turn2"].update({"cost_usd": float(cost2) if cost2 is not None else None, "num_turns": num2,
                                 "duration_ms": dur2, "entries": entries2, "reply": reply[:200], "tokens": tokens2})
    return checks, figures


# -- the kill arm (D14, generalised for the D18 resume probes) --------------------------


@dataclass(frozen=True)
class KillSpec:
    """What ``--kill`` does: which call's PreToolUse row triggers the kill (a bare tool
    name -- ``place_search`` or ``Agent`` -- matched under any server spelling), how long
    after that row to wait, and the message. ``default_text`` gates the two checks that
    are about TEXT_KILL's answer."""

    kill_on: str = KILL_TOOL
    kill_after_s: float = 0.0
    text: str = TEXT_KILL
    session_id: str | None = None
    container: str = "proto-worker"
    background_only: bool = False

    @property
    def default_text(self) -> bool:
        return self.text == TEXT_KILL


def bare_name(tool_name: str) -> str:
    """``mcp__<server>__<name>`` -> ``<name>``; a built-in tool's name as is (the worker's
    ``options.bare_tool_name``, repeated here so this script imports no SDK)."""
    return tool_name.rsplit("__", 1)[-1] if tool_name.startswith("mcp__") else tool_name


def matches_bare(tool_name: str, bare: str) -> bool:
    """Whether a ``tool_calls.tool_name`` is ``bare`` under any spelling: exactly (a
    built-in such as ``Agent``) or as an MCP tool's bare name. Never a suffix match --
    ``place_search`` must not match ``place_search_all``, nor ``Agent`` a name that
    merely ends in it."""
    return tool_name == bare or (tool_name.startswith("mcp__") and bare_name(tool_name) == bare)


# The turn's Agent calls whose transcript tool_use input says run_in_background: true.
# tool_calls carries no input, so the row is joined to its session_entries tool_use by id.
BACKGROUND_AGENT_SQL = (
    "SELECT c.tool_name FROM tool_calls c "
    "JOIN sessions s ON s.session_id = c.session_id "
    "JOIN session_entries e ON e.session_id = s.sdk_session_id "
    "CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.entry->'message'->'content') = 'array' "
    "THEN e.entry->'message'->'content' ELSE '[]'::jsonb END) b "
    "WHERE c.turn_id = %s AND b->>'type' = 'tool_use' AND b->>'id' = c.tool_use_id "
    "AND b->'input'->>'run_in_background' = 'true' ORDER BY c.id"
)


def wait_for_tool_call(dsn: str, turn_id: str, tool: str, deadline_s: float, background_only: bool = False) -> str:
    """``"seen"`` once the turn has a tool_calls row whose name is ``tool`` (the
    PreToolUse hook writes it as the call starts) -- with ``background_only``, only an
    ``Agent`` row whose transcript input carries ``run_in_background: true``;
    ``"completed"`` if the turn finished without one (a kill would then land on
    nothing); ``"timeout"`` at the deadline."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        if background_only:
            names = db(dsn, BACKGROUND_AGENT_SQL, (turn_id,))
        else:
            names = db(dsn, "SELECT tool_name FROM tool_calls WHERE turn_id = %s ORDER BY id", (turn_id,))
        if any(matches_bare(n, tool) for (n,) in names):
            return "seen"
        if one(dsn, "SELECT completed_at FROM turns WHERE turn_id = %s", (turn_id,)) is not None:
            return "completed"
        time.sleep(0.2)
    return "timeout"


def docker(*args: str) -> None:
    subprocess.run(["docker", *args], check=True, capture_output=True, text=True, encoding="utf-8")


@dataclass
class KillRows:
    """What the checks read after ``turn_done``, gathered by ``run_kill`` so ``kill_checks``
    is a pure function of rows."""

    turn_row: tuple | None                 # (receive_count, completed_at, outcome, cost_usd)
    sdk_before: str | None
    sdk_after: str | None
    entries_at_kill: int
    entries_after: int
    kill_calls: list[tuple]                # (decision, duration_ms) for the kill-on tool
    summaries: list[str]                   # tool_result summaries of the kill-on tool
    reply: str


def kill_checks(rows: KillRows, spec: KillSpec) -> list[Check]:
    receive_count, completed, outcome, cost = rows.turn_row if rows.turn_row else (None, None, None, None)
    checks: list[Check] = [
        ("kill: the turn was redelivered (receive_count >= 2)", (receive_count or 0) >= 2, f"receive_count={receive_count}"),
        ("kill: completed with outcome ok and cost_usd > 0",
         completed is not None and outcome == "ok" and cost is not None and float(cost) > 0, f"row={rows.turn_row}"),
        ("kill: the same SDK session resumed, not a new one", bool(rows.sdk_before) and rows.sdk_after == rows.sdk_before,
         f"{rows.sdk_before} -> {rows.sdk_after}"),
        ("kill: session_entries grew past the kill", rows.entries_after > rows.entries_at_kill,
         f"{rows.entries_at_kill} -> {rows.entries_after}"),
        (f"kill: a {spec.kill_on} call completed with a duration (criterion 4)",
         any(d == "allow" and ms is not None for d, ms in rows.kill_calls), f"calls={rows.kill_calls}"),
    ]
    if spec.default_text:
        checks.append((f"kill: {spec.kill_on} answered with the bearer (no reconnect instruction)",
                       bool(rows.summaries) and not any(REAUTH.search(s) for s in rows.summaries),
                       f"summaries={rows.summaries[:2]}"))
        checks.append(("kill: the reply names Nauvoo", "nauvoo" in rows.reply.lower(), f"reply={rows.reply[:200]!r}"))
    return checks


# -- the evidence block: what the resumed attempt actually did ---------------------------


@dataclass
class KillMarks:
    """High-water marks taken at the kill: everything above them was written by the
    resumed attempt."""

    calls_id: int
    entries_seq: int
    events_seq: int
    sections_before: list[tuple]


@dataclass
class KillEvidence:
    turn_row: dict[str, Any] = field(default_factory=dict)
    calls_after: list[tuple] = field(default_factory=list)      # (tool_name, agent_type, decision, duration_ms)
    entries_after: list[tuple] = field(default_factory=list)    # (seq, subpath, type, brief)
    sections_before: list[tuple] = field(default_factory=list)  # (section, n)
    sections_after: list[tuple] = field(default_factory=list)
    texts_after: list[str] = field(default_factory=list)


def entry_brief(entry: Any, limit: int = 200) -> str:
    """The first ``limit`` characters of what a transcript entry says: its message's text
    blocks, ``tool_use:<name>`` per tool call, ``tool_result:<content>`` per result, the
    ``result`` text of a result entry, or the entry's own ``summary``/``content``."""
    if not isinstance(entry, dict):
        return str(entry)[:limit]
    parts: list[str] = []
    message = entry.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if content is None:
        content = entry.get("content")
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                parts.append(str(block))
                continue
            kind = block.get("type")
            if kind == "text":
                parts.append(str(block.get("text") or ""))
            elif kind == "tool_use":
                parts.append(f"tool_use:{block.get('name')}")
            elif kind == "tool_result":
                inner = block.get("content")
                if isinstance(inner, list):
                    inner = " ".join(str(b.get("text") or "") if isinstance(b, dict) else str(b) for b in inner)
                parts.append(f"tool_result:{inner if inner is not None else ''}")
            else:
                parts.append(f"{kind}")
    for key in ("result", "summary"):
        if isinstance(entry.get(key), str):
            parts.append(str(entry[key]))
    text = " ".join(p for p in parts if p)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def section_counts_sql() -> str:
    """Length of every array-typed top-level key of the project's research.json -- no section
    list to maintain, so a delegation writing person_evidence shows up beside an extraction
    writing sources and assertions. Shared with demo.py, which imports this module; nothing
    here imports demo -- under ``python proto/turn.py`` sys.path holds proto/, not apps/server,
    so a ``from proto import …`` in this file is a ModuleNotFoundError at run time."""
    return (
        "SELECT k AS section, jsonb_array_length(d.doc->k) AS n "
        "FROM documents d, jsonb_object_keys(d.doc) AS k "
        "WHERE d.project_id = %s AND d.name = 'research.json' AND jsonb_typeof(d.doc->k) = 'array' "
        "ORDER BY k"
    )


def take_marks(dsn: str, session_id: str, turn_id: str, sdk_session_id: str | None, project_id: str | None) -> KillMarks:
    return KillMarks(
        calls_id=one(dsn, "SELECT COALESCE(max(id), 0) FROM tool_calls WHERE turn_id = %s", (turn_id,)) or 0,
        entries_seq=one(dsn, "SELECT COALESCE(max(seq), 0) FROM session_entries WHERE session_id = %s", (sdk_session_id or "",)) or 0,
        events_seq=one(dsn, "SELECT COALESCE(max(seq), 0) FROM session_events WHERE session_id = %s", (session_id,)) or 0,
        sections_before=db(dsn, section_counts_sql(), (project_id or "",)),
    )


def gather_evidence(dsn: str, session_id: str, turn_id: str, sdk_session_id: str | None, project_id: str | None,
                    marks: KillMarks) -> KillEvidence:
    row = db(dsn, "SELECT receive_count, num_turns, cost_usd, nudges, duration_ms, outcome, completed_at "
                  "FROM turns WHERE turn_id = %s", (turn_id,))
    keys = ("receive_count", "num_turns", "cost_usd", "nudges", "duration_ms", "outcome", "completed_at")
    entries = db(dsn, "SELECT seq, subpath, entry FROM session_entries WHERE session_id = %s AND seq > %s ORDER BY seq",
                 (sdk_session_id or "", marks.entries_seq))
    return KillEvidence(
        turn_row=dict(zip(keys, row[0])) if row else {},
        calls_after=db(dsn, "SELECT tool_name, agent_type, decision, duration_ms FROM tool_calls "
                            "WHERE turn_id = %s AND id > %s ORDER BY id", (turn_id, marks.calls_id)),
        entries_after=[(seq, subpath, (entry or {}).get("type") if isinstance(entry, dict) else None, entry_brief(entry))
                       for seq, subpath, entry in entries],
        sections_before=list(marks.sections_before),
        sections_after=db(dsn, section_counts_sql(), (project_id or "",)),
        texts_after=[t or "" for (t,) in db(dsn, "SELECT payload->>'text' FROM session_events WHERE session_id = %s "
                                                 "AND kind = 'text' AND seq > %s ORDER BY seq", (session_id, marks.events_seq))],
    )


def render_evidence(ev: KillEvidence) -> str:
    """The block printed after turn_done whatever the checks say."""
    lines = ["-- evidence: the turns row",
             "   " + "  ".join(f"{k}={v}" for k, v in ev.turn_row.items()) if ev.turn_row else "   (no row)"]
    lines.append(f"-- evidence: tool_calls rows written after the kill ({len(ev.calls_after)})")
    lines.extend(f"   {tool}  agent_type={agent}  {decision}  duration_ms={ms}" for tool, agent, decision, ms in ev.calls_after)
    if not ev.calls_after:
        lines.append("   (none)")
    lines.append(f"-- evidence: session_entries rows appended after the kill ({len(ev.entries_after)})")
    lines.extend(f"   seq={seq}  {(subpath + '  ') if subpath else ''}{kind}  {brief!r}"
                 for seq, subpath, kind, brief in ev.entries_after)
    if not ev.entries_after:
        lines.append("   (none)")
    before = dict(ev.sections_before)
    after = dict(ev.sections_after)
    lines.append("-- evidence: research.json array sections, before the kill -> after turn_done")
    lines.extend(f"   {name}  {before.get(name, 0)} -> {after.get(name, 0)}"
                 + ("  (%+d)" % (after.get(name, 0) - before.get(name, 0)) if after.get(name, 0) != before.get(name, 0) else "")
                 for name in sorted(set(before) | set(after)))
    if not before and not after:
        lines.append("   (no research.json row)")
    lines.append(f"-- evidence: text events after the kill ({len(ev.texts_after)})")
    lines.extend(f"   {t[:300]!r}" for t in ev.texts_after)
    if not ev.texts_after:
        lines.append("   (none)")
    return "\n".join(lines)


def run_kill(base: str, dsn: str, deadline_s: float, spec: KillSpec) -> tuple[list[Check], dict[str, Any]]:
    """One real turn, the worker container killed ``spec.kill_after_s`` after its first
    ``spec.kill_on`` call starts and started again; the shim's redelivery must resume the
    SDK session and finish. Prints the evidence block after turn_done."""
    checks: list[Check] = []
    figures: dict[str, Any] = {}
    session_id = spec.session_id
    with httpx.Client(timeout=30.0) as client:
        if session_id is None:
            r = client.post(f"{base}/api/sessions", json={"title": "D14 kill-resume"})
            r.raise_for_status()
            session_id = r.json()["id"]
        figures["session_id"] = session_id
        project_id = one(dsn, "SELECT project_id FROM sessions WHERE session_id = %s", (session_id,))
        turn_id = post_message(client, base, session_id, spec.text)
        figures["turn_id"] = turn_id
        outcome = wait_for_tool_call(dsn, turn_id, spec.kill_on, deadline_s, spec.background_only)
        checks.append((f"kill: the turn reached its first {spec.kill_on} call", outcome == "seen",
                       "the turn finished without one" if outcome == "completed" else "no tool_calls row in time"))
        if outcome != "seen":
            return checks, figures
        if spec.kill_after_s > 0:
            time.sleep(spec.kill_after_s)
        sdk_before = one(dsn, "SELECT sdk_session_id FROM sessions WHERE session_id = %s", (session_id,))
        entries_at_kill = one(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",))
        marks = take_marks(dsn, session_id, turn_id, sdk_before, project_id)
        t_kill = time.monotonic()
        docker("kill", spec.container)  # counts as a manual stop: unless-stopped will not restart it
        docker("start", spec.container)
        figures.update({"sdk_session_id": sdk_before, "entries_at_kill": entries_at_kill, "kill_on": spec.kill_on,
                        "kill_after_s": spec.kill_after_s})
        try:
            _seq, _wall = wait_turn_done(client, base, session_id, turn_id, deadline_s)
        except Exception as exc:  # noqa: BLE001
            checks.append(("kill: the redelivered turn reached turn_done", False, f"{type(exc).__name__}: {exc}"))
            print(render_evidence(gather_evidence(dsn, session_id, turn_id, sdk_before, project_id, marks)))
            return checks, figures
        figures["wall_after_kill_s"] = round(time.monotonic() - t_kill, 1)
        checks.append(("kill: the redelivered turn reached turn_done", True, ""))
        row = db(dsn, "SELECT receive_count, completed_at, outcome, cost_usd FROM turns WHERE turn_id = %s", (turn_id,))
        sdk_after = one(dsn, "SELECT sdk_session_id FROM sessions WHERE session_id = %s", (session_id,))
        entries_after = one(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",))
        calls = [(d, ms) for n, d, ms in db(dsn, "SELECT tool_name, decision, duration_ms FROM tool_calls WHERE turn_id = %s ORDER BY id",
                                            (turn_id,)) if matches_bare(n, spec.kill_on)]
        results = db(dsn, "SELECT payload->>'tool', payload->>'summary' FROM session_events WHERE session_id = %s "
                          "AND kind = 'tool_result' ORDER BY seq", (session_id,))
        summaries = [s or "" for tool, s in results if matches_bare(tool or "", spec.kill_on)]
        user_seq = one(dsn, "SELECT max(seq) FROM session_events WHERE session_id = %s AND kind = 'user_msg' AND payload->>'turn_id' = %s",
                       (session_id, turn_id))
        texts = db(dsn, "SELECT payload->>'text' FROM session_events WHERE session_id = %s AND kind = 'text' AND seq > %s ORDER BY seq",
                   (session_id, user_seq or 0))
        reply = " ".join(t[0] or "" for t in texts)
        rows = KillRows(turn_row=row[0] if row else None, sdk_before=sdk_before, sdk_after=sdk_after,
                        entries_at_kill=entries_at_kill, entries_after=entries_after, kill_calls=calls,
                        summaries=summaries, reply=reply)
        checks.extend(kill_checks(rows, spec))
        receive_count, _completed, _outcome, cost = rows.turn_row if rows.turn_row else (None, None, None, None)
        figures.update({"receive_count": receive_count, "cost_usd": float(cost) if cost is not None else None,
                        "entries_after": entries_after, "kill_on_calls": calls, "reply": reply[:200]})
        print(render_evidence(gather_evidence(dsn, session_id, turn_id, sdk_before, project_id, marks)))
    return checks, figures


TOKEN_COLUMNS = ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens")

# The whole SDK session's output tokens, one row per API message (the worker's
# TURN_USAGE_SQL without its seq window).
SESSION_OUTPUT_SQL = (
    "SELECT sum((u->>'output_tokens')::bigint) "
    "FROM (SELECT DISTINCT ON (entry->'message'->>'id') entry->'message'->'usage' AS u "
    "FROM session_entries WHERE session_id = %s AND entry->>'type' = 'assistant' "
    "ORDER BY entry->'message'->>'id', seq DESC) m"
)


def tokens(dsn: str, turn_id: str) -> dict[str, int | None]:
    rows = db(dsn, f"SELECT {', '.join(TOKEN_COLUMNS)} FROM turns WHERE turn_id = %s", (turn_id,))
    return dict(zip(TOKEN_COLUMNS, rows[0])) if rows else dict.fromkeys(TOKEN_COLUMNS)


def tokens_filled(t: dict[str, int | None]) -> bool:
    """Every column non-NULL, some output, and some input (uncached or cached)."""
    return (all(t[c] is not None for c in TOKEN_COLUMNS) and (t["output_tokens"] or 0) > 0
            and ((t["input_tokens"] or 0) + (t["cache_creation_tokens"] or 0) + (t["cache_read_tokens"] or 0)) > 0)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--base", default="http://127.0.0.1:8085")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--deadline-s", type=float, default=300.0,
                   help="wall clock before a FAIL, per wait: on --kill the arm waits it out twice, "
                        "once for the --kill-on row (an Agent can be minutes in) and again for turn_done")
    p.add_argument("--kill", action="store_true", help="D14: one turn killed at its first --kill-on call, redelivered and resumed")
    p.add_argument("--session", default=None, help="with --kill: run on this session (proto/seed.py) instead of a fresh one")
    p.add_argument("--worker-container", default="proto-worker")
    p.add_argument("--kill-on", default=KILL_TOOL,
                   help=f"with --kill: the bare tool name whose PreToolUse row triggers the kill (default {KILL_TOOL}; "
                        "Agent lands it during a delegation)")
    p.add_argument("--kill-after-s", type=float, default=0.0,
                   help="with --kill: seconds to wait after that row before the kill (default 0: at once)")
    p.add_argument("--background-only", action="store_true",
                   help="with --kill --kill-on Agent: kill only on a delegation launched with run_in_background: true")
    text = p.add_mutually_exclusive_group()
    text.add_argument("--text", default=None, help="with --kill: the message to post (default: the place_search question)")
    text.add_argument("--text-file", default=None, help="with --kill: read the message from this UTF-8 file")
    return p


def kill_spec(args: argparse.Namespace) -> KillSpec:
    """The ``--kill`` arm's spec from the parsed arguments. The message is ``--text-file``'s
    contents (UTF-8, stripped), else ``--text`` verbatim, else ``TEXT_KILL``; a blank
    message is refused rather than posted."""
    text = TEXT_KILL
    if args.text_file:
        text = Path(args.text_file).read_text(encoding="utf-8").strip()
    elif args.text is not None:
        text = args.text
    if not text.strip():
        raise ValueError("--text/--text-file gave an empty message")
    if args.kill_after_s < 0:
        raise ValueError(f"--kill-after-s must be >= 0, not {args.kill_after_s}")
    if args.background_only and args.kill_on != "Agent":
        raise ValueError(f"--background-only needs --kill-on Agent, not {args.kill_on}")
    return KillSpec(kill_on=args.kill_on, kill_after_s=args.kill_after_s, text=text,
                    session_id=args.session, container=args.worker_container,
                    background_only=args.background_only)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    spec: KillSpec | None = None
    if args.kill:
        try:
            spec = kill_spec(args)
        except (OSError, ValueError) as exc:
            print(f"--kill: {exc}", file=sys.stderr)
            return 2

    try:
        health = httpx.get(f"{args.base}/api/health", timeout=5.0).json()
        db(args.pg_dsn, "SELECT 1", ())
    except Exception as exc:  # noqa: BLE001
        print(f"stack not up ({type(exc).__name__}: {exc}); run `make proto-up` first", file=sys.stderr)
        return 2
    if health.get("queue") == "NullQueue":
        print("the tier has no queue (NullQueue): nothing would run the turn", file=sys.stderr)
        return 2

    if spec is not None:
        checks, figures = run_kill(args.base, args.pg_dsn, args.deadline_s, spec)
    else:
        checks, figures = run(args.base, args.pg_dsn, args.deadline_s)
    width = max(len(c[0]) for c in checks)
    print()
    for name, ok, detail in checks:
        print(f"{name:{width}} {'PASS' if ok else 'FAIL'}  {'' if ok else detail}")
    failed = sum(not ok for _, ok, _ in checks)
    print(f"\n{len(checks) - failed}/{len(checks)} checks passed")
    if args.kill:
        print(" ".join(f"{k}={v!r}" if isinstance(v, str) else f"{k}={v}" for k, v in figures.items()))
    for key in ("turn1", "turn2"):
        if key in figures:
            f = figures[key]
            print(f"{key}: cost_usd={f.get('cost_usd')} num_turns={f.get('num_turns')} "
                  f"duration_ms={f.get('duration_ms')} wall_s={f.get('wall_s')} entries={f.get('entries')}"
                  + (f" events={f['events']} tool_calls={f['tool_calls']}" if 'events' in f else "")
                  + (f" tokens={f['tokens']}" if 'tokens' in f else "")
                  + (f" reply={f['reply']!r}" if 'reply' in f else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
