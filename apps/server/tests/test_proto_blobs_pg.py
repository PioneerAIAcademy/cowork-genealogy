"""`blobs` against real Postgres.

Split out of `test_proto_writer_record_pg.py` in review: it tests `put_blob`, which
the writer-record work does not touch, and a test file should be findable by the thing
it tests.

Only observable against real Postgres: a FakeConn never executes the ON CONFLICT.
"""

from __future__ import annotations

import uuid

import psycopg
import pytest

from tests._proto_pg import database, session, sql, turn


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="blob_") as dsn:
        yield dsn


def _turn(dsn: str) -> tuple[str, str]:
    row = session(dsn)
    return turn(dsn, row.session_id, row.project_id, "go"), row.session_id


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
