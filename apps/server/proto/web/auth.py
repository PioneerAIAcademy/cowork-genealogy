"""Patron sign-in for the prototype web tier (docs/plan/familysearch-handoff.md, U2).

A vendored port of the E2B/Fly/Neon alpha's FamilySearch front door
(``apps/server/app/{fs_oauth,auth,crypto,config}.py``): PKCE, the signed session cookie,
the email allowlist and Fernet encryption of the grant at rest. Vendored, not imported:
the web image copies only ``enqueue.py``, ``sql/``, ``web/`` and the client config
(``proto/web/Dockerfile``), so ``app.*`` is not importable here, and an import would
pass every test (the suite runs from the repo root) and fail only in the container.
``test_proto_auth.py`` pins that with an AST check.

The refresh is here too (U3): ``refresh_tokens`` is the one FamilySearch refresh call,
and this tier is the grant's only refresher (``app.grant_refresh_loop`` drives it under
``proto/grants.py``'s per-patron database locks, replacing the alpha's in-process lock of
issue #2887). The worker reads the current grant at the start of every attempt; the
Fernet derivation both tiers decrypt with lives in ``grants.py``, which both images copy.

Settings are read from the environment at call time, so a test can set them per case:

  PUBLIC_URL                 the tier's public origin; the default callback hangs off it. Its scheme
                             is the production discriminant: https turns on secure
                             cookies, turns off dev-login and arms ``preflight``
                             (as FAMILYSEARCH_WEB_ENABLED does, at any scheme). Its path
                             is the prefix an edge strips before the origin (U28): it
                             scopes the cookies and the SPA's ``<base href>``.
  WEB_ORIGIN                 where the callback sends the browser (defaults to PUBLIC_URL)
  SESSION_SECRET             signs the session cookie and the OAuth state cookie
  FS_TOKEN_ENC_KEY           any string; a Fernet key is derived from it
  ALLOWED_EMAILS             comma- or space-separated (Beanstalk allows no comma in a
                             value); the FamilySearch sign-in gate
  FAMILYSEARCH_WEB_ENABLED   true to offer FamilySearch sign-in (needs the client config)
  FAMILYSEARCH_CONFIG        path to the engine's familysearch.json
  DEV_LOGIN                  true to offer dev-login (compose sets it; U11's packaging
                             guard keeps every DEV_ variable out of the templates)
  GENEALOGY_CHAT             unset or true: the chat (turns queue, grant refresher and every
                             /api/sessions route); false: none of the three. Anything else
                             refuses to start
  GENEALOGY_MAX_USERS        a positive integer: sign-in admits by user cap and ignores
                             ALLOWED_EMAILS; unset: the allowlist. Anything else refuses to
                             start
  OPENROUTER_LINKING_ENABLED true: serve the /openrouter routes (#3988) and say so in
                             /auth/config; unset or false: every /openrouter route is a 404.
                             Anything else refuses to start
  FS_REDIRECT_URI            the FamilySearch redirect URI (#3992); the callback is served at
                             its path, less PUBLIC_URL's prefix. Unset: PUBLIC_URL + /callback.
                             Refuses to start unless it is an absolute http(s) URL whose path is
                             unreserved segments (no '.' or '..'), with no user info, query or
                             fragment, and, on PUBLIC_URL's host, PUBLIC_URL's scheme and a path
                             under its prefix (``callback_path``)
  GENEALOGY_SIGNIN_CALLS_PER_MINUTE  the sign-in budget (#3992): the code exchange and the
                             identity read share this many calls per sliding minute, two per
                             sign-in. Unset: no budget. Anything but a whole number of at least
                             2 refuses to start

With the chat off (#3992) the session cookie lasts 24 hours rather than 30 days, sign-in asks
for no ``offline_access``, and each sign-in consumes a single-use state record
(``signin_states``) before it calls FamilySearch.

OpenRouter linking (#3988) is the second PKCE round-trip here: the patron's own OpenRouter
key, stored under the same Fernet key as the FamilySearch grant (``encrypt``), which the
tool server decrypts (issue #3984). Its state cookie has its own name and salt, so a
FamilySearch state cookie never validates as an OpenRouter one, and it carries the session's
uid, so a callback finishes only for the user who started it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from itsdangerous import BadSignature, URLSafeTimedSerializer

PROTO_DIR = Path(__file__).resolve().parent.parent
# grants.py is a sibling of web/ in the repo (proto/) and in the image (/app), imported as
# a top-level module the way app.py imports enqueue.
if str(PROTO_DIR) not in sys.path:
    sys.path.insert(0, str(PROTO_DIR))

import grants  # noqa: E402  (the grant custody both tiers share)


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
# its default key decrypts here too. ``preflight`` refuses both on an https PUBLIC_URL
# and whenever FamilySearch sign-in is on.
DEV_SESSION_SECRET = "dev-insecure-secret-change-me"
DEV_FS_TOKEN_ENC_KEY = grants.DEV_FS_TOKEN_ENC_KEY
DEFAULT_PUBLIC_URL = "http://127.0.0.1:8085"

COOKIE_NAME = "wb_session"
# #3992: the session's life, in the cookie and in the signature check that actually ends it.
SESSION_MAX_AGE_CHAT_S = 60 * 60 * 24 * 30  # 30 days, the handoff's
SESSION_MAX_AGE_NO_CHAT_S = 60 * 60 * 24  # a beta user signs in every sitting
FS_OAUTH_COOKIE = "fs_oauth"
FS_OAUTH_MAX_AGE = 600
DEV_LOGIN_EMAIL = "dev@localhost"
# #3988: the OpenRouter link's state cookie. Never FS_OAUTH_COOKIE: the two flows would
# overwrite each other's verifier.
OR_OAUTH_COOKIE = "or_oauth"
OR_OAUTH_MAX_AGE = 600

# OpenRouter's PKCE flow (https://openrouter.ai/docs/use-cases/oauth-pkce). Module
# constants, not settings: a test fakes the exchange through ``transport=``.
OPENROUTER_AUTH_URL = "https://openrouter.ai/auth"
OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys"
OPENROUTER_KEY_LABEL = "Genealogy research beta"
# The exchange's total deadline: under the edge's 60 s idle timeout (ALB and DTM), so the
# patron sees our answer, never an edge 504 while the key is stored behind it.
OPENROUTER_EXCHANGE_TIMEOUT_S = 20.0

# FamilySearch endpoints (packages/engine/mcp-server/src/auth/config.ts).
FS_AUTHORIZE_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/authorization"
FS_TOKEN_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/token"
FS_CURRENT_USER_URL = "https://api.familysearch.org/platform/users/current"
FS_ACCEPT = "application/x-fs-v1+json"
# api.familysearch.org and ident.familysearch.org sit behind Imperva, which 403s
# non-browser UAs (packages/engine/mcp-server/src/constants.ts BROWSER_USER_AGENT). From
# FamilySearch's own AWS ident's discovery endpoint 403s python-httpx while its token
# endpoint takes it (handoff step 18, 2026-10-24); the rules differ by endpoint, so the
# token calls send the browser UA too.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
# No ``expires_in`` in FamilySearch's token response (measured 2026-09-23); an access
# token lives 8 h idle / 24 h max, so 8 h from issue is the lower bound. Equal to the
# engine's FS_ACCESS_TOKEN_LIFETIME_S.
FS_ACCESS_TOKEN_LIFETIME_S = 8 * 60 * 60

# Where the callback may send the browser afterwards: a hash route of our own SPA, or
# exactly one chat-off upload page, ``upload/proj_<16 hex>`` (#4001), the one shape both the
# web tier and the connector mint. ``redirect_target`` appends it to ``<origin>/``. The
# value rides a cookie the browser controls, so anything else is an open redirect: no
# leading ``/``, no ``\``, ``.``, ``?`` or scheme can match. ``\Z``, not ``$``, which also
# matches before a trailing newline.
SAFE_NEXT_RE = re.compile(r"^(?:#/[A-Za-z0-9/_-]{0,120}|upload/proj_[0-9a-f]{16})\Z")
# PUBLIC_URL's path: unreserved segments only, since it is written into a cookie Path and
# the SPA's HTML.
BASE_PATH_RE = re.compile(r"^(/[A-Za-z0-9._~-]+)*$")


# ── settings ─────────────────────────────────────────────────────────────────────


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or "").strip() or default


def public_url() -> str:
    return _env("PUBLIC_URL", DEFAULT_PUBLIC_URL).rstrip("/")


def base_path() -> str:
    """PUBLIC_URL's path without its trailing slash, ``''`` at the root. Raises on a path
    outside ``BASE_PATH_RE`` or any query or fragment, at any scheme."""
    parts = urlsplit(public_url())
    path = parts.path.rstrip("/")
    if (parts.query or parts.fragment or "?" in public_url() or "#" in public_url() or not BASE_PATH_RE.match(path)
            or _has_dot_segment(path)):
        raise RuntimeError(
            f"Refusing to start: PUBLIC_URL {public_url()!r} must be an origin plus an optional path of "
            "unreserved segments (A-Z a-z 0-9 . _ ~ -), with no query or fragment"
        )
    return path


def _has_dot_segment(path: str) -> bool:
    """``.`` or ``..`` as a whole segment: ``BASE_PATH_RE`` admits them, and a browser
    normalizes them away, so the path it sends is not the one written."""
    return any(seg in (".", "..") for seg in path.split("/"))


def cookie_path() -> str:
    return base_path() or "/"


def web_origin() -> str:
    return _env("WEB_ORIGIN", public_url()).rstrip("/")


def is_https() -> bool:
    return public_url().startswith("https")


def session_secret() -> str:
    return _env("SESSION_SECRET", DEV_SESSION_SECRET)


def deletion_code(user_id: str) -> str:
    """The code a user quotes to ask for their account to be deleted: 20 lowercase hex characters.

    Rotating ``SESSION_SECRET`` changes every code. That is harmless: rotation also signs
    everyone out, and the account menu shows the new code. Never log it, put it in a
    feedback bundle, or return it from any route but ``GET /api/account`` and the chat-off
    signed-in page at ``GET /`` (#4001), both ``private, no-store``.
    """
    return hmac.new(session_secret().encode(), b"deletion-code:" + user_id.encode(), hashlib.sha256).hexdigest()[:20]


def fs_token_enc_key() -> str:
    return grants.enc_key(os.environ)


def allowed_emails() -> set[str]:
    return {e.lower() for e in re.split(r"[,\s]+", _env("ALLOWED_EMAILS")) if e}


def _switch(name: str) -> bool | None:
    """A strict switch: None when unset or empty, else ``true``/``false`` in any case. Any
    other value raises, so a typo never silently turns a feature on or off. The tools tier's
    rule (``envSwitch``, ``hosted-config-env.ts``), so the two tiers read a setting one way."""
    raw = _env(name).lower()
    if raw == "":
        return None
    if raw in ("true", "false"):
        return raw == "true"
    raise RuntimeError(f"{name} is {_env(name)!r}: set it to true or false, or leave it unset")


def chat_enabled() -> bool:
    """``GENEALOGY_CHAT``: on when unset, empty or ``true``, off when ``false``."""
    return _switch("GENEALOGY_CHAT") is not False


def uploads_setting() -> bool | None:
    """``UPLOADS_ENABLED`` (#3987): None when unset or empty, else the switch."""
    return _switch("UPLOADS_ENABLED")


def openrouter_linking_enabled() -> bool:
    """``OPENROUTER_LINKING_ENABLED`` (#3988): on only when ``true``."""
    return _switch("OPENROUTER_LINKING_ENABLED") is True


def positive_int_env(name: str) -> int | None:
    """``name`` as a positive integer, or None when unset or empty. Raises otherwise, so a
    typo never falls back to the unset behaviour."""
    raw = _env(name)
    if not raw:
        return None
    # ASCII digits only: int() would also take "1_000", "+5" and non-ASCII digits.
    value = int(raw) if re.fullmatch(r"[0-9]+", raw) else 0
    if value < 1:
        raise RuntimeError(f"{name} is {raw!r}: set it to a positive integer, or leave it unset")
    return value


def max_users() -> int | None:
    """``GENEALOGY_MAX_USERS``: the user cap, or None (unset or empty) for the allowlist."""
    return positive_int_env("GENEALOGY_MAX_USERS")


def signin_calls_per_minute() -> int | None:
    """``GENEALOGY_SIGNIN_CALLS_PER_MINUTE`` (#3992): the sign-in budget, or None (unset) for
    none. At least 2: a sign-in takes two calls at once, so 1 would refuse every sign-in."""
    value = positive_int_env("GENEALOGY_SIGNIN_CALLS_PER_MINUTE")
    if value == 1:
        raise RuntimeError(
            "GENEALOGY_SIGNIN_CALLS_PER_MINUTE is '1': a sign-in takes two calls, so set it to 2 or more, "
            "or leave it unset"
        )
    return value


def session_max_age(*, chat: bool | None = None) -> int:
    """The session's life in seconds (#3992): 24 hours with the chat off, 30 days with it on.
    The tier passes ``app.state.chat``, the value its routes were built with; ``None`` reads
    ``GENEALOGY_CHAT`` (a script with no app)."""
    on = chat_enabled() if chat is None else chat
    return SESSION_MAX_AGE_CHAT_S if on else SESSION_MAX_AGE_NO_CHAT_S


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
    """A local convenience only: offered when ``DEV_LOGIN=true`` AND FamilySearch is off
    AND the tier is not on an https host. Opt-in, so a deploy that forgot both FamilySearch
    and PUBLIC_URL (http by default) cannot expose an allowlist-free sign-in."""
    dev = (os.environ.get("DEV_LOGIN") or "").strip().lower() == "true"
    return dev and not familysearch_enabled() and not is_https()


def preflight() -> None:
    """Refuse to start a misconfigured tier. Called first in the lifespan.

    - FamilySearch enabled with no readable client config: named error, not a silent
      fall-through to dev-login.
    - On an https PUBLIC_URL (a deployed host), or with FamilySearch sign-in or OpenRouter
      linking on at any scheme (a grant or a key is real whatever the scheme, e.g. an http
      loopback PUBLIC_URL): a default or empty SESSION_SECRET forges every session and the
      OAuth state; a default or empty FS_TOKEN_ENC_KEY encrypts every grant and key under a
      public string. Only http with both off (compose's dev-login tier) may start on the
      defaults.
    - ``GENEALOGY_CHAT`` or ``OPENROUTER_LINKING_ENABLED`` other than true/false,
      ``GENEALOGY_MAX_USERS`` other than a positive integer,
      ``GENEALOGY_SIGNIN_CALLS_PER_MINUTE`` other than a whole number of at least 2, or an
      ``FS_REDIRECT_URI`` that is not an absolute http(s) URL with a path, at any scheme.
    """
    base_path()
    chat_enabled()
    or_on = openrouter_linking_enabled()
    max_users()
    signin_calls_per_minute()
    callback_path()
    fs_on = familysearch_enabled()
    if fs_on:
        client_id()
    if not (is_https() or fs_on or or_on):
        return
    problems = []
    for name, dev in (("SESSION_SECRET", DEV_SESSION_SECRET), ("FS_TOKEN_ENC_KEY", DEV_FS_TOKEN_ENC_KEY)):
        if _env(name) in ("", dev):
            problems.append(f"  {name} is unset or the development default; set it to a random secret")
    if problems:
        why = (f"PUBLIC_URL is {public_url()} (a deployed host)" if is_https()
               else "FAMILYSEARCH_WEB_ENABLED is on (patron grants are stored)" if fs_on
               else "OPENROUTER_LINKING_ENABLED is on (patron OpenRouter keys are stored)")
        raise RuntimeError(f"Refusing to start: {why}, but\n" + "\n".join(problems))


# ── cookies ──────────────────────────────────────────────────────────────────────


def _session_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(session_secret(), salt="wb-session")


# Each OAuth flow's state cookie signs under its own salt, so one flow's cookie never
# validates as another's (#3988).
FS_OAUTH_SALT = "fs-oauth"
OR_OAUTH_SALT = "or-oauth"


def _state_cookie(salt: str, payload: dict[str, Any], next_route: str | None) -> str:
    """A flow's signed state cookie; ``next`` kept only when ``SAFE_NEXT_RE`` admits it."""
    if next_route and SAFE_NEXT_RE.match(next_route):
        payload = {**payload, "next": next_route}
    return URLSafeTimedSerializer(session_secret(), salt=salt).dumps(payload)


def _read_state_cookie(salt: str, token: str | None, max_age: int,
                       required: tuple[str, ...] = ()) -> dict[str, Any] | None:
    """The payload, or None for a missing, forged, expired or non-dict cookie, or one whose
    ``required`` keys are not all non-empty strings."""
    if not token:
        return None
    try:
        data = URLSafeTimedSerializer(session_secret(), salt=salt).loads(token, max_age=max_age)
    except BadSignature:
        return None
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) and data[k] for k in required):
        return None
    return data


