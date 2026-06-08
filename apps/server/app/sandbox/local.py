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
import socket
import subprocess
import sys
from pathlib import Path

from ..config import get_settings
from ..ws_token import sandbox_secret
from .base import (
    PROJECT_DIR,
    ConnectURL,
    DirEntry,
    ExecResult,
    Sandbox,
    SandboxProvider,
    SandboxSpec,
    SandboxState,
)

# apps/server, so the WS-server subprocess can `python -m app.sandbox_server`.
SERVER_ROOT = Path(__file__).resolve().parents[2]


async def _wait_until_accepting(port: int, *, timeout: float = 10.0) -> bool:
    """Block until a TCP connect to 127.0.0.1:port succeeds — i.e. the in-sandbox
    WS server has bound and is accepting — or `timeout` elapses.

    Closes the WS startup race: `/connect` must NOT hand the browser a wssUrl
    before the server is listening. The server's cold-start bind is ~40ms, while
    the local `/connect` round trip is faster, so without this gate the browser's
    single (no-retry) WebSocket attempt reliably arrives first, is refused, and
    the turn hangs forever on "working…". Reused/already-live servers pass on the
    first probe. Returns False on timeout (caller still returns the URL; the
    client's reconnect is the backstop) rather than failing /connect outright."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    delay = 0.01
    while True:
        try:
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return True
        except OSError:
            if loop.time() >= deadline:
                return False
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 0.1)


def _sandbox_rel(path: str) -> str:
    return path.lstrip("/")


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
        return SandboxState.RUNNING if self._provider.live_server(self._id) else SandboxState.SUSPENDED

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

    async def expose_port(self, port: int) -> ConnectURL:
        # Local: run the in-sandbox WS server (the same sandbox_server.py E2B boots)
        # as a subprocess on a free 127.0.0.1 port and hand the browser that URL —
        # the unified, provider-agnostic path. `port` (the canonical 8080) is
        # ignored; each local sandbox gets its own free port.
        p = self._provider.ensure_server(
            self._id, self.project_path, self.agent_home_dir(), self.model
        )
        # Gate on readiness: don't hand the browser a wssUrl until the server is
        # actually accepting (closes the startup race — see _wait_until_accepting).
        await _wait_until_accepting(p)
        return ConnectURL(url=f"ws://127.0.0.1:{p}")

    def agent_project_dir(self) -> str:
        # Local subprocess sees the real filesystem, not a sandbox-absolute map.
        return str(self.project_path)

    def agent_home_dir(self) -> str:
        # Per-sandbox HOME so ~/.familysearch-mcp is isolated to this session.
        return str(self._abs("/home/user"))


class LocalProvider(SandboxProvider):
    def __init__(self, sandboxes_dir: Path):
        self._dir = sandboxes_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        # The in-sandbox WS server per sandbox (the unified transport): (proc, port).
        self._servers: dict[str, tuple[subprocess.Popen, int]] = {}

    # ── in-sandbox WS server (unified transport) ──────────────────
    def live_server(self, sandbox_id: str) -> tuple[subprocess.Popen, int] | None:
        entry = self._servers.get(sandbox_id)
        if entry and entry[0].poll() is None:
            return entry
        self._servers.pop(sandbox_id, None)
        return None

    def ensure_server(self, sandbox_id: str, project_dir: Path, home_dir: str, model: str) -> int:
        """Start (or reuse) the WS server subprocess for this sandbox; return its
        127.0.0.1 port. Mirrors E2BProvider.create launching sandbox_server."""
        live = self.live_server(sandbox_id)
        if live:
            return live[1]
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        settings = get_settings()
        Path(home_dir).mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "WS_PORT": str(port),
            "WS_TOKEN_SECRET": sandbox_secret(sandbox_id),
            "PROJECT_DIR": str(project_dir),
            "HOME": home_dir,
            "AGENT_MODE": settings.agent_mode,
            "MODEL": model,
            "PYTHONPATH": str(SERVER_ROOT),  # so `-m app.sandbox_server` resolves
        }
        if settings.anthropic_api_key:
            env["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
        log = open(self._root(sandbox_id) / "ws.log", "ab")
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.sandbox_server"],
            env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        self._servers[sandbox_id] = (proc, port)
        return port

    async def _kill_server(self, proc: subprocess.Popen) -> None:
        if proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)  # kills server + agent (new session)
            except (ProcessLookupError, PermissionError):
                proc.terminate()
        try:
            await asyncio.to_thread(proc.wait, 5)
        except Exception:
            proc.kill()

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
        entry = self._servers.pop(sandbox_id, None)
        if entry is not None:
            await self._kill_server(entry[0])

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
        for entry in list(self._servers.values()):
            await self._kill_server(entry[0])
        self._servers.clear()
