"""The schema migrations runner (U9; docs/plan/familysearch-handoff.md, U9 and step 6).

The ONLY thing that runs DDL against the prototype's Postgres. It keeps a ledger,
``schema_migrations(name, sha256, applied_at)``, and runs each ``sql/NNN_*.sql`` this
build ships and the ledger lacks, in name order, each in a transaction of its own that
also records it. The web tier and the worker never apply the schema: they read the
ledger, compare it with the files they ship (``verdict``) and report ``schema`` failing
until someone runs this. Both images and both bundles copy it beside ``sql/`` (the web
image as ``/app/migrate.py``, imported as ``migrate``; the worker as ``proto/migrate.py``,
imported as ``proto.migrate``). Stdlib and psycopg only.

  python migrate.py [--status]          (web layout: /app, or the unzipped web bundle)
  python proto/migrate.py [--status]    (worker layout, or apps/server in a checkout)

The DSN comes from ``MIGRATE_PG_DSN`` and nowhere else -- never ``PG_DSN``, so a
service's DML-only DSN is never used for DDL by accident. ``--status`` runs no DDL.
Exit 0 current (or migrated), 1 an SQL error, a refusal or retries exhausted, 2 no DSN
or no usable files, 3 ``--status`` found the database not current.

Runners serialise on ``pg_advisory_xact_lock(MIGRATE_LOCK_NS, 0)``, taken afresh in
every transaction and re-checked under it, so simultaneous runners queue rather than
race; the two-int4 form keeps it out of the engine's single-bigint key space, and
``grants.py`` holds the other namespaces (30301, 30302). A current database takes the
fast path: one ledger read, no lock, no DDL. A file whose digest differs from its ledger
row (a statement edit, not a comment edit) and a pending file that sorts below the
ledger's highest name are refused before the lock: shipped files are frozen, and new
schema work is a new, higher-numbered file.

An unledgered database (one every pre-U9 start applied) is baselined by re-running every
file once, not by marking them applied: 004 changed after it shipped, so "004 applied"
names no single schema state, and every file is idempotent because every pre-U9 start
re-ran it.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NamedTuple

import psycopg
from psycopg import errors

SQL_DIR = Path(__file__).resolve().parent / "sql"

MIGRATE_LOCK_NS = 30300
LOCK_SQL = "SELECT pg_advisory_xact_lock(%s::int4, %s::int4)"
NAME_RE = re.compile(r"^\d{3}_[a-z0-9_]+\.sql$")

# In this module, not sql/: the ledger is the runner's, and the tiers' table tuples and
# the config tests' CREATE TABLE scan stay what the files declare. Readable by every role,
# so a DML-only service DSN can verify the schema; it holds file names and digests only.
LEDGER_DDL = (
    "CREATE TABLE IF NOT EXISTS schema_migrations ("
    "name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); "
    "GRANT SELECT ON schema_migrations TO PUBLIC;"
)
LEDGER_EXISTS_SQL = "SELECT to_regclass('schema_migrations') IS NOT NULL"
LEDGER_SELECT_SQL = "SELECT name, sha256 FROM schema_migrations"
LEDGER_INSERT_SQL = "INSERT INTO schema_migrations (name, sha256) VALUES (%s, %s)"

DEFAULT_LOCK_WAIT_S = 300
DEFAULT_LOCK_TIMEOUT_S = 5
DEFAULT_CONNECT_TIMEOUT_S = 10
DEFAULT_ATTEMPTS = 5
BACKOFF_S = (1, 2, 4, 8)
APPLICATION_NAME = "genealogy-migrate"
# What a pre-U9 instance, still applying every file at its start, can make a baseline run
# raise: 23505 and 42P07/42710 on a fresh database, XX000 "tuple concurrently updated" on
# an applied one. Retried on a baseline run only; after it the lock is the whole story.
RACE_ERRORS = (errors.UniqueViolation, errors.InternalError_, errors.DuplicateTable, errors.DuplicateObject)

_DSN_CREDENTIALS = re.compile(r"\b[\w.+-]+://[^\s@/]*@")
# The retry backoff's sleep, a seam so a test can fail on, or record, a retry.
_sleep = time.sleep


class MigrateConfigError(Exception):
    """The shipped files are unusable: none, a malformed name, or a repeated prefix."""


class MigrateRefused(Exception):
    """The ledger disagrees with the shipped files in a way no run may fix."""

    def __init__(self, label: str) -> None:
        super().__init__(label)
        self.label = label


class Migration(NamedTuple):
    name: str
    text: str
    digest: str


@dataclass(frozen=True)
class Verdict:
    pending: list[str] = field(default_factory=list)
    ahead: list[str] = field(default_factory=list)
    label: str | None = None

    @property
    def refused(self) -> bool:
        return self.label is not None and self.label.startswith(("schema: drift ", "schema: out_of_order "))


def digest(text: str) -> str:
    """sha256 of the file with ``--`` line comments stripped and whitespace collapsed -- the
    rule of test_proto_config's ``_statements`` -- so a comment edit or a reflowed
    statement keeps its digest and a statement edit does not."""
    body = "\n".join(re.sub(r"--.*$", "", line) for line in text.splitlines())
    return hashlib.sha256(re.sub(r"\s+", " ", body).strip().encode("utf-8")).hexdigest()


def load(sql_dir: Path = SQL_DIR) -> list[Migration]:
    """Every ``*.sql`` under ``sql_dir``, sorted by name."""
    paths = sorted(Path(sql_dir).glob("*.sql"))
    if not paths:
        raise MigrateConfigError(f"no schema files under {sql_dir}")
    seen: dict[str, str] = {}
    files: list[Migration] = []
    for path in paths:
        if not NAME_RE.match(path.name):
            raise MigrateConfigError(f"{path.name}: a schema file is named NNN_lower_snake.sql")
        prefix = path.name[:3]
        if prefix in seen:
            raise MigrateConfigError(f"{path.name} repeats the prefix of {seen[prefix]}")
        seen[prefix] = path.name
        text = path.read_text(encoding="utf-8")
        files.append(Migration(path.name, text, digest(text)))
    return files


def verdict(shipped: list[Migration], ledger: dict[str, str] | None) -> Verdict:
    """The ledger against this build's files. No ledger is ``unmigrated``; then, in this
    order, a shipped file whose ledger digest differs is ``drift``, a pending file sorting
    below the ledger's highest name is ``out_of_order``, and any other pending file makes
    it ``behind`` the first. Ledger rows this build does not ship are ``ahead`` and fine:
    an old build stays healthy on a newer schema."""
    names = [m.name for m in shipped]
    if ledger is None:
        return Verdict(pending=names, label="schema: unmigrated")
    shipped_names = set(names)
    ahead = sorted(name for name in ledger if name not in shipped_names)
    pending = [m.name for m in shipped if m.name not in ledger]
    for m in shipped:
        if m.name in ledger and ledger[m.name] != m.digest:
            return Verdict(pending, ahead, f"schema: drift {m.name}")
    highest = max(ledger, default=None)
    for name in pending:
        if highest is not None and name < highest:
            return Verdict(pending, ahead, f"schema: out_of_order {name}")
    if pending:
        return Verdict(pending, ahead, f"schema: behind {pending[0]}")
    return Verdict(pending, ahead, None)


def ledger_from_rows(exists: bool, rows: list[Any]) -> dict[str, str] | None:
    """``{name: sha256}`` from ``LEDGER_SELECT_SQL``'s positional rows; None when
    ``LEDGER_EXISTS_SQL`` found no table."""
    if not exists:
        return None
    return {str(row[0]): str(row[1]) for row in rows}


def read_ledger(conn: psycopg.Connection) -> dict[str, str] | None:
    exists = bool(conn.execute(LEDGER_EXISTS_SQL).fetchone()[0])
    return ledger_from_rows(exists, conn.execute(LEDGER_SELECT_SQL).fetchall() if exists else [])


def _ms(seconds: float) -> str:
    return f"{int(seconds * 1000)}ms"


def _lock(conn: psycopg.Connection, lock_wait_s: float) -> None:
    # statement_timeout first, so a role-level timeout cannot cut the advisory wait;
    # lock_timeout bounds it, an advisory lock being a heavyweight lock.
    conn.execute("SET LOCAL statement_timeout = 0")
    conn.execute(f"SET LOCAL lock_timeout = '{_ms(lock_wait_s)}'")
    conn.execute(LOCK_SQL, (MIGRATE_LOCK_NS, 0))


def migrate_on(
    conn: psycopg.Connection, *, sql_dir: Path = SQL_DIR, lock_wait_s: float = DEFAULT_LOCK_WAIT_S,
    lock_timeout_s: float = DEFAULT_LOCK_TIMEOUT_S,
    on_ledger: Callable[[dict[str, str] | None], None] | None = None,
) -> list[str]:
    """One attempt on the caller's connection (autocommit off, READ COMMITTED; never closed
    here): under a snapshot isolation the re-check under the lock reads the snapshot taken
    before the wait and misses the file another runner just committed. Returns
    the files this attempt applied. Every path ends in a commit or a rollback, so the
    connection is left idle with no lock and no setting changed. ``on_ledger`` gets the
    first ledger read, before anything else happens."""
    if conn.autocommit:
        raise ValueError("migrate_on needs a connection with autocommit off")
    if conn.isolation_level is not psycopg.IsolationLevel.READ_COMMITTED:
        raise ValueError("migrate_on needs a connection with isolation_level READ_COMMITTED")
    shipped = load(sql_dir)
    by_name = {m.name: m for m in shipped}
    applied: list[str] = []
    try:
        ledger = read_ledger(conn)
        if on_ledger is not None:
            on_ledger(ledger)
        first = verdict(shipped, ledger)
        if first.refused:
            conn.rollback()
            raise MigrateRefused(first.label)
        if first.label is None:
            conn.rollback()
            return []
        conn.rollback()
        _lock(conn, lock_wait_s)
        conn.execute(LEDGER_DDL)
        conn.commit()
        for name in first.pending:
            _lock(conn, lock_wait_s)
            # A queued ACCESS EXCLUSIVE gives up rather than stall live readers behind it.
            conn.execute(f"SET LOCAL lock_timeout = '{_ms(lock_timeout_s)}'")
            now = verdict(shipped, read_ledger(conn))
            if now.refused:
                conn.rollback()
                raise MigrateRefused(now.label)
            if name not in now.pending:
                conn.rollback()  # another runner applied it while this one waited
                continue
            conn.execute(by_name[name].text)  # no parameters: the simple protocol keeps 002's $$
            conn.execute(LEDGER_INSERT_SQL, (name, by_name[name].digest))
            conn.commit()
            applied.append(name)
        return applied
    except BaseException:
        try:
            conn.rollback()
        except psycopg.Error:
            pass  # a broken connection has nothing left to roll back
        raise


def migrate(
    dsn: str, *, sql_dir: Path = SQL_DIR, lock_wait_s: float = DEFAULT_LOCK_WAIT_S,
    lock_timeout_s: float = DEFAULT_LOCK_TIMEOUT_S, connect_timeout: int = DEFAULT_CONNECT_TIMEOUT_S,
    attempts: int = DEFAULT_ATTEMPTS,
) -> list[str]:
    """``migrate_on`` on a connection of its own per attempt, retrying
    ``psycopg.OperationalError`` (a refused or lost connection, 55P03 lock-not-available,
    40P01 deadlock) with backoff ``BACKOFF_S``. ``RACE_ERRORS`` are retried only when the
    call's first successful ledger read found no ledger or an empty one (a baseline run,
    the one window where a pre-U9 instance can still be applying at its start). That is
    decided once per call: attempt 1's ledger setup makes a later attempt read ``{}``."""
    baseline: list[bool] = []

    def on_ledger(ledger: dict[str, str] | None) -> None:
        if not baseline:
            baseline.append(ledger is None or ledger == {})

    for attempt in range(1, attempts + 1):
        try:
            conn = psycopg.connect(dsn, connect_timeout=connect_timeout, prepare_threshold=None,
                                   application_name=APPLICATION_NAME)
            # Whatever default_transaction_isolation the role or database sets.
            conn.isolation_level = psycopg.IsolationLevel.READ_COMMITTED
            try:
                return migrate_on(conn, sql_dir=sql_dir, lock_wait_s=lock_wait_s,
                                  lock_timeout_s=lock_timeout_s, on_ledger=on_ledger)
            finally:
                conn.close()
        except psycopg.OperationalError:
            if attempt >= attempts:
                raise
        except RACE_ERRORS:
            if attempt >= attempts or not (baseline and baseline[0]):
                raise
        _sleep(BACKOFF_S[min(attempt, len(BACKOFF_S)) - 1])
    raise ValueError(f"attempts must be at least 1, not {attempts}")


