"""C1: the in-sandbox WS server. Spawns `python -m app.sandbox_server` against a
temp project with the mock agent, connects a real WS client, and drives a turn —
token auth + agent stream + turn_done + the /project watch delta. Integration
test (real subprocess + WS); runs on mocks, no E2B/Anthropic.
"""
import asyncio
import hashlib
import hmac
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import websockets

SERVER_ROOT = Path(__file__).resolve().parents[1]  # apps/server
SECRET = "test-ws-secret"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _token(ttl: int = 3600) -> str:
    exp = str(int(time.time()) + ttl)
    sig = hmac.new(SECRET.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


@pytest.fixture
def ws_server(tmp_path, request):
    extra_env = getattr(request, "param", {}) or {}
    proj = tmp_path / "project"
    (proj / "results").mkdir(parents=True)
    (tmp_path / "home").mkdir()
    port = _free_port()
    env = {
        **os.environ,
        "WS_PORT": str(port), "WS_TOKEN_SECRET": SECRET,
        "PROJECT_DIR": str(proj), "HOME": str(tmp_path / "home"),
        "AGENT_MODE": "mock", "PYTHONPATH": str(SERVER_ROOT),
        **extra_env,
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.sandbox_server"], env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8",
    )
    # Generous budget, not a retry (PR #1759 precedent).  Bounds a server
    # that prints without ever printing "listening" — not one that goes
    # silent: readline() blocks, and stderr=STDOUT holds the pipe open, so
    # a silent child hangs past the budget with no EOF to break the read.
    budget, t0 = 60, time.time()
    deadline = t0 + budget
    while time.time() < deadline:
        line = proc.stdout.readline()
        if "listening" in line:
            break
        if proc.poll() is not None:
            raise RuntimeError("server died:\n" + proc.stdout.read())
    else:
        proc.kill()
        raise RuntimeError(
            f"server did not print 'listening' within the {budget}s startup budget "
            f"(elapsed {time.time() - t0:.1f}s)"
        )
    yield port, proj
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


async def _drive(port, proj):
    # bad token → connection rejected (closed at/after handshake)
    try:
        bad = await websockets.connect(f"ws://127.0.0.1:{port}/?token=bad", open_timeout=10)
        await asyncio.wait_for(bad.recv(), 5)
        raise AssertionError("bad token was not rejected")
    except (websockets.ConnectionClosed, websockets.InvalidStatus, OSError):
        pass  # expected

    ws = await websockets.connect(f"ws://127.0.0.1:{port}/?token={_token()}", open_timeout=10)
    try:
        first = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert first["type"] == "status"  # snapshot starts with status:ready

        await ws.send(json.dumps({"type": "user_msg", "text": "let's start a new project"}))
        budget, t0 = 120, time.time()  # generous budget, not a retry (PR #1759 precedent)
        texts, saw_done, end = [], False, t0 + budget
        while time.time() < end and not saw_done:
            try:
                m = json.loads(await asyncio.wait_for(
                    ws.recv(), max(0.0, end - time.time())
                ))
            except asyncio.TimeoutError:
                break
            except websockets.ConnectionClosed as e:
                raise AssertionError(
                    f"socket closed mid-turn after {time.time() - t0:.1f}s: {e}"
                )
            ev = m.get("event", {}) if m.get("type") == "agent_event" else {}
            if ev.get("kind") == "text":
                texts.append(ev["text"])
            if ev.get("kind") == "turn_done":
                saw_done = True
        assert saw_done, (
            f"no turn_done within {budget}s turn budget "
            f"(elapsed {time.time() - t0:.1f}s)"
        )
        assert " ".join(texts).strip(), "agent produced no text"
        # /project watch: write a new file → expect a research_updated delta
        (proj / "research.json").write_text(json.dumps({"project": {"id": "p"}}), encoding="utf-8")
        budget, t0 = 30, time.time()  # generous budget, not a retry (PR #1759 precedent)
        got_delta = False
        end = t0 + budget
        while time.time() < end and not got_delta:
            try:
                m = json.loads(await asyncio.wait_for(
                    ws.recv(), max(0.0, end - time.time())
                ))
                if m.get("type") == "research_updated":
                    got_delta = True
            except (asyncio.TimeoutError, websockets.ConnectionClosed):
                break
        assert got_delta, (
            f"watch did not emit research_updated within {budget}s watch budget "
            f"(elapsed {time.time() - t0:.1f}s)"
        )
    finally:
        await ws.close()


def test_ws_server_token_chat_and_watch(ws_server):
    port, proj = ws_server
    asyncio.run(_drive(port, proj))


def test_local_connect_unified_path():
    """C5: /connect is provider-agnostic. For LocalProvider it starts the
    in-sandbox WS server subprocess and returns ws://127.0.0.1:<port> + a token;
    deleting the session kills the server."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        created = client.post("/api/sessions", json={}).json()
        sid, sbid = created["id"], created["sandbox_id"]
        r = client.post(f"/api/sessions/{sid}/connect").json()
        assert r["wssUrl"].startswith("ws://127.0.0.1:") and r["token"]
        assert app.state.provider.live_server(sbid) is not None  # WS server started
        client.delete(f"/api/sessions/{sid}")
        assert app.state.provider.live_server(sbid) is None  # delete killed it


def test_local_connect_waits_until_ws_server_accepting():
    """Regression (WS startup race): /connect must NOT return the wssUrl until the
    in-sandbox WS server is actually accepting connections. The server's cold-start
    bind (~40ms) is slower than the local /connect round trip, so without the
    readiness gate the browser's single (no-retry) WebSocket attempt arrives first,
    is refused, and the turn hangs forever on "working…". Assert an IMMEDIATE
    connect — no retry, no sleep — to the returned port succeeds."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={}).json()["id"]
        r = client.post(f"/api/sessions/{sid}/connect").json()
        port = int(r["wssUrl"].rsplit(":", 1)[1])
        # The gate guarantees readiness: a bare TCP connect succeeds on the first
        # try. Without the gate this is refused (the bug).
        try:
            conn = socket.create_connection(("127.0.0.1", port), timeout=1.0)
            conn.close()
        except ConnectionRefusedError:
            raise AssertionError(
                "TCP connect refused — the readiness gate in expose_port "
                "timed out or its result was discarded"
            )
        except socket.timeout:
            raise AssertionError(
                "TCP connect timed out (1.0s) — the WS server bound the port "
                "but is not completing the handshake"
            )
        client.delete(f"/api/sessions/{sid}")


def test_token_mint_verify_roundtrip(monkeypatch):
    """The CP mints with the derived per-sandbox secret; the sandbox verifies with
    the same secret. Guards the token format match across the boundary."""
    import app.sandbox_server as ss
    import app.ws_token as wt

    sid = "sbx_demo"
    monkeypatch.setattr(ss, "SECRET", wt.sandbox_secret(sid))
    assert ss.verify_token(wt.mint_token(sid)) is True
    assert ss.verify_token("bogus") is False
    assert ss.verify_token(f"1.{'a' * 64}") is False  # expired exp=1
    # a different sandbox's secret must not verify this token
    monkeypatch.setattr(ss, "SECRET", wt.sandbox_secret("sbx_other"))
    assert ss.verify_token(wt.mint_token(sid)) is False


def test_token_ttl_outlives_the_sandbox_timeout():
    """Regression guard for the alpha hang: the handshake TTL and the sandbox
    running-timeout both start at the same /connect, so when they were EQUAL
    (3600 == 3600) the pause that forced a reconnect expired the token needed to
    make one. Every retry then failed `bad/expired token` and the UI spun on a
    turn whose end it could never receive. The client re-mints per attempt now,
    but keep the margin so an equal-clocks regression can't recreate a lockout
    that no retry can escape.
    """
    from app.sandbox.e2b import _RUNNING_TIMEOUT_S
    from app.ws_token import DEFAULT_TTL_SECONDS

    assert DEFAULT_TTL_SECONDS > _RUNNING_TIMEOUT_S


def test_reconnect_is_told_when_a_turn_is_still_running(monkeypatch):
    """The fix for the 2026-07-20 "no working indicator" report: busy is otherwise
    local to the browser that hit Send, so a reload mid-turn shows idle while the
    agent works. The Hub outlives the connection and announces an in-flight turn
    to every (re)connect; when nothing is running it stays quiet.
    """
    import app.sandbox_server as ss

    monkeypatch.setattr(ss, "SECRET", "")  # auth disabled → handshake passes

    sent: list[dict] = []

    class FakeReq:
        path = "/?token=x"

    class FakeWS:
        request = FakeReq()

        async def send(self, payload):
            sent.append(json.loads(payload))

        async def close(self, *a):
            pass

        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration  # no client→server messages; connection ends

    async def noop(*a, **k):
        pass

    def states():
        return [m.get("state") for m in sent if m.get("type") == "status"]

    hub = ss.Hub()
    hub._turn_active = True
    monkeypatch.setattr(hub, "ensure_started", noop)
    monkeypatch.setattr(hub, "send_snapshot", noop)
    asyncio.run(hub.handle(FakeWS()))
    assert "chat_ready" in states() and "turn_active" in states()

    sent.clear()
    idle = ss.Hub()  # nothing running
    monkeypatch.setattr(idle, "ensure_started", noop)
    monkeypatch.setattr(idle, "send_snapshot", noop)
    asyncio.run(idle.handle(FakeWS()))
    assert "chat_ready" in states() and "turn_active" not in states()


def test_turn_active_clears_when_the_turn_finishes():
    """turn_done in the agent stream ends the in-flight state, so a reconnect
    after the turn completes is not falsely told a turn is running."""
    import app.sandbox_server as ss

    class FakeProc:
        def poll(self):
            return 0

    hub = ss.Hub()
    hub._turn_active = True
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait(json.dumps({"type": "agent_event", "event": {"kind": "turn_done"}}))
    q.put_nowait(None)
    # proc is not hub._proc, so the crash path is skipped.
    asyncio.run(hub._pump(q, FakeProc()))
    assert hub._turn_active is False


def test_rejection_log_is_throttled_to_protect_the_timeline():
    """A token-locked client reconnects in a tight loop; without throttling its
    rejections fill the 20 KB /logs window and evict the agent activity timeline
    (the 2026-07-20 failure). At most one line per interval, with a count of the
    ones it stands in for.
    """
    import app.sandbox_server as ss

    hub = ss.Hub()
    t = 1000.0
    # First rejection always logs, reporting itself.
    assert hub._note_rejection(t) == 1
    # A flood inside the window is suppressed...
    for _ in range(50):
        t += 0.1
        assert hub._note_rejection(t) is None
    # ...then the next rejection past the window reports every one it swallowed.
    assert hub._note_rejection(t + ss._REJECT_LOG_INTERVAL) == 51


@pytest.mark.parametrize("ws_server", [{"WS_HEARTBEAT_INTERVAL": "0.5"}], indirect=True)
def test_heartbeat_keeps_an_idle_socket_warm(ws_server):
    """A silent turn must still put frames on the wire — the edge proxy in front
    of the sandbox drops a socket it reads as idle, which is how a long
    record-extraction subagent lost its connection mid-turn. Pings must NOT enter
    the replay transcript, or they would evict real events from it.
    """
    port, _ = ws_server

    async def drive():
        ws = await websockets.connect(
            f"ws://127.0.0.1:{port}/?token={_token()}", open_timeout=10
        )
        try:
            # Never send a user_msg: the socket stays idle exactly as it does
            # during a long turn that emits nothing.
            budget, t0 = 30, time.time()  # generous budget, not a retry (PR #1759 precedent)
            pings, end = 0, t0 + budget
            while time.time() < end and pings < 2:
                try:
                    m = json.loads(await asyncio.wait_for(
                        ws.recv(), max(0.0, end - time.time())
                    ))
                except asyncio.TimeoutError:
                    break
                if m.get("type") == "ping":
                    pings += 1
            assert pings >= 2, (
                f"no repeating keepalive within {budget}s heartbeat budget "
                f"(elapsed {time.time() - t0:.1f}s)"
            )
        finally:
            await ws.close()

        # Reconnect: the replayed transcript must carry no pings.
        ws2 = await websockets.connect(
            f"ws://127.0.0.1:{port}/?token={_token()}", open_timeout=10
        )
        try:
            budget, t0 = 2, time.time()  # replay is pre-buffered; 2s is generous
            replayed, end = [], t0 + budget
            while time.time() < end:
                try:
                    replayed.append(json.loads(await asyncio.wait_for(
                        ws2.recv(), max(0.0, end - time.time())
                    )))
                except (asyncio.TimeoutError, websockets.ConnectionClosed):
                    break
            # Live pings arrive during the drain too; only the replay is at issue,
            # and it is delivered before chat_ready.
            before_ready = []
            for m in replayed:
                if m.get("type") == "status" and m.get("state") == "chat_ready":
                    break
                before_ready.append(m)
            assert not [m for m in before_ready if m.get("type") == "ping"], (
                f"keepalive frames leaked into the replay transcript "
                f"(drained {budget}s, elapsed {time.time() - t0:.1f}s)"
            )
        finally:
            await ws2.close()

    asyncio.run(drive())


# --- #1126: the two sandbox_server strings a user actually reads ------------
#
# Both reach the browser, and `ChatPane` renders the `chat_error` status as
# `Chat unavailable: ${message}` — so a bare `str(exc)` there put a raw OSError
# in front of a paying user, which is the leak #1126 closes. Review of #1724
# found both edits untested: reverting either left all 200 tests green.


def _broadcasts(hub) -> list[dict]:
    """Capture what the Hub would send, instead of opening a socket."""
    sent: list[dict] = []

    async def fake_broadcast(msg):
        sent.append(msg)

    hub.broadcast = fake_broadcast
    return sent


def test_a_spawn_failure_does_not_put_the_raw_exception_in_front_of_the_user(monkeypatch):
    """`ChatPane` prefixes this with "Chat unavailable: ", so whatever is here is
    read verbatim by the user.

    `monkeypatch`, not `importlib.reload`: reloading the module rebinds the
    objects other modules already hold, which leaked across test files and
    reddened six unrelated tests when two of them ran in one session.
    """
    import app.sandbox_server as ss
    from app.agent.errors import MISCONFIGURED, UNEXPECTED

    hub = ss.Hub()
    sent = _broadcasts(hub)

    def boom(*a, **kw):
        raise OSError(13, "Permission denied: '/usr/bin/python3.12'")

    monkeypatch.setattr(ss.subprocess, "Popen", boom)
    asyncio.run(hub.ensure_started())

    statuses = [m for m in sent if m.get("type") == "status"]
    assert statuses, "a failed spawn told the user nothing"
    message = statuses[-1]["message"]
    assert message in (MISCONFIGURED, UNEXPECTED), (
        f"raw exception text reached the user: {message!r}"
    )
    assert "Permission denied" not in message
    assert "/usr/bin" not in message


def test_an_agent_exit_keeps_the_retry_framing_and_drops_the_exit_code():
    """The error event and the chat_error status are ONE bubble to the reader.

    The retry framing is kept — a crashed runner genuinely does respawn on the
    next message (`send_input`) — but the raw exit code moves to the operator
    log, and the two must not contradict each other.
    """
    import app.sandbox_server as ss

    class FakeProc:
        def poll(self):
            return -9

    hub = ss.Hub()
    proc = FakeProc()
    hub._proc = proc
    hub._turn_active = True
    sent = _broadcasts(hub)

    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait(None)
    asyncio.run(hub._pump(q, proc))

    errors = [
        m for m in sent
        if m.get("type") == "agent_event" and m["event"].get("kind") == "error"
    ]
    assert errors, "the agent died and the user was told nothing"
    text = errors[-1]["event"]["text"]
    assert "-9" not in text and "code" not in text.lower(), (
        f"the raw exit code reached the user: {text!r}"
    )
    assert "send another message" in text.lower(), (
        "the retry framing was lost — a crashed runner does respawn on the next message"
    )

    statuses = [m for m in sent if m.get("type") == "status"]
    assert statuses and "-9" not in statuses[-1]["message"]
    # The turn is unstuck either way, or the UI spins forever.
    assert hub._turn_active is False


def test_a_crashed_runners_synthetic_turn_done_enters_history():
    """The synthetic `turn_done` on agent exit must be RECORDED, not only
    broadcast, or every later reconnect replays an unbalanced `turn_start`.

    Two facts composed into a wedge that persists rather than self-corrects:

    * `turn_start` is not in `TRANSIENT_KINDS`, so it IS recorded and replayed.
    * `_history` is never cleared, only trimmed at `_HISTORY_MAX` (1000). And
      `_record` trims from the FRONT, so a `turn_start` is always evicted before
      its own `turn_done`. The crash path was the only producer of an orphan
      `turn_start`, and it was the one path that skipped `_record`.

    `broadcast` does not touch `_record`, which is why "the user saw it" was not
    the same as "history has it". The consumer this actively broke was the
    public REST API's replay drain, removed with `/v1`; what remains is the
    invariant - a replayed transcript pairs its starts and dones, and this test
    is what holds it.
    """
    import app.sandbox_server as ss

    class FakeProc:
        def poll(self):
            return -9

    hub = ss.Hub()
    proc = FakeProc()
    hub._proc = proc
    hub._turn_active = True
    sent = _broadcasts(hub)

    # A turn was in flight when the runner died: its turn_start is in history.
    start = {"type": "agent_event", "event": {"kind": "turn_start", "queued": True}}
    hub._record(start)

    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait(None)
    asyncio.run(hub._pump(q, proc))

    kinds = [
        m["event"].get("kind") for m in hub._history
        if m.get("type") == "agent_event"
    ]
    assert kinds.count("turn_start") == kinds.count("turn_done"), (
        f"history is unbalanced: {kinds}. A reconnect replays a turn_start whose "
        f"turn_done exists nowhere, and nothing later in the transcript closes "
        f"it."
    )
    # And the user still saw it: recording must be in ADDITION to broadcasting.
    assert any(
        m.get("type") == "agent_event" and m["event"].get("kind") == "turn_done"
        for m in sent
    ), "the terminal frame stopped reaching live clients"


def test_a_queued_turn_start_holds_the_busy_gate_across_the_backlog():
    """`turn_done` fires once per TURN, not once per backlog.

    Clearing `_turn_active` on it left the UI idle while messages were still
    queued, and the client's busy gate is what is supposed to stop a backlog
    forming in the first place - so a user who saw idle would keep sending.
    A queued turn's `turn_start` re-arms the gate. Issue #2062, review round 1.

    ASSERTS THE BROADCAST, NOT THE FLAG, and that is the whole point of round 3.
    `_turn_active` is sent to a client only at CONNECT time, so an
    already-connected client - the one that built the backlog - never learns the
    gate was re-armed. It gets the raw `turn_start` frame, and ChatPane has no
    handler for that kind. So `assert hub._turn_active is True` passed while the
    UI sat idle for the whole backlog: the flag was true and the screen was
    wrong. Only a `turn_active` status frame on the wire reaches that client.
    """
    import app.sandbox_server as ss

    class FakeProc:
        def poll(self):
            return 0

    def ev(kind, **extra):
        return json.dumps({"type": "agent_event", "event": {"kind": kind, **extra}})

    hub = ss.Hub()
    hub._turn_active = True
    sent = _broadcasts(hub)
    q: asyncio.Queue = asyncio.Queue()
    # Turn one ends, then a queued turn announces itself and ends.
    q.put_nowait(ev("turn_done"))
    q.put_nowait(ev("turn_start", queued=True))
    q.put_nowait(None)
    asyncio.run(hub._pump(q, FakeProc()))

    assert hub._turn_active is True, (
        "the queued turn's turn_start did not re-arm the busy gate server-side"
    )
    busy = [
        m for m in sent
        if m.get("type") == "status" and m.get("state") == "turn_active"
    ]
    assert busy, (
        "the gate was re-armed server-side but nothing went out on the wire, so "
        "an already-connected client stays idle for the whole backlog. This is "
        "the assertion the flag check could not make."
    )


def test_the_gate_still_clears_once_the_last_queued_turn_is_done():
    """The converse, so the arm above cannot be satisfied by never clearing."""
    import app.sandbox_server as ss

    class FakeProc:
        def poll(self):
            return 0

    def ev(kind, **extra):
        return json.dumps({"type": "agent_event", "event": {"kind": kind, **extra}})

    hub = ss.Hub()
    hub._turn_active = True
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait(ev("turn_done"))
    q.put_nowait(ev("turn_start", queued=True))
    q.put_nowait(ev("turn_done"))
    q.put_nowait(None)
    asyncio.run(hub._pump(q, FakeProc()))
    assert hub._turn_active is False


def test_an_auto_continue_event_is_broadcast_and_replayed():
    """Regression pin for issue #2653 (green today by construction: `_pump`
    records every kind not in TRANSIENT_KINDS). Its red case is someone adding
    `auto_continue` to TRANSIENT_KINDS: the web folds that event as the bubble
    boundary between auto-continued steps, so a reconnect that did not replay
    it would rebuild every step of a chain into one bubble."""
    import app.sandbox_server as ss

    class FakeProc:
        def poll(self):
            return None

    hub = ss.Hub()
    hub._proc = FakeProc()
    sent = _broadcasts(hub)

    q: asyncio.Queue = asyncio.Queue()
    for ev in (
        {"kind": "text", "text": "Next: choose the first research question. Continue?"},
        {"kind": "turn_done"},
        {"kind": "auto_continue", "text": "Yes.", "step": 1, "max_steps": 30},
        {"kind": "turn_start", "queued": True},
        {"kind": "auto_continue_paused", "reason": "budget", "step": 30, "max_steps": 30},
    ):
        q.put_nowait(json.dumps({"type": "agent_event", "event": ev}))
    q.put_nowait(None)
    asyncio.run(hub._pump(q, hub._proc))

    kinds = [m["event"]["kind"] for m in hub._history if m.get("type") == "agent_event"]
    assert "auto_continue" in kinds and "auto_continue_paused" in kinds, kinds
    assert any(m.get("type") == "agent_event" and m["event"].get("kind") == "auto_continue" for m in sent)
    # And the synthetic turn re-arms the busy gate exactly as a queued user turn does.
    assert {"type": "status", "state": "turn_active"} in sent
