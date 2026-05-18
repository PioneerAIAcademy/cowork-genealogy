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

import pytest

from validators_lib import assert_foreign_keys_valid


# --- Helpers ----------------------------------------------------------

def _new_timelines(before_state, after_state) -> list[dict]:
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {t.get("id") for t in before.get("timelines", []) if isinstance(t, dict)}
    return [
        t for t in after.get("timelines", [])
        if isinstance(t, dict) and t.get("id") not in before_ids
    ]


def _event_sort_key(e: dict) -> str:
    """Lexical sort works for ISO-shaped dates the schema enforces.

    Timeline events use a permissive `date: string` field (the schema
    requires the field but doesn't enforce ISO at the event level — only
    gap.start/end are strict iso_date), so we compare via the date string
    as the skill wrote it. If a date is missing we treat it as empty,
    which sorts first — a defect the chronological-ordering rubric
    dimension would catch.
    """
    return e.get("date") or ""


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_produces_timeline(before_state, after_state, test):
    """Positive timeline tests must add at least one timeline_entry to
    research.json. The skill's whole job is to populate this section."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new = _new_timelines(before_state, after_state)
    assert new, "expected at least one new timeline_entry"


def test_events_have_non_empty_assertion_ids(before_state, after_state, test):
    """Every timeline event must trace back to at least one assertion.
    The schema requires the field; this validator enforces that it isn't
    populated with an empty array (which would let unsupported events
    slip into the timeline)."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new = _new_timelines(before_state, after_state)
    if not new:
        pytest.skip("no new timelines (covered by separate validator)")
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
    new = _new_timelines(before_state, after_state)
    if not new:
        pytest.skip("no new timelines (covered by separate validator)")
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
    new = _new_timelines(before_state, after_state)
    if not new:
        pytest.skip("no new timelines (covered by separate validator)")
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

def test_no_impossibilities_when_resolved(before_state, after_state, test):
    """Tag-gated: in scenarios where the source data is internally
    consistent (the resolved birthplace conflict, no contradictory
    locations), the new timeline's `impossibilities` array should be
    empty. Conflicting INFORMANT testimony about a fact (e.g. birthplace)
    is not a chronological impossibility — that distinction belongs to
    the conflicts section."""
    if "no-impossibilities-expected" not in test.get("tags", []):
        pytest.skip("not a no-impossibilities-expected scenario")
    new = _new_timelines(before_state, after_state)
    assert new, "no new timeline to check"
    errors: list[str] = []
    for t in new:
        imp = t.get("impossibilities", [])
        if imp:
            errors.append(
                f"timelines[{t.get('id')}].impossibilities should be empty "
                f"in this scenario; got {imp}"
            )
    assert not errors, "Unexpected impossibilities:\n  - " + "\n  - ".join(errors)


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
    new = _new_timelines(before_state, after_state)
    if not new:
        pytest.skip("no new timeline to check")
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
