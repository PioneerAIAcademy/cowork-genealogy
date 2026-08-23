"""Unit tests for harness/skill_invocation.py.

docs/specs/guardrail-enforcement-spec.md §7/§8/§11 — pure matching logic
over the harness's `tool_calls` list shape. No I/O, no SDK types, except
the one corpus-pinned regression test that reads a committed runlog.
"""

import json
from pathlib import Path

import pytest

from harness.skill_invocation import (
    CITATION_NULLING_KIND,
    CONFLICT_ANALYSIS_FIELDS,
    CONFLICT_UNPERSISTED_KIND,
    DEDICATED_AGENT_NAMES,
    GUARDRAIL_SKILLS,
    WARNINGS_UNCHECKED_KIND,
    find_citation_nulling_in_conclusions,
    find_effects_without_invocation,
    find_missing_mentor_verdicts,
    find_person_evidence_missing_same_person,
    find_protected_writes_by_unnamed_delegate,
    find_relationship_writes_without_warnings_check,
    find_unguarded_protected_writes,
    find_unpersisted_conflict_resolutions,
    owning_skills,
    recently_succeeded,
    same_person_scored_ids,
    skill_name_if_skill_call,
    unguarded_new_person_evidence_links,
)

# Sentinel distinguishing "key absent entirely" (the historical tool_calls
# shape, and the shape a call still in-flight when a run aborts keeps
# forever) from "key present as None" (spec §11 Step 0's real shape for a
# main-thread call) -- find_protected_writes_by_unnamed_delegate treats both
# as "main thread, always legitimate" via .get(), but the two are
# constructed differently here so both are exercised.
_UNSET = object()


def _skill_call(name, args_text=None, is_error=False):
    entry = {"tool": "Skill", "args": {"skill": name}}
    if args_text is not None:
        entry["args"]["args"] = args_text
    if is_error:
        entry["is_error"] = True
    return entry


def _mcp_call(bare_name, args, is_error=False, agent_id=_UNSET, agent_type=_UNSET):
    entry = {"tool": f"mcp__genealogy__{bare_name}", "args": args}
    if is_error:
        entry["is_error"] = True
    if agent_id is not _UNSET:
        entry["agent_id"] = agent_id
    if agent_type is not _UNSET:
        entry["agent_type"] = agent_type
    return entry


# --- skill_name_if_skill_call ------------------------------------------------


def test_skill_name_extracted_from_skill_tool_call():
    assert skill_name_if_skill_call("Skill", {"skill": "proof-conclusion"}) == "proof-conclusion"


def test_skill_name_none_for_non_skill_tools():
    assert skill_name_if_skill_call("mcp__genealogy__research_append", {"skill": "proof-conclusion"}) is None
    assert skill_name_if_skill_call("Agent", {"skill": "proof-conclusion"}) is None


def test_skill_name_none_when_skill_arg_missing_or_blank():
    assert skill_name_if_skill_call("Skill", {}) is None
    assert skill_name_if_skill_call("Skill", {"skill": ""}) is None
    assert skill_name_if_skill_call("Skill", None) is None


# --- owning_skills: research_append sections ---------------------------------


def test_proof_summaries_owned_by_proof_conclusion():
    args = {"section": "proof_summaries", "op": "append", "entry": {"question_id": "q_001", "tier": "proved"}}
    assert owning_skills("mcp__genealogy__research_append", args) == ["proof-conclusion"]


def test_person_evidence_owned_by_person_evidence():
    args = {"section": "person_evidence", "op": "append", "entry": {"person_id": "I1"}}
    assert owning_skills("mcp__genealogy__research_append", args) == ["person-evidence"]


def test_conflicts_owned_by_conflict_resolution():
    args = {"section": "conflicts", "op": "update", "entryId": "c_001", "fields": {"status": "resolved"}}
    assert owning_skills("mcp__genealogy__research_append", args) == ["conflict-resolution"]


def test_exhaustive_declaration_true_owned_by_research_exhaustiveness():
    args = {
        "section": "questions",
        "op": "update",
        "entryId": "q_001",
        "fields": {"exhaustive_declaration": {"declared": True}},
    }
    assert owning_skills("mcp__genealogy__research_append", args) == ["research-exhaustiveness"]


def test_questions_update_without_declaring_true_owns_nothing():
    args = {"section": "questions", "op": "update", "entryId": "q_001", "fields": {"priority": "low"}}
    assert owning_skills("mcp__genealogy__research_append", args) == []
    args2 = {
        "section": "questions",
        "op": "update",
        "entryId": "q_001",
        "fields": {"exhaustive_declaration": {"declared": False}},
    }
    assert owning_skills("mcp__genealogy__research_append", args2) == []


def test_unrelated_sections_own_nothing():
    for section in ("sources", "assertions", "plans", "hypotheses", "timelines", "evaluations"):
        args = {"section": section, "op": "append", "entry": {}}
        assert owning_skills("mcp__genealogy__research_append", args) == []


def test_batch_form_touching_multiple_sections_returns_all_owners_deduped():
    args = {
        "ops": [
            {"section": "person_evidence", "op": "append", "entry": {"person_id": "I1"}},
            {"section": "proof_summaries", "op": "append", "entry": {"question_id": "q_001", "tier": "probable"}},
            {"section": "person_evidence", "op": "append", "entry": {"person_id": "I2"}},
        ]
    }
    assert owning_skills("mcp__genealogy__research_append", args) == ["person-evidence", "proof-conclusion"]


# --- owning_skills: materialize_facts / tree_edit / tree_correct ------------


def test_materialize_facts_minting_new_person_owned_by_person_evidence():
    args = {"recordId": "rec_1", "recordRole": "child"}  # no personId => mints new
    assert owning_skills("mcp__genealogy__materialize_facts", args) == ["person-evidence"]


def test_materialize_facts_enriching_existing_person_owns_nothing():
    args = {"personId": "I1", "recordId": "rec_1", "recordRole": "child"}
    assert owning_skills("mcp__genealogy__materialize_facts", args) == []


def test_tree_edit_add_parent_child_relationship_owned_by_proof_conclusion():
    args = {"operation": "add_relationship", "relationship": {"type": "ParentChild", "person1": "I1", "person2": "I2"}}
    assert owning_skills("mcp__genealogy__tree_edit", args) == ["proof-conclusion"]


def test_tree_edit_add_couple_relationship_owned_by_proof_conclusion():
    args = {"operation": "add_relationship", "relationship": {"type": "Couple", "person1": "I1", "person2": "I2"}}
    assert owning_skills("mcp__genealogy__tree_edit", args) == ["proof-conclusion"]


def test_tree_correct_setting_primary_fact_owned_by_proof_conclusion():
    args = {"operation": "update_fact", "factId": "f1", "fact": {"type": "Death", "primary": True}}
    assert owning_skills("mcp__genealogy__tree_correct", args) == ["proof-conclusion"]


def test_tree_edit_unrelated_op_owns_nothing():
    args = {"operation": "add_source", "source": {"title": "x"}}
    assert owning_skills("mcp__genealogy__tree_edit", args) == []


def test_non_write_tools_own_nothing():
    assert owning_skills("mcp__genealogy__record_search", {}) == []
    assert owning_skills("Read", {"file_path": "research.json"}) == []


# --- recently_succeeded ------------------------------------------------------


def test_recently_succeeded_true_within_window():
    calls = [_skill_call("proof-conclusion"), _mcp_call("research_append", {})]
    assert recently_succeeded("proof-conclusion", calls, before_index=1, window=5) is True


def test_recently_succeeded_false_outside_window():
    calls = [_skill_call("proof-conclusion")] + [_mcp_call("record_search", {})] * 5
    assert recently_succeeded("proof-conclusion", calls, before_index=6, window=3) is False


def test_recently_succeeded_false_when_never_invoked():
    calls = [_mcp_call("record_search", {})]
    assert recently_succeeded("proof-conclusion", calls, before_index=1, window=5) is False


def test_recently_succeeded_ignores_a_failed_skill_call():
    """An errored Skill invocation must not open the window — otherwise
    invoke -> fail -> finish inline evades detection (plan §4.1)."""
    calls = [_skill_call("proof-conclusion", is_error=True), _mcp_call("research_append", {})]
    assert recently_succeeded("proof-conclusion", calls, before_index=1, window=5) is False


