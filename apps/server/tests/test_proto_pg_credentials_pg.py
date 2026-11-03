"""U29 against a real Postgres: a password rotated by ``ALTER ROLE`` is recovered through
``pg_credentials.connect`` with a fake SAS, and what psycopg reports for a real
connect-phase auth failure is pinned (no sqlstate, so ``is_auth_failure`` reads the
message). Skips without ``PROTO_TEST_PG_DSN``, fails under ``CI`` (``_proto_pg``).
"""

from __future__ import annotations

import contextlib
import os
import secrets
import uuid
from collections.abc import Iterator

import psycopg
import pytest
from psycopg import sql as pgsql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from proto import pg_credentials as pc
from tests._proto_pg import require_base_dsn


@contextlib.contextmanager
def scratch_role(base: str) -> Iterator[tuple[str, str]]:
    role, password = "u29_" + uuid.uuid4().hex[:10], "old-" + secrets.token_hex(8)
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(pgsql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
            pgsql.Identifier(role), pgsql.Literal(password)))
    try:
        yield role, password
    finally:
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(pgsql.SQL("DROP ROLE IF EXISTS {}").format(pgsql.Identifier(role)))


def fch(base: str, role: str, password: str) -> dict[str, str]:
    parts = conninfo_to_dict(base)
    host, port, db = parts.get("host", "localhost"), parts.get("port", "5432"), parts.get("dbname", "postgres")
    return {"fchUser": role, "fchPassword": password,
            "fchDbConnectUrl": f"jdbc:postgresql://{host}:{port}/{db}?ssl=true&sslmode=require"}


def require_password_auth(base: str, role: str) -> None:
    try:
        psycopg.connect(make_conninfo(base, user=role, password="wrong-" + secrets.token_hex(4)),
                        connect_timeout=5).close()
    except psycopg.OperationalError:
        return
    message = "this Postgres trusts the test host, so no password is ever checked"
    if os.environ.get("CI"):
        pytest.fail(message)
    pytest.skip(message)


def test_a_real_auth_failure_has_no_sqlstate():
    base = require_base_dsn()
    with scratch_role(base) as (role, _):
        require_password_auth(base, role)
        with pytest.raises(psycopg.OperationalError) as info:
            psycopg.connect(make_conninfo(base, user=role, password="wrong"), connect_timeout=5)
        # psycopg 3.3 raises connect failures without a sqlstate; the message is libpq's.
        assert info.value.sqlstate is None
        assert "password authentication failed" in str(info.value)
        assert pc.is_auth_failure(info.value)


def test_alter_role_rotation_recovers_through_connect():
    base = require_base_dsn()
    with scratch_role(base) as (role, old):
        require_password_auth(base, role)
        new = "new-" + secrets.token_hex(8)
        published = {"object": fch(base, role, old)}
        fetches: list[str] = []

        def fetch(name):
            fetches.append(name)
            return published["object"]

        creds = pc.PgCredentials(mode="sas", sas_object="fch-db", fetch=fetch, min_interval_s=0)

        def connector(dsn, **kw):
            return psycopg.connect(dsn, **kw)

        with pc.connect(creds, connector, connect_timeout=5) as conn:
            assert conn.execute("SELECT current_user").fetchone()[0] == role
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(pgsql.SQL("ALTER ROLE {} PASSWORD {}").format(
                pgsql.Identifier(role), pgsql.Literal(new)))
        published["object"] = fch(base, role, new)
        with pc.connect(creds, connector, connect_timeout=5) as conn:
            assert conn.execute("SELECT current_user").fetchone()[0] == role
        assert fetches == ["fch-db", "fch-db"]
        assert new in conninfo_to_dict(creds.cached())["password"]
