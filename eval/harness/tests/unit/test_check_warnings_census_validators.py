"""Direct tests for check-warnings' census validators (issue #3260).

The birth-window cases are real replies to the census test when it belonged to
init-project (ut_init_project_wm7, corpus census_wm7_replies.json, carried over
from the deleted test_init_project_wm7_validator.py): runs where the judge
passed a wrong answer and failed a right one. The verdict for each is read off
the reply's own words, not the judge. Plus the windows exactly as
census_children_gap words them, which the agent now reports verbatim.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_check_warnings import (  # noqa: E402
    test_census_counts_go_through_the_tool as census_gap,
    test_census_missing_living_child_born_by_1900 as window,
    test_no_project_hands_back_to_init_project as no_project,
)

REPLIES = json.loads(
    (Path(__file__).parent / "census_wm7_replies.json").read_text(encoding="utf-8")
)
DIRECT = {"delegation": "x\n\nprojectPath: <workspace>"}
WINDOW_TEST = {"skill": "check-warnings", "tags": ["census-living-cumulative", "direct-arm"], **DIRECT}
GAP_TEST = {"skill": "check-warnings", "tags": ["census-gap", "direct-arm"], **DIRECT}
NO_PROJECT_TEST = {"skill": "check-warnings", "tags": ["no-project", "direct-arm"], **DIRECT}


def _agent(text):
    return [{"subagent_type": "check-warnings", "text": text}]


def _call(tool, args=None, response=None):
    return {"tool": f"mcp__genealogy__{tool}", "args": args or {}, "response": response or {}}


# --- birth window (the Brannon test) ---

@pytest.mark.parametrize("run", ["run0", "run2"])
def test_window_fails_a_reply_placing_the_child_after_1900(run):
    with pytest.raises(AssertionError, match="after 1900"):
        window(WINDOW_TEST, _agent(REPLIES[f"agent_scratch_2026-10-07_10-00-43_{run}"]), None)


def test_window_passes_a_reply_placing_the_child_by_1900():
    window(WINDOW_TEST, _agent(REPLIES["agent_scratch_2026-10-07_10-00-43_run1"]), None)


@pytest.mark.parametrize("version", ["v9", "v10", "v14"])
def test_window_passes_committed_correct_replies(version):
    window(WINDOW_TEST, _agent(REPLIES[f"skill_{version}"]), None)


def test_window_fails_a_window_running_past_1900():
    with pytest.raises(AssertionError, match="after 1900"):
        window(WINDOW_TEST, _agent(REPLIES["agent_scratch_2026-10-07_17-11-45_run0"]), None)


def test_window_passes_a_window_ending_before_1900():
    window(WINDOW_TEST, _agent(REPLIES["agent_scratch_2026-10-07_17-11-45_run2"]), None)


def test_window_passes_the_tools_own_wording():
    window(WINDOW_TEST, _agent(
        "1 child missing: born on or before 1900-06-01 and living on both "
        "1900-06-01 and 1910-04-15.\n---\nOne child is still missing."
    ), None)


def test_window_fails_the_tools_after_1900_wording():
    with pytest.raises(AssertionError, match="after 1900"):
        window(WINDOW_TEST, _agent(
            "1 child missing: born after 1900-06-01, on or before 1910-04-15.\n---\nx"
        ), None)


def test_window_passes_a_sibling_born_after_1900_already_in_the_tree():
    window(WINDOW_TEST, _agent(
        "Thomas, born after 1900, is already in the tree, so the missing child was "
        "born on or before 1900-06-01.\n---\nOne child is still missing."
    ), None)


def test_window_passes_a_negated_after_1900():
    window(WINDOW_TEST, _agent(
        "The missing child was not born after June 1, 1900; it was born on or before "
        "1900-06-01.\n---\nx"
    ), None)


def test_window_still_fails_the_missing_child_after_1900_beside_a_sibling_sentence():
    with pytest.raises(AssertionError, match="after 1900"):
        window(WINDOW_TEST, _agent(
            "Thomas is already in the tree. The missing child was born after 1900.\n---\nx"
        ), None)


def test_window_fails_a_reply_that_never_dates_the_child():
    with pytest.raises(AssertionError, match="never places"):
        window(WINDOW_TEST, _agent("One child is missing from the tree.\n---\nWe found one."), None)


def test_window_skips_other_tests():
    with pytest.raises(pytest.skip.Exception):
        window({"tags": ["direct-arm"]}, _agent(""), None)


# --- census counts go through the tool, in tree mode ---

def test_gap_passes_a_tree_mode_call():
    census_gap([_call("census_children_gap", {"motherId": "I1", "censuses": [], "projectPath": "/p"})], GAP_TEST)


def test_gap_fails_when_the_tool_is_never_called():
    with pytest.raises(AssertionError, match="never passed"):
        census_gap([_call("person_warnings", {"personId": "I1"})], GAP_TEST)


def test_gap_fails_hand_copied_children():
    with pytest.raises(AssertionError, match="knownChildren"):
        census_gap([_call("census_children_gap", {"motherId": "I1", "knownChildren": [{"birthDate": "1890"}]})], GAP_TEST)


def test_gap_fails_a_call_without_motherId():
    with pytest.raises(AssertionError, match="without motherId"):
        census_gap([_call("census_children_gap", {"knownChildren": [{"birthDate": "1890"}]})], GAP_TEST)


def test_gap_accepts_any_server_spelling():
    census_gap([{"tool": "mcp__remote-devices__Genealogy_Research__census_children_gap", "args": {"motherId": "I1"}}], GAP_TEST)


def test_gap_skips_other_tests():
    with pytest.raises(pytest.skip.Exception):
        census_gap([], {"tags": ["direct-arm"]})


# --- no project: person_warnings' own answer, then the hand-back ---

NO_PROJECT_ANSWER = {"ok": False, "reason": "no_project", "errors": ["no project"]}
GOOD_REPLY = "Hand-back: init-project — create a project for KWCJ-RN4, then check it\n---\nx"


def test_no_project_passes_the_hand_back():
    no_project([_call("person_warnings", {"personId": "KWCJ-RN4"}, NO_PROJECT_ANSWER)], NO_PROJECT_TEST, _agent(GOOD_REPLY), None)


def test_no_project_passes_a_backticked_owner():
    reply = "Hand-back: `init-project` — create a project for KWCJ-RN4, then check it\n---\nx"
    no_project([_call("person_warnings", {}, NO_PROJECT_ANSWER)], NO_PROJECT_TEST, _agent(reply), None)


def test_no_project_fails_with_no_call():
    with pytest.raises(AssertionError, match="no tool was called"):
        no_project([], NO_PROJECT_TEST, _agent(GOOD_REPLY), None)


def test_no_project_fails_a_second_call():
    calls = [
        _call("person_warnings", {"personId": "X"}, NO_PROJECT_ANSWER),
        _call("project_create", {"personId": "X"}),
    ]
    with pytest.raises(AssertionError, match="only person_warnings"):
        no_project(calls, NO_PROJECT_TEST, _agent(GOOD_REPLY), None)


def test_no_project_fails_when_the_answer_was_not_no_project():
    with pytest.raises(AssertionError, match="did not answer no_project"):
        no_project([_call("person_warnings", {}, {"warnings": []})], NO_PROJECT_TEST, _agent(GOOD_REPLY), None)


def test_no_project_fails_without_the_hand_back_line():
    with pytest.raises(AssertionError, match="never hands back"):
        no_project([_call("person_warnings", {}, NO_PROJECT_ANSWER)], NO_PROJECT_TEST, _agent("There is no project here.\n---\nx"), None)


def test_no_project_reads_the_agents_own_return_not_the_relay():
    # On a direct test a silent agent fails even when the dispatcher wrote the line.
    with pytest.raises(AssertionError, match="never hands back"):
        no_project([_call("person_warnings", {}, NO_PROJECT_ANSWER)], NO_PROJECT_TEST, [], GOOD_REPLY)
