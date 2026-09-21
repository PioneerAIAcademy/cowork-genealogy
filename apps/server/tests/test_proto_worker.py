"""Offline tests for the prototype worker (apps/server/proto/worker/), D9-10 + D15.

No Postgres, no SDK process, no model: the row writers run against a fake connection
that records SQL; event routing runs on canned ``map_message`` outputs; the deny
predicate and the PreToolUse hook are called directly; the compose file, the worker's
Dockerfile and 004_worker.sql are read as text. What these pin:

- claim / complete / the idempotent completion (a redelivered finished turn runs nothing);
  the SDK session id chosen at claim time, before the run, and reused on a redelivery;
  the token columns summed from session_entries in complete();
- transient kinds go to session_activity with the whole event, everything else to
  session_events with ``kind`` lifted into the column;
- deny.py's three cases and the route chooser;
- the hook's tool_calls row for every call, its deny decisions, and that it never raises;
- the D15 registration precondition against the two CONSTANTS: a plugin dir missing an
  agent is refused at load, and the precondition can be handed neither the loaded agents
  nor a count of the skills on disk;
- run_turn against a fake client: a good stream completes the turn with the result's
  figures; a wrong session id in system/init, no init at all, a MirrorErrorMessage, an
  errored ResultMessage and a stream with no ResultMessage each fail the turn without
  completing it; a short registration is refused before anything is sent to the model;
- the option set: cwd, setting_sources=[], agents=, the tool server's per-turn env in a
  0600 mcp.json (never argv) under ``env -u ANTHROPIC_API_KEY``, session_id/resume
  exactly one, the eager store flush, the model pin per provider; the ``TOOL_SERVER=http``
  arm's two per-turn headers (project id always, bearer only when there is a token);
- the container: tmpfs for TMPDIR, the key passed through (never a literal, never baked
  into the image), /project present, no tokens.json, optional deps kept, the SDK
  pinned, 004 additive only;
- D18's Stop hook: ``should_continue_run`` on the harness's own truth table, the hook's
  block with the harness's reason text verbatim (read off orchestrator.py), its cap, its
  no-progress arm, that it never raises; the ``Stop`` matcher bound only when a hook is
  given; run_turn wiring it only when AUTONOMOUS_MAX_NUDGES > 0 and writing ``nudges``.
"""

from __future__ import annotations

import ast
import asyncio
import json
import re
import shutil
import stat
import tempfile
import uuid
from pathlib import Path
from typing import Any

import pytest
import yaml
from claude_agent_sdk import AssistantMessage, MirrorErrorMessage, ResultMessage, SystemMessage, TextBlock

from proto.worker import deny, options, worker
from proto.worker.session_store import entry_rows

SERVER = Path(__file__).resolve().parents[1]
PROTO = SERVER / "proto"
COMPOSE = PROTO / "docker-compose.yml"
DOCKERFILE = PROTO / "worker" / "Dockerfile"
SQL_WORKER = PROTO / "sql" / "004_worker.sql"
PLUGIN_DIR = SERVER.parents[1] / "packages" / "engine" / "plugin"
ORCHESTRATOR = SERVER.parents[1] / "eval" / "harness" / "e2e" / "orchestrator.py"

TRANSIENT = frozenset({"text_delta", "thinking_delta", "task_progress"})
AGENTS = {"gps-mentor", "image-reader", "person-evidence", "proof-conclusion", "record-extractor", "research-exhaustiveness"}


# ── fakes ─────────────────────────────────────────────────────────────────────────


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc: Any) -> None:
        pass

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.conn.executed.append((re.sub(r"\s+", " ", sql).strip(), params))

    def fetchone(self) -> tuple | None:
        sql, params = self.conn.executed[-1]
        if "next_session_seq" in sql:
            self.conn.seq += 1
            return (self.conn.seq,)
        if "SELECT completed_at FROM turns" in sql:
            return (self.conn.completed_at,)
        if "RETURNING sdk_session_id" in sql:
            # COALESCE(sdk_session_id, candidate): the row's id wins, else the candidate lands.
            if self.conn.sdk_session_id is None:
                self.conn.sdk_session_id = params[0]
            return (self.conn.sdk_session_id,)
        if "sum((u->>'input_tokens')" in sql:
            return self.conn.usage
        if "SELECT doc FROM documents" in sql:
            return (self.conn.research,)
        if "SELECT count(*) FROM tool_calls" in sql:
            return (self.conn.tool_call_count,)
        return None


class FakeTransaction:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn

    def __enter__(self) -> None:
        self.conn.transactions += 1

    def __exit__(self, *exc: Any) -> None:
        self.conn.transaction_exits += 1


class FakeConn:
    def __init__(
        self, *, completed_at: Any = None, sdk_session_id: str | None = None,
        usage: tuple = (None, None, None, None),
    ) -> None:
        self.executed: list[tuple[str, tuple]] = []
        self.commits = 0
        self.transactions = 0
        self.transaction_exits = 0
        self.seq = 0
        self.completed_at = completed_at
        self.sdk_session_id = sdk_session_id
        self.usage = usage
        self.research: dict | None = None  # the documents row the Stop hook reads
        self.tool_call_count = 0

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        pass

    def __enter__(self) -> "FakeConn":
        return self

    def __exit__(self, *exc: Any) -> None:
        pass


TURN = {
    "turn_id": "turn-1",
    "session_id": "sess-1",
    "project_id": "proj-1",
    "message": {"turn_id": "turn-1", "session_id": "sess-1", "project_id": "proj-1",
                "text": "hello", "enqueued_at": "2026-09-18T12:00:00+00:00"},
}


# ── claim / complete / idempotent completion ─────────────────────────────────────


def test_claim_upserts_sessions_and_turns_with_the_receive_count():
    conn = FakeConn()
    worker.claim(conn, TURN, 3)
    sqls = [s for s, _ in conn.executed]
    assert sqls[0].startswith("INSERT INTO sessions") and "ON CONFLICT (session_id) DO NOTHING" in sqls[0]
    assert sqls[1].startswith("INSERT INTO turns") and "receive_count = EXCLUDED.receive_count" in sqls[1]
    assert conn.executed[1][1][-1] == 3
    assert conn.commits == 1


def test_claim_takes_the_entries_high_water_mark_on_the_first_claim_only():
    conn = FakeConn()
    worker.claim(conn, TURN, 1)
    sql = conn.executed[1][0]
    assert "entries_seq_before" in sql and "(SELECT COALESCE(max(seq), 0) FROM session_entries)" in sql
    assert "entries_seq_before = COALESCE(turns.entries_seq_before, EXCLUDED.entries_seq_before)" in sql, \
        "a redelivery must not move the mark past the killed attempt's entries"


TOKENS = (10, 18498, 142229, 1881)


def test_complete_writes_turn_done_and_closes_the_turn_with_the_result_figures_in_one_transaction():
    conn = FakeConn()
    seq = worker.complete(conn, TURN, 2, cost_usd=0.0123, num_turns=4, duration_ms=9876)
    assert seq == 1
    sqls = [s for s, _ in conn.executed]
    assert "next_session_seq" in sqls[0]
    assert sqls[1].startswith("INSERT INTO session_events") and "'turn_done'" in sqls[1]
    assert sqls[2].startswith("UPDATE turns SET completed_at = now(), outcome = 'ok'")
    assert conn.executed[2][1] == (0.0123, 4, 9876, None, None, None, None, None, "turn-1")
    assert conn.transactions == 1 and conn.transaction_exits == 1


def test_complete_sums_the_turns_tokens_from_session_entries_in_the_same_transaction():
    conn = FakeConn(usage=TOKENS)
    sid = "0d3e8b1c-0000-4000-8000-000000000001"
    worker.complete(conn, TURN, 23, cost_usd=0.4592, num_turns=22, duration_ms=74294, sdk_session_id=sid)
    sqls = [s for s, _ in conn.executed]
    usage_sql, usage_params = conn.executed[2]
    assert usage_sql == re.sub(r"\s+", " ", worker.TURN_USAGE_SQL).strip() and usage_params == (sid, "turn-1")
    assert "DISTINCT ON (entry->'message'->>'id')" in usage_sql, "one row per API message"
    assert "seq > COALESCE((SELECT entries_seq_before FROM turns WHERE turn_id = %s), 0)" in usage_sql, \
        "every attempt of the turn, not just the completing one"
    assert "entry->>'type' = 'assistant'" in usage_sql and "seq DESC" in usage_sql
    update_sql, update_params = conn.executed[3]
    assert update_sql.startswith("UPDATE turns SET completed_at = now(), outcome = 'ok'")
    assert "input_tokens = COALESCE(%s, input_tokens)" in update_sql and "output_tokens = COALESCE(%s, output_tokens)" in update_sql
    assert update_params == (0.4592, 22, 74294, *TOKENS, None, "turn-1")
    assert sqls[-1] is update_sql and conn.transactions == 1, "the sum and the close are one transaction"


