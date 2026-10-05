"""Mutation tests for the init-project wrote-it-vs-tool-returned-it validators.

Same reason as `test_init_project_opening_turn_validators.py`: `pyproject.toml`
sets `testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise appear
only inside a paid per-skill run. These eight came out of issue #1653's deep
dive (V1-V8 in `docs/deep-dives/init-project-findings-2026-08-20.md`), and the
dive's own lesson is that an unexercised check is indistinguishable from
coverage — so every one is asserted to PASS on the shape the 2026-08-20 run
actually produced and to FAIL on the specific defect it was written for.

`tool_calls[].response` is supplied by the mock at runtime and is stripped from
the committed run log, so the provenance checks cannot be replayed against a log
— hence synthetic inputs here, built to mirror `person-read-flynn-family.json`.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import (  # noqa: E402
    _DEFAULT_LEVEL,
    _HOUSE_STYLE,
    test_every_fact_and_relationship_is_sourced as check_sourced,
    test_existing_project_is_not_reinitialized as check_not_reinit,
    test_narration_guidance_is_the_house_style as check_narration,
    test_person_level_sources_carried as check_person_sources,
    test_init_empty_sections as check_empty,
    test_returned_sources_reach_the_tree_without_notes as check_notes,
    test_search_before_stubs as check_search,
    test_standard_date_survives_from_the_tool as check_std_date,
    test_standard_place_came_from_a_tool as check_std_place,
    test_tree_ark_is_canonical_and_traceable as check_ark,
)

POSITIVE = {"type": "positive", "tags": []}
SEARCH_TAGGED = {"type": "positive", "tags": ["expects-person-search"]}


# --- helpers: the shape person-read-flynn-family.json returns -------------

def _person_read_call(persons=None, sources=None, **args):
    call_args = {"personId": "LZNY-BRF"}
    call_args.update(args)
    return {
        "tool": "mcp__genealogy__person_read",
        "args": call_args,
        "response": {
            "persons": persons if persons is not None else [
                {
                    "id": "LZNY-BRF",
                    "gender": "Male",
                    "living": False,
                    "names": [{"given": "Patrick", "surname": "Flynn"}],
                    "facts": [
                        {
                            "type": "Birth",
                            "date": "~1845",
                            "standard_date": "Abt 1845",
                            "place": "Ireland",
                            "standard_place": "Ireland",
                        },
                        {
                            "type": "Death",
                            "date": "1908",
                            "standard_date": "1908",
                            "place": "Schuylkill County, Pennsylvania, United States",
                            "standard_place": "Schuylkill, Pennsylvania, United States",
                        },
                    ],
                }
            ],
            "relationships": [],
            "sources": sources if sources is not None else [],
        },
    }


def _tree(persons=None, relationships=None, sources=None):
    return {
        "tree_gedcomx_json": {
            "persons": persons if persons is not None else [],
            "relationships": relationships if relationships is not None else [],
            "sources": sources if sources is not None else [],
        }
    }


def _sourced_fact(**fields):
    fact = {"sources": [{"ref": "S1", "quality": 1}]}
    fact.update(fields)
    return fact


def _fails(check, *args):
    """The validator fired. Returns its message so a test can assert on it."""
    with pytest.raises(AssertionError) as excinfo:
        check(*args)
    return str(excinfo.value)


# --- V1: person-level sources reach the tree ------------------------------

def _read_with_person_sources():
    """person_read returning a subject with two person-level refs into its own
    source ids, the shape `person-read-moreau-person-level-sources.json` has."""
    return {
        "tool": "mcp__genealogy__person_read",
        "args": {"personId": "MRQ1-JBM"},
        "response": {
            "persons": [{
                "id": "MRQ1-JBM", "gender": "Male", "living": False,
                "names": [{"given": "Jean Baptiste", "surname": "Moreau"}],
                "sources": [{"ref": "SD01-AAA"}, {"ref": "SD01-BBB"}],
            }],
            "relationships": [],
            "sources": [
                {"id": "SD01-AAA", "title": "Civil birth"},
                {"id": "SD01-BBB", "title": "Church baptism"},
            ],
        },
    }


def _tree_with(person_sources, sources=None):
    return {"tree_gedcomx_json": {
        "persons": [{
            "id": "I1", "ark": "ark:/61903/4:1:MRQ1-JBM", "gender": "Male",
            "names": [{"id": "N1", "given": "Jean Baptiste", "surname": "Moreau"}],
            **({"sources": person_sources} if person_sources is not None else {}),
        }],
        "relationships": [],
        "sources": sources if sources is not None else [
            {"id": "S1", "title": "FamilySearch Family Tree"},
            {"id": "S2", "title": "Civil birth"},
            {"id": "S3", "title": "Church baptism"},
        ],
    }}


def test_v1_passes_when_refs_are_remapped_to_the_tree_ids():
    check_person_sources([_read_with_person_sources()],
                         _tree_with([{"ref": "S2"}, {"ref": "S3"}]))


def test_v1_fires_when_a_person_level_ref_is_dropped():
    msg = _fails(check_person_sources, [_read_with_person_sources()], _tree_with([{"ref": "S2"}]))
    assert "Church baptism" in msg


def test_v1_fires_when_the_person_loses_the_key_entirely():
    msg = _fails(check_person_sources, [_read_with_person_sources()], _tree_with(None))
    assert "Civil birth" in msg and "Church baptism" in msg


def test_v1_fires_when_a_ref_is_copied_unchanged_and_dangles():
    msg = _fails(check_person_sources, [_read_with_person_sources()],
                 _tree_with([{"ref": "SD01-AAA"}, {"ref": "SD01-BBB"}]))
    assert "name no tree source" in msg


def test_v1_fires_when_a_ref_points_at_the_wrong_source():
    msg = _fails(check_person_sources, [_read_with_person_sources()],
                 _tree_with([{"ref": "S1"}, {"ref": "S3"}]))
    assert "Civil birth" in msg


def test_v1_skips_an_unimported_person_instead_of_failing():
    """The model read a candidate with person-level refs, then imported someone
    else: not a V1 failure (V2 fails a run that imports without arks)."""
    tree = _tree_with([{"ref": "S2"}, {"ref": "S3"}])
    tree["tree_gedcomx_json"]["persons"][0]["ark"] = "ark:/61903/4:1:OTHR-001"
    with pytest.raises(pytest.skip.Exception):
        check_person_sources([_read_with_person_sources()], tree)


def test_v1_counts_two_sources_that_share_a_title():
    """FamilySearch titles are "Name, \"Collection\"": two events in one
    collection share one. A set compare would hide the dropped second ref."""
    call = _read_with_person_sources()
    call["response"]["sources"] = [
        {"id": "SD01-AAA", "title": "John Smith, \"US Census\"", "citation": "1900"},
        {"id": "SD01-BBB", "title": "John Smith, \"US Census\"", "citation": "1910"},
    ]
    tree = _tree_with(
        [{"ref": "S2"}],
        sources=[
            {"id": "S2", "title": "John Smith, \"US Census\"", "citation": "1900"},
            {"id": "S3", "title": "John Smith, \"US Census\"", "citation": "1910"},
        ],
    )
    assert "missing person-level sources" in _fails(check_person_sources, [call], tree)


def test_v1_skips_when_no_returned_person_carries_sources():
    with pytest.raises(pytest.skip.Exception):
        check_person_sources([_person_read_call()], _tree_with(None))


# --- V2: ark form and provenance ----------------------------------------

def _imported(ark=None):
    """The Patrick Flynn the family fixture returns, as the tree records him.
    Joined to the response by name, because the import re-ids him to I1."""
    person = {
        "id": "I1",
        "names": [{"id": "N1", "preferred": True, "given": "Patrick",
                   "surname": "Flynn"}],
    }
    if ark is not None:
        person["ark"] = ark
    return person


def test_v2_passes_on_the_canonical_derived_form():
    after = _tree(persons=[_imported("ark:/61903/4:1:LZNY-BRF")])
    check_ark(after, [_person_read_call()])


def test_v2_fires_when_the_ark_is_omitted_from_an_imported_person():
    """The gap that made the first draft of this validator worthless: keying off
    the arks the tree happened to carry meant omitting the key everywhere left
    nothing to inspect, so the check SKIPPED in exactly the case it exists to
    catch. Expectations now come from the persons person_read returned."""
    message = _fails(check_ark, _tree(persons=[_imported()]), [_person_read_call()])
    assert "carries no ark" in message
    assert "ark:/61903/4:1:LZNY-BRF" in message


def test_v2_fires_on_an_empty_string_ark():
    """Same hole, second door: `ark: ""` is falsy, so a truthiness filter
    swallowed it silently."""
    assert "carries no ark" in _fails(
        check_ark, _tree(persons=[_imported("")]), [_person_read_call()]
    )


@pytest.mark.parametrize(
    "bad_ark",
    [
        "https://www.familysearch.org/tree/person/details/LZNY-BRF",
        "https://familysearch.org/ark:/61903/4:1:LZNY-BRF",
        "https://www.familysearch.org/ark:/61903/4:1:LZNY-BRF",
        "LZNY-BRF",
    ],
    ids=["tree-details-url", "resolver-prefixed", "www-resolver", "bare-pid"],
)
def test_v2_fires_on_every_shape_the_corpus_actually_wrote(bad_ark):
    """All four shapes the five committed run logs produced across 18 writes.
    None is canonical; the tree-details URL is the one that defeats arkToBareId
    outright."""
    message = _fails(check_ark, _tree(persons=[_imported(bad_ark)]), [_person_read_call()])
    assert "expected" in message or "canonical" in message


def test_v2_skips_when_person_read_was_never_called():
    """Objective-only builds: no FamilySearch person was read, so no ark is
    owed and a local stub correctly carries none."""
    with pytest.raises(pytest.skip.Exception):
        check_ark(_tree(persons=[{"id": "I1"}]), [])


def test_v2_ignores_a_returned_person_who_was_not_imported():
    """person_search returns candidates that are deliberately not imported;
    only what reached the tree is this validator's business."""
    check_ark(_tree(persons=[]), [_person_read_call()])


