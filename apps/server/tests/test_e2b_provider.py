"""E2BProvider CORE mapping tests (lifecycle + files + state + cache), against a
fake AsyncSandbox — no E2B account, CI-safe. Uses the REAL e2b exceptions +
FileType (installed) and fakes only the network-touching AsyncSandbox.

The fake mirrors real-SDK shapes the live smoke can't pin in CI: `read(format=
"bytes")` returns a **bytearray** (so we assert the adapter coerces to bytes);
`list`/`get_info` return **naive** datetimes (protobuf ToDatetime); a class-level
FS store keyed by sandbox_id mimics pause/resume persistence (pause keeps it, kill
drops it, connect re-attaches); a connect counter verifies the handle cache.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

import e2b
import pytest
from e2b.exceptions import FileNotFoundException, SandboxNotFoundException
from e2b.sandbox.filesystem.filesystem import FileType

from app.sandbox.base import SandboxSpec, SandboxState
from app.sandbox.e2b import _RUNNING_TIMEOUT_S, E2BProvider


def _naive_now():
    # naive UTC, like the real SDK's protobuf ToDatetime() (no deprecation)
    return datetime.now(timezone.utc).replace(tzinfo=None)


class _FakeFiles:
    def __init__(self, store: dict[str, bytes]):
        self.store = store

    async def read(self, path, format="text"):
        if path not in self.store:
            raise FileNotFoundException(path)
        data = self.store[path]
        return bytearray(data) if format == "bytes" else data.decode()  # real SDK: bytearray

    async def write(self, path, data):
        self.store[path] = data if isinstance(data, bytes) else str(data).encode()

    async def list(self, path, depth=1):
        prefix = path.rstrip("/") + "/"
        files, dirs = set(), set()
        for k in self.store:
            if not k.startswith(prefix):
                continue
            rest = k[len(prefix):]
            (dirs if "/" in rest else files).add(rest.split("/", 1)[0])
        out = [SimpleNamespace(name=d, path=prefix + d, type=FileType.DIR, modified_time=_naive_now())
               for d in sorted(dirs)]
        out += [SimpleNamespace(name=f, path=prefix + f, type=FileType.FILE, modified_time=_naive_now())
                for f in sorted(files)]
        return out

    async def get_info(self, path):
        if path not in self.store:
            raise FileNotFoundException(path)
        return SimpleNamespace(name=path.rsplit("/", 1)[-1], path=path,
                               type=FileType.FILE, modified_time=_naive_now())


class _FakeHandle:
    stores: dict[str, dict[str, bytes]] = {}  # sandbox_id -> FS (persists across connect)

    def __init__(self, sandbox_id: str):
        self.sandbox_id = sandbox_id
        self.files = _FakeFiles(_FakeHandle.stores.setdefault(sandbox_id, {}))

    async def pause(self):
        pass  # FS (stores[id]) is intentionally NOT dropped

    async def kill(self):
        _FakeHandle.stores.pop(self.sandbox_id, None)


class _FakeAsyncSandbox:
    created: list[dict] = []
    connects = 0
    _n = [0]

    @classmethod
    async def create(cls, **kwargs):
        cls.created.append(kwargs)
        cls._n[0] += 1
        return _FakeHandle(f"sbx_fake_{cls._n[0]}")

    @classmethod
    async def connect(cls, sandbox_id, **kwargs):
        cls.connects += 1
        if sandbox_id not in _FakeHandle.stores:
            raise SandboxNotFoundException(sandbox_id)
        return _FakeHandle(sandbox_id)


@pytest.fixture
def provider(monkeypatch):
    _FakeHandle.stores.clear()
    _FakeAsyncSandbox.created.clear()
    _FakeAsyncSandbox.connects = 0
    monkeypatch.setattr(e2b, "AsyncSandbox", _FakeAsyncSandbox)
    return E2BProvider(api_key="fake-key", template="genealogy-agent")


def test_provider_requires_api_key():
    with pytest.raises(RuntimeError, match="E2B_API_KEY"):
        E2BProvider(api_key=None, template="genealogy-agent")


async def test_create_maps_to_sdk_exactly(provider):
    sb = await provider.create(
        SandboxSpec(template="genealogy-agent", labels={"user_id": "u1"},
                    env={"FOO": "bar"}, model="claude-sonnet-4-6")
    )
    assert sb.id.startswith("sbx_fake_")
    kw = _FakeAsyncSandbox.created[0]
    assert kw["lifecycle"] == {"on_timeout": "pause", "auto_resume": True}  # never reaped
    assert kw["allow_internet_access"] is True
    assert kw["timeout"] == _RUNNING_TIMEOUT_S          # continuous-running backstop kept
    assert kw["api_key"] == "fake-key"
    assert kw["envs"] == {"FOO": "bar"}
    assert kw["metadata"] == {"user_id": "u1", "model": "claude-sonnet-4-6"}


async def test_create_template_fallback(provider):
    await provider.create(SandboxSpec(template="", labels={}, model="m"))  # empty → provider default
    assert _FakeAsyncSandbox.created[0]["template"] == "genealogy-agent"


async def test_files_roundtrip_bytes_dirs_and_missing(provider):
    sb = await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    p = "/home/user/.familysearch-mcp/tokens.json"
    await sb.write_file(p, b'{"accessToken":"x"}')
    got = await sb.read_file(p)
    assert got == b'{"accessToken":"x"}'
    assert isinstance(got, bytes) and not isinstance(got, bytearray)  # coerced from SDK bytearray
    assert await sb.read_file("/project/nope.json") is None
    assert await sb.list_dir("/project/nope") == []
    assert await sb.file_mtime("/project/nope.json") is None

    await sb.write_file("/home/user/results/log_001.json", b"{}")
    await sb.write_file("/home/user/results/log_002.json", b"{}")
    results = await sb.list_dir("/home/user/results")
    assert {e.name for e in results} == {"log_001.json", "log_002.json"}
    assert all(not e.is_dir for e in results)
    # the DIR branch (is_dir=True) — listing /home/user surfaces results/ + .familysearch-mcp/
    top = {e.name: e.is_dir for e in await sb.list_dir("/home/user")}
    assert top["results"] is True and top[".familysearch-mcp"] is True
    assert isinstance(await sb.file_mtime("/home/user/results/log_001.json"), float)


async def test_handle_cache_reuse_and_reconnect(provider):
    sb = await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    sid = sb.id
    assert _FakeAsyncSandbox.connects == 0           # create() doesn't connect
    await provider.resume(sid)
    await provider.get(sid)
    assert _FakeAsyncSandbox.connects == 0           # both served from the create() cache
    await provider.suspend(sid)                      # pause + drop cache
    await provider.resume(sid)
    assert _FakeAsyncSandbox.connects == 1           # reconnect after suspend


async def test_pause_resume_preserves_fs_then_delete_is_missing(provider):
    created = await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    sid = created.id
    await created.write_file("/home/user/.familysearch-mcp/tokens.json", b"TOKEN")

    await provider.suspend(sid)                       # → pause (FS preserved)
    resumed = await provider.resume(sid)              # → connect (auto-resume)
    assert await resumed.read_file("/home/user/.familysearch-mcp/tokens.json") == b"TOKEN"

    await provider.delete(sid)                        # → kill (FS dropped)
    gone = await provider.get(sid)                    # connect raises NotFound → MISSING
    assert gone.state is SandboxState.MISSING
    assert await gone.read_file("/anything") is None  # MISSING handle: reads inert


async def test_resume_of_gone_sandbox_returns_missing_not_raises(provider):
    """Parity with get()/LocalProvider — resume() never raises on a gone sandbox."""
    gone = await provider.resume("sbx_does_not_exist")
    assert gone.state is SandboxState.MISSING
    # writes to a MISSING handle fail with a clear error, not an opaque AttributeError
    with pytest.raises(RuntimeError, match="MISSING"):
        await gone.write_file("/x", b"y")


async def test_deferred_option_b_methods_raise(provider):
    sb = await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    with pytest.raises(NotImplementedError, match="Option B"):
        await sb.start_process("python3 -m app.agent.runner")
    with pytest.raises(NotImplementedError, match="Option B"):
        sb.watch_project(lambda rel: None)
