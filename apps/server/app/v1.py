"""Public `/v1` REST chat API for an external chatbot team (bearer-only).

Three endpoints: create a session, send a message (sync JSON or, with stream:true,
SSE), and delete a session. Lean shapes that hide internal fields.

How a turn is observed
----------------------
The realtime re-architecture moved the agent stream INTO the sandbox: the browser
connects a WebSocket straight to the in-sandbox WS server (app/sandbox_server.py)
and the control plane is otherwise out of the streaming path. So to "send a message
and get the reply," this router does what the browser does — it becomes a WS client
of the sandbox: reuse the `/connect` plumbing (resume + expose_port + mint_token),
open a socket, send `{type:"user_msg"}`, and read `agent_event` frames until
`turn_done`, assembling the reply (sync) or relaying it as SSE (stream).

Concurrency (one turn at a time per session)
--------------------------------------------
Enforced by a DB-backed lock — a guarded UPDATE on `Project.turn_locked_at`. The DB
serializes the conditional write, so exactly one caller wins regardless of how many
control-plane instances are running (the affinity-free property the realtime re-arch
was built for). Correct on SQLite today and on Postgres after the Neon migration; no
in-memory/per-instance state. A second concurrent message → 409. A lock older than
`v1_turn_lock_stale_seconds` is reclaimed, so a crashed instance can't wedge a
session. On a fresh WS connection the Hub replays its snapshot + transcript history
before live frames, so we first drain that burst (read until the socket goes idle)
before sending.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import timedelta

import websockets
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import update as sa_update
from sqlmodel import Session

from . import agent_secrets
from .auth import get_api_client
from .config import get_settings
from .db import get_engine, get_session
from .models import Project, User, utcnow
from .sandbox import SandboxProvider
from .sandbox.base import SANDBOX_WS_PORT
from .sessions import FsTokenIn, _owned, create_project, get_provider
from .ws_token import mint_token

router = APIRouter(prefix="/v1", tags=["public-api"])

# Seconds of silence that marks the end of the in-sandbox snapshot/history replay
# burst (so we don't read replayed frames as the new turn's reply).
_DRAIN_IDLE = 0.5
# Whole-drain ceiling. _DRAIN_IDLE bounds one recv; nothing bounded the LOOP, so
# a socket that always has a frame ready never goes idle and the drain never
# returns. Reachable without a bug on either path: the streaming cap abandons a
# still-running agent after v1_stream_idle_seconds of silence, and the next
# message on that session reconnects and drains -- if the agent resumed
# producing meanwhile, the drain spins while holding the turn lock, which is the
# wedge this card exists to remove. Well inside v1_turn_timeout_seconds (120) so
# no drain can consume a caller's whole budget. Same name and value as PR #2371
# uses, so the two land without a conflict.
_DRAIN_MAX = 30.0
# SSE heartbeat interval: emit a comment if no frame arrives within this window so
# proxies don't drop a long-running stream.
_HEARTBEAT_S = 15.0
# The text of the `error` event a stream turn ends on when it exceeds
# v1_stream_idle_seconds without a non-ping frame. It names the SAME code the
# sync path's 504 carries (`turn_timeout`), because it is the same condition
# reported on the transport that cannot carry a status line. The published
# `finish_reason` enum stays "stop" | "error" — a third value would be a
# breaking change to the response contract for a case the error text already
# distinguishes.
_IDLE_MESSAGE = (
    "turn_timeout: the turn produced no output for "
    "v1_stream_idle_seconds and was ended. Retry, or send a shorter request."
)
# Retry the in-process connect to the freshly-launched sandbox WS server until it
# is listening (~5s budget).
_CONNECT_ATTEMPTS = 50
_CONNECT_RETRY_S = 0.1


class _TurnTimeout(Exception):
    """Sync turn exceeded v1_turn_timeout_seconds."""


# ── request/response models ──────────────────────────────────────
class SessionOut(BaseModel):
    session_id: str
    title: str
    model: str
    created_at: object  # datetime; serialized to ISO-8601 by FastAPI


class CreateBody(BaseModel):
    title: str | None = None
    model: str | None = None
    # Optional FamilySearch token to authenticate the in-sandbox MCP for this session.
    # /v1 clients have no FS app-login row, so they pass it here; it is injected into
    # the sandbox at create and never persisted. Include refresh_token for sessions
    # that outlive the ~1h access-token TTL (see FsTokenIn). Omit → FS-tool-less session.
    familysearch_token: FsTokenIn | None = None


class MessageBody(BaseModel):
    message: str = Field(min_length=1)
    stream: bool = False


# ── turn lock (DB-backed, cross-instance) ────────────────────────
def _acquire_turn(session: Session, session_id: str):
    """Atomically claim the per-session turn lock via a guarded UPDATE on the
    Project row (also bumps last_active in the same write). Returns the lock token
    (the timestamp set) on success, or None if a non-stale turn already holds it.

    The DB applies the WHERE at write time under its write lock, so this is a true
    test-and-set — no check-then-act race across instances. Stale locks (older than
    v1_turn_lock_stale_seconds) are reclaimed."""
    now = utcnow()
    stale_before = now - timedelta(seconds=get_settings().v1_turn_lock_stale_seconds)
    stmt = (
        sa_update(Project)
        .where(
            Project.id == session_id,
            (Project.turn_locked_at.is_(None)) | (Project.turn_locked_at < stale_before),
        )
        .values(turn_locked_at=now, last_active=now)
        # Skip the Python-side WHERE re-evaluation against loaded objects: SQLite
        # reads tz-aware columns back naive, which would TypeError against our aware
        # param. We don't reuse the in-session Project after this, so SQL-only is fine.
        .execution_options(synchronize_session=False)
    )
    result = session.execute(stmt)
    session.commit()
    return now if result.rowcount == 1 else None


def _release_turn(session_id: str, token) -> None:
    """Release the lock IFF we still hold it (turn_locked_at == the token we set),
    so a staleness takeover by another instance isn't clobbered. Uses a fresh DB
    session — a streaming turn releases after the request-scoped session has closed.
    If we no longer hold it this is a harmless no-op (the lock self-heals via TTL)."""
    stmt = (
        sa_update(Project)
        .where(Project.id == session_id, Project.turn_locked_at == token)
        .values(turn_locked_at=None)
        .execution_options(synchronize_session=False)
    )
    with Session(get_engine()) as s:
        s.execute(stmt)
        s.commit()


# ── in-sandbox WS client ─────────────────────────────────────────
async def _open_ws(provider: SandboxProvider, sandbox_id: str):
    """Open a WS to the in-sandbox server, the same way /connect hands the browser
    a URL: resume → expose_port → mint a handshake token.

    expose_port has just (re)launched the WS server, which may not be listening
    yet — the browser path connects a moment later over the network, but we connect
    in-process immediately — so retry the TCP connect briefly until it is up."""
    sandbox = await provider.resume(sandbox_id)
    await agent_secrets.write_secrets(sandbox)  # same refresh the browser /connect does
    conn = await sandbox.expose_port(SANDBOX_WS_PORT)
    token = mint_token(sandbox_id)
    url = f"{conn.url}/?token={token}"
    # max_size=None: viewer-delta frames (whole research.json) can exceed the 1 MiB
    # default; we ignore those but must not let one crash the connection.
    extra = {"additional_headers": conn.headers} if conn.headers else {}
    last: Exception | None = None
    for _ in range(_CONNECT_ATTEMPTS):
        try:
            return await websockets.connect(url, open_timeout=20, max_size=None, **extra)
        except OSError as exc:  # server not listening yet (ECONNREFUSED, etc.)
            last = exc
            await asyncio.sleep(_CONNECT_RETRY_S)
    raise last if last is not None else RuntimeError("could not connect to sandbox WS server")


def _normalize(raw: str):
    """Map an in-sandbox frame to a public ('kind', payload) tuple, or None to
    ignore. kind ∈ {text, tool, error, done}. thinking/status/viewer deltas drop."""
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if msg.get("type") != "agent_event":
        return None
    ev = msg.get("event") or {}
    kind = ev.get("kind")
    if kind == "turn_done":
        return ("done", None)
    if kind == "text":
        return ("text", ev.get("text", ""))
    if kind in ("tool_use", "tool_result"):
        return ("tool", {"type": kind, "tool": ev.get("tool", ""), "summary": ev.get("summary", "")})
    if kind == "error":
        return ("error", ev.get("text", ""))
    return None


def _is_liveness(raw: str) -> bool:
    """Does this frame prove the turn is still alive?

    EVERY in-sandbox frame except the Hub's heartbeat counts, and both halves of
    that are load-bearing:

    - Not "any frame". The Hub broadcasts {"type":"ping"} to every connected
      client every WS_HEARTBEAT_INTERVAL seconds (sandbox_server), so an idle
      clock reset by any frame can never fire — the pings keep arriving whether
      the agent is working or dead. `_normalize` drops them from the public
      stream, which is exactly why they are invisible here unless looked for.
    - Not "only public events". A real turn is silent of text/tool frames for
      minutes while a subagent works — the reason the heartbeat loop exists at
      all — so counting only what `_normalize` returns would fire on a HEALTHY
      turn. `status` frames and viewer deltas are dropped from the public stream
      but are still proof the sandbox is doing something.

    An unparseable frame counts as liveness: it is not a ping, and the socket
    delivering something is evidence. Failing toward "alive" keeps this from
    ending a legitimate turn, which is the worse error here.
    """
    try:
        return (json.loads(raw) or {}).get("type") != "ping"
    except (json.JSONDecodeError, AttributeError, TypeError):
        return True


async def _drain_replay(ws) -> None:
    """Consume the snapshot/history replay burst, stopping once the socket has been
    idle for _DRAIN_IDLE or _DRAIN_MAX has elapsed. A cancelled recv leaves any
    buffered frame for the next recv, so no live-turn frame is lost.

    The ceiling is bounded HERE rather than at the call sites because there are
    two of them and the second is easy to miss: `_collect_sync` drains at :238
    and only then sets its `deadline`, so `v1_turn_timeout_seconds` never
    covered its drain at all. A per-site wrapper would have left the sync path,
    which is the default, still unbounded.
    """
    deadline = time.monotonic() + _DRAIN_MAX
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        # The wait is clipped to whatever is left of the ceiling, so a timeout
        # means EITHER the socket went idle for a full _DRAIN_IDLE or the
        # ceiling ran out. Both are "stop draining", so neither needs its own
        # branch -- an earlier version distinguished them and no mutation of
        # that branch could be made to fail a test, because the loop top
        # returns on the next pass regardless.
        try:
            await asyncio.wait_for(ws.recv(), timeout=min(_DRAIN_IDLE, remaining))
        except asyncio.TimeoutError:
            return
        except websockets.ConnectionClosed:
            return


# ── sync path ────────────────────────────────────────────────────
async def _collect_sync(ws, message: str, timeout_s: int) -> dict:
    await _drain_replay(ws)
    await ws.send(json.dumps({"type": "user_msg", "text": message}))
    deadline = time.monotonic() + timeout_s
    text_parts: list[str] = []
    tool_calls: list[dict] = []
    finish, error = "stop", None
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _TurnTimeout()
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            raise _TurnTimeout()
        ev = _normalize(raw)
        if ev is None:
            continue
        kind, payload = ev
        if kind == "done":
            break
        if kind == "text":
            text_parts.append(payload)
        elif kind == "tool":
            tool_calls.append({"tool": payload["tool"], "summary": payload["summary"]})
        elif kind == "error":
            finish, error = "error", payload
    return {"text": "".join(text_parts), "tool_calls": tool_calls,
            "finish_reason": finish, "error": error}


async def _handle_sync(provider, sandbox_id: str, message: str, session_id: str, token):
    try:
        ws = await _open_ws(provider, sandbox_id)
        try:
            result = await _collect_sync(ws, message, get_settings().v1_turn_timeout_seconds)
        finally:
            await ws.close()
    except _TurnTimeout:
        raise HTTPException(status_code=504, detail={
            "code": "turn_timeout",
            "message": "The turn did not complete in time; use stream=true for long turns.",
        })
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surface as a stable envelope
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(exc)})
    finally:
        _release_turn(session_id, token)
    resp = {
        "session_id": session_id, "role": "assistant", "text": result["text"],
        "tool_calls": result["tool_calls"], "finish_reason": result["finish_reason"],
    }
    if result["error"] is not None:
        resp["error"] = result["error"]
    return resp


# ── stream (SSE) path ────────────────────────────────────────────
def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _handle_stream(provider, sandbox_id: str, message: str, session_id: str, token):
    try:
        ws = await _open_ws(provider, sandbox_id)
    except Exception as exc:  # noqa: BLE001
        _release_turn(session_id, token)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(exc)})

    async def gen():
        text_parts: list[str] = []
        finish = "stop"
        idle_cap = get_settings().v1_stream_idle_seconds
        last_alive = time.monotonic()
        try:
            await _drain_replay(ws)
            await ws.send(json.dumps({"type": "user_msg", "text": message}))
            while True:
                # Checked at the TOP of the loop, not only on a recv timeout,
                # because a recv timeout is not reached when the agent is silent
                # but the Hub is not: its pings return from `recv()` inside
                # _HEARTBEAT_S forever, so a check hung off `asyncio.TimeoutError`
                # alone would never run in the case this cap exists for. Here the
                # loop turns over at least every _HEARTBEAT_S either way — on a
                # ping or on the timeout — so this is reached in both.
                if time.monotonic() - last_alive >= idle_cap:
                    finish = "error"
                    yield _sse("error", {"type": "error", "text": _IDLE_MESSAGE})
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=_HEARTBEAT_S)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                except websockets.ConnectionClosed:
                    break
                if _is_liveness(raw):
                    last_alive = time.monotonic()
                ev = _normalize(raw)
                if ev is None:
                    continue
                kind, payload = ev
                if kind == "done":
                    break
                if kind == "text":
                    text_parts.append(payload)
                    yield _sse("delta", {"type": "text", "text": payload})
                elif kind == "tool":
                    yield _sse("tool", payload)
                elif kind == "error":
                    finish = "error"
                    yield _sse("error", {"type": "error", "text": payload})
            yield _sse("done", {
                "session_id": session_id, "text": "".join(text_parts), "finish_reason": finish,
            })
        finally:
            await ws.close()
            _release_turn(session_id, token)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── routes ───────────────────────────────────────────────────────
@router.post("/sessions", status_code=201, response_model=SessionOut)
async def create_v1_session(
    body: CreateBody,
    user: User = Depends(get_api_client),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> SessionOut:
    project = await create_project(
        session=session, provider=provider, user=user, title=body.title, model=body.model,
        fs_token=body.familysearch_token,
    )
    return SessionOut(
        session_id=project.id, title=project.title, model=project.model, created_at=project.created,
    )


@router.post("/sessions/{session_id}/messages")
async def send_v1_message(
    session_id: str,
    body: MessageBody,
    user: User = Depends(get_api_client),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
):
    project = _owned(session, user, session_id)  # ownership/isolation → 404
    sandbox_id = project.sandbox_id  # capture before the lock write expires the ORM object
    token = _acquire_turn(session, session_id)
    if token is None:
        raise HTTPException(status_code=409, detail={
            "code": "session_busy",
            "message": "A turn is already in progress for this session; retry after a short backoff.",
        })
    if body.stream:
        return await _handle_stream(provider, sandbox_id, body.message, session_id, token)
    return await _handle_sync(provider, sandbox_id, body.message, session_id, token)


@router.delete("/sessions/{session_id}")
async def delete_v1_session(
    session_id: str,
    user: User = Depends(get_api_client),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    project = _owned(session, user, session_id)
    await provider.delete(project.sandbox_id)
    session.delete(project)  # the turn lock is a column on this row → gone with it
    session.commit()
    return {"deleted": True, "session_id": session_id}