def test_v2_fires_on_a_canonical_ark_for_a_person_no_tool_returned():
    after = _tree(persons=[{"id": "I1", "ark": "ark:/61903/4:1:MADE-UP1"}])
    message = _fails(check_ark, after, [_person_read_call()])
    assert "no tool response returned" in message


def test_v2_accepts_the_search_then_read_flow():
    """ut_init_project_004's real shape: search for candidates, then read the
    chosen one. The ark derives from the person actually read.

    This test previously supplied only the search call and therefore asserted
    nothing — V2 skipped it, since no person_read means no ark is owed. Its
    premise was unreal too: the skill always reads the candidate it picks.
    """
    search = {
        "tool": "mcp__genealogy__person_search",
        "args": {"surname": "Flynn", "givenName": "Patrick"},
        "response": {
            "results": [
                {"personId": "LZNY-BRF",
                 "gedcomx": {"persons": [{"id": "LZNY-BRF",
                                          "ark": "ark:/61903/4:1:LZNY-BRF"}]}},
                {"personId": "LZNY-QRS",
                 "gedcomx": {"persons": [{"id": "LZNY-QRS"}]}},
            ]
        },
    }
    after = _tree(persons=[_imported("ark:/61903/4:1:LZNY-BRF")])
    check_ark(after, [search, _person_read_call()])


