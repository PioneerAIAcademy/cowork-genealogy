"""Regression guard: the eval skill-runner must isolate MCP to the genealogy mock.

The skill run executes under subscription auth from ~/.claude, so the CLI would
otherwise expose the developer's claude.ai account connectors
(`mcp__claude_ai_Claude_Docs__*`, Google_Drive, Slack, …) to the skill. The
model reaches for one, the genealogy mock can't match it, and the run aborts
with `unmatched_tool_call` — a spurious failure unrelated to the skill
(locality-guide ut_003, 2026-09-21). `strict_mcp_config=True` on the
ClaudeAgentOptions makes the SDK use ONLY `mcp_servers` and ignore every other
MCP source. `setting_sources=["project"]` does not cover this — account
connectors arrive through the login, not settings.json.

Asserted by parsing the source (the options are built inline in `run`, with no
seam to construct them in isolation) so the flag cannot be dropped silently.
"""

import ast
from pathlib import Path

_SKILL_RUNNER = Path(__file__).resolve().parents[2] / "harness" / "skill_runner.py"


def _claude_agent_options_call(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "ClaudeAgentOptions":
            return node
    return None


def test_skill_runner_sets_strict_mcp_config_true():
    tree = ast.parse(_SKILL_RUNNER.read_text(encoding="utf-8"))
    call = _claude_agent_options_call(tree)
    assert call is not None, "no ClaudeAgentOptions(...) call found in skill_runner.py"
    kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}
    assert "strict_mcp_config" in kwargs, (
        "ClaudeAgentOptions must set strict_mcp_config to isolate the skill run "
        "from claude.ai account connectors (unmatched_tool_call aborts)"
    )
    val = kwargs["strict_mcp_config"]
    assert isinstance(val, ast.Constant) and val.value is True, (
        "strict_mcp_config must be True, not "
        f"{ast.dump(val)} — anything else re-opens the account-connector leak"
    )


def test_skill_runner_still_registers_the_genealogy_mock():
    """Guard the other half: strict isolation is only safe because the genealogy
    mock is the one server passed. If mcp_servers stopped including it, strict
    mode would leave the skill with no genealogy tools at all."""
    tree = ast.parse(_SKILL_RUNNER.read_text(encoding="utf-8"))
    call = _claude_agent_options_call(tree)
    kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}
    assert "mcp_servers" in kwargs and isinstance(kwargs["mcp_servers"], ast.Dict)
    keys = [k.value for k in kwargs["mcp_servers"].keys if isinstance(k, ast.Constant)]
    assert "genealogy" in keys, "mcp_servers must still register the 'genealogy' mock"