def test_complete_without_figures_keeps_the_existing_columns():
    conn = FakeConn()
    worker.complete(conn, TURN, 1)
    sql, params = conn.executed[2]
    assert "COALESCE(%s, cost_usd)" in sql and params[:8] == (None,) * 8
    assert not any("sum(" in s for s, _ in conn.executed), "no SDK session, no usage query (the stub arms)"


def test_complete_writes_the_nudge_count_with_coalesce_like_the_other_figures():
    conn = FakeConn()
    worker.complete(conn, TURN, 1, nudges=3)
    sql, params = conn.executed[2]
    assert "nudges = COALESCE(%s, nudges)" in sql and params[-2:] == (3, "turn-1")
    conn = FakeConn()
    worker.complete(conn, TURN, 1, nudges=0)
    assert conn.executed[2][1][-2] == 0, "zero is a figure (the arm was off or never vetoed), not an absence"


def test_turn_completed_reads_completed_at():
    assert worker.turn_completed(FakeConn(completed_at="2026-09-18"), "turn-1") is True
    assert worker.turn_completed(FakeConn(completed_at=None), "turn-1") is False


def test_a_redelivered_completed_turn_answers_200_without_running(monkeypatch):
    conn = FakeConn(completed_at="2026-09-18T12:01:00+00:00")
    ran: list[Any] = []
    status, body = worker.serve_real_turn(
        TURN, 2, connect=lambda dsn: conn, run=lambda turn, rc, sid: ran.append((turn, rc, sid)) or {}
    )
    assert status == 200 and body["already_completed"] is True and body["ok"] is True
    assert ran == [], "a finished turn must not be run again"
    assert any(s.startswith("INSERT INTO turns") for s, _ in conn.executed), "the claim is still recorded"
    assert not any("RETURNING sdk_session_id" in s for s, _ in conn.executed), "no session id is minted for it"


def test_an_unfinished_turn_runs_and_answers_with_its_summary():
    conn = FakeConn(completed_at=None)
    status, body = worker.serve_real_turn(
        TURN, 1, connect=lambda dsn: conn, run=lambda turn, rc, sid: {"seq": 7, "cost_usd": 0.01, "resumed": False}
    )
    assert status == 200 and body["seq"] == 7 and body["resumed"] is False


def test_a_fresh_session_gets_its_sdk_session_id_on_the_row_before_the_run():
    conn = FakeConn(completed_at=None, sdk_session_id=None)
    seen: list[tuple[str, int]] = []

    def run(turn, rc, sid):
        seen.append((sid, len(conn.executed)))
        return {"seq": 1}

    status, _ = worker.serve_real_turn(TURN, 1, connect=lambda dsn: conn, run=run)
    assert status == 200
    [(sid, executed_before_run)] = seen
    assert uuid.UUID(sid).version == 4, "the worker mints a UUID the CLI accepts as --session-id"
    writes = [i for i, (s, p) in enumerate(conn.executed) if "RETURNING sdk_session_id" in s]
    assert writes and writes[0] < executed_before_run, "the row names the id BEFORE the CLI can append"
    sql, params = conn.executed[writes[0]]
    assert sql.startswith("UPDATE sessions SET sdk_session_id = COALESCE(sdk_session_id, %s)")
    assert params == (sid, "sess-1")
    assert conn.sdk_session_id == sid


def test_a_redelivery_reuses_the_sdk_session_id_the_row_already_holds():
    existing = "0d3e8b1c-0000-4000-8000-000000000001"
    conn = FakeConn(completed_at=None, sdk_session_id=existing)
    seen: list[str] = []
    worker.serve_real_turn(TURN, 5, connect=lambda dsn: conn, run=lambda turn, rc, sid: seen.append(sid) or {"seq": 2})
    assert seen == [existing]
    assert conn.sdk_session_id == existing, "COALESCE keeps the first writer's id"


def test_a_failing_turn_answers_500_with_the_error_in_the_body():
    conn = FakeConn(completed_at=None)

    def boom(turn, rc, sid):
        raise worker.RegistrationError("agents not registered under their bare names: ['gps-mentor']")

    status, body = worker.serve_real_turn(TURN, 1, connect=lambda dsn: conn, run=boom)
    assert status == 500 and body["ok"] is False
    assert "RegistrationError" in body["error"] and "gps-mentor" in body["error"]


def test_is_real_turn_needs_text():
    assert worker.is_real_turn(TURN["message"])
    assert not worker.is_real_turn({"behaviour": "ok"})
    assert not worker.is_real_turn({"text": "   "})
    assert not worker.is_real_turn({"text": 42})


# ── event routing ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("event", [
    {"kind": "text_delta", "text": "Thom"},
    {"kind": "thinking_delta", "text": "hmm", "agent": "record-extractor"},
    {"kind": "task_progress", "agent": "record-extractor", "task_id": "t1", "last_tool": "record_read",
     "tool_uses": 3, "total_tokens": 100, "duration_ms": 5},
])
def test_transient_kinds_go_to_session_activity_with_the_whole_event(event):
    table, kind, payload = worker.route_event(event, TRANSIENT)
    assert table == "activity" and kind == event["kind"]
    assert payload == event, "the activity payload is the event, kind included"


@pytest.mark.parametrize("event", [
    {"kind": "text", "text": "The date is 15 April 1751."},
    {"kind": "thinking", "text": "..."},
    {"kind": "tool_use", "tool": "mcp__genealogy__convert_calendar", "summary": "date=4 April 1751"},
    {"kind": "tool_result", "tool": "mcp__genealogy__convert_calendar", "summary": "done"},
    {"kind": "task_started", "agent": "record-extractor", "task_id": "t1"},
    {"kind": "task_done", "agent": "record-extractor", "task_id": "t1", "status": "completed", "summary": ""},
    {"kind": "error", "text": "The operator's API key was rejected."},
])
def test_persistent_kinds_go_to_session_events_with_kind_lifted_out(event):
    table, kind, payload = worker.route_event(event, TRANSIENT)
    assert table == "event" and kind == event["kind"]
    assert "kind" not in payload and payload == {k: v for k, v in event.items() if k != "kind"}


def test_write_event_upserts_activity_and_appends_events_through_next_session_seq():
    conn = FakeConn()
    counters = {"events": 0, "activity": 0}
    worker.write_event(conn, "sess-1", {"kind": "text_delta", "text": "T"}, TRANSIENT, counters)
    worker.write_event(conn, "sess-1", {"kind": "text", "text": "The date"}, TRANSIENT, counters)
    worker.write_event(conn, "sess-1", {"kind": "tool_use", "tool": "x", "summary": "s"}, TRANSIENT, counters)
    sqls = [s for s, _ in conn.executed]
    assert sqls[0].startswith("INSERT INTO session_activity") and "ON CONFLICT (session_id) DO UPDATE" in sqls[0]
    assert "next_session_seq" in sqls[1] and sqls[2].startswith("INSERT INTO session_events")
    assert conn.executed[2][1][:3] == ("sess-1", 1, "text")
    assert conn.executed[4][1][:3] == ("sess-1", 2, "tool_use")
    assert counters == {"events": 2, "activity": 1}


def test_message_session_id_reads_the_attribute_or_the_system_message_data():
    class M:
        session_id = "sid-1"

    class S:
        data = {"session_id": "sid-2"}

    class N:
        pass

    assert worker.message_session_id(M()) == "sid-1"
    assert worker.message_session_id(S()) == "sid-2"
    assert worker.message_session_id(N()) is None


def test_is_init_message_picks_the_clis_session_declaration_only():
    class Init:
        subtype = "init"
        data = {"session_id": "sid-1", "tools": []}

    class Other:
        subtype = "compact_boundary"
        data = {"session_id": "sid-1"}

    class Assistant:
        session_id = "sid-1"

    assert worker.is_init_message(Init()) and worker.message_session_id(Init()) == "sid-1"
    assert not worker.is_init_message(Other()) and not worker.is_init_message(Assistant())


# ── session store rows ───────────────────────────────────────────────────────────


def test_session_store_rows_take_the_constructors_project_and_ignore_the_keys():
    rows = entry_rows("proj-1", {"project_key": "-project", "session_id": "sid"}, [{"type": "user"}, {"type": "assistant"}])
    assert [r[:3] for r in rows] == [("proj-1", "sid", ""), ("proj-1", "sid", "")]
    rows = entry_rows("proj-1", {"project_key": "-elsewhere", "session_id": "sid", "subpath": "subagents/agent-1"}, [{"type": "user"}])
    assert rows[0][:3] == ("proj-1", "sid", "subagents/agent-1")


# ── deny.py ───────────────────────────────────────────────────────────────────────


