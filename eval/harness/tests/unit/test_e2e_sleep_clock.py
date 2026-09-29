"""Host-sleep detection and the run log's clock fields (issue #2983).

`time.monotonic()` pauses while macOS/Linux sleeps but advances through Windows
Modern Standby, so `real - active` alone reads ~0 on Windows. `SleepDetector`
counts the monotonic gaps a heartbeat sees; `run_with_heartbeat` bounds where it
looks; `sleep_usage_fields` turns both into `slept_seconds` and
`wall_clock_seconds`. Clocks are injected, so no test sleeps a machine. Nothing
here checks the live behaviour on Windows: that needs a real standby.
"""

from __future__ import annotations

import asyncio
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from e2e import orchestrator
from e2e.orchestrator import SleepDetector, run_with_heartbeat, sleep_usage_fields
from e2e.report import print_rollup
from e2e.result import E2eResult
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_judge_failure import _drive  # noqa: E402
from test_e2e_stall_resume import _FakeAgen, _fixture, _result, _sys, _run  # noqa: E402

TICK = 5.0


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t


def _detector(clock: FakeClock, tick: float = TICK) -> SleepDetector:
    return SleepDetector(tick_seconds=tick, monotonic=clock)


def _bounded(coro):
    """Run `coro` with a hard deadline, so a heartbeat that is never cancelled
    fails the test instead of hanging the suite."""
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


def _steady_ticks(det: SleepDetector, clock: FakeClock, n: int) -> None:
    for _ in range(n):
        clock.t += TICK
        det.tick()


# --- SleepDetector: the three platform cases ---------------------------------


def test_windows_gap_monotonic_jumps_is_counted_minus_one_tick():
    mono = FakeClock()
    det = _detector(mono)
    _steady_ticks(det, mono, 3)
    mono.t += 1200.0  # standby: monotonic kept advancing
    det.tick()
    _steady_ticks(det, mono, 3)
    assert det.counted_sleep_seconds == pytest.approx(1200.0 - TICK)


def _simulate(*, mono_jump: float, wall_jump: float) -> dict[str, float]:
    """Drive both fake clocks through a 30-tick run with one sleep in the
    middle, then build the persisted fields exactly as run_e2e_test does."""
    mono, wall = FakeClock(1000.0), FakeClock(5000.0)
    started_mono, started_wall = mono(), wall()
    det = _detector(mono)
    for i in range(30):
        mono.t += TICK
        wall.t += TICK
        if i == 15:
            mono.t += mono_jump
            wall.t += wall_jump
        det.tick()
    return sleep_usage_fields(
        mono() - started_mono, wall() - started_wall, det.counted_sleep_seconds
    )


def test_end_to_end_windows_standby_both_clocks_jump():
    # The sleep tick's gap is one interval plus the standby, so `gap - tick`
    # recovers the standby exactly and active time is the 30 ticks alone.
    f = _simulate(mono_jump=1200.0, wall_jump=1200.0)
    assert f["counted_sleep_seconds"] == pytest.approx(1200.0)
    assert f["slept_seconds"] == pytest.approx(1200.0)
    assert f["wall_clock_seconds"] == pytest.approx(30 * TICK)


def test_end_to_end_macos_sleep_only_wall_jumps():
    # Monotonic paused, so the detector must count NOTHING; the sleep is the
    # real - active difference alone, and counting it here would double it.
    f = _simulate(mono_jump=0.0, wall_jump=1200.0)
    assert f["counted_sleep_seconds"] == 0.0
    assert f["slept_seconds"] == pytest.approx(1200.0)
    assert f["wall_clock_seconds"] == pytest.approx(30 * TICK)


def test_end_to_end_no_sleep():
    f = _simulate(mono_jump=0.0, wall_jump=0.0)
    assert f["slept_seconds"] == 0.0
    assert f["wall_clock_seconds"] == pytest.approx(30 * TICK)


