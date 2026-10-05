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
           "WORKER_TURN_USERS": "none", "MODEL_PROVIDER": "anthropic",
           "TOOL_SERVER_URL": "http://tools:8787/mcp",
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


# U12 D27: the plugin hook's interpreter. check_hook_python takes the interpreter's
# directory as an argument, so these run on temporary directories rather than by
# shadowing PATH -- a venv's bin/ always carries a python3, so only exe_dir can fail.

def _fake_python3(directory: Path, version: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    exe = directory / "python3"
    exe.write_text(f"#!/bin/sh\necho {version}\n", encoding="utf-8")
    exe.chmod(0o755)
    return exe


def _refused_exit(monkeypatch, exe_dir: str, path: str) -> tuple[int, list[dict]]:
    from proto.worker import worker

    logged: list[dict] = []
    monkeypatch.setattr(worker, "log", lambda **f: logged.append(f))
    with pytest.raises(SystemExit) as exc:
        worker.require_hook_python(exe_dir, path)
    return exc.value.code, logged


def test_hook_python_refuses_a_3_9_interpreter_dir(tmp_path, monkeypatch):
    from proto.worker import worker

    exe = _fake_python3(tmp_path / "bin", "3.9.18")
    assert worker.check_hook_python(str(tmp_path / "bin"), "") == (str(exe), "3.9.18", "too_old")
    code, logged = _refused_exit(monkeypatch, str(tmp_path / "bin"), "")
    assert code == 2
    assert [(f["ev"], f["step"], f["error"]) for f in logged] == [("prepare", "hook_python", "too_old")]


def test_hook_python_refuses_when_no_python3_is_found(tmp_path, monkeypatch):
    from proto.worker import worker

    (tmp_path / "bin").mkdir()
    (tmp_path / "elsewhere").mkdir()
    assert worker.check_hook_python(str(tmp_path / "bin"), str(tmp_path / "elsewhere")) == (None, None, "missing")
    code, logged = _refused_exit(monkeypatch, str(tmp_path / "bin"), str(tmp_path / "elsewhere"))
    assert code == 2
    assert [(f["ev"], f["step"], f["error"]) for f in logged] == [("prepare", "hook_python", "missing")]


def test_hook_python_prefers_the_interpreter_dir_over_an_older_path_entry(tmp_path):
    from proto.worker import worker

    exe = _fake_python3(tmp_path / "venv-bin", "3.12.4")
    _fake_python3(tmp_path / "usr-bin", "3.9.18")
    assert worker.check_hook_python(str(tmp_path / "venv-bin"), str(tmp_path / "usr-bin")) == (
        str(exe), "3.12.4", None)
    assert worker.require_hook_python(str(tmp_path / "venv-bin"), str(tmp_path / "usr-bin")) == f"{exe} 3.12.4"


@pytest.mark.parametrize("path, tail", [("/usr/local/bin:/usr/bin", "/usr/local/bin:/usr/bin"), (None, None), ("", None)])
def test_hook_python_child_path_starts_with_the_interpreter_dir(tmp_path, path, tail):
    from proto.worker import options

    worker_env = {"MODEL_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "sk-test", "TMPDIR": "/tmp",
                  "TOOL_SERVER_URL": "http://tools:8787/mcp"}
    if path is not None:
        worker_env["PATH"] = path
    opts = options.build_worker_options(
        project_id="proj-1", cwd="/project", plugin_dir="/opt/genealogy/plugin", agents={},
        store=object(), config_dir=str(tmp_path), pretool_hook=lambda *a: {},
        posttool_hook=lambda *a: {}, worker_env=worker_env, bearer="grant-token",
    )
    exe_dir = os.path.dirname(sys.executable)
    assert opts.env["PATH"] == (exe_dir if tail is None else f"{exe_dir}{os.pathsep}{tail}")


def test_hook_python_start_reports_the_real_interpreter(tmp_path):
    tmpdir = tmp_path / "tmp"
    tmpdir.mkdir()
    proc, lines = _start(tmp_path, str(tmpdir))
    try:
        start, seen = _wait_for(lines, "start", timeout=10)
        assert start is not None, seen
        assert not any(line.get("step") == "hook_python" for line in seen), seen
        exe, _, version = start["hook_python"].rpartition(" ")
        assert Path(exe).parent == Path(sys.executable).parent, start["hook_python"]
        assert tuple(int(part) for part in version.split("."))[:2] >= (3, 10), start["hook_python"]
    finally:
        _stop(proc)
