"""U3: proto/grants.py, the grant custody the web tier and the worker share (offline).

The pure decisions -- whether an attempt may start on a grant, whether a grant is due a
refresh, how a token-endpoint answer is classified -- on their own tables; the encryption
both tiers must agree on; and the numbers the lock design rests on, pinned against each
other. The lock semantics themselves need Postgres: test_proto_grants_pg.py.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

from proto import grants
from proto.worker import worker

PROTO = Path(__file__).resolve().parents[1] / "proto"
sys.path.insert(0, str(PROTO))

from web import app, auth  # noqa: E402

KEY = "k" * 32


def _row(age_s: float = 10, *, access: str | None = "tok", refresh: str | None = "enc-refresh",
         pending: bool = False, refused: bool = False, reason: str | None = None) -> grants.GrantRow:
    enc = grants.encrypt(access, KEY) if access is not None else "not-ciphertext"
    return grants.GrantRow("usr_a", enc, refresh, age_s, pending, refused, reason)


def _decrypt(value):
    return grants.decrypt(value, KEY)


@pytest.mark.parametrize("row, expected", [
    (_row(10), grants.Ready("tok")),
    (_row(26400), grants.Ready("tok")),  # at the bound, not past it
    (None, grants.Closed("no_grant")),
    (_row(10, refused=True, reason="invalid_grant"), grants.Closed("refused", "invalid_grant")),
    (_row(10, refused=True, reason=None), grants.Closed("refused", None)),
    (_row(10, refused=True, reason="undecryptable"), grants.Closed("undecryptable", "undecryptable")),
    (_row(10, access=None), grants.Closed("undecryptable")),
    (_row(26401, refresh=None), grants.Closed("no_refresh_token")),
    (_row(26401), grants.Wait("session_age")),
    (_row(10, pending=True), grants.Wait("refresh_pending")),
    (_row(30000, pending=True), grants.Wait("refresh_pending")),
    (_row(10, refresh=None), grants.Ready("tok")),  # young enough without one
], ids=["ready", "ready-at-bound", "no-grant", "refused", "refused-no-reason", "refused-undecryptable",
        "undecryptable", "no-refresh-token", "too-old", "ambiguous-refresh", "ambiguous-and-old",
        "young-no-refresh-token"])
def test_attempt_verdict_table(row, expected):
    """D7's causes, the two waits and Ready. `no_owner` is the worker's own (no row to read):
    test_proto_worker's acquire tests cover it."""
    assert grants.attempt_verdict(row, max_start_age_s=26400, decrypt=_decrypt) == expected


def test_an_empty_decrypted_token_is_never_ready():
    assert grants.attempt_verdict(_row(10, access=""), max_start_age_s=26400, decrypt=_decrypt) \
        == grants.Closed("undecryptable")


@pytest.mark.parametrize("row, due", [
    (_row(3600), True),
    (_row(3599), False),
    (_row(10, pending=True), True),
    (_row(9999, refused=True), False),
    (_row(9999, refresh=None), False),
    (None, False),
])
def test_refresh_due_table(row, due):
    assert grants.refresh_due(row, refresh_age_s=3600) is due


@pytest.mark.parametrize("status, body, kind, reason", [
    (200, {"access_token": "a", "refresh_token": "r"}, "ok", None),
    (200, {"access_token": "a"}, "ok", None),
    (200, {"token_type": "bearer"}, "ambiguous", "http_200_no_access_token"),
    (200, None, "ambiguous", "http_200_no_access_token"),
    (400, {"error": "invalid_grant"}, "refused", "invalid_grant"),
    (400, None, "refused", "http_400"),
    (401, {"error": "invalid_client"}, "refused", "invalid_client"),
    (429, {}, "not_sent", "http_429"),
    (403, {}, "ambiguous", "http_403"),
    (500, {}, "ambiguous", "http_500"),
    (503, None, "ambiguous", "http_503"),
])
def test_classify_response_table(status, body, kind, reason):
    result = grants.classify_response(status, body)
    assert (result.kind, result.reason) == (kind, reason)
    if kind == "ok":
        assert result.access_token == "a" and result.refresh_token == body.get("refresh_token")


