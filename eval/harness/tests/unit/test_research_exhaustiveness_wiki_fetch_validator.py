"""Direct tests for the research-exhaustiveness registration-fetch validator.

Same reason as the sibling validator tests: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: issue #2257 / ADR-0012 removed the two hardcoded facts
(Ireland 1864, Pennsylvania 1906) from the agent body and replaced them with a
`wiki_read` named unconditionally in `## 1. Gather evidence`. Nothing else
proves the fetch happened — the judge grades the conclusion, and a conclusion
reached from the model's own memory of a start date looks identical to one read
off the page.

The prefix cases below are the point of `bare_tool_name`: a run records the
call under whichever of the three server spellings the session resolved
(CLAUDE.md, "Dual-spelled tool names"), so matching a qualified name would
match nothing on two thirds of runs.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research_exhaustiveness import (  # noqa: E402
    test_fetches_registration_start_date as check,
)

POSITIVE = {"tags": ["planning", "exhaustiveness"]}
NEGATIVE = {"tags": ["near-miss", "exhaustiveness-vs-research-plan"]}
IN_PROGRESS = {"tags": ["research-exhaustiveness", "refuse-in-progress"]}
ALREADY_DECLARED = {"tags": ["research-exhaustiveness", "already-declared", "re-invocation"]}


def _call(tool):
    return {"tool": tool, "args": {}}


def test_fires_when_no_wiki_read_happened():
    """The whole point: an agent that reasons from memory instead of reading."""
    calls = [_call("mcp__genealogy__project_context"),
             _call("mcp__genealogy__research_append")]
    with pytest.raises(AssertionError, match="did not fetch"):
        check(calls, POSITIVE)


def test_fires_on_zero_tool_calls():
    with pytest.raises(AssertionError, match="none"):
        check([], POSITIVE)


def test_passes_on_the_harness_spelling():
    check([_call("mcp__genealogy__wiki_read")], POSITIVE)


def test_passes_on_the_bridged_cowork_spelling():
    check([_call("mcp__remote-devices__Genealogy_Research__wiki_read")], POSITIVE)


def test_passes_on_the_bare_display_name_spelling():
    check([_call("mcp__Genealogy_Research__wiki_read")], POSITIVE)


def test_does_not_confuse_a_sibling_wiki_tool():
    """wiki_place_page and wiki_search are different tools; neither reads the
    constructed registration URL, so neither satisfies this check."""
    calls = [_call("mcp__genealogy__wiki_search"),
             _call("mcp__genealogy__wiki_place_page")]
    with pytest.raises(AssertionError, match="did not fetch"):
        check(calls, POSITIVE)


def test_skips_the_near_miss_negatives():
    """The four routing negatives never spawn the agent, so they make no MCP
    calls at all and must not be failed for it."""
    with pytest.raises(pytest.skip.Exception):
        check([], NEGATIVE)


def test_tolerates_a_missing_tags_key():
    with pytest.raises(AssertionError, match="did not fetch"):
        check([], {})


def test_tolerates_none_tool_calls():
    with pytest.raises(AssertionError, match="did not fetch"):
        check(None, POSITIVE)


def test_skips_a_run_that_returns_at_a_step_0_precondition():
    """ut_005 (in-flight plan item) and ut_006 (already declared) correctly
    return before `## 1. Gather evidence`, so they owe no fetch. Both failed
    this check on v1_2026-09-08_06-48-40 before the gate was added — 4 and 5
    calls respectively, neither reaching Step 1."""
    for tags in (IN_PROGRESS, ALREADY_DECLARED):
        with pytest.raises(pytest.skip.Exception):
            check([_call("mcp__genealogy__project_context")], tags)


def test_still_fires_on_an_ordinary_positive_that_skipped_the_fetch():
    """The gate must not swallow the real signal: ut_004 reached research_append
    on the same scenario where ut_001 and ut_010 both fetched, and skipped the
    lookup anyway. That is the case this check exists for."""
    calls = [_call("mcp__genealogy__project_context"),
             _call("mcp__genealogy__research_query"),
             _call("mcp__genealogy__research_append")]
    with pytest.raises(AssertionError, match="did not fetch"):
        check(calls, POSITIVE)