def session_cookie_value(user_id: str, *, iat: float | None = None) -> str:
    return _session_serializer().dumps({"uid": user_id, "iat": time.time() if iat is None else iat})


def read_session_cookie(token: str | None, *, chat: bool | None = None) -> dict[str, Any] | None:
    """``{uid, iat}``, or None for a missing, forged or expired cookie. ``chat`` as for
    ``session_max_age``: the signature check is what ends the session."""
    if not token:
        return None
    try:
        data = _session_serializer().loads(token, max_age=session_max_age(chat=chat))
    except BadSignature:
        return None
    return data if isinstance(data, dict) and isinstance(data.get("uid"), str) else None


def cookie_kwargs() -> dict[str, Any]:
    return {"httponly": True, "samesite": "lax", "secure": is_https(), "path": cookie_path()}


def oauth_state_cookie(verifier: str, state: str, next_route: str | None) -> str:
    return _state_cookie(FS_OAUTH_SALT, {"verifier": verifier, "state": state}, next_route)


def read_oauth_state_cookie(token: str | None) -> dict[str, Any] | None:
    return _read_state_cookie(FS_OAUTH_SALT, token, FS_OAUTH_MAX_AGE)


def openrouter_state_cookie(uid: str, verifier: str, state: str, next_route: str | None) -> str:
    """The OpenRouter link's state: the session's uid, the PKCE verifier and the state the
    callback URL carries back. ``next`` as for FamilySearch, validated on the way in and out."""
    return _state_cookie(OR_OAUTH_SALT, {"uid": uid, "verifier": verifier, "state": state}, next_route)


