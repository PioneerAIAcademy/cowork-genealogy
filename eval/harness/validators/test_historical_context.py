"""Skill-specific validators for the historical-context skill.

historical-context is a read-only narrative skill — it produces
narrative analysis tying historical background to research-relevant
record classes and shouldn't modify research.json or tree.gedcomx.json.
Narrative-quality dimensions (Relevance to research, Source quality,
Genealogical implications) live in the rubric — graded by the LLM judge.

The universal ownership table already enforces read-only behavior on
research.json (historical-context owns no section, so any write fails
test_universal.test_ownership_table). The check below makes the
no-research-mutation expectation explicit at the per-skill level too.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import assert_topical_fixture_used


# --- No-write enforcement --------------------------------------------

def test_does_not_modify_research_json(before_state, after_state, test):
    """historical-context is read-only — it must not modify research.json.
    The universal ownership table catches this too, but the explicit
    per-skill check surfaces the design intent here."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests can exercise writes")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("no research.json in scenario")
    assert before == after, (
        "historical-context modified research.json; it is a read-only skill"
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
