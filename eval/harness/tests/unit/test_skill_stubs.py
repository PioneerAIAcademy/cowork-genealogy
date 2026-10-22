"""Unit tests for positive-test sub-skill stubbing (harness/skill_stubs.py).

Contract under test: `execution.stub_skills` names sub-skills the test does not
want executed. The hook denies the launch and lets the run CONTINUE (unlike the
negative-test routing short-circuit, which stops it), optionally handing back a
canned response for callers whose own remaining work reads the callee's output.
"""

import json
from pathlib import Path

import pytest

from harness.skill_stubs import parse_stub_skills, stub_denial

UNIT_TESTS = Path(__file__).resolve().parents[3] / "tests" / "unit"


# --- parse_stub_skills: both declared forms normalize to one dict ------


def test_bare_string_form_means_no_canned_response():
    assert parse_stub_skills({"stub_skills": ["search-external-sites"]}) == {
        "search-external-sites": None
    }


def test_object_form_carries_the_canned_response():
    stubs = parse_stub_skills(
        {
            "stub_skills": [
                {"skill": "search-external-sites", "response": "Ancestry: https://x"}
            ]
        }
    )
    assert stubs == {"search-external-sites": "Ancestry: https://x"}


def test_both_forms_may_be_mixed_in_one_test():
    stubs = parse_stub_skills(
        {"stub_skills": ["record-extraction", {"skill": "a", "response": "r"}]}
    )
    assert stubs == {"record-extraction": None, "a": "r"}


def test_object_form_without_response_is_a_bare_deny():
    assert parse_stub_skills({"stub_skills": [{"skill": "a"}]}) == {"a": None}


def test_empty_response_string_is_a_bare_deny_not_an_empty_payload():
    """An empty `response` must not become "here is your result: <nothing>".

    Telling the model to present an empty result is worse than telling it the
    callee did not run — it invites the caller to report a blank deliverable as
    if it were real output.
    """
    assert parse_stub_skills({"stub_skills": [{"skill": "a", "response": ""}]}) == {
        "a": None
    }


@pytest.mark.parametrize("execution", [None, {}, {"stub_skills": None}, {"stub_skills": []}])
def test_nothing_declared_yields_an_empty_dict(execution):
    """Empty dict, never None — callers use it as a plain membership test."""
    assert parse_stub_skills(execution) == {}


def test_malformed_entries_are_skipped_not_fatal():
    """A bad entry must not abort a whole suite run mid-flight.

    The JSON Schema is the gate for authoring mistakes; this layer runs inside
    a live SDK hook where raising would take the run down with it.
    """
    stubs = parse_stub_skills(
        {"stub_skills": [{"no_skill_key": "x"}, 42, None, "good"]}
    )
    assert stubs == {"good": None}


# --- stub_denial: the hook output -------------------------------------


def _reason(out):
    return out["hookSpecificOutput"]["permissionDecisionReason"]


def _context(out):
    return out["hookSpecificOutput"].get("additionalContext") or ""


def _all_text(out):
    return _reason(out) + "\n\n" + _context(out)


def test_denies_the_launch():
    out = stub_denial("search-external-sites", None)
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert out["hookSpecificOutput"]["hookEventName"] == "PreToolUse"


def test_does_not_stop_the_run():
    """The whole difference from the negative-test routing short-circuit.

    That one sets `continue_: False` because a negative verdict is sealed at
    routing. A positive test still has its closing log entry and summary to
    write, so stopping here would fail it.
    """
    for response in (None, "some result"):
        out = stub_denial("s", response)
        assert "continue_" not in out
        assert "stopReason" not in out


def test_canned_response_is_handed_back_verbatim():
    response = "Ancestry: https://www.ancestry.com/search/?name=Patrick_Flynn"
    assert response in _reason(stub_denial("search-external-sites", response))


def test_canned_response_is_framed_as_the_callees_result():
    """The model must be told the text IS the result, or it re-derives it."""
    reason = _reason(stub_denial("s", "URLS HERE"))
    assert "Treat the following as the result 's' returned" in reason


def test_every_form_tells_the_model_not_to_retry_or_self_serve():
    """Without this the model either retries the denied call or decides it must
    do the callee's work itself — both spend the turns the stub exists to save.
    """
    for response in (None, "some result"):
        reason = _all_text(stub_denial("s", response))
        assert "Do not retry it" in reason
        assert "do its work yourself" in reason
        assert "hand-off counts as made" in reason


def test_bare_deny_does_not_claim_a_result_exists():
    text = _all_text(stub_denial("s", None))
    assert "Treat the following as the result" not in text
    assert "the result" not in text.split("this hand-off using only")[-1]
    assert "do what they still require before you reply." in text


def test_skill_name_appears_in_the_reason():
    assert "search-external-sites" in _reason(stub_denial("search-external-sites", None))


# --- non-disclosure: keep harness scaffolding out of the graded output ---


