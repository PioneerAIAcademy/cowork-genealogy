#!/usr/bin/env python3
"""U23 ``make proto-bounds CASE=<case>``: record one live bound on the compose stack.

Stop during a run, the held-message release, the spend cap, Stop or the cap during a
foreground delegation, and each under a store outage -- plus PR #2870's owed probes: the resume probe,
SDK Q1 (does a halt's ``continue_: False`` suppress the Stop dispatch?) and Q2 (does a
subagent's halt stop the parent?). Billed, except ``precli``.

    uv run python proto/bounds.py --case <case> [--session <id>] [--fixture bagley-father-1884]
                                  [--deadline-s 1200] [--kill-after-s 10] [--pause-s 30]
                                  [--base ...] [--pg-dsn ...] [--s3-endpoint ...]

  precli           worker stopped, a message posted, Stop pressed, worker started: the
                   redelivery closes ``stopped`` before any CLI (cost 0, no ev=cli_stderr)
  stop_main        Stop after the first main-thread allow: halt row, STOP_REASON, stopped,
                   latency, Q1; the next message clears the flag and is not stopped
  stop_delegation  Stop after the first subagent row (seeded): subagent halt row, Q1, Q2,
                   the ResultMessage as the worker saw it
  held_release     a second message after the first allow: queued, handover halt, the
                   released msgid delivered, the held turn runs and is not halted first
  held_after_stop  Stop, then a second message: the first stopped, the second released
                   and not halted at its first call
  cap_main         usage over the cap injected after the first allow: halt row,
                   SPEND_CAP_REASON, budget/spend; the next message closes before the CLI
  cap_main_real    no injection, SESSION_SPEND_CAP_USD lowered (refused above
                   REAL_CAP_MAX_USD; seeded): the real meter fires; overshoot, 5m/1h split
  cap_delegation   usage injected at the first subagent row (seeded): as stop_delegation
  outage_stop / outage_cap / outage_held
                   Stop / inject / hold, then pg_terminate_backend on the turn's own
                   connection (application_name turn:<id>): no call runs after, the attempt
                   answers 500, the redelivery closes stopped / budget / hands over
  outage_pause     docker pause proto-postgres --pause-s mid-turn: recorded, not judged,
                   beyond the driver recovering
  probe_resume     the worker killed --kill-after-s (5-20) after the first subagent row
                   (seeded): the resume, and whether session_entries keeps the model's
                   Agent input ``run_in_background``

Injected usage is one ``session_entries`` row under project_key ``__u23_probe__`` (the meter
counts every project_key; the SDK store loads only its own), deleted at case end; a turn
that carried one is excluded from calibration. Every exit that can leave a turn running
POSTs /interrupt until the session has none (``settle``). Each case prints its evidence
(turns, tool_calls, the worker's ev lines, turn_done payloads), findings (Q1, Q2, what was
recorded), figures and PASS/FAIL per check. Exit 1 on any FAIL, 2 when the stack is not up
or the arguments are refused.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.agent.continue_policy import (  # noqa: E402
    TERMINAL_BUDGET, TERMINAL_NO_PROGRESS, TERMINAL_QUEUED, TERMINAL_STOPPED,
)
from app.agent.spend import PRICE_PER_MTOK, SPEND_CAP_USD  # noqa: E402
from proto import demo, seed, smoke, turn  # noqa: E402
from proto.worker.options import (  # noqa: E402
    HANDOVER_REASON,
    SPEND_CAP_REASON,
    STOP_REASON,
    STORE_UNAVAILABLE_REASON,
)

Check = turn.Check
PROBES = Path(__file__).resolve().parent / "probes"
LOOKUPS_TEXT = PROBES / "u23-lookups.txt"
EXTRACTIONS_TEXT = PROBES / "u23-two-extractions.txt"
RESUME_TEXT = PROBES / "background-delegation.txt"
FOLLOW_UP_TEXT = "Reply with the single word ok."
PROBE_KEY = "__u23_probe__"
REAL_CAP_MAX_USD = 5.0
KILL_AFTER_RANGE_S = (5.0, 20.0)
SETTLE_S = 240.0
INJECT_MARGIN = 1.10
DEFAULT_DEADLINE_S = 1200.0

# (id, tool_name, agent_id, decision, ts)
CALLS_SQL = "SELECT id, tool_name, agent_id, decision, ts FROM tool_calls WHERE turn_id = %s ORDER BY id"
# (receive_count, completed_at, outcome, cost_usd): KillRows.turn_row's order.
TURN_SQL = "SELECT receive_count, completed_at, outcome, cost_usd FROM turns WHERE turn_id = %s"
OPEN_SQL = "SELECT turn_id, outcome FROM turns WHERE session_id = %s AND completed_at IS NULL ORDER BY enqueued_at"
SDK_SQL = "SELECT sdk_session_id FROM sessions WHERE session_id = %s"
STOP_AT_SQL = "SELECT stop_requested_at FROM sessions WHERE session_id = %s"
MAX_ENTRY_SQL = "SELECT COALESCE(max(seq), 0) FROM session_entries WHERE session_id = %s"
ENTRIES_SQL = "SELECT seq, subpath, entry FROM session_entries WHERE session_id = %s AND seq > %s AND seq <= %s ORDER BY seq"
INJECT_SQL = "INSERT INTO session_entries (project_key, session_id, subpath, entry) VALUES (%s, %s, '', %s)"
DELETE_PROBE_SQL = "DELETE FROM session_entries WHERE project_key = %s"
TERMINATE_SQL = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = %s"
# The session's cache writes by TTL, one row per API message (TURN_USAGE_SQL's dedupe).
CACHE_SPLIT_SQL = (
    "SELECT sum((u->'cache_creation'->>'ephemeral_5m_input_tokens')::bigint), "
    "sum((u->'cache_creation'->>'ephemeral_1h_input_tokens')::bigint), "
    "sum((u->>'cache_creation_input_tokens')::bigint) "
    "FROM (SELECT DISTINCT ON (entry->'message'->>'id') entry->'message'->'usage' AS u "
    "FROM session_entries WHERE session_id = %s AND entry->>'type' = 'assistant' "
    "ORDER BY entry->'message'->>'id', seq DESC) m"
)
# A halt's deny text is the tool_result of a call that never ran. Only the fixed part
# before any `{...}` placeholder, so the cap's rendered amount does not matter.
HALT_MARKERS = tuple(r.split("{", 1)[0][:48] for r in (STOP_REASON, HANDOVER_REASON, SPEND_CAP_REASON,
                                                        STORE_UNAVAILABLE_REASON))
STORE_ERRORS = ("StoreUnavailable", "OperationalError")


def is_store_error(error: str) -> bool:
    """The worker's 500 ``error`` is ``"<Type>: <message>"``. A store loss is StoreUnavailable or
    any psycopg OperationalError/InterfaceError subclass -- a terminated backend raises
    AdminShutdown, which no substring of STORE_ERRORS names."""
    name = str(error or "").split(":", 1)[0].strip()
    if name == "StoreUnavailable":
        return True
    cls = getattr(psycopg.errors, name, None) or getattr(psycopg, name, None)
    return isinstance(cls, type) and issubclass(cls, (psycopg.OperationalError, psycopg.InterfaceError))


@dataclass
class TurnSnap:
    """One turn's rows, read after its turn_done, for the pure checks."""

    turn_id: str
    row: tuple | None = None                          # TURN_SQL
    calls: list[tuple] = field(default_factory=list)  # CALLS_SQL
    payload: dict | None = None                       # the turn_done event's payload


