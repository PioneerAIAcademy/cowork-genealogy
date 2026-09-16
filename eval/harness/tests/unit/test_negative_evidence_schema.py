"""Guard: `research.schema.json`'s negative-evidence conditional must reject.

`evidence_type: "negative"` implies `record_role: "absent"` AND
`informant_proximity: "researcher"` (#986). The rule lives in three places —
the runtime validator, the `research_append` write boundary, and the
`$defs/assertion` `allOf` in BOTH schema trees. The first two carry their own
vitest suites; the schema arm carried none.

That gap was not theoretical. The only document in the repo the conditional
rejected was `flynn-parentage-not-proved` `a_012`, and the same change retags
it — so after the retag, deleting the `allOf` from both trees left `make
engine-test` (3494) and `make harness-test` (3859) entirely green. A check
that cannot fail reads as coverage and is worse than no check at all
(CLAUDE.md, "A new lint must be proven to fail").

These vectors are synthetic on purpose: a fixture-derived one would vanish the
next time someone fixes the fixture, which is exactly how the hole opened.

The vectors satisfy `required` and the `record_role` pattern
(`^[a-z][a-z0-9_]*$`), so nothing BUT the conditional can refuse them — a
vector rejected by `required` or by the pattern would pass with the
conditional deleted and prove nothing.
"""

from __future__ import annotations

import copy

import pytest

from harness.schema_validator import validate_research_json

_SOURCE = {
    "id": "src_001",
    "gedcomx_source_description_id": "S1",
    "citation": "Test citation.",
    "repository": "FamilySearch",
    "url": None,
    "source_classification": "original",
    "access_date": "2026-01-01",
    "log_entry_id": None,
    "citation_detail": {
        "who": "w", "what": "w", "when_created": "1850",
        "when_accessed": "2026-01-01", "where": "w", "where_within": "w",
    },
}

_ASSERTION = {
    "id": "a_001",
    "source_id": "src_001",
    "record_id": "rec1",
    "record_role": "absent",
    "fact_type": "birth",
    "value": "Patrick Flynn absent from the 1870 census where expected",
    "information_quality": "primary",
    "informant": "the researcher",
    "informant_proximity": "researcher",
    "evidence_type": "negative",
    "extracted_for_question_ids": [],
}


def _research(**assertion_overrides) -> dict:
    assertion = copy.deepcopy(_ASSERTION)
    for key, value in assertion_overrides.items():
        if value is _OMIT:
            assertion.pop(key, None)
        else:
            assertion[key] = value
    return {
        "project": {
            "id": "rp_001", "objective": "Test", "status": "active",
            "created": "2026-01-01", "updated": "2026-01-01",
        },
        "questions": [], "plans": [], "log": [],
        "sources": [copy.deepcopy(_SOURCE)],
        "assertions": [assertion],
        "person_evidence": [], "conflicts": [], "hypotheses": [],
        "timelines": [], "proof_summaries": [], "evaluations": [],
    }


class _Omit:
    pass


_OMIT = _Omit()


def _conditional_errors(research: dict) -> list[str]:
    """Only the errors the negative-evidence conditional itself raises."""
    return [
        e for e in validate_research_json(research)
        if "'absent' was expected" in e or "'researcher' was expected" in e
    ]


def test_the_correct_pairing_is_accepted():
    assert validate_research_json(_research()) == []


@pytest.mark.parametrize(
    "overrides,expected",
    [
        ({"record_role": "deceased"}, "'absent' was expected"),
        ({"record_role": "spouse"}, "'absent' was expected"),
        ({"informant_proximity": "official_duty"}, "'researcher' was expected"),
        ({"informant_proximity": "self"}, "'researcher' was expected"),
    ],
)
def test_a_violating_negative_is_rejected(overrides, expected):
    errors = _conditional_errors(_research(**overrides))
    assert errors, (
        f"{overrides} was accepted — the $defs/assertion allOf in "
        f"docs/specs/schemas/research.schema.json is missing or inert"
    )
    assert any(expected in e for e in errors), errors


def test_both_fields_are_reported_when_both_disagree():
    errors = _conditional_errors(
        _research(record_role="deceased", informant_proximity="family_not_present")
    )
    assert len(errors) == 2, errors


# ── The other direction: shapes the conditional must NOT refuse.

def test_a_plain_direct_assertion_is_untouched():
    assert validate_research_json(_research(
        evidence_type="direct", record_role="deceased",
        informant="James Brown", informant_proximity="official_duty",
    )) == []


def test_the_converse_is_not_enforced_here():
    """`absent` + a non-negative evidence_type is left to research_append.

    Forward direction only at this tier: every `absent` assertion in the
    corpus is already negative, so the converse is an unexercised branch.
    """
    assert validate_research_json(_research(
        evidence_type="direct", informant="James Brown",
        informant_proximity="official_duty",
    )) == []


def test_an_indirect_assertion_is_untouched():
    assert validate_research_json(_research(
        evidence_type="indirect", record_role="head_of_household",
        informant="unknown household member",
        informant_proximity="household_member",
    )) == []


def test_a_missing_evidence_type_does_not_match_the_conditional_vacuously():
    """The `required: ["evidence_type"]` inside the `if` is load-bearing.

    Without it an assertion that merely OMITS `evidence_type` matches the `if`
    vacuously and collects two spurious `allOf/0/then` errors on top of the
    real "required property" one.
    """
    errors = validate_research_json(
        _research(evidence_type=_OMIT, record_role="deceased",
                  informant_proximity="self")
    )
    assert any("evidence_type" in e and "required" in e for e in errors), errors
    assert _conditional_errors(_research(
        evidence_type=_OMIT, record_role="deceased", informant_proximity="self"
    )) == [], "the conditional fired on an assertion carrying no evidence_type"
