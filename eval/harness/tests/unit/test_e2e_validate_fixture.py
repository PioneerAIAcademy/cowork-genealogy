"""Unit tests for e2e.validate_fixture — the fixture linter.

`lint_fixture` has two gates: the JSON Schemas, and the deterministic
name-token overlap that catches an answer left un-stripped. These exercise
both against synthetic findings/trees; no fixture files or skill runs
involved.
"""

from __future__ import annotations

import json

import pytest

from pathlib import Path

import e2e.validate_fixture as vf
from e2e.validate_fixture import (
    _resolve_target,
    check_stripping,
    finding_shape_errors,
    lint_fixture,
    record_hint_citation_errors,
)


# --- helpers ----------------------------------------------------------

def _person(pid, given, surname, fact_types=()):
    return {
        "id": pid,
        "names": [{"given": given, "surname": surname}],
        "facts": [{"type": t} for t in fact_types],
    }


def _valid_tree(*persons):
    """A schema-complete document. `check_stripping` reads only `persons`, but
    `lint_fixture` validates the whole tree, so its input needs the rest."""
    return {"persons": list(persons), "relationships": [], "sources": []}


def _valid_person(pid, given, surname):
    return {
        "id": pid,
        "gender": "Male",
        "living": False,
        "names": [{"id": f"N-{pid}", "given": given, "surname": surname}],
    }


def _rel_finding(target_name, fid="f1"):
    return {
        "id": fid,
        "type": "relationship",
        "description": f"John Smith's father is {target_name}",
        "details": {"target_person": {"name": target_name}},
    }


# --- relationship findings -------------------------------------------

def test_stripped_relationship_target_gone_no_suspect():
    """Subject (John Smith) legitimately stays; target (Robert Smith) was
    stripped — the tree no longer contains Robert, so no suspect."""
    expected = {"findings": [_rel_finding("Robert Smith")]}
    tree = {"persons": [_person("I1", "John", "Smith")]}  # only the subject
    assert check_stripping(expected, tree) == []


def test_unstripped_relationship_target_present_flags_suspect():
    """Robert Smith is still in the tree — the answer wasn't stripped."""
    expected = {"findings": [_rel_finding("Robert Smith")]}
    tree = {
        "persons": [
            _person("I1", "John", "Smith"),
            _person("I9", "Robert", "Smith"),  # the un-stripped answer
        ]
    }
    suspects = check_stripping(expected, tree)
    assert len(suspects) == 1
    assert suspects[0].finding_id == "f1"
    assert suspects[0].person_id == "I9"
    assert {"robert", "smith"} <= suspects[0].shared


def test_partial_name_overlap_does_not_flag():
    """A person sharing only the surname (Mary Smith) is not Robert Smith —
    requiring both given and surname overlap avoids this false positive."""
    expected = {"findings": [_rel_finding("Robert Smith")]}
    tree = {"persons": [_person("I2", "Mary", "Smith")]}
    assert check_stripping(expected, tree) == []


def test_an_avoid_finding_still_flags_but_carries_its_polarity():
    """A `polarity: "avoid"` claim must be as absent from the starting tree
    as a recover answer (a pre-asserted wrong claim breaks the fixture the
    other way) — same matcher, but the WARN advice differs (spec §3.4.1)."""
    finding = _rel_finding("Robert Smith")
    finding["polarity"] = "avoid"
    tree = {
        "persons": [
            _person("I1", "John", "Smith"),
            _person("I9", "Robert", "Smith"),  # the pre-asserted wrong claim
        ]
    }
    suspects = check_stripping({"findings": [finding]}, tree)
    assert len(suspects) == 1
    assert suspects[0].polarity == "avoid"
    warn = vf.format_suspect("fx", suspects[0])
    assert "avoid" in warn
    assert "must NOT" in warn


# --- non-ASCII names (issue #3490) -----------------------------------

def test_cyrillic_unstripped_target_flags_suspect():
    """An all-Cyrillic answer left in the tree is caught. With an ASCII-only
    letter class every Cyrillic name tokenized to nothing and never matched."""
    expected = {"findings": [_rel_finding("Григорий Захаров Кокоша")]}
    tree = {"persons": [
        _person("I1", "Захар Иванов", "Кокошенко"),
        _person("I9", "Григорий Захаров", "Кокоша"),  # the un-stripped answer
    ]}
    suspects = check_stripping(expected, tree)
    assert [s.person_id for s in suspects] == ["I9"]
    assert {"кокоша", "захаров"} <= suspects[0].shared


def test_cyrillic_surname_only_overlap_does_not_flag():
    expected = {"findings": [_rel_finding("Григорий Кокоша")]}
    tree = {"persons": [_person("I2", "Илья", "Кокоша")]}
    assert check_stripping(expected, tree) == []


def test_accented_name_is_one_token_and_matches_its_unaccented_spelling():
    """"João" must not split into "jo" + "o"; folding lets it match "Joao"."""
    assert vf._tokens("João Gomes") == {"joao", "gomes"}
    expected = {"findings": [_rel_finding("João Gomes de Sousa")]}
    tree = {"persons": [_person("I9", "Joao", "Gomes de Souza")]}
    assert [s.person_id for s in check_stripping(expected, tree)] == ["I9"]


def test_cli_prints_a_cyrillic_warn_on_a_cp1252_console(tmp_path):
    """The WARN line now carries Cyrillic tokens; on a Windows console
    (cp1252) printing it must not raise UnicodeEncodeError."""
    import os
    import subprocess
    import sys

    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I9", "Григорий", "Кокоша")),
        findings={"findings": [_rel_finding("Григорий Кокоша")]},
    )
    proc = subprocess.run(
        [sys.executable, "-m", "e2e.validate_fixture", str(tmp_path)],
        cwd=Path(vf.__file__).resolve().parents[1],
        env={**os.environ, "PYTHONIOENCODING": "cp1252"},
        capture_output=True,
        encoding="utf-8",
    )
    assert proc.returncode == 0, proc.stderr
    assert "кокоша" in proc.stdout


