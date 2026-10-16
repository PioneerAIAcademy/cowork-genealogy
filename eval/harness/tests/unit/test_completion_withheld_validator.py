"""Direct tests for `test_completion_withheld_without_objective_signal` (#3240).

`validators/` is not collected by `make harness-test`, so without these the
validator's pass/fail set would show only inside a paid proof-conclusion run.
Both directions: it refuses a completion that skipped question-selection's
objective-answered line, and it passes a withheld completion that names
question-selection as the next step.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix, as the sibling validator tests do, so
# pytest does not collect the imported validator as a test of this module.
from test_proof_conclusion import (  # noqa: E402
    test_completion_withheld_without_objective_signal as check,
)

TAGGED = {"tags": ["completion-withheld-without-objective-signal"]}
NEXT_STEP = "Next step: run question-selection to confirm every part of the objective is covered."


def _state(status):
    return {"research_json": {"project": {"status": status}}}


def _returns(text):
    return [{"subagent_type": "proof-conclusion", "text": text}]


def test_passes_when_status_stays_active_and_next_step_names_question_selection():
    check(_state("active"), _state("active"), _returns(NEXT_STEP), "", TAGGED)


def test_refuses_a_completion_without_the_objective_signal():
    with pytest.raises(AssertionError, match="without question-selection"):
        check(_state("active"), _state("completed"), _returns(NEXT_STEP), "", TAGGED)


def test_refuses_a_withheld_completion_whose_next_step_names_no_question_selection():
    with pytest.raises(AssertionError, match="must name question-selection"):
        check(_state("active"), _state("active"), _returns("The project is complete."), "", TAGGED)


def test_reads_the_main_thread_reply_when_the_agent_returned_nothing():
    check(_state("active"), _state("active"), [], NEXT_STEP, TAGGED)


def test_a_project_already_completed_before_the_call_is_not_a_violation():
    check(_state("completed"), _state("completed"), _returns(NEXT_STEP), "", TAGGED)


def test_skips_without_its_tag():
    with pytest.raises(pytest.skip.Exception):
        check(_state("active"), _state("completed"), _returns(""), "", {"tags": []})
