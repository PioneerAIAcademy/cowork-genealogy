"""Skill-specific validators for the assertion-classification skill.

assertion-classification keeps its `rubric.md` — all three dimensions
(Three-layer accuracy, Informant analysis, Classification justification)
are GPS taxonomy craft and stay graded by the LLM judge. See
docs/plan/criteria-demotion-and-rubric-opt-in.md.

This file holds mechanical checks: source_classification is read-only
here (Layer 1 is set by record-extraction), no new assertion entries,
no MCP tools, plus tag-gated assertions for specific verdicts that
deserve a deterministic check.

Universal `test_ownership_table` already enforces that
assertion-classification only writes the `assertions` section.

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_no_mcp_tools_called(tool_calls):
    """assertion-classification must not call any *research* MCP tools — it's
    a pure analysis skill that reads assertions from research.json and
    rewrites Layer 2 / Layer 3 classification fields. The universal
    verification tool `validate_research_schema` is exempted: post
    commit 861d3c9 it's a built-in schema check every skill is expected
    to call at the end of its flow, not a research tool."""
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
        and tc.get("tool", "").rsplit("__", 1)[-1] != "validate_research_schema"
    ]
    assert not mcp_calls, (
        f"assertion-classification should not call MCP tools (other than "
        f"validate_research_schema), but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )


# --- No-new-assertions enforcement ------------------------------------

def test_does_not_add_new_assertions(before_state, after_state, test):
    """assertion-classification refines existing assertions — it must
    not create new ones. New assertion extraction is record-extraction's
    job.

    Per SKILL.md: "This skill classifies Layer 2 (information quality)
    and Layer 3 (evidence type). Layer 1 (source classification) is set
    by record-extraction and is read-only here."
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_ids = {a.get("id") for a in before.get("assertions", [])}
    after_ids = {a.get("id") for a in after.get("assertions", [])}
    new = after_ids - before_ids
    assert not new, (
        f"assertion-classification added new assertion entries "
        f"{sorted(new)} — it must only refine existing ones."
    )


# --- Source classification is read-only -------------------------------

def test_source_classification_unchanged(before_state, after_state, test):
    """Layer 1 (`source_classification`) is read-only in this skill —
    it lives on `sources` entries and is set by record-extraction.
    assertion-classification only writes Layer 2 / Layer 3 on
    `assertions` entries.

    A bug where this skill mutates `sources[].source_classification`
    would silently change every downstream conflict-resolution
    decision; this check guards that contract.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_by_id = {
        s.get("id"): s.get("source_classification")
        for s in before.get("sources", [])
    }
    after_by_id = {
        s.get("id"): s.get("source_classification")
        for s in after.get("sources", [])
    }
    diffs = []
    for sid, before_cls in before_by_id.items():
        after_cls = after_by_id.get(sid)
        if before_cls != after_cls:
            diffs.append(f"{sid}: {before_cls!r} → {after_cls!r}")
    assert not diffs, (
        "source_classification changed on sources (must be set by "
        "record-extraction, not assertion-classification):\n  - "
        + "\n  - ".join(diffs)
    )


# --- Tag-gated assertion-specific verdict checks ----------------------

def _find_assertion(after_state, aid):
    after = after_state.get("research_json")
    if after is None:
        return None
    return next(
        (a for a in after.get("assertions", []) if a.get("id") == aid),
        None,
    )


def test_a012_secondary_family_not_present(after_state, test):
    """For the death-cert-secondary-informant test: a_012 captures
    Patrick's birth as reported by his son-in-law James Brown on the
    1908 death cert. Required verdicts on the assertion:
      - information_quality == "secondary"
      - informant_proximity == "family_not_present"
    """
    if "a012-secondary-family-not-present" not in test.get("tags", []):
        pytest.skip("not an a012-secondary-family-not-present scenario")
    a = _find_assertion(after_state, "a_012")
    assert a is not None, "a_012 not found in after_state.assertions"
    assert a.get("information_quality") == "secondary", (
        f"a_012 information_quality should be 'secondary' (son-in-law "
        f"reporting birth six decades earlier); got "
        f"{a.get('information_quality')!r}"
    )
    assert a.get("informant_proximity") == "family_not_present", (
        f"a_012 informant_proximity should be 'family_not_present'; "
        f"got {a.get('informant_proximity')!r}"
    )


def test_a001_preserves_classification(before_state, after_state, test):
    """For the reclassify-census-informant test: a_001 captures Patrick's
    name from the 1850 census. The skill may refine the rationale but
    should preserve:
      - information_quality == "indeterminate" (no identified informant)
      - evidence_type == "direct"
      - the assertion's value and source_id (only classification fields
        are in scope for this skill)
    """
    if "a001-preserves-classification" not in test.get("tags", []):
        pytest.skip("not an a001-preserves-classification scenario")
    before_research = before_state.get("research_json")
    if before_research is None:
        pytest.skip("Missing before research.json")
    before_a = next(
        (a for a in before_research.get("assertions", []) if a.get("id") == "a_001"),
        None,
    )
    after_a = _find_assertion(after_state, "a_001")
    assert before_a is not None, "a_001 not found in before_state"
    assert after_a is not None, "a_001 not found in after_state"

    assert after_a.get("information_quality") == "indeterminate", (
        f"a_001 information_quality should be 'indeterminate' (no "
        f"identified informant on the 1850 census); got "
        f"{after_a.get('information_quality')!r}"
    )
    assert after_a.get("evidence_type") == "direct", (
        f"a_001 evidence_type should be 'direct'; got "
        f"{after_a.get('evidence_type')!r}"
    )
    assert after_a.get("value") == before_a.get("value"), (
        f"a_001.value should not change; was {before_a.get('value')!r}, "
        f"became {after_a.get('value')!r}"
    )
    assert after_a.get("source_id") == before_a.get("source_id"), (
        f"a_001.source_id should not change; was {before_a.get('source_id')!r}, "
        f"became {after_a.get('source_id')!r}"
    )
