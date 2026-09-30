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

    Not `pytest.raises(AssertionError)`. The validators now `pytest.skip` on one
    shape (a run that stopped to ask), and a skip raised inside the validator
    propagates out of the calling test -- so pytest would mark THIS test skipped
    rather than failing it, and the guard would assert nothing. Mutation-verified:
    forcing `_paused_to_ask` to always return True leaves the `pytest.raises`
    form green (the test merely turns into a skip) and kills this form.
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
        call("research_append", section="known_holdings", op="append", entry={}),
    ]


def test_a_compliant_run_passes():
    check(compliant(), NO_PROFILE, POSITIVE, NO_ASK)


def test_a_hand_serialized_run_fails_even_though_the_files_would_look_right():
    """The whole point. Zero writer calls, and the after-state would be identical."""
    e = must_fail(check, [], NO_PROFILE, POSITIVE, NO_ASK)
    assert "project_create" in str(e)


def test_the_profile_and_holdings_calls_alone_are_not_enough():
    """They write into a project; they cannot bring one into being."""
    calls = [c for c in compliant() if not c["tool"].endswith("project_create")]
    e = must_fail(check, calls, NO_PROFILE, POSITIVE, NO_ASK)
    assert "project_create" in str(e)
    # The message names what WAS called, so a reader can see the route taken.
    assert "research_append" in str(e)


def test_project_create_alone_is_enough():
    """It writes both documents, so there is no second call to require. A
    project with no volunteered holdings legitimately makes exactly one call."""
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


def test_a_profile_that_arrived_without_research_append_fails():
    """`project_create` never writes a profile, so one in the output that no
    `research_append` call explains came in by a route the lockdown denies.

    Reachable in the harness specifically because it grants `Write` to every
    skill — which is why the state-shaped checks cannot see it.
    """
    calls = [call("project_create", projectPath="/p", objective="x")]
    e = must_fail(check, calls, WITH_PROFILE, POSITIVE, NO_ASK)
    assert "researcher_profile" in str(e)


def test_a_profile_written_through_research_append_passes():
    check(compliant(), WITH_PROFILE, POSITIVE, NO_ASK)


def test_no_profile_means_the_arm_does_not_fire():
    """A researcher who volunteered nothing legitimately makes one call."""
    check([call("project_create", projectPath="/p", objective="x")], NO_PROFILE, POSITIVE, NO_ASK)


# --- the ask exemption ------------------------------------------------------
#
# Phase 4 made one opening question blocking: when `person_search` reports it
# cannot pick, init-project must ask rather than choose, and a run that asks
# has no project yet. Both file rules therefore stand down for that shape --
# and for no other, which is what the second half of each pair below pins.

EMPTY: dict = {"research_json": None, "tree_gedcomx_json": None}


def test_a_run_that_asked_and_built_nothing_is_excused():
    """The legitimate new shape: asked which person, so there is no project."""
    check([], EMPTY, POSITIVE, ASKED)
    check_files({}, EMPTY, POSITIVE, ASKED)


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
