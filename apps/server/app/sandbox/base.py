"""Vendor-neutral sandbox layer (see docs/plan/sandbox-provider-interface.md).

The control plane talks only to these abstractions; the concrete provider
(LocalProvider for the POC, E2BProvider for hosted) is config-selected. The
contract is deliberately the WEAKER of the two platforms: SUSPENDED preserves
only the project filesystem, never process memory, so resume always re-launches
the agent and restores conversation via the Agent SDK's own session resume.

Paths use a sandbox-absolute convention ("/project/...", "/run/secrets/...").
The agent's project lives at PROJECT_DIR; per-connect secrets at SECRETS_PATH.
"""
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum

PROJECT_DIR = "/project"
SECRETS_PATH = "/run/secrets/session.json"


class SandboxState(str, Enum):
    RUNNING = "running"
    SUSPENDED = "suspended"  # FS preserved, process gone
    MISSING = "missing"  # not found / deleted


@dataclass(frozen=True)
class SandboxSpec:
    template: str
    labels: dict[str, str] = field(default_factory=dict)  # user_id, etc.
    env: dict[str, str] = field(default_factory=dict)  # boot-time, non-secret
    auto_suspend_seconds: int = 900
    model: str = "claude-sonnet-4-6"


@dataclass(frozen=True)
class ConnectURL:
    url: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class DirEntry:
    name: str
    path: str
    is_dir: bool


class Process(ABC):
    """A long-lived process inside the sandbox (the per-user agent_runner)."""

    @property
    @abstractmethod
    def pid(self) -> str: ...

    @abstractmethod
    async def is_alive(self) -> bool: ...

    @abstractmethod
    async def kill(self) -> None: ...


class Sandbox(ABC):
    @property
    @abstractmethod
    def id(self) -> str: ...

    @property
    @abstractmethod
    def state(self) -> SandboxState: ...

    @property
    @abstractmethod
    def model(self) -> str: ...

    # ── process / exec ───────────────────────────────────────────
    @abstractmethod
    async def exec(
        self, cmd: str, *, cwd: str | None = None, env: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> ExecResult: ...

    @abstractmethod
    async def start_process(
        self, cmd: str, *, cwd: str | None = None, env: dict[str, str] | None = None,
    ) -> Process: ...

    # ── networking ───────────────────────────────────────────────
    @abstractmethod
    async def expose_port(self, port: int) -> ConnectURL: ...

    # ── filesystem (secrets, project I/O) ────────────────────────
    @abstractmethod
    async def read_file(self, path: str) -> bytes | None: ...

    @abstractmethod
    async def write_file(self, path: str, data: bytes) -> None: ...

    @abstractmethod
    async def list_dir(self, path: str) -> list[DirEntry]: ...

    # ── project change events (the decoupled viewer path) ────────
    @abstractmethod
    def watch_project(self, on_change: Callable[[str], None]) -> Callable[[], None]:
        """Invoke on_change(relative_path) when a file under /project changes.

        Returns a stop function. LocalProvider polls; E2BProvider uses
        files.watch_dir. Independent of the chat channel so the viewer updates
        even with no active conversation (spec §0.5).
        """
        ...

    # ── convenience: read the whole project for a viewer snapshot ─
    async def read_project_snapshot(self) -> dict:
        """{research, gedcomx, sidecars:[{logId,mtime}]} for the viewer."""
        out: dict = {"research": None, "gedcomx": None, "sidecars": []}
        research = await self.read_file(f"{PROJECT_DIR}/research.json")
        if research is not None:
            out["research"] = research.decode("utf-8")
        gedcomx = await self.read_file(f"{PROJECT_DIR}/tree.gedcomx.json")
        if gedcomx is not None:
            out["gedcomx"] = gedcomx.decode("utf-8")
        try:
            entries = await self.list_dir(f"{PROJECT_DIR}/results")
        except Exception:
            entries = []
        for e in entries:
            if e.is_dir or not e.name.endswith(".json"):
                continue
            out["sidecars"].append({"logId": e.name[:-5]})
        return out


class SandboxProvider(ABC):
    """Implemented by LocalProvider (POC) / E2BProvider (hosted)."""

    @abstractmethod
    async def create(self, spec: SandboxSpec) -> Sandbox: ...

    @abstractmethod
    async def get(self, sandbox_id: str) -> Sandbox: ...  # MISSING if gone

    @abstractmethod
    async def resume(self, sandbox_id: str) -> Sandbox: ...

    @abstractmethod
    async def suspend(self, sandbox_id: str) -> None: ...

    @abstractmethod
    async def delete(self, sandbox_id: str) -> None: ...

    @abstractmethod
    async def list(self, labels: dict[str, str] | None = None) -> list[Sandbox]: ...

    async def aclose(self) -> None:
        """Release any provider-level resources (override as needed)."""
        await asyncio.sleep(0)
