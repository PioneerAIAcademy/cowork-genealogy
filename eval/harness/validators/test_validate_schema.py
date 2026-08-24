"""Skill-specific validators for the validate-schema skill.

Mechanical checks live here; narrative judgment about validation
reporting lands on the validate-schema `rubric.md` dimensions plus the
base Correctness + Completeness dimensions in the LLM judge.

The skill is read-only: it calls the validate_research_schema MCP tool
and reports findings, but never edits research.json or tree.gedcomx.json.
Universal validators in test_universal.py enforce that contract via
the ownership manifest (validate-schema is named by no row of either
artifact → any write is flagged).

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_only_calls_validate_research_schema(tool_calls):
    """validate-schema must only call the validate_research_schema MCP tool.

    The skill calls validate_research_schema to perform validation.
    It should not call any other MCP tools.
    """
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    allowed = {"mcp__genealogy__validate_research_schema"}
    disallowed = [tc for tc in mcp_calls if tc.get("tool") not in allowed]
    assert not disallowed, (
        f"validate-schema should only call validate_research_schema, but called: "
        f"{[tc['tool'] for tc in disallowed]}"
    )


# --- Read-only enforcement --------------------------------------------

def test_does_not_modify_project_files(before_state, after_state, test):
    """validate-schema is read-only — research.json and tree.gedcomx.json
    must be byte-identical before and after.

    Universal `test_ownership_table` and `test_tree_ownership_table`
    catch any section-level diff (validate-schema is absent from both
    tables). This validator backs that with a whole-file equality check
    so even cosmetic re-serialisation surfaces here, not just section
    diffs.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before_research = before_state.get("research_json")
    after_research = after_state.get("research_json")
    if before_research is not None and after_research is not None:
        assert before_research == after_research, (
            "validate-schema modified research.json — it must be read-only"
        )

    before_tree = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after_tree = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before_tree is not None and after_tree is not None:
        assert before_tree == after_tree, (
            "validate-schema modified tree.gedcomx.json — it must be read-only"
        )


def test_does_not_modify_sidecars_or_other_files(before_state, after_state, test):
    """validate-schema is read-only for EVERY file, not just the two main JSONs.

    `test_does_not_modify_project_files` above guards research.json and
    tree.gedcomx.json. `snapshot_files` puts every *other* workspace file into
    the `files` map as `{rel_path: content}` (research.json / tree.gedcomx.json
    are lifted out into their own keys, so they are not double-checked here).
    Comparing the two `files` maps therefore catches anything this skill must
    never touch but the whole-file check never sees — a `results/*.json` sidecar
    (e.g. the skill "fixing" the bad sidecar in ut_validate_schema_009 instead of
    reporting it) or any other file added, removed, or modified.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}

    added = sorted(set(after_files) - set(before_files))
    removed = sorted(set(before_files) - set(after_files))
    modified = sorted(
        p
        for p in (set(before_files) & set(after_files))
        if before_files[p] != after_files[p]
    )
    assert not (added or removed or modified), (
        "validate-schema must be read-only for every file, but the run changed "
        f"the workspace — added: {added}, removed: {removed}, modified: {modified}. "
        "It reports errors and leaves the fix to the user; it never edits a file, "
        "including results/*.json sidecars."
    )
