"""Credential proxy — token derivation, verification, request routing and usage metering.

The proxy validates a per-sandbox HMAC token, replaces it with the real
Anthropic API key, and streams the response from api.anthropic.com. The
sandbox never holds the real key.
"""
import gzip
import json
import threading
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import anthropic_proxy
from app.agent.spend import price_usd
from app.anthropic_proxy import (
    _PROXY_PREFIX,
    make_upstream_client,
    proxy_active,
    proxy_token,
    verify_proxy_token,
)
from app.config import get_settings
from app.db import get_engine, init_db
from app.main import app
from app.models import ApiCall, Project, utcnow


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


# ── proxy_active gate ──────────────────────────────────────────


def test_proxy_active_is_false_for_http(monkeypatch):
    monkeypatch.setattr(get_settings(), "public_url", "http://localhost:8000")
    assert proxy_active() is False


def test_proxy_active_is_true_for_https(monkeypatch):
    monkeypatch.setattr(get_settings(), "public_url", "https://example.fly.dev")
    assert proxy_active() is True


# ── proxy endpoint ──────────────────────────────────────────────

# The liveness check queries the DB for an active Project row; mock it out for
# tests that need a valid token accepted so they can reach the forwarding path.
@pytest.fixture
def _mock_sandbox_exists(monkeypatch):
    monkeypatch.setattr("app.anthropic_proxy._active_project",
                        lambda sid: Project(id="prj_mock", user_id="u_mock", sandbox_id=sid))


def test_invalid_token_returns_401():
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


def test_missing_token_returns_401():
    with TestClient(app) as client:
        resp = client.post(f"{_PROXY_PREFIX}/v1/messages", json={"model": "test"})
    assert resp.status_code == 401


def test_valid_token_for_unknown_sandbox_returns_401(_mock_sandbox_exists, monkeypatch):
    """A valid HMAC but no matching active Project row → 401."""
    monkeypatch.setattr("app.anthropic_proxy._active_project", lambda sid: None)
    token = proxy_token("ghost-sandbox")
    with TestClient(app) as client:
        resp = client.post(
            f"{_PROXY_PREFIX}/v1/messages",
            headers={"x-api-key": token},
            json={"model": "test"},
        )
    assert resp.status_code == 401
    assert "not found" in resp.json()["error"]["message"]


def test_valid_token_with_no_api_key_returns_401(_mock_sandbox_exists, monkeypatch):
    """A valid token reaching a control plane with no Anthropic key → 401
    (classified as misconfiguration by the error module)."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    token = proxy_token("test-sandbox")
    with TestClient(app) as client:
        resp = client.post(
            f"{_PROXY_PREFIX}/v1/messages",
            headers={"x-api-key": token},
            json={"model": "test"},
        )
    assert resp.status_code == 401
    assert "not configured" in resp.json()["error"]["message"]


def test_proxy_forwards_path_and_query(_mock_sandbox_exists, monkeypatch):
    """The proxy preserves the upstream path and query string."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    token = proxy_token("test-sandbox")

    captured_requests = []

    async def _capture(request: httpx.Request):
        captured_requests.append(request)
        return httpx.Response(200, json={"ok": True})

    with TestClient(app) as client:
        saved = app.state.anthropic_proxy_client
        transport = httpx.MockTransport(_capture)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)
        try:
            resp = client.get(
                f"{_PROXY_PREFIX}/v1/models?limit=5",
                headers={"x-api-key": token},
            )
        finally:
            app.state.anthropic_proxy_client = saved

    assert resp.status_code == 200
    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert str(req.url).startswith("https://api.anthropic.com/v1/models")
    assert "limit=5" in str(req.url)
    assert req.headers["x-api-key"] == "sk-ant-real-key"


