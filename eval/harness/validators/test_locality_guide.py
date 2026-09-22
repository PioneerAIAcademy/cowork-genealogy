"""Skill-specific validators for the locality-guide skill.

locality-guide consults the place_search, collections_search,
external_links_search, wiki, and wikipedia MCP tools and outputs the
locality research guide to the user. When invoked inside a research
project it ALSO persists one `localities` entry via research_append —
it owns the `localities` section in the ownership manifest. Standalone
Q&A (no research.json to write to) persists nothing. It never writes
tree.gedcomx.json — enforced by
`test_universal.py::test_tree_ownership_table` (locality-guide is on no
tree row, so any tree write triggers a violation).

The three rubric dimensions (Jurisdiction accuracy, Record availability,
Research strategy) require reading the narrative output for genealogical
judgment, so they stay in `rubric.md`. The deterministic checks below
guard the structural properties a validator can settle without judgment
(issue #1886, from the locality-guide deep dive #1664):

  - test_localities_persisted_with_full_page_coverage — tag-gated; the
    only assertion that a localities entry was persisted AT ALL.
  - test_persisted_localities_entry_shape (VR1) — presence-gated: on any
    run that wrote a localities entry, checks the two properties the shared
    schema validator does NOT cover — source == "locality-guide" and
    coverage of all four wiki sections. The nested key-sets
    (jurisdictions/collections/pages_read) are already enforced by
    `test_universal.py::test_research_json_validates_schema` against
    `research.schema.json` ($defs.locality, additionalProperties:false),
    so VR1 does not re-check them.
  - test_survey_run_calls_both_collections_and_volume_search (VR4) — gating:
    a records survey that called one Step-3 search must have called both.

Two checks the deep dive proposed were dropped after review (PR #2579):
  - VR2 (persisted collection id must trace to a tool response) — circular:
    `project_context` is live and re-emits persisted `collections[].id`, so a
    fabricated id, once written, is grounded by the next read-back. It also
    duplicated `test_research_plan`'s id-grounding and `provenance_report`.
  - VR3 (digitization label requires a volume_search call) — dropped as
    subsumed by VR4, and it would only ever false-fire. A wiki-grounded label
    is NOT a legitimate substitute for the call: SKILL.md:82 makes
    volume_search a required Step-3 call, and Step 4 derives every label from
    its result — even the "No match in volume_search" branch presupposes the
    call was made, with the wiki as a cross-check, not a substitute. VR4
    already gates "a survey must call volume_search". In the acceptance run
    (v1_2026-09-21_13-46-57) every survey with volume_search available called
    it (VR4: 22 passed, 0 survey skipped it). The one run that assigns a
    digitization label without a volume_search call is ut_002, whose fixtures
    don't register volume_search (fixture-backed, absent from LIVE_TOOLS) so the
    tool was uncallable — exactly where VR3 would fire wrongly. (ut_023 makes no
    such classification at all: with the search tools unregistered it reports
    the coverage gap plainly rather than labelling.)

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import pytest

from validators_lib import bare_tool_name, new_section_entries

REQUIRED_WIKI_SECTIONS = {"home", "getting_started", "online_records", "research_tips"}


def _written_localities(before_state, after_state):
    """localities[] entries this run created or modified in place.
    `include_modified=True` so an in-place rewrite (research_append op:"update")
    is re-checked, not skipped as a new-id-only diff would. The top-level entry
    is always an object (validator.ts `isObjectEntry` rejects a non-object at
    write time), so no entry-level guard is needed here.
    """
    return new_section_entries(
        before_state, after_state, "localities", include_modified=True
    )


def test_localities_persisted_with_full_page_coverage(after_state, test):
    """Tag-gated (`localities-persist`): when locality-guide runs inside a project it
    must persist a localities[] entry whose pages_read attempts all four wiki
    sections. Guards the '1-of-4 under-read' — a section that 404s is recorded
    found:false, but every section must appear.

    This is the ONLY validator that asserts persistence happened; VR1 below
    checks a persisted entry but skips when nothing was written, so it cannot
    stand in for this. Do not fold the two together.
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


