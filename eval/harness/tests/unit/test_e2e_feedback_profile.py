"""Tests for `make feedback-profile` (`e2e/feedback_profile.py`).

Every bundle here is SYNTHETIC, built in `tmp_path` from Claude-Code-shaped
lines; no real feedback bundle enters the repo (docs/alpha-feedback-guide.md).
"""

from __future__ import annotations

import json
import tempfile
import zipfile
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from e2e import feedback_profile as fp

T0 = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)
SESSION = "5e55a0b1-0000-4000-8000-000000000001"


def _at(seconds: float) -> str:
    return (T0 + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def _user(uuid: str, seconds: float, content) -> dict:
    return {"type": "user", "uuid": uuid, "sessionId": SESSION, "timestamp": _at(seconds),
            "message": {"role": "user", "content": content}}


def _assistant(uuid: str, seconds: float, msg_id: str, blocks: list, usage: dict | None = None) -> dict:
    return {"type": "assistant", "uuid": uuid, "sessionId": SESSION, "timestamp": _at(seconds),
            "message": {"role": "assistant", "id": msg_id, "model": "claude-sonnet-4-6",
                        "content": blocks, "usage": usage or {"input_tokens": 10, "output_tokens": 5}}}


def _result(tool_use_id: str, text: str) -> list:
    return [{"type": "tool_result", "tool_use_id": tool_use_id, "content": text}]


def _write_bundle(root: Path, name: str, main_rows: list, agents: dict | None = None) -> Path:
    fb = root / name / "_feedback"
    fb.mkdir(parents=True)
    (fb / "feedback.json").write_text(json.dumps({"submitted_at": "2026-10-18T13:00:00Z"}), encoding="utf-8")
    (fb / "session-log.jsonl").write_text("".join(json.dumps(r) + "\n" for r in main_rows), encoding="utf-8")
    for aid, (meta, rows) in (agents or {}).items():
        (fb / "subagents").mkdir(exist_ok=True)
        (fb / "subagents" / f"agent-{aid}.meta.json").write_text(json.dumps(meta), encoding="utf-8")
        (fb / "subagents" / f"agent-{aid}.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return root / name


def _profile(*bundle_dirs: Path, since: float | None = None) -> dict:
    with ExitStack() as stack:
        corpus = fp.load_bundles(fp.resolve_inputs([str(d) for d in bundle_dirs], stack))
        return fp.build_profile(corpus, since)


def _agent_run(paused_gap: float) -> list:
    """A subagent transcript from t=11 to t=1811, idle for `paused_gap` seconds
    between t=100 and its next event."""
    resume = 100 + paused_gap
    return [
        _user("a1", 11, "extract the record"),
        _assistant("a2", 100, "msg_a1", [{"type": "tool_use", "id": "tu_read", "name": "Read",
                                          "input": {"file_path": "/project/research.json"}}]),
        _user("a3", resume, _result("tu_read", "{}")),
        *[_assistant(f"a{4 + i}", t, f"msg_a{2 + i}", [{"type": "text", "text": "x"}])
          for i, t in enumerate(range(int(resume) + 500, 1811, 500))],
        _assistant("a_end", 1811, "msg_end", [{"type": "text", "text": "done"}]),
    ]


def _waiting_session(background: bool = False) -> list:
    """The main thread launches agent `a1` at t=10 and hears back at t=1810: its
    `Agent` result, or for a background launch an immediate ack and then a
    `<task-notification>`."""
    launch = _assistant("m2", 10, "msg_m1", [{"type": "tool_use", "id": "tu_agent", "name": "Agent", "input": {
        "subagent_type": "genealogy-research:record-extractor", "description": "extract", "prompt": "go",
        "run_in_background": background}}])
    if background:
        middle = [_user("m3a", 11, _result("tu_agent", "Async agent launched successfully.")),
                  _assistant("m3b", 12, "msg_m1b", [{"type": "text", "text": "Waiting on it."}]),
                  _user("m3", 1810, "<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>")]
    else:
        middle = [_user("m3", 1810, _result("tu_agent", "extracted"))]
    return [_user("m1", 0, "extract it"), launch, *middle,
            _assistant("m4", 1820, "msg_m2", [{"type": "text", "text": "done"}])]


AGENT_META = {"agentType": "genealogy-research:record-extractor", "description": "extract",
              "toolUseId": "tu_agent", "spawnDepth": 1}


@pytest.mark.parametrize("background", [False, True], ids=["agent-result", "task-notification"])
def test_a_long_agent_wait_is_agent_time_not_a_pause(tmp_path, background):
    bundle = _write_bundle(tmp_path, "feedback-a", _waiting_session(background),
                           {"a1": (AGENT_META, _agent_run(paused_gap=400))})
    session = _profile(bundle)["sessions"][0]
    assert session["paused_min"] == 0.0
    assert session["active_min"] == round(1820 / 60, 1)
    assert session["agent_wait_min"] == round(1800 / 60, 1)


@pytest.mark.parametrize("background", [False, True], ids=["agent-result", "task-notification"])
def test_the_agent_s_own_pause_is_still_a_pause(tmp_path, background):
    bundle = _write_bundle(tmp_path, "feedback-a", _waiting_session(background),
                           {"a1": (AGENT_META, _agent_run(paused_gap=700))})
    session = _profile(bundle)["sessions"][0]
    assert session["paused_min"] == round(700 / 60, 1)
    assert session["agent_wait_min"] == round(1100 / 60, 1)
    assert session["active_min"] == round(1120 / 60, 1)


def test_a_real_idle_gap_is_a_pause(tmp_path):
    rows = [
        _user("m1", 0, "who were his parents?"),
        _assistant("m2", 6, "msg_m1", [{"type": "text", "text": "Here is the plan."}]),
        _user("m3", 3606, "keep going"),
        _assistant("m4", 3612, "msg_m2", [{"type": "tool_use", "id": "tu_1", "name": "Read",
                                           "input": {"file_path": "/project/tree.gedcomx.json"}}]),
        _assistant("m5", 4812, "msg_m2", [{"type": "text", "text": "ok"}]),
    ]
    session = _profile(_write_bundle(tmp_path, "feedback-a", rows))["sessions"][0]
    assert session["paused_min"] == round((3600 + 1200) / 60, 1)
    assert session["active_min"] == round(12 / 60, 1)
    assert session["agent_wait_min"] == 0.0


def test_a_message_is_priced_from_its_last_usage_line(tmp_path):
    first = {"input_tokens": 3, "output_tokens": 7, "cache_read_input_tokens": 100_000,
             "cache_creation_input_tokens": 10_000,
             "cache_creation": {"ephemeral_5m_input_tokens": 10_000, "ephemeral_1h_input_tokens": 0}}
    last = dict(first, output_tokens=20_000)
    rows = [
        _user("a1", 11, "extract the record"),
        _assistant("a2", 20, "msg_x", [{"type": "thinking", "thinking": ""}], first),
        _assistant("a3", 40, "msg_x", [{"type": "text", "text": "the record names his father"}], last),
    ]
    bundle = _write_bundle(tmp_path, "feedback-a", _waiting_session(), {"a1": (AGENT_META, rows)})
    agent = _profile(bundle)["agents"][0]
    expected = (3 * 3.00 + 20_000 * 15.00 + 100_000 * 0.30 + 10_000 * 3.00 * 1.25) / 1_000_000
    assert agent["output_tokens"] == 20_000
    assert agent["cost_total"] == round(expected, 2)


def test_only_a_call_after_an_agent_that_misses_the_cache_is_a_rewrite(tmp_path):
    def agent_call(uuid, t, msg_id, tool_use_id, read, write):
        return _assistant(uuid, t, msg_id, [{"type": "tool_use", "id": tool_use_id, "name": "Agent",
                                             "input": {"subagent_type": "x", "prompt": "go"}}],
                          {"input_tokens": 5, "cache_read_input_tokens": read, "cache_creation_input_tokens": write})

    rows = [
        _user("m1", 0, "go"),
        agent_call("m2", 10, "msg_1", "tu_1", read=40_000, write=10_000),
        _user("m3", 910, _result("tu_1", "done")),
        agent_call("m4", 920, "msg_2", "tu_2", read=27_000, write=30_000),
        _user("m5", 980, _result("tu_2", "done")),
        _assistant("m6", 990, "msg_3", [{"type": "text", "text": "ok"}],
                   {"input_tokens": 5, "cache_read_input_tokens": 57_004, "cache_creation_input_tokens": 500}),
        _user("m7", 2000, "and now?"),
        _assistant("m8", 2010, "msg_4", [{"type": "text", "text": "ok"}],
                   {"input_tokens": 5, "cache_read_input_tokens": 27_000, "cache_creation_input_tokens": 31_000}),
    ]
    session = _profile(_write_bundle(tmp_path, "feedback-a", rows))["sessions"][0]
    assert session["cache_rewrites"] == 1
    assert session["cache_rewrite_cost"] == round((50_005 - 27_000) * (3.00 * 1.25 - 0.30) / 1_000_000, 2)


def test_two_bundles_of_one_session_count_it_once(tmp_path):
    rows = [
        _user("m1", 0, "This session is being continued from a previous conversation."),
        *_waiting_session()[1:],
        _user("m5", 1830, "and the mother?"),
        _assistant("m6", 1840, "msg_m3", [{"type": "text", "text": "Her name is on the record."}]),
    ]
    short_agent = _agent_run(paused_gap=400)[:3]
    first = _write_bundle(tmp_path, "feedback-1", rows[:4], {"a1": (AGENT_META, short_agent)})
    second = _write_bundle(tmp_path, "feedback-2", rows, {"a1": (AGENT_META, _agent_run(paused_gap=400))})
    profile = _profile(first, second)
    assert len(profile["sessions"]) == 1
    session = profile["sessions"][0]
    assert session["bundles"] == ["feedback-1", "feedback-2"]
    assert session["compactions"] == 1
    assert session["main_model_calls"] == 3
    assert session["active_min"] == round(1840 / 60, 1)
    assert [(a["agent_type"], a["runs"], a["active_min_total"]) for a in profile["agents"]] == \
        [("record-extractor", 1, round(1800 / 60, 1))]


def test_a_zip_is_unpacked_into_a_fresh_temporary_directory(tmp_path, monkeypatch, capsys):
    temp_root = tmp_path / "temp"
    temp_root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(temp_root))
    downloads = tmp_path / "downloads"
    downloads.mkdir()
    zip_path = downloads / "feedback-2026-10-18T13-00-00-000000Z.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("research.json", "{}")
        zf.writestr("_feedback/feedback.json", json.dumps({"submitted_at": "2026-10-18T13:00:00Z"}))
        zf.writestr("_feedback/session-log.jsonl", "".join(json.dumps(r) + "\n" for r in _waiting_session()))
        zf.writestr("_feedback\\subagents\\agent-a1.meta.json", json.dumps(AGENT_META))
        zf.writestr("_feedback\\subagents\\agent-a1.jsonl",
                    "".join(json.dumps(r) + "\n" for r in _agent_run(paused_gap=400)))
        zf.writestr("_feedback/../../escaped.txt", "x")

    with ExitStack() as stack:
        first = fp.extract_zip(zip_path, stack)
        second = fp.extract_zip(zip_path, stack)
        assert first.parent == temp_root and second.parent == temp_root and first != second
        assert sorted(p.relative_to(first).as_posix() for p in first.rglob("*") if p.is_file()) == [
            "_feedback/escaped.txt", "_feedback/feedback.json", "_feedback/session-log.jsonl",
            "_feedback/subagents/agent-a1.jsonl", "_feedback/subagents/agent-a1.meta.json"]
    assert not first.exists() and not second.exists()
    assert sorted(p.name for p in downloads.iterdir()) == [zip_path.name]
    assert not list(tmp_path.rglob("escaped.txt"))

    out = tmp_path / "profile.json"
    assert fp.main([str(zip_path), "--json", str(out)]) == 0
    report = capsys.readouterr().out
    assert "1 bundle(s), 1 session(s), 1 agent run(s)" in report
    assert json.loads(out.read_text(encoding="utf-8"))["bundles"] == [zip_path.stem]
    assert list(temp_root.iterdir()) == []
