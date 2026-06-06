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
        assert r.json() == {"connected": True, "mock": True}

        status = client.get(f"/familysearch/status?sessionId={sid}").json()
        assert status["connected"] is True
        assert status["mock"] is True

        client.delete(f"/api/sessions/{sid}")
