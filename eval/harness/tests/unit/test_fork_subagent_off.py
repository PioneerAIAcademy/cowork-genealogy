"""`env_for_sdk` keeps fork subagents off on the pinned CLI.

From CLI 2.1.302 the Agent tool offers `subagent_type: "fork"` in SDK sessions by
default. A fork inherits the main thread's context and tools rather than a plugin
agent's `tools:` list, so a run that forked would test a delegation production
does not make. `CLAUDE_CODE_FORK_SUBAGENT=0` removes the offer; if a CLI upgrade
renamed or dropped the variable, every run would still pass.

The CLI's first request goes to a local listener that answers 400, so no model is
called. The main-thread request carries the Agent tool's prompt, where the fork
offer is a sentence.
"""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from claude_agent_sdk import ClaudeAgentOptions

from harness.auth import AuthConfig, env_for_sdk
from harness.sdk_query import close_query, open_query

_FORK_OFFER = "forks yourself"


def _agent_tool_prompt(tmp_path, extra_env: dict[str, str]) -> str:
    bodies: list[dict] = []

    class Capture(BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("content-length", 0)))
            if self.path.startswith("/v1/messages") and "count_tokens" not in self.path:
                bodies.append(json.loads(raw))
            self.send_response(400)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"type":"error","error":{"type":"invalid_request_error","message":"capture"}}')

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Capture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    options = ClaudeAgentOptions(
        cwd=str(tmp_path),
        setting_sources=[],
        permission_mode="bypassPermissions",
        env={
            **extra_env,
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_port}",
            "ANTHROPIC_API_KEY": "sk-capture",
            "CLAUDE_CODE_OAUTH_TOKEN": "",
            "ANTHROPIC_AUTH_TOKEN": "",
            "ENABLE_TOOL_SEARCH": "false",
        },
        max_turns=1,
    )

    async def main() -> None:
        stream = open_query(prompt="hi", options=options)
        try:
            async for _ in stream:
                if bodies:
                    break
        except Exception:
            pass
        finally:
            await close_query(stream)

    try:
        asyncio.run(main())
    finally:
        server.shutdown()
    for body in bodies:
        for tool in body.get("tools", []):
            if tool.get("name") == "Agent":
                return json.dumps(tool)
    raise AssertionError(f"no request carried the Agent tool ({len(bodies)} captured)")


def test_the_cli_offers_forks_by_default(tmp_path):
    assert _FORK_OFFER in _agent_tool_prompt(tmp_path, {}), (
        "the CLI no longer offers fork subagents by default, so the test below passes vacuously"
    )


def test_env_for_sdk_turns_forks_off(tmp_path):
    env = env_for_sdk(AuthConfig(skill_runner_mode="subscription", api_key=None, detail=""))
    assert _FORK_OFFER not in _agent_tool_prompt(tmp_path, env)
