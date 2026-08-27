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
    def __init__(self, body=None):
        self._body = body if body is not None else {"ok": True}

    def raise_for_status(self):  # 2xx
        return None

    def json(self):
        return self._body


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
                "workedAsExpected": True,
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
        # Read from the body, not the False default — proves the field is plumbed.
        assert meta["worked_as_expected"] is True

        client.delete(f"/api/sessions/{sid}")


def test_blank_submission_is_accepted_end_to_end(monkeypatch):
    """The whole point of issue #1919: a report with every text box empty must go
    through. Three other tests here POST to /api/feedback, but all of them send
    populated fields; this is the only one that puts a blank submission through
    request validation, which is where a non-empty requirement would bite.
    """
    captured: dict = {}

    class _FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            captured["envelope"] = json
            return _FakeResp()

    monkeypatch.setattr(fb.httpx, "AsyncClient", _FakeClient)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={"sample": True}).json()["id"]

        # Only the Yes/No answer. No email, no prompt, no description.
        r = client.post(
            "/api/feedback",
            json={"sessionId": sid, "workedAsExpected": False},
        )
        assert r.status_code == 200 and r.json()["ok"] is True

        env = captured["envelope"]
        assert env["email"] == ""
        zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(env["zipBase64"])))
        meta = json.loads(zf.read("_feedback/feedback.json"))
        assert meta["email"] == ""
        assert meta["user_prompt"] == ""
        assert meta["agent_did"] == ""
        # The flag triage reads is still there, which is what keeps a clean report
        # distinguishable from a problem report.
        assert meta["worked_as_expected"] is False

        md = zf.read("FEEDBACK.md").decode("utf-8")
        assert md.count(fb.NOT_PROVIDED) == 3  # From, What I asked, What the agent did

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


# --- living-person redaction (mirrors apps/electron feedback.test.ts) --------
#
# FamilySearch's terms forbid sharing living people's details, and a feedback
# bundle is a capture of a real family. Redaction happens at CAPTURE time, so
# the data never reaches the Drive folder at all.

_TREE = {
    "persons": [
        {
            "id": "P1", "gender": "Male", "living": False,
            "names": [{"id": "n1", "given": "Reuben Spencer", "surname": "Spriggs"}],
            "facts": [{"id": "f1", "type": "Birth", "date": "6 November 1898",
                       "place": "Maddock, ND"}],
        },
        {
            "id": "P2", "gender": "Female", "living": True,
            "ark": "https://familysearch.org/ark:/61903/4:1:SECRET",
            "names": [{"id": "n2", "given": "Jane Marie", "surname": "Spriggs"}],
            "facts": [{"id": "f2", "type": "Birth", "date": "3 March 1985",
                       "place": "Riverside, CA"}],
        },
        # No `living` flag at all — absent is NOT deceased.
        {
            "id": "P3", "gender": "Male",
            "names": [{"id": "n3", "given": "Bobby", "surname": "Spriggs"}],
            "facts": [{"id": "f3", "type": "Birth", "date": "1990"}],
        },
    ],
    "relationships": [
        {"id": "r1", "type": "Couple", "person1": "P1", "person2": "P2",
         "facts": [{"id": "rf1", "type": "Marriage", "date": "12 June 1980",
                    "place": "Reno, NV"}]},
        {"id": "r2", "type": "Couple", "person1": "P1", "person2": "P9",
         "facts": [{"id": "rf2", "type": "Marriage", "date": "1 Jan 1925"}]},
    ],
    "sources": [],
}


def _redact_tree(tree):
    files = [("research.json", b"{}"),
             ("tree.gedcomx.json", json.dumps(tree).encode("utf-8"))]
    out, count = fb._redact_living(files)
    return json.loads(dict(out)["tree.gedcomx.json"]), count, dict(out)


def _person(tree, pid):
    return next(p for p in tree["persons"] if p["id"] == pid)


def test_redact_leaves_explicitly_deceased_person_untouched():
    tree, _, _ = _redact_tree(_TREE)
    p1 = _person(tree, "P1")
    assert p1["names"][0]["given"] == "Reuben Spencer"
    assert len(p1["facts"]) == 1


def test_redact_strips_living_person_name_facts_and_ark():
    tree, count, _ = _redact_tree(_TREE)
    p2 = _person(tree, "P2")
    assert p2["names"][0]["given"] == fb.LIVING_GIVEN
    assert p2["names"][0]["surname"] == "Spriggs"   # kept: FS's own convention
    assert p2["facts"] == []
    assert "ark" not in p2
    assert p2["gender"] == "Female" and p2["living"] is True
    assert count == 2


