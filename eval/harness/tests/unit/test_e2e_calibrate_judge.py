"""Unit tests for e2e.calibrate_judge — agreement math + set validation.

The judge API call is injected (fake run_judge), so these run offline.
"""

from __future__ import annotations

import json

import pytest

from e2e.calibrate_judge import (
    CalibrationReport,
    grade_case,
    load_cases,
)


def _case(case_id, human_verdict, human_per_finding, **extra):
    base = {
        "id": case_id,
        "research_question": "Who were John Smith's parents?",
        "expected_findings": {"findings": [{"id": fid} for fid in human_per_finding]},
        "final_tree": {"persons": []},
        "human": {"verdict": human_verdict, "per_finding": human_per_finding},
    }
    base.update(extra)
    return base


def _fake_judge(verdict, per_finding):
    """Build a run_judge stand-in returning a fixed judge output."""
    def _run(**_kwargs):
        return {
            "verdict": verdict,
            "per_finding": [
                {"finding_id": fid, "matched": label}
                for fid, label in per_finding.items()
            ],
            "recall_required": 0.0,
            "recall_total": 0.0,
            "rationale": "fake",
        }
    return _run


# --- per-case grading -------------------------------------------------

def test_full_agreement_case():
    case = _case("c1", "pass", {"f1": "true", "f2": "true"})
    fake = _fake_judge("pass", {"f1": "true", "f2": "true"})
    r = grade_case(case, model="m", run_judge=fake)
    assert r.error is None
    assert r.finding_total == 2
    assert r.finding_agreed == 2
    assert r.finding_disagreements == []
    assert r.run_agreed is True


def test_per_finding_disagreement_is_recorded():
    case = _case("c1", "partial", {"f1": "true", "f2": "partial"})
    # Judge calls f2 false where human said partial.
    fake = _fake_judge("partial", {"f1": "true", "f2": "false"})
    r = grade_case(case, model="m", run_judge=fake)
    assert r.finding_total == 2
    assert r.finding_agreed == 1
    assert len(r.finding_disagreements) == 1
    assert "human=partial judge=false" in r.finding_disagreements[0]
    assert r.run_agreed is True  # per-run verdict still matched


def test_run_verdict_disagreement():
    case = _case("c1", "pass", {"f1": "true"})
    fake = _fake_judge("partial", {"f1": "true"})  # judge under-calls the run
    r = grade_case(case, model="m", run_judge=fake)
    assert r.run_agreed is False
    assert r.finding_agreed == 1  # per-finding still agreed


def test_missing_finding_in_judge_output_counts_as_disagreement():
    case = _case("c1", "pass", {"f1": "true", "f2": "true"})
    fake = _fake_judge("pass", {"f1": "true"})  # judge omitted f2
    r = grade_case(case, model="m", run_judge=fake)
    assert r.finding_agreed == 1
    assert r.finding_total == 2
    assert any("f2" in d for d in r.finding_disagreements)


def test_judge_error_is_recorded_not_raised():
    case = _case("c1", "pass", {"f1": "true"})
    def _boom(**_kwargs):
        raise RuntimeError("judge exploded")
    r = grade_case(case, model="m", run_judge=_boom)
    assert r.error is not None
    assert "judge exploded" in r.error


# --- report aggregation ----------------------------------------------

def test_report_aggregates_and_gates_on_target():
    # 4 findings, 3 agreed -> 75% -> below the 80% target
    r1 = grade_case(
        _case("c1", "pass", {"f1": "true", "f2": "true"}),
        model="m",
        run_judge=_fake_judge("pass", {"f1": "true", "f2": "true"}),
    )
    r2 = grade_case(
        _case("c2", "partial", {"f3": "true", "f4": "partial"}),
        model="m",
        run_judge=_fake_judge("partial", {"f3": "true", "f4": "false"}),
    )
    report = CalibrationReport(results=[r1, r2])
    assert report.finding_total == 4
    assert report.finding_agreed == 3
    assert report.per_finding_agreement == pytest.approx(0.75)
    assert report.meets_target is False


def test_report_meets_target_at_threshold():
    # 5/5 findings agreed -> 100% -> meets target, no errors
    results = [
        grade_case(
            _case(f"c{i}", "pass", {f"f{i}": "true"}),
            model="m",
            run_judge=_fake_judge("pass", {f"f{i}": "true"}),
        )
        for i in range(5)
    ]
    report = CalibrationReport(results=results)
    assert report.per_finding_agreement == 1.0
    assert report.meets_target is True


def test_errors_block_target_even_at_high_agreement():
    good = grade_case(
        _case("c1", "pass", {"f1": "true"}),
        model="m",
        run_judge=_fake_judge("pass", {"f1": "true"}),
    )
    def _boom(**_kwargs):
        raise RuntimeError("x")
    bad = grade_case(_case("c2", "pass", {"f2": "true"}), model="m", run_judge=_boom)
    report = CalibrationReport(results=[good, bad])
    assert report.errors
    assert report.meets_target is False


# --- calibration set loading / validation ----------------------------

def test_load_cases_rejects_empty_set(tmp_path):
    p = tmp_path / "cases.json"
    p.write_text(json.dumps({"cases": []}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_cases(p)


def test_load_cases_rejects_bad_human_label(tmp_path):
    p = tmp_path / "cases.json"
    bad = _case("c1", "pass", {"f1": "yes"})  # 'yes' is not a valid label
    p.write_text(json.dumps({"cases": [bad]}), encoding="utf-8")
    with pytest.raises(ValueError) as exc:
        load_cases(p)
    assert "not true/partial/false" in str(exc.value)


def test_load_cases_rejects_missing_required_field(tmp_path):
    p = tmp_path / "cases.json"
    bad = _case("c1", "pass", {"f1": "true"})
    del bad["final_tree"]
    p.write_text(json.dumps({"cases": [bad]}), encoding="utf-8")
    with pytest.raises(ValueError) as exc:
        load_cases(p)
    assert "final_tree" in str(exc.value)


def test_load_cases_returns_model_override(tmp_path):
    p = tmp_path / "cases.json"
    good = _case("c1", "pass", {"f1": "true"})
    p.write_text(
        json.dumps({"model": "claude-haiku-4-5", "cases": [good]}), encoding="utf-8"
    )
    cases, model = load_cases(p)
    assert len(cases) == 1
    assert model == "claude-haiku-4-5"
