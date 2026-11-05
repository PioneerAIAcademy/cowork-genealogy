"""Both harnesses run the main thread on main-thread.json's model and effort, through the
session's `--model` / `--effort`, the same channel the hosted planes use."""
import inspect
import json

import pytest

from harness import auth, skill_runner
from harness.main_thread import EFFORT_LEVELS, MAIN_THREAD, PLUGIN_DIR, load_main_thread


def test_the_levels_are_the_sdks():
    from typing import get_args

    from claude_agent_sdk import EffortLevel

    assert EFFORT_LEVELS == tuple(get_args(EffortLevel))


def test_the_harness_reads_the_shipped_file():
    doc = json.loads((PLUGIN_DIR / "main-thread.json").read_text(encoding="utf-8"))
    assert (MAIN_THREAD.model, MAIN_THREAD.effort) == (doc["model"], doc["effort"])


@pytest.mark.parametrize("doc", [
    {"model": "claude-sonnet-4-6", "effort": "medum"},
    {"model": " ", "effort": "medium"},
    {"effort": "medium"},
    ["claude-sonnet-4-6", "medium"],
])
def test_a_malformed_file_raises(tmp_path, doc):
    (tmp_path / "main-thread.json").write_text(json.dumps(doc), encoding="utf-8")
    with pytest.raises(ValueError):
        load_main_thread(tmp_path)


def test_the_unit_harness_defaults_come_from_the_file():
    params = inspect.signature(skill_runner.run_skill).parameters
    assert params["model"].default == MAIN_THREAD.model
    assert params["effort"].default == MAIN_THREAD.effort


def test_the_e2e_harness_defaults_come_from_the_file():
    from e2e import orchestrator

    for fn in (orchestrator.run_e2e_test, orchestrator._run_agent, orchestrator.run_single_ask_turn):
        params = inspect.signature(fn).parameters
        level = params.get("effort_level") or params.get("effort")
        assert level is not None and level.default is None, (fn.__name__, "None means the file's level")
    source = inspect.getsource(orchestrator._run_agent)
    assert "model=agent_model or MAIN_THREAD.model" in source
    assert "effort=effort or MAIN_THREAD.effort" in source


def test_an_inherited_effort_override_refuses_the_run(monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_EFFORT_LEVEL", "high")
    with pytest.raises(ValueError, match="CLAUDE_CODE_EFFORT_LEVEL"):
        auth.env_for_sdk(auth.AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"))
    monkeypatch.delenv("CLAUDE_CODE_EFFORT_LEVEL")
    assert "CLAUDE_CODE_EFFORT_LEVEL" not in auth.env_for_sdk(
        auth.AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"))
