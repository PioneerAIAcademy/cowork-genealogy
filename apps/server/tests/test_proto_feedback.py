"""U20: the prototype web tier's feedback routes (apps/server/proto/web/app.py, web/feedback.py,
web/blobstore.py). Offline: the route tests' ``FakeStore`` grown the feedback reads, and a fake
bucket that records every ``GetObject`` and ``PutObject``.

The real SQL behind ``transcript_groups`` / ``transcript_rows`` runs in
``test_proto_feedback_pg.py``.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import sys
import zipfile
from datetime import date
from typing import Any

import pytest

import app.feedback as alpha
from tests.test_proto_web import PROTO, USER_A, USER_B, FakeQueue, FakeStore, make_client

sys.path.insert(0, str(PROTO))

from web import auth, blobstore  # noqa: E402
from web import feedback as proto  # noqa: E402

MiB = 1024 * 1024
SDK = "11111111-2222-4333-8444-555555555555"
OLD_SDK = "99999999-2222-4333-8444-555555555555"
ACCESS = "fs-access-" + "A1b2C3d4" * 6
REFRESH = "fs-refresh-" + "Z9y8X7w6" * 6
# The token an older turn held, rotated since: only the bearer pass can catch it.
ROTATED = "fs-rotated-" + "R5t6Y7u8" * 6
FORM_BEARER = "Bearer " + "eyJhbGciOi" + "Q" * 30
API_KEY = "sk-ant-" + "k" * 40


# ── fakes ────────────────────────────────────────────────────────────────────────


class FeedbackStore(FakeStore):
    def __init__(self) -> None:
        super().__init__()
        self.blob_rows: dict[str, list[tuple[str, str, int]]] = {}
        self.entries: list[tuple[int, str, str, str, Any]] = []  # seq, project, sid, subpath, entry
        self.sdk: dict[str, str] = {}
        self.rows_served = 0

    def add_entries(self, project_id: str, sid: str, entries: list[Any], subpath: str = "") -> None:
        for e in entries:
            self.entries.append((len(self.entries) + 1, project_id, sid, subpath, e))

    async def blob_index(self, project_id: str) -> list[tuple[str, str, int]]:
        return list(self.blob_rows.get(project_id, []))

    async def sdk_session_id(self, session_id: str) -> str | None:
        return self.sdk.get(session_id)

    async def transcript_groups(self, project_id: str) -> list[proto.TranscriptGroup]:
        groups: dict[tuple[str, str], list[int]] = {}
        for seq, pid, sid, sub, e in self.entries:
            if pid != project_id:
                continue
            g = groups.setdefault((sid, sub), [0, 0])
            g[0] = max(g[0], seq)
            # jsonb::text's spacing, plus the newline -- what the SQL sums.
            g[1] += len(json.dumps(e, ensure_ascii=False).encode("utf-8")) + 1
        return sorted((proto.TranscriptGroup(sid, sub, m, b) for (sid, sub), (m, b) in groups.items()),
                      key=lambda g: (-g.max_seq, g.session_id, g.subpath))

    async def transcript_rows(self, project_id: str, session_id: str, subpath: str, after: int,
                              limit: int) -> list[tuple[int, Any]]:
        rows = [(seq, e) for seq, pid, sid, sub, e in self.entries
                if (pid, sid, sub) == (project_id, session_id, subpath) and seq > after][:limit]
        self.rows_served += len(rows)
        return rows

    async def grant_ciphertexts(self, user_id: str) -> tuple[str | None, str | None]:
        g = self.grants.get(user_id)
        return (g["access_token_enc"], g["refresh_token_enc"]) if g else (None, None)


class FakeBlobs:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_get: set[str] = set()
        self.fail_put = False
        self.gets: list[str] = []
        self.puts: list[tuple[str, bytes, str]] = []

    def get(self, key: str) -> bytes:
        self.gets.append(key)
        if key in self.fail_get:
            raise RuntimeError("AccessDenied arn:aws:iam::123456789012:role/x")
        return self.objects[key]

    def put(self, key: str, data: bytes, content_type: str) -> None:
        if self.fail_put:
            raise RuntimeError("AccessDenied arn:aws:iam::123456789012:role/x")
        self.puts.append((key, data, content_type))

    @property
    def got_bytes(self) -> int:
        return sum(len(self.objects[k]) for k in self.gets if k not in self.fail_get)


def user(text: str, cwd: str = "/project", **kw) -> dict:
    return {"type": "user", "cwd": cwd, "uuid": text[:8], "message": {"role": "user", "content": text}, **kw}


def assistant(text: str, cwd: str = "/project") -> dict:
    content = [{"type": "text", "text": text}]
    return {"type": "assistant", "cwd": cwd, "message": {"role": "assistant", "content": content}}


def tool_result(text: str) -> dict:
    return {"type": "user", "cwd": "/project",
            "message": {"role": "user", "content": [{"type": "tool_result", "content": text}]}}


LIVING_TREE = {
    "persons": [
        {"id": "P1", "gender": "Female", "names": [{"id": "n1", "given": "Ada", "surname": "Lovell"}],
         "facts": [{"type": "Birth", "date": "1990"}]},
        {"id": "P2", "gender": "Male", "names": [{"id": "n2", "given": "Silas", "surname": "Lovell"}],
         "facts": [{"type": "Birth", "date": "1820"}]},
    ],
    "relationships": [],
}


def seeded(*, include_old_session: bool = True) -> tuple[FeedbackStore, FakeBlobs]:
    store, blobs = FeedbackStore(), FakeBlobs()
    store.seed_session("sess_1", "proj_1")
    store.seed_session("sess_b", "proj_b", owner=USER_B.id)
    store.sdk["sess_1"] = SDK
    store.grants[USER_A.id] = {"access_token_enc": auth.encrypt(ACCESS), "refresh_token_enc": auth.encrypt(REFRESH)}
    store.docs["proj_1"] = {"research.json": (3, {"objective": "Find Ada"}), "tree.gedcomx.json": (2, LIVING_TREE)}
    store.blob_rows["proj_1"] = [
        ("results/x.json", "proj_1/results/x.json/u1", 11),
        ("images/scan.png", "proj_1/images/scan.png/u2", 4),
        ("results/.staging/r.json", "proj_1/results/.staging/r.json/u3", 2),
        ("tree.gedcomx.json.bak", "proj_1/tree.gedcomx.json.bak/u4", 2),
    ]
    blobs.objects.update({"proj_1/results/x.json/u1": b'{"hit": 1}\n', "proj_1/images/scan.png/u2": b"\x89PNG"})
    store.add_entries("proj_1", SDK, [
        user("find Ada's parents"),
        {"type": "system", "cwd": "/project", "subtype": "init"},
        assistant("Searching. key " + API_KEY),
        tool_result(json.dumps({"mcpServers": {"genealogy": {"headers": {"Authorization": "Bearer " + ACCESS}}}})),
        tool_result(json.dumps({"mcpServers": {"genealogy": {"headers": {"Authorization": "Bearer " + ROTATED}}}})),
        assistant("the token was " + ACCESS + " and refresh " + REFRESH),
        assistant("I will not paste the Bearer header."),
        user("elsewhere", cwd="/other"),
    ])
    store.add_entries("proj_1", SDK, [
        user("subagent task"),
        {"type": "agent_metadata", "agentType": "record-extractor", "toolUseId": "toolu_1"},
        assistant("extracted"),
    ], subpath="subagents/agent-a")
    if include_old_session:
        store.add_entries("proj_1", OLD_SDK, [user("an older session")])
        store.add_entries("proj_1", OLD_SDK, [assistant("older subagent")], subpath="subagents/agent-old")
    store.add_entries("proj_b", "sdk-b", [user("someone else's")])
    return store, blobs


def client(store: FeedbackStore, blobs: FakeBlobs | None, **kw):
    return make_client(store, FakeQueue(), blobs=blobs, **kw)


def body(**kw) -> dict:
    return {"sessionId": "sess_1", "email": "A@Example.org", "userPrompt": "find parents", "agentDid": "nothing",
            "workedAsExpected": False, "agentShouldHave": "", "correctAnswer": "", "notes": None,
            "includeMedia": False, "includeSessionLog": True, **kw}


def run(coro):
    return asyncio.run(coro)


async def post(store, blobs, payload, **kw):
    async with client(store, blobs, **kw) as c:
        return await c.post("/api/feedback", json=payload)


async def context(store, blobs, session_id="sess_1", **kw):
    async with client(store, blobs, **kw) as c:
        return await c.get("/api/feedback/context", params={"sessionId": session_id} if session_id else None)


def unzip(blobs: FakeBlobs) -> dict[str, bytes]:
    key, data, ctype = blobs.puts[-1]
    assert ctype == "application/zip"
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


# ── 1. ownership before validation ───────────────────────────────────────────────

MALFORMED = {"includeMedia": {"not": "a bool"}, "workedAsExpected": [1, 2]}


def test_unsigned_is_401_on_both_routes():
    store, blobs = seeded()
    assert run(post(store, blobs, body(), user=None)).status_code == 401
    assert run(context(store, blobs, user=None)).status_code == 401


@pytest.mark.parametrize("payload", [
    {"sessionId": "sess_b", **MALFORMED},
    {"sessionId": "sess_nope", **MALFORMED},
    {"sessionId": 7, **MALFORMED},
    MALFORMED,
    ["not", "an", "object"],
], ids=["foreign", "unknown", "non-string", "missing", "array"])
def test_a_session_the_caller_does_not_own_is_404_before_the_body_is_validated(payload):
    store, blobs = seeded()
    r = run(post(store, blobs, payload))
    assert r.status_code == 404, r.text
    assert r.json() == {"detail": "Session not found"}
    assert blobs.puts == [] and blobs.gets == []


def test_an_unparseable_body_is_404_not_422():
    store, blobs = seeded()

    async def go():
        async with client(store, blobs) as c:
            return await c.post("/api/feedback", content=b"{nope", headers={"content-type": "application/json"})

    assert run(go()).status_code == 404


def test_context_for_a_foreign_unknown_or_missing_session_is_404():
    store, blobs = seeded()
    for sid in ("sess_b", "sess_nope", None):
        assert run(context(store, blobs, sid)).status_code == 404, sid


def test_an_owned_session_with_a_malformed_body_is_422():
    store, blobs = seeded()
    r = run(post(store, blobs, {"sessionId": "sess_1", **MALFORMED}))
    assert r.status_code == 422
    assert blobs.puts == []


def test_an_owned_submission_is_200_with_the_spas_result_shape():
    store, blobs = seeded()
    r = run(post(store, blobs, body()))
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"ok", "filename"} and out["ok"] is True
    assert blobs.puts[0][0].endswith("/" + out["filename"])


def test_a_field_over_the_cap_is_400():
    store, blobs = seeded()
    assert run(post(store, blobs, body(notes="x" * 10_001))).status_code == 400


# ── 2-3. context and zip contents ───────────────────────────────────────────────


def test_context_lists_what_the_post_zips_and_bounds_the_transcript():
    store, blobs = seeded()
    ctx = run(context(store, blobs))
    assert ctx.status_code == 200
    c = ctx.json()
    assert set(c) == {"files", "sessionLogSize", "hasSessionLog"} and c["hasSessionLog"] is True
    assert {f["relativePath"] for f in c["files"]} == {"research.json", "tree.gedcomx.json", "results/x.json",
                                                       "images/scan.png"}
    png = next(f for f in c["files"] if f["relativePath"] == "images/scan.png")
    assert png == {"relativePath": "images/scan.png", "sizeBytes": 4, "isMedia": True, "isText": False}
    assert run(post(store, blobs, body(includeMedia=True))).status_code == 200
    names = unzip(blobs)
    project = {n for n in names if n != "FEEDBACK.md" and not n.startswith("_feedback/")}
    assert project == {f["relativePath"] for f in c["files"]}
    transcript = sum(len(v) for n, v in names.items() if n.startswith("_feedback/") and n != "_feedback/feedback.json")
    assert 0 < transcript <= c["sessionLogSize"]


def test_context_needs_no_bucket_and_reads_no_s3():
    store, blobs = seeded()
    assert run(context(store, None)).status_code == 200
    assert run(context(store, blobs)).status_code == 200 and blobs.gets == []


def test_the_zip_carries_the_alpha_layout():
    store, blobs = seeded()
    assert run(post(store, blobs, body())).status_code == 200
    names = unzip(blobs)
    assert {"research.json", "tree.gedcomx.json", "results/x.json", "FEEDBACK.md", "_feedback/feedback.json",
            "_feedback/session-log.jsonl", "_feedback/subagents/agent-a.jsonl", "_feedback/subagents/agent-a.meta.json",
            f"_feedback/sessions/{OLD_SDK}/session-log.jsonl",
            f"_feedback/sessions/{OLD_SDK}/subagents/agent-old.jsonl"} <= set(names)
    assert "images/scan.png" not in names, "media only with includeMedia"
    assert not any(".staging" in n or n.endswith(".bak") for n in names)
    assert json.loads(names["research.json"]) == {"objective": "Find Ada"}
    fj = json.loads(names["_feedback/feedback.json"])
    assert set(fj) == {"schema_version", "submitted_at", "viewer_version", "build_date", "git_sha", "platform", "email",
                       "project_folder_path", "user_prompt", "agent_did", "worked_as_expected", "agent_should_have",
                       "correct_answer", "notes", "dropped_transcripts"}
    assert fj["platform"] == "web" and fj["project_folder_path"] == "sess_1" and fj["email"] == "a@example.org"
    assert fj["viewer_version"] == "web dev (dev)"
    parent = [json.loads(line) for line in names["_feedback/session-log.jsonl"].splitlines()]
    assert [e["type"] for e in parent] == ["user", "assistant", "user", "user", "assistant", "assistant"], \
        "system and /other dropped"
    meta = json.loads(names["_feedback/subagents/agent-a.meta.json"])
    assert meta == {"agentType": "record-extractor", "toolUseId": "toolu_1"}
    sub = [json.loads(line)["type"] for line in names["_feedback/subagents/agent-a.jsonl"].splitlines()]
    assert sub == ["user", "assistant"], "the agent_metadata row is the meta file, not a line"
    md = names["FEEDBACK.md"].decode("utf-8")
    assert "tree.gedcomx.json.bak (stale copy)" in md and "images/scan.png" in md
    assert "proj_b" not in json.dumps({n: v.decode("utf-8", "replace") for n, v in names.items()})
    assert "someone else's" not in b"".join(names.values()).decode("utf-8", "replace")


def test_the_image_ships_with_include_media():
    store, blobs = seeded()
    assert run(post(store, blobs, body(includeMedia=True))).status_code == 200
    assert unzip(blobs)["images/scan.png"] == b"\x89PNG"


def test_the_active_session_falls_back_to_the_newest_parent():
    store, blobs = seeded()
    store.sdk.pop("sess_1")
    assert run(post(store, blobs, body())).status_code == 200
    names = unzip(blobs)
    assert b"an older session" in names["_feedback/session-log.jsonl"], "OLD_SDK's parent row is the newest"


def test_no_session_log_when_declined():
    store, blobs = seeded()
    assert run(post(store, blobs, body(includeSessionLog=False))).status_code == 200
    assert not any(n.endswith(".jsonl") for n in unzip(blobs))


# ── 4. redaction ───────────────────────────────────────────────────────────────────


def test_living_people_api_keys_and_tokens_are_redacted():
    store, blobs = seeded()
    payload = body(notes="my key " + API_KEY + " and header " + FORM_BEARER, agentDid="refresh was " + REFRESH)
    assert run(post(store, blobs, payload)).status_code == 200
    names = unzip(blobs)
    everything = b"".join(names.values())
    tree = json.loads(names["tree.gedcomx.json"])
    ada = next(p for p in tree["persons"] if p["id"] == "P1")
    assert ada["names"][0]["given"] == "Living" and ada["facts"] == []
    assert next(p for p in tree["persons"] if p["id"] == "P2")["names"][0]["given"] == "Silas"
    for secret in (API_KEY, ACCESS, REFRESH, ROTATED, FORM_BEARER, FORM_BEARER.split()[1]):
        assert secret.encode("utf-8") not in everything, secret[:20]
    assert b"[REDACTED_API_KEY]" in names["_feedback/session-log.jsonl"]
    assert b"[REDACTED_TOKEN]" in names["_feedback/session-log.jsonl"]
    assert b"I will not paste the Bearer header." in names["_feedback/session-log.jsonl"], "a bare word survives"
    fj = json.loads(names["_feedback/feedback.json"])
    assert "[REDACTED_TOKEN]" in fj["notes"] and "[REDACTED_TOKEN]" in fj["agent_did"]


def test_project_text_files_get_the_token_passes():
    store, blobs = seeded()
    store.docs["proj_1"]["research.json"] = (3, {"objective": "Find Ada", "note": "pasted " + ACCESS})
    blobs.objects["proj_1/results/x.json/u1"] = json.dumps(
        {"url": "https://fs.example/img?access_token=" + ROTATED + "&x=1", "auth": "Bearer " + ROTATED}
    ).encode("utf-8")
    assert run(post(store, blobs, body(includeMedia=True))).status_code == 200
    names = unzip(blobs)
    for rel in ("research.json", "results/x.json"):
        for secret in (ACCESS, ROTATED):
            assert secret.encode("utf-8") not in names[rel], (rel, secret[:20])
    assert json.loads(names["results/x.json"])["url"] == "https://fs.example/img?access_token=[REDACTED_TOKEN]&x=1"
    assert json.loads(names["research.json"])["objective"] == "Find Ada", "documents stay valid JSON"
    assert names["images/scan.png"] == b"\x89PNG", "media is not rewritten"


def test_access_token_redaction_shapes():
    assert proto.redact_tokens_str('{"access_token": "' + "t" * 20 + '"}') == '{"access_token": "[REDACTED_TOKEN]"}'
    assert proto.redact_tokens_str("?ACCESS_TOKEN=" + "t" * 20) == "?ACCESS_TOKEN=[REDACTED_TOKEN]"
    assert proto.redact_tokens_str("the access_token field is required") == "the access_token field is required"
    nested = json.dumps({"c": json.dumps({"access_token": "t" * 20})})
    assert proto.redact_tokens_str(nested) == json.dumps({"c": json.dumps({"access_token": "[REDACTED_TOKEN]"})})
    assert proto.redact_tokens_str("access_token=short") == "access_token=short"


def test_bearer_redaction_keeps_ordinary_text():
    assert proto.redact_tokens_str("the Bearer of bad news") == "the Bearer of bad news"
    assert proto.redact_tokens_str("Bearer short") == "Bearer short"
    assert proto.redact_tokens_str("authorization: bearer " + "a" * 20) == "authorization: Bearer [REDACTED_TOKEN]"
    assert proto.redact_tokens(b"x " + ACCESS.encode() + b" y", [ACCESS]) == b"x [REDACTED_TOKEN] y"
    assert proto.redact_tokens(b"tiny", ["tiny"]) == b"tiny", "a short literal is not a token"


# ── 5. caps ──────────────────────────────────────────────────────────────────────


def test_an_oversized_blob_is_never_fetched():
    store, blobs = seeded()
    store.blob_rows["proj_1"].append(("images/huge.tif", "proj_1/images/huge.tif/u9", 26 * MiB))
    assert run(post(store, blobs, body(includeMedia=True))).status_code == 200
    assert "proj_1/images/huge.tif/u9" not in blobs.gets


def test_selection_runs_before_any_fetch_and_keeps_the_largest_out():
    store, blobs = seeded()
    sizes = [12, 10, 9, 8]  # MiB: 39 MiB of images
    for i, mib in enumerate(sizes):
        key = f"proj_1/images/p{i}.jpg/u{i}"
        store.blob_rows["proj_1"].append((f"images/p{i}.jpg", key, mib * MiB))
        blobs.objects[key] = b"\0" * (mib * MiB)
    assert run(post(store, blobs, body(includeMedia=True))).status_code == 200
    assert blobs.got_bytes <= 35 * MiB
    assert "proj_1/images/p0.jpg/u0" not in blobs.gets, "the largest goes first"
    assert {f"proj_1/images/p{i}.jpg/u{i}" for i in (1, 2, 3)} <= set(blobs.gets)
    assert "images/p0.jpg" in unzip(blobs)["FEEDBACK.md"].decode("utf-8")


def test_a_failed_get_is_named_and_the_report_still_lands():
    store, blobs = seeded()
    blobs.fail_get.add("proj_1/results/x.json/u1")
    assert run(post(store, blobs, body())).status_code == 200
    names = unzip(blobs)
    assert "results/x.json" not in names
    assert "results/x.json (could not be read)" in names["FEEDBACK.md"].decode("utf-8")


def test_an_oversized_transcript_stops_fetching_and_is_named(monkeypatch):
    monkeypatch.setattr(proto, "ROWS_BATCH", 50)
    store, blobs = seeded(include_old_session=False)
    store.entries = [e for e in store.entries if e[3] == "" or e[1] != "proj_1"]  # parent only
    filler = "x" * (40 * 1024)
    big = [assistant(f"{i} {filler}") for i in range(800)]  # ~32 MiB
    store.add_entries("proj_1", SDK, big)
    store.rows_served = 0
    assert run(post(store, blobs, body())).status_code == 200
    assert store.rows_served < len(big), f"served {store.rows_served} of {len(big) + 7}"
    names = unzip(blobs)
    assert "_feedback/session-log.jsonl" not in names
    fj = json.loads(names["_feedback/feedback.json"])
    assert fj["dropped_transcripts"] == ["_feedback/session-log.jsonl (over the transcript size budget)"]


# ── 6. the key ───────────────────────────────────────────────────────────────────

KEY_RE = re.compile(r"^feedback/usr_[^/]+/proj_1/feedback-[0-9T-]+Z-[0-9a-f]{8}\.zip$")
# A transliteration of ORPHAN_KEY_RE (packages/engine/mcp-server/src/store/s3-orphan-sweep.ts,
# PROJECT_ID_RE from project-id.ts). tests/store/s3-orphan-sweep.test.ts pins the other side.
_PROJECT_ID = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
ORPHAN_KEY_RE = re.compile(rf"^({_PROJECT_ID})/(.+)/({_UUID})$")


def stored_key() -> str:
    store, blobs = seeded()
    assert run(post(store, blobs, body())).status_code == 200
    return blobs.puts[0][0]


def test_the_key_is_owner_scoped():
    key = stored_key()
    assert KEY_RE.match(key), key
    assert key.split("/")[1] == USER_A.id


def test_the_key_is_outside_the_sweeps_layout():
    assert not ORPHAN_KEY_RE.match(stored_key())
    real = "proj_1/results/x.json/0f8fad5b-d9cb-469f-a165-70867728950e"
    assert ORPHAN_KEY_RE.match(real), "the transliteration bites"


def test_a_put_failure_is_502_and_names_no_account():
    store, blobs = seeded()
    blobs.fail_put = True
    r = run(post(store, blobs, body()))
    assert r.status_code == 502 and r.json() == {"detail": "Feedback upload failed"}


def test_no_bucket_is_503_on_post_only_after_ownership():
    store, _ = seeded()
    assert run(post(store, None, body())).status_code == 503
    assert run(post(store, None, {"sessionId": "sess_b"})).status_code == 404


# ── 7. blobstore ───────────────────────────────────────────────────────────────────


def test_blobstore_unset_keys_use_the_default_chain_not_an_empty_pair(monkeypatch):
    for var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_PROFILE"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    s3 = blobstore.client({"GENEALOGY_S3_BUCKET": "b"})
    creds = s3._request_signer._credentials
    assert creds is None or (creds.access_key, creds.secret_key) != ("", "")
    assert s3.meta.region_name == "us-east-1"
    assert s3.meta.endpoint_url.startswith("https://s3."), "no endpoint means AWS"


def test_blobstore_static_keys_and_endpoint_are_path_style():
    s3 = blobstore.client({"GENEALOGY_S3_BUCKET": "projects", "GENEALOGY_S3_ENDPOINT": "http://minio:9000",
                           "GENEALOGY_S3_ACCESS_KEY": "proto", "GENEALOGY_S3_SECRET_KEY": "protoproto",
                           "GENEALOGY_S3_REGION": "us-west-2"})
    creds = s3._request_signer._credentials
    assert (creds.access_key, creds.secret_key) == ("proto", "protoproto")
    assert s3.meta.endpoint_url == "http://minio:9000" and s3.meta.region_name == "us-west-2"
    assert s3.meta.config.s3["addressing_style"] == "path"


@pytest.mark.parametrize("env", [
    {"GENEALOGY_S3_BUCKET": "b", "GENEALOGY_S3_ACCESS_KEY": "a"},
    {"GENEALOGY_S3_BUCKET": "b", "GENEALOGY_S3_SECRET_KEY": "s"},
    {"GENEALOGY_S3_ACCESS_KEY": "a"},
])
def test_blobstore_half_a_pair_raises(env):
    with pytest.raises(blobstore.S3ConfigError):
        blobstore.client(env)


def test_blobstore_no_bucket_is_none():
    assert blobstore.client({}) is None and blobstore.from_env({"GENEALOGY_S3_ENDPOINT": "http://x"}) is None
    assert "no bucket" in blobstore.describe({})
    assert "secret" not in blobstore.describe({"GENEALOGY_S3_BUCKET": "b", "GENEALOGY_S3_ACCESS_KEY": "a",
                                               "GENEALOGY_S3_SECRET_KEY": "secret"})


def test_a_half_pair_refuses_to_start(monkeypatch):
    from web.app import create_app

    monkeypatch.setenv("QUEUE_URL", "http://localhost:9324/000000000000/turns")
    monkeypatch.setenv("GENEALOGY_SQS_ACCESS_KEY", "x")
    monkeypatch.setenv("GENEALOGY_SQS_SECRET_KEY", "x")
    monkeypatch.setenv("GENEALOGY_S3_BUCKET", "b")
    monkeypatch.setenv("GENEALOGY_S3_ACCESS_KEY", "a")
    monkeypatch.delenv("GENEALOGY_S3_SECRET_KEY", raising=False)
    app = create_app()

    async def start():
        async with app.router.lifespan_context(app):
            pass

    with pytest.raises(RuntimeError, match="GENEALOGY_S3_SECRET_KEY"):
        asyncio.run(start())


# ── 8. parity with the alpha ─────────────────────────────────────────────────────

PARITY_CONSTANTS = (
    "FEEDBACK_SCHEMA_VERSION", "_MAX_FIELD_CHARS", "_SESSION_LOG_CAP_BYTES", "_REDACTED_KEY", "_REDACTED_KEY_STR",
    "_MEDIA_EXTS", "_TEXT_EXTS", "_INDIVIDUAL_FILE_CAP_BYTES", "_ZIP_CAP_BYTES", "TREE_FILENAME",
    "STARTING_TREE_FILENAME", "LIVING_GIVEN", "LIVING_SURNAME_FALLBACK", "PRESUMED_LIVING_YEARS",
    "_DEATH_FACT_TYPES", "_BIRTH_FACT_TYPES", "PARENT_LOG_ENTRY", "NOT_PROVIDED", "PROJECT_DIR",
)


@pytest.mark.parametrize("name", PARITY_CONSTANTS)
def test_parity_constants(name):
    assert getattr(proto, name) == getattr(alpha, name), name


def test_parity_patterns():
    for name in ("_API_KEY_PATTERNS", "_API_KEY_PATTERNS_STR", "_API_KEY_FIELD_PATTERNS",
                 "_API_KEY_FIELD_PATTERNS_STR"):
        assert [p.pattern for p in getattr(proto, name)] == [p.pattern for p in getattr(alpha, name)]
    for name in ("_EMBEDDED_YEAR_RE", "_STALE_TMP_RE"):
        assert getattr(proto, name).pattern == getattr(alpha, name).pattern


PERSONS = [
    {"id": "a", "living": False, "names": [{"id": "n", "given": "A", "surname": "S"}]},
    {"id": "b", "living": None, "names": []},
    {"id": "c", "names": [{"surname": "C"}], "facts": [{"type": "Birth", "date": "1990"}]},
    {"id": "d", "facts": [{"type": "Birth", "date": "1800"}]},
    {"id": "e", "facts": [{"type": "Probate", "date": "2000"}]},
    {"id": "f", "facts": [{"type": "Will", "date": "1990"}]},
    {"id": "g", "facts": [{"type": "Census", "date": "1880"}, {"type": "Christening", "date": "1960"}]},
    {"id": "h", "facts": [{"type": "Christening", "date": {"original": "1823"}}]},
    {"id": "i", "facts": "not a list"},
    {"id": "j", "facts": [{"type": "Baptism", "standard_date": "+1915"}]},
    {"id": "k", "facts": [{"type": "Birth", "date": "1916"}]},
    {"id": "l", "facts": [{"type": "Residence", "date": "1914"}]},
    {"id": "m", "living": "true"},
]


@pytest.mark.parametrize("person", PERSONS, ids=lambda p: p["id"])
def test_parity_is_living(person):
    assert proto._is_living(person, 2026) == alpha._is_living(person, 2026)


TREE_FILES = [
    ("tree.gedcomx.json", json.dumps({"persons": PERSONS, "relationships": [
        {"person1": "c", "person2": "d", "facts": [{"type": "Marriage"}]},
        {"person1": "a", "person2": "d"}]}).encode()),
    ("starting-tree.gedcomx.json", b"\xef\xbb\xbf" + json.dumps({"persons": PERSONS[:3]}).encode()),
    ("research.json", b'{"objective": "x"}'),
    ("broken.json", b'{"persons": [{"id": "x", "names": [7]}]}'),
    ("notes.md", b"# not json"),
    ("images/a.png", b"\x89PNG"),
]


def test_parity_redact_living():
    assert proto._redact_living(TREE_FILES, date(2026, 10, 13)) == alpha._redact_living(TREE_FILES, date(2026, 10, 13))


@pytest.mark.parametrize("include_media", [True, False])
def test_parity_select_files(include_media):
    files = TREE_FILES + [("images/big.tif", b"\0" * (20 * MiB)), ("results/r.json", b"\0" * (16 * MiB)),
                          ("uploads/c.mp4", b"\0" * (30 * MiB))]
    assert proto._select_files(files, include_media) == alpha._select_files(files, include_media)


@pytest.mark.parametrize("include_media", [True, False])
def test_parity_select_files_tiered_eviction(include_media):
    """Exercises the tiered eviction with a large research.json and results/ sidecars."""
    files = [
        ("research.json", b"\0" * (20 * MiB)),
        ("tree.gedcomx.json", b"\0" * 500),
        ("starting-tree.gedcomx.json", b"\0" * 500),
        ("results/log_1.json", b"\0" * (15 * MiB)),
        ("results/log_2.json", b"\0" * (10 * MiB)),
        ("images/photo.tif", b"\0" * (5 * MiB)),
        ("notes.md", b"# notes"),
    ]
    assert proto._select_files(files, include_media) == alpha._select_files(files, include_media)


TRANSCRIPT = b"\n".join([
    json.dumps(user("hi")).encode(), b"", b"not json", json.dumps({"type": "system"}).encode(),
    json.dumps(assistant("a" * 50)).encode(), json.dumps(user("sub", cwd="/project/sub")).encode(),
    json.dumps(user("other", cwd="/elsewhere")).encode(), json.dumps({"type": "user"}).encode(),
]) + b"\n"


@pytest.mark.parametrize("cap", [10, 200, 10_000])
@pytest.mark.parametrize("allow_subdirs", [True, False])
def test_parity_filter_transcript(cap, allow_subdirs):
    assert proto._filter_transcript(TRANSCRIPT, cap=cap, allow_subdirs=allow_subdirs) == \
        alpha._filter_transcript(TRANSCRIPT, cap=cap, allow_subdirs=allow_subdirs)


def test_parity_redact_api_keys():
    text = (f"a {API_KEY} b sk-or-{'o' * 25} c sk-{'z' * 45} d sk-short "
            '{\\"matcherUrl\\": \\"https://m.example\\", \\"matcherApiKey\\": \\"' + "f" * 64 + '\\"}')
    assert proto._redact_api_keys(text.encode()) == alpha._redact_api_keys(text.encode())
    assert proto._redact_api_keys_str(text) == alpha._redact_api_keys_str(text)


@pytest.mark.parametrize("dropped,has_parent", [
    ([], True), (["_feedback/session-log.jsonl (over the transcript size budget)"], False), (["x.png"], False)])
@pytest.mark.parametrize("filled", [True, False])
def test_parity_feedback_markdown(dropped, has_parent, filled):
    f = {"email": "e@x" if filled else "", "userPrompt": "p" if filled else "", "agentDid": "d",
         "agentShouldHave": "s" if filled else "", "correctAnswer": "c" if filled else "",
         "notes": "n" if filled else ""}
    args = (f, "2026-10-13T00:00:00Z", "Label", filled, "web dev (dev)", filled, dropped, 2 if filled else 0, filled)
    assert proto._feedback_markdown(*args, has_parent_log=has_parent) == \
        alpha._feedback_markdown(*args, has_parent_log=has_parent)


def test_parity_small_helpers():
    for name in ("a.PNG", "x", ".hidden", "t.tmp-0123abcd", "t.BAK", "notes.tmp-draft.md"):
        assert proto._ext(name) == alpha._ext(name) and proto._is_stale_copy(name) == alpha._is_stale_copy(name)
    for sid, active in (("s", True), ("s", False)):
        assert proto._group_prefix(sid, active=active) == alpha._group_prefix(sid, active=active)
    assert proto._norm("  x ") == alpha._norm("  x ")
    assert proto.FeedbackBody.model_json_schema() == alpha.FeedbackBody.model_json_schema()
