"""Feedback: context lists project files; submit bundles the Electron-compatible
zip and POSTs the {timestamp, email, filename, zipBase64} envelope to the Drive
endpoint (mocked here — no real upload, no local-disk write)."""
import asyncio
import base64
import re
import io
import json
import zipfile
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.feedback as fb
from app.main import app
from app.sandbox.base import HOME_DIR, PROJECT_DIR, DirEntry


class _FakeResp:
    def __init__(self, body=None):
        self._body = body if body is not None else {"ok": True}

    def raise_for_status(self):  # 2xx
        return None

    def json(self):
        return self._body


def _capture_upload(monkeypatch) -> dict:
    """Swallow the Drive POST and hand back the dict it lands in.

    `captured["envelope"]` is the {timestamp, email, filename, zipBase64} body
    the route would have uploaded.
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
            captured["url"] = url
            captured["envelope"] = json
            return _FakeResp()

    monkeypatch.setattr(fb.httpx, "AsyncClient", _FakeClient)
    return captured


def _zip_of(captured: dict) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(base64.b64decode(captured["envelope"]["zipBase64"])))


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

    def __init__(self, files: dict[str, bytes], mtimes: dict[str, float] | None = None):
        self._files = files
        # Per-path mtimes. A flat constant made the newest-first drop order —
        # the rule that decides which transcript a tester loses — untestable.
        self._mtimes = mtimes or {}

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
        if path not in self._files:
            return None
        return self._mtimes.get(path, 1.0)


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

    out = _parent_log(asyncio.run(fb._session_log(sbx)))
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
    out = _parent_log(asyncio.run(fb._session_log(sbx)))
    assert out is not None and b'"type": "user"' in out


def test_session_log_none_when_no_transcript():
    entries, dropped = asyncio.run(fb._session_log(_FakeSandbox({})))
    assert entries == [] and dropped == []



# --- subagent transcripts (issue #1880) -------------------------------------
#
# A bundle used to carry only the main session's {sid}.jsonl. Two guardrail
# owner arms write from INSIDE a subagent, whose transcript lives one level
# down at {projects_dir}/{sid}/subagents/agent-*.jsonl, so those writes were
# invisible and the arms returned 0 by construction.

PARENT_LOG = "_feedback/session-log.jsonl"


def _parent_log(result) -> bytes | None:
    """The active session's transcript out of `_session_log`'s (entries, dropped)."""
    entries, _dropped = result
    return dict(entries).get(PARENT_LOG)


def _jsonl(*records: dict) -> bytes:
    return ("\n".join(json.dumps(r) for r in records) + "\n").encode("utf-8")


def _turn(cwd: str = PROJECT_DIR, text: str = "hi") -> dict:
    return {"type": "assistant", "cwd": cwd, "message": {"content": [
        {"type": "text", "text": text}]}}


def _meta(tool_use_id: str = "toolu_01", agent_type: str = "proof-conclusion",
          depth: int = 1) -> bytes:
    return json.dumps({
        "agentType": agent_type, "description": "conclude q_001",
        "toolUseId": tool_use_id, "spawnDepth": depth,
    }).encode("utf-8")


def test_session_log_bundles_subagent_transcripts_and_their_meta():
    sid = "sid-live"
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl": _jsonl(_turn(text="PARENT")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-abc.jsonl":
            _jsonl(_turn(text="CHILD")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-abc.meta.json": _meta(),
    })
    entries, dropped = asyncio.run(fb._session_log(sbx))
    names = dict(entries)
    assert PARENT_LOG in names and b"PARENT" in names[PARENT_LOG]
    assert b"CHILD" in names["_feedback/subagents/agent-abc.jsonl"]
    # The meta is what lets the consumer splice rather than append: it names the
    # parent Agent call that spawned this child.
    assert json.loads(names["_feedback/subagents/agent-abc.meta.json"])["toolUseId"] == "toolu_01"
    assert dropped == []


def test_session_log_redacts_api_keys_in_every_member_of_the_set():
    """Before this set existed, redaction sat at `_session_log`'s single return
    (#2175 / #1018 Task 5). The set now has four kinds of member -- active
    parent, grouped parent, subagent transcript, subagent meta -- and a key
    pasted in chat reaches the parent while a subagent handed it reaches the
    child's, so one call site per member is the shape that lets the next member
    ship a key. Mirrors `redacts an API key in every transcript in the set` in
    apps/electron/src/main/__tests__/feedback.test.ts."""
    sid = "sid-live"
    key = "sk-or-v1-" + "a" * 40
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl": _jsonl(_turn(text=f"my key is {key}")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-abc.jsonl":
            _jsonl(_turn(text=f"reusing {key}")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-abc.meta.json": json.dumps({
            "agentType": "proof-conclusion", "description": f"use {key}",
            "toolUseId": "toolu_01", "spawnDepth": 1,
        }).encode("utf-8"),
    })
    entries, dropped = asyncio.run(fb._session_log(sbx))
    assert dropped == []
    assert len(entries) == 3
    for relpath, data in entries:
        assert key.encode("utf-8") not in data, relpath
        assert b"[REDACTED_API_KEY]" in data, relpath


def test_session_log_recovers_subagents_from_a_stale_session_id():
    """The SDK can hand back a new session id on resume and `_remember_session`
    persists it (app/agent/real_agent.py), so the live `.agent_session` can point
    at a session whose subagents dir is empty while the real work sits under the
    OLD id. A single-sid read ships zero subagent transcripts there, which is
    indistinguishable from "this session had no subagents"."""
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": b"sid-new\n",
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-new.jsonl": _jsonl(_turn(text="NEW-PARENT")),
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-old.jsonl": _jsonl(_turn(text="OLD-PARENT")),
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-old/subagents/agent-old.jsonl":
            _jsonl(_turn(text="OLD-CHILD")),
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-old/subagents/agent-old.meta.json": _meta(),
    })
    names = dict(asyncio.run(fb._session_log(sbx))[0])
    assert b"NEW-PARENT" in names[PARENT_LOG]
    # The old session ships as its own group, parent included — a child with no
    # parent in the bundle has no anchor and the consumer must discard it.
    assert b"OLD-CHILD" in names["_feedback/sessions/sid-old/subagents/agent-old.jsonl"]
    assert b"OLD-PARENT" in names["_feedback/sessions/sid-old/session-log.jsonl"]


def test_subagent_transcript_in_a_project_subdirectory_is_kept():
    """A subagent that moved into a subfolder stamps every line with that folder.
    An equality test on cwd drops all of them, the file filters to empty, and it
    is discarded — measured: 1 of 12 local subagent transcripts is this shape."""
    sid = "sid-sub"
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl": _jsonl(_turn(text="PARENT")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-deep.jsonl":
            _jsonl(_turn(cwd=f"{PROJECT_DIR}/results", text="DEEP-CHILD")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-deep.meta.json": _meta(),
    })
    names = dict(asyncio.run(fb._session_log(sbx))[0])
    assert b"DEEP-CHILD" in names["_feedback/subagents/agent-deep.jsonl"]
    # The parent's own scoping is unchanged: a sibling project is still excluded.
    assert b"OUTSIDE" not in names[PARENT_LOG]


def test_a_subagent_transcript_filtered_to_empty_is_named_not_silently_dropped():
    sid = "sid-empty"
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl": _jsonl(_turn(text="PARENT")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-gone.jsonl":
            _jsonl({"type": "summary", "summary": "nothing conversational"}),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-gone.meta.json": _meta(),
    })
    entries, dropped = asyncio.run(fb._session_log(sbx))
    assert "_feedback/subagents/agent-gone.jsonl" not in dict(entries)
    assert any("agent-gone" in d for d in dropped)


def test_session_log_shares_one_budget_and_names_what_it_drops():
    sid = "sid-fat"
    big = _jsonl(*[_turn(text="x" * 400) for _ in range(6)])
    sbx = _FakeSandbox(
        {
            f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl": _jsonl(_turn(text="PARENT")),
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-new.jsonl": big,
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-new.meta.json": _meta(),
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-old.jsonl": big,
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-old.meta.json": _meta(),
        },
        mtimes={
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-new.jsonl": 900.0,
            f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-old.jsonl": 100.0,
        },
    )
    # Room for the parent and exactly one of the two subagent transcripts.
    entries, dropped = asyncio.run(fb._session_log(sbx, cap=len(big) + 200))
    names = dict(entries)
    assert PARENT_LOG in names, "the parent is the routing narrative — it goes first"
    assert "_feedback/subagents/agent-new.jsonl" in names, "newest subagent wins the budget"
    assert "_feedback/subagents/agent-old.jsonl" not in names
    assert any("agent-old" in d for d in dropped), "a silent overflow costs a submission"


def test_transcripts_can_ship_when_the_active_parent_yields_nothing():
    """`hasSessionLog` must mean "the set is non-empty", not "the ACTIVE parent
    exists". The dialog disables its toggle and prints "(none found)" off that
    flag, but the value it submits stays True — a disabled input fires no
    onChange — so the bundle ships whatever the producer collects regardless.
    Parent-only would tell the reporter the opposite of what leaves their
    machine."""
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": b"sid-new\n",
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-new.jsonl":
            _jsonl({"type": "summary", "summary": "active parent filters to nothing"}),
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-old.jsonl": _jsonl(_turn(text="OLD-PARENT")),
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-old/subagents/agent-only.jsonl":
            _jsonl(_turn(text="CHILD")),
        f"{fb._CLAUDE_PROJECTS_DIR}/sid-old/subagents/agent-only.meta.json": _meta(),
    })
    entries, _ = asyncio.run(fb._session_log(sbx))
    names = dict(entries)
    assert PARENT_LOG not in names, "the active parent really did yield nothing"
    assert names, "but the bundle is not empty, so the dialog must not say (none found)"
    assert b"CHILD" in names["_feedback/sessions/sid-old/subagents/agent-only.jsonl"]


def test_a_subagent_with_no_parent_transcript_is_dropped_and_named():
    """Without its parent there is no `Agent` call to anchor to, so the consumer
    can only discard it — shipping it would charge the tester for ballast."""
    sid = "sid-orphan"
    sbx = _FakeSandbox({
        f"{PROJECT_DIR}/.agent_session": (sid + "\n").encode("utf-8"),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}.jsonl":
            _jsonl({"type": "summary", "summary": "filters to nothing"}),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-lost.jsonl":
            _jsonl(_turn(text="CHILD")),
        f"{fb._CLAUDE_PROJECTS_DIR}/{sid}/subagents/agent-lost.meta.json": _meta(),
    })
    entries, dropped = asyncio.run(fb._session_log(sbx))
    assert entries == []
    assert any("agent-lost" in d and "parent" in d for d in dropped)



def test_submitted_zip_carries_subagent_transcripts_and_discloses_their_bytes(monkeypatch):
    """End to end through the real route: the zip contains the subagent
    transcript and its meta, and the size the dialog showed the reporter equals
    the bytes actually written. A number that undercounts means they consented
    to one figure and a larger bundle left their machine."""
    captured = _capture_upload(monkeypatch)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={"sample": True}).json()
        sid = proj["id"]

        # Seed a Claude Code session with one subagent, on the LocalProvider's
        # real filesystem, at the layout the sandbox uses.
        root = app.state.provider._root(proj["sandbox_id"])  # LocalProvider
        projects = root / HOME_DIR.lstrip("/") / ".claude" / "projects" / fb._CLAUDE_PROJECT_SLUG
        subagents = projects / "cc-session" / "subagents"
        subagents.mkdir(parents=True, exist_ok=True)
        (root / PROJECT_DIR.lstrip("/") / ".agent_session").write_text(
            "cc-session", encoding="utf-8"
        )
        (projects / "cc-session.jsonl").write_bytes(_jsonl(_turn(text="PARENT")))
        (subagents / "agent-abc.jsonl").write_bytes(_jsonl(_turn(text="CHILD")))
        (subagents / "agent-abc.meta.json").write_bytes(_meta())

        disclosed = client.get(f"/api/feedback/context?sessionId={sid}").json()

        r = client.post(
            "/api/feedback",
            json={"sessionId": sid, "email": "t@example.com", "userPrompt": "x",
                  "agentDid": "y", "agentShouldHave": "z", "workedAsExpected": False},
        )
        assert r.status_code == 200

        zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(captured["envelope"]["zipBase64"])))
        names = set(zf.namelist())
        assert "_feedback/session-log.jsonl" in names
        assert "_feedback/subagents/agent-abc.jsonl" in names
        assert "_feedback/subagents/agent-abc.meta.json" in names
        assert b"CHILD" in zf.read("_feedback/subagents/agent-abc.jsonl")

        shipped = sum(
            len(zf.read(n)) for n in names
            if n == "_feedback/session-log.jsonl" or n.startswith("_feedback/subagents/")
            or n.startswith("_feedback/sessions/")
        )
        assert disclosed["hasSessionLog"] is True
        assert disclosed["sessionLogSize"] == shipped

        # Present and empty on a healthy bundle. A consumer must be able to tell
        # "nothing was dropped" from "this producer never writes the field".
        payload = json.loads(zf.read("_feedback/feedback.json"))
        assert payload["dropped_transcripts"] == []

        client.delete(f"/api/sessions/{sid}")


def test_a_dropped_transcript_is_named_in_feedback_json_not_only_in_the_markdown(monkeypatch):
    """`dropped_transcripts` is the field a PROGRAM reads. FEEDBACK.md names the
    drops too, but that is prose no consumer opens; the guardrail report reads
    this field and holds every owner arm at "unknown" rather than reporting a 0
    that actually means "we could not see" (issue #1880)."""
    captured = _capture_upload(monkeypatch)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={"sample": True}).json()
        sid = proj["id"]

        root = app.state.provider._root(proj["sandbox_id"])  # LocalProvider
        projects = root / HOME_DIR.lstrip("/") / ".claude" / "projects" / fb._CLAUDE_PROJECT_SLUG
        subagents = projects / "cc-session" / "subagents"
        subagents.mkdir(parents=True, exist_ok=True)
        (root / PROJECT_DIR.lstrip("/") / ".agent_session").write_text(
            "cc-session", encoding="utf-8"
        )
        (projects / "cc-session.jsonl").write_bytes(_jsonl(_turn(text="PARENT")))
        # Conversation-free, so the producer cannot ship it.
        (subagents / "agent-empty.jsonl").write_bytes(
            _jsonl({"type": "summary", "summary": "no turns"})
        )
        (subagents / "agent-empty.meta.json").write_bytes(_meta())

        r = client.post(
            "/api/feedback",
            json={"sessionId": sid, "email": "t@example.com", "userPrompt": "x",
                  "agentDid": "y", "agentShouldHave": "z", "workedAsExpected": False},
        )
        assert r.status_code == 200

        zf = _zip_of(captured)
        assert "_feedback/subagents/agent-empty.jsonl" not in set(zf.namelist())
        dropped = json.loads(zf.read("_feedback/feedback.json"))["dropped_transcripts"]
        assert len(dropped) == 1 and "agent-empty" in dropped[0]
        # And in the prose list a triager reads, so the two never disagree.
        assert "agent-empty" in zf.read("FEEDBACK.md").decode("utf-8")

        client.delete(f"/api/sessions/{sid}")


def test_the_route_does_not_point_a_grouped_only_bundle_at_a_missing_parent_log(monkeypatch):
    """Through the real route, because the bug this guards is at the CALL SITE:
    `_feedback_markdown`'s `session_log` flag means "the set is non-empty", and
    passing that to the sentence that names one specific file sends the triager
    hunting for `_feedback/session-log.jsonl` when the active session filtered to
    nothing and only an older session's group shipped (#1481, #1880)."""
    captured = _capture_upload(monkeypatch)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={"sample": True}).json()
        sid = proj["id"]

        root = app.state.provider._root(proj["sandbox_id"])  # LocalProvider
        projects = root / HOME_DIR.lstrip("/") / ".claude" / "projects" / fb._CLAUDE_PROJECT_SLUG
        old_subagents = projects / "old-session" / "subagents"
        old_subagents.mkdir(parents=True, exist_ok=True)
        (root / PROJECT_DIR.lstrip("/") / ".agent_session").write_text(
            "new-session", encoding="utf-8"
        )
        # The active session exists but carries nothing this project's filter
        # keeps, so no `_feedback/session-log.jsonl` is written.
        (projects / "new-session.jsonl").write_bytes(
            _jsonl({"type": "summary", "summary": "no turns"})
        )
        (projects / "old-session.jsonl").write_bytes(_jsonl(_turn(text="OLD-PARENT")))
        (old_subagents / "agent-x.jsonl").write_bytes(_jsonl(_turn(text="CHILD")))
        (old_subagents / "agent-x.meta.json").write_bytes(_meta())

        r = client.post(
            "/api/feedback",
            json={"sessionId": sid, "email": "t@example.com", "userPrompt": "x",
                  "agentDid": "y", "agentShouldHave": "z", "workedAsExpected": False},
        )
        assert r.status_code == 200

        zf = _zip_of(captured)
        names = set(zf.namelist())
        assert "_feedback/session-log.jsonl" not in names, "the state under test"
        assert "_feedback/sessions/old-session/session-log.jsonl" in names

        md = zf.read("FEEDBACK.md").decode("utf-8")
        assert "## Session log" in md
        assert "See `_feedback/session-log.jsonl`" not in md
        assert "`_feedback/sessions/<session-id>/`" in md

        client.delete(f"/api/sessions/{sid}")


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
        # No `living` flag at all. Absent is no longer living unconditionally —
        # P3 stays redacted only because a 1990 birth is neither 110 years back
        # nor evidence of death. Changing this date changes the expected outcome.
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


