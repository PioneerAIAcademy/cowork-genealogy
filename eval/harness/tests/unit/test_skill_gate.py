"""Unit tests for skill_gate.py — the candidate-vs-step-4-baseline gate
(component A of the E->A->B loop). Pure logic over synthetic scores + tmp dirs;
no live run, no Anthropic API — runs in `make harness-test`.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Add the harness root to sys.path so we can import skill_gate.py as a module
# (mirrors tests/unit/test_cli.py).
_HARNESS_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS_ROOT))

import skill_gate  # noqa: E402
from skill_gate import (  # noqa: E402
    compare,
    compute_signal,
    find_test_path_by_id,
    incumbent_baseline,
    scores_of,
)


def _entry(dims):
    """A minimal candidate test entry with the given (source, name, score) dims."""
    return {
        "outcome_summary": {
            "aggregated_dimensions": [
                {"source": s, "name": n, "score": sc, "rationale": "r"}
                for (s, n, sc) in dims
            ]
        },
        "totals": {"total_cost_usd": 0.01},
    }


def _scores(dims):
    """(source, name, score) tuples -> the {(source,name): score} baseline shape."""
    return {(s, n): sc for (s, n, sc) in dims}


# ---- scores_of / compare -------------------------------------------------


def test_scores_of_empty_and_populated():
    assert scores_of({}) == {}
    assert scores_of(_entry([("base", "Correctness", 2)])) == {("base", "Correctness"): 2}


def test_compare_marks_fixed_and_regressed():
    inc = _scores([("base", "Correctness", 1), ("base", "Completeness", 3)])
    cand = scores_of(_entry([("base", "Correctness", 3), ("base", "Completeness", 2)]))
    rows = {r.name: r for r in compare(inc, cand)}

    assert rows["Correctness"].reproduced_failure is True
    assert rows["Correctness"].fixed is True
    assert rows["Correctness"].regressed is False

    assert rows["Completeness"].reproduced_failure is False
    assert rows["Completeness"].fixed is False
    assert rows["Completeness"].regressed is True


def test_compare_handles_missing_candidate_side():
    rows = compare(_scores([("base", "Correctness", 2)]), {})  # candidate aborted
    assert len(rows) == 1
    assert rows[0].candidate is None
    assert rows[0].regressed is False  # a None candidate never counts as a regression


# ---- compute_signal ------------------------------------------------------


def test_signal_looks_good_when_fix_lands_and_no_regression():
    mined = compare(_scores([("base", "Correctness", 1)]),
                    scores_of(_entry([("base", "Correctness", 3)])))
    sig = compute_signal(mined)
    assert sig.verdict == "LOOKS GOOD"
    assert any("named fix landed" in r for r in sig.reasons)


def test_signal_inconclusive_when_failure_does_not_reproduce():
    mined = compare(_scores([("base", "Correctness", 3)]),  # incumbent already passes
                    scores_of(_entry([("base", "Correctness", 3)])))
    assert compute_signal(mined).verdict == "INCONCLUSIVE"


def test_signal_needs_eyes_when_fix_does_not_land():
    mined = compare(_scores([("base", "Correctness", 1)]),
                    scores_of(_entry([("base", "Correctness", 2)])))  # still not pass
    sig = compute_signal(mined)
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("did NOT land" in r for r in sig.reasons)


def test_signal_needs_eyes_on_regression_even_if_fix_lands():
    # The fix landed on Correctness, but another dimension of the same motivating
    # test regressed -> the gate must not report LOOKS GOOD.
    mined = compare(
        _scores([("base", "Correctness", 1), ("rubric", "Locality depth", 3)]),
        scores_of(_entry([("base", "Correctness", 3), ("rubric", "Locality depth", 2)])),
    )
    sig = compute_signal(mined)
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("regression" in r for r in sig.reasons)


def test_signal_needs_eyes_when_a_gate_test_is_ungraded():
    # The fix landed on Correctness, but a dimension the baseline graded is absent
    # on the candidate (aborted, judge raised, or a validator failed and its
    # scores were excluded from the modal) -> candidate
    # scored None. That can't be a "regression" score-wise, but it must block
    # LOOKS GOOD, because we can't confirm no regression.
    mined = compare(
        _scores([("base", "Correctness", 1), ("base", "Completeness", 3)]),
        scores_of(_entry([("base", "Correctness", 3)])),  # Completeness missing
    )
    sig = compute_signal(mined)
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("could not be graded" in r for r in sig.reasons)


def test_signal_named_dimension_restricts_target():
    # Correctness reproduces+fixes; the named target 'Completeness' never failed
    # on the incumbent -> inconclusive on the named dimension.
    mined = compare(
        _scores([("base", "Correctness", 1), ("base", "Completeness", 3)]),
        scores_of(_entry([("base", "Correctness", 3), ("base", "Completeness", 3)])),
    )
    assert compute_signal(mined, named_dimension="Completeness").verdict == "INCONCLUSIVE"


def test_signal_named_dimension_absent_is_flagged():
    mined = compare(_scores([("base", "Correctness", 1)]),
                    scores_of(_entry([("base", "Correctness", 3)])))
    sig = compute_signal(mined, named_dimension="Nonexistent Dim")
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("not scored" in r for r in sig.reasons)


# ---- id resolution -------------------------------------------------------


def _write_test(dir_: Path, tid: str) -> Path:
    p = dir_ / f"{tid}.json"
    p.write_text(json.dumps({"test": {"id": tid}}), encoding="utf-8")
    return p


def test_find_test_path_by_id(tmp_path):
    skill_dir = tmp_path / "citation"
    skill_dir.mkdir()
    _write_test(skill_dir, "ut_citation_002")
    (skill_dir / "rubric.md").write_text("# rubric", encoding="utf-8")

    assert find_test_path_by_id("ut_citation_002", skill_dir).name == "ut_citation_002.json"
    assert find_test_path_by_id("nope", skill_dir) is None


# ---- incumbent baseline (step-4 run-log + .ann overlay) ------------------


def test_incumbent_baseline_overlays_human_corrections(tmp_path):
    skill = "citation"
    d = tmp_path / "unit" / skill
    d.mkdir(parents=True)
    (d / "v1_2026-07-16_10-00-00.json").write_text(json.dumps({
        "timestamp": "2026-07-16_10-00-00",
        "snapshot": {f"packages/engine/plugin/skills/{skill}/SKILL.md": "the body"},
        "tests": [{
            "test_id": "ut_citation_002",
            "outcome_summary": {"aggregated_dimensions": [
                {"source": "base", "name": "Correctness", "score": 2, "rationale": "r"},
                {"source": "base", "name": "Completeness", "score": 3, "rationale": "r"},
            ]},
        }],
    }), encoding="utf-8")
    (d / "v1_2026-07-16_10-00-00.ann.json").write_text(json.dumps({
        "corrections": [
            # human downgraded Correctness 2 -> 1
            {"test_id": "ut_citation_002", "dimension_source": "base",
             "dimension_name": "Correctness", "llm_score": 2, "corrected_score": 1},
        ]
    }), encoding="utf-8")

    b = incumbent_baseline(skill, tmp_path)
    assert b is not None
    assert b.scores["ut_citation_002"][("base", "Correctness")] == 1  # corrected wins
    assert b.scores["ut_citation_002"][("base", "Completeness")] == 3  # judge score
    assert b.path.name == "v1_2026-07-16_10-00-00.json"


def test_incumbent_baseline_none_when_no_runlog(tmp_path):
    assert incumbent_baseline("citation", tmp_path) is None


# ---- snapshot drift detection -------------------------------------------


def test_incumbent_baseline_populates_snapshot(tmp_path):
    """The Baseline must carry the snapshot from the run-log envelope."""
    skill = "citation"
    d = tmp_path / "unit" / skill
    d.mkdir(parents=True)
    snap = {"packages/engine/plugin/skills/citation/SKILL.md": "abc123"}
    (d / "v1_2026-07-16_10-00-00.json").write_text(json.dumps({
        "timestamp": "2026-07-16_10-00-00",
        "snapshot": snap,
        "tests": [{
            "test_id": "ut_citation_002",
            "outcome_summary": {"aggregated_dimensions": [
                {"source": "base", "name": "Correctness", "score": 3, "rationale": "r"},
            ]},
        }],
    }), encoding="utf-8")

    b = incumbent_baseline(skill, tmp_path)
    assert b is not None
    assert b.snapshot == snap


def test_snapshot_drift_detected_on_non_skill_path(tmp_path):
    """When a non-skill path in the baseline snapshot differs from disk, the
    drift must be detected — this is the case that fires NEEDS YOUR EYES."""
    from harness.snapshot import diff_snapshot_vs_disk, normalize, hash_content

    skill = "citation"
    skill_md_rel = f"packages/engine/plugin/skills/{skill}/SKILL.md"
    fixture_rel = "eval/tests/unit/citation/rubric.md"

    # Write the fixture file on disk with known content.
    fixture_abs = tmp_path / fixture_rel.replace("/", os.sep)
    fixture_abs.parent.mkdir(parents=True, exist_ok=True)
    fixture_abs.write_text("# rubric v2\n", encoding="utf-8")

    # Snapshot recorded a DIFFERENT hash for the fixture.
    snapshot = {
        skill_md_rel: "irrelevant-hash",
        fixture_rel: "stale-hash-that-does-not-match-disk",
    }

    diffs = diff_snapshot_vs_disk(snapshot, tmp_path)
    drifted = [p for p in sorted(diffs) if p != skill_md_rel]
    assert drifted, "expected the fixture to show as drifted"
    assert fixture_rel in drifted


def test_snapshot_drift_excludes_gated_skill_md(tmp_path):
    """The gated skill's own SKILL.md always differs (it IS the edit being
    gated). Drift detection must not flag it as a stale-baseline indicator."""
    from harness.snapshot import diff_snapshot_vs_disk

    skill = "citation"
    skill_md_rel = f"packages/engine/plugin/skills/{skill}/SKILL.md"

    # Write the skill file on disk with content that differs from snapshot.
    skill_md_abs = tmp_path / skill_md_rel.replace("/", os.sep)
    skill_md_abs.parent.mkdir(parents=True, exist_ok=True)
    skill_md_abs.write_text("edited body\n", encoding="utf-8")

    snapshot = {skill_md_rel: "original-hash-that-differs"}

    diffs = diff_snapshot_vs_disk(snapshot, tmp_path)
    # The skill's own SKILL.md IS in the diffs (it really differs).
    assert skill_md_rel in diffs
    # But after excluding it, nothing remains.
    drifted = [p for p in diffs if p != skill_md_rel]
    assert not drifted, "the gated skill's own SKILL.md must be excluded from drift"
