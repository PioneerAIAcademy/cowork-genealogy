# E2BProvider — implementation plan

**Status:** **CORE implemented + live-validated on a real E2B microVM
(2026-06-06)** — lifecycle + files + state in `app/sandbox/e2b.py`, fake-SDK tests
green, and a live create→write FS token→pause→resume→read-back→delete round-trip
passed (Risk #4 resolved). `start_process`/`watch_project` deferred to Ably
Option B (see §0). **Branch:** `hosted-web-workbench`.
**Read with:** `sandbox-provider-interface.md` (original interface design + verified
SDK mapping), `apps/server/app/sandbox/base.py` (the **as-built** contract — the
source of truth, which has drifted from the original doc), `apps/server/sandbox/README.md`
(the E2B template image, already built-out).

This plan covers **only the gap**: turning `apps/server/app/sandbox/e2b.py` from a
stub into a working provider, plus the one control-plane edit it needs. Everything
upstream (the template image, the engine staging, the launch contract) is already
done — this is the Python adapter that runs on the always-on host and drives E2B.

---

## 0. Scope & relationship to Ably Option B (READ FIRST — re-scoped 2026-06-06)

The first draft of this plan implemented the **Ably Option A** shape: the control
plane holds the per-session `LiveSession`, so the E2B adapter had to pump the
agent's stdio (`E2BProcess` + `start_process`) and watch `/project` from the host
(`watch_project`). **But Option B is the committed production architecture**
(affinity-free control plane; sticky routing is disallowed). Under Option B a thin
**bridge process runs inside the sandbox** (its boot command), owns all Ably I/O +
the `/project` poll-watch, and spawns `agent_runner` as its child — so **no
control-plane instance holds a `Process`/watch/`LiveSession`**.

Verified coupling: the **only** caller of `start_process` + `watch_project` is
`live_session.py` (the control-plane component Option B removes). So those E2B
pieces are Option-A-only.

**This plan is therefore re-scoped to the architecture-agnostic CORE** — the
subset both A and B need, that every REST path already uses (`sessions`,
`familysearch`, `feedback` all call `resume`/`get` + `read/write/list_file`), and
that validates the headline risk (does a microVM pause/resume preserve `/project`
+ `~/.familysearch-mcp/tokens.json`?) with **zero throwaway**:

- **IN SCOPE (core):** `create` (auto-pause on timeout) · `get`/`resume`
  (`connect`) · `suspend` (`pause`) · `delete` (`kill`) · `list` · `aclose` ·
  `read_file`/`write_file`/`list_dir`/`file_mtime` · `exec` · `state` mapping
  (RUNNING/SUSPENDED/MISSING).
- **DEFERRED to Ably Option B (the in-sandbox bridge owns these):** `E2BProcess`,
  host-driven `start_process`, `watch_project`, and the `agent_launch` seam (§3.5).
  The ABC still requires `start_process`/`watch_project`/`expose_port` to exist, so
  they're implemented as **explicit `NotImplementedError`** ("runs in the Option B
  sandbox bridge"), not host logic. `expose_port` stays a thin dead stub.

So §3.3 (stdout re-assembly), §3.5 (launch seam), and the `Process` half of §4/§7
below are **deferred** — kept for reference / the Option-A fallback, but not built
now. `chat.py` is **not** touched in the core scope.

### Phase 0 SDK findings (verified against `e2b` 2.x, installed)

The draft's SDK guesses were checked against the real async SDK — **three
corrections**:

| Draft assumed | Actual (verified) |
|---|---|
| `create(..., on_timeout='pause')` | `create(..., lifecycle={"on_timeout": "pause", "auto_resume": True})` — `on_timeout` lives in the `SandboxLifecycle` TypedDict, not a top-level kwarg |
| `file_mtime` may need a `stat` fallback (§3.4) | **No fallback needed** — `EntryInfo.modified_time: datetime` is returned by `files.list`/`files.get_info`; use `.timestamp()` |
| `read_file` via `files.read(path)` | `files.read(path, format="bytes")` — default is text |

Confirmed as-drafted: `AsyncSandbox.connect(sandbox_id)` reconnects by id
(class-method variant, auto-resumes a paused VM); `pause()`/`kill()` are instance
methods; `commands.run(cmd, background, envs, cwd, on_stdout, stdin, timeout)`;
`AsyncSandbox.list(query=SandboxQuery(metadata=labels))`. Not-found errors:
`SandboxNotFoundException` (connect) and `FileNotFoundException` (files) from
`e2b.exceptions`.

---

## 1. What already exists (so this plan is only the delta)

| Piece | State | Where |
|---|---|---|
| E2B template image (`genealogy-agent`) — Node 20 + Python 3.12 + `claude-agent-sdk` + engine prod tree + packages/engine/plugin/skills + agent package | **Done, buildable** (needs an `E2B_API_KEY` to push) | `apps/server/sandbox/{e2b.Dockerfile,e2b.toml,build-image.sh,README.md}` |
| `LocalProvider` — a full reference implementation of the exact same contract | **Done** | `apps/server/app/sandbox/local.py` |
| The vendor-neutral contract (`Sandbox`, `Process`, `SandboxProvider`) | **Done** | `apps/server/app/sandbox/base.py` |
| Config knobs (`sandbox_provider`, `e2b_api_key`, `e2b_template`) + factory dispatch | **Done** | `apps/server/app/config.py`, `apps/server/app/sandbox/factory.py` |
| Deploy wiring (`SANDBOX_PROVIDER=e2b` in `fly.toml`; control-plane container does **not** bake the engine) | **Done** | `deploy/fly.toml`, `deploy/Dockerfile` |
| **`E2BProvider` / `E2BSandbox` / `E2BProcess` bodies** | **STUB** (`NotImplementedError`) | `apps/server/app/sandbox/e2b.py` ← this plan |
| **`chat.py` launch seam** for the baked-image launch command/env | **Local-only** | `apps/server/app/chat.py` ← this plan |
| `e2b` SDK dependency + lockfile | **Missing** | `apps/server/pyproject.toml` ← this plan |
| Provider mapping tests (fake SDK) + a live smoke gated on `E2B_API_KEY` | **Missing** | `apps/server/tests/` ← this plan |

---

## 2. The contract as-built (and where the original doc is stale)

`sandbox-provider-interface.md` §4–5 is the design rationale, but the code shipped
differently. **Implement against `base.py`, not the doc.** The material drifts:

> **E2B sandboxes are persistent — pause/resume, never reaped.** Paused sandboxes
> are kept indefinitely (no TTL); resume-by-id works any time; the only continuous-
> *running* limit (24h Pro / 1h Hobby) is reset by pausing, and at timeout the VM
> auto-pauses (preserving the full FS) rather than being deleted. So the FS
> (including `~/.familysearch-mcp/tokens.json`) survives suspend/resume, and the
> only thing that destroys a sandbox is an explicit `delete()`/`kill()`. Do **not**
> design token re-injection, re-create-on-missing, or stale-handle eviction as if
> sandboxes get reaped. Docs: e2b.dev/docs/sandbox/persistence. **The one
> dependency:** `create()` must configure auto-pause on timeout (§3.6).

- **`Process` is stdio, not a WS server.** The original "in-sandbox WS server +
  `expose_port` + proxy" (decision #3) was replaced: the agent_runner speaks JSON
  lines over **stdio**, because the Agent SDK's anyio subprocess transport hangs
  inside `websockets.serve` (see POC status "Real agent"). As-built `Process` =
  `pid`, `stdout() -> AsyncIterator[str]` (decoded lines, no trailing newline),
  `write_stdin(str)`, `is_alive()`, `kill()`. The doc's `stderr()` / `wait()` /
  bytes streams are **gone**.
- **`expose_port` is dead on the hot path.** Still abstract (must be implemented),
  but nothing in the control plane calls it (grep-confirmed). A thin `get_host`
  impl satisfies the ABC; it is not on the critical path.
- **`watch_project` is the viewer path**, owned by the control plane (not the
  agent emitting deltas as the doc's decision #4 imagined). E2B has
  `files.watch_dir`.
- **New methods the doc didn't have:** `model`, `file_mtime`, `agent_project_dir`,
  `agent_home_dir`, `read_project_snapshot` (the last has a working base default
  built on `read_file`/`list_dir`/`file_mtime` — no E2B-specific work needed).
- **`SandboxSpec` shrank** to `template, labels, env, auto_suspend_seconds, model`
  (no `Resources`/`persistent` — resources are baked into the E2B template).

### Method-by-method: what calls it, and the E2B mapping

E2B mapping per `e2b.py` docstring + interface-doc §5 (SDK v2.5.0, `AsyncSandbox`).
**Phase 0 verifies these against the installed SDK** — names below are the target.

| Contract method | Called by (control plane) | E2B mapping |
|---|---|---|
| `provider.create(spec)` | `sessions.create_session` (then immediately `write_file` to seed / connect FS) | `AsyncSandbox.create(template, envs=spec.env, metadata=spec.labels, allow_internet_access=True, timeout=…, on_timeout=pause)` (auto-pause not kill — §3.6; Phase 0 verifies the param name) |
| `provider.get(id)` | `familysearch.status`, `sessions.sidecar` | `AsyncSandbox.connect(id)`; **catch NotFound → return a MISSING sandbox** (don't throw) |
| `provider.resume(id)` | `sessions.{resume,state,connect}`, `live_session.ensure`, `feedback`, `familysearch.dev_connect` — **almost every REST hit** | `AsyncSandbox.connect(id)` (auto-resumes if paused) |
| `provider.suspend(id)` | `main._idle_suspend_loop` | `sandbox.pause()` |
| `provider.delete(id)` | `sessions.delete_session` | `sandbox.kill()` |
| `provider.list(labels)` | (not currently called; keep for parity) | `AsyncSandbox.list(SandboxQuery(metadata=labels))` |
| `provider.aclose()` | `main.lifespan` shutdown | close cached handles (best-effort) |
| `sandbox.exec(cmd,…)` | (not on hot path; used by `file_mtime` fallback) | `sandbox.commands.run(cmd, envs, cwd, timeout)` |
| `sandbox.start_process(cmd,env)` | `chat.start_agent_process` | `commands.run(cmd, background=True, envs=env, stdin=True, on_stdout=…)` → `CommandHandle` |
| `sandbox.read_file/write_file/list_dir` | snapshot, seed, token injection, sidecar read | `files.read(path)` / `files.write(path, data)` / `files.list(path)` |
| `sandbox.file_mtime(path)` | viewer sidecar race-guard | `files.list` entry mtime **if exposed**, else `exec("stat -c %Y …")` fallback (see §3.4) |
| `sandbox.watch_project(cb)` | `live_session.start` (viewer deltas) | `files.watch_dir("/project", on_event, recursive=True)` → return its stopper |
| `sandbox.expose_port(port)` | **nothing** (dead) | thin `get_host(port)` → `ConnectURL` |
| `sandbox.{id,state,model}` | orchestration / idle loop | `id` from handle; `state` from cached liveness + connect result; `model` from `metadata` |
| `agent_project_dir()` / `agent_home_dir()` | `chat.start_agent_process` | **use base defaults** (`/project`, `/home/user`) — do NOT override (only Local overrides, to point at real disk) |

**One efficiency note:** `get`/`resume` are called on nearly every REST request,
each a network `connect()`. An optional trivial `dict` cache by id avoids the
obvious repeats (§3.1) — but `connect()` is idempotent, so this is a nicety, not
correctness.

---

## 3. Design decisions

### 3.1 Optional trivial handle cache (keep it simple)
`resume()`/`get()` fire per-request, each a `connect()`. A plain
`dict[str, AsyncSandbox]` populated on first `connect()` and dropped on
`delete()`/`suspend()` avoids redundant connects. **No lock, no staleness/eviction
machinery** — `connect()` to a running sandbox is idempotent (a concurrent
double-connect just yields two handles to the same VM, harmless), and E2B
sandboxes don't vanish out from under us (§2), so there's nothing to evict on. If
per-request `connect()` latency never shows up as a problem, drop the cache
entirely for v1. Add complexity only when measurement proves it's needed.

### 3.2 `get()`/`resume()` return MISSING, never throw
`get()` (and now `resume()`, for parity with LocalProvider) of a gone sandbox
returns a `Sandbox` whose `state is MISSING` — catch `SandboxNotFoundException`
and return a handle-less `E2BSandbox` whose **reads** are inert (`read_file→None`,
`list_dir→[]`, `file_mtime→None`) and whose **writes/exec** raise a clear
"MISSING" error (via `_require_handle()`), not an opaque `AttributeError`.

**`state` on E2B is RUNNING or MISSING only — never SUSPENDED**, because
`connect()` *auto-resumes* a paused VM (there's no read-without-resume on E2B; the
FS is only readable while the VM runs). That's fine: nothing in the control plane
branches on SUSPENDED, and `get()`'s only callers — familysearch `/status` and the
sessions sidecar read — fire **during active session use** (`/status` is called on
session open + right after a connect attempt; it is **not** polled on a timer).
So `get()`-resumes never wakes an *idle* sandbox today. The only thing that could
is a future **background `/status` poller**; if one is ever added, have it read
FS-connected state from the **DB** rather than the sandbox (do **not** add
lazy-connect machinery — it would still resume on the actual read). *(Reviewed
2026-06-06: flagged "fix-first", resolved as document-and-defer for this reason.)*

### 3.3 stdout must be re-assembled into lines
`Process.stdout()` yields **one decoded line, no trailing newline** (the pump in
`live_session.pump_agent` does `json.loads(line)` per item, one JSON object per
line). E2B's `on_stdout` delivers **arbitrary chunks** that can split mid-line.
`E2BProcess` buffers chunks, splits on `\n`, and pushes complete lines into an
`asyncio.Queue` (flush any trailing partial on close). **Termination:** when the
runner exits, `on_stdout` simply stops firing — so bind the `CommandHandle`'s
exit/completion to push an EOF sentinel into the queue, mirroring how
`LocalProcess` emits `done` from its reader thread. Without it `stdout()` never
returns and `live_session.pump_agent` leaks a task per turn. `write_stdin` passes
through verbatim (caller already appends `\n`).

### 3.4 `file_mtime` — verify the files API first, `stat` fallback
The viewer sidecar race-guard depends on a real mtime. If `files.list` entries
don't carry a modification time in the installed SDK, fall back to
`exec("stat -c %Y <path>")` and parse. Confirm in Phase 0; this is the one FS
method with no guaranteed primitive. (`read_project_snapshot`'s base default
calls `file_mtime`, so getting this right fixes both.)

### 3.5 Keep `chat.py` provider-neutral via a launch seam on `Sandbox`
`chat.start_agent_process` currently hardcodes `cmd = f"{sys.executable} -m
app.agent.runner"` and `PYTHONPATH=apps/server` — correct for Local (runs against
the repo), wrong for the baked image (`python3`, `PYTHONPATH=/opt/genealogy-agent/server`,
plus `ENGINE_MCP_BUILD`/`ENGINE_PLUGIN_DIR`). Rather than branch on provider type
in `chat.py` (which breaks the abstraction), add **one method to the `Sandbox`
ABC**:

```python
# base.py — default is the Local behavior
def agent_launch(self) -> tuple[str, dict[str, str]]:
    """(command, extra_env) to start the in-sandbox agent_runner."""
    import sys
    from pathlib import Path
    server_root = Path(__file__).resolve().parents[1].parent  # apps/server
    return (f"{sys.executable} -m app.agent.runner", {"PYTHONPATH": str(server_root)})
```

`E2BSandbox` overrides it to `("python3 -m app.agent.runner", {})` — the image
bakes `PYTHONPATH`/`ENGINE_MCP_BUILD`/`ENGINE_PLUGIN_DIR` as `ENV`, and
`commands.run(envs=…)` merges over them, so the per-session env stays minimal.
`chat.py` becomes:

```python
cmd, extra = sandbox.agent_launch()
env = {**common_env, **extra}        # common = AGENT_MODE/PROJECT_DIR/HOME/MODEL/ANTHROPIC_API_KEY
return await sandbox.start_process(cmd, env=env)
```

This is the **only** control-plane change. (The sandbox README already documents
exactly these env vars as the launch contract; this seam is how they get set.)

### 3.6 Idle/suspend ownership + auto-pause-on-timeout (the no-reap guarantee)
The control plane already runs `_idle_suspend_loop` (1800s, FS-preserving,
never under a live socket). That stays the primary suspend driver →
`provider.suspend → sandbox.pause()`. **`create()` must configure auto-pause on
timeout** (JS `onTimeout: 'pause'`; Phase 0 verifies the Python param) so that if
a sandbox ever hits E2B's continuous-running limit (24h Pro / 1h Hobby) it
*pauses* (FS preserved indefinitely) instead of being killed — this is what makes
the "never reaped" model (§2) actually true. Set the create `timeout` to a
generous backstop too. `resume = connect()` auto-resumes a paused VM. `SandboxSpec.
auto_suspend_seconds` is advisory here (the control plane decides) — document it.

### 3.7 Lazy SDK import
The factory already imports `E2BProvider` lazily (only on `SANDBOX_PROVIDER=e2b`).
Keep the `e2b` SDK import **inside** methods / module-local, so local/CI runs
(which never set the e2b branch) don't need the package installed at import time.
Add `e2b` to `[project.dependencies]` regardless (the image and prod need it), but
don't make `from .e2b import E2BProvider` require it unless actually selected.

### 3.8 `expose_port` — minimal, off the hot path
Implement as `get_host(port) → ConnectURL(url=f"https://{host}")` to satisfy the
ABC. Nothing calls it; do not invest in proxy/auth-header handling.

---

## 4. Module layout — `apps/server/app/sandbox/e2b.py`

Three classes, mirroring `local.py`'s structure (`E2BProcess`, `E2BSandbox`,
`E2BProvider`). Sketch (target SDK surface; **verify names in Phase 0**):

```python
from __future__ import annotations
import asyncio
from collections.abc import AsyncIterator, Callable
from .base import (ConnectURL, DirEntry, ExecResult, Process, Sandbox,
                   SandboxProvider, SandboxSpec, SandboxState, PROJECT_DIR)

class E2BProcess(Process):
    def __init__(self, handle):          # CommandHandle from commands.run(background=True)
        self._h = handle
        self._q: asyncio.Queue = asyncio.Queue()
        self._buf = ""                   # line re-assembly (§3.3)
    # on_stdout(chunk): split on "\n", queue complete lines, keep remainder in _buf
    @property
    def pid(self) -> str: ...            # handle.pid
    async def stdout(self) -> AsyncIterator[str]: ...   # drain _q until EOF sentinel
    async def write_stdin(self, data: str) -> None: ... # commands.send_stdin(pid, data)
    async def is_alive(self) -> bool: ...               # handle not exited
    async def kill(self) -> None: ...                   # commands.kill(pid)

class E2BSandbox(Sandbox):
    def __init__(self, sb, *, sandbox_id, model, state=SandboxState.RUNNING):
        self._sb = sb                    # AsyncSandbox (None when MISSING)
        ...
    # id/state/model props; exec/start_process; read_file/write_file/list_dir/file_mtime;
    # watch_project (files.watch_dir → stopper); expose_port (get_host);
    # agent_launch() -> ("python3 -m app.agent.runner", {})
    # (do NOT override agent_project_dir/agent_home_dir — base defaults are correct)

class E2BProvider(SandboxProvider):
    def __init__(self, api_key, template):
        self._api_key, self._template = api_key, template
        self._cache: dict[str, object] = {}     # optional trivial cache, no lock (§3.1)
    async def create(self, spec): ...            # AsyncSandbox.create(..., on_timeout=pause) → cache → E2BSandbox
    async def get(self, sandbox_id): ...         # connect; NotFound → MISSING (§3.2)
    async def resume(self, sandbox_id): ...      # connect (auto-resume)
    async def suspend(self, sandbox_id): ...     # pause; evict cache
    async def delete(self, sandbox_id): ...      # kill; evict cache
    async def list(self, labels=None): ...       # AsyncSandbox.list(SandboxQuery(metadata=labels))
    async def aclose(self): ...                  # best-effort close cached handles
```

Delete the stub's constructor `NotImplementedError` and the per-method
`NotImplementedError` bodies. Keep (and update) the docstring's SDK mapping table.

---

## 5. Dependencies & config

- **`apps/server/pyproject.toml`**: add `"e2b>=2.5"` (the `AsyncSandbox` SDK) to
  `[project.dependencies]`; run `uv lock` so `apps/server/uv.lock` updates (the
  control-plane `deploy/Dockerfile` installs from the lockfile with
  `uv sync --frozen --no-dev`).
- **Config**: nothing new — `e2b_api_key`, `e2b_template` (`"genealogy-agent"`),
  and `sandbox_provider` already exist in `config.py`. The factory already
  dispatches on them.
- **Template id**: after the first `make sandbox-image` build, the e2b CLI writes
  a generated `template_id` into `e2b.toml`; commit it (per the sandbox README).
  The control plane references the template by **name** so this isn't blocking.

---

## 6. Phased steps

1. **Phase 0 — verify the SDK surface. ✅ DONE** (findings in §0; recorded in the
   e2b.py docstring). `uv add e2b` landed.
2. **Phase 1 — implement the CORE `e2b.py`** (`E2BSandbox` files+lifecycle +
   `E2BProvider`), following §0 scope + the verified signatures. `exec` +
   `file_mtime` (`modified_time.timestamp()`) + MISSING-state handling.
   `start_process`/`watch_project` raise `NotImplementedError` ("Option B sandbox
   bridge"); `expose_port` is a thin stub. Lazy SDK imports. **No `chat.py`
   change** (the launch seam is deferred with the Process work).
3. **Phase 2 — core tests against a fake SDK** (§7, re-scoped to the core): a
   dict-backed fake `AsyncSandbox` covering the create/connect/pause/kill
   lifecycle, files round-trip, `list_dir`, `file_mtime`, MISSING state, and the
   `lifecycle={"on_timeout":"pause"}` / `metadata` / `allow_internet_access`
   create mapping. CI-safe, no account.
4. **Phase 3 — live CORE smoke against a real account (the headline risk).** Build
   the template (`make sandbox-image`), set `E2B_API_KEY` + `SANDBOX_PROVIDER=e2b`,
   and run the architecture-agnostic round-trip that de-risks everything:
   **create → `write_file` an FS token → `pause` → `connect`(resume) → `read_file`
   the token back (unchanged) → `list_dir`/`file_mtime` → `delete`.** This proves
   microVM pause/resume preserves `/project` + `~/.familysearch-mcp/tokens.json`
   (interface-doc open question #3) using only core methods — the single thing
   that can invalidate the E2B choice.
5. **(Deferred — Ably Option B)** the in-sandbox bridge: it owns Ably I/O +
   `/project` watch + spawns `agent_runner`. At that point `start_process`,
   `watch_project`, `E2BProcess` (§3.3 stdout re-assembly) and the `agent_launch`
   seam (§3.5) are built **there** (or, if Option A is ever needed as a fallback,
   un-defer them here). Full chat/viewer-on-E2B is validated then.

> Not in scope: `wiki_read` / `wiki_place_page` need the pre-crawled markdown
> corpus on the sandbox FS (`wikiMarkdownDir`) — that's a property of the E2B
> **image**, tracked in `apps/server/sandbox/README.md`, not this host-side
> adapter. (`wiki_search` is unaffected — it calls the external `wiki-query-api`
> over the network.)

---

## 7. Testing

- **Shared parametrized contract suite** (`tests/sandbox/test_provider_contract.py`,
  CI-safe): ONE pytest-parametrized suite over `[LocalProvider (real dirs),
  E2BProvider (fake SDK)]` asserting both providers satisfy the *same* contract,
  so behavioral drift fails a test instead of the E2B tests quietly diverging from
  what Local satisfies. The E2B param injects a minimal in-memory fake
  `AsyncSandbox` (dict-backed FS, recorded commands) via monkeypatch. Cover the
  `create`/`get`/`resume`/`suspend`/`delete` lifecycle; `read`/`write_file`
  round-trip; `list_dir`; `file_mtime`; and `start_process` chunked stdout →
  whole JSON lines (the §3.3 re-assembly — feed `'{"a":'` then `'1}\n'`, expect
  one line `'{"a":1}'`) plus EOF-sentinel termination. Provider-specific
  assertions (E2B mapping: `create → AsyncSandbox.create` with
  `metadata=labels`/`allow_internet_access`/`on_timeout`; `suspend → pause`;
  `delete → kill`; trivial-cache reuse) live in a thin E2B-only addendum.
  Mirror `test_chat.py`'s assertion style.
- **Launch-seam test**: `LocalSandbox.agent_launch()` returns the venv python +
  `apps/server` PYTHONPATH; `E2BSandbox.agent_launch()` returns
  `python3 -m app.agent.runner` + empty extra env. (Cheap regression guard on the
  one abstraction the control plane now depends on.)
- **Live smoke** (`tests/sandbox/test_e2b_live.py`, `@pytest.mark.skipif(not
  E2B_API_KEY)`): the Phase-4 round-trip, skipped by default so CI stays
  account-free.

LocalProvider already exercises all the **control-plane** paths through the same
contract, so no control-plane behavior tests change — only the provider-internal
mapping is new.

---

## 8. Risks / open questions

1. **SDK drift (medium).** Method names/signatures in §2/§4 are from the
   interface doc + e2b.py docstring, not a live install — Phase 0 is the gate.
2. **`file_mtime` (medium).** If `files.list` carries no mtime, the `stat`
   fallback (§3.4) adds an `exec` per sidecar in the snapshot — acceptable, but
   confirm cost on real projects with many `results/*.json`.
3. **`watch_dir` semantics (medium).** Event path normalization + latency vs the
   Local 0.7s poll; the viewer expects `rel` under `/project`. Verify the event
   carries create *and* modify, and that it survives pause/resume (or is
   re-established on resume — `watch_project` is set up fresh in
   `live_session.start`, so a resume re-arms it; fine).
4. **Pause/resume with live sockets (high — the headline unknown).** Interface
   doc open question #3. The agent_runner is **re-launched** on every connect
   (never assumed to survive suspend), and conversation is restored via the Agent
   SDK's on-disk `resume=session_id` (`.agent_session`, which survives E2B's FS
   pause — already proven locally per POC status). Phase 4 validates this on a
   real microVM with live FamilySearch egress.
5. **Per-request `connect()` cost (low).** The optional trivial cache (§3.1)
   removes obvious repeats; no staleness handling needed since sandboxes persist
   (§2). Drop the cache for v1 if latency never bites.
6. **Compliance/PII (out of scope, tracked).** Interface doc open questions #1–2
   (microVM-vs-Sysbox requirement; E2B SOC2/HIPAA/DPA) gate the *endgame
   platform choice*, not this adapter. POC defers PII (no living-person data).

---

## 9. Acceptance criteria

**Core (this plan):**
- `SANDBOX_PROVIDER=e2b` + `E2B_API_KEY` boots the control plane (factory builds
  `E2BProvider` with no constructor `NotImplementedError`).
- The live CORE round-trip works on a real microVM: create → `write_file` FS
  token → `pause` → resume(`connect`) → `read_file` token unchanged →
  `list_dir`/`file_mtime` → `delete`. (Proves pause/resume FS persistence.)
- Fake-SDK core mapping tests pass in CI (no account): lifecycle + files +
  MISSING + the `lifecycle`/`metadata`/`allow_internet_access` create mapping.
- `LocalProvider` behavior is unchanged; **no control-plane file is touched**
  (the `chat.py`/`agent_launch` seam is deferred with the Process work).
- `start_process`/`watch_project` raise a clear `NotImplementedError` pointing at
  Option B (not silent stubs).

**Full chat/viewer-on-E2B** (create → chat turn streams `agent_event`s → viewer
delta → suspend/resume continuity → delete) is the **Option B** acceptance, not
this plan's.
