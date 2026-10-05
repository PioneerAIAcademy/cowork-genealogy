"""U9: the migrations runner against REAL Postgres (apps/server/proto/migrate.py; PLAN.md section 3).

The runner's guarantees are Postgres's to keep -- an advisory lock that serialises
runners, ``SET LOCAL`` that ends with the transaction, DDL that queues behind live
readers -- so no fake proves them. Each test gets a database of its own from
``_proto_pg.database`` (created from ``PROTO_TEST_PG_DSN``, dropped ``WITH (FORCE)``);
a wait is seen in ``pg_stat_activity`` / ``pg_locks``, never inferred from a sleep. The
service halves drive the real web lifespan (``PgStore.verify_schema``) and the real
worker check (``_verify_schema_once``, ``schema_loop``): a tier reads the ledger and
never runs DDL.

Without the DSN the module skips -- except under ``CI``, where it fails.
``make proto-grants-test`` runs it against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import contextlib
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest

from proto import migrate
from proto.worker import worker
from tests._proto_pg import PROTO, database, dml_role, require_base_dsn, sql

sys.path.insert(0, str(PROTO))

from tests.test_proto_web import AUTH_ENV, FakeQueue  # noqa: E402
from web import app  # noqa: E402
from web.app import PgStore, ReadyCheckError, create_app  # noqa: E402

FILES = migrate.load()
NAMES = [m.name for m in FILES]
LATEST = "009_grant_session.sql"
RACE_SQLSTATES = {"23505", "42P07", "42710", "XX000"}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    require_base_dsn()
    for name in (*AUTH_ENV, "MIGRATE_PG_DSN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(worker, "log", lambda **f: None)


def raw_apply(dsn: str, names: list[str]) -> None:
    """What every pre-U9 start did: run the files, record nothing."""
    by_name = {m.name: m for m in FILES}
    with psycopg.connect(dsn, autocommit=True) as conn:
        for name in names:
            conn.execute(by_name[name].text)


def ledger(dsn: str) -> dict[str, str]:
    return dict(sql(dsn, "SELECT name, sha256 FROM schema_migrations"))


def ledger_rows(dsn: str) -> list[tuple]:
    return sql(dsn, "SELECT name, sha256, applied_at FROM schema_migrations ORDER BY name")


def columns(dsn: str, table: str) -> set[str]:
    return {r[0] for r in sql(dsn, "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
                              (table,))}


def exists(dsn: str, relation: str) -> bool:
    return sql(dsn, "SELECT to_regclass(%s) IS NOT NULL", (relation,))[0][0]


def sql_dir(tmp_path: Path, extra: dict[str, str] | None = None, *, edit: dict[str, str] | None = None) -> Path:
    """A copy of the shipped files plus ``extra``; ``edit`` replaces a file's text."""
    out = tmp_path / "sql"
    shutil.copytree(migrate.SQL_DIR, out)
    for name, text in {**(extra or {}), **(edit or {})}.items():
        (out / name).write_text(text, encoding="utf-8")
    return out


def text_of(name: str) -> str:
    return next(m.text for m in FILES if m.name == name)


@contextlib.asynccontextmanager
async def web_tier(monkeypatch, dsn: str, files: Path | None = None):
    """The real web lifespan on ``dsn`` (``files``: the sql dir its schema step verifies)."""
    monkeypatch.setenv("PG_DSN", dsn)
    if files is not None:
        class Store(PgStore):
            async def verify_schema(self, sql_dir: Path = files) -> list[str]:
                return await PgStore.verify_schema(self, sql_dir=sql_dir)

        monkeypatch.setattr(app, "PgStore", Store)
    application = create_app(queue=FakeQueue())
    async with application.router.lifespan_context(application):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t") as client:
            yield application, client


async def health(client: httpx.AsyncClient) -> tuple[int, dict[str, Any]]:
    r = await client.get("/api/health")
    return r.status_code, r.json()


