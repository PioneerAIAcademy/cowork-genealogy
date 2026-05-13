"""Universal validators that run on every test, regardless of skill.

These check structural correctness of the output files against
the research schema spec (docs/specs/research-schema-spec.md).

Validators receive before_state and after_state dicts, each containing:
  - "research_json": parsed research.json (or None if file doesn't exist)
  - "tree_gedcomx": parsed tree.gedcomx.json (or None)
  - "tool_calls": list of {"tool": str, "args": dict, "response": dict}

The before_state represents the scenario fixture. The after_state
represents the files after the skill ran. Validators compute diffs
internally where needed.
"""

import pytest


# --- Closed enums from research-schema-spec.md Section 2 ---

CLOSED_ENUMS = {
    "question_status": {"open", "in_progress", "exhaustive_declared", "resolved"},
    "plan_status": {"active", "completed", "superseded"},
    "plan_item_status": {"planned", "in_progress", "completed", "skipped"},
    "log_outcome": {"positive", "negative", "partial", "error"},
    "source_classification": {"original", "derivative", "authored"},
    "information_quality": {"primary", "secondary", "indeterminate"},
    "evidence_type": {"direct", "indirect", "negative"},
    "conflict_type": {"fact", "identity"},
    "conflict_status": {"unresolved", "resolved", "moot"},
    "hypothesis_status": {"active", "supported", "ruled_out"},
    "proof_tier": {"proved", "probable", "possible", "not_proved", "disproved"},
    "proof_vehicle": {"statement", "summary", "argument"},
    "person_evidence_confidence": {"confident", "probable", "speculative"},
    "project_status": {"active", "paused", "completed"},
    "priority": {"high", "medium", "low"},
    "selection_basis": {
        "timeline_gap", "unresolved_conflict", "fan_pivot",
        "hypothesis_test", "objective_decomposition", "new_evidence",
        "record_found_incidentally", "user_directed",
    },
    "informant_proximity": {
        "self", "witness", "household_member",
        "family_not_present", "official_duty", "unknown",
    },
    "date_certainty": {
        "exact", "approximate", "estimated", "calculated",
        "before", "after", "between",
    },
    "date_certainty_timeline": {"exact", "approximate", "estimated", "calculated"},
}

# Enum field -> enum name mapping for research.json
ENUM_FIELDS = {
    ("questions", "status"): "question_status",
    ("questions", "priority"): "priority",
    ("questions", "selection_basis"): "selection_basis",
    ("plans", "status"): "plan_status",
    ("log", "outcome"): "log_outcome",
    ("sources", "source_classification"): "source_classification",
    ("assertions", "information_quality"): "information_quality",
    ("assertions", "evidence_type"): "evidence_type",
    ("assertions", "informant_proximity"): "informant_proximity",
    ("assertions", "date_certainty"): "date_certainty",
    ("conflicts", "conflict_type"): "conflict_type",
    ("conflicts", "status"): "conflict_status",
    ("hypotheses", "status"): "hypothesis_status",
    ("person_evidence", "confidence"): "person_evidence_confidence",
    ("proof_summaries", "tier"): "proof_tier",
    ("proof_summaries", "vehicle"): "proof_vehicle",
}

# ID prefix -> section mapping
ID_PREFIXES = {
    "rp_": "project",
    "q_": "questions",
    "pl_": "plans",
    "pli_": "plan_items",
    "log_": "log",
    "src_": "sources",
    "a_": "assertions",
    "pe_": "person_evidence",
    "c_": "conflicts",
    "h_": "hypotheses",
    "t_": "timelines",
    "ps_": "proof_summaries",
}

REQUIRED_SECTIONS = [
    "project", "questions", "plans", "log", "sources",
    "assertions", "person_evidence", "conflicts",
    "hypotheses", "timelines", "proof_summaries",
]


# --- Schema validation ---

def test_research_json_has_required_sections(after_state):
    """research.json must have all 11 top-level sections."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    missing = [s for s in REQUIRED_SECTIONS if s not in research]
    assert not missing, f"Missing sections in research.json: {missing}"


def test_project_is_object(after_state):
    """project must be a single object, not an array."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    project = research.get("project")
    if project is None:
        pytest.skip("No project section")

    assert isinstance(project, dict), (
        f"project must be an object, got {type(project).__name__}"
    )


def test_sections_are_arrays(after_state):
    """All sections except project must be arrays."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    array_sections = [s for s in REQUIRED_SECTIONS if s != "project"]
    for section in array_sections:
        value = research.get(section)
        if value is not None:
            assert isinstance(value, list), (
                f"{section} must be an array, got {type(value).__name__}"
            )


# --- Enum validation ---

def test_closed_enum_values(after_state):
    """All closed enum fields must use valid values."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    errors = []
    for (section, field), enum_name in ENUM_FIELDS.items():
        valid_values = CLOSED_ENUMS[enum_name]
        entries = research.get(section, [])
        if isinstance(entries, dict):
            entries = [entries]  # project is a single object
        for entry in entries:
            value = entry.get(field)
            if value is not None and value not in valid_values:
                entry_id = entry.get("id", "?")
                errors.append(
                    f"{section}[{entry_id}].{field} = '{value}' "
                    f"not in {enum_name}: {valid_values}"
                )

    assert not errors, "Invalid enum values:\n" + "\n".join(errors)


