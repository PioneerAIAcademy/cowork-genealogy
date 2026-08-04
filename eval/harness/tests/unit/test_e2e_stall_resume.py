"""Tests for the progress-stall watchdog + first-cut session resume (Idea 3b).

The watchdog is active by default (`progress_stall_seconds`); resume is gated
behind `resume_on_stall` AND a provably-safe state. These drive `_run_agent`
with a mocked SDK `query`, so the message stream and its timing are
controllable — the real path is exercised by an actual e2e run.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from e2e import orchestrator
from e2e.orchestrator import _run_agent, load_fixture
from e2e.stop_checker import derive_stop_reason
from harness.skill_invocation import find_person_evidence_missing_same_person


def _fixture(tmp_path: Path, **caps):
    fixture_dir = tmp_path / "fx"
    fixture_dir.mkdir()
    (fixture_dir / "fixture.json").write_text(
        json.dumps(
            {
                "id": "fx",
                "name": "fx",
                "source_pid": "ABCD-123",
                "captured": "2026-05-26",
                "researcher_question": "Who were John's parents?",
                "tags": {"question_type": "parents", "era": "1850s", "geography": "US-VA"},
                "model": {"agent": "claude-sonnet-4-6", "judge": "claude-haiku-4-5-20251001"},
                "caps": caps,
            }
        ),
        encoding="utf-8",
    )
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "x"}}), encoding="utf-8"
    )
    (fixture_dir / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": []}), encoding="utf-8"
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )
    return load_fixture(fixture_dir)


class _FakeAgen:
    """An async iterator yielding scripted (delay_seconds, message) steps."""

    def __init__(self, steps):
        self._steps = list(steps)
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i >= len(self._steps):
            raise StopAsyncIteration
        delay, msg = self._steps[self._i]
        self._i += 1
        if delay:
            await asyncio.sleep(delay)
        return msg

    async def aclose(self):
        return None


def _sys(session="S1"):
    return SystemMessage(subtype="init", data={"session_id": session})


def _assistant(text="working"):
    return AssistantMessage(content=[TextBlock(text=text)], model="claude")


def _result(session="S1"):
    return ResultMessage(
        subtype="result",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id=session,
    )


def _drive(fx, tmp_path, *, resume_on_stall):
    return asyncio.run(
        _run_agent(
            fixture=fx,
            workspace=tmp_path,
            mcp_server_entry=Path("dummy"),
            resume_on_stall=resume_on_stall,
        )
    )


def test_stop_checker_maps_no_progress_stall_to_inactivity():
    assert (
        derive_stop_reason(sdk_aborted_reason="no_progress_stall", research=None)
        == "inactivity"
    )


def test_watchdog_aborts_on_no_progress_when_resume_off(tmp_path, monkeypatch):
    # Stream stays alive (system messages every 20ms) but never makes progress;
    # the inactivity timer (2s) never fires — the progress watchdog (0.3s) does.
    steps = [(0.0, _sys())] + [(0.02, _sys()) for _ in range(60)]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    fx = _fixture(
        tmp_path, progress_stall_seconds=0.3, inactivity_seconds=2, wall_clock_seconds=30
    )
    _tc, _t, usage, aborted, _e, _b, _g, _sl = _drive(fx, tmp_path, resume_on_stall=False)
    assert aborted == "no_progress_stall"
    assert usage["resumes"] == 0
    assert usage["session_id"] == "S1"  # captured from the init SystemMessage
    assert usage["caps"]["progress_stall_seconds"] == 0.3  # caps recorded for self-description
    assert usage["timeline"]  # per-message timeline populated


def test_resume_recovers_a_stall_in_safe_state(tmp_path, monkeypatch):
    # First query: init + one progress message, then a no-progress stall.
    # Second query (resume set): completes immediately.
    first = [(0.0, _sys()), (0.0, _assistant("starting"))] + [(0.02, _sys()) for _ in range(60)]
    second = [(0.0, _result())]
    calls = {"n": 0}

    def fake_query(**kw):
        calls["n"] += 1
        opts = kw["options"]
        if calls["n"] == 1:
            assert opts.resume is None
            return _FakeAgen(first)
        # resumed the captured session, continuing (not forking)
        assert opts.resume == "S1"
        assert opts.fork_session is False
        return _FakeAgen(second)

    monkeypatch.setattr(orchestrator, "query", fake_query)
    fx = _fixture(
        tmp_path, progress_stall_seconds=0.3, inactivity_seconds=2, wall_clock_seconds=30
    )
    _tc, _t, usage, aborted, _e, _b, _g, _sl = _drive(fx, tmp_path, resume_on_stall=True)
    assert aborted is None  # completed via resume, no abort
    assert usage["resumes"] == 1
    assert calls["n"] == 2  # query was re-issued with resume


def _run(fx, tmp_path, **kw):
    return asyncio.run(
        _run_agent(fixture=fx, workspace=tmp_path, mcp_server_entry=Path("dummy"), **kw)
    )


def test_max_output_tokens_injected_into_env_and_logged(tmp_path, monkeypatch):
    captured = {}

    def fake_query(**kw):
        captured["env"] = dict(kw["options"].env)
        return _FakeAgen([(0.0, _sys()), (0.0, _result())])

    monkeypatch.setattr(orchestrator, "query", fake_query)
    _tc, _t, usage, *_ = _run(_fixture(tmp_path), tmp_path, max_output_tokens=16000)
    assert captured["env"]["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] == "16000"
    assert usage["max_output_tokens"] == 16000


def test_max_output_tokens_absent_from_env_when_unset(tmp_path, monkeypatch):
    captured = {}

    def fake_query(**kw):
        captured["env"] = dict(kw["options"].env)
        return _FakeAgen([(0.0, _sys()), (0.0, _result())])

    monkeypatch.setattr(orchestrator, "query", fake_query)
    _tc, _t, usage, *_ = _run(_fixture(tmp_path), tmp_path)
    assert "CLAUDE_CODE_MAX_OUTPUT_TOKENS" not in captured["env"]
    assert usage["max_output_tokens"] is None


def test_cli_version_captured_from_init_message(tmp_path, monkeypatch):
    init = SystemMessage(subtype="init", data={"session_id": "S1", "version": "2.1.208"})
    monkeypatch.setattr(
        orchestrator, "query", lambda **kw: _FakeAgen([(0.0, init), (0.0, _result())])
    )
    _tc, _t, usage, *_ = _run(_fixture(tmp_path), tmp_path)
    assert usage["cli_version"] == "2.1.208"


def test_agent_model_override_sets_parent_model(tmp_path, monkeypatch):
    captured = {}

    def fake_query(**kw):
        captured["model"] = kw["options"].model
        return _FakeAgen([(0.0, _sys()), (0.0, _result())])

    monkeypatch.setattr(orchestrator, "query", fake_query)
    _run(_fixture(tmp_path), tmp_path, agent_model="claude-sonnet-4-6")
    assert captured["model"] == "claude-sonnet-4-6"


def test_parent_model_defaults_to_fixture_when_no_override(tmp_path, monkeypatch):
    captured = {}

    def fake_query(**kw):
        captured["model"] = kw["options"].model
        return _FakeAgen([(0.0, _sys()), (0.0, _result())])

    monkeypatch.setattr(orchestrator, "query", fake_query)
    _run(_fixture(tmp_path), tmp_path)  # _fixture uses the default agent_model
    assert captured["model"]  # a concrete model id, not None


# --- ToolResultBlock.is_error join (issue: five detectors gate on a dead key) --

_SAME_PERSON = "mcp__genealogy__same_person"


def _tool_turn(tool_use_id, name, args):
    return AssistantMessage(
        content=[ToolUseBlock(id=tool_use_id, name=name, input=args)], model="claude"
    )


def _tool_result(tool_use_id, text, *, is_error):
    return UserMessage(
        content=[
            ToolResultBlock(tool_use_id=tool_use_id, content=text, is_error=is_error)
        ]
    )


def _errored_same_person_run(tmp_path, monkeypatch, person_id="I1"):
    """Drive _run_agent through one same_person call whose result is an ERROR,
    and hand back the tool_calls the run recorded."""
    steps = [
        (0.0, _sys()),
        (0.0, _tool_turn("tu_1", _SAME_PERSON, {"primaryId1": "p_9", "primaryId2": person_id})),
        (0.0, _tool_result("tu_1", "upstream 503", is_error=True)),
        (0.0, _result()),
    ]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    tool_calls, *_ = _run(_fixture(tmp_path), tmp_path)
    return tool_calls


def test_run_agent_records_is_error_from_the_tool_result(tmp_path, monkeypatch):
    """The join must carry ToolResultBlock.is_error onto the tool_calls entry.

    Without it the five `entry.get("is_error") is True` gates in
    skill_invocation.py are dead: an errored call reads as a successful one.
    """
    tool_calls = _errored_same_person_run(tmp_path, monkeypatch)
    assert len(tool_calls) == 1
    assert tool_calls[0]["is_error"] is True


def test_successful_tool_result_records_is_error_false_not_none(tmp_path, monkeypatch):
    """`ToolResultBlock.is_error` is `bool | None`; a successful call must record
    False, not null — the runlog carries this key for every entry now."""
    steps = [
        (0.0, _sys()),
        (0.0, _tool_turn("tu_1", _SAME_PERSON, {"primaryId1": "p_9", "primaryId2": "I1"})),
        (0.0, _tool_result("tu_1", '{"score":0.9}', is_error=None)),
        (0.0, _result()),
    ]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    tool_calls, *_ = _run(_fixture(tmp_path), tmp_path)
    assert tool_calls[0]["is_error"] is False


def test_errored_same_person_does_not_score_the_identity(tmp_path, monkeypatch):
    """The composition: an errored `same_person` must NOT count as having scored
    the identity, so the person_evidence link for that new person is a violation.

    Three project docs, mirroring check_guardrail_compliance's real call: the
    person must be in `tree` and absent from `starting_tree` for the detector to
    consider it new, and `research` supplies the person_evidence link.
    """
    tool_calls = _errored_same_person_run(tmp_path, monkeypatch, person_id="I1")
    violations = find_person_evidence_missing_same_person(
        tool_calls,
        {"person_evidence": [{"id": "pe_001", "person_id": "I1"}]},
        {"persons": [{"id": "I1"}]},
        starting_tree={"persons": []},
    )
    assert len(violations) == 1
    assert "I1" in violations[0]
    assert "never scored" in violations[0]


def test_unresolved_tool_call_carries_no_is_error_key(tmp_path, monkeypatch):
    """A call whose ToolResultBlock never arrived must leave the key ABSENT.

    HARNESS_SCHEMA_VERSION 3's whole justification is that `"is_error" in entry`
    is not a usable version tell, because an aborted or wall-clock-capped run
    leaves unresolved entries keyless in v3 exactly as in v2. That invariant is a
    side effect of the entry literal in `_run_agent` not naming `is_error`:
    "tidying" it to `"is_error": False` would make every unresolved call read as
    a success to the five gates AND silently invalidate the documented tell,
    without failing any other test here.
    """
    steps = [
        (0.0, _sys()),
        (0.0, _tool_turn("tu_1", _SAME_PERSON, {"primaryId1": "p_9", "primaryId2": "I1"})),
        # No _tool_result — the stream ends with the call still in flight.
        (0.0, _result()),
    ]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    tool_calls, *_ = _run(_fixture(tmp_path), tmp_path)
    assert len(tool_calls) == 1
    assert "is_error" not in tool_calls[0]
    # response_summary is the documented exception: initialized by the entry
    # literal, so present-but-null rather than absent (e2e-test-spec.md §8).
    assert tool_calls[0]["response_summary"] is None