# --- subject-person leak regression (spriggs-parents-1898) -----------

def _rel_finding_with_subject(target_name, subject_name, fid="f1"):
    """A relationship finding shaped like the skill's template: the subject
    person is a nested object `{name, pid}`. The nested `name` key is itself
    a target key, which is what let the subject's name leak into the match
    bag — the bug this section pins."""
    return {
        "id": fid,
        "type": "relationship",
        "description": f"{target_name} was the father of {subject_name}",
        "details": {
            "subject_person": {"name": subject_name, "pid": "SUBJ-1"},
            "relation": "father",
            "target_person": {"name": target_name, "birth": "1872 Iowa"},
        },
    }


def test_subject_person_name_does_not_leak_into_target():
    """Regression: `subject_person.name` must not be matched as a target.
    The subject (and any same-named relative) legitimately stay in the
    stripped tree; only the target parent is the answer. Real case:
    spriggs-parents-1898 flagged the subject + a same-named descendant on
    [reuben, spencer, spriggs]. Target (John William Spriggs) is absent →
    no suspects."""
    expected = {"findings": [_rel_finding_with_subject(
        target_name="John William Spriggs", subject_name="Reuben Spencer Spriggs")]}
    tree = {"persons": [
        _person("L64C-QQX", "Reuben Spencer", "Spriggs"),  # the subject — stays
        _person("LFT9-PDR", "Reuben Spencer", "Spriggs"),  # same-named kin — stays
        _person("LFT9-PXM", "Donna Jean", "Spriggs"),      # another relative — stays
    ]}
    assert check_stripping(expected, tree) == []


def test_unstripped_target_still_flagged_with_subject_object():
    """The subject-prune must not blind the linter to a real miss: if the
    target parent is still in the tree, it is still a suspect."""
    expected = {"findings": [_rel_finding_with_subject(
        target_name="John William Spriggs", subject_name="Reuben Spencer Spriggs")]}
    tree = {"persons": [
        _person("L64C-QQX", "Reuben Spencer", "Spriggs"),  # subject — stays
        _person("XXXX-DAD", "John William", "Spriggs"),    # un-stripped father
    ]}
    suspects = check_stripping(expected, tree)
    assert [s.person_id for s in suspects] == ["XXXX-DAD"]
    assert suspects[0].finding_id == "f1"


# --- fact findings ----------------------------------------------------

def _fact_finding(name, kind, fid="f1"):
    return {
        "id": fid,
        "type": "fact",
        "description": f"{name}'s {kind} date",
        "details": {"subject_person": name, "fact": kind},
    }


def test_fact_stripped_person_stays_no_suspect():
    """For a fact finding, the person legitimately remains; only the fact
    is stripped. Person present + fact type absent → not a suspect."""
    expected = {"findings": [_fact_finding("Mary Jones", "death")]}
    tree = {"persons": [_person("I1", "Mary", "Jones", fact_types=["Birth"])]}
    assert check_stripping(expected, tree) == []


def test_fact_still_present_flags_suspect():
    """The death fact is still on Mary Jones — not stripped."""
    expected = {"findings": [_fact_finding("Mary Jones", "death")]}
    tree = {"persons": [_person("I1", "Mary", "Jones", fact_types=["Death"])]}
    suspects = check_stripping(expected, tree)
    assert len(suspects) == 1
    assert suspects[0].finding_type == "fact"


# --- lint_fixture file handling --------------------------------------

def test_lint_fixture_missing_files_is_hard_error(tmp_path):
    suspects, errors = lint_fixture(tmp_path)
    assert suspects == []
    assert errors  # missing both required files


def test_lint_fixture_unparseable_tree_is_hard_error(tmp_path):
    (tmp_path / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )
    (tmp_path / "starting-tree.gedcomx.json").write_text("{not json", encoding="utf-8")
    suspects, errors = lint_fixture(tmp_path)
    assert suspects == []
    assert any("did not parse" in e for e in errors)


def _write_fixture(path, tree, findings=None, research=None):
    (path / "expected-findings.json").write_text(
        json.dumps(findings or {"findings": [_rel_finding("Robert Smith")]}), encoding="utf-8"
    )
    (path / "starting-tree.gedcomx.json").write_text(json.dumps(tree), encoding="utf-8")
    if research is not None:
        (path / "starting-research.json").write_text(json.dumps(research), encoding="utf-8")


def test_lint_fixture_clean_fixture_passes(tmp_path):
    # No starting-research.json: a PID-less fixture under construction may not
    # have one yet, and its absence is not an error.
    _write_fixture(tmp_path, _valid_tree(_valid_person("I1", "John", "Smith")))
    suspects, errors = lint_fixture(tmp_path)
    assert errors == []
    assert suspects == []


def test_lint_fixture_reports_tree_schema_errors(tmp_path):
    # The defect that shipped in three committed fixtures: a ParentChild
    # written with a Couple's endpoint keys. `tree_edit` hard-fails on it, so
    # the agent had to repair our fixture mid-run before it could write.
    tree = _valid_tree(_valid_person("I1", "John", "Smith"))
    tree["relationships"] = [
        {"id": "R1", "type": "ParentChild", "person1": "I1", "person2": "I1"}
    ]
    _write_fixture(tmp_path, tree)
    _, errors = lint_fixture(tmp_path)
    assert any("starting-tree.gedcomx.json" in e for e in errors)


