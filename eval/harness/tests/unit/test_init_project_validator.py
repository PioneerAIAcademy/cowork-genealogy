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
    test_project_files_written_through_the_writer_tools as check,
)


POSITIVE = {"type": "positive"}


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
    check(compliant(), POSITIVE)


def test_a_hand_serialized_run_fails_even_though_the_files_would_look_right():
    """The whole point. Zero writer calls, and the after-state would be identical."""
    with pytest.raises(AssertionError) as e:
        check([], POSITIVE)
    assert "project_create" in str(e.value)


def test_the_profile_and_holdings_calls_alone_are_not_enough():
    """They write into a project; they cannot bring one into being."""
    calls = [c for c in compliant() if not c["tool"].endswith("project_create")]
    with pytest.raises(AssertionError) as e:
        check(calls, POSITIVE)
    assert "project_create" in str(e.value)
    # The message names what WAS called, so a reader can see the route taken.
    assert "research_append" in str(e.value)


def test_project_create_alone_is_enough():
    """It writes both documents, so there is no second call to require. A
    project with no volunteered holdings and no answered interview legitimately
    makes exactly one call."""
    check([call("project_create", projectPath="/p", objective="x")], POSITIVE)


def test_a_namespaced_tool_name_is_recognised():
    """Cowork namespaces MCP tools per run mode; the bare tail is what matches."""
    check(
        [{"tool": "mcp__remote-devices__Genealogy_Research__project_create", "args": {}}],
        POSITIVE,
    )


def test_a_no_premature_write_test_is_skipped():
    """That scenario's correct behaviour is writing nothing at all."""
    with pytest.raises(pytest.skip.Exception):
        check([], {"type": "positive", "tags": ["no-premature-write"]})


def test_a_negative_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check([], {"type": "negative"})
