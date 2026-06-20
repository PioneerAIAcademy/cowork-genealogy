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

import json

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
    assert any(o in ("negative", "partial", "error") for o in outcomes), (
        f"expected a new log entry with outcome in (negative, partial, error); "
        f"got outcomes={outcomes}"
    )


# --- Result sidecar retention ----------------------------------------

def _new_result_sidecars(before_state, after_state) -> dict:
    """results/ sidecar files present in after_state but not before, as
    {relative_path: file_content_string}."""
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}
    return {
        path: content
        for path, content in after_files.items()
        if path.startswith("results/")
        and path.endswith(".json")
        and path not in before_files
    }


def test_sidecar_written_for_positive_search(before_state, after_state, test):
    """Tag-gated (sidecar-write): a positive record search must retain its
    raw results — the new log entry carries a non-null results_ref, the
    named sidecar file is written, and its returned_count equals the
    payload's results length (the D2 integrity check)."""
    if "sidecar-write" not in test.get("tags", []):
        pytest.skip("not a sidecar-write scenario")
    new_entries = _new_log_entries(before_state, after_state)
    with_ref = [e for e in new_entries if e.get("results_ref")]
    assert with_ref, (
        "expected a new log entry with a non-null results_ref; new "
        f"entries: {[(e.get('id'), e.get('results_ref')) for e in new_entries]}"
    )
    sidecars = _new_result_sidecars(before_state, after_state)
    for e in with_ref:
        ref = e["results_ref"]
        assert ref in sidecars, (
            f"log entry {e.get('id')} references {ref}, but no such sidecar "
            f"was written; sidecars written: {sorted(sidecars)}"
        )
        sc = json.loads(sidecars[ref])
        results = (sc.get("payload") or {}).get("results")
        assert isinstance(results, list), f"{ref}: payload has no results array"
        assert sc.get("returned_count") == len(results), (
            f"{ref}: returned_count {sc.get('returned_count')} != "
            f"payload results length {len(results)}"
        )


def test_no_sidecar_for_nil_search(before_state, after_state, test):
    """Tag-gated (sidecar-nil): a search that returns nothing must not write
    a sidecar — the new log entry's results_ref stays null and no new
    results/ file appears."""
    if "sidecar-nil" not in test.get("tags", []):
        pytest.skip("not a sidecar-nil scenario")
    new_entries = _new_log_entries(before_state, after_state)
    with_ref = [e for e in new_entries if e.get("results_ref")]
    assert not with_ref, (
        "a nil search must leave results_ref null; offending entries: "
        f"{[(e.get('id'), e.get('results_ref')) for e in with_ref]}"
    )
    sidecars = _new_result_sidecars(before_state, after_state)
    assert not sidecars, (
        f"a nil search must write no results/ sidecar; got: {sorted(sidecars)}"
    )