def test_a_read_under_the_anchor_is_denied_and_routed(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    cfg = tmp_path / "cfg"
    kw = dict(cwd=str(root), project_root=str(root), config_root=str(cfg))
    reason = deny.project_read_denied("Read", {"file_path": str(root / "research.json")}, **kw)
    assert reason and "research_query" in reason and "Read on research.json" in reason
    assert "record_read" in deny.project_read_denied("Read", {"file_path": str(root / "results" / "abc.json")}, **kw)
    assert "sidecar_read" in deny.project_read_denied("Read", {"file_path": str(root / "evaluations" / "v.json")}, **kw)
    assert "sidecar_read" in deny.project_read_denied("Grep", {"pattern": "x", "path": str(root / "uploads")}, **kw)
    assert "project_context" in deny.project_read_denied("Glob", {"pattern": "**/*.json"}, **kw), "Glob with no path reads the anchor"
    assert deny.project_read_denied("Read", {"file_path": "tree.gedcomx.json"}, **kw), "a relative path resolves against cwd"


def test_dot_claude_under_the_anchor_and_paths_outside_it_are_allowed(tmp_path):
    root = tmp_path / "project"
    (root / ".claude" / "agents").mkdir(parents=True)
    kw = dict(cwd=str(root), project_root=str(root), config_root=str(tmp_path / "cfg"))
    assert deny.project_read_denied("Read", {"file_path": str(root / ".claude" / "agents" / "x.md")}, **kw) is None
    assert deny.project_read_denied("Read", {"file_path": "/etc/hosts"}, **kw) is None
    assert deny.project_read_denied("Read", {"file_path": str(tmp_path / "elsewhere.txt")}, **kw) is None
    assert deny.project_read_denied("mcp__genealogy__research_query", {"projectPath": str(root)}, **kw) is None


def test_the_tool_results_spill_under_the_config_root_is_allowed(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    cfg = tmp_path / "cfg"
    spill = cfg / "projects" / "-project" / "sess" / "tool-results" / "r1.txt"
    kw = dict(cwd=str(root), project_root=str(root), config_root=str(cfg))
    assert deny.project_read_denied("Read", {"file_path": str(spill)}, **kw) is None
    assert deny.project_read_denied("Read", {"file_path": str(cfg / "projects" / "-project" / "sess.jsonl")}, **kw) is None, "outside the anchor anyway"


def test_read_route_chooser():
    assert deny.read_route("/project/results/x.json", "/project") == "record_read({recordId, resultsRef})"
    assert deny.read_route("/project/evaluations/x.json", "/project") == "sidecar_read({projectPath, ref})"
    assert deny.read_route("/project/uploads/notes.txt", "/project") == "sidecar_read({projectPath, ref})"
    assert deny.read_route("/project/research.json", "/project") == "research_query"
    assert deny.read_route("/project/tree.gedcomx.json", "/project") == "project_context"
    assert deny.read_route("/project", "/project") == "project_context"


# ── the PreToolUse hook ──────────────────────────────────────────────────────────


def _hook(rows: list[dict], cwd: str, config_root: str, record=None):
    return options.make_pretool_hook(
        turn_id="turn-1", session_id="sess-1", cwd=cwd, config_root=config_root,
        record=record or rows.append,
    )


def _call(hook, data):
    tool_use_id = data.get("tool_use_id") if isinstance(data, dict) else None
    return asyncio.run(hook(data, tool_use_id, {"signal": None}))


def test_every_call_gets_a_tool_calls_row_with_the_decision(tmp_path):
    rows: list[dict] = []
    hook = _hook(rows, str(tmp_path), str(tmp_path / "cfg"))
    out = _call(hook, {"tool_name": "mcp__genealogy__convert_calendar", "tool_input": {"date": "4 April 1751"},
                       "tool_use_id": "tu-1", "session_id": "sdk-sid"})
    assert out == {}
    assert rows == [{"turn_id": "turn-1", "session_id": "sess-1", "agent_id": None, "agent_type": None,
                     "tool_name": "mcp__genealogy__convert_calendar", "input_path": None, "decision": "allow",
                     "tool_use_id": "tu-1"}]


def test_the_row_carries_the_subagent_identity_and_the_path_when_the_input_has_one(tmp_path):
    rows: list[dict] = []
    hook = _hook(rows, str(tmp_path), str(tmp_path / "cfg"))
    _call(hook, {"tool_name": "Read", "tool_input": {"file_path": "/etc/hosts"}, "agent_id": "a-1", "agent_type": "record-extractor"})
    _call(hook, {"tool_name": "Grep", "tool_input": {"pattern": "Flynn"}})
    _call(hook, {"tool_name": "NotebookEdit", "tool_input": {"notebook_path": "/tmp/n.ipynb"}})
    assert [(r["agent_id"], r["agent_type"], r["input_path"], r["decision"]) for r in rows] == [
        ("a-1", "record-extractor", "/etc/hosts", "allow"),
        (None, None, str(tmp_path), "deny"),  # Grep with no path reads the anchor
        (None, None, "/tmp/n.ipynb", "allow"),
    ]


def test_raw_writes_on_the_project_files_are_denied_and_logged(tmp_path):
    rows: list[dict] = []
    hook = _hook(rows, str(tmp_path), str(tmp_path / "cfg"))
    out = _call(hook, {"tool_name": "Write", "tool_input": {"file_path": "/anywhere/research.json", "content": "{}"}})
    decision = out["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny" and "research_append" in decision["permissionDecisionReason"]
    assert rows[-1]["decision"] == "deny" and rows[-1]["input_path"] == "/anywhere/research.json"
    out = _call(hook, {"tool_name": "Edit", "tool_input": {"file_path": "tree.gedcomx.json", "old_string": "a", "new_string": "b"}})
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    out = _call(hook, {"tool_name": "Write", "tool_input": {"file_path": "/tmp/notes.md", "content": "x"}})
    assert out == {} and rows[-1]["decision"] == "allow"


def test_reads_under_the_anchor_are_denied_with_the_mcp_route(tmp_path):
    rows: list[dict] = []
    hook = _hook(rows, str(tmp_path), str(tmp_path / "cfg"))
    out = _call(hook, {"tool_name": "Read", "tool_input": {"file_path": str(tmp_path / "research.json")}})
    reason = out["hookSpecificOutput"]["permissionDecisionReason"]
    assert "research_query" in reason and rows[-1]["decision"] == "deny"


def test_the_config_root_may_be_a_callable_resolved_per_call(tmp_path):
    rows: list[dict] = []
    root = {"path": str(tmp_path / "cfg-a")}
    hook = options.make_pretool_hook(turn_id="t", session_id="s", cwd=str(tmp_path / "project"),
                                     config_root=lambda: root["path"], record=rows.append)
    spill = tmp_path / "project" / "x"  # under the anchor: denied
    assert _call(hook, {"tool_name": "Read", "tool_input": {"file_path": str(spill)}}) != {}
    root["path"] = str(tmp_path / "project")  # now the anchor IS the config root: the spill carve-out applies
    spill = tmp_path / "project" / "projects" / "k" / "tool-results" / "r.txt"
    assert _call(hook, {"tool_name": "Read", "tool_input": {"file_path": str(spill)}}) == {}


def test_blocked_tools_are_denied_by_bare_name_under_any_server_spelling(tmp_path):
    assert options.parse_blocked_tools(" person_read, person_ancestors,,") == {"person_read", "person_ancestors"}
    assert options.parse_blocked_tools(None) == frozenset() and options.parse_blocked_tools("") == frozenset()
    rows: list[dict] = []
    hook = options.make_pretool_hook(
        turn_id="t", session_id="s", cwd=str(tmp_path), config_root=str(tmp_path / "cfg"),
        record=rows.append, blocked=options.parse_blocked_tools("person_read,person_ancestors"),
    )
    for name in ("mcp__genealogy__person_read", "mcp__remote-devices__Genealogy_Research__person_ancestors"):
        out = _call(hook, {"tool_name": name, "tool_input": {"personId": "MJDL-Q8B"}})
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny", name
        assert "live FamilySearch tree" in out["hookSpecificOutput"]["permissionDecisionReason"]
    assert _call(hook, {"tool_name": "mcp__genealogy__record_search", "tool_input": {}}) == {}
    assert _call(hook, {"tool_name": "person_read", "tool_input": {}}) == {}, "only MCP tools are candidates"
    assert [r["decision"] for r in rows] == ["deny", "deny", "allow", "allow"]
    # No list: the same call is allowed, and logged as such.
    open_rows: list[dict] = []
    assert _call(_hook(open_rows, str(tmp_path), str(tmp_path / "cfg")),
                 {"tool_name": "mcp__genealogy__person_read", "tool_input": {}}) == {}
    assert open_rows[-1]["decision"] == "allow"


def test_the_hook_never_raises(tmp_path):
    def exploding_record(row):
        raise RuntimeError("postgres is down")

    logged: list[dict] = []
    hook = options.make_pretool_hook(turn_id="t", session_id="s", cwd=str(tmp_path), config_root=str(tmp_path / "cfg"),
                                     record=exploding_record, log=lambda **f: logged.append(f))
    assert _call(hook, {"tool_name": "mcp__genealogy__project_context", "tool_input": {}}) == {}
    assert logged and logged[0]["ev"] == "tool_call_log_failed"
    # A deny survives a failed log: the decision is not the log's to change.
    out = _call(hook, {"tool_name": "Write", "tool_input": {"file_path": "research.json"}})
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    # Garbage input: allow, and still a row (tool_name unknown).
    rows: list[dict] = []
    hook = _hook(rows, str(tmp_path), str(tmp_path / "cfg"))
    assert _call(hook, "not a dict") == {}  # type: ignore[arg-type]
    assert _call(hook, {"tool_name": None, "tool_input": "nope"}) == {}
    assert [r["tool_name"] for r in rows] == ["unknown", "unknown"]

    def exploding_config_root():
        raise RuntimeError("no config root")

    hook = options.make_pretool_hook(turn_id="t", session_id="s", cwd=str(tmp_path),
                                     config_root=exploding_config_root, record=rows.append)
    assert _call(hook, {"tool_name": "Read", "tool_input": {"file_path": str(tmp_path / "x")}}) == {}, "an exception allows"
    assert rows[-1]["decision"] == "allow"


# ── D15: registration precondition ───────────────────────────────────────────────


def _info(agents: set[str], skills: int, extra_agents: tuple[str, ...] = ()) -> dict:
    return {
        "agents": [{"name": a} for a in sorted(agents) + list(extra_agents)],
        "commands": [{"name": f"genealogy-research:skill-{i}"} for i in range(skills)] + [{"name": "compact"}, "review"],
    }


def test_registration_passes_with_six_bare_agents_and_every_skill():
    assert options.check_registration(_info(AGENTS, 28, ("general-purpose", "genealogy-research:gps-mentor")),
                                      expected_agents=AGENTS, expected_skills=28) == []


def test_registration_fails_on_a_missing_bare_agent_or_a_missing_skill():
    problems = options.check_registration(_info(AGENTS - {"gps-mentor"}, 28, ("genealogy-research:gps-mentor",)),
                                          expected_agents=AGENTS, expected_skills=28)
    assert problems and "gps-mentor" in problems[0] and "bare" in problems[0]
    problems = options.check_registration(_info(AGENTS, 27), expected_agents=AGENTS, expected_skills=28)
    assert problems == ["27 genealogy-research:* commands registered, expected 28"]
    assert options.check_registration(None, expected_agents=AGENTS, expected_skills=28)


def test_the_plugin_ships_six_agents_and_twenty_eight_skills():
    from proto.worker.plugin_agents import load_agent_definitions

    assert set(load_agent_definitions(PLUGIN_DIR)) == AGENTS
    assert worker.count_skills(str(PLUGIN_DIR)) == worker.EXPECTED_SKILLS == 28
    # A literal in the source, not an expression over the plugin dir (the mutation the
    # review named: both sides of the check shrinking together).
    assert "\nEXPECTED_SKILLS = 28\n" in Path(worker.__file__).read_text(encoding="utf-8")


def test_expected_agents_is_the_shipped_set():
    assert worker.EXPECTED_AGENTS == AGENTS
    agents, error = worker.load_plugin_agents(str(PLUGIN_DIR))
    assert error is None and set(agents) == AGENTS


def _plugin_without(tmp_path: Path, agent: str) -> Path:
    copy = tmp_path / "plugin"
    shutil.copytree(PLUGIN_DIR / "agents", copy / "agents")
    (copy / "agents" / f"{agent}.md").rename(copy / "agents" / f"{agent}.md.disabled")
    return copy


def test_a_plugin_missing_an_agent_is_refused_at_load_not_narrowed_to_what_loaded(tmp_path):
    from proto.worker.plugin_agents import load_agent_definitions

    copy = _plugin_without(tmp_path, "gps-mentor")
    loaded = set(load_agent_definitions(copy))
    assert loaded == AGENTS - {"gps-mentor"} and loaded != worker.EXPECTED_AGENTS
    agents, error = worker.load_plugin_agents(str(copy))
    assert agents is None, "five agents must not become the expectation"
    assert error == f"plugin agents ['gps-mentor'] missing under {copy}/agents"
    # An agent the plugin does not ship is named too (the name is the frontmatter's,
    # not the file's), so a mis-typed `name:` shows both halves.
    source = (copy / "agents" / "gps-mentor.md.disabled").read_text(encoding="utf-8")
    (copy / "agents" / "extra.md").write_text(source.replace("name: gps-mentor", "name: extra-agent", 1), encoding="utf-8")
    assert "extra-agent" in load_agent_definitions(copy)
    agents, error = worker.load_plugin_agents(str(copy))
    assert agents is None and error.endswith("; unexpected ['extra-agent']")


def test_registration_problems_compares_against_the_constants_not_the_loaded_set(tmp_path):
    # Six agents and 28 skills registered: clean. Five, or 27: the miss, whatever loaded --
    # the helper takes neither an agents argument nor a skill count, so neither figure
    # from the image can reach it.
    assert worker.registration_problems(_info(AGENTS, 28)) == []
    problems = worker.registration_problems(_info(AGENTS - {"gps-mentor"}, 28, ("genealogy-research:gps-mentor",)))
    assert problems == ["agents not registered under their bare names: ['gps-mentor']"]
    assert worker.registration_problems(_info(AGENTS, 27)) == ["27 genealogy-research:* commands registered, expected 28"]
    import inspect

    assert list(inspect.signature(worker.registration_problems).parameters) == ["info"]
    # The mutation the first build let through: a plugin copy short one skill folder
    # registers 27, and a count of that same copy would have expected 27.
    copy = tmp_path / "plugin"
    shutil.copytree(PLUGIN_DIR / "skills", copy / "skills")
    shutil.rmtree(next(d for d in sorted((copy / "skills").iterdir()) if (d / "SKILL.md").is_file()))
    assert worker.count_skills(str(copy)) == 27
    assert worker.registration_problems(_info(AGENTS, worker.count_skills(str(copy)))) == [
        "27 genealogy-research:* commands registered, expected 28"
    ]


# ── the option set ───────────────────────────────────────────────────────────────


WORKER_ENV = {
    "ANTHROPIC_API_KEY": "sk-test",
    "GENEALOGY_PG_DSN": "postgresql://postgres:proto@postgres:5432/proto",
    "GENEALOGY_S3_ENDPOINT": "http://minio:9000",
    "GENEALOGY_S3_BUCKET": "projects",
    "GENEALOGY_S3_ACCESS_KEY": "proto",
    "GENEALOGY_S3_SECRET_KEY": "protoproto",
    "GENEALOGY_ANCHOR_PATH": "/project",
    "FS_ACCESS_TOKEN": "env-token",
    "WIKI_API_URL": "http://wiki:8000",
    "TMPDIR": "/tmp",
    "UNRELATED": "x",
}


def _options(**overrides):
    kwargs = dict(
        project_id="proj-1", cwd="/project", engine_dir="/opt/genealogy/engine",
        plugin_dir="/opt/genealogy/plugin", agents={"gps-mentor": object()}, store=object(),
        config_dir=tempfile.mkdtemp(prefix="worker-cfg-test-"), pretool_hook=lambda *a: {},
        posttool_hook=lambda *a: {},
        worker_env=WORKER_ENV,
    )
    kwargs.update(overrides)
    return options.build_worker_options(**kwargs)


def _server(opts) -> dict[str, Any]:
    """The genealogy entry, read back from the mcp.json the options point at."""
    path = Path(opts.mcp_servers)
    return json.loads(path.read_text(encoding="utf-8"))["mcpServers"]["genealogy"]


def test_options_pin_the_prototype_set(tmp_path):
    opts = _options(config_dir=str(tmp_path))
    assert opts.cwd == "/project" and opts.setting_sources == [] and opts.add_dirs == []
    assert opts.permission_mode == "bypassPermissions"
    assert opts.plugins == [{"type": "local", "path": "/opt/genealogy/plugin"}]
    assert list(opts.agents) == ["gps-mentor"]
    assert opts.disallowed_tools == ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]
    assert opts.session_store_flush == "eager" and opts.session_store is not None
    assert opts.include_partial_messages is True
    assert opts.max_buffer_size == options.MAX_BUFFER_BYTES > 1024 * 1024
    assert opts.resume is None and opts.session_id is None
    assert opts.model == "claude-sonnet-4-6"
    assert opts.env["ANTHROPIC_API_KEY"] == "sk-test" and opts.env["ENABLE_TOOL_SEARCH"] == "true"
    assert opts.env["CLAUDE_CONFIG_DIR"] == str(tmp_path) and opts.env["TMPDIR"] == "/tmp"
    assert "CLAUDE_CODE_USE_BEDROCK" not in opts.env
    [matcher] = opts.hooks["PreToolUse"]
    assert matcher.matcher is None and len(matcher.hooks) == 1
    assert "projectPath '/project'" in opts.system_prompt["append"]


def test_the_tool_server_is_hosted_stdio_with_a_per_turn_env_in_a_0600_file_not_argv(tmp_path):
    # The stdio fork is the named opt-out since 2026-09-20; this is its shape.
    opts = _options(config_dir=str(tmp_path), fs_access_token="turn-token",
                    worker_env={**WORKER_ENV, "TOOL_SERVER": "stdio"})
    # A str is handed to the CLI as `--mcp-config <path>`; a dict would be json.dumps'd
    # onto argv, where the bearer and the S3 secret are visible in `ps`.
    assert isinstance(opts.mcp_servers, str) and opts.mcp_servers == str(tmp_path / "mcp.json")
    assert stat.S_IMODE(Path(opts.mcp_servers).stat().st_mode) == 0o600
    server = _server(opts)
    assert server["type"] == "stdio"
    assert server["command"] == "env", "the fork strips the model key the CLI holds"
    assert server["args"] == ["-u", "ANTHROPIC_API_KEY", "node", "/opt/genealogy/engine/build/hosted-stdio.js"]
    env = server["env"]
    assert env["GENEALOGY_PROJECT_ID"] == "proj-1"
    assert env["FS_ACCESS_TOKEN"] == "turn-token", "the message's token beats the worker env's"
    assert all(env[k] == WORKER_ENV[k] for k in options.STORE_ENV_KEYS)
    assert env["WIKI_API_URL"] == "http://wiki:8000" and "POP_STATS_URL" not in env
    assert "UNRELATED" not in env and "ANTHROPIC_API_KEY" not in env


def test_the_mcp_config_is_rewritten_0600_even_over_a_wider_file(tmp_path):
    path = tmp_path / "mcp.json"
    path.write_text("{}", encoding="utf-8")
    path.chmod(0o644)
    assert options.write_mcp_config(str(tmp_path), {"genealogy": {"type": "stdio"}}) == str(path)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert json.loads(path.read_text(encoding="utf-8")) == {"mcpServers": {"genealogy": {"type": "stdio"}}}


def test_the_token_file_is_read_per_turn_and_beats_the_env(tmp_path):
    token_file = tmp_path / "fs-token"
    token_file.write_text("file-token\n", encoding="utf-8")
    env = {**WORKER_ENV, "FS_ACCESS_TOKEN_FILE": str(token_file)}
    assert options.bearer_token(env, None) == "file-token"
    token_file.write_text("refreshed", encoding="utf-8")  # rewritten under a running worker
    assert options.bearer_token(env, None) == "refreshed"
    assert options.bearer_token(env, "message-token") == "message-token", "the message's token wins"
    assert options.bearer_token(env, "") == "", "an explicit empty token is empty, not the file"
    assert options.bearer_token({**env, "FS_ACCESS_TOKEN_FILE": str(tmp_path / "missing")}, None) == "env-token"
    token_file.write_text("", encoding="utf-8")
    assert options.bearer_token(env, None) == "", "an empty file is no token, not the env's"


def test_the_token_falls_back_to_the_worker_env_then_empty():
    """The stdio fork carries the token in its env; the http arm's same fallback is
    asserted as `Authorization: Bearer env-token` in the http test below."""
    stdio = {**WORKER_ENV, "TOOL_SERVER": "stdio"}
    assert _server(_options(worker_env=stdio))["env"]["FS_ACCESS_TOKEN"] == "env-token"
    env = {k: v for k, v in stdio.items() if k != "FS_ACCESS_TOKEN"}
    assert _server(_options(worker_env=env))["env"]["FS_ACCESS_TOKEN"] == ""


def test_resume_is_set_only_when_given():
    assert _options(resume="0d3e8b1c-0000-4000-8000-000000000001").resume == "0d3e8b1c-0000-4000-8000-000000000001"
    assert _options(resume=None).resume is None


def test_session_id_and_resume_are_exactly_one():
    sid = "0d3e8b1c-0000-4000-8000-000000000001"
    fresh = _options(session_id=sid)
    assert fresh.session_id == sid and fresh.resume is None, "fresh: the CLI is told which id to use"
    resumed = _options(resume=sid)
    assert resumed.resume == sid and resumed.session_id is None
    with pytest.raises(ValueError, match="mutually exclusive"):
        _options(resume=sid, session_id=sid)


def test_bedrock_pins_the_model_and_the_cache_flag_explicitly():
    opts = _options(worker_env={**WORKER_ENV, "MODEL_PROVIDER": "bedrock"})
    assert opts.model is None
    assert opts.env["CLAUDE_CODE_USE_BEDROCK"] == "1"
    assert opts.env["ANTHROPIC_MODEL"] == "us.anthropic.claude-sonnet-4-6[1m]"
    assert opts.env["ENABLE_PROMPT_CACHING_1H_BEDROCK"] == "1"
    assert "ANTHROPIC_API_KEY" not in opts.env
    with pytest.raises(ValueError):
        _options(worker_env={**WORKER_ENV, "MODEL_PROVIDER": "vertex"})


# ── the container ─────────────────────────────────────────────────────────────────


def _compose() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))