def test_missing_living_flag_still_redacts_when_nothing_says_they_died():
    """Issue #2988 narrowed this: an absent flag is no longer living
    *unconditionally*, but P3 has only a Birth 1990 — no death fact and no
    110-year age — so the outcome is unchanged."""
    tree, _, _ = _redact_tree(_TREE)
    assert _person(tree, "P3")["names"][0]["given"] == fb.LIVING_GIVEN
    assert _person(tree, "P3")["facts"] == []


def test_no_bundle_entry_leaks_a_living_name_date_or_ark():
    # Scans EVERY file the redaction returns, not just tree.gedcomx.json, so
    # exact-name redaction is verified across whatever the bundle contains
    # rather than one named file. NOTE: this helper stages only research.json +
    # tree.gedcomx.json, so the scan does not by itself exercise a stray
    # unredacted copy — the guard that no writer *produces* one lives in the
    # engine tests (project-io's dot-prefixed-temp assertion and each writer's
    # `.bak`-absent assertion, issue #2333). What this adds is that IF a future
    # fixture or producer ever puts a second readable tree copy in the bundle,
    # an every-entry scan catches it where a one-file assertion would not.
    _, _, files = _redact_tree(_TREE)
    assert files
    for name, buf in files.items():
        raw = buf.decode("utf-8")
        for leak in ("Jane Marie", "Bobby", "3 March 1985", "Riverside, CA", "SECRET"):
            assert leak not in raw, f"{leak} leaked into {name}"
    # the deceased subject still ships in the bundle
    assert "Reuben Spencer" in files["tree.gedcomx.json"].decode("utf-8")


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


