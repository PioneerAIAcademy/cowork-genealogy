"""Tests for harness.fixtures — manifest building and predicate matching."""

import json
from pathlib import Path

import pytest

from harness.fixtures import (
    InvalidFixtureError,
    build_manifest,
    load_fixtures,
    matches,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURE_DIR = REPO_ROOT / "eval/fixtures/mcp"


# --- matches() ------------------------------------------------------------


def test_matches_no_predicate_keys():
    # Empty predicate: trivially matches anything.
    assert matches({}, {"any": "args"})


def test_matches_top_level_key():
    assert matches({"args.q": "Ohio"}, {"q": "Ohio"})
    assert not matches({"args.q": "Ohio"}, {"q": "Texas"})


def test_matches_missing_key():
    assert not matches({"args.q": "Ohio"}, {})
    assert not matches({"args.q": "Ohio"}, {"other": "value"})


def test_matches_nested_path():
    assert matches({"args.payload.id": 42}, {"payload": {"id": 42}})
    assert not matches({"args.payload.id": 42}, {"payload": {"id": 43}})


def test_matches_substring_with_tilde_prefix():
    assert matches({"args.q": "~Ohio"}, {"q": "Cincinnati, Ohio"})
    # Case-insensitive
    assert matches({"args.q": "~OHIO"}, {"q": "cincinnati, ohio"})
    assert not matches({"args.q": "~Iowa"}, {"q": "Cincinnati, Ohio"})


def test_matches_multi_key_all_must_match():
    pred = {"args.q": "Ohio", "args.year": 1860}
    assert matches(pred, {"q": "Ohio", "year": 1860})
    assert not matches(pred, {"q": "Ohio", "year": 1850})
    assert not matches(pred, {"q": "Texas", "year": 1860})


def test_matches_handles_args_prefix_correctly():
    # The dotted path may or may not start with "args." — spec strips it.
    assert matches({"q": "Ohio"}, {"q": "Ohio"})
    assert matches({"args.q": "Ohio"}, {"q": "Ohio"})


def test_matches_non_dict_intermediate_returns_false():
    # args.foo.bar against args = {foo: "string"} should fail gracefully.
    assert not matches({"args.foo.bar": 1}, {"foo": "scalar"})


# --- build_manifest() -----------------------------------------------------


def test_build_manifest_groups_by_tool():
    fixtures = [
        {"tool": "wikipedia_search", "args": {"query": "A"}, "response": {"title": "A"}},
        {"tool": "wikipedia_search", "args": {"query": "B"}, "response": {"title": "B"}},
        {"tool": "place_search", "args": {"query": "X"}, "response": {"results": []}},
    ]
    m = build_manifest(fixtures)
    assert set(m.keys()) == {"wikipedia_search", "place_search"}
    assert len(m["wikipedia_search"]["predicated"]) == 2
    assert len(m["place_search"]["predicated"]) == 1


def test_build_manifest_carries_args_into_predicated_bucket():
    fixtures = [
        {"tool": "record_search", "args": {"args.q": "Ohio"}, "response": {"hits": 1}},
        {"tool": "record_search", "args": {"args.q": "Iowa"}, "response": {"hits": 2}},
    ]
    m = build_manifest(fixtures)
    assert len(m["record_search"]["predicated"]) == 2
    assert m["record_search"]["predicated"][0][0] == {"args.q": "Ohio"}


def test_build_manifest_rejects_fixture_without_tool():
    with pytest.raises(InvalidFixtureError):
        build_manifest([{"response": {}, "args": {"x": 1}}])


def test_build_manifest_rejects_fixture_without_response():
    with pytest.raises(InvalidFixtureError):
        build_manifest([{"tool": "x", "args": {"y": 1}}])


def test_build_manifest_rejects_fixture_without_args():
    with pytest.raises(InvalidFixtureError):
        build_manifest([{"tool": "x", "response": {}}])


def test_build_manifest_rejects_fixture_with_empty_args():
    with pytest.raises(InvalidFixtureError):
        build_manifest([{"tool": "x", "args": {}, "response": {}}])


# --- load_fixtures() ------------------------------------------------------


def test_load_real_seed_fixture():
    fixtures = load_fixtures(["wikipedia-search-schuylkill-county"], FIXTURE_DIR)
    assert len(fixtures) == 1
    assert fixtures[0]["tool"] == "wikipedia_search"
    assert "extract" in fixtures[0]["response"]


def test_load_missing_fixture_raises():
    with pytest.raises(InvalidFixtureError):
        load_fixtures(["does-not-exist"], FIXTURE_DIR)


def test_load_multiple_fixtures_preserves_order():
    fixtures = load_fixtures(
        ["wikipedia-search-schuylkill-county", "place-search-schuylkill-county"], FIXTURE_DIR
    )
    assert fixtures[0]["tool"] == "wikipedia_search"
    assert fixtures[1]["tool"] == "place_search"

# --- person_read fixtures vs. the shipped tool's output contract ----------
#
# A fixture is the only description of a tool most of the corpus ever sees, so a
# fixture that disagrees with the tool teaches the skill a contract production
# does not honor -- and the disagreement is invisible, because every downstream
# check reads the fixture too. `person-read-flynn.json` returned a bare person
# object (`{id, gender, names, facts}`) as its whole response for eight of
# init-project's twelve tests: `relatives: true` was unfalsifiable (the payload
# was identical with and without it) and the relationship-import rules had never
# run once across five committed runs.
#
# Scoped to `person_read` because that tool's output shape is pinned by
# `docs/specs/person-read-tool-spec.md` and by `shapePersons`/
# `shapeRelationships`/`shapeSources`, which always assemble those three keys.

_PERSON_READ_TOP_LEVEL = {"persons", "relationships", "sources"}


def _person_read_fixtures():
    """Every fixture on disk whose `tool` is person_read, as (name, parsed)."""
    out = []
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("tool") == "person_read":
            out.append((path.name, data))
    return out


def test_person_read_fixtures_declared():
    """Guards the two checks below against silently passing on an empty sweep --
    a glob that matches nothing is the failure mode a lint cannot report."""
    assert _person_read_fixtures(), (
        f"no person_read fixtures found under {FIXTURE_DIR}; the two contract "
        f"checks below would pass vacuously"
    )


def test_person_read_fixtures_match_the_tool_contract():
    """`person_read`'s response top level is always persons/relationships/sources.

    Per `person-read-tool-spec.md` ("The top-level shape is always ...") and the
    implementation, which returns exactly those three keys on every input. A
    fixture shaped otherwise cannot exercise either flag.
    """
    wrong = []
    for name, data in _person_read_fixtures():
        response = data.get("response")
        if not isinstance(response, dict):
            wrong.append(f"{name}: response is {type(response).__name__}, not an object")
            continue
        keys = set(response)
        if keys != _PERSON_READ_TOP_LEVEL:
            wrong.append(f"{name}: top-level keys {sorted(keys)}")
        elif not isinstance(response["persons"], list):
            wrong.append(f"{name}: persons is not a list")
    assert not wrong, (
        "person_read fixtures must return {persons, relationships, sources} -- "
        "the shape the tool always returns: " + "; ".join(wrong)
    )


def test_person_read_fixture_facts_carry_both_standardized_sidecars():
    """A dated fact from `person_read` carries `standard_date`; a placed one
    carries `standard_place`.

    `simplifyFact` emits `standard_date` for every fact whose date parses, and
    `toSimplifiedStandardized` fills `standard_place`. A fixture that omits
    either teaches the skill to invent the value -- which is exactly what
    init-project did with `standard_place` in 28 of 28 runs, copying the fact's
    free-text `place` and never calling `place_search`.

    `standard_place` is best-effort (the resolver can fail and leave it empty),
    so it is required only where the fixture itself supplies a `place`; a
    fixture that deliberately models a resolver miss should drop `place` too, or
    this check needs an opt-out marker rather than a silent exception.
    """
    missing = []
    for name, data in _person_read_fixtures():
        response = data.get("response")
        if not isinstance(response, dict):
            continue
        facts = []
        for person in response.get("persons") or []:
            facts += [(person.get("id"), f) for f in person.get("facts") or []]
        for rel in response.get("relationships") or []:
            facts += [(rel.get("type"), f) for f in rel.get("facts") or []]
        for owner, fact in facts:
            if fact.get("date") and not fact.get("standard_date"):
                missing.append(f"{name}: {owner} {fact.get('type')} has date, no standard_date")
            if fact.get("place") and not fact.get("standard_place"):
                missing.append(f"{name}: {owner} {fact.get('type')} has place, no standard_place")
    assert not missing, (
        "person_read returns a standardized sidecar beside each raw date/place; "
        "a fixture without one cannot show whether the skill kept it or invented "
        "it: " + "; ".join(missing)
    )
