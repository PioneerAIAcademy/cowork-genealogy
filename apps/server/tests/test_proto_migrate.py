"""U9: the migrations runner, offline (apps/server/proto/migrate.py; PLAN.md section 3).

What needs no database: the shipped files are frozen and their names ordered, the
verdict a tier reports, the lock's namespace, which errors a run retries, and the CLI's
DSN rule. Everything a real Postgres decides -- the lock, the ledger, the races -- is in
test_proto_migrate_pg.py.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest

from proto import grants, migrate

# Every shipped file's digest. A shipped file is frozen: a statement edit is a new,
# higher-numbered file, never an edit here (a comment edit leaves the digest alone).
PINNED = {
    "001_schema.sql": "377e96f35b85ec23076bc2c6b83ed0239ebe6ca971e969a69bd46d5f86163bad",
    "002_seq.sql": "b8ba30ab67393a347f08720bb2463937e190021612bef545a249b5ae5f23c0a5",
    "003_web.sql": "5049409fbe88f7842f3b1aa635c6c40645d1ad6e977f5f072fc13cb65215916e",
    "004_worker.sql": "1aeb09bef6587169dc8f417045bbac50acf3106c6d2c0fe1406b94ac32ae778b",
    "005_resume_guard.sql": "045c239aa198986a064b8cfe2aaa5cee515efbf46ca8dd7913881b4574a743da",
    "006_stop_and_queue.sql": "b8d69163118aba97ff233f0d8150a14b0899b4d5884467974e58ab60a8723a35",
    "007_session_usage_index.sql": "442700ca892a522157428da9c259cf98c07d03dbe1a13d7d3a75423d5a904f40",
    "008_auth_owner.sql": "9bcde4b42cd08b1249b3ef331c99e3e01f00d132ac57b8a7aeae5db0c523c733",
    "009_grant_session.sql": "fdab812023f0abc3ec2e58041f643e370ffabe14f345e105a6eb42aa22565fc8",
}


def _copy(tmp_path: Path) -> Path:
    out = tmp_path / "sql"
    shutil.copytree(migrate.SQL_DIR, out)
    return out


def _ledger(**overrides: str) -> dict[str, str]:
    return {**PINNED, **overrides}


def _shipped(*names: str) -> list[migrate.Migration]:
    return [migrate.Migration(name, "", PINNED.get(name, "sha-" + name)) for name in names]


# ── the files ────────────────────────────────────────────────────────────────────


def test_shipped_files_are_frozen(tmp_path):
    # Every shipped file, new ones included: a 010 joins PINNED in the PR that adds it, so an
    # edit after it ships fails here, not as `schema: drift` at deploy.
    assert {m.name: m.digest for m in migrate.load()} == PINNED, "pin each new file's migrate.digest in PINNED"
    # Both directions, on a scratch copy: a one-token statement change moves the digest; a
    # comment edit and a reflowed statement do not.
    scratch = _copy(tmp_path)
    path = scratch / "004_worker.sql"
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace("cost_usd              numeric", "cost_usd              bigint"), encoding="utf-8")
    assert migrate.load(scratch)[3].digest != PINNED["004_worker.sql"]
    path.write_text("-- applied once by migrate.py\n" + text.replace("-- D9-10", "--   D9-10 (edited)"),
                    encoding="utf-8")
    assert migrate.load(scratch)[3].digest == PINNED["004_worker.sql"]
    path.write_text(text.replace("ALTER TABLE turns    ADD COLUMN IF NOT EXISTS nudges",
                                 "ALTER TABLE turns\n    ADD COLUMN IF NOT EXISTS\n        nudges"), encoding="utf-8")
    assert migrate.load(scratch)[3].digest == PINNED["004_worker.sql"]


def test_file_names_are_ordered_unique_and_appended():
    names = sorted(p.name for p in migrate.SQL_DIR.glob("*.sql"))
    assert all(migrate.NAME_RE.match(name) for name in names), names
    prefixes = [name[:3] for name in names]
    assert len(prefixes) == len(set(prefixes)), f"a repeated prefix: {names}"
    assert names[: len(PINNED)] == sorted(PINNED), "a shipped file was renamed, removed or sorted before"
    assert [m.name for m in migrate.load()] == names


@pytest.mark.parametrize("extra, match", [
    ("008_x.sql", "repeats the prefix of 008_auth_owner.sql"),
    ("10_x.sql", "NNN_lower_snake"),
    ("010_Upper.sql", "NNN_lower_snake"),
], ids=["repeated-prefix", "two-digits", "uppercase"])
def test_load_refuses_a_bad_name(tmp_path, extra, match):
    scratch = _copy(tmp_path)
    (scratch / extra).write_text("SELECT 1;\n", encoding="utf-8")
    with pytest.raises(migrate.MigrateConfigError, match=match):
        migrate.load(scratch)


def test_load_refuses_an_empty_dir(tmp_path):
    with pytest.raises(migrate.MigrateConfigError, match="no schema files"):
        migrate.load(tmp_path)
    (tmp_path / "README.md").write_text("not a schema file\n", encoding="utf-8")
    with pytest.raises(migrate.MigrateConfigError, match="no schema files"):
        migrate.load(tmp_path)


# ── the verdict ──────────────────────────────────────────────────────────────────

ALL = sorted(PINNED)


@pytest.mark.parametrize("shipped, ledger, label, pending, ahead", [
    (ALL, None, "schema: unmigrated", ALL, []),
    (ALL, {}, "schema: behind 001_schema.sql", ALL, []),
    (ALL, {n: PINNED[n] for n in ALL[:-1]}, "schema: behind 009_grant_session.sql", ALL[-1:], []),
    (ALL, _ledger(), None, [], []),
    (ALL, _ledger(**{"010_future.sql": "f"}), None, [], ["010_future.sql"]),
    (ALL, _ledger(**{"004_worker.sql": "edited"}), "schema: drift 004_worker.sql", [], []),
    (["000_early.sql", *ALL], _ledger(), "schema: out_of_order 000_early.sql", ["000_early.sql"], []),
    ([*ALL, "010_late.sql"], _ledger(**{"011_future.sql": "f"}), "schema: out_of_order 010_late.sql",
     ["010_late.sql"], ["011_future.sql"]),
    # The order: drift beats out_of_order beats behind.
    (["000_early.sql", *ALL], _ledger(**{"009_grant_session.sql": "edited"}), "schema: drift 009_grant_session.sql",
     ["000_early.sql"], []),
    (["000_early.sql", *ALL, "010_new.sql"], _ledger(), "schema: out_of_order 000_early.sql",
     ["000_early.sql", "010_new.sql"], []),
    ([*ALL, "010_new.sql"], {n: PINNED[n] for n in ALL[:-1]}, "schema: behind 009_grant_session.sql",
     ["009_grant_session.sql", "010_new.sql"], []),
    (ALL, {n: PINNED[n] for n in ALL if n != "005_resume_guard.sql"}, "schema: out_of_order 005_resume_guard.sql",
     ["005_resume_guard.sql"], []),
], ids=["unmigrated", "empty-ledger", "behind", "ok", "ahead", "drift", "out-of-order-low", "out-of-order-high",
        "drift-first", "out-of-order-before-behind", "behind-two", "a-gap-is-out-of-order"])
def test_verdict(shipped, ledger, label, pending, ahead):
    got = migrate.verdict(_shipped(*shipped), ledger)
    assert (got.label, got.pending, got.ahead) == (label, pending, ahead)
    assert got.refused == (label is not None and label.split()[1] in ("drift", "out_of_order"))


def test_ledger_from_rows():
    assert migrate.ledger_from_rows(False, []) is None
    assert migrate.ledger_from_rows(True, []) == {}
    assert migrate.ledger_from_rows(True, [("001_schema.sql", "a"), ("002_seq.sql", "b")]) \
        == {"001_schema.sql": "a", "002_seq.sql": "b"}


# ── the lock ─────────────────────────────────────────────────────────────────────


def test_the_lock_has_a_namespace_of_its_own():
    """The text half; test_proto_migrate_pg's test 16 is the behaviour half."""
    assert migrate.MIGRATE_LOCK_NS not in {grants.ATTEMPT_LOCK_NS, grants.WRITE_LOCK_NS}
    assert re.fullmatch(r"SELECT pg_advisory_xact_lock\(%s::int4, %s::int4\)", migrate.LOCK_SQL)
    source = Path(migrate.__file__).read_text(encoding="utf-8")
    assert "pg_advisory_lock(" not in source, "a session-level lock outlives the transaction"
    assert not re.search(r"\bSET (?!LOCAL\b)", source), "a session-level SET outlives the transaction"


