"""Per-connect credential proxy token injection.

The control plane writes a per-sandbox proxy token (HMAC-derived, not the real
Anthropic API key) into the sandbox's secrets file on every connect. The agent
reads it via ``current_api_key()`` and passes it to the SDK, which sends it to
the credential proxy. The proxy validates the token and injects the real key.

Key properties:
- The secrets file never contains the real Anthropic API key.
- The proxy token is deterministic from (signing_key, sandbox_id).
- API key rotation is transparent — the proxy reads the current key from config.
- Proxy signing key rotation changes the token, triggering an SDK client rebuild.
"""
import json

import pytest
from fastapi.testclient import TestClient

from _fakes import FakeSDKClient

from app.agent import real_agent
from app.agent_secrets import secrets_bytes
from app.anthropic_proxy import proxy_token, verify_proxy_token
from app.config import get_settings
from app.main import app
from app.sandbox.base import SECRETS_PATH


# ── the reader (runs inside the sandbox) ─────────────────────────

def _point_at(monkeypatch, path):
    monkeypatch.setattr(real_agent, "_SECRETS_PATH", str(path))


def test_secrets_file_wins_over_stale_create_time_env(tmp_path, monkeypatch):
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
    assert opts.env["_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL"] == "1"


def test_build_options_omits_base_url_when_unset(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("some-token"))
    _point_at(monkeypatch, secrets)
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)

    opts = real_agent.build_options(tmp_path)
    assert "ANTHROPIC_BASE_URL" not in opts.env


def test_secrets_path_agrees_with_the_control_plane_constant():
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


def test_connect_writes_proxy_token_not_raw_key(monkeypatch):
    """The secrets file carries a proxy token, never the real Anthropic API key."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={}).json()
        sandbox_id = proj["sandbox_id"]
        secrets = (
            app.state.provider._root(sandbox_id) / SECRETS_PATH.lstrip("/")
        )
        doc = json.loads(secrets.read_text(encoding="utf-8"))

        # The file must carry a proxy token, not the raw API key.
        token_value = doc["anthropic_api_key"]
        assert token_value != "sk-ant-real-key"
        assert verify_proxy_token(token_value) == sandbox_id

        # Reconnect: the token is stable (same sandbox_id + signing_key).
        assert client.post(f"/api/sessions/{proj['id']}/connect").status_code == 200
        doc2 = json.loads(secrets.read_text(encoding="utf-8"))
        assert doc2["anthropic_api_key"] == token_value


def test_api_key_rotation_does_not_change_proxy_token(monkeypatch):
    """Rotating ANTHROPIC_API_KEY on the control plane does not change the token
    in the sandbox — the proxy reads the current key, so rotation is transparent."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-key-v1")
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
