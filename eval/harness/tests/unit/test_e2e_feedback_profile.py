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
from pathlib import Path, PureWindowsPath

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


def _write_bundle(root: Path, name: str, main_rows: list, agents: dict | None = None,
                  feedback: dict | None = None) -> Path:
    fb = root / name / "_feedback"
    fb.mkdir(parents=True)
    (fb / "feedback.json").write_text(json.dumps({"submitted_at": "2026-10-18T13:00:00Z", **(feedback or {})}),
                                     encoding="utf-8")
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
    profile = _profile(bundle)
    session = profile["sessions"][0]
    assert session["paused_min"] == round(700 / 60, 1)
    assert session["agent_wait_min"] == round(1100 / 60, 1)
    assert session["active_min"] == round(1120 / 60, 1)
    latency = {t["tool"]: t["latency_max_s"] for t in profile["tools"]}
    assert latency == {"Agent": 1.0 if background else None, "Read": None}


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


def _synthetic(uuid: str, seconds: float, text: str = "API Error: Failed to parse JSON",
               api_error: bool = True) -> dict:
    zero = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    row = {"type": "assistant", "uuid": uuid, "sessionId": SESSION, "timestamp": _at(seconds),
           "message": {"role": "assistant", "id": f"syn-{uuid}", "model": "<synthetic>",
                       "stop_reason": "stop_sequence", "usage": zero, "content": [{"type": "text", "text": text}]}}
    return {**row, "isApiErrorMessage": True, "error": "unknown"} if api_error else row


def test_a_wait_that_ends_on_an_api_error_is_active_and_not_a_model_call(tmp_path):
    rows = [
        _user("m1", 0, "go"),
        _assistant("m2", 10, "msg_1", [{"type": "text", "text": "Searching."}]),
        _synthetic("m3", 599),
        _user("m4", 605, "keep going"),
        _synthetic("m5", 1245),
        _user("m6", 1250, "keep going"),
        _assistant("m7", 1260, "msg_2", [{"type": "text", "text": "ok"}]),
        _user("m8", 1270, "thanks"),
        _synthetic("m9", 1900, "No response requested.", api_error=False),
    ]
    profile = _profile(_write_bundle(tmp_path, "feedback-a", rows))
    session = profile["sessions"][0]
    assert (session["active_min"], session["api_error_wait_min"], session["paused_min"]) == \
        (round(1230 / 60, 1), round(600 / 60, 1), round(670 / 60, 1))
    assert session["main_model_calls"] == 2
    assert [m["model"] for m in profile["top"]["slowest_model_calls"]] == ["claude-sonnet-4-6"] * 2
    assert "api-error wait = the first 10 min, the request timeout, of each gap over 10 min" \
        in fp.format_report(profile)


@pytest.mark.parametrize("gap, active, paused, api_error_wait", [
    (644, 600, 44, 600), (96 * 60, 600, 96 * 60 - 600, 600), (300, 300, 0, 0)],
    ids=["644s", "96min", "300s"])
def test_an_api_error_wait_is_active_for_at_most_the_request_timeout(gap, active, paused, api_error_wait):
    rows = [_user("m1", 0, "go"), _assistant("m2", 10, "msg_1", [{"type": "text", "text": "Searching."}]),
            _synthetic("m3", 10 + gap)]
    thread = fp.analyze(rows)
    assert (thread["active_s"] - 10, thread["paused_s"], thread["api_error_wait_s"]) == \
        pytest.approx((active, paused, api_error_wait))


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


COMPACTION = "This session is being continued from a previous conversation that ran out of context."


@pytest.mark.parametrize("compaction", [COMPACTION, [{"type": "text", "text": COMPACTION}]],
                         ids=["string-prompt", "text-block"])
