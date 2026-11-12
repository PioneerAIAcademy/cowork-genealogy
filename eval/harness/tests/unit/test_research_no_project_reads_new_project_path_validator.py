"""Tests for `test_research.test_no_project_reads_new_project_path` (tag
``reads-new-project-path``).

Issue #4246. Replays synthetic call logs through the validator: green when the
router reads project state only at the hosted listing's ``newProjectPath``, red
when it reads the working folder instead, reads it as well (the shape of
``ut_research_hsp`` in ``v46.json``), reads nothing, or hands off with a listed
project's path. Committed run logs do not keep a fixture-served ``project_list``
response, so each log carries the one from ``project-list-hosted-empty``.
`testpaths` excludes `validators/`, which is why this lives here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
_REPO = _HARNESS.parents[1]
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research import test_no_project_reads_new_project_path as reads_new_path  # noqa: E402

_FIXTURE = _REPO / "eval" / "fixtures" / "mcp" / "project-list-hosted-empty.json"
_TEST_FILE = _REPO / "eval" / "tests" / "unit" / "research" / "route-hosted-no-project-no-objective.json"
_WORKING_FOLDER = "/tmp/eval-ut_research_hts-0-0-abcdefgh"
_LISTED_PATH = "/proj_3f9a1c2e7b4d6a80"


def _listing() -> dict:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))["response"]


def _test() -> dict:
    return json.loads(_TEST_FILE.read_text(encoding="utf-8"))["test"]


def _new_path() -> str:
    return _listing()["newProjectPath"]


def _tool_calls(*read_paths: str, listing: dict | None = None, prefix: str = "mcp__genealogy__") -> list[dict]:
    calls = [{"tool": f"{prefix}project_list", "args": {}, "response": listing or _listing()}]
    calls += [{"tool": f"{prefix}project_context", "args": {"projectPath": p}} for p in read_paths]
    return calls


def _handoff(prompt: str = "Survey the researcher's FamilySearch tree.") -> list[dict]:
    return [{"tool": "Agent", "args": {"subagent_type": "tree-survey", "prompt": prompt}}]


def test_the_hosted_test_carries_the_tag_and_the_empty_listing():
    doc = json.loads(_TEST_FILE.read_text(encoding="utf-8"))
    assert "reads-new-project-path" in doc["test"]["tags"]
    assert "uses-new-project-path" not in doc["test"]["tags"]
    assert doc["mcp_fixtures"] == ["project-list-hosted-empty"]


def test_passes_when_project_context_reads_only_new_project_path():
    reads_new_path(_test(), _tool_calls(_new_path()), _handoff())


def test_passes_under_the_bridged_tool_spelling():
    calls = _tool_calls(_new_path(), prefix="mcp__remote-devices__Genealogy_Research__")
    reads_new_path(_test(), calls, _handoff())


def test_fails_when_the_working_folder_is_read_instead():
    with pytest.raises(AssertionError, match="never called with newProjectPath"):
        reads_new_path(_test(), _tool_calls(_WORKING_FOLDER), _handoff())


def test_fails_when_the_working_folder_is_read_before_new_project_path():
    with pytest.raises(AssertionError, match="at a path other than newProjectPath"):
        reads_new_path(_test(), _tool_calls(_WORKING_FOLDER, _new_path()), _handoff())


def test_fails_when_project_context_is_never_called():
    with pytest.raises(AssertionError, match="never called with newProjectPath"):
        reads_new_path(_test(), _tool_calls(), _handoff())


def test_fails_when_the_handoff_names_a_listed_project():
    listing = dict(_listing(), projects=[{"projectPath": _LISTED_PATH}])
    calls = _tool_calls(_new_path(), listing=listing)
    with pytest.raises(AssertionError, match="names a listed project's path"):
        reads_new_path(_test(), calls, _handoff(f"Survey the tree for {_LISTED_PATH}."))


def test_fails_when_there_is_no_hosted_listing():
    calls = [{"tool": "mcp__genealogy__project_context", "args": {"projectPath": _new_path()}}]
    with pytest.raises(AssertionError, match="never received a hosted project_list answer"):
        reads_new_path(_test(), calls, _handoff())


def test_skips_without_the_tag():
    test = dict(_test(), tags=["routing", "routes-to:tree-survey"])
    with pytest.raises(pytest.skip.Exception):
        reads_new_path(test, _tool_calls(_WORKING_FOLDER), _handoff())
