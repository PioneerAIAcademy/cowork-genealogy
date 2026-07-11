"""Universal validators that run on every test, regardless of skill.

These check structural correctness of the output files against
the research schema spec (docs/specs/research-schema-spec.md).

## Validator function signatures

The harness (eval/harness/harness/validator_runner.py) inspects each
validator's signature and supplies whichever of these args it declares.
**Each is a separate parameter — `tool_calls` does NOT live inside
before_state/after_state.**

  - `before_state` (dict): scenario state before the skill ran. Keys:
      "research_json"      — parsed research.json or None
      "tree_gedcomx_json"  — parsed tree.gedcomx.json or None
      "tree_gedcomx"       — alias for backwards compatibility
      "files"              — {rel_path: text} for non-JSON files
      "skill_frontmatter"  — parsed YAML frontmatter of the skill's SKILL.md
  - `after_state` (dict): same shape, after the skill ran
  - `tool_calls` (list): every MCP tool call the skill made, with shape
      {"tool": "mcp__server__tool", "args": dict, "matched": {...},
       "response_fixture": str|None, "response": dict}
  - `skill_frontmatter` (dict): convenience copy of before_state's value

A validator can take any subset of these. Functions are plain pytest
test functions (raise AssertionError on failure). pytest.skip("...") is
treated as "not applicable to this state" — recorded as passed with a
skip marker, not as a failure.
"""

from pathlib import Path

import pytest

from harness.schema_validator import (
    validate_research_json,
    validate_tree_gedcomx_json,
)


# Top-level sections of research.json — the diff-aware tests below
# (`test_log_append_only`, `test_no_entries_deleted`,
# `test_id_references_resolve`, `test_ownership_table`) iterate over these.
# Shape, enums, ID prefixes, and required fields are all delegated to
# jsonschema (research.schema.json) per spec §8; this list is the only
# enum-table kept in Python.
REQUIRED_SECTIONS = [
    "project", "questions", "plans", "log", "sources",
    "assertions", "person_evidence", "conflicts",
    "hypotheses", "timelines", "proof_summaries",
]


# --- Schema validation (delegated to jsonschema per spec §8) ---

def test_research_json_validates_schema(after_state):
    """research.json must validate against docs/specs/schemas/research.schema.json.

    Covers what was previously hand-rolled in five separate Python tests:
    required sections, project-is-object, sections-are-arrays, closed-enum
    values, and ID-prefix patterns. The schema files are the single source
    of truth — when they change, this test picks it up automatically.
    """
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")
    errors = validate_research_json(research)
    assert not errors, (
        "research.json failed schema validation:\n  - "
        + "\n  - ".join(errors)
    )


def test_tree_gedcomx_json_validates_schema(after_state):
    """tree.gedcomx.json must validate against tree-gedcomx.schema.json.

    Previously omitted entirely — spec §8 required schema validation for
    BOTH files. Catches structural drift in the GedcomX output (missing
    required keys, wrong types, invalid enum values) at validator time
    instead of at upload time.
    """
    tree = after_state.get("tree_gedcomx_json")
    if tree is None:
        pytest.skip("No tree.gedcomx.json in output")
    errors = validate_tree_gedcomx_json(tree)
    assert not errors, (
        "tree.gedcomx.json failed schema validation:\n  - "
        + "\n  - ".join(errors)
    )


