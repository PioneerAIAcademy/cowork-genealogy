"""V13 (`test_probate_office_came_from_the_wiki`) is proven to fail.

CLAUDE.md, "A new lint must be proven to fail": break it several ways, and show
a legitimate variant it still accepts. This gate is the only thing standing
behind the ADR-0012 wiki move for probate (issue #2262, carried into #2799).
It checks that the fetch HAPPENED, not what the citation says, and that is the
only thing checkable: the body still carries a Berks County worked example that
names a Register of Wills (kept deliberately -- it is a citation template), and
both probate tests are Pennsylvania, so a recalled office is indistinguishable
from a looked-up one by reading the output. Only the tool ledger separates them.
A gate that passed on an empty ledger would put the move's whole acceptance
criterion on an assertion that checks nothing.

The rejections below are the three shapes a real run can produce: no lookup at
all, a lookup of the wrong page, and a `wiki_read` whose url is missing or
nested where the validator does not read it.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]

PROBATE = {"tags": ["probate", "will", "src_006", "direct-arm"]}
NOT_PROBATE = {"tags": ["census", "1850", "direct-arm"]}


def _citation():
    path = REPO_ROOT / "eval" / "harness" / "validators" / "test_citation.py"
    spec = importlib.util.spec_from_file_location("_tc_probate_wiki", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _call(tool, **args):
    return {"tool": tool, "args": args}


# ── Accepts ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.familysearch.org/en/wiki/Pennsylvania_Probate_Records",
        # A different state is the point of the move, not an edge case.
        "https://www.familysearch.org/en/wiki/Iowa_Probate_Records",
        # Two-word state names carry an underscore of their own.
        "https://www.familysearch.org/en/wiki/New_York_Probate_Records",
    ],
)
def test_accepts_a_probate_page_fetch(url):
    mod = _citation()
    mod.test_probate_office_came_from_the_wiki(
        [_call("mcp__genealogy__wiki_read", url=url)], PROBATE
    )


def test_accepts_the_fetch_alongside_other_calls():
    mod = _citation()
    mod.test_probate_office_came_from_the_wiki(
        [
            _call("mcp__genealogy__wiki_read",
                  url="https://www.familysearch.org/en/wiki/Pennsylvania_Vital_Records"),
            _call("mcp__remote-devices__Genealogy_Research__wiki_read",
                  url="https://www.familysearch.org/en/wiki/Pennsylvania_Probate_Records"),
            _call("mcp__genealogy__research_append", section="sources"),
        ],
        PROBATE,
    )


def test_skips_a_test_that_is_not_probate():
    """`pytest.skip.Exception`, not `Exception`: `Skipped` derives from
    `BaseException`, so a bare `pytest.raises(Exception)` lets it through and
    marks THIS test skipped -- which looks like a pass and asserts nothing."""
    mod = _citation()
    with pytest.raises(pytest.skip.Exception) as exc:
        mod.test_probate_office_came_from_the_wiki([], NOT_PROBATE)
    assert "probate" in str(exc.value)


# ── Rejects ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "tool_calls, why",
    [
        ([], "no tool calls at all"),
        (
            [_call("mcp__genealogy__research_append", section="sources")],
            "refined the citation without any wiki_read",
        ),
        (
            [_call("mcp__genealogy__wiki_read",
                   url="https://www.familysearch.org/en/wiki/Pennsylvania_Vital_Records")],
            "fetched the wrong page",
        ),
        (
            [_call("mcp__genealogy__wiki_search", query="Pennsylvania probate")],
            "searched instead of reading the page",
        ),
        (
            [_call("mcp__genealogy__wiki_read", url="")],
            "a wiki_read with no url",
        ),
        (
            [{"tool": "mcp__genealogy__wiki_read", "args": {}}],
            "a wiki_read whose args carry no url key",
        ),
        (
            [{"tool": "mcp__genealogy__wiki_read",
              "response": {"url": "https://www.familysearch.org/en/wiki/"
                                  "Pennsylvania_Probate_Records"}}],
            "the page only in the RESPONSE, never requested in args",
        ),
    ],
)
def test_rejects(tool_calls, why):
    mod = _citation()
    with pytest.raises(AssertionError) as exc:
        mod.test_probate_office_came_from_the_wiki(tool_calls, PROBATE)
    assert "without fetching the creating" in str(exc.value), why


def test_the_two_probate_tests_in_the_suite_carry_the_gating_tag():
    """The gate is tag-driven, so a retagged test silently leaves it behind.

    Named individually rather than counted: the acceptance criterion on issue
    #2799 is that the committed run log shows the fetch on these two.
    """
    import json

    suite = REPO_ROOT / "eval" / "tests" / "unit" / "citation"
    for name in ("probate-will-citation.json", "fabrication-guardrail-probate.json"):
        spec = json.loads((suite / name).read_text(encoding="utf-8"))
        assert "probate" in spec["test"]["tags"], name
        assert "wiki-read-pennsylvania-probate-records" in spec["mcp_fixtures"], name