def test_no_gap_late_tick_and_threshold_boundary_count_nothing():
    mono = FakeClock()
    det = _detector(mono)
    _steady_ticks(det, mono, 4)
    mono.t += 30.0  # one late tick, under the threshold
    det.tick()
    mono.t += 60.0  # exactly the threshold: not above it
    det.tick()
    assert det.counted_sleep_seconds == 0.0
    mono.t += 60.5  # just above it
    det.tick()
    assert det.counted_sleep_seconds == pytest.approx(60.5 - TICK)


def test_two_separate_sleeps_accumulate():
    mono = FakeClock()
    det = _detector(mono)
    mono.t += 300.0
    det.tick()
    _steady_ticks(det, mono, 2)
    mono.t += 900.0
    det.tick()
    assert det.counted_sleep_seconds == pytest.approx(300.0 + 900.0 - 2 * TICK)


# --- run_with_heartbeat: the structural window -------------------------------


def test_heartbeat_ticks_inside_the_window():
    mono = FakeClock()
    det = SleepDetector(tick_seconds=0.01, monotonic=mono)

    async def work():
        await asyncio.sleep(0.05)
        mono.t += 1000.0
        await asyncio.sleep(0.05)
        return "done"

    assert _bounded(run_with_heartbeat(work(), det)) == "done"
    assert det.counted_sleep_seconds == pytest.approx(1000.0 - 0.01)


def test_gap_after_the_window_adds_nothing():
    mono = FakeClock()
    det = SleepDetector(tick_seconds=0.01, monotonic=mono)

    async def work():
        await asyncio.sleep(0.03)

    async def main():
        await run_with_heartbeat(work(), det)
        # The judge / file writes happen here, outside the window.
        mono.t += 1000.0
        await asyncio.sleep(0.05)
        others = asyncio.all_tasks() - {asyncio.current_task()}
        return others

    assert _bounded(main()) == set()  # heartbeat task is gone
    assert det.counted_sleep_seconds == 0.0


def test_timeout_cancels_heartbeat_and_counts_a_sleep_ending_at_the_cap():
    # Tick interval far above the cap, so only the final `finally` tick can see
    # the jump: this is the Windows wake-and-cap-fires-at-once case.
    mono = FakeClock()
    det = SleepDetector(tick_seconds=5.0, monotonic=mono)

    async def work():
        mono.t += 1000.0
        await asyncio.sleep(10)

    async def main():
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(run_with_heartbeat(work(), det), timeout=0.05)
        return asyncio.all_tasks() - {asyncio.current_task()}

    assert _bounded(main()) == set()
    assert det.counted_sleep_seconds == pytest.approx(1000.0 - 5.0)


def test_exception_in_the_window_propagates_and_stops_the_heartbeat():
    mono = FakeClock()
    det = SleepDetector(tick_seconds=0.01, monotonic=mono)

    async def work():
        await asyncio.sleep(0.02)
        raise ValueError("sdk failure")

    async def main():
        with pytest.raises(ValueError, match="sdk failure"):
            await run_with_heartbeat(work(), det)
        return asyncio.all_tasks() - {asyncio.current_task()}

    assert _bounded(main()) == set()


# --- sleep_usage_fields + the report note ------------------------------------


def _fields_for(case: str) -> dict[str, float]:
    if case == "windows":  # monotonic ran through 1200 s standby; heartbeat counted it
        return sleep_usage_fields(3000.0, 3000.0, 1200.0 - TICK)
    if case == "macos":  # monotonic paused 1200 s; nothing counted
        return sleep_usage_fields(1800.0, 3000.0, 0.0)
    return sleep_usage_fields(1800.0, 1800.0, 0.0)


def _rollup(usage: dict[str, float]) -> str:
    buf = io.StringIO()
    with redirect_stdout(buf):
        print_rollup(
            [
                E2eResult(
                    test_id="t",
                    captured_at="2026-09-28_12-00-00",
                    verdict="pass",
                    stop_reason="completed",
                    usage=usage,
                )
            ]
        )
    return buf.getvalue()


