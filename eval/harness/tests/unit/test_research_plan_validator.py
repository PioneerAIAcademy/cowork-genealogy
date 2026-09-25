"""Direct tests for research-plan's deterministic validators.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and its real pass/fail set would otherwise appear only
inside a paid per-skill run.

Two independent sets of proof-of-failure tests live here:

- The already-attached-FAN-facts validator (issue #1948) further down,
  aliased as `check`.
- The proof-of-failure tests for the run-on-every-test deterministic checks
  (issue #1866, deep dive #1650) below, aliased away from the `test_` prefix
  (the #1762 pattern) since the validators are themselves pytest functions
  named `test_*` and would otherwise be collected a second time here. Shapes
  are reduced from `v1_2026-08-17_17-52-29`, the run the issue cites.
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
    report_survey_surfaces_already_attached_fan_facts as check,
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


def test_v1_grounds_served_url_path_identifier():
    """A collection id served inside a URL path is grounded.

    `external_links_search` is in _TRACEABLE_ID_TOOLS because it returns
    collection ids, but it returns them ONLY as URL path segments, and the
    grounding lookbehind refused any digit run preceded by '/'. So every id
    that tool served was invisible to the grounded set and a correct citation
    read as a fabrication: 22 of the 40 ids its 16 fixtures serve were
    ungroundable. Observed on ut_research_plan_r3d in
    v1_2026-09-01_07-35-31, which cited Ancestry collection 61749 after
    external_links_search served it. Reds without the fix."""
    served = [_call("external_links_search", {
        "query": {"standardPlace": "Kongsberg, Buskerud, Norway"},
        "totalForPlace": 1,
        "returned": 1,
        "results": [
            {
                "url": "https://www.ancestry.com/search/collections/61749/",
                "linkText": "1801 Norway Census",
            }
        ],
    })]
    before, after = _states([
        _item("pli_006", rationale="Also available on Ancestry (col 61749)."),
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


# A browse/unindexed adjective on a non-collection noun is about that volume,
# not the sentence's one collection id. Recorded false positive:
# ut_research_plan_016, v1_2026-09-01_17-38-18 (issue #2110), verbatim below;
# 1804888 is served indexed in collections-search-kentucky.json.
_SERVED_KY = [_call("collections_search", _collections([
    {"id": "1804888", "title": "Kentucky, Deaths and Burials", "personCount": 421870},
]))]
_UT016_PLI007 = (
    "Paid fallback if FamilySearch collection 1804888 (item 2) and the browse-only "
    "volume (item 3) both return nothing for the pre-1911 period."
)


def test_v5_ignores_browse_only_on_a_volume():
    before, after = _states([_item("pli_007", rationale=_UT016_PLI007)])
    check_v5(before, after, _SERVED_KY)


def test_v5_ignores_unindexed_on_a_volume():
    rationale = _UT016_PLI007.replace("browse-only volume", "unindexed volume")
    before, after = _states([_item("pli_007", rationale=rationale)])
    check_v5(before, after, _SERVED_KY)


@pytest.mark.parametrize("phrase", ["image-only film", "browse only register", "not indexed image groups"])
def test_v5_ignores_adjective_variants_on_a_non_collection_noun(phrase):
    before, after = _states([_item("pli_007", rationale=(
        f"Fallback if collection 1804888 and the {phrase} both return nothing."
    ))])
    check_v5(before, after, _SERVED_KY)


def test_v5_still_fires_on_browse_claim_about_the_collection_itself():
    # "images" is not a non-collection noun: the collection's own images are
    # still a claim about the collection.
    before, after = _states([_item("pli_010", rationale="Collection 1921317 has browse-only images.")])
    with pytest.raises(AssertionError, match="1921317"):
        check_v5(before, after, _SERVED)


def test_v5_still_fires_on_indexed_collection_beside_a_browsed_volume():
    before, after = _states([_item("pli_010", rationale=(
        "Search the indexed collection 1999196 before browsing volume 007936749."
    ))])
    with pytest.raises(AssertionError, match="1999196"):
        check_v5(before, after, _SERVED)


def test_v5_fires_on_indexed_collection_beside_a_browse_only_volume():
    # Before the volume skip, the two adjectives cancelled and the sentence was
    # skipped as self-contradicting; the volume's adjective no longer masks the
    # collection's claim.
    before, after = _states([_item("pli_010", rationale=(
        "Search the indexed collection 1999196 first, then the browse-only volume 007936749."
    ))])
    with pytest.raises(AssertionError, match="1999196"):
        check_v5(before, after, _SERVED)


# Verbatim 1999196 rationales from v1_2026-09-17_15-04-52: the two real
# catches must survive the volume skip, and the volume-shaped third must keep
# its old verdict.
_UT007_PLI006 = (
    "Thomas Flynn (born ~1818 Ireland) was head of household in Schuylkill County in "
    "both 1850 and 1860. His plausible death window is 1865–1920. A will or "
    "administration naming Patrick as a son or heir would be direct evidence of "
    "parentage from a primary source. The locality guide confirms probate records "
    "have been held by the county Register of Wills since 1811; the FamilySearch "
    "indexed collection 1999196 (Pennsylvania Probate Records, 1683–1994) covers "
    "this jurisdiction and period. Search under Flynn, Flin, and Flinn. Date range set "
    "to Thomas's plausible lifespan (born ~1818), not Patrick's research window."
)
_UT010_PLI007 = (
    "Carry-forward of pli_006 (superseded pl_002) with corrected date range. New "
    "evidence places Thomas Flynn's death circa 1865, not 1875-1890. A will or estate "
    "file naming Patrick as a son would be direct parentage evidence. FamilySearch "
    "collection 'Pennsylvania, Probate Records, 1683-1994' (id: 1999196) is indexed "
    "and covers this window. Search under Flynn and variant Flinn."
)
_UT007_PLI007 = (
    "Fallback for pli_006 (indexed probate collection). The locality guide flags that "
    "some Schuylkill County records exist only as browse-only image groups. Volume "
    "007936749 (Probate Records, 1851–1930) is 0% record-searchable and not indexed "
    "— browse image-by-image if the indexed collection 1999196 does not return "
    "Thomas Flynn. Check variant spellings Flynn / Flin / Flinn in margin entries."
)


@pytest.mark.parametrize("rationale", [_UT007_PLI006, _UT010_PLI007], ids=["ut007_pli006", "ut010_pli007"])
def test_v5_still_fires_on_recorded_indexed_claims(rationale):
    before, after = _states([_item("pli_006", rationale=rationale)])
    with pytest.raises(AssertionError, match="1999196"):
        check_v5(before, after, _SERVED)


def test_v5_keeps_verdict_on_recorded_volume_fallback():
    before, after = _states([_item("pli_007", rationale=_UT007_PLI007)])
    check_v5(before, after, _SERVED)


# A coverage percentage is not an availability claim. Recorded false positive:
# ut_research_plan_007 run 0, scratch run 2026-09-24 (issue #2685), verbatim.
_UT007_RUN0_PLI006 = (
    "Thomas Flynn (I2) has no sources attached; his death is unlocated but bracketed "
    "by the 1860 census (alive) and Patrick's 1908 death certificate (names him as "
    "father). A will or estate administration listing heirs would directly document "
    "the father-son relationship and — if Thomas's wife survived him — supply her "
    "name (still unknown). The Pennsylvania Probate Records collection (1999196) "
    "returned personCount 0, so this is a browse of image group 007936749 (Schuylkill "
    "County Probate Records, 1851–1930, 412 images, 0% indexed). Date range is sized "
    "to Thomas's plausible death window, not Patrick's research window. Search "
    "variants: Flynn, Flinn."
)


def test_v5_ignores_a_coverage_percentage():
    before, after = _states([_item("pli_006", rationale=_UT007_RUN0_PLI006)])
    check_v5(before, after, _SERVED)


@pytest.mark.parametrize("phrase", ["4% name-indexed", "0 % record-searchable", "12.5%indexed"])
def test_v5_ignores_coverage_percentage_variants(phrase):
    before, after = _states([_item("pli_006", rationale=f"Collection 1999196 is only {phrase}.")])
    check_v5(before, after, _SERVED)


def test_v5_still_fires_on_indexed_claim_beside_an_unrelated_percentage():
    # The strip removes only "N% indexed"; a percentage elsewhere in the sentence
    # must not shield a real indexed claim.
    before, after = _states([_item("pli_006", rationale=(
        "The indexed collection 1999196 covers 40% of counties."
    ))])
    with pytest.raises(AssertionError, match="1999196"):
        check_v5(before, after, _SERVED)


def test_v5_still_fires_on_indexed_claim_after_a_percentage():
    before, after = _states([_item("pli_006", rationale=(
        "Volume 007936749 is 0% indexed, but collection 1999196 is fully indexed."
    ))])
    with pytest.raises(AssertionError, match="1999196"):
        check_v5(before, after, _SERVED)


# ut_research_plan_002, v1_2026-09-24_19-25-44, pli_012 verbatim (trimmed).
_UT002_V4_PLI012 = (
    "Pennsylvania Probate Records (collection 1999196) returned personCount 0 "
    "→ no indexed name search is possible; this is an image browse. "
    "Volume 007936749 (Schuylkill County Probate Records 1851–1930, 412 images, "
    "0% record-searchable) must be paged through manually."
)


def test_v5_ignores_no_indexed_name_search_phrase():
    # "no indexed name search is possible" negates the indexed claim — do not
    # fire even though _INDEXED_RE would match "indexed" in the sentence.
    before, after = _states([_item("pli_012", rationale=_UT002_V4_PLI012)])
    check_v5(before, after, _SERVED)


# ut_research_plan_q7m, v1_2026-09-25_08-29-32, pli_003 verbatim (trimmed).
_UT_Q7M_V6_PLI003 = (
    "collections_search returned 'Pennsylvania, Probate Records, 1683–1994' "
    "(collection 1999196, personCount 0) → images only, not name-indexed. "
    "volume_search returned image group 007936749 (Probate Records, Schuylkill "
    "County, 1851–1930, 0% record-searchable). Browse image-by-image for "
    "John Doyle's will or letters of administration."
)


def test_v5_ignores_not_name_indexed_phrase():
    # "not name-indexed" is an adjectival compound that negates the indexed
    # claim just like "not indexed" — do not fire.
    before, after = _states([_item("pli_003", rationale=_UT_Q7M_V6_PLI003)])
    check_v5(before, after, _SERVED)


# ut_research_plan_015, v1_2026-09-25_09-24-00, pli_003 verbatim (trimmed).
# Collection 2513529 has personCount 200408 — it IS indexed nationally, but the
# specific volume for this jurisdiction is unindexed (recordSearchablePercent:0).
_UT_015_V7_PLI003 = (
    "The national collection 2513529 (Denmark, Military Levying Rolls, 1789–1861, "
    "personCount 200K) is indexed at collection level, but volume_search shows image "
    "group 004748896 (Vestervig/Thisted Amt districts, 1789–1814, 1,204 images, "
    "recordSearchablePercent: 0) is entirely unindexed for this jurisdiction — "
    "browse the images rather than searching by name."
)
_SERVED_DK = [_call("collections_search", _collections([
    {"id": "2513529", "title": "Denmark, Military Levying Rolls, 1789-1861", "personCount": 200408},
]))]


def test_v5_ignores_unindexed_for_this_jurisdiction():
    # "unindexed for this jurisdiction" qualifies the local volume, not the
    # national collection. The collection IS indexed (personCount 200K), so V5
    # must not fire.
    before, after = _states([_item("pli_003", rationale=_UT_015_V7_PLI003)])
    check_v5(before, after, _SERVED_DK)


# ===========================================================================
# Already-attached-FAN-facts validator (issue #1948)
# ===========================================================================

TAGGED = {"tags": ["already-attached"]}
UNTAGGED = {"tags": ["planning"]}

RESEARCH = {"project": {"subject_person_ids": ["I1"]}}

TREE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "date": "1875",
                    "place": "Schuylkill County, Pennsylvania",
                    "value": "Purchased land, Deed Book 42 p. 118",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
        {
            "id": "I3",
            "names": [{"given": "", "surname": "Sheahan"}],
        },
    ]
}

BEFORE_STATE = {"research_json": RESEARCH, "tree_gedcomx_json": TREE}


def test_fires_when_fact_never_surfaced():
    """Proves the check actually fails: a response that never mentions
    Patrick's already-sourced 1875 fact must raise."""
    response = (
        "Here is the plan for Michael Sheahan's move to Schuylkill County: "
        "1880 census, 1900 census, church records, naturalization."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE, response, TAGGED)


