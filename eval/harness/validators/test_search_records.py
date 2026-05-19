"""Skill-specific validators for the search-records skill.

search-records executes a planned record_search against the FamilySearch
API and logs the result. Narrative-quality dimensions (search-parameter
strategy, result triage, log notes) live in the rubric — graded by the
LLM judge. The mechanical "is the log entry shaped right" checks live
here.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Helpers ----------------------------------------------------------

def _new_log_entries(before_state, after_state) -> list[dict]:
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {e.get("id") for e in before.get("log", []) if isinstance(e, dict)}
    return [
        e for e in after.get("log", [])
        if isinstance(e, dict) and e.get("id") not in before_ids
    ]


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_appends_log_entry(before_state, after_state, test):
    """Positive search-records tests must append a log entry. The skill's
    whole audit-trail role depends on this — every search, positive or
    negative, has to leave a log row that can be cited in a future
    exhaustive-search declaration."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record searches")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry recording the search"


def test_log_does_not_produce_assertions(before_state, after_state, test):
    """search-records' job ends at the search — extraction is
    record-extraction's. New log entries it writes must therefore leave
    `produced_assertion_ids` empty. (Sources may be captured; assertions
    are not yet extracted.)"""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record searches")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    bad = [
        e for e in new_entries
        if e.get("produced_assertion_ids")
    ]
    assert not bad, (
        "search-records must not populate produced_assertion_ids "
        "(extraction is record-extraction's job); offending entries: "
        f"{[(e.get('id'), e.get('produced_assertion_ids')) for e in bad]}"
    )


# --- Tag-gated checks ------------------------------------------------

def test_log_outcome_positive_record_search(before_state, after_state, test):
    """Tag-gated: when the test scenario expects a successful record_search
    that hits the planned target, the new log entry must have `tool:
    "record_search"` and `outcome: "positive"`."""
    if "log-positive-record-search" not in test.get("tags", []):
        pytest.skip("not a log-positive-record-search scenario")
    new_entries = _new_log_entries(before_state, after_state)
    matched = [
        e for e in new_entries
        if e.get("tool") == "record_search" and e.get("outcome") == "positive"
    ]
    assert matched, (
        "expected a new log entry with tool='record_search' and "
        f"outcome='positive'; new entries: "
        f"{[(e.get('tool'), e.get('outcome')) for e in new_entries]}"
    )


def test_log_outcome_honest_no_match(before_state, after_state, test):
    """Tag-gated: when the test scenario probes honest negative-result
    logging (the fixture doesn't match the search the user asked for),
    the new log entry must have `outcome` in {`negative`, `error`} —
    never `positive` (which would be silently fabricating a match)."""
    if "log-honest-no-match" not in test.get("tags", []):
        pytest.skip("not a log-honest-no-match scenario")
    new_entries = _new_log_entries(before_state, after_state)
    outcomes = [e.get("outcome") for e in new_entries]
    bad_positive = [e for e in new_entries if e.get("outcome") == "positive"]
    assert not bad_positive, (
        "search-records must not log outcome='positive' when the fixture "
        f"didn't match the search; offending entries: "
        f"{[(e.get('id'), e.get('outcome')) for e in bad_positive]}"
    )
    assert any(o in ("negative", "error") for o in outcomes), (
        f"expected a new log entry with outcome in (negative, error); "
        f"got outcomes={outcomes}"
    )
