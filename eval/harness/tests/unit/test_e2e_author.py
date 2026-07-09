"""Unit tests for e2e.author — the scripted half of /author-e2e-fixture.

The module's whole reason to exist is that a model hand-transcribing a
FamilySearch tree makes quiet mistakes. So the tests are mostly about the
quiet mistakes: a relationship pointing at a person who isn't in the tree, a
living person surviving into a committed fixture, a strip selector that
silently matches nothing, a synthesized id landing on top of a real one.
"""

from __future__ import annotations

import copy
import json
from datetime import date
from pathlib import Path

import pytest

import e2e.author as author
from e2e.author import (
    AuthorError,
    apply_strip,
    diff_trees,
    living_gate,
    normalize_tree,
    presence_mirror,
    render_index,
    _npx,
    _schema_errors_for_tree,
    _substitute,
    StripSpec,
)
from harness.schema_validator import validate_research_json


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

# person-read-raw.json's FamilySearch-native ids, which normalize_tree keeps
# verbatim. DEATH_1879 is the one fact that arrives without an id, so it is the
# only fact id this module synthesizes.
CENSUS_SOURCE = "7BL6-KLH"
BIRTH_1820 = "9381f219-2889-4bfc-9b03-5527232282c1"
DEATH_1868 = "a3ca8aea-4b58-4dbf-aecf-8fd8437e7791"
MARRIAGE_1818 = "27913e02-f2f7-4653-9bc3-9a13a0896872"
DEATH_1879 = "F1"


@pytest.fixture
def raw() -> dict:
    return json.loads((FIXTURES / "person-read-raw.json").read_text(encoding="utf-8"))


@pytest.fixture
def tree(raw: dict) -> dict:
    return normalize_tree(raw)[0]


def _person(pid: str, given: str, surname: str, **kw) -> dict:
    person = {"id": pid, "gender": "Male", "names": [{"id": "N1", "given": given, "surname": surname}]}
    person.update(kw)
    return person


# --- normalization ---------------------------------------------------------


def test_normalized_tree_satisfies_the_tree_schema(tree):
    # Every committed fixture is held to the same bar by `validate_fixture`.
    assert _schema_errors_for_tree(tree) == []


def test_ids_that_arrive_are_kept_and_only_the_gaps_are_filled(tree):
    # `person_read` identifies neither names nor relationships, so those are
    # synthesized. Everything it *does* identify — source PIDs, fact UUIDs —
    # survives verbatim; see simplified-gedcomx-spec.md §3.
    assert [p["names"][0]["id"] for p in tree["persons"]] == ["N1", "N2", "N3"]
    assert [r["id"] for r in tree["relationships"]] == ["R1", "R2", "R3"]
    assert [s["id"] for s in tree["sources"]] == [CENSUS_SOURCE, "9V1G-YQQ"]
    assert [f["id"] for f in tree["persons"][0]["facts"]] == [BIRTH_1820, DEATH_1879]
    assert [f["id"] for f in tree["relationships"][2]["facts"]] == [MARRIAGE_1818]


def test_a_fact_with_no_id_gets_one(tree):
    death = tree["persons"][0]["facts"][1]
    assert death["id"] == "F1"


def test_a_synthesized_id_steps_over_one_the_tree_already_uses():
    # The first two facts arrive as F1/F2 and the third has none. Handing it
    # F1 would make `strip --facts KNDX-MKG:F1` silently ambiguous.
    raw = {
        "persons": [_person("KNDX-MKG", "John", "Smith", living=False, facts=[
            {"id": "F1", "type": "Birth"},
            {"id": "F2", "type": "Death"},
            {"type": "Burial"},
        ])],
        "relationships": [],
        "sources": [],
    }
    tree, _ = normalize_tree(raw)
    assert [f["id"] for f in tree["persons"][0]["facts"]] == ["F1", "F2", "F3"]


def test_source_references_resolve_against_the_trees_source_ids(tree):
    birth = tree["persons"][0]["facts"][0]
    assert birth["sources"] == [{"ref": CENSUS_SOURCE, "page": "dwelling 84"}]