def test_proxy_replaces_api_key_header(_mock_sandbox_exists, monkeypatch):
    """The proxy replaces the proxy token with the real API key."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    token = proxy_token("test-sandbox")

    captured_headers = {}

    async def _capture(request: httpx.Request):
        captured_headers.update(dict(request.headers))
        return httpx.Response(200, json={"ok": True})

    with TestClient(app) as client:
        saved = app.state.anthropic_proxy_client
        transport = httpx.MockTransport(_capture)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)
        try:
            client.post(
                f"{_PROXY_PREFIX}/v1/messages",
                headers={
                    "x-api-key": token,
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "claude-code-20250219,extended-cache-ttl-2025-04-11",
                },
                json={"model": "claude-sonnet-4-6", "messages": []},
            )
        finally:
            app.state.anthropic_proxy_client = saved

    assert captured_headers["x-api-key"] == "sk-ant-real-key"
    assert captured_headers["anthropic-version"] == "2023-06-01"
    # The 1-hour cache beta must reach upstream intact, or a 1h TTL in the body is refused
    # or ignored (the body itself is relayed byte for byte, pinned below).
    assert captured_headers["anthropic-beta"] == "claude-code-20250219,extended-cache-ttl-2025-04-11"


def test_proxy_streams_sse_response(_mock_sandbox_exists, monkeypatch):
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
        saved = app.state.anthropic_proxy_client
        transport = httpx.MockTransport(_sse)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)
        try:
            resp = client.post(
                f"{_PROXY_PREFIX}/v1/messages",
                headers={"x-api-key": token},
                json={"model": "test", "stream": True, "messages": []},
            )
        finally:
            app.state.anthropic_proxy_client = saved

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers.get("content-type", "")
    assert b"message_start" in resp.content
    assert b"message_stop" in resp.content


def test_proxy_strips_content_encoding_from_gzipped_response(
    _mock_sandbox_exists, monkeypatch,
):
    """Regression: httpx's aiter_bytes() decodes gzip transparently, so the
    proxy relays plaintext. If content-encoding is not stripped, the caller
    tries to gunzip plaintext and fails with DecodingError."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    token = proxy_token("test-sandbox")

    payload = b'{"type": "message", "content": "hello"}'
    compressed = gzip.compress(payload)

    async def _gzipped(request: httpx.Request):
        return httpx.Response(
            200,
            content=compressed,
            headers={
                "content-type": "application/json",
                "content-encoding": "gzip",
            },
        )

    with TestClient(app) as client:
        saved = app.state.anthropic_proxy_client
        transport = httpx.MockTransport(_gzipped)
        app.state.anthropic_proxy_client = httpx.AsyncClient(transport=transport)
        try:
            resp = client.post(
                f"{_PROXY_PREFIX}/v1/messages",
                headers={"x-api-key": token},
                json={"model": "test", "messages": []},
            )
        finally:
            app.state.anthropic_proxy_client = saved

    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers
    assert resp.json()["content"] == "hello"


# ── usage metering (api_calls) ──────────────────────────────────


def _sse(*events) -> bytes:
    return b"".join(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode() for name, data in events)


_STREAM = _sse(
    ("message_start", {"type": "message_start", "message": {
        "model": "claude-sonnet-4-6",
        "usage": {"input_tokens": 100, "cache_creation_input_tokens": 2000,
                  "cache_read_input_tokens": 30000, "output_tokens": 1,
                  "cache_creation": {"ephemeral_5m_input_tokens": 2000},
                  "service_tier": "standard"}}}),
    ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {
        "type": "text_delta",
        "text": 'event: message_delta\ndata: {"usage": {"output_tokens": 999}}'}}),
    ("message_delta", {"type": "message_delta", "delta": {"stop_reason": None},
                       "usage": {"output_tokens": 50}}),
    ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
                       "usage": {"output_tokens": 120}}),
    ("message_stop", {"type": "message_stop"}),
)
_FINAL = (100, 2000, 30000, 120)


def _chunked(body: bytes, size: int):
    async def stream():
        for i in range(0, len(body), size):
            yield body[i:i + size]
    return stream()


def _streamed(content, status=200):
    return lambda req: httpx.Response(status, content=content,
                                      headers={"content-type": "text/event-stream"})


def _recorded() -> list[ApiCall]:
    anthropic_proxy._usage_writer.submit(lambda: None).result(timeout=5)
    with Session(get_engine()) as s:
        return list(s.exec(select(ApiCall)).all())


