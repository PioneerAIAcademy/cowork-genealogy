"""E2BProvider CORE mapping tests (lifecycle + files + state + cache), against a
fake AsyncSandbox — no E2B account, CI-safe. Uses the REAL e2b exceptions +
FileType (installed) and fakes only the network-touching AsyncSandbox.

The fake mirrors real-SDK shapes the live smoke can't pin in CI: `read(format=
"bytes")` returns a **bytearray** (so we assert the adapter coerces to bytes);
`list`/`get_info` return **naive** datetimes (protobuf ToDatetime); a class-level
FS store keyed by sandbox_id mimics pause/resume persistence (pause keeps it, kill
drops it, connect re-attaches); a connect counter verifies the handle cache.

`_FakeAsyncSandbox.image_files` models what the TEMPLATE bakes: every sandbox
create() mints starts with those files, which is how the baked-provenance
read-back is exercised without predicting the generated sandbox id (the id
counter `_n` is module-lifetime and is NOT reset by the fixture, so a test that
seeded `stores["sbx_fake_1"]` would pass in file order and break under -k).
"""
import asyncio
import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import e2b
import pytest
from e2b.exceptions import FileNotFoundException, SandboxNotFoundException
from e2b.sandbox.filesystem.filesystem import FileType

from app.sandbox.base import SandboxSpec, SandboxState
from app.sandbox.e2b import _BUILD_INFO_PATH, _RUNNING_TIMEOUT_S, E2BProvider


def _naive_now():
    # naive UTC, like the real SDK's protobuf ToDatetime() (no deprecation)
    return datetime.now(timezone.utc).replace(tzinfo=None)


class _FakeFiles:
    reads: list[str] = []  # every path read, across all handles — order preserved

    def __init__(self, store: dict[str, bytes]):
        self.store = store

    async def read(self, path, format="text"):
        _FakeFiles.reads.append(path)
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


class _FakeCommands:
    def __init__(self):
        self.runs: list[dict] = []

    async def run(self, cmd, background=None, envs=None, **kw):
        self.runs.append({"cmd": cmd, "background": background, "envs": envs or {}})
        return SimpleNamespace(exit_code=0, stdout="", stderr="")


class _FakeHandle:
    stores: dict[str, dict[str, bytes]] = {}  # sandbox_id -> FS (persists across connect)

    def __init__(self, sandbox_id: str):
        self.sandbox_id = sandbox_id
        self.files = _FakeFiles(_FakeHandle.stores.setdefault(sandbox_id, {}))
        self.commands = _FakeCommands()

    def get_host(self, port):  # sync, like the real SDK
        return f"{port}-{self.sandbox_id}.e2b.app"

    async def set_timeout(self, timeout):
        self.timeout = timeout

    async def pause(self):
        pass  # FS (stores[id]) is intentionally NOT dropped

    async def kill(self):
        _FakeHandle.stores.pop(self.sandbox_id, None)


class _FakeAsyncSandbox:
    created: list[dict] = []
    connects = 0
    _n = [0]
    image_files: dict[str, bytes] = {}  # what the template bakes into every new sandbox

    @classmethod
    async def create(cls, **kwargs):
        cls.created.append(kwargs)
        cls._n[0] += 1
        handle = _FakeHandle(f"sbx_fake_{cls._n[0]}")
        handle.files.store.update(cls.image_files)
        return handle

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
    _FakeAsyncSandbox.image_files = {}
    _FakeFiles.reads.clear()
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
    assert kw["metadata"] == {"user_id": "u1", "model": "claude-sonnet-4-6"}
    # envs = spec.env + agent env (AGENT_MODE + MODEL only; key is via secrets file)
    assert kw["envs"]["FOO"] == "bar"
    assert kw["envs"]["AGENT_MODE"] == "mock" and kw["envs"]["MODEL"] == "claude-sonnet-4-6"
    # the in-sandbox WS server was started with a derived per-sandbox secret
    runs = provider._cache[sb.id].commands.runs
    ws = next(r for r in runs if "app.sandbox_server" in r["cmd"])
    assert ws["background"] is True
    assert ws["envs"]["WS_TOKEN_SECRET"] and ws["envs"]["WS_PORT"] == "8080"


