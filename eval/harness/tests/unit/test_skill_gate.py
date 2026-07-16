"""Unit tests for skill_gate.py — the candidate-vs-step-4-baseline gate
(component A of the E->A->B loop). Pure logic over synthetic scores + tmp dirs;
no live run, no Anthropic API — runs in `make harness-test`.
"""

from __future__ import annotations

import json
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
    holdout_test_paths,
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
    holdout = {"ut_h_001": compare(_scores([("base", "Completeness", 3)]),
                                   scores_of(_entry([("base", "Completeness", 3)])))}
    sig = compute_signal(mined, holdout)
    assert sig.verdict == "LOOKS GOOD"
    assert any("named fix landed" in r for r in sig.reasons)


def test_signal_inconclusive_when_failure_does_not_reproduce():
    mined = compare(_scores([("base", "Correctness", 3)]),  # incumbent already passes
                    scores_of(_entry([("base", "Correctness", 3)])))
    assert compute_signal(mined, {}).verdict == "INCONCLUSIVE"


def test_signal_needs_eyes_when_fix_does_not_land():
    mined = compare(_scores([("base", "Correctness", 1)]),
                    scores_of(_entry([("base", "Correctness", 2)])))  # still not pass
    sig = compute_signal(mined, {})
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("did NOT land" in r for r in sig.reasons)


def test_signal_needs_eyes_on_holdout_regression_even_if_fix_lands():
    mined = compare(_scores([("base", "Correctness", 1)]),
                    scores_of(_entry([("base", "Correctness", 3)])))
    holdout = {"ut_h_001": compare(_scores([("rubric", "Locality depth", 3)]),
                                   scores_of(_entry([("rubric", "Locality depth", 2)])))}
    sig = compute_signal(mined, holdout)
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("regression" in r for r in sig.reasons)


def test_signal_named_dimension_restricts_target():
    # Correctness reproduces+fixes; the named target 'Completeness' never failed
    # on the incumbent -> inconclusive on the named dimension.
    mined = compare(
        _scores([("base", "Correctness", 1), ("base", "Completeness", 3)]),
        scores_of(_entry([("base", "Correctness", 3), ("base", "Completeness", 3)])),
    )
    assert compute_signal(mined, {}, named_dimension="Completeness").verdict == "INCONCLUSIVE"


def test_signal_named_dimension_absent_is_flagged():
    mined = compare(_scores([("base", "Correctness", 1)]),
                    scores_of(_entry([("base", "Correctness", 3)])))
    sig = compute_signal(mined, {}, named_dimension="Nonexistent Dim")
    assert sig.verdict == "NEEDS YOUR EYES"
    assert any("not scored" in r for r in sig.reasons)


# ---- holdout / id resolution --------------------------------------------


def _write_test(dir_: Path, tid: str, *, holdout: bool) -> Path:
    p = dir_ / f"{tid}.json"
    p.write_text(json.dumps({"test": {"id": tid, "holdout": holdout}}),
                 encoding="utf-8")
    return p


def test_holdout_paths_and_find_by_id(tmp_path):
    skill_dir = tmp_path / "citation"
    skill_dir.mkdir()
    h1 = _write_test(skill_dir, "ut_citation_h1", holdout=True)
    _write_test(skill_dir, "ut_citation_002", holdout=False)
    (skill_dir / "rubric.md").write_text("# rubric", encoding="utf-8")

    assert holdout_test_paths(skill_dir) == [h1]
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
    assert b.skill_md == "the body"
    assert b.path.name == "v1_2026-07-16_10-00-00.json"


def test_incumbent_baseline_none_when_no_runlog(tmp_path):
    assert incumbent_baseline("citation", tmp_path) is None