def test_missing_living_flag_counts_as_living():
    """Absent is not deceased — same rule as the e2e fixture gate."""
    tree, _, _ = _redact_tree(_TREE)
    assert _person(tree, "P3")["names"][0]["given"] == fb.LIVING_GIVEN
    assert _person(tree, "P3")["facts"] == []


def test_redacted_tree_leaks_no_living_name_date_or_ark():
    _, _, files = _redact_tree(_TREE)
    raw = files["tree.gedcomx.json"].decode("utf-8")
    for leak in ("Jane Marie", "Bobby", "3 March 1985", "Riverside, CA", "SECRET"):
        assert leak not in raw
    assert "Reuben Spencer" in raw  # the deceased subject survives


def test_couple_facts_cleared_only_when_an_endpoint_is_living():
    tree, _, _ = _redact_tree(_TREE)
    rel = {r["id"]: r for r in tree["relationships"]}
    assert rel["r1"]["facts"] == []
    assert len(rel["r2"]["facts"]) == 1


def test_person_without_names_gets_a_synthesized_placeholder():
    tree, _, _ = _redact_tree({"persons": [{"id": "P4", "gender": "Female", "living": True}],
                               "relationships": [], "sources": []})
    name = _person(tree, "P4")["names"][0]
    assert name == {"id": "P4-name-1", "given": fb.LIVING_GIVEN,
                    "surname": fb.LIVING_SURNAME_FALLBACK}


def test_other_project_files_are_untouched():
    _, _, files = _redact_tree(_TREE)
    assert files["research.json"] == b"{}"


def test_unparseable_tree_passes_through_rather_than_failing_the_send():
    out, count = fb._redact_living([("tree.gedcomx.json", b"not json")])
    assert dict(out)["tree.gedcomx.json"] == b"not json"
    assert count == 0


# --- endpoint rejection / non-JSON response -----------------------------------

def _markdown_for(user_prompt: str, agent_did: str, email: str = "t@example.com") -> str:
    return fb._feedback_markdown(
        {
            "email": email,
            "userPrompt": user_prompt,
            "agentDid": agent_did,
            "agentShouldHave": "",
            "correctAnswer": "",
            "notes": "",
        },
        "2026-08-26T00:00:00Z",
        "A project",
        False,
        "web 2026-08-26 (abc123)",
        True,
    )


def test_blank_prompt_and_did_render_as_not_provided():
    # Both are optional at the dialog (#1919). A heading with nothing under it
    # reads like the bundler dropped the field; say it was left blank instead.
    md = _markdown_for("", "   ")
    assert md.count(fb.NOT_PROVIDED) == 2
    assert "## What I asked\n\n_(not provided)_" in md
    assert "## What the agent did\n\n_(not provided)_" in md


def test_blank_email_renders_as_not_provided():
    # Email went optional in the same change, so the From bullet can be empty too.
    md = _markdown_for("q", "d", email="")
    assert f"- **From:** {fb.NOT_PROVIDED}" in md


def test_supplied_prompt_and_did_are_untouched():
    md = _markdown_for("Find John Smith.", "It searched 1860 and stopped.")
    assert fb.NOT_PROVIDED not in md
    assert "## What I asked\n\nFind John Smith." in md
    assert "## What the agent did\n\nIt searched 1860 and stopped." in md


def test_rejected_upload_surfaces_as_502(monkeypatch):
    """An {ok:false} 200 from Apps Script must become a 502, not a silent success."""

    class _RejectClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            return _FakeResp(body={"ok": False, "error": "unauthorized"})

    monkeypatch.setattr(fb.httpx, "AsyncClient", _RejectClient)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={"sample": True}).json()["id"]

        r = client.post(
            "/api/feedback",
            json={
                "sessionId": sid, "email": "t@example.com",
                "userPrompt": "x", "agentDid": "y",
            },
        )
        assert r.status_code == 502
        assert "rejected" in r.json()["detail"].lower()

        client.delete(f"/api/sessions/{sid}")


def test_non_json_response_surfaces_as_502(monkeypatch):
    """A non-JSON 200 (e.g. an HTML redirect page) must become a 502."""

    class _HtmlResp:
        def raise_for_status(self):
            return None

        def json(self):
            raise ValueError("No JSON object could be decoded")

    class _HtmlClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            return _HtmlResp()

    monkeypatch.setattr(fb.httpx, "AsyncClient", _HtmlClient)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        sid = client.post("/api/sessions", json={"sample": True}).json()["id"]

        r = client.post(
            "/api/feedback",
            json={
                "sessionId": sid, "email": "t@example.com",
                "userPrompt": "x", "agentDid": "y",
            },
        )
        assert r.status_code == 502
        assert "failed" in r.json()["detail"].lower()

        client.delete(f"/api/sessions/{sid}")