def _named(local_id, ark, given="Patrick", surname="Flynn"):
    person = {"id": local_id,
              "names": [{"given": given, "surname": surname}]}
    if ark is not None:
        person["ark"] = ark
    return person


def _read_two_same_named():
    """person_read returning two persons who share a name — a Sr./Jr. pair, or
    the same-named siblings #1689 adds to the family fixture."""
    def p(pid):
        return {"id": pid, "gender": "Male", "living": False,
                "names": [{"given": "Patrick", "surname": "Flynn"}], "facts": []}
    return {
        "tool": "mcp__genealogy__person_read",
        "args": {"personId": "LZNY-BRF"},
        "response": {"persons": [p("LZNY-BRF"), p("LZNY-P7Q")],
                     "relationships": [], "sources": []},
    }


def test_v2_passes_a_same_named_pair_each_carrying_its_own_ark():
    """Round 2 of review: keying one written person per name blamed each of a
    same-named pair for the other's pid, failing a CORRECT import. A failed
    validator fails the test outright, so that cost the test its whole grade."""
    after = _tree(persons=[_named("I1", "ark:/61903/4:1:LZNY-BRF"),
                           _named("I2", "ark:/61903/4:1:LZNY-P7Q")])
    check_ark(after, [_read_two_same_named()])


def test_v2_still_fires_when_one_of_a_same_named_pair_lacks_its_ark():
    """The widening must not become a hole: if no same-named person carries the
    expected ark, that pid is still unanchored."""
    after = _tree(persons=[_named("I1", "ark:/61903/4:1:LZNY-BRF"),
                           _named("I2", None)])
    message = _fails(check_ark, after, [_read_two_same_named()])
    assert "LZNY-P7Q" in message


def test_v2_still_fires_when_a_same_named_pair_shares_one_ark():
    """Both written with the SAME ark — one pid is anchored twice and the other
    not at all. The `any` match must not let the duplicate cover for it."""
    after = _tree(persons=[_named("I1", "ark:/61903/4:1:LZNY-BRF"),
                           _named("I2", "ark:/61903/4:1:LZNY-BRF")])
    message = _fails(check_ark, after, [_read_two_same_named()])
    assert "LZNY-P7Q" in message


def test_v2_fires_when_the_ark_names_the_candidate_that_was_not_chosen():
    """The runner-up is in `known` — it was returned — so a form-and-provenance
    check alone would accept it. The expectation is keyed to the person actually
    read, which is what catches it."""
    search = {
        "tool": "mcp__genealogy__person_search",
        "args": {"surname": "Flynn"},
        "response": {"results": [{"personId": "LZNY-QRS",
                                  "gedcomx": {"persons": [{"id": "LZNY-QRS"}]}}]},
    }
    after = _tree(persons=[_imported("ark:/61903/4:1:LZNY-QRS")])
    message = _fails(check_ark, after, [search, _person_read_call()])
    assert "expected 'ark:/61903/4:1:LZNY-BRF'" in message


# --- V3: standard_place provenance --------------------------------------

def test_v3_passes_when_the_value_was_carried_from_person_read():
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Death", "place": "Schuylkill County, Pennsylvania, United States",
         "standard_place": "Schuylkill, Pennsylvania, United States"},
    ]}])
    check_std_place(after, [_person_read_call()])


def test_v3_passes_when_the_value_came_from_place_search():
    place_search = {
        "tool": "mcp__genealogy__place_search",
        "args": {"placeName": "Boston"},
        "response": {"results": [
            {"standardPlace": "Boston, Suffolk, Massachusetts, United States"}
        ]},
    }
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "place": "Boston",
         "standard_place": "Boston, Suffolk, Massachusetts, United States"},
    ]}])
    check_std_place(after, [place_search])


def test_v3_fires_on_the_defect_it_was_written_for():
    """The 56-value case: `standard_place` copied from the raw `place`, with no
    `place_search` call and no returned value to carry."""
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "place": "Boston", "standard_place": "Boston"},
    ]}])
    message = _fails(check_std_place, after, [])
    assert "free-text place" in message
    assert "no tool returned any" in message


def test_v3_fires_on_a_plausible_but_unreturned_standardization():
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "place": "Boston",
         "standard_place": "Boston, Suffolk County, Massachusetts, United States"},
    ]}])
    assert "match neither" in _fails(check_std_place, after, [_person_read_call()])


_STAGED_REF = "results/.staging/x.json"


def _as_built(after):
    """The state as project_create leaves it: the same tree also written as the
    write-once starting baseline, which is what V3 checks a host fill against."""
    import json
    tree = after["tree_gedcomx_json"]
    return {**after, "files": {"starting-tree.gedcomx.json": json.dumps(tree)}}


def _staged(call, ref=_STAGED_REF):
    """The call with the `staged` handle production attaches when it stages."""
    call["response"]["staged"] = {"resultsRef": ref}
    return call


def _unresolved_read():
    """person_read returning a Death with a place it could not standardize."""
    return _staged(_person_read_call(persons=[{
        "id": "LZNY-BRF", "gender": "Male", "living": False,
        "names": [{"given": "Patrick", "surname": "Flynn"}],
        "facts": [{"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania"}],
    }]))


