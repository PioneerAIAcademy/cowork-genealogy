"""U5 D2 against a real process: the worker's own ``main()`` in a subprocess, a real
``POST /turn`` in flight, a real SIGTERM. The harness (proto_shutdown_harness.py)
replaces only Postgres, the plugin load and the attempt's body; CI has no Postgres.

Without the handler a non-PID-1 Python dies of the signal (-15) and the POST gets no
reply -- sqsd would then wait out VisibilityTimeout, 10 h at the interim values. The
PID-1 case (SIGTERM ignored) is the compose ``sigterm`` smoke case's."""

from __future__ import annotations

import http.client
import json
import os
import queue
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "proto_shutdown_harness.py"
GRACE_S = 5.0

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _lines(proc: subprocess.Popen) -> "queue.Queue[dict]":
    out: queue.Queue[dict] = queue.Queue()

    def pump() -> None:
        for line in proc.stdout:
            try:
                out.put(json.loads(line))
            except ValueError:
                out.put({"raw": line})

    threading.Thread(target=pump, daemon=True).start()
    return out


def _wait_for(lines: "queue.Queue[dict]", ev: str, timeout: float = 20,
              seen: list[dict] | None = None) -> dict:
    """The first ``ev`` line; every line skipped on the way goes into ``seen``."""
    deadline = time.monotonic() + timeout
    seen = [] if seen is None else seen
    while time.monotonic() < deadline:
        try:
            line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
        except queue.Empty:
            break
        seen.append(line)
        if line.get("ev") == ev:
            return line
    raise AssertionError(f"no ev={ev} within {timeout}s; saw {seen}")


def _sigterm_one_post(max_retries: int) -> tuple[int, dict, int, float, "queue.Queue[dict]"]:
    """Start the harness, POST one real turn on receive 1, SIGTERM once its attempt runs.
    Returns (status, reply, exit code, seconds from the signal to the exit, log lines)."""
    port = _free_port()
    env = {**os.environ, "PORT": str(port), "SHUTDOWN_GRACE_S": str(GRACE_S), "QUEUE_URL": "",
           "WORKER_TURN_USERS": "none", "MODEL_PROVIDER": "anthropic",
           "TOOL_SERVER_URL": "http://tools:8787/mcp",
           "SWEEP_INTERVAL_S": "0", "SQSD_MAX_RETRIES": str(max_retries), "PYTHONUNBUFFERED": "1"}
    env.pop("SQSD_RETENTION_PERIOD_S", None)
    proc = subprocess.Popen([sys.executable, str(HARNESS)], cwd=SERVER, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    try:
        lines = _lines(proc)
        early: list[dict] = []
        start = _wait_for(lines, "start", seen=early)
        assert start["shutdown_grace_s"] == GRACE_S and start["sweep"] is False
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        body = json.dumps({"turn_id": "turn-sig", "session_id": "sess-sig", "project_id": "proj-sig",
                           "text": "hello"})
        conn.request("POST", "/turn", body=body, headers={"Content-Type": "application/json",
                                                          "X-Aws-Sqsd-Receive-Count": "1"})
        _wait_for(lines, "harness_attempt", seen=early)
        while not lines.empty():
            early.append(lines.get_nowait())
        # U10: the schema thread's connect also passes connect_timeout; a release line
        # before the signal would let the last-receive case pass without a release.
        assert not any(line.get("ev") == "harness_release" for line in early), early
        proc.send_signal(signal.SIGTERM)
        signalled = time.monotonic()
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        code = proc.wait(timeout=GRACE_S + 5)
        return response.status, payload, code, time.monotonic() - signalled, lines
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def test_sigterm_answers_inflight_500_and_exits_0():
    status, payload, code, elapsed, lines = _sigterm_one_post(max_retries=0)
    assert status == 500, payload
    assert payload == {"ok": False, "turn_id": "turn-sig", "error": "worker shutting down", "shutdown": True}
    assert code == 0, f"exit {code}: the SDK's atexit reaper runs only on a normal exit"
    assert elapsed <= GRACE_S + 1, "the grace, plus the harness's late ev=shutdown"
    shutdown = _wait_for(lines, "shutdown", timeout=2)
    assert shutdown["answered"] == ["turn-sig"] and shutdown["drained"] is True, \
        "the attempt's cancel scope ran its finally inside the grace"


def test_sigterm_on_the_last_receive_releases_before_the_process_exits():
    """The deferred release and ev=shutdown run on the daemon shutdown thread after
    serve_forever returns; main() must wait for them, or the exit drops both."""
    status, payload, code, _, lines = _sigterm_one_post(max_retries=1)
    assert status == 200 and payload["outcome"] == "retries_exhausted" and payload["cause"] == "shutdown", payload
    assert code == 0
    _wait_for(lines, "harness_release", timeout=2)
    shutdown = _wait_for(lines, "shutdown", timeout=2)
    assert shutdown["answered"] == [] and shutdown["drained"] is True
