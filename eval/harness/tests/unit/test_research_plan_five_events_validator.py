"""Direct tests for `test_enumerative_plan_accounts_for_five_events`.

Issue #1830 item 1, the lead's 2026-08-31 ruling on #1917. Nothing under
`validators/` is collected by `make harness-test`.

Provenance of the real-plan behaviour, replayed before this file was written:
of the five enumerative questions in `eval/runlogs/e2e/*/run-*.final-research.json`
(each labelled `enumerative` for the replay), `elizabeth-geach-siblings`,
`reese-children` and `ruse-children` account for all five events, and both
`reese-siblings` runs fail on marriage. Geach's birth coverage is a `church` item
planning "a church membership or baptism register … [that] could name Geach
children" — which is why birth matches a vital-type item's rationale and not
`record_type` alone.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_research_plan import (  # noqa: E402
    test_enumerative_plan_accounts_for_five_events as check_five,
)

TAGGED = {"tags": ["planning", "enumerative-five-events"]}


def _item(n, record_type, rationale, **kw):
    return {"id": f"pli_{n:03d}", "sequence": n, "record_type": record_type,
            "rationale": rationale, "status": "planned", **kw}


FULL = [
    _item(1, "census", "The 1850 census names every household member."),
    _item(2, "vital_record", "County birth records name the parents of each child."),
    _item(3, "vital_record", "Marriage records for the children name their parents."),
    _item(4, "vital_record", "Death certificates for the children name a parent."),
    _item(5, "probate", "The father's estate file names his heirs."),
]


def _states(items, kind="enumerative"):
    q = {"id": "q_001", "question": "Who were the children of Lewis Reese?"}
    if kind is not None:
        q["question_kind"] = kind
    plan = {"id": "pl_001", "question_id": "q_001", "items": items}
    return ({"research_json": {"questions": [q], "plans": []}},
            {"research_json": {"questions": [q], "plans": [plan]}})


def _without(n):
    return [i for i in FULL if i["id"] != f"pli_{n:03d}"]


def _check(before, after, test=TAGGED):
    check_five(before, after, test)


# --- the states that must PASS ---------------------------------------------

def test_passes_when_all_five_are_covered():
    _check(*_states(FULL))


def test_passes_when_an_absent_event_is_a_skip_with_category_and_reason():
    items = _without(5) + [_item(6, "probate", "The father's estate file.",
                                 status="skipped", skip_category="no_coverage",
                                 skip_reason="The county's probate court burned in 1872.")]
    _check(*_states(items))


@pytest.mark.parametrize("record_type,rationale", [
    ("vital_record", "Marriage records for the children, all born in Greene County, name their parents."),
    ("marriage", "Hale marriages trace each child born to Thomas and Sarah."),
    ("cemetery", "Children born and buried before 1850 appear only on headstones."),
])
def test_an_item_mentioning_births_in_passing_is_not_birth_coverage(record_type, rationale):
    items = _without(2) + [_item(10, record_type, rationale)]
    with pytest.raises(AssertionError, match="reason for: birth"):
        _check(*_states(items))


def test_a_birth_item_mentioning_marriage_and_death_covers_only_birth():
    items = [i for i in FULL if i["id"] not in ("pli_003", "pli_004")]
    items[1] = _item(2, "vital_record", "Children born after their marriage and before Thomas's death.")
    with pytest.raises(AssertionError, match="reason for: marriage, death"):
        _check(*_states(items))


def test_a_skip_reason_counts_for_one_event_only():
    items = _without(4) + [_item(9, "other", "", status="skipped", skip_category="no_coverage",
                                 skip_reason="No probate: Thomas died intestate.")]
    with pytest.raises(AssertionError, match="reason for: death"):
        _check(*_states(items))


@pytest.mark.parametrize("record_type", ["land_and_real_estate", "real estate deeds"])
def test_a_real_estate_item_is_not_probate(record_type):
    items = _without(5) + [_item(9, record_type, "Deeds name heirs when land passes.")]
    with pytest.raises(AssertionError, match="reason for: probate"):
        _check(*_states(items))


@pytest.mark.parametrize("record_type,rationale", [
    ("civil_war_pension", "Children born to the widow are named in the file."),
    ("Civil War service", "Gives the date each son was born."),
    ("church_membership", "Members' children born in the congregation are listed."),
])
def test_a_type_naming_civil_war_or_church_membership_is_not_a_birth_record(record_type, rationale):
    items = _without(2) + [_item(9, record_type, rationale)]
    with pytest.raises(AssertionError, match="reason for: birth"):
        _check(*_states(items))


def test_a_draft_registration_is_not_a_birth_record():
    items = _without(2) + [_item(9, "military_draft_registration", "Gives the date each son was born.")]
    with pytest.raises(AssertionError, match="reason for: birth"):
        _check(*_states(items))


@pytest.mark.parametrize("record_type", ["estate_files", "Wills"])
def test_probate_recognised_under_other_spellings(record_type):
    _check(*_states(_without(5) + [_item(9, record_type, "The father's estate.")]))


@pytest.mark.parametrize("n,reason", [
    (5, "No probate file survives for Greene County before 1870."),
    (1, "No census before 1850 names the children."),
    (3, "The county's marriage registers before 1820 are lost."),
])
def test_a_skip_filed_as_other_is_credited_from_its_reason(n, reason):
    items = _without(n) + [_item(9, "other", "", status="skipped",
                                 skip_category="no_coverage", skip_reason=reason)]
    _check(*_states(items))


@pytest.mark.parametrize("record_type,rationale", [
    ("church", "A baptism register could name each child."),
    ("Vital Records", "Birth registrations name both parents."),
    ("civil_registration", "Children born after 1867 were registered."),
])
def test_birth_recognised_under_other_spellings(record_type, rationale):
    items = _without(2) + [_item(7, record_type, rationale)]
    _check(*_states(items))


@pytest.mark.parametrize("rationale", ["", "Birth registers are indexed separately."])
def test_a_skipped_vital_item_is_credited_from_its_reason(rationale):
    items = _without(4) + [_item(9, "vital_record", rationale, status="skipped",
                                 skip_category="no_coverage",
                                 skip_reason="No death register survives before 1880.")]
    _check(*_states(items))


def test_death_recognised_from_a_cemetery_record_type():
    items = _without(4) + [_item(8, "cemetery", "Find a Grave memorials for the family plot.")]
    _check(*_states(items))


# --- the states that must FAIL ---------------------------------------------

@pytest.mark.parametrize("n,event", [(1, "census"), (2, "birth"), (3, "marriage"),
                                     (4, "death"), (5, "probate")])
def test_fails_when_any_one_event_is_missing(n, event):
    with pytest.raises(AssertionError, match=f"reason for: {event}"):
        _check(*_states(_without(n)))


@pytest.mark.parametrize("extra", [{}, {"skip_category": "no_coverage"},
                                   {"skip_reason": "No probate."}])
def test_fails_when_the_skip_does_not_say_why(extra):
    items = _without(5) + [_item(6, "probate", "The father's estate file.",
                                 status="skipped", **extra)]
    with pytest.raises(AssertionError, match="reason for: probate"):
        _check(*_states(items))


def test_a_probate_rationale_saying_the_father_died_is_not_death_coverage():
    items = _without(4)
    items[-1] = _item(5, "probate", "Lewis died in 1912; his estate file names his heirs.")
    with pytest.raises(AssertionError, match="reason for: death"):
        _check(*_states(items))


def test_a_census_rationale_naming_births_is_not_birth_coverage():
    items = _without(2)
    items[0] = _item(1, "census", "The 1900 census records each child's birth month and year.")
    with pytest.raises(AssertionError, match="reason for: birth"):
        _check(*_states(items))


@pytest.mark.parametrize("kind", ["targeted", None])
def test_refuses_a_fixture_whose_question_is_not_enumerative(kind):
    with pytest.raises(AssertionError, match="not enumerative"):
        _check(*_states(FULL, kind=kind))


def test_fails_when_no_plan_was_written():
    before, after = _states(FULL)
    after["research_json"]["plans"] = []
    with pytest.raises(AssertionError, match="no new plan"):
        _check(before, after)


def test_skips_when_the_tag_is_absent():
    with pytest.raises(pytest.skip.Exception):
        _check(*_states(FULL), {"tags": ["planning"]})