class _Cursor:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows

    def fetchone(self) -> tuple:
        return self.rows[0]

    def fetchall(self) -> list[tuple]:
        return self.rows


class _StubConn:
    """Answers the two ledger reads; records every statement."""

    autocommit = False
    isolation_level = psycopg.IsolationLevel.READ_COMMITTED

    def __init__(self, ledger: dict[str, str]) -> None:
        self.ledger = ledger
        self.executed: list[str] = []
        self.ends: list[str] = []

    def execute(self, statement: str, params: tuple | None = None) -> _Cursor:
        self.executed.append(statement)
        if statement == migrate.LEDGER_EXISTS_SQL:
            return _Cursor([(True,)])
        if statement == migrate.LEDGER_SELECT_SQL:
            return _Cursor(list(self.ledger.items()))
        return _Cursor([])

    def commit(self) -> None:
        self.ends.append("commit")

    def rollback(self) -> None:
        self.ends.append("rollback")


@pytest.mark.parametrize("ledger, label", [
    (_ledger(**{"004_worker.sql": "drifted"}), "schema: drift 004_worker.sql"),
    ({**_ledger(**{"004_worker.sql": "drifted"}), "010_future.sql": "f"}, "schema: drift 004_worker.sql"),
    ({n: PINNED[n] for n in ALL if n != "005_resume_guard.sql"}, "schema: out_of_order 005_resume_guard.sql"),
], ids=["drift", "drift-and-ahead", "out-of-order"])
def test_drift_is_refused_before_the_lock(ledger, label):
    conn = _StubConn(ledger)
    seen: list = []
    with pytest.raises(migrate.MigrateRefused) as raised:
        migrate.migrate_on(conn, on_ledger=seen.append)
    assert raised.value.label == label
    assert seen == [ledger]
    assert migrate.LOCK_SQL not in conn.executed and migrate.LEDGER_DDL not in conn.executed
    assert conn.executed == [migrate.LEDGER_EXISTS_SQL, migrate.LEDGER_SELECT_SQL]
    assert conn.ends and set(conn.ends) == {"rollback"}