def test_lint_fixture_reports_research_schema_errors(tmp_path):
    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I1", "John", "Smith")),
        research={"project": {"id": "rp_x"}},  # missing most required keys
    )
    _, errors = lint_fixture(tmp_path)
    assert any("starting-research.json" in e for e in errors)


def test_lint_fixture_schema_errors_suppress_the_stripping_check(tmp_path):
    # A tree the schema rejects can't be trusted to answer "was the finding
    # stripped?" — report the schema first and stop.
    _write_fixture(tmp_path, {"persons": [_person("I1", "John", "Smith")]})
    suspects, errors = lint_fixture(tmp_path)
    assert errors and suspects == []


# --- positional-arg resolution (path or bare slug) -------------------

def test_resolve_target_existing_path_used_as_is(tmp_path):
    """A path that exists is returned unchanged."""
    assert _resolve_target(tmp_path) == tmp_path


def test_resolve_target_bare_slug_resolves_against_root(tmp_path, monkeypatch):
    """A bare slug (no such path in cwd) resolves under the fixtures root."""
    monkeypatch.setattr(vf, "DEFAULT_FIXTURES_ROOT", tmp_path)
    (tmp_path / "my-fixture").mkdir()
    assert _resolve_target(Path("my-fixture")) == tmp_path / "my-fixture"


def test_resolve_target_unknown_name_falls_back_to_path(tmp_path, monkeypatch):
    """An argument that's neither an existing path nor a known slug is
    returned as-is, so lint_fixture emits the missing-file error against it."""
    monkeypatch.setattr(vf, "DEFAULT_FIXTURES_ROOT", tmp_path)
    arg = Path("does-not-exist")
    assert _resolve_target(arg) == arg


# --- structural integrity (what JSON Schema cannot express) ------------------


def test_lint_fixture_rejects_a_dangling_relationship_endpoint(tmp_path):
    # Lints clean under JSON Schema 2020-12, hard-fails tree_edit mid-run —
    # the runtime-vs-fixture gate gap the authoring work called out.
    tree = _valid_tree(_valid_person("I1", "John", "Smith"))
    tree["relationships"] = [
        {"id": "R1", "type": "ParentChild", "parent": "I1", "child": "GONE-123"}
    ]
    _write_fixture(tmp_path, tree)
    _, errors = lint_fixture(tmp_path)
    assert any("GONE-123" in e and "dangling" in e for e in errors)


def test_lint_fixture_rejects_a_dangling_source_ref(tmp_path):
    person = _valid_person("I1", "John", "Smith")
    person["facts"] = [
        {"id": "F1", "type": "Birth", "sources": [{"ref": "GONE-SRC"}]}
    ]
    _write_fixture(tmp_path, _valid_tree(person))
    _, errors = lint_fixture(tmp_path)
    assert any("GONE-SRC" in e for e in errors)


def test_lint_fixture_rejects_duplicate_ids(tmp_path):
    tree = _valid_tree(
        _valid_person("I1", "John", "Smith"),
        _valid_person("I1", "Paul", "Smith"),
    )
    _write_fixture(tmp_path, tree)
    _, errors = lint_fixture(tmp_path)
    assert any("duplicate person id 'I1'" in e for e in errors)


def test_lint_fixture_rejects_a_living_person(tmp_path):
    person = _valid_person("I1", "John", "Smith")
    person["living"] = True
    _write_fixture(tmp_path, _valid_tree(person))
    _, errors = lint_fixture(tmp_path)
    assert any("marked living" in e for e in errors)


def test_lint_fixture_rejects_a_missing_living_field(tmp_path):
    # Absent is not deceased — mirrors living_gate rule 2 in e2e.author, so
    # the per-slug authoring gate and this corpus-wide gate cannot disagree.
    person = _valid_person("I1", "John", "Smith")
    del person["living"]
    _write_fixture(tmp_path, _valid_tree(person))
    _, errors = lint_fixture(tmp_path)
    assert any("no `living` field" in e for e in errors)


def test_lint_fixture_holds_the_unstripped_tree_to_the_same_bar(tmp_path):
    # The unstripped tree is committed too — it is where --drop-living
    # mistakes and living persons would hide.
    _write_fixture(tmp_path, _valid_tree(_valid_person("I1", "John", "Smith")))
    bad = _valid_tree(_valid_person("I2", "Paul", "Smith"))
    bad["persons"][0]["living"] = True
    (tmp_path / "unstripped-tree.gedcomx.json").write_text(
        json.dumps(bad), encoding="utf-8"
    )
    _, errors = lint_fixture(tmp_path)
    assert any(e.startswith("unstripped-tree.gedcomx.json:") and "marked living" in e
               for e in errors)


def test_lint_fixture_rejects_a_name_without_given(tmp_path):
    # The mononym alignment: `given` is required by the schema so it agrees
    # with the runtime validator, the spec table, and the TS types. Unknown
    # given names are spelled "" (the engine's living-person-stub convention).
    person = _valid_person("I1", "John", "Smith")
    del person["names"][0]["given"]
    _write_fixture(tmp_path, _valid_tree(person))
    _, errors = lint_fixture(tmp_path)
    assert any("given" in e for e in errors)


def test_an_empty_given_is_the_unknown_spelling_and_passes(tmp_path):
    _write_fixture(tmp_path, _valid_tree(_valid_person("I1", "", "Smith")))
    _, errors = lint_fixture(tmp_path)
    assert errors == []


