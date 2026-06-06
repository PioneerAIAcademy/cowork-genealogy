# Sandbox Provider Interface — design + stubs

**Status:** design (not yet implemented). **Scope:** the per-user execution
sandbox layer for the hosted multi-user "genealogy workbench" (the
client-server product), kept vendor-neutral across **Daytona** and **E2B**
(and a future provider) so the partner (FamilySearch) can self-host later.

This is the implementation plan for the sandbox abstraction only. For the
broader product direction (re-host skills+MCP under the Agent SDK; monorepo +
transport-agnostic viewer; operator-pays SaaS) see the conversation record /
project memory.

---

## 1. Why this layer exists (platform decision context)

Multi-user means **one isolated execution sandbox per user** — not just a
directory — because each session must fork the full agent tree
(`Python Agent SDK → Node Claude Code CLI → Node stdio MCP server`), reach
FamilySearch over open egress, hold that user's project folder durably, and
carry that user's FamilySearch OAuth token. A serverless function / V8 isolate
that cannot fork subprocesses is disqualified.

The endgame requirement is that **FamilySearch will self-host the whole thing**,
so the sandbox platform must be self-hostable. That eliminates Fly.io
(managed-only) as an endgame and narrows the real choice to **Daytona vs E2B**.
Both are full-Linux, self-hostable, and clear every hard constraint; they
differ on the axes below.

