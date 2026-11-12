"""Unit tests for e2e.judge — prompt rendering and output validation.

The actual Anthropic API call is exercised in the e2e suite, not here.
These tests check the deterministic pre/post-processing: prompt
rendering and the fail-loud validation of structured judge output.
"""

from __future__ import annotations

import pytest

from e2e.judge import (
    JUDGE_OUTPUT_SCHEMA,
    JudgeOutputError,
    _render_prompt,
    _validate_judge_output,
    apply_avoid_guard,
    apply_component_derivation,
    derive_matched,
)


def _proof_quality(**overrides):
    base = {
        "score": 3,
        "exhaustiveness": "yes",
        "conflicts_addressed": "na",
        "corroboration": "independent",
        "tier_appropriate": "yes",
        "rationale": "Two independent census + vital records agree.",
    }
    base.update(overrides)
    return base


def _valid_output(**overrides):
    """A judge output that satisfies the contract; override fields per test."""
    base = {
        "per_finding": [
            {
                "finding_id": "f1",
                "matched": "true",
                "agent_evidence": "Robert Smith in persons[]",
                "notes": "name + birth match",
            }
        ],
        "recall_required": 1.0,
        "recall_total": 1.0,
        "verdict": "pass",
        "rationale": "All required findings recovered.",
        "proof_quality": _proof_quality(),
    }
    base.update(overrides)
    return base


def test_render_prompt_substitutes_placeholders():
    prompt = _render_prompt(
        research_question="Who were John Smith's parents?",
        expected_findings={"findings": [{"id": "f1"}]},
        final_tree={"persons": []},
        final_research={"proof_summaries": [{"id": "ps_001", "tier": "probable"}]},
    )
    assert "Who were John Smith's parents?" in prompt
    assert '"id": "f1"' in prompt
    assert '"persons": []' in prompt
    assert '"ps_001"' in prompt  # proof summaries injected
    # Make sure none of the template placeholders leaked through
    assert "{{RESEARCH_QUESTION}}" not in prompt
    assert "{{EXPECTED_FINDINGS}}" not in prompt
    assert "{{FINAL_TREE}}" not in prompt
    assert "{{PROOF_SUMMARIES}}" not in prompt


def test_render_prompt_with_none_inputs():
    """If the agent crashed, final_tree and final_research may be None."""
    prompt = _render_prompt(
        research_question="Q?",
        expected_findings={"findings": []},
        final_tree=None,
        final_research=None,
    )
    # None tree becomes {} and None research becomes [] in the rendered JSON
    assert "{}" in prompt
    assert "[]" in prompt


def test_validate_passes_well_formed_output():
    out = _valid_output()
    assert _validate_judge_output(out) is out


def test_validate_rejects_non_dict():
    with pytest.raises(JudgeOutputError):
        _validate_judge_output(["not", "a", "dict"])


def test_validate_rejects_missing_required_key():
    out = _valid_output()
    del out["verdict"]
    with pytest.raises(JudgeOutputError):
        _validate_judge_output(out)


def test_validate_rejects_bad_verdict_value():
    with pytest.raises(JudgeOutputError):
        _validate_judge_output(_valid_output(verdict="mostly"))


def test_validate_rejects_non_list_per_finding():
    with pytest.raises(JudgeOutputError):
        _validate_judge_output(_valid_output(per_finding={"finding_id": "f1"}))


def test_validate_rejects_missing_proof_quality():
    out = _valid_output()
    del out["proof_quality"]
    with pytest.raises(JudgeOutputError):
        _validate_judge_output(out)


def test_validate_rejects_bad_proof_quality_score():
    with pytest.raises(JudgeOutputError):
        _validate_judge_output(_valid_output(proof_quality=_proof_quality(score=5)))


def test_validate_accepts_null_proof_quality_score():
    """No proof summary -> score is null, sub-fields na. Still valid."""
    out = _valid_output(
        proof_quality=_proof_quality(
            score=None,
            exhaustiveness="na",
            conflicts_addressed="na",
            corroboration="na",
            tier_appropriate="na",
        )
    )
    assert _validate_judge_output(out) is out


