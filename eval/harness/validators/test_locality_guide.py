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
  - test_persisted_localities_entry_shape (VR1) — presence-gated shape
    check on whatever entry the run wrote, closing the nested stray-key
    hole the schema leaves open (validator.ts:1490-1492).
  - test_persisted_collection_ids_trace_to_tool_response (VR2) — every
    persisted collection id must be grounded in a same-run tool response.
  - report_digitization_label_requires_volume_search (VR3) — non-gating
    observation: a closed digitization label should be backed by a
    volume_search call.
  - report_survey_run_calls_both_collections_and_volume_search (VR4) —
    non-gating observation: a survey that called one Step-3 search should
    have called both. Non-gating because the skill skips volume_search on
    survey runs today; gating it needs a SKILL.md change + fixtures + a
    paid run (deferred, issue #1886).

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import json

import pytest

REQUIRED_WIKI_SECTIONS = {"home", "getting_started", "online_records", "research_tips"}

# jurisdictions[] / collections[] item shapes mirror the closed schema at
# docs/specs/schemas/research.schema.json $defs.locality (additionalProperties:
# false). The top-level locality object is already closed at write time by
# checkAllowedKeys (validator.ts:1505); its NESTED items are deliberately not
# deep-checked there (validator.ts:1490-1492) — that is the hole VR1 closes.
JURISDICTION_ALLOWED_KEYS = {"name", "date_range"}
JURISDICTION_REQUIRED_KEYS = {"name"}
COLLECTION_ALLOWED_KEYS = {"id", "title", "date_range"}
COLLECTION_REQUIRED_KEYS = {"id", "title"}

# Closed digitization-level label set. Source of truth:
# packages/engine/plugin/skills/locality-guide/SKILL.md:119-122 (Step 4).
# Not co-located with references/output-format.md (only two of the four appear
# there), and nothing checks the two stay in sync.
DIGITIZATION_LABELS = (
    "indexed + images",
    "full-text searchable, not name-indexed",
    "browse-only images",
    "microfilm or physical only",
)


def _localities(state):
    research = (state or {}).get("research_json") or {}
    return research.get("localities") or []


def _new_localities(before_state, after_state):
    """localities[] entries present in after_state but not before_state, keyed
    by id. Validating only the entries THIS run wrote (rather than locs[-1])
    keeps a fixture-seeded pre-existing entry from being graded as the skill's
    output.
    """
    before_ids = {e.get("id") for e in _localities(before_state)}
    return [e for e in _localities(after_state) if e.get("id") not in before_ids]


def test_localities_persisted_with_full_page_coverage(after_state, test):
    """Tag-gated (`localities-persist`): when locality-guide runs inside a project it
    must persist a localities[] entry whose pages_read attempts all four wiki
    sections. Guards the '1-of-4 under-read' — a section that 404s is recorded
    found:false, but every section must appear.

    This is the ONLY validator that asserts persistence happened; VR1 below
    checks the SHAPE of a persisted entry but skips when nothing was written,
    so it cannot stand in for this. Do not fold the two together.
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
    """VR1 — presence-gated shape check on any localities[] entry this run wrote.

    On every run that persisted a NEW entry: source == 'locality-guide',
    pages_read covers all four wiki sections, and each nested jurisdictions[] /
    collections[] item has keys within the closed schema set with its required
    keys present (subset-plus-required — date_range is optional, so an exact-key
    test would reject legitimate output). Closes the nested stray-key hole the
    schema leaves at validator.ts:1490-1492; the top-level keys are already
    closed at write time.

    Skips when the run persisted no new entry (standalone Q&A / decline).
    Persistence itself is asserted only by the tag-gated test above, so a skill
    that stops persisting fails there, never silently here.
    """
    new_entries = _new_localities(before_state, after_state)
    if not new_entries:
        pytest.skip("no new localities entry persisted this run")
    for loc in new_entries:
        lid = loc.get("id")
        assert loc.get("source") == "locality-guide", (
            f"localities[{lid}] source should be 'locality-guide', got {loc.get('source')!r}"
        )
        sections = {p.get("section") for p in (loc.get("pages_read") or [])}
        missing = REQUIRED_WIKI_SECTIONS - sections
        assert not missing, (
            f"localities[{lid}] pages_read is missing wiki sections {sorted(missing)} — "
            "must attempt all four (home / getting_started / online_records / research_tips)"
        )
        for j in (loc.get("jurisdictions") or []):
            keys = set(j)
            stray = keys - JURISDICTION_ALLOWED_KEYS
            assert not stray, (
                f"localities[{lid}] jurisdictions entry has stray keys {sorted(stray)} — "
                f"allowed keys are {sorted(JURISDICTION_ALLOWED_KEYS)}"
            )
            missing_req = JURISDICTION_REQUIRED_KEYS - keys
            assert not missing_req, (
                f"localities[{lid}] jurisdictions entry missing required keys {sorted(missing_req)}"
            )
        for c in (loc.get("collections") or []):
            keys = set(c)
            stray = keys - COLLECTION_ALLOWED_KEYS
            assert not stray, (
                f"localities[{lid}] collections entry has stray keys {sorted(stray)} — "
                f"allowed keys are {sorted(COLLECTION_ALLOWED_KEYS)}"
            )
            missing_req = COLLECTION_REQUIRED_KEYS - keys
            assert not missing_req, (
                f"localities[{lid}] collections entry missing required keys {sorted(missing_req)}"
            )


def test_persisted_collection_ids_trace_to_tool_response(
    before_state, after_state, tool_calls
):
    """VR2 — every collection id in a newly-persisted localities entry must
    appear in some tool response this run returned: the id was grounded in
    something the skill actually saw, not fabricated.

    Traces against ALL same-run tool responses, not just
    collections_search/volume_search. compactStagedRecordSearch keeps
    collectionId on every row (staged-compaction.ts:72-85) and wiki_place_page
    can surface a collection id in its markdown, so a narrower scope would
    false-fail a legitimately grounded id. Matches ids by substring over the
    serialized responses, which catches an id wherever it appears (a JSON id
    field OR inline in wiki markdown) and biases a gating check toward the safe
    direction (a coincidental match passes; a real fabrication still fails).

    Reads tc['response'] — the full fixture payload the mock served at
    validation time (mock_mcp.py:742; precedent
    test_search_wikipedia.py:188-196). NOTE: committed run logs STRIP these
    responses to empty, so this validator's verdict on a real run is observable
    only live, never replayed from a committed log (register gap #2479).
    """
    new_entries = _new_localities(before_state, after_state)
    persisted = [
        (loc.get("id"), c.get("id"))
        for loc in new_entries
        for c in (loc.get("collections") or [])
        if c.get("id") is not None
    ]
    if not persisted:
        pytest.skip("no persisted collection ids this run")
    blob = json.dumps([tc.get("response") for tc in (tool_calls or [])], default=str)
    for lid, cid in persisted:
        assert str(cid) in blob, (
            f"localities[{lid}] collection id {cid!r} appears in no tool response "
            "this run — a persisted collection id must trace to a tool result, "
            "not be fabricated"
        )


def report_digitization_label_requires_volume_search(text_response, tool_calls):
    """VR3 (report_*, non-gating) — a closed digitization-level label in the
    narrative should be backed by a volume_search call: Step 4 derives the level
    from volume_search's recordSearchablePercent (SKILL.md:119-122).

    Non-gating on purpose. Across the five committed logs, 28 of 76 label-using
    runs made no volume_search call, and every such test is one of the nine that
    ship no volume-search fixture — the skill could not have called it. Gating
    this would fail those tests for a fixture gap; adding the fixtures and
    promoting this to test_* is deferred to VR4 (issue #1886).
    """
    text = (text_response or "").casefold()
    used = [lbl for lbl in DIGITIZATION_LABELS if lbl.casefold() in text]
    if not used:
        return
    called_volume_search = any(
        "volume_search" in (tc.get("tool") or "") for tc in (tool_calls or [])
    )
    assert called_volume_search, (
        f"output uses digitization label(s) {used} but made no volume_search call — "
        "the level must derive from volume_search (SKILL.md:119-122)"
    )


def report_survey_run_calls_both_collections_and_volume_search(tool_calls):
    """VR4 (report_*, non-gating) — a records-availability survey that called one
    of the Step-3 searches should have called both. collections_search AND
    volume_search are both required Step-3 calls ('drop none'). Observation only.

    A run that called neither search is not a records survey (standalone Q&A,
    wiki-only, or a decline) and is not flagged. Non-gating on purpose: the skill
    currently skips volume_search on survey runs (35 of 35 runs across the five
    committed logs for the seven single-search survey tests), so this is a
    skill-behavior gap a clean run would NOT pass today, not a validator to gate
    on. Promoting it to test_* is coupled to a SKILL.md change that makes the
    survey call both, plus per-place volume-search fixtures and a paid eval run —
    deferred, not done here (issue #1886).
    """
    tools = {(tc.get("tool") or "").split("__")[-1] for tc in (tool_calls or [])}
    called_cs = "collections_search" in tools
    called_vs = "volume_search" in tools
    if not (called_cs or called_vs):
        return  # not a records survey — nothing to require
    missing = [
        name
        for name, called in (("collections_search", called_cs), ("volume_search", called_vs))
        if not called
    ]
    assert not missing, (
        f"records survey called {sorted(tools & {'collections_search', 'volume_search'})} "
        f"but not {missing} — both are required Step-3 calls (SKILL.md Step 3, 'drop none')"
    )
