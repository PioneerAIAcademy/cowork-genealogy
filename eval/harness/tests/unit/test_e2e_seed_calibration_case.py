"""Unit tests for e2e.seed_calibration_case — run log -> case stub."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.seed_calibration_case import build_case


def _setup(tmp_path: Path):
    """Lay out a minimal fixture + run log with siblings; return runlog path."""
    slug = "smith-parents"
    fixtures = tmp_path / "tests" / "e2e"
    fixture_dir = fixtures / slug
    fixture_dir.mkdir(parents=True)
    (fixture_dir / "fixture.json").write_text(
        json.dumps({"id": slug, "researcher_question": "Who were John's parents?"}),
        encoding="utf-8",
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": [{"id": "f1"}, {"id": "f2"}]}), encoding="utf-8"
    )

    run_dir = tmp_path / "runlogs" / "e2e" / slug
    run_dir.mkdir(parents=True)
    stem = "run-2026-06-15_10-00-00"
    (run_dir / f"{stem}.json").write_text(
        json.dumps(
            {
                "test_id": slug,
                "verdict": "partial",
                "judge_output": {
                    "verdict": "partial",
                    "per_finding": [
                        {"finding_id": "f1", "matched": "true"},
                        {"finding_id": "f2", "matched": "false"},
                    ],
                    "proof_quality": {"score": 2},
                },
            }
        ),
        encoding="utf-8",
    )
    (run_dir / f"{stem}.final-tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": "I1"}]}), encoding="utf-8"
    )
    (run_dir / f"{stem}.final-research.json").write_text(
        json.dumps({"proof_summaries": [{"id": "ps_001"}]}), encoding="utf-8"
    )
    return run_dir / f"{stem}.json", fixtures


def test_build_case_prefills_judge_blanks_human(tmp_path):
    runlog, fixtures = _setup(tmp_path)
    case = build_case(runlog_path=runlog, fixtures_root=fixtures)

    # Real artifacts carried through
    assert case["research_question"] == "Who were John's parents?"
    assert case["final_tree"] == {"persons": [{"id": "I1"}]}
    assert case["final_research"] == {"proof_summaries": [{"id": "ps_001"}]}
    assert case["expected_findings"]["findings"][0]["id"] == "f1"

    # Judge's labels pre-filled for the grader to compare against
    assert case["_judge"]["verdict"] == "partial"
    assert case["_judge"]["per_finding"] == {"f1": "true", "f2": "false"}
    assert case["_judge"]["proof_quality_score"] == 2

    # Human block blank — every finding id present, all null
    assert case["human"]["verdict"] is None
    assert case["human"]["per_finding"] == {"f1": None, "f2": None}


def test_build_case_slug_survives_hyphen_run_in_slug(tmp_path):
    """A fixture slug containing '-run-' must not be mangled — the case
    carries the real slug, not one re-derived by splitting on '-run-'."""
    slug = "smith-run-away-1850"
    fixtures = tmp_path / "tests" / "e2e"
    fdir = fixtures / slug
    fdir.mkdir(parents=True)
    (fdir / "fixture.json").write_text(
        json.dumps({"id": slug, "researcher_question": "q"}), encoding="utf-8"
    )
    (fdir / "expected-findings.json").write_text(
        json.dumps({"findings": [{"id": "f1"}]}), encoding="utf-8"
    )
    rdir = tmp_path / "runlogs" / "e2e" / slug
    rdir.mkdir(parents=True)
    runlog = rdir / "run-2026-06-15_10-00-00.json"
    runlog.write_text(
        json.dumps({"test_id": slug, "judge_output": {"verdict": "pass", "per_finding": []}}),
        encoding="utf-8",
    )
    case = build_case(runlog_path=runlog, fixtures_root=fixtures)
    assert case["_slug"] == slug


def test_build_case_handles_missing_research_sibling(tmp_path):
    runlog, fixtures = _setup(tmp_path)
    # Remove the research sibling — agent may not have written one.
    (runlog.parent / f"{runlog.name[:-5]}.final-research.json").unlink()
    case = build_case(runlog_path=runlog, fixtures_root=fixtures)
    assert case["final_research"] is None
    # Still produces a usable stub
    assert case["human"]["per_finding"] == {"f1": None, "f2": None}