def _env(service: dict) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    return dict(str(item).partition("=")[::2] for item in raw)


def test_worker_build_context_is_the_repo_root():
    build = _compose()["services"]["worker"]["build"]
    assert build == {"context": "../../..", "dockerfile": "apps/server/proto/worker/Dockerfile"}
    ignore = (SERVER.parents[1] / ".dockerignore").read_text(encoding="utf-8").splitlines()
    assert "**/node_modules" in ignore and not any(line.strip() == "**/build" for line in ignore)


def test_worker_tmpfs_holds_tmpdir_and_the_key_is_passed_through_not_literal():
    svc = _compose()["services"]["worker"]
    mounts = [str(t).split(":", 1)[0] for t in svc.get("tmpfs") or []]
    assert mounts, "TMPDIR and the per-turn CLAUDE_CONFIG_DIR must be writable-not-durable"
    env = _env(svc)
    assert any(env["TMPDIR"] == m or env["TMPDIR"].startswith(m.rstrip("/") + "/") for m in mounts)
    assert env["ANTHROPIC_API_KEY"].startswith("${ANTHROPIC_API_KEY"), "never a literal in the compose file"
    assert env["OPENROUTER_API_KEY"].startswith("${OPENROUTER_API_KEY"), "image_transcribe's key, passed through like the model key"
    assert env["MODEL_PROVIDER"].startswith("${MODEL_PROVIDER")
    # The FS token is a file read per turn (tokens live an hour), never a literal or a build arg.
    assert env["FS_ACCESS_TOKEN_FILE"] == "/run/fs-token" and "FS_ACCESS_TOKEN" not in env
    assert env["BLOCKED_TOOLS"].startswith("${BLOCKED_TOOLS"), "the tree-read block is the caller's, empty by default"
    assert env["AUTONOMOUS_MAX_NUDGES"].startswith("${AUTONOMOUS_MAX_NUDGES"), "the nudge cap is the caller's (proto-demo-auto), off by default"
    assert env["AUTONOMOUS_MAX_NUDGES"].endswith(":-0}"), "unset means off, not the arm's default"
    assert "./.fs-token:/run/fs-token:ro" in (svc.get("volumes") or [])
    assert "apps/server/proto/.fs-token" in (SERVER.parents[1] / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert env["GENEALOGY_PG_DSN"].startswith("postgresql://") and "@postgres:5432" in env["GENEALOGY_PG_DSN"]
    assert env["GENEALOGY_S3_ENDPOINT"] == "http://minio:9000"
    assert env["WORKER_CWD"] == "/project" == env["GENEALOGY_ANCHOR_PATH"]
    assert svc["depends_on"]["minio"] == {"condition": "service_healthy"}


def test_worker_dockerfile_shape():
    text = DOCKERFILE.read_text(encoding="utf-8")
    body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert re.search(r"^FROM ubuntu:24\.04", body, re.M)
    assert "claude-agent-sdk==0.2.128" in body and "psycopg[binary]" in body
    assert re.search(r"npm ci --omit=dev", body) and "--omit=optional" not in body, "hosted-stdio.js needs pg and the S3 client"
    assert re.search(r"^COPY packages/engine/mcp-server/build\s", body, re.M)
    assert re.search(r"^COPY packages/engine/plugin\s", body, re.M)
    assert re.search(r"^COPY apps/server/app\s", body, re.M) and re.search(r"^COPY apps/server/proto/sql\s", body, re.M)
    assert re.search(r"mkdir -p /project", body)
    assert "tokens.json" not in body
    # The one place a key becomes an image layer: compose interpolates it at run time,
    # the Dockerfile must never carry it as an ENV/ARG or a literal.
    assert not re.search(r"^\s*(ENV|ARG)\s+ANTHROPIC_API_KEY", body, re.M), "the key is passed at run time, never baked"
    assert "sk-ant-" not in body
    assert '{"hosted": true}' in body and ".familysearch-mcp/config.json" in body
    assert re.search(r"^ENV PYTHONPATH=/opt/genealogy/server", body, re.M)
    assert "--break-system-packages" in body
    # The CLI refuses bypassPermissions as root ("--dangerously-skip-permissions cannot
    # be used with root/sudo privileges"): the first image ran as root and every turn
    # died on spawn.
    user = re.search(r"^USER (\S+)", body, re.M)
    assert user and user.group(1) != "root", "the worker must run unprivileged"


def test_004_worker_only_adds_nullable_columns():
    body = "\n".join(line.split("--", 1)[0] for line in SQL_WORKER.read_text(encoding="utf-8").splitlines())
    statements = [re.sub(r"\s+", " ", s).strip() for s in body.split(";") if s.strip()]
    assert statements
    for stmt in statements:
        assert re.match(r"ALTER TABLE (sessions|turns|tool_calls) ADD COLUMN IF NOT EXISTS \w+ \w+$", stmt), stmt
    assert "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sdk_session_id text" in statements
    assert "ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS tool_use_id text" in statements
    assert {re.match(r"ALTER TABLE turns ADD COLUMN IF NOT EXISTS (\w+)", s).group(1)
            for s in statements if "ALTER TABLE turns" in s} == {
        "cost_usd", "num_turns", "duration_ms", "nudges",
        "entries_seq_before", "input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens",
    }
    assert all(s.endswith(" bigint") for s in statements if re.search(r"_tokens|entries_seq_before", s)), \
        "token counts and the seq mark are bigint"


def test_tool_server_http_sends_the_bearer_and_the_project_id_as_headers(tmp_path):
    # The shared server's contract is two per-request headers: `Authorization: Bearer
    # <patron token>` -> principal, `X-Genealogy-Project-Id` -> the request's store. The
    # project header is always sent; the default URL is the compose `tools` service.
    env = {**WORKER_ENV, "TOOL_SERVER": "http"}
    server = _server(_options(config_dir=str(tmp_path), fs_access_token="turn-token", worker_env=env))
    assert server == {
        "type": "http",
        "url": "http://tools:8787/mcp",
        "headers": {"Authorization": "Bearer turn-token", "X-Genealogy-Project-Id": "proj-1"},
    }
    custom = _server(_options(
        config_dir=str(tmp_path), fs_access_token="", worker_env={**env, "TOOL_SERVER_URL": "http://127.0.0.1:8787/mcp"}
    ))
    assert custom["url"] == "http://127.0.0.1:8787/mcp"
    assert custom["headers"] == {"X-Genealogy-Project-Id": "proj-1"}, \
        "an empty bearer sends only the project header, not a malformed `Bearer `"
    fallback = _server(_options(config_dir=str(tmp_path), worker_env=env))
    assert fallback["headers"] == {"Authorization": "Bearer env-token", "X-Genealogy-Project-Id": "proj-1"}, \
        "the worker env's token when the message has none"
    other = _server(_options(config_dir=str(tmp_path), project_id="proj-2", fs_access_token="t", worker_env=env))
    assert other["headers"]["X-Genealogy-Project-Id"] == "proj-2", "the header is the turn's id, not a constant"
    assert "GENEALOGY_PROJECT_ID" not in json.dumps(server), "over http the id travels as a header, never as env"


def test_tool_server_headers_require_a_project_id():
    # The keyword is required so no caller can build the http entry without the id and
    # ship a request the server binds to no store.
    with pytest.raises(TypeError):
        options.tool_server_headers(WORKER_ENV, fs_access_token="t")  # type: ignore[call-arg]
    assert options.tool_server_headers({}, fs_access_token=None, project_id="p") == {"X-Genealogy-Project-Id": "p"}


def test_tool_server_defaults_to_http_and_refuses_an_unknown_mode(tmp_path):
    # The lead's call, 2026-09-20: the shared `tools` service is what production runs, so
    # it is what an unqualified worker runs. stdio is the named opt-out, and an empty
    # value is "unset", not a third mode.
    assert options.TOOL_SERVER_DEFAULT == "http"
    assert _server(_options(config_dir=str(tmp_path)))["type"] == "http"
    assert _server(_options(config_dir=str(tmp_path), worker_env={**WORKER_ENV, "TOOL_SERVER": ""}))["type"] == "http"
    assert _server(_options(config_dir=str(tmp_path),
                            worker_env={**WORKER_ENV, "TOOL_SERVER": "stdio"}))["type"] == "stdio"
    with pytest.raises(ValueError, match="stdio or http"):
        _options(config_dir=str(tmp_path), worker_env={**WORKER_ENV, "TOOL_SERVER": "grpc"})


# ── run_turn: every guard seen firing, on a fake client ──────────────────────────


class FakeSessionStore:
    def __init__(self, entries: bool) -> None:
        self.calls = {"entries_appended": 0}
        self._entries = entries

    async def has_entries(self, sdk_session_id: str) -> bool:
        return self._entries


class FakeClient:
    """ClaudeSDKClient's surface as run_turn uses it: a canned message stream."""

    def __init__(self, messages: list[Any], info: dict | None) -> None:
        self.messages, self.info = list(messages), info
        self.queried: list[str] = []
        self.disconnected = False

    async def connect(self) -> None:
        pass

    async def disconnect(self) -> None:
        self.disconnected = True

    async def get_server_info(self) -> dict | None:
        return self.info

    async def query(self, text: str) -> None:
        self.queried.append(text)

    async def receive_response(self):
        for m in self.messages:
            yield m


SID = "11111111-1111-1111-1111-111111111111"


def _init(sid: str = SID) -> SystemMessage:
    return SystemMessage(subtype="init", data={"session_id": sid, "model": "m"})


def _text(text: str) -> AssistantMessage:
    return AssistantMessage(content=[TextBlock(text=text)], model="m")


def _result(*, is_error: bool = False) -> ResultMessage:
    return ResultMessage(
        subtype="error_during_execution" if is_error else "success", duration_ms=10, duration_api_ms=8,
        is_error=is_error, num_turns=1, session_id=SID, total_cost_usd=0.01, result="boom" if is_error else None,
    )


def _good() -> list[Any]:
    return [_init(), _text("4 April 1751"), _result()]


@pytest.fixture
def turn_env(monkeypatch, tmp_path):
    """run_turn offline: a fake connection, session store, client and option builder; the
    anchor under tmp. ``state`` is what the test reads back."""
    import claude_agent_sdk

    state: dict[str, Any] = {"conn": FakeConn(usage=(10, 0, 0, 5)), "client": None, "options": None, "entries": False}
    monkeypatch.setattr(worker.psycopg, "connect", lambda *a, **k: state["conn"])
    monkeypatch.setattr(worker, "PgSessionStore", lambda dsn, project_id: FakeSessionStore(state["entries"]))
    monkeypatch.setattr(worker, "WORKER_CWD", str(tmp_path / "project"))

    def build(**kwargs):
        state["options"] = kwargs
        return object()

    monkeypatch.setattr(worker, "build_worker_options", build)
    monkeypatch.setattr(claude_agent_sdk, "ClaudeSDKClient", lambda options: state["client"])
    return state


def _run(state: dict, messages: list[Any], info: dict | None = None) -> dict:
    state["client"] = FakeClient(messages, _info(AGENTS, 28) if info is None else info)
    return asyncio.run(worker.run_turn(TURN, 1, SID, agents={"gps-mentor": object()}))


def _turn_done_written(conn: FakeConn) -> bool:
    return any("'turn_done'" in sql for sql, _ in conn.executed)


def test_run_turn_completes_a_good_stream_with_the_results_figures(turn_env):
    summary = _run(turn_env, _good())
    conn, client, opts = turn_env["conn"], turn_env["client"], turn_env["options"]
    assert client.queried == ["hello"] and client.disconnected
    assert opts["session_id"] == SID and opts["resume"] is None and opts["agents"] and opts["cwd"] == worker.WORKER_CWD
    assert callable(opts["pretool_hook"]) and callable(opts["posttool_hook"])
    assert _turn_done_written(conn)
    update = next(sql for sql, _ in conn.executed if sql.startswith("UPDATE turns SET completed_at"))
    assert "cost_usd = COALESCE" in update and "output_tokens = COALESCE" in update
    assert summary["cost_usd"] == 0.01 and summary["num_turns"] == 1 and summary["resumed"] is False
    assert summary["events"] == 1 and summary["sdk_session_id"] == SID and summary["seq"] == 2, "text event, then turn_done"


def test_run_turn_resumes_when_the_store_already_holds_the_session(turn_env):
    turn_env["entries"] = True
    assert _run(turn_env, _good())["resumed"] is True
    assert turn_env["options"]["resume"] == SID and turn_env["options"]["session_id"] is None


@pytest.mark.parametrize("messages, error, match", [
    ([_init("other"), _text("x"), _result()], RuntimeError, "not the chosen"),
    ([_init(), MirrorErrorMessage(subtype="mirror_error", data={}, error="disk gone"), _result()], worker.MirrorError, "disk gone"),
    ([_init(), _text("x"), _result(is_error=True)], RuntimeError, "is_error"),
    ([_init(), _text("x")], RuntimeError, "without a ResultMessage"),
    ([_text("x"), _result()], RuntimeError, "never declared its session"),
], ids=["wrong-session-id", "mirror-error", "errored-result", "no-result", "no-init"])
def test_run_turn_fails_the_turn_on_each_guard_without_completing_it(turn_env, messages, error, match):
    with pytest.raises(error, match=match):
        _run(turn_env, messages)
    assert not _turn_done_written(turn_env["conn"]), "a failed turn stays open for the redelivery"
    assert turn_env["client"].disconnected, "the CLI is always released"


def test_run_turn_refuses_to_bill_when_the_registration_is_short(turn_env):
    with pytest.raises(worker.RegistrationError, match="gps-mentor"):
        _run(turn_env, _good(), info=_info(AGENTS - {"gps-mentor"}, 28))
    assert turn_env["client"].queried == [], "nothing sent to the model"
    assert turn_env["client"].disconnected and not _turn_done_written(turn_env["conn"])


# ── PostToolUse: the duration stamp (acceptance criterion 4) ──────────────────────


def test_the_row_carries_the_tool_use_id_and_the_post_hook_finishes_it(tmp_path):
    rows: list[dict] = []
    hook = _hook(rows, str(tmp_path), str(tmp_path / "cfg"))
    _call(hook, {"tool_name": "mcp__genealogy__place_search", "tool_input": {}, "tool_use_id": "toolu_1"})
    assert rows[-1]["tool_use_id"] == "toolu_1"
    finished: list[str] = []
    post = options.make_posttool_hook(turn_id="turn-1", finish=finished.append)
    assert _call(post, {"tool_name": "mcp__genealogy__place_search", "tool_input": {}, "tool_response": {},
                        "tool_use_id": "toolu_1"}) == {}
    assert finished == ["toolu_1"]


def test_the_post_hook_never_raises_and_stamps_nothing_without_an_id():
    logged: list[dict] = []

    def exploding_finish(_id: str) -> None:
        raise RuntimeError("postgres is down")

    post = options.make_posttool_hook(turn_id="t", finish=exploding_finish, log=lambda **f: logged.append(f))
    assert _call(post, {"tool_name": "x", "tool_input": {}, "tool_use_id": "toolu_2"}) == {}
    assert logged and logged[0]["ev"] == "tool_call_finish_failed" and logged[0]["tool_name"] == "x"
    finished: list[str] = []
    post = options.make_posttool_hook(turn_id="t", finish=finished.append)
    assert _call(post, "garbage") == {}  # type: ignore[arg-type]
    assert _call(post, {"tool_name": "x"}) == {}
    assert finished == []


def test_insert_tool_call_writes_the_tool_use_id_and_finish_stamps_the_open_row():
    conn = FakeConn()
    worker.insert_tool_call(conn, {"turn_id": "t", "session_id": "s", "tool_name": "Read", "decision": "allow",
                                   "tool_use_id": "toolu_9"})
    sql, params = conn.executed[-1]
    assert "tool_use_id" in sql and params[-1] == "toolu_9"
    worker.finish_tool_call(conn, "t", "toolu_9")
    sql, params = conn.executed[-1]
    assert sql.startswith("UPDATE tool_calls SET duration_ms") and "now() - ts" in sql
    assert "duration_ms IS NULL" in sql, "the first stamp wins; a redelivery cannot overwrite a completed call"
    assert params == ("t", "toolu_9") and conn.commits == 2


def test_options_bind_the_post_hook_on_success_and_on_failure(tmp_path):
    def post(*a):
        return {}

    opts = _options(config_dir=str(tmp_path), posttool_hook=post)
    assert set(opts.hooks) == {"PreToolUse", "PostToolUse", "PostToolUseFailure"}
    assert opts.hooks["PostToolUse"][0].hooks == [post] and opts.hooks["PostToolUseFailure"][0].hooks == [post]


# ── D18: the Stop hook (the harness's continue-nudge, ported) ─────────────────────


_INCOMPLETE = {"project": {"status": "in_progress"}}
_DONE = {"project": {"status": "completed"}}


@pytest.mark.parametrize("kw, expected", [
    # The truth table eval/harness/tests/unit/test_e2e_stop_checker.py pins, case for case.
    (dict(research=_INCOMPLETE, nudges_used=1, max_nudges=5, tool_count=12, tool_count_at_last_nudge=8), True),
    (dict(research=_DONE, nudges_used=0, max_nudges=5, tool_count=20, tool_count_at_last_nudge=-1), False),
    (dict(research=_INCOMPLETE, nudges_used=5, max_nudges=5, tool_count=30, tool_count_at_last_nudge=10), False),
    (dict(research=_INCOMPLETE, nudges_used=2, max_nudges=5, tool_count=15, tool_count_at_last_nudge=15), False),
    (dict(research=_INCOMPLETE, nudges_used=0, max_nudges=5, tool_count=5, tool_count_at_last_nudge=-1), True),
    (dict(research=_INCOMPLETE, nudges_used=1, max_nudges=5, tool_count=12, tool_count_at_last_nudge=8,
          mcp_unavailable=True), False),
    (dict(research=_INCOMPLETE, nudges_used=1, max_nudges=5, tool_count=12, tool_count_at_last_nudge=8,
          mcp_unavailable=False), True),
    # The worker's own edge: no research.json at all is not "completed".
    (dict(research=None, nudges_used=0, max_nudges=1, tool_count=0, tool_count_at_last_nudge=-1), True),
], ids=["progressing", "completed", "budget-spent", "no-progress", "first-nudge-equal-counts",
        "mcp-unavailable", "mcp-available-default", "no-research"])
def test_should_continue_run_mirrors_the_harness_truth_table(kw, expected):
    assert options.should_continue_run(**kw) is expected


def test_project_completed_reads_project_status_only():
    assert options.project_completed(_DONE) is True
    assert options.project_completed(_INCOMPLETE) is False
    assert options.project_completed(None) is False and options.project_completed({}) is False


def _stop(state: dict, *, max_nudges: int = 3, nudged: list | None = None, log=None, on_nudge=None):
    return options.make_stop_hook(
        turn_id="turn-1", max_nudges=max_nudges,
        research=lambda: state["research"], tool_count=lambda: state["count"],
        on_nudge=on_nudge or (nudged if nudged is not None else []).append, log=log,
    )


def test_the_stop_hook_blocks_a_vetoable_stop_with_the_harness_reason_verbatim():
    state = {"research": _INCOMPLETE, "count": 4}
    nudged: list[int] = []
    hook = _stop(state, nudged=nudged)
    assert _call(hook, {"stop_hook_active": False}) == {"decision": "block", "reason": options.CONTINUE_REASON}
    assert nudged == [1]
    # The reason is the orchestrator's, read off its source: among the dict literals
    # whose "decision" is "block", the one whose "reason" is a literal string is the
    # silent-stop fallback the worker mirrors. Since 2026-09-20 a second such dict
    # carries the "Yes." reply to a well-formed hand-back, whose reason is a NAME
    # (`reply`) rather than a constant, so it is skipped here by shape and named in
    # CONTINUE_REASON's comment — if that branch ever spells a literal too, this
    # collects two and fails, which is the re-sync this test exists to force.
    tree = ast.parse(ORCHESTRATOR.read_text(encoding="utf-8"))
    blocks = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Dict) and any(
            isinstance(k, ast.Constant) and k.value == "decision"
            and isinstance(v, ast.Constant) and v.value == "block"
            for k, v in zip(node.keys, node.values)
        )
    ]
    assert blocks, "the orchestrator no longer vetoes a stop with a block dict: re-read its stop_hook"
    reasons = [
        v.value
        for node in blocks
        for k, v in zip(node.keys, node.values)
        if isinstance(k, ast.Constant) and k.value == "reason" and isinstance(v, ast.Constant)
    ]
    assert reasons == [options.CONTINUE_REASON], \
        "the worker's reason text must stay the harness's silent-stop fallback, verbatim"


