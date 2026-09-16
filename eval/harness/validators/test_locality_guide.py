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
  - test_survey_run_calls_both_collections_and_volume_search (VR4) — gating:
    a survey that called one Step-3 search must have called both. Gating became
    safe once every survey test declared a volume-search fixture (this PR): the
    tool is now in the model's toolset, so a one-sided survey is a real defect
    rather than a fixture gap (issue #1886).

    (A VR3 "digitization label requires a volume_search call" check was
    considered and dropped: SKILL.md Step 4 allows classifying from the
    FamilySearch Wiki when volume_search has no match, so the premise does not
    hold — a wiki-grounded label with no volume_search call is legitimate, not a
    defect.)

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import pytest

from validators_lib import bare_tool_name, written_entries

REQUIRED_WIKI_SECTIONS = {"home", "getting_started", "online_records", "research_tips"}

# jurisdictions[] / collections[] / pages_read[] item shapes mirror the closed
# schema at docs/specs/schemas/research.schema.json $defs.locality
# (additionalProperties: false). The top-level locality object is already closed
# at write time by checkAllowedKeys (validator.ts:1505); its NESTED items are
# deliberately not deep-checked there (validator.ts:1490-1492) — that is the hole
# VR1 closes.
JURISDICTION_ALLOWED_KEYS = {"name", "date_range"}
JURISDICTION_REQUIRED_KEYS = {"name"}
COLLECTION_ALLOWED_KEYS = {"id", "title", "date_range"}
COLLECTION_REQUIRED_KEYS = {"id", "title"}
PAGES_READ_ALLOWED_KEYS = {"section", "url", "found"}
PAGES_READ_REQUIRED_KEYS = {"section", "found"}


def _written_localities(before_state, after_state):
    """localities[] entries this run created or modified in place. The shared
    helper handles both (localities is updatable via research_append
    op:"update", so `include_modified` catches an in-place rewrite a new-id-only
    diff would skip); the top-level entry is always an object (validator.ts
    isObjectEntry rejects a non-object at write time), so no entry-level guard
    is needed here.
    """
    return written_entries(
        before_state, after_state, "localities", include_modified=True
    )


_ID_KEYS = {"id", "collectionId", "collection_id"}


def _harvest_id_values(obj, acc):
    """Collect the string form of every value stored under an id-bearing key
    anywhere in a tool response (collections_search collections[].id,
    volume_search rows, a record_search row's collectionId). Exact values, so a
    persisted id is matched against the whole field, never a numeric substring.
    """
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _ID_KEYS and isinstance(v, (str, int)):
                acc.add(str(v))
            _harvest_id_values(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _harvest_id_values(v, acc)


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
        _check_nested_items(
            loc.get("pages_read") or [], lid, "pages_read",
            PAGES_READ_ALLOWED_KEYS, PAGES_READ_REQUIRED_KEYS,
        )
        sections = {p.get("section") for p in (loc.get("pages_read") or [])}
        missing = REQUIRED_WIKI_SECTIONS - sections
        assert not missing, (
            f"localities[{lid}] pages_read is missing wiki sections {sorted(missing)} — "
            "must attempt all four (home / getting_started / online_records / research_tips)"
        )
        _check_nested_items(
            loc.get("jurisdictions") or [], lid, "jurisdictions",
            JURISDICTION_ALLOWED_KEYS, JURISDICTION_REQUIRED_KEYS,
        )
        _check_nested_items(
            loc.get("collections") or [], lid, "collections",
            COLLECTION_ALLOWED_KEYS, COLLECTION_REQUIRED_KEYS,
        )


def _check_nested_items(items, lid, kind, allowed_keys, required_keys):
    """Assert each nested jurisdictions/collections/pages_read item is an object
    whose keys are within `allowed_keys` (no stray) and include `required_keys`.
    A non-list container or a non-dict item is reported cleanly rather than
    crashing on iteration/`set()`/`.get` — the runtime schema validator does not
    type-check these nested items (validator.ts).
    """
    assert isinstance(items, list), (
        f"localities[{lid}] {kind} is not a list: {items!r}"
    )
    for item in items:
        assert isinstance(item, dict), (
            f"localities[{lid}] {kind} entry is not an object: {item!r}"
        )
        keys = set(item)
        stray = keys - allowed_keys
        assert not stray, (
            f"localities[{lid}] {kind} entry has stray keys {sorted(stray)} — "
            f"allowed keys are {sorted(allowed_keys)}"
        )
        missing_req = required_keys - keys
        assert not missing_req, (
            f"localities[{lid}] {kind} entry missing required keys {sorted(missing_req)}"
        )


def _collection_ids(loc):
    return {
        str(c.get("id"))
        for c in (loc.get("collections") or [])
        if isinstance(c, dict) and c.get("id") is not None
    }


def test_persisted_collection_ids_trace_to_tool_response(
    before_state, after_state, tool_calls
):
    """VR2 — every collection id a run newly writes onto a localities entry must
    match an id-VALUED field in some tool response this run returned: the id was
    grounded in a tool result the skill actually saw, not fabricated.

    Only ids NEW this run are checked — an id already on the same entry in
    `before_state` was grounded in an earlier run, so an `op:"update"` refresh
    that does not re-fetch collections is not re-demanded (which would false-fail
    a legitimate partial update).

    Grounding is an EXACT match against every value stored under an id-bearing
    key (`id` / `collectionId`) anywhere in the responses — not a substring or a
    digit-boundary search over the serialized text. A looser text match grounds a
    fabricated id against any coincidental number (a population count, a year in
    a date range), which is the exact false-pass an anti-fabrication gate must
    not have.

    Reads tc['response'] — the full fixture payload the mock served at validation
    time (mock_mcp.py:754; precedent test_search_wikipedia.py). NOTE: committed
    run logs STRIP these responses to empty, so this validator's verdict on a
    real run is observable only live, never replayed from a committed log
    (register gap #2479).
    """
    before = {
        e.get("id"): e
        for e in ((before_state or {}).get("research_json") or {}).get("localities") or []
        if isinstance(e, dict)
    }
    after = ((after_state or {}).get("research_json") or {}).get("localities") or []
    persisted = []
    for loc in after:
        if not isinstance(loc, dict):
            continue
        prior = before.get(loc.get("id"))
        prior_ids = _collection_ids(prior) if isinstance(prior, dict) else set()
        for cid in _collection_ids(loc) - prior_ids:
            persisted.append((loc.get("id"), cid))
    if not persisted:
        pytest.skip("no newly-persisted collection ids this run")
    grounded = set()
    for tc in (tool_calls or []):
        _harvest_id_values(tc.get("response"), grounded)
    for lid, cid in persisted:
        assert cid in grounded, (
            f"localities[{lid}] collection id {cid!r} matches no id-valued field "
            "in any tool response this run — a persisted collection id must trace "
            "to a tool result, not be fabricated"
        )


def test_survey_run_calls_both_collections_and_volume_search(tool_calls):
    """VR4 (gating) — a records-availability survey that called one of the Step-3
    searches must have called both: collections_search AND volume_search are both
    required Step-3 calls ('drop none', SKILL.md Step 3).

    A run that called neither search is not a records survey (standalone Q&A,
    wiki-only, or a decline) and is not flagged. Gating became safe once every
    survey test declared a volume-search fixture (this PR): before that the tool
    was absent from the model's toolset — it narrated "volume_search is not
    available in this environment" and moved on (35 of 35 runs), which was a
    fixture gap, not a skill choice. With the fixture present the model calls it,
    so a one-sided survey is now a real defect.

    Deliberately grades call PRESENCE, not the result: the skill *making* both
    calls is the behaviour under test. A `fixture_not_found` response means the
    skill called the tool but the eval corpus lacks a fixture (a test-corpus gap,
    not skill misbehaviour); in production the call always returns. Whether a
    persisted value is grounded in the result is VR2's job, not VR4's.
    """
    tools = {bare_tool_name(tc.get("tool")) for tc in (tool_calls or [])}
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