def read_openrouter_state_cookie(token: str | None) -> dict[str, Any] | None:
    return _read_state_cookie(OR_OAUTH_SALT, token, OR_OAUTH_MAX_AGE, ("uid", "verifier", "state"))


def redirect_target(next_route: Any) -> str:
    """Where the callback lands the browser. ``next`` is re-validated on the way out: it
    came back on a cookie the browser holds. Always ``<origin>/``: under a prefix the SPA's
    relative URLs need the trailing slash."""
    target = f"{web_origin()}/"
    if isinstance(next_route, str) and SAFE_NEXT_RE.match(next_route):
        return f"{target}{next_route}"
    return target


def revoked(iat: Any, sessions_revoked_at: datetime | None) -> bool:
    if sessions_revoked_at is None:
        return False
    at = sessions_revoked_at if sessions_revoked_at.tzinfo else sessions_revoked_at.replace(tzinfo=timezone.utc)
    return float(iat or 0) <= at.timestamp()


# ── encryption at rest ───────────────────────────────────────────────────────────


def _fernet() -> Fernet:
    """The alpha's derivation, now ``grants.fernet`` -- so the worker decrypts what this tier
    writes, and a grant the alpha wrote reads here."""
    return grants.fernet(fs_token_enc_key())


def encrypt(value: str) -> str:
    return grants.encrypt(value, fs_token_enc_key())


