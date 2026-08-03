"""Unit tests for e2e.corpus_report — three-axis totals over committed runs."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.corpus_report import (
    classify,
    format_report,
    run_timestamp,
    tally,
    violations_of,
)


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
    recall, compliance, gate, problems, _arms, _fix = tally(paths)

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
    recall, compliance, gate, _, _arms, _fix = tally(paths)

    assert compliance == {"not_checked": 3}
    assert compliance.get("pass", 0) == 0, "unchecked must not read as clean"

    out = format_report(recall, compliance, gate, n_runs=3)
    assert "3 not_checked" in out
    assert "unknown compliance" in out


def test_tally_reports_unreadable_files_instead_of_crashing(tmp_path: Path):
    good = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    bad = tmp_path / "run-2.json"
    bad.write_text("{not json", encoding="utf-8")

    recall, _compliance, _gate, problems, _arms, _fix = tally([good, bad])
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
    recall, compliance, gate, _, _arms, _fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=1)
    assert "unknown compliance" not in out
    assert "1 pass" in out


# ── violation detail + concentration (issue #1176) ───────────────────────────


def test_violations_read_from_both_runlog_vintages():
    """v1+ carries the list at the top level; pre-v1 nests it under
    judge_output. A reader that knows only one shape silently under-counts the
    other era, which is how a hand-computed window goes wrong."""
    v1 = {"harness_schema_version": 1, "guardrail_bypass_violations": ["a", "b"]}
    pre_v1 = {"judge_output": {"guardrail_bypass_violations": ["c"]}}
    assert violations_of(v1) == ["a", "b"]
    assert violations_of(pre_v1) == ["c"]
    assert violations_of({"verdict": "pass"}) == []


def test_absent_violations_are_not_an_empty_list():
    """Absent means `not_checked`, not clean — the distinction the whole
    compliance axis exists to preserve. `violations_of` returning [] for both
    is fine ONLY because the rate is computed from the compliance axis, never
    from this count."""
    _, compliance, _, _, _, _ = tally([])
    assert compliance.get("pass", 0) == 0


def test_classify_maps_each_arm_and_falls_back_rather_than_dropping():
    assert classify("tree person 'I1' ... 'same_person' was never called") == (
        "same_person (per person)"
    )
    assert classify("... 'research-exhaustiveness' was never ...") == "exhaustiveness"
    assert classify("... 'proof-conclusion' was never ...") == "proof-conclusion"
    assert classify("... 'conflict-resolution' was never ...") == "conflict-resolution"
    # A reworded detector message must surface, not vanish.
    assert classify("some new arm nobody mapped") == "other"


def test_tally_counts_violations_by_arm_and_by_fixture(tmp_path: Path):
    loud = tmp_path / "loud-fixture"
    quiet = tmp_path / "quiet-fixture"
    loud.mkdir()
    quiet.mkdir()
    paths = [
        _write(loud, "run-1.json", {
            "judge_output": {"guardrail_bypass_violations": [
                "'same_person' was never called", "'same_person' was never called",
                "'proof-conclusion' was never invoked",
            ]},
        }),
        _write(quiet, "run-2.json", {
            "judge_output": {"guardrail_bypass_violations": [
                "'conflict-resolution' was never invoked",
            ]},
        }),
    ]
    _, _, _, _, arms, per_fixture = tally(paths)
    assert arms == {"same_person (per person)": 2, "proof-conclusion": 1,
                    "conflict-resolution": 1}
    assert per_fixture == {"loud-fixture": 3, "quiet-fixture": 1}


def test_report_refuses_a_rate_when_nothing_is_decidable(tmp_path: Path):
    """The corpus today. A percentage here would assert 17 unknowns ran clean."""
    paths = [_write(tmp_path, f"run-{i}.json", {"verdict": "pass"}) for i in range(3)]
    recall, compliance, gate, _, arms, fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=3, arms=arms, per_fixture=fix)
    assert "NOT MEASURABLE" in out
    assert "%" not in out.split("violation rate:")[1]


def test_report_calls_an_all_fail_decidable_set_a_floor_not_a_rate(tmp_path: Path):
    """12/12 is not "100% of runs violate" — no run is known clean."""
    paths = [
        _write(tmp_path, "run-1.json", {
            "judge_output": {"verdict": "pass",
                             "guardrail_bypass_violations": ["'same_person' missing"]},
        })
    ]
    recall, compliance, gate, _, arms, fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=1, arms=arms, per_fixture=fix)
    assert "floor on incidence, not a rate" in out


def test_report_flags_a_dominant_fixture_so_the_next_outlier_self_discloses(
    tmp_path: Path,
):
    """The reason this exists: the critique hand-wrote "excluding
    jimmie-jewel-neal", which describes one outlier and no future one."""
    hog, other = tmp_path / "hog", tmp_path / "other"
    hog.mkdir()
    other.mkdir()
    paths = [
        _write(hog, "run-1.json", {"harness_schema_version": 1, "compliance": "fail",
                                   "verdict": "pass", "outcome": "fail",
                                   "guardrail_bypass_violations": ["'same_person' x"] * 8}),
        _write(other, "run-2.json", {"harness_schema_version": 1, "compliance": "fail",
                                     "verdict": "pass", "outcome": "fail",
                                     "guardrail_bypass_violations": ["'same_person' x"]}),
    ]
    recall, compliance, gate, _, arms, fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=2, arms=arms, per_fixture=fix)
    assert "concentration:" in out
    assert "hog" in out
    assert "alone accounts for" in out


def test_run_timestamp_rejects_the_sidecars_that_share_a_run_stem(tmp_path: Path):
    """`.ann` / `.final-*` siblings would triple the denominator. This bit a
    hand-written analysis of exactly this corpus."""
    assert run_timestamp(Path("run-2026-07-30_18-09-08.json")) == "2026-07-30_18-09-08"
    assert run_timestamp(Path("run-2026-07-30_18-09-08.ann.json")) is None
    assert run_timestamp(Path("run-2026-07-30_18-09-08.final-tree.gedcomx.json")) is None
    assert run_timestamp(Path("summary.json")) is None
