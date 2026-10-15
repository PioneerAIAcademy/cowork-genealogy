"""Validators for the historical-context agent.

historical-context produces narrative analysis tying historical background to
research-relevant record classes. Inside a project it writes only research-log
entries (#3244 option L): one per wiki/Wikipedia lookup, plus one
`historical_context` entry carrying the full overview in `notes`, which
otherwise lived only in the chat and was lost with the session. It writes
nothing else in research.json or tree.gedcomx.json. Narrative-quality
dimensions (Relevance to research, Source quality, Genealogical implications)
live in the rubric — graded by the LLM judge.

`test_universal.test_ownership_table` already confines the agent to `log`, and
`test_universal.test_log_append_only` already keeps the log append-only; what
only this file checks is which `tool` values the agent may log, and (tag
`logs-overview`) that the overview entry was actually written.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import (
    assert_log_append_only,
    assert_only_writes_to_sections,
    assert_topical_fixture_used,
    new_log_entries,
)


# --- Writes: reference-lookup log entries only (#3244) ----------------

_LOGGABLE_TOOLS = frozenset(
    {"wiki_search", "wiki_read", "wikipedia_search", "historical_context"}
)

#: A floor that a one- or two-sentence summary falls under and an overview with
#: its Sources consulted list clears.
_MIN_OVERVIEW_CHARS = 400


def _research_states(before_state, after_state):
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("no research.json in scenario")
    return before, after


def test_writes_only_reference_log_entries(before_state, after_state, test):
    """Only `log` changes, the old log is a prefix of the new one, and every
    new entry's `tool` is one of the agent's lookups or its overview."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests can exercise writes")
    before, after = _research_states(before_state, after_state)
    assert_only_writes_to_sections(
        before, after, {"log"}, skill_name="historical-context"
    )
    assert_log_append_only(before, after)
    stray = [
        e.get("tool")
        for e in new_log_entries(before_state, after_state)
        if e.get("tool") not in _LOGGABLE_TOOLS
    ]
    assert not stray, (
        f"historical-context logged tools it does not call: {stray}; "
        f"allowed: {sorted(_LOGGABLE_TOOLS)}"
    )


def test_overview_logged(before_state, after_state, test):
    """Tag `logs-overview`: exactly one new `historical_context` entry, with
    `plan_item_id` null and the full overview (not a summary) in `notes`."""
    if "logs-overview" not in test.get("tags", []):
        pytest.skip("not a logs-overview test")
    _research_states(before_state, after_state)
    overviews = [
        e for e in new_log_entries(before_state, after_state)
        if e.get("tool") == "historical_context"
    ]
    assert len(overviews) == 1, (
        f"expected exactly one new historical_context log entry; got {len(overviews)}"
    )
    entry = overviews[0]
    assert entry.get("plan_item_id") is None, (
        f"the overview entry's plan_item_id is {entry.get('plan_item_id')!r}, not null"
    )
    notes = entry.get("notes")
    assert isinstance(notes, str) and len(notes.strip()) >= _MIN_OVERVIEW_CHARS, (
        f"the overview entry's notes must hold the full overview "
        f"(>= {_MIN_OVERVIEW_CHARS} chars); got {len((notes or '').strip())} chars"
    )


# --- Topical fixture actually fires (issue #2283 review) --------------

# Maps a tagged test id to the topical fixture stem its `mcp_fixtures[0]`
# names. Hardcoded rather than read from the test spec: the `test` fixture
# only carries the inner "test" block (id/skill/name/type/tags), not
# top-level `mcp_fixtures` (validator_runner.py). Add an entry here whenever
# the "topical-fixture-required" tag is added to a test.
_TOPICAL_FIXTURE_BY_TEST_ID = {
    "ut_historical_context_gsm": "wiki-search-guardianship-stepchildren",
    "ut_historical_context_u4k": "wiki-search-guardianship-stepchildren",
    "ut_historical_context_hbt": "wiki-search-guardianship-own-children",
    "ut_historical_context_001": "wiki-read-united-states-emigration-and-immigration",
    "ut_historical_context_003": "wiki-read-united-states-emigration-and-immigration",
    "ut_historical_context_005": "wiki-read-west-virginia-genealogy",
    "ut_historical_context_007": "wiki-read-england-civil-registration",
    "ut_historical_context_013": "wiki-read-germany-civil-registration",
}


def test_topical_fixture_actually_used(tool_calls, test):
    """A test tagged 'topical-fixture-required' lists a subject-matter fixture
    ahead of the wiki-search-any/wikipedia-search-any fallbacks (topical
    fixtures match first). Nothing previously confirmed the model's actual query
    phrasing hit that predicate rather than silently falling through to the
    generic fallback -- issue #2283 review (mercyokum): "If the model's phrasing
    ever drifts off matching [the predicate], this silently falls back to the
    generic fixture with no signal anywhere that it happened."

    A miss means the judge graded Source quality against generic fallback
    content, not the subject-matter fixture the test exists to exercise.

    The check itself is `validators_lib.assert_topical_fixture_used`, shared with
    `test_search_records`, which grew a second copy of it; that caller adds an
    ordering arm this one does not need.
    """
    assert_topical_fixture_used(
        tool_calls,
        test,
        _TOPICAL_FIXTURE_BY_TEST_ID,
        map_name="_TOPICAL_FIXTURE_BY_TEST_ID",
    )


# --- Confident attribution in no-results tests (issue #2331) -----------

CONFIDENT_ATTRIBUTION_RE = re.compile(
    r'(?:'
    r'(?:the\s+)?most\s+likely\s+explanations?'
    r'|ordered\s+by\s+(?:probability|likelihood)'
    r'|\(most\s+likely\)'
    r'|is\s+almost\s+certainly'
    r')',
    re.IGNORECASE,
)

def report_confident_no_results_attribution(text_response, test):
    """Tier 2: flags confident ranked/attributed cause lists on no-results
    tests where no tool returned content about the subject."""
    if "no-results" not in test.get("tags", []):
        pytest.skip("not a no-results test")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")
    matches = CONFIDENT_ATTRIBUTION_RE.findall(response)
    if not matches:
        return
    raise AssertionError(
        "the response contains "
        + "; ".join(f"'{m.strip()}'" for m in matches[:5])
        + " \u2014 confident attribution language in a no-results test"
    )
