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

import re
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
    # Scoped, not matcher=None. `None` fired the hook for every tool, so one
    # unanswered callback took down `ToolSearch` too (issue #1915).
    assert [m.matcher for m in matchers] == [real_agent._PRETOOL_MATCHER]
    assert all(m.matcher for m in matchers), "a falsy matcher fires for every tool"
    # Explicitly set, so the effective bound is not whichever CLI default applies.
    assert [m.timeout for m in matchers] == [real_agent._PRETOOL_TIMEOUT_S]
    assert 0 < real_agent._PRETOOL_TIMEOUT_S <= 60


def test_the_matcher_is_derived_from_the_deny_arms_not_restated(tmp_path, monkeypatch):
    """Hard-errors if a constant is renamed or emptied, rather than silently
    checking nothing — the failure mode `tests/packaging/plugin-hooks.test.ts`
    is written against, and the way the plugin's matcher and its predicate
    diverged with every test green (guardrail spec, "Closed 2026-08-17/18").
    """
    file_tools = real_agent._FILE_WRITE_TOOLS
    device_tools = real_agent.DEVICE_WRITE_TOOLS
    assert file_tools, "_FILE_WRITE_TOOLS is empty — the matcher would lose its file arm"
    assert device_tools, "DEVICE_WRITE_TOOLS is empty — the matcher would lose the bridge"

    expected = "|".join((*file_tools, *(f".*{t}" for t in device_tools)))
    assert real_agent._PRETOOL_MATCHER == expected, (
        "the matcher is no longer the join of the deny-arm constants. Derive it; "
        "a restated list is what diverges."
    )
    # The `.*` on the bridge name is load-bearing, not decoration: the bare form
    # shipped inert once, because Cowork namespaces the tool and the predicate
    # matches on the bare tail.
    for t in device_tools:
        assert f".*{t}" in real_agent._PRETOOL_MATCHER


@pytest.mark.parametrize(
    "tool_name",
    [
        "Write",
        "Edit",
        "NotebookEdit",
        "device_commit_files",
        "mcp__remote-devices__device_commit_files",
        "mcp__remote-devices__Genealogy_Research__device_commit_files",
    ],
)
def test_the_matcher_binds_every_tool_the_hook_denies(tool_name):
    """Anchored full match AND substring search, because which one the CLI
    applies is not ours to choose."""
    payload = {"file_path": "research.json", "files": [{"path": "research.json"}]}
    assert real_agent.direct_project_file_write(tool_name, payload), (
        f"{tool_name} is in this list because the hook denies it; it no longer does"
    )
    pattern = real_agent._PRETOOL_MATCHER
    assert re.fullmatch(pattern, tool_name) or re.search(pattern, tool_name), (
        f"the hook denies {tool_name} but the matcher does not bind it, so the "
        f"deny never runs — inert with the whole suite green"
    )


@pytest.mark.asyncio
async def test_the_matcher_covers_every_tool_the_hook_can_deny():
    """THE ANTI-INERT ARM, and the one that catches a future deny arm.

    A matcher narrower than its predicate is a guard that does nothing while
    every test passes. This asserts the converse of the test above: the hook
    must deny NOTHING the matcher fails to bind. So if a deny arm is added to
    `_pretool_hook` for a tool absent from `_PRETOOL_MATCHER` — the shape open
    PR #2179 introduces with its `Bash` credential-exfiltration deny, whose own
    tests call `_pretool_hook` directly and would stay green — this fails and
    names the tool.

    Deliberately not a hard-coded list of "tools we know are safe": the point is
    to catch a tool nobody thought about, so the payload is one that WOULD be
    denied if the tool were ever routed.
    """
    pattern = real_agent._PRETOOL_MATCHER
    payload = {
        "file_path": "research.json",
        "files": [{"path": "research.json"}],
        "command": "cat > research.json",
        "ops": [],
    }
    unbound_but_denied = []
    for tool_name in (
        "Bash",
        "ToolSearch",
        "Read",
        "Glob",
        "Grep",
        "Task",
        "device_bash",
        "mcp__remote-devices__device_bash",
        "mcp__genealogy__research_append",
        "mcp__genealogy__tree_edit",
        "WebFetch",
    ):
        binds = bool(re.fullmatch(pattern, tool_name) or re.search(pattern, tool_name))
        if binds:
            continue
        decision = await real_agent._pretool_hook(
            {"tool_name": tool_name, "tool_input": payload}, None, None
        )
        if decision:
            unbound_but_denied.append(tool_name)
    assert unbound_but_denied == [], (
        f"_pretool_hook denies {unbound_but_denied}, which _PRETOOL_MATCHER does not "
        f"bind, so those denies never fire. Add the tool(s) to the deny-arm constants "
        f"the matcher is derived from, in the same commit as the arm."
    )
