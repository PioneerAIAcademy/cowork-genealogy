"""Direct tests for `test_affirmative_declaration_was_written`.

Same reason as the sibling validator tests: nothing under `validators/` is
collected by `make harness-test`.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased: pyproject.toml collects `test_*`.
from test_research_exhaustiveness import (  # noqa: E402
    REQUIRED_STOP_CRITERIA_KEYS,
    test_affirmative_declaration_was_written as _affirmative_fn,
)

_SCENARIOS = Path(__file__).resolve().parents[3] / "fixtures" / "scenarios"
_TEST = {"tags": ["research-exhaustiveness", "affirmative-declaration"]}
BEFORE = json.loads(
    (_SCENARIOS / "decisive-skip-inaccessible" / "research.json").read_text(encoding="utf-8")
)


def _after(stopped_because, status, stop_criteria) -> dict:
    after = copy.deepcopy(BEFORE)
    q = after["questions"][0]
    q["status"] = status
    q["search_stop"] = {
        "stopped_because": stopped_because,
        "justification": "Overturn risk: low. The censuses, the marriage and the obituary agree.",
        "log_entry_ids": ["log_001", "log_002", "log_003"],
        "stop_criteria": stop_criteria,
        "not_reached": [],
    }
    return after


_CRITERIA = {k: "met" for k in REQUIRED_STOP_CRITERIA_KEYS}


def _run(after: dict, test: dict = _TEST) -> None:
    try:
        _affirmative_fn({"research_json": BEFORE}, {"research_json": after}, test)
    except pytest.skip.Exception as exc:  # a skip here would hide the check
        raise AssertionError(f"validator skipped: {exc}") from exc


def test_skips_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        _affirmative_fn({"research_json": BEFORE},
                        {"research_json": _after("resources_spent", "in_progress", None)},
                        {"tags": ["research-exhaustiveness"]})


@pytest.mark.parametrize("gate", ["question_answered", "record_exhausted", "nothing_further_reachable"])
def test_passes_on_each_stop_gate_value(gate):
    _run(_after(gate, "exhaustive_declared", _CRITERIA))


def test_fails_on_a_decline():
    with pytest.raises(AssertionError, match="resources_spent"):
        _run(_after("resources_spent", "in_progress", None))


def test_fails_on_a_conflict_block():
    with pytest.raises(AssertionError, match="blocked_by_conflict"):
        _run(_after("blocked_by_conflict", "in_progress", None))


def test_fails_when_nothing_was_written():
    with pytest.raises(AssertionError, match="Nothing was written"):
        _run(copy.deepcopy(BEFORE))


def test_fails_on_a_gate_value_without_the_status():
    with pytest.raises(AssertionError, match="No question was declared"):
        _run(_after("question_answered", "in_progress", _CRITERIA))
