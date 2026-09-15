"""Direct tests for the locality-guide validators added by deep dive #1664 (issue #1886).

Same reason as `test_person_evidence_validators.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Each check is exercised three ways: a state that must FIRE it, a legitimate
variant it must ACCEPT (the other direction — a guard that only ever fires is
as broken as one that never does), and the precondition under which it must
STAND DOWN rather than fire.

Populations measured over the 5 committed run logs (VR2 is not offline-
reproducible — committed logs strip tool responses to empty — so its numbers
come from grounding persisted ids to fixture files):
  - VR1: 12 persister tests / 19 entries / 0 violations (a regression guard).
  - VR2: 58 persisted collection ids, all grounded.
  - VR4: 7 survey tests declared no volume-search fixture; with one added the
    model calls volume_search (a VR3 label-check was considered and dropped —
    a wiki-grounded digitization label is legitimate per SKILL.md Step 4).
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_`/`report_` prefixes on purpose: pytest would
# otherwise collect the imported validators as tests of this module and error on
# their harness-supplied fixtures. Same pattern as test_person_evidence_validators.py.
from test_locality_guide import (  # noqa: E402
    test_persisted_collection_ids_trace_to_tool_response as check_ids,
    test_persisted_localities_entry_shape as check_shape,
    test_survey_run_calls_both_collections_and_volume_search as check_both_searches,
)


# --- helpers ------------------------------------------------------------


def _state(localities):
    return {
        "research_json": {"localities": localities} if localities is not None else {},
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


def _entry(
    *,
    lid="loc_001",
    source="locality-guide",
    sections=("home", "getting_started", "online_records", "research_tips"),
    jurisdictions=None,
    collections=None,
):
    return {
        "id": lid,
        "place": "Pennsylvania, United States",
        "source": source,
        "created": "2026-09-15T00:00:00Z",
        "pages_read": [{"section": s, "found": True} for s in sections],
        "jurisdictions": jurisdictions if jurisdictions is not None else [
            {"name": "Schuylkill, Pennsylvania, United States", "date_range": "1811-"}
        ],
        "collections": collections if collections is not None else [
            {"id": "1999196", "title": "Pennsylvania, Probate Records, 1683-1994",
             "date_range": "1683-1994"}
        ],
    }


def _call(tool, response=None, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "response": response or {}}


# --- VR1: test_persisted_localities_entry_shape -------------------------


def test_shape_passes_on_a_valid_new_entry():
    check_shape(_state([]), _state([_entry()]))


def test_shape_accepts_jurisdiction_and_collection_without_date_range():
    """The other direction: date_range is optional in the schema, so a
    jurisdiction with only {name} and a collection with only {id,title} are
    legitimate and must NOT fire (subset-plus-required, not exact-key-set)."""
    check_shape(
        _state([]),
        _state([_entry(
            jurisdictions=[{"name": "Schuylkill, Pennsylvania, United States"}],
            collections=[{"id": "1999196", "title": "Pennsylvania, Probate Records"}],
        )]),
    )


def test_shape_fires_on_stray_jurisdiction_key():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(
            jurisdictions=[{"name": "Schuylkill", "county": "Schuylkill"}],
        )]))
    assert "stray keys" in str(exc.value)
    assert "county" in str(exc.value)


def test_shape_fires_on_stray_collection_key():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(
            collections=[{"id": "1999196", "title": "PA Probate", "url": "http://x"}],
        )]))
    assert "stray keys" in str(exc.value)
    assert "url" in str(exc.value)


def test_shape_fires_on_collection_missing_title():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(
            collections=[{"id": "1999196"}],
        )]))
    assert "missing required keys" in str(exc.value)
    assert "title" in str(exc.value)


def test_shape_fires_on_missing_wiki_section():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(
            sections=("home", "getting_started", "online_records"),
        )]))
    assert "missing wiki sections" in str(exc.value)
    assert "research_tips" in str(exc.value)


def test_shape_fires_on_wrong_source():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(source="research-plan")]))
    assert "source" in str(exc.value)


def test_shape_stands_down_when_no_new_entry():
    with pytest.raises(pytest.skip.Exception):
        check_shape(_state([]), _state([]))


def test_shape_ignores_a_pre_existing_seed_entry():
    """A fixture-seeded entry the skill never wrote must not be graded. An
    INVALID seed present in both before and after (no new entry) must SKIP, not
    fire — this is the trap of targeting locs[-1] instead of the before/after
    diff (plan-critic finding 3)."""
    bad_seed = _entry(lid="loc_seed", jurisdictions=[{"name": "X", "bogus": 1}])
    with pytest.raises(pytest.skip.Exception):
        check_shape(_state([bad_seed]), _state([bad_seed]))


def test_shape_validates_only_the_new_entry_alongside_a_bad_seed():
    """A bad seed in before + a valid NEW entry in after → passes (the seed is
    out of scope, the new entry is clean)."""
    bad_seed = _entry(lid="loc_seed", collections=[{"id": "1", "title": "t", "junk": 9}])
    new_ok = _entry(lid="loc_new")
    check_shape(_state([bad_seed]), _state([bad_seed, new_ok]))


def test_shape_fires_on_an_in_place_update_of_an_existing_entry():
    """An entry rewritten in place (same id) with a bad nested key must be
    caught — the modified case a new-id-only diff would skip (review finding).
    A `skip` here is a FAILURE, not a pass: reverting the fix makes the diff
    return nothing, and a plain `pytest.raises` would let that skip read green.
    """
    good = _entry(lid="loc_001")
    modified = _entry(lid="loc_001", jurisdictions=[{"name": "X", "county": "Y"}])
    try:
        check_shape(_state([good]), _state([modified]))
    except AssertionError as exc:
        assert "stray keys" in str(exc) and "county" in str(exc)
    except pytest.skip.Exception:
        pytest.fail("VR1 skipped a modified same-id entry instead of validating it")
    else:
        pytest.fail("VR1 did not fire on a modified same-id entry")


def test_shape_reports_a_null_nested_item_cleanly_not_as_a_crash():
    """A null jurisdictions item (which passes write-validation — validator.ts
    does not type-check nested items) must raise a clean AssertionError, not a
    TypeError from set(None) (review finding)."""
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(jurisdictions=[None])]))
    assert "not an object" in str(exc.value)


def test_shape_reports_a_string_collection_item_cleanly_not_as_a_crash():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(collections=["1999196"])]))
    assert "not an object" in str(exc.value)


# --- VR2: test_persisted_collection_ids_trace_to_tool_response ----------


def test_ids_passes_when_id_in_a_collections_search_response():
    calls = [_call("collections_search", response={
        "collections": [{"id": "1999196", "title": "PA Probate"}]
    })]
    check_ids(_state([]), _state([_entry()]), calls)


def test_ids_passes_when_id_only_in_a_wiki_place_page_markdown():
    """All-responses scope: a collection id the skill lifted from wiki_place_page
    markdown is grounded and must NOT fire, even though no collections_search
    returned it (the reason VR2 traces every tool, not just the search tools)."""
    calls = [_call("wiki_place_page", response={
        "markdown": "Probate records are in FamilySearch Collection 1999196."
    })]
    check_ids(_state([]), _state([_entry()]), calls)


def test_ids_passes_when_id_in_record_search_collectionId():
    """compactStagedRecordSearch keeps collectionId on every row."""
    calls = [_call("record_search", response={
        "results": [{"collectionId": "1999196", "title": "A record"}]
    })]
    check_ids(_state([]), _state([_entry()]), calls)


def test_ids_fires_when_persisted_id_is_only_a_substring_of_a_longer_real_id():
    """A fabricated short id that is a numeric substring of a longer legit id in
    a response must NOT be accepted as grounded — the exact/id-field + digit-
    boundary trace closes the raw-substring false-negative (review finding)."""
    calls = [_call("collections_search", response={
        "collections": [{"id": "1999196", "title": "PA Probate"}]
    })]
    with pytest.raises(AssertionError) as exc:
        check_ids(_state([]), _state([_entry(
            collections=[{"id": "196", "title": "fabricated"}],
        )]), calls)
    assert "196" in str(exc.value)


def test_ids_exact_field_match_does_not_depend_on_prose():
    """A structured id-field value grounds even when the serialized text has no
    other mention — exact harvest, not substring."""
    calls = [_call("volume_search", response={
        "results": [{"collectionId": "1999196"}]
    })]
    check_ids(_state([]), _state([_entry()]), calls)


def test_ids_fires_when_id_appears_in_no_response():
    calls = [_call("collections_search", response={
        "collections": [{"id": "0000000", "title": "Something else"}]
    })]
    with pytest.raises(AssertionError) as exc:
        check_ids(_state([]), _state([_entry()]), calls)
    assert "1999196" in str(exc.value)
    assert "no tool response" in str(exc.value)


def test_ids_stands_down_when_no_new_collection_ids():
    with pytest.raises(pytest.skip.Exception):
        check_ids(_state([]), _state([_entry(collections=[])]), [])


def test_ids_ignores_a_pre_existing_seed_id():
    """A collection id on a seed entry the skill never wrote is out of scope —
    even if it traces to nothing, the run must SKIP (before/after diff)."""
    seed = _entry(lid="loc_seed", collections=[{"id": "5555555", "title": "seed"}])
    with pytest.raises(pytest.skip.Exception):
        check_ids(_state([seed]), _state([seed]), [])


# --- VR4: test_survey_run_calls_both_collections_and_volume_search ------


def test_both_searches_fires_when_only_collections_search_called():
    """The observed 35/35 gap shape: a survey calls collections_search but not
    volume_search."""
    with pytest.raises(AssertionError) as exc:
        check_both_searches([_call("collections_search"), _call("wiki_place_page")])
    assert "volume_search" in str(exc.value)


def test_both_searches_fires_when_only_volume_search_called():
    with pytest.raises(AssertionError) as exc:
        check_both_searches([_call("volume_search")])
    assert "collections_search" in str(exc.value)


def test_both_searches_passes_when_both_called():
    check_both_searches([_call("collections_search"), _call("volume_search")])


def test_both_searches_stands_down_when_neither_called():
    """A run that searched neither is not a records survey (Q&A / wiki-only /
    decline) — ut_002 (Ireland) and ut_023 (Vermont) call neither in all five
    committed logs — so VR4 must not fire."""
    check_both_searches([_call("wiki_place_page"), _call("place_search")])
