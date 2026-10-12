"""FamilySearch grant custody, shared by the web tier and the worker (U3; list 3 step 19).

The web tier holds each patron's grant encrypted in ``familysearch_tokens`` and is its
only refresher; the worker reads the current grant at the start of every attempt. This
module is what both tiers agree on, so neither can drift from the other: the Fernet
derivation, the lock keys, every grant SQL statement, the thresholds and the pure
decisions. Both images copy it, as they copy ``enqueue.py`` (the web image as
``/app/grants.py``, imported as ``grants``; the worker image as ``proto/grants.py``,
imported as ``proto.grants``). Stdlib and ``cryptography`` only.

The locks (two-int4 advisory keys, ``(namespace, hashtext(user_id))`` -- the queue lock's
second half is ``hashtext(session_id)`` -- so the engine's single-bigint
``pg_advisory_xact_lock(hashtext(projectId))`` space never overlaps):

  ATTEMPT_LOCK_NS  each worker attempt holds it SHARED, session-level, on a dedicated
                   connection, from just before it reads the grant until its CLI is
                   dead. A refresher must win it EXCLUSIVELY with a try, so no refresh
                   ever lands while any attempt of that patron is live -- a refresh
                   revokes the previous access token at once (2026-09-23).
  WRITE_LOCK_NS    a refresher holds it for the whole refresh (a try); the sign-in
                   callback takes it in its write transaction (blocking, bounded). A
                   second sign-in does not revoke the first token (U2), so the callback
                   never waits on a live attempt.
  QUEUE_LOCK_NS    (U23) transaction-scoped, per session: each tier holds it across its
                   "is a turn running?" check and the claim or insert that acts on the
                   answer -- the worker releasing a held message, the web tier admitting
                   one -- so the two can never both start a turn on one session. Taken
                   inside an explicit transaction (an autocommit statement would drop it
                   at once), never on the grant connection, and never across an SQS send.
                   The wait is bounded (``QUEUE_LOCK_TIMEOUT_SQL``), as the write lock's is.

A ``hashtext`` collision between two patrons only over-serializes them (a refresh is
skipped), never lets one through. Every namespace is cast ``::int4``. psycopg 3 types a
Python int by its value (these go as ``smallint``, which resolves; measured 2026-10-02), so
the cast is not load-bearing today: it pins the two-int4 overload, so a parameter typed
wider -- an ``int8`` from a dumper change or another driver -- cannot reach the
``(bigint, integer)`` form that does not exist.

The session (FamilySearch documentation): 8 h idle, 24 h at most, and a refresh starts a
new session. A session therefore lives at least until ``start + 8 h`` whatever it was
used for; ``session_started_at`` (009) records the start, and ages here are computed by
Postgres's ``now()``, so no host clock enters.
"""

from __future__ import annotations

import base64
import hashlib
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

# The alpha's development default (apps/server/app/config.py), kept identical so a grant
# either tier wrote under it decrypts in the other. web/auth.py's preflight refuses it on
# an https PUBLIC_URL or with FamilySearch sign-in on.
DEV_FS_TOKEN_ENC_KEY = "dev-insecure-fs-token-key-change-me"

# -- locks -----------------------------------------------------------------------

ATTEMPT_LOCK_NS = 30301
WRITE_LOCK_NS = 30302
QUEUE_LOCK_NS = 30303

# -- thresholds ------------------------------------------------------------------

