"""Prototype web tier (docs/plan/search-agent-prototype.md, Week 3, D11-12).

The stateless tier between the browser and the queue. It never runs the SDK and never
sees the model stream: the worker (D9-10) writes ``map_message`` output into
``session_events`` / ``session_activity`` and this tier only *reads* those rows, so a
turn's evidence reaches Postgres without a hop that dies with the worker.

Routes are on the same paths ``apps/web`` already calls (``api.ts``), so the SPA is
reused verbatim with ``VITE_SESSION_TRANSPORT=sse``:

  POST /api/sessions/{id}/messages {text}      mint turn_id, record it, enqueue it   -> 202
  GET  /api/sessions/{id}/events?after=N       one-shot poll read (JSON)
  GET  /api/sessions/{id}/events/stream        text/event-stream; Last-Event-ID resume
  GET/POST /api/sessions, GET/PATCH/DELETE /api/sessions/{id}, POST .../resume, GET .../state
  GET  /auth/config, /auth/me, POST /auth/dev-login, /auth/logout   (no auth -- see README)
  GET  .../sidecar/{log_id} -> 404;  .../image, .../logs, .../files, .../interrupt -> 501

The turn message body is ``{turn_id, session_id, project_id, text, enqueued_at}``. The
``turn_id`` is a UUID minted here and travels IN THE BODY -- never the SQS MessageId,
which the shim holds and the worker never sees.

Row -> wire contract (the worker writes the rows; the SPA's chatEvents.ts reads the wire):

  session_events.kind = 'user_msg', payload {text, turn_id}
      -> {"type": "user_msg", "text", "turn_id", "seq"}
  session_events.kind = <any map_message kind>, payload = the event's fields
      -> {"type": "agent_event", "event": {**payload, "kind": kind}, "seq"}
  session_activity.payload
      -> {"type": "agent_event", "event": {**payload, "kind": "task_progress"}}   (no id)
  documents.version moved
      -> {"type": "research_updated" | "gedcomx_updated", "name", "data": <doc>}  (no id)

Only ``session_events`` frames carry ``id: <seq>``, so ``Last-Event-ID`` is always a seq
and the transient frames are never replayed -- the same split as TRANSIENT_KINDS in the
hosted runner.

Env: PG_DSN (postgresql://postgres:proto@localhost:5434/proto), QUEUE_URL (a full SQS
queue URL, the shim's shape; unset -> NullQueue, turns are recorded but not enqueued),
POLL_S (1), SSE_PING_S (15). Startup applies proto/sql/*.sql (all idempotent).

Run: from apps/server, ``uv run python proto/web/app.py``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
PROTO_DIR = HERE.parent
SQL_DIR = PROTO_DIR / "sql"
# enqueue.py is a sibling of this package in the repo (proto/) and in the container
# (/app); make it importable from wherever uvicorn, the driver or pytest started.
if str(PROTO_DIR) not in sys.path:
    sys.path.insert(0, str(PROTO_DIR))

import enqueue  # noqa: E402  (the D3 SQS query-API client; reused, not edited)

log = logging.getLogger("proto.web")

DEFAULT_PG_DSN = "postgresql://postgres:proto@localhost:5434/proto"
DEFAULT_TITLE = "New research session"
DEFAULT_MODEL = "claude-sonnet-4-6"
EVENTS_PAGE = 500
# documents.name -> the wire type the SPA's WsResearchTransport already folds.
DOC_WIRE = {"research.json": "research_updated", "tree.gedcomx.json": "gedcomx_updated"}
PROTO_USER = {"id": "proto", "email": "proto@localhost"}


# ── rows ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SessionRow:
    session_id: str
    project_id: str
    title: str
    model: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class EventRow:
    seq: int
    kind: str
    payload: dict[str, Any]
    ts: datetime


@dataclass(frozen=True)
class Activity:
    updated_at: datetime
    payload: dict[str, Any]


@dataclass(frozen=True)
class Turn:
    turn_id: str
    seq: int  # the user_msg event's seq
    body: dict[str, Any]  # the queue message


class Store(Protocol):
    async def create_session(self, title: str, model: str) -> SessionRow: ...
    async def list_sessions(self) -> list[SessionRow]: ...
    async def get_session(self, session_id: str) -> SessionRow | None: ...
    async def patch_session(self, session_id: str, title: str | None, model: str | None) -> SessionRow | None: ...
    async def delete_session(self, session_id: str) -> bool: ...
    async def document_versions(self, project_id: str) -> dict[str, int]: ...
    async def documents(self, project_id: str) -> dict[str, tuple[int, Any]]: ...
    async def begin_turn(self, session: SessionRow, text: str) -> Turn: ...
    async def fail_turn(self, turn_id: str, reason: str) -> None: ...
    async def events_after(self, session_id: str, after: int, limit: int) -> list[EventRow]: ...
    async def activity(self, session_id: str) -> Activity | None: ...
    async def turn_active(self, session_id: str) -> bool: ...


class Queue(Protocol):
    async def send(self, body: dict[str, Any]) -> str: ...


# ── pure helpers (tested without I/O) ────────────────────────────────────────────


def sse_frame(data: dict[str, Any], *, seq: int | None = None) -> str:
    """One SSE event. ``id:`` only when the frame is a session_events row."""
    head = f"id: {seq}\n" if seq is not None else ""
    return f"{head}data: {json.dumps(data, separators=(',', ':'), default=str)}\n\n"


def row_to_wire(row: EventRow) -> dict[str, Any]:
    if row.kind == "user_msg":
        return {
            "type": "user_msg",
            "text": str(row.payload.get("text", "")),
            "turn_id": row.payload.get("turn_id"),
            "seq": row.seq,
        }
    return {"type": "agent_event", "event": {**row.payload, "kind": row.kind}, "seq": row.seq}


def activity_to_wire(activity: Activity) -> dict[str, Any]:
    return {"type": "agent_event", "event": {**activity.payload, "kind": "task_progress"}}


def resolve_cursor(last_event_id: str | None, after: str | None) -> int:
    """The header wins: it is what the browser's automatic reconnect sends."""
    raw = last_event_id if last_event_id not in (None, "") else after
    if raw in (None, ""):
        return 0
    value = int(str(raw).strip())  # ValueError -> 400 at the route
    if value < 0:
        raise ValueError("cursor must be >= 0")
    return value


