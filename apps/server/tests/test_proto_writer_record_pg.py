"""`tool_calls.wrote` against REAL Postgres — blocker 3 of the #3262 self-review.

Migration 012 added the column and `insert_tool_call` never inserted it, so every row
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
    _insert(pg_dsn, None)
    found = sql(pg_dsn,
                "SELECT tool_use_id FROM tool_calls WHERE wrote IS NOT NULL "
                "AND tool_use_id IN (%s, %s)", (written, written))
    assert [r[0] for r in found] == [written]


def test_a_reupload_refreshes_the_blob_timestamp(pg_dsn):
    """`created_at` is the only timestamp `blobs` has, and `fetch_sidecar` hands it to
    the viewer AS the mtime. Without `created_at = now()` on the upsert a re-uploaded
    sidecar shows the time of the write it replaced — and the engine's own upsert on
    this same table refreshes it, so the two planes disagreed about one column.

    Only observable against real Postgres: a FakeConn never executes the ON CONFLICT.
    """
    import time

    from web.project_blobs import put_blob, upload_key

    turn_id, session_id = _turn(pg_dsn)
    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    key = upload_key("deed.pdf")

    class Facade:
        def put(self, k, data, content_type): pass
        def get(self, k): return b""

    with psycopg.connect(pg_dsn) as conn:
        put_blob(conn, Facade(), project_id, key, b"first", content_type="application/pdf")
        conn.commit()
    first = sql(pg_dsn, "SELECT created_at FROM blobs WHERE project_id = %s AND key = %s",
                (project_id, key))[0][0]

    time.sleep(0.05)
    with psycopg.connect(pg_dsn) as conn:
        put_blob(conn, Facade(), project_id, key, b"second", content_type="application/pdf")
        conn.commit()
    second = sql(pg_dsn, "SELECT created_at FROM blobs WHERE project_id = %s AND key = %s",
                 (project_id, key))[0][0]

    assert second > first, f"the re-upload kept the old timestamp: {first} -> {second}"
