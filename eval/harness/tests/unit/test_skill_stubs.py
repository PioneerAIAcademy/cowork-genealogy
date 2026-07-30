"""Unit tests for positive-test sub-skill stubbing (harness/skill_stubs.py).

Contract under test: `execution.stub_skills` names sub-skills the test does not
want executed. The hook denies the launch and lets the run CONTINUE (unlike the
negative-test routing short-circuit, which stops it), optionally handing back a
canned response for callers whose own remaining work reads the callee's output.
"""

import pytest

from harness.skill_stubs import parse_stub_skills, stub_denial


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
    assert "Treat the following as the result it returned" in reason


def test_every_form_tells_the_model_not_to_retry_or_self_serve():
    """Without this the model either retries the denied call or decides it must
    do the callee's work itself — both spend the turns the stub exists to save.
    """
    for response in (None, "some result"):
        reason = _reason(stub_denial("s", response))
        assert "Do not retry it" in reason
        assert "do its work yourself" in reason
        assert "HAS been recorded" in reason


def test_bare_deny_does_not_claim_a_result_exists():
    reason = _reason(stub_denial("s", None))
    assert "Treat the following as the result" not in reason
    assert "finish your own remaining steps" in reason


def test_skill_name_appears_in_the_reason():
    assert "search-external-sites" in _reason(stub_denial("search-external-sites", None))
