"""Direct tests for `test_objective_target_leads_the_plan`.

Same reason as `test_convert_dates_validators.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and this validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

Exists to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.

Provenance of the violating states, from alpha feedback #1945:

  - The BEHIND-THE-DEATH-PLACE violation is REAL, twice over. In the submitted
    session the plan put the Trysil burial at sequence 1 and the Kongsberg
    baptism at sequence 6 of 11, then ran only item 1. Reproduced on current
    `main` in scratch run `2026-08-28_16-54-42`, where the same skill wrote the
    burial at sequence 1, its browse fallback at 2, and the baptism at 3.

  - The FALLBACK-OF-AN-INDIRECT-ITEM violation is SYNTHETIC in this exact
    shape, but its ingredients are observed: the reproduction's baptism item
    carried the rationale "If the burial entry (pli_001/pli_002) confirms a
    bir[th]...", i.e. it treated the requested record as contingent on the
    death record in prose while leaving `fallback_for` null. A plan that
    encodes the same contingency structurally is the case the ordering check
    alone would miss.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as the sibling validator tests.
from test_research_plan import (  # noqa: E402
    test_objective_target_leads_the_plan as check_target_leads,
)

TAGGED = {"tags": ["planning", "sequencing", "objective-target"]}
UNTAGGED = {"tags": ["planning", "sequencing"]}


def _state(items):
    return {"research_json": {"plans": [{"id": "pl_001", "items": items}]}}


def _item(seq, rtype, juris, **kw):
    d = {
        "id": f"pli_{seq:03d}",
        "sequence": seq,
        "record_type": rtype,
        "jurisdiction": juris,
        "rationale": "",
    }
    d.update(kw)
    return d


# --- the state that must PASS -----------------------------------------

def test_passes_when_the_target_leads():
    """Baptism first, Trysil corroboration behind it — the shape SKILL.md
    step 4 item 7 asks for."""
    after = _state([
        _item(1, "church", "Kongsberg, Buskerud, Norway"),
        _item(2, "church", "Kongsberg, Buskerud, Norway", fallback_for="pli_001"),
        _item(3, "vital_record", "Trysil, Hedmark, Norway"),
        _item(4, "census", "Norway"),
    ])
    check_target_leads({}, after, TAGGED)


# --- the states that must FAIL ----------------------------------------

def test_fires_when_the_death_place_is_sequenced_first():
    """The reproduced defect: burial at 1, browse fallback at 2, the
    requested baptism at 3."""
    after = _state([
        _item(1, "vital_record", "Trysil, Hedmark, Norway",
              rationale="The indexed national extract is the fastest, free starting point."),
        _item(2, "vital_record", "Trysil, Hedmark, Norway", fallback_for="pli_001"),
        _item(3, "church", "Kongsberg, Buskerud, Norway"),
    ])
    with pytest.raises(AssertionError, match="sequenced\\s+ahead of it"):
        check_target_leads({}, after, TAGGED)


def test_fires_when_the_target_is_a_fallback_of_the_death_place():
    """Ordering alone would pass this: the baptism has the lowest sequence
    of the two, but is only reached if the Trysil search succeeds."""
    after = _state([
        _item(1, "church", "Kongsberg, Buskerud, Norway", fallback_for="pli_002"),
        _item(2, "vital_record", "Trysil, Hedmark, Norway"),
    ])
    with pytest.raises(AssertionError, match="must not be gated behind"):
        check_target_leads({}, after, TAGGED)


def test_fires_when_no_item_targets_the_objective_at_all():
    """The tester's own session never searched Kongsberg. A plan that omits
    the requested record entirely is the strongest form of the defect."""
    after = _state([
        _item(1, "vital_record", "Trysil, Hedmark, Norway"),
        _item(2, "census", "Trysil, Hedmark, Norway"),
    ])
    with pytest.raises(AssertionError, match="no plan item targets the objective"):
        check_target_leads({}, after, TAGGED)


# --- the guard does not fire where it should not -----------------------

def test_skips_when_the_tag_is_absent():
    """Every other research-plan test must be unaffected."""
    after = _state([_item(1, "vital_record", "Trysil, Hedmark, Norway")])
    with pytest.raises(pytest.skip.Exception):
        check_target_leads({}, after, UNTAGGED)


def test_skips_when_no_plan_items_were_written():
    """A review-mode run that writes no items is a different test's business."""
    with pytest.raises(pytest.skip.Exception):
        check_target_leads({}, _state([]), TAGGED)


def test_target_is_recognised_under_either_record_type_spelling():
    """`record_type` is an open field and a baptism register is defensibly
    `church` or `vital_record`. Both spellings were observed for this
    scenario's target within one hour — `church` at 09:58, `vital_record` at
    18:16 — and the first version of this validator accepted only `church`,
    so it reported "no item targets the objective" on a plan that had one and
    never reached the ordering check it exists for."""
    for spelling in ("church", "vital_record"):
        ok = _state([
            _item(1, spelling, "Kongsberg, Buskerud, Norway"),
            _item(2, "vital_record", "Trysil, Hedmark, Norway"),
        ])
        check_target_leads({}, ok, TAGGED)

        bad = _state([
            _item(1, "vital_record", "Trysil, Hedmark, Norway"),
            _item(2, spelling, "Kongsberg, Buskerud, Norway"),
        ])
        with pytest.raises(AssertionError, match="sequenced\\s+ahead of it"):
            check_target_leads({}, bad, TAGGED)


def test_an_item_naming_both_places_cannot_be_the_target():
    """One semicolon must not defeat the guard.

    `jurisdiction` is free text and both halves of the check are substring
    matches, so before the fix a single item satisfied the target test AND the
    ahead-of-target test — relabelling the seq-1 death item made the identical
    defect pass. Not a contrived string: `r3d`'s own run in
    `v1_2026-08-28_19-50-30` wrote
    "Trysil, Hedmark, Norway; Kongsberg, Buskerud, Norway" verbatim. Found by
    @T-FEH in review of #2033."""
    both = "Trysil, Hedmark, Norway; Kongsberg, Buskerud, Norway"

    # The evasion: seq 1 is really the Trysil item, relabelled.
    after = _state([
        _item(1, "church", both),
        _item(2, "church", "Kongsberg, Buskerud, Norway"),
    ])
    with pytest.raises(AssertionError, match="sequenced\\s+ahead of it"):
        check_target_leads({}, after, TAGGED)

    # And a multi-place item cannot stand in as the target on its own.
    only_both = _state([_item(1, "church", both)])
    with pytest.raises(AssertionError, match="no plan item targets the objective"):
        check_target_leads({}, only_both, TAGGED)


def test_kongsberg_census_does_not_satisfy_the_target():
    """The target is the requested RECORD TYPE in the named place, not merely
    something in the named place — a Kongsberg census must not count as the
    baptism, or the guard could be satisfied without planning the record the
    objective asked for."""
    after = _state([
        _item(1, "census", "Kongsberg, Buskerud, Norway"),
        _item(2, "vital_record", "Trysil, Hedmark, Norway"),
    ])
    with pytest.raises(AssertionError, match="no plan item targets the objective"):
        check_target_leads({}, after, TAGGED)