@pytest.mark.parametrize("level", [None, psycopg.IsolationLevel.REPEATABLE_READ])
def test_migrate_on_refuses_a_connection_not_pinned_to_read_committed(level):
    """Under a snapshot isolation the re-check under the lock cannot see a file another runner
    committed while this one waited; None is whatever the role's default is."""
    conn = _StubConn(_ledger())
    conn.isolation_level = level
    with pytest.raises(ValueError, match="READ_COMMITTED"):
        migrate.migrate_on(conn)
    assert conn.executed == []


def test_migrate_on_refuses_an_autocommit_connection():
    conn = _StubConn(_ledger())
    conn.autocommit = True
    with pytest.raises(ValueError, match="autocommit"):
        migrate.migrate_on(conn)
    assert conn.executed == []


# ── the retry classes ────────────────────────────────────────────────────────────


def test_retry_classes_are_operational_errors():
    assert issubclass(psycopg.errors.LockNotAvailable, psycopg.OperationalError)
    assert issubclass(psycopg.errors.DeadlockDetected, psycopg.OperationalError)
    assert not any(issubclass(cls, psycopg.OperationalError) for cls in migrate.RACE_ERRORS)


A_LEDGER = {"001_schema.sql": PINNED["001_schema.sql"]}
UNSET = object()


@pytest.mark.parametrize("script, slept, outcome", [
    # (a) the latch is the FIRST ledger read's: attempt 2 reads attempt 1's setup, not None.
    ([(None, psycopg.errors.UniqueViolation), (A_LEDGER, psycopg.errors.UniqueViolation), (A_LEDGER, None)],
     [1, 2], "ran"),
    # (b) a migrated database: a race class is a broken lock, never retried.
    ([(A_LEDGER, psycopg.errors.DuplicateTable)], [], psycopg.errors.DuplicateTable),
    # (c) an OperationalError before any read leaves the latch for the next attempt.
    ([(UNSET, psycopg.OperationalError), (None, psycopg.errors.UniqueViolation), (A_LEDGER, None)],
     [1, 2], "ran"),
    # (d) as (c), but the first read finds a ledger.
    ([(UNSET, psycopg.OperationalError), (A_LEDGER, psycopg.errors.UniqueViolation)], [1],
     psycopg.errors.UniqueViolation),
    # An empty ledger is a baseline too (attempt 1's setup committed, 001 did not).
    ([({}, psycopg.errors.InternalError_), (A_LEDGER, None)], [1], "ran"),
    ([(UNSET, psycopg.OperationalError)] * 3, [1, 2], psycopg.OperationalError),
], ids=["a-latched-baseline", "b-migrated", "c-undecided-then-baseline", "d-undecided-then-migrated",
        "empty-ledger", "exhausted"])
