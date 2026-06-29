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

from claude_agent_sdk import AssistantMessage, ResultMessage, SystemMessage, TextBlock

from e2e import orchestrator
from e2e.orchestrator import _run_agent, load_fixture
from e2e.stop_checker import derive_stop_reason


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
    _tc, _t, usage, aborted, _e, _b = _drive(fx, tmp_path, resume_on_stall=False)
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
    _tc, _t, usage, aborted, _e, _b = _drive(fx, tmp_path, resume_on_stall=True)
    assert aborted is None  # completed via resume, no abort
    assert usage["resumes"] == 1
    assert calls["n"] == 2  # query was re-issued with resume
