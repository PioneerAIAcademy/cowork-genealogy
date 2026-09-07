"""Skill-specific validators for the timeline skill.

timeline builds a chronological timeline_entry from existing assertions
in research.json. Narrative-quality dimensions (chronological ordering
judgment, gap detection, impossibility detection) live in the rubric —
graded by the LLM judge. Structural rules (events sorted by date,
every event traces back to a real assertion, gaps/impossibilities have
the required shape) live here.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import assert_foreign_keys_valid

# US federal decennial census years, per SKILL.md's own list. A non-US life
# must expect its residence jurisdiction's schedule instead (issue #2261).
US_FEDERAL_CENSUS_YEARS = frozenset({1850, 1860, 1870, 1880, 1900, 1910, 1920})
_YEAR_RE = re.compile(r"(?<!\d)(1[89]\d\d)(?!\d)")


# --- Helpers ----------------------------------------------------------

def _produced_timelines(before_state, after_state) -> list[dict]:
    """Return timelines the skill added or modified.

    A refresh (Mode C) replaces an existing timeline in-place — the ID is
    present both before and after, but the content changes. Structural
    validators must cover refreshed timelines with the same rules as new
    ones, so both cases are included here.
    """
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_by_id = {
        t.get("id"): t for t in before.get("timelines", []) if isinstance(t, dict)
    }
    result = []
    for t in after.get("timelines", []):
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        if tid not in before_by_id:
            result.append(t)  # new
        elif t != before_by_id[tid]:
            result.append(t)  # modified (refresh)
    return result


def _event_sort_key(e: dict) -> str:
    """Return a sortable key for a timeline event date.

    Timeline events use a permissive `date: string` field. Approximate
    dates are prefixed with `~` (e.g. `~1845`), and directional qualifiers
    like `<` / `>` may also appear. Strip the leading non-digit characters
    before comparing so that `~1845` sorts before `1850`, not after it
    (`~` is ASCII 126, which is greater than all digits and most letters).

    If a date is missing we treat it as empty, which sorts first — a
    defect the chronological-ordering rubric dimension would catch.
    """
    raw = e.get("date") or ""
    return raw.lstrip("~<> \t")


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_produces_timeline(before_state, after_state, test):
    """Positive timeline tests must add or refresh at least one timeline_entry
    in research.json. Mode C (refresh) replaces an existing timeline in-place;
    that counts as produced."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new = _produced_timelines(before_state, after_state)
    assert new, "expected at least one produced (added or refreshed) timeline_entry"


def test_events_have_non_empty_assertion_ids(before_state, after_state, test):
    """Every timeline event must trace back to at least one assertion.
    The schema requires the field; this validator enforces that it isn't
    populated with an empty array (which would let unsupported events
    slip into the timeline)."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new = _produced_timelines(before_state, after_state)
    if not new:
        pytest.skip("no produced timelines (covered by separate validator)")
    errors: list[str] = []
    for t in new:
        for i, event in enumerate(t.get("events", [])):
            if not event.get("assertion_ids"):
                errors.append(
                    f"timelines[{t.get('id')}].events[{i}] has empty "
                    f"assertion_ids — every event must cite at least one "
                    f"assertion"
                )
    assert not errors, "Timeline events without supporting assertions:\n  - " + "\n  - ".join(errors)


def test_event_assertion_ids_resolve(before_state, after_state, test):
    """Every assertion_id on a new event must point to an existing
    assertion in research.json. Catches references to assertions the
    skill imagined into being."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("no research.json in scenario")
    new = _produced_timelines(before_state, after_state)
    if not new:
        pytest.skip("no produced timelines (covered by separate validator)")
    valid_ids = {
        a.get("id") for a in after.get("assertions", [])
        if isinstance(a, dict) and a.get("id")
    }
    errors: list[str] = []
    for t in new:
        for i, event in enumerate(t.get("events", [])):
            for ref in event.get("assertion_ids", []) or []:
                if ref not in valid_ids:
                    errors.append(
                        f"timelines[{t.get('id')}].events[{i}].assertion_ids "
                        f"'{ref}' doesn't match any assertion in research.json"
                    )
    assert not errors, "Dangling timeline assertion refs:\n  - " + "\n  - ".join(errors)