@dataclass
class Report:
    case: str
    session_id: str | None = None
    turn_ids: list[str] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)
    figures: dict[str, Any] = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)


@dataclass
class Ctx:
    base: str
    dsn: str
    email: str
    s3_endpoint: str
    fixture: str
    session: str | None
    deadline_s: float
    kill_after_s: float
    pause_s: float
    cap_usd: float
    price_output: float
    worker: str = "proto-worker"
    postgres: str = "proto-postgres"
    tools: str = "proto-tools"


# -- pure: selecting rows ----------------------------------------------------------------


def is_subagent(call: tuple) -> bool:
    return call[2] is not None


def first_call(calls: list[tuple], *, subagent: bool, decision: str = "allow") -> tuple | None:
    """The first ``decision`` row on the main thread (``agent_id`` NULL) or on a subagent."""
    return next((c for c in calls if c[3] == decision and is_subagent(c) == subagent), None)


def events_for(events: list[dict], turn_id: str) -> list[dict]:
    """The worker's lines naming ``turn_id``, in log order."""
    return [e for e in events if e.get("turn_id") == turn_id]


def parse_json_lines(text: str) -> list[dict]:
    """Every JSON-object line of a container log, in order; anything else skipped."""
    out: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict):
            out.append(rec)
    return out


def spend_config(start: dict | None, cap_default: float, price_default: float) -> tuple[float, float, str]:
    """``(cap_usd, output price per MTok, source)``: the worker's own ``ev=start`` figures
    when it logged them, else the driver's environment (the Makefile exports both sides)."""
    if start and isinstance(start.get("spend_cap_usd"), (int, float)):
        prices = start.get("prices") if isinstance(start.get("prices"), dict) else {}
        price = prices.get("output")
        return (float(start["spend_cap_usd"]),
                float(price) if isinstance(price, (int, float)) and price > 0 else price_default, "ev=start")
    return cap_default, price_default, "environment"


def tokens_to_exceed(cap_usd: float, price_output_per_mtok: float, *, margin: float = INJECT_MARGIN) -> int:
    """Output tokens whose price alone passes ``cap_usd`` by ``margin`` -- integral, as the
    meter's ``::bigint`` casts require."""
    if cap_usd <= 0 or price_output_per_mtok <= 0:
        raise ValueError(f"cap {cap_usd} and price {price_output_per_mtok} must be positive")
    return int(math.ceil(cap_usd * margin * 1_000_000 / price_output_per_mtok)) + 1


def probe_entry(output_tokens: int) -> dict:
    """The injected transcript row: an assistant entry with a unique message id (the meter
    dedupes by it) and integer usage."""
    return {"type": "assistant", "message": {"id": f"u23-{uuid.uuid4().hex}", "usage": {"output_tokens": int(output_tokens)}}}


