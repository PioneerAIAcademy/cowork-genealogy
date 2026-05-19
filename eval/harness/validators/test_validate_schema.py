"""Skill-specific validators for the validate-schema skill.

validate-schema has no `rubric.md` (deleted in the criteria-demotion
rollout — see docs/plan/criteria-demotion-and-rubric-opt-in.md). All
mechanical checks live here; narrative judgment about validation
reporting lands on the base Correctness + Completeness dimensions in
the LLM judge.

The skill is read-only: it runs `scripts/validate_project.py` and
reports findings, but never edits research.json or tree.gedcomx.json.
Universal validators in test_universal.py enforce that contract via
the ownership table (validate-schema is absent from OWNERSHIP_TABLE
and TREE_OWNERSHIP_TABLE → any write is flagged).

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_no_mcp_tools_called(tool_calls):
    """validate-schema must not call any MCP tools.

    It runs a local python script (scripts/validate_project.py) — there
    are no remote calls. The skill's frontmatter declares no
    `allowed-tools`, so the universal `test_tool_allowlist` also catches
    this; we duplicate it here so a future frontmatter slip-up (e.g.,
    someone adding an unrelated tool) still surfaces as a validate-schema
    failure.
    """
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    assert not mcp_calls, (
        f"validate-schema should not call MCP tools, but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
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
