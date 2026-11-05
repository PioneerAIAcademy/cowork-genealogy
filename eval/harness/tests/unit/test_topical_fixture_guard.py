"""assert_topical_fixture_used fails a spawned agent that read nothing (#4253).

Since #4218 a no-project historical-context run makes no tool call when the
helper answers from memory, and the guard used to skip on "no fixture-backed
call". A caller that passes `builtin_tool_calls` now fails that run; a run that
never spawned the agent still skips, and a caller that passes nothing is
unchanged.
"""

from __future__ import annotations

import pytest

from validators.validators_lib import assert_topical_fixture_used

TEST_ID = "ut_historical_context_zz1"
FIXTURE_MAP = {TEST_ID: "wiki-read-french-republican-calendar"}
TEST = {
    "id": TEST_ID,
    "skill": "historical-context",
    "tags": ["topical-fixture-required"],
}


def _spawn(agent: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent}}


def _served(stem: str) -> dict:
    return {"tool": "wiki_read", "response_fixture": stem}


def _run(tool_calls, builtin_tool_calls="omit"):
    kwargs = {} if builtin_tool_calls == "omit" else {"builtin_tool_calls": builtin_tool_calls}
    return assert_topical_fixture_used(tool_calls, TEST, FIXTURE_MAP, **kwargs)


def test_spawned_agent_with_zero_tool_calls_fails():
    with pytest.raises(AssertionError, match="answered without reading"):
        _run([], [_spawn("historical-context")])


def test_spawned_agent_that_was_served_the_expected_fixture_passes():
    got = _run(
        [_served("wiki-read-french-republican-calendar")],
        [_spawn("historical-context")],
    )
    assert got == "wiki-read-french-republican-calendar"


def test_agent_never_spawned_skips():
    with pytest.raises(pytest.skip.Exception):
        _run([], [])


def test_a_different_agent_spawned_skips():
    with pytest.raises(pytest.skip.Exception):
        _run([], [_spawn("locality-guide")])


def test_no_builtin_tool_calls_kwarg_skips_on_zero_calls():
    with pytest.raises(pytest.skip.Exception):
        _run([])
