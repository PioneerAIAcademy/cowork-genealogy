"""Tests for harness.auth — subscription/API-key resolution."""

import os
from pathlib import Path
from unittest import mock

import pytest

from harness import auth


def test_subscription_preferred_when_both_available(monkeypatch, tmp_path):
    """Policy: when both a subscription and an API key are available, the
    subscription wins for the skill runner — eval runs should bill the
    operator's flat-rate subscription, not the project's metered key. The
    key is still carried on the config so the judge can use it."""
    fake_home = tmp_path / "home" / ".claude"
    fake_home.mkdir(parents=True)
    monkeypatch.setattr(auth, "SUBSCRIPTION_DIRS", [fake_home])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-deadbeef")
    monkeypatch.setattr(auth, "ENV_FILE", tmp_path / "not-a-real-env-file")
    cfg = auth.resolve_auth()
    assert cfg.skill_runner_mode == "subscription"
    # The judge still needs the key, so it rides along on the config.
    assert cfg.api_key == "sk-test-deadbeef"


def test_subscription_with_no_key_leaves_judge_keyless(monkeypatch, tmp_path):
    """Subscription present, no key: skill runner uses the subscription and
    the judge has no key (run_tests warns; the judge errors when reached)."""
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


def test_env_for_sdk_suppresses_key_in_subscription_mode():
    """Subscription mode forces the SDK subprocess onto the CLI session by
    setting ANTHROPIC_API_KEY="" — an empty string reads as unset to the
    Claude Code CLI's truthiness check, so it falls back to its OAuth
    session even when a key was inherited from os.environ."""
    cfg = auth.AuthConfig(skill_runner_mode="subscription", api_key=None, detail="x")
    assert auth.env_for_sdk(cfg) == {"ANTHROPIC_API_KEY": ""}


def test_env_for_sdk_returns_key_in_api_mode():
    cfg = auth.AuthConfig(skill_runner_mode="api_key", api_key="sk-x", detail="x")
    assert auth.env_for_sdk(cfg) == {"ANTHROPIC_API_KEY": "sk-x"}


def test_env_for_sdk_subscription_mode_suppresses_key_even_if_present():
    """Even when a key is available (carried for the judge), subscription
    mode must NOT let the skill-runner subprocess use it — it's overridden
    to empty so the CLI session wins."""
    cfg = auth.AuthConfig(
        skill_runner_mode="subscription", api_key="sk-x", detail="x"
    )
    assert auth.env_for_sdk(cfg) == {"ANTHROPIC_API_KEY": ""}