def test_lint_fixture_rejects_a_lowercase_fact_type(tmp_path):
    # The fact-type value list is open, but the enum's `pattern` pins the
    # upper-initial the runtime hard-fails on — a lowercase "move" copied
    # from research.json must die at the lint, not mid-run in tree_edit.
    person = _valid_person("I1", "John", "Smith")
    person["facts"] = [{"id": "F1", "type": "move"}]
    _write_fixture(tmp_path, _valid_tree(person))
    _, errors = lint_fixture(tmp_path)
    assert any("'move'" in e and "[A-Z]" in e for e in errors)


# --- finding shape (spec §3.4) — expected-findings.json has no JSON Schema,
# so this is the only thing standing between a made-up field and a fixture
# that silently grades nothing (the `"expectation": "not_found"` bug that
# shipped across issues #852-883) -----------------------------------------


def test_finding_shape_rejects_an_unrecognized_field():
    finding = _rel_finding("Robert Smith")
    finding["expectation"] = "not_found"  # the actual mistake, spec §3.6
    errors = finding_shape_errors({"findings": [finding]})
    assert any("expectation" in e and "not a real field" in e for e in errors)


def test_finding_shape_accepts_all_known_fields():
    finding = _rel_finding("Robert Smith")
    finding["polarity"] = "avoid"
    finding["supporting_sources"] = ["a census"]
    finding["required"] = True
    assert finding_shape_errors({"findings": [finding]}) == []


def test_finding_shape_rejects_an_out_of_enum_type():
    finding = _rel_finding("Robert Smith")
    finding["type"] = "relationshp"  # typo
    errors = finding_shape_errors({"findings": [finding]})
    assert any("relationshp" in e for e in errors)


def test_finding_shape_rejects_an_out_of_enum_polarity():
    finding = _rel_finding("Robert Smith")
    finding["polarity"] = "reject"  # not "avoid"
    errors = finding_shape_errors({"findings": [finding]})
    assert any("reject" in e for e in errors)


def test_finding_shape_rejects_a_non_boolean_required():
    finding = _rel_finding("Robert Smith")
    finding["required"] = "true"  # string, not bool
    errors = finding_shape_errors({"findings": [finding]})
    assert any("non-boolean" in e for e in errors)


def test_finding_shape_rejects_duplicate_ids():
    findings = {
        "findings": [_rel_finding("Robert Smith", fid="f1"), _rel_finding("Mary Jones", fid="f1")]
    }
    errors = finding_shape_errors(findings)
    assert any("duplicate finding id 'f1'" in e for e in errors)


def test_finding_shape_does_not_require_any_field_present():
    # A draft mid-authoring shouldn't be punished for an omission that isn't
    # this check's job — `check_stripping`/the schema-less README convention
    # cover completeness elsewhere.
    assert finding_shape_errors({"findings": [{"id": "f1"}]}) == []


def test_lint_fixture_rejects_an_unrecognized_finding_field(tmp_path):
    finding = _rel_finding("Robert Smith")
    finding["expectation"] = "not_found"
    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I1", "John", "Smith")),
        findings={"findings": [finding]},
    )
    _, errors = lint_fixture(tmp_path)
    assert any("expectation" in e for e in errors)


# --- record-hint ark citation (issue #970 / #1025) --------------------

_UNSET = object()  # distinguishes "omit image_basis"/"omit hint" from writing `null`

_VALID_HINT = {"persona_ark": "ark:/61903/1:1:6PFD-Q43C", "identity": "different"}


def _commit_snapshot(fixture_dir) -> None:
    """A record-hint fixture commits its unstripped tree identical to its
    starting tree, and `lint_fixture` fails one that does not."""
    start = fixture_dir / "starting-tree.gedcomx.json"
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(start.read_text(encoding="utf-8"), encoding="utf-8")


def _write_record_hint_meta(
    fixture_dir,
    *,
    resolved: bool,
    genre: str = "record-hint",
    image_basis=_UNSET,
    hint=_VALID_HINT,
    source_pid=_UNSET,
):
    meta = {"id": fixture_dir.name, "genre": genre}
    if source_pid is not _UNSET:
        meta["source_pid"] = source_pid
    if image_basis is not _UNSET:
        meta["image_basis"] = image_basis  # may be a non-bool / None on purpose
    if hint is not _UNSET:
        meta["hint"] = hint  # may be malformed / None on purpose
    (fixture_dir / "fixture.json").write_text(json.dumps(meta), encoding="utf-8")
    body = "Notes for reviewers\n\n" + (
        "Resolved: false match, no findable substitute."
        if resolved
        else "DRAFT PENDING ADJUDICATION. Transcribed from an unverified hint."
    )
    (fixture_dir / "README.md").write_text(body, encoding="utf-8")


def _avoid_pair_findings(supporting_sources_by_finding):
    """Two findings shaped like a resolved record-hint negative (spec
    §3.4.1): an `avoid` guard and a paired required conclusion. Each
    finding's `supporting_sources` comes from `supporting_sources_by_finding`,
    keyed `"f1"` / `"f2"`."""
    return {
        "findings": [
            {
                "id": "f1",
                "type": "fact",
                "polarity": "avoid",
                "description": "must not assert the hinted claim",
                "supporting_sources": supporting_sources_by_finding.get("f1", []),
                "required": True,
            },
            {
                "id": "f2",
                "type": "fact",
                "description": "documents the negative conclusion",
                "supporting_sources": supporting_sources_by_finding.get("f2", []),
                "required": True,
            },
        ]
    }


def test_record_hint_citation_errors_skips_non_record_hint_genre(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, genre="strip")
    findings = _avoid_pair_findings({"f2": ["no ark anywhere"]})
    assert record_hint_citation_errors(tmp_path, findings) == []


def test_record_hint_citation_errors_skips_draft_fixtures(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=False)
    findings = _avoid_pair_findings({"f2": ["still just a transcribed hint, no ark"]})
    assert record_hint_citation_errors(tmp_path, findings) == []


