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
import subprocess
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


def test_a_pid_less_fixture_points_research_at_a_tree_person_that_exists():
    """`PID-TODO` stays as the greppable source_pid marker — provenance only,
    nothing resolves it — while a PID-less tree is constructed by hand and calls
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
    # `--yes` keeps a cold npx cache from blocking on an invisible prompt.
    monkeypatch.setattr(author.os, "name", "nt")
    assert _npx(["tsx", "x.ts"]) == ["cmd", "/c", "npx", "--yes", "tsx", "x.ts"]
    monkeypatch.setattr(author.os, "name", "posix")
    assert _npx(["tsx", "x.ts"]) == ["npx", "--yes", "tsx", "x.ts"]


# --- duplicate ids ----------------------------------------------------------


def test_normalize_warns_about_duplicate_incoming_ids():
    raw = {
        "persons": [
            _person("P1", "John", "Smith", living=False),
            _person("P1", "Paul", "Smith", living=False),
        ],
        "relationships": [],
        "sources": [],
    }
    _, warnings = normalize_tree(raw)
    assert any("duplicate person id 'P1'" in w for w in warnings)


def test_strip_refuses_a_tree_with_duplicate_fact_ids():
    # Two facts sharing an id would BOTH be removed by one selector, and the
    # removals log would list only one — a silent, unrecorded removal from
    # the benchmark input.
    person = _person("P1", "John", "Smith", living=False, facts=[
        {"id": "F1", "type": "Birth", "date": "1900"},
        {"id": "F1", "type": "Death", "date": "1970"},
    ])
    tree = {"persons": [person], "relationships": [], "sources": []}
    result, removals, _, errors = apply_strip(tree, StripSpec(facts={("P1", "F1")}))
    assert removals == []
    assert result == tree
    assert any("duplicate fact id 'F1'" in e for e in errors)


def test_a_duplicate_couple_carrying_the_marriage_fact_keeps_the_fact():
    raw = {
        "persons": [
            _person("P1", "John", "Smith", living=False),
            _person("P2", "Jane", "Doe", living=False),
        ],
        "relationships": [
            {"type": "Couple", "person1": "P1", "person2": "P2"},
            {"type": "Couple", "person1": "P1", "person2": "P2",
             "facts": [{"type": "Marriage", "date": "1 May 1818"}]},
        ],
        "sources": [],
    }
    tree, warnings = normalize_tree(raw)
    assert len(tree["relationships"]) == 1
    assert tree["relationships"][0]["facts"][0]["type"] == "Marriage"
    assert any("plus the duplicate's facts" in w for w in warnings)


def test_a_relationship_with_an_unknown_type_is_dropped_with_a_warning():
    raw = {
        "persons": [_person("P1", "John", "Smith", living=False)],
        "relationships": [{"id": "R1", "type": "Godparent",
                           "person1": "P1", "person2": "P1"}],
        "sources": [],
    }
    tree, warnings = normalize_tree(raw)
    assert tree["relationships"] == []
    assert any("unknown type 'Godparent'" in w for w in warnings)


# --- fetch guards -----------------------------------------------------------


def _proc(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(
        args=[], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_a_malformed_pid_never_reaches_a_subprocess(monkeypatch):
    # On Windows the PID lands in a `cmd /c npx ...` argv, where subprocess
    # does not escape cmd.exe metacharacters — `KWZQ-8Q4&calc` would run
    # `calc`. The shape check must fire before any subprocess call.
    def boom(*args, **kwargs):
        raise AssertionError("subprocess must not run for a malformed PID")

    monkeypatch.setattr(author.subprocess, "run", boom)
    with pytest.raises(AuthorError, match="does not look like"):
        author.fetch_person_read("KWZQ-8Q4&calc")


def test_an_auth_failure_routes_to_the_login_hint(monkeypatch):
    monkeypatch.setattr(
        author.subprocess, "run",
        lambda *a, **kw: _proc(1, stderr="Error: Call the login tool to authenticate."),
    )
    with pytest.raises(AuthorError, match="Login.bat"):
        author.fetch_person_read("KNDX-MKG")


def test_a_tsx_crash_is_not_mistaken_for_an_auth_failure(monkeypatch):
    # "SyntaxError: Unexpected token" is a code bug; sending the author to
    # re-login over it is a dead end the old bare-"token" regex fell into.
    monkeypatch.setattr(
        author.subprocess, "run",
        lambda *a, **kw: _proc(1, stderr="SyntaxError: Unexpected token ')'"),
    )
    with pytest.raises(AuthorError) as excinfo:
        author.fetch_person_read("KNDX-MKG")
    assert "Login.bat" not in str(excinfo.value)


def test_non_json_stdout_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(
        author.subprocess, "run", lambda *a, **kw: _proc(0, stdout="<html>")
    )
    with pytest.raises(AuthorError, match="did not return JSON"):
        author.fetch_person_read("KNDX-MKG")


def test_a_missing_npx_is_a_clear_error(monkeypatch):
    def raise_fnf(*args, **kwargs):
        raise FileNotFoundError("npx")

    monkeypatch.setattr(author.subprocess, "run", raise_fnf)
    with pytest.raises(AuthorError, match="npx"):
        author.fetch_person_read("KNDX-MKG")


# --- cli guards (the write-protection paths) --------------------------------


@pytest.fixture
def fixtures_root(tmp_path, monkeypatch):
    monkeypatch.setattr(author, "FIXTURES_ROOT", tmp_path / "fixtures")
    (tmp_path / "fixtures").mkdir()
    return tmp_path / "fixtures"


def _raw_tree(**person_kw):
    return {
        "persons": [_person("KNDX-MKG", "John", "Smith", **person_kw)],
        "relationships": [],
        "sources": [],
    }


def _write_input(tmp_path, data, name="in.json"):
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_require_findings_refuses_when_the_file_is_missing(tmp_path):
    with pytest.raises(AuthorError, match="does not exist"):
        author._require_findings(tmp_path)


def test_require_findings_refuses_an_empty_findings_list(tmp_path):
    # An empty list would make the stripping linter pass vacuously — the
    # module's own stated worst failure mode.
    (tmp_path / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )
    with pytest.raises(AuthorError, match="no findings"):
        author._require_findings(tmp_path)


def test_snapshot_refuses_to_overwrite_without_force(fixtures_root, tmp_path, capsys):
    src = _write_input(tmp_path, _raw_tree(living=False))
    out = fixtures_root / "t" / "unstripped-tree.gedcomx.json"
    assert author.main(["snapshot", "--slug", "t", "--from-file", str(src)]) == 0
    first = out.read_text(encoding="utf-8")
    assert author.main(["snapshot", "--slug", "t", "--from-file", str(src)]) == 2
    assert out.read_text(encoding="utf-8") == first
    assert "already exists" in capsys.readouterr().err


def test_snapshot_from_file_refuses_a_tree_with_no_living_fields(fixtures_root, tmp_path, capsys):
    # Only person_read writes `living` — a hand-supplied tree without it
    # must refuse; absent is not deceased.
    src = _write_input(tmp_path, _raw_tree())
    assert author.main(["snapshot", "--slug", "t2", "--from-file", str(src)]) == 2
    assert not (fixtures_root / "t2" / "unstripped-tree.gedcomx.json").exists()
    assert "no `living` field" in capsys.readouterr().err


def test_check_excludes_living_persons_from_the_drift_audit(fixtures_root, tmp_path, capsys):
    # Committed trees never contain living persons, so a living person in
    # the live tree must not read as "person added upstream" forever.
    fixture_dir = fixtures_root / "c"
    fixture_dir.mkdir()
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(
        json.dumps(_raw_tree(living=False)), encoding="utf-8"
    )
    live = _raw_tree(living=False)
    live["persons"].append(_person("LF4F-ML8", "Paul", "Smith", living=True))
    src = _write_input(tmp_path, live, name="live.json")
    assert author.main(["snapshot", "--slug", "c", "--from-file", str(src), "--check"]) == 0
    captured = capsys.readouterr()
    assert "matches the committed unstripped tree" in captured.out
    assert "excluded 1 living person(s)" in captured.err


def test_strip_with_no_selectors_is_an_error(fixtures_root, tree, capsys):
    fixture_dir = fixtures_root / "s"
    fixture_dir.mkdir()
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(
        json.dumps(tree), encoding="utf-8"
    )
    assert author.main(["strip", "--slug", "s"]) == 2
    assert "nothing to strip" in capsys.readouterr().err


def test_strip_dry_run_writes_nothing_and_still_lints(fixtures_root, tree, capsys):
    # A clean dry run followed by a WARNing real run would be a trap: when
    # the findings exist, the dry run lints the in-memory candidate too.
    fixture_dir = fixtures_root / "s2"
    fixture_dir.mkdir()
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(
        json.dumps(tree), encoding="utf-8"
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": [_finding("f1", "John Smith")]}), encoding="utf-8"
    )
    rc = author.main(["strip", "--slug", "s2", "--facts", f"KNDX-MKG:{DEATH_1879}", "--dry-run"])
    assert rc == 0
    assert not (fixture_dir / "starting-tree.gedcomx.json").exists()
    captured = capsys.readouterr()
    assert "--dry-run: wrote nothing." in captured.out
    assert "f1" in captured.err  # the linter spoke: John Smith is still present


def test_strip_dry_run_still_works_before_the_findings_exist(fixtures_root, tree, capsys):
    fixture_dir = fixtures_root / "s3"
    fixture_dir.mkdir()
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(
        json.dumps(tree), encoding="utf-8"
    )
    rc = author.main(["strip", "--slug", "s3", "--persons", "M4TT-2BC", "--dry-run"])
    assert rc == 0
    assert not (fixture_dir / "starting-tree.gedcomx.json").exists()


def test_scaffold_refuses_to_overwrite_without_force(fixtures_root, capsys):
    args = [
        "scaffold", "--slug", "t5", "--name", "T5", "--pid", "KNDX-MKG",
        "--question", "Q?", "--question-type", "parents", "--era", "1850s",
        "--geography", "US-VA", "--difficulty", "easy",
    ]
    assert author.main(args) == 0
    assert author.main(args) == 2
    assert "already exist" in capsys.readouterr().err


def test_validate_flags_a_subject_id_that_names_nobody_in_the_tree(fixtures_root, tree, capsys):
    # The engine's runtime cross-file check would fail the agent mid-run on
    # this; the fixture gate has to catch it first.
    fixture_dir = fixtures_root / "v"
    fixture_dir.mkdir()
    research = author.render_template(
        "starting-research.json", _scaffold_values(subject_person_id="NOPE-123")
    )
    (fixture_dir / "starting-research.json").write_text(
        json.dumps(research), encoding="utf-8"
    )
    stripped, _, _, errors = apply_strip(tree, StripSpec(persons={"M4TT-2BC"}))
    assert errors == []
    (fixture_dir / "starting-tree.gedcomx.json").write_text(
        json.dumps(stripped), encoding="utf-8"
    )
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(
        json.dumps(tree), encoding="utf-8"
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": [_finding("f1", "Mary Jones")]}), encoding="utf-8"
    )
    assert author.main(["validate", "--slug", "v"]) == 2
    assert "subject_person_ids" in capsys.readouterr().err


def test_a_slug_with_path_separators_is_rejected():
    with pytest.raises(SystemExit):
        author.build_parser().parse_args(["validate", "--slug", "../evil"])


# --- drift audit (relationships, sources, values) ----------------------------


def test_drift_reports_relationship_and_source_changes(tree):
    after = copy.deepcopy(tree)
    after["relationships"] = after["relationships"][1:]
    after["relationships"].append(
        {"id": "R9", "type": "ParentChild", "parent": "ZZZZ-AAA", "child": "KNDX-MKG"}
    )
    after["sources"] = after["sources"][1:]
    after["sources"].append({"id": "NEW-SRC", "title": "A new register"})
    report = diff_trees(tree, after)
    assert any("relationship gone upstream" in line for line in report)
    assert any("relationship added upstream" in line for line in report)
    assert any("source gone upstream" in line for line in report)
    assert any("source added upstream: A new register" in line for line in report)


def test_a_changed_marriage_date_is_drift(tree):
    # The Couple's facts carry the answer of every marriage fixture — a
    # changed marriage date must not read as "matches".
    after = copy.deepcopy(tree)
    couple = after["relationships"][2]
    assert couple["type"] == "Couple"
    couple["facts"][0]["date"] = "1 January 1820"
    report = diff_trees(tree, after)
    assert any("relationship changed upstream" in line for line in report)


# --- presence mirror (one-half names) ----------------------------------------


def test_the_presence_mirror_accepts_a_target_named_by_one_name_half(tree):
    # An unknown-parent answer is named by surname alone ("the father,
    # ___ Smith"). Requiring both name halves would hard-fail every such
    # fixture with a misleading "was never in the tree".
    findings = {"findings": [_finding("f1", "Unknown Smith")]}
    assert presence_mirror(findings, tree) == []


# --- template substitution edge ----------------------------------------------


def test_a_value_containing_literal_braces_is_data_not_a_placeholder():
    out = _substitute({"notes": "{{notes}}"}, {"notes": "see the {{slug}} docs"})
    assert out == {"notes": "see the {{slug}} docs"}
