"""Offline tests for the D11-12 prototype web tier (apps/server/proto/web/app.py).

No Postgres, no queue: a ``FakeStore`` / ``FakeQueue`` go in through ``create_app``.
The SSE body is tested by pulling ``stream_frames`` directly -- httpx 0.28's
``ASGITransport`` (like Starlette's TestClient) runs the app to completion before it
hands back a response and never delivers ``http.disconnect`` mid-stream, so an
endless stream cannot be tested through the route; the route is checked for its
status and headers with ``stream_max_polls=1``.

``proto/`` goes on sys.path the way test_proto_decide.py does for the shim: the tier
imports ``enqueue`` as a top-level module because that is how the container lays it out.
"""

from __future__ import annotations

import asyncio
import json
import re
import socket
import sys
import pathlib
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

PROTO = Path(__file__).resolve().parents[1] / "proto"
sys.path.insert(0, str(PROTO))

from drive import parse_frame  # noqa: E402  (the driver's SSE parser; one parser, two callers)
from web import app, auth  # noqa: E402  (queue_body / max_nudges: one definition for the fake store too)
from web.app import (  # noqa: E402
    DEFAULT_MODEL,
    DEFAULT_TITLE,
    Activity,
    EventRow,
    IdentityMismatch,
    ProjectNotOwned,
    SessionRow,
    Turn,
    User,
    activity_to_wire,
    create_app,
    resolve_cursor,
    row_to_wire,
    session_out,
    sse_frame,
    stream_frames,
)

T0 = datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc)

# api.ts SessionSummary -- every key the SPA types (SessionList dereferences model and last_active).
SESSION_SUMMARY_KEYS = {
    "id", "title", "model", "status", "sandbox_id", "agent_session_id", "created", "updated", "last_active",
}


# ── fakes ────────────────────────────────────────────────────────────────────────


# U2: the patron every route test signs in as (make_client), and a second one.
USER_A = User("usr_a", "a@example.org")
USER_B = User("usr_b", "b@example.org")


class FakeStore:
    """Re-implements the store in Python. The owner DECISION is the route's (``_session``
    compares ``owner_id``), so these tests exercise the real rule; only ``list_sessions``
    and ``create_session`` filter by owner here, mirroring the SQL that
    ``test_proto_auth.py`` runs against a scripted connection."""

    def __init__(self) -> None:
        self.users: dict[str, User] = {USER_A.id: USER_A, USER_B.id: USER_B}
        self.allowed: set[str] = set()
        self.grants: dict[str, dict[str, Any]] = {}
        self.owners: dict[str, str | None] = {}  # projects.owner_id
        self.sessions: dict[str, SessionRow] = {}
        self.events: dict[str, list[EventRow]] = {}
        self.activity_rows: dict[str, Activity] = {}
        self.docs: dict[str, dict[str, tuple[int, Any]]] = {}
        self.active: set[str] = set()
        self.failed: list[tuple[str, str]] = []
        self.turns: list[Turn] = []
        # 1b/1c: held messages, and the sessions the patron pressed Stop on.
        self.queued: list[Turn] = []
        self.stopped: set[str] = set()

    def seed_session(
        self, session_id: str = "sess_1", project_id: str = "proj_1", owner: str | None = USER_A.id
    ) -> SessionRow:
        self.owners.setdefault(project_id, owner)
        row = SessionRow(session_id, project_id, DEFAULT_TITLE, DEFAULT_MODEL, T0, T0, self.owners[project_id])
        self.sessions[session_id] = row
        return row

    def add_event(self, session_id: str, kind: str, payload: dict[str, Any]) -> int:
        rows = self.events.setdefault(session_id, [])
        seq = len(rows) + 1
        rows.append(EventRow(seq=seq, kind=kind, payload=payload, ts=T0 + timedelta(seconds=seq)))
        return seq

    async def create_session(
        self, title: str, model: str, project_id: str | None, owner: str, may_create_or_claim: bool
    ) -> SessionRow:
        n = len(self.sessions) + 1
        if project_id is None:
            project_id = f"proj_{n}"
            self.owners[project_id] = owner
        elif self.owners.get(project_id) == owner and project_id in self.owners:
            pass
        elif may_create_or_claim and self.owners.get(project_id) is None:
            self.owners[project_id] = owner  # create, or claim an unowned one
        else:
            raise ProjectNotOwned(project_id)
        row = SessionRow(f"sess_{n}", project_id, title, model, T0, T0, owner)
        self.sessions[row.session_id] = row
        return row

    async def list_sessions(self, owner: str) -> list[SessionRow]:
        return [r for r in self.sessions.values() if r.owner_id == owner]

    async def get_session(self, session_id: str) -> SessionRow | None:
        return self.sessions.get(session_id)

    async def patch_session(self, session_id: str, title: str | None, model: str | None) -> SessionRow | None:
        row = self.sessions.get(session_id)
        if row is None:
            return None
        row = SessionRow(row.session_id, row.project_id, title or row.title, model or row.model, row.created_at,
                         T0 + timedelta(minutes=1), row.owner_id)
        self.sessions[session_id] = row
        return row

    async def delete_session(self, session_id: str) -> bool:
        row = self.sessions.pop(session_id, None)
        if row is None:
            return False
        if not any(r.project_id == row.project_id for r in self.sessions.values()):
            self.docs.pop(row.project_id, None)
            self.owners.pop(row.project_id, None)
        return True

    async def document_versions(self, project_id: str) -> dict[str, int]:
        return {name: v for name, (v, _) in self.docs.get(project_id, {}).items()}

    async def documents(self, project_id: str) -> dict[str, tuple[int, Any]]:
        return dict(self.docs.get(project_id, {}))

    async def begin_turn(self, session: SessionRow, text: str, *, queued: bool = False) -> Turn:
        turn_id = str(uuid.uuid4())
        seq = self.add_event(session.session_id, "user_msg", {"text": text, "turn_id": turn_id})
        # The real helper, not a hand-rolled copy: a fake that builds its own body would
        # let the route tests pass while production enqueued a different shape.
        body = app.queue_body(turn_id, session, text, T0.isoformat(), app.max_nudges())
        turn = Turn(turn_id=turn_id, seq=seq, body=body)
        self.turns.append(turn)
        if queued:
            self.queued.append(turn)
        else:
            self.active.add(session.session_id)
            self.stopped.discard(session.session_id)  # 1c: a new message resumes a stopped session
        return turn

    async def fail_turn(self, turn_id: str, reason: str) -> None:
        self.failed.append((turn_id, reason))

    async def events_after(self, session_id: str, after: int, limit: int) -> list[EventRow]:
        return [r for r in self.events.get(session_id, []) if r.seq > after][:limit]

    async def activity(self, session_id: str) -> Activity | None:
        return self.activity_rows.get(session_id)

    async def turn_active(self, session_id: str) -> bool:
        # 1b: a HELD turn is not a running one. The real store excludes it in SQL; the
        # fake mirrors that, or the hold would latch on after the first queued message.
        return session_id in self.active

    async def has_queued(self, session_id: str) -> bool:
        return any(t.body["session_id"] == session_id for t in self.queued)

    async def claim_queued_turn(self, session_id: str) -> dict | None:
        """Oldest-first, and the claim REMOVES it -- the real one is a single UPDATE that
        can only match a row still carrying the queued outcome, so a fake that left the
        row in place would let a double-enqueue pass here and fail in production."""
        for i, t in enumerate(self.queued):
            if t.body["session_id"] == session_id:
                self.queued.pop(i)
                self.active.add(session_id)
                return t.body
        return None

    async def request_stop(self, session_id: str) -> bool:
        self.stopped.add(session_id)
        return True

    async def get_user(self, user_id: str) -> User | None:
        return self.users.get(user_id)

    async def upsert_user(self, email: str, familysearch_id: str | None) -> User:
        email = email.strip().lower()
        user = next((u for u in self.users.values() if u.email == email), None)
        if user is None:
            user = User(f"usr_{len(self.users) + 1}", email)
        if familysearch_id and user.familysearch_id and user.familysearch_id != familysearch_id:
            raise IdentityMismatch(email)
        if familysearch_id and not user.familysearch_id:
            user = User(user.id, user.email, familysearch_id, user.sessions_revoked_at)
        self.users[user.id] = user
        return user

    async def is_allowed(self, email: str) -> bool:
        return email.strip().lower() in self.allowed

    async def sync_allowlist(self, emails: set[str]) -> None:
        self.allowed = set(emails)

    async def revoke_sessions(self, user_id: str) -> None:
        u = self.users[user_id]
        self.users[user_id] = User(u.id, u.email, u.familysearch_id, datetime.now(tz=timezone.utc))

    async def store_grant(self, user_id: str, access_token_enc: str, refresh_token_enc: str | None,
                          expires_at: datetime) -> None:
        old = self.grants.get(user_id, {})
        self.grants[user_id] = {
            "access_token_enc": access_token_enc,
            "refresh_token_enc": refresh_token_enc if refresh_token_enc is not None else old.get("refresh_token_enc"),
            "expires_at": expires_at,
            "granted_at": datetime.now(tz=timezone.utc),
            "writes": old.get("writes", 0) + 1,
        }


