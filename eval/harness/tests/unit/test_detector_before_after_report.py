"""Unit tests for the old-vs-new detector replay tool (issue #1569).

Every other report module under eval/harness/e2e/ has at least one test file;
this one had none, which is exactly what let a wrong eligibility predicate
through review undetected (found by review). These pin the pieces most likely
to silently drift: which entries the lane-check divergence can even be shown
by, that old and new genuinely disagree on the shape the fix targets, and the
empty-input path of the formatter.
"""

from __future__ import annotations

from e2e.detector_before_after_report import (
    _lane_check_eligible,
    _lane_check_new,
    _lane_check_old,
    _lane_check_stamped,
    format_divergences,
)


def _owned_write(agent_id="a1", agent_type="general-purpose", is_error=False):
    """A materialize_facts call with no personId -- owning_skills attributes this
    to person-evidence, so it's a protected write find_protected_writes_by_
    unnamed_delegate flags when the caller is neither the main thread nor a
    dedicated agent."""
    entry = {
        "tool": "mcp__genealogy__materialize_facts",
        "args": {"recordId": "rec_1", "recordRole": "child"},
        "agent_id": agent_id,
        "agent_type": agent_type,
    }
    if is_error:
        entry["is_error"] = True
    return entry


def _unowned_call(agent_id="a1", agent_type="general-purpose", is_error=False):
    """A tool owning_skills never attributes to any guardrail skill -- errored or
    not, this can never be a lane-check divergence."""
    entry = {
        "tool": "mcp__genealogy__record_search",
        "args": {},
        "agent_id": agent_id,
        "agent_type": agent_type,
    }
    if is_error:
        entry["is_error"] = True
    return entry


def test_lane_check_eligible_false_for_an_errored_call_on_an_unowned_tool():
    calls = [_unowned_call(is_error=True)]
    assert _lane_check_eligible(calls) is False


def test_lane_check_eligible_true_for_an_errored_owned_write_from_a_named_delegate():
    calls = [_owned_write(agent_id="a1", agent_type="general-purpose", is_error=True)]
    assert _lane_check_eligible(calls) is True


def test_lane_check_eligible_false_when_the_owned_write_is_not_errored():
    """agent_id present, owned write present -- but not errored, so old and new
    already agree (both flag it), and this isn't where the fix's behavior differs."""
    calls = [_owned_write(agent_id="a1", agent_type="general-purpose", is_error=False)]
    assert _lane_check_eligible(calls) is False


def test_lane_check_stamped_true_whenever_any_entry_carries_an_agent_id_at_all():
    """Independent of is_error or ownership -- this is the "can this run speak to
    agent-attributed detectors at all" baseline, not the fix-specific predicate."""
    calls = [_unowned_call(is_error=False)]
    assert _lane_check_stamped(calls) is True


def test_lane_check_stamped_false_on_historical_runs_with_no_agent_id_key():
    calls = [{"tool": "mcp__genealogy__record_search", "args": {}}]
    assert _lane_check_stamped(calls) is False


def test_lane_check_old_and_new_disagree_on_an_errored_owned_write():
    calls = [_owned_write(agent_id="a1", agent_type="general-purpose", is_error=True)]
    assert len(_lane_check_old(calls)) == 0
    assert len(_lane_check_new(calls)) == 1


def test_lane_check_old_and_new_agree_when_the_same_entry_is_not_errored():
    calls = [_owned_write(agent_id="a1", agent_type="general-purpose", is_error=False)]
    assert len(_lane_check_old(calls)) == len(_lane_check_new(calls)) == 1


def test_lane_check_old_mirrors_the_namespace_strip_no_divergence_on_a_namespaced_agent():
    """The replica must strip the plugin namespace exactly as the live detector does,
    or the old-vs-new diff would blame a namespaced value on the #1569 is_error fix
    (#1856, found in review). A namespaced record-extractor is exempt under BOTH
    clauses, so old and new must agree at zero. Reverting the strip in _lane_check_old
    makes old flag the namespaced value while new does not -> a spurious divergence."""
    # owning_skills clause (materialize_facts owned by person-evidence)
    owned = [_owned_write(agent_id="a1", agent_type="genealogy-research:record-extractor")]
    assert _lane_check_old(owned) == _lane_check_new(owned) == []
    # extraction_append clause
    extraction = [
        {
            "tool": "mcp__genealogy__extraction_append",
            "args": {},
            "agent_id": "a1",
            "agent_type": "genealogy-research:record-extractor"
        }
    ]
    assert _lane_check_old(extraction) == _lane_check_new(extraction) == []


def test_lane_check_old_mirrors_the_1273_item4_arm_no_divergence():
    """The replica must carry the #1273 research_append->sources/assertions arm the
    live detector gained after it first shipped, or the old-vs-new diff blames those
    hits on the #1569 is_error fix (same replica-drift class as #1856, found in
    review). A non-errored general-purpose sources write is flagged by BOTH, so old
    and new must agree at 1. Dropping the arm from _lane_check_old makes new exceed
    old -> a spurious #1569 divergence."""
    calls = [
        {
            "tool": "mcp__genealogy__research_append",
            "args": {"section": "sources", "op": "append", "entry": {}},
            "agent_id": "a1",
            "agent_type": "general-purpose",
        }
    ]
    assert len(_lane_check_old(calls)) == len(_lane_check_new(calls)) == 1
    # a namespaced record-extractor is exempt under both arms -> agree at zero
    exempt = [
        {
            "tool": "mcp__genealogy__research_append",
            "args": {"section": "assertions", "op": "append", "entry": {}},
            "agent_id": "a1",
            "agent_type": "genealogy-research:record-extractor",
        }
    ]
    assert _lane_check_old(exempt) == _lane_check_new(exempt) == []


def test_format_divergences_on_an_empty_list():
    out = format_divergences("lane-check", [])
    assert "no divergence" in out
    assert "lane-check" in out
