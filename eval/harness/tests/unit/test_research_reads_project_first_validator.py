"""Tests for `test_research.test_no_init_project_on_existing_project` (ungated) and
`test_research.test_reads_project_state_before_routing` (tag ``reads-project-first``).

Issue #3766. Replays committed research run logs through both validators: red on
the transcripts that motivated them, green on a released run. Only released
``v{N}.json`` logs are read, because the harness prunes candidates after five newer
ones land. The PR #3727 transcript never reached main, so its two entries are
committed, trimmed, under ``tests/fixtures/reads_project_first/``. `testpaths`
excludes `validators/`, which is why these live here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
_REPO = _HARNESS.parents[1]
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research import (  # noqa: E402
    test_no_init_project_on_existing_project as no_init_project,
    test_reads_project_state_before_routing as reads_project,
)

_RUNLOGS = _REPO / "eval" / "runlogs" / "unit" / "research"
_PR3727_V32 = _HARNESS / "tests" / "fixtures" / "reads_project_first" / "pr3727_v32.json"
_TAG = "reads-project-first"


def _tests_by_id() -> dict[str, dict]:
    out = {}
    for path in (_REPO / "eval" / "tests" / "unit" / "research").glob("*.json"):
        test = json.loads(path.read_text(encoding="utf-8"))["test"]
        out[test["id"]] = test
    return out


def _research(scenario: str | None) -> dict | None:
    path = _REPO / "eval" / "fixtures" / "scenarios" / str(scenario) / "research.json"
    if not scenario or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _replay(log: Path) -> dict[str, dict[str, str]]:
    """``{check: {test_id: "pass" | "fail" | "skip"}}`` over run 0 of each test,
    with each test's tags as they are in this checkout."""
    tests = _tests_by_id()
    out: dict[str, dict[str, str]] = {"no_init": {}, "reads": {}}
    for entry in json.loads(log.read_text(encoding="utf-8"))["tests"]:
        test_id = entry["test_id"]
        test = tests.get(test_id, {"id": test_id, "tags": []})
        before = {"research_json": _research(entry.get("scenario"))}
        output = entry["runs"][0]["output"]
        checks = {
            "no_init": lambda: no_init_project(
                before, output.get("skills_invoked") or [], output.get("builtin_tool_calls") or []
            ),
            "reads": lambda: reads_project(before, output.get("tool_calls") or [], test),
        }
        for name, check in checks.items():
            try:
                check()
                out[name][test_id] = "pass"
            except pytest.skip.Exception:
                out[name][test_id] = "skip"
            except AssertionError:
                out[name][test_id] = "fail"
    return out


def _failing(results: dict[str, str]) -> set[str]:
    return {test_id for test_id, verdict in results.items() if verdict == "fail"}


def test_the_tag_is_on_001_and_004_neither_of_which_runs_agents():
    # A subagent's project_context call would hide the router's omission.
    for path in ("research-objective.json", "investigate-person.json"):
        doc = json.loads((_REPO / "eval" / "tests" / "unit" / "research" / path).read_text(encoding="utf-8"))
        assert _TAG in doc["test"]["tags"], path
        assert not (doc.get("execution") or {}).get("run_agents"), path


def test_pr3727_v32_is_red_on_both_checks():
    results = _replay(_PR3727_V32)
    assert _failing(results["no_init"]) == {"ut_research_001"}
    assert _failing(results["reads"]) == {"ut_research_001", "ut_research_004"}


def test_main_v32_is_red_on_the_hand_off_check_only():
    # Both tests read the project, but only after spawning init-project.
    results = _replay(_RUNLOGS / "v32.json")
    assert _failing(results["no_init"]) == {"ut_research_001", "ut_research_004"}
    assert _failing(results["reads"]) == set()
    assert results["reads"]["ut_research_001"] == results["reads"]["ut_research_004"] == "pass"


def test_v35_is_green_on_every_test():
    results = _replay(_RUNLOGS / "v35.json")
    assert len(results["no_init"]) >= 40
    assert _failing(results["no_init"]) == set()
    assert _failing(results["reads"]) == set()
    assert {t for t, v in results["reads"].items() if v == "pass"} == {"ut_research_001", "ut_research_004"}
    # Ungated, the hand-off check runs on every test that has a project.
    assert sum(v == "pass" for v in results["no_init"].values()) >= 25


_PROJECT = {"research_json": {"project": {}}}
_NO_PROJECT = {"research_json": None}
_TAGGED = {"skill": "research", "tags": [_TAG]}


def _spawn(agent: str, agent_id: str | None = None) -> dict:
    record = {"tool": "Agent", "args": {"subagent_type": agent}}
    if agent_id:
        record["agent_id"] = agent_id
    return record


@pytest.mark.parametrize(
    ("skills_invoked", "calls"),
    [
        (["research"], [_spawn("init-project")]),
        (["research"], [_spawn("question-selection"), _spawn("init-project")]),
        (["research"], [_spawn("tree-survey")]),
        (["research", "init-project"], []),
    ],
    ids=["spawned-first", "spawned-later", "tree-survey", "skill-call"],
)
def test_a_new_project_hand_off_on_an_existing_project_fails(skills_invoked, calls):
    with pytest.raises(AssertionError, match="start a new project"):
        no_init_project(_PROJECT, skills_invoked, calls)


def test_a_new_project_hand_off_is_allowed_with_no_project():
    with pytest.raises(pytest.skip.Exception):
        no_init_project(_NO_PROJECT, ["research"], [_spawn("init-project")])


def test_a_spawn_made_inside_a_subagent_is_not_the_routers():
    no_init_project(_PROJECT, ["research"], [_spawn("question-selection"), _spawn("init-project", agent_id="a1")])


@pytest.mark.parametrize(
    "tool",
    ["project_context", "mcp__genealogy__project_context", "mcp__remote-devices__Genealogy_Research__project_context"],
)
def test_any_spelling_of_project_context_satisfies_the_read(tool):
    reads_project(_PROJECT, [{"tool": "mcp__genealogy__research_query"}, {"tool": tool}], _TAGGED)


@pytest.mark.parametrize(
    "tool_calls",
    [[], None, [{"tool": "mcp__genealogy__research_query"}], [{"tool": "mcp__genealogy__project_list"}]],
    ids=["empty", "none", "other-read", "project-list-only"],
)
def test_no_project_context_call_fails(tool_calls):
    with pytest.raises(AssertionError, match="never called project_context"):
        reads_project(_PROJECT, tool_calls, _TAGGED)


def test_a_tagged_test_without_a_project_is_scenario_drift():
    with pytest.raises(AssertionError, match="Scenario drift"):
        reads_project(_NO_PROJECT, [], _TAGGED)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        reads_project(_PROJECT, [], {"skill": "research", "tags": ["routing"]})
