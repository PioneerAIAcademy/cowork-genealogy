"""Direct tests for `test_new_question_follows_the_researchers_reply` (#4791)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(next(
    q / "eval/harness/validators" for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)))

from test_question_selection import test_new_question_follows_the_researchers_reply as validator  # noqa: E402

TEST = {"tags": ["question-omits:Schuylkill", "rationale-records:Philadelphia"]}
BEFORE = {"research_json": {"questions": []}}


def _after(question, rationale):
    return {"research_json": {"questions": [{"id": "q_001", "question": question, "rationale": rationale}]}}


def test_a_question_without_the_disputed_place_and_a_rationale_recording_the_reply_passes():
    validator(BEFORE, _after(
        "Who were the parents of Patrick Flynn, born about 1845 in Pennsylvania, died 1908?",
        "The researcher says he died in philadelphia, not where the tree places his death.",
    ), TEST)


def test_a_question_assuming_the_disputed_place_fails():
    with pytest.raises(AssertionError, match="assumes 'Schuylkill'"):
        validator(BEFORE, _after(
            "Who were the parents of Patrick Flynn, who died 1908 in Schuylkill County?",
            "The researcher says he died in Philadelphia.",
        ), TEST)


def test_a_rationale_that_drops_the_reply_fails():
    with pytest.raises(AssertionError, match="does not record 'Philadelphia'"):
        validator(BEFORE, _after("Who were the parents of Patrick Flynn?", "First question."), TEST)


def test_no_question_fails_and_no_tag_skips():
    with pytest.raises(AssertionError, match="no question was written"):
        validator(BEFORE, {"research_json": {"questions": []}}, TEST)
    with pytest.raises(pytest.skip.Exception):
        validator(BEFORE, BEFORE, {"tags": []})