_REF_CREATE = {"tool": "mcp__genealogy__project_create",
               "args": {"personReadRef": " " + _STAGED_REF},
               "response": {"ok": True}}
_ARK = "ark:/61903/4:1:LZNY-BRF"
_FILLED = _tree(persons=[{"id": "I1", "ark": _ARK, "facts": [
    {"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania",
     "standard_place": "Pottsville, Schuylkill, Pennsylvania, United States"},
]}])


def test_v3_passes_a_value_the_host_retry_filled():
    """#2944: project_create's host build retries a place the read left
    unresolved, so the value matches no returned value and no place_search."""
    check_std_place(_as_built(_FILLED), [_unresolved_read(), _REF_CREATE])


def test_v3_still_fires_on_that_value_when_the_tree_was_hand_built():
    """Without personReadRef no host build ran, so the model invented it."""
    assert "match neither" in _fails(check_std_place, _as_built(_FILLED), [_unresolved_read()])


def test_v3_passes_a_host_resolution_identical_to_the_raw_place():
    """A resolved name can equal the raw text ("Ireland")."""
    read = _staged(_person_read_call(persons=[{"id": "LZNY-BRF", "gender": "Male", "living": False,
        "names": [{"given": "P", "surname": "F"}], "facts": [{"type": "Birth", "place": "Ireland"}]}]))
    after = _tree(persons=[{"id": "I1", "ark": _ARK, "facts": [
        {"type": "Birth", "place": "Ireland", "standard_place": "Ireland"}]}])
    check_std_place(_as_built(after), [read, _REF_CREATE])


def test_v3_passes_a_host_fill_on_the_second_of_two_same_type_facts():
    read = _staged(_person_read_call(persons=[{"id": "LZNY-BRF", "gender": "Male", "living": False,
        "names": [{"given": "P", "surname": "F"}], "facts": [
            {"type": "Residence", "place": "Pottsville"},
            {"type": "Residence", "place": "Reading", "standard_place": "Reading, Berks, Pennsylvania, United States"},
        ]}]))
    after = _tree(persons=[{"id": "I1", "ark": _ARK, "facts": [
        {"type": "Residence", "place": "Pottsville", "standard_place": "Pottsville, Schuylkill, Pennsylvania, United States"},
        {"type": "Residence", "place": "Reading", "standard_place": "Reading, Berks, Pennsylvania, United States"},
    ]}])
    check_std_place(_as_built(after), [read, _REF_CREATE])


def test_v3_does_not_let_one_person_s_unresolved_fact_exempt_another_s():
    """The read left Patrick's Death unresolved; a Death on his brother with the
    same raw place and an invented value is not the host's fill."""
    after = _tree(persons=[
        {"id": "I1", "ark": _ARK, "facts": [{"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania"}]},
        {"id": "I2", "ark": "ark:/61903/4:1:LZNY-B8S", "facts": [
            {"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania",
             "standard_place": "Pottsville, Schuylkill, Pennsylvania, United States"}]},
    ])
    message = _fails(check_std_place, _as_built(after), [_unresolved_read(), _REF_CREATE])
    assert "I2/Death" in message


def test_v3_does_not_exempt_a_fact_on_a_person_with_no_ark():
    unarked = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania",
         "standard_place": "Pottsville, Schuylkill, Pennsylvania, United States"},
    ]}])
    assert "match neither" in _fails(check_std_place, _as_built(unarked), [_unresolved_read(), _REF_CREATE])


def _couple_read(place_fact):
    read = _person_read_call(persons=[
        {"id": "LZNY-BRF", "gender": "Male", "living": False, "names": [{"given": "P", "surname": "F"}]},
        {"id": "LZNY-K2M", "gender": "Female", "living": False, "names": [{"given": "M", "surname": "K"}]},
    ])
    read["response"]["relationships"] = [
        {"type": "Couple", "person1": "LZNY-BRF", "person2": "LZNY-K2M", "facts": [place_fact]}]
    return _staged(read)


def _couple_tree(person2_ark):
    return _tree(
        persons=[{"id": "I1", "ark": _ARK}, {"id": "I2", "ark": person2_ark}],
        relationships=[{"id": "R1", "type": "Couple", "person1": "I2", "person2": "I1", "facts": [
            {"type": "Marriage", "place": "Dublin", "standard_place": "Dublin, Ireland"}]}],
    )


def test_v3_passes_a_host_fill_on_a_relationship_fact_matched_by_its_endpoints():
    read = _couple_read({"type": "Marriage", "place": "Dublin"})
    check_std_place(_as_built(_couple_tree("ark:/61903/4:1:LZNY-K2M")), [read, _REF_CREATE])


def test_v3_does_not_exempt_a_relationship_fact_on_other_endpoints():
    read = _couple_read({"type": "Marriage", "place": "Dublin"})
    message = _fails(check_std_place, _as_built(_couple_tree("ark:/61903/4:1:ZZZZ-999")), [read, _REF_CREATE])
    assert "R1/Marriage" in message


def test_v3_does_not_trust_a_second_read_the_ref_did_not_name():
    """A second person_read's person joins as an addition; the host retry never
    touched its facts, so its unresolved place does not excuse an invented value."""
    second = _staged(_person_read_call(persons=[{
        "id": "ZZZZ-001", "gender": "Male", "living": False,
        "names": [{"given": "O", "surname": "K"}],
        "facts": [{"type": "Birth", "place": "Cork"}],
    }], personId="ZZZZ-001"), ref="results/.staging/other.json")
    after = _tree(persons=[{"id": "I7", "ark": "ark:/61903/4:1:ZZZZ-001", "facts": [
        {"type": "Birth", "place": "Cork", "standard_place": "Made Up Parish, Cork, Ireland"}]}])
    assert "I7/Birth" in _fails(check_std_place, _as_built(after), [_unresolved_read(), second, _REF_CREATE])
    # The same read, when it IS the one the ref named, is trusted.
    named = {**_REF_CREATE, "args": {"personReadRef": "results/.staging/other.json"}}
    check_std_place(_as_built(after), [second, named])


