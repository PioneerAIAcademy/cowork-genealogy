"""Skill-specific validators for the proof-conclusion skill.

proof-conclusion keeps its `rubric.md` — all three dimensions (Tier
justification, Narrative standalone, Evidence completeness) are GPS
craft about whether a proof argument actually meets a standard, and
stay graded by the LLM judge. See
docs/plan/criteria-demotion-and-rubric-opt-in.md.

This file holds the mechanical checks: structural shape of any new
proof_summary (narrative_markdown non-empty, question_id resolves),
plus tag-gated tier assertions for specific test verdicts.

Universal `test_ownership_table` already enforces that proof-conclusion
only writes `project` and `proof_summaries` on research.json (and
sections of tree.gedcomx.json). Universal schema validation enforces
required-field presence and enum values.

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_no_mcp_tools_called(tool_calls):
    """proof-conclusion must not call any MCP tools — pure analysis
    skill that reads research.json and writes a proof_summaries entry
    plus tree.gedcomx.json updates. Frontmatter declares no
    `allowed-tools`."""
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    assert not mcp_calls, (
        f"proof-conclusion should not call MCP tools, but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )


# --- New proof_summary structural checks ------------------------------

def _new_proof_summaries(before_state, after_state):
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        return None
    before_ids = {p.get("id") for p in before.get("proof_summaries", [])}
    return [
        p for p in after.get("proof_summaries", [])
        if p.get("id") not in before_ids
    ]


def test_positive_test_creates_a_proof_summary(before_state, after_state, test):
    """Positive proof-conclusion tests must produce at least one new
    proof_summaries entry. Zero new entries means the skill skipped its
    primary output."""
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    new = _new_proof_summaries(before_state, after_state)
    if new is None:
        pytest.skip("Missing research.json for diff")
    assert new, (
        "proof-conclusion produced no new proof_summaries entry on a "
        "positive test"
    )


def test_new_proof_summary_has_narrative(before_state, after_state, test):
    """Every new proof_summary must have a non-empty narrative_markdown.
    A `proof_summary` with empty narrative is just metadata — defeats
    GPS Step 5's purpose (the conclusion IS the narrative)."""
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    new = _new_proof_summaries(before_state, after_state)
    if not new:
        pytest.skip("no new proof_summaries to check")
    empty = [
        p.get("id") for p in new
        if not (p.get("narrative_markdown") or "").strip()
    ]
    assert not empty, (
        f"new proof_summaries with empty narrative_markdown: {empty}"
    )


# --- Tag-gated tier verdict checks -----------------------------------

def _proof_summary_for_question(after_state, qid):
    after = after_state.get("research_json")
    if after is None:
        return None
    for ps in after.get("proof_summaries", []):
        if ps.get("question_id") == qid:
            return ps
    return None


def test_q001_probable_tier(after_state, test):
    """For the write-parentage-proof test: the proof summary for q_001
    must have tier == 'probable'. Research is not yet exhaustive
    (1870/1880/1900 censuses + probate still pending) so 'proved' is
    too strong; three independent sources converge so 'possible' is
    too weak."""
    if "tier-probable-q001" not in test.get("tags", []):
        pytest.skip("not a tier-probable-q001 scenario")
    ps = _proof_summary_for_question(after_state, "q_001")
    assert ps is not None, (
        "no proof_summaries entry for q_001 found in after_state"
    )
    assert ps.get("tier") == "probable", (
        f"q_001 proof tier should be 'probable' (research not yet "
        f"exhaustive); got {ps.get('tier')!r}"
    )


def test_q001_proved_tier(after_state, test):
    """For the proved-tier-with-exhaustive-search test: the proof summary
    for q_001 must have tier == 'proved'. The flynn-resolved scenario
    has exhaustive_declaration populated with stop_criteria and the
    negative-probate search completed — the search is reasonably
    exhaustive and three independent sources converge."""
    if "tier-proved-q001" not in test.get("tags", []):
        pytest.skip("not a tier-proved-q001 scenario")
    ps = _proof_summary_for_question(after_state, "q_001")
    assert ps is not None, (
        "no proof_summaries entry for q_001 found in after_state"
    )
    assert ps.get("tier") == "proved", (
        f"q_001 proof tier should be 'proved' (exhaustive search "
        f"complete, three converging sources); got {ps.get('tier')!r}"
    )
