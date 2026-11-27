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

import json

from tests.unit.cli_capture import capture_request_bodies

from harness.auth import AuthConfig, env_for_sdk

_FORK_OFFER = "forks yourself"


def _agent_tool_prompt(tmp_path, extra_env: dict[str, str]) -> str:
    bodies = capture_request_bodies(tmp_path, extra_env)
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