@pytest.mark.parametrize("spelling", [
    "./" + _STAGED_REF, "/abs/project/" + _STAGED_REF, "results//.staging/x.json",
])
def test_v3_matches_the_ref_in_any_spelling_project_create_accepts(spelling):
    create = {**_REF_CREATE, "args": {"personReadRef": spelling}}
    check_std_place(_as_built(_FILLED), [_unresolved_read(), create])


def test_v3_does_not_exempt_a_value_the_starting_tree_does_not_hold():
    """The host fill is what the write-once baseline holds. A different value on
    that fact now (a copy of `place`, or one a later tree_edit invented) is not."""
    baseline = _as_built(_tree(persons=[{"id": "I1", "ark": _ARK, "facts": [
        {"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania"}]}]))
    for invented in ["Pottsville, Schuylkill, Pennsylvania", "Totally Invented"]:
        after = {**_tree(persons=[{"id": "I1", "ark": _ARK, "facts": [
            {"type": "Death", "place": "Pottsville, Schuylkill, Pennsylvania",
             "standard_place": invented}]}]), "files": baseline["files"]}
        assert "I1/Death" in _fails(check_std_place, after, [_unresolved_read(), _REF_CREATE])


def test_v3_does_not_exempt_without_a_starting_tree():
    assert "match neither" in _fails(check_std_place, _FILLED, [_unresolved_read(), _REF_CREATE])


def test_v3_does_not_trust_a_read_that_was_never_staged():
    read = _unresolved_read()
    del read["response"]["staged"]
    assert "match neither" in _fails(check_std_place, _as_built(_FILLED), [read, _REF_CREATE])


def test_v3_does_not_trust_a_refused_ref_call():
    refused = {**_REF_CREATE, "response": {"ok": False, "errors": ["x"]}}
    assert "match neither" in _fails(check_std_place, _as_built(_FILLED), [_unresolved_read(), refused])


def test_v3_skips_when_nothing_was_standardized():
    after = _tree(persons=[{"id": "I1", "facts": [{"type": "Birth", "place": "Boston"}]}])
    with pytest.raises(pytest.skip.Exception):
        check_std_place(after, [])


# --- V8: standard_date is not lost or altered ---------------------------

def test_v8_passes_when_the_sidecar_is_carried_verbatim():
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "date": "~1845", "standard_date": "Abt 1845"},
    ]}])
    check_std_date(after, [_person_read_call()])


def test_v8_fires_when_the_sidecar_is_dropped():
    after = _tree(persons=[{"id": "I1", "facts": [{"type": "Birth", "date": "~1845"}]}])
    assert "dropped" in _fails(check_std_date, after, [_person_read_call()])


def test_v8_fires_when_the_sidecar_is_re_derived():
    """`~1845` -> `1845` is exactly what `stdDate` produced before the tilde fix:
    an approximate year silently promoted to an exact one."""
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "date": "~1845", "standard_date": "1845"},
    ]}])
    assert "altered to '1845'" in _fails(check_std_date, after, [_person_read_call()])


def test_v8_allows_a_hand_built_fact_the_tool_never_returned():
    """The narrowing that keeps this validator honest. The objective-only builds
    write `Abt 1920` for a hand-entered `~1920` with no tool involved, and the
    2026-08-20 annotation confirmed those runs. A provenance rule here would
    have failed them."""
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "date": "~1920", "standard_date": "Abt 1920"},
    ]}])
    check_std_date(after, [_person_read_call()])


def test_v8_skips_when_no_person_read_response_exists():
    after = _tree(persons=[{"id": "I1", "facts": [
        {"type": "Birth", "date": "~1920", "standard_date": "Abt 1920"},
    ]}])
    with pytest.raises(pytest.skip.Exception):
        check_std_date(after, [])


# --- V4: every fact and relationship is sourced -------------------------

def test_v4_passes_when_everything_carries_a_quality_1_ref():
    after = _tree(
        persons=[{"id": "I1", "facts": [_sourced_fact(type="Birth")]}],
        relationships=[{"id": "R1", "type": "ParentChild", "parent": "I1",
                        "child": "I2", "sources": [{"ref": "S1", "quality": 1}]}],
        sources=[{"id": "S1", "title": "FamilySearch Family Tree"}],
    )
    check_sourced(after, POSITIVE)


def test_v4_fires_on_the_objective_only_defect():
    """006's actual shape for four runs: `sources: []` and a fact with no
    `sources` key at all."""
    after = _tree(persons=[{"id": "I1", "facts": [{"type": "Birth"}]}], sources=[])
    assert "no source reference" in _fails(check_sourced, after, POSITIVE)


def test_v4_fires_on_an_unsourced_relationship():
    after = _tree(
        persons=[{"id": "I1", "facts": [_sourced_fact(type="Birth")]}],
        relationships=[{"id": "R1", "type": "ParentChild"}],
        sources=[{"id": "S1", "title": "t"}],
    )
    assert "R1/ParentChild: no source reference" in _fails(check_sourced, after, POSITIVE)


