"""U29: Postgres credentials from SAS, offline (apps/server/proto/pg_credentials.py).

The fake SAS is a ``fetch`` callable handing out fchDatabase objects in turn; the fake
connector raises psycopg's own OperationalError with libpq's message, the way psycopg 3.3
raises a connect-phase auth failure (no sqlstate). The real-Postgres half, a real
``ALTER ROLE`` rotation, is test_proto_pg_credentials_pg.py.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from urllib.parse import quote

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

from proto import pg_credentials as pc

URL = "jdbc:postgresql://db.example.org:5433/proto"
AUTH_FAIL = 'connection failed: connection to server at "10.0.0.1", port 5432 failed: ' \
            'FATAL:  password authentication failed for user "u"'
HBA_FAIL = 'connection failed: connection to server at "10.0.0.1", port 5432 failed: FATAL:  no pg_hba.conf ' \
           'entry for host "10.0.0.2", user "u", database "proto", no encryption'


def obj(password: str = "pw-one", url: str = URL, **extra: str) -> dict[str, str]:
    return {"fchUser": "svc", "fchPassword": password, "fchDbConnectUrl": url, **extra}


class Sas:
    """A fake SAS: each fetch returns the next object (the last one repeats)."""

    def __init__(self, *objects) -> None:
        self.objects = list(objects)
        self.calls = 0

    def __call__(self, name: str):
        assert name == "fch-db"
        self.calls += 1
        item = self.objects[min(self.calls, len(self.objects)) - 1]
        if isinstance(item, BaseException):
            raise item
        return item


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def sas_creds(sas: Sas, clock: Clock | None = None) -> pc.PgCredentials:
    return pc.PgCredentials(mode="sas", sas_object="fch-db", fetch=sas, clock=clock or Clock())


class Connector:
    """Raises ``fail`` for every DSN in ``bad``; records each DSN it is called with."""

    def __init__(self, bad: set[str], fail: str = AUTH_FAIL) -> None:
        self.bad, self.fail, self.dsns = bad, fail, []

    def __call__(self, dsn: str, **kw):
        self.dsns.append(dsn)
        assert kw == {"connect_timeout": 3}
        if dsn in self.bad:
            raise psycopg.OperationalError(self.fail)
        return ("conn", dsn)


INTERVAL = 30  # D4: at most one SAS fetch every 30 s
DSN1 = pc.jdbc_to_dsn(obj("pw-one"))
DSN2 = pc.jdbc_to_dsn(obj("pw-two"))


# ── jdbc_to_dsn ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("url, extra, host, port, db", [
    ("jdbc:postgresql://db.example.org:5433/proto", {}, "db.example.org", "5433", "proto"),
    ("jdbc:postgresql://db.example.org/proto", {}, "db.example.org", "5432", "proto"),
    ("jdbc:postgresql://db.example.org:5432/proto?ssl=true&sslmode=require&ApplicationName=x", {},
     "db.example.org", "5432", "proto"),
    ("jdbc:postgresql://db.example.org:5432/", {"fchDbName": "fromname"}, "db.example.org", "5432", "fromname"),
    ("jdbc:postgresql://db.example.org:5432?ssl=true", {"fchDbName": "fromname"}, "db.example.org", "5432",
     "fromname"),
    ("jdbc:postgresql://[::1]:5434/proto", {}, "::1", "5434", "proto"),
], ids=["host-port-db", "default-port", "params-dropped", "db-from-name", "db-from-name-query", "ipv6"])
def test_jdbc_to_dsn(url, extra, host, port, db):
    dsn = pc.jdbc_to_dsn(obj(url=url, **extra))
    assert "?" not in dsn and "ssl" not in dsn.lower()
    parsed = conninfo_to_dict(dsn)
    assert (parsed["host"], parsed["port"], parsed["dbname"], parsed["user"], parsed["password"]) == \
        (host, port, db, "svc", "pw-one")


def test_a_hostile_password_round_trips():
    password = "p@ss:w/rd%41?#& x"
    dsn = pc.jdbc_to_dsn({**obj(password), "fchUser": "us@r:x"})
    parsed = conninfo_to_dict(dsn)
    assert parsed["password"] == password and parsed["user"] == "us@r:x" and parsed["host"] == "db.example.org"


@pytest.mark.parametrize("bad, names", [
    ({"fchDbConnectUrl": "jdbc:mysql://db.example.org:3306/proto"}, "fchDbConnectUrl"),
    ({"fchDbConnectUrl": "jdbc:postgresql://a.example.org:5432,b.example.org:5432/proto"}, "fchDbConnectUrl"),
    ({"fchDbConnectUrl": "jdbc:postgresql:proto"}, "fchDbConnectUrl"),
    ({"fchDbConnectUrl": "jdbc:postgresql://db.example.org:notaport/proto"}, "fchDbConnectUrl"),
    ({"fchDbConnectUrl": "jdbc:postgresql://db.example.org:/proto"}, "fchDbConnectUrl"),
    ({"fchDbConnectUrl": "jdbc:postgresql://db.example.org:5432/"}, "fchDbName"),
    ({"fchUser": ""}, "fchUser"),
    ({"fchPassword": None}, "fchPassword"),
    ({"fchDbConnectUrl": ""}, "fchDbConnectUrl"),
], ids=["mysql", "multi-host", "no-host", "bad-port", "empty-port", "no-db", "no-user", "no-password", "no-url"])
def test_jdbc_to_dsn_refuses(bad, names):
    item = {**obj("zz-secret-value"), **bad}
    with pytest.raises(pc.PgCredentialsError) as info:
        pc.jdbc_to_dsn(item)
    assert names in str(info.value)
    assert "zz-secret-value" not in str(info.value) and "db.example.org" not in str(info.value)


@pytest.mark.parametrize("missing", ["fchUser", "fchPassword", "fchDbConnectUrl"])
def test_jdbc_to_dsn_names_each_missing_field(missing):
    item = obj()
    del item[missing]
    with pytest.raises(pc.PgCredentialsError, match=missing):
        pc.jdbc_to_dsn(item)


# ── is_auth_failure ──────────────────────────────────────────────────────────────


class Sqlstate28P01(psycopg.OperationalError):
    sqlstate = "28P01"


class Sqlstate28000(psycopg.OperationalError):
    sqlstate = "28000"


@pytest.mark.parametrize("exc, expected", [
    (psycopg.OperationalError(AUTH_FAIL), True),
    (Sqlstate28P01("x"), True),
    (psycopg.OperationalError(HBA_FAIL), False),
    (Sqlstate28000(HBA_FAIL), False),
    (psycopg.OperationalError("connection refused"), False),
    (RuntimeError(AUTH_FAIL), False),
], ids=["message", "28P01", "pg_hba", "28000", "refused", "not-operational"])
def test_is_auth_failure(exc, expected):
    assert pc.is_auth_failure(exc) is expected


# ── from_env ─────────────────────────────────────────────────────────────────────


def from_env(env: dict[str, str], default: str | None = "postgresql://d@h/db") -> pc.PgCredentials:
    return pc.PgCredentials.from_env(dsn_var="PG_DSN", sas_var="PG_SAS_OBJECT", default=default, env=env)


def test_from_env_precedence(monkeypatch):
    monkeypatch.setattr(pc, "sas_installed", lambda: True)
    monkeypatch.setattr(pc, "_fetch_sas_object", lambda name: pytest.fail("env mode fetched from SAS"))
    neither = from_env({})
    assert (neither.mode, neither.dsn(), neither.problem, neither.description) == \
        ("env", "postgresql://d@h/db", None, "environment DSN")
    empty = from_env({"PG_DSN": "", "PG_SAS_OBJECT": ""})
    assert (empty.mode, empty.dsn(), empty.problem) == ("env", "postgresql://d@h/db", None)
    dsn_only = from_env({"PG_DSN": "postgresql://e@h/db"})
    assert (dsn_only.mode, dsn_only.dsn(), dsn_only.problem) == ("env", "postgresql://e@h/db", None)
    assert dsn_only.refresh_after("postgresql://e@h/db") is None
    sas_only = from_env({"PG_SAS_OBJECT": "fch-db"})
    assert (sas_only.mode, sas_only.cached(), sas_only.problem, sas_only.description) == \
        ("sas", None, None, "SAS object fch-db")
    both = from_env({"PG_DSN": "postgresql://e@h/db", "PG_SAS_OBJECT": "fch-db"})
    assert both.problem == "both PG_DSN and PG_SAS_OBJECT are set; set one"


def test_from_env_with_no_default_has_no_dsn():
    creds = from_env({}, default=None)
    assert creds.cached() is None and creds.problem is None
    with pytest.raises(pc.PgCredentialsUnavailable, match="no PG_DSN"):
        creds.dsn()


def test_from_env_flags_sas_without_the_client(monkeypatch):
    monkeypatch.setattr(pc, "sas_installed", lambda: False)
    creds = from_env({"PG_SAS_OBJECT": "fch-db"})
    assert creds.problem and "PG_SAS_OBJECT is set but the sas_client package is not installed" in creds.problem


def test_from_env_uses_the_module_fetch(monkeypatch):
    monkeypatch.setattr(pc, "sas_installed", lambda: True)
    monkeypatch.setattr(pc, "_fetch_sas_object", Sas(obj()))
    assert from_env({"PG_SAS_OBJECT": "fch-db"}).dsn() == DSN1


def test_sas_installed_reads_the_module_name(monkeypatch):
    monkeypatch.setattr(pc, "SAS_MODULE", "json")
    assert pc.sas_installed()
    monkeypatch.setattr(pc, "SAS_MODULE", "no_such_module_u29")
    assert not pc.sas_installed()


# ── connect ──────────────────────────────────────────────────────────────────────


def test_connect_reresolves_once_after_a_rotation():
    sas, clock = Sas(obj("pw-one"), obj("pw-two")), Clock()
    creds = sas_creds(sas, clock)
    assert pc.connect(creds, Connector(set()), connect_timeout=3) == ("conn", DSN1)
    clock.now += INTERVAL
    connector = Connector({DSN1})
    assert pc.connect(creds, connector, connect_timeout=3) == ("conn", DSN2)
    assert connector.dsns == [DSN1, DSN2] and sas.calls == 2 and creds.cached() == DSN2


@pytest.mark.parametrize("fail", [HBA_FAIL, "connection refused"], ids=["pg_hba", "refused"])
def test_connect_does_not_reresolve_other_errors(fail):
    sas, clock = Sas(obj("pw-one"), obj("pw-two")), Clock()
    creds = sas_creds(sas, clock)
    creds.dsn()
    clock.now += INTERVAL
    connector = Connector({DSN1}, fail)
    with pytest.raises(psycopg.OperationalError, match=fail.split(":")[0]):
        pc.connect(creds, connector, connect_timeout=3)
    assert connector.dsns == [DSN1] and sas.calls == 1


def test_connect_does_not_retry_the_same_password():
    sas, clock = Sas(obj("pw-one")), Clock()
    creds = sas_creds(sas, clock)
    creds.dsn()
    clock.now += INTERVAL
    connector = Connector({DSN1})
    with pytest.raises(psycopg.OperationalError, match="password authentication failed"):
        pc.connect(creds, connector, connect_timeout=3)
    assert connector.dsns == [DSN1] and sas.calls == 2


def test_connect_after_a_peer_rotated_retries_with_no_fetch():
    sas, clock = Sas(obj("pw-one"), obj("pw-two")), Clock()
    creds = sas_creds(sas, clock)
    creds.dsn()
    clock.now += INTERVAL
    assert creds.refresh_after(DSN1) == DSN2  # a peer's failed connect rotated the holder
    assert sas.calls == 2
    assert creds.refresh_after(DSN1) == DSN2
    assert creds.refresh_after("postgresql://not:issued@h/db") is None, "only a DSN this holder issued"
    assert sas.calls == 2


def test_env_mode_never_retries():
    creds = pc.PgCredentials.fixed(DSN1)
    connector = Connector({DSN1})
    with pytest.raises(psycopg.OperationalError):
        pc.connect(creds, connector, connect_timeout=3)
    assert connector.dsns == [DSN1]


# ── the rate limit ───────────────────────────────────────────────────────────────


def test_the_interval_is_thirty_seconds():
    assert pc.MIN_REFRESH_INTERVAL_S == INTERVAL


def test_two_failures_inside_the_interval_fetch_once():
    sas, clock = Sas(obj("pw-one"), obj("pw-one"), obj("pw-two")), Clock()
    creds = sas_creds(sas, clock)
    creds.dsn()
    clock.now += INTERVAL
    assert creds.refresh_after(DSN1) is None  # SAS has not published the rotation yet
    clock.now += INTERVAL - 1
    assert creds.refresh_after(DSN1) is None
    assert sas.calls == 2
    clock.now += 1
    assert creds.refresh_after(DSN1) == DSN2
    assert sas.calls == 3


def test_concurrent_failures_fetch_once():
    sas, clock = Sas(obj("pw-one"), obj("pw-two")), Clock()
    creds = sas_creds(sas, clock)
    creds.dsn()
    clock.now += INTERVAL
    barrier = threading.Barrier(20, timeout=10)
    results: list[object] = []

    class AllFailFirst(Connector):
        def __call__(self, dsn, **kw):
            if dsn == DSN1:
                barrier.wait()  # every thread has tried the old password before any refresh
            return super().__call__(dsn, **kw)

    def worker():
        results.append(pc.connect(creds, AllFailFirst({DSN1}), connect_timeout=3))

    threads = [threading.Thread(target=worker) for _ in range(20)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results == [("conn", DSN2)] * 20 and sas.calls == 2


def test_an_unreachable_sas_is_rate_limited_and_heals():
    sas, clock = Sas(TimeoutError("t"), obj("pw-one")), Clock()
    creds = sas_creds(sas, clock)
    with pytest.raises(pc.PgCredentialsUnavailable):
        creds.dsn()
    with pytest.raises(pc.PgCredentialsUnavailable):
        creds.dsn()
    assert sas.calls == 1
    clock.now += pc.MIN_FETCH_INTERVAL_S
    assert creds.dsn() == DSN1 and sas.calls == 2


def test_a_first_fetch_is_not_held_to_the_refresh_interval():
    """A caller's own backoff (migrate: 1, 2, 4, 8 s) must reach SAS each time; only a
    re-read after an auth failure waits MIN_REFRESH_INTERVAL_S."""
    assert pc.MIN_FETCH_INTERVAL_S <= 1 < INTERVAL
    sas, clock = Sas(TimeoutError("a"), TimeoutError("b"), obj("pw-one")), Clock()
    creds = sas_creds(sas, clock)
    for step in (1, 2):
        with pytest.raises(pc.PgCredentialsUnavailable):
            creds.dsn()
        clock.now += step
    assert creds.dsn() == DSN1 and sas.calls == 3


def test_the_window_starts_when_a_slow_fetch_ends():
    """Callers queued on the lock behind a slow failure do not each fetch again."""
    clock = Clock()

    def slow(name):
        clock.now += 10  # the SAS client timed out
        raise TimeoutError("slow")
    creds = sas_creds(Sas(), clock)
    creds._fetch = slow
    with pytest.raises(pc.PgCredentialsUnavailable, match="TimeoutError"):
        creds.dsn()
    with pytest.raises(pc.PgCredentialsUnavailable):
        creds.dsn()  # the next queued caller, at the same instant the fetch ended
    assert clock.now == 1010.0, "fetched once"


def test_a_malformed_sas_object_after_start_is_unavailable_not_a_crash():
    """dsn() past start: an OperationalError every store-unreachable arm handles, naming
    the field and never the value."""
    creds = sas_creds(Sas({"fchUser": "svc", "fchPassword": "zz-secret"}))
    with pytest.raises(pc.PgCredentialsUnavailable, match="unusable.*fchDbConnectUrl") as info:
        creds.dsn()
    assert isinstance(info.value, psycopg.OperationalError) and info.value.sqlstate is None
    assert "zz-secret" not in str(info.value)


def test_check_at_start_refuses_a_malformed_object():
    creds = sas_creds(Sas({"fchUser": "svc", "fchPassword": "zz-secret"}))
    with pytest.raises(pc.PgCredentialsError, match="fchDbConnectUrl") as info:
        creds.check_at_start()
    assert "zz-secret" not in str(info.value)


def test_check_at_start_lets_an_unreachable_sas_through_and_caches_a_good_one():
    down = sas_creds(Sas(TimeoutError("down")))
    assert down.check_at_start() is None and down.cached() is None
    sas = Sas(obj("pw-one"))
    up = sas_creds(sas)
    up.check_at_start()
    assert up.cached() == DSN1 and up.dsn() == DSN1 and sas.calls == 1
    up.check_at_start()
    assert sas.calls == 1, "a cached DSN is not re-read"
    pc.PgCredentials.fixed(DSN1).check_at_start()  # env mode: nothing to fetch


# ── aconnect ─────────────────────────────────────────────────────────────────────


def test_aconnect_reresolves_once_after_a_rotation():
    sas, clock = Sas(obj("pw-one"), obj("pw-two")), Clock()
    creds = sas_creds(sas, clock)
    dsns: list[str] = []

    async def connector(dsn, **kw):
        dsns.append(dsn)
        if dsn == DSN1 and len(dsns) > 1:
            raise psycopg.OperationalError(AUTH_FAIL)
        return dsn

    async def run():
        first = await pc.aconnect(creds, connector)
        clock.now += INTERVAL
        return first, await pc.aconnect(creds, connector)

    assert asyncio.run(run()) == (DSN1, DSN2)
    assert dsns == [DSN1, DSN1, DSN2] and sas.calls == 2


def test_aconnect_with_an_unreachable_sas_raises_unavailable():
    creds = sas_creds(Sas(OSError("down")))

    async def connector(dsn, **kw):
        pytest.fail("connected with no DSN")

    with pytest.raises(pc.PgCredentialsUnavailable) as info:
        asyncio.run(pc.aconnect(creds, connector))
    assert isinstance(info.value, psycopg.OperationalError) and info.value.sqlstate is None


# ── redaction ────────────────────────────────────────────────────────────────────


def test_scrub_removes_a_fetched_password_raw_and_quoted():
    password = "zz-rot/ated:pw@1"
    creds = sas_creds(Sas(obj(password)))
    dsn = creds.dsn()
    text = f"raw {password} quoted {quote(password, safe='')} dsn {dsn}"
    scrubbed = pc.scrub(text)
    assert password not in scrubbed and quote(password, safe="") not in scrubbed
    assert scrubbed.startswith("raw <redacted> quoted <redacted>")


def test_a_sas_failure_never_carries_its_message(caplog):
    secret = "zz-sas-leak-" + "x" * 8
    creds = sas_creds(Sas(RuntimeError(f"bad object {secret}")))
    caplog.set_level(logging.DEBUG)
    with pytest.raises(pc.PgCredentialsUnavailable) as info:
        creds.dsn()
    exc = info.value
    label = getattr(exc, "sqlstate", None) or type(exc).__name__
    assert label == "PgCredentialsUnavailable"
    assert secret not in str(exc) and "RuntimeError" in str(exc)
    assert exc.__cause__ is None and exc.__context__ is None
    assert secret not in caplog.text and "RuntimeError" in caplog.text


def test_a_failed_refresh_never_logs_the_password(caplog):
    sas, clock = Sas(obj("zz-pass-one"), RuntimeError("zz-pass-two leaked"), obj("zz-pass-two")), Clock()
    creds = sas_creds(sas, clock)
    caplog.set_level(logging.DEBUG)
    creds.dsn()
    clock.now += INTERVAL
    assert creds.refresh_after(creds.cached()) is None
    clock.now += INTERVAL
    assert creds.refresh_after(creds.cached()) is not None
    assert "zz-pass" not in caplog.text and "rotated" in caplog.text
