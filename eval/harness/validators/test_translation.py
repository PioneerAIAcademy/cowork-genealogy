"""Agent-specific validators for the translation agent.

translation is a pure model task — it translates foreign-language record
text and explains genealogically significant terms. Narrative quality
(accuracy, notation of uncertainty, cultural context, date formatting)
lives in the rubric — graded by the LLM judge.

Mechanical checks: its only MCP tool is `research_log_append`, called at most
once; inside a project it logs the translation as one `translation` entry
(issue #3524) and writes nothing else, and with no project it writes nothing.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest

from validators_lib import (
    assert_only_logs_report,
    assert_reply_carries_report,
    assert_report_logged,
)


# --- Tool-call enforcement -------------------------------------------

def test_only_logs_translation(tool_calls, test):
    """translation is a pure model task — its one MCP call is the
    `research_log_append` that logs it (issue #3524), at most once. The
    universal `validate_research_schema` is exempted: post commit 861d3c9 it's
    the built-in schema verifier any skill may call, not a research tool."""
    if test.get("type") != "positive":
        pytest.skip("negative tests are not applicable to the direct-arm agent")
    names = [
        tc.get("tool", "").rsplit("__", 1)[-1]
        for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    other = [n for n in names if n not in {"research_log_append", "validate_research_schema"}]
    assert not other, (
        "translation should call no MCP tool other than research_log_append "
        f"(and validate_research_schema), but called: {other}"
    )
    logs = names.count("research_log_append")
    assert logs <= 1, f"translation called research_log_append {logs} times; one translation is one entry"


def test_research_json_only_logs_report(before_state, after_state, test):
    """Inside a project, one `translation` log entry and nothing else; with no
    project, no research.json."""
    if test.get("type") != "positive":
        pytest.skip("negative tests are not applicable to the direct-arm agent")
    assert_only_logs_report(before_state, after_state, "translation", "translation")


def test_report_logged(before_state, after_state, test):
    """Tag `logs-report`: exactly one new `translation` entry carrying the
    translation."""
    if "logs-report" not in test.get("tags", []):
        pytest.skip("not a logs-report test")
    assert_report_logged(before_state, after_state, "translation")


def test_reply_carries_logged_report(before_state, after_state, test, agent_returns=None, text_response=None):
    """The report logged as `translation` is also what the agent returns (issue
    #3524). Graded on the agent's own return (`subject_reply_text`), since the
    judge on a direct test reads the dispatcher's relay."""
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, "translation", test)
    assert_reply_carries_report(before_state, after_state, "translation", reply)
