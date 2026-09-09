"""Direct tests for record-extraction's classification-refinement
validators (issue #2021, F12).

Same reason as `test_research_plan_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and its real pass/fail set would otherwise appear only
inside a paid per-skill run.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_record_extraction import (  # noqa: E402
    test_a_multi_record_batch_announces_each_record_position as check_batch_progress,
    test_expected_classifications as check_classifications,
    test_refinement_preserves_extraction_fields_and_avoids_duplication as check_refinement,
)


def _assertion(**overrides):
    base = {
        "id": "a_002",
        "source_id": "src_001",
        "record_id": "ark:/61903/1:1:M6QK-HRD",
        "record_role": "head",
        "fact_type": "birth",
        "value": "Ireland",
        "structured_value": None,
        "date": None,
        "date_certainty": None,
        "place": "Ireland",
        "information_quality": "primary",
        "informant": "household head (self)",
        "informant_proximity": "self",
        "informant_bias_notes": "assumed self-reported",
        "evidence_type": "direct",
        "log_entry_id": "log_001",
        "extracted_for_question_ids": ["q_001"],
    }
    base.update(overrides)
    return base


def _sibling(**overrides):
    base = {
        "id": "a_001",
        "source_id": "src_001",
        "record_id": "ark:/61903/1:1:M6QK-HRD",
        "record_role": "head",
        "fact_type": "name",
        "value": "Thomas Doyle",
        "structured_value": {"given": "Thomas", "surname": "Doyle"},
        "date": None,
        "date_certainty": None,
        "place": None,
        "information_quality": "primary",
        "informant": "household head (self)",
        "informant_proximity": "self",
        "informant_bias_notes": "assumed self-reported",
        "evidence_type": "direct",
        "log_entry_id": "log_001",
        "extracted_for_question_ids": ["q_001"],
    }
    base.update(overrides)
    return base


# --- test_expected_classifications, widened to "new-or-updated" -----------

def test_classifications_matcher_fires_on_updated_assertion_with_wrong_value():
    """The widened matcher must actually check an UPDATED assertion, not
    just a newly-created one -- this is the exact gap #2021 found."""
    before = {"research_json": {"assertions": [_assertion(informant_proximity="self")]}}
    after = {"research_json": {"assertions": [_assertion(informant_proximity="self")]}}  # unchanged
    test = {
        "expected_classifications": [
            {"record_role": "head", "fact_type": "birth", "informant_proximity": "unknown"}
        ]
    }
    with pytest.raises(AssertionError, match="no new assertion"):
        check_classifications(before, after, test)


def test_classifications_matcher_passes_on_correctly_updated_assertion():
    before = {"research_json": {"assertions": [_assertion(informant_proximity="self")]}}
    after = {"research_json": {"assertions": [_assertion(informant_proximity="unknown")]}}
    test = {
        "expected_classifications": [
            {"record_role": "head", "fact_type": "birth", "informant_proximity": "unknown"}
        ]
    }
    check_classifications(before, after, test)  # does not raise


def test_classifications_matcher_still_works_on_newly_created_assertion():
    """Proves the widening didn't break the original (pre-#2021) semantics."""
    before = {"research_json": {"assertions": []}}
    after = {"research_json": {"assertions": [_assertion(informant_proximity="unknown")]}}
    test = {
        "expected_classifications": [
            {"record_role": "head", "fact_type": "birth", "informant_proximity": "unknown"}
        ]
    }
    check_classifications(before, after, test)  # does not raise


# --- test_refinement_preserves_extraction_fields_and_avoids_duplication ---

BEFORE_STATE = {
    "research_json": {"assertions": [_sibling(), _assertion(informant_proximity="self")]}
}


def test_skipped_when_no_refinement_targets():
    with pytest.raises(pytest.skip.Exception):
        check_refinement(BEFORE_STATE, BEFORE_STATE, {})


def test_passes_on_a_clean_in_place_refinement():
    after = {
        "research_json": {
            "assertions": [
                _sibling(),
                _assertion(informant_proximity="unknown", information_quality="indeterminate"),
            ]
        }
    }
    check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})  # does not raise


