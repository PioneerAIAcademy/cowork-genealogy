"""Claude's authorization server for the connector (#3997; docs/plan/self-hosted-mcp-beta.md, W2).

Registered only when ``OAUTH_ISSUER`` is set (``auth.oauth_issuer``), and imported only
then, so a tier without the setting loads none of the ``mcp`` SDK. A top-level module, like
``pages.py``: the Beanstalk web bundle copies only the top-level ``*.py`` files of
``proto/web/``.

The flow, for a client on the allowlist:

  GET  /.well-known/oauth-authorization-server   our own metadata (``metadata``)
  GET  /authorize    the SDK's handler; ``ConnectorProvider.authorize`` signs the request
                     and sends the browser to the consent page
  GET  /connect      the consent page
  POST /connect      same-origin only; starts the FamilySearch sign-in, carrying the request
                     in the signed ``fs_oauth`` cookie
  GET  <callback>    ``app.py``'s one callback; with the request in the cookie it mints a
                     code and sends the browser back to the client
  POST /token        the SDK's handler; the code becomes one long-lived token

Codes and tokens are stored only as sha256 (017_connector_auth.sql). No refresh token is
ever issued (lead, 2026-11-12), and none is honoured: a refresh request answers
``invalid_grant``, the code that sends a client back to ``/authorize``. That is why the
client record lists ``refresh_token`` while the metadata advertises ``authorization_code``
only: with the grant absent from the record the SDK would answer ``unsupported_grant_type``,
which the MCP TypeScript client does not recover from.

The SDK's own metadata route is not used: it has no client-document flag and prints the
issuer with a trailing slash, which the tools tier's ``authorization_servers`` does not.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import time
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.server.auth.routes import create_auth_routes
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyHttpUrl, AnyUrl

from web import auth
from web import pages

SCOPE = "genealogy"
MCP_PATH = "/mcp"
# The one constant that sets a connector token's life (lead, 2026-11-12: one long token, no
# refresh token). The door reads `connector_tokens.expires_at`, which is written from it.
TOKEN_LIFETIME_S = 30 * 24 * 60 * 60
# Claude's servers exchange the code at once; the probe's 120 s held in every sitting.
CODE_LIFETIME_S = 120
# The consent page's life: the signed request in its URL and hidden field.
CONSENT_MAX_AGE_S = 600
CONSENT_SALT = "connector-consent"
# A consent POST is one short form field; anything larger is not ours.
CONSENT_BODY_MAX = 16 * 1024
# An S256 challenge is exactly 43 base64url characters (RFC 7636 4.2). Bounding it, and
# the state, bounds the fs_oauth cookie that carries the request to the callback.
CODE_CHALLENGE_RE = re.compile(r"[A-Za-z0-9_-]{43}\Z")
STATE_MAX_BYTES = 1024
# The SDK routes this tier serves. Chosen by path, so a route a later SDK adds is not served.
SDK_PATHS = frozenset({"/authorize", "/token"})
METADATA_PATH = "/.well-known/oauth-authorization-server"

# The allowlist (W2): Claude's client metadata document and its one redirect, as recorded
# in four live sign-ins (issue #3529, item 6, and the probe's logs). Fixed here, so nothing
# is fetched at run time. `grant_types` lists refresh_token only so a refresh answers
# invalid_grant (module docstring).
CLAUDE_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata"
CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"


def _client(client_id: str, name: str, redirect_uri: str) -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        client_id=client_id,
        client_name=name,
        redirect_uris=[AnyUrl(redirect_uri)],
        token_endpoint_auth_method="none",
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        scope=SCOPE,
    )


CLIENTS: dict[str, OAuthClientInformationFull] = {
    CLAUDE_CLIENT_ID: _client(CLAUDE_CLIENT_ID, "Claude", CLAUDE_REDIRECT_URI),
}


def sha256_hex(value: str) -> str:
    """The stored form of a code or a token: lowercase hex sha256 of the UTF-8 value, as the
    door computes it (``sha256Hex``, packages/engine/mcp-server/src/http-server.ts)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def metadata(issuer: str) -> dict[str, Any]:
    """RFC 8414, in the shape Claude accepted from the probe. ``issuer`` is printed exactly
    as configured: the tools tier prints the same string in ``authorization_servers``."""
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/authorize",
        "token_endpoint": f"{issuer}/token",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [SCOPE],
        "client_id_metadata_document_supported": True,
    }


# -- the pending request: signed for the consent page, re-checked wherever it is read --------