def test_v4_fires_on_a_dangling_ref():
    after = _tree(
        persons=[{"id": "I1", "facts": [{"type": "Birth",
                                         "sources": [{"ref": "S9", "quality": 1}]}]}],
        sources=[{"id": "S1", "title": "t"}],
    )
    assert "not a top-level source" in _fails(check_sourced, after, POSITIVE)


def test_v4_fires_on_the_wrong_quality():
    after = _tree(
        persons=[{"id": "I1", "facts": [{"type": "Birth",
                                         "sources": [{"ref": "S1", "quality": 3}]}]}],
        sources=[{"id": "S1", "title": "t"}],
    )
    assert "quality=3" in _fails(check_sourced, after, POSITIVE)


def test_v4_skips_on_a_negative_test():
    with pytest.raises(pytest.skip.Exception):
        check_sourced(_tree(), {"type": "negative", "tags": []})


# --- V6: the note is dropped, not the source ----------------------------

_NOTED_SOURCE = {
    "id": "MMM9-7RB",
    "title": "United States Census, 1880, Branch Township, Schuylkill, Pennsylvania",
    "notes": ["Household lists Patrick, wife Mary, and two children."],
}


def test_v6_passes_when_the_note_is_dropped_and_the_source_kept():
    after = _tree(sources=[{"id": "S2", "title": _NOTED_SOURCE["title"]}])
    check_notes(after, [_person_read_call(sources=[_NOTED_SOURCE])])


def test_v6_fires_when_the_note_is_copied_through():
    after = _tree(sources=[{"id": "S2", "title": _NOTED_SOURCE["title"],
                            "notes": _NOTED_SOURCE["notes"]}])
    assert "carries ['notes']" in _fails(
        check_notes, after, [_person_read_call(sources=[_NOTED_SOURCE])]
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("text", "Patrick came over from County Mayo in 1867..."),
        ("image_ref", "images/228755097.jpg"),
    ],
)
def test_v6_fires_on_a_memory_field_copied_through(field, value):
    """`notes` was the first field person_read emitted that a tree source may not
    carry; a memory's `text` and `image_ref` are the second and third. The
    validator checks the ALLOW-LIST, so it catches these without being taught
    their names -- this is what proves that, rather than assuming it."""
    source = {"id": "228755097", "title": "A family story", field: value}
    after = _tree(sources=[{"id": "S3", "title": source["title"], field: value}])
    assert f"carries ['{field}']" in _fails(
        check_notes, after, [_person_read_call(sources=[source])]
    )


def test_v6_passes_when_the_memory_is_written_with_only_allowed_fields():
    """The other direction: stripping the extra field and keeping the source is
    exactly the right behaviour and must not be flagged."""
    source = {
        "id": "228755097",
        "title": "A family story",
        "url": "https://www.familysearch.org/memories/228755097",
        "text": "Patrick came over from County Mayo in 1867...",
    }
    after = _tree(sources=[{"id": "S3", "title": source["title"],
                            "url": source["url"]}])
    check_notes(after, [_person_read_call(sources=[source])])


def test_v6_fires_when_the_whole_source_is_dropped_to_dodge_the_rejection():
    """The plausible wrong fix, and the reason this validator exists: deleting
    the source silently loses evidence the survey found."""
    after = _tree(sources=[])
    assert "absent from the tree" in _fails(
        check_notes, after, [_person_read_call(sources=[_NOTED_SOURCE])]
    )


def test_v6_skips_when_no_sources_were_returned():
    with pytest.raises(pytest.skip.Exception):
        check_notes(_tree(), [_person_read_call()])


# --- V5: the fixed profile, verbatim ------------------------------------

def test_v5_passes_on_the_fixed_profile():
    after = {"research_json": {"researcher_profile": {
        "experience_level": _DEFAULT_LEVEL,
        "narration_guidance": _HOUSE_STYLE,
    }}}
    check_narration(after)


def test_v5_fires_on_a_paraphrase():
    after = {"research_json": {"researcher_profile": {
        "experience_level": _DEFAULT_LEVEL,
        "narration_guidance": "Plain language. No identifiers. One paragraph.",
    }}}
    assert "verbatim" in _fails(check_narration, after)


def test_v5_fires_on_a_volunteered_level():
    """The user said they were experienced; the skill must not persist it -- the
    profile is fixed and a user setting owns the level later."""
    after = {"research_json": {"researcher_profile": {
        "experience_level": "experienced",
        "narration_guidance": _HOUSE_STYLE,
    }}}
    assert "novice" in _fails(check_narration, after)


def test_v5_fires_on_an_unknown_level():
    after = {"research_json": {"researcher_profile": {
        "experience_level": "expert",
        "narration_guidance": "anything",
    }}}
    assert "novice" in _fails(check_narration, after)


def test_v5_skips_when_no_profile_was_written():
    with pytest.raises(pytest.skip.Exception):
        check_narration({"research_json": {}})


# --- V7: search before stubs (tag-gated) --------------------------------

def test_v7_skips_on_an_untagged_test():
    """The narrowing. `ut_init_project_002` skipped the search, and the
    2026-08-20 annotation confirmed it — because its message says the person is
    not in the tree. Untagged means not this validator's business."""
    after = _tree(persons=[{"id": "I1"}])
    with pytest.raises(pytest.skip.Exception):
        check_search([], after, POSITIVE)


def test_v7_passes_when_the_search_ran():
    after = _tree(persons=[{"id": "I1"}])
    check_search(
        [{"tool": "mcp__genealogy__person_search", "args": {"surname": "Flynn"}}],
        after, SEARCH_TAGGED,
    )