def test_retry_classes(monkeypatch, script, slept, outcome):
    attempts = iter(script)
    connects: list[dict] = []
    closed: list[int] = []
    sleeps: list[float] = []

    def connect(dsn, **kw):
        connects.append(kw)
        return SimpleNamespace(close=lambda: closed.append(1))

    def migrate_on(conn, *, on_ledger, **kw):
        ledger, exc = next(attempts)
        if ledger is not UNSET:
            on_ledger(ledger)
        if exc is not None:
            raise exc("scripted")
        return ["ran"]

    monkeypatch.setattr(migrate.psycopg, "connect", connect)
    monkeypatch.setattr(migrate, "migrate_on", migrate_on)
    monkeypatch.setattr(migrate, "_sleep", sleeps.append)
    if outcome == "ran":
        assert migrate.migrate("postgresql://x@h/db", attempts=len(script)) == ["ran"]
    else:
        with pytest.raises(outcome):
            migrate.migrate("postgresql://x@h/db", attempts=len(script))
    assert sleeps == slept
    assert len(closed) == len(connects) == len(slept) + 1, "every attempt's connection is closed"
    assert all(kw["application_name"] == "genealogy-migrate" and kw["prepare_threshold"] is None
               and kw["connect_timeout"] for kw in connects)


# ── the CLI ──────────────────────────────────────────────────────────────────────


def test_the_cli_reads_only_migrate_pg_dsn(monkeypatch, capsys):
    monkeypatch.delenv("MIGRATE_PG_DSN", raising=False)
    monkeypatch.setenv("PG_DSN", "postgresql://postgres:proto@localhost:5434/proto")
    monkeypatch.setattr(migrate, "migrate", lambda *a, **kw: pytest.fail("ran without MIGRATE_PG_DSN"))
    assert migrate.main([]) == 2
    assert migrate.main(["--status"]) == 2
    err = capsys.readouterr().err
    assert f"no MIGRATE_PG_DSN; {len(PINNED)} files under {migrate.SQL_DIR}" in err


def test_the_cli_redacts_the_dsn(monkeypatch, capsys):
    dsn = "postgresql://owner:s3cret-pw@db.example.org:5432/proto"
    monkeypatch.setenv("MIGRATE_PG_DSN", dsn)

    def unreachable(got, **kw):
        assert got == dsn
        raise psycopg.OperationalError(f"connection to {got} failed: timeout expired")

    monkeypatch.setattr(migrate, "migrate", unreachable)
    assert migrate.main([]) == 1
    out = capsys.readouterr()
    assert "s3cret-pw" not in out.err + out.out and "owner:" not in out.err
    assert "ev=migrate error=OperationalError" in out.err and "connection to <MIGRATE_PG_DSN> failed" in out.err


@pytest.mark.parametrize("dsn, secret", [
    ("postgresql://owner:pa%zzss@db.example.org:5432/proto", "zzss"),
    ("host=db.example.org user=owner password=s3cr et", "s3cr"),
], ids=["bad-percent", "conninfo-space"])
def test_the_cli_never_prints_a_dsn_that_does_not_parse(monkeypatch, capsys, dsn, secret):
    """The real migrate(): libpq refuses each before connecting and quotes the token it choked on."""
    monkeypatch.setenv("MIGRATE_PG_DSN", dsn)
    assert migrate.main([]) == 1
    out = capsys.readouterr()
    assert secret not in out.err + out.out, out.err
    assert "MIGRATE_PG_DSN does not parse" in out.err


def test_the_cli_loads_the_files_before_it_reads_the_dsn(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MIGRATE_PG_DSN", "postgresql://x@127.0.0.1:1/p")
    monkeypatch.setattr(migrate, "SQL_DIR", tmp_path)
    monkeypatch.setattr(migrate, "migrate", lambda *a, **kw: pytest.fail("ran with no files"))
    assert migrate.main([]) == 2
    assert "no schema files" in capsys.readouterr().err
