"""Validators for the timeline agent.

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

from validators_lib import assert_foreign_keys_valid, bare_tool_name

# --- Helpers ----------------------------------------------------------

def _produced_timelines(before_state, after_state) -> list[dict]:
    """Return timelines the agent added or modified.

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


# --- Structural rules from the agent body -----------------------------------

def test_positive_produces_timeline(before_state, after_state, test):
    """Positive timeline tests must add or refresh at least one timeline_entry
    in research.json. Mode C (refresh) replaces an existing timeline in-place;
    that counts as produced."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    if "no-project-write" in (test.get("tags") or []):
        pytest.skip("a no-project-write test's correct outcome is no timeline")
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
    agent imagined into being."""
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


# --- The US 1890 census never fills a gap (ADR-0012, issue #2261) ---------

# Python mirrors of `timelineCensus1890Invariants`'s attribution regexes
# (`packages/engine/mcp-server/src/tools/research-append.ts`). The engine applies
# them on every timeline write; this replays the same reading on the persisted
# timeline, with one difference stated in the validator's docstring.
_NAMES_US_RE = re.compile(r"united states|u\.s\.", re.IGNORECASE)
_NAMES_US_ABBREV_RE = re.compile(r"\bUS\b|\bUSA\b")
_VETERAN_RE = re.compile(r"veteran", re.IGNORECASE)
_1890_RE = re.compile(r"(?<!\d)1890(?!\d)")
_NAMES_OTHER_JURISDICTION_RE = re.compile(
    r"\b(?!Census\b|Federal\b|United\b|States\b|Population\b|Decennial\b|Eleventh\b|County\b"
    r"|The\b|A\b|An\b|This\b|That\b|These\b|Those\b)([A-Z][a-z]+)"
    r"(?:\s(?:Population|Decennial|Eleventh|County))*\s[Cc]ensus\b"
)


def _us_place_words(timeline: dict) -> set[str]:
    """Every word of a US-placed event's `place` and `standard_place`: a
    "Pennsylvania census" on a Pennsylvania timeline names a US state."""
    words: set[str] = set()
    for e in timeline.get("events") or []:
        sp = e.get("standard_place") if isinstance(e, dict) else None
        if not isinstance(sp, str) or not sp.endswith("United States"):
            continue
        for src in (sp, e.get("place")):
            if isinstance(src, str):
                words.update(re.findall(r"[A-Za-z]+", src))
    return words