def test_windows_case_fields_and_note():
    f = _fields_for("windows")
    assert f["slept_seconds"] == pytest.approx(1195.0)
    assert f["wall_clock_seconds"] == pytest.approx(1805.0)
    assert f["counted_sleep_seconds"] == pytest.approx(1195.0)
    out = _rollup(f)
    assert "machine slept ~20 min" in out
    assert "total: 30.1 min" in out


def test_macos_case_fields_and_note():
    f = _fields_for("macos")
    assert f["slept_seconds"] == pytest.approx(1200.0)
    assert f["wall_clock_seconds"] == pytest.approx(1800.0)
    assert f["counted_sleep_seconds"] == 0.0
    out = _rollup(f)
    assert "machine slept ~20 min" in out
    assert "total: 30.0 min" in out


def test_no_gap_case_fields_and_no_note():
    f = _fields_for("none")
    assert f["slept_seconds"] == 0.0
    assert f["wall_clock_seconds"] == pytest.approx(1800.0)
    assert "machine slept" not in _rollup(f)


def test_monotonic_ahead_of_wall_never_goes_negative():
    # An NTP step back can put time.time() behind monotonic; sleep stays >= 0.
    f = sleep_usage_fields(1800.0, 1790.0, 0.0)
    assert f["slept_seconds"] == 0.0


# --- wiring: _run_agent's usage -> run_e2e_test's persisted fields -----------


def test_run_e2e_test_applies_the_counted_sleep_from_run_agent(tmp_path, monkeypatch):
    result, _paths = _drive(
        tmp_path,
        monkeypatch,
        judge=lambda **kwargs: {"verdict": "partial", "per_finding": {}},
        final_tree={"persons": []},
        usage={"counted_sleep_seconds": 1200.0},
    )
    u = result.usage
    assert u["counted_sleep_seconds"] == 1200.0
    assert u["slept_seconds"] >= 1200.0
    # The stubbed run takes well under a second, so active time goes negative
    # by ~1200: the subtraction was applied, and applied once.
    assert u["wall_clock_seconds"] == pytest.approx(
        u["real_clock_seconds"] - 1200.0, abs=5.0
    )


def test_run_e2e_test_without_the_key_records_zero_counted(tmp_path, monkeypatch):
    result, _paths = _drive(
        tmp_path,
        monkeypatch,
        judge=lambda **kwargs: {"verdict": "partial", "per_finding": {}},
        final_tree={"persons": []},
    )
    assert result.usage["counted_sleep_seconds"] == 0.0
    assert result.usage["wall_clock_seconds"] >= 0.0


def test_run_agent_wraps_consume_in_the_heartbeat_and_returns_its_count(
    tmp_path, monkeypatch
):
    # A detector whose every tick counts 7 s, ticking every 10 ms, over a stream
    # that takes ~100 ms: a nonzero count proves the heartbeat ran around
    # `_consume()` (a bare `_consume()` would leave it at 0), and equality proves
    # the returned usage carries THIS detector's figure.
    made: list[SleepDetector] = []

    class CountingDetector(SleepDetector):
        def __init__(self, **kw):
            super().__init__(tick_seconds=0.01)
            made.append(self)

        def tick(self):
            self.counted_sleep_seconds += 7.0

    steps = [(0.0, _sys())] + [(0.02, _sys()) for _ in range(4)] + [(0.0, _result())]
    monkeypatch.setattr(orchestrator, "query", lambda **kw: _FakeAgen(steps))
    monkeypatch.setattr(orchestrator, "SleepDetector", CountingDetector)
    fx = _fixture(tmp_path, inactivity_seconds=5, wall_clock_seconds=30)
    usage = _run(fx, tmp_path)[2]
    assert len(made) == 1
    assert usage["counted_sleep_seconds"] == made[0].counted_sleep_seconds
    assert usage["counted_sleep_seconds"] > 7.0
