"""Unit tests for e2e.run_e2e.load_env_file — judge auth from eval/.env.

The judge calls the Anthropic API directly and reads ANTHROPIC_API_KEY
from the process env. Without loading eval/.env the judge fails to
authenticate and every run comes back verdict=skipped.
"""

from __future__ import annotations

import os

from e2e.run_e2e import load_env_file


def test_loads_key_from_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=sk-from-file\n", encoding="utf-8")
    load_env_file(env)
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-from-file"


def test_shell_env_wins_over_file(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-from-shell")
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=sk-from-file\n", encoding="utf-8")
    load_env_file(env)
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-from-shell"


def test_missing_file_is_noop(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    load_env_file(tmp_path / "absent.env")
    assert "ANTHROPIC_API_KEY" not in os.environ