def _blocks(entry: Any) -> list[dict]:
    message = entry.get("message") if isinstance(entry, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def _result_text(block: dict) -> str:
    inner = block.get("content")
    if isinstance(inner, list):
        return " ".join(str(b.get("text") or "") if isinstance(b, dict) else str(b) for b in inner)
    return str(inner or "")


def calls_ran(entries: list[tuple]) -> tuple[list[tuple], list[tuple]]:
    """Over ``(seq, subpath, entry)`` rows: ``(ran, unresolved)``. A ``tool_use`` ran when its
    ``tool_result`` is in the rows and is not a halt's deny text; unresolved has no result
    there. Both ``(subpath, name, tool_use_id)``."""
    uses: list[tuple] = []
    results: dict[str, str] = {}
    for _seq, subpath, entry in entries:
        for block in _blocks(entry):
            if block.get("type") == "tool_use":
                uses.append((subpath, str(block.get("name") or ""), str(block.get("id") or "")))
            elif block.get("type") == "tool_result":
                results[str(block.get("tool_use_id") or "")] = _result_text(block)
    ran = [u for u in uses if u[2] in results and not any(m in results[u[2]] for m in HALT_MARKERS)]
    unresolved = [u for u in uses if u[2] not in results]
    return ran, unresolved


def agent_inputs(entries: list[tuple]) -> list[tuple[str, bool, Any]]:
    """Every main-thread ``Agent``/``Task`` tool_use the transcript kept: ``(name, has the
    key, run_in_background's value)`` -- the model's input as stored, whatever the worker
    then did with it."""
    out: list[tuple[str, bool, Any]] = []
    for _seq, subpath, entry in entries:
        if subpath:
            continue
        for block in _blocks(entry):
            if block.get("type") == "tool_use" and block.get("name") in ("Agent", "Task"):
                given = block.get("input") if isinstance(block.get("input"), dict) else {}
                out.append((str(block["name"]), "run_in_background" in given, given.get("run_in_background")))
    return out


def _ts(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


# -- pure: the checks --------------------------------------------------------------------


def closed_check(label: str, snap: TurnSnap, outcome: str) -> Check:
    _rc, completed, got, _cost = snap.row or (None, None, None, None)
    return (f"{label}: closed {outcome}", completed is not None and got == outcome, f"row={snap.row}")


def payload_check(label: str, snap: TurnSnap, outcome: str, limit: str | None = None) -> Check:
    p = snap.payload or {}
    ok = p.get("outcome") == outcome and (limit is None or p.get("limit") == limit)
    return (f"{label}: turn_done says {outcome}" + (f", limit {limit}" if limit else ""), ok, f"payload={p}")


def ran_check(label: str, snap: TurnSnap) -> Check:
    """A released or follow-up turn that ran: closed, not stopped, not a failure outcome.

    ``no_progress`` passes: these turns run on a project-less session under the recipe's
    nudges, so a reply with no tool call after the Stop hook's nudge ends ``no_progress``
    though the bound under test worked (proto-turn and proto-kill pin nudges to 0 for it)."""
    _rc, completed, got, _cost = snap.row or (None, None, None, None)
    bad = (turn.RESUMED_FAILED_OUTCOMES - {TERMINAL_NO_PROGRESS}) | {TERMINAL_STOPPED}
    return (f"{label}: ran and closed, not {'/'.join(sorted(bad))}",
            completed is not None and got is not None and got not in bad, f"row={snap.row}")


def unbilled_checks(label: str, snap: TurnSnap, events: list[dict], outcome: str) -> list[Check]:
    """A turn a bound closed before any CLI: no cost, the worker said so, and no CLI trace."""
    cost = snap.row[3] if snap.row else None
    mine = events_for(events, snap.turn_id)
    bound = [e for e in mine if e.get("ev") == "bound_before_cli"]
    stderr = [e for e in mine if e.get("ev") == "cli_stderr"]
    return [
        (f"{label}: billed nothing (cost_usd 0 or NULL)", snap.row is not None and (cost is None or float(cost) == 0),
         f"cost_usd={cost}"),
        (f"{label}: the worker logged ev=bound_before_cli outcome={outcome}",
         any(e.get("outcome") == outcome for e in bound), f"bound={bound}"),
        (f"{label}: no CLI ran (no ev=cli_stderr, no tool_calls rows)", not stderr and not snap.calls,
         f"cli_stderr={len(stderr)} tool_calls={len(snap.calls)}"),
    ]


def halt_checks(label: str, calls: list[tuple], events: list[dict], *, reason: str,
                subagent: bool | None) -> list[Check]:
    """A halt row where the bound was meant to land (``subagent`` None: anywhere), no call
    allowed after the first halt, and the worker's ev=halt carrying ``reason``."""
    halts = [c for c in calls if c[3] == "halt"]
    scoped = [c for c in halts if subagent is None or is_subagent(c) == subagent]
    where = "anywhere" if subagent is None else ("on a subagent" if subagent else "on the main thread")
    first = halts[0] if halts else None
    after = [c for c in calls if first is not None and c[0] > first[0] and c[3] == "allow"]
    reasons = [e.get("reason") for e in events if e.get("ev") == "halt"]
    return [
        (f"{label}: a halt row {where}", bool(scoped), f"halts={[(c[1], c[2]) for c in halts]}"),
        (f"{label}: no call allowed after the first halt", first is not None and not after,
         f"allowed after={[(c[1], c[2]) for c in after]}"),
        (f"{label}: ev=halt carried the expected reason", reason in reasons, f"reasons={reasons} wanted={reason!r}"),
    ]


def cap_checks(label: str, snap: TurnSnap, events: list[dict], *, cap_usd: float,
               subagent: bool | None) -> list[Check]:
    mine = events_for(events, snap.turn_id)
    fired = [e for e in mine if e.get("ev") == "spend_cap"]
    spent = (snap.payload or {}).get("spent_usd")
    return [
        *halt_checks(label, snap.calls, mine, reason=SPEND_CAP_REASON.format(cap=cap_usd), subagent=subagent),
        (f"{label}: ev=spend_cap with spent_usd >= the cap",
         any(isinstance(e.get("spent_usd"), (int, float)) and e["spent_usd"] >= cap_usd for e in fired),
         f"spend_cap={fired} cap={cap_usd}"),
        closed_check(label, snap, TERMINAL_BUDGET),
        payload_check(label, snap, TERMINAL_BUDGET, "spend"),
        (f"{label}: turn_done spent_usd >= the cap", isinstance(spent, (int, float)) and spent >= cap_usd,
         f"spent_usd={spent} cap={cap_usd}"),
    ]


def q1_answer(events: list[dict], turn_id: str) -> tuple[str, str]:
    """SDK Q1 over the worker's lines: after the first ev=halt, up to that attempt's ev=turn,
    did the Stop hook run (ev=terminal / ev=nudge)? ``(dispatched | not_dispatched |
    hook_off | no_halt, detail)``."""
    mine = events_for(events, turn_id)
    if any(e.get("ev") == "turn" and e.get("max_nudges") == 0 for e in mine):
        return "hook_off", "max_nudges=0: no Stop hook to observe"
    i = next((k for k, e in enumerate(mine) if e.get("ev") == "halt"), None)
    if i is None:
        return "no_halt", "no ev=halt for the turn"
    window: list[dict] = []
    for e in mine[i + 1:]:
        if e.get("ev") == "turn":
            break
        window.append(e)
    stops = [e for e in window if e.get("ev") in ("terminal", "nudge")]
    if not stops:
        return "not_dispatched", "no ev=terminal or ev=nudge between the halt and the attempt's ev=turn"
    s = stops[0]
    return "dispatched", f"ev={s['ev']} " + " ".join(f"{k}={s.get(k)}" for k in ("reason", "recorded", "n") if k in s)


def q2_answer(calls: list[tuple], entries: list[tuple]) -> tuple[str, str]:
    """SDK Q2: after the first SUBAGENT halt row, did the parent go on -- a main-thread
    tool_calls row after it, or a main-thread assistant entry stamped after it?
    ``(continued | stopped | no_subagent_halt, detail)``."""
    halt = next((c for c in calls if c[3] == "halt" and is_subagent(c)), None)
    if halt is None:
        return "no_subagent_halt", "no halt row with agent_id set"
    rows = [(c[1], c[3]) for c in calls if c[0] > halt[0] and not is_subagent(c)]
    at = _ts(halt[4])
    said = [seq for seq, subpath, entry in entries
            if not subpath and isinstance(entry, dict) and entry.get("type") == "assistant"
            and at is not None and (_ts(entry.get("timestamp")) or at) > at]
    if rows or said:
        return "continued", f"main-thread calls after the halt={rows} main-thread assistant entries after={said}"
    return "stopped", f"nothing on the main thread after the subagent halt at {halt[4]}"


def outage_checks(label: str, events: list[dict], turn_id: str, *, terminated: int,
                  ran: list[tuple]) -> list[Check]:
    """The turn's own connection killed: it was found, the attempt failed closed and
    answered 500, and no call ran after."""
    mine = events_for(events, turn_id)
    failed = [e for e in mine if e.get("ev") in ("halt_check_failed", "halt_failed")]
    five = [e for e in mine if e.get("ev") == "turn" and e.get("status") == 500]
    store_500 = [e for e in five if is_store_error(e.get("error"))]
    return [
        (f"{label}: terminated the turn's backend (application_name turn:{turn_id})", terminated >= 1,
         f"terminated={terminated}"),
        (f"{label}: the attempt failed closed (ev=halt_check_failed / halt_failed, or the receive loop's error)",
         bool(failed) or bool(store_500), f"failed={failed[:2]} 500s={five[:2]}"),
        (f"{label}: the attempt answered 500 carrying {' or '.join(STORE_ERRORS)}", bool(store_500),
         f"500s={[e.get('error') for e in five]}"),
        (f"{label}: no tool call ran after the outage (session_entries)", not ran, f"ran={ran}"),
    ]


def redelivered_check(label: str, snap: TurnSnap) -> Check:
    rc = snap.row[0] if snap.row else None
    return (f"{label}: redelivered (receive_count >= 2)", (rc or 0) >= 2, f"receive_count={rc}")


def released_by(events: list[dict], turn_id: str) -> list[str]:
    """The msgids ``turn_id``'s ev=turn lines say its close released, oldest first."""
    return [e["released_turn"] for e in events_for(events, turn_id) if e.get("ev") == "turn" and e.get("released_turn")]


def held_checks(label: str, reply: dict, a: TurnSnap, b: TurnSnap, events: list[dict],
                shim_posts: list[dict], *, a_outcome: str, a_reason: str) -> list[Check]:
    """B posted while A ran: held, A ended by its bound, the msgid A's close released is B's
    and reached a worker, and B ran without halting at its first call."""
    a_ev = events_for(events, a.turn_id)
    released = released_by(events, a.turn_id)
    msgid = released[-1] if released else None
    named = [e for e in events if e.get("ev") == "released" and e.get("turn_id") == b.turn_id]
    first_b = b.calls[0] if b.calls else None
    return [
        (f"{label}: the second message was held (queued, no message_id)",
         reply.get("queued") is True and reply.get("message_id") is None, f"reply={reply}"),
        *halt_checks(label, a.calls, a_ev, reason=a_reason, subagent=False),
        closed_check(label, a, a_outcome),
        (f"{label}: the first turn's close released a message", msgid is not None, f"released_turn={released}"),
        (f"{label}: ev=released names the held turn and that msgid",
         msgid is not None and any(e.get("message_id") == msgid for e in named), f"released={named}"),
        (f"{label}: the shim delivered the released msgid", msgid is not None and any(p.get("msgid") == msgid for p in shim_posts),
         f"msgid={msgid}"),
        ran_check(f"{label}: the held turn", b),
        (f"{label}: the held turn was not halted at its first call", first_b is not None and first_b[3] != "halt",
         f"first call={first_b}"),
    ]


def resume_checks(label: str, snap: TurnSnap, *, sdk_before: str | None, sdk_after: str | None,
                  entries_at_kill: int, entries_after: int) -> list[Check]:
    rc, completed, outcome, _cost = snap.row or (None, None, None, None)
    return [
        redelivered_check(label, snap),
        (f"{label}: closed, not {'/'.join(sorted(turn.RESUMED_FAILED_OUTCOMES))}",
         completed is not None and outcome is not None and outcome not in turn.RESUMED_FAILED_OUTCOMES,
         f"row={snap.row}"),
        (f"{label}: the same SDK session resumed", bool(sdk_before) and sdk_after == sdk_before, f"{sdk_before} -> {sdk_after}"),
        (f"{label}: session_entries grew past the kill", entries_after > entries_at_kill, f"{entries_at_kill} -> {entries_after}"),
    ]


def result_findings(events: list[dict], turn_id: str) -> list[str]:
    """How each attempt ended as the worker saw it: ev=turn's status, outcome and error --
    the ResultMessage's subtype/is_error when it raised."""
    return [f"attempt receive_count={e.get('receive_count')} status={e.get('status')} outcome={e.get('outcome')}"
            + (f" error={str(e.get('error'))[:240]!r}" if e.get("error") else "")
            for e in events_for(events, turn_id) if e.get("ev") == "turn"]


# -- pure: rendering -----------------------------------------------------------------------


def render_snap(snap: TurnSnap, events: list[dict]) -> list[str]:
    lines = [f"-- turn {snap.turn_id}",
             "   turns: " + ("(no row)" if snap.row is None else
                             "receive_count={} completed_at={} outcome={} cost_usd={}".format(*snap.row)),
             f"   turn_done: {json.dumps(snap.payload, default=str) if snap.payload else '(none)'}",
             f"   tool_calls ({len(snap.calls)}):"]
    lines.extend(f"      #{c[0]} {c[1]} agent={c[2]} {c[3]} {c[4]}" for c in snap.calls)
    mine = events_for(events, snap.turn_id)
    stderr = [e for e in mine if e.get("ev") == "cli_stderr"]
    lines.append(f"   worker ev lines ({len(mine) - len(stderr)}, plus {len(stderr)} cli_stderr):")
    for e in mine:
        if e.get("ev") == "cli_stderr":
            continue
        brief = {k: v for k, v in e.items() if k not in ("turn_id", "session_id")}
        lines.append(f"      {json.dumps(brief, default=str)[:400]}")
    lines.extend(f"      cli_stderr {str(e.get('line'))[:200]!r}" for e in stderr[:3])
    return lines


def render_report(rep: Report) -> str:
    out = [f"== proto-bounds {rep.case}  session={rep.session_id}  turns={rep.turn_ids}"]
    out.extend(rep.evidence)
    out.append("-- findings")
    out.extend(f"   {f}" for f in rep.findings or ["(none)"])
    out.append("-- figures")
    out.append("   " + " ".join(f"{k}={v}" for k, v in rep.figures.items()))
    out.append("")
    width = max((len(c[0]) for c in rep.checks), default=0)
    for name, ok, detail in rep.checks:
        out.append(f"{name:{width}} {'PASS' if ok else 'FAIL'}  {'' if ok else detail}")
    failed = sum(not ok for _, ok, _ in rep.checks)
    out.append(f"\n{rep.case}: {len(rep.checks) - failed}/{len(rep.checks)} checks passed  session={rep.session_id}")
    return "\n".join(out)


# -- the stack -----------------------------------------------------------------------------


def db_exec(dsn: str, sql: str, params: tuple) -> int:
    """A write through its own committed connection (``turn.db`` fetches, which a bare
    INSERT or DELETE cannot); the rowcount."""
    with psycopg.connect(dsn) as conn:
        return conn.execute(sql, params).rowcount


def worker_events() -> list[dict]:
    """The worker container's JSON lines, whole and in order (across restarts)."""
    return parse_json_lines(smoke.compose("logs", "--no-color", "--no-log-prefix", "worker"))


def snapshot(ctx: Ctx, session_id: str, turn_id: str) -> TurnSnap:
    rows = turn.db(ctx.dsn, TURN_SQL, (turn_id,))
    cfg = smoke.Config()
    cfg.pg_dsn = ctx.dsn
    return TurnSnap(turn_id=turn_id, row=rows[0] if rows else None, calls=turn.db(ctx.dsn, CALLS_SQL, (turn_id,)),
                    payload=smoke.turn_done_payload(cfg, session_id, turn_id))


def entries(ctx: Ctx, sdk: str | None, after: int, upto: int | None = None) -> list[tuple]:
    if not sdk:
        return []
    return turn.db(ctx.dsn, ENTRIES_SQL, (sdk, after, upto if upto is not None else 2**62))


def max_entry(ctx: Ctx, sdk: str | None) -> int:
    return int(turn.one(ctx.dsn, MAX_ENTRY_SQL, (sdk or "",)) or 0)


def fresh_session(ctx: Ctx, client: httpx.Client, rep: Report) -> str:
    r = client.post(f"{ctx.base}/api/sessions", json={"title": f"u23 {rep.case}"})
    r.raise_for_status()
    rep.session_id = r.json()["id"]
    return rep.session_id


def seeded_session(ctx: Ctx, rep: Report) -> str:
    """``--session`` when given, else a fresh seed of ``--fixture`` (demo.py's seed)."""
    if ctx.session:
        rep.session_id = ctx.session
    else:
        args = argparse.Namespace(fixture=ctx.fixture, project_id=None, title=f"u23 {rep.case}", pg_dsn=ctx.dsn,
                                  s3_endpoint=ctx.s3_endpoint, base=ctx.base, email=ctx.email)
        rep.session_id, _project, _meta = demo.seed_session(args)
    return rep.session_id


def post(ctx: Ctx, client: httpx.Client, rep: Report, text: str) -> dict:
    """POST one message; the tier's reply (turn_id, message_id, queued). The turn is
    recorded on the report before anything can fail, so settle and the evidence see it."""
    r = client.post(f"{ctx.base}/api/sessions/{rep.session_id}/messages", json={"text": text})
    r.raise_for_status()
    reply = r.json()
    rep.turn_ids.append(reply["turn_id"])
    return reply


def wait_first_call(ctx: Ctx, turn_id: str, *, subagent: bool) -> tuple[str, tuple | None]:
    """``("seen", row)`` at the turn's first allowed call on that thread; ``("completed",
    None)`` if it closed without one; ``("timeout", None)`` at the deadline."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < ctx.deadline_s:
        row = first_call(turn.db(ctx.dsn, CALLS_SQL, (turn_id,)), subagent=subagent)
        if row is not None:
            return "seen", row
        if turn.one(ctx.dsn, "SELECT completed_at FROM turns WHERE turn_id = %s", (turn_id,)) is not None:
            return "completed", None
        time.sleep(0.3)
    return "timeout", None


def reach(ctx: Ctx, rep: Report, turn_id: str, *, subagent: bool) -> tuple | None:
    status, row = wait_first_call(ctx, turn_id, subagent=subagent)
    where = "a subagent" if subagent else "the main thread"
    rep.checks.append((f"{rep.case}: the turn reached its first allowed call on {where}", status == "seen",
                       "the turn closed without one" if status == "completed" else "none within --deadline-s"))
    if row is not None:
        rep.figures["first_call"] = f"{row[1]}@{row[2] or 'main'}"
    return row


def press(ctx: Ctx, client: httpx.Client, rep: Report) -> float:
    """Stop; the press's monotonic time. A refused press is a FAIL, not a crash."""
    t = time.monotonic()
    err = turn.interrupt(client, ctx.base, rep.session_id)
    rep.checks.append((f"{rep.case}: Stop answered 202", err is None, str(err)))
    return t


def done(ctx: Ctx, client: httpx.Client, rep: Report, turn_id: str, *, since: float | None = None,
         label: str = "") -> bool:
    try:
        wall = demo.wait_turn_done(client, ctx.base, rep.session_id, turn_id, ctx.deadline_s)
    except TimeoutError as exc:
        rep.checks.append((f"{rep.case}: {label or turn_id} reached turn_done", False, str(exc)))
        return False
    rep.checks.append((f"{rep.case}: {label or turn_id} reached turn_done", True, ""))
    if since is not None:
        rep.figures[f"{label or 'turn'}_done_after_s"] = round(time.monotonic() - since, 1)
    else:
        rep.figures[f"{label or 'turn'}_wall_s"] = round(wall, 1)
    return True


def inject(ctx: Ctx, rep: Report, sdk: str | None) -> int:
    if not sdk:
        raise RuntimeError("no sdk_session_id to inject under")
    tokens = tokens_to_exceed(ctx.cap_usd, ctx.price_output)
    db_exec(ctx.dsn, INJECT_SQL, (PROBE_KEY, sdk, Jsonb(probe_entry(tokens))))
    rep.figures.update({"injected_output_tokens": tokens, "calibration": "excluded (injected usage)"})
    return tokens


def settle(ctx: Ctx, client: httpx.Client, session_id: str, deadline_s: float = SETTLE_S) -> tuple[list[str], list[str]]:
    """Press Stop every 10 s until the session runs nothing; ``(still running, held)``. A
    held row is not billed, but a release turns it into a running one, which this then
    stops too."""
    t0 = time.monotonic()
    pressed = -math.inf
    while True:
        try:
            rows = turn.db(ctx.dsn, OPEN_SQL, (session_id,))
        except Exception as exc:  # noqa: BLE001 - postgres may be the thing that is down
            rows = [(f"<unreadable: {type(exc).__name__}>", None)]
        running = [t for t, o in rows if o != TERMINAL_QUEUED]
        held = [t for t, o in rows if o == TERMINAL_QUEUED]
        if not running or time.monotonic() - t0 > deadline_s:
            return running, held
        if time.monotonic() - pressed >= 10:
            turn.interrupt(client, ctx.base, session_id)
            pressed = time.monotonic()
        time.sleep(2.0)


def postgres_answers(ctx: Ctx, deadline_s: float = 60.0) -> bool:
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        try:
            turn.db(ctx.dsn, "SELECT 1", ())
            return True
        except Exception:  # noqa: BLE001
            time.sleep(2.0)
    return False


def utc_now() -> str:
    """RFC 3339 in UTC, the form ``docker logs --since/--until`` takes."""
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def docker_logs(container: str, since: str, until: str) -> list[str]:
    proc = subprocess.run(["docker", "logs", "--since", since, "--until", until, container],
                          capture_output=True, text=True, encoding="utf-8", check=False)
    return [ln for ln in (proc.stdout + proc.stderr).splitlines() if ln.strip()]


def stopped_at(ctx: Ctx, session_id: str) -> Any:
    return turn.one(ctx.dsn, STOP_AT_SQL, (session_id,))


def sdk_of(ctx: Ctx, session_id: str) -> str | None:
    return turn.one(ctx.dsn, SDK_SQL, (session_id,))


def halt_latency(snap: TurnSnap, pressed_at: Any) -> float | None:
    """First halt row's ts minus sessions.stop_requested_at: both the Postgres clock."""
    halt = next((c for c in snap.calls if c[3] == "halt"), None)
    a, b = _ts(pressed_at), _ts(halt[4]) if halt else None
    return round((b - a).total_seconds(), 2) if a and b else None


def figures_for(rep: Report, snap: TurnSnap) -> None:
    rep.figures[f"{snap.turn_id}.cost_usd"] = float(snap.row[3]) if snap.row and snap.row[3] is not None else None
    rep.figures[f"{snap.turn_id}.spend_estimate_usd"] = (snap.payload or {}).get("spend_estimate_usd")


# -- the cases -----------------------------------------------------------------------------


def case_precli(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    fresh_session(ctx, client, rep)
    down = False
    try:
        turn.docker("stop", ctx.worker)
        down = True
        # Open, not held: no turn runs, so the tier enqueues it and the shim cannot deliver.
        tid = post(ctx, client, rep, FOLLOW_UP_TEXT)["turn_id"]
        press(ctx, client, rep)
        rep.checks.append(("precli: the flag is set while the turn waits", stopped_at(ctx, rep.session_id) is not None, ""))
    finally:
        if down:
            turn.docker("start", ctx.worker)
    if not done(ctx, client, rep, tid):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks += [closed_check("precli", snap, TERMINAL_STOPPED), payload_check("precli", snap, TERMINAL_STOPPED),
                   *unbilled_checks("precli", snap, events, TERMINAL_STOPPED)]


def case_stop_main(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    t = press(ctx, client, rep)
    pressed_at = stopped_at(ctx, rep.session_id)
    if not done(ctx, client, rep, tid, since=t, label="stopped"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks += [*halt_checks("stop_main", snap.calls, events_for(events, tid), reason=STOP_REASON, subagent=False),
                   closed_check("stop_main", snap, TERMINAL_STOPPED), payload_check("stop_main", snap, TERMINAL_STOPPED)]
    rep.figures["halt_after_press_s"] = halt_latency(snap, pressed_at)
    rep.findings.append("Q1 (main thread): %s -- %s" % q1_answer(events, tid))
    nxt = post(ctx, client, rep, FOLLOW_UP_TEXT)["turn_id"]
    left = stopped_at(ctx, rep.session_id)
    rep.checks.append(("stop_main: the next message cleared the flag", left is None, f"stop_requested_at={left}"))
    if done(ctx, client, rep, nxt, label="next"):
        rep.checks.append(ran_check("stop_main: the next message", snapshot(ctx, rep.session_id, nxt)))


def _delegation(ctx: Ctx, client: httpx.Client, rep: Report, *, bound: str) -> None:
    seeded_session(ctx, rep)
    tid = post(ctx, client, rep, EXTRACTIONS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=True) is None:
        return
    sdk = sdk_of(ctx, rep.session_id)
    before = int(turn.one(ctx.dsn, "SELECT entries_seq_before FROM turns WHERE turn_id = %s", (tid,)) or 0)
    if bound == "stop":
        t = press(ctx, client, rep)
    else:
        inject(ctx, rep, sdk)
        t = time.monotonic()
    if not done(ctx, client, rep, tid, since=t, label="bounded"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    label = rep.case
    if bound == "stop":
        rep.checks += [*halt_checks(label, snap.calls, events_for(events, tid), reason=STOP_REASON, subagent=True),
                       closed_check(label, snap, TERMINAL_STOPPED), payload_check(label, snap, TERMINAL_STOPPED)]
    else:
        rep.checks += cap_checks(label, snap, events, cap_usd=ctx.cap_usd, subagent=True)
    rep.findings.append("Q1 (in a delegation): %s -- %s" % q1_answer(events, tid))
    rep.findings.append("Q2 (subagent halt stops the parent?): %s -- %s" % q2_answer(snap.calls, entries(ctx, sdk, before)))
    rep.findings.extend(f"ResultMessage via ev=turn: {line}" for line in result_findings(events, tid))


def case_stop_delegation(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _delegation(ctx, client, rep, bound="stop")


def case_cap_delegation(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _delegation(ctx, client, rep, bound="cap")


def shim_posts_for(msgid: str | None, timeout_s: float = 60, every_s: float = 1.0) -> list[dict]:
    """The shim's post lines for ``msgid``, polled: the shim logs one when the worker
    answers the delivery, after its teardown and release -- past the turn_done ``done`` saw."""
    if msgid is None:
        return []
    return smoke.wait_for(lambda: [p for p in smoke.service_lines("shim", "post") if p.get("msgid") == msgid],
                          timeout_s, every_s) or []


def _held(ctx: Ctx, client: httpx.Client, rep: Report, *, stop_first: bool) -> None:
    fresh_session(ctx, client, rep)
    a = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, a, subagent=False) is None:
        return
    if stop_first:
        press(ctx, client, rep)
    t = time.monotonic()
    reply = post(ctx, client, rep, turn.TEXT_KILL)
    b = reply["turn_id"]
    if not done(ctx, client, rep, a, since=t, label="first"):
        return
    if not done(ctx, client, rep, b, label="held"):
        return
    events = worker_events()
    sa, sb = snapshot(ctx, rep.session_id, a), snapshot(ctx, rep.session_id, b)
    released = released_by(events, a)
    rep.checks += held_checks(rep.case, reply, sa, sb, events, shim_posts_for(released[-1] if released else None),
                              a_outcome=TERMINAL_STOPPED if stop_first else TERMINAL_QUEUED,
                              a_reason=STOP_REASON if stop_first else HANDOVER_REASON)
    rep.findings.append("Q1 (handover): %s -- %s" % q1_answer(events, a))


def case_held_release(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _held(ctx, client, rep, stop_first=False)


def case_held_after_stop(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _held(ctx, client, rep, stop_first=True)


def case_cap_main(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    inject(ctx, rep, sdk_of(ctx, rep.session_id))
    t = time.monotonic()
    if not done(ctx, client, rep, tid, since=t, label="capped"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks += cap_checks("cap_main", snap, events, cap_usd=ctx.cap_usd, subagent=False)
    rep.findings.append("Q1 (cap, main thread): %s -- %s" % q1_answer(events, tid))
    # The capped session's next message closes before the CLI (the precli cap half).
    nxt = post(ctx, client, rep, FOLLOW_UP_TEXT)["turn_id"]
    if not done(ctx, client, rep, nxt, label="next"):
        return
    snap2, events = snapshot(ctx, rep.session_id, nxt), worker_events()
    rep.checks += [closed_check("cap_main: next", snap2, TERMINAL_BUDGET),
                   payload_check("cap_main: next", snap2, TERMINAL_BUDGET, "spend"),
                   *unbilled_checks("cap_main: next", snap2, events, TERMINAL_BUDGET)]


def case_cap_main_real(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    seeded_session(ctx, rep)
    meta = seed.fixture_meta(seed.resolve_fixture(ctx.fixture))
    tid = post(ctx, client, rep, demo.opening_prompt(meta, None))["turn_id"]
    if not done(ctx, client, rep, tid, label="capped"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks += cap_checks("cap_main_real", snap, events, cap_usd=ctx.cap_usd, subagent=None)
    fired = [e for e in events_for(events, tid) if e.get("ev") == "spend_cap"]
    estimate = (snap.payload or {}).get("spend_estimate_usd")
    split = turn.db(ctx.dsn, CACHE_SPLIT_SQL, (sdk_of(ctx, rep.session_id) or "",))
    m5, h1, total = split[0] if split else (None, None, None)
    rep.figures.update({
        "cap_usd": ctx.cap_usd, "spent_at_halt_usd": fired[0].get("spent_usd") if fired else None,
        "overshoot_usd": round(estimate - ctx.cap_usd, 4) if isinstance(estimate, (int, float)) else None,
        "cache_write_5m": m5, "cache_write_1h": h1, "cache_write_total": total,
    })
    rep.findings.append("Q1 (real cap): %s -- %s" % q1_answer(events, tid))


def _outage(ctx: Ctx, client: httpx.Client, rep: Report, *, condition: str) -> None:
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    sdk = sdk_of(ctx, rep.session_id)
    rc1 = int(turn.one(ctx.dsn, "SELECT receive_count FROM turns WHERE turn_id = %s", (tid,)) or 0)
    reply: dict = {}
    if condition == "stop":
        press(ctx, client, rep)
    elif condition == "cap":
        inject(ctx, rep, sdk)
    else:
        reply = post(ctx, client, rep, turn.TEXT_KILL)
    mark1, t_out = max_entry(ctx, sdk), utc_now()
    terminated = sum(1 for (ok,) in turn.db(ctx.dsn, TERMINATE_SQL, (f"turn:{tid}",)) if ok)
    # Attempt 1 ends when the redelivery claims the turn (receive_count moves) or it closes.
    t0 = time.monotonic()
    while time.monotonic() - t0 < ctx.deadline_s:
        row = turn.db(ctx.dsn, "SELECT receive_count, completed_at FROM turns WHERE turn_id = %s", (tid,))
        if row and (row[0][0] > rc1 or row[0][1] is not None):
            break
        time.sleep(0.3)
    mark2, t_end = max_entry(ctx, sdk), utc_now()
    ran, unresolved = calls_ran(entries(ctx, sdk, mark1, mark2))
    tools_lines = docker_logs(ctx.tools, t_out, t_end)
    rep.figures.update({"terminated_backends": terminated, "entries_window": f"({mark1}, {mark2}]",
                        "tools_log_lines_in_window": len(tools_lines)})
    rep.findings.append(f"calls issued after the outage with no result in attempt 1: {unresolved}")
    rep.findings.extend(f"tools log in the window: {ln[:200]}" for ln in tools_lines[:5])
    if not done(ctx, client, rep, tid, label="redelivered"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    want = {"stop": TERMINAL_STOPPED, "cap": TERMINAL_BUDGET, "held": TERMINAL_QUEUED}[condition]
    rep.checks += [*outage_checks(rep.case, events, tid, terminated=terminated, ran=ran),
                   redelivered_check(rep.case, snap), closed_check(rep.case, snap, want)]
    if condition == "cap":
        rep.checks.append(payload_check(rep.case, snap, TERMINAL_BUDGET, "spend"))
    rep.findings.extend(f"{rep.case}: {line}" for line in result_findings(events, tid))
    failed = [e for e in events_for(events, tid) if e.get("ev") in ("halt_check_failed", "halt_failed")]
    rep.findings.append(f"store-loss path: {[(e.get('ev'), e.get('clause'), e.get('error')) for e in failed] or 'receive loop'}")
    if condition == "held":
        b = reply["turn_id"]
        rep.checks.append((f"{rep.case}: the second message was held", reply.get("queued") is True, f"reply={reply}"))
        if done(ctx, client, rep, b, label="held"):
            rep.checks.append(ran_check(f"{rep.case}: the held turn", snapshot(ctx, rep.session_id, b)))


def case_outage_stop(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _outage(ctx, client, rep, condition="stop")


def case_outage_cap(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _outage(ctx, client, rep, condition="cap")


def case_outage_held(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    _outage(ctx, client, rep, condition="held")


def case_outage_pause(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    sdk = sdk_of(ctx, rep.session_id)
    mark1 = max_entry(ctx, sdk)
    calls_before = int(turn.one(ctx.dsn, "SELECT COALESCE(max(id), 0) FROM tool_calls WHERE turn_id = %s", (tid,)) or 0)
    paused, t_p = False, utc_now()
    try:
        turn.docker("pause", ctx.postgres)
        paused = True
        time.sleep(ctx.pause_s)  # no driver read may touch postgres while it is frozen
    finally:
        if paused:
            turn.docker("unpause", ctx.postgres)
    t_u = utc_now()
    rep.checks.append(("outage_pause: postgres answers after the unpause", postgres_answers(ctx), ""))
    rep.figures.update({"paused_s": ctx.pause_s, "paused_at": t_p, "unpaused_at": t_u})
    try:
        wall = demo.wait_turn_done(client, ctx.base, rep.session_id, tid, ctx.deadline_s)
        rep.findings.append(f"turn_done {wall:.0f}s after the unpause")
    except TimeoutError as exc:
        rep.findings.append(f"no turn_done: {exc} (settle stops it)")
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    ran, unresolved = calls_ran(entries(ctx, sdk, mark1))
    mine = events_for(events, tid)
    hook = [str(e.get("line"))[:200] for e in mine if e.get("ev") == "cli_stderr"
            and any(k in str(e.get("line") or "").lower() for k in ("hook", "timeout", "timed out"))]
    rep.findings += [
        f"turn row: {snap.row}",
        f"tool_calls rows after the pause began: {[(c[1], c[3]) for c in snap.calls if c[0] > calls_before]}",
        f"calls that ran after the pause began (session_entries): {ran}; with no result: {unresolved}",
        f"store-loss lines: {[(e.get('ev'), e.get('clause'), e.get('error')) for e in mine if e.get('ev') in ('halt_check_failed', 'halt_failed')]}",
        f"CLI hook/timeout stderr: {hook[:5]}",
        *result_findings(events, tid),
    ]


def case_probe_resume(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    seeded_session(ctx, rep)
    project_id = turn.one(ctx.dsn, "SELECT project_id FROM sessions WHERE session_id = %s", (rep.session_id,))
    tid = post(ctx, client, rep, RESUME_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=True) is None:
        return
    time.sleep(ctx.kill_after_s)
    sdk_before = sdk_of(ctx, rep.session_id)
    at_kill = int(turn.one(ctx.dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",)) or 0)
    marks = turn.take_marks(ctx.dsn, rep.session_id, tid, sdk_before, project_id)
    killed = False
    try:
        turn.docker("kill", ctx.worker)
        killed = True
    finally:
        turn.docker("start", ctx.worker)
    rep.figures.update({"kill_after_s": ctx.kill_after_s, "killed": killed})
    finished = done(ctx, client, rep, tid, label="resumed")
    rep.evidence.append(turn.render_evidence(turn.gather_evidence(ctx.dsn, rep.session_id, tid, sdk_before, project_id, marks)))
    if not finished:
        return
    snap = snapshot(ctx, rep.session_id, tid)
    after = int(turn.one(ctx.dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",)) or 0)
    rep.checks += resume_checks("probe_resume", snap, sdk_before=sdk_before, sdk_after=sdk_of(ctx, rep.session_id),
                                entries_at_kill=at_kill, entries_after=after)
    inputs = agent_inputs(entries(ctx, sdk_before, 0))
    rep.findings.append(f"Agent inputs as session_entries keeps them (name, has run_in_background, value): {inputs}")
    rep.findings.append(f"ev=foregrounded lines: {len([e for e in events_for(worker_events(), tid) if e.get('ev') == 'foregrounded'])}")


CASES: dict[str, Callable[[Ctx, httpx.Client, Report], None]] = {
    "precli": case_precli,
    "stop_main": case_stop_main,
    "stop_delegation": case_stop_delegation,
    "held_release": case_held_release,
    "held_after_stop": case_held_after_stop,
    "cap_main": case_cap_main,
    "cap_main_real": case_cap_main_real,
    "cap_delegation": case_cap_delegation,
    "outage_stop": case_outage_stop,
    "outage_cap": case_outage_cap,
    "outage_held": case_outage_held,
    "outage_pause": case_outage_pause,
    "probe_resume": case_probe_resume,
}
SEEDED = frozenset({"stop_delegation", "cap_delegation", "cap_main_real", "probe_resume"})


def run_case(ctx: Ctx, name: str) -> Report:
    """One case, then -- whatever it did -- the probe rows deleted, every running turn
    Stopped, and the evidence for each turn it posted."""
    rep = Report(case=name)
    with turn.signed_in_client(ctx.base, ctx.email) as client:
        try:
            CASES[name](ctx, client, rep)
        except Exception as exc:  # noqa: BLE001 - a crash is a FAIL with its evidence, not a traceback
            rep.checks.append((f"{name}: the case ran to its end", False, f"{type(exc).__name__}: {exc}"))
        finally:
            try:
                db_exec(ctx.dsn, DELETE_PROBE_SQL, (PROBE_KEY,))
            except Exception as exc:  # noqa: BLE001
                rep.findings.append(f"probe rows NOT deleted ({type(exc).__name__}); run: DELETE FROM session_entries "
                                    f"WHERE project_key = '{PROBE_KEY}'")
            if rep.session_id:
                running, held = settle(ctx, client, rep.session_id)
                rep.checks.append((f"{name}: no turn left running", not running, f"running={running}"))
                if held:
                    rep.findings.append(f"held rows left (not billed): {held}")
    if rep.session_id and rep.turn_ids:
        try:
            events = worker_events()
            for tid in rep.turn_ids:
                snap = snapshot(ctx, rep.session_id, tid)
                figures_for(rep, snap)
                rep.evidence.extend(render_snap(snap, events))
        except Exception as exc:  # noqa: BLE001
            rep.evidence.append(f"-- evidence unreadable: {type(exc).__name__}: {exc}")
    return rep


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--case", required=True, choices=sorted(CASES))
    p.add_argument("--session", default=None, help=f"a seeded session for {', '.join(sorted(SEEDED))} (else one is seeded)")
    p.add_argument("--fixture", default=demo.DEFAULT_FIXTURE, help="what a seeded case seeds, and cap_main_real's question")
    p.add_argument("--base", default="http://127.0.0.1:8085")
    p.add_argument("--email", default=turn.DEV_LOGIN_EMAIL)
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--s3-endpoint", default="http://localhost:9000")
    p.add_argument("--deadline-s", type=float, default=DEFAULT_DEADLINE_S, help="per wait")
    p.add_argument("--kill-after-s", type=float, default=10.0, help="probe_resume: seconds after the first subagent row (5-20)")
    p.add_argument("--pause-s", type=float, default=30.0, help="outage_pause: how long postgres stays frozen")
    p.add_argument("--worker-container", default="proto-worker")
    p.add_argument("--postgres-container", default="proto-postgres")
    p.add_argument("--tools-container", default="proto-tools")
    return p


def make_ctx(args: argparse.Namespace, start: dict | None) -> Ctx:
    """The parsed arguments plus the worker's spend figures; ValueError on a combination
    that would spend money for nothing (or too much)."""
    if args.session is not None and args.case not in SEEDED:
        raise ValueError(f"--session is for {', '.join(sorted(SEEDED))}; {args.case} runs on a fresh session")
    lo, hi = KILL_AFTER_RANGE_S
    if args.case == "probe_resume" and not lo <= args.kill_after_s <= hi:
        raise ValueError(f"--kill-after-s must be {lo:g}-{hi:g}, not {args.kill_after_s:g}")
    if args.deadline_s <= 0 or args.pause_s <= 0:
        raise ValueError("--deadline-s and --pause-s must be positive")
    cap, price, source = spend_config(start, SPEND_CAP_USD, PRICE_PER_MTOK["output"])
    if args.case == "cap_main_real" and not 0 < cap <= REAL_CAP_MAX_USD:
        raise ValueError(f"cap_main_real wants SESSION_SPEND_CAP_USD lowered to (0, {REAL_CAP_MAX_USD:g}]; the worker "
                         f"runs at {cap:g} ({source})")
    if args.case in ("cap_main", "cap_delegation", "outage_cap") and cap <= 0:
        raise ValueError(f"the worker's spend cap is off ({cap:g}, {source}); nothing to inject over")
    return Ctx(base=args.base, dsn=args.pg_dsn, email=args.email, s3_endpoint=args.s3_endpoint, fixture=args.fixture,
               session=args.session, deadline_s=args.deadline_s, kill_after_s=args.kill_after_s, pause_s=args.pause_s,
               cap_usd=cap, price_output=price, worker=args.worker_container, postgres=args.postgres_container,
               tools=args.tools_container)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    problem = demo.preflight(args.base, args.pg_dsn) or turn.require_grant(args.pg_dsn, args.email)
    if problem:
        print(f"bounds: {problem}", file=sys.stderr)
        return 2
    try:
        starts = [e for e in worker_events() if e.get("ev") == "start"]
        ctx = make_ctx(args, starts[-1] if starts else None)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:  # OSError: no compose command
        print(f"bounds: {exc}", file=sys.stderr)
        return 2
    rep = run_case(ctx, args.case)
    print(render_report(rep))
    return 1 if any(not ok for _, ok, _ in rep.checks) else 0


if __name__ == "__main__":
    sys.exit(main())
