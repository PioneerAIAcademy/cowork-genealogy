"""Skill-specific validators for the locality-guide skill.

locality-guide consults the place_search, collections_search,
external_links_search, wiki, and wikipedia MCP tools and outputs the
locality research guide to the user. When invoked inside a research
project it ALSO persists one `localities` entry via research_append —
it owns the `localities` section in OWNERSHIP_TABLE. Standalone Q&A
(no research.json to write to) persists nothing. It never writes
tree.gedcomx.json — enforced by
`test_universal.py::test_tree_ownership_table` (locality-guide is
absent from TREE_OWNERSHIP_TABLE, so any tree write triggers a
violation).

All rubric dimensions for locality-guide (Jurisdiction accuracy,
Record availability, Research strategy) require reading the narrative
output for genealogical judgment, so they stay in `rubric.md` rather
than migrating to deterministic validators. This file exists to document
that fact and as a placeholder for future tag-gated regression checks.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` per
docs/plan/criteria-demotion-and-rubric-opt-in.md.
"""

from __future__ import annotations

import pytest

REQUIRED_WIKI_SECTIONS = {"home", "getting_started", "online_records", "research_tips"}


def test_localities_persisted_with_full_page_coverage(after_state, test):
    """Tag-gated (`localities-persist`): when locality-guide runs inside a project it
    must persist a localities[] entry whose pages_read attempts all four wiki
    sections. Guards the '1-of-4 under-read' — a section that 404s is recorded
    found:false, but every section must appear.
    """
    if "localities-persist" not in (test.get("tags") or []):
        pytest.skip("not a localities-persist test")
    research = after_state.get("research_json")
    if research is None:
        pytest.fail("no research.json in after_state")
    locs = research.get("localities") or []
    assert locs, "locality-guide should have persisted a localities[] entry"
    loc = locs[-1]
    assert loc.get("source") == "locality-guide", (
        f"localities source should be 'locality-guide', got {loc.get('source')!r}"
    )
    sections = {p.get("section") for p in (loc.get("pages_read") or [])}
    missing = REQUIRED_WIKI_SECTIONS - sections
    assert not missing, (
        f"pages_read is missing wiki sections {sorted(missing)} — locality-guide "
        "must attempt all four (home / getting_started / online_records / research_tips)"
    )