| Dimension | E2B | Daytona | Winner |
|---|---|---|---|
| Isolation primitive (PII) | Firecracker microVM, own guest kernel/tenant | Sysbox container, shared host kernel (+ `Privileged:true`) | **E2B** |
| Network egress | open by default, no gate | gated behind Tier-3 $500 prepaid top-up | **E2B** |
| Persistence / resume | pause = FS+memory, indefinite; resume ~1s (bugs #884/#987 closed) | stop/archive + S3 volumes, FS-only; resume-by-id | **E2B** |
| Self-host license | Apache-2.0 | AGPL-3.0 (copyleft) | **E2B** |
| Self-host isolation | keeps Firecracker microVM | stays Sysbox shared-kernel | **E2B** |
| Compliance **documented today** | contested/unverified (DPA/SOC2/HIPAA not on E2B's own pages) | DPA + HIPAA BAA + SOC2 Type I documented | **Daytona** |
| Ops to self-host | heavier (Nomad+Firecracker+nested-virt, GCP/AWS only) | lighter (Docker-Compose/Nomad) | **Daytona** |
| subprocess / SDK fit / pricing / scaling | tie (both run the fork-tree, official Claude guides, ~$0.067/hr 1vCPU/1GiB, idle=storage) | tie | — |

**Pivotal open question (decides Daytona vs E2B endgame):** does FamilySearch's
security review **require hardware/microVM isolation per tenant**, or is
**hardened shared-kernel (Sysbox) acceptable**? microVM-required → **E2B**;
shared-kernel-OK → **Daytona** (lighter ops + documented compliance).

**Resolve before committing:** (1) E2B's real SOC2/HIPAA/DPA status via
`trust.e2b.dev` (governs whether the interim *managed* phase can legally hold
family PII); (2) the WS-port-exposure recipe for the Agent SDK inside E2B.

Because the choice is genuinely undecided, the rest of this doc defines a
**provider-neutral interface** so the product is built once and the platform
stays swappable.

---

## 2. Architecture placement

The per-user **agent runs inside the sandbox**, not on the FastAPI host —
because the Agent SDK forks its MCP server as a local **stdio** child, the whole
tree must live together with the project folder, the FamilySearch token, and
egress. FastAPI is a thin **control plane + WebSocket proxy** in front of N
sandboxes.

```
Browser ──WS──► FastAPI orchestrator ──(SandboxProvider)──► Sandbox[user]
                  │  create/resume/suspend                   ├─ agent_runner.py (Python Agent SDK, WS server)
                  │  write secrets file                      │    └─ node CLI → node stdio MCP → FamilySearch
                  │  expose_port → proxy WS ◄──in-sbx WS──────┤
                  └─ session_id ↔ sandbox_id (DB)            └─ /project (research.json, tree.gedcomx.json, results/)
                                                                  └─ object-store sync (S3/GCS)
```

---

## 3. Design decisions baked into the interface

1. **Resume = filesystem only, never memory.** Daytona stop/archive preserves
   FS but kills the process; E2B pause snapshots memory too. The portable
   contract is the weaker one: `SUSPENDED` preserves only the project folder;
   on resume the orchestrator **re-launches `agent_runner`**, which restores
   conversation via the Agent SDK's own `resume=session_id`. Works identically
   on both and on any future provider; never depends on a memory snapshot.
2. **Per-user secrets go in a file, written on every (re)connect** — not
   create-time env. Neither SDK can mutate env on a running/resumed sandbox,
   and FamilySearch tokens rotate. `write_file("/run/secrets/session.json", …)`
   each connect; `agent_runner` reads creds per turn.
3. **Streaming via an exposed in-sandbox port**, not stdio piping. `agent_runner`
   runs a tiny WS server inside the sandbox; the orchestrator gets its address
   via `expose_port()` (Daytona `get_preview_link` / E2B `get_host`) and proxies
   the browser WS to it.
4. **Project-file change events come from the agent**, not sandbox file-watch
   (Daytona has none). `agent_runner` knows when it writes `research.json` /
   `tree.gedcomx.json` and pushes deltas over the same WS.
5. **Object-store sync runs inside the sandbox** (it has the files + egress),
   giving durability independent of any vendor's snapshot subsystem.

---

## 4. The interface — `sandbox/base.py`

Six control-plane + six sandbox methods. Deliberately minimal so Daytona, E2B,
and a future Fly/raw-Firecracker/self-hosted provider all implement the same
contract.

```python
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Protocol, runtime_checkable


class SandboxState(str, Enum):
    RUNNING = "running"
    SUSPENDED = "suspended"   # FS preserved, process gone (Daytona stop/archive | E2B pause)
    MISSING = "missing"       # not found / deleted


@dataclass(frozen=True)
class Resources:
    cpu: int = 1              # vCPUs   — honored by Daytona (image path); on E2B comes from the
    memory_gb: int = 2        #            template, so advisory there (see E2BProvider docstring)
    disk_gb: int = 5


@dataclass(frozen=True)
class SandboxSpec:
    template: str                                          # Daytona snapshot/image | E2B template id
    env: dict[str, str] = field(default_factory=dict)      # boot-time, NON-secret only (decision #2)
    labels: dict[str, str] = field(default_factory=dict)   # Daytona labels | E2B metadata (user_id, etc.)
    resources: Resources | None = None
    auto_suspend_seconds: int = 900                        # idle → suspend
    persistent: bool = True                                # False → ephemeral (delete on stop)


@dataclass(frozen=True)
class ConnectURL:
    url: str                                               # reach an in-sandbox server port
    headers: dict[str, str] = field(default_factory=dict)  # auth header(s), provider-specific


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


@runtime_checkable
class Process(Protocol):
    """A long-lived process inside the sandbox (the per-user agent_runner)."""
    @property
    def pid(self) -> str: ...
    def stdout(self) -> AsyncIterator[bytes]: ...
    def stderr(self) -> AsyncIterator[bytes]: ...
    async def write_stdin(self, data: bytes) -> None: ...
    async def wait(self) -> int: ...
    async def kill(self) -> None: ...


@runtime_checkable
class Sandbox(Protocol):
    @property
    def id(self) -> str: ...
    @property
    def state(self) -> SandboxState: ...

    # process / exec
    async def exec(self, cmd: str, *, cwd: str | None = None,
                   env: dict[str, str] | None = None, timeout: int | None = None) -> ExecResult: ...
    async def start_process(self, cmd: str, *, cwd: str | None = None,
                            env: dict[str, str] | None = None) -> Process: ...

    # networking
    async def expose_port(self, port: int) -> ConnectURL: ...

    # filesystem (secrets file, project-folder I/O, object-store sync)
    async def read_file(self, path: str) -> bytes: ...
    async def write_file(self, path: str, data: bytes) -> None: ...
    async def list_dir(self, path: str) -> list[DirEntry]: ...


class SandboxProvider(ABC):
    """Vendor-neutral control plane. Implemented by DaytonaProvider / E2BProvider / (future) FlyProvider."""
    @abstractmethod
    async def create(self, spec: SandboxSpec) -> Sandbox: ...
    @abstractmethod
    async def get(self, sandbox_id: str) -> Sandbox: ...        # MISSING state if gone
    @abstractmethod
    async def resume(self, sandbox_id: str) -> Sandbox: ...     # suspended → running (FS rewarmed)
    @abstractmethod
    async def suspend(self, sandbox_id: str) -> None: ...       # running → suspended (FS preserved)
    @abstractmethod
    async def delete(self, sandbox_id: str) -> None: ...
    @abstractmethod
    async def list(self, labels: dict[str, str] | None = None) -> list[Sandbox]: ...
```

---

## 5. Provider mapping (verified SDK calls, 2026)

| Neutral op | Daytona (`AsyncDaytona`) | E2B (`AsyncSandbox`, SDK v2.5.0) |
|---|---|---|
| `create(spec)` | `daytona.create(CreateSandboxFromImageParams(image, env_vars, labels, ephemeral, auto_stop_interval=secs//60, resources=Resources(cpu,memory,disk)))` | `AsyncSandbox.create(template, envs, metadata, timeout, allow_internet_access=True)` |
| `get` / `resume` | `daytona.get(id)` → `sandbox.start()` | `AsyncSandbox.connect(id)` (auto-resumes if paused) |
| `suspend` | `sandbox.stop()` (or `.archive()` for cheap long idle) | `sandbox.pause()` |
| `delete` | `sandbox.delete()` | `sandbox.kill()` |
| `list(labels)` | `daytona.list(ListSandboxesQuery(labels=…))` | `AsyncSandbox.list(SandboxQuery(metadata=…))` |
| `exec` | `sandbox.process.exec(cmd, cwd, env, timeout)` | `sandbox.commands.run(cmd, envs, cwd, timeout)` |
| `start_process` | `process.create_session(sid)` → `execute_session_command(sid, SessionExecuteRequest(cmd, run_async=True))` → `.cmd_id` | `commands.run(cmd, background=True, stdin=True, on_stdout=…)` → `CommandHandle` |
| `Process.write_stdin` | `process.send_session_command_input(sid, cmd_id, data)` | `commands.send_stdin(pid, data)` |
| `Process.stdout` | `process.get_session_command_logs_async(sid, cmd_id, on_stdout, on_stderr)` | `CommandHandle` iteration / `on_stdout` |
| `expose_port` | `sandbox.get_preview_link(port)` → `{url, token}`; header `x-daytona-preview-token` | `sandbox.get_host(port)` → `https://{host}` (+ optional `e2b-traffic-access-token`) |
| `read/write/list` | `fs.download_file` / `fs.upload_file(bytes, path)` / `fs.list_files(path)` | `files.read` / `files.write` / `files.list(path, depth)` |
| self-host config | `DaytonaConfig(api_url, target, api_key)` | `domain` / `api_url` / `api_key` params |

The long-lived process is where the abstraction earns its keep — both bridge
into one `asyncio.Queue` exposed as the neutral `Process.stdout`:

```python
# DaytonaProcess: session command + log callback → queue
async def start_process(self, cmd, *, cwd=None, env=None) -> Process:
    sid = f"agent-{uuid4().hex}"
    await self._sb.process.create_session(sid)
    resp = await self._sb.process.execute_session_command(
        sid, SessionExecuteRequest(command=cmd, run_async=True))       # → resp.cmd_id
    q: asyncio.Queue[bytes | None] = asyncio.Queue()
    asyncio.create_task(self._sb.process.get_session_command_logs_async(
        sid, resp.cmd_id, on_stdout=lambda l: q.put_nowait(l.encode()), on_stderr=...))
    return _DaytonaProcess(self._sb, sid, resp.cmd_id, q)              # write_stdin → send_session_command_input

# E2BProcess: background command handle + on_stdout → queue
async def start_process(self, cmd, *, cwd=None, env=None) -> Process:
    q: asyncio.Queue[bytes | None] = asyncio.Queue()
    handle = await self._sb.commands.run(
        cmd, background=True, cwd=cwd, envs=env, stdin=True,
        on_stdout=lambda d: q.put_nowait(d.encode()), on_stderr=...)    # → CommandHandle, handle.pid
    return _E2BProcess(self._sb, handle, q)                            # write_stdin → commands.send_stdin(pid)
```

---

## 6. Stub — `agent_runner.py` (runs INSIDE the sandbox)

A tiny WS server that owns one user's agent. Streams chat + project-file deltas
over a single WS; restores context via the Agent SDK's own session resume; syncs
the project folder to object storage. **Sketch — verify API names against the
installed `claude-agent-sdk` version.**

```python
"""agent_runner.py — one per user sandbox. Listens on :8080.

Protocol (JSON over WS):
  in : {"type":"user_msg","text": "..."}
  out: {"type":"agent_event", ...}      # streamed Agent SDK messages/tool calls
       {"type":"file_delta","file":"research.json","data":{...}}
"""
import asyncio, json, pathlib
import websockets
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

PROJECT_DIR = pathlib.Path("/project")
SECRETS = pathlib.Path("/run/secrets/session.json")     # written by orchestrator each connect
MCP_BUILD = "/opt/genealogy-mcp/build/index.js"
WATCHED = ["research.json", "tree.gedcomx.json"]

def load_creds() -> dict:
    return json.loads(SECRETS.read_text())              # fs_token, anthropic_key, session_id, objstore_*

def build_options(creds: dict) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        cwd=str(PROJECT_DIR),
        resume=creds.get("session_id"),                 # restore prior conversation (decision #1)
        setting_sources=["project"],                    # load .claude/skills/ from the project
        skills="all",
        permission_mode="bypassPermissions",            # operator-controlled, headless
        env={"ANTHROPIC_API_KEY": creds["anthropic_key"]},
        mcp_servers={
            "genealogy": {                              # the existing stdio MCP server, unchanged
                "command": "node",
                "args": [MCP_BUILD],
                # NOTE: the MCP server must accept a per-session FS token via env/config
                # rather than the global ~/.familysearch-mcp/tokens.json (auth refactor).
                "env": {"FAMILYSEARCH_ACCESS_TOKEN": creds["fs_token"]},
            }
        },
    )

async def snapshot_files() -> dict:
    out = {}
    for name in WATCHED:
        p = PROJECT_DIR / name
        out[name] = p.read_text() if p.exists() else None
    return out

async def handle(ws):
    creds = load_creds()
    async with ClaudeSDKClient(options=build_options(creds)) as client:
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("type") != "user_msg":
                continue
            before = await snapshot_files()
            await client.query(msg["text"])
            async for event in client.receive_response():
                await ws.send(json.dumps({"type": "agent_event", "event": _serialize(event)}))
            after = await snapshot_files()
            for name, data in after.items():            # decision #4: agent emits file deltas
                if data != before.get(name):
                    await ws.send(json.dumps({"type": "file_delta", "file": name, "data": data}))
            await sync_to_object_store(creds)           # decision #5: durability from inside

async def main():
    async with websockets.serve(handle, "0.0.0.0", 8080):
        await asyncio.Future()

# _serialize(), sync_to_object_store() omitted — push PROJECT_DIR to S3/GCS using objstore_* creds.
if __name__ == "__main__":
    asyncio.run(main())
```

---

## 7. Sketch — FastAPI session orchestrator (runs on the always-on host)

`create → inject-secrets → start agent_runner → expose port → proxy WS → suspend
on idle`. Provider is config-selected (`SANDBOX_PROVIDER=e2b|daytona`); the rest
is identical. **Sketch.**

```python
import json, asyncio, websockets
from fastapi import FastAPI, WebSocket
from sandbox.base import SandboxProvider, SandboxSpec, SandboxState

app = FastAPI()
provider: SandboxProvider = make_provider()             # E2BProvider(...) | DaytonaProvider(...)
AGENT_PORT = 8080
SPEC = SandboxSpec(template="genealogy-agent:latest", auto_suspend_seconds=900)

async def ensure_sandbox(user_id: str):
    sandbox_id = await db_lookup_sandbox(user_id)       # user → sandbox_id map
    if sandbox_id is None:
        sb = await provider.create(SandboxSpec(**{**SPEC.__dict__, "labels": {"user_id": user_id}}))
        await db_store_sandbox(user_id, sb.id)
    else:
        sb = await provider.get(sandbox_id)
        if sb.state is SandboxState.SUSPENDED:
            sb = await provider.resume(sandbox_id)      # FS rewarmed; process re-launched below
        elif sb.state is SandboxState.MISSING:
            sb = await provider.create(SPEC); await db_store_sandbox(user_id, sb.id)
    return sb

@app.websocket("/ws/{user_id}")
async def session_ws(browser_ws: WebSocket, user_id: str):
    await browser_ws.accept()
    sb = await ensure_sandbox(user_id)

    # decision #2: fresh per-user secrets as a file (env can't be mutated on a live sandbox)
    creds = {
        "fs_token": await get_fresh_familysearch_token(user_id),
        "anthropic_key": OPERATOR_ANTHROPIC_KEY,
        "session_id": await db_lookup_agent_session(user_id),   # None on first run
        **object_store_creds(user_id),
    }
    await sb.write_file("/run/secrets/session.json", json.dumps(creds).encode())

    # (re)launch the in-sandbox agent server (decision #1: never assume it survived suspend)
    await sb.start_process("python /opt/agent_runner.py")
    conn = await sb.expose_port(AGENT_PORT)             # ConnectURL{url, headers}

    # proxy browser WS <-> in-sandbox agent WS
    async with websockets.connect(conn.url.replace("https", "wss"), extra_headers=conn.headers) as agent_ws:
        await _pump(browser_ws, agent_ws)              # bidirectional until either closes

    await provider.suspend(sb.id)                       # idle → suspend (FS preserved)

async def _pump(a, b):
    async def fwd(src, dst): 
        try:
            while True: await dst.send(await src.receive_text())
        except Exception: pass
    await asyncio.gather(fwd(a, b), fwd(b, a))
```

---

## 8. Documented abstraction leaks (known, bounded)

- **`Resources` is advisory on E2B** — CPU/RAM come from the template; bake sizes
  into the template. Honored on Daytona's image path.
- **`auto_suspend` units differ** — Daytona wants minutes (`auto_stop_interval`);
  adapter converts. E2B uses `timeout` seconds + `set_timeout` to extend.
- **No env mutation on a running sandbox** on either platform → secrets are
  file-based (decision #2), not an interface method.
- **No native whole-directory sync** on either → object-store sync runs inside
  the sandbox; an orchestrator-side pull would be `exec("tar …")` + `read_file`.
- **`expose_port` auth differs** (Daytona token header vs E2B optional traffic
  token) → absorbed into `ConnectURL.headers`, callers stay uniform.
- **MCP-server token sourcing** — the existing genealogy MCP server reads the FS
  token from `~/.familysearch-mcp/tokens.json`. For per-session multi-tenancy it
  must accept the token via env/config (the auth refactor noted in project
  direction). `agent_runner` injects it via `mcp_servers[...].env`.

---

## 9. Open questions / next steps

1. **Pivotal platform question** → put to FamilySearch security: hardware/microVM
   isolation required, or hardened shared-kernel (Sysbox) acceptable? Decides
   E2B vs Daytona endgame.
2. **Verify E2B compliance** (SOC2/HIPAA/DPA) via `trust.e2b.dev` — governs the
   interim managed phase for family PII.
3. **Spike the WS-port pattern** + microVM pause/resume with live FamilySearch
   sockets + WebSocket re-attach (highest-risk unknown; prototype on E2B).
4. **Flesh out the two adapters** (`DaytonaProvider`, `E2BProvider`) into runnable
   modules; add the `agent_runner` object-store sync and the MCP token refactor.
5. **Build-time:** a sandbox image/template bundling Node + Python + the Agent
   SDK + the genealogy MCP `build/` + the `.claude/skills/`.