SESSION_IDLE_S = 8 * 60 * 60
SESSION_MAX_S = 24 * 60 * 60
# The web tier refreshes a patron with an open turn whose session is this old (or whose
# last refresh was ambiguous): at most one refresh an hour per active patron.
DEFAULT_REFRESH_AGE_S = 3600
DEFAULT_REFRESH_INTERVAL_S = 30
# An attempt starts only on a session this young: 8 h less one attempt at the base shim's
# 1,800 s ceiling less 600 s, so no attempt the shim kills at its ceiling can outlive the
# session's guaranteed life. Under docker-compose.sqsd.yml nothing kills an attempt, so
# there no start age is a guarantee (until U26); the value is the same everywhere.
DEFAULT_MAX_START_AGE_S = SESSION_IDLE_S - 1800 - 600
DEFAULT_WAIT_S = 300
WAIT_POLL_S = 5
# The refresh POST's ONE total deadline (asyncio.timeout around the whole call; httpx's
# own timeout is per phase). It bounds how long a refresher holds both locks, so the two
# lock waits below must exceed it plus the two single-row transactions.
REFRESH_HTTP_TIMEOUT_S = 30
ATTEMPT_LOCK_TIMEOUT_S = 60
WRITE_LOCK_TIMEOUT_S = 45
# The queue lock is held for a few single-row statements, so a wait this long means a
# holder that is not coming back (a host lost mid-transaction holds it until keepalive).
QUEUE_LOCK_TIMEOUT_S = 5.0
DUE_BATCH = 50

# Server-side keepalives for a connection that holds a session lock: a host that vanishes
# without a RST ends its backend in about two minutes rather than TCP's ~15.
GRANT_KEEPALIVE_OPTIONS = (
    "-c tcp_keepalives_idle=60 -c tcp_keepalives_interval=10 -c tcp_keepalives_count=6 "
    "-c tcp_user_timeout=30000"
)

# refresh_refused_reason when the stored ciphertext does not decrypt under this key.
UNDECRYPTABLE = "undecryptable"

# -- SQL ---------------------------------------------------------------------------

OWNER_SQL = "SELECT owner_id FROM projects WHERE project_id = %s"
ATTEMPT_LOCK_SQL = "SELECT pg_advisory_lock_shared(%s::int4, hashtext(%s))"
ATTEMPT_UNLOCK_SQL = "SELECT pg_advisory_unlock_shared(%s::int4, hashtext(%s))"
# Whether backend ``pid`` still holds its attempt lock. The lock connection holds exactly
# one advisory lock, so its pid plus the namespace identifies it; asked on ANOTHER
# connection, because a dead lock connection cannot answer for itself.
ATTEMPT_LOCK_HELD_SQL = (
    "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = %s AND granted "
    "AND classid = %s::int4::oid AND objsubid = 2"
)
TRY_LOCK_SQL = "SELECT pg_try_advisory_lock(%s::int4, hashtext(%s))"
WRITE_XACT_LOCK_SQL = "SELECT pg_advisory_xact_lock(%s::int4, hashtext(%s))"
QUEUE_LOCK_SQL = "SELECT pg_advisory_xact_lock(%s::int4, hashtext(%s))"
# Before QUEUE_LOCK_SQL, in the same transaction; the value is ``queue_lock_timeout(s)``.
QUEUE_LOCK_TIMEOUT_SQL = "SELECT set_config('lock_timeout', %s, true)"
WRITE_LOCK_TIMEOUT_SQL = f"SET LOCAL lock_timeout = '{WRITE_LOCK_TIMEOUT_S}s'"
_SESSION_START = "COALESCE(session_started_at, granted_at)"
GRANT_SQL = (
    "SELECT user_id, access_token_enc, refresh_token_enc, "
    f"EXTRACT(EPOCH FROM now() - {_SESSION_START})::float8 AS age_s, "
    "refresh_started_at IS NOT NULL AS refresh_pending, "
    "refresh_refused_at IS NOT NULL AS refused, refresh_refused_reason "
    "FROM familysearch_tokens WHERE user_id = %s"
)
GRANT_FOR_UPDATE_SQL = GRANT_SQL + " FOR UPDATE"
# The refresher's candidates: not refused, renewable, old enough (or marked), and owning an
# open turn -- held rows included, since a held message runs soon. The open-turn clause
# bounds the work to patrons who need FamilySearch soon; it is not a safety check (the
# lock is).
DUE_SQL = (
    "SELECT ft.user_id, EXTRACT(EPOCH FROM now() - COALESCE(ft.session_started_at, ft.granted_at))::float8 AS age_s "
    "FROM familysearch_tokens ft "
    "WHERE ft.refresh_refused_at IS NULL AND ft.refresh_token_enc IS NOT NULL "
    "AND (now() - COALESCE(ft.session_started_at, ft.granted_at) >= make_interval(secs => %s) "
    "OR ft.refresh_started_at IS NOT NULL) "
    "AND EXISTS (SELECT 1 FROM projects p JOIN turns t ON t.project_id = p.project_id "
    "WHERE p.owner_id = ft.user_id AND t.completed_at IS NULL) "
    "ORDER BY COALESCE(ft.session_started_at, ft.granted_at) LIMIT %s"
)
MARK_REFRESH_SQL = "UPDATE familysearch_tokens SET refresh_started_at = now(), updated_at = now() WHERE user_id = %s"
# Transaction 2, one per RefreshResult kind (ambiguous keeps the marker; so does a
# not_sent when the marker predates this refresh -- PgStore.refresh_grant).
REFRESH_OK_SQL = (
    "UPDATE familysearch_tokens SET access_token_enc = %s, "
    "refresh_token_enc = COALESCE(%s, refresh_token_enc), session_started_at = now(), "
    "expires_at = now() + make_interval(secs => %s), refresh_started_at = NULL, "
    "refresh_refused_at = NULL, refresh_refused_reason = NULL, updated_at = now() WHERE user_id = %s"
)
REFRESH_REFUSED_SQL = (
    "UPDATE familysearch_tokens SET refresh_refused_at = now(), refresh_refused_reason = %s, "
    "refresh_started_at = NULL, updated_at = now() WHERE user_id = %s"
)
REFRESH_NOT_SENT_SQL = (
    "UPDATE familysearch_tokens SET refresh_started_at = NULL, updated_at = now() WHERE user_id = %s"
)
REFRESH_AMBIGUOUS_SQL = "UPDATE familysearch_tokens SET updated_at = now() WHERE user_id = %s"