def test_the_stop_hook_counts_nudges_and_allows_once_the_cap_is_spent():
    state = {"research": _INCOMPLETE, "count": 0}
    nudged: list[int] = []
    hook = _stop(state, max_nudges=2, nudged=nudged)
    state["count"] = 1
    assert _call(hook, {})["decision"] == "block"
    state["count"] = 2
    assert _call(hook, {})["decision"] == "block"
    state["count"] = 3
    assert _call(hook, {}) == {}, "the cap is spent: the stop is allowed"
    assert nudged == [1, 2]


def test_the_stop_hook_allows_a_completed_project_and_a_stop_with_no_new_tool_call():
    state = {"research": _DONE, "count": 9}
    nudged: list[int] = []
    assert _call(_stop(state, nudged=nudged), {}) == {} and nudged == []
    state = {"research": _INCOMPLETE, "count": 5}
    hook = _stop(state, nudged=nudged)
    assert _call(hook, {})["decision"] == "block"
    assert _call(hook, {}) == {}, "no tool call since the nudge: another will not help"
    state["count"] = 6
    assert _call(hook, {})["decision"] == "block", "progress resumes the vetoes"
    assert nudged == [1, 2]


def test_the_stop_hook_never_raises():
    logged: list[dict] = []

    def exploding() -> dict:
        raise RuntimeError("postgres is down")

    hook = options.make_stop_hook(turn_id="turn-1", max_nudges=3, research=exploding, tool_count=lambda: 1,
                                  on_nudge=lambda n: None, log=lambda **f: logged.append(f))
    assert _call(hook, {}) == {}
    assert logged == [{"ev": "stop_hook_failed", "turn_id": "turn-1", "error": "RuntimeError: postgres is down"}]
    hook = options.make_stop_hook(turn_id="turn-1", max_nudges=3, research=lambda: _INCOMPLETE, tool_count=exploding,
                                  on_nudge=lambda n: None, log=lambda **f: logged.append(f))
    assert _call(hook, {}) == {} and logged[-1]["ev"] == "stop_hook_failed"

    def exploding_nudge(n: int) -> None:
        raise RuntimeError("log sink gone")

    hook = options.make_stop_hook(turn_id="turn-1", max_nudges=3, research=lambda: _INCOMPLETE, tool_count=lambda: 1,
                                  on_nudge=exploding_nudge, log=lambda **f: logged.append(f))
    assert _call(hook, {}) == {} and logged[-1]["error"] == "RuntimeError: log sink gone"
    # No log sink at all: still {}.
    hook = options.make_stop_hook(turn_id="turn-1", max_nudges=3, research=exploding, tool_count=lambda: 1,
                                  on_nudge=lambda n: None)
    assert _call(hook, "garbage") == {}  # type: ignore[arg-type]