def test_recently_succeeded_keyed_by_question_when_derivable():
    calls = [_skill_call("proof-conclusion", args_text="--autonomous q_001 projectPath=/x")]
    assert recently_succeeded("proof-conclusion", calls, before_index=1, window=5, question_id="q_002") is False
    assert recently_succeeded("proof-conclusion", calls, before_index=1, window=5, question_id="q_001") is True


def test_recently_succeeded_falls_back_to_skill_only_when_question_id_not_derivable():
    calls = [_skill_call("proof-conclusion")]  # no args text -> no derivable question id
    assert recently_succeeded("proof-conclusion", calls, before_index=1, window=5, question_id="q_001") is True


# --- find_unguarded_protected_writes ----------------------------------------


def test_flags_a_protected_write_with_no_prior_skill_call():
    calls = [_mcp_call("research_append", {"section": "proof_summaries", "entry": {"question_id": "q_001", "tier": "probable"}})]
    violations = find_unguarded_protected_writes(calls, window=10)
    assert len(violations) == 1
    assert violations[0]["required_skill"] == "proof-conclusion"
    assert violations[0]["index"] == 0


def test_does_not_flag_a_protected_write_preceded_by_the_right_skill():
    calls = [
        _skill_call("proof-conclusion", args_text="--autonomous q_001"),
        _mcp_call("research_append", {"section": "proof_summaries", "entry": {"question_id": "q_001", "tier": "probable"}}),
    ]
    assert find_unguarded_protected_writes(calls, window=10) == []


def test_flags_the_read_and_improvise_bypass_shape():
    """No Skill call at all, no Agent/Task call — just the write."""
    calls = [
        _mcp_call("research_append", {"section": "person_evidence", "entry": {"person_id": "I1"}}),
    ]
    violations = find_unguarded_protected_writes(calls, window=10)
    assert violations[0]["required_skill"] == "person-evidence"


def _no_project_summary(escaped: bool) -> str:
    """The two shapes `response_summary` actually arrives in.

    `escaped=True` is the MCP envelope the e2e orchestrator passes through
    VERBATIM for any response under 500 chars — which the no-project response
    always is, at 236 chars enveloped (248 for the read variant), making this the
    DOMINANT production shape. A detector tested only against the unwrapped form
    is dark in every real run.
    """
    doc = '{"ok": false, "reason": "no_project", "errors": ["not a project"]}'
    if not escaped:
        return doc
    return json.dumps([{"type": "text", "text": doc}])


@pytest.mark.parametrize("escaped", [True, False], ids=["mcp-envelope", "unwrapped"])
def test_does_not_flag_a_no_project_write_that_never_landed(escaped):
    """Issue #1695. A no-project write persisted nothing and deliberately
    carries NO `is_error` — it is an answer, not a failure. Counting it would
    manufacture a protected-write violation for a write that never happened,
    in paid e2e grading.

    Parametrized over both shapes because the envelope one is what production
    emits, and a quoted-key match passes the unwrapped case while failing it.
    """
    call = _mcp_call("research_append", {"section": "proof_summaries", "entry": {"question_id": "q_001", "tier": "probable"}})
    call["response_summary"] = _no_project_summary(escaped)
    assert find_unguarded_protected_writes([call], window=10) == []


def test_still_flags_a_landed_write_whose_payload_merely_mentions_no_project():
    """The marker is the underscored token, not the English words — without this
    the test above would pass on a check that skipped everything."""
    call = _mcp_call("research_append", {"section": "proof_summaries", "entry": {"question_id": "q_001", "tier": "probable"}})
    call["response_summary"] = '{"ok":true,"entryId":"ps_001","note":"no project needed"}'
    assert len(find_unguarded_protected_writes([call], window=10)) == 1


def test_flags_the_untyped_agent_bypass_shape():
    """An Agent call with no subagent_type never sets skill_name_if_skill_call
    to anything, so it never opens a window either."""
    calls = [
        {"tool": "Agent", "args": {"description": "write proof summary", "prompt": "..."}},
        _mcp_call("research_append", {"section": "proof_summaries", "entry": {"question_id": "q_001", "tier": "probable"}}),
    ]
    violations = find_unguarded_protected_writes(calls, window=10)
    assert violations[0]["required_skill"] == "proof-conclusion"


# --- find_effects_without_invocation -----------------------------------------


def test_no_violations_on_a_clean_run():
    calls = [
        _skill_call("research-exhaustiveness"),
        _skill_call("proof-conclusion"),
        _skill_call("person-evidence"),
        _skill_call("conflict-resolution"),
    ]
    research = {
        "questions": [{"id": "q_001", "exhaustive_declaration": {"declared": True}}],
        "proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "proved"}],
        "person_evidence": [{"id": "pe_001", "person_id": "I1"}],
        "conflicts": [{"id": "c_001", "status": "resolved"}],
    }
    tree = {"persons": [{"id": "I1", "names": [{"given": "A"}], "facts": []}], "relationships": []}
    assert find_effects_without_invocation(calls, research, tree, starting_tree=tree) == []


def test_flags_exhaustive_declaration_with_no_research_exhaustiveness_invocation():
    research = {"questions": [{"id": "q_001", "exhaustive_declaration": {"declared": True}}]}
    violations = find_effects_without_invocation([], research, {})
    assert any("research-exhaustiveness" in v for v in violations)


