"""Public /v1 REST API over the real LocalProvider + the in-sandbox WS server +
the mock agent. Mirrors test_sandbox_server.py: a turn drives a real subprocess
WS server, no E2B/Anthropic needed.

Keys come from conftest's API_KEYS:
  sk_test  → api-bot@example.com   (NOT on the allowlist — operator-granted)
  sk_other → other-bot@example.com (a second client, for isolation)
"""
import asyncio
import json
import time
from datetime import timedelta

import pytest

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import get_engine
from app.main import app
from app.models import Project, utcnow


def _set_lock(sid: str, when):
    """Force Project.turn_locked_at directly in the DB (simulates an in-flight or
    stale turn held by another instance, without racing a real concurrent turn)."""
    with Session(get_engine()) as s:
        p = s.get(Project, sid)
        p.turn_locked_at = when
        s.add(p)
        s.commit()


def _seed_active(sid: str):
    """Pre-write research.json into the sandbox project dir so the mock agent boots
    straight into 'active' phase (skips the onboarding interview) — then a "search"
    turn runs the record_search tool. Must be called after create, before the first
    message (the agent reads phase from the FS when it spawns on first connect).
    Reaches into LocalProvider internals, same as test_sessions.py."""
    with Session(get_engine()) as s:
        sandbox_id = s.get(Project, sid).sandbox_id
    proj = app.state.provider._root(sandbox_id) / "project"  # LocalProvider
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "research.json").write_text('{"project":{"id":"seed"}}', encoding="utf-8")

def _tokens_path(sid: str):
    """Path to the FS tokens.json injected for a /v1 session's sandbox (LocalProvider),
    mirroring where the in-sandbox MCP reads it (HOME_DIR/.familysearch-mcp)."""
    with Session(get_engine()) as s:
        sandbox_id = s.get(Project, sid).sandbox_id
    return (
        app.state.provider._root(sandbox_id)
        / "home" / "user" / ".familysearch-mcp" / "tokens.json"
    )


K = {"Authorization": "Bearer sk_test"}
K_OTHER = {"Authorization": "Bearer sk_other"}


