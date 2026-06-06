"""M4 chat path: the control plane launches the in-sandbox agent_runner
(subprocess), connects to its WebSocket, and proxies browser <-> agent. This is
the spec's WS-port round-trip — the one unproven path — so prove it end to end:
a user_msg reaches the mock agent and its streamed reply comes back.
"""
from fastapi.testclient import TestClient

from app.main import app


def _collect_until(ws, predicate, limit=60):
    msgs = []
    for _ in range(limit):
        m = ws.receive_json()
        msgs.append(m)
        if predicate(m):
            return msgs
    return msgs


def test_chat_proxy_roundtrip_and_onboarding():
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={}).json()["id"]  # new, not sample

        with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
            # The agent subprocess starts + the proxy connects.
            msgs = _collect_until(
                ws, lambda m: m.get("type") == "status" and m.get("state") == "chat_ready"
            )
            assert any(m.get("state") == "chat_ready" for m in msgs), msgs

            # First turn: the mock agent greets and asks for experience level.
            ws.send_json({"type": "user_msg", "text": "let's start"})
            texts = []
            for _ in range(40):
                m = ws.receive_json()
                if m.get("type") == "agent_event":
                    ev = m["event"]
                    if ev.get("kind") == "text":
                        texts.append(ev["text"])
                    if ev.get("kind") == "turn_done":
                        break
            assert any("experience" in t.lower() for t in texts), texts
