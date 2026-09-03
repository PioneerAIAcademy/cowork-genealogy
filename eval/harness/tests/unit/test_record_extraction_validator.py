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
