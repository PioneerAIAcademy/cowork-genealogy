"""Tests for harness.auth — subscription/API-key resolution."""

import os
from pathlib import Path
from unittest import mock

import pytest

from harness import auth


def test_subscription_preferred_when_available(monkeypatch, tmp_path):
    """v1.3: when subscription is available, the skill runner uses it.
    The judge still needs an API key — auth surfaces both layers separately."""
    fake_home = tmp_path / "home" / ".claude"
    fake_home.mkdir(parents=True)
    monkeypatch.setattr(auth, "SUBSCRIPTION_DIRS", [fake_home])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-deadbeef")
    monkeypatch.setattr(auth, "ENV_FILE", tmp_path / "not-a-real-env-file")
    cfg = auth.resolve_auth()
    assert cfg.skill_runner_mode == "subscription"
    # API key still populated — the judge needs it.
    assert cfg.api_key == "sk-test-deadbeef"


def test_subscription_only_when_no_key(monkeypatch, tmp_path):
    fake_home = tmp_path / "home" / ".claude"
    fake_home.mkdir(parents=True)
    monkeypatch.setattr(auth, "SUBSCRIPTION_DIRS", [fake_home])
    monkeypatch.setattr(auth, "ENV_FILE", tmp_path / "not-a-real-env-file")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cfg = auth.resolve_auth()
    assert cfg.skill_runner_mode == "subscription"
    assert cfg.api_key is None


def test_api_key_mode_when_no_subscription(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "SUBSCRIPTION_DIRS", [tmp_path / "no-such-dir"])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-deadbeef")
    monkeypatch.setattr(auth, "ENV_FILE", tmp_path / "not-a-real-env-file")
    cfg = auth.resolve_auth()
    assert cfg.skill_runner_mode == "api_key"
    assert cfg.api_key == "sk-test-deadbeef"


def test_loads_api_key_from_dotenv(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("ANTHROPIC_API_KEY=sk-from-dotenv\n")
    monkeypatch.setattr(auth, "SUBSCRIPTION_DIRS", [tmp_path / "no-such-dir"])
    monkeypatch.setattr(auth, "ENV_FILE", env_file)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cfg = auth.resolve_auth()
    assert cfg.skill_runner_mode == "api_key"
    assert cfg.api_key == "sk-from-dotenv"


def test_raises_when_no_auth_available(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "SUBSCRIPTION_DIRS", [tmp_path / "no-such-dir"])
    monkeypatch.setattr(auth, "ENV_FILE", tmp_path / "no-such-env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(auth.AuthError):
        auth.resolve_auth()


def test_env_for_sdk_returns_empty_in_subscription_mode():
    cfg = auth.AuthConfig(skill_runner_mode="subscription", api_key=None, detail="x")
    assert auth.env_for_sdk(cfg) == {}


def test_env_for_sdk_returns_key_in_api_mode():
    cfg = auth.AuthConfig(skill_runner_mode="api_key", api_key="sk-x", detail="x")
    assert auth.env_for_sdk(cfg) == {"ANTHROPIC_API_KEY": "sk-x"}


def test_env_for_sdk_subscription_mode_omits_key_even_if_present():
    """Subscription mode means the skill runner uses the CLI session; we
    do NOT inject the API key into the SDK subprocess (the os.environ
    inheritance caveat is documented in auth.py module docstring)."""
    cfg = auth.AuthConfig(
        skill_runner_mode="subscription", api_key="sk-x", detail="x"
    )
    assert auth.env_for_sdk(cfg) == {}
