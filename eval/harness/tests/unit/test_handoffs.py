"""Hand-off validators accept an agent spawn as well as a `Skill` call (issue #2825).

Under the 2026-09-22 ruling each skill becomes an agent, so a router's correct
hand-off to a converted callee is an `Agent` spawn. The four validators that
assert a hand-off read `handoffs`, not `skills_invoked` alone. Every validator
here is exercised in both directions: a spawn-only run must pass, and a run that
spawns the wrong agent, or hands off nowhere, must still fail.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from harness.loader import load_test_from_dict
from harness.orchestrator import _stub_agents
from harness.skill_runner import handoffs, spawn_stub_denial

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "eval" / "harness" / "validators"))


def _validators(name):
    path = REPO_ROOT / "eval" / "harness" / "validators" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_handoffs_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _skill(name, **extra):
    return {"tool": "Skill", "args": {"skill": name}, **extra}


def _spawn(name, **extra):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": "p"}, **extra}


# --- handoffs --------------------------------------------------------------


def test_handoffs_interleaves_skill_calls_and_spawns_in_call_order():
    calls = [_spawn("proof-conclusion"), {"tool": "Read", "args": {}}, _skill("question-selection")]
    assert handoffs(["question-selection"], calls) == ["proof-conclusion", "question-selection"]


def test_handoffs_drops_a_spawn_made_inside_a_subagent():
    calls = [_skill("research-plan"), _spawn("record-extractor", agent_id="a1")]
    assert handoffs(["research-plan"], calls) == ["research-plan"]


def test_handoffs_drops_a_spawn_with_no_subagent_type():
    calls = [{"tool": "Agent", "args": {"description": "d", "prompt": "p"}}]
    assert handoffs([], calls) == []


def test_handoffs_falls_back_to_skills_invoked_when_no_skill_record_exists():
    assert handoffs(["search-records"], []) == ["search-records"]
    assert handoffs(["search-records"], [_spawn("locality-guide")]) == ["search-records", "locality-guide"]


# --- test_routes_to_expected_skill (research routing suite) ------------------

ROUTE_TO_LOCALITY = {"skill": "research", "tags": ["routing", "routes-to:locality-guide"]}


def test_router_passes_when_its_only_hand_off_is_a_spawn():
    _validators("test_research").test_routes_to_expected_skill(
        [], [_spawn("locality-guide")], ROUTE_TO_LOCALITY
    )


def test_router_still_passes_on_a_skill_call():
    _validators("test_research").test_routes_to_expected_skill(
        ["locality-guide"], [_skill("locality-guide")], ROUTE_TO_LOCALITY
    )


@pytest.mark.parametrize(
    "skills,calls",
    [
        ([], []),
        ([], [_spawn("research-plan")]),
        (["locality-guide"], [_spawn("research-plan"), _skill("locality-guide")]),
        ([], [_spawn("locality-guide", agent_id="a1")]),
    ],
    ids=["no_hand_off", "wrong_agent", "wrong_agent_first", "nested_spawn_only"],
)
def test_router_fails_when_the_first_hand_off_is_not_the_expected_one(skills, calls):
    with pytest.raises(AssertionError):
        _validators("test_research").test_routes_to_expected_skill(skills, calls, ROUTE_TO_LOCALITY)


def test_router_stop_fails_on_a_spawn():
    stop = {"skill": "research", "tags": ["routing", "routes-to:stop"]}
    with pytest.raises(AssertionError):
        _validators("test_research").test_routes_to_expected_skill([], [_spawn("gps-mentor")], stop)


# --- the two callee hand-offs inside skills that stay skills -------------------

ESCALATE = {"tags": ["familysearch-exhausted"]}
OLD_STYLE = {"tags": ["convert-dates-handoff"]}


def test_escalation_passes_on_a_spawn_and_fails_without_one():
    mod = _validators("test_search_records")
    mod.test_escalates_to_external_sites_after_fs_exhaustion([], [_spawn("search-external-sites")], ESCALATE)
    with pytest.raises(AssertionError):
        mod.test_escalates_to_external_sites_after_fs_exhaustion([], [_spawn("search-records")], ESCALATE)


def test_live_callee_hand_off_passes_on_a_spawn_and_fails_without_one():
    mod = _validators("test_search_records")
    live = {"tags": ["live-callee"]}
    tools = [{"tool": "mcp__genealogy__external_links_search"}]
    mod.test_live_callee_used_its_own_tools(tools, [], [_spawn("search-external-sites")], live)
    with pytest.raises(AssertionError):
        mod.test_live_callee_used_its_own_tools(tools, [], [], live)


# --- the four other hand-off readers: Skill route, Agent route, wrong name ------

_TREE_BEFORE = {"tree_gedcomx_json": {"persons": [{"id": "I1"}]}}
_TREE_AFTER = {"tree_gedcomx_json": {"persons": [{"id": "I1"}, {"id": "I2"}]}}
ROUTES = {
    "skill": ([_skill("check-warnings")], True),
    "agent": ([_spawn("check-warnings")], True),
    "wrong_name": ([_spawn("conflict-resolution")], False),
}


@pytest.mark.parametrize("route", ROUTES, ids=list(ROUTES))
def test_tree_edit_check_warnings_after_a_write(route):
    calls, ok = ROUTES[route]
    skills = [c["args"]["skill"] for c in calls if c["tool"] == "Skill"]
    check = lambda: _validators("test_tree_edit").test_check_warnings_runs_after_any_tree_write(  # noqa: E731
        _TREE_BEFORE, _TREE_AFTER, skills, calls
    )
    if ok:
        check()
    else:
        with pytest.raises(AssertionError):
            check()


@pytest.mark.parametrize("route", ROUTES, ids=list(ROUTES))
def test_person_evidence_check_warnings_after_a_write(route):
    calls, ok = ROUTES[route]
    skills = [c["args"]["skill"] for c in calls if c["tool"] == "Skill"]
    before = {"research_json": {"person_evidence": []}, **_TREE_BEFORE}
    after = {"research_json": {"person_evidence": [{"id": "pe_001"}]}, **_TREE_BEFORE}
    check = lambda: _validators("test_person_evidence").test_check_warnings_runs_after_a_write(  # noqa: E731
        before, after, skills, [], {"tags": ["check-warnings-required"]}, calls
    )
    if ok:
        check()
    else:
        with pytest.raises(AssertionError):
            check()


@pytest.mark.parametrize(
    "skills,calls,ok",
    [
        ([], [], True),
        (["locality-guide"], [_skill("locality-guide")], False),
        ([], [_spawn("locality-guide")], False),
        ([], [_spawn("gps-mentor")], True),
    ],
    ids=["no_hand_off", "skill_route", "agent_route", "other_agent"],
)
def test_research_plan_never_reaches_locality_guide(skills, calls, ok):
    """Asserts a hand-off did NOT happen, so before issue #2825 a spawn of the
    converted callee passed it: it failed open."""
    check = lambda: _validators("test_research_plan").test_research_plan_no_out_of_lane_tools(  # noqa: E731
        [], [], skills, calls
    )
    if ok:
        check()
    else:
        with pytest.raises(AssertionError):
            check()


@pytest.mark.parametrize(
    "skills,calls,ok",
    [
        ([], [], False),
        (["research-plan"], [_skill("research-plan")], True),
        ([], [_spawn("research-plan")], True),
    ],
    ids=["no_hand_off", "skill_route", "agent_route"],
)
def test_a_run_that_only_handed_off_is_not_dead(skills, calls, ok):
    check = lambda: _validators("test_universal").test_activated_run_produces_response(  # noqa: E731
        True, None, 0, 0, "", {"skill": "research"}, skills, calls
    )
    if ok:
        check()
    else:
        with pytest.raises(AssertionError):
            check()


def _stub_spec(entries):
    return load_test_from_dict(
        {
            "test": {"id": "ut_handoffs_001", "skill": "research", "name": "h", "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "go", "scenario": None},
            "mcp_fixtures": [],
            "judge_context": [],
            "execution": {"stub_skills": entries},
        }
    )


# --- a stubbed callee converted to an agent is stubbed at its spawn ------------


def test_spawn_of_a_stubbed_agent_is_denied_and_continued():
    out = spawn_stub_denial("Agent", {"tool_input": {"subagent_type": "locality-guide"}}, {"locality-guide": None})
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "continue_" not in out


@pytest.mark.parametrize(
    "tool,data",
    [
        ("Agent", {"tool_input": {"subagent_type": "research-plan"}}),
        ("Agent", {"tool_input": {"subagent_type": "locality-guide"}, "agent_id": "a1"}),
        ("Skill", {"tool_input": {"skill": "locality-guide"}}),
        ("Agent", {"tool_input": {"description": "d"}}),
    ],
    ids=["other_agent", "nested_spawn", "skill_call", "general_purpose"],
)
def test_spawn_stub_leaves_everything_else_alone(tool, data):
    assert spawn_stub_denial(tool, data, {"locality-guide": None}) is None


def test_stub_agents_are_only_the_entries_with_no_skill_directory(tmp_path):
    (tmp_path / "search-records").mkdir()
    spec = _stub_spec(["search-records", {"skill": "locality-guide", "response": "r"}])
    assert _stub_agents(spec, tmp_path) == {"locality-guide": "r"}


def test_a_stub_that_is_still_a_skill_is_not_stubbed_at_its_spawn():
    """`route-shortcut-guard.json` stubs three paired names that ship as both a
    skill and an agent; their compliant spawn must keep running."""
    spec = _stub_spec(["proof-conclusion", "research-exhaustiveness", "person-evidence"])
    assert _stub_agents(spec, REPO_ROOT / "packages" / "engine" / "plugin" / "skills") is None


def test_old_style_date_passes_on_a_spawn_and_fails_without_one():
    mod = _validators("test_record_extraction")
    mod.test_old_style_date_routes_to_convert_dates([], [_spawn("convert-dates")], OLD_STYLE)
    with pytest.raises(AssertionError):
        mod.test_old_style_date_routes_to_convert_dates([], [_spawn("record-extractor")], OLD_STYLE)
