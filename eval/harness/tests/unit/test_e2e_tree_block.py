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
        "person_record_matches",
        "person_person_matches",
    }


def test_bare_tool_name_strips_mcp_prefix():
    assert _bare_tool_name("mcp__genealogy__person_read") == "person_read"
    assert _bare_tool_name("person_read") == "person_read"
    assert _bare_tool_name("Read") == "Read"


def test_subject_keyed_tools_are_blocked():
    """Anything keyed off the SUBJECT person that surfaces the answer."""
    for name in (
        "person_read",
        "person_search",
        "person_ancestors",
        "person_record_matches",  # subjectPID -> the answer records, curated
        "person_person_matches",  # subjectPID -> stripped relatives
    ):
        assert is_blocked_tree_tool(f"mcp__genealogy__{name}") is True


def test_record_keyed_and_search_tools_are_not_blocked():
    """Legitimate research stays allowed — the agent must find records
    itself; tools keyed off a found RECORD (not the subject) are fine."""
    allowed = [
        "mcp__genealogy__record_search",
        "mcp__genealogy__record_read",
        "mcp__genealogy__fulltext_search",
        "mcp__genealogy__image_search",
        "mcp__genealogy__collections_search",
        "mcp__genealogy__record_person_matches",  # keyed off a record, not subject
        "mcp__genealogy__record_record_matches",  # keyed off a record
        "mcp__genealogy__source_attachments",  # confirms a found record's attachment
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


# --- per-fixture blocked tools (spec §6.1 "Per-fixture blocked tools") --

def test_fixture_blocked_tool_matches_bare_name():
    from e2e.orchestrator import is_fixture_blocked_tool
    blocked = frozenset({"wiki_search"})
    assert is_fixture_blocked_tool("mcp__genealogy__wiki_search", blocked) is True
    assert is_fixture_blocked_tool("mcp__genealogy__record_search", blocked) is False


def test_fixture_blocked_tool_ignores_non_mcp_and_empty_set():
    from e2e.orchestrator import is_fixture_blocked_tool
    assert is_fixture_blocked_tool("wiki_search", frozenset({"wiki_search"})) is False
    assert is_fixture_blocked_tool("Read", frozenset({"wiki_search"})) is False
    assert is_fixture_blocked_tool("mcp__genealogy__wiki_search", frozenset()) is False


def test_load_fixture_parses_blocked_tools(tmp_path):
    """fixture.json blocked_tools round-trips into Fixture.blocked_tools;
    omitted field defaults to an empty frozenset."""
    import json
    from e2e.orchestrator import load_fixture

    base = {
        "id": "t",
        "researcher_question": "q?",
        "tags": {},
        "model": {},
    }
    findings = {"findings": []}
    for name, extra, want in (
        ("with-block", {"blocked_tools": ["wiki_search"]}, frozenset({"wiki_search"})),
        ("without-block", {}, frozenset()),
    ):
        d = tmp_path / name
        d.mkdir()
        (d / "fixture.json").write_text(
            json.dumps({**base, "id": name, **extra}), encoding="utf-8"
        )
        (d / "expected-findings.json").write_text(json.dumps(findings), encoding="utf-8")
        fx = load_fixture(d)
        assert fx.blocked_tools == want, name


# --- turn-cap error reclassification ----------------------------------

def test_turn_cap_error_recognized():
    from e2e.orchestrator import is_turn_cap_error
    assert is_turn_cap_error("Claude Code returned an error result: Reached maximum number of turns (100)")
    assert is_turn_cap_error("Reached MAXIMUM NUMBER OF TURNS (250)")  # case-insensitive


def test_non_turn_cap_errors_not_reclassified():
    from e2e.orchestrator import is_turn_cap_error
    assert not is_turn_cap_error("some other SDK error")
    assert not is_turn_cap_error(None)
    assert not is_turn_cap_error("")


# --- direct project-file write block (research-guardrail-bypass-plan.md §4.3) --

def test_direct_write_to_research_json_is_blocked():
    from e2e.orchestrator import direct_project_file_write
    assert direct_project_file_write("Write", {"file_path": "/tmp/proj/research.json"}) == "research.json"


def test_direct_edit_to_tree_gedcomx_is_blocked():
    from e2e.orchestrator import direct_project_file_write
    assert (
        direct_project_file_write("Edit", {"file_path": "/tmp/proj/tree.gedcomx.json"})
        == "tree.gedcomx.json"
    )


def test_relative_path_still_matches_on_basename():
    from e2e.orchestrator import direct_project_file_write
    assert direct_project_file_write("Write", {"file_path": "research.json"}) == "research.json"


def test_windows_path_matches_on_basename():
    """The genealogist team runs e2e on Windows, where the workspace is a
    `C:\\Users\\...\\Temp\\e2e-<id>` path — splitting on "/" alone made this
    guard a silent no-op there."""
    from e2e.orchestrator import direct_project_file_write
    assert direct_project_file_write(
        "Write", {"file_path": r"C:\Users\Dell\AppData\Local\Temp\e2e-x\research.json"}
    ) == "research.json"


def test_notebook_edit_is_also_a_write_tool():
    from e2e.orchestrator import direct_project_file_write
    assert (
        direct_project_file_write("NotebookEdit", {"file_path": "/tmp/proj/research.json"})
        == "research.json"
    )


def test_write_to_an_unrelated_file_is_not_blocked():
    from e2e.orchestrator import direct_project_file_write
    assert direct_project_file_write("Write", {"file_path": "/tmp/proj/notes.md"}) is None


def test_non_write_edit_tools_are_never_matched():
    from e2e.orchestrator import direct_project_file_write
    assert direct_project_file_write("Read", {"file_path": "/tmp/proj/research.json"}) is None
    assert direct_project_file_write(
        "mcp__genealogy__research_append", {"file_path": "/tmp/proj/research.json"}
    ) is None


def test_missing_file_path_does_not_crash():
    from e2e.orchestrator import direct_project_file_write
    assert direct_project_file_write("Write", {}) is None
    assert direct_project_file_write("Write", None) is None
