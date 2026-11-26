"""Proof cases for the issue #4670 research validator
`test_identity_steer_names_the_household_member`: it fails on planted breaks, in
more than one shape, and passes legitimate variants."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research import test_identity_steer_names_the_household_member as check  # noqa: E402

TEST = {"id": "ut_research_ygb", "tags": ["identity-steer-names-member"]}


def _spawn(prompt, callee="research-plan", tool="Agent"):
    return {"tool": tool, "args": {"subagent_type": callee, "prompt": prompt}}


def test_passes_a_spawn_that_names_her():
    check(TEST, [_spawn("projectPath: /w\nquestionId: q_001\nThe researcher asks who Harriet Phillips is.")])


def test_passes_any_case_and_the_older_task_tool():
    check(TEST, [_spawn("who is HARRIET in the 1860 household?", tool="Task")])


def test_fails_a_generic_planning_spawn():
    with pytest.raises(AssertionError, match="names 'Harriet'"):
        check(TEST, [_spawn("projectPath: /w\nquestionId: q_001\nPlan the searches.")])


def test_fails_a_name_inside_another_word():
    with pytest.raises(AssertionError, match="names 'Harriet'"):
        check(TEST, [_spawn("Harrietta Smith")])


def test_fails_when_only_another_agent_names_her():
    with pytest.raises(AssertionError, match="no research-plan spawn"):
        check(TEST, [_spawn("who is Harriet?", callee="person-evidence")])


def test_fails_with_no_spawn():
    with pytest.raises(AssertionError, match="no research-plan spawn"):
        check(TEST, [])


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check({"id": "ut_research_xyz", "tags": []}, [])


def test_a_keyed_test_without_its_tag_fails():
    with pytest.raises(AssertionError, match="no\n?.*'identity-steer-names-member' tag"):
        check({"id": "ut_research_ygb", "tags": []}, [])