def test_starting_tree_baseline_is_redacted_too():
    """The write-once starting-tree.gedcomx.json baseline (issue #1490) carries the
    same living persons and is bundled by the same non-media walk, so it must be
    redacted like tree.gedcomx.json — or a feedback bundle leaks living details."""
    files = [("starting-tree.gedcomx.json", json.dumps(_TREE).encode("utf-8"))]
    out, count = fb._redact_living(files)
    raw = dict(out)["starting-tree.gedcomx.json"].decode("utf-8")
    for leak in ("Jane Marie", "Bobby", "3 March 1985", "Riverside, CA", "SECRET"):
        assert leak not in raw
    assert "Reuben Spencer" in raw  # the deceased subject survives
    assert count == 2


def test_both_tree_files_redacted_and_counted_together():
    """With both trees present the redaction count spans both, and the earlier
    reset-to-zero on a later parse failure would have clobbered the running total."""
    files = [
        ("tree.gedcomx.json", json.dumps(_TREE).encode("utf-8")),
        ("starting-tree.gedcomx.json", json.dumps(_TREE).encode("utf-8")),
    ]
    out, count = fb._redact_living(files)
    assert count == 4  # two living persons in each file
    for name in ("tree.gedcomx.json", "starting-tree.gedcomx.json"):
        assert "Jane Marie" not in dict(out)[name].decode("utf-8")