def test_a_reference_to_a_source_that_is_not_in_the_tree_is_dropped():
    raw = {
        "persons": [_person("KNDX-MKG", "John", "Smith", living=False,
                            facts=[{"id": "F1", "type": "Birth",
                                    "sources": [{"ref": "GONE-123"}]}])],
        "relationships": [],
        "sources": [],
    }
    tree, warnings = normalize_tree(raw)
    assert "sources" not in tree["persons"][0]["facts"][0]
    assert any("'GONE-123'" in w and "no such source" in w for w in warnings)


def test_fields_the_tree_schema_forbids_are_dropped(raw):
    tree, warnings = normalize_tree(raw)
    assert "notes" not in tree["sources"][0]
    assert any("'notes'" in w for w in warnings)


def test_a_name_prefix_survives(raw):
    # `person_read` emits prefix/suffix on names and the schema carries them.
    tree, _ = normalize_tree(raw)
    assert tree["persons"][0]["names"][0]["prefix"] == "Rev."


def test_fact_types_are_pascal_cased(tree):
    assert tree["persons"][0]["facts"][1]["type"] == "Death"


def test_unrecognized_fact_types_pass_through_untouched():
    raw = {
        "persons": [_person("KNDX-MKG", "John", "Smith", living=False,
                            facts=[{"type": "Military Draft Registration"}])],
        "relationships": [],
        "sources": [],
    }
    tree, _ = normalize_tree(raw)
    assert tree["persons"][0]["facts"][0]["type"] == "Military Draft Registration"


def test_relationships_pointing_outside_the_tree_are_dropped(raw):
    # `person_read --relatives` returns edges to grandparents and in-laws whose
    # person records it does not include. kenneth-quass-death had 21 of them.
    tree, warnings = normalize_tree(raw)
    known = {p["id"] for p in tree["persons"]}
    for rel in tree["relationships"]:
        assert set(author._endpoints(rel)) <= known
    assert any("dropped 1 relationship(s) pointing at persons not in the tree" in w for w in warnings)


def test_duplicate_relationships_are_collapsed(raw):
    tree, warnings = normalize_tree(raw)
    parent_child = [r for r in tree["relationships"] if r["type"] == "ParentChild"]
    assert len(parent_child) == 2
    assert any("duplicate ParentChild" in w for w in warnings)


def test_a_marriage_fact_survives_on_its_couple_relationship(tree):
    couple = tree["relationships"][2]
    assert couple["type"] == "Couple"
    assert couple["facts"][0]["type"] == "Marriage"


def test_normalization_is_idempotent(tree):
    assert normalize_tree(copy.deepcopy(tree))[0] == tree


# --- the living-person gate ------------------------------------------------


def _tree_with(*persons: dict, relationships: list | None = None) -> dict:
    return {"persons": list(persons), "relationships": relationships or [], "sources": []}


def test_a_living_person_anywhere_is_a_refusal():
    subject = _person("KNDX-MKG", "John", "Smith", living=False)
    son = _person("LF4F-ML8", "Paul", "Smith", living=True)
    result = living_gate(_tree_with(subject, son))
    assert result.errors and "LF4F-ML8" in result.errors[0]
    assert len(result.tree["persons"]) == 2  # refusal changes nothing


def test_a_living_person_stub_from_the_204_path_is_caught():
    # person_read returns livingPersonStub(pid) rather than throwing on HTTP 204.
    stub = {"id": "KNDX-MKG", "gender": "Unknown", "living": True,
            "names": [{"given": "", "surname": ""}]}
    assert living_gate(_tree_with(stub)).errors


def test_a_missing_living_field_is_a_refusal():
    # Absent is not deceased, and the tree schema does not require the field —
    # so the gate has to, or a hand-built tree slips a living person through.
    result = living_gate(_tree_with(_person("KNDX-MKG", "John", "Smith")))
    assert result.errors and "no `living` field" in result.errors[0]


