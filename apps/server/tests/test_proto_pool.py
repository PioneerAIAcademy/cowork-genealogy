"""#3980: the web tier's optional query pool (``PG_POOL_MAX_SIZE``), offline.

The setting's parse, that unset builds no ``psycopg_pool`` object (the handoff's behaviour),
the pool's constructor arguments, and that a pooled tier listens with Postgres down and
answers ``/api/health`` 503. The pool against a real server is ``test_proto_pool_pg.py``.
"""

from __future__ import annotations

import re
import sys
import time

import httpx
import psycopg
import psycopg_pool
import pytest

from tests.test_proto_web import (  # noqa: F401  (refused_pg and silent_pg are fixtures)
    PROTO, FakeQueue, refused_pg, silent_pg,
)

sys.path.insert(0, str(PROTO))

import pg_credentials  # noqa: E402
import web.app as app  # noqa: E402
from web.app import PgStore, create_app  # noqa: E402


@pytest.mark.parametrize("raw, expected", [("", None), ("  ", None), ("3", 3), (" 12 ", 12)])
def test_pool_size_reads_a_positive_integer_or_nothing(monkeypatch, raw, expected):
    monkeypatch.setenv("PG_POOL_MAX_SIZE", raw)
    assert app.pool_max_size() == expected


def test_pool_size_unset_is_no_pool(monkeypatch):
    monkeypatch.delenv("PG_POOL_MAX_SIZE", raising=False)
    assert app.pool_max_size() is None


@pytest.mark.parametrize("raw", ["0", "-1", "+5", "1_000", "2x", "1.5", "٣"])
def test_pool_size_refuses_anything_else(monkeypatch, raw):
    monkeypatch.setenv("PG_POOL_MAX_SIZE", raw)
    with pytest.raises(RuntimeError, match=re.escape(f"PG_POOL_MAX_SIZE is {raw!r}")):
        app.pool_max_size()


class RecordingPool(psycopg_pool.AsyncConnectionPool):
    """The real pool, recording how it was built and opened."""

    built: list[dict] = []
    opened: list[dict] = []

    def __init__(self, *args, **kwargs):
        RecordingPool.built.append(kwargs)
        super().__init__(*args, **kwargs)

    async def open(self, *args, **kwargs):
        RecordingPool.opened.append(kwargs)
        return await super().open(*args, **kwargs)


@pytest.fixture
def recording_pool(monkeypatch):
    RecordingPool.built, RecordingPool.opened = [], []
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", RecordingPool)
    return RecordingPool


async def test_the_pool_is_built_checked_bounded_and_without_tls_overrides(recording_pool, refused_pg):
    store = PgStore(refused_pg.dsn, pool_max_size=3)
    await store.open_pool()
    try:
        (kw,) = recording_pool.built
        assert "check" not in kw, "PgStore._borrow checks, without the pool's backoff between failures"
        assert (kw["min_size"], kw["max_size"]) == (0, 3)
        assert (kw["timeout"], kw["reconnect_timeout"]) == (10.0, 10.0)
        assert kw["open"] is False
        assert kw["kwargs"]["autocommit"] is True and kw["kwargs"]["connect_timeout"] == 10
        assert not {"sslmode", "sslrootcert"} & set(kw["kwargs"]), "libpq reads PGSSL* from the environment"
        assert recording_pool.opened == [{"wait": False}]
    finally:
        await store.close_pool()
    assert store._pool is None


async def test_pooled_connects_go_through_the_store_credentials(recording_pool, refused_pg, monkeypatch):
    """The pool's conninfo is unused: each connect resolves the holder's current DSN through
    ``pg_credentials.aconnect``, so a SAS rotation reaches pooled connections (U29)."""
    store = PgStore(refused_pg.dsn, pool_max_size=1)
    seen: list[tuple] = []

    async def aconnect(creds, connector, /, **kw):
        seen.append((creds, kw))
        return "a connection"

    monkeypatch.setattr(pg_credentials, "aconnect", aconnect)
    await store.open_pool()
    try:
        cls = recording_pool.built[0]["connection_class"]
        assert issubclass(cls, psycopg.AsyncConnection)
        assert await cls.connect("the pool's conninfo", autocommit=True) == "a connection"
        assert seen == [(store.creds, {"autocommit": True})]
    finally:
        await store.close_pool()


async def test_no_pool_setting_builds_no_pool(recording_pool, refused_pg):
    store = PgStore(refused_pg.dsn)
    await store.open_pool()
    assert store._pool is None and recording_pool.built == []


async def _health_through_the_lifespan(monkeypatch, dsn: str):
    monkeypatch.setenv("PG_DSN", dsn)
    monkeypatch.setattr(app, "READY_TIMEOUT_S", 0.3)
    application = create_app(queue=FakeQueue())
    started = time.monotonic()
    async with application.router.lifespan_context(application):
        entered = time.monotonic() - started
        store = application.state.store
        pool = store._pool
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t") as c:
            r = await c.get("/api/health")
    return r, entered, store, pool


async def test_unset_the_lifespan_builds_no_pool(monkeypatch, recording_pool, refused_pg):
    monkeypatch.delenv("PG_POOL_MAX_SIZE", raising=False)
    r, _, store, pool = await _health_through_the_lifespan(monkeypatch, refused_pg.dsn)
    assert r.status_code == 503 and pool is None and recording_pool.built == []


@pytest.mark.parametrize("postgres", ["refused", "silent"])
async def test_a_pooled_tier_listens_with_postgres_down(monkeypatch, recording_pool, refused_pg, silent_pg, postgres):
    monkeypatch.setenv("PG_POOL_MAX_SIZE", "4")
    dsn = (refused_pg if postgres == "refused" else silent_pg).dsn
    r, entered, store, pool = await _health_through_the_lifespan(monkeypatch, dsn)
    assert pool is not None and recording_pool.opened == [{"wait": False}]
    closed_by_shutdown = pool.closed
    if not closed_by_shutdown:
        await pool.close()  # a leaked pool would hold the test process open at exit
    # A refused Postgres answers at once, as with no pool; a silent one holds the inline steps
    # to the shared 5 s budget either way (U10).
    bound = 2 if postgres == "refused" else 6
    assert entered < bound, f"{entered:.1f}s: the inline startup steps must not wait on the pool"
    checks = r.json()["checks"]
    assert r.status_code == 503 and checks["postgres"]["ok"] is False
    assert checks["allowlist"]["ok"] is False, "the allowlist sync borrows and cannot pass"
    assert closed_by_shutdown and store._pool is None, "shutdown closes the pool"


async def test_a_bad_pool_size_refuses_to_start(monkeypatch, refused_pg):
    monkeypatch.setenv("PG_DSN", refused_pg.dsn)
    monkeypatch.setenv("PG_POOL_MAX_SIZE", "0")
    application = create_app(queue=FakeQueue())
    with pytest.raises(RuntimeError, match="PG_POOL_MAX_SIZE"):
        async with application.router.lifespan_context(application):
            pytest.fail("listened with PG_POOL_MAX_SIZE=0")