class FakeQueue:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail = fail

    async def send(self, body: dict[str, Any]) -> str:
        if self.fail:
            raise RuntimeError("elasticmq is down")
        self.sent.append(body)
        return f"msg-{len(self.sent)}"


def make_client(store: FakeStore, queue: FakeQueue, *, user: str | None = USER_A.id, **kw) -> httpx.AsyncClient:
    """A client signed in as ``user`` (a session cookie minted the way /auth/dev-login
    mints one); ``user=None`` sends no cookie."""
    app = create_app(store, queue, poll_s=0.0, ping_s=0.0, **kw)
    cookies = {auth.COOKIE_NAME: auth.session_cookie_value(user)} if user else None
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", cookies=cookies)


def parse_frames(body: str) -> list[dict[str, Any]]:
    """Split an SSE body into {id, data, comment, retry} dicts with the driver's parser."""
    return [vars(parse_frame(raw)) for raw in body.split("\n\n") if raw.strip()]


async def take(gen, n: int) -> list[dict[str, Any]]:
    """Pull n frames from stream_frames and close it."""
    frames: list[str] = []
    try:
        while len(frames) < n:
            frames.append(await anext(gen))
    finally:
        await gen.aclose()
    return parse_frames("".join(frames))


# ── pure helpers ─────────────────────────────────────────────────────────────────


def test_sse_frame_puts_id_on_event_frames_only():
    assert sse_frame({"type": "x"}, seq=7) == 'id: 7\ndata: {"type":"x"}\n\n'
    assert sse_frame({"type": "x"}) == 'data: {"type":"x"}\n\n'


def test_row_to_wire_user_msg_and_agent_kinds():
    user = EventRow(1, "user_msg", {"text": "hi", "turn_id": "t1"}, T0)
    assert row_to_wire(user) == {"type": "user_msg", "text": "hi", "turn_id": "t1", "seq": 1}
    tool = EventRow(2, "tool_use", {"tool": "record_search", "summary": "Flynn 1850", "agent": "record-extractor"}, T0)
    assert row_to_wire(tool) == {
        "type": "agent_event",
        "event": {"tool": "record_search", "summary": "Flynn 1850", "agent": "record-extractor", "kind": "tool_use"},
        "seq": 2,
    }
    # The D3 stub worker's row today: kind turn_done, payload {turn_id, receive_count}.
    stub = EventRow(3, "turn_done", {"turn_id": "t1", "receive_count": 1}, T0)
    assert row_to_wire(stub)["event"] == {"turn_id": "t1", "receive_count": 1, "kind": "turn_done"}


def test_row_to_wire_kind_wins_over_a_payload_kind():
    # A worker that copies the whole map_message event (which carries `kind`) into
    # payload must not be able to disagree with the column the tier keys on.
    row = EventRow(4, "text", {"kind": "thinking", "text": "..."}, T0)
    assert row_to_wire(row)["event"]["kind"] == "text"


def test_activity_to_wire_is_a_task_progress_event():
    wire = activity_to_wire(Activity(T0, {"agent": "record-extractor", "last_tool": "record_read", "tool_uses": 3}))
    assert wire == {
        "type": "agent_event",
        "event": {"agent": "record-extractor", "last_tool": "record_read", "tool_uses": 3, "kind": "task_progress"},
    }
    assert "seq" not in wire


def test_activity_to_wire_keeps_the_payloads_own_kind():
    # The worker writes the whole transient event, kind included (text_delta,
    # thinking_delta, task_progress); relabelling a text delta as task_progress would
    # hand the SPA a subagent progress line with a `text` field.
    wire = activity_to_wire(Activity(T0, {"kind": "text_delta", "text": "Thom"}))
    assert wire["event"] == {"kind": "text_delta", "text": "Thom"}


@pytest.mark.parametrize(
    ("header", "after", "expected"),
    [
        ("12", "3", 12),  # the header wins
        ("", "3", 3),  # an empty header falls through to the query
        (None, "3", 3),
        (None, None, 0),
        ("", "", 0),
        (" 7 ", None, 7),
    ],
)
def test_resolve_cursor(header, after, expected):
    assert resolve_cursor(header, after) == expected


@pytest.mark.parametrize("bad", ["abc", "-1", "1.5", "NaN"])
def test_resolve_cursor_rejects_garbage(bad):
    with pytest.raises(ValueError):
        resolve_cursor(bad, None)


def test_session_out_has_every_session_summary_key():
    out = session_out(SessionRow("sess_1", "proj_1", "T", "claude-sonnet-4-6", T0, T0))
    assert set(out) == SESSION_SUMMARY_KEYS
    assert out["id"] == "sess_1" and out["status"] == "active" and out["agent_session_id"] is None
    assert out["last_active"] == T0.isoformat()


# ── routes ───────────────────────────────────────────────────────────────────────


async def test_session_crud_speaks_the_spa_shape():
    store, queue = FakeStore(), FakeQueue()
    async with make_client(store, queue) as c:
        created = (await c.post("/api/sessions", json={"sample": True})).json()
        assert set(created) == SESSION_SUMMARY_KEYS
        assert created["title"] == DEFAULT_TITLE and created["model"] == DEFAULT_MODEL
        sid = created["id"]
        assert [s["id"] for s in (await c.get("/api/sessions")).json()] == [sid]
        assert (await c.get(f"/api/sessions/{sid}")).json()["id"] == sid
        assert (await c.post(f"/api/sessions/{sid}/resume")).status_code == 200
        patched = (await c.patch(f"/api/sessions/{sid}", json={"title": "Flynn parents"})).json()
        assert patched["title"] == "Flynn parents"
        assert (await c.get("/api/sessions/nope")).status_code == 404
        assert (await c.delete(f"/api/sessions/{sid}")).json() == {"ok": True}
        assert (await c.get(f"/api/sessions/{sid}")).status_code == 404


async def test_state_reads_documents_and_the_unserved_routes_say_so():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    store.docs[row.project_id] = {"research.json": (3, {"project": {"title": "X"}})}
    async with make_client(store, queue) as c:
        state = (await c.get(f"/api/sessions/{row.session_id}/state")).json()
        assert state == {"label": DEFAULT_TITLE, "research": {"project": {"title": "X"}}, "gedcomx": None, "sidecars": []}
        assert (await c.get(f"/api/sessions/{row.session_id}/sidecar/q_001")).status_code == 404
        for path in ("image?filename=images/a.jpg", "logs"):
            assert (await c.get(f"/api/sessions/{row.session_id}/{path}")).status_code == 501
        assert (await c.post(f"/api/sessions/{row.session_id}/files")).status_code == 501
        # 1c: interrupt used to be on that list. It is the control surface the whole
        # design rests on, so a 501 here is the feature missing, not a gap in the tier.
        assert (await c.post(f"/api/sessions/{row.session_id}/interrupt")).status_code == 202
        config = (await c.get("/auth/config")).json()
        assert config == {"familysearch": False, "devLogin": True}
        assert (await c.get("/auth/me")).json() == {"id": USER_A.id, "email": USER_A.email}


