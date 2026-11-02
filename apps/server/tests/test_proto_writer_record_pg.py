"""`tool_calls.wrote` against REAL Postgres — blocker 3 of the #3262 self-review.

Migration 014 adds the column; `insert_tool_call` must bind it, so every row
was NULL, the partial index `WHERE wrote IS NOT NULL` indexed nothing, and the phase-3
change review it exists for was blocked on a feature that looked built.

A FakeConn test (test_proto_worker.py) catches a dropped column or a placeholder/param
mismatch. It cannot catch a column name that does not exist in the real schema, nor a
params-order swap that keeps the count — the `Jsonb` landing in `tool_use_id`'s slot.
Both of those reach production as a runtime error on EVERY tool call, so they are worth
one live insert.

Without the DSN the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import uuid

import psycopg

import pytest

from proto.worker import worker
from tests._proto_pg import database, session, sql, turn


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="wrec_") as dsn:
        yield dsn


def _turn(dsn: str) -> tuple[str, str]:
    row = session(dsn)
    return turn(dsn, row.session_id, row.project_id, "go"), row.session_id


def _insert(dsn: str, wrote) -> str:
    turn_id, session_id = _turn(dsn)
    use_id = "toolu_" + uuid.uuid4().hex[:10]
    row = {"turn_id": turn_id, "session_id": session_id,
           "tool_name": "mcp__genealogy__research_append", "decision": "allow",
           "tool_use_id": use_id}
    if wrote is not None:
        row["wrote"] = wrote
    with psycopg.connect(dsn) as conn:
        worker.insert_tool_call(conn, row)
        conn.commit()
    return use_id


def _read(dsn: str, use_id: str):
    return sql(dsn, "SELECT wrote, tool_use_id FROM tool_calls WHERE tool_use_id = %s",
               (use_id,))


def test_a_write_shape_round_trips_through_the_real_column(pg_dsn):
    """The column exists, accepts the shape, and reads back as the same document."""
    shape = {"section": "person_evidence", "op": "update", "ids": ["pe_001"]}
    use_id = _insert(pg_dsn, shape)
    rows = _read(pg_dsn, use_id)
    assert rows, "the row was not inserted at all"
    stored, stored_use_id = rows[0][0], rows[0][1]
    assert stored == shape, f"the shape did not round-trip: {stored!r}"
    # Catches a params-order swap that keeps the count: if `wrote` were bound into
    # `tool_use_id`'s slot the lookup above would already have missed, but assert it
    # directly so the failure names the cause rather than looking like a missing row.
    assert stored_use_id == use_id


def test_a_read_leaves_the_column_null_so_the_partial_index_stays_sparse(pg_dsn):
    """`WHERE wrote IS NOT NULL` is the whole point of the index: a non-NULL empty
    document would be indexed and read as a write that touched nothing."""
    use_id = _insert(pg_dsn, None)
    rows = _read(pg_dsn, use_id)
    assert rows and rows[0][0] is None


def test_the_partial_index_finds_only_the_writes(pg_dsn):
    """What the change review actually runs: writes in this session, newest first."""
    written = _insert(pg_dsn, {"section": "sources", "op": "append", "ids": ["S1"]})
    # The READ's id is bound too. Checking the written id twice made this pass with
    # reads stored as `{}` AND with the partial index removed (found in review).
    read = _insert(pg_dsn, None)
    found = sql(pg_dsn,
                "SELECT tool_use_id FROM tool_calls WHERE wrote IS NOT NULL "
                "AND tool_use_id IN (%s, %s)", (written, read))
    assert [r[0] for r in found] == [written]


def _insert_decided(dsn: str, decision: str, wrote) -> tuple[str, str]:
    turn_id, session_id = _turn(dsn)
    use_id = "toolu_" + uuid.uuid4().hex[:10]
    with psycopg.connect(dsn) as conn:
        worker.insert_tool_call(conn, {"turn_id": turn_id, "session_id": session_id,
                                       "tool_name": "mcp__genealogy__research_append",
                                       "decision": decision, "tool_use_id": use_id, "wrote": wrote})
        conn.commit()
    return turn_id, use_id


def test_a_call_the_plugin_hook_denied_loses_its_allow_and_its_write(pg_dsn):
    """The worker's hook allowed it and recorded the write; the plugin's hook then denied
    it, so the call never ran. Left as is, the change scan would show a write that never
    happened (live on compose, 2026-10-31: an agent-only tool's row read `allow`)."""
    shape = {"section": "proof_summaries", "op": "append", "ids": []}
    turn_id, use_id = _insert_decided(pg_dsn, "allow", shape)
    with psycopg.connect(pg_dsn) as conn:
        assert worker.mark_hook_denied(conn, turn_id, use_id) == "mcp__genealogy__research_append"
        assert worker.mark_hook_denied(conn, turn_id, use_id) is None, "already a deny"
    assert sql(pg_dsn, "SELECT decision, wrote FROM tool_calls WHERE tool_use_id = %s",
               (use_id,)) == [("deny", None)]


@pytest.mark.parametrize("decision", ["deny", "halt"])
def test_a_row_this_worker_already_stopped_is_left_alone(pg_dsn, decision):
    turn_id, use_id = _insert_decided(pg_dsn, decision, None)
    with psycopg.connect(pg_dsn) as conn:
        assert worker.mark_hook_denied(conn, turn_id, use_id) is None
    assert sql(pg_dsn, "SELECT decision FROM tool_calls WHERE tool_use_id = %s", (use_id,)) == [(decision,)]


def test_another_turns_row_with_the_same_id_is_untouched(pg_dsn):
    """A redelivery repeats tool_use ids, so the match is on the turn as well."""
    turn_a, use_id = _insert_decided(pg_dsn, "allow", None)
    turn_b, _ = _turn(pg_dsn)
    with psycopg.connect(pg_dsn) as conn:
        assert worker.mark_hook_denied(conn, turn_b, use_id) is None
    assert sql(pg_dsn, "SELECT decision FROM tool_calls WHERE tool_use_id = %s", (use_id,)) == [("allow",)]
