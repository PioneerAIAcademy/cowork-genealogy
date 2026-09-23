"""Offline tests for proto/turn.py's generalised ``--kill`` arm (D14, widened for the D18
resume probes): the argument plumbing (``--kill-on``, ``--kill-after-s``, ``--text`` /
``--text-file``), the checks that run only with the default text, the bare-name match a
kill is timed on, the evidence block rendered from canned rows, and the arm's own sequence
(wait, sleep, marks, kill, start) with the stack faked. No Postgres, no stack, no model."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

from proto import demo, turn
from tests.test_proto_config import _recipe

SERVER = Path(__file__).resolve().parents[1]


def _args(*argv: str):
    return turn.build_parser().parse_args(["--kill", *argv])


# ── argument plumbing ───────────────────────────────────────────────────────────────


def test_default_spec_is_the_d14_arm():
    spec = turn.kill_spec(_args())
    assert spec == turn.KillSpec()
    assert spec.kill_on == "place_search" and spec.kill_after_s == 0.0 and spec.text == turn.TEXT_KILL
    assert spec.default_text and spec.session_id is None and spec.container == "proto-worker"


def test_kill_on_after_and_text_reach_the_spec():
    spec = turn.kill_spec(_args("--kill-on", "Agent", "--kill-after-s", "15", "--text", "/record-extraction x",
                                "--session", "sess_1", "--worker-container", "w"))
    assert spec.kill_on == "Agent" and spec.kill_after_s == 15.0 and spec.text == "/record-extraction x"
    assert not spec.default_text and spec.session_id == "sess_1" and spec.container == "w"


def test_text_file_is_read_as_utf8_and_stripped(tmp_path):
    path = tmp_path / "text.txt"
    path.write_text("  /record-extraction Find William A. Bagley’s death entry — Topsham.\n", encoding="utf-8")
    spec = turn.kill_spec(_args("--text-file", str(path)))
    assert spec.text == "/record-extraction Find William A. Bagley’s death entry — Topsham."
    assert not spec.default_text


def test_text_and_text_file_are_mutually_exclusive(tmp_path):
    path = tmp_path / "t.txt"
    path.write_text("x", encoding="utf-8")
    with pytest.raises(SystemExit):
        _args("--text", "x", "--text-file", str(path))


@pytest.mark.parametrize("argv", [("--text", ""), ("--text", "   ")])
def test_a_blank_message_is_refused_not_posted(argv):
    with pytest.raises(ValueError, match="empty"):
        turn.kill_spec(_args(*argv))


def test_a_blank_text_file_is_refused_and_a_missing_one_is_an_oserror(tmp_path):
    blank = tmp_path / "blank.txt"
    blank.write_text(" \n", encoding="utf-8")
    with pytest.raises(ValueError, match="empty"):
        turn.kill_spec(_args("--text-file", str(blank)))
    with pytest.raises(OSError):
        turn.kill_spec(_args("--text-file", str(tmp_path / "missing.txt")))


def test_a_negative_kill_after_is_refused():
    with pytest.raises(ValueError, match="kill-after-s"):
        turn.kill_spec(_args("--kill-after-s", "-1"))


@pytest.mark.parametrize("bad, said", [
    (lambda tmp: ["--text", " "], "empty"),
    (lambda tmp: ["--text-file", str(tmp / "missing.txt")], "missing.txt"),
], ids=["blank --text", "missing --text-file"])
def test_main_exits_2_on_a_bad_kill_spec_before_touching_the_stack(monkeypatch, capsys, tmp_path, bad, said):
    """A blank message (ValueError) and a missing --text-file (OSError) both exit 2 with the
    reason on stderr before the health probe -- neither is a traceback."""
    monkeypatch.setattr(turn.httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("stack touched")))
    assert turn.main(["--kill", *bad(tmp_path)]) == 2
    err = capsys.readouterr().err
    assert said in err and "Traceback" not in err


# ── the checks: two are about the default text ──────────────────────────────────────


def _rows(**over) -> turn.KillRows:
    base = dict(turn_row=(2, "2026-09-20T10:00:00+00:00", "ok", 0.117), sdk_before="sdk-1", sdk_after="sdk-1",
                entries_at_kill=11, entries_after=24, kill_calls=[("allow", None), ("allow", 1310)],
                summaries=["Nauvoo, Hancock, Illinois, United States"], reply="It is Nauvoo, Hancock, Illinois.")
    base.update(over)
    return turn.KillRows(**base)


def test_the_default_text_keeps_the_bearer_and_nauvoo_checks_and_a_custom_text_drops_them():
    default = turn.kill_checks(_rows(), turn.KillSpec())
    custom = turn.kill_checks(_rows(), turn.KillSpec(kill_on="Agent", text="/record-extraction x"))
    names_default = [name for name, _, _ in default]
    names_custom = [name for name, _, _ in custom]
    assert len(default) == 7 and len(custom) == 5
    assert any("bearer" in n for n in names_default) and any("Nauvoo" in n for n in names_default)
    assert not any("bearer" in n or "Nauvoo" in n for n in names_custom)
    assert names_custom == [n.replace("place_search", "Agent") for n in names_default[:5]], "the other five stay, named for the kill-on tool"
    assert all(ok for _, ok, _ in default) and all(ok for _, ok, _ in custom)


def test_each_check_reads_its_row():
    def failed(rows: turn.KillRows, spec: turn.KillSpec = turn.KillSpec()) -> list[str]:
        return [name for name, ok, _ in turn.kill_checks(rows, spec) if not ok]

    # Read off the checks themselves. This one's wording carries the outcome set, which
    # grew when 1c made turns.outcome say HOW a run ended -- repeating the sentence here
    # made the test fail on the wording rather than on the behaviour.
    REDELIVERED = "kill: the turn was redelivered (receive_count >= 2)"
    COMPLETED = next(n for n, _, _ in turn.kill_checks(_rows(), turn.KillSpec())
                     if n.startswith("kill: completed with"))

    assert failed(_rows(turn_row=(1, "t", "ok", 0.1))) == [REDELIVERED]
    assert failed(_rows(turn_row=(2, None, None, None))) == [COMPLETED]
    assert failed(_rows(turn_row=None)) == [REDELIVERED, COMPLETED]
    assert failed(_rows(sdk_after="sdk-2")) == ["kill: the same SDK session resumed, not a new one"]
    assert failed(_rows(entries_after=11)) == ["kill: session_entries grew past the kill"]
    assert failed(_rows(kill_calls=[("allow", None)])) == ["kill: a place_search call completed with a duration (criterion 4)"]
    assert failed(_rows(kill_calls=[("deny", 5)])) == ["kill: a place_search call completed with a duration (criterion 4)"]
    assert failed(_rows(summaries=["Call the login tool to authenticate."])) == \
        ["kill: place_search answered with the bearer (no reconnect instruction)"]
    assert failed(_rows(summaries=[])) == ["kill: place_search answered with the bearer (no reconnect instruction)"]
    assert failed(_rows(reply="Somewhere else")) == ["kill: the reply names Nauvoo"]


# ── the kill-on match, by bare name ─────────────────────────────────────────────────


@pytest.mark.parametrize("tool_name, bare, expected", [
    ("Agent", "Agent", True),
    ("mcp__genealogy__place_search", "place_search", True),
    ("mcp__remote-devices__Genealogy_Research__place_search", "place_search", True),
    ("mcp__Genealogy_Research__place_search", "place_search", True),
    ("mcp__genealogy__place_search_all", "place_search", False),   # never a suffix match
    ("mcp__genealogy__xplace_search", "place_search", False),
    ("MyAgent", "Agent", False),
    ("Agent", "place_search", False),
    ("place_search", "place_search", True),                       # a bare row name matches itself
    ("mcp__genealogy__Agent", "Agent", True),                      # an MCP tool spelled Agent would match too
    ("", "Agent", False),
])
def test_matches_bare(tool_name, bare, expected):
    assert turn.matches_bare(tool_name, bare) is expected


def test_wait_for_tool_call_sees_the_row_by_bare_name_and_reports_a_turn_that_finished_without_one(monkeypatch):
    names = [("mcp__genealogy__record_search",), ("Agent",)]
    monkeypatch.setattr(turn, "db", lambda dsn, sql, params: list(names))
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: None)
    assert turn.wait_for_tool_call("dsn", "t", "Agent", 1.0) == "seen"
    assert turn.wait_for_tool_call("dsn", "t", "record_search", 1.0) == "seen"
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: "2026-09-20T10:00:00+00:00")
    assert turn.wait_for_tool_call("dsn", "t", "extraction_append", 1.0) == "completed", "no row and completed_at set"
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: None)
    monkeypatch.setattr(turn.time, "sleep", lambda s: None)
    clock = iter([0.0, 0.0, 0.5, 2.0, 2.0, 2.0])
    monkeypatch.setattr(turn.time, "monotonic", lambda: next(clock))
    assert turn.wait_for_tool_call("dsn", "t", "extraction_append", 1.0) == "timeout"


def test_run_kill_uses_the_input_selector_when_one_is_given(monkeypatch):
    """The whole point of 0a's probe is selecting a BACKGROUND delegation, and the choice
    between the two waiters is where that happens. Reverting it broke no test: the
    selector had unit tests, but nothing asserted run_kill ever reaches for it, so the
    probe would have silently fallen back to the name-only wait that already resumed
    cleanly on 2026-09-20."""
    used: list[str] = []
    monkeypatch.setattr(turn, "wait_for_tool_call",
                        lambda dsn, tid, tool, dl: used.append("by-name") or "completed")
    monkeypatch.setattr(turn, "wait_for_tool_input",
                        lambda dsn, sid, tid, tool, sel, dl: used.append("by-input") or "completed")
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: "proj-1")
    monkeypatch.setattr(turn, "post_message", lambda client, base, sid, text: "turn_x")

    import httpx

    class _Client:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **k): raise AssertionError("session creation should not be reached")
    monkeypatch.setattr(httpx, "Client", lambda **kw: _Client())

    # With a selector -> the input waiter.
    turn.run_kill("http://x", "dsn", 1.0, turn.KillSpec(
        kill_on="Agent", kill_on_input={"run_in_background": True}, session_id="sess-1"))
    assert used == ["by-input"], used

    # Without one -> the original name-only waiter, unchanged.
    used.clear()
    turn.run_kill("http://x", "dsn", 1.0, turn.KillSpec(session_id="sess-1"))
    assert used == ["by-name"], used


def test_the_kill_check_fails_only_on_a_resume_that_did_nothing():
    """1c made turns.outcome say HOW a run ended, so the old `== "ok"` literal would have
    failed the resume probe on a run that WORKED. `budget` is the case that makes the
    point: proto-probe-resume runs a narrow message with the Stop hook on, so exhausting
    the nudge cap without finishing the project is its ORDINARY shape -- and the resume
    still worked, which is the only thing this probe measures.

    Stated as a failure set, so a terminal value added later reads as "the resume worked"
    unless someone decides otherwise."""
    def outcome_check(outcome):
        rows = _rows(turn_row=(2, "done", outcome, 0.42))
        return [ok for name, ok, _ in turn.kill_checks(rows, turn.KillSpec())
                if name.startswith("kill: completed with")][0]

    for worked in ("ok", "completed", "queued", "stopped", "budget", "decision", "mcp_unavailable"):
        assert outcome_check(worked) is True, worked
    assert outcome_check("no_progress") is False, "a dead resume is the one thing this probe catches"
    assert outcome_check(None) is False, "no outcome at all is not a completed turn"
    assert turn.RESUMED_FAILED_OUTCOMES == frozenset({"no_progress"})


# ── 0a: the input selector (--kill-on-input) ────────────────────────────────────────


@pytest.mark.parametrize("text, expected", [
    ("run_in_background=true", {"run_in_background": True}),
    ("run_in_background=false", {"run_in_background": False}),
    ("limit=5", {"limit": 5}),
    ('description="two at once"', {"description": "two at once"}),
    ("description=two at once", {"description": "two at once"}),
    ("subagent_type=record-extractor", {"subagent_type": "record-extractor"}),
    (None, None),
    ("", None),
])
def test_parse_input_selector_reads_json_values_and_falls_back_to_a_bare_string(text, expected):
    """The first row is the one that matters: the SDK writes a JSON boolean, so a selector
    carrying the STRING "true" would match nothing and the probe would burn its billed hour
    looking exactly like "the model never chose a background delegation"."""
    assert turn.parse_input_selector(text) == expected


@pytest.mark.parametrize("bad", ["nokey", "=true", "  =true"])
def test_a_selector_without_a_key_is_refused(bad):
    with pytest.raises(ValueError, match="KEY=VALUE"):
        turn.parse_input_selector(bad)


def test_the_selector_reaches_the_spec_and_names_itself_in_the_checks(tmp_path):
    spec = turn.kill_spec(_args("--kill", "--kill-on", "Agent",
                                "--kill-on-input", "run_in_background=true"))
    assert spec.kill_on_input == {"run_in_background": True}
    assert spec.target == "Agent(run_in_background=true)", "a check line has to say which call it waited for"
    assert turn.KillSpec().kill_on_input is None and turn.KillSpec().target == "place_search", \
        "the D14 arm is unchanged when no selector is given"


def test_wait_for_tool_input_matches_on_the_call_input_not_the_tool_name(monkeypatch):
    """The selector reads session_entries, because tool_calls has no input column. The
    fake here stands in for the jsonb containment: `db` answers only when the fragment the
    waiter passes is the one the caller asked for."""
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: "sdk-1" if "sdk_session_id" in sql else None)

    def fake_db(dsn, sql, params):
        assert "session_entries" in sql and "tool_use" in sql and "@>" in sql, sql
        _sdk, fragment = params
        return [("Agent",)] if fragment == '{"run_in_background": true}' else []

    monkeypatch.setattr(turn, "db", fake_db)
    assert turn.wait_for_tool_input("dsn", "s", "t", "Agent", {"run_in_background": True}, 1.0) == "seen"
    # A FOREGROUND Agent call is the case that already resumed cleanly on 2026-09-20 --
    # the selector must not answer "seen" for it.
    monkeypatch.setattr(turn.time, "sleep", lambda s: None)
    clock = iter([0.0, 0.0, 0.5, 2.0, 2.0, 2.0])
    monkeypatch.setattr(turn.time, "monotonic", lambda: next(clock))
    assert turn.wait_for_tool_input("dsn", "s", "t", "Agent", {"run_in_background": False}, 1.0) == "timeout"


def test_wait_for_tool_input_reports_a_turn_that_finished_without_the_call(monkeypatch):
    monkeypatch.setattr(turn, "db", lambda dsn, sql, params: [])
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: "sdk-1" if "sdk_session_id" in sql else "2026-09-20")
    assert turn.wait_for_tool_input("dsn", "s", "t", "Agent", {"run_in_background": True}, 1.0) == "completed"


def test_wait_for_tool_input_re_reads_the_sdk_session_id_every_poll(monkeypatch):
    """The worker writes sessions.sdk_session_id at claim time, which can be after this
    starts. Reading it once would send every later query against NULL and the probe would
    time out having polled an empty string."""
    reads = {"n": 0}

    def fake_one(dsn, sql, params):
        if "sdk_session_id" in sql:
            reads["n"] += 1
            return None if reads["n"] == 1 else "sdk-1"
        return None

    monkeypatch.setattr(turn, "one", fake_one)
    monkeypatch.setattr(turn, "db", lambda dsn, sql, params: [("Agent",)])
    monkeypatch.setattr(turn.time, "sleep", lambda s: None)
    assert turn.wait_for_tool_input("dsn", "s", "t", "Agent", {"run_in_background": True}, 5.0) == "seen"
    assert reads["n"] >= 2, "a single NULL read must not poison the rest of the poll"


# ── the evidence block: a pure function of canned rows ──────────────────────────────


def test_entry_brief_reads_text_tool_use_tool_result_and_result_entries():
    assistant = {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "text", "text": "Delegating  to\n record-extractor."},
        {"type": "tool_use", "name": "Agent", "input": {"subagent_type": "record-extractor"}},
    ]}}
    assert turn.entry_brief(assistant) == "Delegating to record-extractor. tool_use:Agent"
    user = {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "x", "content": [{"type": "text", "text": "No completion record"}]},
    ]}}
    assert turn.entry_brief(user) == "tool_result:No completion record"
    string_result = {"type": "user", "message": {"content": [{"type": "tool_result", "content": "done"}]}}
    assert turn.entry_brief(string_result) == "tool_result:done"
    result = {"type": "result", "subtype": "success", "result": "No response requested.", "num_turns": 0}
    assert turn.entry_brief(result) == "No response requested."
    plain = {"type": "user", "message": {"content": "continue"}}
    assert turn.entry_brief(plain) == "continue"
    summary = {"type": "summary", "summary": "the gist"}
    assert turn.entry_brief(summary) == "the gist"
    other = {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "..."}]}}
    assert turn.entry_brief(other) == "thinking"
    assert turn.entry_brief("not a dict") == "not a dict"
    assert turn.entry_brief({"type": "system"}) == ""


def test_entry_brief_caps_at_the_limit():
    long = {"type": "assistant", "message": {"content": [{"type": "text", "text": "x" * 500}]}}
    assert len(turn.entry_brief(long)) == 200
    assert len(turn.entry_brief(long, limit=10)) == 10


def _evidence() -> turn.KillEvidence:
    return turn.KillEvidence(
        turn_row={"receive_count": 2, "num_turns": 0, "cost_usd": 0.0, "nudges": 0, "duration_ms": 10,
                  "outcome": "ok", "completed_at": "2026-09-20T10:05:00+00:00"},
        calls_after=[("Agent", None, "allow", 91000), ("mcp__genealogy__extraction_append", "record-extractor", "allow", 412)],
        entries_after=[(25, "", "user", "continue"), (26, "", "assistant", "tool_use:Agent"),
                       (27, "agent-abc", "user", "tool_result:No completion record"), (28, "", "result", "No response requested.")],
        sections_before=[("assertions", 0), ("log", 1), ("sources", 0)],
        sections_after=[("assertions", 12), ("log", 2), ("sources", 1), ("questions", 1)],
        texts_after=["No response requested.", "Extracted 12 assertions."],
    )


def test_render_evidence_prints_every_section_with_its_rows():
    out = turn.render_evidence(_evidence())
    lines = out.splitlines()
    assert lines[0] == "-- evidence: the turns row"
    assert lines[1].strip() == "receive_count=2  num_turns=0  cost_usd=0.0  nudges=0  duration_ms=10  outcome=ok  completed_at=2026-09-20T10:05:00+00:00"
    assert "-- evidence: tool_calls rows written after the kill (2)" in lines
    assert "   Agent  agent_type=None  allow  duration_ms=91000" in lines
    assert "   mcp__genealogy__extraction_append  agent_type=record-extractor  allow  duration_ms=412" in lines
    assert "-- evidence: session_entries rows appended after the kill (4)" in lines
    assert "   seq=25  user  'continue'" in lines
    assert "   seq=27  agent-abc  user  'tool_result:No completion record'" in lines, "a subagent's subpath is shown"
    assert "   seq=28  result  'No response requested.'" in lines
    assert "-- evidence: research.json array sections, before the kill -> after turn_done" in lines
    assert "   assertions  0 -> 12  (+12)" in lines
    assert "   log  1 -> 2  (+1)" in lines
    assert "   questions  0 -> 1  (+1)" in lines, "a section absent before the kill counts from 0"
    assert "   sources  0 -> 1  (+1)" in lines
    assert "-- evidence: text events after the kill (2)" in lines
    assert "   'No response requested.'" in lines and "   'Extracted 12 assertions.'" in lines


def test_render_evidence_marks_unchanged_sections_and_empty_lists():
    ev = turn.KillEvidence(sections_before=[("assertions", 3)], sections_after=[("assertions", 3)])
    out = turn.render_evidence(ev)
    lines = out.splitlines()
    assert lines[1].strip() == "(no row)"
    assert "   assertions  3 -> 3" in lines and "(+0)" not in out
    assert lines.count("   (none)") == 3, "tool_calls, session_entries and text events each say (none)"
    empty = turn.render_evidence(turn.KillEvidence())
    assert "   (no research.json row)" in empty.splitlines()


def test_render_evidence_signs_a_shrinking_section():
    ev = turn.KillEvidence(sections_before=[("assertions", 1), ("log", 1)], sections_after=[("assertions", 3)])
    lines = turn.render_evidence(ev).splitlines()
    assert "   assertions  1 -> 3  (+2)" in lines
    assert "   log  1 -> 0  (-1)" in lines, "a section that shrank or vanished is signed -1, never +-1"


def test_render_evidence_caps_text_events_and_quotes_them():
    out = turn.render_evidence(turn.KillEvidence(texts_after=["y" * 400]))
    line = next(line for line in out.splitlines() if line.startswith("   'y"))
    assert line == "   " + repr("y" * 300)


def test_gather_evidence_keys_the_turn_row_and_briefs_the_entries(monkeypatch):
    marks = turn.KillMarks(calls_id=7, entries_seq=24, events_seq=40, sections_before=[("sources", 0)])
    seen: list[tuple[str, tuple]] = []

    def fake_db(dsn, sql, params):
        seen.append((sql, params))
        if sql.startswith("SELECT receive_count, num_turns"):
            return [(2, 0, 0.0, 0, 10, "ok", "done")]
        if "FROM tool_calls" in sql:
            return [("Agent", None, "allow", None)]
        if "FROM session_entries" in sql:
            return [(25, "", {"type": "result", "result": "No response requested."})]
        if "jsonb_array_length" in sql:
            return [("sources", 1)]
        if "kind = 'text'" in sql:
            return [("hi",)]
        raise AssertionError(sql)

    monkeypatch.setattr(turn, "db", fake_db)
    ev = turn.gather_evidence("dsn", "sess", "turn", "sdk", "proj", marks)
    assert ev.turn_row == {"receive_count": 2, "num_turns": 0, "cost_usd": 0.0, "nudges": 0, "duration_ms": 10,
                           "outcome": "ok", "completed_at": "done"}
    assert ev.calls_after == [("Agent", None, "allow", None)]
    assert ev.entries_after == [(25, "", "result", "No response requested.")]
    assert ev.sections_before == [("sources", 0)] and ev.sections_after == [("sources", 1)] and ev.texts_after == ["hi"]
    # every "after the kill" query is bounded by the mark taken at the kill
    assert any("id > %s" in sql and params == ("turn", 7) for sql, params in seen)
    assert any("seq > %s" in sql and params == ("sdk", 24) for sql, params in seen)
    assert any("kind = 'text'" in sql and params == ("sess", 40) for sql, params in seen)


# ── run_kill's own sequence, the stack faked ─────────────────────────────────────────


def _fake_stack(monkeypatch, order: list[str], wait_outcome: str = "seen") -> None:
    """Every side effect of run_kill recorded in ``order`` and nothing real touched: the
    session lookups answer a constant, the kill-on wait returns ``wait_outcome``, and the
    turn_done wait times out, so the arm returns at its 'not reached turn_done' branch."""
    monkeypatch.setattr(turn, "one", lambda dsn, sql, params: 7 if "count(*)" in sql else "v")
    monkeypatch.setattr(turn, "post_message", lambda client, base, session_id, text: "turn_x")

    def wait_for_tool_call(dsn, turn_id, tool, deadline_s):
        order.append(f"wait_for_tool_call {tool} deadline={deadline_s}")
        return wait_outcome

    def take_marks(*args):
        order.append("take_marks")
        return turn.KillMarks(calls_id=0, entries_seq=0, events_seq=0, sections_before=[])

    def wait_turn_done(client, base, session_id, turn_id, deadline_s):
        order.append("wait_turn_done")
        raise TimeoutError("no turn_done")

    def gather_evidence(*args):
        order.append("gather_evidence")
        return turn.KillEvidence()

    monkeypatch.setattr(turn, "wait_for_tool_call", wait_for_tool_call)
    monkeypatch.setattr(turn.time, "sleep", lambda s: order.append(f"sleep {s}"))
    monkeypatch.setattr(turn, "take_marks", take_marks)
    monkeypatch.setattr(turn, "docker", lambda *args: order.append("docker " + " ".join(args)))
    monkeypatch.setattr(turn, "wait_turn_done", wait_turn_done)
    monkeypatch.setattr(turn, "gather_evidence", gather_evidence)


def test_run_kill_waits_the_whole_deadline_for_the_kill_on_row_and_kills_nothing_without_it(monkeypatch):
    order: list[str] = []
    _fake_stack(monkeypatch, order, wait_outcome="timeout")
    spec = turn.KillSpec(kill_on="Agent", kill_after_s=15.0, text="x", session_id="sess_1")
    checks, figures = turn.run_kill("http://x", "dsn", 4321.0, spec)
    assert order == ["wait_for_tool_call Agent deadline=4321.0"], "the full --deadline-s, then no sleep, marks or kill"
    assert checks == [("kill: the turn reached its first Agent call", False, "no tool_calls row in time")]
    assert figures == {"session_id": "sess_1", "turn_id": "turn_x"}


@pytest.mark.parametrize("kill_after_s, sleeps", [(0.0, []), (15.0, ["sleep 15.0"])], ids=["at once", "after 15 s"])
def test_run_kill_sleeps_kill_after_s_then_takes_its_marks_before_the_kill(monkeypatch, capsys, kill_after_s, sleeps):
    order: list[str] = []
    _fake_stack(monkeypatch, order)
    spec = turn.KillSpec(kill_on="Agent", kill_after_s=kill_after_s, text="x", session_id="sess_1", container="w")
    checks, figures = turn.run_kill("http://x", "dsn", 100.0, spec)
    assert order == ["wait_for_tool_call Agent deadline=100.0", *sleeps, "take_marks", "docker kill w", "docker start w",
                     "wait_turn_done", "gather_evidence"]
    assert [ok for _, ok, _ in checks] == [True, False]
    assert figures["kill_after_s"] == kill_after_s and figures["entries_at_kill"] == 7
    assert "-- evidence: the turns row" in capsys.readouterr().out, "the evidence block prints even without turn_done"


# ── the script runs standalone ──────────────────────────────────────────────────────


def test_turn_py_never_imports_the_proto_package():
    """`python proto/turn.py` puts proto/ on sys.path, not apps/server, so a `from proto import
    demo` (even a lazy one) is a ModuleNotFoundError at run time -- which is how probe 1 died
    one line before its kill on 2026-09-20. demo.py imports turn, never the reverse."""
    source = (Path(turn.__file__)).read_text(encoding="utf-8")
    assert not re.search(r"^\s*(from proto\b|import proto\b)", source, re.M), "turn.py must not import the proto package"
    assert demo.section_counts_sql is turn.section_counts_sql, "one definition, owned by turn.py"


def test_turn_py_runs_as_a_script_from_apps_server():
    proc = subprocess.run([sys.executable, "proto/turn.py", "--help"], cwd=SERVER, capture_output=True,
                          text=True, encoding="utf-8")
    assert proc.returncode == 0, proc.stderr
    assert "--kill-on" in proc.stdout and "--kill-after-s" in proc.stdout and "--text-file" in proc.stdout


# ── the make target ─────────────────────────────────────────────────────────────────


def test_proto_kill_target_passes_args_through_to_the_arm():
    body = "\n".join(_recipe("proto-kill"))
    assert re.search(r'\$\(MAKE\) proto-turn ARGS="--kill .*\$\(ARGS\)"', body), body
    assert re.search(r"\$\(if \$\(SESSION\),\s*--session \$\(SESSION\),\s*\)", body), body