def run_threads(n: int, target) -> list[Any]:
    """``target()`` on ``n`` threads released together; each result or exception, in order."""
    barrier = threading.Barrier(n)
    out: list[Any] = [None] * n

    def one(i: int) -> None:
        barrier.wait()
        try:
            out[i] = target()
        except BaseException as exc:  # noqa: BLE001 - the test inspects it
            out[i] = exc

    threads = [threading.Thread(target=one, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert not any(t.is_alive() for t in threads), "a runner hung"
    return out


def worker_loop(monkeypatch, dsn: str) -> threading.Thread:
    """``worker.schema_loop(dsn)`` on a thread, backing off 0.05 s, from ``pending``."""
    monkeypatch.setattr(worker, "_SCHEMA_ERROR", "pending")
    monkeypatch.setattr(worker, "SCHEMA_BACKOFF_FIRST_S", 0.05)
    monkeypatch.setattr(worker, "SCHEMA_BACKOFF_MAX_S", 0.05)
    monkeypatch.setattr(worker, "SHUTDOWN", threading.Event())
    thread = threading.Thread(target=worker.schema_loop, args=(dsn,), daemon=True, name="u9-schema")
    thread.start()
    return thread


def wait_for(predicate, timeout_s: float = 5.0, what: str = "the condition") -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError(f"{what} did not hold within {timeout_s}s")


# ── the levels ───────────────────────────────────────────────────────────────────


def test_an_empty_database_reaches_the_latest_file(monkeypatch, capsys):
    with database(apply=False) as dsn:
        assert migrate.migrate(dsn) == NAMES
        assert NAMES == sorted(NAMES) and NAMES[-1] == LATEST
        assert ledger(dsn) == {m.name: migrate.digest(m.text) for m in FILES}
        assert sql(dsn, app.READY_SQL, (list(app.WEB_TABLES), list(app.WEB_FUNCTIONS))) == []
        assert sql(dsn, worker.READY_SQL, (list(worker.WORKER_TABLES), list(worker.WORKER_FUNCTIONS))) == []
        assert {"session_started_at", "refresh_started_at", "refresh_refused_at",
                "refresh_refused_reason"} <= columns(dsn, "familysearch_tokens")
        assert exists(dsn, "turns_open_project_idx")
        assert migrate.migrate(dsn) == [], "a current database applies nothing"
        monkeypatch.setenv("MIGRATE_PG_DSN", dsn)
        assert migrate.main(["--status"]) == 0
        assert migrate.main([]) == 0
        assert capsys.readouterr().out.splitlines()[-1] == "ev=migrate applied=[] ahead=[]"
        assert asyncio.run(PgStore(dsn).verify_schema()) == NAMES


def test_a_005_database_with_live_rows_reaches_the_latest_file():
    with database(apply=False) as dsn:
        raw_apply(dsn, NAMES[:5])
        assert not exists(dsn, "users")
        sql(dsn, "INSERT INTO projects (project_id) VALUES ('proj_u9')")
        sql(dsn, "INSERT INTO sessions (session_id, project_id) VALUES ('sess_u9', 'proj_u9')")
        sql(dsn, "INSERT INTO turns (turn_id, session_id, project_id, message) VALUES "
                 "('turn_u9', 'sess_u9', 'proj_u9', '{}'::jsonb)")
        sql(dsn, "INSERT INTO session_entries (session_id, entry) VALUES ('sess_u9', '{\"n\": 1}'), "
                 "('sess_u9', '{\"n\": 2}')")
        assert migrate.migrate(dsn) == NAMES, "an unledgered database re-runs every file once"
        assert sorted(ledger(dsn)) == NAMES
        assert "stop_requested_at" in columns(dsn, "sessions")
        assert all(exists(dsn, r) for r in ("turns_queued_idx", "session_entries_session_seq_idx", "users",
                                             "allowed_emails", "familysearch_tokens", "projects_owner_idx",
                                             "turns_open_project_idx"))
        assert "owner_id" in columns(dsn, "projects") and "session_started_at" in columns(dsn, "familysearch_tokens")
        assert sql(dsn, "SELECT project_id, owner_id FROM projects") == [("proj_u9", None)]
        assert sql(dsn, "SELECT turn_id, zero_progress_attempts FROM turns") == [("turn_u9", 0)]
        assert sql(dsn, "SELECT count(*) FROM session_entries WHERE session_id = 'sess_u9'") == [(2,)]
        assert sql(dsn, "SELECT count(*) FROM sessions") == [(1,)]


def test_an_early_004_database_is_repaired_not_just_recorded():
    with database(apply=False) as dsn:
        raw_apply(dsn, NAMES)
        sql(dsn, "ALTER TABLE turns DROP COLUMN nudges")
        sql(dsn, "ALTER TABLE tool_calls DROP COLUMN tool_use_id")
        assert migrate.migrate(dsn) == NAMES
        assert "nudges" in columns(dsn, "turns") and "tool_use_id" in columns(dsn, "tool_calls")


# ── the lock ─────────────────────────────────────────────────────────────────────


def _slow_files(tmp_path: Path) -> Path:
    """001 holds its transaction half a second, so runners released together overlap."""
    return sql_dir(tmp_path, edit={"001_schema.sql": text_of("001_schema.sql") + "\nSELECT pg_sleep(0.5);\n"})


def _no_retry(*_a) -> None:
    raise AssertionError("retried")


@pytest.mark.parametrize("isolation", [None, "repeatable read"], ids=["default", "repeatable-read-default"])
def test_concurrent_runners_on_an_empty_database_do_not_race(monkeypatch, tmp_path, isolation):
    """Also under a database whose default isolation is a snapshot one: the runner pins its own
    connection to READ COMMITTED, or the re-check under the lock misses a committed file."""
    files = _slow_files(tmp_path)
    monkeypatch.setattr(migrate, "_sleep", _no_retry)
    with database(apply=False) as dsn:
        if isolation:
            sql(dsn, f"ALTER DATABASE {psycopg.conninfo.conninfo_to_dict(dsn)['dbname']} "
                     f"SET default_transaction_isolation = '{isolation}'")
        # attempts=1: the baseline retry of the race classes would otherwise mask a broken lock.
        results = run_threads(8, lambda: migrate.migrate(dsn, sql_dir=files, attempts=1))
        errors = [r for r in results if isinstance(r, BaseException)]
        assert not errors, errors
        applied = [name for r in results for name in r]
        assert sorted(applied) == NAMES, "every file applied exactly once, by some runner"
        assert sql(dsn, "SELECT count(*), count(DISTINCT name) FROM schema_migrations") == [(len(NAMES), len(NAMES))]


@pytest.mark.parametrize("lock_sql", [
    "SELECT %s, %s",
    "SELECT pg_advisory_xact_lock(%s::int4, (%s + pg_backend_pid())::int4)",
], ids=["no-lock", "a-key-per-runner"])
def test_the_race_harness_races_without_a_shared_lock(monkeypatch, tmp_path, lock_sql):
    """The in-suite break proof of the test above: its guarantee comes from ONE shared key."""
    files = _slow_files(tmp_path)
    monkeypatch.setattr(migrate, "_sleep", _no_retry)
    monkeypatch.setattr(migrate, "LOCK_SQL", lock_sql)
    with database(apply=False) as dsn:
        results = run_threads(8, lambda: migrate.migrate(dsn, sql_dir=files, attempts=1))
        raced = [r for r in results if getattr(r, "sqlstate", None) in RACE_SQLSTATES]
        assert raced, f"no runner raced: {results}"


def test_concurrent_runners_on_an_applied_database_take_the_fast_path(monkeypatch):
    with database() as dsn:
        before = ledger_rows(dsn)
        monkeypatch.setattr(migrate, "LOCK_SQL", "SELECT 1/0, %s, %s")
        results = run_threads(8, lambda: migrate.migrate(dsn))
        assert results == [[]] * 8, results
        assert ledger_rows(dsn) == before, "applied_at unchanged: nothing re-ran"


def _old_style_apply(dsn: str, application_name: str, out: list) -> None:
    """The pre-U9 start-time apply (worker.py's _apply_schema_once): every file, one transaction."""
    try:
        with psycopg.connect(dsn, connect_timeout=5, application_name=application_name) as conn:
            for m in FILES:
                conn.execute(m.text)
            conn.commit()
        out.append("done")
    except psycopg.Error as exc:
        out.append(exc)


async def test_a_service_start_takes_no_table_lock(monkeypatch):
    with database() as dsn:
        reader = psycopg.connect(dsn)
        reader.execute("SELECT 1 FROM turns")  # ACCESS SHARE, held: live traffic
        old_name = "u9-old-apply"
        old: list = []
        thread = None
        try:
            started = time.monotonic()
            async with web_tier(monkeypatch, dsn) as (application, _client):
                assert application.state.startup["schema"] == "ok", application.state.startup
            assert time.monotonic() - started < 5
            await asyncio.wait_for(asyncio.to_thread(worker._verify_schema_once, dsn, connect_timeout=5), 5)
            # The control: the same reader stalls the pre-U9 all-files apply at 004's ALTER TABLE turns.
            thread = threading.Thread(target=_old_style_apply, args=(dsn, old_name, old), daemon=True)
            thread.start()
            thread.join(3)
            assert thread.is_alive() and old == [], "the control did not block: the reader holds no lock"
        finally:
            if thread is not None and thread.is_alive():
                sql(dsn, "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = %s",
                    (old_name,))
                thread.join(10)
            reader.rollback()
            reader.close()


def test_lock_timeout_bounds_a_migration_queued_behind_traffic(monkeypatch, tmp_path):
    monkeypatch.setattr(migrate, "_sleep", _no_retry)
    files = sql_dir(tmp_path, {"010_probe_column.sql": "ALTER TABLE turns ADD COLUMN x int;\n"})
    with database() as dsn:
        reader = psycopg.connect(dsn)
        try:
            reader.execute("SELECT 1 FROM turns")
            started = time.monotonic()
            with pytest.raises(psycopg.errors.LockNotAvailable):
                migrate.migrate(dsn, sql_dir=files, lock_timeout_s=0.5, attempts=1)
            assert time.monotonic() - started < 3
            assert "010_probe_column.sql" not in ledger(dsn)
        finally:
            reader.rollback()
            reader.close()
        assert migrate.migrate(dsn, sql_dir=files) == ["010_probe_column.sql"]
        assert "x" in columns(dsn, "turns")


def test_a_failing_file_rolls_back_and_keeps_earlier_files(monkeypatch, tmp_path):
    monkeypatch.setattr(migrate, "_sleep", _no_retry)
    broken = "ALTER TABLE turns ADD COLUMN u9_probe int; SELECT 1/0;\n"
    with database(apply=False) as dsn:
        with pytest.raises(psycopg.errors.DivisionByZero) as raised:
            migrate.migrate(dsn, sql_dir=sql_dir(tmp_path / "a", {"010_broken.sql": broken}))
        assert raised.value.sqlstate == "22012"
        assert sorted(ledger(dsn)) == NAMES, "the files before the broken one stay applied"
        assert "u9_probe" not in columns(dsn, "turns")
        fixed = sql_dir(tmp_path / "b", {"010_broken.sql": "ALTER TABLE turns ADD COLUMN u9_probe int;\n"})
        assert migrate.migrate(dsn, sql_dir=fixed) == ["010_broken.sql"]
        assert "u9_probe" in columns(dsn, "turns")


# ── refusals ─────────────────────────────────────────────────────────────────────


def test_a_changed_file_is_refused_and_a_comment_edit_is_not(monkeypatch, tmp_path, capsys):
    label = "schema: drift 004_worker.sql"
    original = text_of("004_worker.sql")
    edited = original.replace("cost_usd              numeric", "cost_usd              bigint")
    assert edited != original
    with database() as dsn:
        before = ledger_rows(dsn)
        files = sql_dir(tmp_path / "a", edit={"004_worker.sql": edited})
        with pytest.raises(migrate.MigrateRefused) as raised:
            migrate.migrate(dsn, sql_dir=files)
        assert raised.value.label == label
        monkeypatch.setenv("MIGRATE_PG_DSN", dsn)
        monkeypatch.setattr(migrate, "SQL_DIR", files)
        assert migrate.main([]) == 1
        assert migrate.main(["--status"]) == 3
        assert label in capsys.readouterr().err
        assert ledger_rows(dsn) == before, "no ledger row changed"
        assert sql(dsn, "SELECT data_type FROM information_schema.columns WHERE table_name = 'turns' "
                        "AND column_name = 'cost_usd'") == [("numeric",)]
        with pytest.raises(ReadyCheckError) as web:
            asyncio.run(PgStore(dsn).verify_schema(sql_dir=files))
        assert web.value.label == label
        commented = sql_dir(tmp_path / "b", edit={"004_worker.sql": "-- applied once by migrate.py\n" + original})
        assert migrate.migrate(dsn, sql_dir=commented) == []
        assert migrate.verdict(migrate.load(commented), ledger(dsn)).label is None
        assert asyncio.run(PgStore(dsn).verify_schema(sql_dir=commented)) == NAMES


async def test_build_and_schema_versions_in_either_order(monkeypatch):
    with database() as dsn:
        # A newer schema under this build: an old build stays healthy.
        sql(dsn, "INSERT INTO schema_migrations (name, sha256) VALUES ('010_future.sql', 'f')")
        got = migrate.verdict(FILES, ledger(dsn))
        assert got.label is None and got.ahead == ["010_future.sql"]
        assert await asyncio.to_thread(migrate.migrate, dsn) == []
        # A newer build on an older schema: 503 until someone migrates, then 200 with no restart.
        sql(dsn, "DELETE FROM schema_migrations WHERE name IN ('010_future.sql', %s)", (LATEST,))
        monkeypatch.setattr(app, "STARTUP_BACKOFF_FIRST_S", 0.05)
        monkeypatch.setattr(app, "STARTUP_BACKOFF_MAX_S", 0.05)
        async with web_tier(monkeypatch, dsn) as (_application, client):
            status, body = await health(client)
            assert status == 503 and body["checks"]["schema"] == {"ok": False, "error": f"schema: behind {LATEST}"}
            assert await asyncio.to_thread(migrate.migrate, dsn) == [LATEST]
            for _ in range(250):
                status, body = await health(client)
                if status == 200:
                    break
                await asyncio.sleep(0.02)
            assert status == 200 and body["checks"]["schema"] == {"ok": True}, body


async def test_a_lower_prefixed_new_file_is_refused(monkeypatch, tmp_path):
    early = "ALTER TABLE turns ADD COLUMN u9_early int;\n"
    with database() as dsn:
        before = ledger_rows(dsn)
        files = sql_dir(tmp_path / "a", {"000_early.sql": early})
        label = "schema: out_of_order 000_early.sql"
        assert migrate.verdict(migrate.load(files), ledger(dsn)).label == label
        with pytest.raises(migrate.MigrateRefused, match=label):
            await asyncio.to_thread(migrate.migrate, dsn, sql_dir=files)
        assert "u9_early" not in columns(dsn, "turns") and ledger_rows(dsn) == before
        async with web_tier(monkeypatch, dsn, files) as (_application, client):
            status, body = await health(client)
        assert status == 503 and body["checks"]["schema"] == {"ok": False, "error": label}
        # A file sorting below a row a newer build recorded.
        sql(dsn, "INSERT INTO schema_migrations (name, sha256) VALUES ('011_future.sql', 'f')")
        late = sql_dir(tmp_path / "b", {"010_late.sql": "ALTER TABLE turns ADD COLUMN u9_late int;\n"})
        assert migrate.verdict(migrate.load(late), ledger(dsn)).label == "schema: out_of_order 010_late.sql"
        with pytest.raises(migrate.MigrateRefused, match="out_of_order 010_late.sql"):
            await asyncio.to_thread(migrate.migrate, dsn, sql_dir=late)
        assert "u9_late" not in columns(dsn, "turns")


# ── the services ─────────────────────────────────────────────────────────────────


async def test_the_web_start_runs_no_ddl_and_reports_unmigrated(monkeypatch):
    with database(apply=False) as dsn:
        async with web_tier(monkeypatch, dsn) as (_application, client):
            status, body = await health(client)
        assert not exists(dsn, "projects") and not exists(dsn, "schema_migrations")
        assert status == 503 and body["checks"]["schema"] == {"ok": False, "error": "schema: unmigrated"}


async def test_a_dml_only_role_runs_the_services_but_not_the_migration(monkeypatch, tmp_path):
    with database() as dsn, dml_role(dsn) as (role, role_dsn):
        assert sql(dsn, "SELECT has_table_privilege(%s, 'schema_migrations', 'INSERT')", (role,)) == [(False,)]
        [(acl,)] = sql(dsn, "SELECT coalesce(relacl::text, '') FROM pg_class WHERE oid = 'schema_migrations'::regclass")
        assert role not in acl, acl
        async with web_tier(monkeypatch, role_dsn) as (application, client):
            status, body = await health(client)
            assert application.state.startup["schema"] == "ok", application.state.startup
        assert body["checks"]["schema"] == {"ok": True}, body
        thread = worker_loop(monkeypatch, role_dsn)
        try:
            thread.join(10)
            assert not thread.is_alive() and worker._SCHEMA_ERROR is None, worker._SCHEMA_ERROR
        finally:
            worker.SHUTDOWN.set()
        assert await asyncio.to_thread(migrate.migrate, role_dsn) == []
        before = ledger_rows(dsn)
        pending = sql_dir(tmp_path, {"010_owner_only.sql": "ALTER TABLE turns ADD COLUMN u9_dml int;\n"})
        with pytest.raises(psycopg.errors.InsufficientPrivilege) as raised:
            await asyncio.to_thread(migrate.migrate, role_dsn, sql_dir=pending)
        assert raised.value.sqlstate == "42501"
        assert ledger_rows(dsn) == before and "u9_dml" not in columns(dsn, "turns")


def test_the_worker_keeps_checking_until_the_migration_lands(monkeypatch):
    with database(apply=False) as dsn:
        thread = worker_loop(monkeypatch, dsn)
        try:
            wait_for(lambda: worker._SCHEMA_ERROR == "schema: unmigrated", what="schema: unmigrated")
            assert thread.is_alive(), "the loop keeps checking"
            assert not exists(dsn, "projects"), "the worker ran no DDL"
            migrate.migrate(dsn)
            thread.join(10)
            assert not thread.is_alive() and worker._SCHEMA_ERROR is None, worker._SCHEMA_ERROR
        finally:
            worker.SHUTDOWN.set()


# ── the baseline ─────────────────────────────────────────────────────────────────


def test_the_runner_survives_an_old_style_applier_racing_its_baseline(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr(migrate, "_sleep", slept.append)
    with database(apply=False) as dsn:
        old = psycopg.connect(dsn, application_name="u9-old-style")
        out: dict[str, Any] = {}

        def run() -> None:
            try:
                out["applied"] = migrate.migrate(dsn)
            except BaseException as exc:  # noqa: BLE001 - asserted below
                out["error"] = exc

        try:
            old.execute(text_of("001_schema.sql"))  # a pre-U9 start, mid-apply, uncommitted
            thread = threading.Thread(target=run, daemon=True)
            thread.start()
            wait_for(lambda: sql(dsn, "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                                      "AND application_name = %s AND wait_event_type = 'Lock'",
                                 (migrate.APPLICATION_NAME,))[0][0] > 0,
                     what="the runner waiting on the old-style applier")
            old.commit()
            thread.join(60)
        finally:
            old.close()
        assert not thread.is_alive()
        assert "error" not in out, out
        assert out["applied"] == NAMES
        assert len(slept) >= 1, "the runner's 001 hit the race and retried"
        assert sql(dsn, "SELECT count(*), count(DISTINCT name) FROM schema_migrations") == [(len(NAMES), len(NAMES))]


def test_the_runner_leaves_no_session_state():
    with database(apply=False) as dsn:
        c = psycopg.connect(dsn, options="-c statement_timeout=45s -c lock_timeout=7s")
        c.isolation_level = psycopg.IsolationLevel.READ_COMMITTED
        try:
            pid = c.info.backend_pid
            lt0 = c.execute("SHOW lock_timeout").fetchone()[0]
            st0 = c.execute("SHOW statement_timeout").fetchone()[0]
            c.rollback()
            assert (lt0, st0) == ("7s", "45s")
            for expected in (NAMES, []):  # a run, then the fast path
                assert migrate.migrate_on(c) == expected
                assert c.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
                assert sql(dsn, "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = %s",
                           (pid,)) == [(0,)]
                assert c.execute("SHOW lock_timeout").fetchone()[0] == lt0
                assert c.execute("SHOW statement_timeout").fetchone()[0] == st0
                c.rollback()
        finally:
            c.close()


def test_a_baseline_rerun_of_008_adds_no_second_foreign_key():
    """A guard, not a U9 behaviour: if this shows 2, the pre-U9 start-time apply has been
    piling up foreign keys, and the fix (a DROP CONSTRAINT migration) is the lead's call."""
    with database(apply=False) as dsn:
        raw_apply(dsn, NAMES)
        raw_apply(dsn, NAMES)
        migrate.migrate(dsn)
        assert sql(dsn, "SELECT count(*) FROM pg_constraint WHERE conrelid = 'projects'::regclass "
                        "AND contype = 'f'") == [(1,)]
