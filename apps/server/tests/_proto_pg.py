"""What the real-Postgres prototype suites share (test_proto_grants_pg.py, test_proto_migrate_pg.py,
test_proto_queue_pg.py, test_proto_fencing_pg.py, test_proto_session_store_pg.py).

Each test or module gets a database of its own, created from ``PROTO_TEST_PG_DSN`` and
dropped ``WITH (FORCE)`` at teardown, with the schema applied the way every deploy applies
it -- through ``migrate.migrate``. Without the DSN a suite skips, except under ``CI``,
where it fails, so a job cannot pass by skipping. ``make proto-grants-test`` runs both
suites against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import secrets
import sys
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg import sql as pgsql
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from proto import migrate

PROTO = Path(__file__).resolve().parents[1] / "proto"

BASE_DSN = os.environ.get("PROTO_TEST_PG_DSN", "")


def require_base_dsn() -> str:
    if not BASE_DSN:
        if os.environ.get("CI"):
            pytest.fail("CI is set but PROTO_TEST_PG_DSN is not: the real-Postgres tests must run, not skip")
        pytest.skip("PROTO_TEST_PG_DSN unset; `make proto-grants-test` runs these against the compose Postgres")
    return BASE_DSN


@contextlib.contextmanager
def database(apply: bool = True, *, prefix: str = "pg_") -> Iterator[str]:
    """A scratch database's DSN; with ``apply``, migrated to this build's files."""
    base = require_base_dsn()
    name = prefix + uuid.uuid4().hex[:12]
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')
    dsn = make_conninfo(base, dbname=name)
    try:
        if apply:
            migrate.migrate(dsn)
        yield dsn
    finally:
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def sql(dsn: str, statement: str, params: tuple = ()) -> list[tuple]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        cur = conn.execute(statement, params)
        return cur.fetchall() if cur.description else []


def session(dsn: str, *, running: bool = False, held: tuple[str, ...] = ()):
    """A fresh session with one completed turn, optionally a running one, and ``held``
    messages queued oldest-first. A ``web.app.SessionRow``."""
    if str(PROTO) not in sys.path:
        sys.path.insert(0, str(PROTO))
    from web.app import SessionRow

    sid, pid = "sess_" + uuid.uuid4().hex[:10], "proj_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO sessions (session_id, project_id) VALUES (%s, %s)", (sid, pid))
    turn(dsn, sid, pid, "done", completed=True, outcome="ok")
    if running:
        turn(dsn, sid, pid, "running")
    for text in held:
        turn(dsn, sid, pid, text, outcome="queued")
    now = datetime.now(tz=timezone.utc)
    return SessionRow(sid, pid, "t", "m", now, now)


def turn(dsn: str, sid: str, pid: str, text: str, *, completed: bool = False, outcome: str | None = None) -> str:
    """``enqueued_at`` from this host's clock, as the web tier stamps it: the oldest-first
    claim compares it with the web tier's own stamps, and the database's clock can differ."""
    turn_id = "turn_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at, completed_at, outcome) "
             "VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, %s)",
        (turn_id, sid, pid, Jsonb({"turn_id": turn_id, "session_id": sid, "project_id": pid, "text": text}),
         datetime.now(tz=timezone.utc), completed, outcome))
    return turn_id


# A session's transcript paths as the worker writes them: the main thread, a subagent, and
# a workflow's nested agent (claude_agent_sdk's file_path_to_session_key).
SUBPATHS = ("", "subagents/agent-x", "subagents/workflows/r1/agent-y")


def assistant(tokens: int) -> dict:
    """An assistant transcript entry carrying usage, so the spend meter prices it."""
    return {"type": "assistant", "uuid": uuid.uuid4().hex,
            "message": {"id": "msg_" + uuid.uuid4().hex,
                        "usage": {"input_tokens": tokens, "output_tokens": tokens}}}


async def populated(dsn: str, *, project_id: str | None = None):
    """``session()`` plus everything a purge must reach: an SDK session id and a transcript
    at every SUBPATH, written through the worker's own PgSessionStore; an event, the seq
    and activity rows and a tool call; and the project's document, blob, staging and
    projects rows. On ``project_id`` when given, else a fresh project. ``(row, sdk_id)``."""
    from proto.worker.session_store import PgSessionStore
    from web.app import SessionRow

    row = session(dsn)
    if project_id is not None:
        sql(dsn, "UPDATE sessions SET project_id = %s WHERE session_id = %s", (project_id, row.session_id))
        sql(dsn, "UPDATE turns SET project_id = %s WHERE session_id = %s", (project_id, row.session_id))
        row = SessionRow(row.session_id, project_id, row.title, row.model, row.created_at, row.updated_at)
    sdk = str(uuid.uuid4())
    sql(dsn, "UPDATE sessions SET sdk_session_id = %s WHERE session_id = %s", (sdk, row.session_id))
    store = PgSessionStore(dsn, row.project_id)
    for subpath in SUBPATHS:
        key = {"project_key": "-project", "session_id": sdk, **({"subpath": subpath} if subpath else {})}
        await store.append(key, [assistant(1000)])
    for statement in (
        "INSERT INTO session_events (session_id, seq, kind) VALUES (%s, 1, 'turn_done')",
        "INSERT INTO session_seq (session_id, last) VALUES (%s, 1)",
        "INSERT INTO session_activity (session_id, payload) VALUES (%s, '{}')",
        "INSERT INTO tool_calls (turn_id, session_id, tool_name, decision) VALUES ('t', %s, 'Read', 'allow')",
    ):
        sql(dsn, statement, (row.session_id,))
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
    """The subpaths holding a transcript row for SDK session ``sdk``, sorted."""
    return [r[0] for r in sql(dsn, "SELECT subpath FROM session_entries WHERE session_id = %s ORDER BY subpath",
                              (sdk,))]


def session_rows(dsn: str, session_id: str) -> dict[str, int]:
    """Row counts per table keyed by the web session id (proto.grants.SESSION_TABLES + sessions)."""
    from proto import grants

    return {t: sql(dsn, f"SELECT count(*) FROM {t} WHERE session_id = %s", (session_id,))[0][0]  # noqa: S608
            for t in (*grants.SESSION_TABLES, "sessions")}


def project_rows(dsn: str, project_id: str) -> dict[str, int]:
    return {t: sql(dsn, f"SELECT count(*) FROM {t} WHERE project_id = %s", (project_id,))[0][0]  # noqa: S608
            for t in ("documents", "blobs", "staging", "projects")}


async def ungranted_advisory(dsn: str, classid: int | None = None, timeout_s: float = 10.0) -> None:
    """Return once some backend is WAITING on an advisory lock -- one in namespace
    ``classid`` (a two-int4 key's first half) when given; fail at the deadline."""
    statement = ("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted "
                 "AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) "
                 "AND (%s::int8 IS NULL OR classid::int8 = %s::int8)")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        found = await asyncio.to_thread(sql, dsn, statement, (classid, classid))
        if found[0][0]:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("nothing waited on an advisory lock")


class AsyncPausingConn:
    """A proxy over the web tier's AsyncConnection that awaits ``pause`` once, just before
    the first statement containing ``marker`` -- so a test can hold one tier inside a
    transaction while another runs into it."""

    def __init__(self, conn, marker: str, pause) -> None:
        self._conn, self._marker, self._pause = conn, marker, pause

    async def __aenter__(self):
        await self._conn.__aenter__()
        return self

    async def __aexit__(self, *exc):
        return await self._conn.__aexit__(*exc)

    async def execute(self, statement, params=None):
        if self._pause is not None and self._marker in statement:
            pause, self._pause = self._pause, None
            await pause()
        return await self._conn.execute(statement, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


@contextlib.contextmanager
def dml_role(dsn: str) -> Iterator[tuple[str, str]]:
    """A LOGIN role holding only what the services need -- DML on every table either tier
    queries, sequences, the seq function -- and nothing on the ledger beyond PUBLIC's
    SELECT. ``(role, dsn)``. Roles are cluster-wide, so teardown drops it."""
    if str(PROTO) not in sys.path:
        sys.path.insert(0, str(PROTO))
    from proto.worker import worker
    from web import app

    role = "u9_dml_" + uuid.uuid4().hex[:10]
    password = secrets.token_hex(16)
    tables = sorted(set(app.WEB_TABLES) | set(worker.WORKER_TABLES))
    with psycopg.connect(dsn, autocommit=True) as owner:
        # Never ON ALL TABLES: that would cover the ledger too.
        owner.execute(pgsql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
            pgsql.Identifier(role), pgsql.Literal(password)))
        try:
            for table in tables:
                owner.execute(pgsql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON {} TO {}").format(
                    pgsql.Identifier(table), pgsql.Identifier(role)))
            owner.execute(pgsql.SQL("GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {}").format(
                pgsql.Identifier(role)))
            owner.execute(pgsql.SQL("GRANT EXECUTE ON FUNCTION next_session_seq(text) TO {}").format(
                pgsql.Identifier(role)))
            yield role, make_conninfo(dsn, user=role, password=password)
        finally:
            owner.execute(pgsql.SQL("DROP OWNED BY {}").format(pgsql.Identifier(role)))
            owner.execute(pgsql.SQL("DROP ROLE {}").format(pgsql.Identifier(role)))
