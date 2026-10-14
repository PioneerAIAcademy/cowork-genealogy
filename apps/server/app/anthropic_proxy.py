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

Each Messages API call's usage is read off the response on its way back
(``_UsageMeter``) and recorded to ``api_calls``. Recording only: the alpha has no
spend limit (lead ruling 2026-09-25), so nothing here refuses a call on cost.
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from .agent.spend import price_usd, usage_tokens
from .config import get_settings
from .db import get_engine
from .models import ApiCall, Project, utcnow

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

_METERED_PATH = "v1/messages"
_USAGE_EVENTS = (b"message_start", b"message_delta")
# One thread writes every row: off the event loop and in order, so a test can wait for
# the rows by queueing behind them.
_usage_writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="api-usage")


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


def _active_project(sandbox_id: str) -> Project | None:
    """Liveness check: the active Project row for this sandbox, if there is one."""
    with Session(get_engine()) as session:
        return session.exec(
            select(Project).where(
                Project.sandbox_id == sandbox_id,
                Project.status == "active",
            )
        ).first()


def make_upstream_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=_UPSTREAM_TIMEOUT)


def _save(row: ApiCall) -> None:
    try:
        with Session(get_engine()) as session:
            session.add(row)
            session.commit()
    except Exception:  # noqa: BLE001 — raised here, it would vanish into an unread Future
        log.exception("proxy: could not record an API call for project %s", row.project_id)


class _UsageMeter:
    """Reads one Messages API call's usage off the response as the relay passes it on.

    Streamed, ``message_start`` carries the model and the input-side counts, and each
    ``message_delta`` the counts so far. Every count is a running total, so a later one
    replaces an earlier one and none is ever added to another. Not streamed, the body
    carries ``usage`` itself. Nothing here raises into the relay."""

    def __init__(self, project: Project, streaming: bool):
        self._project = project
        self._streaming = streaming
        self._buf = b""
        self._event = b""
        self._model: str | None = None
        self._usage: dict[str, int] = {}

    def feed(self, chunk: bytes) -> None:
        self._buf += chunk
        if self._streaming:
            *lines, self._buf = self._buf.split(b"\n")
            for line in lines:
                self._line(line.rstrip(b"\r"))

    def _line(self, line: bytes) -> None:
        if not line:
            self._event = b""
        elif line.startswith(b"event:"):
            self._event = line[6:].strip()
        elif line.startswith(b"data:") and self._event in _USAGE_EVENTS:
            self._take(line[5:])

    def _take(self, raw: bytes) -> None:
        try:
            data = json.loads(raw)
            body = data.get("message") or data
            self._model = body.get("model") or self._model
            self._usage.update(
                (k, v) for k, v in (body.get("usage") or {}).items() if isinstance(v, int)
            )
        except Exception:  # noqa: BLE001 — never into the relay
            log.warning("proxy: unreadable usage for project %s", self._project.id)

    def record(self) -> None:
        """Queue this call's row for the writer. The relay calls it in its ``finally``
        before anything there awaits: a dropped connection cancels the relay, and a call
        cut off mid-stream was still billed for what it had read."""
        try:
            if not self._streaming:
                self._take(self._buf)
            if self._model is None and not self._usage:
                return
            tokens = usage_tokens(self._usage)
            created = self._project.created
            if created.tzinfo is None:  # SQLite hands back naive datetimes
                created = created.replace(tzinfo=timezone.utc)
            _usage_writer.submit(_save, ApiCall(
                project_id=self._project.id,
                user_id=self._project.user_id,
                model=self._model,
                input_tokens=tokens[0],
                cache_creation_input_tokens=tokens[1],
                cache_read_input_tokens=tokens[2],
                output_tokens=tokens[3],
                cost_usd=price_usd(tokens, self._model),
                session_age_s=int((utcnow() - created).total_seconds()),
            ))
        except Exception:  # noqa: BLE001 — the relay's finally must reach aclose()
            log.exception("proxy: could not meter an API call for project %s",
                          self._project.id)


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

    project = _active_project(sandbox_id)
    if project is None:
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

    content_type = upstream_resp.headers.get("content-type", "")
    meter = None
    if (request.method == "POST" and path.strip("/") == _METERED_PATH
            and upstream_resp.status_code == 200):
        meter = _UsageMeter(project, streaming=content_type.startswith("text/event-stream"))

    async def _relay():
        try:
            async for chunk in upstream_resp.aiter_bytes():
                if meter is not None:
                    meter.feed(chunk)
                yield chunk
        finally:
            if meter is not None:
                meter.record()
            await upstream_resp.aclose()

    return StreamingResponse(
        _relay(),
        status_code=upstream_resp.status_code,
        headers=resp_headers,
        media_type=upstream_resp.headers.get("content-type"),
    )
