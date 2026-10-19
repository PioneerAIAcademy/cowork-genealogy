"""The project watcher must not broadcast engine bookkeeping to the viewer.

`Hub._watch_loop` walks the project RECURSIVELY (`PROJECT_DIR.rglob("*")`) while
`send_snapshot` lists `results/` one level deep (`results.glob("*.json")`). So a
file the engine keeps in a dot-directory under `results/` is invisible at
hydration but emitted on every write, and `_emit_change`'s `results/*.json` arm
turns it into a `sidecar_updated` naming a log id that does not exist.

`results/.staging/` has leaked this way since staging shipped, unnoticed because
a staged file is consumed or pruned inside 24h. `results/.scores/` — the
`same_person` attestation added by issue #1731 — persists and grows one entry
per scored record, so the leak would be permanent. Hence the dot-SEGMENT guard,
which also covers whatever lands next.

The one consumer of `sidecar_updated` is
`apps/web/src/transport/WsResearchTransport.ts`.
"""
import pytest

from app.sandbox_server import Hub


class _RecordingHub(Hub):
    """A Hub that records broadcasts instead of sending them."""

    def __init__(self):  # noqa: D107 - deliberately skips Hub.__init__
        self.sent: list[dict] = []

    async def broadcast(self, msg: dict) -> None:
        self.sent.append(msg)


@pytest.mark.parametrize(
    "rel",
    [
        "results/.scores/ab12cd34.json",
        "results/.staging/1f2e3d4c.json",
        ".hidden.json",
        "results/.scores/nested/deeper.json",
    ],
)
@pytest.mark.asyncio
async def test_dot_segments_are_never_broadcast(rel):
    hub = _RecordingHub()
    await hub._emit_change(rel)
    assert hub.sent == [], f"{rel} reached the viewer"


@pytest.mark.asyncio
async def test_a_real_sidecar_is_still_broadcast(tmp_path, monkeypatch):
    """The other direction. A guard that also silenced real sidecars would be
    invisible in the test above, which only proves things stay quiet."""
    import app.sandbox_server as mod

    monkeypatch.setattr(mod, "PROJECT_DIR", tmp_path)
    results = tmp_path / "results"
    results.mkdir()
    (results / "log_001.json").write_text("{}", encoding="utf-8")

    hub = _RecordingHub()
    await hub._emit_change("results/log_001.json")

    assert len(hub.sent) == 1
    assert hub.sent[0]["type"] == "sidecar_updated"
    assert hub.sent[0]["logId"] == "log_001"


@pytest.mark.asyncio
async def test_research_and_tree_still_broadcast(tmp_path, monkeypatch):
    import app.sandbox_server as mod

    monkeypatch.setattr(mod, "PROJECT_DIR", tmp_path)
    (tmp_path / "research.json").write_text('{"schema_version": "1.0"}', encoding="utf-8")
    (tmp_path / "tree.gedcomx.json").write_text('{"persons": []}', encoding="utf-8")

    hub = _RecordingHub()
    await hub._emit_change("research.json")
    await hub._emit_change("tree.gedcomx.json")

    assert [m["type"] for m in hub.sent] == ["research_updated", "gedcomx_updated"]


def test_is_internal_classifies_windows_separators_too():
    # The watcher builds `rel` with str(Path.relative_to), which is backslashed
    # on Windows, and the genealogist team is on Windows.
    assert Hub._is_internal("results\\.scores\\ab12.json") is True
    assert Hub._is_internal("results\\log_001.json") is False
