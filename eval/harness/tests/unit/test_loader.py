"""Tests for harness.loader — loading and validating unit-test JSON files."""

import json
from pathlib import Path

import pytest

from harness.loader import (
    InvalidTestError,
    TestSpec,
    load_test,
    load_test_from_dict,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
SEARCH_WIKIPEDIA_TEST = REPO_ROOT / "eval/tests/unit/search-wikipedia/simple-topic-lookup.json"


def _minimal_positive():
    return {
        "test": {
            "id": "ut_loader_001",
            "skill": "search-wikipedia",
            "name": "loader smoke",
            "type": "positive",
            "description": "Verifies loader accepts minimal positive test.",
            "tags": [],
        },
        "input": {"user_message": "hi", "scenario": None},
        "judge_context": [],
    }


def _minimal_negative():
    return {
        "test": {
            "id": "ut_loader_002",
            "skill": "record-extraction",
            "name": "neg loader smoke",
            "type": "negative",
            "description": "Verifies loader accepts minimal negative test.",
            "tags": [],
        },
        "input": {"user_message": "search for X", "scenario": None},
        "negative": {
            "correct_skill": ["search-records"],
            "explanation": "search request, not extraction",
        },
        "judge_context": [],
    }


def test_loads_real_seed_test():
    spec = load_test(SEARCH_WIKIPEDIA_TEST)
    assert spec.id == "ut_search_wikipedia_001"
    assert spec.skill == "search-wikipedia"
    assert spec.type == "positive"
    assert spec.scenario is None
    assert spec.mcp_fixtures == ["wikipedia-search-schuylkill-county"]
    assert spec.negative is None


def test_loads_minimal_positive():
    spec = load_test_from_dict(_minimal_positive())
    assert spec.id == "ut_loader_001"
    assert spec.type == "positive"
    assert spec.tags == []
    assert spec.judge_context == []
    assert spec.mcp_fixtures == []
    assert spec.execution == {}
    assert spec.runs_per_test == 1  # default


def test_loads_minimal_negative():
    spec = load_test_from_dict(_minimal_negative())
    assert spec.type == "negative"
    assert spec.negative is not None
    assert spec.negative["correct_skill"] == ["search-records"]


def test_rejects_missing_test_field():
    data = _minimal_positive()
    del data["test"]
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_rejects_missing_id():
    data = _minimal_positive()
    del data["test"]["id"]
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_rejects_wrong_id_prefix():
    data = _minimal_positive()
    data["test"]["id"] = "foo_123"  # must start with ut_
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_rejects_unknown_type():
    data = _minimal_positive()
    data["test"]["type"] = "neither"
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_negative_test_requires_negative_block():
    data = _minimal_negative()
    del data["negative"]
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_positive_test_rejects_negative_block():
    data = _minimal_positive()
    data["negative"] = {"correct_skill": [], "explanation": "x"}
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_xfail_requires_reason():
    data = _minimal_positive()
    data["test"]["expected_outcome"] = "xfail"
    # no xfail_reason
    with pytest.raises(InvalidTestError):
        load_test_from_dict(data)


def test_xfail_with_reason_loads():
    data = _minimal_positive()
    data["test"]["expected_outcome"] = "xfail"
    data["test"]["xfail_reason"] = "blocked on #312"
    spec = load_test_from_dict(data)
    assert spec.expected_outcome == "xfail"
    assert spec.xfail_reason == "blocked on #312"


def test_runs_per_test_one_is_accepted():
    # Policy (current stage): runs_per_test is pinned to 1. An explicit 1 is
    # valid; omitting the field defaults to 1 (covered elsewhere).
    data = _minimal_positive()
    data["runs_per_test"] = 1
    spec = load_test_from_dict(data)
    assert spec.runs_per_test == 1


def test_runs_per_test_above_one_is_rejected():
    # The schema pins maximum: 1 to enforce the "always run a test once at
    # this stage" policy — multi-run tests make the suite painfully slow for
    # no benefit until the description-optimizer / golden-set phase.
    data = _minimal_positive()
    data["runs_per_test"] = 3
    with pytest.raises(InvalidTestError, match="maximum of 1"):
        load_test_from_dict(data)


def test_execution_overrides():
    data = _minimal_positive()
    data["execution"] = {"max_turns": 40, "max_wall_clock_seconds": 600}
    spec = load_test_from_dict(data)
    assert spec.execution == {"max_turns": 40, "max_wall_clock_seconds": 600}


def test_load_from_path_with_nonexistent_file_raises():
    with pytest.raises(InvalidTestError):
        load_test(Path("/tmp/does-not-exist-xyzzy.json"))