def test_record_hint_citation_errors_requires_an_ark_on_resolution(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True)
    findings = _avoid_pair_findings(
        {"f2": ["Absence of any record in the collection establishing this"]}
    )
    errors = record_hint_citation_errors(tmp_path, findings)
    assert any("ark:/61903/" in e for e in errors)


def test_record_hint_citation_errors_rejects_a_bare_ark_prefix(tmp_path):
    # An `ark:/61903/` with no record path resolves to nothing, so it would be
    # an even cheaper shortcut than the bare id rejected below.
    _write_record_hint_meta(tmp_path, resolved=True)
    findings = _avoid_pair_findings({"f1": ["disproving record, ark:/61903/"]})
    errors = record_hint_citation_errors(tmp_path, findings)
    assert any("ark:/61903/" in e for e in errors)


def test_record_hint_citation_errors_rejects_a_bare_id(tmp_path):
    # Issue #970's rejected shortcut: a bare id is shape-identical to a tree
    # PID and matches collection date ranges on their own — not discriminating.
    _write_record_hint_meta(tmp_path, resolved=True)
    findings = _avoid_pair_findings({"f1": ["disproving record, ark QL7X-YN65"]})
    errors = record_hint_citation_errors(tmp_path, findings)
    assert any("ark:/61903/" in e for e in errors)


def test_record_hint_citation_errors_passes_with_ark_on_the_disproving_finding(tmp_path):
    # Issue #1025's split: the ark attaches to the disproving record (here,
    # on f1, the avoid finding); the absence on f2 carries none and that's fine.
    _write_record_hint_meta(tmp_path, resolved=True)
    findings = _avoid_pair_findings(
        {
            "f1": ["Marriage record, 7 Feb 1871 (ark:/61903/1:1:6PFD-Q43C) — disproving record"],
            "f2": ["No record in the collection establishes a findable substitute"],
        }
    )
    assert record_hint_citation_errors(tmp_path, findings) == []


def test_lint_fixture_hard_fails_a_resolved_record_hint_fixture_with_no_ark(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True)
    findings = _avoid_pair_findings({"f2": ["no ark anywhere in this fixture"]})
    _write_fixture(tmp_path, _valid_tree(_valid_person("I1", "John", "Smith")), findings=findings)
    _, errors = lint_fixture(tmp_path)
    assert any("ark:/61903/" in e for e in errors)


def test_lint_fixture_passes_a_resolved_record_hint_fixture_with_an_ark(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True)
    findings = _avoid_pair_findings(
        {"f1": ["disproving record (ark:/61903/1:1:6PFD-Q43C)"]}
    )
    _write_fixture(tmp_path, _valid_tree(_valid_person("I1", "John", "Smith")), findings=findings)
    _commit_snapshot(tmp_path)
    _, errors = lint_fixture(tmp_path)
    assert errors == []


# --- image_basis flag (issue #2877) -----------------------------------
#
# `image_basis` is a declared flag: a record-hint resolution that rested on
# reading the original page images sets `"image_basis": true`, which raises the
# citation bar from "any full ark" to "an image ark (3:1:/3:2:)". The check
# keys on the flag, NOT on README prose about images — the pair of tests below
# proves it, since identical findings (only index arks) pass with the flag
# absent and fail with it on.

_INDEX_ONLY = {"f1": ["marriage register (ark:/61903/1:1:6PFD-Q43C)"]}
_WITH_IMAGE = {"f1": ["marriage register image (ark:/61903/3:1:9Q97-YSRZ-GWP)"]}


def test_image_basis_true_requires_an_image_ark(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=True)
    errors = record_hint_citation_errors(tmp_path, _avoid_pair_findings(_INDEX_ONLY))
    assert any("image ark" in e for e in errors)


def test_image_basis_true_passes_with_an_image_ark(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=True)
    assert record_hint_citation_errors(tmp_path, _avoid_pair_findings(_WITH_IMAGE)) == []


def test_image_basis_absent_passes_with_only_index_arks(tmp_path):
    # The other half of the meaningful pair: identical index-only findings, no
    # flag. A one-directional test would pass even if the check ignored the flag.
    _write_record_hint_meta(tmp_path, resolved=True)
    assert record_hint_citation_errors(tmp_path, _avoid_pair_findings(_INDEX_ONLY)) == []


def test_image_basis_false_passes_with_only_index_arks(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=False)
    assert record_hint_citation_errors(tmp_path, _avoid_pair_findings(_INDEX_ONLY)) == []


def test_image_basis_non_bool_string_is_error(tmp_path):
    # "true" would read as truthy and wrongly enable the check; it must be a
    # hard error instead, even though the findings carry a valid image ark.
    _write_record_hint_meta(tmp_path, resolved=True, image_basis="true")
    errors = record_hint_citation_errors(tmp_path, _avoid_pair_findings(_WITH_IMAGE))
    assert any("must be a boolean" in e for e in errors)


def test_image_basis_non_bool_int_is_error(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=1)
    errors = record_hint_citation_errors(tmp_path, _avoid_pair_findings(_WITH_IMAGE))
    assert any("must be a boolean" in e for e in errors)


def test_image_basis_null_is_error(tmp_path):
    # JSON null -> Python None; caught via key presence, distinct from absent.
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=None)
    errors = record_hint_citation_errors(tmp_path, _avoid_pair_findings(_WITH_IMAGE))
    assert any("must be a boolean" in e for e in errors)


