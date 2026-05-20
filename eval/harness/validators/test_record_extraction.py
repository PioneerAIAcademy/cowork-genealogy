"""Skill-specific validators for the record-extraction skill.

These check structural invariants that should hold for every
record-extraction test, regardless of the specific test case.

See `validators/test_universal.py` module docstring for the full
validator function-signature contract. Briefly: `before_state`,
`after_state`, `tool_calls`, `skill_frontmatter`, and `test` are each
separate parameters supplied by the harness — pull the one you need by
declaring it in your function signature.

This file is intended as a second worked example for junior devs.
Compared to test_conflict_resolution.py, record-extraction:
  - Writes to TWO sections (assertions and sources), not one.
  - DOES call MCP tools (record_search, image_transcribe, etc.).
  - Has richer field-level invariants on each new assertion.

Pattern: ownership check, append-only check on assertions/sources,
foreign-key integrity, and per-assertion required-field checks.

Tag-gated regression checks (e.g., 1850-census-uses-_inferred-suffix)
sit at the bottom; they gate on `test["tags"]` so they only fire on
the specific scenario they describe.
"""

import pytest

from validators_lib import (
    assert_foreign_keys_valid,
    assert_no_section_deletions,
)


# Ownership enforcement is centralised in test_universal.py's
# OWNERSHIP_TABLE driven by a single dict mirroring
# research-schema-spec.md §4. Per-skill copies were removed to prevent
# drift between two sources of truth.
#
# Diff / append-only / foreign-key patterns delegate to
# `validators_lib.py` — adding the next 21 skill validator files should
# call those helpers rather than re-implementing the patterns.


# --- Append-only / no-delete on owned sections ---

def test_assertions_are_append_only(before_state, after_state):
    """Existing assertions must not be deleted."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "assertions")


def test_sources_are_append_only(before_state, after_state):
    """Existing sources must not be deleted."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "sources")


# --- Foreign-key integrity for new assertions ---

def test_new_assertions_reference_valid_source(before_state, after_state):
    """Every new assertion's source_id must point at a real source entry."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("assertions", "source_id", "sources")],
        before=before,
    )


def test_new_assertions_reference_valid_log_entry(before_state, after_state):
    """log_entry_id is optional (null OK); when set, must resolve."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("assertions", "log_entry_id", "log")],
        before=before,
    )


# --- Per-assertion structural rules ---

def test_new_assertions_have_required_classification(before_state, after_state):
    """Every new assertion must carry the three GPS classification fields.

    Per research-schema-spec.md §5.6, every assertion requires:
      - information_quality (primary | secondary | indeterminate)
      - informant_proximity (self, witness, household_member, ...)
      - evidence_type (direct | indirect | negative)

    Missing these silently breaks downstream skills (conflict-resolution
    weighs by informant_proximity; proof-conclusion needs evidence_type).
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        aid = a.get("id", "?")
        for field in ("information_quality", "informant_proximity", "evidence_type"):
            if not a.get(field):
                errors.append(f"assertions[{aid}]: missing {field}")

    assert not errors, "Incomplete new assertions:\n" + "\n".join(errors)


def test_new_assertions_attached_to_record_role(before_state, after_state):
    """Every new assertion must have both record_id and record_role.

    Per research-schema-spec.md §5.6 design decision: assertions attach
    to record_id + record_role, NOT to a person. Person attachment is
    person-evidence's job. record-extraction must produce assertions
    with both fields populated so person-evidence has something to bind.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        aid = a.get("id", "?")
        if not a.get("record_id"):
            errors.append(f"assertions[{aid}]: missing record_id")
        if not a.get("record_role"):
            errors.append(f"assertions[{aid}]: missing record_role")

    assert not errors, "Assertions not attached to record_role:\n" + "\n".join(errors)


def test_negative_evidence_uses_absent_role(before_state, after_state):
    """Assertions with evidence_type='negative' must have record_role='absent'.

    Per research-schema-spec.md §5.6 negative-evidence convention:
    when the absence of information is the finding, the role is `absent`
    and the value describes what was expected. Catches the common
    mistake of using evidence_type='negative' on a regular role.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for a in after.get("assertions", []):
        if a.get("evidence_type") == "negative" and a.get("record_role") != "absent":
            errors.append(
                f"assertions[{a.get('id')}]: evidence_type=negative but "
                f"record_role='{a.get('record_role')}' (expected 'absent')"
            )

    assert not errors, "Negative-evidence role mismatch:\n" + "\n".join(errors)


# --- New sources structural rules ---

def test_new_sources_have_citation_detail(before_state, after_state):
    """Every new source must have the citation_detail object populated.

    record-extraction creates the source with a working citation; the
    citation skill later refines it. But the structure must exist from
    creation so downstream skills have something to read.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {s.get("id") for s in before.get("sources", [])}

    required_detail_keys = {"who", "what", "when_created", "when_accessed", "where", "where_within"}

    errors = []
    for s in after.get("sources", []):
        if s.get("id") in before_ids:
            continue
        sid = s.get("id", "?")
        detail = s.get("citation_detail") or {}
        missing = required_detail_keys - set(detail.keys())
        if missing:
            errors.append(f"sources[{sid}]: citation_detail missing {sorted(missing)}")

    assert not errors, "Incomplete new sources:\n" + "\n".join(errors)