def test_options_bind_a_stop_matcher_only_when_a_stop_hook_is_given(tmp_path):
    async def stop(*a):
        return {}

    opts = _options(config_dir=str(tmp_path), stop_hook=stop)
    [matcher] = opts.hooks["Stop"]
    assert matcher.matcher is None and matcher.hooks == [stop] and matcher.timeout == options.PRETOOL_TIMEOUT_S
    assert set(opts.hooks) == {"PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"}
    assert "Stop" not in _options(config_dir=str(tmp_path)).hooks, "the interactive stack: a yield to the user ends the turn"
    assert "Stop" not in _options(config_dir=str(tmp_path), stop_hook=None).hooks


def test_parse_max_nudges():
    assert worker.parse_max_nudges(None) == 0 and worker.parse_max_nudges("") == 0 and worker.parse_max_nudges(" 0 ") == 0
    assert worker.parse_max_nudges("20") == 20 and worker.parse_max_nudges(" 5\n") == 5
    with pytest.raises(ValueError):
        worker.parse_max_nudges("-1")
    with pytest.raises(ValueError):
        worker.parse_max_nudges("twenty")


def test_prepare_logs_a_bad_cap_and_runs_with_the_hook_off_instead_of_dying(monkeypatch):
    """A typo'd AUTONOMOUS_MAX_NUDGES must not crash-loop the worker (compose restarts it,
    and a demo then waits its whole deadline): the cap falls to 0 and one prepare line says why."""
    logged: list[dict] = []
    monkeypatch.setattr(worker, "log", lambda **f: logged.append(f))
    monkeypatch.setattr(worker, "ensure_cwd", lambda cwd: None)
    monkeypatch.setattr(worker, "apply_schema", lambda dsn: [])
    monkeypatch.setattr(worker, "load_plugin_agents", lambda plugin_dir: ({}, None))
    for name in ("_AGENTS", "_AGENTS_ERROR", "_BLOCKED", "_AUTONOMOUS_MAX_NUDGES"):
        monkeypatch.setattr(worker, name, getattr(worker, name))  # prepare() rebinds them; restored on teardown
    monkeypatch.delenv("BLOCKED_TOOLS", raising=False)
    monkeypatch.setenv("AUTONOMOUS_MAX_NUDGES", "abc")
    worker.prepare()
    assert worker._AUTONOMOUS_MAX_NUDGES == 0
    [bad] = [f for f in logged if f.get("ev") == "prepare" and f.get("step") == "nudges"]
    assert bad["error"].startswith("ValueError") and "abc" in bad["error"]
    assert next(f for f in logged if f.get("step") == "agents")["autonomous_max_nudges"] == 0
    logged.clear()
    monkeypatch.setenv("AUTONOMOUS_MAX_NUDGES", "20")
    worker.prepare()
    assert worker._AUTONOMOUS_MAX_NUDGES == 20 and not any(f.get("step") == "nudges" for f in logged)
    assert next(f for f in logged if f.get("step") == "agents")["autonomous_max_nudges"] == 20