def test_flags_proof_summaries_entry_with_no_proof_conclusion_invocation():
    research = {"proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "probable"}]}
    violations = find_effects_without_invocation([], research, {})
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_primary_fact_with_no_proof_conclusion_invocation_even_with_no_proof_summary():
    """proof-conclusion's tree-encoding output, not just the research.json entry."""
    tree = {"persons": [{"id": "I1", "facts": [{"type": "Death", "primary": True}]}], "relationships": []}
    violations = find_effects_without_invocation([], {}, tree)
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_parent_child_relationship_with_no_proof_conclusion_invocation():
    tree = {"persons": [], "relationships": [{"type": "ParentChild", "person1": "I1", "person2": "I2"}]}
    violations = find_effects_without_invocation([], {}, tree)
    assert any("proof-conclusion" in v for v in violations)


def test_does_not_flag_a_seeded_relationship_already_in_the_starting_tree():
    """Issue #998: the proof-conclusion arm took no starting-tree baseline, so a
    fixture's seeded ParentChild/Couple read as this run's conclusion. 99 of 104
    fixtures ship such relationships, so the arm fired on seed state alone."""
    rel = {"type": "ParentChild", "parent": "I1", "child": "I2"}
    tree = {"persons": [], "relationships": [rel]}
    starting = {"persons": [], "relationships": [rel]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert not any("proof-conclusion" in v for v in violations)


def test_flags_a_relationship_created_this_run_against_the_starting_tree():
    """The other side of the baseline: a ParentChild present only in the FINAL
    tree is this run's work and must still fire when proof-conclusion is absent."""
    starting = {"persons": [], "relationships": []}
    tree = {"persons": [], "relationships": [{"type": "ParentChild", "parent": "I1", "child": "I2"}]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_does_not_flag_a_seeded_primary_fact_already_in_the_starting_tree():
    """Defensive: no fixture ships a primary:true fact today, but the primary-fact
    half is baselined the same way so a future seeded one cannot fire the arm."""
    person = {"id": "I1", "facts": [{"type": "Death", "primary": True}]}
    tree = {"persons": [person], "relationships": []}
    starting = {"persons": [person]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert not any("proof-conclusion" in v for v in violations)


def test_flags_a_primary_fact_replaced_in_place():
    """Issue #1569: a primary fact REPLACED (same count, different content) used to
    read as unchanged under the count-based check. Identity-based (signature) catches
    it: the seeded Death fact carries no date, the final one does."""
    starting_person = {"id": "I1", "facts": [{"type": "Death", "primary": True}]}
    final_person = {"id": "I1", "facts": [{"type": "Death", "primary": True, "standard_date": "1900"}]}
    tree = {"persons": [final_person], "relationships": []}
    starting = {"persons": [starting_person]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_second_primary_fact_with_content_identical_to_an_existing_one():
    """Found by review: a bare set of normalized signatures would collapse two
    primary facts that happen to carry the identical (type, date, place) into one,
    silently hiding a genuinely-added duplicate -- exactly the gap the raw-count
    check this replaces was supposed to catch. Counter-based comparison preserves
    multiplicity: 2 of the same signature vs. 1 in the baseline must still fire."""
    dup_fact = {"type": "Death", "primary": True, "standard_date": "1900", "standard_place": None}
    starting_person = {"id": "I1", "facts": [dict(dup_fact)]}
    final_person = {"id": "I1", "facts": [dict(dup_fact), {**dup_fact, "sources": [{"ref": "src-2"}]}]}
    tree = {"persons": [final_person], "relationships": []}
    starting = {"persons": [starting_person]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_second_relationship_fact_with_content_identical_to_an_existing_one():
    """The relationship-side twin of
    test_flags_a_second_primary_fact_with_content_identical_to_an_existing_one: a bare
    frozenset of normalized fact signatures collapses two facts carrying the identical
    (type, date, place) into one, hiding a genuinely-added duplicate. Counter-based
    comparison preserves multiplicity. Without this test, dropping the Counter here
    passes the whole suite (found by review)."""
    dup = {"type": "Marriage", "standard_date": "21 Oct 1860", "standard_place": "Lezayre"}
    starting_rel = {"id": "R1", "type": "Couple", "person1": "I1", "person2": "I2", "facts": [dict(dup)]}
    final_rel = {
        "id": "R1",
        "type": "Couple",
        "person1": "I1",
        "person2": "I2",
        "facts": [dict(dup), {**dup, "sources": [{"ref": "src-2"}]}],
    }
    starting = {"persons": [], "relationships": [starting_rel]}
    tree = {"persons": [], "relationships": [final_rel]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_placeholder_relationship_re_pointed_this_run():
    """The endpoint-tuple key, not `id`: 7 fixtures seed a relationship pointing at
    a PID-TODO placeholder that the agent resolves during the run. Keying on `id`
    would read that genuinely-re-pointed relationship as seeded — a false negative
    in the one gate that overrides the judge. Shape taken from young-marriage-1828,
    which seeds {parent: PID-TODO, child: p-child-thomas, id: rel-1}."""
    starting = {"persons": [], "relationships": [
        {"id": "rel-1", "type": "ParentChild", "parent": "PID-TODO", "child": "p-child-thomas"}]}
    tree = {"persons": [], "relationships": [
        {"id": "rel-1", "type": "ParentChild", "parent": "G7X1-234", "child": "p-child-thomas"}]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_marriage_fact_dated_onto_a_seeded_couple():
    """Issue #1569 (was #1368) Scenario A: susanna-dawson-marriage's own shape — a
    Couple seeded with NO facts, a marriage fact written onto it this run. The
    endpoint-only key read this as unchanged; the normalized signature does not,
    because facts is part of the signature now."""
    starting_rel = {"id": "R1", "type": "Couple", "person1": "I1", "person2": "I2"}
    final_rel = {
        "id": "R1",
        "type": "Couple",
        "person1": "I1",
        "person2": "I2",
        "facts": [{"type": "Marriage", "standard_date": "21 Oct 1860", "standard_place": "Lezayre"}],
    }
    starting = {"persons": [], "relationships": [starting_rel]}
    tree = {"persons": [], "relationships": [final_rel]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_flags_a_parentchild_subtype_reclassified():
    """Issue #1569 Scenario B: a seeded ParentChild's subtype changed
    Biological -> Adopted. The endpoints are identical; only subtype differs."""
    starting_rel = {"id": "R16", "type": "ParentChild", "parent": "I1", "child": "I2", "subtype": "Biological"}
    final_rel = {"id": "R16", "type": "ParentChild", "parent": "I1", "child": "I2", "subtype": "Adopted"}
    starting = {"persons": [], "relationships": [starting_rel]}
    tree = {"persons": [], "relationships": [final_rel]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert any("proof-conclusion" in v for v in violations)


def test_does_not_flag_a_seeded_couples_facts_merely_reordered_or_re_ided():
    """The normalization control: a harmless re-serialization (facts reordered, an
    id attached to a fact) must NOT read as a new conclusion -- the exact disease
    issue #1340 cures. Confirms the signature is order- and id-insensitive, not
    merely 'facts changed'."""
    starting_rel = {
        "id": "R1",
        "type": "Couple",
        "person1": "I1",
        "person2": "I2",
        "facts": [
            {"type": "Marriage", "standard_date": "21 Oct 1860", "standard_place": "Lezayre"},
            {"type": "Residence", "standard_date": "1861", "standard_place": "Lezayre"},
        ],
    }
    final_rel = {
        "id": "R1",
        "type": "Couple",
        "person1": "I1",
        "person2": "I2",
        # same two facts, reordered, one with an id attached this run
        "facts": [
            {"id": "F9", "type": "Residence", "standard_date": "1861", "standard_place": "Lezayre"},
            {"type": "Marriage", "standard_date": "21 Oct 1860", "standard_place": "Lezayre"},
        ],
    }
    starting = {"persons": [], "relationships": [starting_rel]}
    tree = {"persons": [], "relationships": [final_rel]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert not any("proof-conclusion" in v for v in violations)


def test_relationship_signature_tolerates_a_none_and_a_populated_place_on_same_fact_type():
    """Real corpus shape (chresten-nielsen-daughter's R1): two facts of the same
    type where one has a populated standard_place and the other None. A
    sorted-tuple signature would raise TypeError comparing None to str; the
    frozenset-based signature must not."""
    rel = {
        "id": "R1",
        "type": "Couple",
        "person1": "I1",
        "person2": "I2",
        "facts": [
            {"type": "Marriage", "standard_date": "13 Mar 1790", "standard_place": None},
            {"type": "Marriage", "standard_date": "13 Mar 1790", "standard_place": "Tyrsted, Vejle, Denmark"},
        ],
    }
    tree = {"persons": [], "relationships": [rel]}
    starting = {"persons": [], "relationships": [rel]}
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting)
    assert not any("proof-conclusion" in v for v in violations)


def test_flags_a_new_unlinked_person_with_no_person_evidence_invocation():
    """The materialize_facts identity-bypass route the adversarial review found."""
    tree = {"persons": [{"id": "I9", "names": [{"given": "New"}], "facts": [{"type": "Birth"}]}], "relationships": []}
    violations = find_effects_without_invocation([], {"person_evidence": []}, tree, starting_tree={"persons": []})
    assert any("person-evidence" in v for v in violations)


def test_does_not_flag_a_seed_person_already_in_the_starting_tree():
    """A fixture's starting tree naturally has unlinked persons with facts —
    that's not a bypass, it's the fixture's initial state."""
    seed_person = {"id": "I1", "names": [{"given": "Seed"}], "facts": [{"type": "Birth"}]}
    tree = {"persons": [seed_person], "relationships": []}
    violations = find_effects_without_invocation([], {"person_evidence": []}, tree, starting_tree=tree)
    assert not any("person-evidence" in v for v in violations)


def test_flags_a_seed_person_who_gained_new_facts_this_run():
    starting = {"persons": [{"id": "I1", "names": [{"given": "Seed"}], "facts": [{"type": "Birth"}]}]}
    grown = {"persons": [{"id": "I1", "names": [{"given": "Seed"}], "facts": [{"type": "Birth"}, {"type": "Death"}]}], "relationships": []}
    violations = find_effects_without_invocation([], {"person_evidence": []}, grown, starting_tree=starting)
    assert any("person-evidence" in v for v in violations)


def test_flags_a_seed_persons_fact_replaced_in_place():
    """Found by review: the same count-based blind spot the proof-conclusion arm
    had (issue #1569) was also present here -- a seeded person's fact REPLACED
    (same count, different content) read as unchanged. Identity-based comparison
    catches it: the seeded Birth fact carries no date, the final one does."""
    starting = {"persons": [{"id": "I1", "names": [{"given": "Seed"}], "facts": [{"type": "Birth"}]}]}
    changed = {
        "persons": [{"id": "I1", "names": [{"given": "Seed"}], "facts": [{"type": "Birth", "standard_date": "1850"}]}],
        "relationships": [],
    }
    violations = find_effects_without_invocation([], {"person_evidence": []}, changed, starting_tree=starting)
    assert any("person-evidence" in v for v in violations)


def test_flags_a_resolved_conflict_with_no_conflict_resolution_invocation():
    research = {"conflicts": [{"id": "c_001", "status": "resolved"}]}
    violations = find_effects_without_invocation([], research, {})
    assert any("conflict-resolution" in v for v in violations)


def test_unresolved_conflict_does_not_require_invocation():
    """A bare record that a conflict EXISTS is not conflict-resolution's product.

    person-evidence (#738), proof-conclusion, question-selection, research-plan,
    timeline and init-project all legitimately open a conflicts entry with only
    the schema's required fields. Firing here would flag every one of them.
    """
    research = {"conflicts": [{"id": "c_001", "status": "unresolved"}]}
    assert find_effects_without_invocation([], research, {}) == []


@pytest.mark.parametrize("field", CONFLICT_ANALYSIS_FIELDS)
def test_flags_an_unresolved_conflict_carrying_the_analysis_product(field):
    """Regression for eulogia-gatica-burial run-2026-07-28_17-07-48.

    The router wrote a full independence/weighing analysis into c_001, never
    invoked conflict-resolution, and left `status: unresolved` — which the
    status-only rule read as "nothing to see here". It then stamped the proof
    `proved` over the open conflict. Each analysis field alone must fire.
    """
    research = {"conflicts": [{"id": "c_001", "status": "unresolved", field: "a_004"}]}
    violations = find_effects_without_invocation([], research, {})
    assert any("conflict-resolution" in v for v in violations)


def test_analysis_product_is_satisfied_by_invoking_conflict_resolution():
    research = {
        "conflicts": [
            {"id": "c_001", "status": "unresolved", "weighing_analysis": "the 1862 baptism wins"}
        ]
    }
    calls = [_skill_call("conflict-resolution")]
    assert not any("conflict-resolution" in v for v in find_effects_without_invocation(calls, research, {}))


def test_empty_analysis_fields_do_not_fire():
    """Null/empty is the schema's own default for these optional fields — a
    writer that spells them out as empty has still produced no analysis."""
    research = {
        "conflicts": [
            {
                "id": "c_001",
                "status": "unresolved",
                "independence_analysis": None,
                "weighing_analysis": "",
                "preferred_assertion_id": None,
                "resolution_rationale": None,
            }
        ]
    }
    assert find_effects_without_invocation([], research, {}) == []


def test_a_failed_skill_call_does_not_count_as_invoked():
    calls = [_skill_call("proof-conclusion", is_error=True)]
    research = {"proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "probable"}]}
    violations = find_effects_without_invocation(calls, research, {})
    assert any("proof-conclusion" in v for v in violations)


def test_guardrail_skills_tuple_is_exactly_the_four():
    assert set(GUARDRAIL_SKILLS) == {
        "research-exhaustiveness",
        "proof-conclusion",
        "person-evidence",
        "conflict-resolution",
    }


# --- find_missing_mentor_verdicts --------------------------------------------


def test_flags_a_resolved_questions_proof_summary_with_no_proof_critique_verdict():
    research = {
        "questions": [{"id": "q_001", "status": "resolved"}],
        "proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "proved"}],
        "evaluations": [],
    }
    violations = find_missing_mentor_verdicts(research)
    assert len(violations) == 1
    assert "ps_001" in violations[0]


def test_does_not_flag_when_a_matching_proof_critique_verdict_exists():
    research = {
        "questions": [{"id": "q_001", "status": "resolved"}],
        "proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "proved"}],
        "evaluations": [
            {"id": "ev_001", "focus": "proof-critique", "target_id": "ps_001", "target_type": "proof_summary"}
        ],
    }
    assert find_missing_mentor_verdicts(research) == []


def test_does_not_flag_an_unrelated_evaluation_focus():
    """A pre-exhaustiveness or on-demand verdict does not satisfy the
    mandatory proof-critique gate."""
    research = {
        "questions": [{"id": "q_001", "status": "resolved"}],
        "proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "proved"}],
        "evaluations": [{"id": "ev_001", "focus": "on-demand", "target_id": "ps_001"}],
    }
    violations = find_missing_mentor_verdicts(research)
    assert len(violations) == 1


def test_does_not_flag_a_proof_summary_on_an_unresolved_question():
    research = {
        "questions": [{"id": "q_001", "status": "in_progress"}],
        "proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": "probable"}],
        "evaluations": [],
    }
    assert find_missing_mentor_verdicts(research) == []


def test_empty_research_has_no_violations():
    assert find_missing_mentor_verdicts({}) == []
    assert find_missing_mentor_verdicts(None) == []


# --- find_person_evidence_missing_same_person --------------------------------


def _same_person_call(primary_id1=None, primary_id2=None, is_error=False):
    args = {"gedcomx1": {}, "gedcomx2": {}}
    if primary_id1 is not None:
        args["primaryId1"] = primary_id1
    if primary_id2 is not None:
        args["primaryId2"] = primary_id2
    entry = {"tool": "mcp__genealogy__same_person", "args": args}
    if is_error:
        entry["is_error"] = True
    return entry


def test_flags_a_new_person_linked_with_zero_same_person_calls():
    """The bagley-father-1884 case: person-evidence invoked, but not for
    this link, and same_person never called for the new person at all."""
    tree = {"persons": [{"id": "I1", "names": [{"given": "David"}]}]}
    research = {"person_evidence": [{"id": "pe_001", "person_id": "I1"}]}
    calls = [_skill_call("person-evidence")]  # invoked, but irrelevant here
    violations = find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": []})
    assert len(violations) == 1
    assert "I1" in violations[0]


def test_does_not_flag_when_same_person_was_called_as_primaryId1():
    tree = {"persons": [{"id": "I1", "names": [{"given": "David"}]}]}
    research = {"person_evidence": [{"id": "pe_001", "person_id": "I1"}]}
    calls = [_same_person_call(primary_id1="I1", primary_id2="p_260268760900")]
    assert find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": []}) == []


def test_does_not_flag_when_same_person_was_called_as_primaryId2():
    tree = {"persons": [{"id": "I1", "names": [{"given": "David"}]}]}
    research = {"person_evidence": [{"id": "pe_001", "person_id": "I1"}]}
    calls = [_same_person_call(primary_id1="p_260268760900", primary_id2="I1")]
    assert find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": []}) == []


def test_a_same_person_call_for_a_different_person_does_not_clear_the_flag():
    """The crude 'was same_person called at all' version would wrongly clear
    this — this is exactly the precision gap that version was rejected for."""
    tree = {
        "persons": [
            {"id": "I1", "names": [{"given": "David"}]},
            {"id": "I2", "names": [{"given": "Someone Else"}]},
        ]
    }
    research = {
        "person_evidence": [
            {"id": "pe_001", "person_id": "I1"},
            {"id": "pe_002", "person_id": "I2"},
        ]
    }
    # same_person is called, but only for I2 -- I1 is still unscored.
    calls = [_same_person_call(primary_id1="p_999", primary_id2="I2")]
    violations = find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": []})
    assert len(violations) == 1
    assert "I1" in violations[0]


# --- find_protected_writes_by_unnamed_delegate -------------------------------


def _owned_write(skill, agent_id=_UNSET, agent_type=_UNSET, is_error=False):
    """A minimal tool_calls entry `owning_skills` attributes to `skill`."""
    if skill == "person-evidence":
        return _mcp_call(
            "materialize_facts",
            {"recordId": "rec_1", "recordRole": "child"},
            is_error=is_error,
            agent_id=agent_id,
            agent_type=agent_type,
        )
    if skill == "proof-conclusion":
        return _mcp_call(
            "research_append",
            {"section": "proof_summaries", "op": "append", "entry": {"question_id": "q_001", "tier": "probable"}},
            is_error=is_error,
            agent_id=agent_id,
            agent_type=agent_type,
        )
    if skill == "research-exhaustiveness":
        return _mcp_call(
            "research_append",
            {
                "section": "questions",
                "op": "update",
                "entryId": "q_001",
                "fields": {"exhaustive_declaration": {"declared": True}},
            },
            is_error=is_error,
            agent_id=agent_id,
            agent_type=agent_type,
        )
    if skill == "conflict-resolution":
        return _mcp_call(
            "research_append",
            {"section": "conflicts", "op": "append", "entry": {"id": "c_001"}},
            is_error=is_error,
            agent_id=agent_id,
            agent_type=agent_type,
        )
    raise ValueError(skill)


def _extraction_call(agent_id=_UNSET, agent_type=_UNSET, is_error=False):
    return _mcp_call(
        "extraction_append",
        {"section": "sources", "op": "append", "entry": {"citation": "test"}},
        is_error=is_error,
        agent_id=agent_id,
        agent_type=agent_type,
    )


def test_main_thread_write_not_flagged_no_agent_id_key():
    """The historical tool_calls shape -- no agent_id key at all."""
    calls = [_owned_write("person-evidence")]
    assert find_protected_writes_by_unnamed_delegate(calls) == []


def test_main_thread_write_not_flagged_agent_id_present_as_none():
    """Step 0's actual output shape for a main-thread call going forward."""
    calls = [_owned_write("person-evidence", agent_id=None, agent_type=None)]
    assert find_protected_writes_by_unnamed_delegate(calls) == []


def test_dedicated_agent_write_not_flagged():
    for name in DEDICATED_AGENT_NAMES:
        calls = [_owned_write("person-evidence", agent_id="a1", agent_type=name)]
        assert find_protected_writes_by_unnamed_delegate(calls) == []


def test_unnamed_delegate_write_flagged():
    """The ogletree-children/juan-rodriguez-son shape: a general-purpose
    subagent makes a guardrail-owned write directly."""
    calls = [_owned_write("person-evidence", agent_id="a1", agent_type="general-purpose")]
    violations = find_protected_writes_by_unnamed_delegate(calls)
    assert len(violations) == 1
    assert "person-evidence" in violations[0]
    assert "general-purpose" in violations[0]


def test_extraction_append_by_record_extractor_not_flagged():
    calls = [_extraction_call(agent_id="a1", agent_type="record-extractor")]
    assert find_protected_writes_by_unnamed_delegate(calls) == []


def test_extraction_append_by_main_thread_not_flagged():
    calls = [_extraction_call(agent_id=None, agent_type=None)]
    assert find_protected_writes_by_unnamed_delegate(calls) == []


def test_extraction_append_by_unnamed_delegate_flagged():
    calls = [_extraction_call(agent_id="a1", agent_type="general-purpose")]
    violations = find_protected_writes_by_unnamed_delegate(calls)
    assert len(violations) == 1
    assert "record-extractor" in violations[0]


def test_extraction_append_by_unnamed_delegate_still_flagged_when_errored():
    """The is_error skip that used to sit before this branch split (issue #1569)
    covered the extraction_append path too -- pin it separately from the
    owning_skills-path regression test above, since a future fix scoped to only
    one branch would otherwise pass every existing test."""
    calls = [_extraction_call(agent_id="a1", agent_type="general-purpose", is_error=True)]
    violations = find_protected_writes_by_unnamed_delegate(calls)
    assert len(violations) == 1
    assert "record-extractor" in violations[0]


def test_extraction_append_by_wrong_dedicated_agent_still_flagged():
    """Only record-extractor is legitimate for this specific tool -- being
    IN DEDICATED_AGENT_NAMES is not sufficient the way it is for the four
    GUARDRAIL_SKILLS writes."""
    calls = [_extraction_call(agent_id="a1", agent_type="gps-mentor")]
    violations = find_protected_writes_by_unnamed_delegate(calls)
    assert len(violations) == 1


def test_gps_mentor_evaluations_write_not_flagged():
    """gps-mentor holds research_append but only ever writes evaluations[] --
    a section owning_skills never attributes to any guardrail skill, so this
    is exempt structurally before caller identity is even considered, even
    from an unnamed delegate."""
    calls = [
        _mcp_call(
            "research_append",
            {"section": "evaluations", "op": "append", "entry": {"focus": "proof-critique"}},
            agent_id="a1",
            agent_type="general-purpose",
        )
    ]
    assert find_protected_writes_by_unnamed_delegate(calls) == []


def test_is_error_entries_still_counted():
    """Issue #1569: the lane check is about who called, not whether the call
    succeeded — an errored write from an unnamed delegate is still a violation."""
    calls = [_owned_write("person-evidence", agent_id="a1", agent_type="general-purpose", is_error=True)]
    violations = find_protected_writes_by_unnamed_delegate(calls)
    assert len(violations) == 1
    assert "person-evidence" in violations[0]


def test_no_owned_writes_returns_empty():
    assert find_protected_writes_by_unnamed_delegate([]) == []
    assert find_protected_writes_by_unnamed_delegate(
        [_mcp_call("record_search", {}, agent_id="a1", agent_type="general-purpose")]
    ) == []


def test_ogletree_children_hand_backfilled_regression():
    """Corpus-pinned regression: eval/runlogs/e2e/ogletree-children/
    run-2026-07-21_13-24-05.json is a committed, judge-`pass` run containing
    a real instance of this bypass. Its tool_calls carry no agent_id/
    agent_type yet (Step 0 postdates it), so this hand-backfills the three
    real subagent spans from the run's own `subagents[]` capture -- verified
    by matching each subagent's turn-by-turn tool sequence against the
    corresponding tool_calls slice in order:
      - subagents[11] (general-purpose, "Research exhaustiveness evaluation
        for q_001") -> tool_calls[215:227]. Its exhaustive_declaration write
        at 227 is declared=false, so owning_skills attributes it to nobody
        -- not part of the expected violation count.
      - subagents[12] (record-extractor, "Extract Louise C Barrett death
        cert") -> tool_calls[258:265]. Legitimate control case.
      - subagents[13] (general-purpose, "Link Louise Barrett death cert
        assertions to tree") -> tool_calls[267:288]. Three of its writes are
        real violations: a person-id-less materialize_facts (mints a new
        person -> person-evidence), a tree_edit adding ParentChild x2 +
        Couple (-> proof-conclusion, not person-evidence, despite sharing
        the subagent span), and a person_evidence-section research_append
        batch (-> person-evidence). Three OTHER materialize_facts calls in
        the same span attach facts to already-known personIds and are
        correctly not owned by anything.
    """
    repo_root = Path(__file__).resolve().parents[4]
    runlog = (
        repo_root
        / "eval"
        / "runlogs"
        / "e2e"
        / "ogletree-children"
        / "run-2026-07-21_13-24-05.json"
    )
    data = json.loads(runlog.read_text(encoding="utf-8"))
    tool_calls = [dict(entry) for entry in data["tool_calls"]]  # shallow-copy entries before mutating

    def backfill(lo, hi, agent_id, agent_type):
        for i in range(lo, hi):
            tool_calls[i]["agent_id"] = agent_id
            tool_calls[i]["agent_type"] = agent_type

    backfill(215, 227, "sub-11", "general-purpose")
    backfill(258, 265, "sub-12", "record-extractor")
    backfill(267, 288, "sub-13", "general-purpose")

    violations = find_protected_writes_by_unnamed_delegate(tool_calls)
    assert len(violations) == 3
    assert sum("materialize_facts" in v and "person-evidence" in v for v in violations) == 1
    assert sum("tree_edit" in v and "proof-conclusion" in v for v in violations) == 1
    assert sum("research_append" in v and "person-evidence" in v for v in violations) == 1


def test_an_errored_same_person_call_does_not_count_as_scoring():
    tree = {"persons": [{"id": "I1", "names": [{"given": "David"}]}]}
    research = {"person_evidence": [{"id": "pe_001", "person_id": "I1"}]}
    calls = [_same_person_call(primary_id1="I1", primary_id2="p_999", is_error=True)]
    violations = find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": []})
    assert len(violations) == 1


def test_does_not_flag_a_person_already_in_the_starting_tree():
    """Only BRAND-NEW persons are in scope -- an already-known person
    (e.g. the research subject) confirming their own identity again is not
    what this check is for; find_effects_without_invocation's coarser
    unlinked-person check covers the general case."""
    seed = {"id": "MJDL-Q8B", "names": [{"given": "William"}]}
    tree = {"persons": [seed]}
    research = {"person_evidence": [{"id": "pe_001", "person_id": "MJDL-Q8B"}]}
    calls = []  # no same_person call anywhere
    assert find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": [seed]}) == []


def test_does_not_flag_a_new_person_with_no_person_evidence_link_at_all():
    """No link yet -> nothing for this check to flag (find_effects_without_
    invocation's unlinked-person check is the one that covers this case)."""
    tree = {"persons": [{"id": "I1", "names": [{"given": "David"}]}]}
    research = {"person_evidence": []}
    assert find_person_evidence_missing_same_person([], research, tree, starting_tree={"persons": []}) == []


def test_multiple_new_persons_only_unscored_ones_flagged():
    tree = {
        "persons": [
            {"id": "I1", "names": [{"given": "David"}]},
            {"id": "I2", "names": [{"given": "Sarah"}]},
        ]
    }
    research = {
        "person_evidence": [
            {"id": "pe_001", "person_id": "I1"},
            {"id": "pe_002", "person_id": "I2"},
        ]
    }
    calls = [_same_person_call(primary_id1="p_1", primary_id2="I1")]  # only I1 scored
    violations = find_person_evidence_missing_same_person(calls, research, tree, starting_tree={"persons": []})
    assert len(violations) == 1
    assert "I2" in violations[0]


def test_no_starting_tree_treats_every_current_person_as_new():
    tree = {"persons": [{"id": "I1", "names": [{"given": "David"}]}]}
    research = {"person_evidence": [{"id": "pe_001", "person_id": "I1"}]}
    # Best-effort with no baseline: still flags an unscored link.
    violations = find_person_evidence_missing_same_person([], research, tree)
    assert len(violations) == 1


def test_empty_tree_and_research_have_no_violations():
    assert find_person_evidence_missing_same_person([], {}, {}) == []
    assert find_person_evidence_missing_same_person([], None, None) == []


# --- same_person_scored_ids --------------------------------------------------


def test_scored_ids_collects_both_primary_id_sides():
    calls = [_same_person_call(primary_id1="I1", primary_id2="p_999")]
    assert same_person_scored_ids(calls) == {"I1", "p_999"}


def test_scored_ids_ignores_errored_calls():
    calls = [_same_person_call(primary_id1="I1", primary_id2="p_999", is_error=True)]
    assert same_person_scored_ids(calls) == set()


def test_scored_ids_ignores_non_same_person_tools():
    calls = [_mcp_call("research_append", {"section": "person_evidence", "entry": {"person_id": "I1"}})]
    assert same_person_scored_ids(calls) == set()


# --- unguarded_new_person_evidence_links (issue #963 pre-write check) ---------


def _pe_append(person_id):
    return {"section": "person_evidence", "op": "append", "entry": {"person_id": person_id}}


def test_pending_pe_link_for_new_unscored_person_is_flagged():
    args = _pe_append("I1")
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", args, scored_ids=set(), starting_ids=set()
    )
    assert out == ["I1"]


def test_pending_pe_link_allowed_when_already_scored():
    args = _pe_append("I1")
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", args, scored_ids={"I1"}, starting_ids=set()
    )
    assert out == []


def test_pending_pe_link_to_a_seed_person_is_never_flagged():
    """Linking an assertion to a pre-existing (seed) tree person is not a new
    identity, so it needs no same_person scoring."""
    args = _pe_append("L6L3-BB8")
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", args, scored_ids=set(), starting_ids={"L6L3-BB8"}
    )
    assert out == []


def test_pending_batch_flags_only_the_new_unscored_persons():
    args = {
        "ops": [
            _pe_append("I1"),          # new, unscored -> flag
            _pe_append("I2"),          # new, scored   -> allow
            _pe_append("L6L3-BB8"),   # seed          -> allow
        ]
    }
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append",
        args,
        scored_ids={"I2"},
        starting_ids={"L6L3-BB8"},
    )
    assert out == ["I1"]


def test_non_person_evidence_write_is_not_flagged():
    args = {"section": "proof_summaries", "op": "append", "entry": {"id": "ps_001"}}
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", args, scored_ids=set(), starting_ids=set()
    )
    assert out == []


def test_non_research_append_tool_is_not_flagged():
    args = _pe_append("I1")
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__materialize_facts", args, scored_ids=set(), starting_ids=set()
    )
    assert out == []


def test_pending_pe_link_deduped_when_same_new_person_appears_twice():
    args = {"ops": [_pe_append("I1"), _pe_append("I1")]}
    out = unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", args, scored_ids=set(), starting_ids=set()
    )
    assert out == ["I1"]


# --- unguarded_new_person_evidence_links: defensive/empty shapes -------------


def test_unguarded_links_args_none_does_not_panic():
    assert unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", None, scored_ids=set(), starting_ids=set()
    ) == []


def test_unguarded_links_args_empty_dict_returns_empty():
    assert unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", {}, scored_ids=set(), starting_ids=set()
    ) == []