def test_drop_living_removes_the_person_and_cascades_relationships():
    subject = _person("KNDX-MKG", "John", "Smith", living=False)
    son = _person("LF4F-ML8", "Paul", "Smith", living=True)
    rels = [{"id": "R1", "type": "ParentChild", "parent": "KNDX-MKG", "child": "LF4F-ML8"}]
    result = living_gate(_tree_with(subject, son, relationships=rels), drop_living=True)

    assert result.errors == []
    assert [p["id"] for p in result.tree["persons"]] == ["KNDX-MKG"]
    assert result.tree["relationships"] == []
    assert any("LF4F-ML8" in w for w in result.warnings)
    assert any("cascaded to 1 relationship" in w for w in result.warnings)


def test_drop_living_does_not_excuse_a_missing_living_field():
    result = living_gate(_tree_with(_person("KNDX-MKG", "John", "Smith")), drop_living=True)
    assert result.errors


def test_the_110_year_rule_warns_about_a_recent_birth_with_no_death():
    person = _person("KNS4-P6W", "Kenneth", "Quass", living=False,
                     facts=[{"id": "F1", "type": "Birth", "standard_date": "4 December 1917"}])
    result = living_gate(_tree_with(person), heuristic=True, today=date(2026, 7, 9))
    assert result.errors == []
    assert any("born 1917" in w for w in result.warnings)


def test_the_110_year_rule_is_quiet_when_a_death_is_known():
    person = _person("KNS4-P6W", "Kenneth", "Quass", living=False, facts=[
        {"id": "F1", "type": "Birth", "standard_date": "1917"},
        {"id": "F2", "type": "Death", "standard_date": "1982"},
    ])
    assert living_gate(_tree_with(person), heuristic=True, today=date(2026, 7, 9)).warnings == []


def test_the_110_year_rule_never_runs_by_default():
    """Regression: stripping a death fact is exactly what makes a deceased
    person look living. `kenneth-quass-death`'s subject is born 1917 with no
    death fact in the starting tree *because his death is the answer*. Run the
    heuristic post-strip and it flags the subject of every death-date fixture.
    """
    person = _person("KNS4-P6W", "Kenneth", "Quass", living=False,
                     facts=[{"id": "F1", "type": "Birth", "standard_date": "1917"}])
    assert living_gate(_tree_with(person), today=date(2026, 7, 9)).warnings == []


def test_the_110_year_rule_is_quiet_for_an_undated_person():
    person = _person("I1", "John", "Smith", living=False)
    assert living_gate(_tree_with(person), heuristic=True, today=date(2026, 7, 9)).warnings == []


# --- the id index ----------------------------------------------------------


def test_the_index_names_every_id_strip_can_select(tree):
    # Exactly strip's four selectors, no more: name ids exist but aren't
    # strippable, so listing them would be noise the author can't act on.
    index = render_index(tree)
    for token in ("KNDX-MKG", BIRTH_1820, "R1", CENSUS_SOURCE):
        assert token in index


def test_the_index_reports_which_persons_a_source_cites(tree):
    assert "[cites: KNDX-MKG]" in render_index(tree)


def test_the_index_renders_facts_on_relationships(tree):
    # A person-only index would make a marriage fixture's answer invisible,
    # and unreachable by strip's --facts selector.
    marriage = [line for line in render_index(tree).splitlines() if "Marriage" in line]
    assert len(marriage) == 1
    assert MARRIAGE_1818 in marriage[0]


def test_the_index_shows_liveness(tree):
    assert "deceased" in render_index(tree)


# --- strip -----------------------------------------------------------------


def test_stripping_a_person_cascades_to_their_relationships(tree):
    result, removals, warnings, errors = apply_strip(tree, StripSpec(persons={"M4TT-2BC"}))
    assert errors == []
    assert [p["id"] for p in result["persons"]] == ["KNDX-MKG", "L2QR-9XY"]
    assert [r["id"] for r in result["relationships"]] == ["R1"]
    assert any("cascaded" in line for line in removals)


