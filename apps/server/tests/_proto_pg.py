"""What the real-Postgres prototype suites share (test_proto_grants_pg.py, test_proto_migrate_pg.py).

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
from pathlib import Path

import psycopg
import pytest
from psycopg import sql as pgsql
from psycopg.conninfo import make_conninfo

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
