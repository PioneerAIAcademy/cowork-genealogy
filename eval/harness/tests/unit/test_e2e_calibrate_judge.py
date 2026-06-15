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


def _fake_judge(verdict, per_finding, pq_score=3):
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
            "proof_quality": {"score": pq_score, "rationale": "fake"},
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


# --- proof-quality calibration (optional axis) -----------------------

def test_proof_quality_not_scored_when_human_omits_it():
    case = _case("c1", "pass", {"f1": "true"})  # no proof_quality_score
    fake = _fake_judge("pass", {"f1": "true"}, pq_score=3)
    r = grade_case(case, model="m", run_judge=fake)
    assert r.pq_agreed is None  # not scored — human didn't label it
    assert r.human_pq is None


def test_proof_quality_agreement_when_human_labels_it():
    case = _case("c1", "pass", {"f1": "true"})
    case["human"]["proof_quality_score"] = 2
    fake = _fake_judge("pass", {"f1": "true"}, pq_score=2)
    r = grade_case(case, model="m", run_judge=fake)
    assert r.pq_agreed is True
    assert r.human_pq == 2 and r.judge_pq == 2


def test_proof_quality_disagreement():
    case = _case("c1", "pass", {"f1": "true"})
    case["human"]["proof_quality_score"] = 3
    fake = _fake_judge("pass", {"f1": "true"}, pq_score=1)  # judge under-scores
    r = grade_case(case, model="m", run_judge=fake)
    assert r.pq_agreed is False


def test_proof_quality_does_not_gate_target():
    """A pq disagreement must not flip meets_target — only recall gates."""
    case = _case("c1", "pass", {"f1": "true"})
    case["human"]["proof_quality_score"] = 3
    fake = _fake_judge("pass", {"f1": "true"}, pq_score=1)  # pq disagrees
    r = grade_case(case, model="m", run_judge=fake)
    report = CalibrationReport(results=[r])
    assert r.pq_agreed is False
    assert report.per_finding_agreement == 1.0
    assert report.meets_target is True  # recall is perfect; pq doesn't gate


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
#
# load_cases reads a DIRECTORY of per-file cases (one case object per
# file). There is no monolithic cases.json.

def _write_case(cases_dir, name, case):
    cases_dir.mkdir(exist_ok=True)
    (cases_dir / f"{name}.json").write_text(json.dumps(case), encoding="utf-8")


def test_load_cases_rejects_empty_dir(tmp_path):
    (tmp_path / "cases").mkdir()
    with pytest.raises(ValueError):
        load_cases(tmp_path / "cases")


def test_load_cases_reads_multiple_files(tmp_path):
    d = tmp_path / "cases"
    _write_case(d, "alice", _case("c1", "pass", {"f1": "true"}))
    _write_case(d, "bob", _case("c2", "fail", {"f2": "false"}))
    cases, _ = load_cases(d)
    assert {c["id"] for c in cases} == {"c1", "c2"}


def test_load_cases_rejects_bad_human_label(tmp_path):
    d = tmp_path / "cases"
    _write_case(d, "alice", _case("c1", "pass", {"f1": "yes"}))  # invalid label
    with pytest.raises(ValueError) as exc:
        load_cases(d)
    assert "not true/partial/false" in str(exc.value)


def test_load_cases_error_names_the_file_not_the_case_id(tmp_path):
    """A contributor must know WHICH FILE to fix — error names the filename,
    not the internal case id (which they may not have set meaningfully)."""
    d = tmp_path / "cases"
    bad = _case("internal-id-xyz", "pass", {"f1": "flase"})  # typo
    _write_case(d, "kenneth-tester1", bad)
    with pytest.raises(ValueError) as exc:
        load_cases(d)
    msg = str(exc.value)
    assert "kenneth-tester1.json" in msg
    assert "internal-id-xyz" not in msg


def test_load_cases_rejects_bad_proof_quality_score(tmp_path):
    d = tmp_path / "cases"
    bad = _case("c1", "pass", {"f1": "true"})
    bad["human"]["proof_quality_score"] = 4  # out of 1/2/3/null
    _write_case(d, "alice", bad)
    with pytest.raises(ValueError) as exc:
        load_cases(d)
    assert "not 1/2/3/null" in str(exc.value)


def test_load_cases_accepts_optional_proof_quality(tmp_path):
    d = tmp_path / "cases"
    good = _case("c1", "pass", {"f1": "true"})
    good["human"]["proof_quality_score"] = 2
    good["final_research"] = {"proof_summaries": [{"id": "ps_001"}]}
    _write_case(d, "alice", good)
    cases, _ = load_cases(d)
    assert cases[0]["human"]["proof_quality_score"] == 2


def test_load_cases_rejects_missing_required_field(tmp_path):
    d = tmp_path / "cases"
    bad = _case("c1", "pass", {"f1": "true"})
    del bad["final_tree"]
    _write_case(d, "alice", bad)
    with pytest.raises(ValueError) as exc:
        load_cases(d)
    assert "final_tree" in str(exc.value)


def test_load_cases_rejects_non_object_file(tmp_path):
    d = tmp_path / "cases"
    d.mkdir()
    (d / "bad.json").write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")
    with pytest.raises(ValueError) as exc:
        load_cases(d)
    assert "single JSON case object" in str(exc.value)


def test_load_cases_picks_up_model_from_a_file(tmp_path):
    d = tmp_path / "cases"
    good = _case("c1", "pass", {"f1": "true"})
    good["model"] = "claude-haiku-4-5"
    _write_case(d, "alice", good)
    cases, model = load_cases(d)
    assert len(cases) == 1
    assert model == "claude-haiku-4-5"
