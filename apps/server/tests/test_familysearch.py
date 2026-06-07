"""M4 FamilySearch token injection (option a): dev-connect writes a mock token
to the sandbox FS, and status reflects it."""
from fastapi.testclient import TestClient

from app.main import app


def test_dev_connect_writes_token_and_status_reflects_it():
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={}).json()["id"]

        assert client.get(f"/familysearch/status?sessionId={sid}").json()["connected"] is False

        r = client.post(f"/familysearch/dev-connect?sessionId={sid}")
        assert r.status_code == 200
        assert r.json() == {"connected": True, "mock": True, "real": False}

        status = client.get(f"/familysearch/status?sessionId={sid}").json()
        assert status["connected"] is True
        assert status["mock"] is True
        assert status["real"] is False  # FS web OAuth not configured in tests

        client.delete(f"/api/sessions/{sid}")


def test_login_501_when_unconfigured():
    """With FAMILYSEARCH_WEB_ENABLED=false (test default), the real /login is
    gated off so dev-connect stays the working path."""
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={}).json()["id"]
        r = client.get(f"/familysearch/login?sessionId={sid}", follow_redirects=False)
        assert r.status_code == 501
        # Google is unconfigured in tests → dev-login offered, not Google-only.
        cfg = client.get("/auth/config").json()
        assert cfg["devLogin"] is True and cfg["google"] is False
        client.delete(f"/api/sessions/{sid}")
