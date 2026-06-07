"""In-sandbox WS server — the per-session server (realtime re-architecture).

Runs INSIDE the sandbox (E2B boot CMD; a LocalProvider subprocess in dev). The
browser opens ONE authenticated WSS directly here — chat in/out + viewer deltas,
all of it — so the control plane is out of the streaming data path (affinity-free
on AWS-no-sticky). This is the relocated relay (the old ws.py + live_session pump)
WITHOUT the multiplexing: one session per sandbox, local /project, one
agent_runner. See docs/plan/ably-realtime-migration.md.

Run:  python -m app.sandbox_server
Env (injected at sandbox create / by LocalProvider):
  WS_PORT          listen port (default 8080)
  WS_TOKEN_SECRET  per-sandbox HMAC secret; clients present a signed token at
                   handshake (?token=<exp>.<hmac>). Empty disables auth (dev).
  PROJECT_DIR      project dir (default /project)
  AGENT_MODE, MODEL, ANTHROPIC_API_KEY, HOME, ENGINE_MCP_BUILD, ENGINE_PLUGIN_DIR
                   passed straight through to agent_runner (this process's env).
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from websockets.asyncio.server import serve

PORT = int(os.environ.get("WS_PORT", "8080"))
SECRET = os.environ.get("WS_TOKEN_SECRET", "")
PROJECT_DIR = Path(os.environ.get("PROJECT_DIR", "/project"))
_WATCH_INTERVAL = 0.7


def _make_token(ttl_seconds: int = 3600) -> str:
    """Mint a token (used by the control plane via mint_session_token). Format:
    '<exp>.<hex hmac-sha256(secret, exp)>'."""
    exp = str(int(time.time()) + ttl_seconds)
    sig = hmac.new(SECRET.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def verify_token(token: str | None) -> bool:
    if not SECRET:
        return True  # auth disabled (local dev with no secret)
    if not token:
        return False
    try:
        exp_s, sig = token.split(".", 1)
        exp = int(exp_s)
    except (ValueError, AttributeError):
        return False
    if exp < int(time.time()):
        return False
    expected = hmac.new(SECRET.encode(), exp_s.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def _read_json(path: Path):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _ts() -> str:
    return time.strftime("%H:%M:%S")


class Hub:
    """Owns the single agent_runner + the /project watch, and fans out to all
    connected browser sockets. One per sandbox."""

    def __init__(self) -> None:
        self._clients: set = set()
        self._proc: subprocess.Popen | None = None
        self._watch_started = False

    # ── outbound fan-out ─────────────────────────────────────────
    async def broadcast(self, msg: dict) -> None:
        payload = json.dumps(msg)
        for ws in list(self._clients):
            try:
                await ws.send(payload)
            except Exception:
                self._clients.discard(ws)

    async def send_one(self, ws, msg: dict) -> None:
        try:
            await ws.send(json.dumps(msg))
        except Exception:
            self._clients.discard(ws)

    # ── agent process + pumps ────────────────────────────────────
    async def ensure_started(self) -> None:
        loop = asyncio.get_running_loop()
        # /project watch → viewer deltas (poll, dependency-free). Start once.
        if not self._watch_started:
            self._watch_started = True
            loop.create_task(self._watch_loop())
        # Agent already alive? nothing to do.
        if self._proc is not None and self._proc.poll() is None:
            return

        print(f"{_ts()} [ws] spawning agent_runner", flush=True)
        log = open("/tmp/agent.log", "ab", buffering=0) if os.path.isdir("/tmp") else None
        try:
            proc = subprocess.Popen(
                [sys.executable, "-m", "app.agent.runner"],
                cwd=str(PROJECT_DIR), env=os.environ.copy(),
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                text=True, bufsize=1,
            )
        except Exception as exc:
            print(f"[ws] agent_runner spawn failed: {exc}", flush=True)
            await self.broadcast({"type": "status", "state": "chat_error", "message": str(exc)})
            return
        self._proc = proc

        q: asyncio.Queue = asyncio.Queue()

        def reader() -> None:
            try:
                for line in proc.stdout:
                    loop.call_soon_threadsafe(q.put_nowait, line.rstrip("\n"))
            finally:
                loop.call_soon_threadsafe(q.put_nowait, None)

        threading.Thread(target=reader, daemon=True).start()
        loop.create_task(self._pump(q, proc))
        await self.broadcast({"type": "status", "state": "chat_ready"})

    async def _pump(self, q: asyncio.Queue, proc: subprocess.Popen) -> None:
        while True:
            line = await q.get()
            if line is None:
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Activity timeline → ws.log so the Logs panel shows WHAT the agent did
            # and where it stalls. Skip per-token text (it streams to the UI; too
            # noisy for the log).
            ev = msg.get("event") or {}
            kind = ev.get("kind")
            if kind and kind != "text":
                if kind == "thinking":
                    detail = str(ev.get("text", "")).replace("\n", " ")[:200]
                elif kind in ("tool_use", "tool_result"):
                    detail = f"{ev.get('tool', '')}: {str(ev.get('summary', ''))[:140]}".strip()
                elif kind == "error":
                    detail = str(ev.get("text", ""))[:200]
                else:
                    detail = ""
                print(f"{_ts()} [agent] {kind} {detail}".rstrip(), flush=True)
            await self.broadcast(msg)
        code = proc.poll()
        print(f"{_ts()} [ws] agent_runner exited (code={code})", flush=True)
        # The live agent died — surface it + unstick the UI instead of hanging on
        # a turn that will never finish. A new message re-spawns it (send_input).
        if proc is self._proc:
            self._proc = None
            await self.broadcast({"type": "agent_event", "event": {"kind": "error",
                "text": f"The agent process exited unexpectedly (code {code}). "
                        "Send another message to restart it."}})
            await self.broadcast({"type": "agent_event", "event": {"kind": "turn_done"}})
            await self.broadcast({"type": "status", "state": "chat_error", "message": f"agent exited ({code})"})

    async def send_input(self, raw: str) -> None:
        if self._proc is None or self._proc.poll() is not None:
            await self.ensure_started()  # respawn a crashed agent before sending
        if self._proc and self._proc.stdin:
            await asyncio.to_thread(self._proc.stdin.write, raw.rstrip("\n") + "\n")
            await asyncio.to_thread(self._proc.stdin.flush)

    # ── /project watch (poll) ────────────────────────────────────
    async def _watch_loop(self) -> None:
        seen: dict[str, float] = {}
        # Prime once with the files present at startup so the initial state isn't
        # replayed as "changed"; thereafter emit on any new OR modified file.
        for f in PROJECT_DIR.rglob("*"):
            if f.is_file():
                try:
                    seen[str(f.relative_to(PROJECT_DIR))] = f.stat().st_mtime
                except OSError:
                    pass
        while True:
            await asyncio.sleep(_WATCH_INTERVAL)
            try:
                for f in PROJECT_DIR.rglob("*"):
                    if not f.is_file():
                        continue
                    rel = str(f.relative_to(PROJECT_DIR))
                    try:
                        mt = f.stat().st_mtime
                    except OSError:
                        continue
                    if seen.get(rel) != mt:  # new or changed
                        seen[rel] = mt
                        await self._emit_change(rel)
            except OSError:
                pass

    async def _emit_change(self, rel: str) -> None:
        if rel == "research.json":
            d = _read_json(PROJECT_DIR / rel)
            if d is not None:
                await self.broadcast({"type": "research_updated", "data": d})
        elif rel == "tree.gedcomx.json":
            d = _read_json(PROJECT_DIR / rel)
            if d is not None:
                await self.broadcast({"type": "gedcomx_updated", "data": d})
        elif rel.startswith("results/") and rel.endswith(".json"):
            log_id = rel[len("results/"): -len(".json")]
            try:
                mt = (PROJECT_DIR / rel).stat().st_mtime
            except OSError:
                mt = 0
            await self.broadcast({"type": "sidecar_updated", "logId": log_id, "mtime": mt})

    # ── per-connection snapshot (viewer hydration) ───────────────
    async def send_snapshot(self, ws) -> None:
        await self.send_one(ws, {"type": "status", "state": "ready"})
        research = _read_json(PROJECT_DIR / "research.json")
        if research is not None:
            await self.send_one(ws, {"type": "research_updated", "data": research})
        gedcomx = _read_json(PROJECT_DIR / "tree.gedcomx.json")
        if gedcomx is not None:
            await self.send_one(ws, {"type": "gedcomx_updated", "data": gedcomx})
        results = PROJECT_DIR / "results"
        if results.is_dir():
            for f in sorted(results.glob("*.json")):
                try:
                    mt = f.stat().st_mtime
                except OSError:
                    mt = 0
                await self.send_one(ws, {"type": "sidecar_updated", "logId": f.stem, "mtime": mt})

    # ── connection handler ───────────────────────────────────────
    async def handle(self, ws) -> None:
        token = None
        path = getattr(ws.request, "path", "") or ""
        if "token=" in path:
            token = path.split("token=", 1)[1].split("&", 1)[0]
        if not verify_token(token):
            print("[ws] rejected connection: bad/expired token", flush=True)
            await ws.close(4401, "unauthorized")
            return
        self._clients.add(ws)
        print(f"{_ts()} [ws] client connected ({len(self._clients)} total)", flush=True)
        try:
            await self.ensure_started()
            await self.send_snapshot(ws)
            # Tell THIS client it can chat — every connection, not just the one
            # that spawned the agent. Without this a reconnect after pause/resume
            # (agent already alive → ensure_started returns early) would sit on
            # "Connecting to the agent…" forever (ChatPane gates on chat_ready).
            await self.send_one(ws, {"type": "status", "state": "chat_ready"})
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") in ("user_msg", "interrupt"):
                    await self.send_input(raw)
        except Exception as exc:
            print(f"[ws] connection error: {exc}", flush=True)
        finally:
            self._clients.discard(ws)
            print(f"{_ts()} [ws] client disconnected ({len(self._clients)} remain)", flush=True)


async def main() -> None:
    hub = Hub()
    async with serve(hub.handle, "0.0.0.0", PORT):
        print(f"{_ts()} sandbox_server listening on :{PORT}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
