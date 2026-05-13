"""Skill-specific validators for the conflict-resolution skill.

These check structural invariants that should hold for every
conflict-resolution test, regardless of the specific test case.

See `validators/test_universal.py` module docstring for the full
validator function-signature contract. Briefly: `before_state`,
`after_state`, `tool_calls`, and `skill_frontmatter` are each separate
parameters supplied by the harness — pull the one you need by declaring
it in your function signature.
"""

import pytest


# Ownership enforcement for *all* skills is in
# test_universal.py::test_ownership_table, driven by a single OWNERSHIP_TABLE
# dict mirroring research-schema-spec.md §4. Per-skill copies were removed
# to prevent drift between two sources of truth.


# --- Tool allowlist ---

def test_no_mcp_tools_called(tool_calls):
    """conflict-resolution should not call any MCP tools.

    It is a pure analysis skill — it reads existing assertions and
    sources from research.json, not from external APIs.

    Note: `tool_calls` is a separate positional arg from the validator
    runner (see eval/harness/harness/validator_runner.py). Earlier versions
    pulled it from after_state["tool_calls"], which always returned [];
    that bug let MCP-using conflict-resolution traces silently pass.
    """
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    assert not mcp_calls, (
        f"conflict-resolution should not call MCP tools, but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )


# --- Structural rules from SKILL.md ---

def test_fact_conflicts_have_competing_assertions(before_state, after_state):
    """Every fact-type conflict must have at least 2 competing_assertion_ids.

    A fact conflict is by definition a disagreement between two or more
    assertions. Identity conflicts may have only 1 (a single assertion
    whose person linkage is uncertain).
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for conflict in after.get("conflicts", []):
        if conflict.get("conflict_type") == "fact":
            ids = conflict.get("competing_assertion_ids", [])
            if len(ids) < 2:
                errors.append(
                    f"conflicts[{conflict['id']}]: fact conflict has "
                    f"{len(ids)} competing_assertion_ids (need ≥2)"
                )

    assert not errors, "Structural violations:\n" + "\n".join(errors)


def test_resolved_conflicts_have_required_fields(before_state, after_state):
    """Resolved conflicts must have preferred_assertion_id and resolution_rationale.

    An unresolved conflict may have null fields — but once status is
    'resolved', the analysis must be complete.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for conflict in after.get("conflicts", []):
        if conflict.get("status") != "resolved":
            continue

        cid = conflict.get("id", "?")

        if not conflict.get("preferred_assertion_id"):
            errors.append(
                f"conflicts[{cid}]: resolved but no preferred_assertion_id"
            )
        if not conflict.get("resolution_rationale"):
            errors.append(
                f"conflicts[{cid}]: resolved but no resolution_rationale"
            )

    assert not errors, "Incomplete resolved conflicts:\n" + "\n".join(errors)


def test_preferred_assertion_is_in_competing(before_state, after_state):
    """preferred_assertion_id must be one of the competing_assertion_ids.

    You can't prefer an assertion that isn't part of the conflict.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for conflict in after.get("conflicts", []):
        preferred = conflict.get("preferred_assertion_id")
        competing = conflict.get("competing_assertion_ids", [])

        if preferred and preferred not in competing:
            errors.append(
                f"conflicts[{conflict['id']}]: preferred_assertion_id "
                f"'{preferred}' not in competing_assertion_ids {competing}"
            )

    assert not errors, "Invalid preferred assertions:\n" + "\n".join(errors)


def test_competing_assertions_exist(before_state, after_state):
    """All competing_assertion_ids must reference existing assertions."""
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    known_assertion_ids = {
        a.get("id") for a in after.get("assertions", [])
    }

    errors = []
    for conflict in after.get("conflicts", []):
        for ref in conflict.get("competing_assertion_ids", []):
            if ref not in known_assertion_ids:
                errors.append(
                    f"conflicts[{conflict['id']}]: competing assertion "
                    f"'{ref}' not found in assertions"
                )

    assert not errors, "Broken assertion references:\n" + "\n".join(errors)


def test_no_new_conflicts_without_competing(before_state, after_state):
    """New conflicts added by the skill must have competing_assertion_ids populated.

    A conflict with an empty competing_assertion_ids array is meaningless.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")

    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {c.get("id") for c in before.get("conflicts", [])}

    errors = []
    for conflict in after.get("conflicts", []):
        if conflict.get("id") in before_ids:
            continue  # existing conflict, not our responsibility
        if not conflict.get("competing_assertion_ids"):
            errors.append(
                f"conflicts[{conflict['id']}]: new conflict has no "
                f"competing_assertion_ids"
            )

    assert not errors, "New conflicts without competing assertions:\n" + "\n".join(errors)
