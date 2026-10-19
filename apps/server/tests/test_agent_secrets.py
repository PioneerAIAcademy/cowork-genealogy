"""Per-connect credential injection — the fix for the create-time-env freeze.

The Anthropic key used to be injected only via ``envs=`` at sandbox create(),
which neither sandbox SDK can update afterwards. Rotating the key therefore
fixed new sessions while every existing one kept 401ing (the 2026-07-20 alpha
outage). The control plane now rewrites SECRETS_PATH on every connect and the
agent prefers that file, so a rotation lands at the user's next reconnect.

When the credential proxy is active (production, ``proxy_active()``), the file
carries an HMAC-derived proxy token, never the real key. When the proxy is
inactive (local dev), it carries the raw API key — same as the original channel.
"""
import json

import pytest
from fastapi.testclient import TestClient

from _fakes import FakeSDKClient

from app.agent import real_agent
from app.agent_secrets import secrets_bytes
from app.anthropic_proxy import proxy_active, proxy_token, verify_proxy_token
from app.config import get_settings
from app.main import app
from app.sandbox.base import SECRETS_PATH


# ── the reader (runs inside the sandbox) ─────────────────────────

def _point_at(monkeypatch, path):
    monkeypatch.setattr(real_agent, "_SECRETS_PATH", str(path))


def test_secrets_file_wins_over_stale_create_time_env(tmp_path, monkeypatch):
    # The exact outage shape: the env copy baked in at create() is the revoked
    # key, the file carries the rotated one. The file must win.
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("proxy-token-from-file"))
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "stale-env-value")

    assert real_agent.current_api_key() == "proxy-token-from-file"


@pytest.mark.parametrize(
    "content",
    [None, b"", b"not json at all", b"{}", b'{"anthropic_api_key": ""}', b"[]"],
    ids=["missing", "empty", "corrupt", "no-key", "blank-key", "not-an-object"],
)
def test_falls_back_to_env_when_file_unusable(tmp_path, monkeypatch, content):
    # Sandboxes created before this channel existed have no file; a partial or
    # truncated write must not strand the agent with no key at all.
    secrets = tmp_path / "session.json"
    if content is not None:
        secrets.write_bytes(content)
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fallback-env")

    assert real_agent.current_api_key() == "fallback-env"


def test_build_options_passes_the_current_token_to_the_sdk(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    token = proxy_token("test-sandbox")
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes(token))
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "stale-env")

    opts = real_agent.build_options(tmp_path)
    assert opts.env["ANTHROPIC_API_KEY"] == token


def test_build_options_forwards_base_url_when_set(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "http://localhost:8000/api/anthropic-proxy")

    opts = real_agent.build_options(tmp_path)
    assert opts.env["ANTHROPIC_BASE_URL"] == "http://localhost:8000/api/anthropic-proxy"
    assert "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL" not in opts.env


def test_build_options_omits_base_url_when_unset(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    _point_at(monkeypatch, secrets)
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)

    opts = real_agent.build_options(tmp_path)
    assert "ANTHROPIC_BASE_URL" not in opts.env


def test_resumed_sandbox_gets_base_url_from_secrets_file(tmp_path, monkeypatch):
    """Deploy-transition: a sandbox created before the proxy has no
    ANTHROPIC_BASE_URL in its env. After reconnect, write_secrets writes
    both the proxy token and the base URL into the secrets file. The SDK
    env must pick up the base URL from the file, not the absent env var."""
    pytest.importorskip("claude_agent_sdk")
    proxy_url = "https://prod.example.com/api/anthropic-proxy"
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("proxy-token", proxy_url))
    _point_at(monkeypatch, secrets)
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)

    opts = real_agent.build_options(tmp_path)
    assert opts.env["ANTHROPIC_API_KEY"] == "proxy-token"
    assert opts.env["ANTHROPIC_BASE_URL"] == proxy_url


def test_secrets_file_base_url_wins_over_stale_env(tmp_path, monkeypatch):
    """If the env still has an old base URL (shouldn't happen, but defensive),
    the secrets file takes precedence — same as the API key."""
    pytest.importorskip("claude_agent_sdk")
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("token", "https://new.example.com/api/anthropic-proxy"))
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://old.example.com/api/anthropic-proxy")

    opts = real_agent.build_options(tmp_path)
    assert opts.env["ANTHROPIC_BASE_URL"] == "https://new.example.com/api/anthropic-proxy"


def test_secrets_path_agrees_with_the_control_plane_constant():
    # real_agent can't import the control-plane package (it also runs as a loose
    # script in the baked E2B image), so the path is duplicated. Writer and
    # reader must not drift.
    assert real_agent._SECRETS_PATH == SECRETS_PATH


# ── live-client rotation ─────────────────────────────────────────

class _FakeClient(FakeSDKClient):
    """The shared stand-in (tests/_fakes.py), subclassed so `instances` is this
    file's own registry and so the two `monkeypatch.setattr` calls below land on
    a class no other file uses."""


@pytest.fixture
def fake_sdk(monkeypatch):
    """Patch the lazily-imported ClaudeSDKClient inside _ensure_client."""
    import sys
    import types

    _FakeClient.instances = []
    mod = types.ModuleType("claude_agent_sdk")
    mod.ClaudeSDKClient = _FakeClient
    mod.ClaudeAgentOptions = dict  # build_options is stubbed out below
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", mod)
    monkeypatch.setattr(real_agent, "build_options", lambda *a, **kw: kw)
    return _FakeClient


