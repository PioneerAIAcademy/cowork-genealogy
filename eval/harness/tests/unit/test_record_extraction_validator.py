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
# The shapes are reduced inline rather than read from a run-log path:
# candidate retention keeps only the newest five per skill, so a path-reading
# test ages out and starts erroring.

POSITIVE = {"type": "positive", "tags": []}


def _calls(n, tool="mcp__genealogy__extraction_append"):
    """`n` per-record writes, plus noise the counter must ignore."""
    return [{"tool": "mcp__genealogy__record_read", "args": {}}] + [
        {"tool": tool, "args": {}} for _ in range(n)
    ]


def _checked(reply, calls, test):
    """Run the validator, converting a skip into a failure.

    Every test below that asserts the validator FIRES must go through this.
    Calling the validator directly would let a skip propagate, and pytest
    reports that as SKIPPED rather than failed — so a gate that silently
    stopped opening would leave this file green while checking nothing, which
    is the failure mode issue #1998's own validator exists to prevent.
    Measured: mutating the gate to `n < 99` turned three firing tests into
    skips and the suite stayed green.
    """
    try:
        check_batch_progress(reply, calls, test)
    except pytest.skip.Exception as exc:  # noqa: PT012
        raise AssertionError(f"validator skipped instead of checking: {exc}") from exc


def test_batch_progress_fires_when_a_record_is_never_announced():
    reply = "Starting on 2 documents. 1 of 2: the 1880 census. Both are done."
    with pytest.raises(AssertionError, match="position marker"):
        _checked(reply, _calls(2), POSITIVE)


def test_batch_progress_fires_when_nothing_is_announced():
    reply = "I extracted both documents and wrote the assertions."
    with pytest.raises(AssertionError, match="missing \\[1, 2\\]"):
        _checked(reply, _calls(2), POSITIVE)


def test_batch_progress_quiet_when_each_record_is_announced():
    reply = (
        "Two documents to extract.\n"
        "1 of 2: the 1880 census for Schuylkill County.\n"
        "2 of 2: the 1885 baptism register.\n"
    )
    _checked(reply, _calls(2), POSITIVE)


def test_batch_progress_accepts_the_slash_spelling():
    """The other direction CLAUDE.md asks for: a legitimate variant the check
    must not reject. SKILL.md shows "3 of 12"; a model writing "(1/2)" has
    complied, and a guard that fails it would be `skip`ped within a month."""
    reply = "Extracting 2 documents.\n(1/2) the 1880 census.\n(2/2) the register."
    _checked(reply, _calls(2), POSITIVE)


def test_batch_progress_accepts_a_denominator_above_the_extracted_count():
    """Announcing three and extracting two is a different defect - a dropped
    record - and this validator must not also fail for it."""
    reply = "Three documents queued.\n1 of 3: the census.\n2 of 3: the register."
    _checked(reply, _calls(2), POSITIVE)


def test_batch_progress_skips_a_single_record_run():
    """The gate, asserted rather than left to propagate.

    A single record has no position to report. Letting the skip escape would
    mark this test SKIPPED in the suite - the shape that reads as coverage
    while asserting nothing - so the skip is caught and asserted instead.
    """
    with pytest.raises(pytest.skip.Exception, match="not a batch"):
        check_batch_progress("Extracted the census.", _calls(1), POSITIVE)


def test_batch_progress_skips_a_negative_test():
    with pytest.raises(pytest.skip.Exception, match="only positive tests"):
        check_batch_progress("", _calls(2), {"type": "negative", "tags": []})


def test_batch_progress_counts_the_bridged_tool_spelling():
    """A run records the call under whichever of the three server spellings
    the session resolved (CLAUDE.md, "Dual-spelled tool names"). Counting a
    qualified name literally would see zero records on two thirds of runs and
    skip the check permanently."""
    calls = _calls(2, tool="mcp__remote-devices__Genealogy_Research__extraction_append")
    with pytest.raises(AssertionError, match="position marker"):
        _checked("no announcements here", calls, POSITIVE)