def test_unguarded_links_pe_op_missing_person_id_is_skipped():
    args = {"section": "person_evidence", "op": "append", "entry": {}}
    assert unguarded_new_person_evidence_links(
        "mcp__genealogy__research_append", args, scored_ids=set(), starting_ids=set()
    ) == []


# --- find_citation_nulling_in_conclusions (issue #1133, shadow) --------------
# The citation-STRING half of provenance nulling: a source backing a WRITTEN
# conclusion whose ESM citation string is empty. Gated on a proof_summaries
# entry so it stays inert on honest partial runs (tree citations are populated
# at upload time). The source-REF half is already unrepresentable at the engine
# write seam, so it is deliberately NOT covered here.


def _research_with_conclusion(*, citation):
    """A minimal research.json: one proof_summary citing one assertion whose
    source carries `citation`. `citation` is the value under test."""
    return {
        "proof_summaries": [
            {"id": "ps_001", "question_id": "q_001", "supporting_assertion_ids": ["a_001"]}
        ],
        "assertions": [{"id": "a_001", "source_id": "src_001", "fact_type": "birth"}],
        "sources": [{"id": "src_001", "citation": citation}],
    }


def test_citation_nulling_fires_on_a_concluded_null_citation():
    out = find_citation_nulling_in_conclusions(_research_with_conclusion(citation=None))
    assert len(out) == 1
    v = out[0]
    assert v["kind"] == CITATION_NULLING_KIND
    assert v["required_skill"] == "citation"
    assert v["question_id"] == "q_001"
    assert "src_001" in v["detail"]
    # int index + string tool so guardrail_shadow_report's :<4 / :<30 formatters
    # never hit a None format spec.
    assert isinstance(v["index"], int) and isinstance(v["tool"], str)


