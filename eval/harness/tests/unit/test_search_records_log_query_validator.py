"""Direct tests for `report_log_query_traces_to_record_search_call`.

pyproject.toml sets testpaths = ["tests"], so nothing under validators/ is
collected by `make harness-test`, and nothing in CI replays a validator over the
committed corpus. Without this file the check would ship unexecuted.

Both directions: an entry claiming a filter its call never sent fires, and an
entry that faithfully echoes its call does not. The vocabulary is patched to a
fixed set so no firing case can skip for want of an engine build; the real
lookup is exercised by the last test.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

import test_search_records as mod  # noqa: E402
from validators_lib import tool_input_keys  # noqa: E402

check = mod.report_log_query_traces_to_record_search_call

VOCAB = frozenset(
    {"surname", "givenName", "recordType", "marriagePlace", "residencePlace", "collectionId",
     "recordCountry", "count", "offset", "projectPath", "subjectId"}
)


@pytest.fixture(autouse=True)
def _vocabulary(monkeypatch):
    monkeypatch.setattr(mod, "_tool_input_keys", lambda tool, nested=None: VOCAB)


def state(*entries):
    return {"research_json": {"log": list(entries)}}


BEFORE = state()


def entry(log_id, query, tool="record_search"):
    return {"id": log_id, "tool": tool, "query": query, "outcome": "positive"}


def search(args, ref=None):
    response = {"results": [{"recordId": "R"}]}
    if ref:
        response["staged"] = {"resultsRef": ref}
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": response}


def log_call(ops_and_ids):
    """One single-op research_log_append call per (op, logId) pair."""
    return [
        {"tool": "mcp__genealogy__research_log_append", "args": op, "response": {"ok": True, "logId": log_id}}
        for op, log_id in ops_and_ids
    ]


def test_fires_on_a_staged_entry_claiming_a_filter_its_call_never_sent():
    calls = [search({"surname": "Flynn", "givenName": "Mary"}, "results/.staging/a.json")]
    calls += log_call([({"stagedResultsRef": "results/.staging/a.json"}, "log_001")])
    after = state(entry("log_001", {"surname": "Flynn", "givenName": "Mary", "recordType": "marriage"}))
    with pytest.raises(AssertionError, match=r"log_001 \(staged handle\) claims recordType='marriage', which the call never sent"):
        check(BEFORE, after, calls)


def test_silent_on_an_entry_that_echoes_its_call():
    args = {"surname": "Flynn", "recordType": "marriage", "marriagePlace": "Pennsylvania"}
    calls = [search(args, "results/.staging/a.json")]
    calls += log_call([({"stagedResultsRef": "results/.staging/a.json"}, "log_001")])
    check(BEFORE, state(entry("log_001", dict(args))), calls)


def test_fires_on_a_stringified_query():
    calls = [search({"surname": "Flynn"}, "results/.staging/a.json")]
    calls += log_call([({"stagedResultsRef": "results/.staging/a.json"}, "log_001")])
    after = state(entry("log_001", '{"surname": "Flynn", "recordType": "marriage"}'))
    with pytest.raises(AssertionError, match="recordType='marriage'"):
        check(BEFORE, after, calls)


@pytest.mark.parametrize("value", [None, ""])
def test_a_null_or_empty_claim_claims_nothing(value):
    calls = [search({"surname": "Flynn"}, "results/.staging/a.json")]
    calls += log_call([({"stagedResultsRef": "results/.staging/a.json"}, "log_001")])
    check(BEFORE, state(entry("log_001", {"surname": "Flynn", "recordType": value})), calls)


def test_descriptive_keys_plumbing_and_paging_are_not_filter_claims():
    calls = [search({"surname": "Flynn"}, "results/.staging/a.json")]
    calls += log_call([({"stagedResultsRef": "results/.staging/a.json"}, "log_001")])
    query = {"surname": "Flynn", "note": "ad hoc", "projectPath": "/x", "offset": 0, "count": 50}
    check(BEFORE, state(entry("log_001", query)), calls)


def test_skips_with_zero_record_search_calls():
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state(entry("log_001", {"surname": "Flynn", "recordType": "birth"})), [])


def test_skips_when_the_vocabulary_is_unavailable(monkeypatch):
    monkeypatch.setattr(mod, "_tool_input_keys", lambda tool, nested=None: None)
    calls = [search({"surname": "Flynn"})]
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state(entry("log_001", {"surname": "Flynn", "recordType": "birth"})), calls)


def test_exact_pairing_beats_a_same_surname_decoy():
    """The broad-then-narrow pattern: two Flynn calls, logged narrow-first.
    Positional pairing would match log_001 to the broad call and report a
    recordType it DID send, on the narrow call."""
    calls = [
        search({"surname": "Flynn"}, "results/.staging/broad.json"),
        search({"surname": "Flynn", "recordType": "marriage"}, "results/.staging/narrow.json"),
    ]
    calls += log_call([
        ({"stagedResultsRef": "results/.staging/narrow.json"}, "log_001"),
        ({"stagedResultsRef": "results/.staging/broad.json"}, "log_002"),
    ])
    after = state(
        entry("log_001", {"surname": "Flynn", "recordType": "marriage"}),
        entry("log_002", {"surname": "Flynn"}),
    )
    check(BEFORE, after, calls)


def test_batch_ops_pair_through_their_per_op_log_ids():
    calls = [
        search({"surname": "Flynn"}, "results/.staging/a.json"),
        search({"surname": "Doyle", "recordType": "birth"}, "results/.staging/b.json"),
        {
            "tool": "mcp__genealogy__research_log_append",
            "args": {"ops": [{"stagedResultsRef": "results/.staging/a.json"}, {"stagedResultsRef": "results/.staging/b.json"}]},
            "response": {"ok": True, "results": [{"logId": "log_001"}, {"logId": "log_002"}]},
        },
    ]
    after = state(
        entry("log_001", {"surname": "Flynn", "recordType": "birth"}),
        entry("log_002", {"surname": "Doyle", "recordType": "birth"}),
    )
    with pytest.raises(AssertionError) as info:
        check(BEFORE, after, calls)
    assert "log_001 (staged handle) claims recordType='birth'" in str(info.value)
    assert "log_002" not in str(info.value)


def test_an_unstaged_nil_entry_falls_back_to_surname_position():
    calls = [search({"surname": "Flynn", "givenName": "Mary"})]
    after = state(entry("log_001", {"surname": "Flynn", "givenName": "Mary", "recordType": "marriage"}))
    with pytest.raises(AssertionError, match=r"position 0 among unstaged 'Flynn' calls\) claims recordType"):
        check(BEFORE, after, calls)


def test_more_entries_than_calls_sharing_a_surname_leaves_the_extra_alone():
    calls = [search({"surname": "Flynn"})]
    after = state(
        entry("log_001", {"surname": "Flynn"}),
        entry("log_002", {"surname": "Flynn", "recordType": "marriage"}),
    )
    check(BEFORE, after, calls)


def test_a_differing_value_is_reported_as_its_own_class():
    calls = [search({"surname": "Flynn", "residencePlace": "Pennsylvania"}, "results/.staging/a.json")]
    calls += log_call([({"stagedResultsRef": "results/.staging/a.json"}, "log_001")])
    after = state(entry("log_001", {"surname": "Flynn", "residencePlace": "Pennsylvania, United States"}))
    with pytest.raises(AssertionError, match="value differs — residencePlace: logged 'Pennsylvania, United States', sent 'Pennsylvania'"):
        check(BEFORE, after, calls)


def test_entries_of_other_tools_are_not_judged():
    calls = [search({"surname": "Flynn"})]
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state(entry("log_001", {"surname": "Flynn", "recordType": "x"}, tool="fulltext_search")), calls)


@pytest.mark.requires_engine_build
def test_the_real_vocabulary_is_record_search_inputs():
    keys = tool_input_keys("record_search")
    assert keys is not None and {"recordType", "collectionId", "marriagePlace", "surname"} <= keys
    assert "recordPlace" not in keys  # a fulltext_search spelling, not a record_search parameter