def test_passes_when_name_date_and_value_content_present():
    """The intended pass case: the response names Patrick, his 1875 date,
    and restates a fragment of the fact's own content (a deed book)."""
    response = (
        "Patrick Sheahan (I2) already has a sourced 1875 deed book entry "
        "for land in Schuylkill County -- seven years before Michael's own "
        "documented arrival. Plan: 1880 census, 1900 census, church records."
    )
    check(BEFORE_STATE, response, TAGGED)  # does not raise


def test_passes_when_citation_sits_in_its_own_paragraph():
    """Proves the same-paragraph scoping removed during PR #2004 review
    (clack391) was a false-negative source, not a precision gain: this
    ordinary, correctly-written response cites the fact's content in a
    paragraph separate from the person's name, and would have wrongly
    failed under the old same-paragraph rule. Now that the check looks at
    the whole response, it correctly passes."""
    response = (
        "**Already attached (surveyed before planning)**\n\n"
        "Patrick Sheahan (I2)\n\n"
        "Source S1 records a land purchase in Schuylkill County dated 1875 "
        "(Deed Book 42, p. 118)."
    )
    check(BEFORE_STATE, response, TAGGED)  # does not raise


def test_fires_when_new_search_proposed_using_the_same_year():
    """Reproduces the exact false positive found in a committed run during
    PR #2004 review (clack391): a FAN plan item's own search-window header
    happens to reuse the fact's year ("Schuylkill County -- 1875-1905") in
    the same paragraph as Patrick's name, while the response never restates
    what the source actually records and instead proposes searching to
    *discover* it ("if Patrick preceded Michael..."). Name+date proximity
    alone cannot tell "citing a known fact" apart from "a new search that
    happens to start near the same year" -- only the value-gram requirement
    catches this, which is why a fact's `value` is required, not just its
    date, whenever the fact has one."""
    response = (
        "### Item 8 -- FAN -- Patrick Sheahan (I2) records\n"
        "Schuylkill County, PA -- 1875-1905\n"
        "Patrick is already in the tree with source S1. If Patrick preceded "
        "Michael in the county, that would support chain migration; search "
        "his 1880/1900 census and church records to confirm."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE, response, TAGGED)


