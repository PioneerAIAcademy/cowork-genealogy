"""LocalProvider — the POC sandbox provider. No microVM, no E2B account: each
"sandbox" is a directory under .workbench-data/sandboxes/<id>/ and the agent
runs as a local subprocess. It implements the exact same SandboxProvider /
Sandbox contract as the future E2BProvider, so the control plane is written
once. Project files persist on disk across suspend/resume (mirrors E2B's pause
snapshot of the FS).
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import subprocess
from collections.abc import Callable
from pathlib import Path

from .base import (
    PROJECT_DIR,
    ConnectURL,
    DirEntry,
    ExecResult,
    Process,
    Sandbox,
    SandboxProvider,
    SandboxSpec,
    SandboxState,
)


def _sandbox_rel(path: str) -> str:
    return path.lstrip("/")


class LocalProcess(Process):
    def __init__(self, proc: subprocess.Popen):
        self._proc = proc

    @property
    def pid(self) -> str:
        return str(self._proc.pid)

    async def is_alive(self) -> bool:
        return self._proc.poll() is None

    async def kill(self) -> None:
        if self._proc.poll() is None:
            try:
                self._proc.send_signal(signal.SIGTERM)
                await asyncio.sleep(0.2)
                if self._proc.poll() is None:
                    self._proc.kill()
            except ProcessLookupError:
                pass


class LocalSandbox(Sandbox):
    def __init__(self, sandbox_id: str, root: Path, provider: "LocalProvider", model: str):
        self._id = sandbox_id
        self._root = root
        self._provider = provider
        self._model = model

    @property
    def id(self) -> str:
        return self._id

    @property
    def root(self) -> Path:
        return self._root

    @property
    def project_path(self) -> Path:
        return self._root / "project"

    @property
    def model(self) -> str:
        return self._model

    @property
    def state(self) -> SandboxState:
        if not self._root.exists():
            return SandboxState.MISSING
        proc = self._provider.live_process(self._id)
        return SandboxState.RUNNING if proc else SandboxState.SUSPENDED

    def _abs(self, path: str) -> Path:
        return self._root / _sandbox_rel(path)

    # ── filesystem ───────────────────────────────────────────────
    async def read_file(self, path: str) -> bytes | None:
        p = self._abs(path)
        if not p.is_file():
            return None
        return await asyncio.to_thread(p.read_bytes)

    async def write_file(self, path: str, data: bytes) -> None:
        p = self._abs(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(p.write_bytes, data)

    async def file_mtime(self, path: str) -> float | None:
        p = self._abs(path)
        if not p.is_file():
            return None
        return p.stat().st_mtime

    async def list_dir(self, path: str) -> list[DirEntry]:
        p = self._abs(path)
        if not p.is_dir():
            return []
        out: list[DirEntry] = []
        for child in sorted(p.iterdir()):
            out.append(
                DirEntry(name=child.name, path=f"{path.rstrip('/')}/{child.name}", is_dir=child.is_dir())
            )
        return out

    # ── process / exec ───────────────────────────────────────────
    async def exec(
        self, cmd: str, *, cwd: str | None = None, env: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> ExecResult:
        workdir = self._abs(cwd) if cwd else self.project_path
        full_env = {**os.environ, **(env or {})}
        proc = await asyncio.create_subprocess_shell(
            cmd, cwd=str(workdir), env=full_env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return ExecResult(proc.returncode or 0, out.decode(), err.decode())

    async def start_process(
        self, cmd: str, *, cwd: str | None = None, env: dict[str, str] | None = None,
    ) -> Process:
        workdir = self._abs(cwd) if cwd else self.project_path
        full_env = {**os.environ, **(env or {})}
        # Line-buffered, own process group so we can clean it up on suspend.
        proc = subprocess.Popen(
            cmd, cwd=str(workdir), env=full_env, shell=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        handle = LocalProcess(proc)
        self._provider.register_process(self._id, handle)
        return handle

    async def expose_port(self, port: int) -> ConnectURL:
        # Local: the subprocess binds 127.0.0.1:<port> directly.
        return ConnectURL(url=f"ws://127.0.0.1:{port}")

    # ── project change events (polling) ──────────────────────────
    def watch_project(self, on_change: Callable[[str], None]) -> Callable[[], None]:
        project = self.project_path
        seen: dict[str, float] = {}

        async def poll() -> None:
            # Prime the mtime cache so we only emit genuine post-connect changes.
            for f in project.rglob("*"):
                if f.is_file():
                    try:
                        seen[str(f.relative_to(project))] = f.stat().st_mtime
                    except OSError:
                        pass
            while True:
                await asyncio.sleep(0.7)
                try:
                    for f in project.rglob("*"):
                        if not f.is_file():
                            continue
                        rel = str(f.relative_to(project))
                        try:
                            mtime = f.stat().st_mtime
                        except OSError:
                            continue
                        if seen.get(rel) != mtime:
                            seen[rel] = mtime
                            on_change(rel)
                except (OSError, FileNotFoundError):
                    continue

        task = asyncio.create_task(poll())

        def stop() -> None:
            task.cancel()

        return stop


class LocalProvider(SandboxProvider):
    def __init__(self, sandboxes_dir: Path):
        self._dir = sandboxes_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        self._procs: dict[str, LocalProcess] = {}

    # process registry (drives RUNNING vs SUSPENDED) ──────────────
    def register_process(self, sandbox_id: str, proc: LocalProcess) -> None:
        self._procs[sandbox_id] = proc

    def live_process(self, sandbox_id: str) -> LocalProcess | None:
        proc = self._procs.get(sandbox_id)
        if proc is None:
            return None
        if proc._proc.poll() is not None:  # exited
            self._procs.pop(sandbox_id, None)
            return None
        return proc

    def _root(self, sandbox_id: str) -> Path:
        return self._dir / sandbox_id

    def _load_meta(self, sandbox_id: str) -> dict:
        meta = self._root(sandbox_id) / "meta.json"
        if meta.is_file():
            try:
                return json.loads(meta.read_text())
            except json.JSONDecodeError:
                return {}
        return {}

    async def create(self, spec: SandboxSpec) -> Sandbox:
        import uuid

        sandbox_id = "sbx_" + uuid.uuid4().hex[:16]
        root = self._root(sandbox_id)
        (root / "project").mkdir(parents=True, exist_ok=True)
        (root / "project" / "results").mkdir(parents=True, exist_ok=True)
        (root / "meta.json").write_text(
            json.dumps({"labels": spec.labels, "model": spec.model, "template": spec.template})
        )
        return LocalSandbox(sandbox_id, root, self, spec.model)

    async def get(self, sandbox_id: str) -> Sandbox:
        meta = self._load_meta(sandbox_id)
        return LocalSandbox(
            sandbox_id, self._root(sandbox_id), self, meta.get("model", "claude-sonnet-4-6")
        )

    async def resume(self, sandbox_id: str) -> Sandbox:
        # Local dirs are always warm; nothing to rewarm. The control plane
        # re-launches the agent process separately on connect.
        return await self.get(sandbox_id)

    async def suspend(self, sandbox_id: str) -> None:
        proc = self._procs.pop(sandbox_id, None)
        if proc is not None:
            await proc.kill()

    async def delete(self, sandbox_id: str) -> None:
        await self.suspend(sandbox_id)
        root = self._root(sandbox_id)
        if root.exists():
            await asyncio.to_thread(shutil.rmtree, root, ignore_errors=True)

    async def list(self, labels: dict[str, str] | None = None) -> list[Sandbox]:
        out: list[Sandbox] = []
        for child in self._dir.iterdir():
            if not child.is_dir():
                continue
            meta = self._load_meta(child.name)
            if labels and not all(meta.get("labels", {}).get(k) == v for k, v in labels.items()):
                continue
            out.append(LocalSandbox(child.name, child, self, meta.get("model", "claude-sonnet-4-6")))
        return out

    async def aclose(self) -> None:
        for proc in list(self._procs.values()):
            await proc.kill()
        self._procs.clear()
