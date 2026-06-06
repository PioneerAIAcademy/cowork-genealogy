"""Session lifecycle over the real REST surface + LocalProvider:
dev-login (with allowlist gate) → create sample session → list → resume →
delete. Also asserts the sample seed lands real project files on the sandbox FS.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_unauthenticated_is_rejected():
    with TestClient(app) as client:
        assert client.get("/api/sessions").status_code == 401


def test_allowlist_blocks_unknown_email():
    with TestClient(app) as client:
        r = client.post("/auth/dev-login", json={"email": "stranger@example.com"})
        assert r.status_code == 403


def test_session_lifecycle_and_sample_seed():
    with TestClient(app) as client:
        # Login (allowlisted).
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

        # It shows up in the list.
        r = client.get("/api/sessions")
        assert r.status_code == 200
        assert [p["id"] for p in r.json()] == [sid]

        # The sample seed actually wrote research.json into the sandbox FS.
        sandbox_id = proj["sandbox_id"]
        provider = app.state.provider
        sb = provider._root(sandbox_id) / "project" / "research.json"  # LocalProvider
        assert sb.is_file()

        # Resume + delete.
        assert client.post(f"/api/sessions/{sid}/resume").status_code == 200
        assert client.delete(f"/api/sessions/{sid}").status_code == 200
        assert client.get("/api/sessions").json() == []