def _create(client, headers=K) -> str:
    r = client.post("/v1/sessions", json={"title": "t"}, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["session_id"].startswith("prj_")
    assert body["title"] == "t" and body["model"] and body["created_at"]
    # Lean shape: no internal fields leak.
    assert not (set(body) & {"sandbox_id", "agent_session_id", "status", "sample"})
    return body["session_id"]


# ── auth + error envelope ────────────────────────────────────────
def test_missing_bearer_is_unauthorized_envelope():
    with TestClient(app) as client:
        r = client.post("/v1/sessions", json={})
        assert r.status_code == 401
        assert r.json() == {"error": {"code": "unauthorized", "message": "Missing bearer token"}}


def test_invalid_key_is_unauthorized():
    with TestClient(app) as client:
        r = client.post("/v1/sessions", json={}, headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"


def test_operator_granted_key_bypasses_allowlist():
    # api-bot@example.com is NOT allowlisted, yet the key mints it a session.
    with TestClient(app) as client:
        sid = _create(client)
        assert sid
        client.delete(f"/v1/sessions/{sid}", headers=K)


def test_validation_error_envelope():
    with TestClient(app) as client:
        r = client.post("/v1/sessions/prj_x/messages", json={}, headers=K)  # missing message
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "validation_error"


# ── FamilySearch token injection at create ───────────────────────
def test_create_injects_supplied_familysearch_token():
    """A /v1 client with no FS app-login row supplies the token in the create body;
    it lands in the sandbox in the engine's tokens.json shape, ready for the in-sandbox
    MCP to self-refresh."""
    with TestClient(app) as client:
        r = client.post("/v1/sessions", json={
            "title": "t",
            "familysearch_token": {
                "access_token": "v1-access",
                "refresh_token": "v1-refresh",
                "expires_in": 3600,
            },
        }, headers=K)
        assert r.status_code == 201, r.text
        sid = r.json()["session_id"]
        assert "familysearch_token" not in r.json()  # not echoed back

        tok = json.loads(_tokens_path(sid).read_text(encoding="utf-8"))
        assert tok["accessToken"] == "v1-access"
        assert tok["refreshToken"] == "v1-refresh"
        assert isinstance(tok["expiresAt"], int) and tok["expiresAt"] > 0
        client.delete(f"/v1/sessions/{sid}", headers=K)


def test_create_token_not_persisted_to_db():
    """The supplied token is injected into the sandbox only — never written to the
    control-plane familysearch_tokens table (sidesteps encrypt-at-rest for /v1)."""
    from app.models import FamilySearchToken

    with TestClient(app) as client:
        r = client.post("/v1/sessions", json={
            "familysearch_token": {"access_token": "v1-access", "refresh_token": "v1-refresh"},
        }, headers=K)
        sid = r.json()["session_id"]
        with Session(get_engine()) as s:
            user_id = s.get(Project, sid).user_id
            assert s.get(FamilySearchToken, user_id) is None
        client.delete(f"/v1/sessions/{sid}", headers=K)


def test_create_without_token_injects_nothing():
    """No token supplied → no tokens.json (the FS-tool-less /v1 path; mock mode here
    never reads it)."""
    with TestClient(app) as client:
        sid = _create(client)
        assert not _tokens_path(sid).exists()
        client.delete(f"/v1/sessions/{sid}", headers=K)


def test_create_rejects_blank_access_token():
    """An empty access_token fails validation with the public envelope (min_length=1)."""
    with TestClient(app) as client:
        r = client.post("/v1/sessions", json={
            "familysearch_token": {"access_token": ""},
        }, headers=K)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "validation_error"


# ── sync turn ────────────────────────────────────────────────────
def test_sync_message_returns_assembled_reply():
    with TestClient(app) as client:
        sid = _create(client)
        r = client.post(f"/v1/sessions/{sid}/messages",
                         json={"message": "let's start"}, headers=K)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["session_id"] == sid
        assert body["role"] == "assistant"
        assert body["finish_reason"] == "stop"
        assert isinstance(body["tool_calls"], list)
        # First turn of a fresh project → the mock greets.
        assert "Welcome" in body["text"]
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── tool-using turn ──────────────────────────────────────────────
def test_sync_turn_reports_tool_calls():
    with TestClient(app) as client:
        sid = _create(client)
        _seed_active(sid)  # skip onboarding → a search turn runs record_search
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "search for census records"}, headers=K)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["finish_reason"] == "stop"
        # tool_use + tool_result are flattened into tool_calls.
        assert any(tc["tool"] == "record_search" for tc in body["tool_calls"]), body["tool_calls"]
        assert "census match" in body["text"]  # trailing text still assembled
        client.delete(f"/v1/sessions/{sid}", headers=K)


