"""Direct tests for the tree-fact/assertion agreement validator (#2472).

Same reason as test_parent_child_age_plausibility_validator.py: pyproject.toml
sets testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill eval run. Without this file the guard would ship
unexecuted, which is worse than no guard at all.

What it guards: issue #2472 -- a place corrected on a research.json assertion
never reached the tree fact already materialised from it, and nothing reported
the divergence. The `assertion_id` backlink is what makes that a computable
property; this is the check, and these are the two directions it has to get
right. The green cases are not decoration: each is a legitimate operation that,
if it fired, would make the validator red forever on correct work.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_tree_facts_agree_with_linked_assertions as check,
)


def assertion(aid, **fields):
    base = {
        "id": aid,
        "source_id": "src_001",
        "record_id": "rec1",
        "record_role": "principal",
        "fact_type": "immigration",
        "value": "Immigrated to Canada, 1924",
        "place": "Odessa, Francis No. 127, Saskatchewan, Canada",
        "standard_place": "Odessa, Francis No. 127, Saskatchewan, Canada",
        "date": "1924",
    }
    base.update(fields)
    return base


def fact(**fields):
    base = {"id": "F4", "type": "Immigration", "sources": [{"ref": "S1"}]}
    base.update(fields)
    return base


def state(facts, assertions, *, on_relationship=False):
    person = {"id": "I1", "names": [{"id": "N1", "given": "Anna", "surname": "Weichel"}]}
    relationship = {"id": "R1", "type": "Couple", "person1": "I1", "person2": "I2"}
    if on_relationship:
        relationship["facts"] = facts
    else:
        person["facts"] = facts
    return {
        "research_json": {"assertions": assertions},
        "tree_gedcomx_json": {
            "persons": [person],
            "relationships": [relationship],
            "sources": [{"id": "S1", "title": "Border crossing manifest"}],
        },
    }


# ── Red: the drift the card was filed about ────────────────────────────────

def test_stale_place_on_a_backlinked_fact_fails():
    """The reported shape: the assertion was corrected, the fact was not."""
    after = state(
        [fact(place="Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id="a_011")],
        [assertion("a_011")],
    )
    with pytest.raises(AssertionError, match="never reached the fact"):
        check(after)


def test_stale_standard_place_alone_fails():
    """The place-AUTHORITY half, which a display-string-only check would miss.

    This is the exact divergence in the wendel-weichel-mother run: `place` had
    been corrected and `standard_place` still named the wrong province.
    """
    after = state(
        [
            fact(
                place="Odessa, Francis No. 127, Saskatchewan, Canada",
                standard_place="Thames Centre Township, Middlesex, Ontario, Canada",
                assertion_id="a_011",
            )
        ],
        [assertion("a_011")],
    )
    with pytest.raises(AssertionError, match="standard_place"):
        check(after)


def test_stale_date_fails():
    after = state([fact(date="1925", assertion_id="a_011")], [assertion("a_011")])
    with pytest.raises(AssertionError, match="date"):
        check(after)


def test_drift_on_a_relationship_fact_fails_too():
    """Nothing can stamp one today; the arm must still work if anything ever does."""
    after = state(
        [fact(id="F9", type="Marriage", place="Wellburn, Ontario, Canada", assertion_id="a_011")],
        [assertion("a_011")],
        on_relationship=True,
    )
    with pytest.raises(AssertionError, match="never reached the fact"):
        check(after)


# ── Green: legitimate states that must never fire ──────────────────────────

def test_a_fact_with_no_backlink_is_ignored():
    """Every fact in every project written before the backlink existed."""
    after = state(
        [fact(place="Wellburn, Thames Centre, Middlesex, Ontario, Canada")],
        [assertion("a_011")],
    )
    check(after)


def test_an_assertion_field_that_is_null_is_skipped():
    """The corroboration branch can fill an attribute from a DIFFERENT assertion,
    so `fact has it, linked assertion does not` is not drift."""
    after = state(
        [fact(place="Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id="a_011")],
        [assertion("a_011", place=None)],
    )
    check(after)


def test_an_absent_fact_field_is_skipped():
    """An event fact never carries the assertion's `value` (#711), so comparing
    it would fail every event fact in the corpus."""
    after = state([fact(assertion_id="a_011")], [assertion("a_011")])
    check(after)


def test_a_blank_string_counts_as_absent():
    after = state([fact(place="   ", assertion_id="a_011")], [assertion("a_011")])
    check(after)


def test_a_dangling_backlink_is_skipped_not_failed():
    """Referential integrity for this field is not this check's job."""
    after = state(
        [fact(place="Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id="a_999")],
        [assertion("a_011")],
    )
    check(after)


def test_an_agreeing_fact_passes():
    after = state(
        [
            fact(
                place="Odessa, Francis No. 127, Saskatchewan, Canada",
                standard_place="Odessa, Francis No. 127, Saskatchewan, Canada",
                date="1924",
                assertion_id="a_011",
            )
        ],
        [assertion("a_011")],
    )
    check(after)


def test_an_unrelated_fact_reflowed_does_not_fire():
    """The other direction, explicitly: editing a fact that is not backlinked
    must stay green no matter what it says."""
    after = state(
        [
            fact(
                place="Odessa, Francis No. 127, Saskatchewan, Canada",
                standard_place="Odessa, Francis No. 127, Saskatchewan, Canada",
                date="1924",
                assertion_id="a_011",
            ),
            fact(id="F5", type="Residence", place="Somewhere else entirely"),
        ],
        [assertion("a_011")],
    )
    check(after)


def test_missing_documents_skip():
    with pytest.raises(BaseException) as exc:
        check({"research_json": None, "tree_gedcomx_json": None})
    assert exc.typename == "Skipped"
def test_a_non_string_backlink_does_not_crash():
    """A list is unhashable; before the isinstance guard this raised TypeError
    out of the dict lookup instead of producing a verdict."""
    after = state(
        [fact(place="Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id=["a_011"])],
        [assertion("a_011")],
    )
    check(after)


def test_a_non_dict_fact_is_skipped():
    after = state(["not a dict", fact(assertion_id="a_011")], [assertion("a_011")])
    check(after)


def test_a_non_dict_assertion_is_skipped():
    after = state(
        [fact(place="Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id="a_011")],
        ["not a dict", assertion("a_011")],
    )
    with pytest.raises(AssertionError, match="never reached the fact"):
        check(after)


def test_malformed_documents_skip():
    """A list-shaped research.json raised AttributeError instead of a verdict."""
    with pytest.raises(BaseException) as exc:
        check({"research_json": [], "tree_gedcomx_json": {"persons": []}})
    assert exc.typename == "Skipped"


def test_a_multi_source_fact_is_skipped():
    """The state the shipped tools deliberately produce and preserve.

    materialize_facts corroborates a second source onto the fact, filling an
    attribute from a DIFFERENT assertion; research_append's rewrite then refuses
    to overwrite it, because that would destroy the other source's evidence. The
    fact legitimately holds a value its own backlink never asserted, and no tool
    can reconcile the two without destroying one. Firing here would be red
    forever on correct work.
    """
    after = state(
        [
            fact(
                place="Wellburn, Thames Centre, Middlesex, Ontario, Canada",
                assertion_id="a_011",
                sources=[{"ref": "S1"}, {"ref": "S2"}],
            )
        ],
        [assertion("a_011")],
    )
    check(after)


def test_a_single_source_fact_still_fires():
    """The other direction, so the multi-source skip cannot swallow the defect:
    the run that produced the card has one ref on the diverging fact."""
    after = state(
        [
            fact(
                place="Wellburn, Thames Centre, Middlesex, Ontario, Canada",
                assertion_id="a_011",
                sources=[{"ref": "S3", "quality": 3}],
            )
        ],
        [assertion("a_011")],
    )
    with pytest.raises(AssertionError, match="never reached the fact"):
        check(after)
