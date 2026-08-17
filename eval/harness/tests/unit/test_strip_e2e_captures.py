"""The e2e capture strip in `scripts/prune_runlogs.py`.

Retention on the e2e corpus is keyed on **age** and **strips** rather than
deletes — the opposite of the unit corpus on both counts. These tests pin the
three properties that make that safe: the calibration triple survives at any
age, a run inside the window is byte-identical after a sweep, and a second
sweep is a no-op.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

HARNESS_DIR = Path(__file__).resolve().parents[2]
if str(HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(HARNESS_DIR))

from scripts.prune_runlogs import (  # noqa: E402
    CAPTURES_STRIPPED_KEY,
    cmd_strip_e2e_captures,
    committed_e2e_runlogs,
    strip_captures_one,
)

CUTOFF = date(2026, 8, 2)
OLD = "run-2026-07-09_12-04-16"
NEW = "run-2026-08-14_09-00-00"


def _runlog(calls: list[dict] | None = None) -> dict:
    return {
        "test_id": "e2e_x",
        "captured_at": "2026-07-09T12:04:16Z",
        "verdict": "pass",
        "tool_calls": calls
        if calls is not None
        else [
            {
                "tool": "mcp__genealogy__record_search",
                "args": {"surname": "Monsen"},
                "response_summary": "x" * 4000,
                "is_error": False,
            },
            {
                "tool": "mcp__genealogy__record_read",
                "args": {"recordId": "abc"},
                "response_summary": "y" * 4000,
                "is_error": True,
            },
        ],
    }


def _fixture_dir(tmp_path: Path, stem: str = OLD) -> Path:
    """One fixture dir holding a run log and its full calibration triple."""
    d = tmp_path / "anders-monsen-ancestry"
    d.mkdir(parents=True)
    (d / f"{stem}.json").write_text(json.dumps(_runlog()), encoding="utf-8")
    (d / f"{stem}.ann.json").write_text(
        json.dumps({"per_finding": [{"id": "f1", "label": "true"}]}), encoding="utf-8"
    )
    (d / f"{stem}.final-research.json").write_text(
        json.dumps({"research_questions": []}), encoding="utf-8"
    )
    (d / f"{stem}.final-tree.gedcomx.json").write_text(
        json.dumps({"persons": []}), encoding="utf-8"
    )
    return d


def test_strips_response_summary_and_keeps_the_rest(tmp_path: Path) -> None:
    d = _fixture_dir(tmp_path)
    target = d / f"{OLD}.json"

    changed, before, after = strip_captures_one(target, cutoff=CUTOFF)

    assert changed is True
    assert after < before
    log = json.loads(target.read_text(encoding="utf-8"))
    assert [c["tool"] for c in log["tool_calls"]] == [
        "mcp__genealogy__record_search",
        "mcp__genealogy__record_read",
    ]
    assert log["tool_calls"][0]["args"] == {"surname": "Monsen"}
    assert log["tool_calls"][1]["is_error"] is True
    assert all("response_summary" not in c for c in log["tool_calls"])
    # Everything outside tool_calls is untouched.
    assert log["verdict"] == "pass"
    assert log["test_id"] == "e2e_x"


def test_a_run_inside_the_window_is_byte_identical(tmp_path: Path) -> None:
    """Not merely equivalent — the sweep must not rewrite recent logs at all.

    A re-serialize would show up as a diff on every sweep, so the whole corpus
    would churn in git even when nothing was reclaimed.
    """
    d = _fixture_dir(tmp_path, stem=NEW)
    target = d / f"{NEW}.json"
    original = target.read_bytes()

    changed, before, after = strip_captures_one(target, cutoff=CUTOFF)

    assert changed is False
    assert (before, after) == (len(original), len(original))
    assert target.read_bytes() == original


def test_second_sweep_is_a_noop(tmp_path: Path) -> None:
    d = _fixture_dir(tmp_path)
    target = d / f"{OLD}.json"

    assert strip_captures_one(target, cutoff=CUTOFF)[0] is True
    after_first = target.read_bytes()

    changed, before, after = strip_captures_one(target, cutoff=CUTOFF)

    assert changed is False
    assert (before, after) == (len(after_first), len(after_first))
    assert target.read_bytes() == after_first
    assert json.loads(after_first.decode())[CAPTURES_STRIPPED_KEY] is True


def test_calibration_triple_is_never_touched(tmp_path: Path) -> None:
    """`calibrate_judge` hard-errors without these three; the sweep must not
    see them as run logs even though all three match `run-*.json`."""
    d = _fixture_dir(tmp_path)
    siblings = {
        p: p.read_bytes()
        for p in d.iterdir()
        if p.name.endswith(
            (".ann.json", ".final-research.json", ".final-tree.gedcomx.json")
        )
    }
    assert len(siblings) == 3

    cmd_strip_e2e_captures(tmp_path, days=14, dry_run=False)

    for p, original in siblings.items():
        assert p.read_bytes() == original, f"{p.name} was modified"


def test_collector_excludes_the_siblings(tmp_path: Path) -> None:
    d = _fixture_dir(tmp_path)
    found = committed_e2e_runlogs(tmp_path)
    assert found == [d / f"{OLD}.json"]


def test_collector_skips_scratch_and_partial(tmp_path: Path) -> None:
    d = _fixture_dir(tmp_path)
    (d / "scratch_2026-07-09_00-00-00.json").write_text("{}", encoding="utf-8")
    (d / ".partial_2026-07-09_00-00-00.json").write_text("{}", encoding="utf-8")

    assert committed_e2e_runlogs(tmp_path) == [d / f"{OLD}.json"]


def test_undated_filename_is_left_alone(tmp_path: Path) -> None:
    """`run_date` returns None rather than raising; that must mean skip, not
    strip — an unparseable name is the one case where age is unknown."""
    d = tmp_path / "fixture"
    d.mkdir(parents=True)
    target = d / "run-nodate.json"
    target.write_text(json.dumps(_runlog()), encoding="utf-8")
    original = target.read_bytes()

    changed, _, _ = strip_captures_one(target, cutoff=CUTOFF)

    assert changed is False
    assert target.read_bytes() == original


def test_dry_run_changes_nothing_but_counts(tmp_path: Path, capsys) -> None:
    d = _fixture_dir(tmp_path)
    target = d / f"{OLD}.json"
    original = target.read_bytes()

    rc = cmd_strip_e2e_captures(tmp_path, days=14, dry_run=True)

    assert rc == 0
    assert target.read_bytes() == original
    out = capsys.readouterr().out
    assert "1 of 1" in out


def test_missing_root_is_not_an_error(tmp_path: Path, capsys) -> None:
    rc = cmd_strip_e2e_captures(tmp_path / "nope", days=14, dry_run=False)
    assert rc == 0
    assert "no e2e runlog root" in capsys.readouterr().out


def test_a_log_with_no_tool_calls_still_gets_marked(tmp_path: Path) -> None:
    """Otherwise every summary-less run is re-read and re-written on every
    sweep, and the marker stops meaning "already swept"."""
    d = tmp_path / "fixture"
    d.mkdir(parents=True)
    target = d / f"{OLD}.json"
    target.write_text(json.dumps(_runlog(calls=[])), encoding="utf-8")

    changed, _, _ = strip_captures_one(target, cutoff=CUTOFF)

    assert changed is True
    assert json.loads(target.read_text(encoding="utf-8"))[CAPTURES_STRIPPED_KEY] is True
    assert strip_captures_one(target, cutoff=CUTOFF)[0] is False


@pytest.mark.parametrize("days", [1, 14, 21])
def test_cutoff_is_relative_to_the_days_argument(tmp_path: Path, days: int) -> None:
    """The window is a parameter, not a constant baked into the sweep."""
    d = tmp_path / "fixture"
    d.mkdir(parents=True)
    stamp = (date.today() - timedelta(days=days + 1)).strftime("%Y-%m-%d")
    target = d / f"run-{stamp}_00-00-00.json"
    target.write_text(json.dumps(_runlog()), encoding="utf-8")

    cmd_strip_e2e_captures(tmp_path, days=days, dry_run=False)

    log = json.loads(target.read_text(encoding="utf-8"))
    assert log[CAPTURES_STRIPPED_KEY] is True

    inside = d / f"run-{date.today().strftime('%Y-%m-%d')}_00-00-00.json"
    inside.write_text(json.dumps(_runlog()), encoding="utf-8")
    original = inside.read_bytes()
    cmd_strip_e2e_captures(tmp_path, days=days, dry_run=False)
    assert inside.read_bytes() == original
