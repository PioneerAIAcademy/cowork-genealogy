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
    ],
    ids=[
        "a-plain-title", "b-hyphen-variant", "b-bold-list-item", "i-inline-after-colon",
        "j-list-under-lead-in", "k-smart-quoted", "l-trailing-parenthetical",
        "m-markdown-link", "n-joined-text-block",
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
    ],
    ids=[
        "c-returned-title-quoted", "d-unconfirmed-wording", "e-life-span-parenthetical",
        "e-life-span-in-prose", "e2-two-sentence-correct-reply", "g-repository-recommendation",
        "h-returned-apostrophe-title",
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