def test_image_basis_non_bool_does_not_also_fire_the_image_check(tmp_path):
    # Strict `is True`: a non-bool is flagged for its type but must NOT ALSO
    # trigger the image-ark check, or one typo yields two errors for one cause.
    _write_record_hint_meta(tmp_path, resolved=True, image_basis="true")
    errors = record_hint_citation_errors(tmp_path, _avoid_pair_findings(_INDEX_ONLY))
    assert any("must be a boolean" in e for e in errors)
    assert not any("image ark" in e for e in errors)


def test_image_basis_ignored_on_strip_genre(tmp_path):
    # The non-record-hint skip precedes the flag check, so a strip fixture with
    # image_basis true and no ark at all is not checked here at all.
    _write_record_hint_meta(tmp_path, resolved=True, genre="strip", image_basis=True)
    assert record_hint_citation_errors(tmp_path, _avoid_pair_findings({})) == []


def test_image_basis_ignored_on_draft(tmp_path):
    # The draft-marker skip likewise precedes the flag check.
    _write_record_hint_meta(tmp_path, resolved=False, image_basis=True)
    assert record_hint_citation_errors(tmp_path, _avoid_pair_findings(_INDEX_ONLY)) == []


def test_lint_fixture_hard_fails_image_basis_true_without_an_image_ark(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=True)
    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I1", "John", "Smith")),
        findings=_avoid_pair_findings(_INDEX_ONLY),
    )
    _, errors = lint_fixture(tmp_path)
    assert any("image ark" in e for e in errors)


def test_lint_fixture_passes_image_basis_true_with_an_image_ark(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, image_basis=True)
    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I1", "John", "Smith")),
        findings=_avoid_pair_findings(_WITH_IMAGE),
    )
    _commit_snapshot(tmp_path)
    _, errors = lint_fixture(tmp_path)
    assert errors == []


@pytest.mark.parametrize(
    "slug",
    ["heinrich-zinsmeister-death", "katalin-horak-son", "cornelius-booysen-death"],
)
def test_committed_no_image_read_fixtures_still_pass(slug):
    # These resolved record-hint fixtures mention images in their README only to
    # record that the reading was NOT relied on; they set no image_basis flag.
    # The check keys on the flag, not the README wording, so they must pass.
    fixture_dir = vf.DEFAULT_FIXTURES_ROOT / slug
    assert fixture_dir.is_dir(), f"missing corpus fixture {slug}"
    _, errors = lint_fixture(fixture_dir)
    assert errors == [], errors


# --- fixture.json `hint` (issue #3553) --------------------------------
#
# A resolved record-hint fixture declares the hinted persona and the
# genealogist's identity judgement, which `make matcher-accuracy` scores.
# Every case below carries a valid ark in its findings, so the only error
# that can fire is the hint check's.

_HINT_FINDINGS = _avoid_pair_findings(_INDEX_ONLY)


def _hint_errors_for(
    tmp_path, hint, *, resolved=True, genre="record-hint", source_pid=_UNSET
):
    _write_record_hint_meta(
        tmp_path, resolved=resolved, genre=genre, hint=hint, source_pid=source_pid
    )
    return record_hint_citation_errors(tmp_path, _HINT_FINDINGS)


def test_hint_missing_on_a_resolved_fixture_is_error(tmp_path):
    errors = _hint_errors_for(tmp_path, _UNSET)
    assert len(errors) == 1
    assert "has no `hint` key" in errors[0]


def test_lint_fixture_hard_fails_a_resolved_fixture_with_no_hint(tmp_path):
    _write_record_hint_meta(tmp_path, resolved=True, hint=_UNSET)
    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I1", "John", "Smith")),
        findings=_HINT_FINDINGS,
    )
    _, errors = lint_fixture(tmp_path)
    assert any("has no `hint` key" in e for e in errors)


def test_hint_explicit_null_is_accepted(tmp_path):
    assert _hint_errors_for(tmp_path, None) == []


def test_hint_not_required_on_a_draft(tmp_path):
    assert _hint_errors_for(tmp_path, _UNSET, resolved=False) == []


def test_hint_not_required_on_a_strip_fixture(tmp_path):
    assert _hint_errors_for(tmp_path, _UNSET, genre="strip") == []


def test_malformed_hint_on_a_draft_is_not_checked(tmp_path):
    assert _hint_errors_for(tmp_path, "same", resolved=False) == []


@pytest.mark.parametrize("identity", ["same", "different", "unresolved"])
def test_hint_with_each_identity_is_accepted(tmp_path, identity):
    hint = {"persona_ark": "ark:/61903/1:1:6PFD-Q43C", "identity": identity}
    assert _hint_errors_for(tmp_path, hint) == []


@pytest.mark.parametrize(
    "persona_ark",
    ["ark:/61903/1:1:6PFD-Q43C", "ark:/61903/1:1:QVS9-DHD", "ark:/61903/1:1:K8T2-9X"],
    ids=["4-4", "4-3", "4-2"],
)
def test_hint_accepts_every_persona_id_shape(tmp_path, persona_ark):
    hint = {"persona_ark": persona_ark, "identity": "same"}
    assert _hint_errors_for(tmp_path, hint) == []


def test_hint_key_order_does_not_matter(tmp_path):
    hint = {"identity": "unresolved", "persona_ark": "ark:/61903/1:1:6PFD-Q43C"}
    assert _hint_errors_for(tmp_path, hint) == []


@pytest.mark.parametrize(
    "identity",
    ["Same", "SAME", " same", "same ", True, False, "1", 1, 2, "2", None, "yes", ""],
)
def test_hint_bad_identity_is_error(tmp_path, identity):
    hint = {"persona_ark": "ark:/61903/1:1:6PFD-Q43C", "identity": identity}
    errors = _hint_errors_for(tmp_path, hint)
    assert len(errors) == 1
    assert "`hint.identity` must be one of" in errors[0]


