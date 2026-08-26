"""The env LocalProvider hands its sandbox subprocesses (issue #1715 follow-up).

`PYTHONUTF8` is load-bearing on Windows only: without it `sandbox_server`
encodes its stdout with the platform default (cp1252), the first non-ASCII
agent summary raises `UnicodeEncodeError` inside `_pump`, and the client hangs
on a broadcast that never happens. Every CI job runs on Linux, where the
variable does nothing and its removal is invisible — so this test is the only
thing standing between a deleted line and a silently reintroduced hang.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.sandbox import local as local_mod
from app.sandbox.local import LocalProvider


class _FakeProc:
    """Enough of Popen for ensure_server: it only stores the handle and polls."""

    def poll(self) -> int | None:
        return None


def test_ensure_server_env_carries_pythonutf8(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_popen(argv, *, env=None, **kwargs):
        captured.update(env or {})
        return _FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(local_mod.subprocess, "Popen", fake_popen)

    provider = LocalProvider(tmp_path / "sandboxes")
    (provider._root("sbx_test")).mkdir(parents=True, exist_ok=True)
    provider.ensure_server(
        "sbx_test",
        project_dir=tmp_path / "project",
        home_dir=str(tmp_path / "home"),
        model="claude-sonnet-5",
    )

    assert captured.get("PYTHONUTF8") == "1"
