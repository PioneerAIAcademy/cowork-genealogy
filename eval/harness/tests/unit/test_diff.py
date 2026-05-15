"""Tests for harness.diff — structured before/after diff per spec §15."""

import pytest

from harness.diff import diff_research_json, diff_tree_gedcomx


# --- research.json ----------------------------------------------------------


def test_no_change_returns_empty_sections():
    before = {"assertions": [{"id": "a_1", "claim": "x"}], "log": []}
    after = {"assertions": [{"id": "a_1", "claim": "x"}], "log": []}
    d = diff_research_json(before, after)
    assert d["sections_modified"] == []
    assert d["diff"] == {}


def test_added_entry():
    before = {"assertions": []}
    after = {"assertions": [{"id": "a_1", "claim": "x"}]}
    d = diff_research_json(before, after)
    assert d["sections_modified"] == ["assertions"]
    assert d["diff"]["assertions"]["added"] == [{"id": "a_1", "claim": "x"}]
    assert d["diff"]["assertions"]["modified"] == []
    assert d["diff"]["assertions"]["deleted"] == []


def test_modified_entry_emits_changed_fields():
    before = {"assertions": [{"id": "a_1", "claim": "old", "weight": 1}]}
    after = {"assertions": [{"id": "a_1", "claim": "new", "weight": 1}]}
    d = diff_research_json(before, after)
    mods = d["diff"]["assertions"]["modified"]
    assert len(mods) == 1
    assert mods[0]["id"] == "a_1"
    assert mods[0]["changed_fields"] == {"claim": {"before": "old", "after": "new"}}


def test_modified_entry_with_added_field_uses_null_before():
    before = {"assertions": [{"id": "a_1", "claim": "x"}]}
    after = {"assertions": [{"id": "a_1", "claim": "x", "weight": 5}]}
    d = diff_research_json(before, after)
    mods = d["diff"]["assertions"]["modified"]
    assert mods[0]["changed_fields"] == {"weight": {"before": None, "after": 5}}


def test_modified_entry_with_removed_field_uses_null_after():
    before = {"assertions": [{"id": "a_1", "claim": "x", "weight": 5}]}
    after = {"assertions": [{"id": "a_1", "claim": "x"}]}
    d = diff_research_json(before, after)
    mods = d["diff"]["assertions"]["modified"]
    assert mods[0]["changed_fields"] == {"weight": {"before": 5, "after": None}}


def test_deleted_entry_recorded_but_should_be_caught_by_validator():
    before = {"assertions": [{"id": "a_1", "claim": "x"}]}
    after = {"assertions": []}
    d = diff_research_json(before, after)
    assert d["diff"]["assertions"]["deleted"] == [{"id": "a_1", "claim": "x"}]


def test_project_section_treated_as_single_object():
    before = {"project": {"id": "rp_1", "status": "active"}}
    after = {"project": {"id": "rp_1", "status": "completed"}}
    d = diff_research_json(before, after)
    mods = d["diff"]["project"]["modified"]
    assert mods[0]["changed_fields"] == {
        "status": {"before": "active", "after": "completed"}
    }


def test_handles_none_before_state():
    # init-project scenario: research.json didn't exist before
    after = {"project": {"id": "rp_1"}, "assertions": []}
    d = diff_research_json(None, after)
    assert "project" in d["diff"]
    assert d["diff"]["project"]["added"] == [{"id": "rp_1"}]


def test_handles_none_after_state_returns_no_diff():
    # Skill ran but didn't write research.json at all
    before = {"assertions": [{"id": "a_1"}]}
    d = diff_research_json(before, None)
    assert d["sections_modified"] == []
    assert d["diff"] == {}


# --- tree.gedcomx.json ------------------------------------------------------


def test_tree_gedcomx_diff_with_persons():
    before = {"persons": [], "relationships": [], "sources": []}
    after = {
        "persons": [{"id": "I1", "gender": "Male", "names": []}],
        "relationships": [],
        "sources": [],
    }
    d = diff_tree_gedcomx(before, after)
    assert d["sections_modified"] == ["persons"]
    assert d["diff"]["persons"]["added"][0]["id"] == "I1"


def test_tree_gedcomx_unchanged_returns_null():
    before = {"persons": [], "relationships": [], "sources": []}
    after = {"persons": [], "relationships": [], "sources": []}
    assert diff_tree_gedcomx(before, after) is None


def test_tree_gedcomx_none_both_returns_null():
    assert diff_tree_gedcomx(None, None) is None
