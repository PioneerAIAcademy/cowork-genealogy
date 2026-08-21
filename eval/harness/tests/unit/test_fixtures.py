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


def sidecar_problems(name, data):
    """Every sidecar problem in one fixture, as messages.

    Extracted from the check below so the exemption logic is unit-testable on
    synthetic input -- the check itself reads the fixture directory, so without
    this the only way to exercise an exemption was to hand-edit a real fixture
    and watch what happened.
    """
    problems = []
    response = data.get("response")
    if not isinstance(response, dict):
        return problems
    exemptions = data.get("_contract_exempt") or {}
    if not isinstance(exemptions, dict):
        problems.append(
            f"{name}: _contract_exempt must be an object keyed 'owner/FactType'"
        )
        exemptions = {}
    if exemptions and not data.get("_contract_exempt_reason"):
        problems.append(
            f"{name}: exempts {sorted(exemptions)} but the fixture states no "
            f"_contract_exempt_reason"
        )
    facts = []
    for person in response.get("persons") or []:
        facts += [(person.get("id"), f) for f in person.get("facts") or []]
    for rel in response.get("relationships") or []:
        facts += [(rel.get("type"), f) for f in rel.get("facts") or []]
    for owner, fact in facts:
        exempt = exemptions.get(f"{owner}/{fact.get('type')}") or []
        if not isinstance(exempt, list):
            problems.append(
                f"{name}: _contract_exempt['{owner}/{fact.get('type')}'] must be a list"
            )
            exempt = []
        for raw, sidecar in (("date", "standard_date"), ("place", "standard_place")):
            if fact.get(raw) and not fact.get(sidecar) and sidecar not in exempt:
                problems.append(
                    f"{name}: {owner} {fact.get('type')} has {raw}, no {sidecar}"
                )
    return problems


def test_person_read_fixture_facts_carry_both_standardized_sidecars():
    """A dated fact from `person_read` carries `standard_date`; a placed one
    carries `standard_place`.

    `simplifyFact` emits `standard_date` for every fact whose date parses, and
    `toSimplifiedStandardized` fills `standard_place`. A fixture that omits
    either teaches the skill to invent the value -- which is exactly what
    init-project did with `standard_place` in 28 of 28 runs, copying the fact's
    free-text `place` and never calling `place_search`.

    `standard_place` is best-effort -- the place resolver can fail and leave it
    empty -- and `SKILL.md` carries a rule for exactly that case ("any returned
    fact with a `place` but no `standard_place`: resolve with `place_search`").
    Without an escape hatch this check would forbid any fixture from modelling a
    resolver miss, which would make that rule permanently untestable: the same
    defect the whole dive is about, reintroduced by its own lint.

    So a fixture may opt a fact out with a fixture-level `"_contract_exempt"`
    map, keyed `"owner/FactType"`, plus a `"_contract_exempt_reason"` saying why.
    Still per-fact, still explicit, still greppable, still carries the reason:

        "_contract_exempt": { "LZNY-BRF/Birth": ["standard_place"] },
        "_contract_exempt_reason": "models a resolver miss",
        "response": { ... }

    **The marker lives beside `response`, never inside it.** The mock serves
    `response` verbatim, so a marker on the fact itself would be handed to the
    skill as a field `person_read` never returns — and `TREE_FACT_FIELDS` rejects
    it, so the `project_create` write would fail for a reason unrelated to what
    the test is checking. The first draft put it inside the fact and would have
    reintroduced this lint's own defect the first time anyone used it. The owner
    key is the person id for a person fact and the relationship type for a
    relationship fact (`Couple/Marriage`), matching `_returned_person_facts`.

    No fixture uses it yet. It exists so the resolver-miss branch of the body can
    be given a test without first having to argue with this check -- and that
    test is the natural next step, deferred here only because adding a fixture to
    a test edits a snapshot-tracked file and would invalidate the run log this PR
    bought.
    """
    missing = []
    for name, data in _person_read_fixtures():
        missing += sidecar_problems(name, data)
    assert not missing, (
        "person_read returns a standardized sidecar beside each raw date/place; "
        "a fixture without one cannot show whether the skill kept it or invented "
        "it: " + "; ".join(missing)
    )


