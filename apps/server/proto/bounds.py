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
  outage_hook      the store fails INSIDE the halt check, not the receive loop: turns locked
                   ACCESS EXCLUSIVE so the handover read blocks, then that one backend
                   cancelled (QueryCanceled): the hook halts store_unavailable, 500, the
                   redelivery runs on
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
from proto import demo, seed, smoke, target, turn  # noqa: E402
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
# outage_hook: the turn's own backend, waiting on the `turns` lock inside the halt check's
# handover read -- the receive loop never reads `turns`, so only the hook can be waiting here.
HOOK_WAITER_SQL = (
    "SELECT pid FROM pg_stat_activity WHERE application_name = %s AND wait_event_type = 'Lock' "
    "AND query ILIKE %s"
)
HOOK_WAIT_QUERY = "%FROM turns WHERE session_id%"
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
    target: str = "compose"


def compose_target(worker: str = "proto-worker", postgres: str = "proto-postgres",
                   tools: str = "proto-tools") -> target.ComposeTarget:
    """Today's docker argv, through ``turn.docker`` (late-bound, so tests that replace it see
    every call)."""
    return target.ComposeTarget({"web": "proto-web", "worker": worker, "postgres": postgres, "tools": tools},
                                docker=lambda *a: turn.docker(*a), compose=lambda *a: smoke.compose(*a))


# Where worker_events, signal and pause go; make_ctx sets it from --target.
TARGET: target.ComposeTarget | target.DeployedTarget = compose_target()


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
    """Every JSON-object line of a container or CloudWatch log, in order, parsed from its
    first ``{``; anything else skipped."""
    return target.json_records(text)


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


