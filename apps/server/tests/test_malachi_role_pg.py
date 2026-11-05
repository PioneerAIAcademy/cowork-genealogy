"""The malachi stack's DML-only role on a real Postgres: what it can write, what it cannot.

Skips without ``PROTO_TEST_PG_DSN`` and fails under CI without it (``_proto_pg``).
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from psycopg.conninfo import make_conninfo

from tests import _proto_pg

PROTO = Path(__file__).resolve().parents[1] / "proto"
sys.path.insert(0, str(PROTO))
sys.path.insert(0, str(PROTO / "malachi"))

import dml_role  # noqa: E402
import openrouter_seed  # noqa: E402
from web import auth  # noqa: E402

PASSWORD = "dml-role-test-password"


@pytest.fixture
def owner_dsn() -> Iterator[str]:
    with _proto_pg.database(prefix="malachi_") as dsn:
        try:
            yield dsn
        finally:
            with psycopg.connect(dsn, autocommit=True) as conn:
                if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (dml_role.ROLE,)).fetchone():
                    conn.execute(f"DROP OWNED BY {dml_role.ROLE}")
                    conn.execute(f"DROP ROLE {dml_role.ROLE}")


def _apply(dsn: str, password: str = PASSWORD) -> list[str]:
    with psycopg.connect(dsn) as conn:
        return dml_role.apply(conn, password)


def _as_role(dsn: str, password: str = PASSWORD) -> str:
    return make_conninfo(dsn, user=dml_role.ROLE, password=password)


def test_the_role_writes_the_tables_the_tiers_write(owner_dsn):
    _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        conn.execute("INSERT INTO users (id, email) VALUES ('u1', 'a@example.test')")
        conn.execute("INSERT INTO documents (project_id, name, doc) VALUES ('p1', 'research.json', '{}')")
        conn.execute("UPDATE documents SET version = 2 WHERE project_id = 'p1'")
        conn.execute("INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) "
                     "VALUES ('h', 'u1', 'c', '{}', now())")
        conn.execute("UPDATE connector_tokens SET ended_at = now()")
        conn.execute("DELETE FROM connector_tokens")
        conn.execute("DELETE FROM documents")
        assert conn.execute("SELECT next_session_seq('s1')").fetchone()[0] == 1


def test_the_role_reads_the_ledger_and_cannot_write_it(owner_dsn):
    _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] > 0
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute("UPDATE schema_migrations SET sha256 = 'x'")
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute("DELETE FROM schema_migrations")


@pytest.mark.parametrize("statement", [
    "CREATE TABLE intruder (i int)",
    "DROP TABLE documents",
    "ALTER TABLE documents ADD COLUMN intruder int",
    "TRUNCATE documents",
])
def test_the_role_cannot_run_ddl(owner_dsn, statement):
    _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(statement)


def test_a_re_run_covers_a_table_added_since(owner_dsn):
    _apply(owner_dsn)
    _proto_pg.sql(owner_dsn, "CREATE TABLE added_later (id serial PRIMARY KEY, v text)")
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute("INSERT INTO added_later (v) VALUES ('x')")
    assert "added_later" in _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        conn.execute("INSERT INTO added_later (v) VALUES ('x')")


def test_a_second_run_changes_nothing(owner_dsn):
    assert _apply(owner_dsn) == _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        assert conn.execute("SELECT 1 FROM documents LIMIT 1").fetchall() == []


def test_a_new_password_replaces_the_old_one(owner_dsn):
    _apply(owner_dsn)
    _apply(owner_dsn, "rotated-password")
    with psycopg.connect(_as_role(owner_dsn, "rotated-password"), autocommit=True) as conn:
        assert conn.execute("SELECT 1").fetchone() == (1,)


def test_the_ledger_read_survives_a_restore_with_no_acl(owner_dsn):
    """A ``--no-acl`` restore drops ``migrate.py``'s grant to PUBLIC; the tiers read the ledger
    at start, so the role's own grant must bring it back."""
    _proto_pg.sql(owner_dsn, "REVOKE SELECT ON schema_migrations FROM PUBLIC")
    _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] > 0


def test_the_seed_writes_ciphertext_through_the_role(owner_dsn, monkeypatch):
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    _apply(owner_dsn)
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        conn.execute("INSERT INTO users (id, email) VALUES ('u1', 'a@example.test')")
    assert openrouter_seed.seed(_as_role(owner_dsn), "A@Example.test", "sk-or-secret") is True
    assert openrouter_seed.seed(_as_role(owner_dsn), "nobody@example.test", "sk-or-secret") is False
    with psycopg.connect(_as_role(owner_dsn), autocommit=True) as conn:
        stored = conn.execute("SELECT openrouter_key_enc FROM users WHERE id = 'u1'").fetchone()[0]
    assert stored.startswith("gAAAAA") and "sk-or-secret" not in stored
    assert auth.decrypt(stored) == "sk-or-secret"
