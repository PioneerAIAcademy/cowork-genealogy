"""`measure_filtered_nil_retry.py`'s record_search arm (issue #3854).

Two things the arm must get right for its figures to mean anything: names that
differ only in Unicode form are one name, as the engine compares them, and an
unreadable record_search staged count is tallied apart from the fulltext arm's.
"""
from __future__ import annotations

import collections
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "measure_filtered_nil_retry",
    Path(__file__).resolve().parents[2] / "scripts" / "measure_filtered_nil_retry.py",
)
measure = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(measure)

NFC = "Heydöcker"
NFD = "Heydöcker"
PINNED = {"givenName": "Simon", "surname": NFC, "collectionId": "1394580"}


def _log_call(ops, response=None):
    call = {"tool": "mcp__genealogy__research_log_append", "args": {"ops": ops}}
    if response is not None:
        call["response"] = response
    return call


def _nil(query):
    return {"tool": "record_search", "outcome": "negative", "resultsExamined": 0, "resultsAvailable": 0, "query": query}


def _scan(calls):
    counts: collections.Counter = collections.Counter()
    hits: list = []
    measure.Run("t", calls, counts).scan(hits)
    return counts, [h for h in hits if h.get("kind") == "record_search"]


def test_the_two_spellings_really_differ():
    assert NFC != NFD and len(NFC) != len(NFD)


def test_names_differing_only_in_unicode_form_are_one_name():
    assert measure._names({"surname": NFD}) == measure._names({"surname": NFC})


def test_an_nfd_unpinned_retry_clears_an_nfc_pinned_nil():
    retry = {"givenName": "Simon", "surname": NFD}
    _counts, hits = _scan([_log_call([_nil(PINNED), _nil(retry)])])
    assert hits == []


def test_a_different_surname_still_counts_as_unretried():
    retry = {"givenName": "Simon", "surname": "Heidecker"}
    _counts, hits = _scan([_log_call([_nil(PINNED), _nil(retry)])])
    assert len(hits) == 1


def test_an_unreadable_record_search_count_is_kept_apart_from_the_fulltext_tally():
    op = {"tool": "record_search", "outcome": "positive", "stagedResultsRef": "results/.staging/r.json", "query": PINNED}
    counts, _hits = _scan([_log_call([op])])  # no response: the count cannot be read
    assert counts["record_ref_ops_count_unreadable"] == 1
    assert counts["ref_ops_count_unreadable"] == 0


def test_an_unreadable_fulltext_count_still_lands_in_the_fulltext_tally():
    op = {
        "tool": "fulltext_search",
        "outcome": "positive",
        "stagedResultsRef": "results/.staging/f.json",
        "query": {"keywords": "Heydocker", "place": "Lippe"},
    }
    counts, _hits = _scan([_log_call([op])])
    assert counts["ref_ops_count_unreadable"] == 1
    assert counts["record_ref_ops_count_unreadable"] == 0
