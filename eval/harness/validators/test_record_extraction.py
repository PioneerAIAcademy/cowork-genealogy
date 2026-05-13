"""Skill-specific validators for the record-extraction skill.

These check structural invariants that should hold for every
record-extraction test, regardless of the specific test case.

See `validators/test_universal.py` module docstring for the full
validator function-signature contract. Briefly: `before_state`,
`after_state`, `tool_calls`, and `skill_frontmatter` are each separate
parameters supplied by the harness — pull the one you need by declaring
it in your function signature.

This file is intended as a second worked example for junior devs.
Compared to test_conflict_resolution.py, record-extraction:
  - Writes to TWO sections (assertions and sources), not one.
  - DOES call MCP tools (record_search, image_transcribe, etc.).
  - Has richer field-level invariants on each new assertion.

Pattern: ownership check, append-only check on assertions/sources,
foreign-key integrity, and per-assertion required-field checks.
"""

import pytest


# Ownership enforcement is centralised in test_universal.py's
# OWNERSHIP_TABLE driven by a single dict mirroring
# research-schema-spec.md §4. Per-skill copies were removed to prevent
# drift between two sources of truth.


# --- Append-only / no-delete on owned sections ---

def test_assertions_are_append_only(before_state, after_state):
    """Existing assertions must not be deleted.

    Modifying an existing assertion's classification fields IS allowed
    (assertion-classification and convert-dates do this), so we don't
    check field-equality — only that no entries disappear.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    after_ids = {a.get("id") for a in after.get("assertions", [])}

    missing = before_ids - after_ids
    assert not missing, (
        f"record-extraction deleted assertions: {missing}. "
        f"No section allows deletion — supersede with a status field instead."
    )


def test_sources_are_append_only(before_state, after_state):
    """Existing sources must not be deleted.

    Citation refinement is allowed (the citation skill updates fields
    in place), but no source entry may disappear.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {s.get("id") for s in before.get("sources", [])}
    after_ids = {s.get("id") for s in after.get("sources", [])}

    missing = before_ids - after_ids
    assert not missing, f"record-extraction deleted sources: {missing}."


# --- Foreign-key integrity for new assertions ---

def test_new_assertions_reference_valid_source(before_state, after_state):
    """Every new assertion's source_id must point at a real source entry."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    valid_source_ids = {s.get("id") for s in after.get("sources", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue  # pre-existing
        src = a.get("source_id")
        if not src or src not in valid_source_ids:
            errors.append(
                f"assertions[{a.get('id')}]: source_id='{src}' "
                f"doesn't match any sources[].id"
            )

    assert not errors, "Dangling source references:\n" + "\n".join(errors)


def test_new_assertions_reference_valid_log_entry(before_state, after_state):
    """When log_entry_id is set on a new assertion, it must point at a real log entry.

    Per the schema, log_entry_id is optional (null is allowed for manual
    extractions outside the search workflow). We only check non-null values.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    valid_log_ids = {entry.get("id") for entry in after.get("log", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        log_id = a.get("log_entry_id")
        if log_id is None:
            continue
        if log_id not in valid_log_ids:
            errors.append(
                f"assertions[{a.get('id')}]: log_entry_id='{log_id}' "
                f"doesn't match any log[].id"
            )

    assert not errors, "Dangling log references:\n" + "\n".join(errors)


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

    record-extraction legitimately calls record_search, record_read, and
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
