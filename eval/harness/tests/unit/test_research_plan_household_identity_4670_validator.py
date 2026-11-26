"""Proof cases for the issue #4670 research-plan validator.

`test_household_identity_reads_no_relative_profile` is shown to fail on planted
reads, in more than one shape, and to pass legitimate variants.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research_plan import (  # noqa: E402
    test_household_identity_reads_no_relative_profile as check,
)

TEST = {"id": "ut_research_plan_4gc", "tags": ["household-identity-no-relative-read"]}

_WRITE = {
    "tool": "mcp__genealogy__research_append",
    "args": {"section": "plans", "op": "append", "entry": {"question_id": "q_001"}},
    "response": {"ok": True},
}


def _read(pid, tool="mcp__genealogy__person_read"):
    return {"tool": tool, "args": {"personId": pid, "projectPath": "/w"}}


def test_passes_a_plan_with_no_profile_read():
    check([_WRITE], [], TEST)


def test_passes_a_read_of_someone_outside_the_household():
    check([_read("K8PL-W2W"), _WRITE], [], TEST)


@pytest.mark.parametrize(
    "pid",
    ["LQRZ-FVX", "ark:/61903/4:1:KNSW-567", "94z5-n1f", "https://www.familysearch.org/ark:/61903/4:1:LQRZ-FVX/"],
)
def test_fails_a_read_of_a_relative_in_any_spelling(pid):
    with pytest.raises(AssertionError, match="person_read on"):
        check([_WRITE, _read(pid)], [], TEST)


def test_fails_a_read_after_the_plan_write_too():
    with pytest.raises(AssertionError, match="LQRZ-FVX"):
        check([_WRITE, _read("LQRZ-FVX", tool="mcp__remote-devices__Genealogy_Research__person_read")], [], TEST)


def test_fails_an_attempted_read_that_never_reached_a_fixture():
    with pytest.raises(AssertionError, match="KNSW-567"):
        check([_WRITE], [_read("KNSW-567")], TEST)


def test_fails_a_run_with_no_plan_write():
    with pytest.raises(AssertionError, match="no research_append wrote"):
        check([], [], TEST)


def test_a_refused_write_is_not_a_plan_write():
    refused = dict(_WRITE, response={"ok": False})
    with pytest.raises(AssertionError, match="no research_append wrote"):
        check([refused], [], TEST)


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check([], [], {"id": "ut_research_plan_xyz", "tags": []})


def test_a_keyed_test_without_its_tag_fails():
    with pytest.raises(AssertionError, match="no\n?.*'household-identity-no-relative-read' tag"):
        check([_WRITE], [], {"id": "ut_research_plan_4gc", "tags": []})


def test_a_tagged_test_without_a_key_fails():
    with pytest.raises(AssertionError, match="has no entry"):
        check([_WRITE], [], {"id": "ut_research_plan_xyz", "tags": ["household-identity-no-relative-read"]})
