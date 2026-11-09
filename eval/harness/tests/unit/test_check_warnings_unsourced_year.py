"""report_unsourced_year_in_response reads the researcher-facing text after the
agent's final `---` (lead, 2026-11-05; #4114)."""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_check_warnings import report_unsourced_year_in_response as check  # noqa: E402

TEST = {"skill": "check-warnings", "type": "positive", "user_message": "Check Ambrose Keane. personId: I1"}
CALLS = [{"tool": "mcp__genealogy__person_warnings", "args": {"personId": "I1"},
          "response": {"warnings": [{"facts": [{"id": "F1", "type": "Birth", "date": "~1785"}]}]}}]


def _ret(above, below):
    return [{"subagent_type": "check-warnings", "text": f"{above}\n\n---\n\n{below}"}]


def test_fires_on_a_planted_year_after_the_rule():
    with pytest.raises(AssertionError, match="1777"):
        check(CALLS, "", TEST, agent_returns=_ret("Cluster note.", "He was born in 1777."))


def test_quiet_on_a_year_the_tool_returned():
    assert check(CALLS, "", TEST, agent_returns=_ret("Cluster note.", "His birth around 1785 looks wrong.")) is None


def test_a_hypothetical_year_above_the_rule_is_not_checked():
    text = "Correcting F7 to after 1926 clears one.\n\n---\n\nBorn around 1785."
    assert check(CALLS, text, TEST, agent_returns=[{"subagent_type": "check-warnings", "text": text}]) is None


def test_the_dispatcher_reply_is_ignored_when_the_agent_returned():
    assert check(CALLS, "Dispatcher says 1777.", TEST, agent_returns=_ret("Note.", "Born around 1785.")) is None


def test_falls_back_to_text_response_when_there_is_no_return():
    with pytest.raises(AssertionError, match="1777"):
        check(CALLS, "He was born in 1777.", TEST, agent_returns=[])


def test_a_silent_agent_on_a_direct_test_is_not_graded_on_the_dispatcher_reply():
    direct = {**TEST, "delegation": "Check Ambrose Keane. personId: I1"}
    with pytest.raises(pytest.skip.Exception):
        check(CALLS, "Dispatcher says 1777.", direct, agent_returns=[])


def test_a_return_with_no_rule_has_nothing_to_check():
    with pytest.raises(pytest.skip.Exception):
        check(CALLS, "Dispatcher says 1777.", TEST, agent_returns=[{"subagent_type": "check-warnings", "text": "No rule here, 1777."}])