def redact(text: str, dsn: str = "") -> str:
    """A message for the output, with any ``scheme://user:password@`` taken out, and the DSN
    itself and each of its whitespace-separated pieces: libpq's parse errors quote the
    offending token, a password among them."""
    for piece in sorted({dsn, *dsn.split()}, key=len, reverse=True):
        if piece:
            text = text.replace(piece, "<MIGRATE_PG_DSN>")
    return _DSN_CREDENTIALS.sub("", text)


def _label(exc: BaseException) -> str:
    if isinstance(exc, MigrateRefused):
        return exc.label
    sqlstate = getattr(exc, "sqlstate", None)
    return str(sqlstate) if sqlstate else type(exc).__name__


def _status(dsn: str, shipped: list[Migration]) -> Verdict:
    with psycopg.connect(dsn, connect_timeout=DEFAULT_CONNECT_TIMEOUT_S, prepare_threshold=None,
                         application_name=APPLICATION_NAME) as conn:
        try:
            return verdict(shipped, read_ledger(conn))
        finally:
            conn.rollback()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply the prototype's sql/*.sql to MIGRATE_PG_DSN.")
    parser.add_argument("--status", action="store_true", help="report the ledger's level; run no DDL")
    args = parser.parse_args(argv)
    # The files before the DSN: a bundle missing sql/ fails as that, whatever the environment.
    try:
        shipped = load(SQL_DIR)
    except MigrateConfigError as exc:
        print(f"ev=migrate error=config detail={exc}", file=sys.stderr)
        return 2
    dsn = os.environ.get("MIGRATE_PG_DSN", "")
    if not dsn:
        print(f"no MIGRATE_PG_DSN; {len(shipped)} files under {SQL_DIR}", file=sys.stderr)
        return 2
    try:
        applied = [] if args.status else migrate(dsn, sql_dir=SQL_DIR)
        now = _status(dsn, shipped)
    except Exception as exc:  # noqa: BLE001 - every failure is one redacted line and exit 1
        if isinstance(exc, psycopg.ProgrammingError) and not getattr(exc, "sqlstate", None):
            # libpq's conninfo parse error, raised before any connection, quotes a fragment
            # of the DSN (a password's, for a stray %): name the class, never the text.
            detail = f"{type(exc).__name__}: MIGRATE_PG_DSN does not parse"
        else:
            detail = redact(f"{type(exc).__name__}: {exc}", dsn)
        print(f"ev=migrate error={_label(exc)} detail={detail}", file=sys.stderr)
        return 1
    if now.label is not None:
        print(f"ev=migrate error={now.label}", file=sys.stderr)
        return 3 if args.status else 1
    print(f"ev=migrate applied={applied} ahead={now.ahead}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