def test_stripping_a_fact_leaves_its_person_in_place(tree):
    result, removals, _, errors = apply_strip(tree, StripSpec(facts={("KNDX-MKG", DEATH_1879)}))
    assert errors == []
    john = result["persons"][0]
    assert [f["id"] for f in john["facts"]] == [BIRTH_1820]
    assert removals == [
        f"fact {DEATH_1879} on KNDX-MKG: Death 11 March 1879 Augusta Co., Virginia"
    ]


def test_stripping_a_fact_off_a_relationship(tree):
    result, _, _, errors = apply_strip(tree, StripSpec(facts={("R3", MARRIAGE_1818)}))
    assert errors == []
    assert "facts" not in result["relationships"][2]


def test_an_unknown_id_is_an_error_and_strips_nothing(tree):
    # A selector typo that silently no-ops would leave the answer in the tree,
    # which is the one failure mode this module exists to prevent.
    result, removals, _, errors = apply_strip(
        tree, StripSpec(persons={"NOPE-123"}, facts={("KNDX-MKG", "F99")})
    )
    assert len(errors) == 2
    assert removals == []
    assert result == tree


def test_strip_does_not_mutate_the_unstripped_tree(tree):
    before = copy.deepcopy(tree)
    apply_strip(tree, StripSpec(persons={"M4TT-2BC"}, sources={CENSUS_SOURCE}))
    assert tree == before


def test_stripping_a_source_removes_the_references_that_pointed_at_it(tree):
    result, _, warnings, errors = apply_strip(tree, StripSpec(sources={CENSUS_SOURCE}))
    assert errors == []
    assert [s["id"] for s in result["sources"]] == ["9V1G-YQQ"]
    assert "sources" not in result["persons"][0]["facts"][0]
    assert any("dangling" in w for w in warnings)


def test_a_person_left_with_no_facts_and_no_relationships_warns(tree):
    spec = StripSpec(relationships={"R1", "R2", "R3"}, facts={("M4TT-2BC", DEATH_1868)})
    _, _, warnings, errors = apply_strip(tree, spec)
    assert errors == []
    assert any("M4TT-2BC" in w and "orphaned" in w for w in warnings)


def test_the_stripped_tree_still_satisfies_the_schema(tree):
    result, _, _, _ = apply_strip(tree, StripSpec(persons={"M4TT-2BC"}, sources={CENSUS_SOURCE}))
    assert _schema_errors_for_tree(result) == []


def test_strip_spec_parsing_accepts_commas_and_repeats():
    args = author.build_parser().parse_args(
        ["strip", "--slug", "x", "--persons", "A,B", "--persons", "C",
         "--facts", "A:F1", "--facts", "R2:F9"]
    )
    spec = author.parse_strip_spec(args)
    assert spec.persons == {"A", "B", "C"}
    assert spec.facts == {("A", "F1"), ("R2", "F9")}


def test_a_fact_selector_without_an_owner_is_rejected():
    args = author.build_parser().parse_args(["strip", "--slug", "x", "--facts", "F1"])
    with pytest.raises(AuthorError, match="owner-id"):
        author.parse_strip_spec(args)


# --- scaffold --------------------------------------------------------------


def _scaffold_values(**overrides) -> dict:
    values = {
        "slug": "john-smith-parents", "slug_underscored": "john_smith_parents",
        "name": "John Smith — parents", "source_pid": "KNDX-MKG",
        "subject_person_id": "KNDX-MKG", "captured_date": "2026-07-09",
        "researcher_question": "Who were his parents?", "tag_question_type": "parents",
        "tag_era": "1850s", "tag_geography": "US-VA", "difficulty": "easy", "notes": "",
    }
    return {**values, **overrides}


def test_the_scaffolded_research_file_satisfies_the_research_schema():
    """Pins the `created`/`updated` fix: the old template wrote
    `2026-06-15T00:00:00Z`, and the schema's `iso_date` wants a bare date.
    All 26 committed fixtures inherited that bug from the template."""
    rendered = author.render_template("starting-research.json", _scaffold_values())
    assert validate_research_json(rendered) == []
    assert rendered["project"]["id"] == "rp_john_smith_parents"
    assert rendered["project"]["subject_person_ids"] == ["KNDX-MKG"]


