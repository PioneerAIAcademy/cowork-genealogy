"""FamilySearch tokens are encrypted at rest (issue #1128).

The seam is `crypto.EncryptedStr`, the column type on
`FamilySearchToken.access_token` / `.refresh_token`: plaintext in Python,
ciphertext in the DB, applied at SQLAlchemy's Core layer so every access path is
transparent. Decrypt failure is soft (returns None), and `fresh_fs_token`'s guard
turns that into "expired" so a legacy or wrong-key row self-heals on the user's
next login instead of raising.

These cover: ciphertext at rest, transparent round-trip, the soft-fail on an
undecryptable value, and the load-bearing heal path (undecryptable-but-not-yet-
expired → "expired" → re-login rewrites it as ciphertext).
"""
import logging
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text
from sqlmodel import Session, SQLModel

from app import fs_oauth
from app.auth import _persist_fs_token, fresh_fs_token
from app.crypto import EncryptedStr, _fernet
from app.db import get_engine, init_db
from app.models import FamilySearchToken


@pytest.fixture(autouse=True)
def _ensure_schema():
    """Create the tables on the shared test engine, so this file passes in
    isolation (the suite otherwise relies on a TestClient test running first to
    trigger the lifespan's init_db)."""
    init_db()


def _insert_plaintext(user_id: str, *, access: str, refresh: str | None, expires_at: datetime) -> None:
    """Insert a row whose token columns hold genuine PLAINTEXT — a pre-#1128 /
    wrong-key row. Uses raw SQL because an ORM/typed insert would encrypt via
    EncryptedStr, which is exactly what we need to bypass here."""
    with get_engine().begin() as c:
        c.execute(
            text(
                "INSERT INTO familysearch_tokens "
                "(user_id, access_token, refresh_token, expires_at, updated) "
                "VALUES (:u, :a, :r, :e, :up)"
            ),
            {"u": user_id, "a": access, "r": refresh,
             "e": expires_at.isoformat(), "up": expires_at.isoformat()},
        )


def _raw_columns(user_id: str) -> tuple[str, str]:
    """The stored (encrypted) column values, read with raw SQL so the
    EncryptedStr result processor does NOT decrypt them."""
    with get_engine().connect() as c:
        return c.execute(
            text("SELECT access_token, refresh_token FROM familysearch_tokens WHERE user_id = :u"),
            {"u": user_id},
        ).one()


def test_tokens_are_ciphertext_at_rest():
    """Persist through the ORM; the raw DB columns are ciphertext that decrypts
    back to the original with the configured key."""
    with Session(get_engine()) as s:
        _persist_fs_token(s, "usr_enc", {
            "access_token": "ACCESS-plain", "refresh_token": "REFRESH-plain", "expires_in": 3600,
        })

    raw_access, raw_refresh = _raw_columns("usr_enc")
    assert raw_access != "ACCESS-plain", "access_token stored as plaintext"
    assert raw_refresh != "REFRESH-plain", "refresh_token stored as plaintext"
    # And it is OUR ciphertext: the configured key decrypts it to the original.
    assert _fernet().decrypt(raw_access.encode("ascii")).decode() == "ACCESS-plain"
    assert _fernet().decrypt(raw_refresh.encode("ascii")).decode() == "REFRESH-plain"


async def test_roundtrip_is_transparent():
    """A caller reading through the ORM (fresh_fs_token) sees plaintext, with no
    encrypt/decrypt code of its own."""
    with Session(get_engine()) as s:
        _persist_fs_token(s, "usr_rt", {
            "access_token": "A-clear", "refresh_token": "R-clear", "expires_in": 3600,
        })
        row = await fresh_fs_token(s, "usr_rt")
    assert row is not None
    assert row.access_token == "A-clear"
    assert row.refresh_token == "R-clear"


def test_process_result_value_soft_fails_on_undecryptable():
    """The type never raises on a value it can't decrypt — it returns None, which
    is what lets a legacy/wrong-key row load and be healed rather than 500."""
    col = EncryptedStr()
    # A value from a DIFFERENT key (simulates a key change / wrong-key deploy).
    foreign = Fernet(Fernet.generate_key()).encrypt(b"whatever").decode("ascii")
    assert col.process_result_value(foreign, None) is None
    # A genuine plaintext value (a pre-#1128 row) is likewise not usable.
    assert col.process_result_value("not-ciphertext-at-all", None) is None
    # A non-ASCII/corrupted value must soft-fail too — .encode("ascii") raises
    # UnicodeError, which the catch has to cover or the whole row 500s on read.
    assert col.process_result_value("tökén-with-ümläut", None) is None
    # None stays None on both hooks.
    assert col.process_result_value(None, None) is None
    assert col.process_bind_param(None, None) is None


async def test_undecryptable_row_reads_as_expired_and_heals(caplog):
    """The heal path, end to end.

    The inserted row is NOT yet expired (expires_at 2h out). That is load-bearing:
    fresh_fs_token checks expiry before the token, so a past expires_at would
    return None via the normal refresh path and the test would pass even if the
    guard were missing. With a future expiry, only the access_token-is-None guard
    can produce the "expired" result — so this asserts the guard specifically.
    """
    future = datetime.now(timezone.utc) + timedelta(hours=2)
    _insert_plaintext("usr_heal", access="LEGACY-plain", refresh="LEGACY-refresh", expires_at=future)

    # It loads (soft-fail), with the token decrypted to None rather than raising.
    with Session(get_engine()) as s:
        assert s.get(FamilySearchToken, "usr_heal").access_token is None

    # fresh_fs_token maps that to "no usable grant" (None) and logs a WARNING.
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        with Session(get_engine()) as s:
            assert await fresh_fs_token(s, "usr_heal") is None
    assert any("usr_heal" in r.getMessage() and "undecryptable" in r.getMessage()
               for r in caplog.records), "expected a WARNING naming the user_id"

    # A re-login (persist) rewrites the row — now usable and ciphertext at rest.
    with Session(get_engine()) as s:
        _persist_fs_token(s, "usr_heal", {
            "access_token": "HEALED", "refresh_token": "HEALED-r", "expires_in": 3600,
        })
        healed = await fresh_fs_token(s, "usr_heal")
    assert healed is not None and healed.access_token == "HEALED"
    assert _raw_columns("usr_heal")[0] != "HEALED", "healed row must be ciphertext at rest"