async def test_post_message_mints_turn_id_records_user_msg_and_enqueues_the_body():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        r = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "Find Thomas Flynn"})
    assert r.status_code == 202
    out = r.json()
    uuid.UUID(out["turn_id"])  # a real UUID, not the queue's MessageId
    assert out["seq"] == 1 and out["message_id"] == "msg-1"
    assert queue.sent == [{
        "turn_id": out["turn_id"], "session_id": row.session_id, "project_id": row.project_id,
        "text": "Find Thomas Flynn", "enqueued_at": T0.isoformat(),
        # 1a: the cap rides the message, from this tier's environment.
        "max_nudges": app.DEFAULT_MAX_NUDGES,
    }]
    events = store.events[row.session_id]
    assert [e.kind for e in events] == ["user_msg"]
    assert events[0].payload == {"text": "Find Thomas Flynn", "turn_id": out["turn_id"]}
    assert store.failed == []


# ── 1b / 1c: holding a message typed mid-turn, and Stop ──────────────────────────


async def test_a_message_typed_while_a_turn_runs_is_held_not_enqueued():
    """1b. post_message enqueued unconditionally; the turn_active() helper existed but
    only the SSE replay and session_state ever called it. And choose_sdk_session_id
    coalesces to ONE sdk_session_id per session, so two concurrent turns resumed the SAME
    SDK session -- two CLIs appending to one transcript."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        first = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "Find Thomas"})
        second = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "also the 1881 census"})
    assert first.status_code == 202 and first.json()["queued"] is False
    assert second.status_code == 202, "held, not refused: the patron must be able to type at any time"
    assert second.json()["queued"] is True and second.json()["message_id"] is None
    assert len(queue.sent) == 1, "only the first reached the queue"
    assert [t.body["text"] for t in store.queued] == ["also the 1881 census"]
    # The row is written either way, so the transcript carries it and the UI can show it.
    assert [e.payload["text"] for e in store.events[row.session_id]] == ["Find Thomas", "also the 1881 census"]


async def test_a_held_turn_does_not_itself_count_as_an_active_turn():
    """The latch bug this design has to avoid: a held row has completed_at NULL too, so a
    turn_active that did not exclude it would hold every later message behind a turn that
    is not running."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "one"})
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "two"})
        store.active.discard(row.session_id)  # the worker finished the running turn
        third = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "three"})
    assert third.json()["queued"] is False, "with no turn running the next message goes straight out"
    assert len(queue.sent) == 2


async def test_the_stream_says_a_message_is_waiting_so_a_reload_still_shows_it():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue, stream_max_polls=1) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "one"})
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "two"})
        body = (await c.get(f"/api/sessions/{row.session_id}/events/stream")).text
    states = [f["data"]["state"] for f in parse_frames(body)
              if isinstance(f["data"], dict) and f["data"].get("type") == "status"]
    assert states == ["turn_active", "turn_queued"], \
        "the status follows the replay, and the held message follows the active turn"


async def test_the_stream_announces_a_message_arriving_and_leaving_mid_stream():
    """The frame at OPEN was asserted; the one the POLL LOOP emits on a change was not,
    and reverting it broke no test. It is the only thing that tells a second tab -- or
    this one, after the message is picked up -- that the state moved."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue, stream_max_polls=3) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "one"})

        # The stream is consumed lazily, so drive stream_frames directly: hold a message
        # after the first poll, release it after the second.
        frames: list[str] = []
        gen = app.stream_frames(store, row, 0, poll_s=0.0, ping_s=99.0, max_polls=3)
        async for chunk in gen:
            frames.append(chunk)
            if len(frames) == 3:
                store.queued.append(
                    app.Turn(turn_id="held", seq=99,
                             body={"session_id": row.session_id, "text": "two"})
                )
            if any("turn_queued" in f for f in frames) and store.queued:
                store.queued.clear()
        states = [f for f in frames if '"status"' in f]
    assert any("turn_queued" in f for f in states), "a message arriving mid-stream is announced"
    assert any("turn_unqueued" in f for f in states), "and so is its release"


async def test_the_poll_read_carries_the_queued_state_too():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "one"})
        assert (await c.get(f"/api/sessions/{row.session_id}/events")).json()["turn_queued"] is False
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "two"})
        out = (await c.get(f"/api/sessions/{row.session_id}/events")).json()
    assert out["turn_active"] is True and out["turn_queued"] is True


async def test_interrupt_raises_the_stop_flag_and_is_no_longer_a_501():
    """1c. The prototype's interrupt answered 501 -- "the worker owns the turn" -- and the
    whole design rests on Stop. The worker still owns the turn, so this raises a flag its
    PreToolUse hook reads before every tool call rather than reaching for a control
    channel that does not exist."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "go"})
        r = await c.post(f"/api/sessions/{row.session_id}/interrupt")
    assert r.status_code == 202 and r.json() == {"ok": True, "stopping": True}
    assert store.stopped == {row.session_id}


async def test_interrupt_on_an_idle_session_is_recorded_but_says_nothing_is_running():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        r = await c.post(f"/api/sessions/{row.session_id}/interrupt")
    assert r.status_code == 202 and r.json()["stopping"] is False


async def test_interrupt_on_an_unknown_session_is_a_404_not_a_silent_ok():
    store, queue = FakeStore(), FakeQueue()
    async with make_client(store, queue) as c:
        assert (await c.post("/api/sessions/sess_nope/interrupt")).status_code == 404
    assert store.stopped == set()


async def test_the_next_message_clears_the_stop_flag_so_the_session_resumes():
    """The acceptance line says a later message resumes a stopped session. A flag that
    outlived its turn would halt the next one at its first tool call -- which looks
    exactly like Stop being broken, from the other side."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "go"})
        await c.post(f"/api/sessions/{row.session_id}/interrupt")
        assert store.stopped == {row.session_id}
        store.active.discard(row.session_id)  # the worker halted and closed the turn
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "carry on"})
    assert store.stopped == set()


async def test_a_turn_that_ends_mid_post_does_not_strand_the_message():
    """The window between the turn_active READ and the held-row INSERT -- two round-trips
    on two connections. The worker releases held messages only at a turn's END, so a turn
    that finishes inside that window has already looked for held rows and found none, and
    the next look is not until the NEXT turn ends -- which needs another message from
    someone who has just been told their message is "picked up at the next step".

    The fix is to confirm after the write rather than trusting the read."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()

    real_begin = store.begin_turn

    async def begin_then_finish(session, text, *, queued=False):
        turn = await real_begin(session, text, queued=queued)
        if queued:  # the worker completes the running turn and finds nothing held
            store.active.discard(session.session_id)
        return turn

    store.begin_turn = begin_then_finish  # type: ignore[method-assign]
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "Find Thomas"})
        second = await c.post(f"/api/sessions/{row.session_id}/messages",
                              json={"text": "also the 1881 census"})

    assert second.json()["queued"] is False, \
        "no turn is running any more, so the message must not be reported as waiting"
    assert [b["text"] for b in queue.sent] == ["Find Thomas", "also the 1881 census"], \
        "the second message must reach the queue, not sit in a row nobody will look at"
    assert store.queued == [], "and it must not be left marked as held as well as sent"
    assert second.json()["turn_id"] == store.turns[-1].turn_id, \
        "the response still names the patron's OWN turn: their tab matches its echo on it"


async def test_a_rescue_runs_the_oldest_message_first_and_keeps_holding_ours():
    """The claim is oldest-first, so what a rescue picks up may be a message held BEFORE
    this one. That one runs; ours stays held and the response says so, rather than
    reporting ours as sent because something was."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "Find Thomas"})
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "the 1881 census"})
        # Now the turn ends before the THIRD message is written, so that one rescues --
        # and finds the second message ahead of it.
        real_begin = store.begin_turn

        async def begin_then_finish(session, text, *, queued=False):
            turn = await real_begin(session, text, queued=queued)
            if queued:
                store.active.discard(session.session_id)
            return turn

        store.begin_turn = begin_then_finish  # type: ignore[method-assign]
        third = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "and his will"})

    assert [b["text"] for b in queue.sent] == ["Find Thomas", "the 1881 census"], "oldest first"
    assert third.json()["queued"] is True, "ours is still waiting: something else went ahead of it"
    assert [t.body["text"] for t in store.queued] == ["and his will"]


async def test_the_rescue_claim_cannot_double_enqueue_against_the_worker():
    """Both the worker's release and this rescue can fire for one held row. The claim is a
    single UPDATE whose WHERE requires the queued outcome, so exactly one of them matches
    -- which is the only reason it is safe to have two releasers at all. A SELECT followed
    by an UPDATE would send the patron's words twice."""
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "one"})
        await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "two"})
    store.active.discard(row.session_id)
    first = await store.claim_queued_turn(row.session_id)   # the worker wins the race
    second = await store.claim_queued_turn(row.session_id)  # the web tier loses it
    assert first is not None and first["text"] == "two"
    assert second is None, "the losing claim gets nothing; it must not re-send the same row"


