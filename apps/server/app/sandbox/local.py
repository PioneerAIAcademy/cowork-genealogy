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
    SECRETS_PATH,
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
        full_env.pop("ANTHROPIC_API_KEY", None)
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


#: The module the WS-server subprocess runs. Named once: the launch argv, the
#: on-disk record and the reaper's ownership check must all agree, and a reaper
#: matching the wrong string silently reaps nothing.
SERVER_MODULE = "app.sandbox_server"


class LocalProvider(SandboxProvider):
    def __init__(self, sandboxes_dir: Path):
        self._dir = sandboxes_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        # The in-sandbox WS server per sandbox (the unified transport): (proc, port).
        self._servers: dict[str, tuple[subprocess.Popen, int]] = {}

    def _abs_secrets(self, sandbox_id: str) -> Path:
        """Host path that LocalSandbox.write_file(SECRETS_PATH) lands on — the
        same `root / <path minus leading slash>` mapping LocalSandbox._abs uses."""
        return self._root(sandbox_id) / _sandbox_rel(SECRETS_PATH)

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
            "AUTO_CONTINUE": "1" if settings.auto_continue else "0",
            "AUTO_CONTINUE_MAX_STEPS": str(settings.auto_continue_max_steps),
            # 1d, set explicitly for the same reason AUTO_CONTINUE is: `**os.environ`
            # above would otherwise let the control plane's own value leak through
            # unfiltered, so `auto_continue: false` would turn off the synthetic-`Yes.`
            # chain and leave the SDK Stop hook still vetoing every yield. The two
            # providers must answer the same setting the same way.
            "AUTONOMOUS_MAX_NUDGES": str(settings.autonomous_max_nudges if settings.auto_continue else 0),
            "PYTHONPATH": str(SERVER_ROOT),  # so `-m app.sandbox_server` resolves
            # The agent's own summaries carry non-ASCII (mock_agent's
            # "1 match -> logged as ..." uses U+2192), and sandbox_server prints
            # them to a stdout redirected into ws.log below: under cp1252 that
            # raises UnicodeEncodeError, killing the _pump task mid-relay so
            # broadcast() never runs and the client hangs.
            # PYTHONUTF8 rather than PYTHONIOENCODING because it also sets the
            # default for any text pipe or bare open() in either child, not just
            # stdio. (agent_runner's own pipe is already explicit since #1822.)
            # This env reaches both children: sandbox_server passes
            # os.environ.copy() to agent_runner. No-op on Linux/macOS, where the
            # default is already UTF-8 -- which is why CI stays green while every
            # Windows run hangs.
            "PYTHONUTF8": "1",
            # LocalProvider maps sandbox-absolute paths under a per-sandbox dir
            # on the dev host, so the agent can't read the literal SECRETS_PATH
            # (/run/secrets/... belongs to the real machine). Point it at where
            # write_file actually put the file. E2B needs no override — there
            # the path is real inside the microVM.
            "AGENT_SECRETS_PATH": str(self._abs_secrets(sandbox_id)),
        }
        from ..anthropic_proxy import proxy_active
        if proxy_active():
            env["ANTHROPIC_BASE_URL"] = f"{settings.public_url}/api/anthropic-proxy"
        env.pop("ANTHROPIC_API_KEY", None)
        log = open(self._root(sandbox_id) / "ws.log", "ab")
        proc = subprocess.Popen(
            [sys.executable, "-m", SERVER_MODULE],
            env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        self._servers[sandbox_id] = (proc, port)
        self._record_server(sandbox_id, proc.pid, port)
        return port

    # ── orphan reaping ────────────────────────────────────────────
    #
    # `_servers` is in-memory and these subprocesses are launched with
    # `start_new_session=True`, so they are in their OWN process group and
    # survive a control plane that dies without reaching `aclose()` -- a crash,
    # a `kill -9`, a reload. The next run then has no idea they exist. That is
    # how nine of them were once found running, one 17 days old, and why "is my
    # sandbox running?" had to be answered with a process table.
    #
    # So the pid goes on disk beside the sandbox, and startup reaps what it can
    # PROVE is ours.

    def _server_file(self, sandbox_id: str) -> Path:
        return self._root(sandbox_id) / "server.json"

    def _record_server(self, sandbox_id: str, pid: int, port: int) -> None:
        try:
            self._server_file(sandbox_id).write_text(
                json.dumps({"pid": pid, "port": port, "argv": SERVER_MODULE}),
                encoding="utf-8",
            )
        except OSError:
            # Losing the record costs reaping, never correctness. A sandbox that
            # cannot write here still runs.
            pass

    def _forget_server(self, sandbox_id: str) -> None:
        try:
            self._server_file(sandbox_id).unlink()
        except OSError:
            pass

    @staticmethod
    def _is_our_server(pid: int) -> bool:
        """Whether `pid` is alive AND is one of our WS servers.

        Liveness alone is not enough: pids are reused, and killing a stranger
        because it inherited a number we wrote down weeks ago is far worse than
        leaking a process. So the command line must name the module too, and a
        platform that cannot show us one gets NO for an answer -- reaping is a
        convenience, and an unverifiable kill is not worth it.
        """
        try:
            cmdline = Path(f"/proc/{pid}/cmdline").read_bytes()
        except OSError:
            return False
        return SERVER_MODULE.encode() in cmdline

    def reap_orphans(self) -> list[str]:
        """Kill WS servers left behind by an earlier control plane.

        Returns the sandbox ids reaped, so a caller can log what it cleaned up
        rather than doing it silently -- the point is to make the state
        answerable, and a silent reap answers nothing.
        """
        reaped: list[str] = []
        if not self._dir.is_dir():
            return reaped
        for child in sorted(self._dir.iterdir()):
            if not child.is_dir() or child.name in self._servers:
                continue
            f = child / "server.json"
            if not f.is_file():
                continue
            try:
                pid = int(json.loads(f.read_text(encoding="utf-8")).get("pid") or 0)
            except (OSError, ValueError, TypeError):
                self._forget_server(child.name)
                continue
            if pid <= 0 or not self._is_our_server(pid):
                # Dead, or not provably ours. Drop the stale record either way:
                # keeping it would make every later reap re-examine a pid that
                # will never match again.
                self._forget_server(child.name)
                continue
            try:
                if hasattr(os, "killpg"):
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                else:
                    os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError, OSError):
                pass
            self._forget_server(child.name)
            reaped.append(child.name)
        return reaped

    async def _kill_server(self, proc: subprocess.Popen) -> None:
        if proc.poll() is None:
            try:
                if hasattr(os, "killpg"):
                    # kills server + agent (new session)
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                else:
                    # Windows has no process groups here. terminate() reaches the
                    # direct child only, so the agent grandchild sandbox_server
                    # spawns is orphaned rather than killed — strictly better than
                    # the AttributeError this replaces, but not equivalent.
                    proc.terminate()
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
                return json.loads(meta.read_text(encoding="utf-8"))
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
            json.dumps({"labels": spec.labels, "model": spec.model, "template": spec.template}),
            encoding="utf-8",
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
        # Unconditional: a suspend that found nothing in `_servers` may still be
        # clearing a record this process never owned.
        self._forget_server(sandbox_id)

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
        for sandbox_id, entry in list(self._servers.items()):
            await self._kill_server(entry[0])
            self._forget_server(sandbox_id)
        self._servers.clear()