def test_a_file_that_fails_partway_ships_untouched_and_counts_zero():
    """The count must describe the bytes written, not the persons visited. A
    living first person is redacted in the loop, then a malformed `names` entry
    on a later person raises inside _redact_person — the whole file must ship
    untouched (the living details still in the clear) and contribute 0, so
    FEEDBACK.md never claims a record was protected that was not."""
    tree = {
        "persons": [
            {"id": "P1", "gender": "Female", "living": True,
             "names": [{"id": "N1", "given": "Jane Marie", "surname": "Doe"}],
             "facts": [{"id": "F1", "type": "Birth", "date": "3 March 1985"}]},
            {"id": "P2", "gender": "Male", "living": True, "names": ["Bob Smith"]},
        ],
        "relationships": [],
        "sources": [],
    }
    raw = json.dumps(tree).encode("utf-8")
    out, count = fb._redact_living([("tree.gedcomx.json", raw)])
    assert count == 0, "a file that failed partway must contribute nothing to the count"
    # The file ships byte-for-byte as it came in — nothing half-redacted.
    assert dict(out)["tree.gedcomx.json"] == raw


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
        has_parent_log=True,
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


def _session_log_markdown(
    *, has_parent_log: bool, has_subagents: bool = True, dropped: list[str] | None = None
) -> str:
    return fb._feedback_markdown(
        {"email": "t@example.com", "userPrompt": "q", "agentDid": "d",
         "agentShouldHave": "", "correctAnswer": "", "notes": ""},
        "2026-09-01T00:00:00Z",
        "A project",
        True,  # the SET is non-empty
        "web 2026-09-01 (abc123)",
        False,
        dropped,
        0,
        has_subagents,
        has_parent_log=has_parent_log,
    )


