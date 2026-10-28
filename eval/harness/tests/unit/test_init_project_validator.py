"""Direct tests for the init-project write-path validator.

Same reason as `test_universal_validators.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test` and its real pass/fail set appears only inside a paid
per-skill run. A validator added to close an unfalsifiable check would itself
go unexercised until someone spent $7-25 to find out whether it works.

What it guards: `init-project` creating the project by CALLING the writer tools
rather than hand-serializing the files. No after-state check can see that — the
harness grants `Write` to every skill, so both routes leave identical output.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import (  # noqa: E402
    test_asks_for_pid_creates_no_project as check_no_project,
    test_both_project_files_created as check_files,
    test_project_files_written_through_the_writer_tools as check,
)


POSITIVE = {"type": "positive"}

#: builtin_tool_calls for a run that never stopped to ask the researcher anything.
NO_ASK: list = []

#: builtin_tool_calls for a run that stopped on a non-decisive person pick.
ASKED = [{"tool": "Glob"}, {"tool": "AskUserQuestion"}]

#: after_state for a run whose researcher volunteered nothing, so no profile was
#: written. The profile arm of the check is conditional on one existing.
NO_PROFILE = {"research_json": {"project": {"objective": "x"}}}

#: after_state for a run that ended with a profile — which project_create never
#: writes, so it can only have come from research_append or a raw write.
WITH_PROFILE = {
    "research_json": {
        "project": {"objective": "x"},
        "researcher_profile": {"experience_level": "novice"},
    }
}



def must_fail(fn, *args):
    """Call a validator that is expected to REJECT this run, and return the error.

    Not `pytest.raises(AssertionError)`. The validators `pytest.skip` on the
    `asks-for-pid` shape, and a skip raised inside the validator propagates out
    of the calling test -- so pytest would mark THIS test skipped rather than
    failing it, and the guard would assert nothing. Mutation-verified: widening
    that skip to fire on any run leaves the `pytest.raises` form green (the test
    merely turns into a skip) and kills this form.
    """
    try:
        fn(*args)
    except AssertionError as exc:
        return exc
    except pytest.skip.Exception as exc:  # noqa: PT012 -- the whole point
        pytest.fail(f"validator SKIPPED instead of rejecting the run: {exc}")
    pytest.fail("validator accepted a run it should have rejected")


def call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


def compliant():
    """The call shape the rewritten SKILL.md produces: one create, then the
    two sections the create deliberately leaves out."""
    return [
        call("project_create", projectPath="/p", objective="x", tree={"persons": []}),
        call(
            "research_append",
            section="researcher_profile",
            op="update",
            fields={"experience_level": "novice"},
        ),
    ]


def test_a_compliant_run_passes():
    check(compliant(), NO_PROFILE, POSITIVE, NO_ASK)


def test_a_hand_serialized_run_fails_even_though_the_files_would_look_right():
    """The whole point. Zero writer calls, and the after-state would be identical."""
    e = must_fail(check, [], NO_PROFILE, POSITIVE, NO_ASK)
    assert "project_create" in str(e)


def test_the_profile_call_alone_is_not_enough():
    """They write into a project; they cannot bring one into being."""
    calls = [c for c in compliant() if not c["tool"].endswith("project_create")]
    e = must_fail(check, calls, NO_PROFILE, POSITIVE, NO_ASK)
    assert "project_create" in str(e)
    # The message names what WAS called, so a reader can see the route taken.
    assert "research_append" in str(e)


def test_project_create_alone_is_enough():
    """It writes both documents, so there is no second call to require. A
    project whose researcher names no site access legitimately makes exactly one call."""
    check([call("project_create", projectPath="/p", objective="x")], NO_PROFILE, POSITIVE, NO_ASK)


def test_a_namespaced_tool_name_is_recognised():
    """Cowork namespaces MCP tools per run mode; the bare tail is what matches."""
    check(
        [{"tool": "mcp__remote-devices__Genealogy_Research__project_create", "args": {}}],
        NO_PROFILE,
        POSITIVE,
        NO_ASK,
    )


def test_a_negative_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check([], NO_PROFILE, {"type": "negative"}, NO_ASK)


def test_a_profile_written_by_project_create_alone_passes():
    """`project_create` writes the house profile itself (issue #3384), so a
    profile with no `research_append` call is the normal case, not a raw write."""
    calls = [call("project_create", projectPath="/p", objective="x", personId="LZNY-BRF")]
    check(calls, WITH_PROFILE, POSITIVE, NO_ASK)


def test_a_profile_written_through_research_append_passes():
    check(compliant(), WITH_PROFILE, POSITIVE, NO_ASK)


def test_no_profile_means_the_arm_does_not_fire():
    """A researcher who volunteered nothing legitimately makes one call."""
    check([call("project_create", projectPath="/p", objective="x")], NO_PROFILE, POSITIVE, NO_ASK)


# --- the ask exemption ------------------------------------------------------
#
# A project always starts from a FamilySearch PID. When the message carries
# none, init-project returns to the router asking for one and builds nothing;
# those tests carry the `asks-for-pid` tag, and both file rules stand down for
# that tag and for nothing else. The person-pick exemption this replaced keyed
# on an `AskUserQuestion` call, a tool init-project does not hold.

EMPTY: dict = {"research_json": None, "tree_gedcomx_json": None}


def test_a_run_that_asked_and_built_nothing_still_fails():
    """Asking is no longer an excuse, because nothing legitimate can ask.

    This was an exemption for the namesake person-pick: `person_search` could
    not choose between tied candidates, so the skill asked and built nothing.
    That path is gone. init-project does not hold `AskUserQuestion` at all, a
    project always starts from a PID, and the no-PID ask is a RETURN to the
    router rather than a tool call (it carries the `asks-for-pid` tag, which
    the rule below reads). So the exemption excused nothing real while
    loosening both file checks for all ten positive PID tests: a run that
    asked and built nothing passed both.
    """
    must_fail(check, [], EMPTY, POSITIVE, ASKED)
    must_fail(check_files, {}, EMPTY, POSITIVE, ASKED)


def test_a_run_that_built_nothing_and_did_not_ask_still_fails():
    """The exemption is for asking, not for idling -- otherwise "did nothing"
    passes as "asked", and the rule protects nothing."""
    must_fail(check, [], EMPTY, POSITIVE, NO_ASK)
    must_fail(check_files, {}, EMPTY, POSITIVE, NO_ASK)


def test_a_run_that_asked_but_still_built_a_project_is_held_to_both_rules():
    """Asking does not buy a pass on the write path. A run that asked AND
    produced files must still have gone through project_create."""
    e = must_fail(check, [], NO_PROFILE, POSITIVE, ASKED)
    assert "project_create" in str(e)


def test_a_compliant_run_that_also_asked_passes():
    check(compliant(), NO_PROFILE, POSITIVE, ASKED)


# --- the asks-for-pid tag ---------------------------------------------------
#
# A message with no FamilySearch person ID must create nothing, and init-project
# returns to the router to ask rather than calling AskUserQuestion. The tag
# excuses the two file rules above; `check_no_project` is what keeps the excuse
# from passing a run that built a project anyway. One must-fail case per half,
# so removing either half of its condition turns a test red.

ASKS_FOR_PID = {"type": "positive", "tags": ["asks-for-pid"]}


def test_an_asks_for_pid_run_that_built_nothing_is_excused():
    """The two file rules must SKIP here, and the skip must be asserted.

    Calling them bare let the skip propagate and mark this test skipped, so it
    reported green while asserting nothing -- and would have kept reporting
    green if the exemption were deleted outright. `check_no_project` is a plain
    call because it is expected to PASS, not skip.
    """
    with pytest.raises(pytest.skip.Exception):
        check([], EMPTY, ASKS_FOR_PID, NO_ASK)
    with pytest.raises(pytest.skip.Exception):
        check_files({}, EMPTY, ASKS_FOR_PID, NO_ASK)
    check_no_project([], EMPTY, ASKS_FOR_PID)


def test_an_asks_for_pid_run_that_wrote_only_the_tree_fails():
    """The third way to build something: files on disk without project_create,
    and only the tree. Checking research.json alone let this through."""
    must_fail(
        check_no_project,
        [],
        {"research_json": None, "tree_gedcomx_json": {"persons": []}},
        ASKS_FOR_PID,
    )


def test_an_asks_for_pid_run_that_called_project_create_fails():
    """project_create called, but nothing reached disk."""
    calls = [call("project_create", projectPath="/p", objective="x")]
    e = must_fail(check_no_project, calls, EMPTY, ASKS_FOR_PID)
    assert "project_create" in str(e)


def test_an_asks_for_pid_run_that_wrote_files_without_project_create_fails():
    """Files on disk, by a route that never called project_create."""
    must_fail(check_no_project, [], NO_PROFILE, ASKS_FOR_PID)


def test_the_no_project_rule_skips_untagged_tests():
    with pytest.raises(pytest.skip.Exception):
        check_no_project([], NO_PROFILE, POSITIVE)
