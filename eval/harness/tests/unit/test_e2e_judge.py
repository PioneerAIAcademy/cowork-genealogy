"""Unit tests for e2e.judge — prompt rendering and JSON extraction.

The actual Anthropic API call is exercised in the e2e suite, not here.
These tests check the deterministic pre/post-processing.
"""

from __future__ import annotations

import json

import pytest

from e2e.judge import _extract_json, _render_prompt


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


def test_extract_json_from_bare_object():
    text = '{"verdict": "pass", "recall_required": 1.0}'
    assert _extract_json(text) == {"verdict": "pass", "recall_required": 1.0}


def test_extract_json_strips_json_code_fence():
    text = '```json\n{"verdict": "pass"}\n```'
    assert _extract_json(text) == {"verdict": "pass"}


def test_extract_json_strips_bare_code_fence():
    text = '```\n{"verdict": "fail"}\n```'
    assert _extract_json(text) == {"verdict": "fail"}


def test_extract_json_tolerates_leading_prose():
    text = 'Here is my grading:\n\n{"verdict": "partial", "recall_required": 0.5}'
    assert _extract_json(text) == {"verdict": "partial", "recall_required": 0.5}


def test_extract_json_handles_nested_objects():
    payload = {
        "per_finding": [{"finding_id": "f1", "matched": "true"}],
        "verdict": "pass",
    }
    text = json.dumps(payload, indent=2)
    assert _extract_json(text) == payload


def test_extract_json_raises_on_no_json():
    with pytest.raises(ValueError):
        _extract_json("Just some prose with no JSON whatsoever.")


def test_extract_json_raises_on_unbalanced_braces():
    with pytest.raises((ValueError, json.JSONDecodeError)):
        _extract_json('{"verdict": "pass"')
