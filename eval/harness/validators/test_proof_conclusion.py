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


# --- Tool allowlist ---
#
# `test_no_mcp_tools_called` was removed: it forbade every MCP tool except
# validate_research_schema, which predated proof-conclusion's migration to
# the `research_append` write tool (commit 86c741d). It is now both wrong
# (research_append is a sanctioned write path in this skill's allowed-tools)
# and redundant with the universal `test_tool_allowlist` + `test_ownership_table`
# checks in test_universal.py, which enforce the real invariant: every call
# must match the skill's declared allowed-tools, and writes stay within
# proof-conclusion's owned sections. Same removal already applied to
# conflict-resolution.


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
    primary output.

    Exempt: tests tagged `no-new-proof-expected`, where the correct
    behavior is NOT to write a new summary — re-invocation that updates an
    existing summary in place (`reinvocation-dedup`), a precondition block
    that defers to another skill (`conflict-blocks-proved`), or a request
    to assess an existing proof against the GPS (`gps-review`)."""
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    if "no-new-proof-expected" in test.get("tags", []):
        pytest.skip("test is tagged no-new-proof-expected")
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


def test_q001_possible_tier(after_state, test):
    """For the thin-evidence test: the proof summary for q_001 must have
    tier == 'possible'. A single uncorroborated indirect co-residence (the
    1850 census alone) is a credible lead but cannot support 'probable'; it
    still leans toward Thomas, so it is stronger than 'not_proved'."""
    if "tier-possible-q001" not in test.get("tags", []):
        pytest.skip("not a tier-possible-q001 scenario")
    ps = _proof_summary_for_question(after_state, "q_001")
    assert ps is not None, "no proof_summaries entry for q_001 found in after_state"
    assert ps.get("tier") == "possible", (
        f"q_001 proof tier should be 'possible' (one uncorroborated "
        f"indirect source); got {ps.get('tier')!r}"
    )


def test_q001_not_proved_tier(after_state, test):
    """For the rival-candidates test: the proof summary for q_001 must have
    tier == 'not_proved'. Two equally-plausible candidate fathers that the
    evidence cannot distinguish means there is no basis to lean."""
    if "tier-not-proved-q001" not in test.get("tags", []):
        pytest.skip("not a tier-not-proved-q001 scenario")
    ps = _proof_summary_for_question(after_state, "q_001")
    assert ps is not None, "no proof_summaries entry for q_001 found in after_state"
    assert ps.get("tier") == "not_proved", (
        f"q_001 proof tier should be 'not_proved' (two undistinguished "
        f"candidate fathers); got {ps.get('tier')!r}"
    )


def test_q001_disproved_tier(after_state, test):
    """For the chronological-impossibility test: the proof summary for q_001
    must have tier == 'disproved'. The candidate father was buried in 1842;
    the child was born ~1845 — the hypothesis is affirmatively refuted."""
    if "tier-disproved-q001" not in test.get("tags", []):
        pytest.skip("not a tier-disproved-q001 scenario")
    ps = _proof_summary_for_question(after_state, "q_001")
    assert ps is not None, "no proof_summaries entry for q_001 found in after_state"
    assert ps.get("tier") == "disproved", (
        f"q_001 proof tier should be 'disproved' (father died before the "
        f"child was born); got {ps.get('tier')!r}"
    )


# --- Tree write-back invariant ----------------------------------------
#
# proof-conclusion updates tree.gedcomx.json ONLY when the tier reaches
# `probable` or higher. Below that (possible / not_proved / disproved) it
# must leave the tree untouched. The two tags below pin both directions:
#   `no-tree-write`       — the tree must be byte-identical before and after
#   `tree-write-expected` — the concluded ParentChild relationship must be
#                           ADDED by the skill: absent in the pre-state,
#                           present afterward (catches found-but-lost)

def _tree(state):
    return state.get("tree_gedcomx_json") or state.get("tree_gedcomx")


def test_no_tree_write_below_probable(before_state, after_state, test):
    """Tagged `no-tree-write`: at `possible`/`not_proved`/`disproved` the
    skill must not modify tree.gedcomx.json at all. The corresponding
    scenarios deliberately ship a pre-state tree with no concluded
    ParentChild relationship, so a correct run leaves the tree identical."""
    if "no-tree-write" not in test.get("tags", []):
        pytest.skip("not a no-tree-write scenario")
    before = _tree(before_state)
    after = _tree(after_state)
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "tree.gedcomx.json was modified by a below-probable conclusion — "
        "the tree must only be written at tier `probable` or higher"
    )


def test_tree_relationship_written_at_probable_plus(before_state, after_state, test):
    """Tagged `tree-write-expected`: at `probable`/`proved` proof-conclusion
    must WRITE the concluded parentage into the tree as a ParentChild
    relationship (parent I2 -> child I1). The scenarios ship the persons
    (I1, I2) present but with NO parentage relationship, so this verifies the
    skill actually *added* it — absent in the pre-state, present in the
    post-state.

    That absent->present check is what catches a "found-but-lost" run that
    concludes in the proof-summary narrative but skips the tree write
    (proof-conclusion SKILL.md §6): such a run leaves the persons unlinked and
    fails here even though it produced a proof_summary. A weaker
    present-in-after check would pass a skipped write whenever the scenario
    pre-loaded the link — which is exactly how the elizabeth-geach e2e
    found-but-lost slipped past the suite."""
    if "tree-write-expected" not in test.get("tags", []):
        pytest.skip("not a tree-write-expected scenario")
    after = _tree(after_state)
    if after is None:
        pytest.skip("Missing tree.gedcomx.json")

    def has_pc(tree):
        return any(
            r.get("type") == "ParentChild"
            and r.get("parent") == "I2"
            and r.get("child") == "I1"
            for r in (tree or {}).get("relationships", [])
        )

    before = _tree(before_state)
    # Guard the guard: the scenario MUST ship the relationship absent, or a
    # skipped write is undetectable. Fail loudly if someone re-pre-loads it.
    assert before is not None and not has_pc(before), (
        "scenario pre-state already contains the concluded ParentChild "
        "relationship (parent I2 -> child I1); a `tree-write-expected` "
        "scenario must ship the persons WITHOUT the relationship so this "
        "guard can verify the skill *added* it (absent -> present)"
    )
    assert has_pc(after), (
        "proof-conclusion concluded at probable/proved but did NOT write the "
        "ParentChild relationship (parent I2 -> child I1) into "
        "tree.gedcomx.json — the conclusion reached the proof summary but "
        "never the tree (found-but-lost; see proof-conclusion SKILL.md §6). "
        f"post-state relationships={after.get('relationships', [])!r}"
    )


# --- Re-invocation and precondition checks ----------------------------

def test_reinvocation_no_duplicate_proof(after_state, test):
    """Tagged `reinvocation-dedup`: re-invoking on a question that already
    has a proof summary must update it in place, never create a second
    summary for the same question. There must be exactly one
    proof_summaries entry for q_001 afterward."""
    if "reinvocation-dedup" not in test.get("tags", []):
        pytest.skip("not a reinvocation-dedup scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("Missing research.json")
    for_q = [
        ps for ps in after.get("proof_summaries", [])
        if ps.get("question_id") == "q_001"
    ]
    assert len(for_q) == 1, (
        f"expected exactly one proof_summary for q_001 after re-invocation "
        f"(update in place, no duplicate); found {len(for_q)}: "
        f"{[ps.get('id') for ps in for_q]}"
    )


def test_conflict_blocks_proved(after_state, test):
    """Tagged `conflict-blocks-proved`: with an unresolved conflict that
    blocks the question, the skill must not declare `proved`. Any proof
    summary for q_001 must be at a tier below proved (or absent, if the
    skill deferred to conflict-resolution)."""
    if "conflict-blocks-proved" not in test.get("tags", []):
        pytest.skip("not a conflict-blocks-proved scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("Missing research.json")
    proved = [
        ps for ps in after.get("proof_summaries", [])
        if ps.get("question_id") == "q_001" and ps.get("tier") == "proved"
    ]
    assert not proved, (
        "proof-conclusion declared q_001 `proved` while an unresolved "
        "conflict (c_001) blocks it — unresolved conflicts hard-block the "
        "proved tier"
    )
