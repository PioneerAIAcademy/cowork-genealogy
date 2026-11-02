"""Direct tests for `test_research.test_names_collections_only_from_search`.

The validator runs only on a test tagged `names-collections-only-from-search`, whose one
test serves an empty `collections_search`. These cases prove it fires on the Kenya
shape in every form a reply can carry a title, and passes the replies a correct run
writes. `testpaths` excludes `validators/`, which is why they live here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_names_collections_only_from_search as check  # noqa: E402

TAGGED = {"skill": "research", "tags": ["boundary", "names-collections-only-from-search"]}
KENYA_DEATHS = "Kenya, Civil Registration, deaths 1904–1967"
ARKANSAS = "Arkansas, Freedmen's Bureau Field Office Records, 1865-1872"


def _search(*titles: str) -> dict:
    return {
        "tool": "mcp__genealogy__collections_search",
        "args": {"standardPlace": "Kenya"},
        "response": {"scope": "Kenya", "totalForPlace": len(titles), "results": [{"title": t} for t in titles]},
    }


EMPTY = [_search()]


@pytest.mark.parametrize(
    "reply",
    [
        f"He lived near Kisumu. {KENYA_DEATHS} would be the place to start.",
        "Start with Kenya, Civil Registration, deaths 1904-1967 for his death.",
        f"- **{KENYA_DEATHS}**",
        "FamilySearch collections searchable now: Kenya, African Court Records, 1904–1967; "
        f"{KENYA_DEATHS}",
        f"Here are Kenyan records you can search:\n- Kenya, African Court Records, 1904–1967\n- {KENYA_DEATHS}",
        f"The “{KENYA_DEATHS}” collection is searchable now.",
        f"{KENYA_DEATHS} (FamilySearch)",
        f"[{KENYA_DEATHS}](https://www.familysearch.org/search/collection/0000000)",
        f"{KENYA_DEATHS}I'll look for his entry next.",
        "| Kenya, Civil Registration of Births | ~1904–1960 |",
        "Search Kenya Births and Baptisms, 1900–1960 for him.",
    ],
    ids=[
        "a-plain-title", "b-hyphen-variant", "b-bold-list-item", "i-inline-after-colon",
        "j-list-under-lead-in", "k-smart-quoted", "l-trailing-parenthetical",
        "m-markdown-link", "n-joined-text-block", "o-table-row-one-comma",
        "p-one-comma-specific-record-type",
    ],
)
def test_an_unreturned_title_fires(reply):
    with pytest.raises(AssertionError, match="no collections_search result returned"):
        check(reply, EMPTY, TAGGED)


@pytest.mark.parametrize(
    ("reply", "calls"),
    [
        (f"FamilySearch lists “{ARKANSAS.replace('-', '–')}”, which is searchable.", [_search(ARKANSAS)]),
        ("Civil registration for Kenya may exist but is unconfirmed on FamilySearch.", EMPTY),
        ("Wadhala Wadhala (1888–1960) is the subject.", EMPTY),
        ("He lived in Kisumu, Kenya, 1888–1960.", EMPTY),
        ("FamilySearch has no indexed records for Kenya. Wadhala lived in Kisumu, Kenya, 1888–1960.", EMPTY),
        ("Kenya National Archives, Nairobi — colonial district records, 1895–1963", EMPTY),
        (f"Search {ARKANSAS} next.", [_search(ARKANSAS)]),
        (
            "The Kenya Registration of Births and Deaths Ordinance was strengthened over time, "
            "but gaps remain common for the 1888–1930 period especially.",
            EMPTY,
        ),
        ("Here is what I can tell you about the record landscape for Kenya, 1888–1960:", EMPTY),
        ("## Kenya Records, 1888–1960 — General Guidance", EMPTY),
    ],
    ids=[
        "c-returned-title-quoted", "d-unconfirmed-wording", "e-life-span-parenthetical",
        "e-life-span-in-prose", "e2-two-sentence-correct-reply", "g-repository-recommendation",
        "h-returned-apostrophe-title", "q-sentence-before-a-comma", "r-lead-in-naming-the-place",
        "s-generic-heading",
    ],
)
def test_a_correct_reply_passes(reply, calls):
    check(reply, calls, TAGGED)


def test_an_unreturned_title_beside_a_returned_one_fires():
    reply = f"Search “{ARKANSAS}” and “{KENYA_DEATHS}” next."
    with pytest.raises(AssertionError, match="no collections_search result returned"):
        check(reply, [_search(ARKANSAS)], TAGGED)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check(KENYA_DEATHS, EMPTY, {"skill": "research", "tags": ["routing"]})


# The lead's widening on #4011 (2026-11-02, from issue #4125): a named book or other
# cited work, not only a FamilySearch collection title.
from test_research import test_names_works_only_from_tool_results as check_works  # noqa: E402

AYLING = (
    "Revised Register of the Soldiers and Sailors of New Hampshire in the War of the "
    "Revolution, 1775–1783"
)


def _wiki(text: str) -> dict:
    return {"tool": "mcp__genealogy__wiki_search", "args": {"query": "q"}, "response": {"results": [{"text": text}]}}


@pytest.mark.parametrize(
    "reply",
    [
        f"The standard reference is Augustus D. Ayling, *{AYLING}* (1895).",
        f"See _{AYLING}_ for the roster.",
        "Footnote 2: Coffin, *Guns of Independence: The Siege of Fort Mifflin* (2005).",
    ],
    ids=["t-ayling-asterisk-italics", "u-underscore-italics", "v-italic-footnote"],
)
def test_an_unreturned_work_fires(reply):
    with pytest.raises(AssertionError, match="no tool result in the session contains"):
        check_works(reply, [_wiki("Moses Dustin served in Reid's regiment.")], TAGGED)


@pytest.mark.parametrize(
    ("reply", "calls"),
    [
        (f"The wiki points to *{AYLING.replace('–', '-')}*.", [_wiki(f"See {AYLING}.")]),
        ("That collection is *unconfirmed* and *not* indexed.", EMPTY),
        ("**Kenya Colony Records Overview Today**", EMPTY),
        ("Set Kenya_Colony Records Overview Index_Today in the config.", EMPTY),
        # Known gap, stated in the validator's docstring: plain-text works are not seen;
        # the hosted replays measure that half.
        ("Footnote 2: Coffin, Guns of Independence (2005).", EMPTY),
    ],
    ids=[
        "w-returned-work-dash-variant", "x-short-emphasis", "y-bold-heading",
        "z-snake-case-identifiers", "known-gap-plain-text-footnote",
    ],
)
def test_a_returned_or_unmarked_work_passes(reply, calls):
    check_works(reply, calls, TAGGED)


def test_the_works_check_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check_works(f"*{AYLING}*", EMPTY, {"skill": "research", "tags": ["routing"]})
