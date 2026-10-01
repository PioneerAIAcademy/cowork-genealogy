"""U10 D4/D5 against a real process: ``proto/worker/worker.py`` run as the image runs it,
with no Postgres (``PG_DSN`` names a refused port) and no model.

- a bad ``TMPDIR`` exits 2 with one named line and never listens;
- a writable one (or none) starts, and a down Postgres no longer stalls the bind: the
  worker listens at once, answers ``/healthz`` 503, and still exits 0 on SIGTERM while
  its schema thread is backing off.

Nothing here reaches a ``proto-*`` container or the default ``localhost:5434``."""

from __future__ import annotations

import http.client
import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
WORKER = SERVER / "proto" / "worker" / "worker.py"
REFUSED_DSN = "postgresql://probeuser:secretpw@127.0.0.1:1/proto"
GRACE_S = 2.0

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals and modes")


def _start(tmp_path: Path, tmpdir: str | None) -> tuple[subprocess.Popen, "queue.Queue[dict]"]:
    cwd = tmp_path / "project"
    cwd.mkdir(exist_ok=True)
    env = {**os.environ, "PORT": "0", "PG_DSN": REFUSED_DSN, "WORKER_CWD": str(cwd), "QUEUE_URL": "",
           "SWEEP_INTERVAL_S": "0", "SHUTDOWN_GRACE_S": str(GRACE_S), "PYTHONUNBUFFERED": "1"}
    env.pop("SQSD_MAX_RETRIES", None)
    env.pop("SQSD_RETENTION_PERIOD_S", None)
    if tmpdir is None:
        env.pop("TMPDIR", None)
    else:
        env["TMPDIR"] = tmpdir
    proc = subprocess.Popen([sys.executable, str(WORKER)], cwd=SERVER, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    lines: queue.Queue[dict] = queue.Queue()

    def pump() -> None:
        for line in proc.stdout:
            try:
                lines.put(json.loads(line))
            except ValueError:
                lines.put({"raw": line})

    threading.Thread(target=pump, daemon=True).start()
    return proc, lines


def _wait_for(lines: "queue.Queue[dict]", ev: str, timeout: float) -> tuple[dict | None, list[dict]]:
    deadline = time.monotonic() + timeout
    seen: list[dict] = []
    while time.monotonic() < deadline:
        try:
            line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
        except queue.Empty:
            break
        seen.append(line)
        if line.get("ev") == ev:
            return line, seen
    return None, seen


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.kill()
        proc.wait()


def _bad_tmpdir(kind: str, tmp_path: Path) -> str:
    if kind == "missing":
        return str(tmp_path / "missing")
    if kind == "file":
        path = tmp_path / "a-file"
        path.write_text("x", encoding="utf-8")
        return str(path)
    if kind == "read-only":
        path = tmp_path / "read-only"
        path.mkdir()
        path.chmod(0o555)
        return str(path)
    return "relative/tmp"


@pytest.mark.parametrize("kind, label", [
    ("missing", "ENOENT"), ("file", "ENOTDIR"), ("read-only", "EACCES"), ("relative", "not_absolute"),
])
def test_bad_tmpdir_exits_2_before_listening(tmp_path, kind, label):
    if kind == "read-only" and os.geteuid() == 0:
        pytest.skip("root writes through 0555")
    proc, lines = _start(tmp_path, _bad_tmpdir(kind, tmp_path))
    try:
        code = proc.wait(timeout=5)
    finally:
        _stop(proc)
        if kind == "read-only":
            (tmp_path / "read-only").chmod(0o755)
    _, seen = _wait_for(lines, "never", timeout=0.5)
    assert code == 2, seen
    named = [line for line in seen if line.get("ev") == "prepare" and line.get("step") == "tmpdir"]
    assert len(named) == 1 and named[0]["error"] == label, seen
    assert not any(line.get("ev") == "start" for line in seen), "it must never listen"


@pytest.mark.parametrize("kind", ["tmp-style-dir", "unset"])
def test_a_writable_tmpdir_starts(tmp_path, kind):
    tmpdir = tmp_path / "tmp"
    tmpdir.mkdir()
    proc, lines = _start(tmp_path, str(tmpdir) if kind == "tmp-style-dir" else None)
    try:
        start, seen = _wait_for(lines, "start", timeout=10)
        assert start is not None, seen
        assert not any(line.get("step") == "tmpdir" for line in seen)
    finally:
        _stop(proc)


def test_worker_listens_and_answers_503_with_postgres_down(tmp_path):
    tmpdir = tmp_path / "tmp"
    tmpdir.mkdir()
    proc, lines = _start(tmp_path, str(tmpdir))
    try:
        launched = time.monotonic()
        start, seen = _wait_for(lines, "start", timeout=5)
        assert start is not None, f"no ev=start within 5 s (the old schema loop waited ~30 s): {seen}"
        assert time.monotonic() - launched < 5
        conn = http.client.HTTPConnection("127.0.0.1", start["port"], timeout=5)
        conn.request("GET", "/healthz")
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        conn.close()
        assert response.status == 503, body
        assert body["checks"]["postgres"] == {"ok": False, "error": "OperationalError"}
        assert body["checks"]["schema"]["ok"] is False
        assert proc.poll() is None, "a down store never exits the worker"
        proc.send_signal(signal.SIGTERM)
        code = proc.wait(timeout=GRACE_S + 2)
        assert code == 0, "the schema thread backing off must not hold the process open"
    finally:
        _stop(proc)
