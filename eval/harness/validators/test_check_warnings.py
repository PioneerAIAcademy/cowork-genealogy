"""Skill-specific validators for the check-warnings skill.

check-warnings is a read-only analysis skill — it invokes the
`person_warnings` MCP tool (declared in allowed-tools) and surfaces
the results as narrative output. It does not modify research.json or
tree.gedcomx.json.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" rules live here.

Tool-usage enforcement is handled by the universal `test_tool_allowlist`,
which validates calls against the skill's `allowed-tools` frontmatter —
there is no separate `test_no_mcp_tools_called` here because check-warnings
legitimately calls `person_warnings` as its checking engine.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import pytest


# --- Read-only enforcement ---

def test_research_json_unmodified(before_state, after_state, test):
    """check-warnings must not modify research.json. The skill reports
    warnings as narrative output — the project file is read-only input.

    Skipped on negative tests: the LLM is expected to route away to
    another skill (e.g. conflict-resolution), which may legitimately
    modify project files as part of its own contract. Attributing those
    writes to check-warnings would be a false positive. Mirrors the
    same guard in test_project_status.py and test_universal.py's
    test_ownership_table.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "check-warnings modified research.json — this skill is read-only. "
        "Warnings should be reported as narrative, not written into the file."
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """check-warnings must not modify tree.gedcomx.json either.

    Skipped on negative tests (see test_research_json_unmodified).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "check-warnings modified tree.gedcomx.json — this skill is read-only."
    )
