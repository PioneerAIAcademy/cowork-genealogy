"""The e2e driver's simulated researcher: `next_reply` (section F).

An e2e run is unattended, so the driver answers each step boundary as a
researcher would: "Continue." at an offer, flagged `--autonomous` as the opener
is so the router keeps the run unattended, "Wrap it up." at the second planning
round's plan offer, and nothing where only a real researcher could answer. No
production plane sends a reply of its own.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from e2e.turn_loop import MAX_REPLIES, UNATTENDED_CONTINUE, next_reply  # noqa: E402

_MODULE_PATH = REPO / "packages" / "engine" / "plugin" / "hooks" / "step_boundary.py"
_spec = importlib.util.spec_from_file_location("_genealogy_step_boundary_e2e", _MODULE_PATH)
sb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sb)


def _with_question(**extra):
    question = {"id": "q_001", "status": "open"}
    question.update(extra)
    return {"questions": [question]}


# ---------------------------------------------------------------------------
# next_reply: the simulated researcher
# ---------------------------------------------------------------------------


def _reply(state=None, mode="step", prev="search-records", step="person-evidence",
           offer="research-exhaustiveness", outcome="ok", research=None):
    return next_reply(sb, state, mode, prev, step, offer, outcome, research=research)


def _research_with_plan_items(statuses, question_status="open"):
    """A research fixture with one active plan under the current question, whose
    items carry the given statuses in order."""
    research = _with_question(status=question_status)
    research["plans"] = [
        {
            "id": "pl_001",
            "question_id": "q_001",
            "status": "active",
            "items": [
                {"id": f"pli_{i:03d}", "status": status}
                for i, status in enumerate(statuses, start=1)
            ],
        }
    ]
    return research


def test_an_ordinary_offer_is_answered_with_continue():
    out = _reply()
    assert out["reply"] == UNATTENDED_CONTINUE
    assert out["state"]["replies"] == 1


def test_a_wrap_up_turn_ends_the_run():
    """Every step turn gets a reply; the turn "Wrap it up." opened ends the run."""
    assert _reply(mode="step")["reply"] == UNATTENDED_CONTINUE
    assert _reply(mode="wrapup")["reply"] is None


def test_a_turn_that_did_not_finish_cleanly_ends_the_run():
    assert _reply(outcome="stopped")["reply"] is None
    assert _reply(outcome="error")["reply"] is None
    assert _reply(outcome="completed")["reply"] == UNATTENDED_CONTINUE


def test_no_offer_ends_the_run():
    """Including a step that ended on a question for the researcher."""
    assert _reply(offer=None)["reply"] is None


def test_a_wrap_up_offer_ends_the_run_because_only_the_researcher_answers_it():
    assert _reply(offer=sb.WRAP_UP)["reply"] is None


def test_a_proof_conclusion_turn_ends_the_run():
    """No `research` passed: unreadable-store behavior, unchanged from before this
    parameter existed."""
    assert _reply(step="proof-conclusion", offer="question-selection")["reply"] is None


def test_a_blocked_proof_conclusion_with_no_proof_summary_gets_a_reply():
    """Proof-conclusion was refused (wrote no summary) and offered a real next
    step -- falls through to the ordinary rules instead of ending the run."""
    research = _with_question()
    out = _reply(step="proof-conclusion", offer="conflict", research=research)
    assert out["reply"] == UNATTENDED_CONTINUE


def test_a_proof_conclusion_turn_with_a_proof_summary_still_ends_the_run():
    """A conflict's reopened question: still `current_question` (not resolved),
    and already has a summary from before the reopening."""
    research = _with_question()
    research["proof_summaries"] = [{"id": "ps_001", "question_id": "q_001"}]
    out = _reply(step="proof-conclusion", offer="question-selection", research=research)
    assert out["reply"] is None


def test_a_proof_conclusion_that_resolves_the_last_question_still_ends_the_run():
    """The ordinary case, and the one the bug hid behind: `proof-conclusion`
    resolves the question it concludes in the SAME batch as the summary, so
    `current_question` has already moved past it (here, to nothing) by the
    time this reads research.json back. The gate must find it by creation
    order, not by asking which question is still open."""
    research = _with_question(status="resolved")
    research["proof_summaries"] = [{"id": "ps_001", "question_id": "q_001"}]
    assert sb.current_question(research) is None, "the fixture must exercise the no-current-question case"
    out = _reply(step="proof-conclusion", offer="question-selection", research=research)
    assert out["reply"] is None


def test_the_run_stops_at_max_replies():
    at_cap = {"replies": MAX_REPLIES, "planning_rounds": 0, "answered": []}
    assert _reply(state=at_cap)["reply"] is None
    under = {"replies": MAX_REPLIES - 1, "planning_rounds": 0, "answered": []}
    assert _reply(state=under)["reply"] == UNATTENDED_CONTINUE


def test_a_repeated_step_and_offer_pair_ends_the_run():
    """A link-and-assess cycle that never plans."""
    first = _reply()
    second = next_reply(
        sb, first["state"], "step", "search-records", "person-evidence",
        "research-exhaustiveness", "ok",
    )
    assert second["reply"] is None


def test_a_repeated_step_and_offer_pair_with_research_but_no_item_growth_still_ends_the_run():
    """The regression check: with `research` present but item statuses
    unchanged, the repeated-pair guard still ends the run exactly as it does
    when `research` is None (the existing test above never reaches the new
    growth-check code path at all)."""
    research = _research_with_plan_items(["planned", "planned"])
    first = _reply(research=research)
    second = next_reply(
        sb, first["state"], "step", "search-records", "person-evidence",
        "research-exhaustiveness", "ok", research=research,
    )
    assert second["reply"] is None


def test_a_second_plan_item_s_search_and_link_cycle_gets_a_reply():
    """Replays the `hannah-earnest-children` shape: a second plan item getting
    linked reads as real progress, not a repeated loop, even though the
    (step, offer) pair repeats."""
    research = _research_with_plan_items(["completed", "planned"])
    first = next_reply(
        sb, None, "step", "research-plan", "search-records", "link", "ok", research=research,
    )
    assert first["reply"] == UNATTENDED_CONTINUE
    assert first["state"]["touched_items"] == 1

    second = next_reply(
        sb, first["state"], "step", "search-records", "person-evidence",
        "research-exhaustiveness", "ok", research=research,
    )
    assert second["reply"] == UNATTENDED_CONTINUE

    research["plans"][0]["items"][1]["status"] = "completed"
    third = next_reply(
        sb, second["state"], "step", "person-evidence", "search-records", "link", "ok",
        research=research,
    )
    assert third["reply"] == UNATTENDED_CONTINUE
    assert third["state"]["touched_items"] == 2


def test_the_first_planning_round_is_allowed():
    out = _reply(prev="research-exhaustiveness", step="research-plan", offer="search-records")
    assert out["reply"] == UNATTENDED_CONTINUE
    assert out["state"]["planning_rounds"] == 1


def test_a_research_plan_offer_after_a_planning_round_gets_wrap_it_up():
    used = {"replies": 1, "planning_rounds": 1, "answered": []}
    out = _reply(state=used, prev="person-evidence", step="research-exhaustiveness",
                 offer="research-plan")
    assert out["reply"] == sb.REPLY_WRAP_UP


def test_a_second_planning_round_ends_the_run():
    used = {"replies": 2, "planning_rounds": 1, "answered": []}
    out = _reply(state=used, prev="research-exhaustiveness", step="research-plan",
                 offer="search-records")
    assert out["reply"] is None


def test_the_ordinary_first_plan_does_not_spend_the_planning_round():
    """research-plan after setup or after itself is the first plan, not a re-plan."""
    for prev in ("question-selection", "locality-guide", "init-project", "research-plan"):
        out = _reply(prev=prev, step="research-plan", offer="search-records")
        assert out["reply"] == UNATTENDED_CONTINUE, prev
        assert out["state"]["planning_rounds"] == 0, prev


def test_a_planning_round_clears_the_answered_pairs():
    """Pairs are tracked since the run's LAST planning round."""
    state = {"replies": 1, "planning_rounds": 0,
             "answered": [["research-plan", "search"]]}
    out = _reply(state=state, prev="research-exhaustiveness", step="research-plan",
                 offer="search-records")
    assert out["reply"] == UNATTENDED_CONTINUE
    # Cleared, then this turn's own pair appended -- so the one pair that stands is
    # this one, recorded under the OFFER KEY the line parser yields.
    assert out["state"]["answered"] == [["research-plan", "search"]]


