"""The SDK's stdout line ceiling (`max_buffer_size`) on both hosted planes — issue #4694.

A line past the ceiling stops the SDK's read loop, and that loop also answers hook callbacks,
so every later tool call fails with "hook did not respond". A main-thread PDF Read puts the
file's base64 on one line twice (measured 2.67x the file; a subagent's line carries it once,
1.33x), so the ceiling must cover two copies of the largest upload's base64.

These tests check the option is set, that it covers both upload caps, and that the SDK's real
read loop passes a max-upload line with it and fails one without it. They do not run a CLI,
so they do not show the downstream hook stall; the repro in the PR does.
"""
from __future__ import annotations

import ast
import base64
import json
import math
from pathlib import Path

import pytest
from claude_agent_sdk import ClaudeAgentOptions, CLIJSONDecodeError
from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport

from app import sessions
from app.agent import real_agent
from app.agent.real_agent import MAX_BUFFER_BYTES
from proto.web import project_blobs

REPO = Path(__file__).resolve().parents[3]
MiB = 1024 * 1024
UPLOAD_CAPS = {
    "alpha (app/sessions.py)": sessions._UPLOAD_MAX_BYTES,
    "beta (proto/web/project_blobs.py)": project_blobs.UPLOAD_MAX_BYTES,
}


def test_alpha_options_raise_the_buffer(tmp_path):
    assert real_agent.build_options(tmp_path).max_buffer_size == MAX_BUFFER_BYTES


@pytest.mark.parametrize("plane", sorted(UPLOAD_CAPS))
def test_buffer_covers_the_upload_cap(plane):
    cap = UPLOAD_CAPS[plane]
    needed = 2 * 4 * math.ceil(cap / 3) + MiB
    assert MAX_BUFFER_BYTES >= needed, (
        f"{plane} accepts {cap} bytes, whose base64 line needs {needed}; raise MAX_BUFFER_BYTES"
    )


def test_e2e_harness_mirrors_the_buffer():
    """eval/harness/e2e/orchestrator.py runs on its own venv, so it copies the value."""
    src = (REPO / "eval" / "harness" / "e2e" / "orchestrator.py").read_text(encoding="utf-8")
    values = [
        eval(compile(ast.Expression(kw.value), "orchestrator.py", "eval"), {"__builtins__": {}})
        for node in ast.walk(ast.parse(src))
        if isinstance(node, ast.Call)
        for kw in node.keywords
        if kw.arg == "max_buffer_size"
    ]
    assert values == [MAX_BUFFER_BYTES], f"orchestrator.py max_buffer_size values: {values}"


class _ExitedCleanly:
    returncode = 0

    async def wait(self):
        return 0


def _max_upload_line() -> str:
    payload = base64.b64encode(b"\0" * max(UPLOAD_CAPS.values())).decode("ascii")
    return json.dumps({"type": "user", "message": {"content": payload},
                       "tool_use_result": {"file": {"base64": payload}}}) + "\n"


async def _read_all(options: ClaudeAgentOptions, line: str) -> list[dict]:
    async def chunks():
        for i in range(0, len(line), 65536):
            yield line[i:i + 65536]

    transport = SubprocessCLITransport(prompt="", options=options)
    transport._process = _ExitedCleanly()
    transport._stdout_stream = chunks()
    return [m async for m in transport._read_messages_impl()]


async def test_sdk_reads_a_max_upload_line_with_our_options_only(tmp_path):
    line = _max_upload_line()
    with pytest.raises(CLIJSONDecodeError, match="exceeded maximum buffer size"):
        await _read_all(ClaudeAgentOptions(), line)
    messages = await _read_all(real_agent.build_options(tmp_path), line)
    assert len(messages) == 1
    payload = messages[0]["message"]["content"]
    assert len(payload) == 4 * math.ceil(max(UPLOAD_CAPS.values()) / 3)
    assert messages[0]["tool_use_result"]["file"]["base64"] == payload
