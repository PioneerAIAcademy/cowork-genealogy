"""Skill-specific validators for the conflict-resolution skill.

These check structural invariants that should hold for every
conflict-resolution test, regardless of the specific test case.

Validators receive before_state and after_state dicts, each containing:
  - "research_json": parsed research.json (or None)
  - "tree_gedcomx": parsed tree.gedcomx.json (or None)
  - "tool_calls": list of {"tool": str, "args": dict, "response": dict}
"""

import pytest


# From research-schema-spec.md Section 4: Ownership Table
# conflict-resolution writes to: conflicts
# conflict-resolution reads from: assertions, person_evidence, timelines, conflicts
OWNED_SECTIONS = {"conflicts"}

ALL_SECTIONS = {
    "project", "questions", "plans", "log", "sources",
    "assertions", "person_evidence", "conflicts",
    "hypotheses", "timelines", "proof_summaries",
}


def _get_entries(research, section):
    """Get entries from a section, handling project (object) vs others (array)."""
    value = research.get(section, [] if section != "project" else {})
    if isinstance(value, dict):
        return [value]
    return value


# --- Ownership enforcement ---

def test_only_writes_to_owned_sections(before_state, after_state):
    """conflict-resolution must only modify the conflicts section."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")

    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    modified_sections = []
    for section in ALL_SECTIONS:
        before_entries = _get_entries(before, section)
        after_entries = _get_entries(after, section)
        if before_entries != after_entries:
            modified_sections.append(section)

    unauthorized = set(modified_sections) - OWNED_SECTIONS
    assert not unauthorized, (
        f"conflict-resolution modified sections it doesn't own: {unauthorized}. "
        f"It may only write to: {OWNED_SECTIONS}"
    )


# --- Tool allowlist ---

def test_no_mcp_tools_called(after_state):
    """conflict-resolution should not call any MCP tools.

    It is a pure analysis skill — it reads existing assertions and
    sources from research.json, not from external APIs.
    """
    tool_calls = after_state.get("tool_calls", [])

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
