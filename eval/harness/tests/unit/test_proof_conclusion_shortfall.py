"""Direct tests for the `shortfall` consistency validator.

Same reason as the sibling validator tests: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears only
inside a paid per-skill run.

What this guards. `shortfall` is a required field on every proof summary, so the
write boundary already refuses one that is MISSING -- `research_append` is live
in the unit harness. Nothing checked whether the value is RIGHT. Without that,
the agent could write `shortfall: "ceiling"` ("the reachable record is
exhausted") on `probable-tier-research-not-exhaustive`, whose own scenario says
research is not exhaustive, and the paid run would come back green.

The rule is derived from the document's own state, never from the tier alone --
the same derivation the corpus backfill used, and for the same reason: a
`ceiling` asserted over a document that denies exhaustiveness is exactly the
false claim this field was added to expose.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_proof_conclusion import test_shortfall_matches_document_state as check  # noqa: E402

TEST = {"type": "positive", "tags": ["proof"]}


def _after(*, tier="probable", shortfall="gap", declared=False, conflicts=None,
           qid="q_001", claims=None):
    summary = {
        "id": "ps_001",
        "question_id": qid,
        "tier": tier,
        "vehicle": "summary",
        "shortfall": shortfall,
    }
    if claims is not None:
        summary["claims"] = claims
    return {
        "research_json": {
            "proof_summaries": [summary],
            "questions": [
                {"id": qid, "exhaustive_declaration": {"declared": declared}}
            ],
            "conflicts": conflicts or [],
        }
    }


def _blocking(qid="q_001", status="unresolved"):
    return [{"id": "c_001", "status": status, "blocks_question_ids": [qid]}]


# ── the CONCLUSIVE tiers take `none`, both directions ────────────────
#
# `proved` and `disproved` are both terminal answers: one establishes the
# claim, the other affirmatively refutes it. Neither has anything "holding it
# back", so both take `none` and nothing else. `not_proved` is NOT conclusive
# -- it means the evidence will not support a call either way, which is
# exactly a shortfall -- so it is grouped with the rest.
#
# This distinction cost a paid run to learn: the first version of this rule
# said `none` only on `proved`, and the agent correctly wrote `none` on a
# disproved conclusion in ut_proof_conclusion_006 and _013. The agent was
# right and the rule was wrong.


def test_conclusive_tiers_with_none_pass():
    for tier in ("proved", "disproved"):
        check(_after(tier=tier, shortfall="none", declared=True), TEST)


def test_conclusive_tiers_with_anything_else_fail():
    for tier in ("proved", "disproved"):
        for bad in ("ceiling", "gap", "conflict"):
            with pytest.raises(AssertionError, match="conclusive|none"):
                check(_after(tier=tier, shortfall=bad, declared=True), TEST)


def test_none_on_an_inconclusive_tier_fails():
    # `none` says "nothing is holding this back", which is false of every tier
    # that did not reach an answer. `not_proved` is the one worth naming: it is
    # a non-answer, not a negative answer, so it always has a shortfall.
    for tier in ("probable", "possible", "not_proved"):
        with pytest.raises(AssertionError, match="none"):
            check(_after(tier=tier, shortfall="none", declared=True), TEST)


# ── the GPS rule: no ceiling over a document that denies exhaustion ──


def test_a_disproved_conclusion_is_not_forced_to_name_a_gap():
    # Regression guard for the rule this file got wrong: an undeclared
    # question does NOT drag a disproved conclusion into `gap`. A chronological
    # impossibility refutes the claim whatever else went unsearched.
    check(_after(tier="disproved", shortfall="none", declared=False), TEST)


def test_ceiling_with_declared_exhaustive_passes():
    check(_after(tier="probable", shortfall="ceiling", declared=True), TEST)


def test_ceiling_without_declared_exhaustive_fails():
    # The defect the field exists to expose, and the one the corpus backfill
    # would have written onto 34 of 38 fixtures under the rule first proposed.
    with pytest.raises(AssertionError, match="ceiling"):
        check(_after(tier="probable", shortfall="ceiling", declared=False), TEST)


def test_gap_without_declared_exhaustive_passes():
    check(_after(tier="probable", shortfall="gap", declared=False), TEST)


def test_gap_with_declared_exhaustive_passes():
    # Not an error: a question can be declared exhaustive while the conclusion
    # still names a reachable source it did not reach. Only `ceiling` makes the
    # stronger claim, so only `ceiling` is constrained.
    check(_after(tier="probable", shortfall="gap", declared=True), TEST)


# ── conflict ─────────────────────────────────────────────────────────


def test_blocking_unresolved_conflict_requires_conflict():
    with pytest.raises(AssertionError, match="conflict"):
        check(_after(shortfall="gap", conflicts=_blocking()), TEST)


def test_blocking_unresolved_conflict_with_conflict_passes():
    check(_after(shortfall="conflict", conflicts=_blocking()), TEST)


def test_a_resolved_conflict_does_not_require_conflict():
    check(_after(shortfall="gap", conflicts=_blocking(status="resolved")), TEST)


def test_a_conflict_blocking_another_question_does_not_require_conflict():
    # Question-scoped, per proof-conclusion's decision rules: a conflict open
    # on a different question does not bear on this conclusion.
    check(_after(shortfall="gap", conflicts=_blocking(qid="q_002")), TEST)


# ── shape robustness ────────────────────────────────────────────────


def test_no_proof_summaries_is_not_a_failure():
    # Several proof-conclusion tests are `no-new-proof-expected` or routing
    # negatives. This validator must say nothing about them rather than fail
    # them for a field they were never meant to write.
    check({"research_json": {"proof_summaries": []}}, TEST)
    check({"research_json": {}}, TEST)


def test_a_summary_whose_question_is_missing_is_skipped_not_failed():
    state = _after(shortfall="ceiling", declared=False)
    state["research_json"]["questions"] = []
    check(state, TEST)


def test_per_claim_shortfall_is_checked_when_present():
    with pytest.raises(AssertionError, match="claims"):
        check(
            _after(
                tier="probable",
                shortfall="gap",
                declared=False,
                claims=[{"claim": "paternity", "proof_tier": "probable",
                         "shortfall": "ceiling"}],
            ),
            TEST,
        )


def test_per_claim_shortfall_absent_is_fine():
    check(
        _after(claims=[{"claim": "paternity", "proof_tier": "probable"}]),
        TEST,
    )