async def test_expose_port_returns_wss_url(provider):
    sb = await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    conn = await sb.expose_port(8080)
    assert conn.url.startswith("wss://") and f"8080-{sb.id}" in conn.url


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


# ── Baked image provenance (#1489) ────────────────────────────────────────────
# The template is referenced by a stable name and carries no version, so the only
# way to ask a running system which build a session is on is to read the file the
# image bakes. These pin the read-back; /api/health's use of it is in
# test_health.py.

def _info(commit: str, dirty: bool = False) -> bytes:
    return json.dumps({"commit": commit, "dirty": dirty, "built_at": "2026-09-16T00:00:00Z"}).encode()


async def test_create_reads_baked_image_provenance(provider):
    assert provider.sandbox_image_commit is None          # nothing created yet
    _FakeAsyncSandbox.image_files = {_BUILD_INFO_PATH: _info("abc123")}
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "abc123"
    assert _BUILD_INFO_PATH in _FakeFiles.reads           # read from the image, not guessed


async def test_dirty_image_build_is_marked(provider):
    """A clean sha claimed for an image built over uncommitted edits is worse
    than no sha, so the marker rides on the value itself."""
    _FakeAsyncSandbox.image_files = {_BUILD_INFO_PATH: _info("abc123", dirty=True)}
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "abc123+dirty"


async def test_second_create_refreshes_the_commit(provider):
    """`make sandbox-image` rebuilds the template IN PLACE and does not restart
    this process. A read-once-per-process cache would report the pre-rebuild
    commit forever — the stale-image blindness this field exists to remove."""
    _FakeAsyncSandbox.image_files = {_BUILD_INFO_PATH: _info("old111")}
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "old111"

    _FakeAsyncSandbox.image_files = {_BUILD_INFO_PATH: _info("new222")}   # template rebuilt
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "new222"


@pytest.mark.parametrize("baked", [
    pytest.param(None, id="file-absent"),                 # an image built before this shipped
    pytest.param(b"", id="empty"),
    pytest.param(b"not json at all", id="invalid-json"),
    pytest.param(b"{}", id="no-commit-key"),
    pytest.param(b'{"commit": null}', id="commit-null"),
    pytest.param(b'{"commit": ""}', id="commit-empty"),
    pytest.param(b'{"commit": 12345}', id="commit-not-a-string"),
    pytest.param(b'["abc123"]', id="json-array"),
    pytest.param(b'"abc123"', id="json-string"),
])
async def test_unreadable_provenance_never_breaks_create(provider, baked):
    """Provenance is observability. No shape of it may fail session creation, and
    an image predating this change has no such file at all."""
    _FakeAsyncSandbox.image_files = {} if baked is None else {_BUILD_INFO_PATH: baked}
    sb = await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert sb.id.startswith("sbx_fake_")                   # the session still works
    assert provider.sandbox_image_commit is None


async def test_failed_read_keeps_the_last_known_commit(provider):
    """A transient read failure must not blank a commit already reported — that
    would turn one bad read into a permanent `null` on /api/health."""
    _FakeAsyncSandbox.image_files = {_BUILD_INFO_PATH: _info("abc123")}
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "abc123"

    _FakeAsyncSandbox.image_files = {}                     # next read finds nothing
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "abc123"


async def test_dirty_flag_only_when_literally_true(provider):
    """`dirty` is the schema's boolean, not a truthiness test: a non-boolean is a
    malformed field, and marking a clean build dirty is its own false alarm."""
    for value in ("true", 1, "yes", None):
        _FakeAsyncSandbox.image_files = {
            _BUILD_INFO_PATH: json.dumps({"commit": "abc123", "dirty": value}).encode()
        }
        p = E2BProvider(api_key="k", template="t")
        await p.create(SandboxSpec(template="t", labels={}, model="m"))
        assert p.sandbox_image_commit == "abc123", f"dirty={value!r}"