def test_events_chronologically_ordered(before_state, after_state, test):
    """Events within each new timeline must be sorted by date.
    Chronological *interpretation* of approximate dates is judge-graded;
    the mechanical "sorted by the date string" check is here."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new = _produced_timelines(before_state, after_state)
    if not new:
        pytest.skip("no produced timelines (covered by separate validator)")
    errors: list[str] = []
    for t in new:
        events = t.get("events", [])
        keys = [_event_sort_key(e) for e in events]
        if keys != sorted(keys):
            errors.append(
                f"timelines[{t.get('id')}].events out of date order: "
                f"got dates {keys}"
            )
    assert not errors, "Chronological-order violations:\n  - " + "\n  - ".join(errors)


# --- Tag-gated checks ------------------------------------------------

def test_no_rejected_assertion_in_events(before_state, after_state, test):
    """Tag-gated: in scenarios with a resolved conflict, the timeline
    should reflect the preferred assertion only — events must not cite
    an assertion that the resolved conflict marked as competing-but-not-
    preferred. The rejected assertion's id is named via the
    `rejected-assertion-id-<id>` tag (slug-style)."""
    tags = test.get("tags", [])
    rejected = [
        t.removeprefix("rejected-assertion-id-")
        for t in tags
        if t.startswith("rejected-assertion-id-")
    ]
    if not rejected:
        pytest.skip("no rejected-assertion-id-<id> tag")
    new = _produced_timelines(before_state, after_state)
    if not new:
        pytest.skip("no produced timeline to check")
    errors: list[str] = []
    for t in new:
        for i, event in enumerate(t.get("events", [])):
            for ref in event.get("assertion_ids", []) or []:
                if ref in rejected:
                    errors.append(
                        f"timelines[{t.get('id')}].events[{i}].assertion_ids "
                        f"includes rejected assertion '{ref}' (rejected per "
                        f"resolved conflict in scenario)"
                    )
    assert not errors, (
        "Rejected assertions appearing in timeline events:\n  - "
        + "\n  - ".join(errors)
    )


# --- Census years read from the wiki, not the US schedule (#2261) ------

def _wiki_read_calls(tool_calls) -> list[dict]:
    """wiki_read tool calls this run, each carrying the response the mock
    served (mock_mcp.py sets `entry["response"]`)."""
    return [tc for tc in (tool_calls or []) if "wiki_read" in (tc.get("tool") or "")]


def test_census_years_read_from_wiki(before_state, after_state, tool_calls, test):
    """Tag-gated (`census-from-wiki`): the timeline must derive expected census
    years from the residence jurisdiction's `{Country}_Census` wiki page
    (ADR-0012, issue #2261), not from a hard-coded US federal schedule.

    Two assertions:
      1. A `wiki_read` call to a `{Country}_Census` page is *observed* in
         `tool_calls` — ADR-0012 requires the fetch be observed, not merely
         instructed (the `gps-mentor` skip pattern).
      2. Every census year the timeline placed in a gap's `expected_events`
         appears on a fetched census page, and at least one is outside the US
         federal set — proving the years came from the page, not the default.
    """
    if "census-from-wiki" not in (test.get("tags") or []):
        pytest.skip("not a census-from-wiki test")

    census_reads = [
        tc for tc in _wiki_read_calls(tool_calls)
        if "_Census" in ((tc.get("args") or {}).get("url") or "")
    ]
    assert census_reads, (
        "census-from-wiki test must call wiki_read for a {Country}_Census page; "
        f"wiki_read urls seen: "
        f"{[(tc.get('args') or {}).get('url') for tc in _wiki_read_calls(tool_calls)]}"
    )

    page_text = "".join(
        str((tc.get("response") or {}).get("content") or "")
        for tc in census_reads
        if isinstance(tc.get("response"), dict)
    )

    timelines = _produced_timelines(before_state, after_state)
    if not timelines:
        pytest.skip("no produced timeline (covered by test_positive_produces_timeline)")

    census_years: set[int] = set()
    for tl in timelines:
        for gap in (tl.get("gaps") or []):
            if not isinstance(gap, dict):
                continue
            joined = " ".join(str(x) for x in (gap.get("expected_events") or []))
            if "census" not in joined.lower():
                continue
            # Only the years named in expected_events are census years; the gap's
            # start/end are the bounding events (a birth/marriage/death), not
            # census years, so they are deliberately not collected here.
            census_years.update(int(y) for y in _YEAR_RE.findall(joined))

    assert census_years, (
        "census-from-wiki test produced no census gap naming a year in "
        "expected_events; the timeline should expect the jurisdiction's "
        "undocumented census years"
    )

    missing = sorted(y for y in census_years if str(y) not in page_text)
    assert not missing, (
        f"expected census years absent from the fetched census page: {missing} "
        f"(all expected census years: {sorted(census_years)}) — a year the page "
        "does not list was not read from it"
    )

    non_us = sorted(census_years - US_FEDERAL_CENSUS_YEARS)
    assert non_us, (
        f"every expected census year is a US federal year ({sorted(census_years)}); "
        "a non-US life must expect its own jurisdiction's census years, not the "
        "US schedule"
    )
