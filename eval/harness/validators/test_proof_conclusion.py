"""Skill-specific validators for the proof-conclusion skill.

proof-conclusion keeps its `rubric.md` — all three dimensions (Tier
justification, Narrative standalone, Evidence completeness) are GPS
craft about whether a proof argument actually meets a standard, and
stay graded by the LLM judge.

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
    # Source-description (S entry) metadata is not a conclusion — a
    # sources-only diff (e.g. citation backfill on an existing S) is
    # permitted below probable; facts/relationships/persons are not.
    def _without_sources(tree):
        return {k: v for k, v in tree.items() if k != "sources"}
    assert _without_sources(before) == _without_sources(after), (
        "tree.gedcomx.json facts/relationships/persons were modified by a "
        "below-probable conclusion — the tree (beyond source-description "
        "metadata) must only be written at tier `probable` or higher"
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
    """Tagged `conflict-blocks-proved`: an unresolved conflict on an
    IDENTIFYING attribute blocks the conclusion outright, and the blocked
    attempt is recorded at `not_proved`.

    Three assertions, deliberately deterministic. Every one of them was a
    judge-graded nuance before, and the test flip-flopped across four runs on
    exactly these points while the skill produced three different behaviours:
    concluding at probable, declining silently, and resolving the conflict
    itself.

    The rule (lead ruling, 2026-08-19): correlation presupposes identity, so
    sources whose identity to one another is unsettled cannot be correlated at
    any tier. Tiering down does not fix it — tiering happens after identity is
    established. `probable` is NOT an acceptable hedge here, which is what the
    earlier version of this check allowed by testing only for `proved`.
    """
    if "conflict-blocks-proved" not in test.get("tags", []):
        pytest.skip("not a conflict-blocks-proved scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("Missing research.json")

    for_q = [
        ps for ps in after.get("proof_summaries", [])
        if ps.get("question_id") == "q_001"
    ]
    # 1. The attempt is recorded. A silent decline loses the reasoning.
    assert for_q, (
        "proof-conclusion recorded nothing for q_001. A blocked conclusion is "
        "still a research finding: write a `not_proved` summary naming the "
        "conflict and what would settle it, then route to conflict-resolution."
    )
    # 2. At not_proved — not proved, and not probable either.
    bad = [ps for ps in for_q if ps.get("tier") != "not_proved"]
    assert not bad, (
        "proof-conclusion concluded q_001 at "
        f"{[ps.get('tier') for ps in bad]} while an unresolved conflict on an "
        "identifying attribute (c_001, birthplace) is open. The disputed "
        "attribute goes to whether the cited sources describe the same person, "
        "so no tier is available — record it at `not_proved`."
    )
    # 3. The question stays open — resolving it is the downstream step's call.
    q = next((x for x in after.get("questions", []) if x.get("id") == "q_001"), None)
    if q is not None:
        assert q.get("status") != "resolved" and not q.get("resolved"), (
            "proof-conclusion marked q_001 resolved on a blocked conclusion. "
            "The question stays open until the conflict is adjudicated."
        )



def test_bounded_conclusion_is_tiered_and_encoded(after_state, test):
    """Tagged `bounded-conclusion`: a well-supported bounded finding is tiered
    at `probable` or better AND lands in the tree as a fact carrying the
    bracket.

    Both halves are one rule. The tier says whether a finding was reached; the
    encoding says whether it reached the researcher's tree. A bounded finding
    can be honestly uncertain about WHERE INSIDE the range the event falls while
    being certain the event happened — so it encodes at `possible` too, carrying
    the range verbatim as the fact's date (lead ruling, 2026-08-21). What it may
    not do is collapse to `not_proved` because the exact value is unreachable,
    or reach a tier and never touch the tree.

    `possible` is the expected tier for the committed fixture, and for a reason
    worth keeping: a reachable, unsearched 1880 census would halve its bracket,
    which is a Component 1 failure rather than a corroboration gap. A bracket
    with a named record that would narrow it is not reasonably exhaustive.

    Deterministic on purpose — both halves were judge-graded before, and the
    test failed on 2026-08-19 with a rationale that misread its own fixture.
    """
    if "bounded-conclusion" not in test.get("tags", []):
        pytest.skip("not a bounded-conclusion scenario")
    after = after_state.get("research_json")
    tree = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if after is None or tree is None:
        pytest.skip("Missing research.json or tree.gedcomx.json")

    summaries = [
        ps for ps in after.get("proof_summaries", [])
        if ps.get("question_id") == "q_001"
    ]
    assert summaries, "no proof summary written for q_001"

    ACCEPTED = {"possible", "probable", "proved"}
    tiers = [ps.get("tier") for ps in summaries]
    assert any(t in ACCEPTED for t in tiers), (
        f"bounded conclusion tiered {tiers} — a bounded finding is tiered on the "
        "strength of what CAN be established (the bracket, the documented "
        "negative), not on the unreachable exact value. `not_proved` says no "
        "finding was reached; a defensible range IS a finding."
    )

    facts = [
        f
        for p in tree.get("persons", [])
        if p.get("id") == "I1"
        for f in p.get("facts", []) or []
    ]
    deaths = [f for f in facts if f.get("type") == "Death"]
    assert deaths, (
        "no Death fact on I1 — the conclusion exists only in the narrative and "
        "the tree is silent on the vital event the question asked about. Encode "
        "the bracket as the fact's date. A `possible` tier is NOT a reason to "
        "skip this: the probable threshold asks whether a conclusion was "
        "reached, and a bracket is one."
    )
    assert any(str(f.get("date") or "").strip() for f in deaths), (
        "the Death fact on I1 carries no date — the bracket IS the finding, so "
        "it belongs in the date (e.g. 'after 1870, before 1885')."
    )

# --- Tag-gated: research_query tool coverage (SKILL.md §1) -------------

def test_research_query_called_for_coverage(tool_calls, test):
    """Tag-gated (research-query-coverage): the skill must actually call
    research_query to gather a question's accumulated evidence, not fall
    back to a whole-file Read of research.json (SKILL.md §1).

    Deterministic regression catch — not judge-graded — for a future
    SKILL.md edit that reverts to a raw Read or drops the scoped lookup:
    such an edit produces zero research_query calls, and this assertion
    flips. Substring match on the tool name so it holds under any MCP
    server-prefix spelling.
    """
    if "research-query-coverage" not in test.get("tags", []):
        pytest.skip("not a research_query coverage test")
    called = [tc["tool"] for tc in tool_calls if "research_query" in tc.get("tool", "")]
    assert called, (
        "research-query-coverage test made no research_query call — "
        "proof-conclusion must gather the question's evidence via scoped "
        "research_query, not a whole-file Read of research.json (SKILL.md §1)."
    )

# --- Open-candidate invariant (routing-flaky negatives) ----------------
#
# For a `grade_on_invariant` negative where the request is an ACCOUNT of
# competing candidates, not a conclusion: whichever skill answers, the
# question must not be closed out while a rival hypothesis is still
# `active`. Routing is deliberately not graded (proof-conclusion may fire
# and correctly decline, or hypothesis-tracking may fire) — only the
# resulting state is. That is what makes the test immune to which of two
# plausible routes the model picks, while still failing the one outcome
# that is actually wrong.
#
# hypotheses[] is deliberately NOT asserted: hypothesis-tracking owns that
# section and may legitimately record evidence against h_002 in the course
# of answering.

_TIER_RANK = {
    "disproved": 0,
    "not_proved": 1,
    "possible": 2,
    "probable": 3,
    "proved": 4,
}


def test_open_candidate_blocks_closure(before_state, after_state, test):
    """Tagged `hypothesis-open-blocks-tier`: while a competing hypothesis is
    still `active`, no route may close the question out — no second proof
    summary for it, no tier advanced above what the pre-state already held,
    and the question not marked resolved."""
    if "hypothesis-open-blocks-tier" not in test.get("tags", []):
        pytest.skip("not a hypothesis-open-blocks-tier scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    open_h = [
        h.get("id")
        for h in (before.get("hypotheses") or [])
        if h.get("status") == "active"
    ]
    assert open_h, (
        "fixture error: this tag asserts an invariant that only holds while a "
        "hypothesis is `active`, and the pre-state has none — the test would "
        "pass vacuously"
    )

    qid = "q_001"
    before_ps = [
        ps for ps in (before.get("proof_summaries") or [])
        if ps.get("question_id") == qid
    ]
    after_ps = [
        ps for ps in (after.get("proof_summaries") or [])
        if ps.get("question_id") == qid
    ]

    assert len(after_ps) <= len(before_ps), (
        f"a proof summary was added for {qid} while {', '.join(open_h)} is "
        f"still `active` — an account of competing candidates is not a "
        f"conclusion, and there is no settled answer to conclude"
    )

    if before_ps and after_ps:
        was = _TIER_RANK.get(before_ps[0].get("tier"), -1)
        now = _TIER_RANK.get(after_ps[0].get("tier"), -1)
        assert now <= was, (
            f"{qid}'s tier advanced from {before_ps[0].get('tier')!r} to "
            f"{after_ps[0].get('tier')!r} while {', '.join(open_h)} is still "
            f"`active` — a rival candidate that has not been ruled out cannot "
            f"support a stronger conclusion"
        )

    q = next(
        (x for x in (after.get("questions") or []) if x.get("id") == qid), None
    )
    if q is not None:
        assert q.get("status") != "resolved" and not q.get("resolved"), (
            f"{qid} was marked resolved while {', '.join(open_h)} is still "
            f"`active`"
        )