def test_validate_proof_quality_independent_of_verdict():
    """A failing recall verdict can still carry a graded proof_quality."""
    out = _valid_output(
        verdict="fail",
        recall_required=0.0,
        proof_quality=_proof_quality(score=2, corroboration="single_source"),
    )
    assert _validate_judge_output(out) is out


def test_schema_has_no_enum_on_union_type():
    """Regression: the Messages API structured-output validator rejects an
    `enum` whose declared `type` is a union (e.g. ['integer','null']) with
    "Enum value X does not match declared type ...". A union-typed property
    must rely on post-parse validation instead of a schema enum. This walk
    asserts no property in JUDGE_OUTPUT_SCHEMA pairs an enum with a list type.
    """

    def walk(node, path="$"):
        if not isinstance(node, dict):
            return
        if "enum" in node and isinstance(node.get("type"), list):
            raise AssertionError(
                f"{path}: enum paired with union type {node['type']!r} — "
                "the structured-output API will 400 on this"
            )
        for key in ("properties", "items"):
            child = node.get(key)
            if isinstance(child, dict):
                if key == "properties":
                    for name, prop in child.items():
                        walk(prop, f"{path}.{name}")
                else:
                    walk(child, f"{path}[]")

    walk(JUDGE_OUTPUT_SCHEMA)


# --- the avoid-guard (deterministic §3.4.1 backstop) -------------------------
#
# Three branches (e2e/avoid_guard.py): a wrong-person finding (it lists the
# rejected candidate's records) fails on provenance or on a new edge to the named
# candidate; a fact finding fails on the avoided value anywhere; a
# wrong-relationship finding fails on a new non-Step edge in the forbidden role.
# Every branch subtracts what the starting tree already carried.

_RECORD = "ark:/61903/1:1:AAAA-111"


def _wrong_person(records=(_RECORD,), required=True):
    return {
        "findings": [
            {
                "id": "f1",
                "type": "relationship",
                "required": required,
                "polarity": "avoid",
                "description": "The agent should NOT conclude Robert Smith of the 1850 census is John's father.",
                "details": {
                    "subject_person": "John Smith (S1)",
                    "relation": "father",
                    "wrong_candidate": {"name": "Robert Smith", "note": "a different man", "records": list(records)},
                },
            }
        ]
    }


def _wrong_relationship(**candidate):
    return {
        "findings": [
            {
                "id": "f1",
                "type": "relationship",
                "required": True,
                "polarity": "avoid",
                "description": "The agent should NOT conclude Agnes Wardrop was John's mother.",
                "details": {
                    "subject_person": "John Smith (S1)",
                    "relation": "mother",
                    "wrong_candidate": {"name": "Agnes Wardrop", "note": "his stepmother", **candidate},
                },
            }
        ]
    }


def _fact_avoid():
    return {
        "findings": [
            {
                "id": "f1",
                "type": "fact",
                "required": True,
                "polarity": "avoid",
                "description": "The agent should NOT conclude John died 15 December 1854.",
                "details": {
                    "subject_person": "John Smith (S1)",
                    "fact_type": "Death",
                    "wrong_candidate": {"date": "15 December 1854", "note": "another man's burial"},
                },
            }
        ]
    }


def _person(pid, given, surname, *, name_sources=(), facts=()):
    name = {"id": f"N{pid}", "given": given, "surname": surname}
    if name_sources:
        name["sources"] = [{"ref": ref} for ref in name_sources]
    return {"id": pid, "living": False, "names": [name], "facts": list(facts)}


def _tree(*persons, relationships=(), sources=()):
    return {"persons": list(persons), "relationships": list(relationships), "sources": list(sources)}


def _subject():
    return _person("S1", "John", "Smith")


