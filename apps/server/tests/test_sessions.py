"""Session lifecycle over the real REST surface + LocalProvider:
dev-login (local, no allowlist) → create sample session → list → resume →
delete. Also asserts the sample seed lands real project files on the sandbox FS.
"""
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def test_unauthenticated_is_rejected():
    with TestClient(app) as client:
        assert client.get("/api/sessions").status_code == 401


def test_dev_login_accepts_any_email_locally():
    # No allowlist on the local dev-login path — any email signs in (the prod gate
    # is the Google callback's allowlist, exercised separately).
    with TestClient(app) as client:
        r = client.post("/auth/dev-login", json={"email": "stranger@example.com"})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "stranger@example.com"


def test_dev_login_blank_email_defaults():
    with TestClient(app) as client:
        r = client.post("/auth/dev-login", json={})  # email omitted
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "dev@localhost"


def test_dev_login_refused_when_deployed(monkeypatch):
    # Backstop: on an https (deployed) host, dev-login is off even if Google was
    # never configured — so a misconfigured deploy can't become open signup.
    monkeypatch.setattr(get_settings(), "public_url", "https://example.com")
    with TestClient(app) as client:
        assert client.get("/auth/config").json()["devLogin"] is False
        r = client.post("/auth/dev-login", json={"email": "anyone@example.com"})
        assert r.status_code == 403


def test_session_lifecycle_and_sample_seed():
    with TestClient(app) as client:
        # Login (any email; no allowlist locally).
        r = client.post("/auth/dev-login", json={"email": "tester@example.com"})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "tester@example.com"

        # /auth/me works with the cookie.
        assert client.get("/auth/me").status_code == 200

        # Create a sample-seeded session.
        r = client.post("/api/sessions", json={"sample": True})
        assert r.status_code == 200, r.text
        proj = r.json()
        sid = proj["id"]
        assert proj["title"] == "Sample research project"

        # It shows up in the list (the DB is shared across tests, so other
        # sessions may exist — just assert ours is present).
        r = client.get("/api/sessions")
        assert r.status_code == 200
        assert sid in [p["id"] for p in r.json()]

        # The sample seed actually wrote research.json into the sandbox FS.
        sandbox_id = proj["sandbox_id"]
        provider = app.state.provider
        sb = provider._root(sandbox_id) / "project" / "research.json"  # LocalProvider
        assert sb.is_file()

        # Resume + delete.
        assert client.post(f"/api/sessions/{sid}/resume").status_code == 200
        assert client.delete(f"/api/sessions/{sid}").status_code == 200
        assert sid not in [p["id"] for p in client.get("/api/sessions").json()]
