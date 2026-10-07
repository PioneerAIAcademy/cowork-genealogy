"""Tests for `make e2e-compare` — two runs of one fixture side by side.

The comparison file lives in the folder the blind grader works from, so the
judge's grade may appear only when BOTH runs are graded (spec §7.4).
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.run_compare import compare, keep_newest_comparisons, main, next_comparison_path

REAL_DIR = Path(__file__).resolve().parents[3] / "runlogs" / "e2e" / "anders-monsen-ancestry"


def _log(cost, **over):
    log = {
        "test_id": "fx", "captured_at": "t", "harness_schema_version": 3,
        "verdict": "pass", "compliance": "clean", "outcome": "pass", "stop_reason": "completed",
        "skills_hash": "h1", "git_sha": "abc",
        "judge_output": {"verdict": "pass", "recall_required": 1.0},
        "usage": {"total_cost_usd": cost, "wall_clock_seconds": 600.0, "num_turns": 10,
                  "agent_model": "claude-sonnet-4-6", "effort_level": "high"},
        "tool_calls": [],
    }
    log.update(over)
    return log


def _pair(tmp_path, before, after, graded=(False, False)):
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    paths = []
    for name, log, g in (("run-2026-10-01_00-00-00", before, graded[0]),
                         ("run-2026-10-02_00-00-00", after, graded[1])):
        p = fx / f"{name}.json"
        p.write_text(json.dumps(log), encoding="utf-8")
        if g:
            (fx / f"{name}.ann.json").write_text("{}", encoding="utf-8")
        paths.append(p)
    return paths


def test_the_grade_shows_only_when_both_runs_are_graded(tmp_path):
    b, a = _pair(tmp_path, _log(5.0), _log(4.0), graded=(True, False))
    text = compare(_log(5.0), b, _log(4.0), a)
    assert "verdict" not in text and "recall" not in text
    b, a = _pair(tmp_path, _log(5.0), _log(4.0), graded=(True, True))
    assert "verdict" in compare(_log(5.0), b, _log(4.0), a)


def test_settings_that_moved_are_named(tmp_path):
    after = _log(4.0)
    after["usage"]["effort_level"] = "low"
    after["skills_hash"] = "h2"
    b, a = _pair(tmp_path, _log(5.0), after)
    text = compare(_log(5.0), b, after, a)
    assert "plugin skills + agents: CHANGED" in text
    assert "effort_level 'high' -> 'low'" in text
    assert "$5.00 -> $4.00" in text and "-20%" in text


def test_a_real_committed_comparison_shows_helper_time_and_both_grades():
    before = REAL_DIR / "run-2026-09-30_07-29-52.json"
    after = REAL_DIR / "run-2026-10-05_16-07-18.json"
    text = compare(json.loads(before.read_text(encoding="utf-8")), before,
                   json.loads(after.read_text(encoding="utf-8")), after)
    assert "29.1 min -> 57.4 min" in text
    assert "$14.58 -> $15.66" in text
    assert "partial -> pass" in text  # both runs graded, so the grade shows
    # A fraction keeps its decimals: 0.75 -> 1.0 printed as "1 -> 1 +33%" once.
    assert "0.75 -> 1.00" in text


def test_files_are_numbered_and_only_five_kept(tmp_path):
    fx = tmp_path / "fx"
    assert next_comparison_path(fx).name == "01_comparison.txt"
    (fx / "comparison").mkdir(parents=True)
    for n in range(1, 8):
        (fx / "comparison" / f"{n:02d}_comparison.txt").write_text("x", encoding="utf-8")
    assert next_comparison_path(fx).name == "08_comparison.txt"
    keep_newest_comparisons(fx)
    assert sorted(p.name for p in (fx / "comparison").iterdir()) == [
        f"{n:02d}_comparison.txt" for n in range(3, 8)
    ]
    # Numbering continues past pruned files rather than reusing a number.
    assert next_comparison_path(fx).name == "08_comparison.txt"


def test_main_writes_the_next_numbered_file_and_prints_it(tmp_path, capsys):
    b, a = _pair(tmp_path, _log(5.0), _log(4.0))
    assert main(["--before", str(b), "--after", str(a)]) == 0
    saved = tmp_path / "fx" / "comparison" / "01_comparison.txt"
    assert saved.exists()
    assert "$5.00 -> $4.00" in capsys.readouterr().out