# -- encryption at rest --------------------------------------------------------------


def enc_key(env: Mapping[str, str] | None = None) -> str:
    """``FS_TOKEN_ENC_KEY``, else the development default."""
    value = ((os.environ if env is None else env).get("FS_TOKEN_ENC_KEY") or "").strip()
    return value or DEV_FS_TOKEN_ENC_KEY


def key_mode(env: Mapping[str, str] | None = None) -> str:
    """``default`` or ``set`` -- what a start line may say about the key, never the key."""
    return "default" if enc_key(env) == DEV_FS_TOKEN_ENC_KEY else "set"


def fernet(key: str) -> Fernet:
    """The alpha's derivation (apps/server/app/crypto.py): SHA-256 of the configured
    string, urlsafe-base64 -- so any strong random value works as the key."""
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(key.encode("utf-8")).digest()))


def encrypt(value: str, key: str) -> str:
    return fernet(key).encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str | None, key: str) -> str | None:
    """Soft-fails to None on a value written under another key or not ciphertext at all;
    callers treat None as undecryptable. Never use such a value as plaintext."""
    if value is None:
        return None
    try:
        return fernet(key).decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError):
        return None


# -- pure decisions --------------------------------------------------------------------


def env_seconds(env: Mapping[str, str], name: str, default: float) -> float:
    """A non-negative number of seconds from ``env``; unset, blank, garbage or negative
    gives ``default`` (a typo must not crash-loop a tier at start), and 0 is allowed."""
    raw = (env.get(name) or "").strip()
    if not raw:
        return float(default)
    try:
        value = float(raw)
    except ValueError:
        return float(default)
    return value if value >= 0 else float(default)


def queue_lock_timeout(seconds: float | None = None) -> str:
    """``QUEUE_LOCK_TIMEOUT_SQL``'s value (default ``QUEUE_LOCK_TIMEOUT_S``): whole
    milliseconds, at least 1, since 0 is no limit at all."""
    seconds = QUEUE_LOCK_TIMEOUT_S if seconds is None else seconds
    return f"{max(1, round(seconds * 1000))}ms"