def checked_pending(value: Any) -> dict[str, Any] | None:
    """``value`` as a pending authorization request, or None unless every field has the
    shape ``ConnectorProvider.authorize`` signed and still names an allowlisted client and
    one of its redirects. Run on every read (the consent page, its POST, the callback), so
    an allowlist change takes effect on requests already in flight."""
    if not isinstance(value, dict):
        return None
    client = CLIENTS.get(value.get("client_id")) if isinstance(value.get("client_id"), str) else None
    redirect_uri = value.get("redirect_uri")
    challenge = value.get("code_challenge")
    scopes = value.get("scopes")
    state = value.get("state")
    resource = value.get("resource")
    if (
        client is None
        or not isinstance(redirect_uri, str)
        or redirect_uri not in {str(uri) for uri in client.redirect_uris or []}
        or not isinstance(value.get("redirect_uri_provided_explicitly"), bool)
        or not isinstance(challenge, str)
        or not CODE_CHALLENGE_RE.match(challenge)
        or scopes != [SCOPE]
        or not (state is None or (isinstance(state, str) and len(state.encode("utf-8")) <= STATE_MAX_BYTES))
        or not (resource is None or isinstance(resource, str))
    ):
        return None
    return {
        "client_id": value["client_id"],
        "redirect_uri": redirect_uri,
        "redirect_uri_provided_explicitly": value["redirect_uri_provided_explicitly"],
        "code_challenge": challenge,
        "scopes": [SCOPE],
        "state": state,
        "resource": resource,
    }


def _consent_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(auth.session_secret(), salt=CONSENT_SALT)


def sign_consent(pending: dict[str, Any]) -> str:
    return _consent_serializer().dumps(pending)


def read_consent(token: str | None) -> dict[str, Any] | None:
    """The pending request a consent URL or form carries, or None when it is missing,
    altered, older than ``CONSENT_MAX_AGE_S`` or no longer passes ``checked_pending``."""
    if not token:
        return None
    try:
        value = _consent_serializer().loads(token, max_age=CONSENT_MAX_AGE_S)
    except BadSignature:
        return None
    return checked_pending(value)


def client_redirect(pending: dict[str, Any], code: str) -> str:
    """Where the callback sends the browser: the client's redirect URI with the code and
    the client's own ``state``, unchanged."""
    return construct_redirect_uri(pending["redirect_uri"], code=code, state=pending["state"])


# -- the SDK's provider, over the tier's store ------------------------------------------------


class ConnectorProvider:
    """``OAuthAuthorizationServerProvider`` for ``create_auth_routes``. ``store`` is called
    per request: the lifespan builds the tier's store after the routes are registered."""

    def __init__(self, store: Any, issuer: str) -> None:
        self._store = store
        self.issuer = issuer
        self.resource = f"{issuer}{MCP_PATH}"

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return CLIENTS.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        raise NotImplementedError("this server registers no clients")

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """The handler has checked the client, its redirect and its scope. Refusals here go
        back to the client as a redirect carrying ``error``; the code must be one of the
        SDK's seven, or the handler turns it into ``server_error``."""
        if params.resource is not None and params.resource != self.resource:
            raise AuthorizeError("invalid_request", f"resource must be {self.resource}")
        # The challenge's shape and the state's length are checked here, by the one check
        # every later read of the request runs too.
        pending = checked_pending({
            "client_id": client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "code_challenge": params.code_challenge,
            # RFC 6749 3.3: a request with no scope gets the default, never a null column.
            "scopes": params.scopes or [SCOPE],
            "state": params.state,
            "resource": params.resource,
        })
        if pending is None:
            raise AuthorizeError(
                "invalid_request",
                f"code_challenge must be a 43-character S256 challenge and state at most {STATE_MAX_BYTES} bytes",
            )
        return f"{self.issuer}/connect?" + urlencode({"request": sign_consent(pending)})

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        row = await self._store().load_authorization_code(sha256_hex(authorization_code))
        if row is None:
            return None
        return AuthorizationCode(
            code=authorization_code,
            scopes=list(row["scopes"]),
            # Postgres's now() decided expiry in the query (017: no host clock enters), so the
            # handler's own comparison against time.time() is given a value it always passes.
            expires_at=time.time() + CODE_LIFETIME_S,
            client_id=row["client_id"],
            code_challenge=row["code_challenge"],
            redirect_uri=AnyUrl(row["redirect_uri"]),
            redirect_uri_provided_explicitly=row["redirect_uri_provided_explicitly"],
            resource=row["resource"],
            subject=row["user_id"],
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        """One transaction deletes the code and stores the token's hash, so of two
        exchanges of one code exactly one gets a token."""
        token = secrets.token_urlsafe(32)
        exchanged = await self._store().exchange_authorization_code(
            sha256_hex(authorization_code.code), sha256_hex(token), TOKEN_LIFETIME_S,
        )
        if not exchanged:
            raise TokenError("invalid_grant", "authorization code does not exist")
        return OAuthToken(
            access_token=token, token_type="Bearer", expires_in=TOKEN_LIFETIME_S,
            scope=" ".join(authorization_code.scopes),
        )

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        return None  # none is ever issued; the handler answers invalid_grant

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        raise TokenError("invalid_grant", "refresh token does not exist")

    async def load_access_token(self, token: str) -> AccessToken | None:
        return None  # the tools tier admits tokens, by its own lookup

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        return None


# -- routes -----------------------------------------------------------------------------------

# The consent page and its refusals. Framing is refused (a framed page could be clicked
# through). `same-origin`, never `no-referrer`: under `no-referrer` a browser sends the
# form's POST with `Origin: null`, which the POST below refuses.
PAGE_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Cache-Control": "no-store",
    "Referrer-Policy": "same-origin",
}
# A redirect whose URL carries a code or a state: not stored, and not sent on as a Referer.
REDIRECT_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
EXPIRED = "This connection request is missing or has expired. Go back to Claude and connect again."
CROSS_SITE = "This connection request did not come from this site. Go back to Claude and connect again."


