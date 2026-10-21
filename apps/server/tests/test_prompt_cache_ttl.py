"""The hosted 1-hour main-thread cache switch (`Settings.prompt_cache_ttl_main`).

Unset stamps nothing (an API key's 5-minute default); set, it reaches a NEW sandbox as
CLAUDE_CODE_PROMPT_CACHE_TTL, which CLI 2.1.294 applies to the main thread only. Checked in
both directions, on both providers, plus the CLI dependency the variable rests on."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
TTL_VARS = ("CLAUDE_CODE_PROMPT_CACHE_TTL", "CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL",
            "ENABLE_PROMPT_CACHING_1H")


@pytest.fixture(autouse=True)
def _no_inherited_switch(monkeypatch):
    monkeypatch.delenv("PROMPT_CACHE_TTL_MAIN", raising=False)
    for name in TTL_VARS:
        monkeypatch.delenv(name, raising=False)


def _settings(**kw):
    from app.config import Settings

    return Settings(**kw)


def test_unset_by_default_and_refuses_a_ttl_the_cli_does_not_take():
    from pydantic import ValidationError

    assert _settings().prompt_cache_ttl_main is None
    assert _settings(prompt_cache_ttl_main="1h").prompt_cache_ttl_main == "1h"
    with pytest.raises(ValidationError):
        _settings(prompt_cache_ttl_main="2h")


def test_an_operators_env_var_turns_it_on(monkeypatch):
    monkeypatch.setenv("PROMPT_CACHE_TTL_MAIN", "1h")
    assert _settings().prompt_cache_ttl_main == "1h"


@pytest.mark.parametrize("value", ["1h", "5m"])
def test_e2b_stamps_the_main_thread_ttl_only_when_set(monkeypatch, value):
    from app.sandbox import e2b

    monkeypatch.setattr(e2b, "get_settings", lambda: _settings())
    assert not set(TTL_VARS) & set(e2b.E2BProvider._agent_env(None, "m"))
    on = _settings(prompt_cache_ttl_main=value)
    monkeypatch.setattr(e2b, "get_settings", lambda: on)
    env = e2b.E2BProvider._agent_env(None, "m")
    assert env["CLAUDE_CODE_PROMPT_CACHE_TTL"] == value
    assert "CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL" not in env and "ENABLE_PROMPT_CACHING_1H" not in env


def _local_env(monkeypatch, tmp_path, settings) -> dict:
    from app.sandbox import local

    seen: dict = {}

    class FakeProc:
        pid = 4242
        def poll(self):
            return None

    def fake_popen(argv, env=None, **_kw):
        seen.update(env)
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(local, "get_settings", lambda: settings)
    (tmp_path / "sb" / "s").mkdir(parents=True)
    local.LocalProvider(tmp_path / "sb").ensure_server("s", tmp_path, str(tmp_path / "h"), "m")
    return seen


def test_local_never_lets_a_host_ttl_reach_a_session(monkeypatch, tmp_path):
    """LocalProvider spreads `**os.environ`: a developer's (or the control plane's own)
    1-hour variables would otherwise switch a session on behind an unset setting -- and
    the two it never stamps would move the helpers' TTL, which the switch leaves alone."""
    unset = _settings()
    for name in TTL_VARS:
        monkeypatch.setenv(name, "1h" if name != "ENABLE_PROMPT_CACHING_1H" else "1")
    seen = _local_env(monkeypatch, tmp_path, unset)
    assert not set(TTL_VARS) & set(seen), {k: seen[k] for k in TTL_VARS if k in seen}


def test_local_stamps_the_main_thread_ttl_when_set(monkeypatch, tmp_path):
    on = _settings(prompt_cache_ttl_main="1h")
    monkeypatch.setenv("CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL", "1h")
    seen = _local_env(monkeypatch, tmp_path, on)
    assert seen["CLAUDE_CODE_PROMPT_CACHE_TTL"] == "1h"
    assert "CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL" not in seen


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(x) for x in text.split("."))


def test_prompt_cache_switch_needs_cli_2_1_294():
    """CLAUDE_CODE_PROMPT_CACHE_TTL exists from CLI 2.1.294 (SDK 0.2.165); 2.1.220 has it
    zero times and ignores it in silence. So if the sandbox's SDK pin is ever rolled back,
    this goes red rather than leaving a switch that does nothing. Checks only what the
    sandbox installs: the `sandbox` group pin and its exported requirements."""
    pyproject = (SERVER / "pyproject.toml").read_text(encoding="utf-8")
    group = re.search(r"^sandbox = \[(.*?)^\]", pyproject, re.S | re.M)
    assert group, "no `sandbox` dependency group in apps/server/pyproject.toml"
    pin = re.search(r'"claude-agent-sdk==([\d.]+)"', group.group(1))
    assert pin, "the sandbox group no longer pins claude-agent-sdk exactly"
    exported = re.search(r"^claude-agent-sdk==([\d.]+)",
                         (SERVER / "sandbox" / "requirements.txt").read_text(encoding="utf-8"),
                         re.M)
    assert exported, "apps/server/sandbox/requirements.txt carries no claude-agent-sdk pin"
    for where, version in (("pyproject sandbox group", pin.group(1)),
                           ("sandbox/requirements.txt", exported.group(1))):
        assert _version(version) >= (0, 2, 165), (
            f"{where} installs claude-agent-sdk {version}, whose CLI ignores "
            "CLAUDE_CODE_PROMPT_CACHE_TTL: prompt_cache_ttl_main would silently do nothing")