def test_fires_when_only_name_present_not_date():
    """A bare mention of the person's name (e.g. planning a redundant new
    search for them) does not count as surfacing the already-attached fact --
    this is the exact failure mode issue #1948 reported. Also proves the
    failure message accurately reports which condition is missing (PR #2004
    review, EdmondOware): this scenario has the name present and the date
    absent, so the message must not claim "neither" is present."""
    response = (
        "Plan includes a FAN item: search census records for Patrick Sheahan "
        "(I2) to corroborate the family's origin and timing."
    )
    with pytest.raises(AssertionError) as exc_info:
        check(BEFORE_STATE, response, TAGGED)
    message = str(exc_info.value)
    assert "I2" in message
    assert "neither" not in message.lower()
    assert "the person's given name appears" in message


TREE_SHORT_NAME = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Ann", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "date": "1868",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_SHORT_NAME = {"research_json": RESEARCH, "tree_gedcomx_json": TREE_SHORT_NAME}


def test_name_and_date_present_but_unrelated_still_fails():
    """A coincidental date match alone must not pass: a real run's pre-plan
    narration happened to say "the 1875-1900 window" (an unrelated
    search-date range) before the plan ever mentioned Patrick, and Patrick's
    own paragraph never restates the fact's content. This is caught by the
    value-gram requirement, not by paragraph scoping (removed during PR
    #2004 review, clack391: scoping to one paragraph was itself a
    false-positive hole, not a precision gain -- see the validator's
    docstring). The response below carries neither "purchased land" nor
    "deed book" anywhere, which is what actually fails it here."""
    response = (
        "Discovering record collections for Schuylkill County in the "
        "1875-1900 window.\n\n"
        "Starting-point analysis: Michael Sheahan (I1) has zero attached "
        "sources. Patrick Sheahan (I2) holds source S1 in tree.gedcomx.json "
        "but no research.json source assertions."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE, response, TAGGED)


