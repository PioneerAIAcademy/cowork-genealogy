"""T4.1: the hosted reasoning-effort settings, from the control plane to the Agent call.

Three operator settings, unset by default, reach a sandbox at create() and are applied in
two places: `build_options` passes ORCHESTRATOR_EFFORT as the session's `effort`, and the
PreToolUse hook writes the helper level onto each Agent/Task call's own `effort` (CLI
2.1.294+). Every arm is checked in both directions: the setting changes what it should,
and unset changes nothing."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app.agent import real_agent
from app.agent.continue_policy import foreground_rewrite

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in (*real_agent.EFFORT_ENV, "CLAUDE_CODE_EFFORT_LEVEL"):
        monkeypatch.delenv(name, raising=False)
    real_agent._effort_warned.clear()


def _hook(tool_input, tool_name="Agent"):
    import asyncio

    return asyncio.run(real_agent._pretool_hook(
        {"tool_name": tool_name, "tool_input": tool_input}, None, None))


# ── the levels and names everything keys on ─────────────────────────────────────────

def test_the_levels_are_the_sdks_and_the_settings():
    """An injected value outside the SDK's `EffortLevel` does not raise: the CLI DENIES the
    whole delegation (schema check on `updatedInput`). So the hook, the settings and the
    SDK must agree on the set."""
    from typing import get_args

    from claude_agent_sdk import EffortLevel

    from app.config import EffortSetting

    assert set(real_agent.EFFORT_LEVELS) == set(get_args(EffortLevel)) == set(get_args(EffortSetting))
    assert real_agent.HELPER_DEFAULT_EFFORT in real_agent.EFFORT_LEVELS


def test_the_plugin_prefix_is_read_from_the_manifest():
    doc = json.loads((REPO / "packages/engine/plugin/.claude-plugin/plugin.json")
                     .read_text(encoding="utf-8"))
    assert real_agent.PLUGIN_NAME == doc["name"]
    assert real_agent._plugin_name() == doc["name"]


# ── settings: refuse a bad value at control-plane start-up ──────────────────────────

def test_settings_default_unset_and_refuse_a_bad_level():
    from pydantic import ValidationError

    from app.config import Settings

    s = Settings()
    assert (s.orchestrator_effort, s.subagent_effort, s.subagent_effort_by_agent) == (None, None, {})
    with pytest.raises(ValidationError):
        Settings(orchestrator_effort="medum")
    with pytest.raises(ValidationError):
        Settings(subagent_effort_by_agent={"person-evidence": "loww"})


def test_the_map_parses_from_a_json_env_string(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("SUBAGENT_EFFORT_BY_AGENT", '{"person-evidence": "low"}')
    assert Settings().subagent_effort_by_agent == {"person-evidence": "low"}


# ── providers: set → passed, unset → absent ─────────────────────────────────────────

def _settings(**kw):
    from app.config import Settings

    return Settings(**kw)


def test_e2b_passes_the_settings_only_when_set(monkeypatch):
    from app.sandbox import e2b

    monkeypatch.setattr(e2b, "get_settings", lambda: _settings())
    env = e2b.E2BProvider._agent_env(None, "claude-sonnet-4-6")
    assert not set(real_agent.EFFORT_ENV) & set(env), env
    monkeypatch.setattr(e2b, "get_settings", lambda: _settings(
        orchestrator_effort="medium", subagent_effort="low",
        subagent_effort_by_agent={"person-evidence": "high"}))
    env = e2b.E2BProvider._agent_env(None, "claude-sonnet-4-6")
    assert env["ORCHESTRATOR_EFFORT"] == "medium"
    assert env["SUBAGENT_EFFORT"] == "low"
    assert json.loads(env["SUBAGENT_EFFORT_BY_AGENT"]) == {"person-evidence": "high"}


def test_local_passes_the_settings_and_never_leaks_the_hosts(monkeypatch, tmp_path):
    """LocalProvider spreads `**os.environ`, so a developer's own ORCHESTRATOR_EFFORT would
    otherwise reach the sandbox behind an unset setting."""
    from app.sandbox import local

    seen = {}

    class FakeProc:
        def poll(self):
            return None

    def fake_popen(argv, env=None, **_kw):
        seen.update(env)
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    unset = _settings()  # built before the host values exist, as a deploy's settings are
    for name in real_agent.EFFORT_ENV:
        monkeypatch.setenv(name, '{"a": "max"}' if name.endswith("_BY_AGENT") else "max")
    monkeypatch.setattr(local, "get_settings", lambda: unset)
    (tmp_path / "sb" / "s1").mkdir(parents=True)
    local.LocalProvider(tmp_path / "sb").ensure_server("s1", tmp_path, str(tmp_path / "h"), "m")
    assert not set(real_agent.EFFORT_ENV) & set(seen), "a host value leaked past an unset setting"

    seen.clear()
    for name in real_agent.EFFORT_ENV:
        monkeypatch.delenv(name)
    medium = _settings(orchestrator_effort="medium")
    monkeypatch.setattr(local, "get_settings", lambda: medium)
    (tmp_path / "sb2" / "s2").mkdir(parents=True)
    local.LocalProvider(tmp_path / "sb2").ensure_server("s2", tmp_path, str(tmp_path / "h"), "m")
    assert seen["ORCHESTRATOR_EFFORT"] == "medium"
    assert "SUBAGENT_EFFORT" not in seen and "SUBAGENT_EFFORT_BY_AGENT" not in seen


# ── build_options: the session effort ───────────────────────────────────────────────

def test_build_options_sets_effort_only_when_asked(monkeypatch, tmp_path, capsys):
    assert real_agent.build_options(tmp_path).effort is None
    monkeypatch.setenv("ORCHESTRATOR_EFFORT", "medium")
    assert real_agent.build_options(tmp_path).effort == "medium"
    assert "effort requested: orchestrator=medium subagents=pinned high" in capsys.readouterr().err


@pytest.mark.parametrize("level", ["low", "medium", "high", "xhigh", "max"])
def test_every_valid_level_is_accepted(monkeypatch, tmp_path, level):
    monkeypatch.setenv("ORCHESTRATOR_EFFORT", level)
    assert real_agent.build_options(tmp_path).effort == level


def test_a_bad_level_is_dropped_and_logged_not_raised(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("ORCHESTRATOR_EFFORT", "medum")
    assert real_agent.build_options(tmp_path).effort is None
    assert "ORCHESTRATOR_EFFORT='medum' is not one of" in capsys.readouterr().err


def test_the_cli_env_override_is_warned_about_not_used(monkeypatch, tmp_path, capsys):
    """CLAUDE_CODE_EFFORT_LEVEL outranks every pin and strips `effort` from the Agent tool,
    so it is never the channel -- and an inherited one is named in the log."""
    monkeypatch.setenv("ORCHESTRATOR_EFFORT", "medium")
    opts = real_agent.build_options(tmp_path)
    assert "CLAUDE_CODE_EFFORT_LEVEL" not in (opts.env or {})
    assert not capsys.readouterr().err.count("CLAUDE_CODE_EFFORT_LEVEL is set")
    monkeypatch.setenv("CLAUDE_CODE_EFFORT_LEVEL", "low")
    real_agent.build_options(tmp_path)
    assert "CLAUDE_CODE_EFFORT_LEVEL is set" in capsys.readouterr().err


def test_a_map_key_naming_no_agent_is_logged(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("SUBAGENT_EFFORT_BY_AGENT", '{"person-evidense": "low", "timeline": "low"}')
    real_agent.build_options(tmp_path)
    err = capsys.readouterr().err
    assert "SUBAGENT_EFFORT_BY_AGENT names no agent: person-evidense" in err
    assert "timeline" not in err.split("names no agent:")[1].splitlines()[0]


def test_staged_agents_stay_byte_identical_with_every_setting_on(monkeypatch, tmp_path):
    """The helper levels go on the Agent call, never into the agent files."""
    for name, value in (("ORCHESTRATOR_EFFORT", "medium"), ("SUBAGENT_EFFORT", "low"),
                        ("SUBAGENT_EFFORT_BY_AGENT", '{"person-evidence": "high"}')):
        monkeypatch.setenv(name, value)
    real_agent.build_options(tmp_path)
    src = sorted((Path(real_agent._PLUGIN_DIR) / "agents").glob("*.md"))
    assert src
    for f in src:
        assert (tmp_path / ".claude" / "agents" / f.name).read_bytes() == f.read_bytes(), f.name


# ── the hook: the per-spawn effort ──────────────────────────────────────────────────

def test_unset_leaves_the_hook_exactly_as_today():
    for shape in ({}, {"subagent_type": "person-evidence"}, {"run_in_background": False},
                  {"subagent_type": "x", "effort": "max"}):
        assert _hook(dict(shape)) == (foreground_rewrite("Agent", shape) or {}), shape


def test_a_subagent_level_is_injected_beside_the_foreground_rewrite(monkeypatch):
    monkeypatch.setenv("SUBAGENT_EFFORT", "low")
    out = _hook({"subagent_type": "person-evidence", "prompt": "go"})["hookSpecificOutput"]
    assert out["permissionDecision"] == "allow"
    assert out["updatedInput"] == {"subagent_type": "person-evidence", "prompt": "go",
                                   "run_in_background": False, "effort": "low"}


def test_the_namespaced_name_matches_the_bare_map_key(monkeypatch):
    monkeypatch.setenv("SUBAGENT_EFFORT_BY_AGENT", '{"person-evidence": "low"}')
    ns = f"{real_agent.PLUGIN_NAME}:person-evidence"
    assert _hook({"subagent_type": ns})["hookSpecificOutput"]["updatedInput"]["effort"] == "low"
    assert _hook({"subagent_type": "locality-guide"}) == foreground_rewrite("Agent", {"subagent_type": "locality-guide"})


def test_an_explicit_foreground_call_still_gets_its_effort(monkeypatch):
    """`foreground_rewrite` declines `run_in_background: False`; the effort arm builds its
    own allow there rather than skipping the call."""
    monkeypatch.setenv("SUBAGENT_EFFORT", "medium")
    out = _hook({"subagent_type": "a", "run_in_background": False})["hookSpecificOutput"]
    assert out["updatedInput"] == {"subagent_type": "a", "run_in_background": False, "effort": "medium"}


def test_the_map_outranks_the_flat_level_and_the_operator_outranks_the_model(monkeypatch):
    monkeypatch.setenv("SUBAGENT_EFFORT", "low")
    monkeypatch.setenv("SUBAGENT_EFFORT_BY_AGENT", '{"person-evidence": "high"}')
    assert real_agent.spawn_effort("Agent", {"subagent_type": "person-evidence"}) == "high"
    assert real_agent.spawn_effort("Task", {"subagent_type": "timeline"}) == "low"
    out = _hook({"subagent_type": "timeline", "effort": "max"})
    assert out["hookSpecificOutput"]["updatedInput"]["effort"] == "low"


def test_orchestrator_alone_pins_helpers_to_their_default(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_EFFORT", "medium")
    out = _hook({"subagent_type": "question-selection"})
    assert out["hookSpecificOutput"]["updatedInput"]["effort"] == real_agent.HELPER_DEFAULT_EFFORT


def test_the_hook_reads_the_setting_at_call_time_not_import(monkeypatch):
    """Set AFTER `real_agent` was imported (it was, at the top of this file): a value
    cached at import would leave every probe arm reading 'unset'."""
    assert real_agent.spawn_effort("Agent", {"subagent_type": "a"}) is None
    monkeypatch.setenv("SUBAGENT_EFFORT", "low")
    assert real_agent.spawn_effort("Agent", {"subagent_type": "a"}) == "low"


def test_every_level_the_hook_can_inject_is_an_sdk_level(monkeypatch):
    from typing import get_args

    from claude_agent_sdk import EffortLevel

    for lvl in (*real_agent.EFFORT_LEVELS, "medum", "", "HIGH"):
        monkeypatch.setenv("SUBAGENT_EFFORT", lvl)
        out = real_agent.spawn_effort("Agent", {"subagent_type": "a"})
        assert out is None or out in get_args(EffortLevel), (lvl, out)


def test_non_delegations_and_odd_inputs_are_left_alone(monkeypatch):
    monkeypatch.setenv("SUBAGENT_EFFORT", "low")
    assert real_agent.spawn_effort("Bash", {"command": "ls"}) is None
    assert real_agent.spawn_effort("Agent", None) == "low"
    assert real_agent.spawn_effort("Agent", "not-a-dict") == "low"
    monkeypatch.setenv("SUBAGENT_EFFORT_BY_AGENT", "[1, 2]")
    assert real_agent.spawn_effort("Agent", {"subagent_type": "a"}) == "low"


# ── the per-turn record ─────────────────────────────────────────────────────────────

def test_the_turn_summary_lists_each_thread_once_and_counts_spawns(monkeypatch):
    monkeypatch.setenv("SUBAGENT_EFFORT_BY_AGENT", '{"question-selection": "low"}')
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
        "(spawns with effort: 1 injected, 1 model-chosen)")


def test_a_turn_with_no_effort_seen_writes_no_line():
    assert real_agent.effort_turn_summary({}) is None
    assert real_agent.effort_turn_summary(None) is None
    counter: dict = {}
    real_agent.note_effort(counter, {"tool_name": "Read"})
    assert real_agent.effort_turn_summary(counter) is None