def decrypt(value: str | None) -> str | None:
    """Soft-fails to None on a value written under another key or not ciphertext at all;
    callers treat None as "no grant". Never use an undecryptable value as plaintext."""
    return grants.decrypt(value, fs_token_enc_key())


# ── the FamilySearch round-trip ──────────────────────────────────────────────────


def pkce() -> tuple[str, str]:
    """(verifier, S256 challenge), both base64url without padding."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def redirect_uri() -> str:
    """``FS_REDIRECT_URI`` (#3992), else a TOP-LEVEL /callback on the public URL. The dev
    key's only registration is http://127.0.0.1:1837/callback, which is why the compose
    override publishes this tier on 1837. Under a prefix PUBLIC_URL carries it, so the
    default registration is ``<prefix>/callback``. ``authorize_url`` and ``exchange_code``
    both send this value, as FamilySearch requires."""
    return _env("FS_REDIRECT_URI", f"{public_url()}/callback")


def callback_path() -> str:
    """The path the callback route is served at: ``redirect_uri()``'s, less PUBLIC_URL's
    prefix when it sits under it on a segment boundary (the edge strips the prefix before
    the request reaches the tier). The path is taken exactly as FamilySearch will send the
    browser back to it, so it must be unreserved segments (``BASE_PATH_RE``: no trailing
    slash, no percent-encoding, which the route would match differently). Raises on a
    redirect that is not an absolute http(s) URL, carries a query or fragment, or whose path
    is empty, ``/`` or the prefix itself (each of those is the SPA's root), and on one on
    PUBLIC_URL's host outside its prefix, where the cookies are scoped. Another host stays
    allowed: P0.4's loopback bounce forwards to this one."""
    prefix = base_path()  # first, so a bad PUBLIC_URL is reported as itself
    uri = redirect_uri()
    parts = urlsplit(uri)
    path = parts.path
    if (parts.scheme not in ("http", "https") or not parts.hostname or "@" in parts.netloc
            or parts.query or parts.fragment or "?" in uri or "#" in uri or not path
            or not BASE_PATH_RE.match(path) or _has_dot_segment(path) or path == prefix):
        raise RuntimeError(
            f"Refusing to start: FS_REDIRECT_URI {uri!r} must be an absolute http(s) URL with no user "
            "info, whose path is one or more unreserved segments (A-Z a-z 0-9 . _ ~ -, no '.' or '..' "
            "segment) other than PUBLIC_URL's own path, with no trailing slash, query or fragment"
        )
    public = urlsplit(public_url())
    # Cookies are scoped to a host, whatever its port or spelling.
    same_host = parts.hostname.rstrip(".") == (public.hostname or "").rstrip(".")
    if same_host and parts.scheme != public.scheme:
        raise RuntimeError(
            f"Refusing to start: FS_REDIRECT_URI {uri!r} is on PUBLIC_URL's host under another scheme, "
            "where the sign-in cookies are not sent"
        )
    if prefix and same_host and not path.startswith(prefix + "/"):
        raise RuntimeError(
            f"Refusing to start: FS_REDIRECT_URI {uri!r} is on PUBLIC_URL's host but outside its path "
            f"{prefix!r}, where the sign-in cookies are not sent"
        )
    if prefix and path.startswith(prefix + "/"):
        path = path[len(prefix):]
    return path


def state_sha256(state: str) -> str:
    """The single-use state record's key (017_connector_auth.sql): lowercase hex sha256 of
    the UTF-8 state."""
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def authorize_url(challenge: str, state: str, *, chat: bool | None = None) -> str:
    """With the chat off (#3992) no ``scope`` at all: the beta refreshes nothing, so it asks
    for no ``offline_access``. With it on, exactly the handoff's request. ``chat`` as for
    ``session_max_age``."""
    from urllib.parse import urlencode

    params = {
        "response_type": "code",
        "client_id": client_id(),
        "redirect_uri": redirect_uri(),
        "scope": "offline_access",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if not (chat_enabled() if chat is None else chat):
        del params["scope"]
    return FS_AUTHORIZE_URL + "?" + urlencode(params)


class SigninBudget:
    """The web tier's own FamilySearch sign-in budget (#3992, ``GENEALOGY_SIGNIN_CALLS_PER_MINUTE``):
    at most ``limit`` calls in any sliding 60 s, held in process memory. ``try_take`` checks
    and takes in one synchronous step, so no other coroutine runs between the two, and takes
    all ``n`` units or none. ``clock`` is for tests."""

    WINDOW_S = 60.0

    def __init__(self, limit: int, clock: Any = time.monotonic) -> None:
        from collections import deque

        self.limit = limit
        self._clock = clock
        self._taken: deque[float] = deque()

    def try_take(self, n: int) -> bool:
        now = self._clock()
        while self._taken and now - self._taken[0] >= self.WINDOW_S:
            self._taken.popleft()
        if len(self._taken) + n > self.limit:
            return False
        self._taken.extend([now] * n)
        return True

    def give_back(self, n: int) -> None:
        """Return the ``n`` most recent units: a sign-in that took them and then made no
        FamilySearch call (it lost the state's consume) spent nothing."""
        for _ in range(min(n, len(self._taken))):
            self._taken.pop()


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
            headers={"Accept": "application/json", "User-Agent": BROWSER_USER_AGENT},
        )
    if resp.status_code != 200:
        return None
    body = resp.json()
    return body if isinstance(body, dict) and body.get("access_token") else None


async def refresh_tokens(refresh_token: str, *, transport: Any = None) -> grants.RefreshResult:
    """One ``grant_type=refresh_token`` POST, classified (``grants.classify_response``).
    No retries inside: the refresh loop is the retry.

    The whole call -- client construction included -- runs under ONE total deadline,
    ``grants.REFRESH_HTTP_TIMEOUT_S``. httpx's own ``timeout=`` is per phase, and its read
    timer restarts on every chunk, so a slow drip would otherwise hold the refresher's
    locks without bound. The deadline cannot tell whether FamilySearch processed the
    request, so it is ``ambiguous``; a refused connection never reached it (``not_sent``).
    ``transport`` is for tests."""
    import asyncio

    import httpx

    try:
        cid = client_id()
    except ClientConfigError:
        return grants.RefreshResult("not_sent", reason="client_config")
    extra: dict[str, Any] = {"transport": transport} if transport is not None else {}
    try:
        async with asyncio.timeout(grants.REFRESH_HTTP_TIMEOUT_S):
            async with httpx.AsyncClient(timeout=grants.REFRESH_HTTP_TIMEOUT_S, **extra) as client:
                resp = await client.post(
                    FS_TOKEN_URL,
                    data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": cid},
                    headers={"Accept": "application/json", "User-Agent": BROWSER_USER_AGENT},
                )
                try:
                    body = resp.json()
                except ValueError:
                    body = None
    except TimeoutError:
        return grants.RefreshResult("ambiguous", reason="deadline")
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        return grants.RefreshResult("not_sent", reason=type(exc).__name__)
    except httpx.HTTPError as exc:
        return grants.RefreshResult("ambiguous", reason=type(exc).__name__)
    return grants.classify_response(resp.status_code, body)


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


# ── the OpenRouter round-trip (#3988) ────────────────────────────────────────────


def openrouter_callback_url(state: str) -> str:
    """``<PUBLIC_URL>/openrouter/callback?state=<state>``. The state rides in the callback
    URL's own query string: OpenRouter appends ``code`` to the URL it was given, so this
    works whether or not it also echoes a separate ``state`` parameter (its docs said it did
    not when the issue was written, and say it does now)."""
    from urllib.parse import urlencode

    return f"{public_url()}/openrouter/callback?" + urlencode({"state": state})


def openrouter_authorize_url(challenge: str, state: str) -> str:
    from urllib.parse import urlencode

    return OPENROUTER_AUTH_URL + "?" + urlencode({
        "callback_url": openrouter_callback_url(state),
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "key_label": OPENROUTER_KEY_LABEL,
    })


@dataclass(frozen=True)
class OpenRouterExchange:
    """One code exchange. ``outcome``: ``ok`` (``key`` set); ``refused`` (a response, but a
    non-200 or no key: ``reason`` is the status); ``not_sent`` (the connection never opened,
    so no key was minted); ``ambiguous`` (sent, but no usable response arrived within the
    deadline: OpenRouter may have minted a key we never received). Never the body."""
    outcome: str
    key: str | None = None
    reason: str = ""


async def exchange_openrouter_code(code: str, verifier: str, *, transport: Any = None) -> OpenRouterExchange:
    """Code + verifier -> an ``OpenRouterExchange``. The whole call, client construction
    included, runs under ONE deadline, ``OPENROUTER_EXCHANGE_TIMEOUT_S``: httpx's own
    ``timeout=`` is per phase and its read timer restarts on every chunk, so a slow drip
    could otherwise outlast the edge's 60 s idle timeout (as ``refresh_tokens`` guards).
    ``transport`` is for tests."""
    import asyncio

    import httpx

    extra: dict[str, Any] = {"transport": transport} if transport is not None else {}
    try:
        async with asyncio.timeout(OPENROUTER_EXCHANGE_TIMEOUT_S):
            async with httpx.AsyncClient(timeout=OPENROUTER_EXCHANGE_TIMEOUT_S, **extra) as client:
                resp = await client.post(
                    OPENROUTER_KEYS_URL,
                    json={"code": code, "code_verifier": verifier, "code_challenge_method": "S256"},
                    headers={"Accept": "application/json"},
                )
                try:
                    body = resp.json()
                except ValueError:
                    body = None
    except TimeoutError:
        return OpenRouterExchange("ambiguous", reason="deadline")
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        return OpenRouterExchange("not_sent", reason=type(exc).__name__)
    except httpx.HTTPError as exc:
        return OpenRouterExchange("ambiguous", reason=type(exc).__name__)
    key = body.get("key") if resp.status_code == 200 and isinstance(body, dict) else None
    if isinstance(key, str) and key.strip():
        return OpenRouterExchange("ok", key=key)
    return OpenRouterExchange("refused", reason=str(resp.status_code))


def expires_at_from(token_json: dict[str, Any]) -> datetime:
    seconds = int(token_json.get("expires_in", FS_ACCESS_TOKEN_LIFETIME_S))
    return datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=seconds)
