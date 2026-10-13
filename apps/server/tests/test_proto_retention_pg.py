"""U19: retention keyed on session INACTIVITY, against REAL Postgres
(docs/plan/familysearch-handoff.md, U19; ``worker.retention_once``).

session_entries is live state: the SDK resumes from it and the spend cap sums it. So a
session's transcript, events and tool calls go only when the session is idle -- no open
turn, running or held, and no message, rename or turn end inside the period -- never by a
row's own age, and the session is marked ``retired_at`` in the same transaction, so a
new message is refused (``SessionRetired``) rather than resuming nothing at a zero cap.
The interleavings with ``admit_message`` and ``delete_session`` run here, observed in
``pg_locks``: retention only TRIES the session's queue lock, so it never waits.

Without the DSN the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import asyncio
import sys
import threading
import uuid

import psycopg
import pytest

from proto import grants
from proto.worker import worker
from tests._proto_pg import (
    PROTO, SUBPATHS, AsyncPausingConn, database, dml_role, populated, project_rows, session, session_rows, sql,
    transcript, ungranted_advisory,
)

sys.path.insert(0, str(PROTO))

from web.app import PgStore, SessionRetired  # noqa: E402

IDLE_S = 90 * 86400
OLD = "now() - interval '100 days'"
WAIT_S = 10.0


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u19r_") as dsn:
        yield dsn


@pytest.fixture(scope="module")
def role_dsn(pg_dsn):
    with dml_role(pg_dsn) as (_role, dsn):
        yield dsn


@pytest.fixture(autouse=True)
def running():
    """Another suite may leave worker.SHUTDOWN set, and every retention loop stops on it."""
    worker.SHUTDOWN.clear()
    yield
    worker.SHUTDOWN.clear()


def idle(dsn: str, session_id: str) -> None:
    """Backdate a session and every turn it has past the period."""
    sql(dsn, f"UPDATE sessions SET updated_at = {OLD} WHERE session_id = %s", (session_id,))  # noqa: S608
    sql(dsn, f"UPDATE turns SET enqueued_at = {OLD}, completed_at = {OLD} "  # noqa: S608
             "WHERE session_id = %s AND completed_at IS NOT NULL", (session_id,))


def retired_at(dsn: str, session_id: str):
    return sql(dsn, "SELECT retired_at FROM sessions WHERE session_id = %s", (session_id,))[0][0]


def run(dsn: str, *, idle_s: int = IDLE_S) -> dict:
    """One pass, every session but the test's own excluded only by their activity."""
    return worker.retention_once(connect=lambda _dsn: psycopg.connect(dsn), idle_s=idle_s)


async def test_an_idle_session_is_retired_and_purged_and_keeps_its_turns_and_project(pg_dsn, role_dsn):
    row, sdk = await populated(pg_dsn)
    idle(pg_dsn, row.session_id)
    assert row.session_id in run(role_dsn)["retired"]
    assert retired_at(pg_dsn, row.session_id) is not None
    assert transcript(pg_dsn, sdk) == [], "the SDK transcript survived retirement"
    counts = session_rows(pg_dsn, row.session_id)
    assert {t: counts[t] for t in worker.RETENTION_PURGE_TABLES} == dict.fromkeys(worker.RETENTION_PURGE_TABLES, 0)
    assert counts["turns"] == 1 and counts["sessions"] == 1, "retention keeps the turns and the sessions row"
    assert set(project_rows(pg_dsn, row.project_id).values()) == {1}, "retention keeps the project"


async def test_a_session_that_never_ran_retires(pg_dsn):
    row = session(pg_dsn)
    idle(pg_dsn, row.session_id)
    assert row.session_id in run(pg_dsn)["retired"]
    assert retired_at(pg_dsn, row.session_id) is not None


