"""Offline tests for proto/bounds.py (U23): every check function over canned row tuples,
each with a passing and a failing fixture; the argument refusals that keep a billed case
from spending for nothing; the cases' selectors and their Stop-on-every-exit with the stack
faked; the make target. No Postgres, no stack, no model."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.agent.spend import price_usd
from proto import bounds
from proto.worker import options
from tests.test_proto_config import MAKEFILE, _recipe
from tests.test_proto_demo import _recipe_commands

SERVER = Path(__file__).resolve().parents[1]
T0 = datetime(2026, 10, 5, 12, 0, 0, tzinfo=timezone.utc)
CAP = 2.5
CAP_REASON = options.SPEND_CAP_REASON.format(cap=CAP)


def call(i: int, decision: str = "allow", agent: str | None = None, tool: str = "mcp__genealogy__place_search",
         s: float = 0.0) -> tuple:
    return (i, tool, agent, decision, T0 + timedelta(seconds=s))


def snap(outcome: str | None = "stopped", *, tid: str = "t1", cost=None, rc: int = 1, calls=(), payload=None,
         completed: bool = True) -> bounds.TurnSnap:
    row = (rc, T0 if completed else None, outcome, cost)
    return bounds.TurnSnap(turn_id=tid, row=row, calls=list(calls),
                           payload=payload if payload is not None else {"turn_id": tid, "outcome": outcome})


def ev(name: str, tid: str = "t1", **fields) -> dict:
    return {"ev": name, "turn_id": tid, **fields}


def oks(checks) -> list[bool]:
    return [ok for _, ok, _ in checks]


def entry(kind: str, *blocks, ts: str | None = None) -> dict:
    e = {"type": kind, "message": {"content": list(blocks)}}
    if ts:
        e["timestamp"] = ts
    return e


def use(uid: str, name: str = "mcp__genealogy__place_search", **inp) -> dict:
    return {"type": "tool_use", "id": uid, "name": name, "input": inp}


def result(uid: str, text: str) -> dict:
    return {"type": "tool_result", "tool_use_id": uid, "content": [{"type": "text", "text": text}]}


# ── selecting rows ──────────────────────────────────────────────────────────────────────


def test_first_call_splits_the_threads_on_agent_id_and_skips_other_decisions():
    calls = [call(1, "deny"), call(2, agent="a1"), call(3), call(4, "halt", agent="a1")]
    assert bounds.first_call(calls, subagent=False) == calls[2]
    assert bounds.first_call(calls, subagent=True) == calls[1]
    assert bounds.first_call(calls[:1], subagent=False) is None, "a deny is not the allow the case waits for"
    assert bounds.first_call(calls, subagent=True, decision="halt") == calls[3]


def test_parse_json_lines_keeps_objects_in_order_and_skips_the_rest():
    text = '{"ev":"a"}\nnot json\n  {"ev":"b","n":1}\n{broken\n[1,2]\n'
    assert bounds.parse_json_lines(text) == [{"ev": "a"}, {"ev": "b", "n": 1}]


@pytest.mark.parametrize("start, expected", [
    ({"ev": "start", "spend_cap_usd": 1.0, "prices": {"output": 75.0}}, (1.0, 75.0, "ev=start")),
    ({"ev": "start", "spend_cap_usd": 1, "prices": {}}, (1.0, 15.0, "ev=start")),
    ({"ev": "start"}, (35.0, 15.0, "environment")),        # a worker from before the field
    (None, (35.0, 15.0, "environment")),
])
def test_spend_config_prefers_the_workers_own_figures(start, expected):
    assert bounds.spend_config(start, 35.0, 15.0) == expected


@pytest.mark.parametrize("cap, price", [(35.0, 15.0), (0.5, 15.0), (1.0, 75.0), (35.0, 0.6)])
def test_injected_tokens_price_past_the_cap_alone_and_are_integral(cap, price):
    tokens = bounds.tokens_to_exceed(cap, price)
    assert isinstance(tokens, int)
    assert tokens / 1_000_000 * price > cap * 1.05, "the injection alone must clear the cap with margin"
    assert price_usd((0, 0, 0, tokens)) > cap or price != 15.0, "the shared meter prices it past the cap too"


@pytest.mark.parametrize("cap, price", [(0.0, 15.0), (35.0, 0.0), (-1.0, 15.0)])
def test_tokens_to_exceed_refuses_a_cap_or_price_it_cannot_size(cap, price):
    with pytest.raises(ValueError):
        bounds.tokens_to_exceed(cap, price)


def test_probe_entry_is_a_counted_assistant_row_with_a_unique_message_id():
    a, b = bounds.probe_entry(10), bounds.probe_entry(10)
    assert a["type"] == "assistant" and a["message"]["usage"] == {"output_tokens": 10}
    assert a["message"]["id"] != b["message"]["id"], "the meter dedupes by message id"
    assert a["message"]["id"].startswith("u23-")
    assert isinstance(bounds.probe_entry(3.0)["message"]["usage"]["output_tokens"], int)


def test_calls_ran_counts_a_call_with_a_real_result_and_not_a_halted_or_unanswered_one():
    rows = [
        (1, "", entry("assistant", use("u1"), use("u2"), use("u3"))),
        (2, "", entry("user", result("u1", "Nauvoo, Hancock, Illinois"), result("u2", bounds.STORE_UNAVAILABLE_REASON))),
        (3, "agent-x", entry("assistant", use("u4", "Read"))),
        (4, "agent-x", entry("user", result("u4", options.STOP_REASON))),
        (5, "agent-x", entry("assistant", use("u5", "Read"))),
        (6, "agent-x", entry("user", result("u5", "This session has reached its $2.5 spend limit"))),
    ]
    ran, unresolved = bounds.calls_ran(rows)
    assert ran == [("", "mcp__genealogy__place_search", "u1")]
    assert unresolved == [("", "mcp__genealogy__place_search", "u3")]
    assert bounds.calls_ran([]) == ([], [])


def test_the_halt_markers_are_the_workers_own_reasons():
    for reason in (options.STOP_REASON, options.HANDOVER_REASON, options.STORE_UNAVAILABLE_REASON, CAP_REASON):
        assert any(m in reason for m in bounds.HALT_MARKERS), reason
    assert all(m.strip() for m in bounds.HALT_MARKERS)


def test_agent_inputs_reports_the_models_flag_as_stored_on_the_main_thread_only():
    rows = [
        (1, "", entry("assistant", use("a1", "Agent", run_in_background=True, prompt="x"), use("a2", "Task", prompt="y"))),
        (2, "agent-z", entry("assistant", use("a3", "Agent", run_in_background=True))),
        (3, "", entry("assistant", use("a4", "Read"))),
    ]
    assert bounds.agent_inputs(rows) == [("Agent", True, True), ("Task", False, None)]


# ── the checks ─────────────────────────────────────────────────────────────────────────


def test_closed_and_payload_checks():
    good = snap("budget", payload={"outcome": "budget", "limit": "spend"})
    assert bounds.closed_check("x", good, "budget")[1] and bounds.payload_check("x", good, "budget", "spend")[1]
    assert not bounds.closed_check("x", snap("budget", completed=False), "budget")[1], "open is not closed"
    assert not bounds.closed_check("x", good, "stopped")[1]
    assert not bounds.payload_check("x", snap("budget", payload={"outcome": "budget"}), "budget", "spend")[1], \
        "the nudge budget is not the spend cap"
    assert not bounds.payload_check("x", snap("budget", payload={}), "budget")[1]
    assert not bounds.closed_check("x", bounds.TurnSnap("t1"), "budget")[1], "no row"


@pytest.mark.parametrize("outcome, completed, ok", [
    ("completed", True, True), ("budget", True, True), ("stopped", True, False),
    # A project-less reply with no tool call after the nudge: the bound worked.
    ("no_progress", True, True),
    ("signin_required", True, False), ("retries_exhausted", True, False), ("transcript_lost", True, False),
    ("ok", False, False), (None, True, False),
])
def test_ran_check(outcome, completed, ok):
    assert bounds.ran_check("x", snap(outcome, completed=completed))[1] is ok


def test_unbilled_checks_pass_a_turn_closed_before_the_cli():
    s = snap("stopped", cost=None)
    events = [ev("bound_before_cli", outcome="stopped"), ev("turn", status=200)]
    assert oks(bounds.unbilled_checks("x", s, events, "stopped")) == [True, True, True]
    assert oks(bounds.unbilled_checks("x", snap("stopped", cost=0), events, "stopped")) == [True, True, True]


def test_unbilled_checks_fail_a_cost_a_cli_trace_or_no_bound_line():
    events = [ev("bound_before_cli", outcome="stopped")]
    assert oks(bounds.unbilled_checks("x", snap("stopped", cost=0.03), events, "stopped")) == [False, True, True]
    assert oks(bounds.unbilled_checks("x", snap("stopped"), events + [ev("cli_stderr", line="x")], "stopped")) == [True, True, False]
    assert oks(bounds.unbilled_checks("x", snap("stopped", calls=[call(1, "halt")]), events, "stopped"))[2] is False
    assert oks(bounds.unbilled_checks("x", snap("stopped"), [ev("bound_before_cli", outcome="budget")], "stopped"))[1] is False
    assert oks(bounds.unbilled_checks("x", snap("stopped"), [ev("bound_before_cli", "t2", outcome="stopped")], "stopped"))[1] \
        is False, "another turn's line does not count"


def test_halt_checks_pass_a_halt_where_the_bound_landed():
    calls = [call(1), call(2, "halt"), call(3, "halt")]
    events = [ev("halt", reason=options.STOP_REASON)]
    assert oks(bounds.halt_checks("x", calls, events, reason=options.STOP_REASON, subagent=False)) == [True, True, True]
    sub = [call(1, agent="a1"), call(2, "halt", agent="a1")]
    assert oks(bounds.halt_checks("x", sub, events, reason=options.STOP_REASON, subagent=True)) == [True, True, True]
    assert oks(bounds.halt_checks("x", sub, events, reason=options.STOP_REASON, subagent=None)) == [True, True, True]


def test_halt_checks_fail_no_halt_the_wrong_thread_a_later_allow_or_the_wrong_reason():
    stop = options.STOP_REASON
    assert oks(bounds.halt_checks("x", [call(1)], [], reason=stop, subagent=False)) == [False, False, False]
    sub = [call(1, agent="a1"), call(2, "halt", agent="a1")]
    assert oks(bounds.halt_checks("x", sub, [ev("halt", reason=stop)], reason=stop, subagent=False))[0] is False
    ran_on = [call(1), call(2, "halt"), call(3)]
    assert oks(bounds.halt_checks("x", ran_on, [ev("halt", reason=stop)], reason=stop, subagent=False))[1] is False
    assert oks(bounds.halt_checks("x", [call(2, "halt")], [ev("halt", reason=options.HANDOVER_REASON)],
                                  reason=stop, subagent=False))[2] is False


def _capped(**over) -> tuple[bounds.TurnSnap, list[dict]]:
    payload = {"outcome": "budget", "limit": "spend", "spent_usd": 3.1, "spend_estimate_usd": 3.2}
    payload.update(over.pop("payload", {}))
    s = snap("budget", calls=over.pop("calls", [call(1), call(2, "halt")]), payload=payload)
    events = over.pop("events", [ev("spend_cap", spent_usd=3.1, cap_usd=CAP), ev("halt", reason=CAP_REASON)])
    return s, events


def test_cap_checks_pass_a_spend_halt():
    s, events = _capped()
    assert all(oks(bounds.cap_checks("x", s, events, cap_usd=CAP, subagent=False)))


@pytest.mark.parametrize("over, failing", [
    ({"events": [ev("halt", reason=CAP_REASON)]}, "ev=spend_cap"),
    ({"events": [ev("spend_cap", spent_usd=1.0), ev("halt", reason=CAP_REASON)]}, "ev=spend_cap"),
    ({"events": [ev("spend_cap", spent_usd=3.1), ev("halt", reason=options.STOP_REASON)]}, "expected reason"),
    ({"payload": {"limit": None}}, "limit spend"),
    ({"payload": {"spent_usd": None}}, "turn_done spent_usd"),
    ({"calls": [call(1)]}, "a halt row"),
])
def test_cap_checks_fail_each_missing_piece(over, failing):
    s, events = _capped(**over)
    bad = [name for name, ok, _ in bounds.cap_checks("x", s, events, cap_usd=CAP, subagent=False) if not ok]
    assert bad and any(failing in name for name in bad), bad


def test_q1_reads_the_stop_dispatch_between_the_halt_and_the_attempts_end():
    halt = ev("halt", reason=options.STOP_REASON)
    assert bounds.q1_answer([ev("allow"), halt, ev("terminal", reason="stopped", recorded="stopped"),
                             ev("turn", status=200, max_nudges=3)], "t1")[0] == "dispatched"
    assert bounds.q1_answer([halt, ev("nudge", n=1)], "t1")[0] == "dispatched"
    assert bounds.q1_answer([halt, ev("turn", status=200, max_nudges=3)], "t1")[0] == "not_dispatched"
    # A later attempt's terminal is not this halt's dispatch.
    assert bounds.q1_answer([halt, ev("turn", status=500, error="x"), ev("terminal", reason="stopped")], "t1")[0] \
        == "not_dispatched"
    assert bounds.q1_answer([halt, ev("terminal", "t2", reason="x")], "t1")[0] == "not_dispatched"
    assert bounds.q1_answer([ev("turn", status=200, max_nudges=3)], "t1")[0] == "no_halt"
    assert bounds.q1_answer([halt, ev("turn", status=200, max_nudges=0)], "t1")[0] == "hook_off"


def test_q2_reads_the_parent_after_the_first_subagent_halt():
    calls = [call(1, agent="a1"), call(2, "halt", agent="a1", s=10)]
    main_after = [(5, "", entry("assistant", {"type": "text", "text": "carrying on"}, ts="2026-10-05T12:00:20Z"))]
    main_before = [(5, "", entry("assistant", {"type": "text", "text": "x"}, ts="2026-10-05T12:00:05Z"))]
    sub_after = [(5, "agent-a1", entry("assistant", {"type": "text", "text": "x"}, ts="2026-10-05T12:00:20Z"))]
    assert bounds.q2_answer(calls, main_after)[0] == "continued"
    assert bounds.q2_answer(calls + [call(3, "halt", s=12)], [])[0] == "continued", "a main-thread call, even a halted one"
    assert bounds.q2_answer(calls, main_before + sub_after)[0] == "stopped"
    assert bounds.q2_answer(calls, [(5, "", entry("assistant"))])[0] == "stopped", "no timestamp is not after"
    assert bounds.q2_answer([call(1), call(2, "halt")], main_after)[0] == "no_subagent_halt"


def test_outage_checks_pass_either_store_loss_path():
    by_hook = [ev("halt_check_failed", clause="stop", error="OperationalError", store_down=True),
               ev("turn", status=500, error="StoreUnavailable: the store is unreachable")]
    by_loop = [ev("turn", status=500, error="OperationalError: terminating connection")]
    # What a pg_terminate_backend actually raised on compose (2026-10-05): a subclass.
    by_admin = [ev("turn", status=500, error="AdminShutdown: terminating connection due to administrator command")]
    for events in (by_hook, by_loop, by_admin):
        assert all(oks(bounds.outage_checks("x", events, "t1", terminated=1, ran=[])))


def test_outage_checks_fail_no_backend_another_error_or_a_call_that_ran():
    events = [ev("turn", status=500, error="StoreUnavailable: x")]
    assert oks(bounds.outage_checks("x", events, "t1", terminated=0, ran=[]))[0] is False, "application_name not set"
    other = [ev("turn", status=500, error="RuntimeError: ResultMessage is_error")]
    assert oks(bounds.outage_checks("x", other, "t1", terminated=1, ran=[]))[1:3] == [False, False]
    # A psycopg error that is not a store loss (a SQL bug) does not pass for one.
    bug = [ev("turn", status=500, error="UndefinedColumn: column \"x\" does not exist")]
    assert oks(bounds.outage_checks("x", bug, "t1", terminated=1, ran=[]))[1:3] == [False, False]
    assert oks(bounds.outage_checks("x", events, "t1", terminated=1, ran=[("", "Read", "u1")]))[3] is False
    assert oks(bounds.outage_checks("x", [ev("turn", "t2", status=500, error="StoreUnavailable")], "t1",
                                    terminated=1, ran=[]))[2] is False


def _held(**over):
    a = over.pop("a", snap("queued", tid="A", calls=[call(1), call(2, "halt")]))
    b = over.pop("b", snap("completed", tid="B", calls=[call(7)]))
    reply = over.pop("reply", {"turn_id": "B", "queued": True, "message_id": None})
    events = over.pop("events", [ev("halt", "A", reason=options.HANDOVER_REASON),
                                 ev("turn", "A", status=200, released_turn="m-1"),
                                 ev("released", "B", message_id="m-1")])
    posts = over.pop("posts", [{"ev": "post", "msgid": "m-1", "action": "delete"}])
    return bounds.held_checks("x", reply, a, b, events, posts, a_outcome="queued", a_reason=options.HANDOVER_REASON)


def test_held_checks_pass_a_handover():
    assert all(oks(_held()))


@pytest.mark.parametrize("over, failing", [
    ({"reply": {"turn_id": "B", "queued": False, "message_id": "m-9"}}, "was held"),
    ({"events": [ev("halt", "A", reason=options.HANDOVER_REASON), ev("turn", "A", status=200),
                 ev("released", "B", message_id="m-1")]}, "released a message"),
    ({"events": [ev("halt", "A", reason=options.HANDOVER_REASON), ev("turn", "A", status=200, released_turn="m-1"),
                 ev("released", "C", message_id="m-1")]}, "ev=released"),
    ({"posts": [{"ev": "post", "msgid": "m-2"}]}, "shim delivered"),
    ({"b": snap("completed", tid="B", calls=[call(7, "halt")])}, "not halted at its first call"),
    ({"b": snap("completed", tid="B", calls=[])}, "not halted at its first call"),
    ({"b": snap("stopped", tid="B", calls=[call(7)])}, "the held turn: ran"),
    ({"a": snap("stopped", tid="A", calls=[call(1), call(2, "halt")])}, "closed queued"),
])
def test_held_checks_fail_each_missing_piece(over, failing):
    bad = [name for name, ok, _ in _held(**over) if not ok]
    assert bad and any(failing in name for name in bad), bad


def test_resume_checks():
    good = snap("completed", rc=2)
    assert all(oks(bounds.resume_checks("x", good, sdk_before="s", sdk_after="s", entries_at_kill=5, entries_after=9)))
    assert oks(bounds.resume_checks("x", snap("completed", rc=1), sdk_before="s", sdk_after="s",
                                    entries_at_kill=5, entries_after=9)) == [False, True, True, True]
    assert oks(bounds.resume_checks("x", snap("no_progress", rc=2), sdk_before="s", sdk_after="s",
                                    entries_at_kill=5, entries_after=9)) == [True, False, True, True]
    assert oks(bounds.resume_checks("x", good, sdk_before="s", sdk_after="t", entries_at_kill=5, entries_after=5)) \
        == [True, True, False, False]
    assert oks(bounds.resume_checks("x", good, sdk_before=None, sdk_after=None, entries_at_kill=0, entries_after=1))[2] is False


def test_result_findings_name_each_attempts_ending():
    lines = bounds.result_findings([ev("turn", receive_count=1, status=500, error="RuntimeError: ResultMessage is_error "
                                                                             "(error_during_execution)"),
                                    ev("turn", receive_count=2, status=200, outcome="stopped"),
                                    ev("turn", "t2", status=200)], "t1")
    assert len(lines) == 2 and "error_during_execution" in lines[0] and "outcome=stopped" in lines[1]


def test_halt_latency_is_on_the_postgres_clock():
    s = snap(calls=[call(1), call(2, "halt", s=4.5)])
    assert bounds.halt_latency(s, T0 + timedelta(seconds=1)) == 3.5
    assert bounds.halt_latency(snap(calls=[call(1)]), T0) is None
    assert bounds.halt_latency(s, None) is None


def test_render_report_prints_evidence_findings_figures_and_a_verdict_per_check():
    rep = bounds.Report(case="stop_main", session_id="sess_1", turn_ids=["t1"],
                        checks=[("a", True, ""), ("b", False, "why")], findings=["Q1: dispatched"],
                        figures={"t1.cost_usd": 0.1}, evidence=["-- turn t1"])
    out = bounds.render_report(rep)
    assert "session=sess_1" in out and "-- turn t1" in out and "Q1: dispatched" in out and "t1.cost_usd=0.1" in out
    assert re.search(r"^a +PASS", out, re.M) and re.search(r"^b +FAIL  why", out, re.M)
    assert out.rstrip().endswith("stop_main: 1/2 checks passed  session=sess_1")


def test_render_snap_shows_rows_and_the_workers_lines_without_the_stderr_flood():
    s = snap("stopped", calls=[call(1), call(2, "halt")])
    lines = bounds.render_snap(s, [ev("halt", reason="r"), *[ev("cli_stderr", line=f"l{i}") for i in range(9)],
                                   ev("halt", "t2", reason="other")])
    text = "\n".join(lines)
    assert "outcome=stopped" in text and "#2 mcp__genealogy__place_search agent=None halt" in text
    assert '"reason": "r"' in text and "other" not in text
    assert text.count("cli_stderr ") == 3 and "plus 9 cli_stderr" in text


# ── argument refusals: no billed case runs for nothing ─────────────────────────────────


def _args(*argv: str) -> argparse.Namespace:
    return bounds.build_parser().parse_args(list(argv))


START = {"ev": "start", "spend_cap_usd": 35.0, "prices": {"output": 15.0}}


@pytest.mark.parametrize("argv, start, said", [
    (("--case", "stop_main", "--session", "s1"), START, "fresh session"),
    (("--case", "probe_resume", "--kill-after-s", "2"), START, "5-20"),
    (("--case", "probe_resume", "--kill-after-s", "25"), START, "5-20"),
    (("--case", "cap_main_real",), START, "lowered"),
    (("--case", "cap_main_real",), {**START, "spend_cap_usd": 0}, "lowered"),
    (("--case", "cap_main",), {**START, "spend_cap_usd": 0}, "off"),
    (("--case", "outage_pause", "--pause-s", "0"), START, "positive"),
])
def test_make_ctx_refuses(argv, start, said):
    with pytest.raises(ValueError, match=said):
        bounds.make_ctx(_args(*argv), start)


@pytest.mark.parametrize("argv, start", [
    (("--case", "stop_delegation", "--session", "s1"), START),
    (("--case", "probe_resume", "--kill-after-s", "20"), START),
    (("--case", "cap_main_real",), {**START, "spend_cap_usd": 1.0}),
    (("--case", "precli",), {**START, "spend_cap_usd": 0}),  # the cap does not matter to Stop
])
def test_make_ctx_accepts(argv, start):
    ctx = bounds.make_ctx(_args(*argv), start)
    assert ctx.cap_usd == start["spend_cap_usd"]


def test_the_case_list_is_closed():
    with pytest.raises(SystemExit):
        _args("--case", "stop_everything")
    assert set(bounds.SEEDED) <= set(bounds.CASES)


def test_main_exits_2_before_any_case_when_the_stack_is_down(monkeypatch, capsys):
    monkeypatch.setattr(bounds.demo, "preflight", lambda base, dsn: "stack not up")
    monkeypatch.setattr(bounds, "run_case", lambda *a: pytest.fail("no case may run"))
    assert bounds.main(["--case", "precli"]) == 2
    assert "stack not up" in capsys.readouterr().err


# ── the cases, the stack faked ─────────────────────────────────────────────────────────


class _Resp:
    def __init__(self, status: int, body: dict):
        self.status_code, self._body = status, body

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Client:
    def __init__(self, log: list[str]):
        self.log, self.n = log, 0

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, json=None, **k):
        self.log.append("POST " + url.split("/api/")[-1])
        if url.endswith("/api/sessions"):
            return _Resp(200, {"id": "sess_1"})
        if url.endswith("/messages"):
            self.n += 1
            return _Resp(202, {"turn_id": f"turn_{self.n}", "message_id": "m", "queued": False})
        return _Resp(202, {"ok": True})


def _fake(monkeypatch, *, wait=("timeout", None), open_rows=None):
    """Every side effect recorded in ``log``: the client, the waits, docker, the db writes.
    ``open_rows`` is what settle sees on each read (then nothing open)."""
    log: list[str] = []
    reads = iter(open_rows or [])
    monkeypatch.setattr(bounds.turn, "signed_in_client", lambda base, email, **kw: _Client(log))
    monkeypatch.setattr(bounds, "wait_first_call",
                        lambda ctx, tid, *, subagent: log.append(f"wait {tid} subagent={subagent}") or wait)
    monkeypatch.setattr(bounds, "db_exec", lambda dsn, sql, params: log.append(f"exec {sql.split()[0]}") or 0)
    monkeypatch.setattr(bounds, "seeded_session", lambda ctx, rep: setattr(rep, "session_id", "sess_s") or "sess_s")
    monkeypatch.setattr(bounds.turn, "docker", lambda *a: log.append("docker " + " ".join(a)))

    def db(dsn, sql, params):
        if sql == bounds.OPEN_SQL:
            return next(reads, [])
        return []

    monkeypatch.setattr(bounds.turn, "db", db)
    monkeypatch.setattr(bounds.turn, "one", lambda dsn, sql, params: None)
    monkeypatch.setattr(bounds, "worker_events", lambda: [])
    monkeypatch.setattr(bounds.time, "sleep", lambda s: None)
    monkeypatch.setattr(bounds.smoke, "turn_done_payload", lambda cfg, sid, tid: None)
    return log


def _ctx(**over) -> bounds.Ctx:
    base = dict(base="http://x", dsn="dsn", email="e", s3_endpoint="s3", fixture="fx", session=None, deadline_s=5.0,
                kill_after_s=10.0, pause_s=1.0, cap_usd=CAP, price_output=15.0)
    base.update(over)
    return bounds.Ctx(**base)


@pytest.mark.parametrize("case, subagent", [
    ("stop_main", False), ("held_release", False), ("held_after_stop", False), ("cap_main", False),
    ("outage_stop", False), ("outage_cap", False), ("outage_held", False), ("outage_pause", False),
    ("stop_delegation", True), ("cap_delegation", True), ("probe_resume", True),
])
def test_each_case_waits_on_its_thread_and_a_miss_bounds_nothing(monkeypatch, case, subagent):
    log = _fake(monkeypatch, open_rows=[[("turn_1", None)]])
    rep = bounds.run_case(_ctx(), case)
    assert f"wait turn_1 subagent={subagent}" in log, log
    assert not any(e.startswith("docker") for e in log), "a miss kills, pauses and terminates nothing"
    assert "POST sessions/sess_1/interrupt" in log or "POST sessions/sess_s/interrupt" in log, \
        "the missed turn is still running: settle must Stop it"
    assert "exec DELETE" in log, "probe rows are deleted on every exit"
    names = [n for n, ok, _ in rep.checks if not ok]
    assert any("reached its first allowed call" in n for n in names), rep.checks


def test_a_case_that_crashes_still_settles_deletes_and_reports(monkeypatch):
    log = _fake(monkeypatch, wait=("seen", call(1)), open_rows=[[("turn_1", None)], [("turn_1", None)]])
    monkeypatch.setattr(bounds, "inject", lambda ctx, rep, sdk: (_ for _ in ()).throw(RuntimeError("boom")))
    rep = bounds.run_case(_ctx(), "cap_main")
    assert ("cap_main: the case ran to its end", False, "RuntimeError: boom") in rep.checks
    assert "exec DELETE" in log and log.count("POST sessions/sess_1/interrupt") == 1
    assert ("cap_main: no turn left running", True, "running=[]") in rep.checks


def test_settle_reports_a_turn_it_could_not_stop_and_leaves_held_rows_alone(monkeypatch):
    log = _fake(monkeypatch)
    monkeypatch.setattr(bounds.turn, "db", lambda dsn, sql, params: [("turn_1", None), ("turn_2", "queued")])
    clock = iter([0.0, 0.0, 0.0, 1.0, 1.0, 11.0, 11.0, 300.0, 300.0])
    monkeypatch.setattr(bounds.time, "monotonic", lambda: next(clock))
    running, held = bounds.settle(_ctx(), _Client(log), "sess_1", deadline_s=240.0)
    assert running == ["turn_1"] and held == ["turn_2"]
    assert log.count("POST sessions/sess_1/interrupt") == 2, "pressed again every 10 s, not every poll"
    monkeypatch.setattr(bounds.turn, "db", lambda dsn, sql, params: [("turn_2", "queued")])
    assert bounds.settle(_ctx(), _Client(log), "sess_1") == ([], ["turn_2"]), "held alone is not billed"


@pytest.mark.parametrize("case", ["held_release", "held_after_stop"])
def test_the_held_cases_wait_for_the_shims_line_for_the_released_msgid(monkeypatch, case):
    """The shim logs a delivery's post line only when the worker answers it -- after B's
    teardown and release, seconds past the turn_done ``done`` saw. Read once, the check
    raced that teardown and failed a delivery that happened."""
    _fake(monkeypatch, wait=("seen", call(1)))
    monkeypatch.setattr(bounds, "done", lambda *a, **k: True)
    monkeypatch.setattr(bounds, "snapshot", lambda ctx, sid, tid: snap("completed", tid=tid, calls=[call(1)]))
    monkeypatch.setattr(bounds, "worker_events", lambda: [ev("turn", "turn_1", released_turn="m-B"),
                                                          ev("released", "turn_2", message_id="m-B")])
    reads: list[int] = []

    def service_lines(service, name):
        reads.append(1)
        assert (service, name) == ("shim", "post")
        return [{"ev": "post", "msgid": "m-A"}] + ([{"ev": "post", "msgid": "m-B"}] if len(reads) >= 3 else [])

    monkeypatch.setattr(bounds.smoke, "service_lines", service_lines)
    rep = bounds.run_case(_ctx(), case)
    [delivered] = [ok for n, ok, _ in rep.checks if n.endswith("the shim delivered the released msgid")]
    assert delivered and len(reads) == 3, (reads, rep.checks)


def test_shim_posts_for_gives_up_quietly():
    assert bounds.shim_posts_for(None) == [], "nothing released, nothing to wait for"


def test_shim_posts_for_returns_nothing_at_its_deadline(monkeypatch):
    monkeypatch.setattr(bounds.smoke, "service_lines", lambda service, name: [{"ev": "post", "msgid": "other"}])
    assert bounds.shim_posts_for("m-B", timeout_s=0, every_s=0) == []


def test_precli_starts_the_worker_again_whatever_happens(monkeypatch):
    log = _fake(monkeypatch)
    monkeypatch.setattr(bounds, "post", lambda *a: (_ for _ in ()).throw(RuntimeError("tier down")))
    rep = bounds.run_case(_ctx(), "precli")
    assert log.index("docker stop proto-worker") < log.index("docker start proto-worker")
    assert ("precli: the case ran to its end", False, "RuntimeError: tier down") in rep.checks


def test_outage_pause_unpauses_whatever_happens(monkeypatch):
    log = _fake(monkeypatch, wait=("seen", call(1)))

    def sleep(s):
        if s == 1.0:
            raise KeyboardInterrupt  # the operator's ^C during the freeze

    monkeypatch.setattr(bounds.time, "sleep", sleep)
    with pytest.raises(KeyboardInterrupt):
        bounds.case_outage_pause(_ctx(), _Client(log), bounds.Report(case="outage_pause", session_id="s"))
    assert log[-2:] == ["docker pause proto-postgres", "docker unpause proto-postgres"], log


def test_the_outage_cases_terminate_exactly_the_turns_backend(monkeypatch):
    log = _fake(monkeypatch, wait=("seen", call(1)))
    seen: list[tuple] = []

    def db(dsn, sql, params):
        seen.append((sql, params))
        if sql == bounds.TERMINATE_SQL:
            return [(True,)]
        if "receive_count, completed_at" in sql:
            return [(2, None)]
        return []

    monkeypatch.setattr(bounds.turn, "db", db)
    monkeypatch.setattr(bounds, "docker_logs", lambda *a: [])
    monkeypatch.setattr(bounds, "done", lambda *a, **k: False)
    rep = bounds.Report(case="outage_stop", session_id="sess_1")
    bounds.case_outage_stop(_ctx(), _Client(log), rep)
    assert (bounds.TERMINATE_SQL, ("turn:turn_1",)) in seen
    assert "POST sessions/sess_1/interrupt" in log, "the condition is set before the outage"
    assert rep.figures["terminated_backends"] == 1
    assert "application_name = %s" in bounds.TERMINATE_SQL and "pg_terminate_backend" in bounds.TERMINATE_SQL


# ── the probe texts and the make target ────────────────────────────────────────────────


def test_the_probe_texts_exist_and_the_delegation_one_never_asks_for_background():
    for path in (bounds.LOOKUPS_TEXT, bounds.EXTRACTIONS_TEXT, bounds.RESUME_TEXT):
        assert path.read_text(encoding="utf-8").strip(), path
    text = bounds.EXTRACTIONS_TEXT.read_text(encoding="utf-8").lower()
    assert "background" not in text and "record-extractor" in text


_NUDGES_3 = re.compile(r"""^export AUTONOMOUS_MAX_NUDGES=(["']?)\$\$\{AUTONOMOUS_MAX_NUDGES:-3\}\1$""")
_CAP_PASS = re.compile(r"""^export SESSION_SPEND_CAP_USD=(["']?)\$\$\{SESSION_SPEND_CAP_USD:-35\}\1$""")
_UP = re.compile(r"^\$\(PROTO_COMPOSE\)\s+up\b")


def _before_up(commands: list[str], pattern: re.Pattern) -> bool:
    at = next((i for i, c in enumerate(commands) if pattern.match(c)), None)
    up = next((i for i, c in enumerate(commands) if _UP.match(c)), None)
    return at is not None and up is not None and at < up


@pytest.mark.parametrize("body, ok", [
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-3}"; \\', "\t  $(PROTO_COMPOSE) up -d --build"], True),
    (["\texport AUTONOMOUS_MAX_NUDGES=$${AUTONOMOUS_MAX_NUDGES:-3} && $(PROTO_COMPOSE)  up -d"], True),
    (['\t$(PROTO_COMPOSE) up -d; export AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-3}"'], False),
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES-3}"; $(PROTO_COMPOSE) up -d'], False),
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-0}"; $(PROTO_COMPOSE) up -d'], False),
])
def test_the_pin_reader_accepts_a_reflow_and_rejects_a_late_or_wrong_pin(body, ok):
    assert _before_up(_recipe_commands(body), _NUDGES_3) is ok


