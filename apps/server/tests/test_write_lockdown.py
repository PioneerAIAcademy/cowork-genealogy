"""Raw Write/Edit must not reach research.json / tree.gedcomx.json — issue #940,
`docs/specs/guardrail-enforcement-spec.md` §6.

Every write to the two project files has to go through the MCP writer tools,
which validate before persisting. That rule was prose plus, in the e2e harness,
a `PreToolUse` deny. The hosted path had neither: it runs
`permission_mode="bypassPermissions"` with no allowlist, and unlike e2e's
`dontAsk` that mode does not deny Write/Edit on its own.

The predicate tests are the load-bearing ones — a hook that stops matching is
silent, which is the failure mode this whole issue is about.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.agent import real_agent

PLUGIN_DIR = Path(__file__).resolve().parents[3] / "packages" / "engine" / "plugin"


# ── the predicate ────────────────────────────────────────────────

@pytest.mark.parametrize("tool", ["Write", "Edit", "NotebookEdit"])
@pytest.mark.parametrize(
    "path",
    [
        "/project/research.json",
        "research.json",
        "./research.json",
        # The model composes this path itself; a Windows-style separator must
        # not slip past the basename match.
        r"C:\Users\Dell\project\research.json",
    ],
)
def test_protected_file_is_detected_on_every_write_tool_and_path_shape(tool, path):
    assert real_agent.direct_project_file_write(tool, {"file_path": path}) == "research.json"


def test_tree_file_is_protected_too():
    got = real_agent.direct_project_file_write("Write", {"file_path": "/project/tree.gedcomx.json"})
    assert got == "tree.gedcomx.json"


@pytest.mark.parametrize(
    "tool_name, tool_input",
    [
        # Not a file-write tool. The MCP writer tools are the sanctioned route
        # and must stay open; Read/Bash are a different code path.
        ("Read", {"file_path": "/project/research.json"}),
        ("mcp__genealogy__research_append", {"file_path": "/project/research.json"}),
        ("Bash", {"command": "cat /project/research.json"}),
        # A write the agent is entitled to make.
        ("Write", {"file_path": "/project/results/log_001.json"}),
        ("Write", {"file_path": "/project/notes.md"}),
        # A near-miss name must not be caught.
        ("Write", {"file_path": "/project/research.json.bak"}),
        # Malformed input must not raise.
        ("Write", {}),
        ("Write", None),
    ],
)
def test_unprotected_calls_are_not_flagged(tool_name, tool_input):
    assert real_agent.direct_project_file_write(tool_name, tool_input) is None


# ── the hook ─────────────────────────────────────────────────────

async def test_hook_denies_a_raw_write_without_stopping_the_turn():
    out = await real_agent._pretool_hook(
        {"tool_name": "Write", "tool_input": {"file_path": "/project/research.json"}}, None, None
    )
    hook = out["hookSpecificOutput"]
    assert hook["hookEventName"] == "PreToolUse"
    assert hook["permissionDecision"] == "deny"
    # The reason is the agent's only feedback, so it must name the way out.
    assert "research_append" in hook["permissionDecisionReason"]
    # A denied write is recoverable — the turn continues so the agent can pivot
    # to the writer tool.
    assert "stopReason" not in out and "continue_" not in out


async def test_hook_passes_everything_else_through():
    assert await real_agent._pretool_hook(
        {"tool_name": "Write", "tool_input": {"file_path": "/project/notes.md"}}, None, None
    ) == {}
    assert await real_agent._pretool_hook(
        {"tool_name": "mcp__genealogy__research_append", "tool_input": {"ops": []}}, None, None
    ) == {}


# ── the wiring ───────────────────────────────────────────────────

def test_build_options_registers_the_pretool_hook(tmp_path, monkeypatch):
    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    opts = real_agent.build_options(tmp_path)

    matchers = opts.hooks["PreToolUse"]
    assert [h for m in matchers for h in m.hooks] == [real_agent._pretool_hook]
    # matcher=None so it fires for every tool, not just an MCP prefix.
    assert all(m.matcher is None for m in matchers)
