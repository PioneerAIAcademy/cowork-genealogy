"""Unit tests for e2e.calibrate_judge — agreement math + annotation loading.

The judge API call is injected (fake run_judge), so these run offline. The
loader (`load_annotated_runs`) assembles cases from a committed annotation + its
run-log siblings + the fixture; there is no standalone calibration-case file.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.calibrate_judge import (
    CalibrationReport,
    derive_verdict,
    grade_case,
    load_annotated_runs,
    main,
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
    fake = _fake_judge("partial", {"f1": "true", "f2": "false"})
    r = grade_case(case, model="m", run_judge=fake)
    assert r.finding_total == 2
    assert r.finding_agreed == 1
    assert len(r.finding_disagreements) == 1
    assert "human=partial judge=false" in r.finding_disagreements[0]
    assert r.run_agreed is True  # per-run verdict still matched


def test_disagreement_carries_per_finding_note():
    case = _case(
        "smith/run-x", "partial", {"f1": "true", "f2": "partial"},
        human={
            "verdict": "partial",
            "per_finding": {"f1": "true", "f2": "partial"},
            "notes": {"f2": "year-only date — date-precision call."},
        },
    )
    fake = _fake_judge("partial", {"f1": "true", "f2": "true"})
    r = grade_case(case, model="m", run_judge=fake)
    assert len(r.finding_disagreements) == 1
    d = r.finding_disagreements[0]
    assert "smith/run-x/f2" in d
    assert "note: year-only date" in d


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
    assert r.pq_agreed is None
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
    fake = _fake_judge("pass", {"f1": "true"}, pq_score=1)
    r = grade_case(case, model="m", run_judge=fake)
    assert r.pq_agreed is False


def test_proof_quality_does_not_gate_target():
    """A pq disagreement must not flip meets_target — only recall gates."""
    case = _case("c1", "pass", {"f1": "true"})
    case["human"]["proof_quality_score"] = 3
    fake = _fake_judge("pass", {"f1": "true"}, pq_score=1)
    r = grade_case(case, model="m", run_judge=fake)
    report = CalibrationReport(results=[r])
    assert r.pq_agreed is False
    assert report.per_finding_agreement == 1.0
    assert report.meets_target is True


# --- report aggregation ----------------------------------------------

def test_report_aggregates_and_gates_on_target():
    r1 = grade_case(
        _case("c1", "pass", {"f1": "true", "f2": "true"}),
        model="m", run_judge=_fake_judge("pass", {"f1": "true", "f2": "true"}),
    )
    r2 = grade_case(
        _case("c2", "partial", {"f3": "true", "f4": "partial"}),
        model="m", run_judge=_fake_judge("partial", {"f3": "true", "f4": "false"}),
    )
    report = CalibrationReport(results=[r1, r2])
    assert report.finding_total == 4
    assert report.finding_agreed == 3
    assert report.per_finding_agreement == pytest.approx(0.75)
    assert report.meets_target is False


def test_report_meets_target_at_threshold():
    results = [
        grade_case(
            _case(f"c{i}", "pass", {f"f{i}": "true"}),
            model="m", run_judge=_fake_judge("pass", {f"f{i}": "true"}),
        )
        for i in range(5)
    ]
    report = CalibrationReport(results=results)
    assert report.per_finding_agreement == 1.0
    assert report.meets_target is True


def test_errors_block_target_even_at_high_agreement():
    good = grade_case(
        _case("c1", "pass", {"f1": "true"}),
        model="m", run_judge=_fake_judge("pass", {"f1": "true"}),
    )
    def _boom(**_kwargs):
        raise RuntimeError("x")
    bad = grade_case(_case("c2", "pass", {"f2": "true"}), model="m", run_judge=_boom)
    report = CalibrationReport(results=[good, bad])
    assert report.errors
    assert report.meets_target is False


# --- verdict derivation ----------------------------------------------

def _findings(*specs):
    """specs are (id, required) pairs."""
    return [{"id": fid, "required": req} for fid, req in specs]


def test_derive_verdict_all_required_true_is_pass():
    findings = _findings(("f1", True), ("f2", True))
    assert derive_verdict({"f1": "true", "f2": "true"}, findings) == "pass"


def test_derive_verdict_some_partial_is_partial():
    findings = _findings(("f1", True), ("f2", True))
    assert derive_verdict({"f1": "true", "f2": "partial"}, findings) == "partial"


def test_derive_verdict_no_required_matched_is_fail():
    findings = _findings(("f1", True), ("f2", True))
    assert derive_verdict({"f1": "false", "f2": "false"}, findings) == "fail"


def test_derive_verdict_ignores_non_required():
    # f2 is bonus (required=False) and missed; the required f1 fully matched.
    findings = _findings(("f1", True), ("f2", False))
    assert derive_verdict({"f1": "true", "f2": "false"}, findings) == "pass"


def test_derive_verdict_polarity_agnostic():
    # An avoid finding labeled "true" (correctly avoided) rolls up like any true.
    findings = _findings(("f1", True), ("f2", True))
    assert derive_verdict({"f1": "true", "f2": "true"}, findings) == "pass"


# --- loader: assemble cases from annotations -------------------------

def _layout(tmp_path, slug="smith-1850", *, findings=None, ann=None,
            tree=True, research=True, fixture=True, stem="run-2026-06-15_10-00-00"):
    """Create fixtures_root + runlog_root with one slug/run/annotation.

    Returns (runlog_root, fixtures_root, ann_path).
    """
    if findings is None:
        findings = [{"id": "f1", "required": True}, {"id": "f2", "required": True}]
    fixtures_root = tmp_path / "tests" / "e2e"
    runlog_root = tmp_path / "runlogs" / "e2e"
    fdir = fixtures_root / slug
    rdir = runlog_root / slug
    fdir.mkdir(parents=True, exist_ok=True)
    rdir.mkdir(parents=True, exist_ok=True)
    if fixture:
        (fdir / "fixture.json").write_text(
            json.dumps({"id": slug, "researcher_question": "q?"}), encoding="utf-8")
        (fdir / "expected-findings.json").write_text(
            json.dumps({"findings": findings}), encoding="utf-8")
    # The run log itself (must NOT be matched by the loader's glob).
    (rdir / f"{stem}.json").write_text(
        json.dumps({"test_id": slug, "judge_output": {"verdict": "pass"}}),
        encoding="utf-8")
    if tree:
        (rdir / f"{stem}.final-tree.gedcomx.json").write_text(
            json.dumps({"persons": [{"id": "I1"}]}), encoding="utf-8")
    if research:
        (rdir / f"{stem}.final-research.json").write_text(
            json.dumps({"proof_summaries": [{"id": "ps_001"}]}), encoding="utf-8")
    if ann is None:
        ann = {"annotator": "alice", "per_finding": {"f1": "true", "f2": "partial"}}
    ann_path = rdir / f"{stem}.ann.json"
    ann_path.write_text(json.dumps(ann), encoding="utf-8")
    return runlog_root, fixtures_root, ann_path


def test_loader_glob_excludes_non_ann_siblings(tmp_path):
    rr, fr, _ = _layout(tmp_path)
    cases, problems = load_annotated_runs(rr, fr)
    assert problems == []
    assert len(cases) == 1
    # The run log and final-* siblings are not themselves cases.
    assert cases[0]["id"] == "smith-1850/run-2026-06-15_10-00-00"


def test_loader_assembly_and_derived_verdict(tmp_path):
    rr, fr, _ = _layout(tmp_path)  # f1=true, f2=partial
    cases, problems = load_annotated_runs(rr, fr)
    assert problems == []
    case = cases[0]
    assert case["research_question"] == "q?"
    assert case["final_tree"] == {"persons": [{"id": "I1"}]}
    assert case["final_research"] == {"proof_summaries": [{"id": "ps_001"}]}
    assert case["human"]["verdict"] == "partial"  # derived from f1=true, f2=partial


def test_loader_missing_research_sibling_is_none(tmp_path):
    rr, fr, _ = _layout(tmp_path, research=False)
    cases, problems = load_annotated_runs(rr, fr)
    assert problems == []
    assert cases[0]["final_research"] is None


def test_loader_incomplete_warns_and_skips(tmp_path):
    rr, fr, _ = _layout(tmp_path, ann={"per_finding": {"f1": "true", "f2": None}})
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert len(problems) == 1
    assert problems[0].severity == "warn"
    assert "ungraded" in problems[0].message


def test_loader_incomplete_beats_missing_fixture_and_tree(tmp_path):
    # Incomplete grade whose fixture AND tree are gone -> still just WARN+SKIP.
    rr, fr, _ = _layout(
        tmp_path, fixture=False, tree=False,
        ann={"per_finding": {"f1": None, "f2": None}},
    )
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert [p.severity for p in problems] == ["warn"]


def test_loader_drift_is_error(tmp_path):
    # Annotation labels f1 + f3; fixture has f1 + f2.
    rr, fr, _ = _layout(tmp_path, ann={"per_finding": {"f1": "true", "f3": "true"}})
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert [p.severity for p in problems] == ["error"]
    assert "fixture changed" in problems[0].message


def test_loader_orphaned_fixture_is_error(tmp_path):
    rr, fr, _ = _layout(tmp_path, fixture=False)  # filled grade, no fixture
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert [p.severity for p in problems] == ["error"]
    assert "unreadable" in problems[0].message


def test_loader_missing_tree_is_error(tmp_path):
    rr, fr, _ = _layout(tmp_path, tree=False)  # filled grade, no tree
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert [p.severity for p in problems] == ["error"]
    assert "nothing to grade" in problems[0].message


def test_loader_unknown_key_is_error(tmp_path):
    # proof_quality (typo for proof_quality_score) is not an allowed key.
    rr, fr, _ = _layout(
        tmp_path,
        ann={"per_finding": {"f1": "true", "f2": "true"}, "proof_quality": 2},
    )
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert [p.severity for p in problems] == ["error"]
    assert "unknown key" in problems[0].message


def test_loader_missing_per_finding_is_error(tmp_path):
    rr, fr, _ = _layout(tmp_path, ann={"annotator": "alice"})
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert "'per_finding'" in problems[0].message


def test_loader_bad_label_is_error(tmp_path):
    rr, fr, _ = _layout(tmp_path, ann={"per_finding": {"f1": "true", "f2": "yes"}})
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert "not in ['false', 'partial', 'true']" in problems[0].message


def test_loader_bad_proof_quality_is_error(tmp_path):
    rr, fr, _ = _layout(
        tmp_path,
        ann={"per_finding": {"f1": "true", "f2": "true"}, "proof_quality_score": 4},
    )
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert "not 1/2/3/null" in problems[0].message


def test_loader_pq_null_is_complete(tmp_path):
    rr, fr, _ = _layout(
        tmp_path,
        ann={"per_finding": {"f1": "true", "f2": "true"}, "proof_quality_score": None},
    )
    cases, problems = load_annotated_runs(rr, fr)
    assert problems == []
    assert len(cases) == 1  # null pq is a complete grade


def test_loader_notes_unknown_finding_is_error(tmp_path):
    rr, fr, _ = _layout(
        tmp_path,
        ann={"per_finding": {"f1": "true", "f2": "true"}, "notes": {"f3": "x"}},
    )
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert "unknown finding" in problems[0].message


def test_loader_notes_carried_into_case(tmp_path):
    rr, fr, _ = _layout(
        tmp_path,
        ann={"per_finding": {"f1": "true", "f2": "partial"}, "notes": {"f2": "x"}},
    )
    cases, problems = load_annotated_runs(rr, fr)
    assert problems == []
    assert cases[0]["human"]["notes"] == {"f2": "x"}


def test_loader_invalid_json_is_error(tmp_path):
    rr, fr, ann_path = _layout(tmp_path)
    ann_path.write_text("{not json", encoding="utf-8")
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert "invalid JSON" in problems[0].message


def test_loader_non_object_is_error(tmp_path):
    rr, fr, ann_path = _layout(tmp_path)
    ann_path.write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")
    cases, problems = load_annotated_runs(rr, fr)
    assert cases == []
    assert "expected a JSON object" in problems[0].message


def test_loader_exclude_not_abort(tmp_path):
    # One valid, one drift (error), one incomplete (warn) — all reported, the
    # valid one still included.
    rr, fr, _ = _layout(tmp_path, slug="good")
    _layout(tmp_path, slug="drift", ann={"per_finding": {"f1": "true", "fX": "true"}})
    _layout(tmp_path, slug="todo", ann={"per_finding": {"f1": "true", "f2": None}})
    cases, problems = load_annotated_runs(rr, fr)
    assert len(cases) == 1
    assert cases[0]["id"].startswith("good/")
    sev = sorted(p.severity for p in problems)
    assert sev == ["error", "warn"]


def test_loader_no_annotations_is_empty(tmp_path):
    fixtures_root = tmp_path / "tests" / "e2e"
    runlog_root = tmp_path / "runlogs" / "e2e"
    runlog_root.mkdir(parents=True)
    cases, problems = load_annotated_runs(runlog_root, fixtures_root)
    assert cases == []
    assert problems == []


# --- main exit codes (dry-run path is offline) ------------------------

def test_main_dry_run_nothing_graded_exits_zero(tmp_path):
    rr, fr, _ = _layout(tmp_path, ann={"per_finding": {"f1": "true", "f2": None}})
    rc = main(["--dry-run", "--runlog-root", str(rr), "--fixtures-root", str(fr)])
    assert rc == 0  # warnings only, no errors


def test_main_dry_run_with_error_exits_two(tmp_path):
    rr, fr, _ = _layout(tmp_path, ann={"per_finding": {"f1": "true", "f3": "true"}})
    rc = main(["--dry-run", "--runlog-root", str(rr), "--fixtures-root", str(fr)])
    assert rc == 2  # drift is an error


def test_main_dry_run_valid_exits_zero(tmp_path):
    rr, fr, _ = _layout(tmp_path)
    rc = main(["--dry-run", "--runlog-root", str(rr), "--fixtures-root", str(fr)])
    assert rc == 0


def test_main_missing_runlog_root_exits_two(tmp_path):
    rc = main([
        "--runlog-root", str(tmp_path / "nope"),
        "--fixtures-root", str(tmp_path),
    ])
    assert rc == 2
