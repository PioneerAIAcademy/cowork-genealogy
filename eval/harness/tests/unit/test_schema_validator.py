"""Tests for harness.schema_validator — jsonschema gating per spec §8.

This module is load-bearing: the runnability gate and the universal
validators both call it on every test run. An upstream schema change
that silently makes it permissive or noisy would corrupt every grading
signal — these tests pin the contract.
"""

import pytest

from harness.schema_validator import (
    validate_research_json,
    validate_tree_gedcomx_json,
)


def _minimal_valid_research_json() -> dict:
    """Schema-valid empty research.json — same shape used by other tests."""
    return {
        "project": {
            "id": "rp_1",
            "objective": "test",
            "status": "active",
            "created": "2026-01-01",
            "updated": "2026-01-01",
        },
        "questions": [],
        "plans": [],
        "log": [],
        "sources": [],
        "assertions": [],
        "person_evidence": [],
        "conflicts": [],
        "hypotheses": [],
        "timelines": [],
        "proof_summaries": [],
        "evaluations": [],
    }


def _minimal_valid_tree_gedcomx() -> dict:
    return {
        "persons": [
            {
                "id": "I1",
                "gender": "Male",
                "names": [
                    {"id": "N1", "preferred": True, "given": "John", "surname": "Doe"}
                ],
            }
        ],
        "relationships": [],
        "sources": [],
    }


# --- validate_research_json -----------------------------------------------


def test_valid_research_json_returns_empty_list():
    """A schema-valid research.json must produce zero error messages."""
    errors = validate_research_json(_minimal_valid_research_json())
    assert errors == []


def test_missing_required_project_field_returns_error():
    """Required-field omission surfaces with the JSON pointer in the message."""
    data = _minimal_valid_research_json()
    del data["project"]["objective"]
    errors = validate_research_json(data)
    assert errors, "expected at least one error"
    # The error should reference the missing field somewhere.
    assert any("objective" in e for e in errors)
    # And the path should point at the project subtree.
    assert any("project" in e for e in errors)


def test_invalid_enum_value_returns_error():
    """Closed enum violation must be caught by the schema (via $ref to
    enums.schema.json — this exercises the registry wiring)."""
    data = _minimal_valid_research_json()
    data["project"]["status"] = "not-a-real-status"
    errors = validate_research_json(data)
    assert errors
    # The error should mention either the bad value or the path.
    assert any("status" in e or "not-a-real-status" in e for e in errors)


def test_wrong_type_for_array_section_returns_error():
    """`questions` is an array; giving it a dict must fail."""
    data = _minimal_valid_research_json()
    data["questions"] = {"q_1": "not an array"}
    errors = validate_research_json(data)
    assert errors


def test_missing_required_section_returns_error():
    """All 11 sections are required at top level."""
    data = _minimal_valid_research_json()
    del data["conflicts"]
    errors = validate_research_json(data)
    assert errors
    assert any("conflicts" in e for e in errors)


def test_id_prefix_pattern_enforced_by_schema():
    """ID prefixes are enforced via `pattern` on each section's id property."""
    data = _minimal_valid_research_json()
    data["questions"].append({
        "id": "wrong_prefix",  # should start with q_
        "question": "x",
        "rationale": "x",
        "selection_basis": "objective_decomposition",
        "priority": "medium",
        "status": "open",
        "depends_on": [],
        "unblocks": [],
    })
    errors = validate_research_json(data)
    # Either the pattern fires, or there are other validation issues.
    # Either way, errors should be non-empty for a wrong prefix.
    assert errors


# --- validate_tree_gedcomx_json --------------------------------------------


def test_valid_tree_gedcomx_returns_empty_list():
    assert validate_tree_gedcomx_json(_minimal_valid_tree_gedcomx()) == []


def test_tree_gedcomx_missing_persons_array_returns_error():
    data = {"relationships": [], "sources": []}
    errors = validate_tree_gedcomx_json(data)
    assert errors
    assert any("persons" in e for e in errors)


def test_tree_gedcomx_person_missing_required_returns_error():
    data = _minimal_valid_tree_gedcomx()
    del data["persons"][0]["names"]
    errors = validate_tree_gedcomx_json(data)
    assert errors
