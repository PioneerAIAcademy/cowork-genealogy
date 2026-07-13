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


def _avoid_findings(required=True):
    return {
        "findings": [
            {
                "id": "f1",
                "type": "relationship",
                "required": required,
                "polarity": "avoid",
                "description": "The agent should NOT conclude Robert Smith is the father.",
                "details": {"target_person": {"name": "Robert Smith"}},
            }
        ]
    }


def _tree_with_robert_smith():
    return {
        "persons": [
            {
                "id": "P1",
                "living": False,
                "names": [{"id": "N1", "given": "Robert", "surname": "Smith"}],
            }
        ],
        "relationships": [],
        "sources": [],
    }


def test_avoid_guard_forces_false_when_the_avoided_claim_is_in_the_final_tree():
    # The judge said "correctly avoided" (matched true, verdict pass), but the
    # final tree still contains the avoided person — the guard overrides.
    output = _valid_output()
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_tree_with_robert_smith(),
    )
    assert out["per_finding"][0]["matched"] == "false"
    assert "[avoid-guard]" in out["per_finding"][0]["notes"]
    assert "P1" in out["per_finding"][0]["notes"]
    assert out["verdict"] == "fail"
    assert out["recall_required"] == 0.0
    assert out["avoid_guard"]["forced_false"] == [
        {"finding_id": "f1", "person_ids": ["P1"]}
    ]
    # Downgrade happens on a copy; the judge's own output is untouched.
    assert output["per_finding"][0]["matched"] == "true"
    assert output["verdict"] == "pass"


def test_avoid_guard_is_a_no_op_when_the_avoided_claim_is_absent():
    output = _valid_output()
    tree = {"persons": [{"id": "P1", "living": False,
                         "names": [{"id": "N1", "given": "Jane", "surname": "Doe"}]}]}
    assert apply_avoid_guard(
        output, expected_findings=_avoid_findings(), final_tree=tree
    ) is output


def test_avoid_guard_ignores_recover_findings():
    # A recover finding SHOULD be in the final tree — its presence must not
    # trip the guard even though the matcher would find it.
    findings = _avoid_findings()
    del findings["findings"][0]["polarity"]
    output = _valid_output()
    assert apply_avoid_guard(
        output, expected_findings=findings, final_tree=_tree_with_robert_smith()
    ) is output


def test_avoid_guard_never_upgrades_the_verdict():
    # Judge already failed the finding: nothing left to force, output passes
    # through unchanged — the guard can only tighten, never loosen.
    output = _valid_output(verdict="fail", recall_required=0.0, recall_total=0.0)
    output["per_finding"][0]["matched"] = "false"
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_tree_with_robert_smith(),
    )
    assert out is output


def test_avoid_guard_handles_a_skipped_judge():
    # verdict "skipped" produces judge_output == {} — the guard must pass it
    # through rather than inventing a grade.
    assert apply_avoid_guard(
        {}, expected_findings=_avoid_findings(), final_tree=_tree_with_robert_smith()
    ) == {}


def test_avoid_guard_grades_a_finding_the_judge_never_graded():
    # Judge contract violation (per_finding missing the avoid finding): the
    # guard records the objective miss instead of letting it vanish.
    output = _valid_output(per_finding=[], verdict="pass", recall_required=1.0)
    out = apply_avoid_guard(
        output,
        expected_findings=_avoid_findings(),
        final_tree=_tree_with_robert_smith(),
    )
    assert out["per_finding"][0]["finding_id"] == "f1"
    assert out["per_finding"][0]["matched"] == "false"
    assert out["verdict"] == "fail"
