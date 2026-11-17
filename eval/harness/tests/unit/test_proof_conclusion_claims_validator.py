"""Direct tests for the per-claim-tier-split validator's claim lookup.

`claim` is a free-text label (proof-conclusion.md), so a label naming the
candidate ("paternity (Thomas Flynn)") is still the paternity claim."""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_proof_conclusion import test_per_claim_tree_encoding as check  # noqa: E402

TAGGED = {"type": "positive", "tags": ["per-claim-tier-split"]}
PC = lambda p, c: {"type": "ParentChild", "parent": p, "child": c}  # noqa: E731


def _state(claims, relationships):
    return {
        "research_json": {"proof_summaries": [{"id": "ps_001", "question_id": "q_001", "claims": claims}]},
        "tree_gedcomx_json": {"relationships": relationships},
    }


BEFORE = {"research_json": {"proof_summaries": []}, "tree_gedcomx_json": {"relationships": []}}


@pytest.mark.parametrize("pat,mat", [
    ("paternity", "maternity"),
    ("paternity (Thomas Flynn)", "maternity (Bridget Flynn)"),
    ("Paternity", " Maternity of Bridget"),
])
def test_finds_the_claims_by_their_label(pat, mat):
    claims = [{"claim": pat, "proof_tier": "probable"}, {"claim": mat, "proof_tier": "not_proved"}]
    check(BEFORE, _state(claims, [PC("I2", "I1")]), TAGGED)


@pytest.mark.parametrize("pat", ["father", "the paternity claim", None])
def test_rejects_a_claim_list_with_no_paternity_label(pat):
    claims = [{"claim": pat, "proof_tier": "probable"}, {"claim": "maternity", "proof_tier": "not_proved"}]
    with pytest.raises(AssertionError, match="no 'paternity' entry"):
        check(BEFORE, _state(claims, [PC("I2", "I1")]), TAGGED)


def test_still_rejects_the_wrong_tier_under_a_long_label():
    claims = [{"claim": "paternity (Thomas Flynn)", "proof_tier": "possible"},
              {"claim": "maternity (Bridget Flynn)", "proof_tier": "not_proved"}]
    with pytest.raises(AssertionError, match="paternity should be 'probable'"):
        check(BEFORE, _state(claims, [PC("I2", "I1")]), TAGGED)
