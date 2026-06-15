"""Unit tests for e2e.validate_fixture — the stripping-completeness linter.

These exercise the deterministic name-token overlap logic against
synthetic findings/trees; no fixture files or skill runs involved.
"""

from __future__ import annotations

import json

from e2e.validate_fixture import check_stripping, lint_fixture


# --- helpers ----------------------------------------------------------

def _person(pid, given, surname, fact_types=()):
    return {
        "id": pid,
        "names": [{"given": given, "surname": surname}],
        "facts": [{"type": t} for t in fact_types],
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


def test_lint_fixture_clean_fixture_passes(tmp_path):
    (tmp_path / "expected-findings.json").write_text(
        json.dumps({"findings": [_rel_finding("Robert Smith")]}), encoding="utf-8"
    )
    (tmp_path / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": [_person("I1", "John", "Smith")]}), encoding="utf-8"
    )
    suspects, errors = lint_fixture(tmp_path)
    assert errors == []
    assert suspects == []
