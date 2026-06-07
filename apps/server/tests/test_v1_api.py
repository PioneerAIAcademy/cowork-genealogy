"""Public /v1 REST API over the real LocalProvider + the in-sandbox WS server +
the mock agent. Mirrors test_sandbox_server.py: a turn drives a real subprocess
WS server, no E2B/Anthropic needed.

Keys come from conftest's API_KEYS:
  sk_test  → api-bot@example.com   (NOT on the allowlist — operator-granted)
  sk_other → other-bot@example.com (a second client, for isolation)
"""
import json
from datetime import timedelta

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
    (proj / "research.json").write_text('{"project":{"id":"seed"}}')

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
