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


# The avoid guard is subject-anchored (Dallan ruling, 2026-10-20): it forces an
# avoid finding false only on what the agent NEWLY attached to the subject,
# diffing the final tree against the starting tree. These helpers build a
# starting tree with a subject + an existing spouse, and final trees that add
# (or don't) a new attachment to the subject.


def _avoid_findings(required=True):
    return {
        "findings": [
            {
                "id": "f1",
                "type": "relationship",
                "required": required,
                "polarity": "avoid",
                "description": "The agent should NOT conclude Robert Smith is a spouse.",
                "details": {
                    "subject_person": {"name": "Subject Person"},
                    "relation": "spouse",
                    "wrong_candidate": {"name": "Robert Smith"},
                },
            }
        ]
    }


def _fact_avoid_findings(required=True):
    return {
        "findings": [
            {
                "id": "f1",
                "type": "fact",
                "required": required,
                "polarity": "avoid",
                "description": (
                    "The agent must NOT assert that the subject died 15 December "
                    "1854 or was buried 17 December 1854."
                ),
                "details": {
                    "subject_person": {"name": "Subject Person"},
                    "fact_type": "Death",
                    "wrong_candidate": {"date": "15 December 1854"},
                },
            }
        ]
    }


def _person_avoid_findings(required=True):
    return {
        "findings": [
            {
                "id": "f1",
                "type": "person",
                "required": required,
                "polarity": "avoid",
                "description": "The agent must NOT assert that Robert Smith exists.",
                "details": {"person": {"name": "Robert Smith"}},
            }
        ]
    }


def _starting_tree():
    return {
        "persons": [
            {"id": "SUBJECT", "living": False,
             "names": [{"id": "N0", "given": "Subject", "surname": "Person"}], "facts": []},
            {"id": "W1", "living": False,
             "names": [{"id": "N1", "given": "Existing", "surname": "Wife"}]},
        ],
        "relationships": [{"id": "R1", "type": "Couple", "person1": "SUBJECT", "person2": "W1"}],
        "sources": [],
    }


def _subject_tree_with_new_spouse():
    t = _starting_tree()
    t["persons"].append(
        {"id": "P9", "living": False,
         "names": [{"id": "N9", "given": "Robert", "surname": "Smith"}]})
    t["relationships"].append({"id": "R9", "type": "Couple", "person1": "SUBJECT", "person2": "P9"})
    return t


def _starting_tree_with_undated_death():
    return {
        "persons": [
            {"id": "SUBJECT", "living": False,
             "names": [{"id": "N0", "given": "Subject", "surname": "Person"}],
             "facts": [{"id": "F0", "type": "Death"}]},
        ],
        "relationships": [],
        "sources": [],
    }


def _tree_with_robert_smith():
    return {
        "persons": [
            {"id": "P1", "living": False,
             "names": [{"id": "N1", "given": "Robert", "surname": "Smith"}]},
        ],
        "relationships": [],
        "sources": [],
    }


def test_avoid_guard_forces_false_on_a_new_spouse_attached_to_the_subject():
    # The judge said "correctly avoided" (matched true, verdict pass), but the
    # agent newly attached the avoided person to the subject — the guard overrides.
    output = _valid_output()
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_subject_tree_with_new_spouse(),
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    )
    assert out["per_finding"][0]["matched"] == "false"
    assert "[avoid-guard]" in out["per_finding"][0]["notes"]
    assert "P9" in out["per_finding"][0]["notes"]
    assert out["verdict"] == "fail"
    assert out["recall_required"] == 0.0
    assert out["avoid_guard"]["forced_false"] == [
        {"finding_id": "f1", "person_ids": ["P9"]}
    ]
    # Downgrade happens on a copy; the judge's own output is untouched.
    assert output["per_finding"][0]["matched"] == "true"
    assert output["verdict"] == "pass"


def test_avoid_guard_catches_a_new_parent_attached_to_the_subject():
    # subject-as-child: a new ParentChild whose parent matches the target.
    output = _valid_output()
    final = _starting_tree()
    final["persons"].append(
        {"id": "P9", "living": False,
         "names": [{"id": "N9", "given": "Robert", "surname": "Smith"}]})
    final["relationships"].append(
        {"id": "R9", "type": "ParentChild", "parent": "P9", "child": "SUBJECT"})
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=final,
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    )
    assert out["per_finding"][0]["matched"] == "false"
    assert out["avoid_guard"]["forced_false"] == [
        {"finding_id": "f1", "person_ids": ["P9"]}
    ]


