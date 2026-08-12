"""Encryption of FamilySearch OAuth tokens at rest (issue #1128).

`EncryptedStr` is a SQLAlchemy column type that Fernet-encrypts its value on the
way into the database and decrypts it on the way out. Plaintext lives only in
Python memory; the column on disk is always ciphertext. Because the encrypt /
decrypt hooks run at SQLAlchemy's **Core** layer, every access path — ORM or
Core — goes through them transparently, so callers never encrypt or decrypt and
cannot forget to.

**Decrypt failure is soft.** `process_result_value` returns ``None`` (it never
raises) on an undecryptable value — a legacy row written before encryption, or
one written under a different key. Callers already treat a missing token as "no
grant / expired" and prompt a re-login, which rewrites the row as ciphertext, so
such rows self-heal within FamilySearch's ~24h grant window instead of 500-ing
the request. The one caller that peeks before the expiry check (`fresh_fs_token`)
carries an explicit guard for this. Never *use* an undecryptable value as though
it were plaintext — that is the fallback we deliberately reject.

The key comes from ``FS_TOKEN_ENC_KEY`` (config), an arbitrary string like
``SESSION_SECRET``; a valid Fernet key is derived from it, so an operator can set
any strong random value without minting a Fernet-format key. A production deploy
still on the dev default is refused at boot (``config.assert_production_config``).
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import String, TypeDecorator

from .config import get_settings


def _fernet() -> Fernet:
    """Build the Fernet cipher from ``FS_TOKEN_ENC_KEY``.

    Read at call time (not captured at import) so tests can override the setting
    and so key rotation takes effect without a re-import. The configured value is
    an arbitrary string; a 32-byte urlsafe-base64 Fernet key is derived from it
    via SHA-256.
    """
    raw = get_settings().fs_token_enc_key.encode("utf-8")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw).digest()))


class EncryptedStr(TypeDecorator):
    """A TEXT column whose value is Fernet-encrypted at rest. See module docstring."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        # Fernet.encrypt returns urlsafe-base64 bytes; the column is TEXT, so
        # decode to str (a bytes value into a text column misbehaves on Postgres).
        return _fernet().encrypt(value.encode("utf-8")).decode("ascii")

    def process_result_value(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        try:
            return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeError):
            # Undecryptable — legacy plaintext, wrong key, or a non-ASCII/corrupted
            # value that isn't valid ciphertext (the .encode("ascii") raises
            # UnicodeError). Soft-fail to None so the row loads and can be healed;
            # callers map None → "expired" → re-login.
            return None
