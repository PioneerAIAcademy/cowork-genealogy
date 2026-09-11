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

from validators_lib import new_log_entries as _new_log_entries
from validators_lib import (
    assert_capture_pending_item_not_terminal as _assert_capture_pending_item_not_terminal,
)


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


def test_resolved_birthplace_conflict_rejected_value_not_encoded(
    before_state, after_state, tool_calls, test
):
    """Mechanical form of SKILL.md's "check conflicts[] before encoding a
    place or date" rule, scoped to resolved `birthplace` conflicts.

    The rubric already grades this from prose, which makes it a single-run
    judgment call the skill can miss (issue #1980's own corpus: `mid-research
    -flynn`'s `conflicts[]` c_001 resolves birthplace as Ireland against a
    rejected Pennsylvania, and a model has been observed encoding the
    rejected value). Encoding a rejected fact is a genealogically wrong URL,
    not a stylistic slip, so this makes the specific failure a hard,
    deterministic fail rather than leaving it to the judge alone.

    Reads the `build_external_search_url` call's own `attributes.birthPlace`
    argument directly — option 2 of issue #1950's 2026-08-27 lead ruling
    ("V1 checks the tool call's arguments instead of the URL string"),
    available now that this tool exists. An earlier draft parsed the
    generated URL string instead, which needed a per-site table of which
    query parameter carries the birthplace value and was vulnerable to a
    substring false positive: this fixture's `residencePlace` ("Schuylkill
    County, Pennsylvania") legitimately contains the rejected value
    ("Pennsylvania"), which a whole-URL substring search would have flagged
    as if it were the birthplace parameter. Reading the structured argument
    the model actually passed needs neither.

    "Rejected" is decided by comparing each competing assertion's `place`
    value against the *preferred assertion's own value*, not by id: this
    fixture's `competing_assertion_ids` for c_001 lists three assertions, two
    of which (a_002, a_009) independently say "Ireland" — only the third
    (a_012, "Pennsylvania") actually disagrees. Treating every non-preferred
    id as rejected flagged a_009's own "Ireland" as if it were a rejected
    value, which a synthetic test against this exact fixture caught before
    this landed.

    Deliberately narrow to `disputed_attribute == "birthplace"` — the
    general case (any disputed attribute) is issue #1950/V1's fuller scope.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests generate URLs")
    research = before_state.get("research_json")
    if research is None:
        pytest.skip("no research.json in scenario")

    resolved_birthplace_conflicts = [
        c for c in (research.get("conflicts") or [])
        if c.get("conflict_type") == "fact"
        and c.get("status") == "resolved"
        and c.get("disputed_attribute") == "birthplace"
    ]
    if not resolved_birthplace_conflicts:
        pytest.skip("no resolved birthplace conflict in this scenario")

    assertions_by_id = {a.get("id"): a for a in (research.get("assertions") or [])}

    calls = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "build_external_search_url"
    ]
    if not calls:
        pytest.skip("no build_external_search_url call")

    errors: list[str] = []
    for c in resolved_birthplace_conflicts:
        preferred_id = c.get("preferred_assertion_id")
        preferred_assertion = assertions_by_id.get(preferred_id) or {}
        preferred_place = preferred_assertion.get("place")
        if not preferred_place:
            continue
        # A competing id is not automatically a rejected VALUE: two assertions
        # can independently support the same preferred value from different
        # sources (this fixture's a_002/a_009 both say "Ireland" — only a_012's
        # "Pennsylvania" actually disagrees), so the comparison is by place
        # value against the preferred assertion's own value, not by id.
        rejected_places = {
            assertions_by_id[i]["place"]
            for i in (c.get("competing_assertion_ids") or [])
            if i in assertions_by_id
            and assertions_by_id[i].get("place")
            and assertions_by_id[i]["place"] != preferred_place
        }
        if not rejected_places:
            continue
        for call in calls:
            args = call.get("args") or {}
            birth_place = (args.get("attributes") or {}).get("birthPlace")
            if birth_place in rejected_places:
                errors.append(
                    f"build_external_search_url call's attributes.birthPlace="
                    f"{birth_place!r} is the value conflict {c.get('id')} "
                    f"rejected (preferred: {preferred_id})"
                )
    assert not errors, "resolved birthplace-conflict rejected value passed to the tool:\n  - " + "\n  - ".join(errors)


# --- Tag-gated no-harm invariant (grade_on_invariant negatives) ------

def test_no_external_search_or_log_on_routeaway_negative(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-search-no-write): the search-external-sites no-harm
    invariant for any negative whose correct answer is to route away.

    search-external-sites executes a chosen external-site search — it
    generates a pre-filled URL and logs the step to research.json. A request
    that belongs to another skill must not cause a search to be EXECUTED or
    logged. This is the deterministic gate for two grade_on_invariant
    negatives:

      - `ut_search_external_sites_011` — a planning question that belongs to
        research-plan.
      - `ut_search_external_sites_012` — a single record already in hand,
        which belongs to record-extraction (issue #1519).

    Both were flaky for the same reason: the decline is correct every run, but
    its phrasing and length vary, and a longer decline that names the right
    skill was read by the activation heuristic as substantive output. Under
    grade_on_invariant the phrasing no longer decides the outcome; only
    executing or logging a search does. See docs/specs/unit-test-spec.md and
    the sibling test_search_records.py::test_no_search_or_writes_on_planning_request.

    Fails iff the run:
      - made an `external_links_search` MCP call (a search was executed), or
      - appended a new **`external_site`** `log` entry (this skill records
        every external-site search it runs).

    **The log check narrows only for 012, via `route-away-writes-own-log`.**
    011's accepted route is research-plan, which never writes `log` at all, so
    ANY new entry there means a search skill ran and the strict form is the
    real gate. 012's accepted route is record-extraction, which holds
    `research_log_append` and may legitimately write a non-`external_site`
    entry for the record it was handed — flagging that would fail 012 for
    routing correctly. Narrowing both would have silently dropped 011's gate
    (issue #1519), so the loosening is carried
    by a tag on 012 alone rather than by the shared `no-search-no-write` gate.

    Deliberately does NOT flag other research.json writes: routing to
    research-plan legitimately writes `plans`/`questions`, and record-extraction
    legitimately writes `sources`/`assertions`. Both are correct behavior.
    """
    if "no-search-no-write" not in test.get("tags", []):
        pytest.skip("not a no-search-no-write scenario")

    # 1. No external-site search executed.
    searched = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "external_links_search"
    ]
    assert not searched, (
        "a route-away request must not execute an external-site search; got "
        f"external_links_search call(s) with args: "
        f"{[c.get('args') for c in searched]}"
    )

    # 2. No new search log entry. Which entries count depends on what the
    #    accepted route is allowed to write, so the narrowing is opt-in per
    #    test rather than applied to both.
    new_entries = _new_log_entries(before_state, after_state)
    if "route-away-writes-own-log" in test.get("tags", []):
        offending = [e for e in new_entries if e.get("tool") == "external_site"]
        detail = "external_site search log entry"
    else:
        offending = new_entries
        detail = "search log entry"
    assert not offending, (
        f"a route-away request must not append a {detail}; new log ids: "
        f"{[e.get('id') for e in offending]}"
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


def test_capture_pending_item_not_terminal(before_state, after_state, test):
    """Issue #1226 — a plan item awaiting an external-site capture must not be
    `completed`/`skipped`. Shared with the other suite that can reach this
    state; the assertion lives in validators_lib."""
    _assert_capture_pending_item_not_terminal(before_state, after_state, test)
