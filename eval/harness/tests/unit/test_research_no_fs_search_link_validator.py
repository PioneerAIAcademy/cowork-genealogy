"""Direct tests for the research #4777 validator: the reply carries no
hand-written FamilySearch search link.

Nothing under validators/ is collected by `make harness-test`, so the check is
proven here in both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    test_no_hand_written_familysearch_search_link as link_check,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
SUITE = REPO_ROOT / "eval/tests/unit/research"
TESTS = [
    json.loads((SUITE / name).read_text(encoding="utf-8"))["test"]
    for name in ("no-fs-link-for-searched-census.json", "no-fs-link-on-search-timeout.json")
]
TAGGED = TESTS[0]


@pytest.mark.parametrize("test", TESTS, ids=lambda t: t["id"])
def test_both_test_files_carry_the_tag(test):
    assert "no-familysearch-search-link" in test["tags"]


def test_untagged_skips():
    with pytest.raises(pytest.skip.Exception):
        link_check({"tags": []}, "https://www.familysearch.org/search/record/results?q.surname=Renhard")


@pytest.mark.parametrize(
    "reply",
    [
        # The #4743 link, malformed collection parameter and all.
        "Try this: https://www.familysearch.org/search/record/results?q.surname=Renhard"
        "&q.givenName=Charles&collection_id=1548076",
        # The #4745 shape.
        "Run [this search](https://www.familysearch.org/search/record/results?q.surname="
        "Weathersby&q.givenName=Hatton&q.anyDate.from=1865) and tell me what you find.",
        "Search familysearch.org/search/record/results?q.surname=Renhard yourself.",
        "See https://www.familysearch.org/en/search/record/results?q.surname=Renhard",
        "Open HTTPS://WWW.FAMILYSEARCH.ORG/SEARCH/CATALOG/RESULTS?q.title=Liverpool",
    ],
)
def test_a_familysearch_search_link_fails(reply):
    with pytest.raises(AssertionError, match="FamilySearch search link"):
        link_check(TAGGED, reply)


@pytest.mark.parametrize(
    "reply",
    [
        "FamilySearch search is not answering right now. Shall I run that search again?",
        "The 1901 census was already searched three times on FamilySearch under Renhard, "
        "Charls and Rennard, with nothing found.",
        # A record's own page and the tool's error text are not search links.
        "The record is at https://www.familysearch.org/ark:/61903/1:1:NNY1-W4R.",
        "The search failed: Request to https://www.familysearch.org/service/search/hr/v2/"
        "personas timed out after 25000ms.",
        "His tree profile: https://www.familysearch.org/tree/person/details/GDQB-17Y",
        # Links image_read/image_transcribe and collections_search return.
        "https://www.familysearch.org/search/film/004528077?i=697",
        "https://www.familysearch.org/search/collection/1548076",
        "",
    ],
)
def test_a_reply_without_one_passes(reply):
    link_check(TAGGED, reply)


def test_a_missing_reply_passes():
    link_check(TAGGED, None)
