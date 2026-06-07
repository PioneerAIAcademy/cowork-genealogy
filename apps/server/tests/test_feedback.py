"""Feedback: context lists project files; submit bundles the Electron-compatible
zip and POSTs the {timestamp, email, filename, zipBase64} envelope to the Drive
endpoint (mocked here — no real upload, no local-disk write)."""
import base64
import io
import json
import zipfile

from fastapi.testclient import TestClient

import app.feedback as fb
from app.main import app


class _FakeResp:
    def raise_for_status(self):  # 2xx
        return None


def test_feedback_context_and_drive_upload(monkeypatch):
    captured: dict = {}

    class _FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            captured["url"] = url
            captured["envelope"] = json
            return _FakeResp()

    monkeypatch.setattr(fb.httpx, "AsyncClient", _FakeClient)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={"sample": True}).json()["id"]

        ctx = client.get(f"/api/feedback/context?sessionId={sid}").json()
        assert "research.json" in [f["relativePath"] for f in ctx["files"]]

        r = client.post(
            "/api/feedback",
            json={
                "sessionId": sid, "email": "Tester@Example.com",
                "userPrompt": "x", "agentDid": "y", "agentShouldHave": "z",
            },
        )
        assert r.status_code == 200 and r.json()["ok"] is True

        # The envelope matches the Electron flow and went to the Drive endpoint.
        env = captured["envelope"]
        assert captured["url"].startswith("https://script.google.com/")
        assert set(env) == {"timestamp", "email", "filename", "zipBase64"}
        assert env["email"] == "tester@example.com"  # normalized lowercase
        assert env["filename"].endswith(".zip")

        # The zip has the Electron-compatible structure the triage workflow reads.
        zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(env["zipBase64"])))
        names = set(zf.namelist())
        assert "research.json" in names
        assert "_feedback/feedback.json" in names
        assert "FEEDBACK.md" in names
        meta = json.loads(zf.read("_feedback/feedback.json"))
        assert meta["schema_version"] == 1
        assert meta["platform"] == "web"
        assert meta["user_prompt"] == "x"

        client.delete(f"/api/sessions/{sid}")
