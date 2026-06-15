"""Unit tests for e2e.preflight — the per-check pass/fail logic."""

from __future__ import annotations

import e2e.preflight as pf


def test_fs_token_check_pass(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    ok, _ = pf._check_fs_token()
    assert ok


def test_fs_token_check_fail(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "FS_TOKENS", tmp_path / "nope.json")
    ok, detail = pf._check_fs_token()
    assert not ok
    assert "login" in detail.lower()


def test_mcp_build_check(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "MCP_BUILD", tmp_path / "index.js")
    ok, detail = pf._check_mcp_build()
    assert not ok
    assert "build" in detail.lower()
    (tmp_path / "index.js").write_text("//", encoding="utf-8")
    ok, _ = pf._check_mcp_build()
    assert ok


def test_api_key_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    ok, detail = pf._check_api_key()
    assert ok
    assert "environment" in detail.lower()


def test_api_key_from_env_file(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=sk-from-file\n", encoding="utf-8")
    monkeypatch.setattr(pf, "ENV_FILE", env)
    ok, detail = pf._check_api_key()
    assert ok
    assert ".env" in detail


def test_api_key_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(pf, "ENV_FILE", tmp_path / "absent.env")
    ok, detail = pf._check_api_key()
    assert not ok
    assert "ANTHROPIC_API_KEY" in detail


def test_harness_deps_present():
    # claude_agent_sdk + anthropic are installed in the harness env.
    ok, _ = pf._check_harness_deps()
    assert ok


def test_main_returns_zero_when_all_pass(monkeypatch, capsys):
    monkeypatch.setattr(pf, "CHECKS", [("x", lambda: (True, "ok"))])
    assert pf.main() == 0
    assert "ready" in capsys.readouterr().out.lower()


def test_main_returns_one_when_any_fail(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: (True, "ok")), ("y", lambda: (False, "bad"))]
    )
    assert pf.main() == 1