async def test_the_rescue_claim_clears_the_stop_flag_too():
    """The web tier's rescue enqueues a held message, so it inherits the worker's
    obligation: claiming IS enqueuing, and `begin_turn` deliberately did not clear the
    flag for a held row. Without this the rescued turn halts at its first tool call with
    "Stopped by the researcher." -- the patron's words swallowed by a Stop they pressed
    before they typed them."""
    conn = RecordingConn()
    store = app.PgStore("postgresql://unused")

    async def fake_connect():
        return conn

    store._connect = fake_connect  # type: ignore[method-assign]
    assert await store.claim_queued_turn("sess_1") == {"turn_id": "t2"}  # RecordingConn answers
    cleared = [sql for sql in conn.sql if "stop_requested_at = NULL" in sql]
    assert cleared == [" ".join(app.CLEAR_STOP_SQL.split())], \
        "a claimed message must resume a stopped session, exactly as the worker's does"


async def test_a_rescue_that_finds_nothing_leaves_a_stop_alone():
    """The other direction: with nothing held there is nothing to enqueue, so a Stop the
    patron just pressed must stay exactly where it is."""
    conn = RecordingConn(message=None)
    store = app.PgStore("postgresql://unused")

    async def fake_connect():
        return conn

    store._connect = fake_connect  # type: ignore[method-assign]
    assert await store.claim_queued_turn("sess_1") is None
    assert not [sql for sql in conn.sql if "stop_requested_at = NULL" in sql]


def test_the_rescue_claim_is_the_workers_own_statement():
    """Two releasers are safe only because both run the SAME single-statement claim. The
    route tests drive FakeStore, which re-implements it in Python, so the real SQL is
    checked against the worker's -- if either drifts to a SELECT-then-UPDATE, the patron's
    message can be enqueued twice and nothing else would notice."""
    import inspect

    web = " ".join(inspect.getsource(app.PgStore.claim_queued_turn).split())
    worker_src = (
        pathlib.Path(__file__).resolve().parents[1] / "proto" / "worker" / "worker.py"
    ).read_text(encoding="utf-8")
    claim = " ".join(worker_src.split("def take_queued_turn", 1)[1].split("def ", 1)[0].split())
    for fragment in (
        # claimed_at dates the row from its release: the worker's retention backstop
        # reads COALESCE(claimed_at, enqueued_at), so a long-held message released without
        # it looks expired and is closed before it ever runs.
        "UPDATE turns SET outcome = NULL, claimed_at = now() WHERE turn_id = (",
        # The predicate IS the claim. Widened to anything non-null it would match a turn
        # that already RAN and re-enqueue it; this was unpinned until a break test
        # swapped it for `outcome IS NOT NULL` and every test stayed green.
        "SELECT turn_id FROM turns WHERE session_id = %s AND outcome = %s",
        "AND completed_at IS NULL ORDER BY enqueued_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        ") RETURNING message",
    ):
        assert fragment in claim, f"the worker's claim changed shape: {fragment!r}"
        assert fragment in web, f"the web tier's claim no longer matches the worker's: {fragment!r}"
    assert web.count("UPDATE turns") == 1, "one statement, or the two releasers can both win"


def test_the_real_turn_active_query_excludes_a_held_row():
    """The latch bug, asserted on the SQL the real store runs rather than on a fake that
    re-implements the rule in Python. A held row has completed_at NULL too, so without the
    exclusion the first queued message holds every later one behind a turn that is not
    running -- and every route test above would still pass."""
    assert "completed_at IS NULL" in app.TURN_ACTIVE_SQL
    assert "outcome IS DISTINCT FROM %s" in app.TURN_ACTIVE_SQL, \
        "a held turn is not a running one"
    assert "outcome = %s" in app.HAS_QUEUED_SQL and "completed_at IS NULL" in app.HAS_QUEUED_SQL
    # The two must not be the same question asked twice.
    assert app.TURN_ACTIVE_SQL != app.HAS_QUEUED_SQL


class RecordingConn:
    """Just enough asyncpg-shaped surface to run `PgStore.begin_turn` with no database.

    The route tests above all drive `FakeStore`, which re-implements the rules in Python
    — so the SQL the real store runs was only ever string-matched, and a fake that
    happened to mirror the wrong rule kept every test green. This runs the real method."""

    def __init__(self, message: dict | None = {"turn_id": "t2"}) -> None:
        self.sql: list[str] = []
        self.params: list[tuple] = []
        self.message = message  # what the 1b claim's RETURNING hands back

    async def execute(self, sql, params=()):
        self.sql.append(" ".join(sql.split()))
        self.params.append(params)
        return self

    async def fetchone(self):
        # Enough for every caller here: begin_turn reads `seq`, has_queued reads
        # `queued`, turn_active reads `active`, request_stop only checks for a row.
        if "RETURNING message" in self.sql[-1]:  # the 1b claim
            return {"message": self.message} if self.message is not None else None
        return {"seq": 1, "queued": True, "active": True, "stop_requested_at": "now"}

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self): return None
            async def __aexit__(self, *exc): return False
        return _Tx()

    async def __aenter__(self): return self
    async def __aexit__(self, *exc): return False


async def _begin(queued: bool) -> RecordingConn:
    conn = RecordingConn()
    store = app.PgStore("postgresql://unused")

    async def fake_connect():
        return conn

    store._connect = fake_connect  # type: ignore[method-assign]
    row = SessionRow(session_id="sess_1", project_id="proj_1", title="t", model="m",
                     created_at=T0, updated_at=T0)
    await store.begin_turn(row, "hello", queued=queued)
    return conn


async def test_the_real_has_queued_and_request_stop_run_the_sql_they_claim():
    """Both PgStore methods were UNPINNED: every route test drives FakeStore, which
    re-implements them in Python, so the real bodies could be deleted with the suite
    green. `request_stop` is the whole of Stop on the server side, and `has_queued` is
    what tells a reloaded tab a message is still waiting."""
    conn = RecordingConn()
    store = app.PgStore("postgresql://unused")

    async def fake_connect():
        return conn

    store._connect = fake_connect  # type: ignore[method-assign]

    assert await store.has_queued("sess_1") is True  # RecordingConn.fetchone answers truthy
    assert conn.sql and conn.sql[-1] == " ".join(app.HAS_QUEUED_SQL.split())
    # ...and the PARAMS, not just the statement. Both queries carry the held-row sentinel
    # as a bind, so a test that checked only the SQL string let `("sess_1", "nope")`
    # through -- which silently answers "nothing is held" forever, and on turn_active
    # recreates the very latch bug the test below exists to prevent, with the suite green.
    assert conn.params[-1] == ("sess_1", app.QUEUED_OUTCOME)

    conn.sql.clear()
    assert await store.turn_active("sess_1") is True
    assert conn.sql[-1] == " ".join(app.TURN_ACTIVE_SQL.split())
    assert conn.params[-1] == ("sess_1", app.QUEUED_OUTCOME), \
        "a wrong sentinel here counts a HELD row as a running turn and latches the hold on"

    conn.sql.clear()
    assert await store.request_stop("sess_1") is True
    [stop_sql] = conn.sql
    assert "UPDATE sessions" in stop_sql and "stop_requested_at" in stop_sql
    # COALESCE, so a second press does not move the timestamp the worker is reading.
    assert "COALESCE(stop_requested_at, now())" in stop_sql, \
        "the first press wins; a second must change nothing"
    assert "RETURNING stop_requested_at" in stop_sql, "a missing session must answer False, not silently pass"


