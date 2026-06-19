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


# --- Tag-gated: same_person score wiring ----------------------

def _new_pe_for_assertion(before, after, assertion_id):
    """New person_evidence entries (in after, not before) for an assertion."""
    before_ids = {e.get("id") for e in before.get("person_evidence", [])}
    return [
        e for e in after.get("person_evidence", [])
        if e.get("id") not in before_ids and e.get("assertion_id") == assertion_id
    ]


def test_match_score_persisted(before_state, after_state, test):
    """Tag-gated (match-score): a record_search-sourced link must persist the
    same_person score — the new person_evidence entry for a_001
    carries a non-null match_score."""
    if "match-score" not in test.get("tags", []):
        pytest.skip("not a match-score scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_001")
    assert new, "expected a new person_evidence entry linking a_001"
    scored = [e for e in new if e.get("match_score") is not None]
    assert scored, (
        "the record_search-sourced link must carry a non-null match_score; "
        f"got match_score values: {[e.get('match_score') for e in new]}"
    )


def test_fts_assertion_no_score(before_state, after_state, test):
    """Tag-gated (no-score-fallback): a full-text-sourced assertion has no
    record_persona_id, so same_person cannot run — the new
    person_evidence entry for a_004 must leave match_score null."""
    if "no-score-fallback" not in test.get("tags", []):
        pytest.skip("not a no-score-fallback scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_004")
    assert new, "expected a new person_evidence entry linking a_004"
    bad = [e for e in new if e.get("match_score") is not None]
    assert not bad, (
        "a full-text-sourced link must leave match_score null; offending "
        f"entries: {[(e.get('id'), e.get('match_score')) for e in bad]}"
    )


def test_high_score_conflict_not_confident(before_state, after_state, test):
    """Tag-gated (score-conflict): when a high match score collides with a
    qualitative conflict, person-evidence must not create a `confident`
    link for a_002 — the conflict caps confidence regardless of score."""
    if "score-conflict" not in test.get("tags", []):
        pytest.skip("not a score-conflict scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_002")
    confident = [e for e in new if e.get("confidence") == "confident"]
    assert not confident, (
        "a high score must not auto-link past a qualitative conflict — no "
        "`confident` person_evidence entry may be created for a_002; got: "
        f"{[(e.get('id'), e.get('confidence')) for e in confident]}"
    )


def test_low_score_variant_still_links(before_state, after_state, test):
    """Tag-gated (score-variant): a low match score driven by a
    transcription-variant name must not dismiss a strong qualitative
    match — person-evidence must still create the link for a_003."""
    if "score-variant" not in test.get("tags", []):
        pytest.skip("not a score-variant scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_003")
    assert new, (
        "a low score must not dismiss a strong qualitative match — "
        "expected a new person_evidence entry linking a_003"
    )


# --- Tag-gated: stub-person creation -------------------------------

def test_stub_person_created_and_linked(before_state, after_state, test):
    """Tag-gated (stub-creation): when an assertion's persona matches no
    existing tree person, person-evidence must mint a NEW stub person in
    tree.gedcomx.json and link a_005 to it — not force a bad match onto an
    existing person and not skip the role.

    The schema authorizes this write (research-schema-spec.md §8 line 656);
    TREE_OWNERSHIP_TABLE in test_universal.py grants person-evidence the
    `persons` write so a correct stub run isn't failed for ownership.
    """
    if "stub-creation" not in test.get("tags", []):
        pytest.skip("not a stub-creation scenario")
    before_r = before_state.get("research_json")
    after_r = after_state.get("research_json")
    before_t = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after_t = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if any(x is None for x in (before_r, after_r, before_t, after_t)):
        pytest.skip("Missing research.json or tree.gedcomx.json for diff")

    before_pids = {p.get("id") for p in before_t.get("persons", [])}
    after_pids = {p.get("id") for p in after_t.get("persons", [])}
    new_pids = after_pids - before_pids
    assert new_pids, (
        "expected a new stub person in tree.gedcomx.json for the un-matched "
        f"persona; persons unchanged (before={sorted(before_pids)})"
    )

    new_pe = _new_pe_for_assertion(before_r, after_r, "a_005")
    assert new_pe, "expected a new person_evidence entry linking a_005"

    linked_to_new = [e for e in new_pe if e.get("person_id") in new_pids]
    assert linked_to_new, (
        "a_005 must link to the newly created stub person, not an existing "
        f"one; new pe person_ids={[e.get('person_id') for e in new_pe]}, "
        f"new stub ids={sorted(new_pids)}"
    )

    # a_005 is full-text-sourced — no same_person score, so match_score null.
    scored = [e for e in linked_to_new if e.get("match_score") is not None]
    assert not scored, (
        "a_005 is full-text-sourced — its link must leave match_score null; "
        f"got {[(e.get('id'), e.get('match_score')) for e in linked_to_new]}"
    )

    # The new stub must be minimally well-formed (gender + a name).
    for pid in {e.get("person_id") for e in linked_to_new}:
        person = next((p for p in after_t.get("persons", []) if p.get("id") == pid), None)
        assert person and person.get("gender") and person.get("names"), (
            f"new stub person {pid} must have a gender and at least one name"
        )


# --- Tag-gated: audit / review-only makes no writes ----------------

def test_audit_review_makes_no_writes(before_state, after_state, test):
    """Tag-gated (audit-review): a review/audit request is analysis-only.

    The skill flags gaps (e.g., a relationship assertion missing its
    other-side link) and asks before writing — it must not modify the
    person_evidence section during the review itself.
    """
    if "audit-review" not in test.get("tags", []):
        pytest.skip("not an audit-review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert after.get("person_evidence") == before.get("person_evidence"), (
        "an audit/review must not modify person_evidence — it produces "
        "analysis and asks the user before making any change"
    )