def hook_outage_checks(label: str, events: list[dict], turn_id: str, *, cancelled: int,
                       ran: list[tuple]) -> list[Check]:
    """The store failed inside the halt check: the hook (not the receive loop) saw it,
    classified it down, halted with STORE_UNAVAILABLE_REASON, and the attempt answered 500
    StoreUnavailable with no call run after."""
    mine = events_for(events, turn_id)
    failed = [e for e in mine if e.get("ev") == "halt_check_failed" and e.get("store_down")]
    halts = [e for e in mine if e.get("ev") == "halt" and e.get("reason") == STORE_UNAVAILABLE_REASON]
    five = [e for e in mine if e.get("ev") == "turn" and e.get("status") == 500]
    return [
        (f"{label}: cancelled the turn's backend waiting in the halt check", cancelled >= 1, f"cancelled={cancelled}"),
        (f"{label}: the hook classified the store down (ev=halt_check_failed store_down)",
         bool(failed), f"failed={failed[:2]}"),
        (f"{label}: the hook halted with the store-unavailable reason", bool(halts), f"halts={halts[:2]}"),
        (f"{label}: the attempt answered 500 StoreUnavailable",
         any(str(e.get("error") or "").startswith("StoreUnavailable") for e in five),
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
    """The worker's JSON lines, whole and in order (across restarts)."""
    return TARGET.events("worker")


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


def epoch_ms(rfc3339: str) -> int:
    return int(datetime.strptime(rfc3339, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp() * 1000)


def tools_log_lines(ctx: Ctx, since: str, until: str) -> list[str]:
    """The tool server's log lines between two ``utc_now`` marks, from its container or its
    CloudWatch group."""
    if TARGET.name == "compose":
        return docker_logs(ctx.tools, since, until)
    return [ln for ln in TARGET.logs("tools", epoch_ms(since), epoch_ms(until)).splitlines() if ln.strip()]


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
        TARGET.signal("worker", "stop")
        down = True
        # Open, not held: no turn runs, so the tier enqueues it and the shim cannot deliver.
        tid = post(ctx, client, rep, FOLLOW_UP_TEXT)["turn_id"]
        press(ctx, client, rep)
        rep.checks.append(("precli: the flag is set while the turn waits", stopped_at(ctx, rep.session_id) is not None, ""))
    finally:
        if down:
            TARGET.signal("worker", "start")
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


DEPLOYED_DELIVERY_S = (180.0, 5.0)  # CloudWatch ingestion lags the worker by tens of seconds


def deliveries(events: list[dict], msgid: str) -> list[dict]:
    """The worker's own evidence that ``msgid`` was delivered: an ev=released line maps it to
    a turn_id, and an ev=turn line with a receive_count says sqsd handed that turn over.
    One dict per such ev=turn, carrying ``msgid`` (held_checks reads it)."""
    released = {e.get("turn_id") for e in events if e.get("ev") == "released" and e.get("message_id") == msgid}
    return [{**e, "msgid": msgid} for e in events
            if e.get("ev") == "turn" and e.get("turn_id") in released and e.get("receive_count") is not None]


def shim_posts_for(msgid: str | None, timeout_s: float | None = None, every_s: float | None = None) -> list[dict]:
    """``msgid``'s deliveries, polled. Compose: the shim's post lines, logged when the worker
    answers the delivery, after its teardown and release -- past the turn_done ``done`` saw.
    Deployed: sqsd's log is not read; the worker's own lines (``deliveries``), on a longer
    budget for CloudWatch's lag."""
    if msgid is None:
        return []
    if TARGET.name == "compose":
        return smoke.wait_for(lambda: smoke.shim_decisions(msgid), 60 if timeout_s is None else timeout_s,
                              1.0 if every_s is None else every_s) or []
    budget, every = DEPLOYED_DELIVERY_S
    return smoke.wait_for(lambda: deliveries(worker_events(), msgid), budget if timeout_s is None else timeout_s,
                          every if every_s is None else every_s) or []


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
    tools_lines = tools_log_lines(ctx, t_out, t_end)
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


def cancel_hook_waiter(ctx: Ctx, turn_id: str) -> int:
    """Lock ``turns`` ACCESS EXCLUSIVE, wait for the turn's backend to block on it inside the
    halt check, cancel that backend, release. Returns how many backends were cancelled. No
    other driver read may touch ``turns`` while the lock is held."""
    # Two connections: pg_stat_activity is snapshotted once per transaction, so a poll inside
    # the transaction holding the lock never sees the backend that starts waiting on it.
    with psycopg.connect(ctx.dsn) as lock, psycopg.connect(ctx.dsn, autocommit=True) as watch:
        lock.execute("SET lock_timeout = '10s'")
        lock.execute("LOCK TABLE turns IN ACCESS EXCLUSIVE MODE")
        try:
            t0 = time.monotonic()
            while time.monotonic() - t0 < 60:
                pids = [r[0] for r in watch.execute(HOOK_WAITER_SQL, (f"turn:{turn_id}", HOOK_WAIT_QUERY)).fetchall()]
                if pids:
                    return sum(1 for pid in pids
                               if watch.execute("SELECT pg_cancel_backend(%s)", (pid,)).fetchone()[0])
                time.sleep(0.2)
            return 0
        finally:
            lock.rollback()


def case_outage_hook(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:  # the handover read needs one call made
        return
    sdk = sdk_of(ctx, rep.session_id)
    rc1 = int(turn.one(ctx.dsn, "SELECT receive_count FROM turns WHERE turn_id = %s", (tid,)) or 0)
    mark1 = max_entry(ctx, sdk)
    cancelled = cancel_hook_waiter(ctx, tid)
    t0 = time.monotonic()
    while time.monotonic() - t0 < ctx.deadline_s:
        row = turn.db(ctx.dsn, "SELECT receive_count, completed_at FROM turns WHERE turn_id = %s", (tid,))
        if row and (row[0][0] > rc1 or row[0][1] is not None):
            break
        time.sleep(0.3)
    mark2 = max_entry(ctx, sdk)
    ran, unresolved = calls_ran(entries(ctx, sdk, mark1, mark2))
    rep.figures.update({"cancelled_backends": cancelled, "entries_window": f"({mark1}, {mark2}]"})
    rep.findings.append(f"calls issued in attempt 1 after the cancel with no result: {unresolved}")
    if not done(ctx, client, rep, tid, label="redelivered"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks += [*hook_outage_checks(rep.case, events, tid, cancelled=cancelled, ran=ran),
                   redelivered_check(rep.case, snap), ran_check(f"{rep.case}: the redelivery", snap)]
    rep.findings.extend(f"{rep.case}: {line}" for line in result_findings(events, tid))


def case_outage_pause(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    sdk = sdk_of(ctx, rep.session_id)
    mark1 = max_entry(ctx, sdk)
    calls_before = int(turn.one(ctx.dsn, "SELECT COALESCE(max(id), 0) FROM tool_calls WHERE turn_id = %s", (tid,)) or 0)
    t_p = utc_now()
    with TARGET.pause("postgres"):
        time.sleep(ctx.pause_s)  # no driver read may touch postgres while it is frozen
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
        TARGET.signal("worker", "kill")
        killed = True
    finally:
        TARGET.signal("worker", "start")
    rep.figures.update({"kill_after_s": ctx.kill_after_s, "killed": killed})
    finished = done(ctx, client, rep, tid, label="resumed")
    rep.evidence.append(turn.render_evidence(turn.gather_evidence(ctx.dsn, rep.session_id, tid, sdk_before, project_id, marks)))
    # Findings first: a resumed run that outlasts the deadline still answers both questions.
    inputs = agent_inputs(entries(ctx, sdk_before, 0))
    rep.findings.append(f"Agent inputs as session_entries keeps them (name, has run_in_background, value): {inputs}")
    rep.findings.append(f"ev=foregrounded lines: {len([e for e in events_for(worker_events(), tid) if e.get('ev') == 'foregrounded'])}")
    if not finished:
        return
    snap = snapshot(ctx, rep.session_id, tid)
    after = int(turn.one(ctx.dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s", (sdk_before or "",)) or 0)
    rep.checks += resume_checks("probe_resume", snap, sdk_before=sdk_before, sdk_after=sdk_of(ctx, rep.session_id),
                                entries_at_kill=at_kill, entries_after=after)


# -- U13: cases for the rehearsal's Beanstalk worker (--target deployed only) -----------------

ATTEMPT_LOCK_SQL = (
    "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) "
    "WHERE l.locktype = 'advisory' AND l.classid = %s"
)
ATTEMPT_LOCK_NS = 30301  # grants.ATTEMPT_LOCK_NS
KEEPALIVE_DROP_MAX_S = 180.0
DEADMAN_S = 300
NFT_TABLE = "u13drop"
SPILL_TOOL = "collections_search"
SPILL_TEXT = PROBES / "u13-spill.txt"
SPILL_READ_SQL = ("SELECT count(*) FROM tool_calls WHERE turn_id = %s AND id > %s AND tool_name IN ('Read', 'Grep') "
                  "AND input_path LIKE '%%/tool-results/%%'")
SPILL_CALL_SQL = ("SELECT id, duration_ms FROM tool_calls WHERE turn_id = %s AND tool_name LIKE %s "
                  "AND duration_ms IS NOT NULL ORDER BY id LIMIT 1")
RERUN_SQL = "SELECT count(*) FROM tool_calls WHERE turn_id = %s AND id > %s AND tool_name LIKE %s"


NFT_INSTALL = "command -v nft >/dev/null || dnf -y -q install nftables"


def nft_drop_commands(port: int = 5432) -> list[str]:
    """The worker's Postgres traffic dropped both ways, behind a dead-man that removes the
    table after DEADMAN_S even if this driver never comes back. The dead-man first, after
    nftables itself: the AL2023 Beanstalk worker ships neither nft nor iptables (U13, 2026-10-07)."""
    return [
        NFT_INSTALL,
        f"systemd-run --unit {NFT_TABLE}-deadman --on-active={DEADMAN_S} /usr/sbin/nft delete table inet {NFT_TABLE}",
        f"nft add table inet {NFT_TABLE}",
        f"nft add chain inet {NFT_TABLE} out '{{ type filter hook output priority 0 ; }}'",
        f"nft add chain inet {NFT_TABLE} in '{{ type filter hook input priority 0 ; }}'",
        f"nft add rule inet {NFT_TABLE} out tcp dport {port} drop",
        f"nft add rule inet {NFT_TABLE} in tcp sport {port} drop",
    ]


NFT_UNDROP = [f"nft delete table inet {NFT_TABLE} || true", f"systemctl stop {NFT_TABLE}-deadman.timer || true"]


def wait_lock_gone(ctx: Ctx, deadline_s: float = KEEPALIVE_DROP_MAX_S, every_s: float = 5.0) -> float | None:
    """Seconds until the patron's attempt lock backend is gone (polled through the driver's
    own connection, which the drop does not touch), or None at the deadline."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        if int(turn.one(ctx.dsn, ATTEMPT_LOCK_SQL, (ATTEMPT_LOCK_NS,)) or 0) == 0:
            return round(time.monotonic() - t0, 1)
        time.sleep(every_s)
    return None


HANDOVER_WAIT_S = 30.0
COMPLETED_SQL = "SELECT completed_at FROM turns WHERE turn_id = %s AND completed_at IS NOT NULL"


def shutdown_named(events: list[dict], turn_id: str) -> bool:
    return any(e.get("ev") == "shutdown" and turn_id in json.dumps(e) for e in events)


def case_sigterm_real(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M42 (U5 b): SIGTERM mid-turn on Beanstalk (systemctl restart). The worker answers 500
    and exits; sqsd redelivers after ErrorVisibilityTimeout; the redelivery resumes. A
    held message rides along to attempt ev=deferred_release_skipped (M75)."""
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    held = post(ctx, client, rep, FOLLOW_UP_TEXT)
    # The held message hands over at the turn's next tool call (handover_clause): if that
    # closes it inside HANDOVER_WAIT_S, the released held turn is the live one to signal.
    target = tid
    t0 = time.monotonic()
    while time.monotonic() - t0 < HANDOVER_WAIT_S:
        if turn.one(ctx.dsn, COMPLETED_SQL, (tid,)) is not None:
            target = held["turn_id"]
            break
        time.sleep(1.0)
    rep.figures["kill_target"] = "held" if target != tid else "original"
    if target != tid and reach(ctx, rep, target, subagent=False) is None:
        return
    sdk_before = sdk_of(ctx, rep.session_id)
    at_kill = max_entry(ctx, sdk_before)
    TARGET.signal("worker", "term")
    if not done(ctx, client, rep, target, label="resumed"):
        return
    snap, events = snapshot(ctx, rep.session_id, target), worker_events()
    rep.checks.append(("sigterm_real: ev=shutdown names the turn", shutdown_named(events, target), ""))
    rep.checks += resume_checks("sigterm_real", snap, sdk_before=sdk_before, sdk_after=sdk_of(ctx, rep.session_id),
                                entries_at_kill=at_kill, entries_after=max_entry(ctx, sdk_before))
    skipped = [e for e in events if e.get("ev") == "deferred_release_skipped"]
    rep.findings.append(f"held reply {held}; ev=deferred_release_skipped lines: {skipped[:3]}")
    if target == tid:
        done(ctx, client, rep, held["turn_id"], label="held")


def case_dead_letter_real(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M43 (U5 c): with MaxRetries 1 (probe maxretries_1), a 500 on the only receive closes
    the turn retries_exhausted and releases its held message. The 500 comes from the
    attempt's own Postgres connection terminated mid-turn (turn:<id>)."""
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    held = post(ctx, client, rep, FOLLOW_UP_TEXT)
    terminated = sum(1 for (ok,) in turn.db(ctx.dsn, TERMINATE_SQL, (f"turn:{tid}",)) if ok)
    rep.figures["terminated_backends"] = terminated
    if not done(ctx, client, rep, tid, label="closed"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks += [closed_check("dead_letter_real", snap, "retries_exhausted"),
                   ("dead_letter_real: one receive", (snap.row or (0,))[0] == 1, f"row={snap.row}"),
                   ("dead_letter_real: its close released a message", bool(released_by(events, tid)),
                    f"released={released_by(events, tid)}")]
    done(ctx, client, rep, held["turn_id"], label="held")


def case_keepalive_drop(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M52: the worker's Postgres traffic dropped both ways mid-turn, as a vanished host.
    Client side: the attempt errors within ~30 s and the redelivery resumes. Server side:
    seconds until RDS drops the patron's attempt lock backend (TCP keepalives, grants.py)."""
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    rep.figures["attempt_locks_before"] = int(turn.one(ctx.dsn, ATTEMPT_LOCK_SQL, (ATTEMPT_LOCK_NS,)) or 0)
    try:
        TARGET.run("worker", *nft_drop_commands(), comment="U13 keepalive_drop: drop worker<->RDS")
        rep.figures["lock_gone_after_s"] = wait_lock_gone(ctx)
    finally:
        TARGET.run("worker", *NFT_UNDROP, comment="U13 keepalive_drop: undrop")
    rep.checks.append(("keepalive_drop: the attempt lock backend disappeared within "
                       f"{KEEPALIVE_DROP_MAX_S:g} s", rep.figures["lock_gone_after_s"] is not None,
                       f"figures={rep.figures}"))
    if not done(ctx, client, rep, tid, label="resumed"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), worker_events()
    rep.checks.append(redelivered_check("keepalive_drop", snap))
    rep.findings.append(f"store errors on the turn: {[e.get('ev') for e in events_for(events, tid) if is_store_error(str(e.get('error') or ''))][:5]}")


def case_spill_kill(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M51: SIGKILL between a tool result spilling to the CLI's tool-results file and the
    agent reading it back; the redelivery must complete, not end no_progress.

    The prompt asks for Italy's last collection title: Italy is measured past the CLI's
    50,000-character spill and the title is only in the tail, past the 2 KB preview. The
    kill fires on ``duration_ms``, which a failed call stamps too, so the run is void
    unless the turn read a tool-results file somewhere: a failing upstream call reads as
    void, not as M51 met. ``rerun_calls`` and ``reads_after_kill`` record re-ran vs stranded."""
    fresh_session(ctx, client, rep)
    tid = post(ctx, client, rep, SPILL_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    t0, row = time.monotonic(), None
    while time.monotonic() - t0 < ctx.deadline_s and row is None:
        got = turn.db(ctx.dsn, SPILL_CALL_SQL, (tid, f"%{SPILL_TOOL}"))
        row = got[0] if got else None
        if row is None:
            time.sleep(0.2)
    rep.checks.append(("spill_kill: the spilling call finished", row is not None, "none within --deadline-s"))
    if row is None:
        return
    read_first = int(turn.one(ctx.dsn, SPILL_READ_SQL, (tid, row[0])) or 0)
    TARGET.signal("worker", "kill")
    rep.figures.update({"spill_call_id": row[0], "spill_call_ms": row[1], "read_before_kill": read_first})
    rep.checks.append(("spill_kill: killed before the spill file was read (else void)", read_first == 0,
                       f"{read_first} Read/Grep rows on tool-results came first"))
    if not done(ctx, client, rep, tid, label="resumed"):
        return
    snap = snapshot(ctx, rep.session_id, tid)
    reads = int(turn.one(ctx.dsn, SPILL_READ_SQL, (tid, 0)) or 0)
    after = int(turn.one(ctx.dsn, SPILL_READ_SQL, (tid, row[0])) or 0)
    rerun = int(turn.one(ctx.dsn, RERUN_SQL, (tid, row[0], f"%{SPILL_TOOL}")) or 0)
    rep.figures.update({"tool_results_reads": reads, "reads_after_kill": after, "rerun_calls": rerun})
    rep.checks += [("spill_kill: the result spilled (a tool-results Read/Grep in the turn, else void)", reads > 0,
                    "no Read/Grep of a tool-results path: the call failed or never spilled"),
                   redelivered_check("spill_kill", snap),
                   ("spill_kill: not closed no_progress", snap.row is not None and snap.row[2] != TERMINAL_NO_PROGRESS,
                    f"row={snap.row}")]
    rep.findings.append("after the kill the agent " + (f"re-ran {SPILL_TOOL}" if rerun else
                                                        "read a tool-results path without re-running (stranded spill)"
                                                        if after else "neither re-ran nor read a tool-results path"))


# -- U13 PR8: measurements under a probe case the operator set (rehearse.py probe --case) ----

# What each probe case leaves on its tier, as TARGET.settings reads it back; a case checks
# its probes before it posts, so a forgotten probe costs no turn. Pinned to rehearse.py's
# CASES (test_proto_target.py). idle_session_60s is an RDS parameter, read from pg_settings.
PROBE_SETTINGS = {
    "kill_window": ("worker", "SQSD_VISIBILITY_TIMEOUT_S", "1500"),
    "debug_hold": ("tools", "GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS", "20000"),
    "refresh_age_0": ("web", "FS_GRANT_REFRESH_AGE_S", "0"),
}
IDLE_PROBE = ("idle_session_timeout", "60000")
IDLE_SETTING_SQL = "SELECT setting FROM pg_settings WHERE name = %s"
ERROR_VISIBILITY_S = 300.0  # step 11's interim ErrorVisibilityTimeout, which has no environment mirror
RECLAIM_BUDGET_S = 1800.0   # past kill_window's VisibilityTimeout (1500 s)
EVENT_LAG_S = DEPLOYED_DELIVERY_S[0]
PG_NOW_SQL = "SELECT now()"
PROJECT_SQL = "SELECT project_id FROM sessions WHERE session_id = %s"
USER_SEQ_SQL = ("SELECT max(seq) FROM session_events WHERE session_id = %s AND kind = 'user_msg' "
                "AND payload->>'turn_id' = %s")
RECLAIM_SQL = "SELECT receive_count, claimed_at, completed_at FROM turns WHERE turn_id = %s"
# kill_hold: the delegated extraction_append inside the hold -- allowed, no duration_ms yet.
HOLD_ROW_SQL = ("SELECT id, ts FROM tool_calls WHERE turn_id = %s AND agent_type = 'record-extractor' "
                "AND tool_name LIKE '%%extraction_append' AND decision = 'allow' AND duration_ms IS NULL "
                "ORDER BY id LIMIT 1")
DURATION_SQL = "SELECT duration_ms FROM tool_calls WHERE id = %s"
# The main-thread delegation the held call runs under: the last Agent/Task row before it.
AGENT_ROW_SQL = ("SELECT id, duration_ms FROM tool_calls WHERE turn_id = %s AND agent_id IS NULL "
                 "AND tool_name IN ('Agent', 'Task') AND id < %s ORDER BY id DESC LIMIT 1")
# research.json's sources sharing one url (or, lacking one, citation): a write that both
# committed and re-ran shows here.
DUP_SOURCES_SQL = (
    "SELECT COALESCE(s->>'url', s->>'citation'), count(*) FROM documents d, jsonb_array_elements("
    "CASE WHEN jsonb_typeof(d.doc->'sources') = 'array' THEN d.doc->'sources' ELSE '[]'::jsonb END) s "
    "WHERE d.project_id = %s AND d.name = 'research.json' GROUP BY 1 HAVING count(*) > 1 ORDER BY 1"
)
SOURCES_SQL = ("SELECT CASE WHEN jsonb_typeof(doc->'sources') = 'array' THEN jsonb_array_length(doc->'sources') "
               "ELSE 0 END FROM documents WHERE project_id = %s AND name = 'research.json'")
IDLE_TEXT = PROBES / "u13-idle-watch.txt"
IDLE_LIMIT_S = 60.0
IDLE_WATCH_S = 900.0
IDLE_POLL_S = 5.0
IDLE_CUT = "idle-session timeout"  # Postgres's FATAL text for a backend idle_session_timeout ended
# idle_watch: the patron's attempt-lock backend (grants.ATTEMPT_LOCK_SQL's two-int4 key, so
# objsubid 2; objid is hashtext(owner) as an unsigned oid), its age and its idle time.
LOCK_BACKEND_SQL = (
    "SELECT a.pid, EXTRACT(EPOCH FROM now() - a.backend_start), a.state, EXTRACT(EPOCH FROM now() - a.state_change) "
    "FROM pg_locks l JOIN pg_stat_activity a USING (pid) "
    "JOIN projects p ON p.project_id = (SELECT project_id FROM sessions WHERE session_id = %s) "
    "WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 2 AND l.classid = %s::int4::oid "
    "AND l.objid::bigint = (hashtext(p.owner_id)::bigint & 4294967295)"
)
TURN_BACKEND_SQL = ("SELECT pid, EXTRACT(EPOCH FROM now() - backend_start), state, "
                    "EXTRACT(EPOCH FROM now() - state_change) FROM pg_stat_activity WHERE application_name = %s")
RSS_EVERY_S = 10.0
# One SSM call per sample: web.service's cgroup (the worker and every CLI it spawned), the
# instance's MemAvailable, the /tmp tmpfs, then every process's RSS.
RSS_COMMANDS = (
    "echo cgroup_bytes=$(systemctl show -p MemoryCurrent --value web.service)",
    "awk '/^MemAvailable:/ {print \"avail_kb=\" $2}' /proc/meminfo",
    "echo tmp_used_mb=$(df -m --output=used /tmp | tail -1)",
    "ps -eo rss,comm --no-headers",
)


def probes_in_effect(ctx: Ctx, rep: Report, *probes: str) -> bool:
    """A check per probe the measurement needs; False when one is not in effect (post nothing)."""
    ok_all, read = True, {}
    for probe in probes:
        if probe == "idle_session_60s":
            name, want = IDLE_PROBE
            got = turn.one(ctx.dsn, IDLE_SETTING_SQL, (name,))
        else:
            tier, name, want = PROBE_SETTINGS[probe]
            if tier not in read:
                read[tier] = TARGET.settings(tier)
            got = read[tier].get(name)
        ok = got is not None and str(got) == want
        rep.checks.append((f"{rep.case}: probe {probe} in effect (else void)", ok, f"{name}={got!r}, wanted {want!r}"))
        ok_all = ok_all and ok
    return ok_all


def redelivery_timer(gap_s: float, *, visibility_s: float, error_s: float = ERROR_VISIBILITY_S) -> str:
    """Which sqsd timer brought a killed attempt's message back: the nearer of the two."""
    return "ErrorVisibilityTimeout" if abs(gap_s - error_s) <= abs(gap_s - visibility_s) else "VisibilityTimeout"


def wait_row(ctx: Ctx, turn_id: str, sql: str, params: tuple, every_s: float = 0.3) -> tuple | None:
    """``sql``'s first row once it has one; None if the turn closes first or at --deadline-s."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < ctx.deadline_s:
        got = turn.db(ctx.dsn, sql, params)
        if got:
            return got[0]
        if turn.one(ctx.dsn, "SELECT completed_at FROM turns WHERE turn_id = %s", (turn_id,)) is not None:
            return None
        time.sleep(every_s)
    return None


def wait_reclaim(ctx: Ctx, turn_id: str, receive_count: int, budget_s: float = RECLAIM_BUDGET_S,
                 every_s: float = 5.0) -> tuple | None:
    """``(receive_count, claimed_at)`` once a later receive claims the turn; None if it
    closed first or at the budget, which outlasts kill_window's VisibilityTimeout."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < budget_s:
        got = turn.db(ctx.dsn, RECLAIM_SQL, (turn_id,))
        if got and got[0][0] > receive_count:
            return got[0][0], got[0][1]
        if got and got[0][2] is not None:
            return None
        time.sleep(every_s)
    return None


def resumed_lines(events: list[dict], turn_id: str) -> list[dict]:
    """The redelivery's ev=turn lines (receive_count >= 2) that answered 200."""
    return [e for e in events_for(events, turn_id) if e.get("ev") == "turn" and e.get("status") == 200
            and isinstance(e.get("receive_count"), int) and e["receive_count"] >= 2]


def turn_lines(events: list[dict], turn_id: str) -> list[dict]:
    return [e for e in events_for(events, turn_id) if e.get("ev") == "turn"]


def events_until(turn_id: str, lines: Callable[[list[dict], str], list[dict]] = turn_lines) -> list[dict]:
    """The worker's lines once ``lines`` finds the turn's among them, polled for CloudWatch's
    lag; whatever is there at EVENT_LAG_S."""
    def got() -> list[dict] | None:
        evs = worker_events()
        return evs if lines(evs, turn_id) else None

    return smoke.wait_for(got, EVENT_LAG_S, 5.0) or worker_events()


def resumed_line_check(label: str, events: list[dict], turn_id: str) -> Check:
    lines = resumed_lines(events, turn_id)
    return (f"{label}: the redelivery's ev=turn has resumed true and list_subkeys >= 1",
            any(e.get("resumed") is True and (e.get("list_subkeys") or 0) >= 1 for e in lines),
            f"lines={[{k: e.get(k) for k in ('receive_count', 'resumed', 'list_subkeys')} for e in lines]}")


def reauth(ctx: Ctx, session_id: str, turn_id: str, sdk: str | None) -> tuple[list[str], list[str]]:
    """``(summary hits since the turn's user_msg, full-result hits)``: demo's and turn's scans."""
    since = turn.one(ctx.dsn, USER_SEQ_SQL, (session_id, turn_id)) or 0
    return turn.reauth_hits(ctx.dsn, session_id, since), turn.reauth_entry_hits(ctx.dsn, sdk, turn_id)


def _secs(a: Any, b: Any) -> float | None:
    """``b - a`` in seconds, both Postgres timestamps; None when either is missing."""
    ta, tb = _ts(a), _ts(b)
    return round((tb - ta).total_seconds(), 1) if ta and tb else None


def case_kill_hold(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M65 (acceptance 4): SIGKILL the worker while a delegated extraction_append sits in the
    tools tier's 20 s hold (debug_hold), under kill_window. The redelivery must resume and
    close not no_progress with research.json holding the source once. Void (H:360) unless
    the kill landed inside the hold with the delegation's Agent row still open, or if any
    FamilySearch call got the reconnect instruction; one kill by construction. Records
    which sqsd timer brought the message back: seconds from the kill to the second claim."""
    if not probes_in_effect(ctx, rep, "kill_window", "debug_hold"):
        return
    seeded_session(ctx, rep)
    project_id = turn.one(ctx.dsn, PROJECT_SQL, (rep.session_id,))
    tid = post(ctx, client, rep, EXTRACTIONS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    hold = wait_row(ctx, tid, HOLD_ROW_SQL, (tid,))
    rep.checks.append(("kill_hold: a delegated extraction_append entered the hold", hold is not None,
                       "the turn closed without one, or none within --deadline-s"))
    if hold is None:
        return
    # Nothing between the hold and the kill but the kill: everything below is read after it,
    # when the dead worker can write no entry, stamp no duration_ms and add no source.
    kill_at = turn.one(ctx.dsn, PG_NOW_SQL, ())
    try:
        TARGET.signal("worker", "kill")
        killed_by = turn.one(ctx.dsn, PG_NOW_SQL, ())
        held_ms = turn.one(ctx.dsn, DURATION_SQL, (hold[0],))
        agent = turn.db(ctx.dsn, AGENT_ROW_SQL, (tid, hold[0]))
    finally:
        TARGET.signal("worker", "start")
    sdk_before = sdk_of(ctx, rep.session_id)
    at_kill = max_entry(ctx, sdk_before)
    # The held write commits ~20 s on whatever happens here, so this may or may not hold its
    # source; either way only the redelivery can make a second copy.
    dups_before = turn.db(ctx.dsn, DUP_SOURCES_SQL, (project_id,))
    rep.figures["sources_at_kill"] = turn.one(ctx.dsn, SOURCES_SQL, (project_id,))
    hold_s = int(PROBE_SETTINGS["debug_hold"][2]) / 1000
    sent_s, landed_s = _secs(hold[1], kill_at), _secs(hold[1], killed_by)
    rep.figures.update({"hold_call_id": hold[0], "kill_sent_s_into_hold": sent_s,
                        "kill_landed_by_s_into_hold": landed_s, "kill_signal_s": _secs(kill_at, killed_by)})
    # killed_by is only an upper bound (SSM's poll); a worker alive past the hold would
    # have stamped duration_ms, so no stamp plus a send inside the hold places the kill.
    rep.checks += [
        ("kill_hold: the kill landed inside the hold (else void)",
         held_ms is None and sent_s is not None and sent_s < hold_s,
         f"duration_ms={held_ms} sent {sent_s}s (landed by {landed_s}s) into {hold_s:g}s"),
        ("kill_hold: the delegation's Agent row had no duration_ms at the kill (else void)",
         bool(agent) and agent[0][1] is None, f"agent row={agent}"),
    ]
    reclaim = wait_reclaim(ctx, tid, 1)
    gap = _secs(killed_by, reclaim[1]) if reclaim else None
    if gap is not None:
        rep.figures.update({"reclaimed_after_kill_s": gap, "redelivered_by": redelivery_timer(
            gap, visibility_s=float(PROBE_SETTINGS["kill_window"][2]))})
    else:
        rep.findings.append(f"no second claim within {RECLAIM_BUDGET_S:g} s of the kill (closed first, or never redelivered)")
    if not done(ctx, client, rep, tid, label="resumed"):
        return
    snap, events = snapshot(ctx, rep.session_id, tid), events_until(tid, resumed_lines)
    hits, entry_hits = reauth(ctx, rep.session_id, tid, sdk_before)
    grown = [d for d in turn.db(ctx.dsn, DUP_SOURCES_SQL, (project_id,)) if d not in dups_before]
    rep.figures.update({"sources_after": turn.one(ctx.dsn, SOURCES_SQL, (project_id,)),
                        "reauth_hits": len(hits), "reauth_entry_hits": len(entry_hits)})
    rep.checks += [
        *resume_checks("kill_hold", snap, sdk_before=sdk_before, sdk_after=sdk_of(ctx, rep.session_id),
                       entries_at_kill=at_kill, entries_after=max_entry(ctx, sdk_before)),
        resumed_line_check("kill_hold", events, tid),
        ("kill_hold: research.json holds each source once (no duplicate the kill added)", not grown,
         f"duplicated (key, count)={grown}"),
        ("kill_hold: no FamilySearch call got the reconnect instruction (else void)", not hits and not entry_hits,
         f"hits={(hits + entry_hits)[:2]}"),
    ]
    rep.findings.extend(f"kill_hold: {line}" for line in result_findings(events, tid))


def case_kill_refresh(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M55: SIGKILL mid-turn under kill_window and refresh_age_0, so the web tier refreshes
    the grant -- revoking the killed attempt's token -- before the redelivery; the resumed
    attempt must bear the new one (no reconnect instruction anywhere) and resume."""
    if not probes_in_effect(ctx, rep, "kill_window", "refresh_age_0"):
        return
    fresh_session(ctx, client, rep)
    project_id = turn.one(ctx.dsn, PROJECT_SQL, (rep.session_id,))
    tid = post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    if reach(ctx, rep, tid, subagent=False) is None:
        return
    sdk_before = sdk_of(ctx, rep.session_id)
    at_kill = max_entry(ctx, sdk_before)
    grant_before = turn.one(ctx.dsn, turn.GRANT_START_SQL, (project_id,))
    refreshed = False
    try:
        TARGET.signal("worker", "kill")
        # No attempt is live now, so the web tier's loop may refresh the grant.
        refreshed = turn.wait_grant_refresh(ctx.dsn, project_id, grant_before)
    finally:
        TARGET.signal("worker", "start")
    rep.figures["grant_refreshed"] = refreshed
    if not done(ctx, client, rep, tid, label="resumed"):
        return
    snap = snapshot(ctx, rep.session_id, tid)
    hits, entry_hits = reauth(ctx, rep.session_id, tid, sdk_before)
    rep.figures.update({"receive_count": snap.row[0] if snap.row else None, "reauth_hits": len(hits),
                        "reauth_entry_hits": len(entry_hits)})
    rep.checks += [
        ("kill_refresh: grant refreshed between attempts", bool(refreshed),
         "session_started_at did not move while no attempt was live"),
        ("kill_refresh: reauth_hits=0 since the user_msg", not hits, f"hits={hits[:2]}"),
        ("kill_refresh: reauth_entry_hits=0 (full tool results)", not entry_hits, f"hits={entry_hits[:2]}"),
        *resume_checks("kill_refresh", snap, sdk_before=sdk_before, sdk_after=sdk_of(ctx, rep.session_id),
                       entries_at_kill=at_kill, entries_after=max_entry(ctx, sdk_before)),
    ]


@dataclass
class IdleSample:
    """One idle_watch poll: the lock and turn backends as ``(pid, age_s, state, idle_s)``."""

    at_s: float
    receive_count: int
    completed: bool
    lock: list[tuple] = field(default_factory=list)
    turn: list[tuple] = field(default_factory=list)


def idle_figures(samples: list[IdleSample]) -> dict[str, Any]:
    """Over attempt 1's samples (the first receive_count seen): the lock backends, their
    oldest age and longest idle; the turn:<id> backends, and when one vanished with the turn
    still open."""
    first = [s for s in samples if s.receive_count == samples[0].receive_count] if samples else []
    seen, cut_at = False, None
    for i, s in enumerate(first):
        if s.turn:
            seen = True
        # A backend gone in a sample read just before the turn closed is the close, not a
        # cut: count it only when the next sample still shows the turn open.
        elif seen and not s.completed and cut_at is None and i + 1 < len(samples) and not samples[i + 1].completed:
            cut_at = s.at_s
    # pg_stat_activity hides another role's backend_start/state_change (None) from a role
    # without pg_read_all_stats: those read as missing, not as a crash.
    return {
        "lock_pids": list(dict.fromkeys(r[0] for s in first for r in s.lock)),
        "lock_max_age_s": max((float(r[1]) for s in first for r in s.lock if r[1] is not None), default=None),
        "lock_max_idle_s": max((float(r[3]) for s in first for r in s.lock if r[2] == "idle" and r[3] is not None),
                               default=None),
        "turn_pids": list(dict.fromkeys(r[0] for s in first for r in s.turn)),
        "turn_max_idle_s": max((float(r[3]) for s in first for r in s.turn if r[2] == "idle" and r[3] is not None),
                               default=None),
        "turn_backend_gone_at_s": cut_at,
        "final_receive_count": samples[-1].receive_count if samples else None,
        "samples": len(samples),
    }


def case_idle_watch(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M22: under idle_session_60s (a 60 s parameter-group idle_session_timeout), the attempt's
    lock connection, which sets idle_session_timeout=0, must outlive 60 s idle with no
    ev=grant_lock_lost. Polls both backends every 5 s through the driver's own connections
    until the first redelivery or IDLE_WATCH_S, then Stops a turn still running. Records
    whether the turn:<id> connection, which TURN_CONN_KWARGS does not shield, was cut."""
    if not probes_in_effect(ctx, rep, "idle_session_60s"):
        return
    fresh_session(ctx, client, rep)
    since_ms = epoch_ms(utc_now())
    tid = post(ctx, client, rep, IDLE_TEXT.read_text(encoding="utf-8").strip())["turn_id"]
    samples: list[IdleSample] = []
    t0 = time.monotonic()
    while time.monotonic() - t0 < IDLE_WATCH_S:
        row = turn.db(ctx.dsn, RECLAIM_SQL, (tid,))
        rc, completed = (row[0][0], row[0][2] is not None) if row else (0, False)
        if rc >= 1:
            samples.append(IdleSample(at_s=round(time.monotonic() - t0, 1), receive_count=rc, completed=completed,
                                      lock=turn.db(ctx.dsn, LOCK_BACKEND_SQL, (rep.session_id, ATTEMPT_LOCK_NS)),
                                      turn=turn.db(ctx.dsn, TURN_BACKEND_SQL, (f"turn:{tid}",))))
        if completed or rc >= 2:
            break
        time.sleep(IDLE_POLL_S)
    figures = idle_figures(samples)
    rep.figures.update(figures)
    if samples and samples[-1].completed:
        done(ctx, client, rep, tid, label="done")
    else:
        t = press(ctx, client, rep)
        done(ctx, client, rep, tid, since=t, label="stopped")
    events = events_until(tid)  # ev=grant_lock_lost precedes the attempt's ev=turn
    lost = [e for e in events_for(events, tid) if e.get("ev") == "grant_lock_lost"]
    five = [e.get("error") for e in events_for(events, tid) if e.get("ev") == "turn" and e.get("status") == 500]
    age, idle = figures["lock_max_age_s"], figures["lock_max_idle_s"]
    rep.checks += [
        (f"idle_watch: attempt 1's lock backend lived past {IDLE_LIMIT_S:g} s (else void)",
         age is not None and age > IDLE_LIMIT_S, f"lock_max_age_s={age}"),
        (f"idle_watch: the lock backend outlived {IDLE_LIMIT_S:g} s idle, one pid throughout attempt 1",
         idle is not None and idle > IDLE_LIMIT_S and len(figures["lock_pids"]) == 1,
         f"lock_max_idle_s={idle} lock_pids={figures['lock_pids']}"),
        ("idle_watch: no ev=grant_lock_lost", not lost, f"lost={lost[:2]}"),
    ]
    cut = figures["turn_backend_gone_at_s"]
    rep.findings.append(
        f"turn:{tid} backend " + (f"vanished at ~{cut:g} s with the turn open (a cut: a finding against H:327)"
                                  if cut is not None else "never vanished while the turn was open")
        + f"; longest idle {figures['turn_max_idle_s']} s; receive_count {figures['final_receive_count']}; "
          f"500s {five}")
    for tier in ("web", "tools"):
        cut_lines = [ln for ln in TARGET.logs(tier, since_ms).splitlines() if IDLE_CUT in ln]
        rep.findings.append(f"{tier} tier: {len(cut_lines)} log line(s) naming the idle-session timeout"
                            + (f", first {cut_lines[0][:200]!r}" if cut_lines else ""))


def parse_rss(text: str) -> dict[str, Any]:
    """One RSS_COMMANDS sample, in MB: the ``key=value`` lines, then ``<rss kB> <comm>`` per
    process. A figure the instance could not give is None."""
    keys: dict[str, int | None] = {}
    procs: list[tuple[int, str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        key, sep, value = line.partition("=")
        if sep and key in ("cgroup_bytes", "avail_kb", "tmp_used_mb"):
            keys[key] = int(value) if value.strip().isdigit() else None
            continue
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            procs.append((int(parts[0]), parts[1]))
    top = max(procs, default=None)
    cgroup, avail = keys.get("cgroup_bytes"), keys.get("avail_kb")
    return {"total_rss_mb": round(sum(p[0] for p in procs) / 1024, 1),
            "top_mb": round(top[0] / 1024, 1) if top else None, "top_comm": top[1] if top else None,
            "cgroup_mb": round(cgroup / 1048576, 1) if cgroup is not None else None,
            "avail_mb": round(avail / 1024, 1) if avail is not None else None, "tmp_used_mb": keys.get("tmp_used_mb")}


def rss_figures(samples: list[dict]) -> dict[str, Any]:
    """The peaks over every sample (MemAvailable's floor)."""
    def over(key: str, pick: Callable = max) -> Any:
        return pick((s[key] for s in samples if s.get(key) is not None), default=None)

    top = max((s for s in samples if s.get("top_mb") is not None), key=lambda s: s["top_mb"], default=None)
    return {"rss_samples": len(samples), "peak_total_rss_mb": over("total_rss_mb"), "peak_cgroup_mb": over("cgroup_mb"),
            "peak_process_mb": top["top_mb"] if top else None, "peak_process": top["top_comm"] if top else None,
            "min_avail_mb": over("avail_mb", min), "peak_tmp_used_mb": over("tmp_used_mb")}


def case_concurrent_rss(ctx: Ctx, client: httpx.Client, rep: Report) -> None:
    """M49: two turns at once on two fresh sessions (HttpConnections 2), the worker's memory
    sampled over SSM every RSS_EVERY_S until both close: peak total RSS, the peak process,
    web.service's cgroup, MemAvailable's floor and /tmp, for U18. Void unless both ran at
    once. run_case settles the second session; this settles the first."""
    sessions: list[str] = []
    try:
        for _ in range(2):
            sessions.append(fresh_session(ctx, client, rep))
            post(ctx, client, rep, LOOKUPS_TEXT.read_text(encoding="utf-8").strip())
        tids = list(rep.turn_ids)
        samples: list[dict] = []
        overlapped = False
        t0 = time.monotonic()
        while time.monotonic() - t0 < ctx.deadline_s:
            t = time.monotonic()
            samples.append(parse_rss(TARGET.run("worker", *RSS_COMMANDS, comment="U13 concurrent_rss: sample memory")))
            rows = [turn.db(ctx.dsn, RECLAIM_SQL, (tid,)) for tid in tids]
            overlapped = overlapped or sum(1 for r in rows if r and r[0][1] is not None and r[0][2] is None) == 2
            if all(r and r[0][2] is not None for r in rows):
                break
            time.sleep(max(0.0, RSS_EVERY_S - (time.monotonic() - t)))
        rep.figures.update(rss_figures(samples))
        rep.checks += [("concurrent_rss: both turns ran at once (else void)", overlapped,
                        "never both claimed and open in one sample"),
                       ("concurrent_rss: memory sampled", bool(samples), "no sample")]
        for sid, tid, label in zip(sessions, tids, ("first", "second")):
            rep.session_id = sid
            done(ctx, client, rep, tid, label=label)
    finally:
        for sid in sessions[:-1]:
            running, _held = settle(ctx, client, sid)
            rep.checks.append((f"concurrent_rss: no turn left running on {sid}", not running, f"running={running}"))


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
    "outage_hook": case_outage_hook,
    "outage_pause": case_outage_pause,
    "probe_resume": case_probe_resume,
    "sigterm_real": case_sigterm_real,
    "dead_letter_real": case_dead_letter_real,
    "keepalive_drop": case_keepalive_drop,
    "spill_kill": case_spill_kill,
    "kill_hold": case_kill_hold,
    "kill_refresh": case_kill_refresh,
    "idle_watch": case_idle_watch,
    "concurrent_rss": case_concurrent_rss,
}
SEEDED = frozenset({"stop_delegation", "cap_delegation", "cap_main_real", "probe_resume", "kill_hold"})
# Cases a deployed target cannot run yet, and why.
COMPOSE_ONLY = {
    "outage_pause": "RDS has no freeze (U19 calls a pause no RDS failure shape)",
}
# Cases only a deployed target runs (U13): they signal or firewall the Beanstalk worker.
DEPLOYED_ONLY = frozenset({"sigterm_real", "dead_letter_real", "keepalive_drop", "spill_kill",
                           "kill_hold", "kill_refresh", "idle_watch", "concurrent_rss"})


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
    p.add_argument("--target", choices=("compose", "deployed"), default="compose",
                   help="compose's containers, or U13's rehearsal tiers on Beanstalk")
    p.add_argument("--profile", default=None, help="deployed: the aws CLI profile")
    return p


def make_target(args: argparse.Namespace) -> target.ComposeTarget | target.DeployedTarget:
    if args.target == "compose":
        return compose_target(args.worker_container, args.postgres_container, args.tools_container)
    return target.DeployedTarget(profile=args.profile)


def make_ctx(args: argparse.Namespace, start: dict | None) -> Ctx:
    """The parsed arguments plus the worker's spend figures; ValueError on a combination
    that would spend money for nothing (or too much)."""
    if getattr(args, "target", "compose") == "deployed" and args.case in COMPOSE_ONLY:
        raise ValueError(f"{args.case} is compose-only: {COMPOSE_ONLY[args.case]}")
    if getattr(args, "target", "compose") == "compose" and args.case in DEPLOYED_ONLY:
        raise ValueError(f"{args.case} runs only with --target deployed (make proto-bounds-aws)")
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
               tools=args.tools_container, target=getattr(args, "target", "compose"))


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    global TARGET
    TARGET = make_target(args)
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