def _guard(output, findings, tree, *, research=None, starting_tree=None, starting_research=None):
    return apply_avoid_guard(
        output,
        expected_findings=findings,
        final_tree=tree,
        final_research=research,
        starting_tree=starting_tree if starting_tree is not None else _tree(_subject()),
        starting_research=starting_research,
        subject_person_ids={"S1"},
    )


def test_a_wrong_person_avoid_fails_when_a_tree_object_cites_one_of_the_candidates_records():
    # A minted candidate under a different spelling, linked to nobody: the name
    # matcher passed this; provenance does not.
    output = _valid_output()
    tree = _tree(
        _subject(),
        _person("I1", "Bob", "Smyth", name_sources=["S9"]),
        sources=[{"id": "S9", "title": "1850 census", "url": f"https://www.familysearch.org/{_RECORD}"}],
    )
    out = _guard(output, _wrong_person(), tree)
    assert out["per_finding"][0]["matched"] == "false"
    assert out["verdict"] == "fail"
    assert out["recall_required"] == 0.0
    [forced] = out["avoid_guard"]["forced_false"]
    assert forced["finding_id"] == "f1"
    assert forced["branch"] == "wrong-person"
    assert forced["person_ids"] == ["I1"]
    assert "[avoid-guard]" in out["per_finding"][0]["notes"]
    # Downgrade happens on a copy; the judge's own output is untouched.
    assert output["per_finding"][0]["matched"] == "true"
    assert output["verdict"] == "pass"


def test_a_wrong_person_avoid_fails_through_a_research_link_when_the_tree_cites_nothing():
    # The run minted the candidate with no source on the tree person, and linked
    # it in research.json (swarbrick-christening 07-22's shape).
    tree = _tree(_subject(), _person("I1", "Robert", "Smith"))
    research = {
        "assertions": [{"id": "a_001", "record_id": _RECORD, "source_id": "src_001"}],
        "sources": [{"id": "src_001"}],
        "person_evidence": [{"id": "pe_001", "assertion_id": "a_001", "person_id": "I1", "confidence": "probable"}],
    }
    out = _guard(_valid_output(), _wrong_person(), tree, research=research)
    assert out["avoid_guard"]["forced_false"][0]["person_ids"] == ["I1"]


def test_a_speculative_link_to_the_candidates_record_does_not_count():
    tree = _tree(_subject(), _person("I1", "Robert", "Smith"))
    research = {
        "assertions": [{"id": "a_001", "record_id": _RECORD, "source_id": "src_001"}],
        "person_evidence": [{"id": "pe_001", "assertion_id": "a_001", "person_id": "I1", "confidence": "speculative"}],
    }
    output = _valid_output()
    assert _guard(output, _wrong_person(), tree, research=research) is output


def test_a_wrong_person_avoid_passes_when_no_tree_object_cites_the_candidates_records():
    # A same-named person is present and cites another record: not the candidate.
    tree = _tree(
        _subject(),
        _person("I1", "Robert", "Smith", name_sources=["S2"]),
        sources=[{"id": "S2", "url": "https://www.familysearch.org/ark:/61903/1:1:BBBB-222"}],
    )
    output = _valid_output()
    assert _guard(output, _wrong_person(), tree) is output


def test_a_wrong_person_avoid_with_an_empty_list_still_fails_on_a_new_edge_to_the_candidate():
    tree = _tree(
        _subject(),
        _person("I1", "Robert", "Smith"),
        relationships=[{"id": "R1", "type": "ParentChild", "parent": "I1", "child": "S1"}],
    )
    out = _guard(_valid_output(), _wrong_person(records=()), tree)
    assert out["avoid_guard"]["forced_false"][0]["branch"] == "wrong-person"


def test_provenance_only_skips_the_edge_check_on_a_wrong_person_avoid():
    findings = _wrong_person(records=())
    findings["findings"][0]["details"]["wrong_candidate"]["provenance_only"] = True
    tree = _tree(
        _subject(),
        _person("I1", "Robert", "Smith"),
        relationships=[{"id": "R1", "type": "ParentChild", "parent": "I1", "child": "S1"}],
    )
    output = _valid_output()
    assert _guard(output, findings, tree) is output


