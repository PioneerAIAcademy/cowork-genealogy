"""Section F's two remaining arms: the Wrap it up arm, and answering the
fixture's own question (review of aa48f22e, ask 10).

`ended_on_a_question` is pure and tested directly. The two reply arms live
inside `_run_agent`'s closure, so they are driven through `run_e2e.main` with
`_run_one` stubbed (the `test_e2e_tool_search_switch.py` idiom) for the wiring,
and the override's own decision is tested on the predicate it keys on.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from e2e import run_e2e
from e2e.orchestrator import ended_on_a_question, wrap_up_override
from tests.unit.test_e2e_tool_search_switch import _argv, _record_run

REPO = next(
    q for q in Path(__file__).resolve().parents if (q / "packages/engine/plugin").is_dir()
)
_spec = importlib.util.spec_from_file_location(
    "_sb_for_tests", REPO / "packages/engine/plugin/hooks/step_boundary.py"
)
sb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sb)


# --- ended_on_a_question -----------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "I found three candidates. Which of them is your Patrick?",
        "What was her maiden name?",
        "The 1850 census is unclear.\n\nShould I order the film?",
    ],
)
def test_a_turn_that_asks_the_researcher_is_recognised(text):
    assert ended_on_a_question(sb, text) is True


def test_an_offer_line_is_not_a_question_for_the_researcher():
    """It ends with "?" too. Without the offer test every step boundary would
    be answered with the fixture's question instead of Continue, and the run
    would restate its objective at every step."""
    assert ended_on_a_question(sb, "The report.\n\nContinue with running the searches?") is False


def test_a_final_conclusion_is_not_a_question():
    """No offer either, so the no-offer test alone would catch this one and the
    run would be restarted after it had finished."""
    assert ended_on_a_question(sb, "The research is finished for now.") is False


@pytest.mark.parametrize("text", [None, "", "   \n  "])
def test_no_text_is_not_a_question(text):
    assert ended_on_a_question(sb, text) is False


def test_a_question_followed_by_an_offer_is_an_offer():
    """The LAST line decides, as the offer parser reads it: a step may discuss a
    question it is about to answer itself and still offer the next step."""
    both = "Who were his parents?\n\nContinue with planning the searches?"
    assert ended_on_a_question(sb, both) is False


def test_a_question_earlier_in_the_text_does_not_make_it_a_question():
    """The LAST line decides. A step that poses a question and then answers it
    itself has not handed anything back -- and this is the case the offer test
    does NOT also catch, so it is what pins the last-line reading."""
    text = (
        "Is this the right Patrick? The ages and the parish both agree."
        "\n\nThe research is finished for now."
    )
    assert ended_on_a_question(sb, text) is False


# --- the wrap-up override ----------------------------------------------------


def test_the_override_swaps_the_reply_after_the_named_step():
    """It is an override of the REPLY, not a session mode: `next_auto_reply`
    stays production's own function with no test-only branch in it."""
    assert wrap_up_override(sb, sb.REPLY_KEEP_GOING, "search-records",
                            "search-records") == sb.REPLY_WRAP_UP


def test_the_override_leaves_every_other_step_alone():
    assert wrap_up_override(sb, sb.REPLY_KEEP_GOING, "person-evidence",
                            "search-records") == sb.REPLY_KEEP_GOING


def test_the_override_is_inert_when_no_step_was_named():
    """Every run without the flag, which is every committed one."""
    assert wrap_up_override(sb, sb.REPLY_KEEP_GOING, "search-records",
                            None) == sb.REPLY_KEEP_GOING


def test_the_override_never_invents_a_reply():
    """It swaps one; it does not create one. A turn `next_auto_reply` ended the
    run on stays ended, so the arm cannot extend a run past where production
    would have stopped it -- which would make it measure something production
    never does."""
    assert wrap_up_override(sb, None, "search-records", "search-records") is None


def test_a_turn_that_ran_no_step_is_never_the_named_one():
    """`turn.step` is None when the turn spawned nothing (a question between
    steps). Matching None against the flag would fire the arm on a turn that
    ran nothing at all."""
    assert wrap_up_override(sb, sb.REPLY_KEEP_GOING, None,
                            "search-records") == sb.REPLY_KEEP_GOING


def test_the_run_ends_after_the_override():
    """The reply opens a turn that reads `wrapup`, and `next_auto_reply`
    answers nothing for one -- so the arm needs no stop of its own."""
    assert sb.step_mode(sb.REPLY_WRAP_UP) == "wrapup"
    assert sb.next_auto_reply({}, "wrapup", "search-records", "person-evidence",
                              "conclude", "ok")["reply"] is None


# --- the CLI wiring ----------------------------------------------------------


def test_the_flag_reaches_the_run(monkeypatch, tmp_path):
    calls = _record_run(monkeypatch)
    assert run_e2e.main(_argv(tmp_path, "--step-mode", "job",
                              "--wrap-up-after", "search-records")) == 0
    assert calls and calls[0]["wrap_up_after"] == "search-records"


def test_no_flag_means_no_override(monkeypatch, tmp_path):
    calls = _record_run(monkeypatch)
    assert run_e2e.main(_argv(tmp_path, "--step-mode", "job")) == 0
    assert calls and calls[0]["wrap_up_after"] is None


def test_the_flag_is_refused_without_step_mode(monkeypatch, tmp_path, capsys):
    """Without `--step-mode` no host reply is sent at all, so there is nothing
    to override — and a run that silently ignored the flag would be bought and
    would measure the wrong thing."""
    calls = _record_run(monkeypatch)
    assert run_e2e.main(_argv(tmp_path, "--wrap-up-after", "search-records")) == 2
    assert not calls
    assert "needs --step-mode" in capsys.readouterr().err