async def test_rotating_the_token_rebuilds_the_live_client(tmp_path, monkeypatch, fake_sdk):
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("token-old"))
    _point_at(monkeypatch, secrets)

    agent = real_agent.RealAgent(tmp_path)
    first = await agent._ensure_client()
    assert first.connected and len(fake_sdk.instances) == 1

    # Same token → same client (no needless teardown mid-conversation).
    assert await agent._ensure_client() is first
    assert len(fake_sdk.instances) == 1

    # Rotated token → the old client is torn down and a new one built.
    secrets.write_bytes(secrets_bytes("token-new"))
    second = await agent._ensure_client()
    assert second is not first
    assert first.disconnected
    assert second.options["api_key"] == "token-new"


async def test_failed_connect_is_not_cached(tmp_path, monkeypatch, fake_sdk):
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    _point_at(monkeypatch, secrets)

    async def boom(self):
        raise RuntimeError("CLI failed to start")

    monkeypatch.setattr(_FakeClient, "connect", boom)
    agent = real_agent.RealAgent(tmp_path)
    with pytest.raises(RuntimeError):
        await agent._ensure_client()
    assert agent._client is None


async def test_disconnect_failure_still_replaces_the_client(tmp_path, monkeypatch, fake_sdk):
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("token-old"))
    _point_at(monkeypatch, secrets)

    agent = real_agent.RealAgent(tmp_path)
    first = await agent._ensure_client()

    async def boom(self):
        raise RuntimeError("transport already gone")

    monkeypatch.setattr(_FakeClient, "disconnect", boom)
    secrets.write_bytes(secrets_bytes("token-new"))
    second = await agent._ensure_client()
    assert second is not first and agent._client is second


# ── the writer (control plane) ───────────────────────────────────

def test_secrets_bytes_omits_an_unset_value():
    assert json.loads(secrets_bytes(None)) == {}
    assert json.loads(secrets_bytes("")) == {}
    assert json.loads(secrets_bytes("proxy-tok")) == {"anthropic_api_key": "proxy-tok"}
    assert json.loads(secrets_bytes("proxy-tok", "https://example.com/api/anthropic-proxy")) == {
        "anthropic_api_key": "proxy-tok",
        "anthropic_base_url": "https://example.com/api/anthropic-proxy",
    }
    assert json.loads(secrets_bytes("proxy-tok", None)) == {"anthropic_api_key": "proxy-tok"}
    assert json.loads(secrets_bytes("proxy-tok", "")) == {"anthropic_api_key": "proxy-tok"}


def test_connect_writes_proxy_token_when_proxy_active(monkeypatch):
    """Production (proxy_active): secrets file carries a proxy token, not the raw key."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    monkeypatch.setattr("app.agent_secrets.proxy_active", lambda: True)
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={}).json()
        sandbox_id = proj["sandbox_id"]
        secrets = (
            app.state.provider._root(sandbox_id) / SECRETS_PATH.lstrip("/")
        )
        doc = json.loads(secrets.read_text(encoding="utf-8"))

        token_value = doc["anthropic_api_key"]
        assert token_value != "sk-ant-real-key"
        assert verify_proxy_token(token_value) == sandbox_id
        assert "anthropic_base_url" in doc
        assert "/api/anthropic-proxy" in doc["anthropic_base_url"]

        # Reconnect: the token is stable (same sandbox_id + signing_key).
        assert client.post(f"/api/sessions/{proj['id']}/connect").status_code == 200
        doc2 = json.loads(secrets.read_text(encoding="utf-8"))
        assert doc2["anthropic_api_key"] == token_value
        assert doc2["anthropic_base_url"] == doc["anthropic_base_url"]


def test_connect_writes_raw_key_when_proxy_inactive(monkeypatch):
    """Local dev (proxy not active): secrets file carries the raw API key so the
    sandbox talks directly to api.anthropic.com."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    monkeypatch.setattr(get_settings(), "public_url", "http://localhost:8000")
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={}).json()
        sandbox_id = proj["sandbox_id"]
        secrets = (
            app.state.provider._root(sandbox_id) / SECRETS_PATH.lstrip("/")
        )
        doc = json.loads(secrets.read_text(encoding="utf-8"))
        assert doc["anthropic_api_key"] == "sk-ant-real-key"
        assert "anthropic_base_url" not in doc


def test_api_key_rotation_does_not_change_proxy_token(monkeypatch):
    """Rotating ANTHROPIC_API_KEY on the control plane does not change the token
    in the sandbox — the proxy reads the current key, so rotation is transparent."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-key-v1")
    monkeypatch.setattr("app.agent_secrets.proxy_active", lambda: True)
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={}).json()
        sandbox_id = proj["sandbox_id"]
        secrets = (
            app.state.provider._root(sandbox_id) / SECRETS_PATH.lstrip("/")
        )
        token_before = json.loads(secrets.read_text(encoding="utf-8"))["anthropic_api_key"]

        # Rotate the API key and reconnect.
        monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-key-v2")
        client.post(f"/api/sessions/{proj['id']}/connect")

        token_after = json.loads(secrets.read_text(encoding="utf-8"))["anthropic_api_key"]
        assert token_before == token_after


async def test_closing_the_client_resets_the_respawn_flag(tmp_path, monkeypatch, fake_sdk):
    """`_close_client` must clear `_stream_dirty` along with the client.

    Left set, a close from any path other than the abandoned-stream one costs the
    NEXT turn a redundant rebuild, which makes the flag mean "maybe dirty" rather
    than "dirty". Raised in review on issue #2062.
    """
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    _point_at(monkeypatch, secrets)

    agent = real_agent.RealAgent(tmp_path)
    await agent._ensure_client()
    agent._stream_dirty = True

    await agent._close_client()

    assert agent._stream_dirty is False, (
        "the respawn flag survived the client it describes, so the next turn "
        "rebuilds a client that was never dirty"
    )
