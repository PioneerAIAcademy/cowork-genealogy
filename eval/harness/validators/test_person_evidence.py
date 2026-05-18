"""Skill-specific validators for the person-evidence skill.

These check structural invariants that should hold for every
person-evidence test, regardless of the specific test case.

See test_universal.py module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

person-evidence creates / updates entries in `research.json.person_evidence`,
linking assertions (in research.json) to persons (in tree.gedcomx.json).
Ownership of the `person_evidence` section is enforced by
test_universal.py::test_ownership_table; this file holds the structural
rules + tag-gated regression checks.
"""

from __future__ import annotations

import pytest

from validators_lib import (
    assert_foreign_keys_valid,
    assert_no_section_deletions,
)


# --- Append-only / no-delete on the owned section ---

def test_person_evidence_no_deletions(before_state, after_state):
    """Existing person_evidence entries must not be deleted.

    person-evidence may modify in place (e.g., upgrade confidence after
    new evidence comes in) but must not drop entries — that would erase
    the evidence trail back to a person.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "person_evidence")


# --- Foreign-key integrity for new person_evidence entries ---

def test_new_person_evidence_references_valid_assertion(before_state, after_state):
    """Every new person_evidence entry's assertion_id must resolve.

    The whole point of person_evidence is to bind an assertion to a
    person; a dangling assertion_id makes the binding meaningless.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("person_evidence", "assertion_id", "assertions")],
        before=before,
    )


# --- Per-entry structural rules ---

def test_new_person_evidence_have_required_fields(before_state, after_state):
    """Every new person_evidence entry must have person_id, assertion_id,
    confidence, and a non-empty rationale.

    A pe entry without person_id or assertion_id is structurally broken.
    Missing confidence collapses the confidence-calibration grading. An
    empty rationale defeats the audit-trail purpose of person_evidence.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {e.get("id") for e in before.get("person_evidence", [])}

    errors = []
    for e in after.get("person_evidence", []):
        if e.get("id") in before_ids:
            continue
        eid = e.get("id", "?")
        if not e.get("person_id"):
            errors.append(f"person_evidence[{eid}]: missing person_id")
        if not e.get("assertion_id"):
            errors.append(f"person_evidence[{eid}]: missing assertion_id")
        if not e.get("confidence"):
            errors.append(f"person_evidence[{eid}]: missing confidence")
        if not e.get("rationale"):
            errors.append(f"person_evidence[{eid}]: missing/empty rationale")

    assert not errors, "Incomplete new person_evidence:\n" + "\n".join(errors)


# --- Tag-gated "review confirms, doesn't churn" checks ---

def _pe_by_id(research: dict, pe_id: str) -> dict | None:
    for e in research.get("person_evidence", []):
        if e.get("id") == pe_id:
            return e
    return None


def test_pe005_unchanged_when_review_confirms(before_state, after_state, test):
    """If the test is a confirmation review of pe_005, the entry must not
    be modified — confirming review doesn't churn the existing record."""
    if "pe_005" not in test.get("tags", []):
        pytest.skip("not a pe_005 review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_pe = _pe_by_id(before, "pe_005")
    after_pe = _pe_by_id(after, "pe_005")
    if before_pe is None:
        pytest.skip("pe_005 not present in before_state")
    assert after_pe == before_pe, (
        f"pe_005 was modified during a confirmation review.\n"
        f"before: {before_pe}\nafter: {after_pe}"
    )


def test_no_unrelated_new_pe_in_focused_review(before_state, after_state, test):
    """A focused-review test should not create unrelated new pe_ entries.

    Tag-gated: only enforced when `confidence-calibration` is in tags —
    these tests are scoped to reviewing one existing pe entry, not
    expanding the evidence graph.
    """
    if "confidence-calibration" not in test.get("tags", []):
        pytest.skip("not a focused-review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_ids = {e.get("id") for e in before.get("person_evidence", [])}
    after_ids = {e.get("id") for e in after.get("person_evidence", [])}
    new = after_ids - before_ids
    assert not new, (
        f"focused review of an existing pe entry must not create new pe "
        f"entries; got: {sorted(new)}"
    )


# --- Tag-gated multi-person-awareness regression check ---

def test_pe004_unchanged_when_adding_second_side(before_state, after_state, test):
    """When a relationship assertion gets its missing other-side link
    added, the EXISTING side (pe_004) must not be modified.

    Tag-gated on multi-person-awareness + pe_004 — the original pe_004
    is the canonical "already correct" entry that gets the missing
    Thomas-side companion link.
    """
    if "multi-person-awareness" not in test.get("tags", []):
        pytest.skip("not a multi-person-awareness scenario")
    if "pe_004" not in test.get("tags", []):
        pytest.skip("not a pe_004 scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_pe = _pe_by_id(before, "pe_004")
    after_pe = _pe_by_id(after, "pe_004")
    if before_pe is None:
        pytest.skip("pe_004 not present in before_state")
    assert after_pe == before_pe, (
        f"pe_004 was modified while adding the second-side link.\n"
        f"before: {before_pe}\nafter: {after_pe}"
    )


def test_a010_has_second_side_link(before_state, after_state, test):
    """When the multi-person-awareness scenario for a_010 runs, the skill
    must add a new pe_ entry linking a_010 to a person other than the
    one(s) it was already linked to.

    Tag-gated on a_010 + multi-person-awareness so it only fires on the
    specific relationship-assertion-bears-on-both-persons scenario.
    """
    if "multi-person-awareness" not in test.get("tags", []):
        pytest.skip("not a multi-person-awareness scenario")
    if "a_010" not in test.get("tags", []):
        pytest.skip("not an a_010 scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_persons_for_a010 = {
        e.get("person_id")
        for e in before.get("person_evidence", [])
        if e.get("assertion_id") == "a_010"
    }
    after_persons_for_a010 = {
        e.get("person_id")
        for e in after.get("person_evidence", [])
        if e.get("assertion_id") == "a_010"
    }
    new_persons = after_persons_for_a010 - before_persons_for_a010
    assert new_persons, (
        f"expected a new pe_ entry linking a_010 to a second person; "
        f"before linked persons: {sorted(before_persons_for_a010)}; "
        f"after: {sorted(after_persons_for_a010)}"
    )
