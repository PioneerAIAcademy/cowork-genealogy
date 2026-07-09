"""Unit tests for e2e.validate_fixture — the fixture linter.

`lint_fixture` has two gates: the JSON Schemas, and the deterministic
name-token overlap that catches an answer left un-stripped. These exercise
both against synthetic findings/trees; no fixture files or skill runs
involved.
"""

from __future__ import annotations

import json

from pathlib import Path

import e2e.validate_fixture as vf
from e2e.validate_fixture import _resolve_target, check_stripping, lint_fixture


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
    # No starting-research.json: a Path-3 fixture under construction may not
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
