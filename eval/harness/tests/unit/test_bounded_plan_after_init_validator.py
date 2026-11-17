"""Direct tests for `test_bounded_plan_first_message_stops_after_init_project` (#2813).

A bounded research-plan ask with a PID and no project runs init-project alone and
ends on "Continue with `setting up the project`?". These pin the validator against
each way that can go wrong, and against the legitimate shapes it must still accept.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(next(
    q / "eval/harness/validators" for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)))

from test_research import (  # noqa: E402
    test_bounded_plan_first_message_stops_after_init_project as validator,
)

TEST = {"skill": "research", "tags": ["routing", "routes-to:init-project", "bounded-plan-after-init"]}
OFFER = "The project for Patrick Flynn is set up.\n\nContinue with `setting up the project`?"
AFTER = {"research_json": {"project": {"subject_person_ids": ["I1"]}, "questions": [], "plans": []}}


def _run(names, *, text=OFFER, test=TEST, after=AFTER):
    validator(
        skills_invoked=["research"],
        builtin_tool_calls=[
            {"tool": "Agent", "args": {"subagent_type": n, "prompt": "projectPath: /p"}} for n in names
        ],
        text_response=text,
        after_state=after,
        test=test,
    )


def test_init_project_alone_offering_setup_passes():
    _run(["init-project"])


def test_the_url_on_the_offer_line_and_a_bold_label_pass():
    _run(["init-project"], text=OFFER + " https://example.test/p/1")
    _run(["init-project"], text="Set up.\n\nContinue with **setting up the project**?")


def test_a_project_with_no_question_or_plan_keys_passes():
    _run(["init-project"], after={"research_json": {"project": {}}})


def test_question_selection_after_init_project_fails():
    """The #4237 shape: the drift this test exists to catch."""
    with pytest.raises(AssertionError, match="got \\['init-project', 'question-selection'\\]"):
        _run(["init-project", "question-selection"])


def test_research_plan_after_init_project_fails():
    with pytest.raises(AssertionError, match="got \\['init-project', 'research-plan'\\]"):
        _run(["init-project", "research-plan"])


def test_no_init_project_fails():
    with pytest.raises(AssertionError, match="got \\[\\]"):
        _run([])


def test_a_plan_with_no_project_step_fails():
    with pytest.raises(AssertionError, match="got \\['research-plan'\\]"):
        _run(["research-plan"])


def test_no_project_after_the_run_fails():
    with pytest.raises(AssertionError, match="made no project"):
        _run(["init-project"], after={"research_json": None})


def test_a_question_written_in_the_turn_fails():
    with pytest.raises(AssertionError, match="wrote \\['questions'\\]"):
        _run(["init-project"], after={"research_json": {"questions": [{"id": "q_001"}]}})


def test_a_plan_written_in_the_turn_fails():
    with pytest.raises(AssertionError, match="wrote \\['plans'\\]"):
        _run(["init-project"], after={"research_json": {"plans": [{"id": "plan_001"}]}})


def test_relaying_the_next_step_sentence_fails():
    with pytest.raises(AssertionError, match="next-step sentence"):
        _run(["init-project"],
             text="The next step is the first research question.\n\n" + OFFER)


def test_offering_the_plan_fails():
    with pytest.raises(AssertionError, match="it offers 'plan'"):
        _run(["init-project"], text="Set up.\n\nContinue with `planning the searches`?")


def test_no_offer_line_fails():
    with pytest.raises(AssertionError, match="it offers None"):
        _run(["init-project"], text="The project for Patrick Flynn is set up.")


def test_an_offer_not_on_the_last_line_fails():
    with pytest.raises(AssertionError, match="it offers None"):
        _run(["init-project"], text=OFFER + "\n\nLet me know what you think.")


def test_a_test_without_the_tag_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        _run(["init-project", "question-selection"], test={"skill": "research", "tags": ["routing"]})
