"""Phase 2: the Ably-shaped server flow, exercised end-to-end against the
in-process MockRealtime (no Ably account). Token minting + /connect + /message →
the agent's reply is published to the per-session channel. Also checks token
auth/ownership."""
import time

from fastapi.testclient import TestClient

from app.main import app
from app.realtime.mock import MockRealtime


def test_token_endpoint_auth_and_ownership():
    with TestClient(app) as client:
        # no cookie → 401
        assert client.get("/api/realtime/token?sessionId=prj_x").status_code == 401
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        # owned session → token; unowned → 404
        sid = client.post("/api/sessions", json={}).json()["id"]
        tok = client.get(f"/api/realtime/token?sessionId={sid}")
        assert tok.status_code == 200
        assert tok.json()["channel"] == f"session:{sid}"
        assert client.get("/api/realtime/token?sessionId=prj_nope").status_code == 404
        client.delete(f"/api/sessions/{sid}")


def test_ably_flow_publishes_agent_reply_to_channel():
    with TestClient(app) as client:
        # Swap in the mock realtime backend + watch its channel.
        mock = MockRealtime()
        client.app.state.realtime = mock

        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={}).json()["id"]

        # Token reports the mock backend + the right channel.
        assert client.get(f"/api/realtime/token?sessionId={sid}").json()["backend"] == "ably_mock"

        # Connect makes the session live (spawns agent + watch, publishes status).
        assert client.post(f"/api/sessions/{sid}/connect").status_code == 200

        # Chat input via REST → agent reply streams back over the channel.
        assert client.post(
            f"/api/sessions/{sid}/message", json={"type": "user_msg", "text": "let's start"}
        ).status_code == 202

        texts: list[str] = []
        for _ in range(50):  # up to ~5s for the mock agent turn
            for m in mock.published.get(sid, []):
                if m.get("type") == "agent_event" and m.get("event", {}).get("kind") == "text":
                    texts.append(m["event"]["text"])
            if any("experience" in t.lower() for t in texts):
                break
            time.sleep(0.1)

        # Mock agent's onboarding greeting asks for experience level.
        assert any("experience" in t.lower() for t in texts), mock.published.get(sid)
        # And the session published a status frame (ready/chat_ready) on the channel.
        assert any(m.get("type") == "status" for m in mock.published.get(sid, []))

        client.delete(f"/api/sessions/{sid}")
