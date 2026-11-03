"""The main thread's model and effort come from the plugin's main-thread.json, and each
agent's from its own frontmatter. Nothing on the hosted planes sets either any other way:
no operator setting, no environment variable and no rewrite of an Agent call's `effort`."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.agent import real_agent
from app.agent.continue_policy import foreground_rewrite
from app.agent.main_thread import EFFORT_LEVELS, load_main_thread

REPO = Path(__file__).resolve().parents[3]
PLUGIN = REPO / "packages" / "engine" / "plugin"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_EFFORT_LEVEL", raising=False)


def _hook(tool_input, tool_name="Agent"):
    import asyncio

    return asyncio.run(real_agent._pretool_hook(
        {"tool_name": tool_name, "tool_input": tool_input}, None, None))


def _plugin_with(tmp_path, doc) -> Path:
    """A copy of the plugin whose main-thread.json is ``doc``."""
    dest = tmp_path / "plugin"
    shutil.copytree(PLUGIN, dest)
    (dest / "main-thread.json").write_text(json.dumps(doc), encoding="utf-8")
    return dest


# ── the file ────────────────────────────────────────────────────────────────────────

def test_the_levels_are_the_sdks():
    from typing import get_args

    from claude_agent_sdk import EffortLevel

    assert EFFORT_LEVELS == tuple(get_args(EffortLevel))


def test_the_shipped_file_names_a_priced_gateway_mapped_model_and_an_sdk_level():
    from app.agent.spend import MODEL_RATES
    from proto.worker.options import GATEWAY_AGENT_MODELS

    main = load_main_thread(PLUGIN)
    assert main.effort in EFFORT_LEVELS
    assert main.model in MODEL_RATES, "the spend cap would price the main thread at the default rate"
    assert main.model in GATEWAY_AGENT_MODELS, "the beta's gateway would get an id it cannot map"


@pytest.mark.parametrize("doc", [
    {"model": "claude-sonnet-4-6", "effort": "medum"},
    {"model": "", "effort": "medium"},
    {"effort": "medium"},
    {"model": "claude-sonnet-4-6"},
    ["claude-sonnet-4-6", "medium"],
])
def test_a_malformed_file_raises(tmp_path, doc):
    (tmp_path / "main-thread.json").write_text(json.dumps(doc), encoding="utf-8")
    with pytest.raises(ValueError):
        load_main_thread(tmp_path)


def test_a_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_main_thread(tmp_path)


# ── the alpha ───────────────────────────────────────────────────────────────────────

def test_build_options_runs_the_main_thread_from_the_file(monkeypatch, tmp_path, capsys):
    plugin = _plugin_with(tmp_path, {"model": "claude-haiku-5-5", "effort": "low"})
    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(plugin))
    project = tmp_path / "project"
    project.mkdir()
    opts = real_agent.build_options(project)
    assert (opts.model, opts.effort) == ("claude-haiku-5-5", "low")
    assert "main thread: claude-haiku-5-5 at effort low" in capsys.readouterr().err


def test_the_alpha_has_no_other_main_thread_setting(monkeypatch, tmp_path):
    from app.config import Settings

    fields = set(Settings.model_fields)
    assert not fields & {"default_model", "orchestrator_effort", "subagent_effort", "subagent_effort_by_agent"}
    monkeypatch.setenv("MODEL", "claude-opus-4-8")
    monkeypatch.setenv("ORCHESTRATOR_EFFORT", "max")
    opts = real_agent.build_options(tmp_path)
    main = load_main_thread(PLUGIN)
    assert (opts.model, opts.effort) == (main.model, main.effort), "an environment variable moved it"
    fly = (REPO / "deploy" / "fly.toml").read_text(encoding="utf-8")
    for key in ("DEFAULT_MODEL", "ORCHESTRATOR_EFFORT", "SUBAGENT_EFFORT"):
        assert f"\n  {key} =" not in fly, f"fly.toml still sets {key}"


def test_the_control_plane_image_carries_the_file():
    """The control plane records each project's model from the file (`sessions.create_project`)."""
    dockerfile = (REPO / "deploy" / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY packages/engine/plugin/main-thread.json /packages/engine/plugin/main-thread.json" in dockerfile


def test_the_cli_env_override_is_warned_about(monkeypatch, tmp_path, capsys):
    """CLAUDE_CODE_EFFORT_LEVEL outranks main-thread.json and every agent's own `effort:`."""
    opts = real_agent.build_options(tmp_path)
    assert "CLAUDE_CODE_EFFORT_LEVEL" not in (opts.env or {})
    assert "CLAUDE_CODE_EFFORT_LEVEL is set" not in capsys.readouterr().err
    monkeypatch.setenv("CLAUDE_CODE_EFFORT_LEVEL", "low")
    real_agent.build_options(tmp_path)
    assert "CLAUDE_CODE_EFFORT_LEVEL is set" in capsys.readouterr().err


def test_local_never_passes_the_hosts_effort_override(monkeypatch, tmp_path):
    """LocalProvider spreads `**os.environ`, so a developer's CLAUDE_CODE_EFFORT_LEVEL would
    otherwise reach the sandbox and outrank every level the files set."""
    from app.config import Settings
    from app.sandbox import local

    seen = {}

    class FakeProc:
        pid = 4242

        def poll(self):
            return None

    def fake_popen(argv, env=None, **_kw):
        seen.update(env)
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setenv("CLAUDE_CODE_EFFORT_LEVEL", "max")
    monkeypatch.setattr(local, "get_settings", lambda: Settings())
    (tmp_path / "sb" / "s1").mkdir(parents=True)
    local.LocalProvider(tmp_path / "sb").ensure_server("s1", tmp_path, str(tmp_path / "h"), "m")
    assert "CLAUDE_CODE_EFFORT_LEVEL" not in seen
    assert "MODEL" not in seen


def test_staged_agents_stay_byte_identical(tmp_path):
    """Each agent's level is its file's: staging copies the files unchanged."""
    real_agent.build_options(tmp_path)
    src = sorted((PLUGIN / "agents").glob("*.md"))
    assert src
    for f in src:
        assert (tmp_path / ".claude" / "agents" / f.name).read_bytes() == f.read_bytes(), f.name


def test_the_hook_never_writes_an_effort():
    """An Agent call keeps whatever `effort` it carries, and gains none."""
    for shape in ({}, {"subagent_type": "person-evidence"}, {"run_in_background": False},
                  {"subagent_type": "x", "effort": "max"}):
        assert _hook(dict(shape)) == (foreground_rewrite("Agent", shape) or {}), shape


# ── the per-turn record ─────────────────────────────────────────────────────────────

def test_the_turn_summary_lists_each_thread_once_and_counts_model_chosen_spawns():
    counter: dict = {}
    for data in (
        {"tool_name": "research_query", "effort": {"level": "medium"}},
        {"tool_name": "research_query", "effort": {"level": "medium"}},
        {"tool_name": "Agent", "effort": {"level": "medium"},
         "tool_input": {"subagent_type": "question-selection"}},
        {"tool_name": "Agent", "effort": "medium", "tool_input": {"subagent_type": "x", "effort": "max"}},
        {"tool_name": "research_query", "agent_id": "a1", "agent_type": "question-selection",
         "effort": {"level": "low"}},
        {"tool_name": "research_query", "effort": None},
        {"tool_name": "research_query", "effort": 7},
        "not-a-dict",
    ):
        real_agent.note_effort(counter, data)
    assert real_agent.effort_turn_summary(counter) == (
        "[agent] effort this turn: main=medium question-selection=low "
        "(spawns with a model-chosen effort: 1)")


def test_a_turn_with_no_effort_seen_writes_no_line():
    assert real_agent.effort_turn_summary({}) is None
    assert real_agent.effort_turn_summary(None) is None
    counter: dict = {}
    real_agent.note_effort(counter, {"tool_name": "Read"})
    assert real_agent.effort_turn_summary(counter) is None