# --- Tool allowlist ---

def test_only_allowed_mcp_tools(skill_frontmatter, tool_calls):
    """Every MCP tool called must be listed in SKILL.md allowed-tools.

    record-extraction legitimately calls record_search and
    image_transcribe. This check catches accidental calls to MCP tools
    outside the skill's declared allowlist (e.g., wikipedia_search,
    fulltext_search).

    Skipped when frontmatter doesn't declare allowed-tools (defensive —
    some skills omit the field).
    """
    declared = skill_frontmatter.get("allowed-tools")
    if declared is None:
        pytest.skip("SKILL.md doesn't declare allowed-tools")

    declared_set = set(declared)

    violations = []
    for tc in tool_calls:
        full = tc.get("tool", "")
        if not full.startswith("mcp__"):
            continue
        # Strip mcp__<server>__ prefix
        bare = full.split("__")[-1]
        if bare not in declared_set:
            violations.append(bare)

    assert not violations, (
        f"record-extraction called MCP tools outside its allowed-tools: "
        f"{sorted(set(violations))}. Declared: {sorted(declared_set)}"
    )


# --- Tag-gated regression checks ---

def test_1850_census_uses_inferred_suffix(before_state, after_state, test):
    """For 1850-census extractions, relationship-type assertions must use
    the `_inferred` suffix on `structured_value.relationship_type`.

    Per research-schema-spec.md §5.6.1, the 1850 census has no
    relationship column — relationships are deduced from household
    position and must be flagged with the `_inferred` suffix
    (e.g., `child_inferred`, `spouse_inferred`).

    Tag-gated on `1850` or `1850-census` so it only applies to the
    relevant scenarios.
    """
    tags = test.get("tags", [])
    if not any(t in tags for t in ("1850", "1850-census")):
        pytest.skip("not a 1850-census scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if a.get("fact_type") != "relationship":
            continue
        sv = a.get("structured_value") or {}
        rel_type = sv.get("relationship_type")
        if rel_type and not str(rel_type).endswith("_inferred"):
            errors.append(
                f"assertions[{a.get('id')}]: 1850-census relationship "
                f"has relationship_type='{rel_type}' without '_inferred' "
                f"suffix (relationships in 1850 are deduced, not stated)"
            )

    assert not errors, (
        "1850-census relationships missing _inferred suffix:\n  - "
        + "\n  - ".join(errors)
    )


def test_negative_evidence_assertion_created(
    before_state, after_state, test
):
    """For negative-evidence scenarios, the skill must create at least
    one NEW assertion with `evidence_type: \"negative\"` and
    `record_role: \"absent\"`. Otherwise the absence wasn't recorded.

    Tag-gated on `negative-evidence`.
    """
    if "negative-evidence" not in test.get("tags", []):
        pytest.skip("not a negative-evidence scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new_neg = [
        a for a in after.get("assertions", [])
        if a.get("id") not in before_ids
        and a.get("evidence_type") == "negative"
        and a.get("record_role") == "absent"
    ]
    assert new_neg, (
        "negative-evidence scenario produced no new assertion with "
        "evidence_type='negative' and record_role='absent'"
    )


def test_negative_evidence_value_describes_expectation(
    before_state, after_state, test
):
    """For negative-evidence extractions, the assertion's `value` field
    must describe what was expected — not be empty or just the literal
    'absent'.

    Per the negative-evidence convention, `value` carries the
    expected-but-missing information so downstream skills (and the
    genealogist) know what was searched for.

    Tag-gated on `negative-evidence`.
    """
    if "negative-evidence" not in test.get("tags", []):
        pytest.skip("not a negative-evidence scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if a.get("evidence_type") != "negative":
            continue
        value = (a.get("value") or "").strip()
        if not value or value.lower() in {"absent", "missing", "n/a", "none"}:
            errors.append(
                f"assertions[{a.get('id')}]: negative-evidence value is "
                f"'{value}' — should describe what was expected"
            )

    assert not errors, (
        "Negative-evidence assertions missing expectation in value:\n  - "
        + "\n  - ".join(errors)
    )