def test_us_1890_never_expected(before_state, after_state, test):
    """Deterministic backstop for the one documented fact that the US 1890
    federal census does not survive: it can never fill a gap, so no
    `expected_events` entry may name it.

    An entry naming a census and the year 1890 is flagged unless it names a
    jurisdiction outside the United States, read as the engine reads it: a
    capitalized word before "census" that is not a word of the timeline's own
    US-placed events ("Denmark census 1890" passes; "1890 Pennsylvania census"
    on a Pennsylvania timeline does not). A veterans schedule is not the
    population census and is left alone. Unlike the engine, an entry naming no
    jurisdiction is flagged whether or not any event is in the United States: a
    bare "1890 census" is the schedule-revert regression this guards.

    Scope is the 1890 fact only; it encodes no census schedule. Not tag-gated."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests produce timelines")
    timelines = _produced_timelines(before_state, after_state)
    if not timelines:
        pytest.skip("no produced timeline")

    offending: list[str] = []
    for tl in timelines:
        us_words = _us_place_words(tl)
        for gap in (tl.get("gaps") or []):
            if not isinstance(gap, dict):
                continue
            for item in (gap.get("expected_events") or []):
                entry = str(item)
                if "census" not in entry.lower() or not _1890_RE.search(entry):
                    continue
                if _VETERAN_RE.search(entry):
                    continue
                names_us = bool(_NAMES_US_RE.search(entry) or _NAMES_US_ABBREV_RE.search(entry))
                if not names_us:
                    other = _NAMES_OTHER_JURISDICTION_RE.search(entry)
                    if other and other.group(1) not in us_words:
                        continue
                offending.append(entry)

    assert not offending, (
        "the US 1890 federal census does not survive and can never fill a gap, "
        f"but 1890 appears as a US census expected_event: {offending} "
        "(ADR-0012, issue #2261)"
    )


# --- The person timeline is timeline_build's (issue #3516) -------------------

def _calls(tool_calls, name: str) -> list[tuple[int, dict]]:
    """(position, call) for every call to `name`, under any server spelling."""
    return [
        (i, c) for i, c in enumerate(tool_calls or [])
        if bare_tool_name(str(c.get("tool", ""))) == name
    ]


def _writes_timelines(call: dict) -> bool:
    """A research_append call that writes the `timelines` section, in its
    single-op form or as any op of the batched `ops` form."""
    args = call.get("args") or {}
    if args.get("section") == "timelines":
        return True
    ops = args.get("ops")
    return isinstance(ops, list) and any(
        isinstance(op, dict) and op.get("section") == "timelines" for op in ops
    )


def test_project_unchanged(before_state, after_state, test):
    """Tag-gated (`no-project-write`): the run writes nothing to research.json.
    For a run whose correct outcome is no timeline at all (nothing linked and
    nothing to extract, or a hypothesis with no linked record)."""
    if "no-project-write" not in (test.get("tags") or []):
        pytest.skip("not a no-project-write test")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    assert after == before, (
        "research.json changed in a run that must write nothing; sections that differ: "
        f"{sorted(k for k in set(before or {}) | set(after or {}) if (before or {}).get(k) != (after or {}).get(k))}"
    )


def test_no_extraction(tool_calls, test):
    """Tag-gated (`extraction-calls-0`): no `extraction_append` call. Mode B
    never extracts, and a person who already has live links is built at the
    first `timeline_build` call."""
    if "extraction-calls-0" not in (test.get("tags") or []):
        pytest.skip("not an extraction-calls-0 test")
    calls = _calls(tool_calls, "extraction_append")
    assert not calls, (
        f"expected no extraction_append call; got {len(calls)}: "
        f"{[c.get('args') for _, c in calls]}"
    )


def test_one_extraction_between_builds(tool_calls, test):
    """Tag-gated (`extraction-calls-1`): with nothing linked, the agent calls
    `extraction_append({ personId })` exactly once, after a `timeline_build`
    and before another one (lead, 2026-10-20)."""
    if "extraction-calls-1" not in (test.get("tags") or []):
        pytest.skip("not an extraction-calls-1 test")
    calls = _calls(tool_calls, "extraction_append")
    assert len(calls) == 1, (
        f"expected exactly one extraction_append call; got {len(calls)}: "
        f"{[c.get('args') for _, c in calls]}"
    )
    pos, call = calls[0]
    args = call.get("args") or {}
    assert isinstance(args.get("personId"), str) and args["personId"].strip(), (
        f"the extraction_append call must carry personId (the attached-records mode); args: {args}"
    )
    builds = [i for i, _ in _calls(tool_calls, "timeline_build")]
    assert any(i < pos for i in builds) and any(i > pos for i in builds), (
        "the extraction_append call must fall between two timeline_build calls "
        f"(build, extract once, build again); timeline_build at {builds}, extraction_append at {pos}"
    )


def test_person_timeline_in_code(before_state, after_state, tool_calls, test):
    """Tag-gated (`person-timeline-in-code`): a person timeline is built by
    `timeline_build`. The run calls it, never writes `timelines` through
    `research_append`, and leaves every hypothesis timeline as it was. Catches a
    Mode A delegation read as a regeneration of a hypothesis timeline that lists
    the same person."""
    if "person-timeline-in-code" not in (test.get("tags") or []):
        pytest.skip("not a person-timeline-in-code test")
    assert _calls(tool_calls, "timeline_build"), (
        "a person timeline must be built by timeline_build; it was never called. "
        f"Tools called: {sorted({str(c.get('tool')) for c in tool_calls or []})}"
    )
    hand_written = [c.get("args") for _, c in _calls(tool_calls, "research_append") if _writes_timelines(c)]
    assert not hand_written, (
        "the person timeline must not be written through research_append: "
        f"{hand_written}"
    )
    before = {t.get("id"): t for t in (before_state.get("research_json") or {}).get("timelines", []) if isinstance(t, dict)}
    after = {t.get("id"): t for t in (after_state.get("research_json") or {}).get("timelines", []) if isinstance(t, dict)}
    changed = sorted(
        tid for tid, t in before.items()
        if t.get("hypothesis_id") and after.get(tid) != t
    )
    assert not changed, f"hypothesis timeline(s) changed by a person-timeline run: {changed}"
