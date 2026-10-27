"""The model a unit test's main thread runs on (issue #3870).

An agent-keyed suite's main thread is the dispatcher, not the agent, so it runs the
CLI model however the agent's file pins its own. A `SKILL.md` suite's skill runs on
the main thread, so its `model:` wins.

`session_model_for` is imported inside each test that calls it: a module-level
import would fail collection on a tree without it, and the call-site test would
never get to show the defect it pins.
"""

import asyncio

from harness import orchestrator
from harness.auth import AuthConfig
from harness.loader import load_test
from harness.orchestrator import OrchestratorPaths, REPO_ROOT, _run_one_test_async
from harness.runlog import JudgeResult, SingleRun, ValidatorResult

WIKI_TEST_PATH = REPO_ROOT / "eval/tests/unit/search-wikipedia/simple-topic-lookup.json"
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


def test_an_agent_suite_runs_its_dispatcher_on_the_cli_model(monkeypatch, tmp_path):
    """search-wikipedia's agent file pins its own model; the session must not take it."""
    seen: list[str] = []

    async def fake_execute(*, model, **kwargs):
        seen.append(model)
        return _stub_run()

    monkeypatch.setattr(orchestrator, "_execute_single_run", fake_execute)
    asyncio.run(_run_one_test_async(
        spec=load_test(WIKI_TEST_PATH),
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        paths=OrchestratorPaths(runlogs_root=tmp_path),
        model=SENTINEL,
        judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-10-26_10-00-00",
    ))
    assert seen == [SENTINEL]


def _skill(skills_dir, name, frontmatter):
    path = skills_dir / name / "SKILL.md"
    path.parent.mkdir(parents=True)
    path.write_text(f"---\nname: {name}\n{frontmatter}---\n\nBody.\n", encoding="utf-8")


def test_a_skill_suite_takes_its_skill_model(tmp_path):
    from harness.orchestrator import session_model_for

    _skill(tmp_path, "some-skill", "model: claude-haiku-5-5\n")
    assert session_model_for("some-skill", tmp_path, SENTINEL) == "claude-haiku-5-5"


def test_a_skill_suite_with_no_model_line_takes_the_cli_model(tmp_path):
    from harness.orchestrator import session_model_for

    _skill(tmp_path, "some-skill", "")
    assert session_model_for("some-skill", tmp_path, SENTINEL) == SENTINEL


def test_a_name_with_no_skill_file_takes_the_cli_model(tmp_path):
    from harness.orchestrator import session_model_for

    agents = tmp_path / "agents"
    agents.mkdir()
    (agents / "some-agent.md").write_text(
        "---\nname: some-agent\nmodel: claude-haiku-5-5\n---\n\nBody.\n", encoding="utf-8"
    )
    assert session_model_for("some-agent", tmp_path, SENTINEL, agents_dir=agents) == SENTINEL


def test_a_test_only_skill_takes_the_skill_branch(monkeypatch, tmp_path):
    """`extraction-append` lives in `eval/skills/`, not the plugin, so it is a skill
    suite even with an empty plugin skills dir. Its file declares no model today, so
    the frontmatter is stubbed to show which branch ran; an agent name with the same
    stub still gets the CLI model."""
    from harness.orchestrator import session_model_for

    monkeypatch.setattr(orchestrator, "load_skill_frontmatter", lambda _: {"model": "from-skill"})
    assert session_model_for("extraction-append", tmp_path, SENTINEL) == "from-skill"
    assert session_model_for("search-wikipedia", tmp_path, SENTINEL) == SENTINEL