@dataclass(frozen=True)
class GrantRow:
    """One ``GRANT_SQL`` row. ``age_s`` is the current session's age by Postgres's clock."""

    user_id: str
    access_token_enc: str
    refresh_token_enc: str | None
    age_s: float
    refresh_pending: bool
    refused: bool
    refused_reason: str | None

    @classmethod
    def from_row(cls, row: Any) -> GrantRow | None:
        """From a tuple or a dict row in ``GRANT_SQL``'s column order; None for no row."""
        if row is None:
            return None
        if isinstance(row, Mapping):
            row = (row["user_id"], row["access_token_enc"], row["refresh_token_enc"], row["age_s"],
                   row["refresh_pending"], row["refused"], row["refresh_refused_reason"])
        user_id, access, refresh, age, pending, refused, reason = row
        return cls(str(user_id), access, refresh, float(age or 0), bool(pending), bool(refused), reason)


@dataclass(frozen=True)
class Ready:
    token: str


@dataclass(frozen=True)
class Wait:
    reason: str  # refresh_pending | session_age


@dataclass(frozen=True)
class Closed:
    cause: str  # refused | no_grant | no_refresh_token | undecryptable
    reason: str | None = None


def attempt_verdict(
    row: GrantRow | None, *, max_start_age_s: float, decrypt: Callable[[str | None], str | None],
) -> Ready | Wait | Closed:
    """Whether an attempt may start on this grant (read under the attempt lock).

    Closed ends the turn ``signin_required``; Wait releases the lock and polls, so the
    refresher gets its window; Ready bears the token. A grant whose last refresh was
    ambiguous (``refresh_pending``) waits: FamilySearch may already have revoked the
    stored access token, and the next refresh either renews it or is refused."""
    if row is None:
        return Closed("no_grant")
    if row.refused:
        cause = UNDECRYPTABLE if row.refused_reason == UNDECRYPTABLE else "refused"
        return Closed(cause, row.refused_reason)
    token = decrypt(row.access_token_enc)
    if not token:
        return Closed(UNDECRYPTABLE)
    if row.refresh_pending:
        return Wait("refresh_pending")
    if row.age_s > max_start_age_s:
        if not row.refresh_token_enc:
            return Closed("no_refresh_token")
        return Wait("session_age")
    return Ready(token)


def refresh_due(row: GrantRow | None, *, refresh_age_s: float) -> bool:
    """The refresher's re-check on the LOCKED row: another instance may just have done it."""
    if row is None or row.refused or not row.refresh_token_enc:
        return False
    return row.refresh_pending or row.age_s >= refresh_age_s


@dataclass(frozen=True)
class RefreshResult:
    """``ok`` (new tokens), ``refused`` (FamilySearch said no: sign in again), ``not_sent``
    (FamilySearch never processed it: the old token is still good) or ``ambiguous`` (it
    may have processed it and revoked the old token: keep the marker)."""

    kind: str
    access_token: str | None = None
    refresh_token: str | None = None
    reason: str | None = None


def classify_response(status: int, body: Any) -> RefreshResult:
    """A token-endpoint answer as a RefreshResult (RFC 6749 section 5.2 for the refusals)."""
    if status == 200:
        access = body.get("access_token") if isinstance(body, dict) else None
        if isinstance(access, str) and access:
            refresh = body.get("refresh_token")
            return RefreshResult("ok", access, refresh if isinstance(refresh, str) and refresh else None)
        return RefreshResult("ambiguous", reason="http_200_no_access_token")
    if status in (400, 401):
        error = body.get("error") if isinstance(body, dict) else None
        return RefreshResult("refused", reason=error if isinstance(error, str) and error else f"http_{status}")
    if status == 429:
        return RefreshResult("not_sent", reason="http_429")
    return RefreshResult("ambiguous", reason=f"http_{status}")