def test_run_turn_wires_the_stop_hook_only_on_the_autonomous_arm_and_records_nudges(turn_env, monkeypatch):
    completed: list[dict] = []
    original = worker.complete

    def spy(conn, turn, rc, **kw):
        completed.append(kw)
        return original(conn, turn, rc, **kw)

    monkeypatch.setattr(worker, "complete", spy)
    monkeypatch.setattr(worker, "_AUTONOMOUS_MAX_NUDGES", 0)
    summary = _run(turn_env, _good())
    assert turn_env["options"]["stop_hook"] is None and summary["nudges"] == 0
    assert completed[-1]["nudges"] == 0
    monkeypatch.setattr(worker, "_AUTONOMOUS_MAX_NUDGES", 20)
    summary = _run(turn_env, _good())
    assert callable(turn_env["options"]["stop_hook"]) and summary["nudges"] == 0
    assert completed[-1]["nudges"] == 0
    update = next(sql for sql, _ in turn_env["conn"].executed if sql.startswith("UPDATE turns SET completed_at"))
    assert "nudges = COALESCE(%s, nudges)" in update


def test_the_wired_stop_hook_reads_research_and_the_tool_count_off_the_turns_connection(turn_env, monkeypatch):
    monkeypatch.setattr(worker, "_AUTONOMOUS_MAX_NUDGES", 2)
    logged: list[dict] = []
    monkeypatch.setattr(worker, "log", lambda **f: logged.append(f))
    conn = turn_env["conn"]
    conn.research, conn.tool_call_count = _INCOMPLETE, 3
    _run(turn_env, _good())
    hook = turn_env["options"]["stop_hook"]
    assert _call(hook, {"stop_hook_active": False}) == {"decision": "block", "reason": options.CONTINUE_REASON}
    assert [f for f in logged if f.get("ev") == "nudge"] == [{"ev": "nudge", "turn_id": "turn-1", "n": 1, "max": 2}]
    assert any("SELECT doc FROM documents" in s and p == ("proj-1",) for s, p in conn.executed), "research.json by project"
    assert any("SELECT count(*) FROM tool_calls" in s and p == ("turn-1",) for s, p in conn.executed), "the turn's calls"
    assert _call(hook, {}) == {}, "no new tool call: allowed"
    conn.tool_call_count = 4
    assert _call(hook, {})["decision"] == "block"
    conn.research, conn.tool_call_count = _DONE, 9
    assert _call(hook, {}) == {}, "completed: allowed"
    assert [f["n"] for f in logged if f.get("ev") == "nudge"] == [1, 2]