def _agnes_as_mother(subtype=None):
    rel = {"id": "R1", "type": "ParentChild", "parent": "I1", "child": "S1"}
    if subtype is not None:
        rel["subtype"] = subtype
    return _tree(_subject(), _person("I1", "Agnes", "Wardrop"), relationships=[rel])


@pytest.mark.parametrize("subtype", [None, "Biological", "biologcal"])
def test_a_wrong_relationship_avoid_fails_on_a_biological_edge_in_the_forbidden_role(subtype):
    out = _guard(_valid_output(), _wrong_relationship(), _agnes_as_mother(subtype))
    [forced] = out["avoid_guard"]["forced_false"]
    assert forced["branch"] == "wrong-relationship"
    assert forced["person_ids"] == ["I1"]


@pytest.mark.parametrize("subtype", ["Step", "step", "Adoptive", "Foster", "Guardian"])
def test_a_wrong_relationship_avoid_passes_on_a_step_edge(subtype):
    output = _valid_output()
    assert _guard(output, _wrong_relationship(), _agnes_as_mother(subtype)) is output


def test_a_wrong_relationship_avoid_passes_when_the_candidate_is_the_child_not_the_mother():
    # Same two people, the subject in the other role: not the forbidden claim.
    tree = _tree(
        _subject(),
        _person("I1", "Agnes", "Wardrop"),
        relationships=[{"id": "R1", "type": "ParentChild", "parent": "S1", "child": "I1"}],
    )
    output = _valid_output()
    assert _guard(output, _wrong_relationship(), tree) is output


def test_any_new_fails_on_an_unknown_new_relative_and_passes_on_the_expected_answer():
    findings = _wrong_relationship(any_new=True)
    findings["findings"].append(
        {
            "id": "f2",
            "type": "relationship",
            "required": True,
            "details": {"relation": "mother", "target_person": {"name": "Matea Pedersdatter"}},
        }
    )
    expected = _tree(
        _subject(),
        _person("I1", "Matea", "Pedersdtr"),
        relationships=[{"id": "R1", "type": "ParentChild", "parent": "I1", "child": "S1"}],
    )
    output = _valid_output()
    assert _guard(output, findings, expected) is output

    unknown = _tree(
        _subject(),
        _person("I2", "Kari", "Hole"),
        relationships=[{"id": "R2", "type": "ParentChild", "parent": "I2", "child": "S1"}],
    )
    out = _guard(_valid_output(), findings, unknown)
    assert out["avoid_guard"]["forced_false"][0]["person_ids"] == ["I2"]


def test_any_new_does_not_fire_on_a_relative_the_starting_tree_already_holds():
    tree = _tree(
        _subject(),
        _person("I1", "Rachel", "Wilkins"),
        relationships=[{"id": "R1", "type": "Couple", "person1": "S1", "person2": "I1"}],
    )
    findings = _wrong_relationship(any_new=True)
    findings["findings"][0]["details"]["relation"] = "spouse"
    output = _valid_output()
    assert _guard(output, findings, tree, starting_tree=tree) is output


def test_any_new_fails_on_a_new_parent_who_shares_only_the_subjects_surname():
    findings = _wrong_relationship(any_new=True)
    findings["findings"].append(
        {
            "id": "f2",
            "type": "relationship",
            "required": True,
            "details": {"relation": "father", "target_person": {"name": "Benjamin Christophersen (later Benjamin Smith)"}},
        }
    )
    tree = _tree(
        _subject(),
        _person("I2", "Peder", "Smith"),
        relationships=[{"id": "R2", "type": "ParentChild", "parent": "I2", "child": "S1"}],
    )
    out = _guard(_valid_output(), findings, tree)
    assert out["avoid_guard"]["forced_false"][0]["person_ids"] == ["I2"]


