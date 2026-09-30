"""Patron sign-in for the prototype web tier (docs/plan/familysearch-handoff.md, U2).

A vendored port of the E2B/Fly/Neon alpha's FamilySearch front door
(``apps/server/app/{fs_oauth,auth,crypto,config}.py``): PKCE, the signed session cookie,
the email allowlist and Fernet encryption of the grant at rest. Vendored, not imported:
the web image copies only ``enqueue.py``, ``sql/``, ``web/`` and the client config
(``proto/web/Dockerfile``), so ``app.*`` is not importable here, and an import would
pass every test (the suite runs from the repo root) and fail only in the container.
``test_proto_auth.py`` pins that with an AST check.

What is deliberately NOT here: token refresh and any refresh lock. U3 makes this tier
the only refresher, under a per-patron database lock; the alpha's in-process per-user
lock (issue #2887) is the thing U3 exists to replace. Until U3 the worker
still runs every turn on the operator's token (``worker/options.py``), so the grant
stored here is written and never read.

Settings are read from the environment at call time, so a test can set them per case:

  PUBLIC_URL                 the tier's public origin; /callback hangs off it. Its scheme
                             is the production discriminant: https turns on secure
                             cookies, turns off dev-login and arms ``preflight``.
  WEB_ORIGIN                 where the callback sends the browser (defaults to PUBLIC_URL)
  SESSION_SECRET             signs the session cookie and the OAuth state cookie
  FS_TOKEN_ENC_KEY           any string; a Fernet key is derived from it
  ALLOWED_EMAILS             comma-separated; the FamilySearch sign-in gate
  FAMILYSEARCH_WEB_ENABLED   true to offer FamilySearch sign-in (needs the client config)
  FAMILYSEARCH_CONFIG        path to the engine's familysearch.json
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import BadSignature, URLSafeTimedSerializer

PROTO_DIR = Path(__file__).resolve().parent.parent


def client_config_candidates(proto_dir: Path) -> tuple[Path, ...]:
    """/app/config/familysearch.json in the image (the Dockerfile copies it there); the
    engine's own file in a checkout, where proto_dir is apps/server/proto. In the image
    proto_dir is /app, which has no third parent -- indexing ``parents[2]`` there raised
    at import and the tier never started, which no offline test could see."""
    candidates = [proto_dir / "config" / "familysearch.json"]
    if len(proto_dir.parents) > 2:
        candidates.append(
            proto_dir.parents[2] / "packages" / "engine" / "mcp-server" / "config" / "familysearch.json"
        )
    return tuple(candidates)


CLIENT_CONFIG_CANDIDATES = client_config_candidates(PROTO_DIR)

# The alpha's development defaults, kept identical so ciphertext the alpha wrote under
# its default key decrypts here too. ``preflight`` refuses both on an https PUBLIC_URL.
DEV_SESSION_SECRET = "dev-insecure-secret-change-me"
DEV_FS_TOKEN_ENC_KEY = "dev-insecure-fs-token-key-change-me"
DEFAULT_PUBLIC_URL = "http://127.0.0.1:8085"

COOKIE_NAME = "wb_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
FS_OAUTH_COOKIE = "fs_oauth"
FS_OAUTH_MAX_AGE = 600
DEV_LOGIN_EMAIL = "dev@localhost"

# FamilySearch endpoints (packages/engine/mcp-server/src/auth/config.ts).
FS_AUTHORIZE_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/authorization"
FS_TOKEN_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/token"
FS_CURRENT_USER_URL = "https://api.familysearch.org/platform/users/current"
FS_ACCEPT = "application/x-fs-v1+json"
# api.familysearch.org sits behind Imperva, which 403s non-browser UAs
# (packages/engine/mcp-server/src/constants.ts BROWSER_USER_AGENT). The ident token
# endpoint does not need it.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
# No ``expires_in`` in FamilySearch's token response (measured 2026-09-23); an access
# token lives 8 h idle / 24 h max, so 8 h from issue is the lower bound. Equal to the
# engine's FS_ACCESS_TOKEN_LIFETIME_S.
FS_ACCESS_TOKEN_LIFETIME_S = 8 * 60 * 60

# Where the callback may send the browser afterwards: only a hash route of our own SPA.
# The value rides a cookie the browser controls, so anything else is an open redirect.
SAFE_NEXT_RE = re.compile(r"^#/[A-Za-z0-9/_-]{0,120}$")


# ── settings ─────────────────────────────────────────────────────────────────────


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or "").strip() or default


def public_url() -> str:
    return _env("PUBLIC_URL", DEFAULT_PUBLIC_URL).rstrip("/")


def web_origin() -> str:
    return _env("WEB_ORIGIN", public_url()).rstrip("/")


def is_https() -> bool:
    return public_url().startswith("https")


def session_secret() -> str:
    return _env("SESSION_SECRET", DEV_SESSION_SECRET)


def fs_token_enc_key() -> str:
    return _env("FS_TOKEN_ENC_KEY", DEV_FS_TOKEN_ENC_KEY)


def allowed_emails() -> set[str]:
    return {e.strip().lower() for e in _env("ALLOWED_EMAILS").split(",") if e.strip()}


def familysearch_enabled() -> bool:
    return _env("FAMILYSEARCH_WEB_ENABLED").lower() in {"1", "true", "yes", "on"}


class ClientConfigError(RuntimeError):
    """FamilySearch sign-in is enabled but the bundled client config cannot be read."""


def client_config_path() -> Path | None:
    explicit = _env("FAMILYSEARCH_CONFIG")
    if explicit:
        return Path(explicit)
    return next((p for p in CLIENT_CONFIG_CANDIDATES if p.is_file()), None)


def client_id() -> str:
    """The FamilySearch client id from the engine's bundled config -- its sole source
    (CLAUDE.md, auth). Raises rather than returning None: an unreadable config while
    sign-in is enabled must stop the tier, never fall through to "unconfigured", which
    is the state that turns dev-login back on."""
    path = client_config_path()
    if path is None:
        raise ClientConfigError(
            "FAMILYSEARCH_WEB_ENABLED is on but no familysearch.json was found; set "
            "FAMILYSEARCH_CONFIG or ship packages/engine/mcp-server/config/familysearch.json "
            "in the image"
        )
    try:
        value = json.loads(path.read_text(encoding="utf-8")).get("clientId")
    except (OSError, ValueError, AttributeError) as exc:
        raise ClientConfigError(f"cannot read the FamilySearch client config at {path}: {exc}") from exc
    if not isinstance(value, str) or not value.strip():
        raise ClientConfigError(f"{path} has no clientId")
    return value.strip()


def familysearch_configured() -> bool:
    return familysearch_enabled() and bool(client_id())


def dev_login_enabled() -> bool:
    """A local convenience only: offered when FamilySearch is off AND the tier is not on
    an https host, so a deploy that forgot to configure FamilySearch cannot expose an
    allowlist-free sign-in."""
    return not familysearch_enabled() and not is_https()


def preflight() -> None:
    """Refuse to start a misconfigured tier. Called first in the lifespan.

    - FamilySearch enabled with no readable client config: named error, not a silent
      fall-through to dev-login.
    - On an https PUBLIC_URL (a deployed host): a default or empty SESSION_SECRET forges
      every session and the OAuth state; a default FS_TOKEN_ENC_KEY encrypts every grant
      under a public string.
    """
    if familysearch_enabled():
        client_id()
    if not is_https():
        return
    problems = []
    for name, dev in (("SESSION_SECRET", DEV_SESSION_SECRET), ("FS_TOKEN_ENC_KEY", DEV_FS_TOKEN_ENC_KEY)):
        if _env(name) in ("", dev):
            problems.append(f"  {name} is unset or the development default; set it to a random secret")
    if problems:
        raise RuntimeError(
            f"Refusing to start: PUBLIC_URL is {public_url()} (a deployed host), but\n" + "\n".join(problems)
        )


# ── cookies ──────────────────────────────────────────────────────────────────────


def _session_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(session_secret(), salt="wb-session")


def _oauth_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(session_secret(), salt="fs-oauth")


def session_cookie_value(user_id: str, *, iat: float | None = None) -> str:
    return _session_serializer().dumps({"uid": user_id, "iat": time.time() if iat is None else iat})


def read_session_cookie(token: str | None) -> dict[str, Any] | None:
    """``{uid, iat}``, or None for a missing, forged or expired cookie."""
    if not token:
        return None
    try:
        data = _session_serializer().loads(token, max_age=COOKIE_MAX_AGE)
    except BadSignature:
        return None
    return data if isinstance(data, dict) and isinstance(data.get("uid"), str) else None


def cookie_kwargs() -> dict[str, Any]:
    return {"httponly": True, "samesite": "lax", "secure": is_https(), "path": "/"}


def oauth_state_cookie(verifier: str, state: str, next_route: str | None) -> str:
    payload = {"verifier": verifier, "state": state}
    if next_route and SAFE_NEXT_RE.match(next_route):
        payload["next"] = next_route
    return _oauth_serializer().dumps(payload)


def read_oauth_state_cookie(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        data = _oauth_serializer().loads(token, max_age=FS_OAUTH_MAX_AGE)
    except BadSignature:
        return None
    return data if isinstance(data, dict) else None


def redirect_target(next_route: Any) -> str:
    """Where the callback lands the browser. ``next`` is re-validated on the way out: it
    came back on a cookie the browser holds."""
    target = web_origin()
    if isinstance(next_route, str) and SAFE_NEXT_RE.match(next_route):
        return f"{target}/{next_route}"
    return target


def revoked(iat: Any, sessions_revoked_at: datetime | None) -> bool:
    if sessions_revoked_at is None:
        return False
    at = sessions_revoked_at if sessions_revoked_at.tzinfo else sessions_revoked_at.replace(tzinfo=timezone.utc)
    return float(iat or 0) <= at.timestamp()


# ── encryption at rest ───────────────────────────────────────────────────────────


def _fernet() -> Fernet:
    """The alpha's derivation (apps/server/app/crypto.py): SHA-256 of the configured
    string, urlsafe-base64 -- so any strong random value works as the key."""
    raw = fs_token_enc_key().encode("utf-8")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw).digest()))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str | None) -> str | None:
    """Soft-fails to None on a value written under another key or not ciphertext at all;
    callers treat None as "no grant". Never use an undecryptable value as plaintext."""
    if value is None:
        return None
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError):
        return None


# ── the FamilySearch round-trip ──────────────────────────────────────────────────


def pkce() -> tuple[str, str]:
    """(verifier, S256 challenge), both base64url without padding."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def redirect_uri() -> str:
    """The registered redirect is a TOP-LEVEL /callback on the public URL. The dev key's
    only registration is http://127.0.0.1:1837/callback, which is why the compose
    override publishes this tier on 1837."""
    return f"{public_url()}/callback"


