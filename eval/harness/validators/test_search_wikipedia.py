"""Skill-specific validators for the search-wikipedia skill.

search-wikipedia has no `rubric.md` (deleted in the criteria-demotion
rollout). All mechanical
checks live here; narrative judgment lands on the base Correctness +
Completeness dimensions in the LLM judge.

See test_universal.py module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_only_wikipedia_search_called(tool_calls, test):
    """Positive search-wikipedia tests must call wikipedia_search and nothing
    else. Negative tests should not call wikipedia_search at all — but
    activation/routing is graded by the negative-test outcome logic in
    orchestrator._compute_outcome, so we only enforce the positive case
    here."""
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    bad = [
        tc["tool"] for tc in mcp_calls
        if "wikipedia_search" not in tc.get("tool", "")
    ]
    assert not bad, (
        f"search-wikipedia positive tests must only call wikipedia_search; also called: {bad}"
    )


def test_wikipedia_search_called_exactly_once(tool_calls, test):
    """Positive search-wikipedia tests should issue exactly one wikipedia_search
    call. Multiple calls signal query-refinement loops that the SKILL.md
    doesn't authorize (and inflate cost)."""
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    wiki_calls = [
        tc for tc in tool_calls
        if "wikipedia_search" in tc.get("tool", "")
    ]
    assert len(wiki_calls) == 1, (
        f"expected exactly 1 wikipedia_search call; got {len(wiki_calls)}"
    )


# --- File-write enforcement -------------------------------------------

def _files_created(before_state, after_state) -> list[str]:
    before = set((before_state.get("files") or {}).keys())
    after = set((after_state.get("files") or {}).keys())
    return sorted(after - before)


def test_wrote_one_markdown_file(before_state, after_state, test):
    """Positive tests must produce exactly one .md file in the working
    folder. The SKILL.md template names a single file derived from the
    article title — zero means the skill skipped the save step, more
    than one means it wrote extra noise."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests write files")
    new = _files_created(before_state, after_state)
    md = [p for p in new if p.endswith(".md")]
    assert len(md) == 1, f"expected exactly one new .md file; got {md}"


# --- Slug-normalization regression checks (tag-gated) -----------------

def _new_md_basenames(before_state, after_state) -> list[str]:
    new = _files_created(before_state, after_state)
    return [p.split("/")[-1] for p in new if p.endswith(".md")]


def test_slug_albert_einstein(before_state, after_state, test):
    if "slug-albert-einstein" not in test.get("tags", []):
        pytest.skip("not a slug-albert-einstein scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "albert-einstein.md" in names, (
        f"expected 'albert-einstein.md'; got {names}"
    )


def test_slug_schuylkill_county_pennsylvania(before_state, after_state, test):
    if "slug-schuylkill-county-pennsylvania" not in test.get("tags", []):
        pytest.skip("not a slug-schuylkill-county-pennsylvania scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "schuylkill-county-pennsylvania.md" in names, (
        f"expected 'schuylkill-county-pennsylvania.md'; got {names}"
    )


def test_slug_great_famine_ireland(before_state, after_state, test):
    if "slug-great-famine-ireland" not in test.get("tags", []):
        pytest.skip("not a slug-great-famine-ireland scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "great-famine-ireland.md" in names, (
        f"expected 'great-famine-ireland.md'; got {names}"
    )


def test_slug_obrien_surname(before_state, after_state, test):
    if "slug-obrien-surname" not in test.get("tags", []):
        pytest.skip("not a slug-obrien-surname scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "o-brien-surname.md" in names, (
        f"expected 'o-brien-surname.md' (apostrophe → hyphen, "
        f"' (surname)' → '-surname'); got {names}"
    )