def test_a_starting_edge_the_run_retypes_to_biological_is_still_subtracted():
    start = _agnes_as_mother()
    final = _agnes_as_mother("Biological")
    output = _valid_output()
    assert _guard(output, _wrong_relationship(), final, starting_tree=start) is output


@pytest.mark.parametrize("holder", ["S1", "I1"])
def test_a_fact_avoid_fails_when_the_avoided_value_is_on_any_person_the_subject_included(holder):
    death = {"id": "F1", "type": "Death", "date": "15 Dec 1854"}
    persons = [_subject(), _person("I1", "Elisabetha", "Meininger")]
    for p in persons:
        if p["id"] == holder:
            p["facts"] = [death]
    out = _guard(_valid_output(), _fact_avoid(), _tree(*persons))
    [forced] = out["avoid_guard"]["forced_false"]
    assert forced["branch"] == "fact"
    assert forced["person_ids"] == [holder]


def test_a_fact_avoid_passes_on_another_date():
    subject = _subject()
    subject["facts"] = [{"id": "F1", "type": "Death", "date": "15 Jan 1857"}]
    output = _valid_output()
    assert _guard(output, _fact_avoid(), _tree(subject)) is output


def test_a_year_only_avoided_value_binds_on_the_subject_not_on_a_relative():
    # wasyl-kapach-birth f3's shape: a bare year is too common to hold against
    # a relative a correct run fills in.
    findings = _fact_avoid()
    findings["findings"][0]["details"] = {"fact_type": "Birth", "wrong_value": "1883"}
    wife = _person("I1", "Tekla", "Kapach", facts=[{"id": "F1", "type": "Birth", "date": "abt 1883"}])
    output = _valid_output()
    assert _guard(output, findings, _tree(_subject(), wife)) is output
    subject = _subject()
    subject["facts"] = [{"id": "F2", "type": "Birth", "date": "1883"}]
    assert _guard(_valid_output(), findings, _tree(subject))["avoid_guard"]["forced_false"][0]["person_ids"] == ["S1"]


def test_a_coarser_date_on_the_subject_counts_when_the_place_matches():
    findings = _fact_avoid()
    findings["findings"][0]["details"]["wrong_candidate"] = {"date": "24 August 1808", "place": "Laakirchen"}
    for date, place, forced in (
        ("Aug 1808", "Laakirchen, Gmunden, Austria", True),
        ("1808", "Laakirchen", True),
        ("1808", "Linz", False),
        ("Sep 1808", "Laakirchen", False),
    ):
        subject = _subject()
        subject["facts"] = [{"id": "F1", "type": "Death", "date": date, "place": place}]
        out = _guard(_valid_output(), findings, _tree(subject))
        assert ("avoid_guard" in out) is forced, (date, place)
    relative = _person("I1", "Simon", "Heydocker", facts=[{"id": "F1", "type": "Death", "date": "1808", "place": "Laakirchen"}])
    output = _valid_output()
    assert _guard(output, findings, _tree(_subject(), relative)) is output


def test_a_fact_avoid_reads_a_marriage_on_the_couple():
    findings = _fact_avoid()
    details = findings["findings"][0]["details"]
    details["fact_type"] = "Marriage"
    details["wrong_candidate"] = {"date": "1 February 1868"}
    tree = _tree(
        _subject(),
        _person("I1", "Johanna", "Ryan"),
        relationships=[
            {
                "id": "R1",
                "type": "Couple",
                "person1": "S1",
                "person2": "I1",
                "facts": [{"id": "F1", "type": "Marriage", "standard_date": "1 Feb 1868"}],
            }
        ],
    )
    out = _guard(_valid_output(), findings, tree)
    assert sorted(out["avoid_guard"]["forced_false"][0]["person_ids"]) == ["I1", "S1"]