# Enum and ID-prefix validation are covered by the jsonschema delegation
# above (enums via $ref to enums.schema.json, ID prefixes via the
# `pattern` field on each section's `id` property). The previous
# hand-rolled Python implementations were removed in v1.5 to eliminate
# drift between code and schema.


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

    # assertions.log_entry_id -> log
    for assertion in research.get("assertions", []):
        ref = assertion.get("log_entry_id")
        if ref and ref not in known_ids:
            errors.append(
                f"assertions[{assertion['id']}].log_entry_id '{ref}' not found"
            )

    # sources.log_entry_id -> log
    for source in research.get("sources", []):
        ref = source.get("log_entry_id")
        if ref and ref not in known_ids:
            errors.append(
                f"sources[{source['id']}].log_entry_id '{ref}' not found"
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

    # conflicts.preferred_assertion_id -> assertions
    for conflict in research.get("conflicts", []):
        ref = conflict.get("preferred_assertion_id")
        if ref and ref not in known_ids:
            errors.append(
                f"conflicts[{conflict['id']}].preferred_assertion_id "
                f"'{ref}' not found"
            )

    # questions.depends_on / questions.unblocks -> other questions
    for q in research.get("questions", []):
        for field in ("depends_on", "unblocks"):
            for ref in q.get(field, []) or []:
                if ref not in known_ids:
                    errors.append(
                        f"questions[{q['id']}].{field} '{ref}' not found"
                    )

    # questions.resolution_assertion_ids -> assertions
    for q in research.get("questions", []):
        for ref in q.get("resolution_assertion_ids", []) or []:
            if ref not in known_ids:
                errors.append(
                    f"questions[{q['id']}].resolution_assertion_ids "
                    f"'{ref}' not found"
                )

    # hypotheses.supporting_assertion_ids / contradicting_assertion_ids
    for hyp in research.get("hypotheses", []):
        for field in ("supporting_assertion_ids", "contradicting_assertion_ids"):
            for ref in hyp.get(field, []) or []:
                if ref not in known_ids:
                    errors.append(
                        f"hypotheses[{hyp['id']}].{field} '{ref}' not found"
                    )

    # proof_summaries.question_id -> questions
    for ps in research.get("proof_summaries", []):
        ref = ps.get("question_id")
        if ref and ref not in known_ids:
            errors.append(
                f"proof_summaries[{ps['id']}].question_id '{ref}' not found"
            )

    # NOTE: timelines.person_ids references GedcomX persons in
    # tree.gedcomx.json, not entries in research.json. To check those we'd
    # need the tree state passed in alongside research_json — out of scope
    # for this validator. Tracked in unit-test-spec-v2.md under "expand
    # cross-file ID-reference validation."

    assert not errors, "Broken ID references:\n" + "\n".join(errors)


# --- Ownership table ---
#
# Single source of truth for which skills are *allowed* to write each
# research.json section. Mirrors the prose table in
# docs/specs/research-schema-spec.md §4. Update both together — drift here
# would silently let any skill write any section.
#
# A section absent from this dict (e.g., a hypothetical "metadata") has no
# declared writers and any modification fails the ownership check. A skill
# absent from every section is read-only (e.g., search-wikipedia,
# historical-context); they fail the ownership check if they touch
# research.json at all.
# Mirrors simplified-gedcomx-spec.md §1: tree.gedcomx.json is the
# upload-target file. init-project writes the initial stub persons;
# tree-edit applies user-directed changes; proof-conclusion promotes
# research → tree when a proof summary reaches `probable` or higher
# (see research-schema-spec.md §8 "tree.gedcomx.json update timing").
# person-evidence may also add `persons` — it mints a stub person when a
# newly discovered persona matches no one in the tree, then links the
# assertion to it (SKILL.md Step 5; research-schema-spec.md §8 line 656:
# "Person stubs may be created by person-evidence when a newly discovered
# person doesn't yet exist in the GedcomX file").
# record-extraction may also add `persons` AND `relationships` — when the
# subject appears as a child on a household record (e.g., census), §5d of
# the record-extraction skill creates minimal person stubs for the
# subject's siblings (preferred name + gender only, no facts) and the
# `ParentChild` edges linking each new sibling to the household's existing
# in-tree parent. This is the upstream half of the warnings-architecture
# chain — sibling stubs in the tree are what `buildParentMob` discovers
# and what makes `relativesChildBirthRange40` and `person-evidence` work
# end-to-end. The skill never adds non-sibling persons, never updates an
# existing person, and never writes relationships other than ParentChild
# from an in-tree parent to a new sibling.
TREE_OWNERSHIP_TABLE: dict[str, set[str]] = {
    "persons": {"init-project", "tree-edit", "proof-conclusion",
                "person-evidence", "record-extraction"},
    "relationships": {"init-project", "tree-edit", "proof-conclusion",
                      "record-extraction"},
    "sources": {"init-project", "tree-edit", "proof-conclusion",
                "record-extraction"},
}


OWNERSHIP_TABLE: dict[str, set[str]] = {
    "project": {"init-project", "proof-conclusion"},
    "questions": {"question-selection", "research-exhaustiveness"},
    # research-plan owns plan/item structure; search and extraction skills
    # co-own plans only to update items[].status after executing or
    # extracting from an item (see spec §4).
    "plans": {"research-plan", "search-records", "search-external-sites",
              "search-full-text", "search-images", "record-extraction"},
    "log": {"search-records", "search-external-sites", "record-extraction",
            "search-full-text", "search-images"},
    "sources": {"record-extraction", "citation"},
    "assertions": {"record-extraction", "convert-dates"},
    "person_evidence": {"person-evidence"},
    "conflicts": {"conflict-resolution"},
    "hypotheses": {"hypothesis-tracking"},
    "timelines": {"timeline"},
    "proof_summaries": {"proof-conclusion"},
}


def _modified_sections(before: dict, after: dict, sections: list[str]) -> list[str]:
    """Return the names of top-level sections whose contents differ."""
    modified = []
    for section in sections:
        b = before.get(section)
        a = after.get(section)
        # Singletons (project) need direct comparison; arrays compare elementwise.
        if b != a:
            modified.append(section)
    return modified


def _only_project_updated_changed(before: dict, after: dict) -> bool:
    """True if `project` differs only in the `updated` audit timestamp.

    `project.updated` is a per-session activity ping: any skill that
    successfully modifies research.json may refresh it. Substantive
    project fields (id, objective, subject_person_ids, status, created)
    remain restricted to the OWNERSHIP_TABLE writers.
    """
    bp = before.get("project")
    ap = after.get("project")
    if not isinstance(bp, dict) or not isinstance(ap, dict):
        return False
    bp_copy = {k: v for k, v in bp.items() if k != "updated"}
    ap_copy = {k: v for k, v in ap.items() if k != "updated"}
    return bp_copy == ap_copy and bp.get("updated") != ap.get("updated")


def test_ownership_table(before_state, after_state, skill_frontmatter, test):
    """Universal: skill may only modify research.json sections it owns.

    Driven by the OWNERSHIP_TABLE above. A skill modifying a section it
    doesn't own fails the test — that's the single biggest layer-1
    defense for cross-skill state corruption.

    The skill name is read from skill_frontmatter["name"]. If the
    frontmatter is missing a name, we skip rather than fail (caller
    error, not a skill defect).

    Skipped on negative tests: the skill under test is supposed to
    decline, so any research.json change was made by the routed-to
    skill, which has its own ownership rights — attributing those
    writes to the skill under test is a false positive. A negative
    test where the skill *does* wrongly activate already fails on the
    routing check.
    """
    if test.get("type") == "negative":
        pytest.skip(
            "ownership is not checked on negative tests — writes belong "
            "to the routed-to skill, not the skill under test"
        )

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for ownership diff")

    skill_name = (skill_frontmatter or {}).get("name")
    if not skill_name:
        pytest.skip("skill_frontmatter has no `name` field")

    modified = _modified_sections(before, after, REQUIRED_SECTIONS)
    unauthorized = []
    for section in modified:
        allowed = OWNERSHIP_TABLE.get(section, set())
        if skill_name not in allowed:
            # `project.updated` is an activity ping any skill may touch.
            # If the only delta inside `project` is that timestamp, don't
            # flag it as an ownership violation.
            if section == "project" and _only_project_updated_changed(before, after):
                continue
            unauthorized.append(section)

    if unauthorized:
        # Sort for stable error messages.
        owners_summary = {s: sorted(OWNERSHIP_TABLE.get(s, set())) for s in unauthorized}
        assert False, (
            f"{skill_name} modified sections it doesn't own: {sorted(unauthorized)}. "
            f"Allowed writers per section: {owners_summary}"
        )


def test_tree_ownership_table(before_state, after_state, skill_frontmatter, test):
    """Universal: skill may only modify tree.gedcomx.json sections it owns.

    Parallel to test_ownership_table, but for tree.gedcomx.json. Driven
    by TREE_OWNERSHIP_TABLE above. Without this check, tree-edit and
    proof-conclusion writes to that file would pass vacuously — there
    was no ownership coverage at all in earlier versions.

    Skipped on negative tests for the same reason as test_ownership_table
    — a routed-to skill's legitimate writes would otherwise be
    misattributed to the skill under test.
    """
    if test.get("type") == "negative":
        pytest.skip(
            "ownership is not checked on negative tests — writes belong "
            "to the routed-to skill, not the skill under test"
        )

    before = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for ownership diff")

    skill_name = (skill_frontmatter or {}).get("name")
    if not skill_name:
        pytest.skip("skill_frontmatter has no `name` field")

    modified = _modified_sections(before, after, list(TREE_OWNERSHIP_TABLE.keys()))
    unauthorized = []
    for section in modified:
        allowed = TREE_OWNERSHIP_TABLE.get(section, set())
        if skill_name not in allowed:
            unauthorized.append(section)

    if unauthorized:
        owners_summary = {s: sorted(TREE_OWNERSHIP_TABLE.get(s, set())) for s in unauthorized}
        assert False, (
            f"{skill_name} modified tree.gedcomx.json sections it doesn't own: "
            f"{sorted(unauthorized)}. Allowed writers per section: {owners_summary}"
        )


def test_tool_allowlist(tool_calls, skill_frontmatter, test):
    """Universal: every MCP tool call must be in the skill's allowed-tools.

    Per unit-test-spec.md §15 the SDK enforces this at call time when the
    harness derives the allowlist from frontmatter; this validator catches
    drift between the frontmatter and what the skill actually called (e.g.,
    a fixture was loaded for a tool the skill shouldn't be using).

    The declared set is widened with the frontmatter `tools:` of every
    plugin agent the skill's SKILL.md references via `@plugin:<name>` —
    a delegated agent's MCP calls land in the same session tool_calls log,
    and they are legitimate exactly when the skill body instructs the
    delegation. Mirrors harness.allowed_tools.compute_allowed_tools.

    Skipped on negative tests: tool calls come from the routed-to skill,
    not the skill under test, so checking against the skill under test's
    allowed-tools would be a false positive.
    """
    if test.get("type") == "negative":
        pytest.skip(
            "allowlist is not checked on negative tests — tool calls "
            "belong to the routed-to skill, not the skill under test"
        )
    if not tool_calls:
        return
    declared = set((skill_frontmatter or {}).get("allowed-tools", []) or [])

    # Widen with referenced plugin agents' tools (bare MCP names only —
    # built-in tools like Read never appear in tool_calls).
    from harness.allowed_tools import agent_refs_for_skill, load_skill_frontmatter
    from harness.workspace import DEFAULT_PLUGIN_AGENTS

    _repo_root = Path(__file__).resolve().parents[3]
    _skill_md = (
        _repo_root / "packages" / "engine" / "plugin" / "skills"
        / str(test.get("skill", "")) / "SKILL.md"
    )
    for _agent in agent_refs_for_skill(_skill_md):
        _agent_fm = load_skill_frontmatter(DEFAULT_PLUGIN_AGENTS / f"{_agent}.md")
        for _t in _agent_fm.get("tools", []) or []:
            # Agent frontmatter lists MCP tools in qualified form
            # (mcp__genealogy__wikipedia_search — the SDK resolves subagent
            # tools by exposed name); this validator compares bare names, so
            # normalize. Built-ins (capitalized) never appear in tool_calls.
            _bare = _t.split("__")[-1] if "__" in _t else _t
            if not _bare[:1].isupper():
                declared.add(_bare)
    if not declared:
        # Skill declared no MCP tools but called some — that's a violation.
        bare = [c["tool"].split("__")[-1] for c in tool_calls]
        assert not bare, (
            f"skill called MCP tools but declared none in allowed-tools: {bare}"
        )
        return
    bad = []
    for call in tool_calls:
        bare = call["tool"].split("__")[-1]
        if bare not in declared:
            bad.append(bare)
    assert not bad, (
        f"skill called MCP tools not in allowed-tools frontmatter: {sorted(set(bad))}"
    )
