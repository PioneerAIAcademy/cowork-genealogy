"""`_run_judge` grades the direct arm on the agent's own return.

`test_agent_returns.py` covers the capture helpers; this file covers the
selection in `_run_judge` that decides what text the judge sees. Without it,
inverting the `subagent_type == spec.skill` match, or dropping the fallback,
left every harness test green -- and this selection changes grading on every
direct-arm suite, not only search-wikipedia.
"""

from types import SimpleNamespace

import pytest

from harness import orchestrator
from harness.auth import AuthConfig
from harness.loader import load_test_from_dict
from harness.rubric import empty_rubric

AGENT_TEXT = "Saved the Wikipedia summary to `albert-einstein.md`."
DISPATCHER_TEXT = (
    "The subagent has completed the task. It looked up **Albert Einstein** on "
    "Wikipedia and saved the article summary to `albert-einstein.md`."
)
SPAWN = {
    "tool": "Agent",
    "args": {"subagent_type": "search-wikipedia", "prompt": "Look up Albert Einstein"},
}


def _spec(*, direct: bool):
    input_block = (
        {"delegation": "Look up Albert Einstein on Wikipedia", "scenario": None}
        if direct
        else {"user_message": "Look up Albert Einstein on Wikipedia", "scenario": None}
    )
    return load_test_from_dict({
        "test": {
            "id": "ut_direct_judge_text_001",
            "skill": "search-wikipedia",
            "name": "x",
            "type": "positive",
            "description": "x",
            "tags": ["direct-arm"] if direct else [],
        },
        "input": input_block,
        "mcp_fixtures": [],
        "judge_context": [],
    })


def _judged_text(monkeypatch, spec, agent_returns):
    seen = {}

    def fake_grade(**kwargs):
        seen.update(kwargs)
        return "graded"

    monkeypatch.setattr(orchestrator, "grade", fake_grade)
    result = SimpleNamespace(
        text_response=DISPATCHER_TEXT,
        skills_invoked=[],
        tool_calls=[],
        builtin_tool_calls=[SPAWN],
        agent_returns=agent_returns,
    )
    assert orchestrator._run_judge(
        spec=spec,
        rubric=empty_rubric(spec.skill),
        scenario_readme="",
        result=result,
        file_changes=[],
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        judge_model="stub",
    ) == "graded"
    return seen["text_response"]


def test_direct_arm_grades_the_agent_return_not_the_dispatcher(monkeypatch):
    returns = [{"subagent_type": "search-wikipedia", "text": AGENT_TEXT}]
    assert _judged_text(monkeypatch, _spec(direct=True), returns) == AGENT_TEXT


def test_direct_arm_joins_every_return_from_the_agent_under_test(monkeypatch):
    returns = [
        {"subagent_type": "search-wikipedia", "text": "first"},
        {"subagent_type": "search-wikipedia", "text": "second"},
    ]
    assert _judged_text(monkeypatch, _spec(direct=True), returns) == "first\n\nsecond"


@pytest.mark.parametrize(
    "returns",
    [
        [],
        [{"subagent_type": "image-reader", "text": "a different agent's return"}],
        [{"subagent_type": "search-wikipedia", "text": ""}],
    ],
    ids=["no-returns", "other-agent-only", "empty-return"],
)
def test_direct_arm_falls_back_to_text_response(monkeypatch, returns):
    assert _judged_text(monkeypatch, _spec(direct=True), returns) == DISPATCHER_TEXT


def test_routed_arm_ignores_agent_returns(monkeypatch):
    """A routed test's reply is the subject's own, so a stray return must not
    replace it."""
    returns = [{"subagent_type": "search-wikipedia", "text": AGENT_TEXT}]
    assert _judged_text(monkeypatch, _spec(direct=False), returns) == DISPATCHER_TEXT