def test_short_name_substring_is_not_a_false_positive():
    """A short given name ('Ann') must not be treated as present just
    because it appears as a substring inside an unrelated word ('planning'
    contains 'ann'). Proves the word-boundary fix (PR #2004 review,
    EdmondOware): under the old plain-substring check this response would
    have wrongly counted as surfacing Ann's fact and the check would have
    passed silently even though nothing about Ann was actually said."""
    response = (
        "Plan for 1868 records: continue planning the census search and "
        "church record review for the family."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE_SHORT_NAME, response, TAGGED)


def test_skipped_when_not_tagged():
    """Untagged tests are not in scope -- must not raise even on a
    response that would otherwise fail."""
    response = "No mention of anyone."
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE_STATE, response, UNTAGGED)


def test_passes_vacuously_when_no_sourced_fan_facts():
    """A tree with no already-sourced non-subject fact has nothing to
    check -- must pass vacuously (nothing in scope), not fail. Named for
    what actually happens: the validator has no `pytest.skip()` branch for
    this case, it just finds nothing to add to `missed` (PR #2004 review,
    clack391 -- the previous name/docstring here claimed a skip that the
    code never performed)."""
    tree_no_sources = {
        "persons": [
            {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
            {"id": "I2", "names": [{"given": "Patrick", "surname": "Sheahan"}]},
        ]
    }
    before_state = {"research_json": RESEARCH, "tree_gedcomx_json": tree_no_sources}
    response = "No mention of anyone."
    check(before_state, response, TAGGED)  # does not raise (nothing in scope)


TREE_NONSTANDARD_DATE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "date": "~1845",
                    "standard_date": "Abt 1845",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_NONSTANDARD_DATE = {
    "research_json": RESEARCH,
    "tree_gedcomx_json": TREE_NONSTANDARD_DATE,
}


def test_extracted_year_matches_non_bare_year_date_formats():
    """The fact's date is `~1845` (approximate, not a bare year) -- of 113
    sourced facts with a date across the scenario corpus, only 9 are bare
    years (PR #2004 review, clack391's measurement). A literal `"~1845" in
    response` check fails against a response that naturally writes "about
    1845", so the check must extract and match the bare year too."""
    response = "Patrick Sheahan (I2) was born about 1845 in County Cork, per source S1."
    check(BEFORE_STATE_NONSTANDARD_DATE, response, TAGGED)  # does not raise


TREE_NO_DATE_HAS_VALUE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Occupation",
                    "value": "Coal miner, per 1880 census",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_NO_DATE_HAS_VALUE = {
    "research_json": RESEARCH,
    "tree_gedcomx_json": TREE_NO_DATE_HAS_VALUE,
}


def test_passes_on_value_content_alone_when_fact_has_no_date():
    """`date` is optional in the schema (PR #2004 review, clack391): a
    sourced fact with no date at all previously failed unconditionally no
    matter what the response said. A fact with a `value` but no date must
    still be satisfiable -- by the value content alone."""
    response = "Patrick Sheahan (I2) is already documented as a coal miner in the tree."
    check(BEFORE_STATE_NO_DATE_HAS_VALUE, response, TAGGED)  # does not raise


TREE_NO_DATE_NO_VALUE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_NO_DATE_NO_VALUE = {
    "research_json": RESEARCH,
    "tree_gedcomx_json": TREE_NO_DATE_NO_VALUE,
}


def test_passes_vacuously_when_fact_has_neither_date_nor_value():
    """A sourced fact with neither a date nor a value has no fact-specific
    content to confirm was read -- it is out of scope, the same as a
    person with no sourced facts at all, not an unconditional fail. Must
    not raise even though the response never mentions Patrick."""
    response = "No mention of anyone."
    check(BEFORE_STATE_NO_DATE_NO_VALUE, response, TAGGED)  # does not raise