@pytest.mark.parametrize("shape", ["recent message", "running turn", "held message", "turn ended recently"])
async def test_a_session_active_inside_the_period_is_untouched(pg_dsn, shape):
    """The predicate keys on the session's activity, never a row's own ts: the old event and
    transcript rows below would all match a per-row cutoff."""
    row, sdk = await populated(pg_dsn)
    idle(pg_dsn, row.session_id)
    sql(pg_dsn, f"UPDATE session_events SET ts = {OLD} WHERE session_id = %s", (row.session_id,))  # noqa: S608
    if shape == "recent message":
        sql(pg_dsn, "UPDATE sessions SET updated_at = now() WHERE session_id = %s", (row.session_id,))
    elif shape == "running turn":
        sql(pg_dsn, f"INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at) "  # noqa: S608
                    f"VALUES (%s, %s, %s, '{{}}', {OLD})", ("turn_" + uuid.uuid4().hex[:10], row.session_id, row.project_id))
    elif shape == "held message":
        sql(pg_dsn, f"INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at, outcome) "  # noqa: S608
                    f"VALUES (%s, %s, %s, '{{}}', {OLD}, 'queued')",
            ("turn_" + uuid.uuid4().hex[:10], row.session_id, row.project_id))
    else:
        sql(pg_dsn, "UPDATE turns SET completed_at = now() - interval '1 day' WHERE session_id = %s", (row.session_id,))
    before = session_rows(pg_dsn, row.session_id)
    assert row.session_id not in run(pg_dsn)["retired"]
    assert retired_at(pg_dsn, row.session_id) is None
    assert session_rows(pg_dsn, row.session_id) == before and transcript(pg_dsn, sdk) == sorted(SUBPATHS)


async def test_a_session_in_use_keeps_every_tool_call_however_old(pg_dsn):
    """User ruling 2026-10-13: tool_calls is the session's change history, so it goes only
    with the session. A row far older than the period, on a session still in use, stays."""
    row = session(pg_dsn)
    closed = sql(pg_dsn, "SELECT turn_id FROM turns WHERE session_id = %s AND completed_at IS NOT NULL",
                 (row.session_id,))[0][0]
    sql(pg_dsn, f"INSERT INTO tool_calls (turn_id, session_id, tool_name, decision, ts) "  # noqa: S608
                f"VALUES (%s, %s, 'Read', 'allow', {OLD})", (closed, row.session_id))
    # The turn and its call are both past the period; only the session's last message is not.
    sql(pg_dsn, f"UPDATE turns SET completed_at = {OLD} WHERE turn_id = %s", (closed,))  # noqa: S608
    sql(pg_dsn, "UPDATE sessions SET updated_at = now() WHERE session_id = %s", (row.session_id,))
    before = sql(pg_dsn, "SELECT count(*) FROM tool_calls WHERE session_id = %s", (row.session_id,))[0][0]
    assert row.session_id not in run(pg_dsn)["retired"]
    assert sql(pg_dsn, "SELECT count(*) FROM tool_calls WHERE session_id = %s", (row.session_id,))[0][0] == before >= 1


class PausingCommit:
    """A sync connection whose first ``commit`` -- retention's, after its purge and while it
    holds the session's queue lock -- waits for ``go``."""

    def __init__(self, conn, inside: threading.Event, go: threading.Event) -> None:
        self._conn, self._inside, self._go, self._paused = conn, inside, go, False

    def commit(self):
        if not self._paused:
            self._paused = True
            self._inside.set()
            assert self._go.wait(WAIT_S), "never let go"
        return self._conn.commit()

    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, *exc):
        return self._conn.__exit__(*exc)

    def __getattr__(self, name):
        return getattr(self._conn, name)


async def retention_paused_inside(dsn: str):
    inside, go = threading.Event(), threading.Event()
    future = asyncio.ensure_future(asyncio.to_thread(
        worker.retention_once, connect=lambda _dsn: PausingCommit(psycopg.connect(dsn), inside, go),
        idle_s=IDLE_S))
    assert await asyncio.to_thread(inside.wait, WAIT_S), "retention never reached its commit"
    return future, go


