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
    """The call shape the rewritten SKILL.md is supposed to produce."""
    return [
        call("tree_edit", ops=[{"operation": "add_person"}]),
        call("research_append", section="project", op="update", fields={"objective": "x"}),
        call(
            "research_append",
            section="researcher_profile",
            op="update",
            fields={"experience_level": "novice"},
        ),
    ]


def test_a_compliant_run_passes():
    check(compliant(), POSITIVE)


def test_a_hand_serialized_run_fails_even_though_the_files_would_look_right():
    """The whole point. Zero writer calls, and the after-state would be identical."""
    with pytest.raises(AssertionError) as e:
        check([], POSITIVE)
    assert "research_append" in str(e.value)


def test_missing_the_project_write_fails():
    calls = [c for c in compliant() if c["args"].get("section") != "project"]
    with pytest.raises(AssertionError) as e:
        check(calls, POSITIVE)
    assert "section 'project'" in str(e.value)


def test_missing_the_tree_write_fails():
    calls = [c for c in compliant() if not c["tool"].endswith("tree_edit")]
    with pytest.raises(AssertionError) as e:
        check(calls, POSITIVE)
    assert "tree_edit" in str(e.value)


def test_materialize_facts_satisfies_the_tree_half():
    """Either tree writer is legitimate — the rule is 'not hand-serialized'."""
    calls = [c for c in compliant() if not c["tool"].endswith("tree_edit")]
    calls.append(call("materialize_facts", personId="I1"))
    check(calls, POSITIVE)


def test_a_batched_project_write_is_seen():
    """The ops[] form has to be walked, not just the single-op form."""
    calls = [
        call("tree_edit", ops=[{"operation": "add_person"}]),
        call(
            "research_append",
            ops=[
                {"section": "known_holdings", "op": "append", "entry": {}},
                {"section": "project", "op": "update", "fields": {"objective": "x"}},
            ],
        ),
    ]
    check(calls, POSITIVE)


def test_a_no_premature_write_test_is_skipped():
    """That scenario's correct behaviour is writing nothing at all."""
    with pytest.raises(pytest.skip.Exception):
        check([], {"type": "positive", "tags": ["no-premature-write"]})


def test_a_negative_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check([], {"type": "negative"})
