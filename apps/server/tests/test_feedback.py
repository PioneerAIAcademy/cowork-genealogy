"""Feedback: context lists project files; submit bundles the Electron-compatible
zip and POSTs the {timestamp, email, filename, zipBase64} envelope to the Drive
endpoint (mocked here — no real upload, no local-disk write)."""
import asyncio
import base64
import io
import json
import zipfile

from fastapi.testclient import TestClient

import app.feedback as fb
from app.main import app
from app.sandbox.base import PROJECT_DIR, DirEntry


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


class _FakeSandbox:
    """Minimal Sandbox stub backed by an in-memory {path: bytes} map."""

    def __init__(self, files: dict[str, bytes]):
        self._files = files

    async def read_file(self, path):
        return self._files.get(path)

    async def list_dir(self, path):
        prefix = path.rstrip("/") + "/"
        seen, out = set(), []
        for p in self._files:
            if not p.startswith(prefix):
                continue
            name = p[len(prefix):].split("/", 1)[0]
            if name in seen:
                continue
            seen.add(name)
            is_dir = "/" in p[len(prefix):]
            out.append(DirEntry(name=name, path=prefix + name, is_dir=is_dir))
        return out

    async def file_mtime(self, path):
        return 1.0 if path in self._files else None


def test_session_log_keeps_thinking_and_filters_non_conversation():
    sid = "abc-123"
    lines = [
        {"type": "summary", "summary": "ignored"},  # dropped: non-conversation
        {"type": "user", "cwd": "/project", "message": {"content": "find birth"}},
        {"type": "assistant", "cwd": "/project", "message": {"content": [
            {"type": "thinking", "thinking": "REASONING-KEPT"},
            {"type": "text", "text": "Searching..."},
            {"type": "tool_use", "name": "record_search", "input": {"surname": "Quass"}},
        ]}},
        {"type": "assistant", "cwd": "/other", "message": {"content": [
            {"type": "text", "text": "WRONG-CWD"}]}},  # dropped: cwd mismatch
        {"type": "user", "cwd": "/project", "message": {"content": [
            {"type": "tool_result", "content": "result rows"}]}},
    ]
    raw = ("\n".join(json.dumps(x) for x in lines) + "\n").encode("utf-8")
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl": raw,
    })

    out = asyncio.run(fb._session_log(sbx))
    assert out is not None
    text = out.decode("utf-8")
    kept = [json.loads(line) for line in text.splitlines()]

    # Only user/assistant entries scoped to /project survive (3 of 5).
    assert [e["type"] for e in kept] == ["user", "assistant", "user"]
    assert "WRONG-CWD" not in text  # cwd-mismatch entry dropped
    assert "summary" not in {e.get("type") for e in kept}
    # Thinking is retained (the whole point of this change).
    assert "REASONING-KEPT" in text


def test_session_log_falls_back_to_newest_jsonl_without_agent_session():
    raw = (json.dumps({"type": "user", "cwd": "/project",
                       "message": {"content": "hi"}}) + "\n").encode("utf-8")
    sbx = _FakeSandbox({f"{fb._CLAUDE_PROJECTS_DIR}/only-session.jsonl": raw})
    out = asyncio.run(fb._session_log(sbx))
    assert out is not None and b'"type": "user"' in out


def test_session_log_none_when_no_transcript():
    assert asyncio.run(fb._session_log(_FakeSandbox({}))) is None