def test_fires_when_extraction_field_changes():
    """The refinement must not touch extraction fields -- only classification."""
    after = {
        "research_json": {
            "assertions": [
                _sibling(),
                _assertion(informant_proximity="unknown", place="England"),  # extraction field moved
            ]
        }
    }
    with pytest.raises(AssertionError, match="extraction field 'place' changed"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


def test_fires_when_target_deleted_instead_of_updated():
    after = {"research_json": {"assertions": [_sibling()]}}  # a_002 gone
    with pytest.raises(AssertionError, match="no longer exists"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


def test_fires_when_nothing_actually_changed():
    with pytest.raises(AssertionError, match="nothing about it changed"):
        check_refinement(BEFORE_STATE, BEFORE_STATE, {"refinement_targets": ["a_002"]})


def test_fires_when_untargeted_sibling_changes():
    """Proves scope: reclassifying a_002 must not touch a_001, which the
    refinement request never named."""
    after = {
        "research_json": {
            "assertions": [
                _sibling(informant_proximity="unknown"),  # a_001 changed, not asked for
                _assertion(informant_proximity="unknown", information_quality="indeterminate"),
            ]
        }
    }
    with pytest.raises(AssertionError, match="not a named refinement target"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


def test_fires_on_duplicate_via_append_instead_of_update():
    """The exact failure mode this validator exists to catch: a second
    assertion for the same (source_id, record_role, fact_type) appended
    rather than the original updated in place."""
    after = {
        "research_json": {
            "assertions": [
                _sibling(),
                _assertion(informant_proximity="self"),  # original untouched
                _assertion(id="a_003", informant_proximity="unknown"),  # duplicate
            ]
        }
    }
    with pytest.raises(AssertionError, match="duplicates a refinement target"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


# --- Batch progress narration (issue #1998, candidate 3) ---------------
#
# Both directions per check, because nothing in CI runs a validator against a
# real run - it executes only inside a paid `make eval-skill`. A validator
# that silently always skips is green forever and reads as coverage.
#
# Shapes are reduced inline rather than read from a run-log path: candidate
# retention keeps only the newest five per skill, so a path-reading test ages
# out and starts erroring.

POSITIVE = {"type": "positive", "tags": []}


def _states(n_new_sources, n_before=0):
    """Before/after pair differing by `n_new_sources` newly-created sources."""
    before = [{"id": f"src_{i:03d}", "title": f"pre-existing {i}"} for i in range(1, n_before + 1)]
    after = before + [
        {"id": f"src_{n_before + i:03d}", "title": f"record {i}"}
        for i in range(1, n_new_sources + 1)
    ]
    return {"research_json": {"sources": before}}, {"research_json": {"sources": after}}


def _checked(reply, before, after, test):
    """Run the validator, converting a skip into a failure.

    Every test below that asserts a VERDICT must go through this. Calling the
    validator directly lets a skip propagate, and pytest reports that as
    SKIPPED rather than failed — so a gate that silently stopped opening would
    leave this file green while checking nothing, the failure mode this
    validator exists to prevent. Measured: an early mutation closing the gate
    turned three firing tests into skips and the suite stayed green.
    """
    try:
        check_batch_progress(reply, before, after, test)
    except pytest.skip.Exception as exc:  # noqa: PT012
        raise AssertionError(f"validator skipped instead of checking: {exc}") from exc


def test_batch_progress_fires_when_the_only_record_is_not_announced():
    """The live case. On v1_2026-09-09_16-38-08 four runs did exactly this —
    ut_record_extraction_013, _023, _028 and _029 narrate their setup steps
    and never state a count."""
    before, after = _states(1)
    with pytest.raises(AssertionError, match="position marker"):
        _checked("Good, tools are loaded. Let me read the project context.", before, after, POSITIVE)


def test_batch_progress_quiet_on_the_single_record_announcement():
    """What the skill actually emitted after the SKILL.md change, verbatim
    from ut_record_extraction_006."""
    before, after = _states(1)
    reply = "**1 record to extract — delegating now.**\n\n**1 of 1:** United States Census, 1850"
    _checked(reply, before, after, POSITIVE)


def test_batch_progress_fires_when_a_second_record_is_never_announced():
    before, after = _states(2)
    with pytest.raises(AssertionError, match=r"missing \[2\]"):
        _checked("Two records. 1 of 2: the census. Both done.", before, after, POSITIVE)


def test_batch_progress_quiet_when_each_of_two_is_announced():
    before, after = _states(2)
    reply = "Two documents.\n1 of 2: the 1880 census.\n2 of 2: the baptism register."
    _checked(reply, before, after, POSITIVE)


def test_batch_progress_accepts_the_slash_spelling():
    """The other direction CLAUDE.md asks for: a legitimate variant the check
    must not reject, or it gets `skip`ped within a month."""
    before, after = _states(2)
    _checked("Extracting 2.\n(1/2) the census.\n(2/2) the register.", before, after, POSITIVE)


def test_batch_progress_accepts_a_denominator_above_the_extracted_count():
    """Announcing three and extracting two is a dropped record — a different
    defect, which this validator must not also fail for."""
    before, after = _states(2)
    _checked("Three queued.\n1 of 3: the census.\n2 of 3: the register.", before, after, POSITIVE)


def test_batch_progress_counts_a_retry_as_one_record():
    """The regression that cost a $9.82 run.

    The first version counted `extraction_append` calls. In
    v1_2026-09-09_16-38-08, ut_record_extraction_006 and _007 each made TWO
    identical append calls — same source title, same op count — against ONE
    Agent delegation. A retry. Both runs had announced "1 of 1" and complied;
    counting calls scored them as two-record batches and failed them.

    Counting sources is immune: a retry writes the same source, so one record
    stays one record.
    """
    before, after = _states(1)
    _checked("**1 record to extract.** **1 of 1:** the 1850 census.", before, after, POSITIVE)


def test_batch_progress_ignores_sources_that_already_existed():
    """Only NEW sources count — a project opening with sources already in it
    must not inflate the record count."""
    before, after = _states(1, n_before=3)
    _checked("**1 of 1:** the 1850 census.", before, after, POSITIVE)


def test_batch_progress_skips_when_nothing_was_extracted():
    """The gate, asserted rather than left to propagate — a bare skip here
    would report SKIPPED and assert nothing."""
    before, after = _states(0)
    with pytest.raises(pytest.skip.Exception, match="no record extracted"):
        check_batch_progress("I could not read the record.", before, after, POSITIVE)


def test_batch_progress_skips_a_negative_test():
    before, after = _states(1)
    with pytest.raises(pytest.skip.Exception, match="only positive tests"):
        check_batch_progress("", before, after, {"type": "negative", "tags": []})
