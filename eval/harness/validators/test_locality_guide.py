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
  - test_digitization_label_requires_volume_search (VR3) — gating: a closed
    digitization label must be backed by a volume_search call.
  - test_survey_run_calls_both_collections_and_volume_search (VR4) — gating:
    a survey that called one Step-3 search must have called both. Gating became
    safe once every survey test declared a volume-search fixture (this PR): the
    tool is now in the model's toolset, so a one-sided survey is a real defect
    rather than a fixture gap (issue #1886).

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import json
import re

import pytest

from validators_lib import bare_tool_name, written_entries

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
        pages = loc.get("pages_read") or []
        assert all(isinstance(p, dict) for p in pages), (
            f"localities[{lid}] pages_read has a non-object item: {pages!r}"
        )
        sections = {p.get("section") for p in pages}
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
    """Assert each nested jurisdictions/collections item is an object whose keys
    are within `allowed_keys` (no stray) and include `required_keys`. A non-dict
    item is reported cleanly rather than crashing on set()/`.get` — the runtime
    schema validator does not type-check these nested items (validator.ts).
    """
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


def test_persisted_collection_ids_trace_to_tool_response(
    before_state, after_state, tool_calls
):
    """VR2 — every collection id in a newly-persisted localities entry must
    appear in some tool response this run returned: the id was grounded in
    something the skill actually saw, not fabricated.

    Traces against ALL same-run tool responses, not just
    collections_search/volume_search. compactStagedRecordSearch keeps
    collectionId on every row (staged-compaction.ts:72-85) and wiki_place_page
    can surface a collection id inside its markdown, so a narrower scope would
    false-fail a legitimately grounded id. Grounding is checked two ways: first
    an EXACT match against every id-valued field harvested from the responses
    (so a fabricated id that is a numeric substring of a longer real id — "196"
    inside "1999196" — is NOT accepted); then, for an id that appears only in
    prose, a digit-boundary search over the serialized responses (so a
    markdown-cited id still grounds while a digit-substring still does not). The
    residual is a fabricated id equal to a bare number bounded by non-digits
    (e.g. a 4-digit year in a date range) — negligible for multi-digit
    collection ids.

    Reads tc['response'] — the full fixture payload the mock served at
    validation time (mock_mcp.py:742; precedent
    test_search_wikipedia.py:188-196). NOTE: committed run logs STRIP these
    responses to empty, so this validator's verdict on a real run is observable
    only live, never replayed from a committed log (register gap #2479).
    """
    written = _written_localities(before_state, after_state)
    persisted = [
        (loc.get("id"), c.get("id"))
        for loc in written
        for c in (loc.get("collections") or [])
        if isinstance(c, dict) and c.get("id") is not None
    ]
    if not persisted:
        pytest.skip("no persisted collection ids this run")
    responses = [tc.get("response") for tc in (tool_calls or [])]
    grounded = set()
    for r in responses:
        _harvest_id_values(r, grounded)
    blob = json.dumps(responses, default=str)
    for lid, cid in persisted:
        cid = str(cid)
        traced = cid in grounded or bool(
            re.search(rf"(?<!\d){re.escape(cid)}(?!\d)", blob)
        )
        assert traced, (
            f"localities[{lid}] collection id {cid!r} appears in no tool response "
            "this run — a persisted collection id must trace to a tool result "
            "(an id-valued field or a text mention), not be fabricated"
        )


def test_digitization_label_requires_volume_search(text_response, tool_calls):
    """VR3 (gating) — a closed digitization-level label in the narrative must be
    backed by a volume_search call: Step 4 derives the level from volume_search's
    recordSearchablePercent (SKILL.md:119-122). A label without the call is an
    ungrounded classification.

    Gating became safe once every survey test declared a volume-search fixture
    (this PR): the tool is now in the model's toolset, so a run that uses a label
    without calling volume_search is a real defect, not a fixture gap. Runs that
    use no closed label make no claim to back and pass.
    """
    text = (text_response or "").casefold()
    used = [lbl for lbl in DIGITIZATION_LABELS if lbl in text]  # labels are lowercase
    if not used:
        return
    called_volume_search = any(
        bare_tool_name(tc.get("tool")) == "volume_search" for tc in (tool_calls or [])
    )
    assert called_volume_search, (
        f"output uses digitization label(s) {used} but made no volume_search call — "
        "the level must derive from volume_search (SKILL.md:119-122)"
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