def test_every_branch_passes_when_the_candidate_or_the_avoided_value_is_already_in_the_starting_tree():
    cited = _tree(
        _subject(),
        _person("I1", "Bob", "Smyth", name_sources=["S9"]),
        sources=[{"id": "S9", "url": f"https://www.familysearch.org/{_RECORD}"}],
    )
    subject = _subject()
    subject["facts"] = [{"id": "F1", "type": "Death", "date": "15 Dec 1854"}]
    valued = _tree(subject)
    agnes = _agnes_as_mother()
    for findings, tree in ((_wrong_person(), cited), (_fact_avoid(), valued), (_wrong_relationship(), agnes)):
        output = _valid_output()
        assert _guard(output, findings, tree, starting_tree=tree) is output
        # The control: the same final tree against a bare starting tree is forced.
        assert _guard(_valid_output(), findings, tree)["per_finding"][0]["matched"] == "false"


def test_avoid_guard_ignores_recover_findings():
    # A recover finding SHOULD be in the final tree — its presence must not
    # trip the guard even though it names the same record.
    findings = _wrong_person()
    del findings["findings"][0]["polarity"]
    tree = _tree(
        _subject(),
        _person("I1", "Bob", "Smyth", name_sources=["S9"]),
        sources=[{"id": "S9", "url": f"https://www.familysearch.org/{_RECORD}"}],
    )
    output = _valid_output()
    assert _guard(output, findings, tree) is output


def _cited_candidate():
    return _tree(
        _subject(),
        _person("I1", "Bob", "Smyth", name_sources=["S9"]),
        sources=[{"id": "S9", "url": f"https://www.familysearch.org/{_RECORD}"}],
    )


def test_avoid_guard_never_upgrades_the_verdict():
    # Judge already failed the finding: nothing left to force, output passes
    # through unchanged — the guard can only tighten, never loosen.
    output = _valid_output(verdict="fail", recall_required=0.0, recall_total=0.0)
    output["per_finding"][0]["matched"] = "false"
    assert _guard(output, _wrong_person(), _cited_candidate()) is output


def test_avoid_guard_handles_a_skipped_judge():
    # verdict "skipped" produces judge_output == {} — the guard must pass it
    # through rather than inventing a grade.
    assert _guard({}, _wrong_person(), _cited_candidate()) == {}


def test_avoid_guard_grades_a_finding_the_judge_never_graded():
    # Judge contract violation (per_finding missing the avoid finding): the
    # guard records the objective miss instead of letting it vanish.
    output = _valid_output(per_finding=[], verdict="pass", recall_required=1.0)
    out = _guard(output, _wrong_person(), _cited_candidate())
    assert out["per_finding"][0]["finding_id"] == "f1"
    assert out["per_finding"][0]["matched"] == "false"
    assert out["verdict"] == "fail"


# --- component derivation (issue #1090) ---------------------------------
#
# The judge decomposes a finding reliably and labels it unreliably. These
# pin the arithmetic that replaced the label.


def _findings(*, polarity: str = "recover", ftype: str = "relationship"):
    return {
        "findings": [
            {"id": "f1", "required": True, "polarity": polarity, "type": ftype}
        ]
    }


def _with_components(components, matched="true"):
    components = [{"kind": "link", **c} for c in components]
    return _valid_output(
        per_finding=[
            {
                "finding_id": "f1",
                "matched": matched,
                "agent_evidence": "",
                "notes": "",
                "components": components,
            }
        ]
    )


@pytest.mark.parametrize(
    "statuses,expected",
    [
        ([], None),
        (["supported"], "true"),
        (["supported", "supported"], "true"),
        (["unsupported"], "false"),
        (["unsupported", "unsupported", "unsupported"], "false"),
        (["supported", "unsupported"], "partial"),
        (["contradicted"], "false"),
        (["supported", "contradicted"], "false"),
    ],
)
def test_derive_matched_rolls_components_up(statuses, expected):
    components = [{"claim": "c", "kind": "link", "status": s} for s in statuses]
    assert derive_matched(components) == expected


