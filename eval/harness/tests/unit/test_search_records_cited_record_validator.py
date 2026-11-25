"""Direct tests for the search-records #4667 validator: a search that returned
a record the tree cites on the subject is not left logged negative.

Nothing under validators/ is collected by `make harness-test`, so the check is
proven here in both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import test_cited_record_search_not_logged_negative as check  # noqa: E402

TAGGED = {"tags": ["search", "cited-record-not-negative"]}
UNTAGGED = {"tags": ["search"]}


def entry(n, outcome, results_ref="results/log_00{}.json", tool="record_search"):
    return {
        "id": f"log_00{n}",
        "tool": tool,
        "outcome": outcome,
        "results_ref": results_ref.format(n) if results_ref else None,
    }


def states(*entries):
    return {"research_json": {"log": []}}, {"research_json": {"log": list(entries)}}


@pytest.mark.parametrize(
    "entries",
    [
        # The Phipps session: the 1860 search kept its rows and was logged negative.
        [entry(1, "negative")],
        # Corrected later, but the negative with results still stands.
        [entry(1, "negative"), entry(2, "positive")],
        # Nothing positive or partial at all: only a nil.
        [entry(1, "negative", results_ref=None)],
        # The search that returned rows logged error rather than negative.
        [entry(1, "error"), entry(2, "positive")],
        # Dodged the refusal: the 1860 search re-logged with no results, beside a
        # positive entry that kept none either.
        [entry(1, "negative", results_ref=None), entry(2, "positive", results_ref=None)],
        # No record_search entry at all.
        [],
    ],
)
def test_fires(entries):
    before, after = states(*entries)
    with pytest.raises(AssertionError):
        check(before, after, TAGGED)


@pytest.mark.parametrize(
    "entries",
    [
        [entry(1, "positive")],
        [entry(1, "partial")],
        # A nil 1850 search beside the positive 1860 one is rightly negative.
        [entry(1, "negative", results_ref=None), entry(2, "positive")],
        # A negative from another tool is not this check's business.
        [entry(1, "negative", tool="fulltext_search"), entry(2, "partial")],
        # An error with no results (the search never ran) beside the positive one.
        [entry(1, "error", results_ref=None), entry(2, "positive")],
    ],
)
def test_passes(entries):
    before, after = states(*entries)
    check(before, after, TAGGED)


def test_skips_untagged():
    before, after = states(entry(1, "negative"))
    with pytest.raises(pytest.skip.Exception):
        check(before, after, UNTAGGED)