# --- ID format validation ---

def test_id_prefixes(after_state):
    """New entries must use correct ID prefixes for their section."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    errors = []
    section_to_prefix = {}
    for prefix, section in ID_PREFIXES.items():
        section_to_prefix.setdefault(section, []).append(prefix)

    for section in REQUIRED_SECTIONS:
        entries = research.get(section, [])
        if isinstance(entries, dict):
            entries = [entries]
        expected_prefixes = section_to_prefix.get(section, [])
        if not expected_prefixes:
            continue
        for entry in entries:
            entry_id = entry.get("id", "")
            if not any(entry_id.startswith(p) for p in expected_prefixes):
                errors.append(
                    f"{section}[{entry_id}]: ID should start with "
                    f"one of {expected_prefixes}"
                )

    # Plan items are nested inside plans
    for plan in research.get("plans", []):
        for item in plan.get("items", []):
            item_id = item.get("id", "")
            if not item_id.startswith("pli_"):
                errors.append(
                    f"plans[{plan.get('id')}].items[{item_id}]: "
                    f"ID should start with 'pli_'"
                )

    assert not errors, "Invalid ID prefixes:\n" + "\n".join(errors)


# --- Append-only enforcement (log section) ---

def test_log_append_only(before_state, after_state):
    """Log entries must not be modified or deleted. New entries may be appended."""
    before_research = before_state.get("research_json")
    after_research = after_state.get("research_json")

    if before_research is None or after_research is None:
        pytest.skip("Missing research.json for diff")

    before_log = before_research.get("log", [])
    after_log = after_research.get("log", [])

    # All original entries must still be present and unmodified
    assert len(after_log) >= len(before_log), (
        f"Log entries deleted: before had {len(before_log)}, "
        f"after has {len(after_log)}"
    )

    for i, before_entry in enumerate(before_log):
        assert i < len(after_log), f"Log entry {before_entry.get('id')} deleted"
        assert after_log[i] == before_entry, (
            f"Log entry {before_entry.get('id')} was modified"
        )


# --- No-delete enforcement ---

def test_no_entries_deleted(before_state, after_state):
    """No entries should be deleted from any section. Supersede with status instead."""
    before_research = before_state.get("research_json")
    after_research = after_state.get("research_json")

    if before_research is None or after_research is None:
        pytest.skip("Missing research.json for diff")

    errors = []
    for section in REQUIRED_SECTIONS:
        if section == "project":
            continue  # project is an object, not an array

        before_entries = {
            e.get("id"): e for e in before_research.get(section, [])
        }
        after_entries = {
            e.get("id"): e for e in after_research.get(section, [])
        }

        deleted = set(before_entries) - set(after_entries)
        if deleted:
            errors.append(f"{section}: deleted IDs {deleted}")

    assert not errors, "Entries deleted (should supersede instead):\n" + "\n".join(errors)


# --- ID referential integrity ---

def test_id_references_resolve(after_state):
    """All ID references in the output must point to existing entries."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    # Collect all known IDs
    known_ids = set()

    project = research.get("project")
    if project:
        known_ids.add(project.get("id", ""))

    for section in REQUIRED_SECTIONS:
        if section == "project":
            continue
        for entry in research.get(section, []):
            known_ids.add(entry.get("id", ""))

    # Collect plan item IDs
    for plan in research.get("plans", []):
        for item in plan.get("items", []):
            known_ids.add(item.get("id", ""))

    known_ids.discard("")

    # Check references (sample of key foreign keys)
    errors = []

    # plans.question_id -> questions
    for plan in research.get("plans", []):
        ref = plan.get("question_id")
        if ref and ref not in known_ids:
            errors.append(f"plans[{plan['id']}].question_id '{ref}' not found")

    # log.plan_item_id -> plan items
    for log_entry in research.get("log", []):
        ref = log_entry.get("plan_item_id")
        if ref and ref not in known_ids:
            errors.append(f"log[{log_entry['id']}].plan_item_id '{ref}' not found")

    # assertions.source_id -> sources
    for assertion in research.get("assertions", []):
        ref = assertion.get("source_id")
        if ref and ref not in known_ids:
            errors.append(
                f"assertions[{assertion['id']}].source_id '{ref}' not found"
            )

    # person_evidence.assertion_id -> assertions
    for pe in research.get("person_evidence", []):
        ref = pe.get("assertion_id")
        if ref and ref not in known_ids:
            errors.append(
                f"person_evidence[{pe['id']}].assertion_id '{ref}' not found"
            )

    # conflicts.competing_assertion_ids -> assertions
    for conflict in research.get("conflicts", []):
        for ref in conflict.get("competing_assertion_ids", []):
            if ref not in known_ids:
                errors.append(
                    f"conflicts[{conflict['id']}].competing_assertion_ids "
                    f"'{ref}' not found"
                )

    # proof_summaries.question_id -> questions
    for ps in research.get("proof_summaries", []):
        ref = ps.get("question_id")
        if ref and ref not in known_ids:
            errors.append(
                f"proof_summaries[{ps['id']}].question_id '{ref}' not found"
            )

    assert not errors, "Broken ID references:\n" + "\n".join(errors)