async def test_the_real_begin_turn_stamps_the_tiers_cap_and_not_a_literal(monkeypatch):
    """1a's whole carrier. `queue_body(..., max_nudges())` swapped for `queue_body(..., 0)`
    survived the suite -- and a 0 turns the nudge budget OFF for every turn this tier
    enqueues, shipping the stop-at-every-step behaviour the plan exists to remove while
    looking exactly like the feature simply not working."""
    monkeypatch.setenv("AUTONOMOUS_MAX_NUDGES", "37")
    conn = await _begin(queued=False)
    inserts = [p for sql, p in zip(conn.sql, conn.params) if sql.startswith("INSERT INTO turns")]
    assert len(inserts) == 1
    body = inserts[0][3].obj if hasattr(inserts[0][3], "obj") else inserts[0][3]
    assert body["max_nudges"] == 37, (
        f"the row carries max_nudges={body['max_nudges']}; it must come from this tier's "
        f"own environment, which is 1a's only carrier"
    )


async def test_the_real_begin_turn_clears_the_stop_flag_only_when_it_enqueues():
    """1c. A HELD message must NOT clear the flag. The patron presses Stop, then types a
    correction while the turn is still winding down -- which 1b's own UI change
    encourages, since Send now sits beside Stop -- and clearing it there would cancel the
    Stop they just pressed: the worker's halt() reads exactly this column on every tool
    call, would find nothing, and the run would carry on to job end."""
    enqueued = await _begin(queued=False)
    assert any("stop_requested_at = NULL" in q for q in enqueued.sql), \
        "an enqueued message resumes a stopped session"

    held = await _begin(queued=True)
    assert not any("stop_requested_at = NULL" in q for q in held.sql), \
        "a HELD message must not cancel the Stop the patron just pressed"
    # It is still recorded, with the sentinel, so the transcript and the UI have it.
    assert any("INSERT INTO turns" in q for q in held.sql)
    assert any("INSERT INTO session_events" in q and "user_msg" in q for q in held.sql)


def test_the_real_begin_turn_clears_the_stop_flag():
    """1c's other half, for the same reason: the fake clears its own set. A flag that
    outlives its turn halts the NEXT turn at its first tool call."""
    assert "stop_requested_at = NULL" in app.CLEAR_STOP_SQL
    import inspect
    source = inspect.getsource(app.PgStore.begin_turn)
    assert "CLEAR_STOP_SQL" in source, "begin_turn must clear the flag, or a stopped session never resumes"


async def test_post_message_on_queue_failure_marks_the_turn_and_returns_502(caplog):
    store, queue = FakeStore(), FakeQueue(fail=True)
    row = store.seed_session()
    with caplog.at_level("ERROR", logger="proto.web"):
        async with make_client(store, queue) as c:
            r = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "hello"})
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert detail["message"] == app.ENQUEUE_FAILED_MESSAGE
    assert "elasticmq is down" in caplog.text, "the operator keeps the queue's own error"
    # The user_msg row stays; the 502 names its seq so the SPA can still drop the echo.
    assert detail == {"message": detail["message"], "turn_id": store.turns[0].turn_id, "seq": 1}
    assert store.failed == [(store.turns[0].turn_id, "enqueue_failed")]
    assert queue.sent == []


async def test_a_queue_refusal_never_reaches_the_patron(caplog):
    """A real SQS AccessDenied (measured on AWS, 2026-10-01) names the account id and the
    caller's role ARN. The 502 body is shown to the patron; the log line is the operator's."""
    refusal = ("SQS SendMessage failed: HTTP 403 AccessDenied: User: arn:aws:sts::123456789012:"
               "assumed-role/aws-elasticbeanstalk-ec2-role/i-0abc is not authorized to perform: sqs:sendmessage")

    class RefusingQueue(FakeQueue):
        async def send(self, body: dict[str, Any]) -> str:
            raise app.enqueue.SqsError(refusal)

    store, queue = FakeStore(), RefusingQueue()
    row = store.seed_session()
    with caplog.at_level("ERROR", logger="proto.web"):
        async with make_client(store, queue) as c:
            r = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "hello"})
    assert r.status_code == 502
    body = r.text
    for secret in ("123456789012", "arn:aws", "AccessDenied", "elasticbeanstalk"):
        assert secret not in body, secret
    assert refusal in caplog.text


async def test_post_message_rejects_empty_or_blank_text_and_unknown_session():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue) as c:
        for blank in ("", " ", "\n", "  \t "):
            r = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": blank})
            assert r.status_code == 422, repr(blank)
        assert (await c.post("/api/sessions/nope/messages", json={"text": "x"})).status_code == 404
        assert queue.sent == []
        # Padding around real text is not blankness.
        assert (await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "  hi  "})).status_code == 202
    assert [m["text"] for m in queue.sent] == ["  hi  "]


async def test_get_events_returns_rows_above_the_cursor():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    for i in range(5):
        store.add_event(row.session_id, "text", {"text": f"t{i}"})
    store.activity_rows[row.session_id] = Activity(T0, {"agent": "a"})
    async with make_client(store, queue) as c:
        all_ = (await c.get(f"/api/sessions/{row.session_id}/events")).json()
        assert [e["seq"] for e in all_["events"]] == [1, 2, 3, 4, 5]
        assert all_["next_after"] == 5 and all_["turn_active"] is False
        assert all_["activity"]["event"]["kind"] == "task_progress"
        tail = (await c.get(f"/api/sessions/{row.session_id}/events?after=3")).json()
        assert [e["seq"] for e in tail["events"]] == [4, 5]
        # The header wins over the query, exactly as on the stream.
        hdr = (await c.get(f"/api/sessions/{row.session_id}/events?after=0", headers={"Last-Event-ID": "4"})).json()
        assert [e["seq"] for e in hdr["events"]] == [5]
        empty = (await c.get(f"/api/sessions/{row.session_id}/events?after=5")).json()
        assert empty["events"] == [] and empty["next_after"] == 5
        assert (await c.get(f"/api/sessions/{row.session_id}/events?after=abc")).status_code == 400


async def test_stream_route_headers_and_first_frames():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    store.add_event(row.session_id, "text", {"text": "hello"})
    async with make_client(store, queue, stream_max_polls=1) as c:
        r = await c.get(f"/api/sessions/{row.session_id}/events/stream")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache" and r.headers["x-accel-buffering"] == "no"
    frames = parse_frames(r.text)
    assert frames[0]["retry"] == 1000
    assert frames[1]["id"] == 1 and frames[1]["data"]["type"] == "agent_event"


async def test_stream_route_400_on_bad_cursor_and_404_on_unknown_session():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue, stream_max_polls=1) as c:
        assert (await c.get(f"/api/sessions/{row.session_id}/events/stream", headers={"Last-Event-ID": "x"})).status_code == 400
        assert (await c.get("/api/sessions/nope/events/stream")).status_code == 404


# ── stream_frames, pulled directly ───────────────────────────────────────────────


async def test_stream_yields_events_after_the_cursor_with_ids_and_then_pings():
    store = FakeStore()
    row = store.seed_session()
    for i in range(4):
        store.add_event(row.session_id, "text", {"text": f"t{i}"})
    gen = stream_frames(store, row, 2, poll_s=0.0, ping_s=0.0)
    frames = await take(gen, 4)  # retry, seq 3, seq 4, then an idle poll -> ping
    assert frames[0]["retry"] == 1000
    assert [f["id"] for f in frames[1:3]] == [3, 4]
    assert [f["data"]["seq"] for f in frames[1:3]] == [3, 4]
    assert frames[3]["comment"] == "ping" and frames[3]["id"] is None


async def test_stream_resumes_from_last_event_id_over_after():
    store = FakeStore()
    row = store.seed_session()
    for i in range(6):
        store.add_event(row.session_id, "text", {"text": f"t{i}"})
    cursor = resolve_cursor("5", "0")  # what the route computes from the reconnect
    frames = await take(stream_frames(store, row, cursor, poll_s=0.0, ping_s=5.0), 2)
    assert [f["id"] for f in frames] == [None, 6]  # retry, then only the missed row


async def test_stream_announces_an_in_flight_turn_after_the_catch_up_rows():
    """ChatPane clears busy on every turn_done, so a replayed one must land BEFORE the
    turn_active status, never after it (sandbox_server.py orders it the same way)."""
    store = FakeStore()
    row = store.seed_session()
    store.active.add(row.session_id)
    store.add_event(row.session_id, "user_msg", {"text": "first", "turn_id": "t0"})
    store.add_event(row.session_id, "turn_done", {"turn_id": "t0"})
    store.add_event(row.session_id, "user_msg", {"text": "second", "turn_id": "t1"})
    frames = await take(stream_frames(store, row, 0, poll_s=0.0, ping_s=5.0), 5)
    assert [f["id"] for f in frames] == [None, 1, 2, 3, None]
    assert frames[2]["data"]["event"]["kind"] == "turn_done"
    assert frames[4]["data"] == {"type": "status", "state": "turn_active"}