def test_citation_nulling_fires_on_empty_and_whitespace_citation():
    assert len(find_citation_nulling_in_conclusions(_research_with_conclusion(citation=""))) == 1
    assert len(find_citation_nulling_in_conclusions(_research_with_conclusion(citation="   "))) == 1


def test_citation_nulling_silent_when_citation_present():
    good = _research_with_conclusion(citation="1850 U.S. Census, Schuylkill Co., Pa., dwelling 84.")
    assert find_citation_nulling_in_conclusions(good) == []


def test_citation_nulling_inert_without_a_proof_summary():
    """The gate: an assertion+source with an empty citation but NO written
    conclusion is a legitimate partial run, not a violation."""
    research = {
        "proof_summaries": [],
        "assertions": [{"id": "a_001", "source_id": "src_001"}],
        "sources": [{"id": "src_001", "citation": None}],
    }
    assert find_citation_nulling_in_conclusions(research) == []


def test_citation_nulling_only_flags_sources_backing_the_conclusion():
    """A citation-less source NOT referenced by the conclusion's
    supporting_assertion_ids is out of scope — only concluded evidence is held
    to a citation."""
    research = {
        "proof_summaries": [
            {"id": "ps_001", "question_id": "q_001", "supporting_assertion_ids": ["a_001"]}
        ],
        "assertions": [
            {"id": "a_001", "source_id": "src_001"},  # cited by the conclusion
            {"id": "a_099", "source_id": "src_099"},  # NOT cited by the conclusion
        ],
        "sources": [
            {"id": "src_001", "citation": "A full citation."},
            {"id": "src_099", "citation": None},  # citation-less but not concluded
        ],
    }
    assert find_citation_nulling_in_conclusions(research) == []