def test_next_reply_does_not_mutate_the_state_it_was_given():
    state = {"replies": 0, "planning_rounds": 0, "answered": []}
    _reply(state=state)
    assert state == {"replies": 0, "planning_rounds": 0, "answered": []}


def test_next_reply_survives_a_missing_or_junk_state():
    assert _reply(state=None)["reply"] == UNATTENDED_CONTINUE
    assert _reply(state={})["reply"] == UNATTENDED_CONTINUE
    assert _reply(state={"replies": "x", "answered": "x"})["reply"] == UNATTENDED_CONTINUE
    # A state written before `touched_items` existed -- accepted with no KeyError.
    no_touched = {"replies": 1, "planning_rounds": 0, "answered": []}
    assert _reply(state=no_touched)["reply"] == UNATTENDED_CONTINUE


def test_the_extraction_offer_is_answered_with_continue():
    out = _reply(prev="search-full-text", step="evaluate-search-results", offer="extract-matches")
    assert out["reply"] == UNATTENDED_CONTINUE


def test_next_reply_reads_an_agent_name_and_its_key_the_same_way():
    for agent, key in (("proof-conclusion", "conclude"), ("research-plan", "plan"),
                       ("question-selection", "setup"), ("search-records", "search")):
        assert _reply(offer=agent)["reply"] == _reply(offer=key)["reply"], agent


def test_the_continue_reply_keeps_the_run_unattended():
    """The router passes `userPresent: no` only in an autonomous run, so each reply
    carries the opener's flag; it still opens an ordinary step turn."""
    assert "--autonomous" in UNATTENDED_CONTINUE
    assert UNATTENDED_CONTINUE.rstrip().endswith(sb.REPLY_CONTINUE)
    assert sb.step_mode(UNATTENDED_CONTINUE) == "step"
    # "Wrap it up." goes bare, or step_mode would not read it as a wrap-up.
    used = {"replies": 1, "planning_rounds": 1, "answered": []}
    out = _reply(state=used, prev="person-evidence", step="research-exhaustiveness", offer="research-plan")
    assert out["reply"] == sb.REPLY_WRAP_UP and sb.step_mode(out["reply"]) == "wrapup"