# --- the _contract_exempt map, on synthetic fixtures ----------------------
#
# Round 2 of review caught the first draft reading the marker from inside the
# fact. The mock serves `response` verbatim, so that shape handed the skill a
# field `person_read` never returns, which `TREE_FACT_FIELDS` then rejects --
# the write would have failed for a reason unrelated to what the test checks.
# These pin the marker at fixture level, and pin that the inside-the-fact shape
# no longer suppresses anything.

_PLACED_FACT = {"type": "Birth", "place": "Boston"}


def _fixture(facts=None, relationships=None, **top):
    data = {
        "tool": "person_read",
        "args": {"personId": "X"},
        "response": {
            "persons": [{"id": "LZNY-BRF", "facts": facts or []}],
            "relationships": relationships or [],
            "sources": [],
        },
    }
    data.update(top)
    return data


def _problems(data):
    return sidecar_problems("f.json", data)


def test_a_missing_sidecar_is_reported():
    problems = _problems(_fixture(facts=[_PLACED_FACT]))
    assert any("has place, no standard_place" in p for p in problems), problems


def test_a_fixture_level_exemption_suppresses_it():
    data = _fixture(
        facts=[_PLACED_FACT],
        _contract_exempt={"LZNY-BRF/Birth": ["standard_place"]},
        _contract_exempt_reason="models a resolver miss",
    )
    assert _problems(data) == []


def test_an_exemption_without_a_reason_is_reported():
    data = _fixture(
        facts=[_PLACED_FACT],
        _contract_exempt={"LZNY-BRF/Birth": ["standard_place"]},
    )
    assert any("_contract_exempt_reason" in p for p in _problems(data)), _problems(data)


def test_an_exemption_of_the_wrong_type_is_reported():
    data = _fixture(
        facts=[_PLACED_FACT],
        _contract_exempt=["standard_place"],
        _contract_exempt_reason="wrong shape on purpose",
    )
    assert any("must be an object keyed" in p for p in _problems(data)), _problems(data)


def test_a_per_key_exemption_of_the_wrong_type_is_reported():
    data = _fixture(
        facts=[_PLACED_FACT],
        _contract_exempt={"LZNY-BRF/Birth": "standard_place"},
        _contract_exempt_reason="wrong inner shape on purpose",
    )
    assert any("must be a list" in p for p in _problems(data)), _problems(data)


def test_an_exemption_keys_a_relationship_fact_too():
    rel = {"type": "Couple", "facts": [{"type": "Marriage", "place": "Boston"}]}
    assert any("has place, no standard_place" in p for p in _problems(_fixture(relationships=[rel])))
    exempted = _fixture(
        relationships=[rel],
        _contract_exempt={"Couple/Marriage": ["standard_place"]},
        _contract_exempt_reason="models a resolver miss on a marriage place",
    )
    assert _problems(exempted) == []


def test_the_marker_inside_the_fact_no_longer_suppresses():
    """The trap round 2 caught. A marker on the fact itself is served to the
    skill verbatim, so it must NOT be honoured -- otherwise the shape that breaks
    the write is the shape the lint rewards."""
    data = _fixture(
        facts=[dict(_PLACED_FACT, _contract_exempt=["standard_place"])],
        _contract_exempt_reason="reason present, but the marker is in the wrong place",
    )
    assert any("has place, no standard_place" in p for p in _problems(data)), _problems(data)


def test_an_exemption_does_not_suppress_the_other_sidecar():
    data = _fixture(
        facts=[{"type": "Birth", "place": "Boston", "date": "1845"}],
        _contract_exempt={"LZNY-BRF/Birth": ["standard_place"]},
        _contract_exempt_reason="only the place is unresolvable",
    )
    problems = _problems(data)
    assert any("has date, no standard_date" in p for p in problems), problems
    assert not any("standard_place" in p for p in problems), problems