def test_citation_nulling_dedups_one_source_cited_by_many_assertions():
    research = {
        "proof_summaries": [
            {
                "id": "ps_001",
                "question_id": "q_001",
                "supporting_assertion_ids": ["a_001", "a_002"],
            }
        ],
        "assertions": [
            {"id": "a_001", "source_id": "src_001"},
            {"id": "a_002", "source_id": "src_001"},  # same source
        ],
        "sources": [{"id": "src_001", "citation": ""}],
    }
    out = find_citation_nulling_in_conclusions(research)
    assert len(out) == 1  # one (conclusion, source) pair, not two


def test_citation_nulling_tolerates_dangling_and_sourceless_refs():
    """Dangling assertion/source refs and assertions with no source_id are
    schema concerns, not this detector's — it skips them without erroring."""
    research = {
        "proof_summaries": [
            {
                "id": "ps_001",
                "question_id": "q_001",
                "supporting_assertion_ids": ["a_missing", "a_nosrc", "a_dangling"],
            }
        ],
        "assertions": [
            {"id": "a_nosrc"},  # no source_id
            {"id": "a_dangling", "source_id": "src_missing"},  # source not in sources[]
        ],
        "sources": [],
    }
    assert find_citation_nulling_in_conclusions(research) == []


def test_citation_nulling_defensive_on_none_and_empty():
    assert find_citation_nulling_in_conclusions(None) == []
    assert find_citation_nulling_in_conclusions({}) == []


