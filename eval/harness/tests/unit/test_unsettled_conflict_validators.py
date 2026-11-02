"""Direct tests for the two state validators of the unsettled-conflict tests.

Same reason as the sibling validator tests: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`. Both validators first shipped reading `after_state` as if it
were research.json itself, when the harness wraps it as
`{"research_json": ...}`; every run then failed "c_001 is gone" or "0 proof
summaries" whatever the agent did. These tests feed the harness's own shape,
built from the Dutch scenario fixtures the tests run on.
"""

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
_SCENARIOS = _HARNESS.parent / "fixtures" / "scenarios"
_TAGGED = {"tags": ["unsettled-conflict-ending"]}
sys.path.insert(0, str(_HARNESS / "validators"))


def _load(name):
    # Unrewritten, as `harness/validator_runner.py` loads it, so the assertion
    # message is the validator's own (see test_conflict_resolution_validator.py).
    spec = importlib.util.spec_from_file_location(f"_unrewritten_{name}", _HARNESS / "validators" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_cr = _load("test_conflict_resolution")
_pc = _load("test_proof_conclusion")


def _state(scenario):
    research = json.loads((_SCENARIOS / scenario / "research.json").read_text(encoding="utf-8"))
    return {"research_json": research}


def _fails(fn, *args):
    with pytest.raises(AssertionError) as e:
        fn(*args)
    return str(e.value.args[0])


# --- conflict-resolution: c_001 stays open and is declared searched out ---


def test_weighed_state_passes():
    _cr.test_unsettled_conflict_stays_open_and_weighed(_state("dutch-mother-searched-out-weighed"), _TAGGED)


def test_no_declaration_fails_naming_the_unweighed_entries():
    msg = _fails(_cr.test_unsettled_conflict_stays_open_and_weighed, _state("dutch-mother-searched-out"), _TAGGED)
    assert "log_009" in msg


def test_a_resolved_conflict_fails():
    after = _state("dutch-mother-searched-out-weighed")
    after["research_json"]["conflicts"][0]["status"] = "resolved"
    msg = _fails(_cr.test_unsettled_conflict_stays_open_and_weighed, after, _TAGGED)
    assert "resolved" in msg


def test_a_missing_conflict_fails():
    after = _state("dutch-mother-searched-out-weighed")
    after["research_json"]["conflicts"] = []
    msg = _fails(_cr.test_unsettled_conflict_stays_open_and_weighed, after, _TAGGED)
    assert "c_001" in msg


# --- proof-conclusion: one not_proved/conflict summary, question left open ---


def test_ended_state_passes():
    _pc.test_unsettled_conflict_not_proved_left_open(
        _state("dutch-mother-searched-out-weighed"), _state("dutch-mother-ended-on-conflict"), _TAGGED
    )


def test_no_summary_fails():
    before = _state("dutch-mother-searched-out-weighed")
    msg = _fails(_pc.test_unsettled_conflict_not_proved_left_open, before, copy.deepcopy(before), _TAGGED)
    assert "0 proof summaries" in msg


def test_a_wrong_tier_fails():
    after = _state("dutch-mother-ended-on-conflict")
    after["research_json"]["proof_summaries"][0]["tier"] = "probable"
    msg = _fails(_pc.test_unsettled_conflict_not_proved_left_open, _state("dutch-mother-searched-out-weighed"), after, _TAGGED)
    assert "probable" in msg


def test_a_resolved_question_fails():
    after = _state("dutch-mother-ended-on-conflict")
    after["research_json"]["questions"][0]["status"] = "resolved"
    msg = _fails(_pc.test_unsettled_conflict_not_proved_left_open, _state("dutch-mother-searched-out-weighed"), after, _TAGGED)
    assert "resolved" in msg
