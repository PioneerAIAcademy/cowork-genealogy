"""Direct tests for the hypothesis-tracking `supported` evidence-floor validator.

Same reason as `test_proof_conclusion_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: issue #1644's widened `supported` gate — a hypothesis needs
either one direct supporting assertion, or two indirect ones citing two
distinct sources, and no unresolved conflict naming its own linked
assertions. The conflict half is matched by assertion overlap, never by a
shared `question_id` — `test_ignores_a_conflict_that_only_shares_a_question`
below is the `flynn-unresolved-conflict` fixture shape made mechanical.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_hypothesis_tracking import (  # noqa: E402
    test_supported_requires_evidence_floor as check,
)


def _hyp(status="supported", supporting=None, contradicting=None):
    return {
        "id": "h_001",
        "status": status,
        "supporting_assertion_ids": supporting or [],
        "contradicting_assertion_ids": contradicting or [],
    }


def _assertion(aid, evidence_type, source_id="src_001"):
    return {"id": aid, "evidence_type": evidence_type, "source_id": source_id}


def _after(hypotheses, assertions=None, conflicts=None):
    return {
        "research_json": {
            "hypotheses": hypotheses,
            "assertions": assertions or [],
            "conflicts": conflicts or [],
        }
    }


def test_accepts_one_direct_supporting_assertion():
    h = _hyp(supporting=["a_001"])
    assertions = [_assertion("a_001", "direct")]
    check({}, _after([h], assertions))


def test_accepts_two_indirect_from_two_distinct_sources():
    h = _hyp(supporting=["a_001", "a_002"])
    assertions = [
        _assertion("a_001", "indirect", source_id="src_001"),
        _assertion("a_002", "indirect", source_id="src_002"),
    ]
    check({}, _after([h], assertions))


def test_rejects_two_indirect_from_the_same_source():
    h = _hyp(supporting=["a_001", "a_002"])
    assertions = [
        _assertion("a_001", "indirect", source_id="src_001"),
        _assertion("a_002", "indirect", source_id="src_001"),
    ]
    with pytest.raises(AssertionError, match="1 distinct"):
        check({}, _after([h], assertions))


def test_rejects_a_single_indirect_assertion():
    h = _hyp(supporting=["a_001"])
    assertions = [_assertion("a_001", "indirect")]
    with pytest.raises(AssertionError, match="1 distinct"):
        check({}, _after([h], assertions))


def test_rejects_no_supporting_evidence_at_all():
    h = _hyp(supporting=[])
    with pytest.raises(AssertionError, match="supported evidence floor violated"):
        check({}, _after([h], []))


def test_rejects_an_unresolved_conflict_naming_a_supporting_assertion():
    h = _hyp(supporting=["a_001"])
    assertions = [_assertion("a_001", "direct")]
    conflicts = [
        {
            "id": "c_001",
            "status": "unresolved",
            "competing_assertion_ids": ["a_001"],
        }
    ]
    with pytest.raises(AssertionError, match="c_001.*unresolved"):
        check({}, _after([h], assertions, conflicts))


@pytest.mark.parametrize("status", ["resolved", "moot"])
def test_accepts_a_resolved_or_moot_conflict_naming_an_assertion(status):
    h = _hyp(supporting=["a_001"])
    assertions = [_assertion("a_001", "direct")]
    conflicts = [
        {"id": "c_001", "status": status, "competing_assertion_ids": ["a_001"]}
    ]
    check({}, _after([h], assertions, conflicts))


def test_ignores_a_conflict_that_only_shares_a_question():
    """The `flynn-unresolved-conflict` shape: c_001 is unresolved and blocks
    the same question h_001 answers, but names entirely different
    assertions. Matching by question instead of by assertion would wrongly
    flag this fixture — it must not."""
    h = _hyp(supporting=["a_004", "a_010", "a_013"])
    assertions = [
        _assertion("a_004", "indirect", source_id="src_001"),
        _assertion("a_010", "indirect", source_id="src_003"),
        _assertion("a_013", "direct", source_id="src_004"),
    ]
    conflicts = [
        {
            "id": "c_001",
            "status": "unresolved",
            "competing_assertion_ids": ["a_002", "a_009", "a_012"],
            "blocks_question_ids": ["q_001"],
        }
    ]
    check({}, _after([h], assertions, conflicts))


def test_ignores_a_hypothesis_that_is_not_supported():
    """One-directional: `active` with zero evidence is not this validator's
    business — the third gate condition and the promotion decision itself
    are judgment calls left to the skill and the judge."""
    h = _hyp(status="active", supporting=[])
    check({}, _after([h], []))


def test_skips_when_research_json_is_absent():
    with pytest.raises(BaseException) as exc:  # pytest.skip raises Skipped
        check({}, {"research_json": None})
    assert "No research.json in output" in str(exc.value)