# --- find_unpersisted_conflict_resolutions (issue #1317, shadow) -------------
# The conflict-side sibling: a WRITTEN conclusion relies on a resolved conflict
# (per its question's exhaustive_declaration.stop_criteria.conflict_resolution)
# that no conflicts[] entry backs, so the resolution lives only in prose and the
# viewer's Conflicts section stays blank. Gated on a proof_summaries entry.


def _research_with_conflict_claim(*, conflict_resolution, conflicts=None, resolved_conflict_ids=None):
    """A minimal research.json: one proof_summary on q_001 whose question carries
    a `conflict_resolution` stop-criterion. `conflicts` / `resolved_conflict_ids`
    default to empty (the evidenced failure shape)."""
    return {
        "proof_summaries": [
            {
                "id": "ps_001",
                "question_id": "q_001",
                "resolved_conflict_ids": resolved_conflict_ids or [],
            }
        ],
        "questions": [
            {
                "id": "q_001",
                "exhaustive_declaration": {
                    "stop_criteria": {"conflict_resolution": conflict_resolution}
                },
            }
        ],
        "conflicts": conflicts or [],
    }


def test_conflict_unpersisted_fires_on_the_evidenced_shape():
    """The john-applegarth-family case: a resolution asserted in prose, empty
    conflicts[] and empty resolved_conflict_ids."""
    out = find_unpersisted_conflict_resolutions(
        _research_with_conflict_claim(
            conflict_resolution="Ella Chase marriage conflict resolved -- a different Henry."
        )
    )
    assert len(out) == 1
    v = out[0]
    assert v["kind"] == CONFLICT_UNPERSISTED_KIND
    assert v["required_skill"] == "conflict-resolution"
    assert v["question_id"] == "q_001"
    assert "ps_001" in v["detail"]
    # int index + string tool so the shadow report's formatters never hit None.
    assert isinstance(v["index"], int) and isinstance(v["tool"], str)


def test_conflict_unpersisted_silent_when_a_resolved_conflict_is_cited():
    """Backed: resolved_conflict_ids cites a conflicts[] entry with status resolved."""
    research = _research_with_conflict_claim(
        conflict_resolution="Birthplace conflict resolved per preponderance.",
        conflicts=[{"id": "c_001", "status": "resolved"}],
        resolved_conflict_ids=["c_001"],
    )
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_fires_when_cited_conflict_is_unresolved():
    """A dangling/unresolved citation is not real backing — the cited c_ is not
    status:resolved (or does not exist), so the resolution is still unpersisted."""
    research = _research_with_conflict_claim(
        conflict_resolution="Conflict resolved after weighing the records.",
        conflicts=[{"id": "c_001", "status": "open"}],  # cited but NOT resolved
        resolved_conflict_ids=["c_001"],
    )
    assert len(find_unpersisted_conflict_resolutions(research)) == 1


def test_conflict_unpersisted_silent_on_no_conflict_phrasings():
    """An honest 'no conflicts' stop-criterion is not an unpersisted resolution."""
    for phrase in (
        "No conflicts identified.",
        "No material conflicts.",
        "No remaining conflicts.",
        "No discrepancies found.",
        "None",
        "n/a",
        "",
        "   ",
    ):
        assert (
            find_unpersisted_conflict_resolutions(
                _research_with_conflict_claim(conflict_resolution=phrase)
            )
            == []
        ), f"should stay silent on {phrase!r}"


def test_conflict_unpersisted_inert_without_a_proof_summary():
    """The gate: a conflict_resolution note with no written conclusion is a
    legitimate partial run, not a violation."""
    research = {
        "proof_summaries": [],
        "questions": [
            {
                "id": "q_001",
                "exhaustive_declaration": {
                    "stop_criteria": {"conflict_resolution": "Conflict resolved."}
                },
            }
        ],
        "conflicts": [],
    }
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_silent_without_a_reliance_signal():
    """A conclusion with no conflict_resolution stop-criterion (and no linked
    question) owes no conflict entry."""
    research = {
        "proof_summaries": [
            {"id": "ps_001", "question_id": "q_001", "resolved_conflict_ids": []}
        ],
        "questions": [{"id": "q_001", "exhaustive_declaration": {"stop_criteria": {}}}],
        "conflicts": [],
    }
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_dedups_per_conclusion():
    research = _research_with_conflict_claim(
        conflict_resolution="Conflict resolved."
    )
    # the SAME (conclusion, question) listed twice must still yield one violation
    # — exercises the `seen` guard, which a single-proof_summary fixture never hits
    research["proof_summaries"].append(dict(research["proof_summaries"][0]))
    assert len(find_unpersisted_conflict_resolutions(research)) == 1


def test_conflict_unpersisted_silent_when_resolved_conflict_blocks_the_question():
    """Senior-review fix 1: a resolved conflicts[] entry can back a question via
    its own blocks_question_ids WITHOUT being cited on resolved_conflict_ids. That
    is a correctly-persisted conflict (viewer's Conflicts section populated) and
    must not fire — reading only resolved_conflict_ids fired on it and emitted a
    factually false 'no resolved entry backs it'."""
    research = _research_with_conflict_claim(
        conflict_resolution="Ella Chase marriage conflict resolved.",
        conflicts=[{"id": "c_001", "status": "resolved", "blocks_question_ids": ["q_001"]}],
        resolved_conflict_ids=[],  # NOT cited on the proof_summary
    )
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_silent_when_the_stop_criterion_names_a_resolved_conflict():
    """Senior-review round 2: blocks_question_ids is schema-required but legitimately
    empty, so a resolved conflict the conclusion NAMES in its prose backs it even
    when nothing links it structurally. The mary-dwyer-father corpus shape: a
    resolved c_001, blocks_question_ids [], resolved_conflict_ids [], but the
    stop-criterion says '... resolved (c_001, ...)'. The Conflicts section populates,
    so it must not fire."""
    research = _research_with_conflict_claim(
        conflict_resolution="YES. Birth year conflict resolved (c_001, preferred a_019).",
        conflicts=[{"id": "c_001", "status": "resolved", "blocks_question_ids": []}],
        resolved_conflict_ids=[],
    )
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_silent_when_a_resolved_entry_exists_and_prose_names_none():
    """Senior-review round 2: when the stop-criterion claims a resolution but names
    no c_ id, the mere existence of a resolved conflicts[] entry backs it — the
    conflict was written, the viewer is populated. The jimmie-jewel-neal shape."""
    research = _research_with_conflict_claim(
        conflict_resolution="Martha birth year conflict resolved by preponderance.",
        conflicts=[{"id": "c_001", "status": "resolved", "blocks_question_ids": []}],
        resolved_conflict_ids=[],
    )
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_still_fires_when_named_conflict_is_unresolved():
    """The naming backing is scoped to RESOLVED entries: a conclusion that claims a
    resolution and names a c_ id that is NOT status:resolved is still unlinked to
    any resolved entry, so it fires (nothing resolved was persisted for it)."""
    research = _research_with_conflict_claim(
        conflict_resolution="Birth conflict resolved (c_001).",
        conflicts=[{"id": "c_001", "status": "open", "blocks_question_ids": []}],
        resolved_conflict_ids=[],
    )
    assert len(find_unpersisted_conflict_resolutions(research)) == 1


