"""Direct tests for `test_bounded_first_message_runs_its_deliverable_after_init_project`
(#2813, feedback #4237).

A bounded first message with a PID and no project creates the project and runs its
deliverable in the same turn. These pin the validator against each way that can go
wrong, and against the legitimate shapes it must still accept.
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
    test_bounded_first_message_runs_its_deliverable_after_init_project as validator,
)

TEST = {"skill": "research", "tags": ["routing", "routes-to:init-project", "bounded-after-init"]}
OFFER = "Nothing new turned up for Patrick Flynn.\n\nContinue with `setting up the project`?"
DENIAL = (
    'Step complete. Give the researcher your report on the step that just finished, '
    'end with "Continue with running the searches?", and end your turn.'
)
SUBJECT = '{"subjectId": "I1", "names": ["Patrick Flynn"]}'
AFTER = {
    "research_json": {"project": {"subject_person_ids": ["I1"]}},
    "tree_gedcomx_json": {"persons": [{"id": "I1"}]},
}


def _spawn(name, subject=SUBJECT):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": f"projectPath: /p\nsubject: {subject}"}}


def _run(names, *, returns=None, text=OFFER, test=TEST, after=AFTER, subject=SUBJECT):
    validator(
        skills_invoked=["research"],
        builtin_tool_calls=[_spawn(n, subject) for n in names],
        agent_returns=returns if returns is not None else [
            {"subagent_type": n, "text": f"{n} report"} for n in names
        ],
        text_response=text,
        after_state=after,
        test=test,
    )


def test_init_project_then_the_search_passes():
    _run(["init-project", "search-records"])


def test_repeats_of_the_search_and_the_url_on_the_offer_line_pass():
    _run(["init-project", "search-records", "search-records"],
         text=OFFER + " https://example.test/p/1")


def test_a_hint_review_fails():
    """A hint review stops for the researcher's verdict and writes no offer, so it
    cannot pass this test's shape; a hint verdict is its own bounded ask."""
    with pytest.raises(AssertionError, match="got \\['init-project', 'search-hints'\\]"):
        _run(["init-project", "search-hints"])


def test_the_next_offer_is_the_routers_call():
    _run(["init-project", "search-records"],
         text="Nothing new turned up.\n\nContinue with `running the searches`?")


def test_two_record_steps_in_the_turn_fail():
    with pytest.raises(AssertionError, match="search-hints', 'search-records"):
        _run(["init-project", "search-hints", "search-records"])


def test_question_selection_after_init_project_fails():
    """The #4237 shape main produced, exactly: two hand-offs, so only the
    record-step clause can catch it."""
    with pytest.raises(AssertionError, match="got \\['init-project', 'question-selection'\\]"):
        _run(["init-project", "question-selection"],
             text="Project made.\n\nContinue with `planning the searches`?")


def test_a_search_with_no_init_project_before_it_fails():
    with pytest.raises(AssertionError, match="got \\['question-selection', 'search-records'\\]"):
        _run(["question-selection", "search-records"])


def test_init_project_alone_offering_setup_fails():
    with pytest.raises(AssertionError, match="got \\['init-project'\\]"):
        _run(["init-project"], text="Project made.\n\nContinue with `setting up the project`?")


def test_a_plan_after_the_search_fails():
    with pytest.raises(AssertionError, match="research-plan"):
        _run(["init-project", "search-records", "research-plan"])


def test_a_search_after_init_project_failed_fails():
    with pytest.raises(AssertionError, match="made no project"):
        _run(["init-project", "search-records"], after={"research_json": None})


def test_the_familysearch_id_as_the_subject_fails():
    with pytest.raises(AssertionError, match="'LZNY-BRF' is not a person in the tree"):
        _run(["init-project", "search-records"],
             subject='{"subjectId": "LZNY-BRF", "names": ["Patrick Flynn"]}')


def test_a_search_the_gate_denied_fails():
    with pytest.raises(AssertionError, match="denied \\['search-records'\\]"):
        _run(["init-project", "search-records"], returns=[
            {"subagent_type": "init-project", "text": "init-project report"},
            {"subagent_type": "search-records", "text": DENIAL, "is_error": True},
        ])


def test_relaying_the_next_step_sentence_fails():
    with pytest.raises(AssertionError, match="next-step sentence"):
        _run(["init-project", "search-records"],
             text="The next step is the first research question: the single fact we go after first.\n\n" + OFFER)


def test_no_offer_line_fails():
    with pytest.raises(AssertionError, match="offer"):
        _run(["init-project", "search-records"], text="Nothing new turned up for Patrick Flynn.")


def test_a_test_without_the_tag_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        _run(["init-project", "question-selection"], test={"skill": "research", "tags": ["routing"]})