def test_stream_emits_tool_event():
    with TestClient(app) as client:
        sid = _create(client)
        _seed_active(sid)
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "search for census records", "stream": True}, headers=K)
        assert r.status_code == 200, r.text
        tool_payloads, saw_done = [], False
        for block in r.text.split("\n\n"):
            if block.startswith("event: tool"):
                tool_payloads.append(json.loads(block.split("data: ", 1)[1]))
            elif block.startswith("event: done"):
                saw_done = True
        assert saw_done, r.text
        assert any(p.get("tool") == "record_search" for p in tool_payloads), r.text
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── streaming turn ───────────────────────────────────────────────
def test_stream_message_done_text_equals_sync():
    with TestClient(app) as client:
        sid = _create(client)
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "let's start", "stream": True}, headers=K)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("text/event-stream")
        # Parse SSE: find the terminal `done` event payload.
        done = None
        for block in r.text.split("\n\n"):
            if block.startswith("event: done"):
                data = block.split("data: ", 1)[1]
                done = json.loads(data)
        assert done is not None, r.text
        assert done["session_id"] == sid
        assert done["finish_reason"] == "stop"
        assert "Welcome" in done["text"]
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── sync timeout ─────────────────────────────────────────────────
def test_sync_turn_timeout_returns_504(monkeypatch):
    """A sync turn capped at 0s ends in 504 turn_timeout (no partial text). The
    agent keeps running in the sandbox; the lock is released so a retry isn't 409'd
    forever."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "v1_turn_timeout_seconds", 0)
    with TestClient(app) as client:
        sid = _create(client)
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "let's start"}, headers=K)
        assert r.status_code == 504, r.text
        assert r.json()["error"]["code"] == "turn_timeout"
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── streaming idle cap ───────────────────────────────────────────
# WHAT THESE PROVE, AND WHAT THEY DO NOT. Together they show the cap fires on a
# silent agent behind a LIVE Hub, that a non-public frame resets it, and that a
# ping flood breaks nothing on a healthy turn. What no test here does is drive a
# genuinely silent real sandbox: the mock agent has no silence knob, and adding
# one would be a product change made for a test. So the ping frames in the two
# unit-level tests are the Hub's real bytes over a fake socket, and the
# integration test runs the real Hub with its interval turned down. Nothing in
# CI exercises a silent sandbox (docs/architecture.md §9.4), which is what
# `nothing-checks` is on this card for.


class _PingOnlyWS:
    """A socket delivering the Hub's heartbeat and nothing else.

    This is the exact shape of the wedge: a live Hub in front of an agent that
    has stopped producing. The frame is byte-identical to what
    `sandbox_server`'s `_heartbeat_loop` broadcasts.
    """

    def __init__(self, interval: float = 0.02):
        self.interval = interval
        self.pings = 0
        self.sent: list[str] = []
        self.closed = False

    async def recv(self):
        await asyncio.sleep(self.interval)
        self.pings += 1
        return json.dumps({"type": "ping", "ts": 1})

    async def send(self, raw):
        self.sent.append(raw)

    async def close(self):
        self.closed = True


class _StatusThenDoneWS(_PingOnlyWS):
    """Pings, interleaved with `status` frames the public stream DROPS, then a
    turn_done. A real turn looks like this while a subagent works."""

    def __init__(self, interval: float = 0.02, status_every: int = 3, finish_after: int = 12):
        super().__init__(interval)
        self.status_every = status_every
        self.finish_after = finish_after
        self.frames = 0

    async def recv(self):
        await asyncio.sleep(self.interval)
        self.frames += 1
        if self.frames >= self.finish_after:
            return json.dumps({"type": "agent_event", "event": {"kind": "turn_done"}})
        if self.frames % self.status_every == 0:
            return json.dumps({"type": "status", "phase": "active"})
        self.pings += 1
        return json.dumps({"type": "ping", "ts": 1})


async def _stream_body(monkeypatch, ws, idle_cap: float) -> str:
    """Drive `_handle_stream`'s generator over `ws` and return the SSE body.

    `_drain_replay` is stubbed out: it loops until a recv TIMES OUT, which a
    socket that always has a frame ready never does. It is not what is under
    test here.
    """
    from app import v1
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "v1_stream_idle_seconds", idle_cap)
    monkeypatch.setattr(v1, "_HEARTBEAT_S", 0.05)
    monkeypatch.setattr(v1, "_open_ws", _async_return(ws))
    monkeypatch.setattr(v1, "_drain_replay", _async_noop)
    monkeypatch.setattr(v1, "_release_turn", lambda *a, **k: None)

    resp = await v1._handle_stream(None, "sb", "go", "sess", "tok")
    return "".join([chunk async for chunk in resp.body_iterator])


def _async_return(value):
    async def _f(*_a, **_k):
        return value

    return _f


async def _async_noop(*_a, **_k):
    return None


@pytest.mark.asyncio
async def test_stream_idle_cap_fires_through_a_ping_flood(monkeypatch):
    """THE CAP THIS CARD IS ABOUT. Before it, `_handle_stream` had no bound of
    any kind and this stream never ended.

    The discriminating property is the ping flood: an idle clock reset by any
    frame can never fire, because the Hub keeps sending. If `_is_liveness`
    stopped excluding pings, this test would hang rather than fail, which is why
    the ping count is asserted too.
    """
    ws = _PingOnlyWS(interval=0.02)
    body = await asyncio.wait_for(_stream_body(monkeypatch, ws, idle_cap=0.3), timeout=15)

    assert "event: error" in body, body
    assert "turn_timeout" in body, body
    blocks = [b for b in body.split("\n\n") if b.startswith("event: done")]
    assert blocks, body
    assert json.loads(blocks[-1].split("data: ", 1)[1])["finish_reason"] == "error"
    assert ws.pings >= 3, (
        f"only {ws.pings} ping(s) arrived, so the flood was not exercised and this "
        f"test does not discriminate a ping-blind clock from a ping-aware one"
    )
    assert ws.closed, "the finally did not run: the socket is still open"


@pytest.mark.asyncio
async def test_a_dropped_status_frame_still_resets_the_idle_clock(monkeypatch):
    """The other direction, and the one that would break a healthy turn.

    `status` frames and viewer deltas never reach the public stream, so a cap
    counting only text/tool events would fire on a turn that is working. The cap
    here is shorter than the run, so it WOULD fire if status frames did not count.
    """
    ws = _StatusThenDoneWS(interval=0.02, status_every=3, finish_after=12)
    body = await asyncio.wait_for(_stream_body(monkeypatch, ws, idle_cap=0.12), timeout=15)

    assert "event: error" not in body, body
    blocks = [b for b in body.split("\n\n") if b.startswith("event: done")]
    assert blocks, body
    assert json.loads(blocks[-1].split("data: ", 1)[1])["finish_reason"] == "stop"


def test_a_live_ping_loop_does_not_break_a_healthy_stream_turn(monkeypatch):
    """INTEGRATION: a healthy turn still completes with the real in-sandbox Hub's
    heartbeat loop running at a low interval.

    WHAT THIS DOES NOT ESTABLISH, stated because the first version of this
    docstring claimed it did: it is not the proof that the idle clock ignores
    pings. It cannot be. The turn is short, the socket is open for less than a
    second of it, and nothing here can observe how many pings crossed the wire -
    so a mis-set interval would leave this passing with zero pings and prove
    nothing. The discriminating proof is
    `test_stream_idle_cap_fires_through_a_ping_flood`, which fails when
    `_is_liveness` is made ping-blind. This test's job is narrower and real: the
    no-false-positive direction, with the loop switched on.
    """
    from app.config import get_settings

    # 1.0, which is 2x `_DRAIN_IDLE`, and the margin is deliberate rather than
    # arbitrary. `_drain_replay` returns only after _DRAIN_IDLE seconds of
    # SILENCE on the socket before the turn is sent, so a ping interval at or
    # below it means silence never occurs and the turn is never sent at all -
    # the drain loops forever. Found by setting 0.1 here and watching this test
    # hang, which is also what proves the env var really does reach the
    # subprocess Hub. 0.7 worked but left 0.2s of slack, which is a flake
    # waiting for a slower machine - and the platform this card is about is the
    # slow one. Recorded in the spec: any future heartbeat speed-up has a floor.
    monkeypatch.setenv("WS_HEARTBEAT_INTERVAL", "1.0")
    monkeypatch.setattr(get_settings(), "v1_stream_idle_seconds", 60)
    with TestClient(app) as client:
        sid = _create(client)
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "let's start", "stream": True}, headers=K)
        assert r.status_code == 200, r.text
        assert "event: error" not in r.text, r.text
        done = [b for b in r.text.split("\n\n") if b.startswith("event: done")]
        assert done, r.text
        assert json.loads(done[-1].split("data: ", 1)[1])["finish_reason"] == "stop"
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── 409 session_busy (DB-backed lock) ────────────────────────────
def test_concurrent_turn_is_session_busy():
    with TestClient(app) as client:
        sid = _create(client)
        # A fresh (non-stale) lock held by "another instance" → 409.
        _set_lock(sid, utcnow())
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "second"}, headers=K)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "session_busy"
        client.delete(f"/v1/sessions/{sid}", headers=K)


def test_stale_lock_is_reclaimed():
    """A lock older than v1_turn_lock_stale_seconds must not wedge the session — a
    new turn reclaims it (guards against a crashed instance holding it forever)."""
    with TestClient(app) as client:
        sid = _create(client)
        _set_lock(sid, utcnow() - timedelta(hours=1))  # well past the staleness TTL
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "let's start"}, headers=K)
        assert r.status_code == 200, r.text
        assert "Welcome" in r.json()["text"]
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── ownership isolation ──────────────────────────────────────────
def test_another_client_cannot_reach_the_session():
    with TestClient(app) as client:
        sid = _create(client, headers=K)  # owned by api-bot
        # other-bot presents a valid key but does not own the session → 404.
        r = client.post(f"/v1/sessions/{sid}/messages",
                        json={"message": "hi"}, headers=K_OTHER)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "session_not_found"
        client.delete(f"/v1/sessions/{sid}", headers=K)


# ── delete ───────────────────────────────────────────────────────
def test_delete_releases_sandbox_and_404s_after():
    with TestClient(app) as client:
        r = client.post("/v1/sessions", json={}, headers=K)
        sid = r.json()["session_id"]
        # Drive one turn so the in-sandbox WS server is actually running.
        client.post(f"/v1/sessions/{sid}/messages", json={"message": "hi"}, headers=K)

        d = client.delete(f"/v1/sessions/{sid}", headers=K)
        assert d.status_code == 200
        assert d.json() == {"deleted": True, "session_id": sid}

        # Gone: a follow-up message 404s.
        r2 = client.post(f"/v1/sessions/{sid}/messages", json={"message": "again"}, headers=K)
        assert r2.status_code == 404


@pytest.mark.asyncio
async def test_drain_replay_returns_on_a_socket_that_is_never_idle(monkeypatch):
    """`_drain_replay` must stop on a ceiling, not only on silence.

    `_DRAIN_IDLE` bounds ONE `recv`; nothing bounded the loop. A socket with a
    frame always ready never times out, so the drain never returned. Both call
    sites are reachable in that state without a bug: the streaming cap abandons
    a still-running agent after `v1_stream_idle_seconds` of silence, and the
    next message on that session reconnects and drains -- if the agent resumed
    producing meanwhile, the drain spins while holding the turn lock.

    The sync path is the worse of the two and is why the bound lives inside the
    function rather than at the call site: `_collect_sync` drains BEFORE setting
    its `deadline`, so `v1_turn_timeout_seconds` never covered its drain.

    Scaled `_DRAIN_MAX` so the test costs a fraction of a second.

    THE FRAME LIMIT IS THE ASSERTION, not the elapsed-time check. An outer
    `asyncio.wait_for` does NOT rescue this: without the ceiling the loop is a
    tight cycle of immediately-returning coroutines, which never yields long
    enough for an outer timeout to fire, so removing the ceiling HANGS the test
    rather than failing it. Verified by doing exactly that -- the run had to be
    killed at 10 minutes. A hang reads as a stuck CI job, not a red test, so the
    fake raises once it has served more frames than any bounded drain could ask
    for, which turns the break into a deterministic failure.
    """
    from app import v1

    monkeypatch.setattr(v1, "_DRAIN_MAX", 0.3)

    class NeverIdle:
        """Always has a frame ready, so `recv` never times out.

        Sleeps a beat per frame so the event loop turns over (a fake that never
        awaits starves everything else), and refuses to serve more than `limit`,
        which is ~15x what a 0.3s ceiling at 0.01s/frame can consume.
        """

        def __init__(self, limit: int = 500):
            self.recvs = 0
            self.limit = limit

        async def recv(self):
            self.recvs += 1
            if self.recvs > self.limit:
                raise AssertionError(
                    f"_drain_replay consumed {self.recvs} frames without "
                    f"returning: the loop is unbounded, so a socket that is "
                    f"never idle wedges the turn"
                )
            await asyncio.sleep(0.01)
            return json.dumps({"type": "agent_event", "event": {"kind": "text_delta"}})

    ws = NeverIdle()
    started = time.monotonic()
    await v1._drain_replay(ws)
    elapsed = time.monotonic() - started

    assert ws.recvs > 1, "the fake socket was barely read, so this proves nothing"
    assert elapsed < 2.0, (
        f"the drain ran {elapsed:.2f}s against a socket that is never idle; "
        f"_DRAIN_MAX did not bound the loop"
    )


@pytest.mark.asyncio
async def test_drain_replay_still_returns_on_silence_well_inside_the_ceiling():
    """The ceiling must not become the ONLY way out.

    Without this, setting `_DRAIN_MAX` to 0 would satisfy the test above and
    break the drain entirely: every reconnect would send its turn before
    consuming the replay burst, and the caller would read history as live
    output. This is the direction that pins `_DRAIN_IDLE` still works.
    """
    from app import v1

    class TwoFramesThenIdle:
        def __init__(self):
            self.recvs = 0

        async def recv(self):
            self.recvs += 1
            if self.recvs <= 2:
                return json.dumps({"type": "agent_event", "event": {"kind": "text_delta"}})
            await asyncio.sleep(3600)  # silence: the idle timer must fire

    ws = TwoFramesThenIdle()
    started = time.monotonic()
    await asyncio.wait_for(v1._drain_replay(ws), timeout=5.0)
    elapsed = time.monotonic() - started

    assert ws.recvs == 3, f"expected 2 frames then one silent recv, got {ws.recvs}"
    assert elapsed < v1._DRAIN_MAX, (
        f"returned after {elapsed:.2f}s, i.e. on the {v1._DRAIN_MAX}s ceiling "
        f"rather than the {v1._DRAIN_IDLE}s idle timer"
    )
