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
OFFER = "Nothing new turned up for Patrick Flynn.\n\nContinue with `running the searches`?"
DENIAL = (
    'Step complete. Give the researcher your report on the step that just finished, '
    'end with "Continue with running the searches?", and end your turn.'
)


def _spawn(name):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": "x"}}


def _run(names, *, returns=None, text=OFFER, test=TEST):
    validator(
        skills_invoked=["research"],
        builtin_tool_calls=[_spawn(n) for n in names],
        agent_returns=returns if returns is not None else [
            {"subagent_type": n, "text": f"{n} report"} for n in names
        ],
        text_response=text,
        test=test,
    )


def test_init_project_then_the_search_passes():
    _run(["init-project", "search-records"])


def test_repeats_of_the_search_and_the_url_on_the_offer_line_pass():
    _run(["init-project", "search-records", "search-records"],
         text=OFFER + " https://example.test/p/1")


def test_question_selection_after_init_project_fails():
    with pytest.raises(AssertionError, match="got \\['init-project', 'question-selection'"):
        _run(["init-project", "question-selection", "locality-guide"])


def test_init_project_alone_offering_setup_fails():
    with pytest.raises(AssertionError, match="got \\['init-project'\\]"):
        _run(["init-project"], text="Project made.\n\nContinue with `setting up the project`?")


def test_a_plan_after_the_search_fails():
    with pytest.raises(AssertionError, match="research-plan"):
        _run(["init-project", "search-records", "research-plan"])


def test_a_search_the_gate_denied_fails():
    with pytest.raises(AssertionError, match="denied \\['search-records'\\]"):
        _run(["init-project", "search-records"], returns=[
            {"subagent_type": "init-project", "text": "init-project report"},
            {"subagent_type": "search-records", "text": DENIAL, "is_error": True},
        ])


def test_no_offer_line_fails():
    with pytest.raises(AssertionError, match="search step's offer"):
        _run(["init-project", "search-records"], text="Nothing new turned up for Patrick Flynn.")


def test_a_test_without_the_tag_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        _run(["init-project", "question-selection"], test={"skill": "research", "tags": ["routing"]})
