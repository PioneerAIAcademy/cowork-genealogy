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
from dataclasses import dataclass, field
from enum import Enum

PROJECT_DIR = "/project"
SECRETS_PATH = "/run/secrets/session.json"
# Sandbox-absolute HOME for the agent process. The FamilySearch token lands at
# {HOME_DIR}/.familysearch-mcp/tokens.json (spec §5.2 option a — file on the
# sandbox FS, zero MCP code change). The agent process runs with HOME set to
# the OS path agent_home_dir() maps this to.
HOME_DIR = "/home/user"
# Port the in-sandbox WS server (app/sandbox_server.py) listens on; exposed by
# the provider (E2B get_host / Local 127.0.0.1) and handed to the browser by
# /connect. The realtime re-arch: browser ↔ this port, control plane out of band.
SANDBOX_WS_PORT = 8080


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

    # ── exec ─────────────────────────────────────────────────────
    @abstractmethod
    async def exec(
        self, cmd: str, *, cwd: str | None = None, env: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> ExecResult: ...

    # ── networking ───────────────────────────────────────────────
    @abstractmethod
    async def expose_port(self, port: int) -> ConnectURL: ...

    def agent_project_dir(self) -> str:
        """The path the in-sandbox agent process should use for the project.
        LocalProvider overrides with the real local path; in a microVM it is
        the sandbox-absolute /project."""
        return PROJECT_DIR

    def agent_home_dir(self) -> str:
        """The OS path to set as HOME for the agent process (so the genealogy
        MCP server reads ~/.familysearch-mcp/tokens.json from a per-sandbox
        location). LocalProvider overrides with a real local path."""
        return HOME_DIR

    # ── filesystem (secrets, project I/O) ────────────────────────
    @abstractmethod
    async def read_file(self, path: str) -> bytes | None: ...

    @abstractmethod
    async def write_file(self, path: str, data: bytes) -> None: ...

    @abstractmethod
    async def list_dir(self, path: str) -> list[DirEntry]: ...

    @abstractmethod
    async def file_mtime(self, path: str) -> float | None:
        """Modification time (epoch seconds), or None if absent. Used for the
        viewer's sidecar race-guard."""
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
            mtime = await self.file_mtime(e.path)
            out["sidecars"].append({"logId": e.name[:-5], "mtime": mtime or 0})
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
