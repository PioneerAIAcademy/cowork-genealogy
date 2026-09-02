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


def _session_log_markdown(*, has_parent_log: bool, has_subagents: bool = True) -> str:
    return fb._feedback_markdown(
        {"email": "t@example.com", "userPrompt": "q", "agentDid": "d",
         "agentShouldHave": "", "correctAnswer": "", "notes": ""},
        "2026-09-01T00:00:00Z",
        "A project",
        True,  # the SET is non-empty
        "web 2026-09-01 (abc123)",
        False,
        None,
        0,
        has_subagents,
        has_parent_log,
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
