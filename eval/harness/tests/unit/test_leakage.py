"""Tests for harness.leakage — verdict-shaped criterion detection."""

import pytest

from harness.leakage import flag_verdict_shaped_criteria


def test_no_flags_for_reasoning_criteria():
    """Reasoning-shaped criteria (grade the *how*, not the *what*) must
    NOT be flagged — these are what the spec asks authors to write."""
    criteria = [
        "Resolution should explicitly weigh informant proximity as one factor",
        "Should distinguish the original record from any indexed copy",
        "Should evaluate whether household composition supports the relationship",
        "Should cite both informant proximity and temporal distance",
    ]
    assert flag_verdict_shaped_criteria(criteria) == []


def test_flags_resolve_in_favor_pattern():
    flags = flag_verdict_shaped_criteria([
        "Should resolve the conflict in favor of the Irish birthplace, citing informant proximity"
    ])
    assert len(flags) == 1
    assert "resolves toward" in flags[0]["matched_pattern"]
    assert "neutrality test" in flags[0]["advisory"]


def test_flags_classify_as_pattern():
    flags = flag_verdict_shaped_criteria([
        "Should classify the source as derivative"
    ])
    assert len(flags) == 1
    assert "classification" in flags[0]["matched_pattern"]


def test_flags_choose_select_pattern():
    flags = flag_verdict_shaped_criteria([
        "Should choose the 1860 census over the death certificate",
        "Should select the more recent record",
        "Should prefer the contemporary source",
    ])
    assert len(flags) == 3


def test_flags_identify_as_pattern():
    flags = flag_verdict_shaped_criteria([
        "Should identify Thomas Flynn as Patrick's father"
    ])
    assert len(flags) == 1


def test_flags_direct_answer_phrasing():
    flags = flag_verdict_shaped_criteria([
        "The right answer is Ireland",
        "The right conclusion is that Thomas is the father",
    ])
    assert len(flags) == 2


def test_one_flag_per_criterion_max():
    """A criterion that matches multiple patterns still gets one flag."""
    flags = flag_verdict_shaped_criteria([
        "Should choose Ireland and identify Thomas as father (the right answer is Patrick=son)"
    ])
    assert len(flags) == 1


def test_flags_verdict_first_phrasing():
    """v1.7 widened patterns: 'X is the right Y' / 'X is the correct Y'."""
    flags = flag_verdict_shaped_criteria([
        "Ireland is the right birthplace",
        "Thomas is the correct father",
    ])
    assert len(flags) == 2
    for f in flags:
        assert "verdict-first" in f["matched_pattern"]


def test_flags_reason_baked_in_framings():
    """v1.7: 'since X is true', 'because X is...'."""
    flags = flag_verdict_shaped_criteria([
        "Should resolve, since the death certificate is more recent",
        "Because the 1860 census is contemporary, prefer it",
    ])
    assert len(flags) == 2


def test_flags_negated_forms():
    """v1.7: 'should not conclude/say/claim X'."""
    flags = flag_verdict_shaped_criteria([
        "Should not conclude Pennsylvania",
        "Should not say the father is Thomas",
    ])
    assert len(flags) == 2
    for f in flags:
        assert "forbids" in f["matched_pattern"]


def test_flags_equality_framing():
    """v1.7: bare 'X = Y' verdict assertions."""
    flags = flag_verdict_shaped_criteria([
        "Patrick = Thomas's son",
    ])
    assert len(flags) == 1
    assert "equality" in flags[0]["matched_pattern"]


def test_mixed_list_only_flags_offenders():
    criteria = [
        "Resolution should weigh informant proximity",  # reasoning — keep
        "Should classify as primary information",  # verdict — flag
        "Should distinguish original from derivative sources",  # reasoning — keep
        "The right answer is Ireland",  # verdict — flag
    ]
    flags = flag_verdict_shaped_criteria(criteria)
    assert len(flags) == 2
    flagged = {f["criterion"] for f in flags}
    assert "Should classify as primary information" in flagged
    assert "The right answer is Ireland" in flagged