def test_conflict_unpersisted_idless_question_does_not_match_a_summary_missing_qid():
    """questions_by_id drops a question with no id, so a proof_summary whose
    question_id is None cannot bind to it (both would otherwise key on None).
    Reverting the q.get('id') truthiness filter re-introduces that false match."""
    research = {
        "proof_summaries": [{"id": "ps_001", "resolved_conflict_ids": []}],  # no question_id
        "questions": [  # no id
            {"exhaustive_declaration": {"stop_criteria": {"conflict_resolution": "Conflict resolved."}}}
        ],
        "conflicts": [],
    }
    assert find_unpersisted_conflict_resolutions(research) == []


def test_conflict_unpersisted_silent_on_text_that_negates_a_resolution():
    """Senior-review fix 2: conflict_resolution is a REQUIRED field, so 'absence of
    negative words' defaulted to fire. Text that explicitly says the conflict is
    unresolved / not met / partial is the CORRECT persistence for an unresolved
    conflict and must stay silent."""
    for phrase in (
        "UNRESOLVED. Conflict c_001 cannot be resolved with the available records.",
        "NOT MET.",
        "PARTIAL.",
        "Partially met.",
        "Not met -- one identity thread remains open.",
        "One unresolved conflict exists (c_001).",
    ):
        research = _research_with_conflict_claim(
            conflict_resolution=phrase,
            conflicts=[{"id": "c_001", "status": "unresolved"}],
            resolved_conflict_ids=[],
        )
        assert find_unpersisted_conflict_resolutions(research) == [], (
            f"should stay silent on negating text {phrase!r}"
        )


def test_conflict_unpersisted_silent_on_more_no_conflict_phrasings():
    """Senior-review fix 3: honest 'no conflict' phrasings the exact/substring
    lists miss are caught by requiring positive resolution language."""
    for phrase in (
        "N/A -- no evidence to conflict.",
        "No active conflicts on q_001.",
        "Yes -- no substantive conflicts identified.",
        "Yes -- no genuine conflicts identified.",
        "Yes.",
        "All records agree.",
    ):
        assert (
            find_unpersisted_conflict_resolutions(
                _research_with_conflict_claim(conflict_resolution=phrase)
            )
            == []
        ), f"should stay silent on {phrase!r}"


def test_conflict_unpersisted_defensive_on_none_and_empty():
    assert find_unpersisted_conflict_resolutions(None) == []
    assert find_unpersisted_conflict_resolutions({}) == []


# --- find_relationship_writes_without_warnings_check (issue #1193, shadow) ----
# A new ParentChild/Couple relationship written this run with no person_warnings
# call. Gated on the relationship being NEW (diffed against the starting tree),
# and keyed on the person_warnings TOOL (not the check-warnings skill), so it
# catches a direct-tool path and a skill that fails before reaching the tool.


def _tree_with_parentchild(child="I3", parent="I1"):
    return {"relationships": [{"id": "R1", "type": "ParentChild", "parent": parent, "child": child}]}


def _person_warnings_call(*, is_error=None):
    return {"tool": "mcp__genealogy__person_warnings", "args": {"personId": "I3"}, "is_error": is_error}


def test_warnings_unchecked_fires_on_new_relationship_with_no_call():
    """The evidenced #1193 shape: a parentage link written, guardrail never run."""
    out = find_relationship_writes_without_warnings_check(
        [{"tool": "mcp__genealogy__tree_edit", "is_error": None}],
        _tree_with_parentchild(),
        starting_tree={"relationships": []},
    )
    assert len(out) == 1
    v = out[0]
    assert v["kind"] == WARNINGS_UNCHECKED_KIND
    assert v["required_skill"] == "check-warnings"
    # int index + string tool so guardrail_shadow_report's formatters never hit a
    # None format spec.
    assert isinstance(v["index"], int) and isinstance(v["tool"], str)


def test_warnings_unchecked_silent_when_person_warnings_was_called():
    """Keyed on the tool: a successful person_warnings call means the guardrail
    was consulted, whatever skill (or none) reached it."""
    out = find_relationship_writes_without_warnings_check(
        [{"tool": "mcp__genealogy__tree_edit", "is_error": None}, _person_warnings_call()],
        _tree_with_parentchild(),
        starting_tree={"relationships": []},
    )
    assert out == []


def test_warnings_unchecked_still_fires_when_the_call_errored():
    """A failed person_warnings call left the tree unchecked, so it does not
    count as consulting the guardrail."""
    out = find_relationship_writes_without_warnings_check(
        [_person_warnings_call(is_error=True)],
        _tree_with_parentchild(),
        starting_tree={"relationships": []},
    )
    assert len(out) == 1


def test_warnings_unchecked_still_fires_on_a_no_project_person_warnings_call():
    """Issue #1695, and note the INVERTED polarity against the write detectors.

    Everywhere else `did_not_land` makes a detector SKIP a call. Here it must
    stop a call being CREDITED: a no-project person_warnings checked no tree, so
    crediting it would mark the guardrail consulted when it never ran — a MISSED
    violation, which is silent. That is why this test exists rather than being
    folded into the write-side one.
    """
    call = _person_warnings_call()
    # The MCP-envelope shape, i.e. what production actually emits.
    call["response_summary"] = _no_project_summary(escaped=True)
    out = find_relationship_writes_without_warnings_check(
        [call],
        _tree_with_parentchild(),
        starting_tree={"relationships": []},
    )
    assert len(out) == 1


def test_warnings_unchecked_matches_the_tool_under_any_server_spelling():
    """bare_tool_name strips the mcp__<server>__ prefix, so the on-computer /
    bridge spellings are recognized too."""
    for tool in (
        "mcp__Genealogy_Research__person_warnings",
        "mcp__remote-devices__Genealogy_Research__person_warnings",
    ):
        out = find_relationship_writes_without_warnings_check(
            [{"tool": tool, "is_error": None}],
            _tree_with_parentchild(),
            starting_tree={"relationships": []},
        )
        assert out == [], f"{tool} should count as consulting the guardrail"


def test_warnings_unchecked_gated_on_a_new_relationship():
    """A relationship present in the starting tree is not this run's product, so
    a run that wrote nothing new is not flagged for skipping the check."""
    seeded = _tree_with_parentchild()
    out = find_relationship_writes_without_warnings_check([], seeded, starting_tree=seeded)
    assert out == []


def test_warnings_unchecked_fires_on_a_new_couple_relationship():
    out = find_relationship_writes_without_warnings_check(
        [],
        {"relationships": [{"id": "R2", "type": "Couple", "person1": "I1", "person2": "I2"}]},
        starting_tree={"relationships": []},
    )
    assert len(out) == 1


def test_warnings_unchecked_ignores_non_parentchild_couple_relationships():
    """Only ParentChild/Couple writes are the parentage-assertion class #1193 is
    about; another relationship type is not gated on a warnings check."""
    out = find_relationship_writes_without_warnings_check(
        [],
        {"relationships": [{"id": "R3", "type": "Sibling", "person1": "I1", "person2": "I2"}]},
        starting_tree={"relationships": []},
    )
    assert out == []


def test_warnings_unchecked_no_relationship_no_finding():
    """No parent/child write at all → nothing a warnings check should have
    preceded, so silent even with no person_warnings call."""
    out = find_relationship_writes_without_warnings_check(
        [{"tool": "mcp__genealogy__record_search", "is_error": None}],
        {"relationships": []},
        starting_tree={"relationships": []},
    )
    assert out == []


def test_warnings_unchecked_defensive_on_none():
    assert find_relationship_writes_without_warnings_check(None, None) == []
    assert find_relationship_writes_without_warnings_check([], {}) == []
