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

import re
import sys
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
from web import app  # noqa: E402  (queue_body / max_nudges: one definition for the fake store too)
from web.app import (  # noqa: E402
    DEFAULT_MODEL,
    DEFAULT_TITLE,
    Activity,
    EventRow,
    SessionRow,
    Turn,
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


class FakeStore:
    def __init__(self) -> None:
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

    def seed_session(self, session_id: str = "sess_1", project_id: str = "proj_1") -> SessionRow:
        row = SessionRow(session_id, project_id, DEFAULT_TITLE, DEFAULT_MODEL, T0, T0)
        self.sessions[session_id] = row
        return row

    def add_event(self, session_id: str, kind: str, payload: dict[str, Any]) -> int:
        rows = self.events.setdefault(session_id, [])
        seq = len(rows) + 1
        rows.append(EventRow(seq=seq, kind=kind, payload=payload, ts=T0 + timedelta(seconds=seq)))
        return seq

    async def create_session(self, title: str, model: str, project_id: str | None = None) -> SessionRow:
        n = len(self.sessions) + 1
        row = SessionRow(f"sess_{n}", project_id or f"proj_{n}", title, model, T0, T0)
        self.sessions[row.session_id] = row
        return row

    async def list_sessions(self) -> list[SessionRow]:
        return list(self.sessions.values())

    async def get_session(self, session_id: str) -> SessionRow | None:
        return self.sessions.get(session_id)

    async def patch_session(self, session_id: str, title: str | None, model: str | None) -> SessionRow | None:
        row = self.sessions.get(session_id)
        if row is None:
            return None
        row = SessionRow(row.session_id, row.project_id, title or row.title, model or row.model, row.created_at, T0 + timedelta(minutes=1))
        self.sessions[session_id] = row
        return row

    async def delete_session(self, session_id: str) -> bool:
        return self.sessions.pop(session_id, None) is not None

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

    async def request_stop(self, session_id: str) -> bool:
        self.stopped.add(session_id)
        return True


class FakeQueue:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail = fail

    async def send(self, body: dict[str, Any]) -> str:
        if self.fail:
            raise RuntimeError("elasticmq is down")
        self.sent.append(body)
        return f"msg-{len(self.sent)}"


def make_client(store: FakeStore, queue: FakeQueue, **kw) -> httpx.AsyncClient:
    app = create_app(store, queue, poll_s=0.0, ping_s=0.0, **kw)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


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
        auth = (await c.get("/auth/config")).json()
        assert auth == {"familysearch": False, "devLogin": True}
        assert (await c.get("/auth/me")).json()["id"] == "proto"


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

    def __init__(self) -> None:
        self.sql: list[str] = []

    async def execute(self, sql, params=()):
        self.sql.append(" ".join(sql.split()))
        return self

    async def fetchone(self):
        return {"seq": 1}

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


async def test_post_message_on_queue_failure_marks_the_turn_and_returns_502():
    store, queue = FakeStore(), FakeQueue(fail=True)
    row = store.seed_session()
    async with make_client(store, queue) as c:
        r = await c.post(f"/api/sessions/{row.session_id}/messages", json={"text": "hello"})
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "elasticmq is down" in detail["message"]
    # The user_msg row stays; the 502 names its seq so the SPA can still drop the echo.
    assert detail == {"message": detail["message"], "turn_id": store.turns[0].turn_id, "seq": 1}
    assert store.failed == [(store.turns[0].turn_id, "enqueue_failed")]
    assert queue.sent == []


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
    assert all(str(p).startswith("127.0.0.1:") for p in web["ports"]), "no auth on the tier: publish on loopback only"
    deps = web["depends_on"]
    assert deps["postgres"] == {"condition": "service_healthy"}
    assert deps["elasticmq"] == {"condition": "service_healthy"}
    assert "worker" not in deps, "the tier is driven against rows a script inserts until the worker exists"
    assert "shim" not in deps


def test_web_service_sends_to_the_queue_the_shim_reads():
    services = _compose()["services"]
    assert _env(services["web"])["QUEUE_URL"] == _env(services["shim"])["QUEUE_URL"]


def test_web_build_context_carries_enqueue_and_sql():
    web = _compose()["services"]["web"]
    assert web["build"] == {"context": ".", "dockerfile": "web/Dockerfile"}
    dockerfile = (PROTO / "web" / "Dockerfile").read_text(encoding="utf-8")
    assert re.search(r"^COPY enqueue\.py", dockerfile, re.M) and re.search(r"^COPY sql", dockerfile, re.M)


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