def test_the_markdown_names_session_log_jsonl_when_the_bundle_has_one():
    md = _session_log_markdown(has_parent_log=True)
    assert "See `_feedback/session-log.jsonl`" in md


def test_a_grouped_only_bundle_is_not_pointed_at_a_file_it_does_not_contain():
    """`session_log` means "the set is non-empty", which does NOT imply the
    active session's parent is in it — `test_transcripts_can_ship_when_the_active
    _parent_yields_nothing` proves that state is reachable. Naming the file
    anyway sends the triager hunting for a missing file, which is the #1481
    confusion the section exists to prevent."""
    md = _session_log_markdown(has_parent_log=False)
    assert "## Session log" in md
    assert "See `_feedback/session-log.jsonl`" not in md
    assert "`_feedback/sessions/<session-id>/`" in md
    # Still a log-bearing bundle: the subagent pointer must survive the branch.
    assert "`_feedback/subagents/`" in md


def test_a_grouped_only_bundle_names_its_cause_instead_of_an_unrendered_list():
    """The commoner grouped-only cause records NO drop, so the "Files not
    included" section is not rendered — `if dropped:` guards it. A message that
    sends the triager there to learn which cause applied is the same missing-file
    hunt the branch exists to prevent, so the message must state the cause."""
    md = _session_log_markdown(has_parent_log=False, dropped=None)
    assert "had no conversation entries for this project" in md
    assert "Files not included" not in md, "pointed at a section that is not rendered"
    assert "transcript size budget" not in md, "named a cause that did not apply"


def test_a_parent_lost_to_the_budget_says_so_and_the_list_it_names_exists():
    """The other grouped-only cause DOES record a drop, so naming the list is
    correct here — and the list really is rendered. Both halves asserted, because
    the failure mode is a message and a section disagreeing."""
    md = _session_log_markdown(
        has_parent_log=False,
        dropped=[f"{fb.PARENT_LOG_ENTRY} (over the transcript size budget)"],
    )
    assert "did not fit the transcript size budget" in md
    assert "## Files not included" in md, "named a list that is not rendered"
    assert "had no conversation entries" not in md, "named a cause that did not apply"


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


# ---------- API-key redaction in session logs ----------


def test_redact_anthropic_key():
    data = b'{"message":"my key is sk-ant-api03-abcDEF123456789012345678901234"}\n'
    out = fb._redact_api_keys(data)
    assert b"sk-ant-" not in out
    assert b"[REDACTED_API_KEY]" in out


def test_redact_openrouter_key():
    data = b'{"message":"use sk-or-v1-abcdef1234567890abcdef1234567890"}\n'
    out = fb._redact_api_keys(data)
    assert b"sk-or-" not in out
    assert b"[REDACTED_API_KEY]" in out


def test_redact_generic_sk_key():
    key = b"sk-" + b"a" * 48
    data = b'{"message":"' + key + b'"}\n'
    out = fb._redact_api_keys(data)
    assert key not in out
    assert b"[REDACTED_API_KEY]" in out


def test_short_sk_token_not_redacted():
    data = b'{"message":"sk-short is fine"}\n'
    assert fb._redact_api_keys(data) == data


def test_redact_multiple_keys():
    data = (
        b'{"type":"user","message":"sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA"}\n'
        b'{"type":"user","message":"sk-or-v1-BBBBBBBBBBBBBBBBBBBBBB"}\n'
    )
    out = fb._redact_api_keys(data)
    assert b"sk-ant-" not in out
    assert b"sk-or-" not in out
    assert out.count(b"[REDACTED_API_KEY]") == 2


def test_redact_api_keys_str():
    text = "I pasted sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA into the field"
    out = fb._redact_api_keys_str(text)
    assert "sk-ant-" not in out
    assert "[REDACTED_API_KEY]" in out
    assert "I pasted" in out


def test_redact_api_keys_str_passthrough():
    text = "normal text with no keys"
    assert fb._redact_api_keys_str(text) == text


# --------------------------------------------------------------------------
# Issue #2988 — an absent `living` flag is no longer "living" unconditionally.
# Mirrors the Electron suite's describe block of the same name.
# --------------------------------------------------------------------------

_NOW = date(2026, 1, 1)
_BIRTH_1990 = {"id": "b", "type": "Birth", "date": "3 March 1990"}


def _p(**extra):
    return {
        "id": "X1",
        "gender": "Male",
        "names": [{"id": "nx", "given": "Ada Test", "surname": "Sample"}],
        **extra,
    }


_SENTINEL = {
    "id": "SENTINEL",
    "gender": "Female",
    "living": True,
    "names": [{"id": "ns", "given": "Jane Marie", "surname": "Sentinel"}],
}


