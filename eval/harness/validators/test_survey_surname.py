"""Skill-specific validators for the survey-surname agent.

survey-surname tabulates every household of a surname across a place's US
federal censuses. It resolves a place with ``place_search``, calls
``record_search`` per census year with ``projectPath`` for staging, logs
every page with ``research_log_append``, groups stubs by ``recordArk``
into households, sections by census year and collection title, and writes
the table via ``Write``.

Narrative-quality dimensions (place resolution accuracy, table prose) live
in the rubric and are graded by the LLM judge. The mechanical checks here
verify the tool-call contract the agent body specifies.

See test_universal.py module docstring for the validator function-signature
contract.
"""

from __future__ import annotations

import pytest

from validators_lib import bare_tool_name, new_log_entries as _new_log_entries


def _mcp_calls(tool_calls, name):
    """MCP calls matching bare tool name."""
    return [
        tc for tc in (tool_calls or [])
        if bare_tool_name(tc.get("tool", "")) == name
    ]


def _builtin_calls(builtin_tool_calls, name):
    """Built-in (non-MCP) tool calls matching tool name."""
    return [
        tc for tc in (builtin_tool_calls or [])
        if tc.get("tool") == name
    ]


# --- Positive: threshold stop ----------------------------------------

def test_threshold_year_gets_one_record_search(tool_calls, test):
    """d3: when a year exceeds 600 totalMatches the agent must NOT make a
    second record_search for that year with a different offset."""
    if "threshold" not in test.get("tags", []):
        pytest.skip("not a threshold test")
    calls_1850 = [
        tc for tc in _mcp_calls(tool_calls, "record_search")
        if tc.get("args", {}).get("residenceYearFrom") == 1850
    ]
    assert len(calls_1850) == 1, (
        f"expected exactly 1 record_search for 1850 (over threshold), "
        f"got {len(calls_1850)}"
    )


# --- Negative: no MCP calls and no Write -----------------------------

def test_negative_makes_no_mcp_calls(tool_calls, test):
    """d4: a negative routing test must make zero MCP calls."""
    if test.get("type") != "negative":
        pytest.skip("only negative tests")
    assert not tool_calls, (
        f"negative test should make no MCP calls; "
        f"got {[tc.get('tool') for tc in tool_calls]}"
    )


def test_negative_makes_no_write(builtin_tool_calls, test):
    """d4: a negative routing test must not call Write."""
    if test.get("type") != "negative":
        pytest.skip("only negative tests")
    writes = _builtin_calls(builtin_tool_calls, "Write")
    assert not writes, "negative test should not call Write"


# --- Positive: log entry per record_search page ----------------------

def test_positive_logs_each_search_page(tool_calls, before_state, after_state, test):
    """Each positive test must append one research_log_append per
    record_search call."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    searches = _mcp_calls(tool_calls, "record_search")
    logs = _mcp_calls(tool_calls, "research_log_append")
    assert len(logs) >= len(searches), (
        f"expected at least one research_log_append per record_search; "
        f"got {len(logs)} log calls for {len(searches)} search calls"
    )


# --- Positive: Write call to surname-survey-*.md ---------------------

def test_positive_writes_table(builtin_tool_calls, test):
    """Each positive test must call Write to a surname-survey-*.md file."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests")
    writes = _builtin_calls(builtin_tool_calls, "Write")
    survey_writes = [
        w for w in writes
        if "surname-survey" in (w.get("args", {}).get("file_path") or "")
    ]
    assert survey_writes, (
        "expected a Write call to a surname-survey-*.md file; "
        f"got writes to: {[w.get('args', {}).get('file_path') for w in writes]}"
    )
