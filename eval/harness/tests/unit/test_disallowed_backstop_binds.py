"""The unit harness's `disallowed_tools` backstop removes its tools on the pinned CLI.

`skill_runner.DISALLOWED_BACKSTOP` keeps Bash, WebFetch, WebSearch and
NotebookEdit away from a skill under test. If a CLI upgrade stopped honouring
`--disallowedTools`, a skill could reach a shell or the web during evals and
every run would still pass. This spawns the bundled CLI and reads the init
message's tool list, which the CLI sends before any model call. The key variables
are blanked and ANTHROPIC_BASE_URL points at a closed local port, so a stored
login cannot turn the run into a real request.
"""

from __future__ import annotations

import asyncio

from claude_agent_sdk import ClaudeAgentOptions, SystemMessage

from harness.sdk_query import close_query, open_query
from harness.skill_runner import DISALLOWED_BACKSTOP

_NO_CREDENTIALS = {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:9",
    "ANTHROPIC_API_KEY": "",
    "CLAUDE_CODE_OAUTH_TOKEN": "",
    "ANTHROPIC_AUTH_TOKEN": "",
}


def _init_tools(tmp_path, disallowed: list[str]) -> list[str]:
    options = ClaudeAgentOptions(
        cwd=str(tmp_path),
        setting_sources=[],
        permission_mode="bypassPermissions",
        disallowed_tools=disallowed,
        env=_NO_CREDENTIALS,
        max_turns=1,
    )

    async def main() -> list[str]:
        stream = open_query(prompt="hi", options=options)
        try:
            async for message in stream:
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    return list(message.data.get("tools") or [])
        finally:
            await close_query(stream)
        raise AssertionError("the CLI sent no init message")

    return asyncio.run(main())


def test_backstop_tools_are_offered_without_the_backstop(tmp_path):
    offered = _init_tools(tmp_path, [])
    assert set(DISALLOWED_BACKSTOP) <= set(offered), (
        f"the CLI no longer offers {sorted(set(DISALLOWED_BACKSTOP) - set(offered))} at all, "
        "so the backstop test below would pass vacuously"
    )


def test_backstop_tools_are_absent_with_the_backstop(tmp_path):
    offered = _init_tools(tmp_path, list(DISALLOWED_BACKSTOP))
    leaked = sorted(set(DISALLOWED_BACKSTOP) & set(offered))
    assert not leaked, f"disallowed_tools did not remove {leaked} from the session's tool list"