def test_only_a_call_after_an_agent_that_misses_the_cache_is_a_rewrite(tmp_path, compaction):
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
        agent_call("m9", 2020, "msg_5", "tu_3", read=58_000, write=500),
        _user("m10", 2900, _result("tu_3", "done")),
        _user("m11", 2950, compaction),
        _assistant("m12", 2960, "msg_6", [{"type": "text", "text": "ok"}],
                   {"input_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 12_000}),
        agent_call("m13", 2970, "msg_7", "tu_4", read=12_000, write=300),
        _user("m14", 3870, _result("tu_4", "done")),
        _assistant("m15", 3880, "msg_8", [{"type": "text", "text": "ok"}],
                   {"input_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 12_500}),
    ]
    session = _profile(_write_bundle(tmp_path, "feedback-a", rows))["sessions"][0]
    assert session["compactions"] == 1
    assert session["cache_rewrites"] == 2
    rewritten = (50_005 - 27_000) + 12_305
    assert session["cache_rewrite_cost"] == round(rewritten * (3.00 * 1.25 - 0.30) / 1_000_000, 2)


def test_a_call_queued_behind_an_agent_is_timed_from_the_agent_s_return(tmp_path):
    def use(uuid, t, msg_id, tool_use_id, name):
        return _assistant(uuid, t, msg_id, [{"type": "tool_use", "id": tool_use_id, "name": name, "input": {}}])

    rows = [
        _user("m1", 0, "go"),
        # 5baa965d on 2026-10-15: one message launches an agent, then three calls that wait for it.
        use("m2", 10.0, "msg_1", "tu_agent", "Agent"),
        use("m3", 10.719, "msg_1", "tu_read", "mcp__genealogy__record_read"),
        use("m4", 17.4, "msg_1", "tu_log", "mcp__genealogy__research_log_append"),
        use("m5", 18.505, "msg_1", "tu_search", "mcp__genealogy__record_search"),
        _user("m6", 907.069, _result("tu_agent", "extracted")),
        _user("m7", 907.795, _result("tu_read", "{}")),
        _user("m8", 907.812, _result("tu_log", "{}")),
        _user("m9", 908.096, _result("tu_search", "{}")),
        # Agents launched together run together, and a call that ran beside them
        # and came back first keeps its own clock.
        use("m10", 910.0, "msg_2", "tu_agent2", "Agent"),
        use("m10b", 910.2, "msg_2", "tu_agent3", "Agent"),
        use("m11", 910.5, "msg_2", "tu_glob", "Glob"),
        _user("m12", 911.0, _result("tu_glob", "[]")),
        _user("m13", 1000.0, _result("tu_agent2", "done")),
        _user("m13b", 1005.0, _result("tu_agent3", "done")),
        # A call whose window holds a pause has no latency.
        use("m14", 1010.0, "msg_3", "tu_slow", "mcp__genealogy__record_search"),
        _user("m15", 2210.0, _result("tu_slow", "{}")),
        _assistant("m16", 2220.0, "msg_4", [{"type": "text", "text": "done"}]),
    ]
    tools = _profile(_write_bundle(tmp_path, "feedback-a", rows))["tools"]
    assert {t["tool"]: (t["latency_p50_s"], t["latency_max_s"]) for t in tools} == {
        "Agent": (94.8, 897.1), "record_read": (0.7, 0.7), "research_log_append": (0.7, 0.7),
        "record_search": (1.0, 1.0), "Glob": (0.5, 0.5)}


def _failed_read(n: int, t: float, error: str) -> list:
    return [_assistant(f"r{n}", t, f"msg_r{n}", [{"type": "tool_use", "id": f"tu_r{n}", "name": "Read",
                                                  "input": {"file_path": f"/project/{n}.json"}}]),
            _user(f"e{n}", t + 1, [{"type": "tool_result", "tool_use_id": f"tu_r{n}", "content": error,
                                    "is_error": True}])]


def test_an_error_head_is_counted_in_each_thread_it_came_from(tmp_path):
    error = "File does not exist. Note: your current working directory is /project."
    main = _waiting_session()
    main = [main[0], *_failed_read(1, 2, error), *main[1:]]
    agent = [_user("a1", 11, "extract the record"), *_failed_read(2, 20, error), *_failed_read(3, 30, error),
             _assistant("a_end", 40, "msg_end", [{"type": "text", "text": "done"}])]
    bundle = _write_bundle(tmp_path, "feedback-a", main, {"a1": (AGENT_META, agent)})
    assert _profile(bundle)["top"]["error_heads"] == [
        {"times": 2, "tool": "Read", "where": "record-extractor a1", "head": error},
        {"times": 1, "tool": "Read", "where": "main 5e55a0b1", "head": error}]


def test_an_agent_run_with_no_transcript_is_missing_once(tmp_path):
    launches = ["tu_agent", "tu_a5", "tu_a8", "tu_a9", "tu_err"]
    results = {"tu_agent": "extracted", "tu_a5": "done\nagentId: a5 (use SendMessage to continue)",
               "tu_a8": "done\nagentId: a8 (use SendMessage to continue)",
               "tu_a9": "done\nagentId: a9 (use SendMessage to continue)"}
    rows = [_user("m1", 0, "go"),
            *[_assistant(f"m{2 + i}", 10 + i, "msg_1", [{"type": "tool_use", "id": tid, "name": "Agent",
                                                       "input": {"subagent_type": "x", "prompt": "go"}}])
              for i, tid in enumerate(launches)],
            *[_user(f"r{i}", 100 + i, _result(tid, text)) for i, (tid, text) in enumerate(results.items())],
            _user("r_err", 105, [{"type": "tool_result", "tool_use_id": "tu_err", "is_error": True,
                                  "content": "Agent type 'x' not found."}]),
            _assistant("m9", 110, "msg_2", [{"type": "text", "text": "done"}])]
    run = [_user("x1", 11, "go"), _assistant("x2", 50, "msg_x", [{"type": "text", "text": "done"}])]
    bundle = _write_bundle(tmp_path, "feedback-a", rows, {"a1": (AGENT_META, run), "a5": ({}, run)},
                           {"dropped_transcripts": ["subagents/agent-a9.jsonl", "subagents/agent-b7.jsonl"]})
    assert _profile(bundle)["sessions"][0]["missing_agent_transcripts"] == 3


def test_a_rewrite_is_priced_at_its_own_message_s_1h_and_5m_split(tmp_path):
    rows = [
        _user("m1", 0, "go"),
        _assistant("m2", 10, "msg_1", [{"type": "tool_use", "id": "tu_1", "name": "Agent",
                                        "input": {"subagent_type": "x", "prompt": "go"}}],
                   {"input_tokens": 5, "cache_read_input_tokens": 40_000, "cache_creation_input_tokens": 10_000}),
        _user("m3", 910, _result("tu_1", "done")),
        _assistant("m4", 920, "msg_2", [{"type": "text", "text": "ok"}],
                   {"input_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 60_000,
                    "cache_creation": {"ephemeral_5m_input_tokens": 40_000, "ephemeral_1h_input_tokens": 20_000}}),
    ]
    session = _profile(_write_bundle(tmp_path, "feedback-a", rows))["sessions"][0]
    rewritten = 50_005
    one_hour = round(rewritten / 3)
    expected = (one_hour * 6.00 + (rewritten - one_hour) * 3.00 * 1.25 - rewritten * 0.30) / 1_000_000
    assert session["cache_rewrites"] == 1
    assert session["cache_rewrite_cost"] == round(expected, 2)


def test_a_nested_agent_s_own_pause_is_taken_off_its_parent_s_wait_too(tmp_path):
    parent = [
        _user("p1", 11, "survey the tree"),
        _assistant("p2", 20, "msg_p1", [{"type": "tool_use", "id": "tu_nested", "name": "Agent",
                                         "input": {"subagent_type": "x", "prompt": "go"}}]),
        _user("p3", 1800, _result("tu_nested", "done")),
        _assistant("p4", 1810, "msg_p2", [{"type": "text", "text": "done"}]),
    ]
    nested = [
        _user("n1", 21, "read it"),
        _assistant("n2", 30, "msg_n1", [{"type": "tool_use", "id": "tu_read", "name": "Read",
                                         "input": {"file_path": "/project/research.json"}}]),
        _user("n3", 730, _result("tu_read", "{}")),
        _assistant("n4", 1230, "msg_n2", [{"type": "text", "text": "x"}]),
        _assistant("n5", 1730, "msg_n3", [{"type": "text", "text": "x"}]),
        _assistant("n6", 1790, "msg_n4", [{"type": "text", "text": "done"}]),
    ]
    nested_meta = {"agentType": "genealogy-research:tree-survey", "description": "survey",
                   "toolUseId": "tu_nested", "spawnDepth": 2}
    bundle = _write_bundle(tmp_path, "feedback-a", _waiting_session(),
                           {"a1": (AGENT_META, parent), "b2": (nested_meta, nested)})
    session = _profile(bundle)["sessions"][0]
    assert session["paused_min"] == round(700 / 60, 1)
    assert session["agent_wait_min"] == round(1100 / 60, 1)


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
        zf.writestr("_feedback/D:evil.txt", "x")

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


WINDOWS_TEMP = PureWindowsPath(r"C:\Users\x\AppData\Local\Temp\feedback-profile-abc")


@pytest.mark.parametrize("name", [
    "_feedback/D:/evil.txt", "_feedback/D:evil.txt", "D:/_feedback/evil.txt", "C:\\_feedback\\evil.txt",
    "/etc/x", "/tmp/_feedback/evil.txt", "\\\\server\\share\\_feedback\\evil.txt",
    "//server/share/_feedback/evil.txt", "_feedback/session-log.jsonl:hidden", "_feedback/subagents/",
])
def test_a_windows_name_that_could_leave_the_directory_is_skipped(name):
    assert fp.member_target(name, WINDOWS_TEMP) is None


@pytest.mark.parametrize("name, inside", [
    ("_feedback/../../x", "_feedback/x"),
    ("_feedback\\subagents\\agent-a1.jsonl", "_feedback/subagents/agent-a1.jsonl"),
    ("feedback-1/./_feedback//session-log.jsonl", "feedback-1/_feedback/session-log.jsonl"),
])
def test_a_windows_name_is_kept_inside_the_directory(name, inside):
    assert fp.member_target(name, WINDOWS_TEMP) == WINDOWS_TEMP.joinpath(*inside.split("/"))


def test_a_member_that_resolves_outside_the_directory_is_skipped(tmp_path):
    dest, outside = tmp_path / "dest", tmp_path / "outside"
    dest.mkdir()
    outside.mkdir()
    (dest / "_feedback").symlink_to(outside, target_is_directory=True)
    assert fp.member_target("_feedback/evil.txt", dest) is None
    assert fp.member_target("b/_feedback/ok.txt", dest) == dest / "b" / "_feedback" / "ok.txt"


# ── CACHE TTL: what a 1-hour cache would have cost ───────────────────────────


def _ttl_session(gap: float, one_hour: bool = False, agent_writes: int = 80_000) -> list:
    """The plan's worked instance: call 1 writes 50,000 tokens on a 100,000-token context and
    launches an agent; it returns `gap` seconds later and call 2 reads none of the 100,000."""
    split = ({"cache_creation": {"ephemeral_1h_input_tokens": 50_000}} if one_hour else {})
    return [
        _user("m1", 0, "go"),
        _assistant("m2", 10, "msg_1", [{"type": "tool_use", "id": "tu_agent", "name": "Agent",
                                        "input": {"subagent_type": "x", "prompt": "go"}}],
                   {"input_tokens": 0, "cache_read_input_tokens": 50_000,
                    "cache_creation_input_tokens": 50_000, **split}),
        _user("m3", gap, _result("tu_agent", "done")),
        _assistant("m4", gap + 10, "msg_2", [{"type": "text", "text": "ok"}],
                   {"input_tokens": 0, "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 100_000}),
    ]


def _ttl_agent(writes: int) -> list:
    return [_user("a1", 11, "go"),
            _assistant("a2", 20, "msg_a", [{"type": "text", "text": "done"}],
                       {"input_tokens": 0, "cache_creation_input_tokens": writes})]


def _ttl(tmp_path, rows, agent_writes=80_000) -> tuple[dict, str]:
    meta = {**AGENT_META, "toolUseId": "tu_agent"}
    profile = _profile(_write_bundle(tmp_path, "feedback-a", rows,
                                     agents={"a1": (meta, _ttl_agent(agent_writes))}))
    return profile["cache_ttl"], fp.format_report(profile)


def test_cache_ttl_prices_the_worked_instance_and_prints_it(tmp_path):
    """saving 100,000 x ($3.75 - $0.30) = $0.345; premium main 50,000 x $2.25 = $0.1125;
    premium all adds the agent's 80,000 x $2.25. The re-written tokens are not ALSO in the
    premium -- that would count them on both sides."""
    ttl, text = _ttl(tmp_path, _ttl_session(gap=410))
    row = ttl["total"]
    assert row["saving_after_agent"] == pytest.approx(0.345)
    assert row["saving_other"] == 0
    assert row["premium_main"] == pytest.approx(0.1125)
    assert row["net_main"] == pytest.approx(-0.2325)
    assert row["premium_all"] == pytest.approx(0.2925)
    assert row["net_all"] == pytest.approx(-0.0525)
    assert row["share_1h_main"] == 0 and row["share_1h_agents"] == 0
    section = text.split("CACHE TTL")[1].split("MAIN-THREAD SKILLS")[0]
    total = next(line for line in section.splitlines() if line.strip().startswith("TOTAL"))
    assert total.split() == ["TOTAL", "0%", "0%", "0.34", "0.00", "0.11", "-0.23", "0.29", "-0.05"]


@pytest.mark.parametrize("gap, saved", [(299, False), (301, True), (3_600, True), (3_601, False),
                                        (7_200, False)])
def test_only_a_gap_a_1h_cache_survives_counts_as_saved(tmp_path, gap, saved):
    """Under 5 minutes the 5-minute cache already holds; over an hour the 1-hour one would
    have expired too. (The gap is request start to request start: 0 -> `gap`.)"""
    ttl, _ = _ttl(tmp_path, _ttl_session(gap=gap))
    assert (ttl["total"]["saving_after_agent"] > 0) is saved


def test_a_session_with_no_long_gap_saves_nothing_and_pays_the_premium(tmp_path):
    rows = [_user("m1", 0, "go"),
            _assistant("m2", 10, "msg_1", [{"type": "text", "text": "ok"}],
                       {"input_tokens": 0, "cache_creation_input_tokens": 40_000})]
    ttl = _profile(_write_bundle(tmp_path, "feedback-a", rows))["cache_ttl"]["total"]
    assert ttl["saving_after_agent"] == ttl["saving_other"] == 0
    assert ttl["premium_main"] == pytest.approx(40_000 * 2.25 / 1_000_000)
    assert ttl["net_main"] > 0 and ttl["share_1h_agents"] is None


def test_a_bundle_already_on_1h_reports_its_share(tmp_path):
    ttl, _ = _ttl(tmp_path, _ttl_session(gap=410, one_hour=True))
    assert ttl["sessions"][0]["share_1h_main"] == pytest.approx(50_000 / 150_000)
