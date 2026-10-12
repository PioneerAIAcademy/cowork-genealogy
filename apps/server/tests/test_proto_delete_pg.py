"""U19: ``PgStore.delete_session`` against REAL Postgres (docs/plan/familysearch-handoff.md, U19).

The SDK transcript is keyed by ``sessions.sdk_session_id`` (004), not the web session id,
and a subagent's entries share it under a ``subagents/...`` subpath. The delete used to
match the web id only, so every transcript row -- what the spend meter sums -- survived it.
The transcript here is written through the worker's own ``PgSessionStore``, so this cannot
drift from what the worker stores. The delete runs as a role holding only the services'
grants, so a table it touches that no tier grants fails here rather than on a deploy.

A delete is refused while a turn is running (``SessionBusy``): the attempt's unfenced
writes would otherwise recreate rows for a session that no longer exists.

Without the DSN the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import asyncio
import sys
import uuid

import psycopg
import pytest

from proto import grants
from proto.worker import worker
from proto.worker.session_store import PgSessionStore
from tests._proto_pg import PROTO, AsyncPausingConn, database, dml_role, session, sql, ungranted_advisory

sys.path.insert(0, str(PROTO))

import web.app as web_app  # noqa: E402
from web.app import PgStore, SessionBusy  # noqa: E402

SUBPATHS = ("", "subagents/agent-x", "subagents/workflows/r1/agent-y")
WAIT_S = 10.0


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u19d_") as dsn:
        yield dsn


@pytest.fixture(scope="module")
def role_dsn(pg_dsn):
    with dml_role(pg_dsn) as (_role, dsn):
        yield dsn


def assistant(tokens: int) -> dict:
    return {"type": "assistant", "uuid": uuid.uuid4().hex,
            "message": {"id": "msg_" + uuid.uuid4().hex,
                        "usage": {"input_tokens": tokens, "output_tokens": tokens}}}


async def populated(dsn: str, *, project_id: str | None = None):
    """A session on ``project_id`` (a fresh one when None) with a transcript at every
    subpath, an event, a tool call, and the project's document, blob and staging rows."""
    row = session(dsn)
    if project_id is not None:
        sql(dsn, "UPDATE sessions SET project_id = %s WHERE session_id = %s", (project_id, row.session_id))
        sql(dsn, "UPDATE turns SET project_id = %s WHERE session_id = %s", (project_id, row.session_id))
        row = web_app.SessionRow(row.session_id, project_id, row.title, row.model, row.created_at, row.updated_at)
    sdk = str(uuid.uuid4())
    sql(dsn, "UPDATE sessions SET sdk_session_id = %s WHERE session_id = %s", (sdk, row.session_id))
    store = PgSessionStore(dsn, row.project_id)
    for subpath in SUBPATHS:
        key = {"project_key": "-project", "session_id": sdk, **({"subpath": subpath} if subpath else {})}
        await store.append(key, [assistant(1000)])
    sql(dsn, "INSERT INTO session_events (session_id, seq, kind) VALUES (%s, 1, 'turn_done')", (row.session_id,))
    sql(dsn, "INSERT INTO tool_calls (turn_id, session_id, tool_name, decision) VALUES ('t', %s, 'Read', 'allow')",
        (row.session_id,))
    for statement in (
        "INSERT INTO documents (project_id, name, doc) VALUES (%s, 'research.json', '{}') ON CONFLICT DO NOTHING",
        "INSERT INTO blobs (project_id, key, s3_key, bytes, sha256) VALUES (%s, 'images/a', 'k', 1, 'h') "
        "ON CONFLICT DO NOTHING",
        "INSERT INTO staging (project_id, staging_id, s3_key) VALUES (%s, 's1', 'k') ON CONFLICT DO NOTHING",
        "INSERT INTO projects (project_id) VALUES (%s) ON CONFLICT DO NOTHING",
    ):
        sql(dsn, statement, (row.project_id,))
    return row, sdk


def transcript(dsn: str, sdk: str) -> list[str]:
    return [r[0] for r in sql(dsn, "SELECT subpath FROM session_entries WHERE session_id = %s ORDER BY subpath", (sdk,))]


def spend(dsn: str, sdk: str) -> float:
    with psycopg.connect(dsn) as conn:
        return worker.session_spend_usd(conn, sdk)


def project_rows(dsn: str, project_id: str) -> dict[str, int]:
    return {t: sql(dsn, f"SELECT count(*) FROM {t} WHERE project_id = %s", (project_id,))[0][0]  # noqa: S608
            for t in ("documents", "blobs", "staging", "projects")}


