"""`env_for_sdk` keeps Claude Code's auto-memory off on the pinned CLI.

Auto-memory writes a researcher's remark to a memory file under the session's
`~/.claude`, outside the project, unreviewed, and loads it into later sessions
(issue #4778). `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` removes it; if a CLI upgrade
renamed, dropped or re-polarised the variable, every dict assertion in the repo
would still pass.

The CLI's first request goes to a local listener that answers 400, so no model
is called. The preset system prompt carries the `# Memory` block, so the
capture shows whether the variable bound. It must be the PRESET: with no
`system_prompt` the request carries ~136 characters and no block either way,
which is what made an earlier capture report that this could not be tested
(issue #4778, "review-ready, 2026-11-23"). Re-measured 2026-11-23 on CLI
2.1.308 / SDK 0.2.172: unset 6345 chars with the block, `"1"` 4167 without.

`test_the_cli_carries_a_memory_block_by_default` is the positive control, so
the real test cannot pass vacuously. `test_a_falsy_value_forces_memory_on`
pins the polarity: on this variable `"0"` is not a weaker `"1"`, it is
`forced_on`, and it is the value of the `CLAUDE_CODE_FORK_SUBAGENT` line
directly above it in all three env builders.
"""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from claude_agent_sdk import ClaudeAgentOptions

from harness.auth import AuthConfig, env_for_sdk
from harness.sdk_query import close_query, open_query

_MEMORY_BLOCK = "# Memory"
VAR = "CLAUDE_CODE_DISABLE_AUTO_MEMORY"


def _system_prompt(tmp_path, extra_env: dict[str, str]) -> str:
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
    options = ClaudeAgentOptions(
        cwd=str(tmp_path),
        setting_sources=[],
        permission_mode="bypassPermissions",
        # Production's prompt, and the only one that carries the block.
        system_prompt={"type": "preset", "preset": "claude_code"},
        env={
            **extra_env,
            # The control arm leaves memory ON, so keep any write inside tmp.
            "HOME": str(home),
            "CLAUDE_CONFIG_DIR": str(home / ".claude"),
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
        field = body.get("system")
        if field is None:
            continue
        text = (
            "\n".join(b.get("text", "") for b in field if isinstance(b, dict))
            if isinstance(field, list)
            else str(field)
        )
        if text:
            return text
    raise AssertionError(f"no request carried a system prompt ({len(bodies)} captured)")


def test_the_cli_carries_a_memory_block_by_default(tmp_path):
    assert _MEMORY_BLOCK in _system_prompt(tmp_path, {}), (
        "the CLI no longer injects a memory block by default, so the test below "
        "passes vacuously"
    )


def test_env_for_sdk_turns_auto_memory_off(tmp_path):
    env = env_for_sdk(AuthConfig(skill_runner_mode="subscription", api_key=None, detail=""))
    assert _MEMORY_BLOCK not in _system_prompt(tmp_path, env)


def test_a_falsy_value_forces_memory_on(tmp_path):
    """`"0"` is not a weaker `"1"` — the CLI reads it as `forced_on`.

    It is the value of the `CLAUDE_CODE_FORK_SUBAGENT` line directly above this
    variable in all three env builders, so copying the neighbour is the one way
    this goes wrong, and every dict assertion would stay green.
    """
    assert _MEMORY_BLOCK in _system_prompt(tmp_path, {VAR: "0"})
