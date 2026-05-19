"""Skill-specific validators for the search-external-sites skill.

search-external-sites generates pre-filled search URLs for commercial
genealogy sites (Ancestry, MyHeritage, FindMyPast, FindAGrave,
Newspapers.com) and walks the user through the click-capture workflow.

URL composition quality and capture-guidance narrative live in the
rubric — graded by the LLM judge. Mechanical checks (a log entry was
written with the right shape, captured_source_ids stays empty for a
URL-generation-only turn) live here.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Helpers ----------------------------------------------------------

def _new_log_entries(before_state, after_state) -> list[dict]:
    """Return log entries added between before and after, keyed by id."""
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {e.get("id") for e in before.get("log", []) if isinstance(e, dict)}
    return [
        e for e in after.get("log", [])
        if isinstance(e, dict) and e.get("id") not in before_ids
    ]


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_appends_external_site_log_entry(before_state, after_state, test):
    """Positive search-external-sites tests must append a `tool: external_site`
    log entry. The skill's whole purpose is to record the URL-generation step
    in the research log so later turns can pick up the capture."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, (
        f"expected at least one new log entry with tool='external_site'; "
        f"new entries: {[e.get('tool') for e in new_entries]}"
    )


def test_url_generation_log_entry_shape(before_state, after_state, test):
    """The new external_site log entry must encode the URL-generation step:
    `external_site.url_generated` is a non-empty string,
    `external_site.capture_received` is false, and `captured_source_ids` /
    `produced_assertion_ids` are empty (no records have been ingested yet —
    that happens after the user returns a capture)."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    if not external:
        pytest.skip("no external_site log entry (covered by separate validator)")

    errors: list[str] = []
    for entry in external:
        detail = entry.get("external_site") or {}
        url = detail.get("url_generated")
        if not isinstance(url, str) or not url.strip():
            errors.append(
                f"log[{entry.get('id')}].external_site.url_generated "
                f"must be a non-empty string; got {url!r}"
            )
        if detail.get("capture_received") is not False:
            errors.append(
                f"log[{entry.get('id')}].external_site.capture_received "
                f"must be false on URL-generation step; got "
                f"{detail.get('capture_received')!r}"
            )
        if entry.get("captured_source_ids"):
            errors.append(
                f"log[{entry.get('id')}].captured_source_ids must be empty "
                f"on URL-generation step; got {entry.get('captured_source_ids')}"
            )
        if entry.get("produced_assertion_ids"):
            errors.append(
                f"log[{entry.get('id')}].produced_assertion_ids must be empty "
                f"on URL-generation step; got {entry.get('produced_assertion_ids')}"
            )
    assert not errors, "URL-generation log-shape violations:\n  - " + "\n  - ".join(errors)


# --- Tag-gated site-specific checks ----------------------------------

def test_log_site_ancestry(before_state, after_state, test):
    """Tag-gated: when the test scenario targets Ancestry, the new external_site
    log entry's `external_site.site` must be `ancestry`."""
    if "log-site-ancestry" not in test.get("tags", []):
        pytest.skip("not a log-site-ancestry scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "ancestry" in sites, (
        f"expected an external_site log entry with site='ancestry'; got sites={sites}"
    )


def test_log_site_myheritage(before_state, after_state, test):
    """Tag-gated: when the test scenario targets MyHeritage, the new
    external_site log entry's `external_site.site` must be `myheritage`."""
    if "log-site-myheritage" not in test.get("tags", []):
        pytest.skip("not a log-site-myheritage scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "myheritage" in sites, (
        f"expected an external_site log entry with site='myheritage'; got sites={sites}"
    )
