"""Credential proxy — token derivation, verification, and request routing.

The proxy validates a per-sandbox HMAC token, replaces it with the real
Anthropic API key, and streams the response from api.anthropic.com. The
sandbox never holds the real key.
"""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.anthropic_proxy import (
    _PROXY_PREFIX,
    make_upstream_client,
    proxy_token,
    verify_proxy_token,
)
from app.config import get_settings
from app.main import app


# ── token derivation ────────────────────────────────────────────


def test_proxy_token_is_deterministic():
    t1 = proxy_token("sandbox-abc")
    t2 = proxy_token("sandbox-abc")
    assert t1 == t2


def test_proxy_token_embeds_sandbox_id():
    token = proxy_token("sandbox-abc")
    assert token.startswith("sandbox-abc:")


def test_different_sandboxes_get_different_tokens():
    assert proxy_token("sandbox-1") != proxy_token("sandbox-2")


def test_verify_accepts_valid_token():
    token = proxy_token("my-sandbox")
    assert verify_proxy_token(token) == "my-sandbox"


def test_verify_rejects_tampered_token():
    token = proxy_token("my-sandbox")
    tampered = token[:-4] + "0000"
    assert verify_proxy_token(tampered) is None


def test_verify_rejects_garbage():
    assert verify_proxy_token("") is None
    assert verify_proxy_token("no-colon-here") is None
    assert verify_proxy_token("abc:wrong-sig") is None


def test_verify_rejects_wrong_sandbox_id():
    token = proxy_token("sandbox-a")
    forged = "sandbox-b:" + token.split(":", 1)[1]
    assert verify_proxy_token(forged) is None


def test_token_changes_with_signing_key(monkeypatch):
    t1 = proxy_token("sandbox-x")
    monkeypatch.setattr(get_settings(), "anthropic_proxy_signing_key", "rotated-key")
    t2 = proxy_token("sandbox-x")
    assert t1 != t2


# ── proxy endpoint ──────────────────────────────────────────────


@pytest.fixture
def _proxy_client():
    """Set up the app with a mock upstream httpx client."""
    app.state.anthropic_proxy_client = make_upstream_client()
    yield
    app.state.anthropic_proxy_client.aclose


def test_invalid_token_returns_401(_proxy_client):
    with TestClient(app) as client:
        resp = client.post(
            f"{_PROXY_PREFIX}/v1/messages",
            headers={"x-api-key": "bad-token"},
            json={"model": "test"},
        )
    assert resp.status_code == 401
    body = resp.json()
    assert body["type"] == "error"
    assert body["error"]["type"] == "authentication_error"


def test_missing_token_returns_401(_proxy_client):
    with TestClient(app) as client:
        resp = client.post(f"{_PROXY_PREFIX}/v1/messages", json={"model": "test"})
    assert resp.status_code == 401


def test_valid_token_with_no_api_key_returns_502(_proxy_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    token = proxy_token("test-sandbox")
    with TestClient(app) as client:
        resp = client.post(
            f"{_PROXY_PREFIX}/v1/messages",
            headers={"x-api-key": token},
            json={"model": "test"},
        )
    assert resp.status_code == 502
    assert "not configured" in resp.json()["error"]["message"]


def test_proxy_forwards_path_and_query(monkeypatch):
    """The proxy preserves the upstream path and query string."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    token = proxy_token("test-sandbox")

    captured_requests = []

    async def _capture(request: httpx.Request):
        captured_requests.append(request)
        return httpx.Response(200, json={"ok": True})

    with TestClient(app) as client:
        transport = httpx.MockTransport(_capture)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)

        resp = client.get(
            f"{_PROXY_PREFIX}/v1/models?limit=5",
            headers={"x-api-key": token},
        )

    assert resp.status_code == 200
    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert str(req.url).startswith("https://api.anthropic.com/v1/models")
    assert "limit=5" in str(req.url)
    assert req.headers["x-api-key"] == "sk-ant-real-key"


def test_proxy_replaces_api_key_header(monkeypatch):
    """The proxy replaces the proxy token with the real API key."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    token = proxy_token("test-sandbox")

    captured_headers = {}

    async def _capture(request: httpx.Request):
        captured_headers.update(dict(request.headers))
        return httpx.Response(200, json={"ok": True})

    with TestClient(app) as client:
        transport = httpx.MockTransport(_capture)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)

        client.post(
            f"{_PROXY_PREFIX}/v1/messages",
            headers={
                "x-api-key": token,
                "anthropic-version": "2023-06-01",
            },
            json={"model": "claude-sonnet-4-6", "messages": []},
        )

    assert captured_headers["x-api-key"] == "sk-ant-real-key"
    assert captured_headers["anthropic-version"] == "2023-06-01"


def test_proxy_streams_sse_response(monkeypatch):
    """SSE responses are streamed back to the caller."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    token = proxy_token("test-sandbox")

    sse_body = (
        b"event: message_start\n"
        b'data: {"type":"message_start"}\n\n'
        b"event: message_stop\n"
        b'data: {"type":"message_stop"}\n\n'
    )

    async def _sse(request: httpx.Request):
        return httpx.Response(
            200,
            content=sse_body,
            headers={"content-type": "text/event-stream"},
        )

    with TestClient(app) as client:
        transport = httpx.MockTransport(_sse)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)

        resp = client.post(
            f"{_PROXY_PREFIX}/v1/messages",
            headers={"x-api-key": token},
            json={"model": "test", "stream": True, "messages": []},
        )

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers.get("content-type", "")
    assert b"message_start" in resp.content
    assert b"message_stop" in resp.content