def session_out(row: SessionRow) -> dict[str, Any]:
    """Every key of api.ts's SessionSummary; SessionList dereferences model/last_active."""
    return {
        "id": row.session_id,
        "title": row.title,
        "model": row.model,
        "status": "active",
        "sandbox_id": "",
        "agent_session_id": None,
        "created": row.created_at.isoformat(),
        "updated": row.updated_at.isoformat(),
        "last_active": row.updated_at.isoformat(),
    }


async def stream_frames(
    store: Store,
    session: SessionRow,
    cursor: int,
    *,
    poll_s: float,
    ping_s: float,
    max_polls: int | None = None,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[str]:
    """The SSE body: a Postgres poll every ``poll_s``, ``: ping`` after ``ping_s`` idle.

    Order at open, and why: ``retry:``; the catch-up rows after the cursor; the current
    documents once (the WS server's send_snapshot -- a version bump during a disconnect
    would otherwise never reach the viewer, which hydrates /state only at mount); THEN
    ``status turn_active`` if a turn is in flight. The status must follow the replay:
    ChatPane clears busy on every ``turn_done``, so a replayed one landing after the
    status would show idle while the agent works -- the same order sandbox_server.py
    uses (history, then chat_ready, then turn_active).

    ``max_polls`` bounds the loop for a route-level test; production passes None and
    stops on client disconnect.
    """
    sid, pid = session.session_id, session.project_id
    activity = await store.activity(sid)
    seen_activity = activity.updated_at if activity else None
    docs = await store.documents(pid)
    seen_versions = {name: version for name, (version, _) in docs.items()}
    yield "retry: 1000\n\n"
    rows = await store.events_after(sid, cursor, EVENTS_PAGE)
    while rows:  # the whole backlog before the status frame, page by page
        for row in rows:
            yield sse_frame(row_to_wire(row), seq=row.seq)
            cursor = row.seq
        rows = await store.events_after(sid, cursor, EVENTS_PAGE) if len(rows) >= EVENTS_PAGE else []
    for name, (_, doc) in docs.items():
        yield sse_frame({"type": DOC_WIRE.get(name, "document_updated"), "name": name, "data": doc})
    if await store.turn_active(sid):
        yield sse_frame({"type": "status", "state": "turn_active"})
    last_sent = time.monotonic()
    polls = 0
    while max_polls is None or polls < max_polls:
        polls += 1
        sent = False
        rows = await store.events_after(sid, cursor, EVENTS_PAGE)
        for row in rows:
            yield sse_frame(row_to_wire(row), seq=row.seq)
            cursor = row.seq
            sent = True
        activity = await store.activity(sid)
        if activity is not None and activity.updated_at != seen_activity:
            seen_activity = activity.updated_at
            yield sse_frame(activity_to_wire(activity))
            sent = True
        versions = await store.document_versions(pid)
        if versions != seen_versions:
            docs = await store.documents(pid)
            for name, (version, doc) in docs.items():
                if seen_versions.get(name) != version:
                    yield sse_frame({"type": DOC_WIRE.get(name, "document_updated"), "name": name, "data": doc})
                    sent = True
            seen_versions = versions
        now = time.monotonic()
        if sent:
            last_sent = now
        elif now - last_sent >= ping_s:
            yield ": ping\n\n"
            last_sent = now
        if is_disconnected is not None and await is_disconnected():
            return
        if len(rows) >= EVENTS_PAGE:
            continue  # a backlog is still draining; do not sleep between pages
        await asyncio.sleep(poll_s)


# ── Postgres store ───────────────────────────────────────────────────────────────


class PgStore:
    """One AsyncConnection per call -- streams included, so an open stream costs three or
    four short connects per poll. n=1 in the prototype; a pool is a production concern.

    Connections are ``autocommit=True``: a read is one round trip, and the writers that
    need several statements to land together say so with ``conn.transaction()``."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    async def _connect(self):
        import psycopg
        from psycopg.rows import dict_row

        return await psycopg.AsyncConnection.connect(self.dsn, row_factory=dict_row, autocommit=True)

    async def apply_schema(self, sql_dir: Path = SQL_DIR) -> list[str]:
        """Run proto/sql/*.sql in name order. Every statement is IF NOT EXISTS / OR
        REPLACE, and each file goes down as ONE multi-statement execute (no parameters,
        so psycopg uses the simple query protocol and 002_seq.sql's $$ body survives)."""
        files = sorted(sql_dir.glob("*.sql"))
        if not files:
            raise RuntimeError(f"no schema files under {sql_dir}; refusing to start without a schema")
        applied: list[str] = []
        async with await self._connect() as conn:
            for path in files:
                await conn.execute(path.read_text(encoding="utf-8"))
                applied.append(path.name)
        return applied

    @staticmethod
    def _row(r: dict[str, Any]) -> SessionRow:
        return SessionRow(
            session_id=r["session_id"], project_id=r["project_id"],
            title=r["title"] or DEFAULT_TITLE, model=r["model"] or DEFAULT_MODEL,
            created_at=r["created_at"], updated_at=r["updated_at"] or r["created_at"],
        )

    _SELECT = "SELECT session_id, project_id, title, model, created_at, updated_at FROM sessions"

    async def create_session(self, title: str, model: str) -> SessionRow:
        session_id = "sess_" + uuid.uuid4().hex[:16]
        project_id = "proj_" + uuid.uuid4().hex[:16]
        async with await self._connect() as conn:
            async with conn.transaction():
                await conn.execute("INSERT INTO projects (project_id) VALUES (%s)", (project_id,))
                await conn.execute(
                    "INSERT INTO sessions (session_id, project_id, title, model) VALUES (%s, %s, %s, %s)",
                    (session_id, project_id, title, model),
                )
            cur = await conn.execute(self._SELECT + " WHERE session_id = %s", (session_id,))
            row = await cur.fetchone()
        return self._row(row)

    async def list_sessions(self) -> list[SessionRow]:
        async with await self._connect() as conn:
            cur = await conn.execute(self._SELECT + " ORDER BY updated_at DESC, created_at DESC")
            return [self._row(r) for r in await cur.fetchall()]

    async def get_session(self, session_id: str) -> SessionRow | None:
        async with await self._connect() as conn:
            cur = await conn.execute(self._SELECT + " WHERE session_id = %s", (session_id,))
            row = await cur.fetchone()
        return self._row(row) if row else None

    async def patch_session(self, session_id: str, title: str | None, model: str | None) -> SessionRow | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "UPDATE sessions SET title = COALESCE(%s, title), model = COALESCE(%s, model), "
                "updated_at = now() WHERE session_id = %s RETURNING session_id",
                (title, model, session_id),
            )
            hit = await cur.fetchone()
        return await self.get_session(session_id) if hit else None

    async def delete_session(self, session_id: str) -> bool:
        async with await self._connect() as conn:
            async with conn.transaction():
                cur = await conn.execute("SELECT project_id FROM sessions WHERE session_id = %s", (session_id,))
                row = await cur.fetchone()
                if row is None:
                    return False
                # Every per-session table in 001_schema.sql, session_entries included: it is
                # the SDK SessionStore's transcript once D9-10 lands, and a deleted session
                # must not leave unreachable transcript rows behind.
                for table in ("session_events", "session_seq", "session_activity", "session_entries", "turns", "tool_calls"):
                    await conn.execute(f"DELETE FROM {table} WHERE session_id = %s", (session_id,))  # noqa: S608 - fixed names
                await conn.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
                for table in ("documents", "blobs", "staging", "projects"):
                    await conn.execute(f"DELETE FROM {table} WHERE project_id = %s", (row["project_id"],))  # noqa: S608
        return True

    async def document_versions(self, project_id: str) -> dict[str, int]:
        async with await self._connect() as conn:
            cur = await conn.execute("SELECT name, version FROM documents WHERE project_id = %s", (project_id,))
            return {r["name"]: r["version"] for r in await cur.fetchall()}

    async def documents(self, project_id: str) -> dict[str, tuple[int, Any]]:
        async with await self._connect() as conn:
            cur = await conn.execute("SELECT name, version, doc FROM documents WHERE project_id = %s", (project_id,))
            return {r["name"]: (r["version"], r["doc"]) for r in await cur.fetchall()}

    async def begin_turn(self, session: SessionRow, text: str) -> Turn:
        from psycopg.types.json import Jsonb

        turn_id = str(uuid.uuid4())
        enqueued_at = datetime.now(tz=timezone.utc).isoformat()
        body = {
            "turn_id": turn_id,
            "session_id": session.session_id,
            "project_id": session.project_id,
            "text": text,
            "enqueued_at": enqueued_at,
        }
        async with await self._connect() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at) "
                    "VALUES (%s, %s, %s, %s, %s::timestamptz)",
                    (turn_id, session.session_id, session.project_id, Jsonb(body), enqueued_at),
                )
                cur = await conn.execute("SELECT next_session_seq(%s) AS seq", (session.session_id,))
                seq = (await cur.fetchone())["seq"]
                await conn.execute(
                    "INSERT INTO session_events (session_id, seq, kind, payload) VALUES (%s, %s, 'user_msg', %s)",
                    (session.session_id, seq, Jsonb({"text": text, "turn_id": turn_id})),
                )
                await conn.execute(
                    "UPDATE sessions SET updated_at = now() WHERE session_id = %s", (session.session_id,)
                )
        return Turn(turn_id=turn_id, seq=seq, body=body)

    async def fail_turn(self, turn_id: str, reason: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "UPDATE turns SET outcome = %s, completed_at = now() WHERE turn_id = %s", (reason, turn_id)
            )

    async def events_after(self, session_id: str, after: int, limit: int) -> list[EventRow]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "SELECT seq, kind, payload, ts FROM session_events "
                "WHERE session_id = %s AND seq > %s ORDER BY seq LIMIT %s",
                (session_id, after, limit),
            )
            return [EventRow(seq=r["seq"], kind=r["kind"], payload=r["payload"] or {}, ts=r["ts"]) for r in await cur.fetchall()]

    async def activity(self, session_id: str) -> Activity | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "SELECT payload, updated_at FROM session_activity WHERE session_id = %s", (session_id,)
            )
            row = await cur.fetchone()
        return Activity(updated_at=row["updated_at"], payload=row["payload"] or {}) if row else None

    async def turn_active(self, session_id: str) -> bool:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "SELECT EXISTS (SELECT 1 FROM turns WHERE session_id = %s AND completed_at IS NULL) AS active",
                (session_id,),
            )
            return bool((await cur.fetchone())["active"])


# ── queues ───────────────────────────────────────────────────────────────────────


class SqsQueue:
    """SendMessage over the SQS query API via enqueue.sqs_call. QUEUE_URL is a full queue
    URL (the shim's shape); the endpoint is its scheme+host, and the URL itself goes down
    as QueueUrl -- elasticmq keys on the path, so the in-network host is fine."""

    def __init__(self, queue_url: str) -> None:
        parsed = urlparse(queue_url)
        self.queue_url = queue_url
        self.endpoint = f"{parsed.scheme}://{parsed.netloc}"

    async def send(self, body: dict[str, Any]) -> str:
        doc = await asyncio.to_thread(
            enqueue.sqs_call,
            self.endpoint,
            "SendMessage",
            {"QueueUrl": self.queue_url, "MessageBody": json.dumps(body)},
        )
        return enqueue.xml_text(doc, "MessageId")


class NullQueue:
    """No queue configured: the turn is recorded (turns row + user_msg event) and never
    enqueued. This is the 'rows a script inserts' mode; the compose service never uses it."""

    async def send(self, body: dict[str, Any]) -> str:
        message_id = "null-" + uuid.uuid4().hex[:12]
        log.info("NullQueue: turn %s recorded, not enqueued", body.get("turn_id"))
        return message_id


# ── app ──────────────────────────────────────────────────────────────────────────


class CreateSessionBody(BaseModel):
    title: str | None = None
    model: str | None = None
    sample: bool = False  # accepted for api.ts compatibility; no seed project on this backend


class PatchSessionBody(BaseModel):
    title: str | None = None
    model: str | None = None


class MessageBody(BaseModel):
    text: str = Field(min_length=1)


class DevLoginBody(BaseModel):
    email: str | None = None


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw not in (None, "") else default


def create_app(
    store: Store | None = None,
    queue: Queue | None = None,
    *,
    poll_s: float | None = None,
    ping_s: float | None = None,
    stream_max_polls: int | None = None,
) -> FastAPI:
    """Factory. With no arguments the lifespan builds PgStore(PG_DSN) + SqsQueue(QUEUE_URL)
    (or NullQueue) from env; tests pass fakes and shrink the timings."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.store is None:
            pg = PgStore(os.environ.get("PG_DSN") or DEFAULT_PG_DSN)
            applied = await pg.apply_schema()
            log.info("schema applied: %s", ", ".join(applied))
            app.state.store = pg
        if app.state.queue is None:
            queue_url = os.environ.get("QUEUE_URL")
            if queue_url:
                app.state.queue = SqsQueue(queue_url)
                log.info("queue: %s", queue_url)
            else:
                app.state.queue = NullQueue()
                log.warning("QUEUE_URL unset: turns are recorded but NOT enqueued (NullQueue)")
        yield

    app = FastAPI(title="Genealogy search-agent prototype - web tier", lifespan=lifespan)
    app.state.store = store
    app.state.queue = queue
    app.state.poll_s = poll_s if poll_s is not None else _env_float("POLL_S", 1.0)
    app.state.ping_s = ping_s if ping_s is not None else _env_float("SSE_PING_S", 15.0)
    app.state.stream_max_polls = stream_max_polls

    def _store(request: Request) -> Store:
        return request.app.state.store

    async def _session(request: Request, session_id: str) -> SessionRow:
        row = await _store(request).get_session(session_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return row

    # -- health / auth stubs --------------------------------------------------------

    @app.get("/api/health")
    async def health(request: Request) -> dict:
        return {
            "ok": True,
            "tier": "proto-web",
            "queue": type(request.app.state.queue).__name__,
            "poll_s": request.app.state.poll_s,
            "ping_s": request.app.state.ping_s,
        }

    @app.get("/auth/config")
    async def auth_config() -> dict:
        return {"familysearch": False, "devLogin": True}

    @app.get("/auth/me")
    async def auth_me() -> dict:
        return PROTO_USER

    @app.post("/auth/dev-login")
    async def dev_login(body: DevLoginBody) -> dict:
        return {**PROTO_USER, "email": body.email or PROTO_USER["email"]}

    @app.post("/auth/logout")
    async def logout() -> dict:
        return {"ok": True}

    # -- sessions -----------------------------------------------------------------

    @app.get("/api/sessions")
    async def list_sessions(request: Request) -> list[dict]:
        return [session_out(r) for r in await _store(request).list_sessions()]

    @app.post("/api/sessions")
    async def create_session(body: CreateSessionBody, request: Request) -> dict:
        row = await _store(request).create_session(body.title or DEFAULT_TITLE, body.model or DEFAULT_MODEL)
        return session_out(row)

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: str, request: Request) -> dict:
        return session_out(await _session(request, session_id))

    @app.patch("/api/sessions/{session_id}")
    async def patch_session(session_id: str, body: PatchSessionBody, request: Request) -> dict:
        row = await _store(request).patch_session(session_id, body.title, body.model)
        if row is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return session_out(row)

    @app.post("/api/sessions/{session_id}/resume")
    async def resume_session(session_id: str, request: Request) -> dict:
        return session_out(await _session(request, session_id))  # nothing to resume: no sandbox

    @app.delete("/api/sessions/{session_id}")
    async def delete_session(session_id: str, request: Request) -> dict:
        if not await _store(request).delete_session(session_id):
            raise HTTPException(status_code=404, detail="Session not found")
        return {"ok": True}

    @app.get("/api/sessions/{session_id}/state")
    async def session_state(session_id: str, request: Request) -> dict:
        row = await _session(request, session_id)
        docs = await _store(request).documents(row.project_id)
        return {
            "label": row.title,
            "research": docs.get("research.json", (0, None))[1],
            "gedcomx": docs.get("tree.gedcomx.json", (0, None))[1],
            "sidecars": [],
        }

    @app.get("/api/sessions/{session_id}/sidecar/{log_id}")
    async def session_sidecar(session_id: str, log_id: str, request: Request) -> dict:
        await _session(request, session_id)
        raise HTTPException(status_code=404, detail="Sidecar bodies are not served by the prototype web tier (D6-8)")

    _NOT_IN_PROTOTYPE = {
        "image": "Source images are not served by the prototype web tier (D6-8 blobs)",
        "logs": "There are no sandbox logs on this backend; read the worker's stdout",
        "files": "Uploads have no path into the project on this backend (plan: 'the first unserved class')",
        "interrupt": "Interrupt is not available in the prototype: the worker owns the turn",
    }

    @app.get("/api/sessions/{session_id}/image")
    @app.get("/api/sessions/{session_id}/logs")
    async def not_in_prototype_get(session_id: str, request: Request) -> None:
        await _session(request, session_id)
        raise HTTPException(status_code=501, detail=_NOT_IN_PROTOTYPE[request.url.path.rsplit("/", 1)[-1]])

    @app.post("/api/sessions/{session_id}/files")
    @app.post("/api/sessions/{session_id}/interrupt")
    async def not_in_prototype_post(session_id: str, request: Request) -> None:
        await _session(request, session_id)
        raise HTTPException(status_code=501, detail=_NOT_IN_PROTOTYPE[request.url.path.rsplit("/", 1)[-1]])

    # -- turns and events ---------------------------------------------------------

    @app.post("/api/sessions/{session_id}/messages", status_code=202)
    async def post_message(session_id: str, body: MessageBody, request: Request) -> dict:
        row = await _session(request, session_id)
        turn = await _store(request).begin_turn(row, body.text)
        try:
            message_id = await request.app.state.queue.send(turn.body)
        except Exception as exc:  # any queue failure: the row stays, marked, and the UI sees 502
            await _store(request).fail_turn(turn.turn_id, "enqueue_failed")
            log.error("enqueue failed for turn %s: %s", turn.turn_id, exc)
            # The user_msg row was committed before the send and stays (seqs are dense), so
            # the 502 names its seq: the SPA still has an echo to drop.
            raise HTTPException(
                status_code=502,
                detail={"message": f"queue send failed: {exc}", "turn_id": turn.turn_id, "seq": turn.seq},
            ) from exc
        return {"turn_id": turn.turn_id, "seq": turn.seq, "message_id": message_id}

    @app.get("/api/sessions/{session_id}/events")
    async def get_events(session_id: str, request: Request, after: str | None = None) -> dict:
        row = await _session(request, session_id)
        try:
            cursor = resolve_cursor(request.headers.get("last-event-id"), after)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"bad cursor: {exc}") from exc
        store = _store(request)
        rows = await store.events_after(row.session_id, cursor, EVENTS_PAGE)
        activity = await store.activity(row.session_id)
        return {
            "events": [row_to_wire(r) for r in rows],
            "activity": activity_to_wire(activity) if activity else None,
            "turn_active": await store.turn_active(row.session_id),
            "next_after": rows[-1].seq if rows else cursor,
        }

    @app.get("/api/sessions/{session_id}/events/stream")
    async def stream_events(session_id: str, request: Request, after: str | None = None) -> StreamingResponse:
        row = await _session(request, session_id)
        try:
            cursor = resolve_cursor(request.headers.get("last-event-id"), after)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"bad cursor: {exc}") from exc
        frames = stream_frames(
            _store(request), row, cursor,
            poll_s=request.app.state.poll_s, ping_s=request.app.state.ping_s,
            max_polls=request.app.state.stream_max_polls, is_disconnected=request.is_disconnected,
        )
        return StreamingResponse(
            frames, media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    # uvicorn's CLI builds the loop before this module is imported, and on Windows that
    # is ProactorEventLoop, which psycopg3 async refuses; loop="none" lets us choose.
    server = uvicorn.Server(uvicorn.Config(
        app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8085")), loop="none"
    ))
    asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop if sys.platform == "win32" else None)