def test_hint_missing_identity_is_error(tmp_path):
    errors = _hint_errors_for(tmp_path, {"persona_ark": "ark:/61903/1:1:6PFD-Q43C"})
    assert len(errors) == 1
    assert "`hint.identity` is missing" in errors[0]


@pytest.mark.parametrize(
    "persona_ark",
    [
        "ark:/61903/1:2:4BT2-KM71",
        "ark:/61903/3:1:9Q97-YSRZ-GWP",
        "ark:/61903/3:2:77TF-QRBM",
        "6PFD-Q43C",
        "LZ1N-QK9",
        "ark:/61903/4:1:LZ1N-QK9",
        "https://www.familysearch.org/ark:/61903/1:1:6PFD-Q43C",
        "ark:/61903/1:1:6PFD-Q43C\n",
        "ark:/61903/1:1:6pfd-q43c",
        "ark:/61903/1:1:6PFD",
        "ark:/61903/1:1:",
        "ark:/61903/1:1:6PFD-Q43C, ark:/61903/1:1:QVS9-DHD",
        "",
        None,
        ["ark:/61903/1:1:6PFD-Q43C"],
    ],
    ids=[
        "1:2-record-ark",
        "3:1-image-ark",
        "3:2-image-ark",
        "bare-persona-id",
        "tree-pid",
        "tree-person-ark",
        "url-wrapped",
        "trailing-newline",
        "lowercase",
        "no-id-suffix",
        "prefix-only",
        "two-arks",
        "empty",
        "null",
        "list",
    ],
)
def test_hint_bad_persona_ark_is_error(tmp_path, persona_ark):
    hint = {"persona_ark": persona_ark, "identity": "same"}
    errors = _hint_errors_for(tmp_path, hint)
    assert len(errors) == 1
    assert "`hint.persona_ark` must be a 1:1: record-persona ark" in errors[0]


# A tree PID is the same 4-3 shape as a persona id, so `ark:/61903/1:1:<PID>`
# passes the regex; only the comparison against `source_pid` catches it.
_SOURCE_PID = "LZ1N-QK9"


@pytest.mark.parametrize(
    "source_pid",
    [_SOURCE_PID, " LZ1N-QK9 ", "lz1n-qk9"],
    ids=["exact", "padded", "lowercase"],
)
def test_hint_persona_ark_wrapping_source_pid_is_error(tmp_path, source_pid):
    hint = {"persona_ark": f"ark:/61903/1:1:{_SOURCE_PID}", "identity": "same"}
    errors = _hint_errors_for(tmp_path, hint, source_pid=source_pid)
    assert len(errors) == 1
    assert "wraps the tree person's PID (`source_pid`" in errors[0]


def test_lint_fixture_hard_fails_a_hint_wrapping_source_pid(tmp_path):
    _write_record_hint_meta(
        tmp_path,
        resolved=True,
        hint={"persona_ark": f"ark:/61903/1:1:{_SOURCE_PID}", "identity": "different"},
        source_pid=_SOURCE_PID,
    )
    _write_fixture(
        tmp_path,
        _valid_tree(_valid_person("I1", "John", "Smith")),
        findings=_HINT_FINDINGS,
    )
    _, errors = lint_fixture(tmp_path)
    assert any("wraps the tree person's PID" in e for e in errors)


@pytest.mark.parametrize(
    "persona_ark",
    ["ark:/61903/1:1:QVS9-DHD", "ark:/61903/1:1:LZ1N-QK9X", "ark:/61903/1:1:LZ1N-QK"],
    ids=["other-4-3", "source-pid-prefix-4-4", "source-pid-prefix-4-2"],
)
def test_hint_persona_ark_not_equal_to_source_pid_passes(tmp_path, persona_ark):
    hint = {"persona_ark": persona_ark, "identity": "same"}
    assert _hint_errors_for(tmp_path, hint, source_pid=_SOURCE_PID) == []


def test_hint_wrapping_source_pid_on_a_draft_is_not_checked(tmp_path):
    hint = {"persona_ark": f"ark:/61903/1:1:{_SOURCE_PID}", "identity": "same"}
    assert _hint_errors_for(tmp_path, hint, resolved=False, source_pid=_SOURCE_PID) == []


@pytest.mark.parametrize("source_pid", [None, 7, ""], ids=["null", "int", "empty"])
def test_hint_non_string_or_empty_source_pid_does_not_fire(tmp_path, source_pid):
    hint = {"persona_ark": f"ark:/61903/1:1:{_SOURCE_PID}", "identity": "same"}
    assert _hint_errors_for(tmp_path, hint, source_pid=source_pid) == []


def test_hint_malformed_persona_ark_reports_shape_not_source_pid(tmp_path):
    hint = {"persona_ark": _SOURCE_PID, "identity": "same"}
    errors = _hint_errors_for(tmp_path, hint, source_pid=_SOURCE_PID)
    assert len(errors) == 1
    assert "`hint.persona_ark` must be a 1:1: record-persona ark" in errors[0]


def test_hint_missing_persona_ark_is_error(tmp_path):
    errors = _hint_errors_for(tmp_path, {"identity": "same"})
    assert len(errors) == 1
    assert "`hint.persona_ark` is missing" in errors[0]


def test_hint_unknown_key_is_error(tmp_path):
    hint = {"persona_ark": "ark:/61903/1:1:6PFD-Q43C", "identity": "same", "outcome": 2}
    errors = _hint_errors_for(tmp_path, hint)
    assert len(errors) == 1
    assert "unrecognized field(s) ['outcome']" in errors[0]