def _refused(message: str, status: int) -> HTMLResponse:
    return HTMLResponse(pages.consent_refused_page(message), status_code=status, headers=PAGE_HEADERS)


async def _form_field(request: Request, name: str) -> str | None:
    """One field of a small urlencoded form, or None. The body is bounded by its declared
    length before it is read, and never parsed as multipart. A body with no declared length
    (chunked) is refused unread: a browser's form post always declares one, and the server
    reads no more than was declared, so this one check bounds what is read."""
    declared = request.headers.get("content-length", "")
    if not declared.isascii() or not declared.isdigit() or int(declared) > CONSENT_BODY_MAX:
        return None
    body = await request.body()
    values = parse_qs(body.decode("utf-8", "replace")).get(name)
    return values[0] if values else None


def register(app: FastAPI, issuer: str) -> ConnectorProvider:
    """Add the authorization server's routes to ``app``. ``issuer`` is ``auth.oauth_issuer()``,
    already checked to be this tier's own origin."""
    provider = ConnectorProvider(lambda: app.state.store, issuer)
    sdk_routes = create_auth_routes(
        provider,
        AnyHttpUrl(issuer),
        client_registration_options=ClientRegistrationOptions(enabled=False),
        revocation_options=RevocationOptions(enabled=False),
    )
    kept = [route for route in sdk_routes if route.path in SDK_PATHS]
    if {route.path for route in kept} != SDK_PATHS:
        raise RuntimeError(f"the mcp SDK no longer provides {sorted(SDK_PATHS)}; see web/connector_auth.py")
    app.router.routes.extend(kept)
    document = metadata(issuer)
    origin = urlsplit(issuer)
    public_origin = f"{origin.scheme}://{origin.netloc}"

    @app.get(METADATA_PATH)
    async def authorization_server_metadata() -> JSONResponse:
        return JSONResponse(document)

    @app.get("/connect")
    async def consent(request: Request) -> Response:
        signed = request.query_params.get("request")
        pending = read_consent(signed)
        if pending is None:
            return _refused(EXPIRED, 400)
        client = CLIENTS[pending["client_id"]]
        return HTMLResponse(
            pages.consent_page(
                signed_request=signed or "",
                client_name=client.client_name or "",
                redirect_host=urlsplit(pending["redirect_uri"]).hostname or "",
            ),
            headers=PAGE_HEADERS,
        )

    @app.post("/connect")
    async def consent_agreed(request: Request) -> Response:
        """The consent click. It needs a same-origin ``Origin``: a missing or ``null`` one
        is refused, so no other site can post this form for a signed-in FamilySearch user.
        Nothing is written before the request it carries has passed its signature."""
        if request.headers.get("origin") != public_origin:
            return _refused(CROSS_SITE, 403)
        pending = read_consent(await _form_field(request, "request"))
        if pending is None:
            return _refused(EXPIRED, 400)
        verifier, challenge = auth.pkce()
        state = secrets.token_urlsafe(16)
        # The single-use record the callback consumes before it calls FamilySearch (#3992).
        await app.state.store.create_signin_state(auth.state_sha256(state))
        resp = RedirectResponse(auth.authorize_url(challenge, state, chat=False), status_code=303,
                                headers=REDIRECT_HEADERS)
        resp.set_cookie(
            auth.FS_OAUTH_COOKIE, auth.connector_state_cookie(verifier, state, pending),
            max_age=auth.FS_OAUTH_MAX_AGE, **auth.cookie_kwargs(),
        )
        return resp

    return provider
