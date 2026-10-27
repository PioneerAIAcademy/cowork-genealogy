"""Direct tests for the report-log validators (issue #3524).

check-warnings, translation, convert-dates and validate-schema each log their
reply as one research-log entry inside a project and write nothing else; with no
project they write nothing. The state rule lives in `validators_lib`
(`assert_only_logs_report`, `assert_report_logged`); each agent's tool
allow-list admits one `research_log_append` call. Same reason as the sibling
validator tests: nothing under `validators/` is collected by
`make harness-test`, so without this file a validator's pass/fail set would
appear only inside a paid run.

Both directions, per CLAUDE.md "A new lint must be proven to fail": one
legitimate entry passes; a second entry, a wrong `tool`, an edit outside `log`,
an edited earlier entry, empty `notes`, and research.json created with no
project each fail.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_convert_dates import (  # noqa: E402
    test_only_convert_calendar_called as cd_allowlist,
    test_reply_carries_logged_report as cd_reply,
    test_report_logged as cd_logged,
    test_research_json_only_logs_report as cd_state,
)
from test_check_warnings import (  # noqa: E402
    test_reply_carries_logged_report as cw_reply,
    test_report_logged as cw_logged,
    test_research_json_only_logs_report as cw_state,
)
from test_translation import (  # noqa: E402
    test_only_logs_translation as tr_allowlist,
    test_reply_carries_logged_report as tr_reply,
    test_report_logged as tr_logged,
    test_research_json_only_logs_report as tr_state,
)
from test_validate_schema import (  # noqa: E402
    test_does_not_modify_project_files as vs_state,
    test_only_calls_validate_research_schema as vs_allowlist,
    test_reply_carries_logged_report as vs_reply,
    test_report_logged as vs_logged,
)

POSITIVE = {"type": "positive", "tags": ["logs-report"]}

# (state validator, logged validator, the agent's `tool`)
AGENTS = [
    pytest.param(cw_state, cw_logged, "check_warnings", id="check-warnings"),
    pytest.param(tr_state, tr_logged, "translation", id="translation"),
    pytest.param(cd_state, cd_logged, "convert_dates", id="convert-dates"),
    pytest.param(vs_state, vs_logged, "validate_schema", id="validate-schema"),
]


def _research(log, **extra):
    return {"project": {"id": "p1"}, "log": log, "sources": [], **extra}


def _entry(n, tool, notes="the full reply"):
    return {"id": f"log_{n:03d}", "tool": tool, "plan_item_id": None, "notes": notes}


_PRIOR = _entry(1, "record_search", notes=None)


def _states(before, after):
    tree = {"persons": []}
    return (
        {"research_json": before, "tree_gedcomx_json": tree, "files": {}},
        {"research_json": after, "tree_gedcomx_json": tree, "files": {}},
    )


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_one_logged_reply_passes(state, logged, tool):
    before, after = _states(_research([_PRIOR]), _research([_PRIOR, _entry(2, tool)]))
    state(before, after, POSITIVE)
    logged(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_no_entry_passes_the_state_check_and_fails_the_logged_check(state, logged, tool):
    before, after = _states(_research([_PRIOR]), _research([_PRIOR]))
    state(before, after, POSITIVE)
    with pytest.raises(AssertionError, match=f"exactly one new {tool}"):
        logged(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_a_second_entry_fails(state, logged, tool):
    before, after = _states(
        _research([_PRIOR]), _research([_PRIOR, _entry(2, tool), _entry(3, tool)])
    )
    with pytest.raises(AssertionError, match="one reply is one entry"):
        state(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_an_entry_under_another_tool_fails(state, logged, tool):
    before, after = _states(_research([_PRIOR]), _research([_PRIOR, _entry(2, "record_search")]))
    with pytest.raises(AssertionError, match="its only log entry"):
        state(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_a_write_outside_the_log_fails(state, logged, tool):
    before, after = _states(
        _research([_PRIOR]), _research([_PRIOR, _entry(2, tool)], sources=[{"id": "s_001"}])
    )
    with pytest.raises(AssertionError):
        state(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_an_edited_earlier_entry_fails(state, logged, tool):
    edited = dict(_PRIOR, notes="rewritten")
    before, after = _states(_research([_PRIOR]), _research([edited, _entry(2, tool)]))
    with pytest.raises(AssertionError):
        state(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_empty_notes_fail_the_logged_check(state, logged, tool):
    before, after = _states(_research([_PRIOR]), _research([_PRIOR, _entry(2, tool, notes=" ")]))
    with pytest.raises(AssertionError, match="notes must carry the reply"):
        logged(before, after, POSITIVE)


@pytest.mark.parametrize("state, logged, tool", AGENTS)
def test_no_project_passes_only_when_nothing_is_created(state, logged, tool):
    before, after = _states(None, None)
    state(before, after, POSITIVE)
    with pytest.raises(pytest.skip.Exception):
        logged(before, after, POSITIVE)
    before, after = _states(None, _research([_entry(1, tool)]))
    with pytest.raises(AssertionError, match="created research.json with no project"):
        state(before, after, POSITIVE)


def test_validate_schema_still_fails_on_a_tree_edit():
    before, after = _states(_research([]), _research([_entry(1, "validate_schema")]))
    after["tree_gedcomx_json"] = {"persons": [{"id": "I1"}]}
    with pytest.raises(AssertionError, match="tree.gedcomx.json"):
        vs_state(before, after, POSITIVE)


# --- the tool allow-lists admit one research_log_append and nothing else ---

def _call(name, server="genealogy"):
    return {"tool": f"mcp__{server}__{name}"}


def test_translation_allows_one_log_call_and_no_other_tool():
    tr_allowlist([_call("research_log_append")], POSITIVE)
    tr_allowlist([], POSITIVE)
    with pytest.raises(AssertionError, match="research_log_append 2 times"):
        tr_allowlist([_call("research_log_append")] * 2, POSITIVE)
    with pytest.raises(AssertionError, match="no MCP tool other than"):
        tr_allowlist([_call("record_read")], POSITIVE)


def test_convert_dates_allows_one_log_call_beside_convert_calendar():
    cd_allowlist([_call("convert_calendar"), _call("research_log_append")], POSITIVE)
    with pytest.raises(AssertionError, match="only call convert_calendar"):
        cd_allowlist([_call("convert_calendar")] + [_call("research_log_append")] * 2, POSITIVE)
    with pytest.raises(AssertionError, match="only call convert_calendar"):
        cd_allowlist([_call("research_append")], POSITIVE)


def test_validate_schema_allows_one_log_call_beside_the_validator():
    vs_allowlist([_call("validate_research_schema"), _call("research_log_append")])
    with pytest.raises(AssertionError, match="one report is one entry"):
        vs_allowlist([_call("validate_research_schema")] + [_call("research_log_append")] * 2)
    with pytest.raises(AssertionError, match="should only call validate_research_schema"):
        vs_allowlist([_call("research_append")])


# --- the logged report is also the reply (issue #3524 review) ---------------

REPLY_AGENTS = [
    pytest.param(cw_reply, "check-warnings", "check_warnings", id="check-warnings"),
    pytest.param(tr_reply, "translation", "translation", id="translation"),
    pytest.param(cd_reply, "convert-dates", "convert_dates", id="convert-dates"),
    pytest.param(vs_reply, "validate-schema", "validate_schema", id="validate-schema"),
]

_REPORT = (
    "WARNINGS FOR: Patrick Flynn (KWCJ-RN4). Contradiction: residence recorded "
    "eighteen months after burial in Sherbrooke parish; verify the residence "
    "source against the original census enumeration before correcting anything."
)
_DIRECT = {"type": "positive", "delegation": "Check Patrick Flynn for warnings.", "tags": ["direct-arm"]}


def _logged(tool):
    return _states(_research([]), _research([_entry(1, tool, notes=_REPORT)]))


@pytest.mark.parametrize("check, agent, tool", REPLY_AGENTS)
def test_a_reply_carrying_the_report_passes(check, agent, tool):
    before, after = _logged(tool)
    returns = [{"subagent_type": agent, "text": _REPORT + "\n\n---\nA plain summary."}]
    check(before, after, _DIRECT, agent_returns=returns, text_response="relay")


@pytest.mark.parametrize("check, agent, tool", REPLY_AGENTS)
def test_a_note_that_it_was_logged_fails(check, agent, tool):
    before, after = _logged(tool)
    returns = [{"subagent_type": agent, "text": "The check has been logged (log_001 in research.json)."}]
    with pytest.raises(AssertionError, match="not a note that it was logged"):
        check(before, after, _DIRECT, agent_returns=returns, text_response=_REPORT)


@pytest.mark.parametrize("check, agent, tool", REPLY_AGENTS)
def test_the_dispatchers_relay_does_not_rescue_a_silent_agent(check, agent, tool):
    before, after = _logged(tool)
    with pytest.raises(AssertionError, match="carries 0%"):
        check(before, after, _DIRECT, agent_returns=[], text_response=_REPORT)


@pytest.mark.parametrize("check, agent, tool", REPLY_AGENTS)
def test_no_logged_entry_skips(check, agent, tool):
    before, after = _states(_research([]), _research([]))
    with pytest.raises(pytest.skip.Exception):
        check(before, after, _DIRECT, agent_returns=[], text_response="")