def _redacts(person, now=_NOW, name="tree.gedcomx.json"):
    """1 when the subject was redacted, 0 when they shipped unredacted.

    Every tree also carries a person explicitly flagged living, and this asserts
    they came back redacted. Without it a bare count of 0 is ambiguous:
    _redact_living's `except` also returns 0 with the file passed through
    untouched. The sentinel is the only thing that makes a swallowed raise
    visible.
    """
    tree = {"persons": [person, _SENTINEL], "relationships": [], "sources": []}
    out, count = fb._redact_living([(name, json.dumps(tree).encode("utf-8"))], now)
    result = json.loads(dict(out)[name])
    sentinel = _person(result, "SENTINEL")
    assert sentinel["names"][0]["given"] == fb.LIVING_GIVEN, (
        "sentinel survived unredacted — the file was passed through by the except"
    )
    return count - 1


# 1-3: each death-type fact alone decides it. Birth 1990 keeps the age
# heuristic out of the way, so exactly one fact type is under test.
def _with_death_fact(fact_type):
    return _p(facts=[{"id": "f", "type": fact_type, "date": "1994"}, _BIRTH_1990])


def test_2988_case_1_no_flag_with_a_death_fact_ships_unredacted():
    assert _redacts(_with_death_fact("Death")) == 0


def test_2988_case_2_no_flag_with_a_burial_fact_ships_unredacted():
    assert _redacts(_with_death_fact("Burial")) == 0


def test_2988_case_3_no_flag_with_a_cremation_fact_ships_unredacted():
    assert _redacts(_with_death_fact("Cremation")) == 0


def test_2988_case_4_no_flag_born_1823_ships_unredacted():
    assert _redacts(_p(facts=[{"id": "b", "type": "Birth", "date": "14 May 1823"}])) == 0


def test_2988_case_5_no_flag_born_1990_still_redacted():
    assert _redacts(_p(facts=[_BIRTH_1990])) == 1


# 6: `living` is 4-valued in the wild. Every PRESENT value keeps the pre-#2988
# behaviour, so a non-boolean flag must not fall into the heuristic and
# un-redact someone the old code protected.
@pytest.mark.parametrize("value", [None, 0, "true", []])
def test_2988_case_6_present_but_non_boolean_living_flag_still_redacted(value):
    person = _p(
        living=value,
        facts=[{"id": "f", "type": "Death", "date": "1994"}, _BIRTH_1990],
    )
    assert _redacts(person) == 1


def test_2988_case_7_living_true_wins_over_a_death_fact():
    """The flag comes from FamilySearch; a privacy filter must not argue."""
    person = _p(living=True, facts=[{"id": "f", "type": "Death", "date": "1994"}, _BIRTH_1990])
    assert _redacts(person) == 1


def test_2988_case_8_facts_null_does_not_throw_the_file_past_the_redactor():
    """_redact_living's `except` ships the file UNTOUCHED, so a raise here would
    leak every living person in it. Asserting the bytes changed is what
    separates "the helper coped" from "the except swallowed it"."""
    tree = {
        "persons": [
            _p(id="BAD", facts=None),
            _p(
                id="LIVE",
                living=True,
                names=[{"id": "n2", "given": "Jane Marie", "surname": "Sample"}],
            ),
        ],
        "relationships": [],
        "sources": [],
    }
    raw = json.dumps(tree).encode("utf-8")
    out, count = fb._redact_living([("tree.gedcomx.json", raw)], _NOW)
    after = dict(out)["tree.gedcomx.json"]

    assert count == 2
    assert after != raw
    assert b"Jane Marie" not in after


def test_2988_case_9_a_malformed_fact_is_skipped_not_fatal():
    person = _p(facts=[None, {"id": "f", "type": "Death", "date": "1994"}, _BIRTH_1990])
    assert _redacts(person) == 0


# 10-11: the only pair that can tell `> 110` from `>= 110`. Deliberately one
# year more conservative than living_gate, which would ship the 110-year-old.
def test_2988_case_10_born_exactly_110_years_ago_is_still_redacted():
    year = _NOW.year - fb.PRESUMED_LIVING_YEARS
    assert _redacts(_p(facts=[{"id": "b", "type": "Birth", "date": f"1 July {year}"}])) == 1


def test_2988_case_11_born_111_years_ago_ships_unredacted():
    year = _NOW.year - fb.PRESUMED_LIVING_YEARS - 1
    assert _redacts(_p(facts=[{"id": "b", "type": "Birth", "date": f"1 July {year}"}])) == 0


def test_2988_birth_year_falls_through_an_unparseable_birth_fact():
    """Mirrors _birth_year: an unparseable birth fact falls through to the next
    one rather than ending the search."""
    person = _p(
        facts=[
            {"id": "b1", "type": "Birth", "date": "date unknown"},
            {"id": "b2", "type": "Christening", "standard_date": "+1823-05-14"},
        ]
    )
    assert _redacts(person) == 0


def test_2988_defaults_to_the_real_clock_when_no_now_is_passed():
    """Born 1900, so the answer flips on what the default clock actually is: the
    real one ships them, while the epoch, a NaN date and a deleted fallback all
    redact. A 1990 birth would pass under every one of those."""
    person = _p(facts=[{"id": "b", "type": "Birth", "date": "1900"}])
    assert _redacts(person, None) == 0


# --------------------------------------------------------------------------
# Issue #2988 — stale tree copies never reach the bundle.
# --------------------------------------------------------------------------

_STALE_TMP = "tree.gedcomx.json.tmp-0b5f1c2e-9a44-4d1e-8f77-2c6d3e9a1b04"


