"""Skill-specific validators for the citation skill.

citation keeps its `rubric.md` — all three dimensions (Evidence
Explained compliance, Replication test, Source vs information
distinction) are pure GPS craft and stay graded by the LLM judge.

This file holds the append-only source-section check (per spec:
citation never creates new source entries — it refines existing
ones). Tool-allowlist enforcement is delegated to universal
`test_tool_allowlist`, which correctly honors the skill's declared
`allowed-tools` (currently `[validate_research_schema]`).

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import pytest


# --- No-new-sources enforcement ---------------------------------------

def test_does_not_add_new_source_entries(before_state, after_state, test):
    """citation refines existing source entries — it must not create new
    ones. New record discovery is search-records / record-extraction's job.

    Per SKILL.md: "This skill never creates new source entries — it only
    refines entries created by record-extraction."
    """
    # Runs on every positive citation test, and on negative tests tagged
    # `no-new-source` (e.g. ut_citation_012): those negatives DO run a
    # skill body — record-extraction, or a citation trigger-then-decline —
    # so the never-create-a-source invariant must be enforced
    # deterministically here, independent of which skill routed.
    if test.get("type") != "positive" and "no-new-source" not in test.get("tags", []):
        pytest.skip("negative test without the no-new-source invariant")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_ids = {s.get("id") for s in before.get("sources", [])}
    after_ids = {s.get("id") for s in after.get("sources", [])}
    new = after_ids - before_ids
    assert not new, (
        f"citation added new source entries {sorted(new)} — it must only "
        f"refine existing ones, never create new sources."
    )


# --- Tag-gated assertions on specific source fields -------------------

def test_preserves_src001_original_classification(after_state, test):
    """For the refine-census-citation test, source_classification on
    src_001 must remain 'original' — the 1850 census image IS the
    original (digital image of microfilm of the original schedule).
    Down-classifying it to 'derivative' or 'authored' would be wrong.
    """
    if "preserves-src001-original" not in test.get("tags", []):
        pytest.skip("not a preserves-src001-original scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")
    src = next(
        (s for s in after.get("sources", []) if s.get("id") == "src_001"),
        None,
    )
    assert src is not None, "src_001 not found in after_state.sources"
    assert src.get("source_classification") == "original", (
        f"src_001 source_classification should be 'original'; "
        f"got {src.get('source_classification')!r}"
    )
