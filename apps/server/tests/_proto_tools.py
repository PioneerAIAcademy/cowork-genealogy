"""The real Streamable HTTP tool server (``packages/engine/mcp-server/build/http.js``) as a
test fixture: spawned against a scratch database, called through the Python MCP client.

test_proto_fencing_pg.py needs the engine's real claim fence and the worker's real claim
SQL in one test, so it runs the built server as a process -- two of them, the way two
instances would. Without ``node`` or the build the module skips, except under ``CI``,
where it fails, so the job cannot pass by skipping; a build older than any engine source
always fails, because it would test code that is no longer the code.
"""

from __future__ import annotations

import contextlib
import os
import queue
import re
import shutil
import subprocess
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from psycopg.conninfo import conninfo_to_dict

ENGINE = Path(__file__).resolve().parents[3] / "packages" / "engine" / "mcp-server"
HTTP_JS = ENGINE / "build" / "http.js"
BUILD_HINT = "npm --prefix packages/engine/mcp-server run build"
LISTENING = re.compile(r"listening on http://[^:]+:(\d+)/mcp")
START_S = 30.0


def require_tool_server_build() -> str:
    """The ``node`` executable, once the tool server's build is present and current."""
    node = shutil.which("node")
    missing = None if node else "node is not on PATH"
    if node and not HTTP_JS.is_file():
        missing = f"{HTTP_JS} is missing"
    if missing:
        if os.environ.get("CI"):
            pytest.fail(f"CI is set but {missing}: the tool-server fencing tests must run, not skip ({BUILD_HINT})")
        pytest.skip(f"{missing}; run `{BUILD_HINT}`")
    built = HTTP_JS.stat().st_mtime
    stale = sorted(str(p.relative_to(ENGINE)) for p in (ENGINE / "src").rglob("*.ts") if p.stat().st_mtime > built)
    if stale:
        pytest.fail(f"build/http.js is older than {', '.join(stale[:5])}: run `{BUILD_HINT}` -- "
                    "a stale build tests code that is no longer the engine's")
    return str(node)


def dsn_uri(dsn: str) -> str:
    """psycopg's ``key=value`` conninfo as the URI node-postgres takes."""
    parts = conninfo_to_dict(dsn)
    auth = quote(parts.get("user", "postgres"), safe="")
    if parts.get("password"):
        auth += ":" + quote(str(parts["password"]), safe="")
    host = parts.get("host", "localhost")
    return f"postgresql://{auth}@{host}:{parts.get('port', 5432)}/{quote(str(parts['dbname']), safe='')}"


class ToolServer:
    """One ``node build/http.js`` process; ``port`` is the one it bound."""

    def __init__(self, proc: subprocess.Popen, port: int, lines: list[str]) -> None:
        self.proc = proc
        self.port = port
        self.lines = lines

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/mcp"


@contextlib.contextmanager
def spawn_tool_server(dsn: str, home: Path) -> Iterator[ToolServer]:
    """The tool server over ``dsn``. It needs no S3 for the documents these tests write
    (the backend connects lazily), so the endpoint is a closed port. Every inherited
    ``GENEALOGY_*`` variable is dropped, so a developer's shell cannot point it elsewhere."""
    node = require_tool_server_build()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GENEALOGY_")}
    env.update({
        "GENEALOGY_PG_DSN": dsn_uri(dsn),
        "GENEALOGY_S3_BUCKET": "projects",
        "GENEALOGY_S3_ENDPOINT": "http://127.0.0.1:9",
        "GENEALOGY_S3_ACCESS_KEY": "test",
        "GENEALOGY_S3_SECRET_KEY": "test",
        "GENEALOGY_ANCHOR_PATH": "/project",
        "HOME": str(home),
    })
    proc = subprocess.Popen([node, str(HTTP_JS), "--host", "127.0.0.1", "--port", "0"], cwd=ENGINE, env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace")
    lines: list[str] = []
    ports: queue.Queue[int] = queue.Queue()

    def drain() -> None:
        # Read stderr to its end, so a chatty server never blocks on a full pipe.
        assert proc.stderr is not None
        for line in proc.stderr:
            lines.append(line.rstrip("\n"))
            found = LISTENING.search(line)
            if found:
                ports.put(int(found.group(1)))

    threading.Thread(target=drain, daemon=True, name="tool-server-stderr").start()
    try:
        try:
            port = ports.get(timeout=START_S)
        except queue.Empty:
            raise AssertionError(f"the tool server never printed its listening line; stderr: {lines}") from None
        yield ToolServer(proc, port, lines)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


async def call_tool(server: ToolServer, headers: dict[str, str], name: str, args: dict[str, Any]):
    """One ``tools/call`` through the Python MCP client, ``headers`` on every request.
    The ``CallToolResult``."""
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(60.0)) as http:
        async with streamable_http_client(server.url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as client:
                await client.initialize()
                return await client.call_tool(name, args)


def result_text(result) -> str:
    """Every text block of a ``CallToolResult``, joined."""
    return "\n".join(getattr(block, "text", "") for block in result.content)
