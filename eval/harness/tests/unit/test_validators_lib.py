"""Tests for validators/validators_lib.py — shared validator helpers."""

import sys
from pathlib import Path

import pytest


# validators_lib lives under eval/harness/validators/ — add that to the
# import path so this test file can import it directly.
_VALIDATORS_DIR = (
    Path(__file__).resolve().parents[2] / "validators"
)
sys.path.insert(0, str(_VALIDATORS_DIR))

from validators_lib import (  # noqa: E402
    assert_foreign_keys_valid,
    assert_log_append_only,
    assert_no_section_deletions,
    assert_only_writes_to_sections,
)


# --- assert_no_section_deletions ------------------------------------------


def test_no_deletions_passes_when_section_only_grows():
    before = {"assertions": [{"id": "a_1"}]}
    after = {"assertions": [{"id": "a_1"}, {"id": "a_2"}]}
    assert_no_section_deletions(before, after, "assertions")


def test_no_deletions_passes_when_entries_modified():
    """Modifications are allowed; only deletion is forbidden."""
    before = {"assertions": [{"id": "a_1", "claim": "old"}]}
    after = {"assertions": [{"id": "a_1", "claim": "new"}]}
    assert_no_section_deletions(before, after, "assertions")


def test_no_deletions_fails_when_entry_removed():
    before = {"assertions": [{"id": "a_1"}, {"id": "a_2"}]}
    after = {"assertions": [{"id": "a_1"}]}
    with pytest.raises(AssertionError, match="a_2"):
        assert_no_section_deletions(before, after, "assertions")


def test_no_deletions_passes_on_empty_section():
    assert_no_section_deletions({"x": []}, {"x": []}, "x")


# --- assert_only_writes_to_sections ---------------------------------------


def test_only_writes_passes_when_only_owned_modified():
    before = {"conflicts": [], "assertions": [{"id": "a_1"}]}
    after = {"conflicts": [{"id": "c_1"}], "assertions": [{"id": "a_1"}]}
    assert_only_writes_to_sections(before, after, owned={"conflicts"})


def test_only_writes_fails_when_unauthorized_section_modified():
    before = {"conflicts": [], "assertions": [{"id": "a_1"}]}
    after = {"conflicts": [], "assertions": [{"id": "a_1"}, {"id": "a_2"}]}
    with pytest.raises(AssertionError, match="assertions"):
        assert_only_writes_to_sections(
            before, after, owned={"conflicts"}, skill_name="conflict-resolution"
        )


def test_only_writes_skill_name_appears_in_error():
    """The helper takes a skill_name kwarg so the error is diagnostic."""
    before = {"x": [], "y": []}
    after = {"x": [{"id": "a"}], "y": []}
    with pytest.raises(AssertionError, match="my-skill"):
        assert_only_writes_to_sections(
            before, after, owned=set(),
            all_sections={"x", "y"},
            skill_name="my-skill",
        )


# --- assert_foreign_keys_valid --------------------------------------------


def test_foreign_keys_valid_single_id_reference():
    after = {
        "assertions": [{"id": "a_1", "source_id": "s_1"}],
        "sources": [{"id": "s_1"}],
    }
    assert_foreign_keys_valid(
        after, [("assertions", "source_id", "sources")]
    )


def test_foreign_keys_valid_dangling_reference_fails():
    after = {
        "assertions": [{"id": "a_1", "source_id": "s_999"}],
        "sources": [{"id": "s_1"}],
    }
    with pytest.raises(AssertionError, match="s_999"):
        assert_foreign_keys_valid(
            after, [("assertions", "source_id", "sources")]
        )


def test_foreign_keys_valid_list_of_ids():
    """Field can be a list — every element must resolve."""
    after = {
        "conflicts": [{"id": "c_1", "competing_assertion_ids": ["a_1", "a_2"]}],
        "assertions": [{"id": "a_1"}, {"id": "a_2"}],
    }
    assert_foreign_keys_valid(
        after, [("conflicts", "competing_assertion_ids", "assertions")]
    )


def test_foreign_keys_valid_skips_null_field():
    """Null field is OK — used for genuinely optional foreign keys."""
    after = {
        "assertions": [{"id": "a_1", "log_entry_id": None}],
        "log": [],
    }
    assert_foreign_keys_valid(
        after, [("assertions", "log_entry_id", "log")]
    )


def test_foreign_keys_valid_only_checks_new_entries_when_before_supplied():
    """With `before`, pre-existing entries are skipped (already validated
    on an earlier run); only new entries are checked."""
    before = {
        "assertions": [{"id": "a_1", "source_id": "stale_ref"}],
        "sources": [],
    }
    after = {
        "assertions": [
            {"id": "a_1", "source_id": "stale_ref"},  # pre-existing — skipped
            {"id": "a_2", "source_id": "s_1"},  # new — must resolve
        ],
        "sources": [{"id": "s_1"}],
    }
    assert_foreign_keys_valid(
        after, [("assertions", "source_id", "sources")], before=before
    )


# --- assert_log_append_only -----------------------------------------------


def test_log_append_only_passes_when_log_extended():
    before = {"log": [{"id": "log_1", "outcome": "positive"}]}
    after = {"log": [
        {"id": "log_1", "outcome": "positive"},
        {"id": "log_2", "outcome": "negative"},
    ]}
    assert_log_append_only(before, after)


def test_log_append_only_fails_when_entry_modified():
    before = {"log": [{"id": "log_1", "outcome": "positive"}]}
    after = {"log": [{"id": "log_1", "outcome": "negative"}]}
    with pytest.raises(AssertionError, match="modified"):
        assert_log_append_only(before, after)


def test_log_append_only_fails_when_entry_deleted():
    before = {"log": [{"id": "log_1"}, {"id": "log_2"}]}
    after = {"log": [{"id": "log_1"}]}
    with pytest.raises(AssertionError, match="deleted"):
        assert_log_append_only(before, after)
