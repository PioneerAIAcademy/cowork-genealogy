"""Proof cases for the research validator `test_draws_the_steps_card`: it fails
on planted breaks, in more than one shape, and passes legitimate variants."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research import test_draws_the_steps_card as check  # noqa: E402

TEST = {"id": "ut_research_hpc", "tags": ["routing", "draws-card:plan"]}
PROJECT = "/projects/proj_0123456789abcdef"


def _read(path=PROJECT, tool="mcp__genealogy__project_context"):
    return {"tool": tool, "args": {"projectPath": path}, "response": {}}


def _card(show="plan", path=PROJECT, tool="mcp__genealogy__show_project", response=None):
    return {"tool": tool, "args": {"show": show, "projectPath": path}, "response": response or {}}


def test_passes_one_card_at_the_project_read():
    check(TEST, [_read(), _card()])


def test_passes_any_server_spelling():
    check(
        TEST,
        [
            _read(tool="mcp__remote-devices__Genealogy_Research__project_context"),
            _card(tool="mcp__Genealogy_Research__show_project"),
        ],
    )


def test_passes_when_an_earlier_read_sent_no_path():
    check(TEST, [{"tool": "project_context", "args": {}, "response": {}}, _read(), _card()])


def test_fails_with_no_card():
    with pytest.raises(AssertionError, match="expected one show_project call"):
        check(TEST, [_read()])


def test_fails_two_cards():
    with pytest.raises(AssertionError, match="expected one show_project call"):
        check(TEST, [_read(), _card(), _card()])


def test_fails_the_wrong_card():
    with pytest.raises(AssertionError, match="drew 'tree'; this step's card is 'plan'"):
        check(TEST, [_read(), _card(show="tree")])


def test_fails_a_card_with_no_show():
    with pytest.raises(AssertionError, match="drew None"):
        check(TEST, [_read(), {"tool": "show_project", "args": {"projectPath": PROJECT}}])


def test_fails_a_project_the_router_did_not_read():
    with pytest.raises(AssertionError, match="not the project the router read"):
        check(TEST, [_read(), _card(path="/projects/proj_fedcba9876543210")])


def test_fails_a_card_with_no_project_read():
    with pytest.raises(AssertionError, match="not the project the router read"):
        check(TEST, [_card()])


def test_fails_a_card_with_no_path_when_a_read_sent_none():
    with pytest.raises(AssertionError, match="not the project the router read"):
        check(TEST, [{"tool": "project_context", "args": {}}, _card(path=None)])


def test_fails_a_refused_call():
    with pytest.raises(AssertionError, match="refused the call: no such project"):
        check(TEST, [_read(), _card(response={"isError": True, "text": "no such project"})])


def test_skips_a_test_with_no_card_tag():
    with pytest.raises(pytest.skip.Exception):
        check({"id": "ut_research_xyz", "tags": ["routing"]}, [_read()])
