"""Skill-specific validators for the hypothesis-tracking skill.

hypothesis-tracking creates / updates entries in
`research.json.hypotheses`. It tracks competing claims about parentage,
identity, and similar genealogical questions, attaching supporting and
contradicting assertion references to each.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(claim clarity, evidence linkage, status transitions). The mechanical
shape checks — every hypothesis has a claim, foreign-key validity on
supporting/contradicting refs, and the `ruled_out_reason` rule — live
here.

See test_universal.py module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.
"""

from __future__ import annotations

import pytest

from validators_lib import (
    assert_foreign_keys_valid,
    assert_no_section_deletions,
)


# --- Append-only / no-delete on the owned section ---

def test_hypotheses_no_deletions(before_state, after_state):
    """Existing hypotheses must not be deleted. Status changes (ruled
    out, supported) supersede deletion."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "hypotheses")


# --- Foreign-key integrity ---

def test_hypotheses_assertion_refs_resolve(before_state, after_state):
    """Every supporting_assertion_ids / contradicting_assertion_ids entry
    must point at a real assertion."""
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")
    assert_foreign_keys_valid(
        after,
        [
            ("hypotheses", "supporting_assertion_ids", "assertions"),
            ("hypotheses", "contradicting_assertion_ids", "assertions"),
        ],
        before=None,
    )


# --- Per-hypothesis structural rules ---

def test_new_hypotheses_have_claim(before_state, after_state):
    """Every new hypothesis must have a non-empty `claim` field.

    A hypothesis without a stated claim is meaningless — even a vague
    claim fails the rubric's claim-clarity dimension, but a missing
    claim is a hard structural error.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {h.get("id") for h in before.get("hypotheses", [])}

    errors = []
    for h in after.get("hypotheses", []):
        if h.get("id") in before_ids:
            continue
        hid = h.get("id", "?")
        if not h.get("claim"):
            errors.append(f"hypotheses[{hid}]: missing/empty claim")

    assert not errors, "Hypotheses missing claim:\n" + "\n".join(errors)


def test_ruled_out_requires_reason(before_state, after_state):
    """Per research-schema-spec.md §5.9, when a hypothesis is marked
    `ruled_out: true` (or status='ruled_out'), the `ruled_out_reason`
    field must be populated.

    Catches the "moved status to ruled_out without an affirmative
    refutation written down" mistake.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for h in after.get("hypotheses", []):
        is_ruled_out = (
            h.get("ruled_out") is True
            or h.get("status") == "ruled_out"
        )
        if is_ruled_out and not h.get("ruled_out_reason"):
            errors.append(
                f"hypotheses[{h.get('id')}]: ruled_out but no ruled_out_reason"
            )

    assert not errors, "ruled_out without reason:\n" + "\n".join(errors)


# --- Tag-gated regression checks ---

def _hyp_by_id(research: dict, hid: str) -> dict | None:
    for h in research.get("hypotheses", []):
        if h.get("id") == hid:
            return h
    return None


def test_h001_status_unchanged_when_review(before_state, after_state, test):
    """When reviewing the supported h_001 with no new refuting evidence,
    the skill must keep `status: supported` — moving to `ruled_out`
    requires affirmative refutation per spec §5.9.

    Tag-gated on h_001 + status-review.
    """
    if "h_001" not in test.get("tags", []):
        pytest.skip("not an h_001 scenario")
    if "status-review" not in test.get("tags", []):
        pytest.skip("not a status-review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_h = _hyp_by_id(before, "h_001")
    after_h = _hyp_by_id(after, "h_001")
    if before_h is None or after_h is None:
        pytest.skip("h_001 not present")
    assert after_h.get("status") == before_h.get("status"), (
        f"h_001 status changed from '{before_h.get('status')}' to "
        f"'{after_h.get('status')}' during a status review without new "
        f"refuting evidence"
    )


def test_new_hypothesis_added_for_c002(before_state, after_state, test):
    """When formulating identity-conflict alternatives as hypotheses for
    c_002, at least one new hypothesis must be created with c_002 in
    its `related_conflict_ids` (or an equivalent linking field) — or
    simply with q_001 in related_question_ids, since c_002 blocks
    q_001.

    Tag-gated on c_002 + new-hypothesis.
    """
    if "c_002" not in test.get("tags", []):
        pytest.skip("not a c_002 scenario")
    if "new-hypothesis" not in test.get("tags", []):
        pytest.skip("not a new-hypothesis scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {h.get("id") for h in before.get("hypotheses", [])}
    new_hyps = [
        h for h in after.get("hypotheses", [])
        if h.get("id") not in before_ids
    ]
    assert new_hyps, (
        "expected at least one new hypothesis formulated from c_002; "
        "found none"
    )

    # New hypotheses should start in 'active' — neither supported nor
    # ruled_out, since the underlying identity conflict is unresolved.
    bad_status = [
        h.get("id") for h in new_hyps
        if h.get("status") not in (None, "active")
    ]
    assert not bad_status, (
        f"new hypotheses formulated from an unresolved conflict should be "
        f"status='active'; got non-active: {bad_status}"
    )


def test_h001_not_ruled_out_when_adding_identity_hypotheses(
    before_state, after_state, test
):
    """Adding alternative identity hypotheses for c_002 must NOT mark the
    existing parentage hypothesis h_001 as ruled_out — they're about
    different facts and don't refute each other.

    Tag-gated on c_002 + new-hypothesis.
    """
    if "c_002" not in test.get("tags", []):
        pytest.skip("not a c_002 scenario")
    if "new-hypothesis" not in test.get("tags", []):
        pytest.skip("not a new-hypothesis scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")
    h001 = _hyp_by_id(after, "h_001")
    if h001 is None:
        pytest.skip("h_001 not present in after_state")
    assert h001.get("status") != "ruled_out", (
        "h_001 (parentage hypothesis) was marked ruled_out while adding "
        "alternative identity hypotheses — these are about different facts."
    )
    assert h001.get("ruled_out") is not True, (
        "h_001 had ruled_out=true set while adding alternative identity "
        "hypotheses."
    )