def _walk(names):
    files = {f"{PROJECT_DIR}/{n}": b"{}" for n in names}
    return [rel for rel, _ in asyncio.run(fb._walk_project(_FakeSandbox(files)))]


def test_2988_case_12_a_bak_beside_the_tree_is_not_walked():
    """Pre-#2333 .mcpb builds wrote one. It is never redacted, because
    _redact_living only rewrites the two canonical filenames."""
    walked = _walk(["tree.gedcomx.json", "tree.gedcomx.json.bak"])
    assert "tree.gedcomx.json" in walked
    assert "tree.gedcomx.json.bak" not in walked


def test_2988_case_13_a_non_dot_prefixed_tmp_copy_is_not_walked():
    """Before the ProjectStore seam, atomicWriteJson wrote this shape, so a
    crash between write and rename leaves one the dot-skip does not catch."""
    assert _STALE_TMP not in _walk(["tree.gedcomx.json", _STALE_TMP])


def test_2988_stale_skip_spares_look_alike_names_at_any_depth():
    """The other direction: names that merely resemble the patterns must
    survive, or the skip is silently eating real project files."""
    walked = _walk(
        [
            "results/log_001.json.bak",
            "results/log_001.json",
            "backup-notes.md",
            "tmp-plan.md",
        ]
    )
    assert "results/log_001.json.bak" not in walked
    assert "results/log_001.json" in walked
    assert "backup-notes.md" in walked
    assert "tmp-plan.md" in walked


def test_2988_bundle_2932_shape_end_to_end():
    """No living flag anywhere — exactly what tree_edit produces, and what
    blanked all 11 persons in bundle #2932."""
    tree = {
        "persons": [
            {
                "id": "M1", "gender": "Female",
                "names": [{"id": "n1", "given": "Mary Hales", "surname": "Hales"}],
                "facts": [
                    {"id": "f1", "type": "Birth", "date": "1823",
                     "place": "Sheffield, Yorkshire"},
                    {"id": "f2", "type": "Death", "date": "1853"},
                    {"id": "f3", "type": "Burial", "date": "1853"},
                ],
            },
            {
                "id": "M2", "gender": "Male",
                "names": [{"id": "n2", "given": "Bobby Living", "surname": "Hales"}],
                "facts": [{"id": "f4", "type": "Birth", "date": "1990",
                           "place": "Riverside, CA"}],
            },
        ],
        "relationships": [],
        "sources": [],
    }
    raw = json.dumps(tree).encode("utf-8")
    files = {
        f"{PROJECT_DIR}/research.json": b"{}",
        f"{PROJECT_DIR}/tree.gedcomx.json": raw,
        f"{PROJECT_DIR}/tree.gedcomx.json.bak": raw,
        f"{PROJECT_DIR}/{_STALE_TMP}": raw,
    }
    walked = asyncio.run(fb._walk_project(_FakeSandbox(files)))
    out, _ = fb._redact_living(walked, _NOW)
    bundled = dict(out)

    assert not [n for n in bundled if n.endswith(".bak") or ".tmp-" in n]

    result = json.loads(bundled["tree.gedcomx.json"])
    mary = _person(result, "M1")
    bobby = _person(result, "M2")
    assert mary["names"][0]["given"] == "Mary Hales"
    assert len(mary["facts"]) == 3
    assert bobby["names"][0]["given"] == fb.LIVING_GIVEN
    assert bobby["facts"] == []

    for name, buf in bundled.items():
        if name == "tree.gedcomx.json":
            continue
        assert b"Bobby Living" not in buf


# --------------------------------------------------------------------------
# Review findings on the #2988 fix.
# --------------------------------------------------------------------------


def test_review_redacts_a_tree_copy_the_walker_has_no_reason_to_drop():
    """A researcher's own duplicate is not `.bak` and not `.tmp-`, so nothing
    skips it. Keying redaction on the two canonical names shipped it whole."""
    person = _p(facts=[{"id": "b", "type": "Birth", "date": "1990"}])
    assert _redacts(person, name="tree-backup.gedcomx.json") == 1
    assert _redacts(person, name="tree.gedcomx copy.json") == 1


def test_review_leaves_a_non_tree_json_document_alone():
    """Shape-based selection must not rewrite project JSON with no `persons`."""
    raw = json.dumps({"project": {"id": "rp_x"}, "log": []}).encode("utf-8")
    out, count = fb._redact_living([("research.json", raw)], _NOW)
    assert count == 0
    assert dict(out)["research.json"] == raw


def test_review_ignores_a_non_string_date():
    """`str({...})` shows the contents and would find 1823 here; JavaScript's
    `String({...})` gives "[object Object]". The guard is what keeps the two
    bundles identical — without it this side ships someone the desktop redacts."""
    person = _p(facts=[{"id": "b", "type": "Birth", "date": {"original": "14 May 1823"}}])
    assert _redacts(person) == 1


def test_review_ships_an_ancestor_known_only_from_a_census_or_residence():
    """No birth, no death — the record type an ancestor is most likely to have
    exactly one of. A birth-only heuristic left these blanked."""
    person = _p(
        facts=[
            {"id": "c", "type": "Census", "date": "1850"},
            {"id": "r", "type": "Residence", "date": "1860"},
        ]
    )
    assert _redacts(person) == 0


def test_review_treats_a_probate_fact_as_evidence_of_death():
    assert _redacts(_p(facts=[{"id": "pr", "type": "Probate", "date": "1994"}])) == 0