def test_every_form_forbids_disclosing_the_stub():
    """The reason lands in context right before the model writes its summary.

    If it narrates "search-external-sites was stubbed for this eval run", a
    judge reads that as a defect in the skill, and the only fix from the
    grading side is a judge instruction to ignore it — the grading patch this
    mechanism exists to remove. Suppress on the harness side instead.
    """
    for response in (None, "Ancestry: https://x"):
        reason = _reason(stub_denial("search-external-sites", response))
        assert "Do NOT mention it" in reason
        assert "Describe this hand-off using only what the text above states" in reason


def test_non_disclosure_covers_written_files_not_just_the_reply():
    """A leak into a log entry's `notes` outlives the run and is worse than one
    in the chat reply — validators and later readers both see it."""
    reason = _reason(stub_denial("s", "r"))
    assert "not in anything you write to disk" in reason


def test_reason_never_tells_the_model_to_narrate_as_if_callee_ran():
    """The old wording told the model to narrate 'as you would if <name> had
    run normally', which made it claim writes that never happened. The reason
    must not contain any phrasing that encourages this."""
    for response in (None, "some result"):
        reason = _reason(stub_denial("s", response))
        for phrase in (
            "had run normally",
            "as you would if",
            "counts as successful",
            "HAS been recorded",
        ):
            assert phrase not in reason, (
                f"{phrase!r} tells the model to narrate as if the callee ran"
            )


def test_preamble_carries_no_harness_vocabulary():
    """The model only needs to know: it didn't run, it counts, don't redo it."""
    reason = _reason(stub_denial("s", None))
    head = reason.split("This message is test scaffolding")[0]
    for leaky in ("eval run", "unit suite", "not under test"):
        assert leaky not in head, f"{leaky!r} is harness vocabulary the model may echo"


# --- the hand-back to the caller (issue #3740) ----------------------------

# The canned tail most research stubs end on (compound-bounded-ask.json).
_STOP_TAIL = (
    "do not walk further down the routing table. Write your summary of what "
    "you routed and why, and stop."
)


def test_hand_back_rides_in_additional_context_not_the_reason():
    """CLI 2.1.294 shows the reason as a `hook error`. With the hand-back inside
    that error, a router sometimes ended its turn right after the stub, so the
    hand-back goes in `additionalContext` and the reason keeps the result."""
    for response in (None, "some result"):
        out = stub_denial("s", response)
        assert "your turn is not" not in _reason(out)
        assert _context(out).endswith(
            "The hand-off is over; your turn is not. Your own instructions still "
            "govern how this turn ends: do what they still require before you reply."
            + (
                " Where the result it returned says otherwise, follow the result."
                if response
                else ""
            )
        )


def test_canned_form_moves_the_did_not_execute_instructions_out_of_the_reason():
    reason = _reason(stub_denial("s", "some result"))
    assert "did not execute" not in reason
    assert "did not execute" in _context(stub_denial("s", "some result"))


def test_hand_back_defers_to_a_canned_stop_rather_than_overriding_it():
    """Many canned responses tell the router to summarize and stop. A push like
    "follow your instructions through to their end" after them sent a router on
    a job down the rest of its routing table (ut_research_h7w), so the result
    must outrank the caller's own instructions."""
    hand_back = _context(stub_denial("research-plan", _STOP_TAIL)).split("\n\n")[-1]
    assert hand_back.startswith("The hand-off is over")
    assert hand_back.endswith("says otherwise, follow the result.")
    for push in (
        "keep going", "carry on", "continue", "next step", "remaining steps",
        "through to their end",
    ):
        assert push not in hand_back.lower(), f"{push!r} overrides the canned stop"


@pytest.mark.parametrize("response", [None, "some result"])
def test_text_names_no_tool_or_step_a_test_could_be_graded_on(response):
    """Every stubbed test shares this text. Naming the step one test grades
    (research_delivered, loaded through ToolSearch) would hand that test its
    pass and every other test an instruction it does not have."""
    text = _all_text(stub_denial("s", response))
    for token in ("research_", "mcp__", "ToolSearch"):
        assert token not in text, f"{token!r} names a step the model is graded on"


def test_hand_back_carries_no_harness_vocabulary():
    """test_preamble_carries_no_harness_vocabulary reads only the reason, so it
    does not see `additionalContext`."""
    for response in (None, "r"):
        hand_back = _context(stub_denial("s", response))
        for leaky in ("eval", "unit suite", "not under test", "stub", "test"):
            assert leaky not in hand_back.lower(), f"{leaky!r} is harness vocabulary"


def test_every_committed_stub_fits_the_cli_hook_output_limit():
    """CLI 2.1.294 caps `permissionDecisionReason` at 2000 characters. A canned
    response is authored in test JSON, so the margin moves with the corpus; a
    fixed-size sample would not see a longer one land."""
    lengths = {}
    for path in sorted(UNIT_TESTS.glob("*/*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        for name, response in parse_stub_skills(data.get("execution")).items():
            out = stub_denial(name, response)["hookSpecificOutput"]
            size = len(out["permissionDecisionReason"]) + len(
                out.get("additionalContext") or ""
            )
            lengths[f"{path.parent.name}/{path.name}:{name}"] = size
    assert lengths, f"no stub_skills found under {UNIT_TESTS}"
    longest = max(lengths, key=lengths.get)
    assert lengths[longest] <= 2000, f"{longest} is {lengths[longest]} characters"
