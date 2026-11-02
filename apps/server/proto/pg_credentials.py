"""Postgres credentials from the environment or from SAS (handoff U29).

Each tier builds one ``PgCredentials`` with ``from_env``: the DSN variable as today, or a
SAS object name, whose fchDatabase object becomes a URL DSN. Every connect goes through
``connect``/``aconnect``, which re-resolve once on an invalid password (a rotation) and
retry with the new DSN. A re-read after a failed authentication fetches at most once every
``MIN_REFRESH_INTERVAL_S`` per holder; a first fetch with nothing cached, at most once every
``MIN_FETCH_INTERVAL_S``, so a caller's own retries (migrate's backoff) each reach SAS.
``check_at_start`` turns an unusable SAS object into ``PgCredentialsError`` before a tier
serves; after start, ``dsn()`` raises it as ``PgCredentialsUnavailable``, which every
store-unreachable path already handles.
Stdlib and psycopg only; the SAS client is imported lazily, in ``_fetch_sas_object``.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import importlib
import importlib.util
import logging
import os
import re
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import quote

import psycopg

SAS_MODULE = "sas_client"
MIN_REFRESH_INTERVAL_S = 30.0
MIN_FETCH_INTERVAL_S = 0.5

log = logging.getLogger("pg_credentials")

_JDBC = re.compile(r"^jdbc:postgresql://([^/?,]+)(/[^?]*)?(\?.*)?$")
_SECRETS: set[str] = set()
_SECRETS_LOCK = threading.Lock()


class PgCredentialsError(Exception):
    """A configuration error: refuse to start. Raised only by ``jdbc_to_dsn`` and
    ``check_at_start``; ``dsn()`` reports an unusable object as ``PgCredentialsUnavailable``."""


class PgCredentialsUnavailable(psycopg.OperationalError):
    """No DSN yet: SAS unreachable or unusable, rate-limited, or no DSN configured. No sqlstate."""


def sas_installed() -> bool:
    return importlib.util.find_spec(SAS_MODULE) is not None


def _fetch_sas_object(name: str) -> Mapping[str, str]:
    """The only SAS client call (sas-client 0.2.1.16: an async ``get_secure_object``). A new
    client per call, so no client cache returns a stale password."""
    client_class = importlib.import_module(SAS_MODULE + ".sas_client").SasClient

    def run() -> Mapping[str, str]:
        return asyncio.run(client_class().get_secure_object(sas_object_name=name))

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return run()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(run).result()


def jdbc_to_dsn(obj: Mapping[str, Any]) -> str:
    """``postgresql://user:password@host:port/db`` from an fchDatabase object. JDBC
    parameters are dropped. Errors name the field, never its value."""
    if not isinstance(obj, Mapping):
        raise PgCredentialsError("the SAS object is not a mapping")
    for name in ("fchUser", "fchPassword", "fchDbConnectUrl"):
        if not isinstance(obj.get(name), str) or not obj[name]:
            raise PgCredentialsError(f"the SAS object has no {name}")
    m = _JDBC.match(obj["fchDbConnectUrl"])
    if not m or "@" in m.group(1):
        raise PgCredentialsError("fchDbConnectUrl is not a single-host jdbc:postgresql:// URL")
    hostport = m.group(1)
    if hostport.startswith("["):
        end = hostport.find("]")
        if end < 0:
            raise PgCredentialsError("fchDbConnectUrl has a malformed IPv6 host")
        host, rest = hostport[: end + 1], hostport[end + 1:]
        if rest and not rest.startswith(":"):
            raise PgCredentialsError("fchDbConnectUrl has a malformed IPv6 host")
        port = rest[1:] if rest else ""
    else:
        host, sep, port = hostport.partition(":")
        if sep and not port:
            raise PgCredentialsError("fchDbConnectUrl has no usable host:port")
    if not host or (port and not (port.isdigit() and 0 < int(port) < 65536)):
        raise PgCredentialsError("fchDbConnectUrl has no usable host:port")
    db = (m.group(2) or "").strip("/")
    if not db:
        db_name = obj.get("fchDbName")
        if not isinstance(db_name, str) or not db_name:
            raise PgCredentialsError("fchDbConnectUrl names no database and the SAS object has no fchDbName")
        db = db_name
    user, password = obj["fchUser"], obj["fchPassword"]
    return f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port or 5432}/{quote(db, safe='')}"


def is_auth_failure(exc: BaseException) -> bool:
    """An invalid password: 28P01, or libpq's English message when the connect error has no
    sqlstate (psycopg 3.3 raises connect failures without one). Never 28000."""
    if not isinstance(exc, psycopg.OperationalError):
        return False
    return getattr(exc, "sqlstate", None) == "28P01" or "password authentication failed" in str(exc)


def _register(password: str) -> None:
    if password:
        with _SECRETS_LOCK:
            _SECRETS.update({password, quote(password, safe="")})


def scrub(text: str) -> str:
    """``text`` with every password a holder has fetched taken out, raw and URL-quoted."""
    with _SECRETS_LOCK:
        secrets = sorted(_SECRETS, key=len, reverse=True)
    for secret in secrets:
        text = text.replace(secret, "<redacted>")
    return text


class PgCredentials:
    def __init__(self, *, mode: str, dsn: str | None = None, sas_object: str | None = None,
                 fetch: Callable[[str], Mapping[str, Any]] | None = None,
                 clock: Callable[[], float] = time.monotonic,
                 min_interval_s: float | None = None, dsn_var: str = "PG_DSN") -> None:
        if mode not in ("env", "sas"):
            raise ValueError(f"mode is env or sas, not {mode!r}")
        if mode == "sas" and not sas_object:
            raise ValueError("sas mode needs sas_object")
        self.mode = mode
        self.problem: str | None = None
        self._dsn = dsn or None
        self._sas_object = sas_object
        self._fetch = fetch
        self._clock = clock
        self._min_interval_s = min_interval_s
        self._dsn_var = dsn_var
        self._lock = threading.Lock()
        self._last_fetch: float | None = None
        self._issued: set[str] = set()

    @classmethod
    def fixed(cls, dsn: str) -> PgCredentials:
        return cls(mode="env", dsn=dsn)

    @classmethod
    def from_env(cls, *, dsn_var: str, sas_var: str, default: str | None,
                 env: Mapping[str, str] | None = None) -> PgCredentials:
        """Never raises; a configuration error is left in ``problem``."""
        env = os.environ if env is None else env
        dsn, sas_object = env.get(dsn_var, ""), env.get(sas_var, "")
        if sas_object and dsn:
            creds = cls(mode="env", dsn=dsn, dsn_var=dsn_var)
            creds.problem = f"both {dsn_var} and {sas_var} are set; set one"
        elif sas_object:
            creds = cls(mode="sas", sas_object=sas_object, dsn_var=dsn_var)
            if not sas_installed():
                creds.problem = (f"{sas_var} is set but the {SAS_MODULE} package is not installed "
                                 f"(FamilySearch's build installs it; use {dsn_var} elsewhere)")
        else:
            creds = cls(mode="env", dsn=dsn or default, dsn_var=dsn_var)
        return creds

    @property
    def description(self) -> str:
        return f"SAS object {self._sas_object}" if self.mode == "sas" else "environment DSN"

    def cached(self) -> str | None:
        return self._dsn

    def _refresh_interval(self) -> float:
        return MIN_REFRESH_INTERVAL_S if self._min_interval_s is None else self._min_interval_s

    def check_at_start(self) -> None:
        """One SAS fetch before a tier serves: an unusable object raises ``PgCredentialsError``
        (refuse to start, D5); an unreachable SAS is an outage and returns, logged."""
        if self.mode == "env":
            return
        with self._lock:
            if self._dsn:
                return
            _dsn, _failure, config = self._fetch_locked(interval=0.0)
        if config is not None:
            raise PgCredentialsError(str(config))

    def dsn(self) -> str:
        if self.mode == "env":
            if not self._dsn:
                raise PgCredentialsUnavailable(f"no {self._dsn_var}")
            return self._dsn
        with self._lock:
            if self._dsn:
                return self._dsn
            new, failure, config = self._fetch_locked(
                interval=min(MIN_FETCH_INTERVAL_S, self._refresh_interval()))
        if new is not None:
            return new
        if config is not None:
            raise PgCredentialsUnavailable(f"SAS object {self._sas_object} unusable ({config})")
        if failure is not None:
            raise PgCredentialsUnavailable(f"SAS object {self._sas_object} unavailable ({failure})")
        raise PgCredentialsUnavailable(f"SAS object {self._sas_object} unavailable")

    def refresh_after(self, failed_dsn: str) -> str | None:
        """A DSN to retry with after ``failed_dsn`` failed authentication, or None."""
        if self.mode == "env":
            return None
        with self._lock:
            current = self._dsn
            if current and current != failed_dsn and failed_dsn in self._issued:
                return current
            new, _failure, _config = self._fetch_locked(interval=self._refresh_interval())
        return new if new and new != failed_dsn else None

    def _fetch_locked(self, *, interval: float) -> tuple[str | None, str | None, PgCredentialsError | None]:
        """(dsn, failure label, configuration error); all None when rate-limited. The window
        runs from the end of the last fetch, so callers queued on the lock behind a slow
        failure do not each fetch again."""
        if self._last_fetch is not None and self._clock() - self._last_fetch < interval:
            return None, None, None
        failure: str | None = None
        config: PgCredentialsError | None = None
        try:
            obj = (self._fetch or _fetch_sas_object)(self._sas_object)
            dsn = jdbc_to_dsn(obj)
            _register(obj["fchPassword"])
        except PgCredentialsError as e:
            config = e
        except Exception as e:  # noqa: BLE001 - the SAS client's message may carry the secret
            failure = type(e).__name__
        finally:
            self._last_fetch = self._clock()
        if config is not None:
            log.warning("ev=pg_credentials error=config object=%s detail=%s", self._sas_object, config)
            return None, None, config
        if failure is not None:
            log.warning("ev=pg_credentials error=%s object=%s", failure, self._sas_object)
            return None, failure, None
        if self._dsn and dsn != self._dsn:
            log.info("ev=pg_credentials rotated object=%s", self._sas_object)
        self._dsn = dsn
        self._issued.add(dsn)
        return dsn, None, None


def connect(creds: PgCredentials, connector: Callable[..., Any], /, **kw: Any) -> Any:
    dsn = creds.dsn()
    try:
        return connector(dsn, **kw)
    except psycopg.OperationalError as e:
        if is_auth_failure(e):
            new = creds.refresh_after(dsn)
            if new:
                return connector(new, **kw)
        raise


async def aconnect(creds: PgCredentials, connector: Callable[..., Any], /, **kw: Any) -> Any:
    dsn = creds.cached() or await asyncio.to_thread(creds.dsn)
    try:
        return await connector(dsn, **kw)
    except psycopg.OperationalError as e:
        if is_auth_failure(e):
            new = None if creds.mode == "env" else await asyncio.to_thread(creds.refresh_after, dsn)
            if new:
                return await connector(new, **kw)
        raise
