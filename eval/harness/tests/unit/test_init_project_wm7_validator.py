"""Direct tests for init-project's census living-child window validator.

The cases are real replies to ut_init_project_wm7 (init_project_wm7_replies.json):
three agent runs from scratch_2026-10-07_10-00-43, where the judge passed a
wrong answer and failed a right one, two from scratch_2026-10-07_17-11-45 (one window running
past 1900, one ending in 1899), and the skill's committed v9, v10 and v14
replies. The verdict for each is read off the reply's own words, not the judge.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import test_census_missing_living_child_born_by_1900 as check  # noqa: E402

REPLIES = json.loads(
    (Path(__file__).parent / "init_project_wm7_replies.json").read_text(encoding="utf-8")
)
TEST = {"skill": "init-project", "tags": ["census-living-cumulative", "direct-arm"], "delegation": "x\n\nprojectPath: <workspace>"}
SKILL_TEST = {"skill": "init-project", "tags": ["census-living-cumulative"]}


def _agent(text):
    return [{"subagent_type": "init-project", "text": text}]


@pytest.mark.parametrize("run", ["run0", "run2"])
def test_fails_an_agent_reply_placing_the_child_after_1900(run):
    with pytest.raises(AssertionError, match="after 1900"):
        check(TEST, _agent(REPLIES[f"agent_scratch_2026-10-07_10-00-43_{run}"]), None)


def test_passes_the_agent_reply_placing_the_child_by_1900():
    check(TEST, _agent(REPLIES["agent_scratch_2026-10-07_10-00-43_run1"]), None)


@pytest.mark.parametrize("version", ["v9", "v10", "v14"])
def test_passes_the_skills_committed_correct_replies(version):
    check(SKILL_TEST, None, REPLIES[f"skill_{version}"])


def test_fails_a_window_that_runs_past_1900():
    # "born between 1896 and 1903": the child is counted born by the 1900 census.
    with pytest.raises(AssertionError, match="after 1900"):
        check(TEST, _agent(REPLIES["agent_scratch_2026-10-07_17-11-45_run0"]), None)


def test_passes_a_window_that_ends_before_1900():
    # "born between 1896 and 1899".
    check(TEST, _agent(REPLIES["agent_scratch_2026-10-07_17-11-45_run2"]), None)


def test_fails_a_reply_that_never_dates_the_child():
    with pytest.raises(AssertionError, match="never places"):
        check(TEST, _agent("One child is missing from the tree.\n---\nWe found one missing child."), None)


def test_skips_other_tests():
    with pytest.raises(pytest.skip.Exception):
        check({"tags": ["direct-arm"]}, _agent(""), None)
