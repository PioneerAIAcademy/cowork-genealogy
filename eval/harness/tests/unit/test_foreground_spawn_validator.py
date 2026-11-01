"""`test_every_agent_spawn_runs_in_the_foreground` — decision 27's validator.

Both directions are proven: a spawn that asks for the foreground passes in
every spelling the recorders produce, and a backgrounded or silent spawn fails.
The silent case is the one that matters — the SDK's default is background, so a
check that only rejected an explicit `true` would pass today's router, which
says nothing at all.

**Why the failure tests assert the exception TYPE.** The validator skips a run
with no spawn, and `pytest.skip` inside it skips the *calling* test. So a
validator that had gone vacuous — keyed on a recorded tool name it did not
expect, and therefore matching nothing — would turn every
`pytest.raises(AssertionError)` here into a skip, and the suite would report
success. Catching `BaseException` and naming the type is what tells a skip from
a failure; a break-test proved the `raises` form could not.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import (  # noqa: E402
    test_every_agent_spawn_runs_in_the_foreground as _validator,
)


def validator(test, calls, skills_invoked=("research",)):
    return _validator(test, calls, list(skills_invoked))

TEST = {"tags": ["routing"]}


def _spawn(**args) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": "research-plan", **args}}


def _expect_fail(calls) -> str:
    """Run the validator expecting a real assertion failure, never a skip."""
    with pytest.raises(BaseException) as excinfo:
        validator(TEST, calls)
    assert excinfo.typename == "AssertionError", (
        f"expected the validator to FAIL, got {excinfo.typename}. A skip here "
        "means it matched no spawn at all and is passing vacuously."
    )
    return str(excinfo.value)


def _expect_skip(calls) -> None:
    with pytest.raises(BaseException) as excinfo:
        validator(TEST, calls)
    assert excinfo.typename == "Skipped", excinfo.typename


@pytest.mark.parametrize("value", [False, "False", "false", "FALSE", " false ", "0"])
def test_a_foreground_spawn_passes_in_every_spelling(value):
    validator(TEST, [_spawn(run_in_background=value)])


def test_several_foreground_spawns_pass():
    validator(
        TEST,
        [
            _spawn(run_in_background=False),
            {"tool": "Agent", "args": {"subagent_type": "search-records",
                                    "run_in_background": "False"}},
        ],
    )


@pytest.mark.parametrize("value", [True, "True", "true", "1"])
def test_an_explicitly_backgrounded_spawn_fails(value):
    assert "research-plan" in _expect_fail([_spawn(run_in_background=value)])


def test_a_spawn_that_says_nothing_fails():
    """Today's router. The SDK default is background, so silence is background —
    this is the case the validator exists for, and the one a naive check misses."""
    assert "<absent>" in _expect_fail([_spawn()])


def test_one_bad_spawn_among_good_ones_still_fails():
    message = _expect_fail(
        [
            _spawn(run_in_background=False),
            {"tool": "Agent", "args": {"subagent_type": "person-evidence"}},
        ]
    )
    assert "person-evidence" in message
    assert "research-plan" not in message


def test_an_unparseable_value_fails_rather_than_being_guessed_at():
    _expect_fail([_spawn(run_in_background="maybe")])


def test_the_validator_reads_spawns_the_recorder_actually_writes():
    """A spawn as the recorder writes it is SEEN: this asserts it by making it
    fail, since a validator that saw nothing would skip and report success."""
    assert "research-plan" in _expect_fail([_spawn(run_in_background=True)])


def test_the_recorded_tool_name_does_not_matter():
    """Committed logs record `"Agent"`; an older CLI named the same tool `"Task"`.
    `subagent_type` is the key, so a spawn under either name is still read."""
    assert "research-plan" in _expect_fail(
        [{"tool": "Task", "args": {"subagent_type": "research-plan"}}]
    )


def test_a_subagent_s_own_spawn_is_not_the_main_thread_s():
    """`agent_id` is present only when the hook fired INSIDE a subagent, so its
    absence is what marks the main thread. The rule is the router's; a nested
    spawn is not the router's to answer for."""
    _expect_skip([{"tool": "Agent", "args": {"subagent_type": "search-records"},
                   "agent_id": "sub-1"}])


def test_a_run_with_no_spawn_is_skipped_not_passed():
    """A vacuous pass here would read as coverage on every non-routing run."""
    _expect_skip([])


def test_a_non_spawn_tool_call_is_not_mistaken_for_a_spawn():
    _expect_skip([{"tool": "Read", "args": {"file_path": "/x"}}])


def test_a_spawn_with_the_router_never_entered_is_skipped():
    """A message that never reached /research: the main thread spawned the agent
    itself, so the router's foreground rule does not apply to it."""
    with pytest.raises(BaseException) as excinfo:
        validator(TEST, [_spawn()], skills_invoked=["historical-context"])
    assert excinfo.typename == "Skipped"


def test_the_router_entered_among_others_still_grades():
    with pytest.raises(BaseException) as excinfo:
        validator(TEST, [_spawn()], skills_invoked=["historical-context", "research"])
    assert excinfo.typename == "AssertionError"
