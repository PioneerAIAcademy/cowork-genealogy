"""Direct tests for `report_log_query_traces_to_url_tool_call`.

Same reason as test_search_records_log_query_validator.py: validators/ is not a
collected test path and nothing replays a validator over the corpus. Both
directions: a claimed attribute the call never sent fires, a faithful echo and
descriptive context do not. The vocabulary is patched so no firing case skips;
the real lookup is exercised by the last test.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

import test_search_external_sites as mod  # noqa: E402
from validators_lib import tool_input_keys  # noqa: E402

check = mod.report_log_query_traces_to_url_tool_call
POSITIVE = {"type": "positive"}
VOCAB = frozenset({"givenName", "surname", "birthYear", "birthPlace", "residenceYear", "residencePlace"})


@pytest.fixture(autouse=True)
def _vocabulary(monkeypatch):
    monkeypatch.setattr(mod, "_tool_input_keys", lambda tool, nested=None: VOCAB)


def state(*entries):
    return {"research_json": {"log": list(entries)}}


BEFORE = state()


def entry(log_id, query, site="ancestry", url="https://example.test/a"):
    return {
        "id": log_id,
        "tool": "external_site",
        "query": query,
        "outcome": "partial",
        "external_site": {"site": site, "url_generated": url, "capture_received": False},
    }


def build(attributes, site="ancestry", url="https://example.test/a"):
    return {
        "tool": "mcp__genealogy__build_external_search_url",
        "args": {"site": site, "attributes": attributes},
        "response": {"ok": True, "url": url},
    }


def test_fires_on_an_attribute_the_call_never_sent():
    calls = [build({"givenName": "Patrick", "surname": "Flynn"})]
    after = state(entry("log_001", {"givenName": "Patrick", "surname": "Flynn", "birthYear": 1845}))
    with pytest.raises(AssertionError, match=r"log_001 \(same url\) claims birthYear=1845, which the call never sent"):
        check(BEFORE, after, calls, POSITIVE)


def test_silent_on_a_faithful_echo_with_descriptive_context():
    attrs = {"givenName": "Patrick", "surname": "Flynn", "birthYear": 1845}
    after = state(entry("log_001", {**attrs, "recordType": "census", "collection": "1880 US Census"}))
    check(BEFORE, after, [build(attrs)], POSITIVE)


def test_stringified_attributes_and_query_are_read():
    call = build({"surname": "Flynn"})
    call["args"]["attributes"] = '{"surname": "Flynn"}'
    after = state(entry("log_001", '{"surname": "Flynn", "birthPlace": "Ireland"}'))
    with pytest.raises(AssertionError, match="birthPlace='Ireland'"):
        check(BEFORE, after, [call], POSITIVE)


def test_a_null_claim_claims_nothing():
    check(BEFORE, state(entry("log_001", {"surname": "Flynn", "birthYear": None})), [build({"surname": "Flynn"})], POSITIVE)


def test_skips_with_zero_url_tool_calls():
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state(entry("log_001", {"surname": "Flynn"})), [], POSITIVE)


def test_skips_when_the_vocabulary_is_unavailable(monkeypatch):
    monkeypatch.setattr(mod, "_tool_input_keys", lambda tool, nested=None: None)
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state(entry("log_001", {"surname": "Flynn"})), [build({"surname": "Flynn"})], POSITIVE)


def test_a_relog_of_the_same_url_pairs_with_the_same_call():
    attrs = {"surname": "Flynn", "birthYear": 1845}
    after = state(entry("log_001", dict(attrs)), entry("log_002", dict(attrs)))
    check(BEFORE, after, [build(attrs)], POSITIVE)


def test_exact_url_pairing_beats_site_position():
    calls = [
        build({"surname": "Flynn"}, url="https://example.test/broad"),
        build({"surname": "Flynn", "residenceYear": 1880}, url="https://example.test/narrow"),
    ]
    after = state(
        entry("log_001", {"surname": "Flynn", "residenceYear": 1880}, url="https://example.test/narrow"),
        entry("log_002", {"surname": "Flynn"}, url="https://example.test/broad"),
    )
    check(BEFORE, after, calls, POSITIVE)


def test_site_position_fallback_and_extra_entries_left_alone():
    calls = [build({"surname": "Flynn"}, url="https://example.test/x")]
    after = state(
        entry("log_001", {"surname": "Flynn", "birthYear": 1845}, url="https://elsewhere.test/1"),
        entry("log_002", {"surname": "Flynn", "birthPlace": "Ireland"}, url="https://elsewhere.test/2"),
    )
    with pytest.raises(AssertionError) as info:
        check(BEFORE, after, calls, POSITIVE)
    assert "log_001 (position 0 among unpaired ancestry calls) claims birthYear=1845" in str(info.value)
    assert "log_002" not in str(info.value)


def test_a_differing_value_is_reported_as_its_own_class():
    after = state(entry("log_001", {"surname": "Flynn", "birthPlace": "County Cork, Ireland"}))
    with pytest.raises(AssertionError, match="value differs — birthPlace: logged 'County Cork, Ireland', sent 'Ireland'"):
        check(BEFORE, after, [build({"surname": "Flynn", "birthPlace": "Ireland"})], POSITIVE)


def test_negative_tests_are_skipped():
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state(entry("log_001", {"birthYear": 1})), [build({})], {"type": "negative"})


@pytest.mark.requires_engine_build
def test_the_real_vocabulary_is_the_attributes_object():
    keys = tool_input_keys("build_external_search_url", "attributes")
    assert keys is not None and {"givenName", "surname", "birthYear", "residencePlace"} <= keys
    assert "recordType" not in keys and "site" not in keys
