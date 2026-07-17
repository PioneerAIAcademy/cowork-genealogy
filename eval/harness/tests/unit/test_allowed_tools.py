"""Tests for harness.allowed_tools — per-skill tool allowlist computation."""

from pathlib import Path

import pytest

from harness.allowed_tools import compute_allowed_tools


REPO_ROOT = Path(__file__).resolve().parents[4]
PLUGIN_SKILLS = REPO_ROOT / "packages/engine/plugin/skills"


def test_search_wikipedia_includes_wikipedia_search():
    tools = compute_allowed_tools("search-wikipedia", PLUGIN_SKILLS)
    assert "mcp__genealogy__wikipedia_search" in tools
    assert "Read" in tools
    assert "Write" in tools
    assert "Skill" in tools


def test_baseline_always_present():
    tools = compute_allowed_tools("search-wikipedia", PLUGIN_SKILLS)
    for required in ("Read", "Glob", "Grep", "Skill"):
        assert required in tools


def test_baseline_always_includes_write_and_edit(tmp_path):
    """v1.3: Write/Edit are always in the baseline. The previous
    hardcoded no-write set drifted from the ownership table and was
    redundant with the universal ownership validator. See allowed_tools.py
    for the rationale."""
    skill = tmp_path / "translation"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: translation\nallowed-tools: []\n---\n# Translation"
    )
    tools = compute_allowed_tools("translation", tmp_path)
    assert "Write" in tools
    assert "Edit" in tools
    assert "Read" in tools


def test_already_qualified_mcp_tool_passed_through(tmp_path):
    skill = tmp_path / "x"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: x\nallowed-tools:\n  - mcp__custom__special\n  - bare_tool\n---"
    )
    tools = compute_allowed_tools("x", tmp_path)
    assert "mcp__custom__special" in tools
    assert "mcp__genealogy__bare_tool" in tools


def test_missing_skill_md_returns_baseline(tmp_path):
    (tmp_path / "noskill").mkdir()
    tools = compute_allowed_tools("noskill", tmp_path)
    assert "Read" in tools
    assert "Skill" in tools
    # No MCP tools because no frontmatter
    assert not any(t.startswith("mcp__") for t in tools)


def test_no_frontmatter_returns_baseline(tmp_path):
    skill = tmp_path / "no-fm"
    skill.mkdir()
    (skill / "SKILL.md").write_text("# No frontmatter here\nJust body content.")
    tools = compute_allowed_tools("no-fm", tmp_path)
    assert "Read" in tools
    assert not any(t.startswith("mcp__") for t in tools)


# --- Task + plugin-agent tool union ----------------------------------------


def test_task_always_in_baseline():
    tools = compute_allowed_tools("search-wikipedia", PLUGIN_SKILLS)
    assert "Task" in tools


def _make_skill_and_agent(tmp_path, *, body: str):
    skills = tmp_path / "skills"
    skill = skills / "router"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        f"---\nname: router\nallowed-tools:\n  - record_search\n---\n{body}",
        encoding="utf-8",
    )
    agents = tmp_path / "agents"
    agents.mkdir()
    (agents / "spike-echo.md").write_text(
        "---\nname: spike-echo\nmodel: claude-haiku-4-5\ntools:\n"
        "  - Read\n  - wikipedia_search\n---\nAgent body.\n",
        encoding="utf-8",
    )
    return skills, agents


def test_referenced_agent_tools_unioned(tmp_path):
    """A skill that delegates via @plugin:<name> gets the agent's MCP tools
    in its allowlist — the subagent's calls must not be denied."""
    skills, agents = _make_skill_and_agent(
        tmp_path, body="Delegate to `@plugin:spike-echo` for the lookup.\n"
    )
    tools = compute_allowed_tools("router", skills, agents_dir=agents)
    assert "mcp__genealogy__record_search" in tools  # skill's own frontmatter
    assert "mcp__genealogy__wikipedia_search" in tools  # unioned from agent
    assert "Read" in tools  # agent's builtin entry passes through unqualified
    assert "mcp__genealogy__Read" not in tools


def test_unreferenced_agent_tools_not_unioned(tmp_path):
    """Agents the skill never references contribute nothing — keeps the
    allowlist tight so direct out-of-frontmatter calls are still denied."""
    skills, agents = _make_skill_and_agent(tmp_path, body="No delegation.\n")
    tools = compute_allowed_tools("router", skills, agents_dir=agents)
    assert "mcp__genealogy__wikipedia_search" not in tools


def test_referenced_but_missing_agent_is_ignored(tmp_path):
    """A dangling @plugin: ref (no agent file) must not crash or widen."""
    skills, agents = _make_skill_and_agent(
        tmp_path, body="Delegate to `@plugin:ghost`.\n"
    )
    tools = compute_allowed_tools("router", skills, agents_dir=agents)
    assert "mcp__genealogy__record_search" in tools
    assert not any(t == "mcp__genealogy__ghost" for t in tools)
