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
    )
    deadline = time.time() + 20
    while time.time() < deadline:
        line = proc.stdout.readline()
        if "listening" in line:
            break
        if proc.poll() is not None:
            raise RuntimeError("server died:\n" + proc.stdout.read())
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
        texts, saw_done, end = [], False, time.time() + 45
        while time.time() < end and not saw_done:
            m = json.loads(await asyncio.wait_for(ws.recv(), 45))
            ev = m.get("event", {}) if m.get("type") == "agent_event" else {}
            if ev.get("kind") == "text":
                texts.append(ev["text"])
            if ev.get("kind") == "turn_done":
                saw_done = True
        assert saw_done, "no turn_done"
        assert " ".join(texts).strip(), "agent produced no text"
        # /project watch: write a new file → expect a research_updated delta
        (proj / "research.json").write_text(json.dumps({"project": {"id": "p"}}))
        got_delta = False
        end = time.time() + 6
        while time.time() < end and not got_delta:
            try:
                m = json.loads(await asyncio.wait_for(ws.recv(), 6))
                if m.get("type") == "research_updated":
                    got_delta = True
            except (asyncio.TimeoutError, websockets.ConnectionClosed):
                break
        assert got_delta, "watch did not emit research_updated for a new file"
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
        conn = socket.create_connection(("127.0.0.1", port), timeout=1.0)
        conn.close()
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
            pings, end = 0, time.time() + 6
            while time.time() < end and pings < 2:
                m = json.loads(await asyncio.wait_for(ws.recv(), 6))
                if m.get("type") == "ping":
                    pings += 1
            assert pings >= 2, "no repeating keepalive on an idle socket"
        finally:
            await ws.close()

        # Reconnect: the replayed transcript must carry no pings.
        ws2 = await websockets.connect(
            f"ws://127.0.0.1:{port}/?token={_token()}", open_timeout=10
        )
        try:
            replayed, end = [], time.time() + 2
            while time.time() < end:
                try:
                    replayed.append(json.loads(await asyncio.wait_for(ws2.recv(), 1)))
                except (asyncio.TimeoutError, websockets.ConnectionClosed):
                    break
            # Live pings arrive during the drain too; only the replay is at issue,
            # and it is delivered before chat_ready.
            before_ready = []
            for m in replayed:
                if m.get("type") == "status" and m.get("state") == "chat_ready":
                    break
                before_ready.append(m)
            assert not [m for m in before_ready if m.get("type") == "ping"], \
                "keepalive frames leaked into the replay transcript"
        finally:
            await ws2.close()

    asyncio.run(drive())
