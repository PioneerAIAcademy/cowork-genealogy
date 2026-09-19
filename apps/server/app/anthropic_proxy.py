"""Credential proxy — routes Anthropic API calls through the control plane so the
sandbox never holds the real API key.

The sandbox receives a per-sandbox proxy token (HMAC-derived, not the real key)
as its ``ANTHROPIC_API_KEY``, and ``ANTHROPIC_BASE_URL`` points at this endpoint.
The SDK sends requests here with the proxy token in the ``x-api-key`` header;
we validate it, replace it with the real key, and stream the response from
``api.anthropic.com``.

Token format: ``{sandbox_id}:{hmac_hex}``.  The sandbox_id is embedded so the
proxy can verify without a lookup table — same derivation pattern as
``ws_token.sandbox_secret``.
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
import logging

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from .config import get_settings
from .db import get_engine
from .models import Project

log = logging.getLogger(__name__)

UPSTREAM = "https://api.anthropic.com"
_PROXY_PREFIX = "/api/anthropic-proxy"

_DROP_REQUEST_HEADERS = frozenset({
    "host", "content-length", "transfer-encoding", "connection", "keep-alive",
    "proxy-connection", "te", "trailer", "upgrade",
})
_DROP_RESPONSE_HEADERS = frozenset({
    "content-length", "content-encoding", "transfer-encoding", "connection",
    "keep-alive", "trailer", "upgrade",
})

_UPSTREAM_TIMEOUT = httpx.Timeout(connect=30.0, read=600.0, write=30.0, pool=30.0)


def proxy_active() -> bool:
    """Whether the credential proxy is active (production only).

    Gated on an https ``public_url`` — the same production discriminant
    ``assert_production_config`` uses. Local dev (``make server``,
    ``make server-e2b``) runs http and falls back to the raw API key so the
    proxy URL is always reachable from inside the sandbox.
    """
    return get_settings().public_url.startswith("https")


def proxy_token(sandbox_id: str) -> str:
    """Derive a per-sandbox proxy token: ``{sandbox_id}:{hmac_hex}``."""
    key = get_settings().anthropic_proxy_signing_key
    sig = _hmac.new(key.encode(), sandbox_id.encode(), hashlib.sha256).hexdigest()
    return f"{sandbox_id}:{sig}"


def verify_proxy_token(token: str) -> str | None:
    """Return the sandbox_id if ``token`` is a valid proxy token, else None."""
    idx = token.rfind(":")
    if idx < 1:
        return None
    sandbox_id = token[:idx]
    expected = proxy_token(sandbox_id)
    if _hmac.compare_digest(token, expected):
        return sandbox_id
    return None


def _sandbox_exists(sandbox_id: str) -> bool:
    """Liveness check: is there an active Project row for this sandbox?"""
    with Session(get_engine()) as session:
        row = session.exec(
            select(Project.sandbox_id).where(
                Project.sandbox_id == sandbox_id,
                Project.status == "active",
            )
        ).first()
        return row is not None


def make_upstream_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=_UPSTREAM_TIMEOUT)


router = APIRouter()


def _error_json(error_type: str, message: str) -> str:
    return (
        f'{{"type":"error","error":'
        f'{{"type":"{error_type}","message":"{message}"}}}}'
    )


@router.api_route(
    f"{_PROXY_PREFIX}/{{path:path}}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def anthropic_proxy(path: str, request: Request) -> Response:
    token = request.headers.get("x-api-key") or ""
    sandbox_id = verify_proxy_token(token)
    if sandbox_id is None:
        return Response(
            content=_error_json("authentication_error", "invalid proxy token"),
            status_code=401,
            media_type="application/json",
        )

    if not _sandbox_exists(sandbox_id):
        log.warning("proxy: sandbox %s not found or archived", sandbox_id)
        return Response(
            content=_error_json("authentication_error",
                                "sandbox not found or archived"),
            status_code=401,
            media_type="application/json",
        )

    settings = get_settings()
    if not settings.anthropic_api_key:
        return Response(
            content=_error_json("authentication_error",
                                "Anthropic API key not configured on the control plane"),
            status_code=401,
            media_type="application/json",
        )

    log.info("proxy: forwarding %s %s for sandbox %s",
             request.method, path, sandbox_id)

    forwarded_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _DROP_REQUEST_HEADERS and k.lower() != "x-api-key"
    }
    forwarded_headers["x-api-key"] = settings.anthropic_api_key
    forwarded_headers["host"] = "api.anthropic.com"

    body = await request.body()
    upstream_url = f"{UPSTREAM}/{path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    client: httpx.AsyncClient = request.app.state.anthropic_proxy_client

    try:
        req = client.build_request(
            method=request.method,
            url=upstream_url,
            headers=forwarded_headers,
            content=body or None,
        )
        upstream_resp = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        log.warning("anthropic proxy upstream error: %s", exc)
        return Response(
            content=_error_json("api_error",
                                f"proxy upstream failure: {type(exc).__name__}"),
            status_code=502,
            media_type="application/json",
        )

    resp_headers = {
        k: v for k, v in upstream_resp.headers.multi_items()
        if k.lower() not in _DROP_RESPONSE_HEADERS
    }

    async def _relay():
        try:
            async for chunk in upstream_resp.aiter_bytes():
                yield chunk
        finally:
            await upstream_resp.aclose()

    return StreamingResponse(
        _relay(),
        status_code=upstream_resp.status_code,
        headers=resp_headers,
        media_type=upstream_resp.headers.get("content-type"),
    )