class NudgingClient(FakeClient):
    """The CLI's stream with two voluntary yields the Stop hook vetoes before the result."""

    def __init__(self, info, state) -> None:
        super().__init__([], info)
        self.state = state

    async def receive_response(self):
        yield _init()
        hook, conn = self.state["options"]["stop_hook"], self.state["conn"]
        conn.research, conn.tool_call_count = _INCOMPLETE, 1
        assert (await hook({"stop_hook_active": False}, None, {}))["decision"] == "block"
        conn.tool_call_count = 2
        assert (await hook({"stop_hook_active": True}, None, {}))["decision"] == "block"
        yield _text("done")
        yield _result()


def test_two_vetoes_land_on_the_turns_row_and_in_the_summary(turn_env, monkeypatch):
    monkeypatch.setattr(worker, "_AUTONOMOUS_MAX_NUDGES", 5)
    turn_env["client"] = NudgingClient(_info(AGENTS, 28), turn_env)
    summary = asyncio.run(worker.run_turn(TURN, 1, SID, agents={"gps-mentor": object()}))
    assert summary["nudges"] == 2
    sql, params = next((s, p) for s, p in turn_env["conn"].executed if s.startswith("UPDATE turns SET completed_at"))
    assert "nudges = COALESCE(%s, nudges)" in sql and params[-2] == 2, params


def test_read_research_and_count_tool_calls_read_the_rows():
    conn = FakeConn()
    conn.research, conn.tool_call_count = {"project": {"status": "x"}}, 7
    assert worker.read_research(conn, "proj-1") == {"project": {"status": "x"}}
    assert conn.executed[-1][1] == ("proj-1",) and "name = 'research.json'" in conn.executed[-1][0]
    assert worker.count_tool_calls(conn, "turn-1") == 7 and conn.executed[-1][1] == ("turn-1",)
    conn.research = ["not", "a", "dict"]
    assert worker.read_research(conn, "proj-1") is None
    conn.research = None
    assert worker.read_research(conn, "proj-1") is None

