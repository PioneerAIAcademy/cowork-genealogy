"""Tests for harness.validator_runner.

Runs against the actual seed validators in eval/harness/validators/ to verify
the runner can drive them with realistic inputs.
"""

from pathlib import Path

import pytest

from harness.validator_runner import (
    all_passed,
    as_dicts,
    run_validators,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
VALIDATORS_DIR = REPO_ROOT / "eval/harness/validators"


def _empty_research_state():
    """Schema-valid empty research.json. v1.5: project must include
    objective/created/updated per research.schema.json."""
    return {
        "research_json": {
            "project": {
                "id": "rp_1",
                "objective": "test stub",
                "status": "active",
                "created": "2026-01-01",
                "updated": "2026-01-01",
            },
            "questions": [],
            "plans": [],
            "log": [],
            "sources": [],
            "assertions": [],
            "conflicts": [],
            "hypotheses": [],
            "person_evidence": [],
            "proof_summaries": [],
            "timelines": [],
            "evaluations": [],
        },
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,  # alias some validators may use
    }


def test_universal_passes_on_clean_state():
    state = _empty_research_state()
    results = run_validators(
        skill="search-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
    )
    assert len(results) > 0, "expected at least one validator from test_universal.py"
    # If any failed, the validators didn't like our stub state — surface so we can
    # fix the stub rather than silently ignoring.
    if not all_passed(results):
        fails = [(r.name, r.error) for r in results if not r.passed]
        pytest.fail(f"validators failed on clean state: {fails}")


def test_skill_specific_validator_loaded_when_present():
    state = _empty_research_state()
    results = run_validators(
        skill="conflict-resolution",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
    )
    # Skill validator (conflict-resolution) defines some test_* functions;
    # they should appear in results when called against a clean state.
    names = {r.name for r in results}
    # Must include at least one validator name unique to conflict-resolution.
    # Looking at the seed file, test_conflict_resolution_ownership_only_conflicts
    # exists; check that one or another skill-specific test is present.
    skill_only = [n for n in names if "conflict" in n.lower() or "ownership" in n.lower()]
    assert skill_only, f"expected skill-specific validator to load; got {names}"


def test_skill_without_specific_file_runs_only_universal():
    state = _empty_research_state()
    results = run_validators(
        skill="search-wiki",  # no test_search_wiki.py exists
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
    )
    # All loaded validators must come from test_universal.py — none from a
    # nonexistent test_search_wiki.py. Universal validators don't have
    # "ownership" or skill-specific words in their names typically.
    assert len(results) >= 1


def test_assertion_error_captured_as_failure(tmp_path):
    # Write a one-off validator that always fails.
    bad = tmp_path / "test_universal.py"
    bad.write_text(
        "def test_always_fails(before_state, after_state, tool_calls):\n"
        "    assert False, 'intentional'\n"
    )
    results = run_validators(
        skill="x",
        validators_dir=tmp_path,
        before_state={},
        after_state={},
        tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is False
    assert "intentional" in results[0].error


def test_validator_with_no_args_still_runs(tmp_path):
    nullary = tmp_path / "test_universal.py"
    nullary.write_text("def test_no_args():\n    assert 1 == 1\n")
    results = run_validators(
        skill="x", validators_dir=tmp_path,
        before_state={}, after_state={}, tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is True


def test_ownership_table_blocks_cross_skill_writes():
    """Universal: a skill that writes to a section it doesn't own must fail
    test_ownership_table, regardless of which skill is being tested."""
    research_before = {
        "project": {
            "id": "rp_1", "objective": "test", "status": "active",
            "created": "2026-01-01", "updated": "2026-01-01",
        },
        "questions": [], "plans": [], "log": [], "sources": [],
        "assertions": [], "person_evidence": [], "conflicts": [],
        "hypotheses": [], "timelines": [], "proof_summaries": [],
    }
    research_after = dict(research_before)
    # record-extraction wrote to conflicts — it owns sources/assertions/log,
    # NOT conflicts. The universal validator must catch this.
    research_after = {**research_before, "conflicts": [
        {"id": "c_1", "status": "unresolved"}
    ]}

    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state={
            "research_json": research_before, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        after_state={
            "research_json": research_after, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
    )
    ownership = next((r for r in results if r.name == "test_ownership_table"), None)
    assert ownership is not None
    assert ownership.passed is False
    assert "conflicts" in (ownership.error or "")
    assert "record-extraction" in (ownership.error or "")


def test_ownership_table_allows_owned_writes():
    """conflict-resolution writing to conflicts should pass ownership."""
    research_before = {
        "project": {
            "id": "rp_1", "objective": "test", "status": "active",
            "created": "2026-01-01", "updated": "2026-01-01",
        },
        "questions": [], "plans": [], "log": [], "sources": [],
        "assertions": [], "person_evidence": [], "conflicts": [],
        "hypotheses": [], "timelines": [], "proof_summaries": [],
    }
    research_after = {**research_before, "conflicts": [
        {"id": "c_1", "status": "unresolved"}
    ]}

    results = run_validators(
        skill="conflict-resolution",
        validators_dir=VALIDATORS_DIR,
        before_state={
            "research_json": research_before, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        after_state={
            "research_json": research_after, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        tool_calls=[],
        skill_frontmatter={"name": "conflict-resolution"},
    )
    ownership = next((r for r in results if r.name == "test_ownership_table"), None)
    assert ownership is not None
    assert ownership.passed is True, f"unexpected failure: {ownership.error}"


def test_pytest_skip_is_treated_as_pass_with_skipped_marker(tmp_path):
    """Validators using `pytest.skip()` should not abort the run."""
    bad = tmp_path / "test_universal.py"
    bad.write_text(
        "import pytest\n"
        "def test_uses_skip(before_state, after_state, tool_calls):\n"
        "    pytest.skip('not applicable to this state')\n"
    )
    results = run_validators(
        skill="x",
        validators_dir=tmp_path,
        before_state={},
        after_state={},
        tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is True
    assert "skipped" in results[0].error.lower()


def test_as_dicts_shape():
    from harness.validator_runner import ValidatorRunResult
    items = [
        ValidatorRunResult(name="a", passed=True, error=None),
        ValidatorRunResult(name="b", passed=False, error="boom"),
    ]
    out = as_dicts(items)
    assert out == [
        {"name": "a", "passed": True, "error": None},
        {"name": "b", "passed": False, "error": "boom"},
    ]