def test_persisted_localities_entry_shape(before_state, after_state):
    """VR1 — presence-gated check on any localities[] entry this run wrote,
    covering the two properties the shared schema validator does not:

      1. source == "locality-guide"
      2. pages_read attempts all four wiki sections.

    The nested key-sets (jurisdictions/collections/pages_read) are enforced by
    `test_universal.py::test_research_json_validates_schema` against
    `research.schema.json` ($defs.locality, additionalProperties:false + required
    keys), so VR1 does not duplicate them. Presence-gated rather than tag-gated:
    the ~20 `empty-project-just-created` survey tests carry that scenario
    without the `localities-persist` tag, so on any that DO persist this catches
    source/section defects the tag-gated test above never sees. (How many
    persist is a separate, currently-low number — 2 of 26 in v1_2026-09-21_13-46-57;
    that population question is tracked on #1886, not asserted here.)

    Skips when the run wrote no entry (standalone Q&A / decline). Persistence
    itself is asserted only by the tag-gated test above, so a skill that stops
    persisting fails there, never silently here.
    """
    written = _written_localities(before_state, after_state)
    if not written:
        pytest.skip("no localities entry created or modified this run")
    for loc in written:
        lid = loc.get("id")
        assert loc.get("source") == "locality-guide", (
            f"localities[{lid}] source should be 'locality-guide', got {loc.get('source')!r}"
        )
        sections = {p.get("section") for p in (loc.get("pages_read") or []) if isinstance(p, dict)}
        missing = REQUIRED_WIKI_SECTIONS - sections
        assert not missing, (
            f"localities[{lid}] pages_read is missing wiki sections {sorted(missing)} — "
            "must attempt all four (home / getting_started / online_records / research_tips)"
        )


def test_survey_run_calls_both_collections_and_volume_search(tool_calls):
    """VR4 (gating) — a records-availability survey that called one of the Step-3
    searches must have called both: collections_search and volume_search are both
    required Step-3 calls (SKILL.md Step 3, "do not drop any call").

    Grades call PRESENCE, not the result: the skill *making* both calls is the
    behaviour under test. A `fixture_not_found` response means the skill DID call
    a *registered* tool with args no fixture matched (a test-corpus gap, not
    skill misbehaviour); in production the call always returns. That is distinct
    from a tool with NO fixture at all: collections_search and volume_search are
    fixture-backed and absent from LIVE_TOOLS, so a test that declares no fixture
    for one never registers it and the skill cannot call it — which is why ut_002
    (no volume_search fixture) shows up as a one-search run, not a
    `fixture_not_found`. Grounding of a result is not this validator's concern.

    LIMIT (documented, not a bug): a run that called NEITHER search is skipped —
    it cannot be distinguished from a legitimate non-survey (standalone Q&A, a
    wiki-only guide, or a decline). `ut_locality_guide_023` is exactly such a
    deliberate no-collection-tool test (its judge_context forbids naming a
    collection), so VR4 correctly stands down there; `ut_002` is a plain records
    survey that stands down only because its fixture list omits the searches.
    Catching "a survey that should have called both but called neither" would
    need an intent signal (e.g. the `volume-search` tag already on 12 tests, none
    of them the seven rewired here) VR4 does not yet consult — a deliberate
    choice, tracked on #1886, not an absence.
    """
    tools = {bare_tool_name(tc.get("tool")) for tc in (tool_calls or [])}
    called_cs = "collections_search" in tools
    called_vs = "volume_search" in tools
    if not (called_cs or called_vs):
        pytest.skip("not a records survey — called neither collections_search nor volume_search")
    missing = [
        name
        for name, called in (("collections_search", called_cs), ("volume_search", called_vs))
        if not called
    ]
    assert not missing, (
        f"records survey called {sorted(tools & {'collections_search', 'volume_search'})} "
        f"but not {missing} — both are required Step-3 calls (SKILL.md Step 3)"
    )