def test_web_auth_ciphertext_decrypts_through_grants(monkeypatch):
    """The worker decrypts with grants.decrypt what the web tier encrypts with auth.encrypt,
    under the one FS_TOKEN_ENC_KEY both read; under another key it is None, never plaintext."""
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "shared key")
    key = grants.enc_key()
    assert key == "shared key" and grants.key_mode() == "set"
    assert grants.decrypt(auth.encrypt("from-web"), key) == "from-web"
    assert auth.decrypt(grants.encrypt("from-worker", key)) == "from-worker"
    assert grants.decrypt(auth.encrypt("from-web"), "another key") is None
    monkeypatch.delenv("FS_TOKEN_ENC_KEY")
    assert grants.enc_key() == auth.DEV_FS_TOKEN_ENC_KEY == grants.DEV_FS_TOKEN_ENC_KEY
    assert grants.key_mode() == "default" and grants.key_mode({"FS_TOKEN_ENC_KEY": "  "}) == "default"


def test_lock_timeouts_cover_the_refresh_budget():
    """A refresher holds both locks for at most the POST's one total deadline plus two
    single-row transactions; the worker's shared-lock wait and the sign-in callback's
    write-lock wait must both outlast that, or a healthy refresh fails an attempt or a
    sign-in. The worker's connection and the callback's SQL carry these exact numbers."""
    hold = grants.REFRESH_HTTP_TIMEOUT_S + 1
    assert hold < grants.WRITE_LOCK_TIMEOUT_S < grants.ATTEMPT_LOCK_TIMEOUT_S
    assert f"lock_timeout={grants.ATTEMPT_LOCK_TIMEOUT_S}s" in worker.GRANT_CONN_KWARGS["options"]
    assert grants.WRITE_LOCK_TIMEOUT_SQL == f"SET LOCAL lock_timeout = '{grants.WRITE_LOCK_TIMEOUT_S}s'"
    assert grants.DEFAULT_WAIT_S < 1800, "the start-gate wait ends inside the shim's 1,800 s kill"
    assert grants.DEFAULT_MAX_START_AGE_S == grants.SESSION_IDLE_S - 1800 - 600 == 26400


def test_lock_namespaces_are_distinct_int4():
    """Two-int4 keys (never the engine's single-bigint space), positive, distinct, and every
    call casts the namespace, so the overload never depends on how the driver types a Python
    int (psycopg 3 sends these as smallint today; an int8 would find no (bigint, integer)
    form)."""
    for ns in (grants.ATTEMPT_LOCK_NS, grants.WRITE_LOCK_NS):
        assert isinstance(ns, int) and 0 < ns < 2**31
    assert grants.ATTEMPT_LOCK_NS != grants.WRITE_LOCK_NS
    for sql in (grants.ATTEMPT_LOCK_SQL, grants.ATTEMPT_UNLOCK_SQL, grants.TRY_LOCK_SQL,
                grants.WRITE_XACT_LOCK_SQL, grants.ATTEMPT_LOCK_HELD_SQL):
        assert "%s::int4" in sql, sql
    for sql in (grants.ATTEMPT_LOCK_SQL, grants.ATTEMPT_UNLOCK_SQL, grants.TRY_LOCK_SQL, grants.WRITE_XACT_LOCK_SQL):
        assert "hashtext(%s)" in sql, sql
    # The web image imports it as `grants`, the worker as `proto.grants`: one file, one key space.
    assert Path(app.grants.__file__).resolve() == Path(grants.__file__).resolve()


@pytest.mark.parametrize("raw, expected", [
    (None, 300.0), ("", 300.0), ("  ", 300.0), ("abc", 300.0), ("-5", 300.0), ("0", 0.0), ("26400", 26400.0),
    ("1.5", 1.5),
])
def test_env_seconds(raw, expected):
    env = {} if raw is None else {"X": raw}
    assert grants.env_seconds(env, "X", 300) == expected


def _third_party_imports(source: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    return {n for n in names if n not in sys.stdlib_module_names and n != "__future__"}


def test_grants_imports_only_stdlib_and_cryptography():
    """Both images copy grants.py and nothing it would need beyond what each installs: the
    worker image has no fastapi, httpx or itsdangerous, and neither image has `app`."""
    assert _third_party_imports((PROTO / "grants.py").read_text(encoding="utf-8")) == {"cryptography"}


@pytest.mark.parametrize("source, expected", [
    ("import httpx", {"httpx"}),
    ("def f():\n    from app.config import x\n", {"app"}),
    ("import os, json\nfrom collections.abc import Mapping", set()),
    ("from cryptography.fernet import Fernet", {"cryptography"}),
])
def test_the_import_reader_sees_each_shape(source, expected):
    assert _third_party_imports(source) == expected
