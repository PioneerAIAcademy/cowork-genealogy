"""The judge's skills slot on a skill test names the agents the skill spawned.

`_run_judge` used to hand the judge `skills_invoked` alone, which holds `Skill`
calls only, so a judge_context asking whether the skill delegated to an agent
was graded on a call the judge never saw: `ut_init_project_q7b` lost
Correctness and Completeness for "no Agent call with subagent_type
check-warnings" on init-project runs that made exactly that call.
"""

from types import SimpleNamespace

from harness import orchestrator
from harness.auth import AuthConfig
from harness.loader import load_test_from_dict
from harness.rubric import empty_rubric
from harness.skill_runner import judge_skills_slot


def _skill(name, **extra):
    return {"tool": "Skill", "args": {"skill": name}, **extra}


def _spawn(name, **extra):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": "x"}, **extra}


def test_a_spawn_is_inserted_in_call_order_and_marked():
    calls = [_skill("init-project"), _spawn("check-warnings"), _skill("question-selection")]
    assert judge_skills_slot(["init-project", "question-selection"], calls) == [
        "init-project",
        "check-warnings (agent)",
        "question-selection",
    ]


def test_a_run_with_no_spawn_keeps_skills_invoked_unchanged():
    calls = [_skill("init-project"), {"tool": "Glob", "args": {"pattern": "x"}}]
    assert judge_skills_slot(["init-project"], calls) == ["init-project"]


def test_a_skill_called_inside_a_subagent_is_kept_in_its_place():
    calls = [
        _spawn("general-purpose"),
        _skill("search-full-text", agent_id="a1"),
        _spawn("record-extractor"),
    ]
    assert judge_skills_slot(["search-full-text"], calls) == [
        "general-purpose (agent)",
        "search-full-text",
        "record-extractor (agent)",
    ]


def test_a_skill_with_no_matching_record_is_kept_at_the_end():
    calls = [_skill("init-project"), _spawn("check-warnings")]
    assert judge_skills_slot(["init-project", "question-selection"], calls) == [
        "init-project",
        "check-warnings (agent)",
        "question-selection",
    ]


def test_a_spawn_made_inside_a_subagent_is_not_listed():
    calls = [
        _skill("record-extraction"),
        _spawn("record-extractor"),
        _spawn("image-reader", agent_id="a1"),
    ]
    assert judge_skills_slot(["record-extraction"], calls) == [
        "record-extraction",
        "record-extractor (agent)",
    ]


def test_a_spawn_with_no_subagent_type_is_not_listed():
    calls = [_skill("research-plan"), {"tool": "Agent", "args": {"description": "d", "prompt": "p"}}]
    assert judge_skills_slot(["research-plan"], calls) == ["research-plan"]


def test_with_no_skill_record_the_skills_come_first_then_the_spawns():
    assert judge_skills_slot(["search-records"], [_spawn("search-images")]) == [
        "search-records",
        "search-images (agent)",
    ]


def _spec(*, direct: bool):
    skill = "search-wikipedia" if direct else "init-project"
    input_block = (
        {"delegation": "Look up Albert Einstein on Wikipedia", "scenario": None}
        if direct
        else {"user_message": "Start a project for Thomas Doyle", "scenario": None}
    )
    return load_test_from_dict({
        "test": {
            "id": "ut_judge_skills_slot_001",
            "skill": skill,
            "name": "x",
            "type": "positive",
            "description": "x",
            "tags": ["direct-arm"] if direct else [],
        },
        "input": input_block,
        "mcp_fixtures": [],
        "judge_context": [],
    })


def _judged_slot(monkeypatch, spec, result):
    seen = {}

    def fake_grade(**kwargs):
        seen.update(kwargs)
        return "graded"

    monkeypatch.setattr(orchestrator, "grade", fake_grade)
    assert orchestrator._run_judge(
        spec=spec,
        rubric=empty_rubric(spec.skill),
        scenario_readme="",
        result=result,
        file_changes=[],
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        judge_model="stub",
    ) == "graded"
    return seen["skills_invoked"]


def test_skill_path_judge_sees_the_agent_the_skill_spawned(monkeypatch):
    result = SimpleNamespace(
        text_response="Project created.",
        skills_invoked=["init-project", "question-selection"],
        tool_calls=[],
        builtin_tool_calls=[
            _skill("init-project"),
            _spawn("check-warnings"),
            _skill("question-selection"),
        ],
        agent_returns=[],
    )
    assert _judged_slot(monkeypatch, _spec(direct=False), result) == [
        "init-project",
        "check-warnings (agent)",
        "question-selection",
    ]
    assert result.skills_invoked == ["init-project", "question-selection"]


def test_direct_arm_slot_is_still_the_spawned_agent_alone(monkeypatch):
    result = SimpleNamespace(
        text_response="relay",
        skills_invoked=[],
        tool_calls=[],
        builtin_tool_calls=[_spawn("search-wikipedia")],
        agent_returns=[{"subagent_type": "search-wikipedia", "text": "Saved."}],
    )
    assert _judged_slot(monkeypatch, _spec(direct=True), result) == [
        "search-wikipedia (agent, spawned directly — no skill was invoked)",
    ]


def test_slash_entry_keeps_call_order():
    """A slash entry has no `Skill` call of its own (issue #3116).

    `skills_invoked` is walked positionally against the `Skill` calls, so an
    entry with no matching call would never match, stall the walk, and dump the
    whole list after the spawns -- destroying the call order this function
    exists to preserve, and only on slash-entry tests, which are exactly the
    ones #3116 makes gradable. Fix per chesworthrm, 2026-10-05.
    """
    calls = [
        {"tool": "Skill", "args": {"skill": "question-selection"}},
        {"tool": "Task", "args": {"subagent_type": "gps-mentor"}},
        {"tool": "Skill", "args": {"skill": "research-plan"}},
    ]
    assert judge_skills_slot(
        ["research", "question-selection", "research-plan"], calls
    ) == ["research", "question-selection", "gps-mentor (agent)", "research-plan"]


def test_without_a_slash_entry_the_walk_is_unchanged():
    """The other direction: the fix must not reorder an ordinary run."""
    calls = [
        {"tool": "Skill", "args": {"skill": "question-selection"}},
        {"tool": "Task", "args": {"subagent_type": "gps-mentor"}},
        {"tool": "Skill", "args": {"skill": "research-plan"}},
    ]
    assert judge_skills_slot(["question-selection", "research-plan"], calls) == [
        "question-selection",
        "gps-mentor (agent)",
        "research-plan",
    ]
