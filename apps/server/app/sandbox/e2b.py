"""E2BProvider — the hosted provider (per-user Firecracker microVM).

CORE scope (docs/plan/e2b-provider-implementation-plan.md §0): sandbox lifecycle
+ filesystem + state. This is everything the **affinity-free** control plane needs
under Ably **Option B**, where an in-sandbox *bridge* (not the host) owns the agent
process + the /project watch. So `start_process` / `watch_project` raise
`NotImplementedError` here (they belong to the Option B bridge, or to an Option A
fallback if ever un-deferred); `expose_port` is a thin dead stub (no callers).

Verified against the `e2b` SDK (2.x) — Phase 0 findings:
- `AsyncSandbox.create(template, metadata, envs, allow_internet_access, timeout,
  lifecycle={"on_timeout":"pause","auto_resume":True}) -> handle`  (auto-pause on
  the running-timeout, never kill → "never reaped"; FS preserved indefinitely).
- `AsyncSandbox.connect(sandbox_id)` reconnects by id (auto-resumes a paused VM).
- `sandbox.pause()` / `sandbox.kill()`; `AsyncSandbox.list(query=SandboxQuery(metadata=…))`.
- `files.read(path, format="bytes") -> bytes`; `files.write(path, data)`;
  `files.list(path)` / `files.get_info(path) -> EntryInfo(.modified_time: datetime,
  .type: FileType, .name, .path)`.
- Not-found: `SandboxNotFoundException` (connect), `FileNotFoundException` (files).

The `e2b` SDK is imported lazily (module-local) so non-e2b runs/CI don't need it.
"""
from __future__ import annotations

import inspect

from ..config import get_settings
from ..ws_token import sandbox_secret
from .base import (
    HOME_DIR,
    PROJECT_DIR,
    SANDBOX_WS_PORT,
    ConnectURL,
    DirEntry,
    ExecResult,
    Sandbox,
    SandboxProvider,
    SandboxSpec,
    SandboxState,
)

# Generous continuous-running backstop. With lifecycle on_timeout=pause, hitting
# it just *pauses* (FS preserved) instead of killing — the control plane's idle
# loop is the primary suspend driver.
_RUNNING_TIMEOUT_S = 3600
# The image's fixed prefix (e2b.Dockerfile AGENT_HOME). E2B commands.run does NOT
# inherit the Dockerfile ENV, so the WS server launch must pass these explicitly.
_AGENT_HOME = "/opt/genealogy-agent"


