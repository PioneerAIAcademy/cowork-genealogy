"""Tests for `make unit-compare` — one unit run against the run before it.

The traps it exists to avoid: comparing a one-test scratch run against a full
suite as if the totals were like for like, sorting logs by filename when a
`scratch_` and a `v1_` log interleave by time, and reporting a cost move without
saying whether anything the run depended on changed.
"""

from __future__ import annotations

import json
from pathlib import Path

from unit_run_compare import changed_files, compare, latest_two


def _test(tid, cost, outcome="pass", turns=2, wall=23_000, peak=None):
    run = {"outcome": outcome}
    if peak is not None:
        run["main_thread"] = {"peak_window_tokens": peak, "compactions": [], "models": []}
    return {"test_id": tid, "outcome": outcome, "runs": [run],
            "totals": {"skill_cost_usd": cost, "num_turns": turns, "wall_clock_ms": wall}}


def _log(ts, tests, snapshot=None):
    return {"skill": "check-warnings", "timestamp": ts, "model": "claude-sonnet-4-6",
            "tests": tests, "snapshot": snapshot if snapshot is not None else {"a.md": "1"}}


def test_compares_only_tests_in_both_and_says_so():
    before = _log("2026-10-01_00-00-00", [_test("ut_1", 0.10), _test("ut_2", 0.20)])
    after = _log("2026-10-06_00-00-00", [_test("ut_1", 0.08), _test("ut_3", 0.50)])
    text = compare(before, "v1_a.json", after, "scratch_b.json")
    assert "SUMMARY  (the 1 test(s) in both runs only)" in text
    assert "$0.100 -> $0.080  (-20%)" in text
    assert "only in before (1): ut_2" in text
    assert "only in after (1): ut_3" in text
    # Not the like-for-unlike $0.300 -> $0.080.
    assert "$0.300" not in text


def test_each_row_shows_cost_turns_seconds_and_busiest_moment():
    before = _log("t1", [_test("ut_1", 0.144, turns=2, wall=68_000)])
    after = _log("t2", [_test("ut_1", 0.163, turns=3, wall=82_000, peak=41_230)])
    row = next(line for line in compare(before, "b", after, "a").splitlines()
               if line.startswith("ut_1"))
    assert "$0.144 -> $0.163" in row
    assert "+13%" in row
    assert "2 -> 3" in row
    assert "68 -> 82" in row
    assert "-- -> 41,230" in row  # before predates the capture: dashes, not 0


def test_a_result_change_is_called_out():
    before = _log("t1", [_test("ut_1", 0.1, outcome="pass")])
    after = _log("t2", [_test("ut_1", 0.1, outcome="fail")])
    assert "results changed  ut_1: pass -> fail" in compare(before, "b", after, "a")


def test_names_the_files_that_changed_between_the_runs():
    before = _log("t1", [], snapshot={"agent.md": "1", "test.json": "1", "old.json": "1"})
    after = _log("t2", [], snapshot={"agent.md": "2", "test.json": "1", "new.json": "1"})
    assert changed_files(before, after) == ["agent.md", "new.json (new)", "old.json (gone)"]
    assert "changed between them: 3 file(s)" in compare(before, "b", after, "a")


def test_nothing_changed_says_the_move_is_wobble():
    before = _log("t1", [_test("ut_1", 0.10)])
    after = _log("t2", [_test("ut_1", 0.12)])
    assert "changed between them: nothing" in compare(before, "b", after, "a")


def test_a_log_without_a_snapshot_says_unknown_not_nothing():
    before = _log("t1", [])
    before.pop("snapshot")
    assert changed_files(before, _log("t2", [])) is None
    assert "changed between them: unknown" in compare(before, "b", _log("t2", []), "a")


def test_latest_two_sorts_by_the_logs_own_timestamp_not_the_filename(tmp_path: Path):
    """By name `scratch_` sorts BEFORE every `v1_`, whatever its date — so the
    newest run here, a scratch run, would be dropped by a filename sort."""
    files = {
        "scratch_2026-10-07_00-00-00.json": "2026-10-07_00-00-00",
        "v1_2026-10-01_00-00-00.json": "2026-10-01_00-00-00",
        "v1_2026-10-06_00-00-00.json": "2026-10-06_00-00-00",
    }
    paths = []
    for name, ts in files.items():
        p = tmp_path / name
        p.write_text(json.dumps(_log(ts, [])), encoding="utf-8")
        paths.append(p)
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")
    pair = latest_two(paths + [tmp_path / "broken.json"])
    assert [p.name for p, _ in pair] == ["v1_2026-10-06_00-00-00.json", "scratch_2026-10-07_00-00-00.json"]
