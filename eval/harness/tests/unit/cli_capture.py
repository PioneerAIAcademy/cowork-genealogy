"""Capture the CLI's own first request without a key, a model or a network call.

Two tests pin a CLI default that `env_for_sdk` turns off — the fork offer in the
Agent tool, and the `# Memory` block in the system prompt. Both need the same
thing: start the real CLI, let it build one request, answer 400, read what it
sent. Only the extraction differs, so that is what each test keeps.

It was duplicated first, and the two copies had already drifted on whether HOME
was redirected. The redirect is unconditional here: a run that leaves a CLI
default ON must not be able to write into the operator's own `~/.claude`.
"""
from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from claude_agent_sdk import ClaudeAgentOptions

from harness.sdk_query import close_query, open_query


def capture_request_bodies(
    tmp_path,
    extra_env: dict[str, str],
    *,
    system_prompt: dict | None = None,
) -> list[dict]:
    """Every `/v1/messages` body the CLI sends before it gives up on the 400.

    `system_prompt` is passed through: with none the request carries ~136
    characters, so a test that reads the system prompt must ask for the preset
    production actually sends.
    """
    bodies: list[dict] = []

    class Capture(BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("content-length", 0)))
            if self.path.startswith("/v1/messages") and "count_tokens" not in self.path:
                bodies.append(json.loads(raw))
            self.send_response(400)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"type":"error","error":{"type":"invalid_request_error","message":"capture"}}'
            )

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Capture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    kwargs = {} if system_prompt is None else {"system_prompt": system_prompt}
    options = ClaudeAgentOptions(
        cwd=str(tmp_path),
        setting_sources=[],
        permission_mode="bypassPermissions",
        env={
            **extra_env,
            # A control arm leaves its CLI default ON, so keep any write in tmp.
            "HOME": str(home),
            "CLAUDE_CONFIG_DIR": str(home / ".claude"),
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_port}",
            "ANTHROPIC_API_KEY": "sk-capture",
            "CLAUDE_CODE_OAUTH_TOKEN": "",
            "ANTHROPIC_AUTH_TOKEN": "",
            "ENABLE_TOOL_SEARCH": "false",
        },
        max_turns=1,
        **kwargs,
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
        # shutdown() stops serve_forever; without this the listening fd stays
        # open, and the harness runs many CLI-spawning tests in one process.
        server.server_close()
    return bodies