def test_review_is_not_fooled_by_a_posthumous_ordinance():
    """A Baptism long after death would date this 1823 person to 1960 and blank
    them. An explicit Birth fact wins regardless of list order."""
    person = _p(
        facts=[
            {"id": "o", "type": "Baptism", "date": "12 Mar 1960"},
            {"id": "b", "type": "Birth", "date": "14 May 1823"},
        ]
    )
    assert _redacts(person) == 0


def test_review_redacts_a_tree_saved_with_a_bom_in_front():
    """A Windows editor readily adds one. Without utf-8-sig the parse raises,
    _redact_living's except ships the file UNREDACTED, and the living person in
    it leaks — the fail-open hazard this whole change exists to close."""
    tree = {
        "persons": [_p(facts=[_BIRTH_1990])],
        "relationships": [],
        "sources": [],
    }
    raw = b"\xef\xbb\xbf" + json.dumps(tree).encode("utf-8")
    out, count = fb._redact_living([("tree.gedcomx.json", raw)], _NOW)
    assert count == 1
    assert b"Ada Test" not in dict(out)["tree.gedcomx.json"]


def test_review_still_redacts_someone_whose_only_dated_fact_is_recent():
    """The reverse of the census case: a living person with a 1990 residence
    must not be shipped by the last-seen-alive rule."""
    assert _redacts(_p(facts=[{"id": "r", "type": "Residence", "date": "1990"}])) == 1


def test_review_stale_skip_is_case_insensitive():
    """The genealogist team is on Windows, where `.BAK` is readily produced."""
    assert "tree.gedcomx.json.BAK" not in _walk(["tree.gedcomx.json", "tree.gedcomx.json.BAK"])


def test_review_stale_skip_keeps_a_file_merely_containing_the_temp_substring():
    """Anchored to a trailing uuid run, so an ordinary file is not eaten."""
    assert "notes.tmp-draft.md" in _walk(["notes.tmp-draft.md"])


def test_review_the_walker_collects_the_stale_copies_it_dropped():
    names = ["tree.gedcomx.json", "tree.gedcomx.json.bak", _STALE_TMP]
    files = {f"{PROJECT_DIR}/{n}": b"{}" for n in names}
    stale: list[str] = []
    asyncio.run(fb._walk_project(_FakeSandbox(files), stale))
    assert sorted(stale) == sorted(["tree.gedcomx.json.bak", _STALE_TMP])


def test_review_stale_copies_are_named_in_feedback_md_not_dropped_silently(monkeypatch):
    """End to end through the real route. Every other drop reason is reported;
    a silent one leaves a triager reproducing against a folder quietly missing a
    file. Asserted on the shipped bundle rather than on the walker's sink,
    because the sink being right does not mean it is wired to the markdown."""
    captured = _capture_upload(monkeypatch)

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={"sample": True}).json()
        sid = proj["id"]

        root = app.state.provider._root(proj["sandbox_id"])  # LocalProvider
        project_dir = root / PROJECT_DIR.lstrip("/")
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "tree.gedcomx.json.bak").write_text('{"persons":[]}', encoding="utf-8")

        r = client.post(
            "/api/feedback",
            json={"sessionId": sid, "email": "t@example.com", "userPrompt": "x",
                  "agentDid": "y", "agentShouldHave": "z", "workedAsExpected": False},
        )
        assert r.status_code == 200

        zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(captured["envelope"]["zipBase64"])))
        assert "tree.gedcomx.json.bak" not in set(zf.namelist())
        md = zf.read("FEEDBACK.md").decode("utf-8")
        assert "tree.gedcomx.json.bak (stale copy)" in md
        assert "## Files not included" in md, "named a list that is not rendered"

        client.delete(f"/api/sessions/{sid}")


# --------------------------------------------------------------------------
# Parity guard. The rule is duplicated across two languages by design (neither
# app may import the other, nor eval code), linked only by "mirrors" comments.
# That drift is not hypothetical: the string-coercion divergence above shipped
# in the first draft of this very change.
# --------------------------------------------------------------------------

_TS_SOURCE = (
    Path(__file__).resolve().parents[3] / "apps/electron/src/main/feedback.ts"
)


def _ts_set(name: str) -> set[str]:
    src = _TS_SOURCE.read_text(encoding="utf-8")
    match = re.search(rf"const {name} = new Set\(\[(.*?)\]\)", src, re.S)
    assert match, f"{name} not found in feedback.ts — did it get renamed?"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_parity_fact_type_sets_match_the_electron_copy():
    assert _ts_set("DEATH_FACT_TYPES") == set(fb._DEATH_FACT_TYPES)
    assert _ts_set("BIRTH_FACT_TYPES") == set(fb._BIRTH_FACT_TYPES)


def test_parity_presumed_living_years_matches_the_electron_copy():
    src = _TS_SOURCE.read_text(encoding="utf-8")
    match = re.search(r"export const PRESUMED_LIVING_YEARS = (\d+)", src)
    assert match, "PRESUMED_LIVING_YEARS not found in feedback.ts"
    assert int(match.group(1)) == fb.PRESUMED_LIVING_YEARS


def test_parity_year_regex_matches_the_electron_copy():
    src = _TS_SOURCE.read_text(encoding="utf-8")
    match = re.search(r"const EMBEDDED_YEAR_RE = /(.+?)/\n", src)
    assert match, "EMBEDDED_YEAR_RE not found in feedback.ts"
    assert match.group(1) == fb._EMBEDDED_YEAR_RE.pattern