async def test_stream_has_no_status_frame_when_no_turn_is_in_flight():
    store = FakeStore()
    row = store.seed_session()
    store.add_event(row.session_id, "text", {"text": "hello"})
    frames = await take(stream_frames(store, row, 0, poll_s=0.0, ping_s=0.0), 3)  # retry, seq 1, ping
    assert [(f["id"], (f["data"] or {}).get("type"), f["comment"]) for f in frames] == [
        (None, None, None), (1, "agent_event", None), (None, None, "ping"),
    ]


async def test_stream_snapshots_documents_at_open_then_emits_changes_without_ids():
    store = FakeStore()
    row = store.seed_session()
    store.docs[row.project_id] = {"research.json": (1, {"v": 1})}
    gen = stream_frames(store, row, 0, poll_s=0.0, ping_s=5.0)
    opening = parse_frames(await anext(gen) + await anext(gen))
    assert opening[0]["retry"] == 1000
    # The snapshot: a stream opened (or reopened) after a version moved must not miss it.
    assert opening[1] == {"id": None, "data": {"type": "research_updated", "name": "research.json", "data": {"v": 1}}, "comment": None, "retry": None}
    # Mutate between pulls: the next poll sees a new activity row and two moved versions.
    store.activity_rows[row.session_id] = Activity(T0, {"agent": "record-extractor", "last_tool": "record_read"})
    store.docs[row.project_id] = {"research.json": (2, {"v": 2}), "tree.gedcomx.json": (1, {"persons": []})}
    frames = await take(gen, 3)
    assert [(f["id"], f["data"]["type"]) for f in frames] == [
        (None, "agent_event"), (None, "research_updated"), (None, "gedcomx_updated"),
    ]
    assert frames[0]["data"]["event"]["kind"] == "task_progress"
    assert frames[1]["data"]["data"] == {"v": 2}


async def test_stream_stops_when_the_client_disconnects():
    store = FakeStore()
    row = store.seed_session()
    calls = 0

    async def disconnected() -> bool:
        nonlocal calls
        calls += 1
        return calls >= 2

    frames = [f async for f in stream_frames(store, row, 0, poll_s=0.0, ping_s=5.0, is_disconnected=disconnected)]
    assert calls == 2 and parse_frames("".join(frames))[0]["retry"] == 1000


# ── compose / schema shape (alongside test_proto_config.py) ─────────────────────

COMPOSE = PROTO / "docker-compose.yml"
SQL_WEB = PROTO / "sql" / "003_web.sql"


def _compose() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))


def _env(service: dict) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    return dict(str(item).partition("=")[::2] for item in raw)


def test_web_service_is_published_and_depends_on_postgres_and_the_queue_only():
    services = _compose()["services"]
    web = services["web"]
    assert web["container_name"] == "proto-web"
    assert web["ports"], "the SPA and the driver reach the tier from the host"
    assert all(str(p).startswith("127.0.0.1:") for p in web["ports"]), "dev-login signs anyone in: publish on loopback only"
    deps = web["depends_on"]
    assert deps["postgres"] == {"condition": "service_healthy"}
    assert deps["elasticmq"] == {"condition": "service_healthy"}
    assert "worker" not in deps, "the tier is driven against rows a script inserts until the worker exists"
    assert "shim" not in deps


def test_web_service_sends_to_the_queue_the_shim_reads():
    services = _compose()["services"]
    assert _env(services["web"])["QUEUE_URL"] == _env(services["shim"])["QUEUE_URL"]


def test_compose_web_and_worker_carry_dummy_sqs_chain_env():
    """U7: both tiers sign SendMessage. In compose they sign with dummies elasticmq ignores,
    through the default chain's env provider, and IMDS stays off so a laptop never waits
    on 169.254.169.254. Not GENEALOGY_*: the worker holds no store credentials."""
    services = _compose()["services"]
    web, worker_env = _env(services["web"]), _env(services["worker"])
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        assert web[name] and web[name] == worker_env[name], name
    assert web["AWS_EC2_METADATA_DISABLED"] == "true"
    assert worker_env["AWS_EC2_METADATA_DISABLED"] == "true"
    assert not [k for k in worker_env if k.startswith("GENEALOGY_")]


# ── U7: the signed queue ─────────────────────────────────────────────────────────

QUEUE = "http://elasticmq:9324/000000000000/turns"


async def test_lifespan_refuses_a_half_sqs_pair_only_with_a_queue(monkeypatch):
    monkeypatch.setenv("GENEALOGY_SQS_ACCESS_KEY", "AKIAHALFPAIR")
    monkeypatch.setenv("QUEUE_URL", QUEUE)
    application = create_app(store=FakeStore())
    with pytest.raises(RuntimeError, match="GENEALOGY_SQS_SECRET_KEY") as exc:
        async with application.router.lifespan_context(application):
            pass
    assert "AKIAHALFPAIR" not in str(exc.value)

    monkeypatch.delenv("QUEUE_URL")
    application = create_app(store=FakeStore())
    async with application.router.lifespan_context(application):
        assert isinstance(application.state.queue, app.NullQueue)


async def test_lifespan_start_line_names_mode_and_region(monkeypatch, caplog):
    monkeypatch.setenv("GENEALOGY_SQS_ACCESS_KEY", "AKIASTARTLINE")
    monkeypatch.setenv("GENEALOGY_SQS_SECRET_KEY", "start-line-secret")
    monkeypatch.setenv("QUEUE_URL", QUEUE)
    application = create_app(store=FakeStore())
    with caplog.at_level("INFO", logger="proto.web"):
        async with application.router.lifespan_context(application):
            assert isinstance(application.state.queue, app.SqsQueue)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("queue: ")]
    assert lines == [f"queue: {QUEUE}; sqs credentials: static keys; region us-east-1"]
    assert not any("start-line-secret" in r.getMessage() or "AKIASTARTLINE" in r.getMessage()
                   for r in caplog.records)


def test_the_start_line_reaches_the_container_log():
    """uvicorn configures only its own loggers: without a handler of its own, proto.web's
    INFO start line is dropped in the container while caplog still sees it here."""
    import logging

    assert app.log.handlers, "proto.web has no handler: its INFO lines never reach the log"
    assert app.log.getEffectiveLevel() <= logging.INFO


async def test_lifespan_warns_when_the_chain_finds_nothing(monkeypatch, caplog):
    monkeypatch.setenv("QUEUE_URL", QUEUE)
    application = create_app(store=FakeStore())
    with caplog.at_level("INFO", logger="proto.web"):
        async with application.router.lifespan_context(application):
            pass
    assert f"queue: {QUEUE}; sqs credentials: default chain (none found); region us-east-1" in caplog.messages
    assert any(r.levelname == "WARNING" and "no AWS credentials" in r.getMessage() for r in caplog.records)


async def test_sqs_queue_send_signs_over_the_wire():
    from _sigv4 import Capture, verify_sigv4

    app.enqueue.configure({"GENEALOGY_SQS_ACCESS_KEY": "AKIAWEB", "GENEALOGY_SQS_SECRET_KEY": "web-secret"}, None)
    server = Capture()
    try:
        queue = app.SqsQueue(server.url + "/000000000000/turns")
        assert await queue.send({"turn_id": "t"}) == "m1"
    finally:
        server.close()
    [req] = server.requests
    assert verify_sigv4(req["method"], req["path"], req["headers"], req["body"], "web-secret", "us-east-1", "sqs")
    form = dict(pair.split("=", 1) for pair in req["body"].decode("utf-8").split("&"))
    from urllib.parse import unquote_plus

    assert unquote_plus(form["MessageBody"]) == json.dumps({"turn_id": "t"})
    assert unquote_plus(form["QueueUrl"]) == server.url + "/000000000000/turns"


