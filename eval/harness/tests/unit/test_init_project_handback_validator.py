"""Direct tests for init-project's check-warnings hand-back validator (issue #2122).

pyproject.toml sets testpaths = ["tests"], so nothing under validators/ is
collected by make harness-test; without these the check would run its real
pass/fail set only inside a paid make eval-skill run. The tree is the
ut_init_project_q7b shape: the subject and three imported relatives, all
carrying an ark.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import (  # noqa: E402
    test_check_warnings_handed_back_for_every_imported_person as check,
)

TREE = {
    "persons": [
        {"id": f"I{n}", "ark": f"ark:/61903/4:1:DOYL-00{n}", "gender": "Unknown", "names": []}
        for n in (1, 2, 3, 4)
    ]
}
AFTER = {"tree_gedcomx_json": TREE}
TEST = {
    "skill": "init-project",
    "tags": ["check-warnings", "direct-arm"],
    "delegation": "Start a project for Thomas Doyle.\n\nprojectPath: <workspace>",
}
RESEARCHER = "\n---\nThe project is set up for Thomas Doyle and his family.\nNext we choose the first question."


def _returns(text):
    return [{"subagent_type": "init-project", "text": text}]


def test_passes_when_every_imported_person_is_handed_back():
    reply = "Project created.\nHand-back: check-warnings I1 I2 I3 I4" + RESEARCHER
    check(AFTER, TEST, _returns(reply), None)


def test_passes_on_a_comma_separated_list():
    reply = "Hand-back: check-warnings I1, I2, I3, I4\nHand-back: question-selection — derive the first research question" + RESEARCHER
    check(AFTER, TEST, _returns(reply), None)


def test_fails_with_no_hand_back_line():
    with pytest.raises(AssertionError, match="never hands back"):
        check(AFTER, TEST, _returns("Project created." + RESEARCHER), None)


def test_fails_when_an_imported_relative_is_left_out():
    reply = "Hand-back: check-warnings I1 I3 I4" + RESEARCHER
    with pytest.raises(AssertionError, match=r"\['I2'\]"):
        check(AFTER, TEST, _returns(reply), None)


def test_fails_when_the_hand_back_reaches_the_researcher_paragraph():
    reply = "Project created.\n---\nWe set it up. Hand-back: check-warnings I1 I2 I3 I4"
    with pytest.raises(AssertionError, match="researcher paragraph"):
        check(AFTER, TEST, _returns(reply), None)


def test_a_relay_does_not_count_on_the_direct_arm():
    relay = "Hand-back: check-warnings I1 I2 I3 I4"
    with pytest.raises(AssertionError, match="never hands back"):
        check(AFTER, TEST, _returns(""), relay)


def test_skips_a_test_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        check(AFTER, {**TEST, "tags": ["direct-arm"]}, _returns(""), None)