def test_derivation_forces_false_when_no_component_is_supported():
    """The #1090 case: judge decomposes correctly, then emits `true` anyway."""
    out = apply_component_derivation(
        _with_components(
            [
                {"claim": "father link", "status": "unsupported"},
                {"claim": "mother link", "status": "unsupported"},
                {"claim": "spouse link", "status": "unsupported"},
            ],
            matched="true",
        ),
        expected_findings=_findings(),
    )
    entry = out["per_finding"][0]
    assert entry["matched"] == "false"
    assert entry["matched_model"] == "true"
    assert out["component_derivation"]["overrides"][0]["derived"] == "false"
    assert "[component-derivation]" in entry["notes"]


def test_derivation_recomputes_recall_and_verdict():
    out = apply_component_derivation(
        _with_components([{"claim": "father link", "status": "unsupported"}]),
        expected_findings=_findings(),
    )
    assert out["verdict"] == "fail"
    assert out["recall_required"] == 0.0
    assert out["recall_total"] == 0.0


def test_derivation_leaves_output_untouched_when_label_already_agrees():
    original = _with_components(
        [{"claim": "father link", "status": "supported"}], matched="true"
    )
    out = apply_component_derivation(original, expected_findings=_findings())
    assert out is original
    assert "component_derivation" not in out


def test_derivation_ignores_findings_without_components():
    """Historical run logs predate `components` — their labels must survive."""
    original = _valid_output()
    out = apply_component_derivation(original, expected_findings=_findings())
    assert out is original
    assert out["per_finding"][0]["matched"] == "true"


def test_derivation_skips_avoid_findings():
    """`true` on an avoid finding means 'correctly declined', not a tally."""
    original = _with_components(
        [{"claim": "the wrong Robert Smith", "status": "unsupported"}], matched="true"
    )
    out = apply_component_derivation(
        original, expected_findings=_findings(polarity="avoid")
    )
    assert out is original
    assert out["per_finding"][0]["matched"] == "true"


def test_derivation_is_a_noop_when_the_judge_was_skipped():
    assert apply_component_derivation({}, expected_findings=_findings()) == {}


def test_detail_components_never_score():
    """Biography identifies which person is meant; it is not a claim to file."""
    out = apply_component_derivation(
        _with_components(
            [
                {"claim": "father link", "kind": "link", "status": "supported"},
                {"claim": "born 1833 in the Gorbals", "kind": "detail",
                 "status": "unsupported"},
                {"claim": "an iron moulder", "kind": "detail", "status": "unsupported"},
            ],
            matched="true",
        ),
        expected_findings=_findings(),
    )
    # Every link supported -> `true`; the two missing details must not lower it.
    assert out is not None
    assert out["per_finding"][0]["matched"] == "true"


def test_derivation_skips_fact_findings():
    """A `fact` finding's components are dates and places, not links."""
    original = _with_components(
        [{"claim": "birth place", "kind": "link", "status": "unsupported"}],
        matched="true",
    )
    out = apply_component_derivation(
        original, expected_findings=_findings(ftype="fact")
    )
    assert out is original
    assert out["per_finding"][0]["matched"] == "true"


def test_derivation_falls_back_when_only_details_are_listed():
    original = _with_components(
        [{"claim": "an iron moulder", "kind": "detail", "status": "unsupported"}],
        matched="true",
    )
    out = apply_component_derivation(original, expected_findings=_findings())
    assert out is original


# --- verdict/recall roll-up derivation (issue #2849) ------------------------
#
# `apply_component_derivation` used to skip the recompute entirely whenever
# there were no component overrides — which is most runs, and every run on a
# `fact`-only fixture, since that type is never eligible for the override
# loop. These pin that the roll-up (`verdict`, `recall_required`,
# `recall_total`) is now checked against `per_finding` on every call.


