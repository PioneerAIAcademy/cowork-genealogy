"""Hand-off validators accept an agent spawn as well as a `Skill` call (issue #2825).

Under the 2026-09-22 ruling each skill becomes an agent, so a router's correct
hand-off to a converted callee is an `Agent` spawn. The four validators that
assert a hand-off read `handoffs`, not `skills_invoked` alone. Every validator
here is exercised in both directions: a spawn-only run must pass, and a run that
spawns the wrong agent, or hands off nowhere, must still fail.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from harness.loader import load_test_from_dict
from harness.orchestrator import _stub_agents
from harness.skill_runner import default_spawn_denial, handoffs, spawn_stub_denial

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


def _return(text: str) -> list[dict]:
    return [{"subagent_type": "search-records", "text": text}]


def test_escalation_passes_on_a_named_hand_back_and_fails_without_one():
    # search-records is an agent (issue #2243) and cannot spawn: the escalation is a
    # hand-back it names in its own return, so the validator reads that text.
    mod = _validators("test_search_records")
    named = _return("FamilySearch variants exhausted; hand back to `search-external-sites` with: Patrick Flynn, pli_001.")
    mod.test_escalates_to_external_sites_after_fs_exhaustion(named, "", ESCALATE)
    mod.test_escalates_to_external_sites_after_fs_exhaustion([], "Hand-back: search-external-sites", ESCALATE)
    # An offer in prose names the site, not the agent, and is not an escalation.
    with pytest.raises(AssertionError):
        mod.test_escalates_to_external_sites_after_fs_exhaustion(
            _return("FamilySearch is exhausted. Shall I check Ancestry?"), "", ESCALATE
        )
    # Naming the agent far from a hand-back is not one either.
    with pytest.raises(AssertionError):
        mod.test_escalates_to_external_sites_after_fs_exhaustion(
            _return("search-external-sites exists.\n\nNothing else."), "", ESCALATE
        )
    # Only the exhaustion test asserts this.
    with pytest.raises(pytest.skip.Exception):
        mod.test_escalates_to_external_sites_after_fs_exhaustion([], "", {"tags": []})


NO_SOLE = {"tags": ["no-sole-repository-claim"], "delegation": "Find every Tallman family."}


@pytest.mark.parametrize("text", [
    "| **NY State 1825, 1835, 1845** | **Not on FamilySearch** (held at NY State Library only) |",
    "The 1835 census is only available at the NYSL.",
    "Status: in_progress\n---\nThese early state censuses are not available elsewhere.",
    "The 1845 returns are held exclusively at the State Library.",
    "The 1825 schedules are held only at the New York State Library.",
    "They are available only at the NYSL.",
    "These are only at the NY State Library.",
    "The surviving schedules exist only by the State Library's microfilm.",
    "Not on FamilySearch (NY State Library only)",
    "The NYSL is the sole repository for these years.",
    "No other repository holds them.",
    "They are not available anywhere else.",
])
def test_sole_repository_claim_fails(text):
    with pytest.raises(AssertionError):
        _validators("test_search_records").test_no_sole_repository_claim(_return(text), "", NO_SOLE)


@pytest.mark.parametrize("text", [
    "1825, 1835, 1845: not on FamilySearch.\nHand-back: search-external-sites — NY state census, Clinton and Essex Counties, 1825/1835/1845; FamilySearch holds no collection for these years",
    "The wiki lists the 1892 census on Ancestry and FamilySearch.",
    "Only 1855-1875 are indexed on FamilySearch; the New York State Library holds a county list.",
    "The originals are held at the New York State Library, and only 1855 onward is on FamilySearch.",
    "Originals held at the NYSL; only county lists survive.",
    "Hiram Tallman was found only in the 1849 directory.",
    "| Essex | Keeseville directory (Clinton only) |",
])
def test_sole_repository_claim_passes_a_legitimate_return(text):
    _validators("test_search_records").test_no_sole_repository_claim(_return(text), "", NO_SOLE)


def test_sole_repository_claim_grades_the_agent_not_the_relay():
    # A direct test grades the agent's own return; the dispatcher's relay is not it.
    _validators("test_search_records").test_no_sole_repository_claim(
        _return("Not on FamilySearch."), "held at NY State Library only", NO_SOLE
    )


def test_sole_repository_claim_is_tag_gated():
    with pytest.raises(pytest.skip.Exception):
        _validators("test_search_records").test_no_sole_repository_claim(
            _return("held at NY State Library only"), "", {"tags": []}
        )


def test_no_collection_hand_back_needs_a_search_first():
    mod = _validators("test_search_records")
    mod.test_searched_before_no_collection_hand_back(
        [{"tool": "mcp__genealogy__record_search", "args": {"surname": "Tallman"}}], NO_SOLE
    )
    with pytest.raises(AssertionError):
        mod.test_searched_before_no_collection_hand_back(
            [{"tool": "mcp__genealogy__wiki_read", "args": {"url": "New_York_Census"}}], NO_SOLE
        )
    with pytest.raises(pytest.skip.Exception):
        mod.test_searched_before_no_collection_hand_back([], {"tags": []})


# --- Warning gate (issue #2840): replaced check-warnings hand-off tests --------
# The engine gate now refuses unjustified warnings at write time, so the
# validators no longer check for check-warnings hand-offs. No eval validator
# asserts the gate at all — the engine enforces it and PR 1's tests prove it
# (`guardrail-enforcement-spec.md`, "No eval validator asserts this gate").
# What remains is the shadow detector, tested in test_skill_invocation.py.


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


def test_a_stub_that_is_still_a_skill_is_denied_at_its_spawn_by_the_default(tmp_path):
    """A paired name that ships as both a skill and an agent is not in
    `_stub_agents` — the skill directory makes it return None — but its spawn
    is still denied, by `default_spawn_denial` (#3568), and with the entry's
    canned text. It cannot be opted in either: runnability refuses a name in
    both `run_agents` and `stub_skills`.

    After issue #2738 deleted `research-exhaustiveness`'s skill directory, no
    paired names remain in the shipped plugin.  This test uses `tmp_path` to
    create a synthetic skill directory instead.  `route-shortcut-guard.json`
    supplied the real paired name until then, and now ends at its first stubbed
    hand-off anyway: `stop_at_stub`.
    """
    (tmp_path / "fake-paired-skill").mkdir()
    spec = _stub_spec([{"skill": "fake-paired-skill", "response": "canned"}])
    assert _stub_agents(spec, tmp_path) is None
    spawn = {"tool_input": {"subagent_type": "fake-paired-skill"}}
    assert spawn_stub_denial("Agent", spawn, {}) is None
    denial = default_spawn_denial("Agent", spawn, {"research"}, {"fake-paired-skill": "canned"})
    assert denial is not None
    assert "canned" in json.dumps(denial)


def test_a_stub_with_no_skill_directory_is_stubbed_at_its_spawn():
    """The other direction, on the real plugin tree: an agent-only callee in the
    same fixture IS denied at its spawn, which is what issue #2825 buys."""
    spec = _stub_spec(["proof-conclusion", "gps-mentor", "person-evidence", "research-exhaustiveness"])
    assert _stub_agents(spec, REPO_ROOT / "packages" / "engine" / "plugin" / "skills") == {
        "proof-conclusion": None,
        "gps-mentor": None,
        "person-evidence": None,
        "research-exhaustiveness": None,
    }
