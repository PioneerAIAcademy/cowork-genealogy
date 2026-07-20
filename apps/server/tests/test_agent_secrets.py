"""Per-connect secret injection — the fix for the create-time-env freeze.

The Anthropic key used to be injected only via `envs=` at sandbox create(),
which neither sandbox SDK can update afterwards. Rotating the key therefore
fixed new sessions while every existing one kept 401ing (the 2026-07-20 alpha
outage). The control plane now rewrites SECRETS_PATH on every connect and the
agent prefers that file, so a rotation lands at the user's next reconnect.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.agent import real_agent
from app.agent_secrets import secrets_bytes
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
    secrets.write_bytes(secrets_bytes("sk-ant-rotated"))
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-revoked")

    assert real_agent.current_api_key() == "sk-ant-rotated"


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
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-from-env")

    assert real_agent.current_api_key() == "sk-ant-from-env"


def test_build_options_passes_the_current_key_to_the_sdk(tmp_path, monkeypatch):
    pytest.importorskip("claude_agent_sdk")
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("sk-ant-rotated"))
    _point_at(monkeypatch, secrets)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-revoked")

    opts = real_agent.build_options(tmp_path)
    assert opts.env["ANTHROPIC_API_KEY"] == "sk-ant-rotated"


def test_secrets_path_agrees_with_the_control_plane_constant():
    # real_agent can't import the control-plane package (it also runs as a loose
    # script in the baked E2B image), so the path is duplicated. Writer and
    # reader must not drift.
    assert real_agent._SECRETS_PATH == SECRETS_PATH


# ── live-client rotation ─────────────────────────────────────────

class _FakeClient:
    """Stands in for ClaudeSDKClient: records connect/disconnect only."""

    instances: list["_FakeClient"] = []

    def __init__(self, options=None):
        self.options = options
        self.connected = False
        self.disconnected = False
        _FakeClient.instances.append(self)

    async def connect(self):
        self.connected = True

    async def disconnect(self):
        self.disconnected = True


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


async def test_rotating_the_key_rebuilds_the_live_client(tmp_path, monkeypatch, fake_sdk):
    # A running agent_runner holds a persistent client. The SDK reads the key
    # once, at subprocess start, so a rotation only lands if the client is
    # rebuilt — otherwise the fix would help new sandboxes only.
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("sk-ant-old"))
    _point_at(monkeypatch, secrets)

    agent = real_agent.RealAgent(tmp_path)
    first = await agent._ensure_client()
    assert first.connected and len(fake_sdk.instances) == 1

    # Same key → same client (no needless teardown mid-conversation).
    assert await agent._ensure_client() is first
    assert len(fake_sdk.instances) == 1

    # Rotated key → the old client is torn down and a new one built with it.
    secrets.write_bytes(secrets_bytes("sk-ant-new"))
    second = await agent._ensure_client()
    assert second is not first
    assert first.disconnected
    assert second.options["api_key"] == "sk-ant-new"


async def test_failed_connect_is_not_cached(tmp_path, monkeypatch, fake_sdk):
    # A client that never opened must not be handed to the next turn — the turn
    # would hang on a dead transport instead of retrying the connect.
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("sk-ant-key"))
    _point_at(monkeypatch, secrets)

    async def boom(self):
        raise RuntimeError("CLI failed to start")

    monkeypatch.setattr(_FakeClient, "connect", boom)
    agent = real_agent.RealAgent(tmp_path)
    with pytest.raises(RuntimeError):
        await agent._ensure_client()
    assert agent._client is None


async def test_disconnect_failure_still_replaces_the_client(tmp_path, monkeypatch, fake_sdk):
    # Teardown is best-effort: a client whose disconnect throws must not stay
    # cached, or the rotation would never take.
    secrets = tmp_path / "session.json"
    secrets.write_bytes(secrets_bytes("sk-ant-old"))
    _point_at(monkeypatch, secrets)

    agent = real_agent.RealAgent(tmp_path)
    first = await agent._ensure_client()

    async def boom(self):
        raise RuntimeError("transport already gone")

    monkeypatch.setattr(_FakeClient, "disconnect", boom)
    secrets.write_bytes(secrets_bytes("sk-ant-new"))
    second = await agent._ensure_client()
    assert second is not first and agent._client is second


# ── the writer (control plane) ───────────────────────────────────

def test_secrets_bytes_omits_an_unset_key():
    assert json.loads(secrets_bytes(None)) == {}
    assert json.loads(secrets_bytes("")) == {}
    assert json.loads(secrets_bytes("sk-ant-x")) == {"anthropic_api_key": "sk-ant-x"}


def test_connect_rewrites_the_secrets_file(monkeypatch):
    # End to end over the real REST surface: /connect must refresh the file so a
    # key rotated while a session was paused reaches it on reconnect.
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-at-create")
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "tester@example.com"})
        proj = client.post("/api/sessions", json={}).json()
        secrets = (  # LocalProvider maps sandbox-absolute paths under the root
            app.state.provider._root(proj["sandbox_id"]) / SECRETS_PATH.lstrip("/")
        )
        assert json.loads(secrets.read_text(encoding="utf-8")) == {
            "anthropic_api_key": "sk-ant-at-create"
        }

        # Rotate on the control plane while the session exists, then reconnect.
        monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-rotated")
        assert client.post(f"/api/sessions/{proj['id']}/connect").status_code == 200

        assert json.loads(secrets.read_text(encoding="utf-8")) == {
            "anthropic_api_key": "sk-ant-rotated"
        }
