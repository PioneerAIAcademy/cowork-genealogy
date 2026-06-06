"""Per-session live manager (Phase 2 of the Ably migration). A LiveSession owns,
for one active session: the sandbox, the agent_runner Process, the /project
watch, and the agent-stdout pump — publishing every outbound frame via
realtime.publish(session_id, frame). It is shared by both backends:

- local_ws: the WebSocket endpoint (ws.py) ensures a LiveSession on connect and
  disposes it when the last socket detaches; chat input arrives on the socket.
- ably: REST endpoints (POST /connect, /message, /ping) ensure / feed / keep the
  LiveSession alive; the idle-suspend loop disposes it when pings stop.

This moves the watch + pump that used to live inside the WS handler into an
app-owned manager keyed by session_id, so neither liveness signal (socket vs
ping) is baked into the handler.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from collections.abc import Awaitable, Callable

from .chat import start_agent_process
from .models import Project
from .realtime.base import Realtime
from .sandbox.base import PROJECT_DIR, Sandbox

Publish = Callable[[dict], Awaitable[None]]


async def _read_json(sandbox: Sandbox, path: str):
    raw = await sandbox.read_file(path)
    if raw is None:
        return None
    return json.loads(raw.decode("utf-8"))


async def push_full_snapshot(publish: Publish, sandbox: Sandbox) -> None:
    """Initial hydration: research + gedcomx + the sidecar pointers."""
    research = None
    gedcomx = None
    try:
        research = await _read_json(sandbox, f"{PROJECT_DIR}/research.json")
        if research is not None:
            await publish({"type": "research_updated", "data": research})
    except json.JSONDecodeError:
        await publish({"type": "error", "message": "research.json is not valid JSON"})
    try:
        gedcomx = await _read_json(sandbox, f"{PROJECT_DIR}/tree.gedcomx.json")
        if gedcomx is not None:
            await publish({"type": "gedcomx_updated", "data": gedcomx})
    except json.JSONDecodeError:
        await publish({"type": "error", "message": "tree.gedcomx.json is not valid JSON"})
    for entry in await sandbox.list_dir(f"{PROJECT_DIR}/results"):
        if entry.is_dir or not entry.name.endswith(".json"):
            continue
        mtime = await sandbox.file_mtime(entry.path) or 0
        await publish({"type": "sidecar_updated", "logId": entry.name[:-5], "mtime": mtime})


async def push_change(publish: Publish, sandbox: Sandbox, rel: str) -> None:
    """A single /project file changed (relative path under /project)."""
    if rel == "research.json":
        try:
            data = await _read_json(sandbox, f"{PROJECT_DIR}/research.json")
            if data is not None:
                await publish({"type": "research_updated", "data": data})
        except json.JSONDecodeError:
            return
    elif rel == "tree.gedcomx.json":
        try:
            data = await _read_json(sandbox, f"{PROJECT_DIR}/tree.gedcomx.json")
            if data is not None:
                await publish({"type": "gedcomx_updated", "data": data})
        except json.JSONDecodeError:
            return
    elif rel.startswith("results/") and rel.endswith(".json"):
        log_id = rel[len("results/") : -len(".json")]
        mtime = await sandbox.file_mtime(f"{PROJECT_DIR}/{rel}") or 0
        await publish({"type": "sidecar_updated", "logId": log_id, "mtime": mtime})


class LiveSession:
    def __init__(self, session_id: str, sandbox: Sandbox, realtime: Realtime):
        self.session_id = session_id
        self.sandbox = sandbox
        self.realtime = realtime
        self.process = None
        self._watch_stop: Callable[[], None] | None = None
        self._tasks: list[asyncio.Task] = []
        self._started = False

    async def _publish(self, msg: dict) -> None:
        await self.realtime.publish(self.session_id, msg)

    async def start(self, project: Project) -> None:
        if self._started:
            return
        self._started = True

        await self._publish({"type": "status", "state": "ready"})
        await push_full_snapshot(self._publish, self.sandbox)

        # /project watch → publish viewer deltas
        queue: asyncio.Queue[str] = asyncio.Queue()
        self._watch_stop = self.sandbox.watch_project(lambda rel: queue.put_nowait(rel))

        async def pump_changes() -> None:
            while True:
                rel = await queue.get()
                await push_change(self._publish, self.sandbox, rel)

        self._tasks.append(asyncio.create_task(pump_changes()))

        # agent_runner → publish agent_event frames
        try:
            self.process = await start_agent_process(self.sandbox, project)

            async def pump_agent() -> None:
                try:
                    async for line in self.process.stdout():
                        if not line:
                            continue
                        try:
                            await self._publish(json.loads(line))
                        except json.JSONDecodeError:
                            continue
                except Exception:
                    pass

            self._tasks.append(asyncio.create_task(pump_agent()))
            await self._publish({"type": "status", "state": "chat_ready"})
        except Exception as exc:
            await self._publish({"type": "status", "state": "chat_error", "message": str(exc)})

    async def send_input(self, raw: str) -> None:
        if self.process is not None:
            await self.process.write_stdin(raw.rstrip("\n") + "\n")

    async def dispose(self) -> None:
        if self._watch_stop is not None:
            self._watch_stop()
        for t in self._tasks:
            t.cancel()
        if self.process is not None:
            try:
                await self.process.kill()
            except Exception:
                pass


class SessionManager:
    """app-owned registry of LiveSessions, keyed by session_id."""

    def __init__(self, app) -> None:
        self.app = app
        self.sessions: dict[str, LiveSession] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def ensure(self, session_id: str, project: Project) -> LiveSession:
        async with self._locks[session_id]:
            ls = self.sessions.get(session_id)
            if ls is None:
                sandbox = await self.app.state.provider.resume(project.sandbox_id)
                ls = LiveSession(session_id, sandbox, self.app.state.realtime)
                self.sessions[session_id] = ls
                self.app.state.active_sessions.add(session_id)
                await ls.start(project)
            return ls

    def get(self, session_id: str) -> LiveSession | None:
        return self.sessions.get(session_id)

    async def dispose(self, session_id: str) -> None:
        async with self._locks[session_id]:
            ls = self.sessions.pop(session_id, None)
            self.app.state.active_sessions.discard(session_id)
            if ls is not None:
                await ls.dispose()
