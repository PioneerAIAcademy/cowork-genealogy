"""Hand-off validators accept an agent spawn as well as a `Skill` call (issue #2825).

Under the 2026-09-22 ruling each skill becomes an agent, so a router's correct
hand-off to a converted callee is an `Agent` spawn. The four validators that
assert a hand-off read `handoffs`, not `skills_invoked` alone. Every validator
here is exercised in both directions: a spawn-only run must pass, and a run that
spawns the wrong agent, or hands off nowhere, must still fail.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from harness.loader import load_test_from_dict
from harness.orchestrator import _stub_agents
from harness.skill_runner import default_spawn_denial, handoffs, spawn_stub_denial

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "eval" / "harness" / "validators"))


def _validators(name):
    path = REPO_ROOT / "eval" / "harness" / "validators" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_handoffs_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _skill(name, **extra):
    return {"tool": "Skill", "args": {"skill": name}, **extra}


def _spawn(name, **extra):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": "p"}, **extra}


# --- handoffs --------------------------------------------------------------


def test_handoffs_interleaves_skill_calls_and_spawns_in_call_order():
    calls = [_spawn("proof-conclusion"), {"tool": "Read", "args": {}}, _skill("question-selection")]
    assert handoffs(["question-selection"], calls) == ["proof-conclusion", "question-selection"]


def test_handoffs_drops_a_spawn_made_inside_a_subagent():
    calls = [_skill("research-plan"), _spawn("record-extractor", agent_id="a1")]
    assert handoffs(["research-plan"], calls) == ["research-plan"]


def test_handoffs_drops_a_spawn_with_no_subagent_type():
    calls = [{"tool": "Agent", "args": {"description": "d", "prompt": "p"}}]
    assert handoffs([], calls) == []


def test_handoffs_falls_back_to_skills_invoked_when_no_skill_record_exists():
    assert handoffs(["search-records"], []) == ["search-records"]
    assert handoffs(["search-records"], [_spawn("locality-guide")]) == ["search-records", "locality-guide"]


# --- test_routes_to_expected_skill (research routing suite) ------------------

ROUTE_TO_LOCALITY = {"skill": "research", "tags": ["routing", "routes-to:locality-guide"]}


def test_router_passes_when_its_only_hand_off_is_a_spawn():
    _validators("test_research").test_routes_to_expected_skill(
        [], [_spawn("locality-guide")], ROUTE_TO_LOCALITY
    )


def test_router_still_passes_on_a_skill_call():
    _validators("test_research").test_routes_to_expected_skill(
        ["locality-guide"], [_skill("locality-guide")], ROUTE_TO_LOCALITY
    )


@pytest.mark.parametrize(
    "skills,calls",
    [
        ([], []),
        ([], [_spawn("research-plan")]),
        (["locality-guide"], [_spawn("research-plan"), _skill("locality-guide")]),
        ([], [_spawn("locality-guide", agent_id="a1")]),
    ],
    ids=["no_hand_off", "wrong_agent", "wrong_agent_first", "nested_spawn_only"],
)
def test_router_fails_when_the_first_hand_off_is_not_the_expected_one(skills, calls):
    with pytest.raises(AssertionError):
        _validators("test_research").test_routes_to_expected_skill(skills, calls, ROUTE_TO_LOCALITY)


def test_router_stop_fails_on_a_spawn():
    stop = {"skill": "research", "tags": ["routing", "routes-to:stop"]}
    with pytest.raises(AssertionError):
        _validators("test_research").test_routes_to_expected_skill([], [_spawn("gps-mentor")], stop)


# --- the two callee hand-offs inside skills that stay skills -------------------

ESCALATE = {"tags": ["familysearch-exhausted"]}


def _return(text: str) -> list[dict]:
    return [{"subagent_type": "search-records", "text": text}]


def test_escalation_passes_on_a_named_hand_back_and_fails_without_one():
    # search-records is an agent (issue #2243) and cannot spawn: the escalation is a
    # hand-back it names in its own return, so the validator reads that text.
    mod = _validators("test_search_records")
    named = _return("FamilySearch variants exhausted; hand back to `search-external-sites` with: Patrick Flynn, pli_001.")
    mod.test_escalates_to_external_sites_after_fs_exhaustion(named, "", ESCALATE)
    mod.test_escalates_to_external_sites_after_fs_exhaustion([], "Hand-back: search-external-sites", ESCALATE)
    # An offer in prose names the site, not the agent, and is not an escalation.
    with pytest.raises(AssertionError):
        mod.test_escalates_to_external_sites_after_fs_exhaustion(
            _return("FamilySearch is exhausted. Shall I check Ancestry?"), "", ESCALATE
        )
    # Naming the agent far from a hand-back is not one either.
    with pytest.raises(AssertionError):
        mod.test_escalates_to_external_sites_after_fs_exhaustion(
            _return("search-external-sites exists.\n\nNothing else."), "", ESCALATE
        )
    # Only the exhaustion test asserts this.
    with pytest.raises(pytest.skip.Exception):
        mod.test_escalates_to_external_sites_after_fs_exhaustion([], "", {"tags": []})


NO_SOLE = {"tags": ["no-sole-repository-claim"], "delegation": "Find every Tallman family."}


@pytest.mark.parametrize("text", [
    "| **NY State 1825, 1835, 1845** | **Not on FamilySearch** (held at NY State Library only) |",
    "The 1835 census is only available at the NYSL.",
    "Status: in_progress\n---\nThese early state censuses are not available elsewhere.",
    "The 1845 returns are held exclusively at the State Library.",
    "The 1825 schedules are held only at the New York State Library.",
    "They are available only at the NYSL.",
    "These are only at the NY State Library.",
    "The surviving schedules exist only by the State Library's microfilm.",
    "Not on FamilySearch (NY State Library only)",
    "The NYSL is the sole repository for these years.",
    "No other repository holds them.",
    "They are not available anywhere else.",
])
def test_sole_repository_claim_fails(text):
    with pytest.raises(AssertionError):
        _validators("test_search_records").test_no_sole_repository_claim(_return(text), "", NO_SOLE)


@pytest.mark.parametrize("text", [
    "1825, 1835, 1845: not on FamilySearch.\nHand-back: search-external-sites — NY state census, Clinton and Essex Counties, 1825/1835/1845; FamilySearch holds no collection for these years",
    "The wiki lists the 1892 census on Ancestry and FamilySearch.",
    "Only 1855-1875 are indexed on FamilySearch; the New York State Library holds a county list.",
    "The originals are held at the New York State Library, and only 1855 onward is on FamilySearch.",
    "Originals held at the NYSL; only county lists survive.",
    "Hiram Tallman was found only in the 1849 directory.",
    "FamilySearch's New York state census holdings begin only at 1855.",
    "| Essex | Keeseville directory (Clinton only) |",
])
def test_sole_repository_claim_passes_a_legitimate_return(text):
    _validators("test_search_records").test_no_sole_repository_claim(_return(text), "", NO_SOLE)


def test_sole_repository_claim_grades_the_agent_not_the_relay():
    # A direct test grades the agent's own return; the dispatcher's relay is not it.
    _validators("test_search_records").test_no_sole_repository_claim(
        _return("Not on FamilySearch."), "held at NY State Library only", NO_SOLE
    )


def test_sole_repository_claim_is_tag_gated():
    with pytest.raises(pytest.skip.Exception):
        _validators("test_search_records").test_no_sole_repository_claim(
            _return("held at NY State Library only"), "", {"tags": []}
        )


def test_no_collection_hand_back_needs_a_search_first():
    mod = _validators("test_search_records")
    mod.test_searched_before_no_collection_hand_back(
        [{"tool": "mcp__genealogy__record_search", "args": {"surname": "Tallman"}}], NO_SOLE
    )
    with pytest.raises(AssertionError):
        mod.test_searched_before_no_collection_hand_back(
            [{"tool": "mcp__genealogy__wiki_read", "args": {"url": "New_York_Census"}}], NO_SOLE
        )
    with pytest.raises(pytest.skip.Exception):
        mod.test_searched_before_no_collection_hand_back([], {"tags": []})


# --- outside holdings grounded per (site, year) in tool responses (issue #4352) ---

HOLDING = {"tags": ["outside-holding-claim"], "delegation": "Find every Tallman family."}


def _fixture_call(fixture: str) -> dict:
    # The test builds the call the mock would have logged; the validator itself
    # never reads fixture files.
    path = REPO_ROOT / "eval" / "fixtures" / "mcp" / f"{fixture}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"tool": f"mcp__genealogy__{data['tool']}", "args": data["args"], "response": data["response"]}


NY_WIKI = _fixture_call("wiki-read-new-york-census")
US_WIKI = _fixture_call("wiki-read-united-states-census")


def _links(*results) -> dict:
    return {"tool": "mcp__genealogy__external_links_search", "args": {}, "response": {"results": list(results)}}


def _holding(text, calls=(), test=HOLDING):
    _validators("test_search_records").report_names_no_ungrounded_outside_holding(
        list(calls), _return(text), "", test
    )


def _with_delegation(delegation):
    return {"tags": ["outside-holding-claim"], "delegation": delegation}


# The 13 claims PR #4229's strict check failed (commit 7319cd9d6). With no tool
# response, none is grounded.
@pytest.mark.parametrize("text", [
    "The surviving schedules for 1825, 1835, and 1845 (not all counties made it through, but Clinton and Essex are among those that did survive in part) are indexed on Ancestry.com, and the original microfilm is held at the New York State Library",
    "Handing back to search-external-sites: Ancestry indexes the surviving 1825/1835/1845 NY state census schedules.",
    "The 1835 returns are available on MyHeritage.",
    "These years are digitized and hosted at Find My Past.",
    "The originals are held by Ancestry.",
    "Ancestry.com holds the 1845 census.",
    "The surviving schedules are indexed on **Ancestry.com**, with originals held at the New York State Library.",
    "The right next step is to check Ancestry.com, which has indexed many of the surviving New York state census years.",
    "The next step is to check Ancestry.com, which holds indexed images of these years.",
    "Search those earlier censuses through Ancestry (which has indexed them from microfilm).",
    "FamilySearch lacks those years, and other genealogy sites index some of them.",
    "The next step is to search through another site, such as Ancestry or the New York State Library, which holds surviving county schedules from those earlier state censuses.",
    "Look through other repositories (such as Ancestry or the New York State Library), which hold surviving county copies.",
])
def test_outside_holding_with_no_tool_response_is_reported(text):
    with pytest.raises(AssertionError):
        _holding(text)


# The 9 legitimate returns the strict check passed: none makes a holding claim.
@pytest.mark.parametrize("text", [
    "1825, 1835, 1845: not on FamilySearch.\nHand-back: search-external-sites — NY state census, Clinton and Essex Counties, 1825/1835/1845; FamilySearch holds no collection for these years",
    "search-external-sites can generate an Ancestry search URL for those years and counties.",
    "Shall I generate Ancestry/MyHeritage URLs for it (search-external-sites)?",
    "Only 1855-1875 are indexed on FamilySearch.",
    "Hiram Tallman was found in the 1849 directory, held on FamilySearch.",
    "search-external-sites can build an Ancestry search link, which has the counties prefilled.",
    "Not on FamilySearch. search-external-sites can check other sites for these years.",
    "Hand-back: search-external-sites — NY state censuses 1825/1835/1845, Tallman, Clinton and Essex; FamilySearch holds no collection for these years; check Ancestry",
    "The New York State Library keeps a county list; FamilySearch holds no collection for these years.\nsearch-external-sites can check Ancestry.",
])
def test_a_reply_with_no_holding_claim_is_not_reported(text):
    _holding(text)


def test_issue_case_a_wiki_does_not_tie_ancestry_to_1825_1845():
    with pytest.raises(AssertionError, match="ancestry 1825"):
        _holding("the 1825, 1835 and 1845 schedules are indexed on Ancestry.com", [NY_WIKI])


@pytest.mark.parametrize("text", [
    "the 1855 state census is on Ancestry.com",
    "The 1855 state census is indexed on Ancestry.com.",
])
def test_issue_case_b_wiki_row_ties_ancestry_to_1855(text):
    _holding(text, [NY_WIKI])


def test_is_on_a_site_is_a_holding_claim():
    # Without "is on" in the holding words, case (b) would pass unexamined.
    with pytest.raises(AssertionError):
        _holding("The 1825 state census is on Ancestry.com.", [NY_WIKI])


def test_issue_case_c_no_tool_calls():
    with pytest.raises(AssertionError):
        _holding("the 1825, 1835 and 1845 schedules are indexed on Ancestry.com")


@pytest.mark.parametrize("calls", [[], [NY_WIKI]])
def test_issue_case_d_no_site_named(calls):
    _holding("The 1825, 1835 and 1845 schedules are held at the New York State Library.", calls)


def test_wiki_grid_ties_a_site_to_the_year_column_above_it():
    # 1820 is linked to Ancestry only in the federal grid (a year row, then a link row).
    _holding("Ancestry.com indexes the 1820 census.", [NY_WIKI])
    with pytest.raises(AssertionError):
        _holding("Ancestry.com indexes the 1825 census.", [NY_WIKI])


def test_wiki_list_line_ties_a_site_to_the_year_it_opens_on():
    _holding("Ancestry's independently indexed 1870 census holds records FamilySearch may miss.", [US_WIKI])
    with pytest.raises(AssertionError):
        _holding("Ancestry's independently indexed 1875 census holds records FamilySearch may miss.", [US_WIKI])


def test_a_vital_year_is_not_the_record_sets_year():
    _holding(
        "Search Ancestry's independently-indexed 1870 US Federal Census for Patrick Flynn, "
        "born ca. 1845, Schuylkill County, which holds records FamilySearch may miss.",
        [US_WIKI],
    )
    with pytest.raises(AssertionError):
        _holding("Ancestry indexes the 1845 census.", [US_WIKI])


def test_an_abbreviation_does_not_end_the_sentence():
    # Split at "St.", the claim half names no year and would fall back to 1855.
    with pytest.raises(AssertionError):
        _holding(
            "Ancestry.com indexes the St. Lawrence County 1825 census.",
            [NY_WIKI],
            _with_delegation("Find the Tallmans in the 1855 New York state census."),
        )


def test_external_links_year_range_grounds_a_claim():
    federal = {"url": "https://www.ancestry.com/search/collections/7163/", "linkText": "1870 census", "startYear": 1860, "endYear": 1880}
    _holding("Ancestry indexes the 1870 census.", [_links(federal)])
    with pytest.raises(AssertionError):
        _holding("Ancestry indexes the 1850 census.", [_links(federal)])
    tax = {"url": "https://www.ancestry.com/search/collections/7667/", "linkText": "Pennsylvania, U.S., Tax and Exoneration Lists, 1768-1801"}
    _holding("Ancestry holds the 1790 tax lists.", [_links(tax)])
    with pytest.raises(AssertionError):
        _holding("MyHeritage holds the 1790 tax lists.", [_links(tax)])


def test_a_yearless_claim_takes_the_delegations_years():
    _holding("Ancestry indexes these schedules.", [NY_WIKI], _with_delegation("Search the 1855 NY state census."))
    with pytest.raises(AssertionError):
        _holding("Ancestry indexes these schedules.", [NY_WIKI], _with_delegation("Search the 1825 NY state census."))
    with pytest.raises(AssertionError, match="no year"):
        _holding("Ancestry indexes these schedules.", [NY_WIKI])


def test_a_yearless_claim_reads_only_the_delegations_first_paragraph():
    # ut_search_records_018's delegation: "…in the 1850 US census.", then a plan
    # item whose subject is born ~1845.
    test_file = REPO_ROOT / "eval" / "tests" / "unit" / "search-records" / "escalate-to-external-after-fs-exhaustion.json"
    delegation = json.loads(test_file.read_text(encoding="utf-8"))["input"]["delegation"]
    assert "1845" in delegation
    _holding("Ancestry indexes these schedules.", [US_WIKI], _with_delegation(delegation))


def test_other_sites_are_never_grounded():
    with pytest.raises(AssertionError, match="other sites"):
        _holding("Other sites hold the 1855 census.", [NY_WIKI])


@pytest.mark.parametrize("calls", [
    [{"tool": "mcp__genealogy__wiki_read", "response": None}],
    [{"tool": "mcp__genealogy__wiki_read", "response": "| 1855 | at [Ancestry](https://www.ancestry.com/x) |"}],
    [{"tool": "mcp__genealogy__external_links_search", "response": {"results": None}}],
    [{"tool": "mcp__genealogy__external_links_search", "response": {"results": [None, "x", {"url": None}]}}],
    [{"tool": "mcp__genealogy__external_links_search", "response": {"results": [{"url": "https://www.ancestry.com/a", "startYear": "abc"}]}}],
    [None, "not a call"],
])
def test_malformed_tool_responses_do_not_crash(calls):
    _holding("The 1855 state census is held by NYSL.", calls)
    with pytest.raises(AssertionError):
        _holding("Ancestry holds the 1825 census.", calls)


def test_a_string_response_with_a_table_still_grounds():
    _holding("Ancestry holds the 1855 census.", [{"tool": "mcp__genealogy__wiki_read", "response": "| 1855 | at [Ancestry](https://www.ancestry.com/x) |"}])


@pytest.mark.parametrize("text", [
    "FamilySearch does not hold these years; search-external-sites can check Ancestry.",
    "Ancestry does not hold the 1825 census.",
    "These years aren't indexed on FamilySearch; search-external-sites can check MyHeritage.",
    "An Ancestry search link is available through search-external-sites.",
    "The surviving 1825 schedules are not on FamilySearch; search-external-sites can check other sites.",
])
def test_a_negated_holding_or_a_link_offer_is_not_a_claim(text):
    _holding(text, [NY_WIKI])


@pytest.mark.parametrize("text", [
    "No FamilySearch collection is available for the 1835 census; Ancestry may have it.",
    "Nothing for 1835 is indexed anywhere I can reach; Ancestry and MyHeritage are outside my tools.",
    "No FamilySearch collection is available for 1835, so I could not search Ancestry from here.",
])
def test_a_holding_word_familysearch_owns_is_not_an_outside_claim(text):
    _holding(text, [NY_WIKI])


@pytest.mark.parametrize("text", [
    "The 1835 census is not on FamilySearch; Ancestry holds the 1835 schedules.",
    "FamilySearch has no collection for 1835, and the schedules are indexed on Ancestry.com.",
    "FamilySearch has no collection for 1835, and the schedules are held by **Ancestry**.",
])
def test_familysearch_earlier_in_the_sentence_does_not_hide_a_claim(text):
    with pytest.raises(AssertionError, match="ancestry 1835"):
        _holding(text, [NY_WIKI])


# Second code review of PR #4468: each claim below went unreported.
@pytest.mark.parametrize("text, missing", [
    ("FamilySearch has no collection for 1825, but the census is on Ancestry.", "ancestry 1825"),
    ("The 1825 census is not on FamilySearch but is on Ancestry.", "ancestry 1825"),
    ("The 1825 census is not available on FamilySearch, only on Ancestry.", "ancestry 1825"),
    ("Ancestry and FamilySearch both hold the 1825 census.", "ancestry 1825"),
    ("The 1825 census is held on FamilySearch and Ancestry.", "ancestry 1825"),
    ("Ancestry holds the earlier state censuses (1825-1845).", "ancestry 1825"),
    ("Ancestry indexes state censuses from about 1825.", "ancestry 1825"),
    ("Ancestry has the 1825 census.", "ancestry 1825"),
    ("The 1825 census can be found on Ancestry.", "ancestry 1825"),
    ("You can find the 1825 census on Ancestry.", "ancestry 1825"),
    ("Ancestry offers the 1825 schedules.", "ancestry 1825"),
    ("Ancestry contains the 1825 schedules.", "ancestry 1825"),
    ("FindAGrave holds the 1825 memorial.", "findagrave 1825"),
    ("Newspapers.com has the 1825 records.", "newspapers 1825"),
    # The measured no_fs_collection claim (scratch_2026-11-10_16-54-51, run 1).
    ("The 1825, 1835, and 1845 New York state censuses that survived are held elsewhere, with "
     "Ancestry being one of the main providers and the New York State Library's own listing "
     "identifying which counties' schedules exist for each year.", "ancestry 1825"),
])
def test_claims_the_second_review_found_unreported(text, missing):
    with pytest.raises(AssertionError, match=missing):
        _holding(text, [NY_WIKI], _with_delegation("Search the 1855 NY state census."))


# ...and each of these was reported though it claims no outside holding, or
# reported a site it does not claim.
@pytest.mark.parametrize("text", [
    "The 1825 originals are held at the New York State Library. search-external-sites can check Ancestry.",
    "The 1825 originals are held at the New York State Library, and search-external-sites can check Ancestry.",
    "An Ancestry search is available through search-external-sites.",
    "Ancestry may have it.",
])
def test_reports_the_second_review_found_false(text):
    _holding(text, [NY_WIKI])


@pytest.mark.parametrize("text, reported, not_reported", [
    ("Ancestry holds the 1855 census, and MyHeritage was not checked.", None, "myheritage"),
    ("Ancestry does not hold the 1825 census but MyHeritage holds it.", "myheritage 1825", "ancestry"),
    ("Ancestry is not indexing 1825 yet, but MyHeritage holds the 1825 census.", "myheritage 1825", "ancestry"),
])
def test_only_the_site_a_holding_word_is_about_is_checked(text, reported, not_reported):
    try:
        _holding(text, [NY_WIKI])
        message = ""
    except AssertionError as e:
        message = str(e).split("ties:", 1)[-1]
    assert (reported in message) if reported else message == ""
    assert not_reported not in message


# Third code review of PR #4468.
def test_a_stored_external_collections_row_grounds_a_claim():
    # research_query({section: "external_collections"}) returns stored rows in
    # snake_case; search-records holds research_query.
    row = {"url": "https://www.ancestry.com/search/collections/7163/", "link_text": "United States Federal Census",
           "start_year": "1870", "end_year": "1870"}
    call = {"tool": "mcp__genealogy__research_query", "response": {"section": "external_collections", "rows": [row]}}
    _holding("Ancestry indexes the 1870 census.", [call])
    with pytest.raises(AssertionError, match="ancestry 1880"):
        _holding("Ancestry indexes the 1880 census.", [call])


@pytest.mark.parametrize("text", [
    "Ancestry/MyHeritage URLs for the 1825 census are available from search-external-sites.",
    "An Ancestry URL for 1825 is available through search-external-sites.",
    "No 1825 census is available on Ancestry.",
    "None of the 1825 census is available on Ancestry.",
    "The 1825 census is indexed by FamilySearch, not by Ancestry.",
    "Unlike Ancestry, the 1825 census is held at the county clerk's office.",
])
def test_reports_the_third_review_found_false(text):
    _holding(text, [NY_WIKI])


def test_a_capitalised_record_set_title_keeps_its_years():
    # The NY wiki grounds Ancestry 1855 and 1875; the title's years are the claim's.
    _holding("Ancestry holds the New York State Census (1855-1875).", [NY_WIKI],
             _with_delegation("Search the 1825 NY state census."))


def test_a_site_set_against_familysearch_is_still_the_holder():
    with pytest.raises(AssertionError, match="ancestry 1825"):
        _holding("Ancestry, not FamilySearch, holds the 1825 census.", [NY_WIKI])


def test_link_text_ranges_stay_within_record_years():
    link = {"url": "https://www.ancestry.com/x", "linkText": "Records 1000-9999"}
    validators = _validators("test_search_records")
    assert validators._link_years(link) == set()


# Fourth review of PR #4468: a site standing in for an earlier holding word.
@pytest.mark.parametrize("text, missing", [
    ("Ancestry doesn't hold the 1825 census, but MyHeritage does.", "myheritage 1825"),
    ("The 1825 census isn't indexed on FamilySearch, but Ancestry is.", "ancestry 1825"),
    ("FamilySearch does not hold the 1825 schedules, while Find My Past does.", "findmypast 1825"),
])
def test_a_site_that_stands_in_for_a_holding_word_is_a_claim(text, missing):
    with pytest.raises(AssertionError, match=missing):
        _holding(text, [NY_WIKI])


@pytest.mark.parametrize("text", [
    "Ancestry doesn't hold the 1825 census, but MyHeritage doesn't either.",
    "Ancestry doesn't hold the 1825 census, but MyHeritage does not either.",
    "I checked the catalog, but Ancestry is outside my tools.",
])
def test_a_negated_or_unrelated_stand_in_is_not_a_claim(text):
    _holding(text, [NY_WIKI])


# One case per rule that no other rule covers.
def test_a_semicolon_keeps_a_years_claim_apart():
    # Without the split the sentence's years are {1855, 1825} and Ancestry is
    # checked against 1825, which the NYSL clause is about.
    _holding("Ancestry holds the 1855 census; the 1825 originals are at the NYSL.", [NY_WIKI])


def test_a_site_named_before_familysearch_does_not_take_its_holding_word():
    _holding("I tried Ancestry, but no FamilySearch collection is available for 1825.", [NY_WIKI])


def test_a_holding_word_is_not_given_a_site_an_earlier_holder_already_closed():
    _holding(
        "Ancestry was searched, the 1825 originals are held at the New York State Library, "
        "which also hosts the 1835 returns.",
        [NY_WIKI],
    )


def test_a_negated_holding_word_after_the_site_claims_nothing():
    _holding("On Ancestry, the 1825 schedules are not indexed.", [NY_WIKI])


def test_a_response_logged_as_json_text_still_grounds():
    serialized = {"tool": "mcp__genealogy__wiki_read", "response": json.dumps(NY_WIKI["response"])}
    _holding("Ancestry holds the 1855 census.", [serialized])


def test_a_negation_elsewhere_does_not_hide_a_claim():
    with pytest.raises(AssertionError, match="ancestry 1825"):
        _holding("FamilySearch does not hold them, but Ancestry holds the 1825 census.", [NY_WIKI])


@pytest.mark.parametrize("text", [
    "Ancestry indexes the U.S. 1825 census.",
    "Ancestry holds the N.Y. 1825 state census.",
])
def test_an_initialism_does_not_end_the_sentence(text):
    with pytest.raises(AssertionError, match="ancestry 1825"):
        _holding(text, [NY_WIKI], _with_delegation("Search the 1855 NY census."))


@pytest.mark.parametrize("text", [
    "Search Ancestry's 1870 census for Patrick, born in 1845, which holds records FamilySearch may miss.",
    "Search Ancestry's 1870 census for Patrick Flynn (1845–1910), which holds records FamilySearch may miss.",
])
def test_born_in_and_a_lifespan_are_vital_years(text):
    _holding(text, [US_WIKI])


def test_link_text_naming_separate_years_grounds_only_those_years():
    link = {"url": "https://www.ancestry.com/search/collections/1/", "linkText": "New York State Census, 1855, 1875"}
    _holding("Ancestry holds the 1875 census.", [_links(link)])
    with pytest.raises(AssertionError, match="ancestry 1865"):
        _holding("Ancestry holds the 1865 census.", [_links(link)])


def test_outside_holding_report_grades_the_agent_and_is_tag_gated():
    # The dispatcher's relay is not the agent's return on a direct test.
    _validators("test_search_records").report_names_no_ungrounded_outside_holding(
        [], _return("Not on FamilySearch."), "Ancestry.com holds the 1845 census.", HOLDING
    )
    with pytest.raises(pytest.skip.Exception):
        _holding("Ancestry.com holds the 1845 census.", test={"tags": []})
    with pytest.raises(pytest.skip.Exception):
        _holding("Ancestry.com holds the 1845 census.", test={**HOLDING, "type": "negative"})


# --- Warning gate (issue #2840): replaced check-warnings hand-off tests --------
# The engine gate now refuses unjustified warnings at write time, so the
# validators no longer check for check-warnings hand-offs. No eval validator
# asserts the gate at all — the engine enforces it and PR 1's tests prove it
# (`guardrail-enforcement-spec.md`, "No eval validator asserts this gate").
# What remains is the shadow detector, tested in test_skill_invocation.py.


@pytest.mark.parametrize(
    "skills,calls,ok",
    [
        ([], [], True),
        (["locality-guide"], [_skill("locality-guide")], False),
        ([], [_spawn("locality-guide")], False),
        ([], [_spawn("gps-mentor")], True),
    ],
    ids=["no_hand_off", "skill_route", "agent_route", "other_agent"],
)
def test_research_plan_never_reaches_locality_guide(skills, calls, ok):
    """Asserts a hand-off did NOT happen, so before issue #2825 a spawn of the
    converted callee passed it: it failed open."""
    check = lambda: _validators("test_research_plan").test_research_plan_no_out_of_lane_tools(  # noqa: E731
        [], [], skills, calls
    )
    if ok:
        check()
    else:
        with pytest.raises(AssertionError):
            check()


@pytest.mark.parametrize(
    "skills,calls,ok",
    [
        ([], [], False),
        (["research-plan"], [_skill("research-plan")], True),
        ([], [_spawn("research-plan")], True),
    ],
    ids=["no_hand_off", "skill_route", "agent_route"],
)
def test_a_run_that_only_handed_off_is_not_dead(skills, calls, ok):
    check = lambda: _validators("test_universal").test_activated_run_produces_response(  # noqa: E731
        True, None, 0, 0, "", {"skill": "research"}, skills, calls
    )
    if ok:
        check()
    else:
        with pytest.raises(AssertionError):
            check()


def _stub_spec(entries):
    return load_test_from_dict(
        {
            "test": {"id": "ut_handoffs_001", "skill": "research", "name": "h", "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "go", "scenario": None},
            "mcp_fixtures": [],
            "judge_context": [],
            "execution": {"stub_skills": entries},
        }
    )


# --- a stubbed callee converted to an agent is stubbed at its spawn ------------


def test_spawn_of_a_stubbed_agent_is_denied_and_continued():
    out = spawn_stub_denial("Agent", {"tool_input": {"subagent_type": "locality-guide"}}, {"locality-guide": None})
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "continue_" not in out


@pytest.mark.parametrize(
    "tool,data",
    [
        ("Agent", {"tool_input": {"subagent_type": "research-plan"}}),
        ("Agent", {"tool_input": {"subagent_type": "locality-guide"}, "agent_id": "a1"}),
        ("Skill", {"tool_input": {"skill": "locality-guide"}}),
        ("Agent", {"tool_input": {"description": "d"}}),
    ],
    ids=["other_agent", "nested_spawn", "skill_call", "general_purpose"],
)
def test_spawn_stub_leaves_everything_else_alone(tool, data):
    assert spawn_stub_denial(tool, data, {"locality-guide": None}) is None


def test_stub_agents_are_only_the_entries_with_no_skill_directory(tmp_path):
    (tmp_path / "search-records").mkdir()
    spec = _stub_spec(["search-records", {"skill": "locality-guide", "response": "r"}])
    assert _stub_agents(spec, tmp_path) == {"locality-guide": "r"}


def test_a_stub_that_is_still_a_skill_is_denied_at_its_spawn_by_the_default(tmp_path):
    """A paired name that ships as both a skill and an agent is not in
    `_stub_agents` — the skill directory makes it return None — but its spawn
    is still denied, by `default_spawn_denial` (#3568), and with the entry's
    canned text. It cannot be opted in either: runnability refuses a name in
    both `run_agents` and `stub_skills`.

    After issue #2738 deleted `research-exhaustiveness`'s skill directory, no
    paired names remain in the shipped plugin.  This test uses `tmp_path` to
    create a synthetic skill directory instead.  `route-shortcut-guard.json`
    supplied the real paired name until then, and now ends at its first stubbed
    hand-off anyway: `stop_at_stub`.
    """
    (tmp_path / "fake-paired-skill").mkdir()
    spec = _stub_spec([{"skill": "fake-paired-skill", "response": "canned"}])
    assert _stub_agents(spec, tmp_path) is None
    spawn = {"tool_input": {"subagent_type": "fake-paired-skill"}}
    assert spawn_stub_denial("Agent", spawn, {}) is None
    denial = default_spawn_denial("Agent", spawn, {"research"}, {"fake-paired-skill": "canned"})
    assert denial is not None
    assert "canned" in json.dumps(denial)


def test_a_stub_with_no_skill_directory_is_stubbed_at_its_spawn():
    """The other direction, on the real plugin tree: an agent-only callee in the
    same fixture IS denied at its spawn, which is what issue #2825 buys."""
    spec = _stub_spec(["proof-conclusion", "gps-mentor", "person-evidence", "research-exhaustiveness"])
    assert _stub_agents(spec, REPO_ROOT / "packages" / "engine" / "plugin" / "skills") == {
        "proof-conclusion": None,
        "gps-mentor": None,
        "person-evidence": None,
        "research-exhaustiveness": None,
    }
