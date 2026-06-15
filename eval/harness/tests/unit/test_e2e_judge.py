"""Unit tests for e2e.judge — prompt rendering and output validation.

The actual Anthropic API call is exercised in the e2e suite, not here.
These tests check the deterministic pre/post-processing: prompt
rendering and the fail-loud validation of structured judge output.
"""

from __future__ import annotations

import pytest

from e2e.judge import JudgeOutputError, _render_prompt, _validate_judge_output


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
    }
    base.update(overrides)
    return base


def test_render_prompt_substitutes_placeholders():
    prompt = _render_prompt(
        research_question="Who were John Smith's parents?",
        expected_findings={"findings": [{"id": "f1"}]},
        final_tree={"persons": []},
    )
    assert "Who were John Smith's parents?" in prompt
    assert '"id": "f1"' in prompt
    assert '"persons": []' in prompt
    # Make sure none of the template placeholders leaked through
    assert "{{RESEARCH_QUESTION}}" not in prompt
    assert "{{EXPECTED_FINDINGS}}" not in prompt
    assert "{{FINAL_TREE}}" not in prompt


def test_render_prompt_with_none_final_tree():
    """If the agent crashed and we still want a judge call, final_tree is None."""
    prompt = _render_prompt(
        research_question="Q?",
        expected_findings={"findings": []},
        final_tree=None,
    )
    # None becomes {} in the rendered JSON
    assert "{}" in prompt


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
