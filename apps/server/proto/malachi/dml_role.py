"""The DML-only role web and tools connect as, run after ``migrate.py`` in the ``migrate``
one-shot. The owner's DSN comes from ``MIGRATE_PG_DSN`` and the role's password from
``DML_PASSWORD``, never argv.

Reads the tables from ``pg_tables`` rather than a list, so each deploy re-grants whatever a
new migration added. Never ``ON ALL TABLES``: that would cover the ledger, which the role
only reads. ``migrate.py`` grants that read to PUBLIC, but a restore with ``--no-acl`` drops
it, so it is granted here too. Safe to run again.
"""

from __future__ import annotations

import os
import sys

import psycopg
from psycopg import sql

ROLE = "genealogy_dml"
LEDGER = "schema_migrations"
TABLES_SQL = "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> %s ORDER BY tablename"


def apply(conn: psycopg.Connection, password: str) -> list[str]:
    """Create or update the role and grant it DML on every table but the ledger. Returns the
    tables granted. The caller commits."""
    role = sql.Identifier(ROLE)
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (ROLE,)).fetchone()
    verb = "ALTER" if exists else "CREATE"
    conn.execute(sql.SQL(verb + " ROLE {} LOGIN PASSWORD {}").format(role, sql.Literal(password)))
    tables = [row[0] for row in conn.execute(TABLES_SQL, (LEDGER,)).fetchall()]
    if tables:
        names = sql.SQL(", ").join(sql.Identifier(t) for t in tables)
        conn.execute(sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON {} TO {}").format(names, role))
    conn.execute(sql.SQL("GRANT SELECT ON {} TO {}").format(sql.Identifier(LEDGER), role))
    conn.execute(sql.SQL("GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {}").format(role))
    return tables


def main() -> int:
    dsn = os.environ.get("MIGRATE_PG_DSN", "")
    password = os.environ.get("DML_PASSWORD", "")
    if not dsn or not password:
        print("dml_role: MIGRATE_PG_DSN and DML_PASSWORD are required", file=sys.stderr)
        return 2
    with psycopg.connect(dsn) as conn:
        tables = apply(conn, password)
    print(f"ev=dml_role role={ROLE} tables={len(tables)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
