"""What a slept host BECOMES (issue #2974).

Detection (`SleepDetector`, issue #2983) already counts Windows Modern Standby.
This suite pins the consequence: a run whose heartbeat counted
`>= caps.inactivity_seconds` of sleep is relabeled `host_slept` — at the
wall-clock cap, at the inactivity-silence timer, and at the progress watchdog —
and, when a resume is armed, is stopped rather than resumed as if it had stalled.

Two layers:
  * `sleep_relabel` — the pure stop decision, tested directly (no SDK loop).
    This is where the "worst plausible wrong PR" (relabel the cap only) dies:
    the parametrization fails unless ALL THREE abort reasons relabel.
  * `_run_agent` — driven with a mocked `query` and a pinned detector, so a real
    abort at each site is exercised and its relabel asserted.

Clocks/detector are injected; no test sleeps a machine, and nothing here checks
the live Windows behaviour — that needs a real standby.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from e2e import orchestrator
from e2e.orchestrator import sleep_relabel

sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_stall_resume import (  # noqa: E402
    _FakeAgen,
    _assistant,
    _fixture,
    _result,
    _run,
    _sys,
)
from test_e2e_judge_failure import _drive  # noqa: E402

# The three cap/watchdog aborts a Windows standby can masquerade as.
_RELABELABLE = ("max_wall_clock_seconds", "sdk_stream_silence", "no_progress_stall")
# Stops a sleep cannot manufacture — must survive any amount of counted sleep.
_NEVER = ("max_tool_calls", "cost_cap", "max_turns", "error", "mcp_unavailable", None)


# --- sleep_relabel: the pure stop decision -----------------------------------


@pytest.mark.parametrize("reason", _RELABELABLE)
def test_sleep_relabel_relabels_each_abort_reason_at_and_above_threshold(reason):
    # `>=` — the boundary counts. Each of the three, individually: a PR that
    # fixes only the wall-clock cap fails the sdk_stream_silence/no_progress_stall
    # cases here (the issue's "worst plausible wrong PR").
    assert sleep_relabel(reason, 600.0, 600.0) == "host_slept"
    assert sleep_relabel(reason, 600.1, 600.0) == "host_slept"


@pytest.mark.parametrize("reason", _RELABELABLE)
def test_sleep_relabel_leaves_reason_unchanged_below_threshold(reason):
    # The other direction: a real cap/stall with little or no counted sleep must
    # keep its own reason, or every genuine timeout becomes host_slept.
    assert sleep_relabel(reason, 599.9, 600.0) == reason
    assert sleep_relabel(reason, 0.0, 600.0) == reason


@pytest.mark.parametrize("reason", _NEVER)
def test_sleep_relabel_never_touches_non_sleep_reasons(reason):
    # A tool-cap / cost / turn / harness-error / mcp stop is real regardless of
    # sleep, so even a huge counted figure must not relabel it.
    assert sleep_relabel(reason, 10_000.0, 600.0) == reason


# --- _run_agent: a real abort at each site relabels --------------------------


def _pinned(seconds: float):
    """A `SleepDetector` frozen at `seconds` of counted sleep.

    Lets a test drive a genuine abort and assert the relabel without simulating
    monotonic gaps; `tick()` is a no-op so the value the relabel reads stays put
    regardless of heartbeat/timeout wake order — the very race the forced tick at
    each resume site exists to defeat.
    """

    class _Pinned(orchestrator.SleepDetector):
        def __init__(self, **kw):
            super().__init__(**kw)
            self.counted_sleep_seconds = seconds

        def tick(self) -> None:  # noqa: D401 — pinned
            pass

    return _Pinned


def test_wall_clock_cap_relabels_to_host_slept(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "SleepDetector", _pinned(10_000.0))
    # The result arrives long after the 0.1s wall-clock cap, so the cap fires.
    steps = [(0.0, _sys()), (0.5, _result())]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    fx = _fixture(
        tmp_path,
        wall_clock_seconds=0.1,
        inactivity_seconds=30,
        progress_stall_seconds=30,
    )
    _tc, _t, usage, aborted, error, *_ = _run(fx, tmp_path, resume_on_stall=False)
    assert aborted == "host_slept"
    assert "host slept" in error


def test_inactivity_silence_relabels_to_host_slept(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "SleepDetector", _pinned(10_000.0))
    # 0.5s gap to the next message > the 0.1s inactivity timer → true silence,
    # which on a slept host must become host_slept, not sdk_stream_silence.
    steps = [(0.0, _sys()), (0.5, _result())]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    fx = _fixture(
        tmp_path,
        inactivity_seconds=0.1,
        progress_stall_seconds=30,
        wall_clock_seconds=30,
    )
    _tc, _t, usage, aborted, error, *_ = _run(fx, tmp_path, resume_on_stall=False)
    assert aborted == "host_slept"
    assert usage["resumes"] == 0
    assert "host slept" in error


def test_progress_stall_relabels_to_host_slept(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "SleepDetector", _pinned(10_000.0))
    # Stream alive with non-progress init messages; the 0.3s progress watchdog
    # fires while the 2s inactivity timer never does.
    steps = [(0.0, _sys())] + [(0.02, _sys()) for _ in range(60)]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    fx = _fixture(
        tmp_path,
        progress_stall_seconds=0.3,
        inactivity_seconds=2,
        wall_clock_seconds=30,
    )
    _tc, _t, usage, aborted, error, *_ = _run(fx, tmp_path, resume_on_stall=False)
    assert aborted == "host_slept"
    assert usage["resumes"] == 0
    assert "host slept" in error


def test_slept_stall_is_not_resumed_even_with_resume_on(tmp_path, monkeypatch):
    """The resume-guard case, contrasting test_resume_recovers_a_stall_in_safe_state.

    With `resume_on_stall=True` a genuine stall in a safe state resumes; a stall
    that is really a sleep must NOT — it is stopped as host_slept before a resume
    is spent. This is the failure spec §6 "Clocks" says cannot happen.
    """
    monkeypatch.setattr(orchestrator, "SleepDetector", _pinned(10_000.0))
    first = (
        [(0.0, _sys()), (0.0, _assistant("starting"))]
        + [(0.02, _sys()) for _ in range(60)]
    )
    calls = {"n": 0}

    def fake_query(**kw):
        calls["n"] += 1
        return _FakeAgen(first)  # a resume would only stall again

    monkeypatch.setattr(orchestrator, "query", fake_query)
    fx = _fixture(
        tmp_path,
        progress_stall_seconds=0.3,
        inactivity_seconds=2,
        wall_clock_seconds=30,
    )
    _tc, _t, usage, aborted, error, *_ = _run(fx, tmp_path, resume_on_stall=True)
    assert aborted == "host_slept"
    assert usage["resumes"] == 0  # the sleep guard stopped it before resuming
    assert calls["n"] == 1  # query issued once, never re-issued


def test_genuine_stall_below_threshold_is_not_relabeled(tmp_path, monkeypatch):
    """The other direction at the integration layer: a real stall with ~no
    counted sleep keeps its own reason and (with resume on) still resumes."""
    monkeypatch.setattr(orchestrator, "SleepDetector", _pinned(0.0))
    steps = [(0.0, _sys())] + [(0.02, _sys()) for _ in range(60)]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    fx = _fixture(
        tmp_path,
        progress_stall_seconds=0.3,
        inactivity_seconds=2,
        wall_clock_seconds=30,
    )
    _tc, _t, usage, aborted, _error, *_ = _run(fx, tmp_path, resume_on_stall=False)
    assert aborted == "no_progress_stall"


# --- run_e2e_test: a host_slept run skips the judge but is committed ----------


def test_host_slept_run_skips_judge_and_is_committed(tmp_path, monkeypatch):
    """The retention half of the ruling, at the full-run layer (issue #2974).

    A slept run HAS a tree (build_workspace copies the fixture's in), so this is
    NOT the `final_tree is None` skip path: the judge must be skipped *because*
    the stop_reason is host_slept. The run is committed (`run-`) despite the
    `skipped` verdict, and being `skipped` is what excludes it from the rates. A
    judge that raises if called turns "the judge ran" into a red test; had the
    judge-skip arm been missing, the judge would run and the verdict would be
    `ungraded`, not `skipped` — so the verdict assertion is the real guard.
    """

    def never_called(**kwargs):  # pragma: no cover - asserts it is not reached
        raise AssertionError("the judge must not run for a host_slept run")

    result, paths = _drive(
        tmp_path,
        monkeypatch,
        judge=never_called,
        final_tree={"persons": []},  # a tree exists — not the treeless path
        aborted="host_slept",
    )
    assert result.stop_reason == "host_slept"
    assert result.verdict == "skipped"  # judge skipped → no grade → rate-excluded
    assert paths["result"].name.startswith("run-")  # committed, keyed on stop_reason