async def test_a_message_posted_while_retention_holds_the_session_is_refused(pg_dsn):
    row = session(pg_dsn)
    idle(pg_dsn, row.session_id)
    retention, go = await retention_paused_inside(pg_dsn)
    admit = asyncio.ensure_future(PgStore(pg_dsn).admit_message(row, "hello again"))
    try:
        await ungranted_advisory(pg_dsn, grants.QUEUE_LOCK_NS, WAIT_S)
    finally:
        go.set()
    assert row.session_id in (await retention)["retired"]
    with pytest.raises(SessionRetired):
        await admit
    assert session_rows(pg_dsn, row.session_id)["turns"] == 1, "a turn was admitted on a retired session"


async def test_retention_skips_a_session_whose_message_is_being_admitted(pg_dsn):
    row = session(pg_dsn)
    idle(pg_dsn, row.session_id)
    inside, go = asyncio.Event(), asyncio.Event()

    async def pause():
        inside.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    store = PgStore(pg_dsn)
    real = store._connect

    async def connect():
        return AsyncPausingConn(await real(), "AS active", pause)

    store._connect = connect  # type: ignore[method-assign]
    admit = asyncio.ensure_future(store.admit_message(row, "go"))
    await asyncio.wait_for(inside.wait(), WAIT_S)
    try:
        passed = await asyncio.wait_for(asyncio.to_thread(run, pg_dsn), WAIT_S)
    finally:
        go.set()
    await admit
    assert row.session_id not in passed["retired"], "retention retired a session mid-admit"
    assert retired_at(pg_dsn, row.session_id) is None


async def test_a_delete_waits_for_retention_then_deletes(pg_dsn):
    row, sdk = await populated(pg_dsn)
    idle(pg_dsn, row.session_id)
    retention, go = await retention_paused_inside(pg_dsn)
    delete = asyncio.ensure_future(PgStore(pg_dsn).delete_session(row.session_id))
    try:
        await ungranted_advisory(pg_dsn, grants.QUEUE_LOCK_NS, WAIT_S)
    finally:
        go.set()
    assert row.session_id in (await retention)["retired"]
    assert await asyncio.wait_for(delete, WAIT_S) is True
    assert set(session_rows(pg_dsn, row.session_id).values()) == {0}


async def test_retention_skips_a_session_being_deleted(pg_dsn):
    row, _sdk = await populated(pg_dsn)
    idle(pg_dsn, row.session_id)
    inside, go = asyncio.Event(), asyncio.Event()

    async def pause():
        inside.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    store = PgStore(pg_dsn)
    real = store._connect

    async def connect():
        return AsyncPausingConn(await real(), "FOR UPDATE", pause)

    store._connect = connect  # type: ignore[method-assign]
    delete = asyncio.ensure_future(store.delete_session(row.session_id))
    await asyncio.wait_for(inside.wait(), WAIT_S)
    try:
        passed = await asyncio.wait_for(asyncio.to_thread(run, pg_dsn), WAIT_S)
    finally:
        go.set()
    assert row.session_id not in passed["retired"]
    assert await asyncio.wait_for(delete, WAIT_S) is True


async def test_a_session_row_another_transaction_holds_is_skipped_not_waited_on(pg_dsn):
    """A rename, an admit or a second retention pass can hold the sessions row; the pass
    moves on to the next idle session instead of waiting behind it (SKIP LOCKED)."""
    held, other = session(pg_dsn), session(pg_dsn)
    for row in (held, other):
        idle(pg_dsn, row.session_id)
    with psycopg.connect(pg_dsn) as locker:
        locker.execute("SELECT 1 FROM sessions WHERE session_id = %s FOR UPDATE", (held.session_id,))
        passed = await asyncio.wait_for(asyncio.to_thread(run, pg_dsn), WAIT_S)
        locker.rollback()
    assert held.session_id not in passed["retired"] and other.session_id in passed["retired"], passed
    assert retired_at(pg_dsn, held.session_id) is None


def test_the_try_lock_takes_the_queue_lock_s_own_key():
    """Spelled differently, the try would lock another key and exclude nothing."""
    assert grants.QUEUE_TRY_LOCK_SQL == grants.QUEUE_LOCK_SQL.replace("pg_advisory_xact_lock",
                                                                      "pg_try_advisory_xact_lock")
