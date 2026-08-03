"""Unit tests for e2e.corpus_report — three-axis totals over committed runs."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.corpus_report import format_report, tally


def _write(dir_: Path, name: str, payload: dict) -> Path:
    path = dir_ / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_tally_counts_each_axis_independently(tmp_path: Path):
    paths = [
        # v1 run: recovered the answer but bypassed a guardrail.
        _write(tmp_path, "run-1.json", {
            "harness_schema_version": 1,
            "verdict": "pass", "compliance": "fail", "outcome": "fail",
        }),
        # v1 clean pass.
        _write(tmp_path, "run-2.json", {
            "harness_schema_version": 1,
            "verdict": "pass", "compliance": "pass", "outcome": "pass",
        }),
        # Pre-detector run: never checked.
        _write(tmp_path, "run-3.json", {"verdict": "partial"}),
    ]
    recall, compliance, gate, problems = tally(paths)

    assert recall == {"pass": 2, "partial": 1}
    assert compliance == {"fail": 1, "pass": 1, "not_checked": 1}
    assert gate == {"fail": 1, "pass": 1, "partial": 1}
    assert problems == []


def test_not_checked_is_never_folded_into_the_gate_pass_count(tmp_path: Path):
    """The whole point of the third compliance value. An unchecked run is an
    unknown, and counting it as clean would reinstate the uninterpretable
    aggregate issue #972 was filed about."""
    paths = [
        _write(tmp_path, f"run-{i}.json", {"verdict": "pass"}) for i in range(3)
    ]
    recall, compliance, gate, _ = tally(paths)

    assert compliance == {"not_checked": 3}
    assert compliance.get("pass", 0) == 0, "unchecked must not read as clean"

    out = format_report(recall, compliance, gate, n_runs=3)
    assert "3 not_checked" in out
    assert "unknown compliance" in out


def test_tally_reports_unreadable_files_instead_of_crashing(tmp_path: Path):
    good = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    bad = tmp_path / "run-2.json"
    bad.write_text("{not json", encoding="utf-8")

    recall, _compliance, _gate, problems = tally([good, bad])
    assert recall == {"pass": 1}
    assert len(problems) == 1
    assert "run-2.json" in problems[0]


def test_format_report_omits_the_note_when_everything_was_checked(tmp_path: Path):
    paths = [
        _write(tmp_path, "run-1.json", {
            "harness_schema_version": 1,
            "verdict": "pass", "compliance": "pass", "outcome": "pass",
        })
    ]
    recall, compliance, gate, _ = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=1)
    assert "unknown compliance" not in out
    assert "1 pass" in out
