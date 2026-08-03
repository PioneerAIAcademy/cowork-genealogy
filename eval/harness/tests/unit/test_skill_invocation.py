"""Unit tests for harness/skill_invocation.py.

docs/specs/guardrail-enforcement-spec.md §7/§8/§11 — pure matching logic
over the harness's `tool_calls` list shape. No I/O, no SDK types, except
the one corpus-pinned regression test that reads a committed runlog.
"""

import json
from pathlib import Path

import pytest

from harness.skill_invocation import (
    CONFLICT_ANALYSIS_FIELDS,
    DEDICATED_AGENT_NAMES,
    GUARDRAIL_SKILLS,
    find_effects_without_invocation,
    find_missing_mentor_verdicts,
    find_person_evidence_missing_same_person,
    find_protected_writes_by_unnamed_delegate,
    find_unguarded_protected_writes,
    owning_skills,
    recently_succeeded,
    skill_name_if_skill_call,
)

# Sentinel distinguishing "key absent entirely" (the historical tool_calls
# shape, and the shape a call still in-flight when a run aborts keeps
# forever) from "key present as None" (§12 Step 0's real shape for a
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


def test_is_error_entries_skipped():
    calls = [_owned_write("person-evidence", agent_id="a1", agent_type="general-purpose", is_error=True)]
    assert find_protected_writes_by_unnamed_delegate(calls) == []


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
