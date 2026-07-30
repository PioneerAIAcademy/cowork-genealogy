"""Skill-specific validators for the search-external-sites skill.

search-external-sites generates pre-filled search URLs for commercial
genealogy sites (Ancestry, MyHeritage, FindMyPast, FindAGrave,
Newspapers.com) and walks the user through the click-capture workflow.

URL composition quality and capture-guidance narrative live in the
rubric — graded by the LLM judge. Mechanical checks (a log entry was
written with the right shape for a URL-generation-only turn) live here.

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
    """A new external_site log entry that records a URL-generation step
    (`outcome: "partial"` — in-flight, awaiting capture) must have a non-empty
    `external_site.url_generated` and `external_site.capture_received: false`.
    Entries with other outcomes (a capture analyzed, or a nil result reported
    with `outcome: "negative"`) are not URL-generation steps and are graded by
    the rubric's Log entry dimension instead."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [
        e for e in new_entries
        if e.get("tool") == "external_site" and e.get("outcome") == "partial"
    ]
    if not external:
        pytest.skip("no URL-generation (outcome=partial) external_site log entry")

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
    assert not errors, "URL-generation log-shape violations:\n  - " + "\n  - ".join(errors)


# --- Tag-gated no-harm invariant (grade_on_invariant negatives) ------

def test_no_external_search_on_planning_request(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-search-no-write): the search-external-sites no-harm
    invariant for a planning/strategy request that should route to
    research-plan.

    search-external-sites executes a chosen external-site search — it
    generates a pre-filled URL and logs the step to research.json. A pure
    planning question ("what external sites should I search next?") must
    not cause a search to be EXECUTED or logged. This is the deterministic
    gate for the grade_on_invariant negative ut_search_external_sites_011:
    the decline phrasing (and whether the model routes to research-plan
    via the Skill tool or just declines in text) varies run to run, but
    the state-harm invariant always holds and is what we assert. See
    docs/specs/unit-test-spec.md and the sibling
    test_search_records.py::test_no_search_or_writes_on_planning_request.

    Fails iff the run:
      - made an `external_links_search` MCP call (a search was executed),
        or
      - appended a new `log` entry (search-external-sites records every
        search it runs; research-plan — the acceptable route — never
        writes `log`, so any new log entry means a search skill actually
        ran).

    Deliberately does NOT flag other research.json writes: routing to
    research-plan legitimately writes `plans`/`questions`, which is correct
    behavior, not harm.
    """
    if "no-search-no-write" not in test.get("tags", []):
        pytest.skip("not a no-search-no-write scenario")

    # 1. No external-site search executed.
    searched = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "external_links_search"
    ]
    assert not searched, (
        "planning request must not execute an external-site search; got "
        f"external_links_search call(s) with args: "
        f"{[c.get('args') for c in searched]}"
    )

    # 2. No new search log entry (research-plan never writes `log`).
    new_entries = _new_log_entries(before_state, after_state)
    assert not new_entries, (
        "planning request must not append a search log entry; new log "
        f"ids: {[e.get('id') for e in new_entries]}"
    )


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


def test_log_site_findmypast(before_state, after_state, test):
    """Tag-gated: when the test scenario targets FindMyPast, the new
    external_site log entry's `external_site.site` must be `findmypast`."""
    if "log-site-findmypast" not in test.get("tags", []):
        pytest.skip("not a log-site-findmypast scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "findmypast" in sites, (
        f"expected an external_site log entry with site='findmypast'; got sites={sites}"
    )


def test_log_site_findagrave(before_state, after_state, test):
    """Tag-gated: when the test scenario targets FindAGrave, the new
    external_site log entry's `external_site.site` must be `findagrave`."""
    if "log-site-findagrave" not in test.get("tags", []):
        pytest.skip("not a log-site-findagrave scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "findagrave" in sites, (
        f"expected an external_site log entry with site='findagrave'; got sites={sites}"
    )


def test_log_site_newspapers(before_state, after_state, test):
    """Tag-gated: when the test scenario targets Newspapers.com, the new
    external_site log entry's `external_site.site` must be `newspapers`."""
    if "log-site-newspapers" not in test.get("tags", []):
        pytest.skip("not a log-site-newspapers scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "newspapers" in sites, (
        f"expected an external_site log entry with site='newspapers'; got sites={sites}"
    )
