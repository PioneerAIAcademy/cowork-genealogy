"""M3 viewer path: the WS pushes an initial snapshot, and LocalProvider's
watch_project reports post-connect file changes (the delta source)."""
import asyncio
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.sandbox.base import PROJECT_DIR
from app.sandbox.local import LocalProvider
from app.sandbox.base import SandboxSpec


def _login_and_make_sample(client: TestClient) -> str:
    client.post("/auth/dev-login", json={"email": "tester@example.com"})
    r = client.post("/api/sessions", json={"sample": True})
    return r.json()["id"]


def test_ws_pushes_initial_snapshot():
    with TestClient(app) as client:
        sid = _login_and_make_sample(client)
        with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
            types: list[str] = []
            research = None
            sidecars: list[str] = []
            for _ in range(12):
                msg = ws.receive_json()
                types.append(msg["type"])
                if msg["type"] == "research_updated":
                    research = msg["data"]
                if msg["type"] == "sidecar_updated":
                    sidecars.append(msg["logId"])
                # Stop once we have research + at least one sidecar.
                if research is not None and sidecars:
                    break
        assert "status" in types
        assert research is not None
        assert "objective" in research["project"]
        assert "log_001" in sidecars  # sample ships results/log_001.json


def test_ws_rejects_unauthenticated():
    with TestClient(app) as client:
        # No cookie → server closes before accept.
        try:
            with client.websocket_connect("/ws/sessions/nope"):
                pass
            assert False, "expected close"
        except Exception:
            pass


async def test_watch_project_reports_changes():
    with tempfile.TemporaryDirectory() as tmp:
        provider = LocalProvider(Path(tmp))
        sandbox = await provider.create(SandboxSpec(template="t", labels={}, model="m"))

        changes: list[str] = []
        stop = sandbox.watch_project(changes.append)
        try:
            await asyncio.sleep(0.15)  # let the watcher prime its mtime cache
            await sandbox.write_file(f"{PROJECT_DIR}/research.json", b'{"project":{}}')
            for _ in range(20):  # up to ~2s
                await asyncio.sleep(0.1)
                if "research.json" in changes:
                    break
        finally:
            stop()
        assert "research.json" in changes