@pytest.fixture
def send(monkeypatch):
    """Sandbox sbx-meter belongs to a real session created 30 hours ago. Yields a function
    that sends one call through the proxy, answered upstream by `respond`."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-real-key")
    init_db()

    def clear():
        with Session(get_engine()) as s:
            for model in (ApiCall, Project):
                for row in s.exec(select(model)).all():
                    s.delete(row)
            s.commit()

    clear()
    with Session(get_engine()) as s:
        s.add(Project(id="prj_meter", user_id="u_meter", sandbox_id="sbx-meter",
                      created=utcnow() - timedelta(hours=30)))
        s.commit()

    def _send(respond, path="v1/messages", method="POST", request_json=None):
        """`request_json` is the request body: a dict goes as JSON, bytes as they are."""
        if request_json is None:
            request_json = {"model": "claude-sonnet-4-6", "messages": []}
        body = ({"content": request_json} if isinstance(request_json, bytes)
                else {"json": request_json})
        with TestClient(app) as client:
            saved = app.state.anthropic_proxy_client
            app.state.anthropic_proxy_client = httpx.AsyncClient(
                transport=httpx.MockTransport(respond))
            try:
                return client.request(method, f"{_PROXY_PREFIX}/{path}",
                                      headers={"x-api-key": proxy_token("sbx-meter")},
                                      **body)
            finally:
                app.state.anthropic_proxy_client = saved

    yield _send
    _recorded()
    clear()


@pytest.mark.parametrize("body, size", [
    (_STREAM, len(_STREAM)),
    (_STREAM, 1),
    (_STREAM.replace(b"\n", b"\r\n"), 7),
], ids=["one-chunk", "byte-by-byte", "crlf"])
def test_a_streamed_call_is_recorded_once_with_its_final_counts(send, body, size):
    resp = send(_streamed(_chunked(body, size)))
    assert resp.status_code == 200 and resp.content == body, "the meter altered the relay"
    [row] = _recorded()
    assert (row.project_id, row.user_id, row.model) == ("prj_meter", "u_meter", "claude-sonnet-4-6")
    assert (row.input_tokens, row.cache_creation_input_tokens,
            row.cache_read_input_tokens, row.output_tokens) == _FINAL, (
        "output_tokens is a running total: the last message_delta is the count")
    assert row.cost_usd == pytest.approx(price_usd(_FINAL))
    assert abs(row.session_age_s - 30 * 3600) < 60


def test_an_unstreamed_call_is_recorded_from_its_body_at_its_models_rates(send):
    """1M input and 100k output tokens are $1.50 on Haiku 4.5; at Sonnet 4.6's rates they
    would be $4.50."""
    body = {"type": "message", "model": "claude-haiku-4-5-20251001", "content": [],
            "usage": {"input_tokens": 1_000_000, "cache_creation_input_tokens": 0,
                      "cache_read_input_tokens": 0, "output_tokens": 100_000}}
    assert send(lambda req: httpx.Response(200, json=body)).json() == body
    [row] = _recorded()
    assert (row.model, row.input_tokens, row.output_tokens) == (
        "claude-haiku-4-5-20251001", 1_000_000, 100_000)
    assert row.cost_usd == pytest.approx(1.50)


@pytest.mark.parametrize("method, path, status", [
    ("POST", "v1/messages/count_tokens", 200),
    ("GET", "v1/models", 200),
    ("POST", "v1/messages", 529),
])
def test_only_a_successful_messages_call_is_metered(send, method, path, status):
    """Every answer here carries a usage block, so only the filter keeps it out."""
    billable = {"type": "message", "model": "claude-sonnet-4-6",
                "usage": {"input_tokens": 10, "output_tokens": 5}}
    resp = send(lambda req: httpx.Response(status, json=billable), path=path, method=method)
    assert resp.status_code == status
    assert _recorded() == []


def test_a_call_cut_off_mid_stream_is_still_recorded(send):
    async def dropped():
        yield _STREAM.split(b"event: content_block_delta")[0]
        raise httpx.ReadError("upstream dropped the stream")

    with pytest.raises(httpx.ReadError):
        send(_streamed(dropped()))
    assert [(r.input_tokens, r.output_tokens) for r in _recorded()] == [(100, 1)]


def test_an_unreadable_usage_line_is_relayed_untouched_and_records_nothing(send):
    body = (b'event: message_start\ndata: {"type": "message_start", "message": {"model"\n\n'
            b'event: message_stop\ndata: {"type": "message_stop"}\n\n')
    resp = send(_streamed(body))
    assert resp.status_code == 200 and resp.content == body
    assert _recorded() == []


def test_a_failing_meter_never_reaches_the_relay(send, monkeypatch):
    def broken(tokens):
        raise RuntimeError("pricing is broken")

    monkeypatch.setattr(anthropic_proxy, "price_usd", broken)
    resp = send(_streamed(_STREAM))
    assert resp.status_code == 200 and resp.content == _STREAM
    assert _recorded() == []


# ── the agent behind each call ─────────────────────────────────

# The main thread's system prompt: the claude_code preset, whose own `# ` headings come
# before the hosted prompt appended to it.
_MAIN_SYSTEM = (
    "You are Claude Code, Anthropic's official CLI for Claude.\n\n# Tone and style\n"
    "Be concise.\n\n# Doing tasks\nPlan first.\n\n"
    f"{anthropic_proxy._MAIN_MARKER}. The active research project lives in your current "
    "working directory."
)
# A named subagent's, as the CLI sends it: a billing block and the identity line, then the
# agent body verbatim, then its notes and environment.
_SUBAGENT_SYSTEM = [
    {"type": "text", "text": "x-anthropic-billing-header: cc_version=2.1.220; cc_is_subagent=true;"},
    {"type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude.",
     "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "# Record Structurer\n\nTurn one record into assertions.\n\n"
                             "Notes:\n- Use absolute paths.\n\nHere is useful information "
                             "about the environment you are running in:"},
]


@pytest.mark.parametrize("system, agent", [
    (_MAIN_SYSTEM, "main"),
    (_SUBAGENT_SYSTEM, "Record Structurer"),
    (None, None),
    ({"text": "# Not a block list"}, None),
    ("You are a helpful AI assistant tasked with summarizing conversations.", None),
], ids=["main-thread", "subagent", "no-system", "not-text", "no-heading"])
def test_each_call_records_the_agent_that_made_it(send, system, agent):
    request = {"model": "claude-sonnet-4-6", "messages": []}
    if system is not None:
        request["system"] = system
    resp = send(_streamed(_STREAM), request_json=request)
    assert resp.status_code == 200 and resp.content == _STREAM
    [row] = _recorded()
    assert row.agent == agent


def test_a_body_that_is_not_json_is_relayed_untouched_and_recorded_with_no_agent(send):
    raw = b'{"model": "claude-sonnet-4-6", "system": "# Record Structurer'  # cut off
    seen = []

    def respond(req):
        seen.append(req.content)
        return httpx.Response(200, content=_STREAM, headers={"content-type": "text/event-stream"})

    resp = send(respond, request_json=raw)
    assert seen == [raw], "the proxy changed the request body"
    assert resp.status_code == 200 and resp.content == _STREAM
    [row] = _recorded()
    assert row.agent is None and row.output_tokens == _FINAL[3]


@pytest.mark.parametrize("extra, effort", [
    ({"output_config": {"effort": "medium"}}, "medium"),
    ({"output_config": {"effort": "high", "format": None}}, "high"),
    ({"effort": "medium"}, None),
    ({"output_config": "medium"}, None),
    ({"output_config": {"effort": 3}}, None),
    ({}, None),
], ids=["medium", "high", "top-level-only", "not-a-dict", "not-a-string", "absent"])
def test_each_call_records_the_effort_it_asked_for(send, extra, effort):
    """T4.1: read from `output_config.effort`, where the CLI puts it; anything else is null
    and the call is still relayed and recorded."""
    resp = send(_streamed(_STREAM), request_json={"model": "claude-sonnet-4-6", "messages": [],
                                                  **extra})
    assert resp.status_code == 200 and resp.content == _STREAM
    [row] = _recorded()
    assert row.effort == effort


def _stream_with_split(model, split: dict) -> bytes:
    return _sse(
        ("message_start", {"type": "message_start", "message": {
            "model": model,
            "usage": {"input_tokens": 100, "cache_creation_input_tokens": 2000,
                      "cache_read_input_tokens": 30000, "output_tokens": 1,
                      **({"cache_creation": split} if split is not None else {})}}}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
                           "usage": {"output_tokens": 120}}),
        ("message_stop", {"type": "message_stop"}),
    )


@pytest.mark.parametrize("model", ["claude-sonnet-4-6", None], ids=["known-model", "no-model"])
def test_a_1h_cache_write_is_recorded_and_priced_at_2x_input(send, model):
    """The split is a nested object, which the meter's int filter used to drop -- every
    write priced at the 5-minute 1.25x. A call with no model still records a row, priced at
    the PRICE_PER_MTOK fallback (a KeyError there would be swallowed and the row lost)."""
    resp = send(_streamed(_stream_with_split(model, {"ephemeral_5m_input_tokens": 0,
                                                     "ephemeral_1h_input_tokens": 2000})))
    assert resp.status_code == 200
    [row] = _recorded()
    assert row.cache_creation_1h_input_tokens == 2000
    assert row.cost_usd == pytest.approx(price_usd(_FINAL, model, cache_write_1h=2000))
    assert row.cost_usd > price_usd(_FINAL, model)


@pytest.mark.parametrize("split", [None, {}, {"ephemeral_1h_input_tokens": "2000"},
                                   {"ephemeral_1h_input_tokens": 999_999}],
                         ids=["absent", "empty", "not-an-int", "over-the-total"])
def test_the_split_reads_0_unless_it_is_a_count_and_never_exceeds_the_writes(send, split):
    send(_streamed(_stream_with_split("claude-sonnet-4-6", split)))
    [row] = _recorded()
    expect = 2000 if split and split.get("ephemeral_1h_input_tokens") == 999_999 else 0
    assert row.cache_creation_1h_input_tokens == expect
    assert row.cost_usd == pytest.approx(price_usd(_FINAL, "claude-sonnet-4-6", cache_write_1h=expect))


def test_a_body_that_is_not_json_records_no_effort(send):
    raw = b'{"model": "claude-sonnet-4-6", "output_config": {"effort": "medium"'  # cut off
    resp = send(lambda req: httpx.Response(200, content=_STREAM,
                                           headers={"content-type": "text/event-stream"}),
                request_json=raw)
    assert resp.status_code == 200 and resp.content == _STREAM
    [row] = _recorded()
    assert row.effort is None


def test_the_agent_is_named_in_the_writer_thread_not_in_the_route(send, monkeypatch):
    """Parsed in the route, a 100–500 KB body would hold up the relay and a bad one would
    raise into it; in the writer thread the parse waits for the stream to end, and a
    failure only leaves the agent null."""
    threads = []
    real = anthropic_proxy._agent_name

    def spy(request_body):
        threads.append(threading.current_thread().name)
        return real(request_body)

    monkeypatch.setattr(anthropic_proxy, "_agent_name", spy)
    send(_streamed(_STREAM), request_json={"model": "claude-sonnet-4-6", "messages": [],
                                           "system": "# Locality Guide\n\nFind the records."})
    [row] = _recorded()
    assert row.agent == "Locality Guide"
    assert threads and all(t.startswith("api-usage") for t in threads), threads


def test_the_main_marker_opens_the_hosted_prompt_and_no_agent_body(tmp_path):
    """Reworded in `real_agent.build_options`, the marker would stop matching and every
    main-thread call would be named after the preset's first heading."""
    from pathlib import Path

    from app.agent import real_agent

    appended = real_agent.build_options(tmp_path).system_prompt["append"]
    assert appended.startswith(anthropic_proxy._MAIN_MARKER)
    bodies = sorted((Path(real_agent._PLUGIN_DIR) / "agents").glob("*.md"))
    assert bodies
    assert [b.name for b in bodies if anthropic_proxy._MAIN_MARKER in b.read_text(encoding="utf-8")] == []