class E2BSandbox(Sandbox):
    def __init__(
        self,
        handle,  # e2b AsyncSandbox, or None when MISSING
        *,
        sandbox_id: str,
        model: str = "",
        state: SandboxState = SandboxState.RUNNING,
    ):
        self._sb = handle
        self._id = sandbox_id
        self._model = model
        self._state = state

    @property
    def id(self) -> str:
        return self._id

    @property
    def state(self) -> SandboxState:
        return self._state

    @property
    def model(self) -> str:
        return self._model

    def _require_handle(self):
        if self._sb is None:
            raise RuntimeError(f"sandbox {self._id} is not available (MISSING)")
        return self._sb

    # ── filesystem ───────────────────────────────────────────────
    async def read_file(self, path: str) -> bytes | None:
        from e2b.exceptions import FileNotFoundException

        if self._sb is None:
            return None
        try:
            data = await self._sb.files.read(path, format="bytes")
        except FileNotFoundException:
            return None
        return bytes(data)  # SDK returns bytearray; the contract promises bytes

    async def write_file(self, path: str, data: bytes) -> None:
        await self._require_handle().files.write(path, data)

    async def list_dir(self, path: str) -> list[DirEntry]:
        from e2b.exceptions import FileNotFoundException
        from e2b.sandbox.filesystem.filesystem import FileType

        if self._sb is None:
            return []
        try:
            entries = await self._sb.files.list(path)
        except FileNotFoundException:
            return []
        return [
            DirEntry(name=e.name, path=e.path, is_dir=(e.type == FileType.DIR))
            for e in entries
        ]

    async def file_mtime(self, path: str) -> float | None:
        from e2b.exceptions import FileNotFoundException

        if self._sb is None:
            return None
        try:
            info = await self._sb.files.get_info(path)
        except FileNotFoundException:
            return None
        mt = getattr(info, "modified_time", None)
        return mt.timestamp() if mt is not None else None

    # ── process / exec ───────────────────────────────────────────
    async def exec(
        self, cmd: str, *, cwd: str | None = None, env: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> ExecResult:
        kwargs: dict = {}
        if cwd is not None:
            kwargs["cwd"] = cwd
        if env:
            kwargs["envs"] = env
        if timeout is not None:
            kwargs["timeout"] = timeout
        res = await self._require_handle().commands.run(cmd, **kwargs)
        return ExecResult(
            getattr(res, "exit_code", 0) or 0,
            getattr(res, "stdout", "") or "",
            getattr(res, "stderr", "") or "",
        )

    async def expose_port(self, port: int) -> ConnectURL:
        # The exposed-port URL for the in-sandbox WS server. get_host() may be
        # sync or async depending on SDK version; handle both.
        host = self._require_handle().get_host(port)
        if inspect.iscoroutine(host):
            host = await host
        return ConnectURL(url=f"wss://{host}")


class E2BProvider(SandboxProvider):
    def __init__(self, api_key: str | None, template: str):
        if not api_key:
            raise RuntimeError(
                "SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set. Provision an "
                "E2B account, build the genealogy template, and set E2B_API_KEY. "
                "Until then use SANDBOX_PROVIDER=local."
            )
        self._api_key = api_key
        self._template = template
        # Trivial handle cache (§3.1): no lock, no eviction machinery. connect()
        # is idempotent and E2B sandboxes don't vanish, so there's nothing to
        # evict on; dropped on suspend()/delete().
        self._cache: dict[str, object] = {}

    def _sdk(self):
        from e2b import AsyncSandbox

        return AsyncSandbox

    async def _connect(self, sandbox_id: str):
        cached = self._cache.get(sandbox_id)
        if cached is not None:
            return cached
        sb = await self._sdk().connect(sandbox_id, api_key=self._api_key)
        self._cache[sandbox_id] = sb
        return sb

    def _agent_env(self, model: str) -> dict[str, str]:
        s = get_settings()
        env = {"AGENT_MODE": s.agent_mode, "MODEL": model}
        if s.anthropic_api_key:
            env["ANTHROPIC_API_KEY"] = s.anthropic_api_key
        return env

    async def create(self, spec: SandboxSpec) -> Sandbox:
        agent_env = self._agent_env(spec.model)
        sb = await self._sdk().create(
            template=spec.template or self._template,
            metadata={**spec.labels, "model": spec.model},
            envs={**spec.env, **agent_env},
            allow_internet_access=True,
            timeout=_RUNNING_TIMEOUT_S,
            lifecycle={"on_timeout": "pause", "auto_resume": True},
            api_key=self._api_key,
        )
        self._cache[sb.sandbox_id] = sb
        # Start the in-sandbox WS server (the per-session server, sandbox_server.py).
        # It survives pause/resume (spike-verified), so /connect never restarts it;
        # it spawns agent_runner itself on first browser connection. The per-sandbox
        # WS_TOKEN_SECRET is derived so a leaked sandbox can't forge other sessions.
        ws_env = {
            **agent_env,  # AGENT_MODE, MODEL, ANTHROPIC_API_KEY
            "WS_TOKEN_SECRET": sandbox_secret(sb.sandbox_id),
            "WS_PORT": str(SANDBOX_WS_PORT),
            # commands.run does NOT inherit the image ENV → pass the baked paths
            # the WS server (and the agent_runner it spawns) need explicitly.
            "PROJECT_DIR": PROJECT_DIR,
            "HOME": HOME_DIR,
            "PYTHONPATH": f"{_AGENT_HOME}/server",
            "ENGINE_MCP_BUILD": f"{_AGENT_HOME}/engine/build/index.js",
            "ENGINE_PLUGIN_DIR": f"{_AGENT_HOME}/plugin",
        }
        # nohup is REQUIRED: without it the server is SIGHUP'd when the sandbox
        # pauses/resumes (or the create RPC closes) and dies, breaking the agent's
        # stdout pipe (BrokenPipeError → hung turn). The spike survived precisely
        # because it used nohup. Output → /tmp/ws.log (GET /api/sessions/{id}/logs).
        await sb.commands.run(
            "nohup python3 -m app.sandbox_server > /tmp/ws.log 2>&1",
            background=True, envs=ws_env,
        )
        return E2BSandbox(sb, sandbox_id=sb.sandbox_id, model=spec.model)

    async def get(self, sandbox_id: str) -> Sandbox:
        from e2b.exceptions import SandboxNotFoundException

        # NOTE: connect() auto-resumes a paused VM, so E2B get() wakes a
        # suspended sandbox and can't report SUSPENDED (unlike LocalProvider's
        # non-destructive get()). Harmless here: both callers — familysearch
        # /status (called only on session open + right after a connect attempt;
        # NOT polled on a timer) and the sessions sidecar read — fire during
        # active session use, when the sandbox is being resumed anyway, and an
        # E2B FS is only readable while the VM runs. The only way to wake an idle
        # sandbox would be a future *background* /status poller; if one is ever
        # added, track FS-connected state in the DB instead of reading the
        # sandbox (don't add lazy-connect machinery that still resumes on read).
        try:
            sb = await self._connect(sandbox_id)
        except SandboxNotFoundException:
            return E2BSandbox(None, sandbox_id=sandbox_id, state=SandboxState.MISSING)
        return E2BSandbox(sb, sandbox_id=sandbox_id)

    async def resume(self, sandbox_id: str) -> Sandbox:
        from e2b.exceptions import SandboxNotFoundException

        try:
            sb = await self._connect(sandbox_id)  # connect() auto-resumes a paused VM
        except SandboxNotFoundException:
            # Parity with get()/LocalProvider: never raise on a gone sandbox.
            return E2BSandbox(None, sandbox_id=sandbox_id, state=SandboxState.MISSING)
        # Give the session a fresh window on each /connect so a long turn isn't
        # paused mid-flight (connect() can reset the VM timeout to a short
        # default). on_timeout=pause is still the idle backstop. Best-effort.
        try:
            await sb.set_timeout(_RUNNING_TIMEOUT_S)
        except Exception:
            pass
        return E2BSandbox(sb, sandbox_id=sandbox_id)

    async def suspend(self, sandbox_id: str) -> None:
        sb = await self._connect(sandbox_id)
        await sb.pause()
        self._cache.pop(sandbox_id, None)

    async def delete(self, sandbox_id: str) -> None:
        from e2b.exceptions import SandboxNotFoundException

        try:
            sb = await self._connect(sandbox_id)
            await sb.kill()
        except SandboxNotFoundException:
            pass
        finally:
            self._cache.pop(sandbox_id, None)

    async def list(self, labels: dict[str, str] | None = None) -> list[Sandbox]:
        # Parity method — no control-plane caller. Best-effort over the paginator.
        from e2b import SandboxQuery

        query = SandboxQuery(metadata=labels) if labels else None
        out: list[Sandbox] = []
        try:
            paginator = self._sdk().list(query=query, api_key=self._api_key)
            while getattr(paginator, "has_next", False):
                for info in await paginator.next_items():
                    out.append(
                        E2BSandbox(
                            None,
                            sandbox_id=getattr(info, "sandbox_id", ""),
                            state=SandboxState.SUSPENDED,
                        )
                    )
        except Exception:
            pass
        return out

    async def aclose(self) -> None:
        self._cache.clear()