@pytest.mark.parametrize(
    "hint",
    ["same", "ark:/61903/1:1:6PFD-Q43C", True, 0, [], ["same"]],
)
def test_hint_not_an_object_or_null_is_error(tmp_path, hint):
    errors = _hint_errors_for(tmp_path, hint)
    assert len(errors) == 1
    assert "`hint` must be an object or null" in errors[0]


def test_hint_empty_object_reports_both_missing_fields(tmp_path):
    errors = _hint_errors_for(tmp_path, {})
    assert any("`hint.persona_ark` is missing" in e for e in errors)
    assert any("`hint.identity` is missing" in e for e in errors)


# --- genre-aware WARN advice (issue #2306 / PR #2634) ------------------
#
# Every branch of `format_suspect` used to tell the reader to edit
# `starting-tree.gedcomx.json`. That is right for a `strip` fixture and
# forbidden on a `record-hint` one, where nothing was stripped and the two
# trees are committed byte-identical. These pin BOTH directions: the
# record-hint wording appears when it should, and the strip wording is
# unchanged when it should be. A one-directional test here would pass
# happily if the genre branch swallowed every fixture.

_EDIT_TREE_PHRASES = (
    "delete that person and its relationship from starting-tree.gedcomx.json",
    "Remove it from starting-tree.gedcomx.json",
)


def _suspect(polarity="recover", finding_type="relationship"):
    return vf.Suspect(
        finding_id="f1",
        finding_type=finding_type,
        person_id="ABCD-123",
        shared={"smith"},
        reason="",
        polarity=polarity,
    )


def test_record_hint_advice_never_tells_you_to_edit_a_tree():
    for polarity in ("recover", "avoid"):
        warn = vf.format_suspect("fx", _suspect(polarity), "record-hint")
        assert "Do not" in warn
        for phrase in _EDIT_TREE_PHRASES:
            assert phrase not in warn, f"{polarity}: still says {phrase!r}"


def test_strip_genre_advice_is_unchanged():
    # The other direction. If this ever starts failing because the strip
    # wording drifted toward the record-hint wording, the genre branch has
    # stopped discriminating and the test above proves nothing.
    assert _EDIT_TREE_PHRASES[0] in vf.format_suspect("fx", _suspect("recover"), "strip")
    assert _EDIT_TREE_PHRASES[1] in vf.format_suspect("fx", _suspect("avoid"), "strip")


def test_genre_defaults_to_strip_when_omitted():
    # Three call sites pass it; a fourth added later must not silently get
    # record-hint wording.
    assert vf.format_suspect("fx", _suspect("recover")) == vf.format_suspect(
        "fx", _suspect("recover"), "strip"
    )


def test_fact_findings_keep_their_own_advice_on_a_strip_fixture():
    warn = vf.format_suspect("fx", _suspect("recover", "fact"), "strip")
    assert "only a problem if the stripped fact is still on" in warn


# The tests above all call `format_suspect` directly, so they prove the
# advice *branches* correctly and nothing about whether `main()` reaches it.
# Deleting `genre = suspect_genre(fixture_dir)` and the third argument at the
# CLI call site left the whole suite green while the command-line linter went
# back to telling record-hint reviewers to edit a tree the genre forbids
# (senior review, PR #2634). These two run the CLI end to end, both
# directions.


def _genre_fixture(path: Path, genre: str) -> None:
    """A fixture that lints clean but raises one suspect, at `genre`."""
    finding = _rel_finding("Robert Smith")
    finding["polarity"] = "avoid"
    _write_fixture(
        path,
        _valid_tree(
            _valid_person("I1", "John", "Smith"),
            _valid_person("I9", "Robert", "Smith"),  # the suspect
        ),
        {"findings": [finding]},
    )
    (path / "fixture.json").write_text(
        json.dumps({"id": path.name, "genre": genre}), encoding="utf-8"
    )
    if genre == "record-hint":
        _commit_snapshot(path)


def test_cli_wires_the_fixture_genre_into_the_advice_it_prints(tmp_path, capsys):
    _genre_fixture(tmp_path, "record-hint")
    assert vf.main([str(tmp_path)]) == 0  # suspects are warn-only
    out = capsys.readouterr().out
    assert "Do not" in out
    for phrase in _EDIT_TREE_PHRASES:
        assert phrase not in out, f"CLI still says {phrase!r} on a record-hint fixture"


def test_cli_still_prints_strip_advice_for_a_strip_fixture(tmp_path, capsys):
    # The other direction: a CLI that hardcoded record-hint wording, or a
    # `suspect_genre` that swallowed every fixture, passes the test above.
    _genre_fixture(tmp_path, "strip")
    assert vf.main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert _EDIT_TREE_PHRASES[1] in out


def test_suspect_genre_reads_fixture_json(tmp_path: Path):
    (tmp_path / "fixture.json").write_text(
        json.dumps({"genre": "record-hint"}), encoding="utf-8"
    )
    assert vf.suspect_genre(tmp_path) == "record-hint"


def test_suspect_genre_falls_back_to_strip_rather_than_crashing(tmp_path: Path):
    # Advice text must never be the thing that takes the linter down. Four
    # broken shapes, since "it returns a string" is easy to satisfy by
    # accident: missing file, unparseable, not an object, and genre null.
    assert vf.suspect_genre(tmp_path) == "strip"  # no fixture.json at all

    (tmp_path / "fixture.json").write_text("{not json", encoding="utf-8")
    assert vf.suspect_genre(tmp_path) == "strip"

    (tmp_path / "fixture.json").write_text("[]", encoding="utf-8")
    assert vf.suspect_genre(tmp_path) == "strip"

    (tmp_path / "fixture.json").write_text(
        json.dumps({"genre": None}), encoding="utf-8"
    )
    assert vf.suspect_genre(tmp_path) == "strip"
