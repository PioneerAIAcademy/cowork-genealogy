"""The model a unit test's main thread runs on (issue #3870).

Every suite's main thread runs the model the harness is given, which defaults to
main-thread.json's (`harness.main_thread`). An agent-keyed suite's agent runs as a
subagent on its own `model:` and `effort:`, which the CLI applies. A skill cannot set
a model, so a `SKILL.md` suite's main thread takes the same model as any other.
"""

import asyncio

import pytest

from harness import orchestrator
from harness.auth import AuthConfig
from harness.loader import load_test
from harness.orchestrator import OrchestratorPaths, REPO_ROOT, _run_one_test_async
from harness.runlog import JudgeResult, SingleRun, ValidatorResult

WIKI_TEST_PATH = REPO_ROOT / "eval/tests/unit/search-wikipedia/simple-topic-lookup.json"
RESEARCH_TEST_PATH = REPO_ROOT / "eval/tests/unit/research/attached-before-searching.json"
SENTINEL = "cli-model-sentinel"


def _stub_run() -> SingleRun:
    return SingleRun(
        outcome="pass",
        aborted_reason=None,
        duration_ms=1.0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={},
        validators=ValidatorResult(passed=True, results=[]),
        judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0),
    )


@pytest.mark.parametrize("test_path", [WIKI_TEST_PATH, RESEARCH_TEST_PATH], ids=["agent-suite", "skill-suite"])
def test_the_main_thread_runs_the_model_it_is_given(monkeypatch, tmp_path, test_path):
    """search-wikipedia's agent file pins its own model, and the session must not take
    it; the research skill's suite takes the given model too."""
    seen: list[str] = []

    async def fake_execute(*, model, **kwargs):
        seen.append(model)
        return _stub_run()

    monkeypatch.setattr(orchestrator, "_execute_single_run", fake_execute)
    asyncio.run(_run_one_test_async(
        spec=load_test(test_path),
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        paths=OrchestratorPaths(runlogs_root=tmp_path),
        model=SENTINEL,
        judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-10-26_10-00-00",
    ))
    assert seen == [SENTINEL]
