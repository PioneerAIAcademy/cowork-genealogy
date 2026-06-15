"""Unit tests for the e2e tree-read block (orchestrator integrity guard).

The agent must not recover the stripped answer by reading it off the live
FamilySearch tree — person_read / person_search / person_ancestors are
denied for the whole run. See e2e-test-spec.md §6.1.
"""

from __future__ import annotations

from e2e.orchestrator import (
    BLOCKED_TREE_TOOLS,
    _bare_tool_name,
    is_blocked_tree_tool,
)


def test_blocked_set_is_exactly_the_three_tree_readers():
    assert BLOCKED_TREE_TOOLS == {
        "person_read",
        "person_search",
        "person_ancestors",
    }


def test_bare_tool_name_strips_mcp_prefix():
    assert _bare_tool_name("mcp__genealogy__person_read") == "person_read"
    assert _bare_tool_name("person_read") == "person_read"
    assert _bare_tool_name("Read") == "Read"


def test_tree_reading_tools_are_blocked():
    for name in ("person_read", "person_search", "person_ancestors"):
        assert is_blocked_tree_tool(f"mcp__genealogy__{name}") is True


def test_record_and_match_tools_are_not_blocked():
    """Legitimate research tools must stay allowed — record search/read,
    fulltext, and the matching tools are how the agent earns the answer."""
    allowed = [
        "mcp__genealogy__record_search",
        "mcp__genealogy__record_read",
        "mcp__genealogy__fulltext_search",
        "mcp__genealogy__image_search",
        "mcp__genealogy__person_record_matches",
        "mcp__genealogy__person_person_matches",
        "mcp__genealogy__person_warnings",  # reads the local stripped tree, not live
    ]
    for name in allowed:
        assert is_blocked_tree_tool(name) is False


def test_baseline_tools_are_never_blocked():
    for name in ("Read", "Write", "Edit", "Glob", "Grep", "Skill"):
        assert is_blocked_tree_tool(name) is False


def test_non_genealogy_tool_named_like_a_tree_tool_is_not_blocked():
    """The block only applies to MCP genealogy tools, matched on the bare
    name — a non-mcp tool can't be a live-tree read."""
    assert is_blocked_tree_tool("person_read") is False  # no mcp__ prefix
