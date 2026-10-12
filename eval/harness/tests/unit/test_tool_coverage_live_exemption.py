"""`check_tool_coverage.live_tools()` — the derived LIVE_TOOLS exemption.

A LIVE_TOOL is exempt from the "declared but no fixture" warning by construction:
the mock registers it unconditionally and its handler calls the real compiled
implementation, so there is no fixture to write and never will be. Six were
hand-copied into `EXEMPT_TOOLS` while `LIVE_TOOLS` held eighteen, which is why
`research_query` was exempt and `validate_research_schema` — equally live — was
warned about for as long as both existed. Deriving it fixed both, and these pin
the derivation so the next live tool does not need a seventh hand-copy.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/scripts/check_tool_coverage.py").is_file()
)
_spec = importlib.util.spec_from_file_location(
    "check_tool_coverage", REPO / "eval/harness/scripts/check_tool_coverage.py"
)
check_tool_coverage = importlib.util.module_from_spec(_spec)
sys.modules["check_tool_coverage"] = check_tool_coverage
_spec.loader.exec_module(check_tool_coverage)


def test_it_reads_the_real_live_tools_set():
    live = check_tool_coverage.live_tools()
    # Spot-check rather than pin the whole set: pinning it would make every new
    # live tool edit this test, which is the hand-copying this replaced.
    assert {"research_append", "validate_research_schema", "research_delivered"} <= live


def test_the_delivery_tool_is_exempt_so_declaring_it_warns_about_nothing():
    """THE regression this was written for: `research` declares `research_delivered`
    (the skill body now tells the model to call it), and the forward check demanded a
    fixture for a tool that can never have one."""
    assert "research_delivered" in check_tool_coverage.live_tools()


def test_a_tool_that_is_not_live_is_not_exempted():
    """The other direction. If this started passing, the exemption would be swallowing
    the genuine gaps the lint exists to report (`tree_forget`, `same_person`,
    `place_search_all`, `wiki_search`, `source_attachments` are all real today)."""
    live = check_tool_coverage.live_tools()
    assert "tree_forget" not in live
    assert "same_person" not in live


@pytest.mark.parametrize(
    "body",
    [
        "",                                   # no LIVE_TOOLS at all
        "LIVE_TOOLS = None\n",                # present but not a collection
        "LIVE_TOOLS: set[str] = {A, B}\n",    # names, not literals
        "LIVE_TOOLS = {\n",                   # a syntax error
    ],
    ids=["absent", "not-a-collection", "non-literal", "unparseable"],
)
def test_an_unreadable_source_exempts_nothing(monkeypatch, tmp_path, body):
    """Fails OPEN to reporting gaps, never to hiding them.

    Returning everything-exempt on a parse failure would silence the whole forward
    check with one stray character, and because this lint is warn-only nothing
    downstream would go red to say so."""
    (tmp_path / "eval/harness/harness").mkdir(parents=True)
    (tmp_path / "eval/harness/harness/mock_mcp.py").write_text(body, encoding="utf-8")
    monkeypatch.setattr(check_tool_coverage, "REPO_ROOT", tmp_path)
    assert check_tool_coverage.live_tools() == set()


def test_a_missing_source_file_exempts_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(check_tool_coverage, "REPO_ROOT", tmp_path)
    assert check_tool_coverage.live_tools() == set()


@pytest.mark.parametrize(
    "literal, expected",
    [
        ('LIVE_TOOLS: set[str] = {"a", "b"}', {"a", "b"}),
        ('LIVE_TOOLS = {"a", "b"}', {"a", "b"}),          # unannotated assignment
        ('LIVE_TOOLS = frozenset({"a"})', set()),          # a call, not a literal
        ('LIVE_TOOLS = ["a", "b"]', {"a", "b"}),           # list
        ('LIVE_TOOLS = ("a", 7)', {"a"}),                  # non-strings dropped
    ],
    ids=["annotated-set", "bare-set", "frozenset-call", "list", "mixed-types"],
)
def test_it_accepts_the_shapes_the_declaration_could_take(monkeypatch, tmp_path, literal, expected):
    """The other direction again: a reformat of the declaration must not silently
    empty the exemption. `frozenset(...)` is a call rather than a literal, so it
    yields nothing — documented here rather than discovered later."""
    (tmp_path / "eval/harness/harness").mkdir(parents=True)
    (tmp_path / "eval/harness/harness/mock_mcp.py").write_text(literal + "\n", encoding="utf-8")
    monkeypatch.setattr(check_tool_coverage, "REPO_ROOT", tmp_path)
    assert check_tool_coverage.live_tools() == expected


def test_main_actually_subtracts_the_live_set(capsys):
    """The helper being right is not the same as the forward check USING it.

    Deleting ` - LIVE` from `missing` left every test above green, because they all
    exercise `live_tools()` alone. This runs the real check over the real corpus and
    asserts the warning the subtraction removes stays removed. `research` declares
    `research_delivered` and `validate_research_schema`, both live and both
    fixture-less, so without the subtraction it warns.
    """
    check_tool_coverage.main()
    # ONE readouterr(): a second call returns an empty buffer, so `out + err` built
    # from two calls silently drops whichever stream the check actually used.
    captured = capsys.readouterr()
    out = captured.out + captured.err
    offending = [
        line for line in out.splitlines()
        if "no fixture for" in line and "skill `research` declares" in line
    ]
    assert not offending, (
        "a live tool was reported as an uncovered fixture gap:\n  " + "\n  ".join(offending)
    )


def test_the_check_still_reports_a_genuine_gap(capsys):
    """The other direction, and the one that matters most: the exemption must not have
    silenced the lint wholesale. `tree_forget` is declared by a skill, is not live, and
    has no fixture — it must still be named."""
    check_tool_coverage.main()
    out = capsys.readouterr().out
    assert "tree_forget" in out, "the forward check stopped reporting real gaps"


def test_the_derived_exemption_is_printed(capsys):
    """The module docstring promises the exemption list is printed every run "so it stays
    visible rather than silently swallowing a gap". Only `EXEMPT_TOOLS` was printed, and
    the derived set is now the larger of the two — the invisible one was the big one.

    Deleting the print block left every other test green."""
    check_tool_coverage.main()
    out = capsys.readouterr().out
    assert "derived from mock_mcp.LIVE_TOOLS" in out, "the derived exemptions are silent"
    assert "research_delivered" in out, "and must name what they cover"
