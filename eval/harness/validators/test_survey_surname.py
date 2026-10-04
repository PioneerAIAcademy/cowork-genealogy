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


# --- Positive: two-page paging for 1840 ------------------------------

def test_paging_offsets_1840(tool_calls, test):
    """d1/d3: 1840 has hasMore: true on page 1, so the agent must call
    record_search twice for that year at offsets 0 and 100."""
    tags = set(test.get("tags", []))
    if not (tags & {"statewide", "threshold"}):
        pytest.skip("only statewide and threshold tests exercise 1840 paging")
    calls_1840 = [
        tc for tc in _mcp_calls(tool_calls, "record_search")
        if tc.get("args", {}).get("residenceYearFrom") == 1840
    ]
    offsets = sorted(
        int(tc.get("args", {}).get("offset") or 0) for tc in calls_1840
    )
    assert offsets == [0, 100], (
        f"expected 1840 paged at offset 0 then 100; got offsets {offsets}"
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


# --- Positive: every searched page is persisted in the log ------------

def test_positive_logs_each_search_page(
    tool_calls, before_state, after_state, test
):
    """Each record_search (year, offset) pair must appear as a persisted
    log entry. Compares searched pages against new entries in
    research.json rather than counting tool calls."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    def _page(q):
        q = q or {}
        return (q.get("residenceYearFrom"), int(q.get("offset") or 0))

    searched = {
        _page(tc.get("args"))
        for tc in _mcp_calls(tool_calls, "record_search")
    }
    logged = {
        _page(e.get("query"))
        for e in _new_log_entries(before_state, after_state)
        if e.get("tool") == "record_search"
    }
    missing = sorted(searched - logged, key=str)
    assert not missing, (
        f"record_search pages never logged (year, offset): {missing}"
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


# --- d5: recordArk grouping and slave-schedule sectioning -------------

def _survey_file(after_state):
    files = (after_state or {}).get("files") or {}
    for path, text in files.items():
        name = path.rsplit("/", 1)[-1]
        if name.startswith("surname-survey") and name.endswith(".md"):
            return text
    return ""


def test_household_grouping_and_slave_schedule(after_state, test):
    """d5: in the written table, the two stubs sharing a recordArk (Edmund and
    Mary) are one row, and the slave-schedule stub sits under its own heading.

    Reads the file from after_state["files"]: the recorded Write args are
    truncated, and on a direct test text_response is the dispatcher's relay."""
    if "household-grouping" not in test.get("tags", []):
        pytest.skip("not a household-grouping test")
    text = _survey_file(after_state)
    assert text, "no surname-survey-*.md in the workspace"
    population, slave, heading = [], [], ""
    for line in text.lower().splitlines():
        s = line.strip()
        if s.startswith("#"):
            heading = s
        elif s.startswith("|"):
            (slave if "slave" in heading else population).append(s)
    assert slave, "no table rows under a heading naming the slave schedule"
    assert any("edmund" in r for r in slave), (
        "the slave-schedule stub is not under the slave-schedule heading"
    )
    mary = [r for r in population if "mary" in r]
    assert len(mary) == 1 and "edmund" in mary[0], (
        f"Edmund and Mary share a recordArk and must be one household row; got {mary}"
    )