def test_avoid_guard_does_not_force_when_the_avoided_person_is_unattached():
    # antonio shape: the avoided person exists in the final tree but is NOT
    # linked to the subject — the correct research outcome, not an over-claim.
    output = _valid_output()
    final = _starting_tree()
    final["persons"].append(
        {"id": "P9", "living": False,
         "names": [{"id": "N9", "given": "Robert", "surname": "Smith"}]})
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=final,
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    )
    assert out is output  # nothing new attached to the subject → nothing forced
    assert out["per_finding"][0]["matched"] == "true"


def test_avoid_guard_does_not_force_a_new_relative_sharing_only_the_surname():
    # Pins the "given AND surname" rule: a newly-attached relative who shares
    # only the surname (not the given name) with the wrong candidate is not the
    # avoided person, so the guard must NOT force. Relaxing the match to
    # "given OR surname" would wrongly force this and is otherwise untested.
    output = _valid_output()
    final = _starting_tree()
    final["persons"].append(
        {"id": "P9", "living": False,
         "names": [{"id": "N9", "given": "William", "surname": "Smith"}]})
    final["relationships"].append(
        {"id": "R9", "type": "Couple", "person1": "SUBJECT", "person2": "P9"})
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),  # wrong candidate "Robert Smith"
        final_tree=final,
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    )
    # Shares surname "Smith" only, not given "Robert" → not forced.
    assert out is output
    assert out["per_finding"][0]["matched"] == "true"


def test_avoid_guard_ignores_a_preexisting_namesake_relationship():
    # The avoided name matches a person ALREADY linked to the subject in the
    # starting tree (a legitimate look-alike relative). Not new → not forced.
    # The retired whole-tree matcher wrongly force-failed exactly this case.
    output = _valid_output()
    start = {
        "persons": [
            {"id": "SUBJECT", "living": False,
             "names": [{"id": "N0", "given": "Subject", "surname": "Person"}]},
            {"id": "X", "living": False,
             "names": [{"id": "N1", "given": "Robert", "surname": "Smith"}]},
        ],
        "relationships": [{"id": "R1", "type": "Couple", "person1": "SUBJECT", "person2": "X"}],
        "sources": [],
    }
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=start,
        starting_tree=start,
        subject_person_ids={"SUBJECT"},
    )
    assert out is output


def test_avoid_guard_keys_on_endpoints_not_relationship_id():
    # The same subject relationship re-minted with a different id in the final
    # tree is NOT new — keying on the endpoint pair, not the synthesized id.
    output = _valid_output()
    start = {
        "persons": [
            {"id": "SUBJECT", "living": False,
             "names": [{"id": "N0", "given": "Subject", "surname": "Person"}]},
            {"id": "X", "living": False,
             "names": [{"id": "N1", "given": "Robert", "surname": "Smith"}]},
        ],
        "relationships": [{"id": "R1", "type": "Couple", "person1": "SUBJECT", "person2": "X"}],
        "sources": [],
    }
    final = {
        "persons": start["persons"],
        "relationships": [
            {"id": "R999", "type": "Couple", "person1": "SUBJECT", "person2": "X"}
        ],  # re-minted, same endpoints
        "sources": [],
    }
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=final,
        starting_tree=start,
        subject_person_ids={"SUBJECT"},
    )
    assert out is output


def test_avoid_guard_fact_avoid_does_not_force_the_subjects_own_death():
    # Option 3 (2026-10-20): the subject-anchored fact branch was WITHDRAWN after
    # review found it force-failed correct runs (a sibling recover finding of the
    # same type). Fact-avoid findings stay on the legacy whole-tree matcher, which
    # exempts the subject — so a new dated Death on the SUBJECT is NOT forced. This
    # is the Heinrich Death/Burial blind spot, left unresolved on purpose (spec
    # §3.4.1); it is also what stops a fact-avoid from force-failing a legitimate
    # sibling recovery of the same fact type.
    output = _valid_output()
    final = {
        "persons": [
            {"id": "SUBJECT", "living": False,
             "names": [{"id": "N0", "given": "Subject", "surname": "Person"}],
             "facts": [{"id": "F0", "type": "Death", "date": "15 December 1854",
                        "standard_date": "+1854-12-15"}]},
        ],
        "relationships": [],
        "sources": [],
    }
    out = apply_avoid_guard(
        output,
        expected_findings=_fact_avoid_findings(),
        final_tree=final,
        starting_tree=_starting_tree_with_undated_death(),
        subject_person_ids={"SUBJECT"},
    )
    assert out is output  # nothing forced — the subject's own facts are exempt


