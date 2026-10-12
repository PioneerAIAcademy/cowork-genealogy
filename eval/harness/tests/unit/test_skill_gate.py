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
    drift_signal,
    find_test_path_by_id,
    incumbent_baseline,
    scores_of,
    stale_snapshot_paths,
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
    """When a non-skill path in the baseline snapshot differs from disk,
    stale_snapshot_paths returns it — this is the case that fires NEEDS YOUR EYES."""
    skill = "citation"
    fixture_rel = "eval/tests/unit/citation/rubric.md"

    # Write the fixture file on disk with known content.
    fixture_abs = tmp_path / fixture_rel.replace("/", os.sep)
    fixture_abs.parent.mkdir(parents=True, exist_ok=True)
    fixture_abs.write_text("# rubric v2\n", encoding="utf-8")

    # Snapshot recorded a DIFFERENT sha256 hash for the fixture.
    # Use a real 64-char hex digest so is_hashed_snapshot() returns True
    # and the test exercises the v3 sha256-comparison path, not the legacy
    # content-comparison branch.
    skill_md_rel = f"packages/engine/plugin/skills/{skill}/SKILL.md"
    snapshot = {
        skill_md_rel: "a" * 64,
        fixture_rel: "b" * 64,
    }

    drifted = stale_snapshot_paths(snapshot, skill, tmp_path)
    assert drifted, "expected the fixture to show as drifted"
    assert fixture_rel in drifted


def test_snapshot_drift_excludes_gated_skill_md(tmp_path):
    """The gated skill's own SKILL.md always differs (it IS the edit being
    gated). stale_snapshot_paths must not include it."""
    skill = "citation"
    skill_md_rel = f"packages/engine/plugin/skills/{skill}/SKILL.md"

    # Write the skill file on disk with content that differs from snapshot.
    skill_md_abs = tmp_path / skill_md_rel.replace("/", os.sep)
    skill_md_abs.parent.mkdir(parents=True, exist_ok=True)
    skill_md_abs.write_text("edited body\n", encoding="utf-8")

    snapshot = {skill_md_rel: "c" * 64}

    drifted = stale_snapshot_paths(snapshot, skill, tmp_path)
    assert not drifted, "the gated skill's own SKILL.md must be excluded from drift"


def test_snapshot_drift_excludes_gated_agent_body_only(tmp_path):
    """A suite keyed on an agent (person-evidence has no skills/ dir) gates an
    edit to agents/<skill>.md: that file is excluded, another agent's is not."""
    skill = "person-evidence"
    own_rel = f"packages/engine/plugin/agents/{skill}.md"
    other_rel = "packages/engine/plugin/agents/record-extractor.md"
    for rel in (own_rel, other_rel):
        p = tmp_path / rel.replace("/", os.sep)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("edited body\n", encoding="utf-8")

    snapshot = {own_rel: "d" * 64, other_rel: "e" * 64}

    drifted = stale_snapshot_paths(snapshot, skill, tmp_path)
    assert own_rel not in drifted, "the gated agent body must be excluded from drift"
    assert drifted == [other_rel], "another agent's body must still read as drift"


def test_uncommitted_edit_check_covers_agent_body(monkeypatch):
    """The no-edit check must diff the agent body too, or an agent-keyed suite
    always reads as "no edit" and the gate can never print LOOKS GOOD."""
    seen: list[list[str]] = []

    class _Done:
        returncode = 1

    def fake_run(cmd, *args, **kwargs):
        seen.append(cmd)
        return _Done()

    monkeypatch.setattr(skill_gate.subprocess, "run", fake_run)
    assert skill_gate._has_uncommitted_skill_edit("person-evidence") is True
    assert "packages/engine/plugin/agents/person-evidence.md" in seen[0]
    assert "packages/engine/plugin/skills/person-evidence/SKILL.md" in seen[0]


# ---- drift_signal ----------------------------------------------------------


def test_drift_signal_forces_needs_your_eyes():
    """A non-empty drift list must force NEEDS YOUR EYES regardless of the
    original signal, and prepend the drift reason."""
    original = skill_gate.GateSignal("LOOKS GOOD", ["named fix landed"])
    result = drift_signal(original, ["eval/tests/unit/citation/rubric.md"])
    assert result.verdict == "NEEDS YOUR EYES"
    assert any("drifted" in r for r in result.reasons)
    # The original reasons are preserved after the drift reason.
    assert "named fix landed" in result.reasons


def test_drift_signal_passes_through_on_empty_list():
    """An empty drift list must return the signal unchanged."""
    original = skill_gate.GateSignal("LOOKS GOOD", ["named fix landed"])
    result = drift_signal(original, [])
    assert result is original