def test_path_3_points_research_at_a_tree_person_that_exists():
    """`PID-TODO` stays as the greppable source_pid marker — provenance only,
    nothing resolves it — while a Path-3 tree is constructed by hand and calls
    its subject `I1`. `subject_person_ids` must name a person the tree actually
    contains, so it follows the tree, not the marker."""
    values = _scaffold_values(source_pid="PID-TODO", subject_person_id="I1")
    rendered = author.render_template("starting-research.json", values)
    assert rendered["project"]["subject_person_ids"] == ["I1"]
    assert author.render_template("fixture.json", values)["source_pid"] == "PID-TODO"


def test_substitution_survives_a_value_containing_quotes():
    # Walking the parsed JSON rather than the raw text is what makes this safe.
    out = _substitute({"notes": "{{notes}}"}, {"notes": 'He said "no" \\ maybe'})
    assert out == {"notes": 'He said "no" \\ maybe'}


def test_an_unfilled_placeholder_is_an_error():
    with pytest.raises(AuthorError, match="researcher_question"):
        _substitute({"objective": "{{researcher_question}}"}, {})


# --- validate --------------------------------------------------------------


def _finding(fid: str, name: str, ftype: str = "person") -> dict:
    return {"id": fid, "type": ftype, "details": {"target_person": {"name": name}}}


def test_the_presence_mirror_passes_when_the_answer_is_in_the_unstripped_tree(tree):
    findings = {"findings": [_finding("f1", "Robert Smith")]}
    assert presence_mirror(findings, tree) == []


def test_the_presence_mirror_catches_a_finding_that_was_never_in_the_tree(tree):
    # An author described a finding but never stripped it — or --drop-living
    # removed the answer.
    findings = {"findings": [_finding("f1", "Ebenezer Ferber")]}
    errors = presence_mirror(findings, tree)
    assert len(errors) == 1 and "f1" in errors[0]


def test_the_presence_mirror_skips_a_finding_with_no_nameable_target(tree):
    # Same skip the stripping linter makes — nothing to match on.
    assert presence_mirror({"findings": [{"id": "f1", "type": "fact"}]}, tree) == []


# --- drift audit -----------------------------------------------------------


def test_drift_reports_added_removed_and_changed_persons(tree):
    after = copy.deepcopy(tree)
    after["persons"] = after["persons"][:2]
    after["persons"][1]["facts"][0]["place"] = "North Carolina"
    after["persons"].append(_person("NEW1-234", "Ada", "Smith", living=False))
    report = diff_trees(tree, after)

    assert any("person gone upstream: M4TT-2BC" in line for line in report)
    assert any("person added upstream: NEW1-234" in line for line in report)
    assert any("person changed upstream: L2QR-9XY" in line for line in report)


def test_a_tree_does_not_drift_from_itself(tree):
    assert diff_trees(tree, copy.deepcopy(tree)) == []


def test_differing_ids_alone_are_not_drift(tree):
    """Committed unstripped trees carry the `F#` ids we used to mint; a fresh
    `snapshot` of the same person carries FamilySearch's UUIDs. If the audit
    compared ids it would report every such tree as wholly changed."""
    after = copy.deepcopy(tree)
    for i, fact in enumerate(after["persons"][0]["facts"]):
        fact["id"] = f"F{i + 90}"
    assert diff_trees(tree, after) == []


# --- windows -------------------------------------------------------------


def test_npx_is_invoked_through_cmd_on_windows(monkeypatch):
    # `npx` resolves to `npx.cmd`, which subprocess cannot exec (WinError 193),
    # and `tsx` is not resolvable from the engine's node_modules either.
    monkeypatch.setattr(author.os, "name", "nt")
    assert _npx(["tsx", "x.ts"]) == ["cmd", "/c", "npx", "tsx", "x.ts"]
    monkeypatch.setattr(author.os, "name", "posix")
    assert _npx(["tsx", "x.ts"]) == ["npx", "tsx", "x.ts"]