async def test_unreadable_provenance_is_logged_at_warning(provider, caplog):
    """A silent failure here is indistinguishable from the healthy "no session
    created yet" state, because both surface as a null on /api/health. The level
    matters: `obs.py` attaches its handler to the `workbench` logger, which this
    module is not under, so a debug or info line here is dropped by the root
    logger's default WARNING and never emitted at all."""
    _FakeAsyncSandbox.image_files = {}                      # an image predating this change
    with caplog.at_level(logging.WARNING, logger="app.sandbox.e2b"):
        await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    # `caplog.at_level(WARNING)` drops sub-WARNING records before they reach
    # caplog.records, so asserting every record is >= WARNING would be a
    # tautology. This assertion is the one that catches a downgrade to log.info:
    # the message simply stops being captured.
    assert any(_BUILD_INFO_PATH in r.getMessage() for r in caplog.records), caplog.text


async def test_a_hanging_read_cannot_hang_session_creation(provider, monkeypatch):
    """The read sits inside create(). Unbounded, a stalled SDK call would hang
    session creation for a value that is only observability."""
    monkeypatch.setattr("app.sandbox.e2b._PROVENANCE_READ_TIMEOUT_S", 0.05)

    async def _never_returns(self, path):
        await asyncio.sleep(30)

    monkeypatch.setattr("app.sandbox.e2b.E2BSandbox.read_file", _never_returns)
    sb = await asyncio.wait_for(
        provider.create(SandboxSpec(template="t", labels={}, model="m")), timeout=5
    )
    assert sb.id.startswith("sbx_fake_")                    # the session still came up
    assert provider.sandbox_image_commit is None


# ── The SCHEMA half of the writer/reader seam (#1489) ─────────────────────────
# `_info()` above hand-writes its own JSON, so it is its own ground truth and
# cannot see the shipped writer. Rename a key in build-image.sh's printf and
# every other test stays green: `commit` would make production report null
# forever (with a WARNING per create), and `dirty` is worse because it is
# SILENT -- a dirty build would report a bare clean sha, which is the exact
# "a clean sha that lies is worse than no sha" failure the flag exists to
# prevent. The path half of this seam is pinned in
# tests/test_sandbox_image_provenance.py.

_BUILD_SCRIPT = Path(__file__).resolve().parents[3] / "apps" / "server" / "sandbox" / "build-image.sh"


def _shipped_provenance_bytes(commit: str, dirty: str) -> bytes:
    """Run the printf statement build-image.sh actually ships, with controlled
    values, and return exactly the bytes it would write into the image."""
    lines = _BUILD_SCRIPT.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("printf '{"))
    end = next(i for i in range(start, len(lines)) if '> "${PROVENANCE_FILE}"' in lines[i])
    stmt = "\n".join(lines[start:end + 1]).replace('> "${PROVENANCE_FILE}"', "")
    out = subprocess.run(
        ["bash", "-c", f'set -eu; _commit="{commit}"; _dirty={dirty}; {stmt}'],
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return out.stdout.encode("utf-8")


async def test_reader_parses_what_the_shipped_writer_emits(provider):
    """Seed the fake image with the REAL writer's bytes, not a hand-written copy."""
    _FakeAsyncSandbox.image_files = {
        _BUILD_INFO_PATH: _shipped_provenance_bytes("abc123", "false")
    }
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "abc123"


async def test_the_dirty_key_the_writer_emits_is_the_one_the_reader_reads(provider):
    """The silent half: a renamed `dirty` key drops the marker with no log line."""
    _FakeAsyncSandbox.image_files = {
        _BUILD_INFO_PATH: _shipped_provenance_bytes("abc123", "true")
    }
    await provider.create(SandboxSpec(template="t", labels={}, model="m"))
    assert provider.sandbox_image_commit == "abc123+dirty"
