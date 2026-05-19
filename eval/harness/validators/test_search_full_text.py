"""Skill-specific validators for the search-full-text skill.

search-full-text queries the FamilySearch full-text MCP tool and logs
every search (positive, negative, partial). Narrative-quality dimensions
(query construction, FAN awareness, negative-result detail) live in the
rubric — graded by the LLM judge. The mechanical "did the skill record
a log entry of the right shape" checks live here.

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
    """Positive search-full-text tests must append a log entry recording
    the search — including FAN searches. The skill's whole audit-trail role
    depends on this. The log's `tool` field should reference fulltext_search
    (the MCP tool used) so a future exhaustive-search declaration can
    cite the search."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record searches")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry recording the search"
    tools = [e.get("tool") for e in new_entries]
    assert any("fulltext" in (t or "") for t in tools), (
        f"expected a new log entry with a fulltext-shaped `tool`; got tools={tools}"
    )


# --- Tag-gated negative-result log shape -----------------------------

def test_negative_result_log_shape(before_state, after_state, test):
    """Tag-gated: when the test scenario probes negative-result handling, the
    new log entry must have `outcome: "negative"`, an empty
    `captured_source_ids` array, and a non-empty `query` object describing
    what was searched. The narrative `notes` field — what collections,
    date ranges — is judge-graded under the Negative-result-handling rubric
    dim and not asserted here."""
    if "negative-result-log" not in test.get("tags", []):
        pytest.skip("not a negative-result-log scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry"

    errors: list[str] = []
    matched = False
    for entry in new_entries:
        if entry.get("outcome") != "negative":
            continue
        matched = True
        if entry.get("captured_source_ids"):
            errors.append(
                f"log[{entry.get('id')}].captured_source_ids must be empty "
                f"on a negative-outcome entry; got {entry.get('captured_source_ids')}"
            )
        query = entry.get("query")
        if not isinstance(query, dict) or not query:
            errors.append(
                f"log[{entry.get('id')}].query must be a non-empty object "
                f"describing the search; got {query!r}"
            )
    assert matched, (
        f"no new log entry has outcome='negative'; "
        f"outcomes={[e.get('outcome') for e in new_entries]}"
    )
    assert not errors, "Negative-log-shape violations:\n  - " + "\n  - ".join(errors)