def session_rows(dsn: str, session_id: str) -> dict[str, int]:
    return {t: sql(dsn, f"SELECT count(*) FROM {t} WHERE session_id = %s", (session_id,))[0][0]  # noqa: S608
            for t in (*web_app.SESSION_TABLES, "sessions")}


async def test_delete_removes_the_sdk_transcript_at_every_subpath_and_keeps_the_sibling(pg_dsn, role_dsn):
    pid = "proj_" + uuid.uuid4().hex[:10]
    a, sdk_a = await populated(pg_dsn, project_id=pid)
    b, sdk_b = await populated(pg_dsn, project_id=pid)
    c, sdk_c = await populated(pg_dsn)
    assert transcript(pg_dsn, sdk_a) == sorted(SUBPATHS) and spend(pg_dsn, sdk_a) > 0

    assert await PgStore(role_dsn).delete_session(a.session_id) is True
    assert transcript(pg_dsn, sdk_a) == [], "the SDK transcript survived the delete"
    assert spend(pg_dsn, sdk_a) == 0
    assert set(session_rows(pg_dsn, a.session_id).values()) == {0}, session_rows(pg_dsn, a.session_id)
    assert transcript(pg_dsn, sdk_b) == sorted(SUBPATHS), "a sibling session's transcript went too"
    assert set(project_rows(pg_dsn, pid).values()) == {1}, "the project went with a session that was not its last"

    assert await PgStore(role_dsn).delete_session(b.session_id) is True
    assert transcript(pg_dsn, sdk_b) == []
    assert set(project_rows(pg_dsn, pid).values()) == {0}, project_rows(pg_dsn, pid)
    assert transcript(pg_dsn, sdk_c) == sorted(SUBPATHS) and set(project_rows(pg_dsn, c.project_id).values()) == {1}


async def test_a_session_the_worker_never_started_deletes(pg_dsn, role_dsn):
    row = session(pg_dsn)
    assert await PgStore(role_dsn).delete_session(row.session_id) is True
    assert set(session_rows(pg_dsn, row.session_id).values()) == {0}
    assert await PgStore(role_dsn).delete_session(row.session_id) is False


async def test_a_running_turn_refuses_the_delete_and_keeps_every_row(pg_dsn, role_dsn):
    row, sdk = await populated(pg_dsn)
    sql(pg_dsn, "INSERT INTO turns (turn_id, session_id, project_id, message) VALUES (%s, %s, %s, '{}')",
        ("turn_" + uuid.uuid4().hex[:10], row.session_id, row.project_id))
    before = session_rows(pg_dsn, row.session_id)
    with pytest.raises(SessionBusy):
        await PgStore(role_dsn).delete_session(row.session_id)
    assert session_rows(pg_dsn, row.session_id) == before
    assert transcript(pg_dsn, sdk) == sorted(SUBPATHS)


async def test_a_held_message_alone_does_not_block_the_delete(pg_dsn, role_dsn):
    row = session(pg_dsn, held=("later",))
    assert await PgStore(role_dsn).delete_session(row.session_id) is True
    assert set(session_rows(pg_dsn, row.session_id).values()) == {0}


async def test_a_message_admitted_first_wins_and_the_delete_waits_then_refuses(pg_dsn):
    """The delete takes the session's queue lock, so it cannot slip between admit_message's
    check and its insert: it waits, then sees the admitted turn running and refuses."""
    row = session(pg_dsn)
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
    delete = asyncio.ensure_future(PgStore(pg_dsn).delete_session(row.session_id))
    try:
        await ungranted_advisory(pg_dsn, grants.QUEUE_LOCK_NS, WAIT_S)
    finally:
        go.set()
    await admit
    with pytest.raises(SessionBusy):
        await delete
    assert session_rows(pg_dsn, row.session_id)["sessions"] == 1


def test_every_table_with_a_session_id_column_is_one_the_delete_clears(pg_dsn):
    """A per-session table added later and missed by delete_session leaves its rows
    behind every delete. Keyed differently: session_entries (the SDK id) and sessions."""
    cleared = set(web_app.SESSION_TABLES) | {"session_entries", "sessions"}
    found = {r[0] for r in sql(pg_dsn, "SELECT table_name FROM information_schema.columns "
                                       "WHERE table_schema = 'public' AND column_name = 'session_id'")}
    missed = sorted(found - cleared)
    assert not missed, f"delete_session clears no rows from: {', '.join(missed)}"
    assert cleared <= found, f"SESSION_TABLES names a table with no session_id column: {sorted(cleared - found)}"