def test_proto_bounds_target():
    lines = _recipe("proto-bounds")
    body = "\n".join(lines)
    commands = _recipe_commands(lines)
    assert re.search(r'test -n "\$\(CASE\)"', body), "refuse without CASE rather than guess one"
    assert _before_up(commands, _NUDGES_3), "the Stop hook on at 3 before compose takes its environment (Q1)"
    assert _before_up(commands, _CAP_PASS), "SESSION_SPEND_CAP_USD must reach compose, defaulting to the worker's 35"
    assert "apps/server/proto/env.sh" in body and "ANTHROPIC_API_KEY" in body
    assert re.search(r"up -d --wait postgres minio elasticmq worker shim web tools", body), body
    assert re.search(r"PROTO_COMPOSE=\"\$\(PROTO_COMPOSE\)\" uv run python proto/bounds.py --case '\$\(CASE\)'", body), \
        "the compose command reaches the driver's log reads"
    assert re.search(r"\$\(if \$\(SESSION\),\s*--session '\$\(SESSION\)',\s*\)", body) and body.rstrip().endswith("$(ARGS)")
    rule = re.search(r"^proto-bounds:.*?##(.*)$", MAKEFILE.read_text(encoding="utf-8"), re.M)
    assert rule and "billed" in rule.group(1)
    assert re.search(r"^PROTO_COMPOSE :?= ", MAKEFILE.read_text(encoding="utf-8"), re.M), \
        "PROTO_COMPOSE stays a plain assignment, so `make ... PROTO_COMPOSE=...` overrides it"


def test_the_offline_and_postgres_suites_run_the_u23_files():
    assert "tests/test_proto_bounds.py" in "\n".join(_recipe("proto-test"))
    assert "tests/test_proto_queue_pg.py" in "\n".join(_recipe("proto-test"))
    assert "tests/test_proto_queue_pg.py" in "\n".join(_recipe("proto-grants-test"))


def test_bounds_py_runs_as_a_script_from_apps_server():
    proc = subprocess.run([sys.executable, "proto/bounds.py", "--help"], cwd=SERVER, capture_output=True,
                          text=True, encoding="utf-8")
    assert proc.returncode == 0, proc.stderr
    assert "--case" in proc.stdout and "probe_resume" in proc.stdout