def test_verdict_derivation_downgrades_a_fact_only_fixture():
    """The #2849 case: the model says `pass` but its own required finding is
    labeled `partial` — no component override can fire (fact type, no
    relationship components), so only the new roll-up recompute catches it."""
    out = apply_component_derivation(
        _valid_output(
            verdict="pass",
            recall_required=1.0,
            recall_total=1.0,
            per_finding=[
                {
                    "finding_id": "f1",
                    "matched": "partial",
                    "agent_evidence": "",
                    "notes": "",
                }
            ],
        ),
        expected_findings=_findings(ftype="fact"),
    )
    assert out["verdict"] == "partial"
    assert out["recall_required"] == 0.5
    assert "component_derivation" not in out
    assert out["verdict_derivation"]["model"] == {
        "verdict": "pass",
        "recall_required": 1.0,
        "recall_total": 1.0,
    }
    assert out["verdict_derivation"]["derived"] == {
        "verdict": "partial",
        "recall_required": 0.5,
        "recall_total": 0.5,
    }


def test_verdict_derivation_upgrades_when_the_model_undersells_true_labels():
    """The other direction: the model says `fail` even though every required
    finding is labeled `true`. The recompute is not downgrade-only."""
    out = apply_component_derivation(
        _valid_output(
            verdict="fail",
            recall_required=0.0,
            recall_total=0.0,
            per_finding=[
                {
                    "finding_id": "f1",
                    "matched": "true",
                    "agent_evidence": "",
                    "notes": "",
                }
            ],
        ),
        expected_findings=_findings(),
    )
    assert out["verdict"] == "pass"
    assert out["recall_required"] == 1.0
    assert out["recall_total"] == 1.0
    assert out["verdict_derivation"]["model"]["verdict"] == "fail"
    assert out["verdict_derivation"]["derived"]["verdict"] == "pass"


def test_verdict_derivation_corrects_recall_even_when_the_verdict_was_right():
    """The model's verdict can be correct while its recall arithmetic is
    still wrong — the two are corrected independently, and only the field
    that actually disagreed is named in `verdict_derivation`."""
    out = apply_component_derivation(
        _valid_output(
            verdict="partial",
            recall_required=0.8,
            recall_total=0.5,
            per_finding=[
                {
                    "finding_id": "f1",
                    "matched": "partial",
                    "agent_evidence": "",
                    "notes": "",
                }
            ],
        ),
        expected_findings=_findings(),
    )
    assert out["verdict"] == "partial"
    assert out["recall_required"] == 0.5
    assert out["verdict_derivation"]["model"] == {"recall_required": 0.8}
    assert out["verdict_derivation"]["derived"] == {"recall_required": 0.5}


def test_verdict_derivation_is_a_noop_when_output_is_already_consistent():
    """A model output whose own verdict/recall already agree with the
    arithmetic — the common case — still returns the identical object, same
    as before #2849's always-recompute change."""
    original = _valid_output()
    out = apply_component_derivation(original, expected_findings=_findings())
    assert out is original
    assert "verdict_derivation" not in out


def test_a_rounded_recall_is_within_tolerance_and_records_nothing():
    """2/3 = 0.666…; a model reporting 0.67 is agreement, not a disagreement."""
    # Three required findings: two true, one false → recall = 2/3 ≈ 0.666…
    # The model reports 0.67, which is within the 0.011 tolerance.
    findings = {
        "findings": [
            {"id": "f1", "description": "a", "type": "relationship", "required": True},
            {"id": "f2", "description": "b", "type": "relationship", "required": True},
            {"id": "f3", "description": "c", "type": "relationship", "required": True},
        ]
    }
    original = _valid_output(
        verdict="partial",
        recall_required=0.67,
        recall_total=0.67,
        per_finding=[
            {"finding_id": "f1", "matched": "true", "agent_evidence": "", "notes": ""},
            {"finding_id": "f2", "matched": "true", "agent_evidence": "", "notes": ""},
            {"finding_id": "f3", "matched": "false", "agent_evidence": "", "notes": ""},
        ],
    )
    out = apply_component_derivation(original, expected_findings=findings)
    assert out is original
    assert "verdict_derivation" not in out
