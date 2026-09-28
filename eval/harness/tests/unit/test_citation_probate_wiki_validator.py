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
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
SUITE = REPO_ROOT / "eval" / "tests" / "unit" / "citation"

# Read from the real test rather than hand-copying its tags. A hand-written copy
# and the validator's gate literal are two spellings of one fact, and nothing
# compared them: moving the literal (`"probate"` -> `"probate-records"`) made
# every reject case below SKIP and the file exit 0 -- `2 passed, 11 skipped`,
# green, checking nothing. That is the "check that cannot fail" shape CLAUDE.md
# names, reproduced on this very file. Derived, the same mutation reds it.
PROBATE = json.loads((SUITE / "probate-will-citation.json").read_text(encoding="utf-8"))["test"]
NOT_PROBATE = json.loads((SUITE / "refine-census-citation.json").read_text(encoding="utf-8"))["test"]


def _citation():
    path = REPO_ROOT / "eval" / "harness" / "validators" / "test_citation.py"
    spec = importlib.util.spec_from_file_location("_tc_probate_wiki", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _call(tool, **args):
    return {"tool": tool, "args": args}


def _run_gate(mod, tool_calls, test):
    """Call V13, turning a `pytest.skip` into a hard failure.

    THIS is what makes the file provable, and deriving the tags from the suite
    was not enough on its own. `Skipped` derives from `BaseException`, so a skip
    raised inside `pytest.raises(AssertionError)` propagates straight past it and
    marks the CALLING test skipped -- which reads as green. Moving the
    validator's gate literal (`"probate"` -> `"probate-records"`) made all seven
    reject cases skip and the file exit 0 at `2 passed, 11 skipped`. Reproduced
    twice: once on the hand-written tags, and again after deriving them from the
    suite, which changed nothing because the mutation is on the OTHER side of the
    comparison. Converting the skip here is what reds it.
    """
    try:
        mod.test_probate_office_came_from_the_wiki(tool_calls, test)
    except pytest.skip.Exception as exc:
        raise AssertionError(
            f"V13 skipped on a test that carries the gating tag -- its gate "
            f"literal and the suite's tag no longer agree: {exc}"
        ) from None


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
    _run_gate(mod, [_call("mcp__genealogy__wiki_read", url=url)], PROBATE)


def test_accepts_the_fetch_alongside_other_calls():
    mod = _citation()
    _run_gate(
        mod,
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
        _run_gate(mod, tool_calls, PROBATE)
    assert "without fetching the creating" in str(exc.value), why


@pytest.mark.parametrize(
    "name", ["probate-will-citation.json", "fabrication-guardrail-probate.json"]
)
def test_the_gate_actually_fires_on_each_real_probate_test(name):
    """V13 must RUN on both probate tests, using their own tag blocks.

    The sibling below checks the JSON side (`"probate"` is present); this checks
    the validator side (the gate matches it). Neither alone is enough, and the
    gap between them is real: `probate-will-citation.json` also carries a `will`
    tag, so moving the gate literal to `"will"` keeps that test covered while
    silently dropping `fabrication-guardrail-probate.json`, which has no `will`
    tag. Measured -- that mutation passed 13/13 before this test existed.
    """
    mod = _citation()
    spec = json.loads((SUITE / name).read_text(encoding="utf-8"))
    with pytest.raises(AssertionError) as exc:
        _run_gate(mod, [], spec["test"])
    assert "without fetching the creating" in str(exc.value), name


def test_the_two_probate_tests_in_the_suite_carry_the_gating_tag():
    """The gate is tag-driven, so a retagged test silently leaves it behind.

    Named individually rather than counted: the acceptance criterion on issue
    #2799 is that the committed run log shows the fetch on these two.
    """
    for name in ("probate-will-citation.json", "fabrication-guardrail-probate.json"):
        spec = json.loads((SUITE / name).read_text(encoding="utf-8"))
        assert "probate" in spec["test"]["tags"], name
        assert "wiki-read-pennsylvania-probate-records" in spec["mcp_fixtures"], name
