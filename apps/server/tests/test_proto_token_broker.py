"""The host token broker (proto/token_broker.py): GET /token answers a token or 503, never
logs it, serialises refreshes, and binds 127.0.0.1. No engine, no network beyond loopback."""

from __future__ import annotations

import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from proto import token_broker


def _serve(fetch, min_life="30"):
    server = ThreadingHTTPServer(("127.0.0.1", 0), token_broker.make_handler(fetch, min_life))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def test_get_token_answers_the_token_and_passes_min_life():
    seen: list[str] = []
    server, base = _serve(lambda m: (seen.append(m), ("tok-abc", ""))[1], min_life="42")
    try:
        with urllib.request.urlopen(f"{base}/token", timeout=5) as r:
            assert r.status == 200 and r.read().decode("utf-8") == "tok-abc"
        assert seen == ["42"]
    finally:
        server.shutdown()


def test_a_failed_refresh_is_a_503_with_the_reason_and_other_paths_404(capsys):
    server, base = _serve(lambda m: ("", "log in again with make e2e-login"))
    try:
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(f"{base}/token", timeout=5)
        assert err.value.code == 503 and b"e2e-login" in err.value.read()
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(f"{base}/other", timeout=5)
        assert err.value.code == 404
    finally:
        server.shutdown()


def test_the_token_is_never_logged(capsys):
    server, base = _serve(lambda m: ("secret-token-value", ""))
    try:
        urllib.request.urlopen(f"{base}/token", timeout=5).read()
    finally:
        server.shutdown()
    assert "secret-token-value" not in capsys.readouterr().err


def test_concurrent_asks_are_serialised():
    active = {"n": 0, "max": 0}
    gate = threading.Lock()

    def fetch(m):
        with gate:
            active["n"] += 1
            active["max"] = max(active["max"], active["n"])
        threading.Event().wait(0.05)
        with gate:
            active["n"] -= 1
        return "tok", ""

    server, base = _serve(fetch)
    try:
        threads = [threading.Thread(target=lambda: urllib.request.urlopen(f"{base}/token", timeout=5).read()) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        server.shutdown()
    assert active["max"] == 1, "two refreshes at once would revoke each other's token"


@pytest.mark.parametrize("env, expected", [
    ({}, "30"), ({"READ_TIMEOUT_S": "7200"}, "120"), ({"PROTO_TOKEN_MIN_LIFE": "45", "READ_TIMEOUT_S": "7200"}, "45"),
])
def test_min_life_defaults_to_the_step_ceiling_in_minutes(env, expected):
    assert token_broker.min_life_minutes(env) == expected


def test_fetch_token_shells_to_fs_token_with_min_life(monkeypatch, tmp_path):
    calls = []

    class Done:
        returncode, stdout, stderr = 0, "tok\n", ""

    monkeypatch.setattr(token_broker.subprocess, "run", lambda cmd, **kw: (calls.append((cmd, kw)), Done())[1])
    assert token_broker.fetch_token("30", tmp_path) == ("tok", "")
    cmd, kw = calls[0]
    assert cmd == ["npx", "tsx", "dev/fs-token.ts", "--min-life", "30"] and kw["cwd"] == tmp_path and kw["encoding"] == "utf-8"
    Done.returncode, Done.stdout, Done.stderr = 2, "", "refresh token rejected"
    assert token_broker.fetch_token("30", tmp_path) == ("", "refresh token rejected")
