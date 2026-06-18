"""Unit tests for e2e.preflight — per-check status (OK/WARN/FAIL) logic."""

from __future__ import annotations

import os
import time

import e2e.preflight as pf


def test_fs_token_fresh_is_ok(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")  # just-written -> age ~0
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    status, _ = pf._check_fs_token()
    assert status == "OK"


def test_fs_token_missing_is_fail(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "FS_TOKENS", tmp_path / "nope.json")
    status, detail = pf._check_fs_token()
    assert status == "FAIL"
    assert "login" in detail.lower()


def test_fs_token_aging_warns(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")
    # Age it to 23h (past WARN 22h, under FAIL 24h).
    old = time.time() - 23 * 3600
    os.utime(token, (old, old))
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    status, detail = pf._check_fs_token()
    assert status == "WARN"
    assert "expire" in detail.lower()


def test_fs_token_expired_is_fail(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")
    old = time.time() - 25 * 3600  # past 24h
    os.utime(token, (old, old))
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    status, detail = pf._check_fs_token()
    assert status == "FAIL"
    assert "e2e-login" in detail or "login" in detail.lower()


def test_mcp_build_check(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "MCP_BUILD", tmp_path / "index.js")
    status, detail = pf._check_mcp_build()
    assert status == "FAIL"
    assert "build" in detail.lower()
    (tmp_path / "index.js").write_text("//", encoding="utf-8")
    status, _ = pf._check_mcp_build()
    assert status == "OK"


def test_api_key_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    status, detail = pf._check_api_key()
    assert status == "OK"
    assert "environment" in detail.lower()


def test_api_key_from_env_file(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=sk-from-file\n", encoding="utf-8")
    monkeypatch.setattr(pf, "ENV_FILE", env)
    status, detail = pf._check_api_key()
    assert status == "OK"
    assert ".env" in detail


def test_api_key_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(pf, "ENV_FILE", tmp_path / "absent.env")
    status, detail = pf._check_api_key()
    assert status == "FAIL"
    assert "ANTHROPIC_API_KEY" in detail


def test_harness_deps_present():
    status, _ = pf._check_harness_deps()
    assert status == "OK"


def test_main_returns_zero_when_all_ok(monkeypatch, capsys):
    monkeypatch.setattr(pf, "CHECKS", [("x", lambda: ("OK", "ok"))])
    assert pf.main() == 0
    assert "ready" in capsys.readouterr().out.lower()


def test_main_warn_is_nonblocking(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: ("OK", "ok")), ("y", lambda: ("WARN", "aging"))]
    )
    assert pf.main() == 0
    assert "warning" in capsys.readouterr().out.lower()


def test_main_returns_one_when_any_fail(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: ("OK", "ok")), ("y", lambda: ("FAIL", "bad"))]
    )
    assert pf.main() == 1
