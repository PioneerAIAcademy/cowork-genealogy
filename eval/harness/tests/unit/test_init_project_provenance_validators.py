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
    test_narration_guidance_is_the_house_style as check_narration,
    test_person_read_passes_both_flags as check_flags,
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
    call_args = {"personId": "LZNY-BRF", "relatives": True, "sourceDescriptions": True}
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


# --- V1: both person_read flags -----------------------------------------

def test_v1_passes_when_both_flags_are_true():
    check_flags([_person_read_call()])


def test_v1_skips_when_person_read_was_never_called():
    with pytest.raises(pytest.skip.Exception):
        check_flags([{"tool": "mcp__genealogy__place_search", "args": {}}])


@pytest.mark.parametrize("dropped", ["relatives", "sourceDescriptions"])
def test_v1_fires_when_either_flag_is_missing(dropped):
    call = _person_read_call()
    del call["args"][dropped]
    assert dropped in _fails(check_flags, [call])


def test_v1_fires_on_an_explicit_false():
    call = _person_read_call(relatives=False)
    assert "relatives" in _fails(check_flags, [call])


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
        "args": {"personId": "LZNY-BRF", "relatives": True, "sourceDescriptions": True},
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
    {"id": "1", "title": "A will", "artifactUrl": "https://sg30p0.familysearch.org/a/dist.pdf"},
    {"id": "2", "title": "A deed", "artifactUrl": "https://sg30p0.familysearch.org/b/dist.jpg"},
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
        {"id": "1", "title": "A will", "artifactUrl": "https://sg30p0.familysearch.org/a/dist.pdf"},
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

