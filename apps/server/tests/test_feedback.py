"""M5 feedback: context lists project files; submit bundles a zip and returns
a filename."""
from fastapi.testclient import TestClient

from app.main import app


def test_feedback_context_and_submit():
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={"sample": True}).json()["id"]

        ctx = client.get(f"/api/feedback/context?sessionId={sid}").json()
        rels = [f["relativePath"] for f in ctx["files"]]
        assert "research.json" in rels

        r = client.post("/api/feedback", json={
            "sessionId": sid, "email": "tester@example.com",
            "userPrompt": "x", "agentDid": "y", "agentShouldHave": "z",
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert r.json()["filename"].endswith(".zip")

        client.delete(f"/api/sessions/{sid}")
