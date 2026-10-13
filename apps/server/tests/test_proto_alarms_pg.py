"""U19's long-Agent alarm signal against REAL Postgres: ``ev=long_tool_call``, logged by
``finish_tool_call`` when a delegation ends and by the sweep's ``long_inflight_calls`` while
one is still running (a stuck call never reaches PostToolUse).

Without the DSN the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import uuid

import psycopg
import pytest

from proto.worker import worker
from tests._proto_pg import database, session, sql, turn

THRESHOLD_S = 600


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u19a_") as dsn:
        yield dsn


@pytest.fixture
def logged(monkeypatch):
    lines: list[dict] = []
    monkeypatch.setattr(worker, "log", lambda **f: lines.append(f))
    monkeypatch.setattr(worker, "LONG_AGENT_CALL_S", THRESHOLD_S)
    monkeypatch.setattr(worker, "_LONG_LOGGED", set())
    return lines


def open_claimed_turn(dsn: str, *, claimed_ago_s: int = 3600) -> str:
    row = session(dsn)
    turn_id = turn(dsn, row.session_id, row.project_id, "go")
    sql(dsn, "UPDATE turns SET claimed_at = now() - make_interval(secs => %s) WHERE turn_id = %s",
        (claimed_ago_s, turn_id))
    return turn_id


def call(dsn: str, turn_id: str, tool: str, age_s: int) -> str:
    use_id = "toolu_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO tool_calls (turn_id, session_id, tool_name, decision, tool_use_id, ts) "
             "SELECT %s, session_id, %s, 'allow', %s, now() - make_interval(secs => %s) FROM turns WHERE turn_id = %s",
        (turn_id, tool, use_id, age_s, turn_id))
    return use_id


def longs(lines: list[dict]) -> list[dict]:
    return [f for f in lines if f["ev"] == "long_tool_call"]


@pytest.mark.parametrize(("tool", "age_s", "logs"), [
    ("Agent", THRESHOLD_S + 30, True), ("Task", THRESHOLD_S + 30, True),
    ("Agent", THRESHOLD_S - 30, False), ("Read", THRESHOLD_S + 30, False),
])
def test_a_delegation_that_ends_long_logs_once(pg_dsn, logged, tool, age_s, logs):
    turn_id = open_claimed_turn(pg_dsn)
    use_id = call(pg_dsn, turn_id, tool, age_s)
    with psycopg.connect(pg_dsn) as conn:
        worker.finish_tool_call(conn, turn_id, use_id)
        worker.finish_tool_call(conn, turn_id, use_id)  # a redelivery's repeat stamps nothing
    got = longs(logged)
    assert [(f["tool_use_id"], f["in_flight"]) for f in got] == ([(use_id, False)] if logs else []), got
    if logs:
        assert got[0]["tool_name"] == tool and got[0]["duration_ms"] >= THRESHOLD_S * 1000


def test_the_sweep_flags_only_this_attempts_long_running_delegations(pg_dsn, logged):
    turn_id = open_claimed_turn(pg_dsn, claimed_ago_s=THRESHOLD_S * 3)
    long_one = call(pg_dsn, turn_id, "Agent", THRESHOLD_S * 2)
    call(pg_dsn, turn_id, "Agent", THRESHOLD_S // 2)  # young
    call(pg_dsn, turn_id, "Read", THRESHOLD_S * 2)  # not a delegation
    call(pg_dsn, turn_id, "Agent", THRESHOLD_S * 4)  # before this claim: a killed attempt's row
    finished = call(pg_dsn, turn_id, "Agent", THRESHOLD_S * 2)
    sql(pg_dsn, "UPDATE tool_calls SET duration_ms = 1 WHERE tool_use_id = %s", (finished,))
    closed = open_claimed_turn(pg_dsn, claimed_ago_s=THRESHOLD_S * 3)
    call(pg_dsn, closed, "Agent", THRESHOLD_S * 2)
    sql(pg_dsn, "UPDATE turns SET completed_at = now(), outcome = 'ok' WHERE turn_id = %s", (closed,))
    other = open_claimed_turn(pg_dsn, claimed_ago_s=THRESHOLD_S * 3)  # another instance's turn
    call(pg_dsn, other, "Agent", THRESHOLD_S * 2)

    with psycopg.connect(pg_dsn) as conn:
        assert worker.long_inflight_calls(conn, [turn_id, closed]) == [long_one]
        assert worker.long_inflight_calls(conn, [turn_id, closed]) == [], "logged once per call"
    assert [(f["tool_use_id"], f["in_flight"]) for f in longs(logged)] == [(long_one, True)]


def test_the_in_flight_check_is_off_at_zero_and_with_no_turns(pg_dsn, logged):
    turn_id = open_claimed_turn(pg_dsn)
    call(pg_dsn, turn_id, "Agent", THRESHOLD_S * 2)
    with psycopg.connect(pg_dsn) as conn:
        assert worker.long_inflight_calls(conn, [turn_id], threshold_s=0) == []
        assert worker.long_inflight_calls(conn, []) == []
    assert longs(logged) == []
