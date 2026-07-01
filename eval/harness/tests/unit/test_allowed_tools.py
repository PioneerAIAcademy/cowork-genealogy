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