def test_v7_fires_when_a_tagged_test_stubs_without_searching():
    after = _tree(persons=[{"id": "I1"}])
    message = _fails(
        check_search,
        [{"tool": "mcp__genealogy__place_search", "args": {"placeName": "Boston"}}],
        after, SEARCH_TAGGED,
    )
    assert "without searching FamilySearch first" in message


def test_v7_skips_when_no_tree_person_was_written():
    with pytest.raises(pytest.skip.Exception):
        check_search([], _tree(), SEARCH_TAGGED)


# --- init-empty-sections: the memory-transcription exemption --------------

_STORY = "Patrick came over from County Mayo in 1867, a boy of nineteen."
_EMPTY_TAGGED = {"type": "positive", "tags": ["init-empty-sections"]}


def _after(research):
    return {"research_json": research}


def _blank(**over):
    r = {s: [] for s in (
        "questions", "plans", "log", "sources", "assertions",
        "person_evidence", "conflicts", "hypotheses", "timelines",
        "proof_summaries",
    )}
    r.update(over)
    return r


def test_empty_sections_allows_a_verbatim_memory_transcription():
    """The ruled behaviour: a memory's text is persisted at init."""
    calls = [_person_read_call(sources=[{"id": "228755097", "title": "A story",
                                         "text": _STORY}])]
    after = _after(_blank(sources=[{"gedcomx_source_description_id": "S3",
                                    "transcription": _STORY}]))
    check_empty(after, _EMPTY_TAGGED, calls)


def test_empty_sections_now_FIRES_on_the_untranscribed_memory_null_entry():
    """Decision 5, 2026-09-17: an untranscribed memory gets NO sources entry.
    It is already a tree source carrying title and URL, so the lead survives;
    what the sources entry adds is the assertion it was examined, which is the
    one thing that is not true. This test asserted the opposite until the
    ruling."""
    calls = [_person_read_call(sources=[{"id": "1", "title": "A story",
                                         "text": _STORY}])]
    after = _after(_blank(sources=[{"gedcomx_source_description_id": "S4",
                                    "transcription": None}]))
    assert "is null for a memory that was never transcribed" in _fails(
        check_empty, after, _EMPTY_TAGGED, calls
    )


_ALL_UNTRANSCRIBED = [
    {"id": "1", "title": "A will", "artifact_url": "https://sg30p0.familysearch.org/a/dist.pdf"},
    {"id": "2", "title": "A deed", "artifact_url": "https://sg30p0.familysearch.org/b/dist.jpg"},
]


def test_acceptance_14_all_untranscribed_leaves_sources_EMPTY():
    """Acceptance 14: on a person whose kept memories all came back
    untranscribed, `sources` is empty after init. Both memories are still in
    tree.gedcomx.json, which is where the lead lives."""
    calls = [_person_read_call(sources=_ALL_UNTRANSCRIBED)]
    check_empty(_after(_blank()), _EMPTY_TAGGED, calls)


def test_acceptance_14_fires_when_an_untranscribed_memory_got_an_entry_anyway():
    """The other direction, and the one that can actually regress: the skill
    writing the entry the cap forbids. Text-gating made this invisible -- with
    no text returned the exemption never engaged at all."""
    calls = [_person_read_call(sources=_ALL_UNTRANSCRIBED)]
    after = _after(_blank(sources=[{"gedcomx_source_description_id": "S1",
                                    "transcription": None}]))
    assert "is null for a memory that was never transcribed" in _fails(
        check_empty, after, _EMPTY_TAGGED, calls
    )


def test_empty_sections_fires_when_more_nulls_than_memories_came_back():
    """The other direction, and the hole the text-only gate left wide open:
    once ANY text was present the null branch was unbounded, so invented
    entries rode in behind one real memory. Two memories cannot justify three
    sources."""
    calls = [_person_read_call(sources=[
        {"id": "1", "title": "A will", "artifact_url": "https://sg30p0.familysearch.org/a/dist.pdf"},
        {"id": "2", "title": "A story", "text": _STORY},
    ])]
    after = _after(_blank(sources=[
        {"gedcomx_source_description_id": "S1", "transcription": _STORY},
        {"gedcomx_source_description_id": "S2", "transcription": _STORY},
        {"gedcomx_source_description_id": "S3", "transcription": _STORY},
    ]))
    assert "cannot admit more entries than there were memories" in _fails(
        check_empty, after, _EMPTY_TAGGED, calls
    )


def test_empty_sections_still_fires_on_an_invented_transcription():
    """The exemption must not become a hole: a transcription person_read never
    returned is exactly the fabrication the empty-sections rule exists to stop."""
    calls = [_person_read_call(sources=[{"id": "1", "title": "A story",
                                         "text": _STORY}])]
    after = _after(_blank(sources=[{"gedcomx_source_description_id": "S3",
                                    "transcription": "I made this up."}]))
    assert "not verbatim from person_read" in _fails(check_empty, after,
                                                     _EMPTY_TAGGED, calls)


def test_empty_sections_unchanged_when_no_memories_came_back():
    """Every pre-existing test takes this path: no memory text, so `sources`
    must still be empty and the original message still fires."""
    calls = [_person_read_call(sources=[{"id": "S1", "title": "A census"}])]
    after = _after(_blank(sources=[{"gedcomx_source_description_id": "S1"}]))
    assert "sources (1 entries)" in _fails(check_empty, after,
                                           _EMPTY_TAGGED, calls)


def test_empty_sections_still_fires_on_the_other_sections():
    """The exemption is scoped to `sources` alone."""
    calls = [_person_read_call(sources=[{"id": "1", "title": "A story",
                                         "text": _STORY}])]
    after = _after(_blank(questions=[{"id": "Q1"}]))
    assert "questions (1 entries)" in _fails(check_empty, after,
                                             _EMPTY_TAGGED, calls)



