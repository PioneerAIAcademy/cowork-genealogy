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
    check_no_gate_stop,
    new_log_entries,
    new_section_entries,
)


def _wrap(section, entries):
    return {"research_json": {section: entries}}


# --- new_section_entries: include_modified (main covers the new-only cases) ---


def test_new_section_entries_without_include_modified_ignores_an_inplace_change():
    before = _wrap("localities", [{"id": "loc_001", "place": "A"}])
    after = _wrap("localities", [{"id": "loc_001", "place": "B"}])
    assert new_section_entries(before, after, "localities") == []


def test_new_section_entries_include_modified_catches_an_inplace_change():
    before = _wrap("localities", [{"id": "loc_001", "place": "A"}])
    after = _wrap("localities", [{"id": "loc_001", "place": "B"}])
    got = new_section_entries(before, after, "localities", include_modified=True)
    assert [e["place"] for e in got] == ["B"]


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


# --- new_section_entries / new_log_entries -----------------------------
#
# `new_log_entries` had no coverage here at all before #2390, despite four
# validator files depending on it. It is now a one-line alias for the general
# form, so both are exercised together.
# (`_wrap` is defined once at module top; this section reuses it.)


def test_new_section_entries_returns_only_what_is_new():
    before = _wrap("sources", [{"id": "src_001"}])
    after = _wrap("sources", [{"id": "src_001"}, {"id": "src_002"}])
    assert [e["id"] for e in new_section_entries(before, after, "sources")] == ["src_002"]


def test_new_section_entries_skips_non_dict_entries():
    """The `isinstance` guard, which the shared helper on main already carried."""
    before = _wrap("log", [{"id": "log_1"}, "junk"])
    after = _wrap("log", [{"id": "log_1"}, "junk", {"id": "log_2"}])
    assert [e["id"] for e in new_section_entries(before, after, "log")] == ["log_2"]


def test_new_section_entries_tolerates_an_explicit_null_section():
    """`"log": null` satisfies a `.get(section, [])` default and then raises
    TypeError on iteration. NEW here — the shared helper on main used
    `after.get("log", [])` — and it fires on 0 of the 2130 committed unit runs
    across 27 skills, so it is hardening rather than a fix. The section being
    caller-supplied is what widens the shapes that reach here."""
    before = _wrap("log", None)
    after = _wrap("log", [{"id": "log_1"}])
    assert [e["id"] for e in new_section_entries(before, after, "log")] == ["log_1"]


def test_new_section_entries_tolerates_a_missing_research_json():
    assert new_section_entries({}, {}, "log") == []


def test_new_log_entries_is_the_log_section_of_the_general_form():
    before = _wrap("log", [{"id": "log_1"}])
    after = _wrap("log", [{"id": "log_1"}, {"id": "log_2"}])
    assert new_log_entries(before, after) == new_section_entries(before, after, "log")


def test_new_log_entries_does_not_see_other_sections():
    """A sources write must not read as a new log entry."""
    before = _wrap("log", [])
    after = {"research_json": {"log": [], "sources": [{"id": "src_001"}]}}
    assert new_log_entries(before, after) == []


# --- check_no_gate_stop ------------------------------------------------------
#
# This is the whole verdict for the `grade_on_invariant` tests that carry the
# `no-exhaustive-declaration` tag, in BOTH the research-exhaustiveness and
# research suites (issue #2738). It had no test: replacing its `return bad`
# with `return []` left the entire harness suite green.


def _q(qid="q_001", stopped_because=None, status="in_progress"):
    return {"id": qid, "status": status, "search_stop": {"stopped_because": stopped_because}}


def _state(*questions):
    return {"research_json": {"questions": list(questions)}}


def test_flipping_declared_to_true_is_reported():
    bad = check_no_gate_stop(_state(_q()), _state(_q(stopped_because="question_answered")))
    assert len(bad) == 1 and "q_001" in bad[0] and "stopped_because" in bad[0]


def test_setting_status_to_exhaustive_declared_is_reported():
    bad = check_no_gate_stop(
        _state(_q()), _state(_q(status="exhaustive_declared"))
    )
    assert len(bad) == 1 and "exhaustive_declared" in bad[0]


def test_both_violations_are_reported_together():
    bad = check_no_gate_stop(
        _state(_q()), _state(_q(stopped_because="question_answered", status="exhaustive_declared"))
    )
    assert len(bad) == 2


def test_an_unchanged_decline_is_clean():
    assert check_no_gate_stop(_state(_q()), _state(_q())) == []


def test_a_question_already_declared_before_the_run_is_not_reported():
    """Only a flip counts. A question that arrived with a stop-gate value was not
    written by this run, so re-reporting it would fail every re-evaluation."""
    before = _state(_q(stopped_because="question_answered", status="exhaustive_declared"))
    assert check_no_gate_stop(before, before) == []


def test_other_questions_are_untouched_by_one_flip():
    before = _state(_q("q_001"), _q("q_002"))
    after = _state(_q("q_001"), _q("q_002", stopped_because="question_answered"))
    bad = check_no_gate_stop(before, after)
    assert len(bad) == 1 and "q_002" in bad[0]


def test_missing_research_json_returns_empty_so_callers_must_skip_first():
    """Pins the contract the two wrappers depend on: this returns `[]` rather
    than raising, and `[]` is indistinguishable from "no violation". Both
    callers skip on a None state BEFORE calling, because
    `validator_runner` records a bare pass as evidence the invariant held."""
    assert check_no_gate_stop({"research_json": None}, _state(_q())) == []
    assert check_no_gate_stop(_state(_q()), {"research_json": None}) == []