def test_web_build_context_carries_enqueue_sql_and_the_client_config():
    """U2 moved the context to the repo root (like the tools image) so the image can carry
    the engine's familysearch.json, the client id's sole source. The paths are checked
    against the repo too, so a moved file reds here and not in `docker build`."""
    web = _compose()["services"]["web"]
    assert web["build"] == {"context": "../../..", "dockerfile": "apps/server/proto/web/Dockerfile"}
    repo = PROTO.parents[2]
    assert (repo / web["build"]["dockerfile"]).is_file()
    dockerfile = (PROTO / "web" / "Dockerfile").read_text(encoding="utf-8")
    copies = dict(ln.split()[1:3] for ln in dockerfile.splitlines() if ln.startswith("COPY "))
    assert copies["apps/server/proto/enqueue.py"] == "./"
    assert copies["apps/server/proto/sql"] == "./sql"
    assert copies["apps/server/proto/web"] == "./web"
    assert copies["packages/engine/mcp-server/config/familysearch.json"] == "./config/familysearch.json"
    for src in copies:
        assert (repo / src).exists(), f"the web Dockerfile copies {src}, which is not in the repo"
    # ./config/familysearch.json under WORKDIR /app is the path web/auth.py looks at first.
    assert auth.CLIENT_CONFIG_CANDIDATES[0].relative_to(auth.PROTO_DIR).as_posix() == "config/familysearch.json"


def test_003_web_only_adds_not_null_default_columns_to_sessions():
    body = "\n".join(line.split("--", 1)[0] for line in SQL_WEB.read_text(encoding="utf-8").splitlines())
    # Whitespace-normalised so a statement reflowed across lines is still the same statement.
    statements = [re.sub(r"\s+", " ", s).strip() for s in body.split(";") if s.strip()]
    assert statements, "003_web.sql has no statements"
    for stmt in statements:
        assert re.match(r"ALTER TABLE sessions ADD COLUMN IF NOT EXISTS \w+ .*NOT NULL DEFAULT", stmt), stmt
    columns = {re.match(r"ALTER TABLE sessions ADD COLUMN IF NOT EXISTS (\w+)", s).group(1) for s in statements}
    assert columns == {"title", "model", "updated_at"}


async def test_create_session_on_a_seeded_project_and_refuse_a_bad_project_id():
    # proto/seed.py loads a fixture under a project id, then opens the session on it.
    store, queue = FakeStore(), FakeQueue()
    async with make_client(store, queue) as c:
        r = await c.post("/api/sessions", json={"title": "Bagley", "project_id": "proj_bagley-father-1884_ab12cd"})
        assert r.status_code == 200
        assert store.sessions[r.json()["id"]].project_id == "proj_bagley-father-1884_ab12cd"
        r = await c.post("/api/sessions", json={"title": "x"})
        assert store.sessions[r.json()["id"]].project_id.startswith("proj_")
        for bad in ("p/q", "", "..", "/p", "p q", "-p"):
            assert (await c.post("/api/sessions", json={"project_id": bad})).status_code == 422, repr(bad)



# ── U2: patron sign-in and owner scoping ────────────────────────────────────────

AUTH_ENV = ("PUBLIC_URL", "WEB_ORIGIN", "SESSION_SECRET", "FS_TOKEN_ENC_KEY", "ALLOWED_EMAILS",
            "FAMILYSEARCH_WEB_ENABLED", "FAMILYSEARCH_CONFIG")


@pytest.fixture(autouse=True)
def _clean_auth_env(monkeypatch):
    """A developer's shell can carry PUBLIC_URL or FAMILYSEARCH_WEB_ENABLED; either turns
    dev-login off and changes what every route test here means."""
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)


def _per_session_routes() -> list[tuple[str, str]]:
    """(method, path) for every route under /api/sessions/{session_id}, read off the app
    itself -- so a route added later is swept without anyone remembering to list it."""
    pairs = []
    for route in create_app(FakeStore(), FakeQueue()).routes:
        path = getattr(route, "path", "")
        if path.startswith("/api/sessions/{session_id}"):
            pairs += [(m, path) for m in sorted(route.methods - {"HEAD"})]
    return sorted(pairs)


_BODIES = {"/api/sessions/{session_id}/messages": {"text": "Find Thomas Flynn"},
           "/api/sessions/{session_id}": {"title": "renamed"}}


async def _call(c: httpx.AsyncClient, method: str, path: str, session_id: str) -> httpx.Response:
    url = path.replace("{session_id}", session_id).replace("{log_id}", "q_001")
    body = _BODIES.get(path) if method in ("POST", "PATCH") else None
    return await c.request(method, url, json=body)


def test_the_route_sweep_sees_every_per_session_route():
    # 13 routes: get, patch, delete, resume, state, sidecar, image, logs, files,
    # interrupt, messages, events, events/stream. A new one must be decided on, not missed.
    assert len(_per_session_routes()) == 13, _per_session_routes()


@pytest.mark.parametrize(("method", "path"), _per_session_routes())
async def test_second_user_gets_404_on_every_session_route(method, path):
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session(owner=USER_A.id)
    async with make_client(store, queue, user=USER_B.id, stream_max_polls=1) as c:
        r = await _call(c, method, path, row.session_id)
    assert r.status_code == 404, (method, path, r.status_code, r.text[:200])
    assert r.json()["detail"] == "Session not found"
    assert row.session_id in store.sessions and store.turns == [] and store.stopped == set()
    # The owner still gets through -- the refusal is about B, not about the route.
    async with make_client(store, queue, user=USER_A.id, stream_max_polls=1) as c:
        r = await _call(c, method, path, row.session_id)
    assert r.status_code not in (401, 403), (method, path, r.status_code)
    assert r.status_code != 404 or r.json()["detail"] != "Session not found", (method, path)


@pytest.mark.parametrize(("method", "path"), _per_session_routes() + [("GET", "/api/sessions"), ("POST", "/api/sessions")])
async def test_session_routes_require_a_cookie(method, path):
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session()
    async with make_client(store, queue, user=None, stream_max_polls=1) as c:
        r = await _call(c, method, path, row.session_id)
        assert r.status_code == 401, (method, path, r.status_code)
        assert (await c.get("/api/health")).status_code == 200


async def test_a_forged_or_unknown_cookie_is_401():
    store, queue = FakeStore(), FakeQueue()
    async with make_client(store, queue, user="usr_nobody") as c:
        assert (await c.get("/api/sessions")).status_code == 401
    app_ = create_app(store, queue)
    forged = auth.session_cookie_value(USER_A.id) + "x"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_), base_url="http://t",
                                 cookies={auth.COOKIE_NAME: forged}) as c:
        assert (await c.get("/api/sessions")).status_code == 401


async def test_an_unowned_project_is_nobodys():
    # The engine creates projects without an owner; until a create claims one, nobody sees it.
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session(owner=None)
    async with make_client(store, queue) as c:
        assert (await c.get(f"/api/sessions/{row.session_id}")).status_code == 404
        assert (await c.get("/api/sessions")).json() == []


async def test_list_sessions_returns_only_the_callers_sessions():
    store, queue = FakeStore(), FakeQueue()
    store.seed_session("sess_a", "proj_a", owner=USER_A.id)
    store.seed_session("sess_b", "proj_b", owner=USER_B.id)
    async with make_client(store, queue, user=USER_A.id) as c:
        assert [s["id"] for s in (await c.get("/api/sessions")).json()] == ["sess_a"]
    async with make_client(store, queue, user=USER_B.id) as c:
        assert [s["id"] for s in (await c.get("/api/sessions")).json()] == ["sess_b"]


async def test_delete_by_another_user_leaves_the_session_and_project_documents():
    store, queue = FakeStore(), FakeQueue()
    row = store.seed_session(owner=USER_A.id)
    store.docs[row.project_id] = {"research.json": (1, {"x": 1})}
    async with make_client(store, queue, user=USER_B.id) as c:
        assert (await c.delete(f"/api/sessions/{row.session_id}")).status_code == 404
    assert row.session_id in store.sessions and row.project_id in store.docs


async def test_deleting_one_of_two_sessions_keeps_the_other_visible():
    store, queue = FakeStore(), FakeQueue()
    first = store.seed_session("sess_1", "proj_1")
    second = store.seed_session("sess_2", "proj_1")
    store.docs["proj_1"] = {"research.json": (1, {"x": 1})}
    async with make_client(store, queue) as c:
        assert (await c.delete(f"/api/sessions/{first.session_id}")).status_code == 200
        assert (await c.get(f"/api/sessions/{second.session_id}")).status_code == 200
        state = (await c.get(f"/api/sessions/{second.session_id}/state")).json()
    assert state["research"] == {"x": 1}, "the surviving session's documents went with the other one"