def test_avoid_guard_fact_avoid_catches_a_non_subject_on_the_legacy_path():
    # The legacy fact path is retained: a NON-subject person matching the avoid
    # finding's name and carrying the forbidden fact type is still forced.
    output = _valid_output()
    findings = {
        "findings": [
            {"id": "f1", "type": "fact", "required": True, "polarity": "avoid",
             "description": "The agent must NOT assert that Wrong Person died.",
             "details": {"target_person": {"name": "Wrong Person"}, "fact_type": "Death"}},
        ]
    }
    final = {
        "persons": [
            {"id": "SUBJECT", "living": False,
             "names": [{"id": "N0", "given": "Subject", "surname": "Person"}]},
            {"id": "P1", "living": False,
             "names": [{"id": "N1", "given": "Wrong", "surname": "Person"}],
             "facts": [{"id": "D1", "type": "Death", "date": "1854"}]},
        ],
        "relationships": [],
        "sources": [],
    }
    out = apply_avoid_guard(
        output,
        expected_findings=findings,
        final_tree=final,
        starting_tree=final,
        subject_person_ids={"SUBJECT"},
    )
    assert out["per_finding"][0]["matched"] == "false"
    assert out["avoid_guard"]["forced_false"] == [{"finding_id": "f1", "person_ids": ["P1"]}]


def test_avoid_guard_person_type_uses_the_legacy_whole_tree_path():
    # person/source avoid findings are NOT subject-anchored; a matching person
    # present in the final tree (and not the subject) is forced.
    output = _valid_output()
    out = apply_avoid_guard(
        output,
        expected_findings=_person_avoid_findings(),
        final_tree=_tree_with_robert_smith(),
        starting_tree={"persons": [], "relationships": [], "sources": []},
        subject_person_ids=set(),
    )
    assert out["per_finding"][0]["matched"] == "false"
    assert out["avoid_guard"]["forced_false"] == [
        {"finding_id": "f1", "person_ids": ["P1"]}
    ]


def test_avoid_guard_person_type_exempts_the_subject():
    # The legacy path still exempts the fixture subject by id.
    output = _valid_output()
    out = apply_avoid_guard(
        output,
        expected_findings=_person_avoid_findings(),
        final_tree=_tree_with_robert_smith(),  # P1 = Robert Smith
        starting_tree=_tree_with_robert_smith(),
        subject_person_ids={"P1"},
    )
    assert out is output


def test_avoid_guard_forces_nothing_without_a_starting_tree():
    # Defensive: a missing starting tree means no baseline to diff, so the
    # subject-anchored path forces nothing rather than treating all as new.
    output = _valid_output()
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_subject_tree_with_new_spouse(),
        starting_tree=None,
        subject_person_ids={"SUBJECT"},
    )
    assert out is output


def test_avoid_guard_is_a_no_op_when_the_avoided_claim_is_absent():
    output = _valid_output()
    final = _starting_tree()
    final["persons"].append(
        {"id": "P9", "living": False,
         "names": [{"id": "N9", "given": "Jane", "surname": "Doe"}]})
    final["relationships"].append({"id": "R9", "type": "Couple", "person1": "SUBJECT", "person2": "P9"})
    assert apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=final,
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    ) is output


def test_avoid_guard_ignores_recover_findings():
    # A recover finding is not an avoid finding — the guard returns early.
    findings = _avoid_findings()
    del findings["findings"][0]["polarity"]
    output = _valid_output()
    assert apply_avoid_guard(
        output,
        expected_findings=findings,
        final_tree=_subject_tree_with_new_spouse(),
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    ) is output


def test_avoid_guard_never_upgrades_the_verdict():
    # Judge already failed the finding: nothing left to force, output passes
    # through unchanged — the guard can only tighten, never loosen.
    output = _valid_output(verdict="fail", recall_required=0.0, recall_total=0.0)
    output["per_finding"][0]["matched"] = "false"
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_subject_tree_with_new_spouse(),
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    )
    assert out is output


def test_avoid_guard_handles_a_skipped_judge():
    # verdict "skipped" produces judge_output == {} — the guard must pass it
    # through rather than inventing a grade.
    assert apply_avoid_guard(
        {},
        expected_findings=_avoid_findings(),
        final_tree=_subject_tree_with_new_spouse(),
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    ) == {}


def test_avoid_guard_grades_a_finding_the_judge_never_graded():
    # Judge contract violation (per_finding missing the avoid finding): the
    # guard records the objective miss instead of letting it vanish.
    output = _valid_output(per_finding=[], verdict="pass", recall_required=1.0)
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_subject_tree_with_new_spouse(),
        starting_tree=_starting_tree(),
        subject_person_ids={"SUBJECT"},
    )
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
