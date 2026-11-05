"""U20: the feedback reads of ``PgStore`` against REAL Postgres.

``transcript_groups`` and ``transcript_rows`` read ``session_entries`` rows written through the
worker's own ``PgSessionStore``, so they cannot drift from what the worker stores: a parent and
a ``subagents/agent-x`` subpath on two SDK sessions, plus a foreign project that reuses one of
the SDK session ids, whose rows must never appear. Every read runs as a role holding only the
services' grants (``dml_role``). The offline route tests are ``test_proto_feedback.py``.

Without the DSN the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid

import pytest

from proto.worker.session_store import PgSessionStore
from tests._proto_pg import PROTO, database, dml_role, sql

sys.path.insert(0, str(PROTO))

from web import feedback  # noqa: E402
from web.app import PgStore  # noqa: E402


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u20f_") as dsn:
        yield dsn


@pytest.fixture(scope="module")
def role_dsn(pg_dsn):
    with dml_role(pg_dsn) as (_role, dsn):
        yield dsn


def entry(kind: str, text: str, **kw) -> dict:
    return {"type": kind, "uuid": uuid.uuid4().hex, "cwd": "/project", "message": {"content": text}, **kw}


async def append(dsn: str, project_id: str, sdk: str, entries: list[dict], subpath: str = "") -> None:
    key = {"project_key": "-project", "session_id": sdk, **({"subpath": subpath} if subpath else {})}
    await PgSessionStore(dsn, project_id).append(key, entries)


@pytest.fixture(scope="module")
def written(pg_dsn):
    return asyncio.run(_write(pg_dsn))


async def _write(pg_dsn):
    pid, foreign = "proj_" + uuid.uuid4().hex[:10], "proj_" + uuid.uuid4().hex[:10]
    sdk1, sdk2 = str(uuid.uuid4()), str(uuid.uuid4())
    await append(pg_dsn, pid, sdk1, [entry("user", "first"), entry("assistant", "ünïcode ✓")])
    await append(pg_dsn, pid, sdk1, [entry("user", "sub"), {"type": "agent_metadata", "agentType": "x"}],
                 subpath="subagents/agent-x")
    await append(pg_dsn, pid, sdk2, [entry("user", "second session")])
    await append(pg_dsn, pid, sdk1, [entry("assistant", "last")])
    await append(pg_dsn, foreign, sdk1, [entry("user", "FOREIGN ROW")])
    await append(pg_dsn, foreign, str(uuid.uuid4()), [entry("user", "FOREIGN ROW 2")])
    return pid, foreign, sdk1, sdk2


async def test_groups_are_the_projects_own_with_sql_sizes(pg_dsn, role_dsn, written):
    pid, _foreign, sdk1, sdk2 = written
    groups = await PgStore(role_dsn).transcript_groups(pid)
    expected = sql(pg_dsn, "SELECT session_id, subpath, max(seq), sum(octet_length(entry::text) + 1) "
                           "FROM session_entries WHERE project_key = %s GROUP BY 1, 2", (pid,))
    assert {(g.session_id, g.subpath, g.max_seq, g.bytes) for g in groups} == {tuple(r) for r in expected}
    assert {(g.session_id, g.subpath) for g in groups} == {(sdk1, ""), (sdk1, "subagents/agent-x"), (sdk2, "")}
    assert groups[0] == max(groups, key=lambda g: g.max_seq), "newest first"
    store = PgStore(role_dsn)
    for g in groups:
        rows = await store.transcript_rows(pid, g.session_id, g.subpath, 0, 100)
        jsonl = b"".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
                         for _seq, e in rows)
        assert len(jsonl) <= g.bytes, "the SQL size is an upper bound on the JSONL"


async def test_rows_page_by_seq_and_never_cross_projects(role_dsn, written):
    pid, foreign, sdk1, _sdk2 = written
    store = PgStore(role_dsn)
    pages = [b async for b in feedback.iter_batches(store.transcript_rows, pid, sdk1, "", batch=2)]
    assert [len(p) for p in pages] == [2, 1]
    assert [e["message"]["content"] for p in pages for e in p] == ["first", "ünïcode ✓", "last"]
    whole = await store.transcript_rows(pid, sdk1, "", 0, 100)
    assert [s for s, _ in whole] == sorted(s for s, _ in whole)
    assert await store.transcript_rows(pid, sdk1, "", whole[-1][0], 100) == []
    theirs = await store.transcript_rows(foreign, sdk1, "", 0, 100)
    assert [e["message"]["content"] for _s, e in theirs] == ["FOREIGN ROW"]


async def test_the_transcript_set_carries_no_foreign_row(role_dsn, written):
    pid, _foreign, sdk1, sdk2 = written
    store = PgStore(role_dsn)
    entries, dropped = await feedback.transcript_set(await store.transcript_groups(pid), store.transcript_rows,
                                                     pid, sdk1)
    names = dict(entries)
    assert set(names) == {"_feedback/session-log.jsonl", "_feedback/subagents/agent-x.jsonl",
                          "_feedback/subagents/agent-x.meta.json"}, (names.keys(), dropped)
    assert json.loads(names["_feedback/subagents/agent-x.meta.json"]) == {"agentType": "x"}
    assert b"FOREIGN" not in b"".join(names.values())
    assert sdk2 not in json.dumps(dropped), "a parent-only older session ships nothing and drops nothing"


async def test_the_other_feedback_reads(pg_dsn, role_dsn):
    pid, sid, uid = "proj_" + uuid.uuid4().hex[:10], "sess_" + uuid.uuid4().hex[:10], "usr_" + uuid.uuid4().hex[:8]
    sql(pg_dsn, "INSERT INTO sessions (session_id, project_id, sdk_session_id) VALUES (%s, %s, 'sdk-1')", (sid, pid))
    sql(pg_dsn, "INSERT INTO blobs (project_id, key, s3_key, bytes, sha256) VALUES (%s, 'images/a.png', 'k1', 7, 'h'), "
                "(%s, 'results/r.json', 'k2', 3, 'h')", (pid, pid))
    sql(pg_dsn, "INSERT INTO users (id, email) VALUES (%s, %s)", (uid, uid + "@example.org"))
    sql(pg_dsn, "INSERT INTO familysearch_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, "
                "granted_at) VALUES (%s, 'enc-a', 'enc-r', now(), now())", (uid,))
    store = PgStore(role_dsn)
    assert await store.blob_index(pid) == [("images/a.png", "k1", 7), ("results/r.json", "k2", 3)]
    assert await store.blob_index("proj_none") == []
    assert await store.sdk_session_id(sid) == "sdk-1" and await store.sdk_session_id("sess_none") is None
    assert await store.grant_ciphertexts(uid) == ("enc-a", "enc-r")
    assert await store.grant_ciphertexts("usr_none") == (None, None)