async def test_create_session_refuses_a_project_owned_by_another_user():
    store, queue = FakeStore(), FakeQueue()
    store.seed_session("sess_a", "proj_a", owner=USER_A.id)
    async with make_client(store, queue, user=USER_B.id) as c:
        r = await c.post("/api/sessions", json={"project_id": "proj_a"})
    assert r.status_code == 404
    assert [s.session_id for s in store.sessions.values() if s.project_id == "proj_a"] == ["sess_a"]


async def test_create_session_on_own_project_opens_a_second_session():
    store, queue = FakeStore(), FakeQueue()
    store.seed_session("sess_a", "proj_a", owner=USER_A.id)
    async with make_client(store, queue, user=USER_A.id) as c:
        r = await c.post("/api/sessions", json={"project_id": "proj_a"})
    assert r.status_code == 200
    assert store.sessions[r.json()["id"]].project_id == "proj_a"


async def test_supplied_project_id_is_created_or_claimed_only_under_dev_login(monkeypatch):
    store, queue = FakeStore(), FakeQueue()
    store.seed_session("sess_x", "proj_unowned", owner=None)
    # Dev-login on (the default): a new id is created and an unowned one is claimed.
    async with make_client(store, queue) as c:
        assert (await c.post("/api/sessions", json={"project_id": "proj_new"})).status_code == 200
        assert (await c.post("/api/sessions", json={"project_id": "proj_unowned"})).status_code == 200
    assert store.owners["proj_new"] == store.owners["proj_unowned"] == USER_A.id
    # FamilySearch sign-in on: dev-login is off, and neither may happen.
    store2 = FakeStore()
    store2.seed_session("sess_y", "proj_unowned", owner=None)
    store2.allowed = {USER_A.email}
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    assert not auth.dev_login_enabled()
    async with make_client(store2, queue) as c:
        assert (await c.post("/api/sessions", json={"project_id": "proj_new"})).status_code == 404
        assert (await c.post("/api/sessions", json={"project_id": "proj_unowned"})).status_code == 404
        assert (await c.post("/api/sessions", json={})).status_code == 200, "a fresh project is still fine"
    assert "proj_new" not in store2.owners and store2.owners["proj_unowned"] is None


def test_queue_body_carries_no_token_or_user_field():
    """U3 resolves the patron from the project_id already in the body; a token in the body
    would persist in turns.message, SQS and the DLQ."""
    body = app.queue_body("t", SessionRow("s", "p", "t", "m", T0, T0, USER_A.id), "hi", T0.isoformat(), 1)
    assert set(body) == {"turn_id", "session_id", "project_id", "text", "enqueued_at", "max_nudges"}


# ── U10: /api/health as readiness ────────────────────────────────────────────────


class SilentPostgres:
    """A local listener that accepts and never answers: a blackholed Postgres, no
    network. ``accepted`` counts the connections the probes opened."""

    hang_up = False

    def __init__(self) -> None:
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.sock.settimeout(0.05)
        self.port = self.sock.getsockname()[1]
        self.accepted: list[socket.socket] = []
        self.stopped = threading.Event()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.stopped.is_set():
            try:
                conn, _ = self.sock.accept()
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            if self.hang_up:
                conn.close()
            else:
                self.accepted.append(conn)

    @property
    def dsn(self) -> str:
        return f"postgresql://probeuser:secretpw@127.0.0.1:{self.port}/proto"

    def close(self) -> None:
        self.stopped.set()
        self.sock.close()
        for conn in self.accepted:
            conn.close()


@pytest.fixture
def silent_pg():
    pg = SilentPostgres()
    yield pg
    pg.close()


class RefusingPostgres(SilentPostgres):
    """A local listener that hangs up on every connection at once: a Postgres that is down
    and says so fast on every OS. Port 1 is not that on Windows, which retries a refused
    loopback connect for about two seconds, past ``READY_TIMEOUT_S``."""

    hang_up = True


@pytest.fixture
def refused_pg():
    pg = RefusingPostgres()
    yield pg
    pg.close()


REFUSED_DSN = "postgresql://probeuser:secretpw@127.0.0.1:1/proto"
HEALTH_KEYS = {"ok", "tier", "queue", "poll_s", "ping_s"}


class ReadyStore(FakeStore):
    """A FakeStore with the optional probe, answering ``check``."""

    def __init__(self, check: dict[str, Any]) -> None:
        super().__init__()
        self.check = check

    async def check_ready(self, timeout_s: float | None = None) -> dict[str, Any]:
        return {"ok": self.check["ok"], "checks": {"postgres": self.check}}


async def test_health_is_503_when_the_store_is_not_ready():
    store = ReadyStore({"ok": False, "error": "OperationalError"})
    async with make_client(store, FakeQueue(), user=None) as c:
        r = await c.get("/api/health")
    body = r.json()
    assert r.status_code == 503 and HEALTH_KEYS <= set(body) and body["ok"] is False
    assert body["queue"] == "FakeQueue", "the keys the drivers read survive a 503"
    assert body["checks"] == {"postgres": {"ok": False, "error": "OperationalError"}}


async def test_health_is_200_with_checks_when_ready():
    async with make_client(ReadyStore({"ok": True}), FakeQueue(), user=None) as c:
        r = await c.get("/api/health")
    assert r.status_code == 200 and r.json()["checks"] == {"postgres": {"ok": True}}
    async with make_client(FakeStore(), FakeQueue(), user=None) as c:
        r = await c.get("/api/health")
    assert r.status_code == 200 and "checks" not in r.json(), "a store with no probe keeps today's body"


async def test_health_that_raises_is_503_not_500():
    class Broken(FakeStore):
        async def check_ready(self, timeout_s=None):
            raise RuntimeError("probe exploded")

    async with make_client(Broken(), FakeQueue(), user=None) as c:
        r = await c.get("/api/health")
    assert r.status_code == 503 and "checks" not in r.json() and HEALTH_KEYS <= set(r.json())


def test_the_tier_logs_its_info_lines_under_a_bare_interpreter():
    """uvicorn configures only its own loggers; an ok health transition is an info line,
    and the live stack showed none until proto.web had its own handler."""
    import subprocess

    code = (
        "import asyncio, sys; sys.path.insert(0, sys.argv[1]); from web import app\n"
        "store = app.PgStore(sys.argv[2])\n"
        "async def fake(): return None\n"
        "store._probe_postgres = fake\n"
        "asyncio.run(store.check_ready())\n"
    )
    out = subprocess.run([sys.executable, "-c", code, str(PROTO), REFUSED_DSN], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert out.returncode == 0, out.stderr
    assert "ev=health check=postgres ok=true" in out.stderr, out.stderr


async def test_pgstore_check_ready_fails_fast_on_refused_and_silent_postgres(refused_pg, silent_pg):
    refused = await app.PgStore(refused_pg.dsn).check_ready()
    assert refused == {"ok": False, "checks": {"postgres": {"ok": False, "error": "OperationalError"}}}
    started = time.monotonic()
    silent = await app.PgStore(silent_pg.dsn).check_ready(timeout_s=0.3)
    elapsed = time.monotonic() - started
    assert silent["checks"]["postgres"] == {"ok": False, "error": "TimeoutError"}
    assert elapsed < 0.8, f"{elapsed:.2f}s: psycopg's own connect_timeout decided, not the race"
    for report in (refused, silent):
        raw = json.dumps(report)
        assert "probeuser" not in raw and "127.0.0.1" not in raw and "secretpw" not in raw


async def test_concurrent_health_share_one_probe(monkeypatch, silent_pg):
    monkeypatch.setattr(app, "READY_TIMEOUT_S", 0.3)
    async with make_client(app.PgStore(silent_pg.dsn), FakeQueue(), user=None) as c:
        replies = await asyncio.gather(*(c.get("/api/health") for _ in range(3)))
    accepted = len(silent_pg.accepted)
    assert [r.status_code for r in replies] == [503, 503, 503]
    assert all(r.json()["checks"]["postgres"] == {"ok": False, "error": "TimeoutError"} for r in replies)
    assert accepted == 1, f"{accepted} connections: a stalled host must cost one, not one per probe"