# --- The host-built tree passes the provenance validators (#2944 Stage B) ---

_ENGINE_BUILD = Path(__file__).resolve().parents[4] / "packages/engine/mcp-server/build"
_FAMILY = Path(__file__).resolve().parents[3] / "fixtures/mcp/person-read-flynn-family.json"


def _host_build(tmp_path, fixture=_FAMILY, pid="LZNY-BRF"):
    """Stage a person_read fixture and create the project through the COMPILED
    stagePersonRead + projectCreate, the path init-project now takes. Returns
    (person_read response with its `staged` handle, written tree, the
    project_create call as the log would record it)."""
    import json, subprocess

    response = json.loads(fixture.read_text(encoding="utf-8"))["response"]

    def url(p):
        posix = str(p).replace("\\", "/")
        return ("file:///" + posix) if sys.platform == "win32" else posix

    script = (
        f"import {{ stagePersonRead }} from '{url(_ENGINE_BUILD / 'tools/person-read.js')}';"
        f"import {{ projectCreate }} from '{url(_ENGINE_BUILD / 'tools/project-create.js')}';"
        " import { readFileSync } from 'node:fs';"
        " const i = JSON.parse(readFileSync(0, 'utf-8'));"
        " const { staged } = await stagePersonRead({ projectPath: i.dir, input: { personId: i.pid }, result: i.result });"
        " const r = await projectCreate({ projectPath: i.dir, objective: 'Find Patrick Flynn\\'s parents', personReadRef: staged.resultsRef });"
        " process.stdout.write(JSON.stringify({ r, staged }));"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        input=json.dumps({"dir": str(tmp_path).replace("\\", "/"), "result": response, "pid": pid}),
        capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    result = out["r"]
    assert result["ok"], result
    tree = json.loads((tmp_path / "tree.gedcomx.json").read_text(encoding="utf-8"))
    create = {"tool": "mcp__genealogy__project_create",
              "args": {"personReadRef": out["staged"]["resultsRef"]}, "response": result}
    return {**response, "staged": out["staged"]}, tree, create


@pytest.mark.requires_engine_build
def test_host_built_tree_passes_the_provenance_validators(tmp_path):
    """The rules the model followed by hand now run on the host. Checked by the
    validators written to grade the model, not by the builder's own reading."""
    response, tree, create = _host_build(tmp_path)
    calls = [{"tool": "mcp__genealogy__person_read", "args": {"personId": "LZNY-BRF"}, "response": response}, create]
    after = {"tree_gedcomx_json": tree}
    check_ark(after, calls)
    check_std_place(after, calls)
    check_std_date(after, calls)
    check_sourced(after, POSITIVE)
    check_notes(after, calls)


@pytest.mark.requires_engine_build
def test_host_built_tree_carries_person_level_sources(tmp_path):
    """V1 over the moreau fixture, whose persons carry person-level refs (on the
    family fixture V1 would pass vacuously). The refs must reach the written
    persons, re-pointed at the tree's own `S` ids."""
    moreau = _FAMILY.parent / "person-read-moreau-person-level-sources.json"
    response, tree, _create = _host_build(tmp_path, moreau, "MRQ1-JBM")
    calls = [{"tool": "mcp__genealogy__person_read", "args": {"personId": "MRQ1-JBM"}, "response": response}]
    after = {"tree_gedcomx_json": tree}
    check_person_sources(calls, after)
    check_ark(after, calls)
    assert any(p.get("sources") for p in tree["persons"]), "V1 checked nothing"


# --- refuse-if-exists invariant --------------------------------------------

_REFUSE = {"type": "negative", "tags": ["refuse-if-exists"]}
_PROJECT = {"id": "rp_001", "created": "2026-01-01", "objective": "Find Patrick's parents"}


def _states(after_project=None):
    before = {"research_json": {"project": dict(_PROJECT)}}
    after = {"research_json": {"project": dict(after_project or _PROJECT)}}
    return before, after


def test_not_reinit_passes_when_the_request_is_routed_without_init_work():
    before, after = _states()
    calls = [{"tool": "mcp__genealogy__research_query", "args": {}},
             {"tool": "mcp__genealogy__project_context", "args": {}}]
    check_not_reinit(before, after, calls, _REFUSE)


@pytest.mark.parametrize("tool", ["person_read", "person_search", "project_create"])
def test_not_reinit_fails_on_any_init_tool_call(tool):
    before, after = _states()
    with pytest.raises(AssertionError, match=f"called \\['{tool}'\\]"):
        check_not_reinit(before, after, [{"tool": f"mcp__genealogy__{tool}", "args": {}}], _REFUSE)


@pytest.mark.parametrize("key,value", [("id", "rp_002"), ("created", "2026-10-05"), ("objective", "General research")])
def test_not_reinit_fails_when_the_existing_project_was_replaced(key, value):
    before, after = _states({**_PROJECT, key: value})
    with pytest.raises(AssertionError, match=f"project.{key} changed"):
        check_not_reinit(before, after, [], _REFUSE)


def test_not_reinit_refuses_a_scenario_with_no_existing_project():
    with pytest.raises(AssertionError, match="needs a scenario"):
        check_not_reinit({"research_json": None}, {"research_json": None}, [], _REFUSE)


def test_not_reinit_skips_untagged_tests():
    with pytest.raises(pytest.skip.Exception):
        check_not_reinit({}, {}, [{"tool": "mcp__genealogy__person_read"}], POSITIVE)