def authorize_url(challenge: str, state: str) -> str:
    from urllib.parse import urlencode

    return FS_AUTHORIZE_URL + "?" + urlencode({
        "response_type": "code",
        "client_id": client_id(),
        "redirect_uri": redirect_uri(),
        "scope": "offline_access",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })


async def exchange_code(code: str, verifier: str) -> dict[str, Any] | None:
    """Code + verifier -> the raw token JSON, or None on any non-200."""
    import httpx

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            FS_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id(),
                "code_verifier": verifier,
                "redirect_uri": redirect_uri(),
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code != 200:
        return None
    body = resp.json()
    return body if isinstance(body, dict) and body.get("access_token") else None


async def fetch_identity(access_token: str) -> dict[str, Any] | None:
    """``users[0]`` of /platform/users/current, or None. Read only the email and id: the
    endpoint also returns account PII."""
    import httpx

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            FS_CURRENT_USER_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": FS_ACCEPT, "User-Agent": BROWSER_USER_AGENT},
        )
    if resp.status_code != 200:
        return None
    users = resp.json().get("users") or []
    return users[0] if users and isinstance(users[0], dict) else None


def expires_at_from(token_json: dict[str, Any]) -> datetime:
    seconds = int(token_json.get("expires_in", FS_ACCESS_TOKEN_LIFETIME_S))
    return datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=seconds)
