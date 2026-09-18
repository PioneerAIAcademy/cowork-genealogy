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
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
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


# -- the kill arm (D14) ----------------------------------------------------------------


def wait_for_tool_call(dsn: str, turn_id: str, tool: str, deadline_s: float) -> bool:
    """True once the turn has a tool_calls row naming ``tool`` -- written by the PreToolUse
    hook, i.e. as the call starts."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        if one(dsn, "SELECT count(*) FROM tool_calls WHERE turn_id = %s AND tool_name LIKE %s", (turn_id, f"%{tool}")):
            return True
        time.sleep(0.2)
    return False


def docker(*args: str) -> None:
    subprocess.run(["docker", *args], check=True, capture_output=True, text=True, encoding="utf-8")


def run_kill(base: str, dsn: str, deadline_s: float, session_id: str | None, container: str) -> tuple[list[Check], dict[str, Any]]:
    """One real turn, the worker container killed as its first place_search call starts
    and started again; the shim's redelivery must resume the SDK session and finish."""
    checks: list[Check] = []
    figures: dict[str, Any] = {}
    with httpx.Client(timeout=30.0) as client:
        if session_id is None:
            r = client.post(f"{base}/api/sessions", json={"title": "D14 kill-resume"})
            r.raise_for_status()
            session_id = r.json()["id"]
        figures["session_id"] = session_id
        turn_id = post_message(client, base, session_id, TEXT_KILL)
        figures["turn_id"] = turn_id
        seen = wait_for_tool_call(dsn, turn_id, KILL_TOOL, min(deadline_s, 120.0))
        checks.append((f"kill: the turn reached its first {KILL_TOOL} call", seen, "no tool_calls row in time"))
        if not seen:
            return checks, figures
        sdk_before = one(dsn, "SELECT sdk_session_id FROM sessions WHERE session_id = %s", (session_id,))
        entries_at_kill = one(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",))
        t_kill = time.monotonic()
        docker("kill", container)  # counts as a manual stop: unless-stopped will not restart it
        docker("start", container)
        figures.update({"sdk_session_id": sdk_before, "entries_at_kill": entries_at_kill})
        try:
            _seq, _wall = wait_turn_done(client, base, session_id, turn_id, deadline_s)
        except Exception as exc:  # noqa: BLE001
            checks.append(("kill: the redelivered turn reached turn_done", False, f"{type(exc).__name__}: {exc}"))
            return checks, figures
        figures["wall_after_kill_s"] = round(time.monotonic() - t_kill, 1)
        checks.append(("kill: the redelivered turn reached turn_done", True, ""))
        row = db(dsn, "SELECT receive_count, completed_at, outcome, cost_usd FROM turns WHERE turn_id = %s", (turn_id,))
        receive_count, completed, outcome, cost = row[0] if row else (None, None, None, None)
        checks.append(("kill: the turn was redelivered (receive_count >= 2)", (receive_count or 0) >= 2, f"receive_count={receive_count}"))
        checks.append(("kill: completed with outcome ok and cost_usd > 0",
                       completed is not None and outcome == "ok" and cost is not None and float(cost) > 0, f"row={row}"))
        sdk_after = one(dsn, "SELECT sdk_session_id FROM sessions WHERE session_id = %s", (session_id,))
        checks.append(("kill: the same SDK session resumed, not a new one", bool(sdk_before) and sdk_after == sdk_before,
                       f"{sdk_before} -> {sdk_after}"))
        entries_after = one(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",))
        checks.append(("kill: session_entries grew past the kill", entries_after > entries_at_kill, f"{entries_at_kill} -> {entries_after}"))
        calls = db(dsn, "SELECT decision, duration_ms FROM tool_calls WHERE turn_id = %s AND tool_name LIKE %s ORDER BY id",
                   (turn_id, f"%{KILL_TOOL}"))
        checks.append((f"kill: a {KILL_TOOL} call completed with a duration (criterion 4)",
                       any(d == "allow" and ms is not None for d, ms in calls), f"calls={calls}"))
        results = db(dsn, "SELECT payload->>'summary' FROM session_events WHERE session_id = %s AND kind = 'tool_result' "
                          "AND payload->>'tool' LIKE %s ORDER BY seq", (session_id, f"%{KILL_TOOL}"))
        summaries = [r[0] or "" for r in results]
        checks.append((f"kill: {KILL_TOOL} answered with the bearer (no reconnect instruction)",
                       bool(summaries) and not any(REAUTH.search(s) for s in summaries), f"summaries={summaries[:2]}"))
        user_seq = one(dsn, "SELECT max(seq) FROM session_events WHERE session_id = %s AND kind = 'user_msg' AND payload->>'turn_id' = %s",
                       (session_id, turn_id))
        texts = db(dsn, "SELECT payload->>'text' FROM session_events WHERE session_id = %s AND kind = 'text' AND seq > %s ORDER BY seq",
                   (session_id, user_seq or 0))
        reply = " ".join(t[0] or "" for t in texts)
        checks.append(("kill: the reply names Nauvoo", "nauvoo" in reply.lower(), f"reply={reply[:200]!r}"))
        figures.update({"receive_count": receive_count, "cost_usd": float(cost) if cost is not None else None,
                        "entries_after": entries_after, "place_search_calls": calls, "reply": reply[:200]})
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


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--base", default="http://127.0.0.1:8085")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--deadline-s", type=float, default=300.0, help="per-turn wall clock before a FAIL")
    p.add_argument("--kill", action="store_true", help="D14: one turn killed at its first place_search call, redelivered and resumed")
    p.add_argument("--session", default=None, help="with --kill: run on this session (proto/seed.py) instead of a fresh one")
    p.add_argument("--worker-container", default="proto-worker")
    args = p.parse_args(argv)

    try:
        health = httpx.get(f"{args.base}/api/health", timeout=5.0).json()
        db(args.pg_dsn, "SELECT 1", ())
    except Exception as exc:  # noqa: BLE001
        print(f"stack not up ({type(exc).__name__}: {exc}); run `make proto-up` first", file=sys.stderr)
        return 2
    if health.get("queue") == "NullQueue":
        print("the tier has no queue (NullQueue): nothing would run the turn", file=sys.stderr)
        return 2

    if args.kill:
        checks, figures = run_kill(args.base, args.pg_dsn, args.deadline_s, args.session, args.worker_container)
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
