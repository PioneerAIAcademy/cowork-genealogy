"""Proof-of-failure tests for the research-plan deterministic validators
(issue #1866, deep dive #1650).

Nothing in CI checks that a gating validator can fail (the run-log gate only
runs the validators, it never mutates a run to red one), so each check here is
exercised against a state that must PASS and the state that must FIRE —
CLAUDE.md, "a new lint must be proven to fail".

The validators are pytest functions named `test_*` so the harness collects
them; imported here they would be collected a second time as tests of this
module, so they are aliased away from the `test_` prefix (the #1762 pattern).
Shapes are reduced from `v1_2026-08-17_17-52-29`, the run the issue cites.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))  # provenance_report
sys.path.insert(0, str(_HARNESS / "validators"))  # validators_lib, the module

from test_research_plan import (  # noqa: E402
    test_research_plan_availability_claim_matches_counts as check_v5,
    test_research_plan_fallback_for_in_same_plan as check_v3,
    test_research_plan_no_out_of_lane_tools as check_v2,
    test_research_plan_rationale_identifiers_traceable as check_v1,
)

QUAL = "mcp__genealogy__"


def _item(item_id, *, fallback_for=None, rationale=""):
    return {
        "id": item_id,
        "sequence": 1,
        "record_type": "census",
        "jurisdiction": "Schuylkill County, Pennsylvania",
        "date_range": "1850",
        "repository": "FamilySearch",
        "rationale": rationale,
        "fallback_for": fallback_for,
        "status": "planned",
    }


def _states(new_items):
    """A before/after pair whose only change is a new plan pl_002 carrying
    `new_items`. pl_001 is a pre-existing completed plan."""
    before = {
        "research_json": {
            "plans": [
                {"id": "pl_001", "status": "completed", "items": [_item("pli_001")]}
            ]
        }
    }
    after = {
        "research_json": {
            "plans": [
                {"id": "pl_001", "status": "completed", "items": [_item("pli_001")]},
                {"id": "pl_002", "status": "active", "items": new_items},
            ]
        }
    }
    return before, after


def _call(tool, response=None, args=None):
    return {"tool": QUAL + tool, "args": args or {}, "response": response}


def _collections(results):
    return {"query": {}, "scope": "place", "totalForPlace": len(results), "results": results}


# --- V3 -------------------------------------------------------------------

def test_v3_fires_on_cross_plan_fallback():
    # pli_011's fallback points at pli_001, an item of the OTHER (completed) plan.
    before, after = _states([_item("pli_010"), _item("pli_011", fallback_for="pli_001")])
    with pytest.raises(AssertionError, match="fallback_for"):
        check_v3(before, after)


def test_v3_passes_on_in_plan_fallback():
    before, after = _states([_item("pli_010"), _item("pli_011", fallback_for="pli_010")])
    check_v3(before, after)  # in-plan chain and null fallbacks are fine


def test_v3_skips_when_no_new_plan():
    before = {"research_json": {"plans": [{"id": "pl_001", "items": [_item("pli_001")]}]}}
    with pytest.raises(pytest.skip.Exception):
        check_v3(before, before)


# --- V2 -------------------------------------------------------------------

def test_v2_fires_on_wiki_call():
    with pytest.raises(AssertionError, match="wiki_search"):
        check_v2([_call("wiki_search")], [], [])


def test_v2_fires_on_attempted_place_population():
    # A denied call never reaches tool_calls; it must still red via attempts.
    with pytest.raises(AssertionError, match="place_population"):
        check_v2([], [_call("place_population")], [])


def test_v2_fires_on_locality_guide_delegation():
    with pytest.raises(AssertionError, match="locality-guide"):
        check_v2([], [], ["locality-guide"])


def test_v2_passes_on_lane_tools_and_project_context():
    # project_context is forbidden by nothing — a complement-of-six gate would
    # wrongly red this. Both a call and an attempt of it must stay green.
    check_v2(
        [_call("collections_search"), _call("project_context")],
        [_call("project_context")],
        [],
    )


# --- V1 -------------------------------------------------------------------

_SERVED = [_call("collections_search", _collections([
    {"id": "1999196", "title": "Pennsylvania, Probate Records", "personCount": 0},
    {"id": "1921317", "title": "Pennsylvania, County Marriages", "personCount": 1048378},
]))]


def test_v1_fires_on_untraceable_identifier():
    before, after = _states([_item("pli_010", rationale="Search collection 1401638 for the burial.")])
    with pytest.raises(AssertionError, match="1401638"):
        check_v1(before, after, _SERVED)


def test_v1_passes_on_served_identifier():
    before, after = _states([_item("pli_010", rationale="Search collection 1999196, the probate records.")])
    check_v1(before, after, _SERVED)


def test_v1_ignores_four_digit_years():
    # A year is not identifier-shaped, so it is never demanded to trace.
    before, after = _states([_item("pli_010", rationale="Cover the 1850 and 1860 census years.")])
    check_v1(before, after, _SERVED)


def test_v1_passes_on_identifier_from_before_state_localities():
    """Issue #1866, EdmondOware's correction: an id carried from the starting
    research.json — e.g. a volume id in a `localities` entry the skill read at
    Step 2 — is grounded even though no tool response this run served it.
    Grounding against served ids alone would false-positive on this correct
    behaviour (ut_research_plan_wzk's loc_001 volume ids)."""
    before = {
        "research_json": {
            "plans": [
                {"id": "pl_001", "status": "completed", "items": [_item("pli_001")]}
            ],
            "localities": [
                {
                    "id": "loc_001",
                    "place": "Schuylkill County, Pennsylvania",
                    # No trailing period: NUM_RE's lookahead rejects a digit run
                    # followed by `.` — the same normalisation the rationale side
                    # uses, so grounding stays symmetric.
                    "notes": "Probate on FHL film 007255720, per the county survey",
                }
            ],
        }
    }
    after = {
        "research_json": {
            "plans": [
                *before["research_json"]["plans"],
                {
                    "id": "pl_002",
                    "status": "active",
                    "items": [
                        _item(
                            "pli_010",
                            rationale="Order FHL film 007255720 (loc_001) for the probate.",
                        )
                    ],
                },
            ],
            "localities": before["research_json"]["localities"],
        }
    }
    # No tool calls at all: the id is grounded solely by the before-state.
    check_v1(before, after, [])


def test_v1_grounds_before_state_hyphenated_range():
    """Issue #1866, johnmarkpeterbrown: a before-state value written as a
    hyphenated RANGE must ground BOTH endpoints. candidate_identifiers refuses a
    digit run touching a hyphen, so "volumes 007316661-007316663" grounded
    nothing while the rationale — which cites the volumes individually — flagged
    them as fabrications. _grounded_identifiers (looser, applied to both arms)
    rescues them; the cited side stays strict. Reds without the fix: the strict
    grounded set is empty for the range, so both cited ids are 'untraceable'."""
    before = {
        "research_json": {
            "plans": [
                {"id": "pl_001", "status": "completed", "items": [_item("pli_001")]}
            ],
            "localities": [
                {
                    "id": "loc_001",
                    "place": "Schuylkill County, Pennsylvania",
                    "notes": "Marriage records on FamilySearch volumes 007316661-007316663",
                }
            ],
        }
    }
    after = {
        "research_json": {
            "plans": [
                *before["research_json"]["plans"],
                {
                    "id": "pl_002",
                    "status": "active",
                    "items": [
                        _item(
                            "pli_010",
                            rationale="Order volume 007316661 first, then 007316663 as a fallback.",
                        )
                    ],
                },
            ],
            "localities": before["research_json"]["localities"],
        }
    }
    check_v1(before, after, [])  # both endpoints grounded by the before-state range


def test_v1_grounds_served_hyphenated_range():
    """The served arm gets the same looser grounding (johnmarkpeterbrown asked
    for both): a volume_search response naming a range grounds both endpoints
    for a rationale that cites them individually. Here the before-state carries
    neither id, so grounding comes solely from the served response. Reds without
    the fix."""
    served = [_call("volume_search", {
        "results": [
            {
                "title": "Schuylkill County Marriages",
                "description": "Digitized as volumes 007316661-007316663",
            }
        ]
    })]
    before, after = _states([
        _item("pli_010", rationale="Order volume 007316661; fall back to 007316663 if empty."),
    ])
    check_v1(before, after, served)


# --- V5 -------------------------------------------------------------------

def test_v5_fires_on_indexed_claim_against_zero_count():
    before, after = _states([_item("pli_010", rationale="Collection 1999196 is fully indexed.")])
    with pytest.raises(AssertionError, match="1999196"):
        check_v5(before, after, _SERVED)


def test_v5_fires_on_browse_only_claim_against_indexed():
    before, after = _states([_item("pli_010", rationale="Collection 1921317 is browse-only.")])
    with pytest.raises(AssertionError, match="1921317"):
        check_v5(before, after, _SERVED)


def test_v5_passes_when_claims_match_counts():
    before, after = _states([
        _item("pli_010", rationale="Collection 1999196 is image-only (personCount 0)."),
        _item("pli_011", rationale="Collection 1921317 is fully indexed."),
    ])
    check_v5(before, after, _SERVED)


def test_v5_skips_multi_collection_sentence():
    # Two served collections in one sentence: the adjective cannot be bound to
    # one identifier, so the sentence is skipped rather than mis-flagged.
    before, after = _states([
        _item("pli_010", rationale="Collection 1999196 is indexed and 1921317 is browse-only.")
    ])
    check_v5(before, after, _SERVED)  # no fire despite both adjectives being wrong
