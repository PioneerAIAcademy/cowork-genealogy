"""Unit tests for e2e.stop_checker — JSON reads + stop_reason derivation."""

from __future__ import annotations

import json
import re
from pathlib import Path

from e2e.stop_checker import (
    COUNTED_TERMINAL_REASONS,
    classify_hand_back,
    hand_back_outcome,
    terminal_reason,
    derive_stop_reason,
    project_completed,
    read_research_json,
    read_tree_json,
    should_continue_run,
)


def test_read_research_json_returns_none_when_missing(tmp_path: Path):
    assert read_research_json(tmp_path) is None


def test_read_research_json_returns_none_on_invalid_json(tmp_path: Path):
    (tmp_path / "research.json").write_text("{not valid", encoding="utf-8")
    assert read_research_json(tmp_path) is None


def test_read_research_json_parses_valid(tmp_path: Path):
    (tmp_path / "research.json").write_text(json.dumps({"project": {"status": "in_progress"}}), encoding="utf-8")
    parsed = read_research_json(tmp_path)
    assert parsed == {"project": {"status": "in_progress"}}


def test_read_tree_json_returns_none_when_missing(tmp_path: Path):
    assert read_tree_json(tmp_path) is None


def test_read_tree_json_parses_valid(tmp_path: Path):
    (tmp_path / "tree.gedcomx.json").write_text(json.dumps({"persons": []}), encoding="utf-8")
    parsed = read_tree_json(tmp_path)
    assert parsed == {"persons": []}


def test_project_completed_true_when_status_completed():
    assert project_completed({"project": {"status": "completed"}}) is True


def test_project_completed_false_when_in_progress():
    assert project_completed({"project": {"status": "in_progress"}}) is False


def test_project_completed_false_on_none():
    assert project_completed(None) is False


def test_project_completed_false_on_missing_project_field():
    assert project_completed({}) is False


def test_derive_stop_reason_timeout_beats_completed():
    """A wall-clock cap that fires AFTER the agent set status=completed
    still reports as `timeout` — caps win over status."""
    assert (
        derive_stop_reason(
            sdk_aborted_reason="max_wall_clock_seconds",
            research={"project": {"status": "completed"}},
        )
        == "timeout"
    )


def test_derive_stop_reason_tool_cap():
    assert (
        derive_stop_reason(sdk_aborted_reason="max_tool_calls", research=None)
        == "tool_cap"
    )


def test_derive_stop_reason_max_turns():
    assert (
        derive_stop_reason(sdk_aborted_reason="max_turns", research=None)
        == "max_turns"
    )


def test_derive_stop_reason_cost_cap():
    assert (
        derive_stop_reason(sdk_aborted_reason="cost_cap", research=None)
        == "cost_cap"
    )


def test_derive_stop_reason_cost_cap_beats_completed():
    """A cost cap that fires after the agent set status=completed still
    reports as `cost_cap` — caps win over status (same rule as timeout)."""
    assert (
        derive_stop_reason(
            sdk_aborted_reason="cost_cap",
            research={"project": {"status": "completed"}},
        )
        == "cost_cap"
    )


def test_derive_stop_reason_inactivity():
    assert (
        derive_stop_reason(sdk_aborted_reason="sdk_stream_silence", research=None)
        == "inactivity"
    )


def test_derive_stop_reason_error():
    assert (
        derive_stop_reason(sdk_aborted_reason="error", research=None)
        == "error"
    )


def test_derive_stop_reason_mcp_unavailable():
    assert (
        derive_stop_reason(sdk_aborted_reason="mcp_unavailable", research=None)
        == "mcp_unavailable"
    )


def test_derive_stop_reason_mcp_unavailable_beats_completed():
    """#941's exact regression: two of the three lost runs self-declared
    `completed` while making zero genealogy tool calls, and were reported as
    research failures. The environment reason must win."""
    assert (
        derive_stop_reason(
            sdk_aborted_reason="mcp_unavailable",
            research={"project": {"status": "completed"}},
        )
        == "mcp_unavailable"
    )


def test_derive_stop_reason_completed_when_no_abort_and_status_set():
    assert (
        derive_stop_reason(
            sdk_aborted_reason=None,
            research={"project": {"status": "completed"}},
        )
        == "completed"
    )


def test_derive_stop_reason_natural_end_when_no_abort_and_incomplete():
    assert (
        derive_stop_reason(
            sdk_aborted_reason=None,
            research={"project": {"status": "in_progress"}},
        )
        == "natural_end"
    )


# --- should_continue_run (continue-nudge decision) -------------------

_INCOMPLETE = {"project": {"status": "in_progress"}}
_DONE = {"project": {"status": "completed"}}


def test_should_continue_blocks_when_unfinished_and_progressing():
    """Unfinished project, budget left, and tool calls made since the last
    nudge → veto the stop and nudge onward."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=1, max_nudges=5,
        tool_count=12, tool_count_at_last_nudge=8,
    ) is True


def test_should_continue_allows_when_completed():
    assert should_continue_run(
        research=_DONE, nudges_used=0, max_nudges=5,
        tool_count=20, tool_count_at_last_nudge=-1,
    ) is False


def test_should_continue_allows_when_nudge_budget_spent():
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=5, max_nudges=5,
        tool_count=30, tool_count_at_last_nudge=10,
    ) is False


def test_should_continue_allows_when_no_progress_since_last_nudge():
    """A prior nudge produced no tool call → another won't help; let the run
    end and fail rather than nudge a stuck agent forever."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=2, max_nudges=5,
        tool_count=15, tool_count_at_last_nudge=15,
    ) is False


def test_should_continue_blocks_first_nudge_even_with_equal_counts():
    """The no-progress guard only applies after the first nudge — the very
    first voluntary yield is always eligible."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=0, max_nudges=5,
        tool_count=5, tool_count_at_last_nudge=-1,
    ) is True


def test_should_continue_allows_when_mcp_unavailable():
    """#941 ask (3). Every other input says "nudge it onward" — unfinished
    project, full budget, progress since the last nudge — and the absent MCP
    surface still wins: there is nothing to resume into."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=1, max_nudges=5,
        tool_count=12, tool_count_at_last_nudge=8,
        mcp_unavailable=True,
    ) is False


def test_mcp_unavailable_defaults_false_so_existing_callers_are_unchanged():
    """The flag is opt-in: the same inputs that vetoed a stop before still do."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=1, max_nudges=5,
        tool_count=12, tool_count_at_last_nudge=8,
    ) is True


# --- hand-back classification (#2328) ----------------------------------------


def test_classify_hand_back_one_case_per_class():
    assert classify_hand_back("Next: research-plan. Continue?") == "step"
    assert classify_hand_back("Research complete.") == "completion_claim"
    assert classify_hand_back("I'll look at the 1900 census now.") == "silent"


def test_classify_hand_back_normalises_whitespace_itself():
    """Both callers must agree: the orchestrator passes a whole TextBlock, the report
    passes narration text. A predicate anchored to the end would otherwise diverge."""
    assert classify_hand_back("  Next: research-plan.\n\n  Continue?  ") == "step"
    assert classify_hand_back("Research\ncomplete.") == "completion_claim"


def test_classify_hand_back_rejects_free_prose_that_merely_names_a_step():
    """The lead set free-prose matching aside on 2026-09-07: the old ANNOUNCE_RE caught
    15 of 41 real yields. Only the literal form counts."""
    for prose in (
        "Proceeding to person-evidence.",
        "Handing off to search-records.",
        "Next up I will build the timeline.",
        "The research is complete.",
    ):
        assert classify_hand_back(prose) == "silent", prose


def test_classify_hand_back_takes_no_research_argument():
    """Half B (#1104) lifts this verbatim into a plugin hook that reads research.json
    itself. Keeping status out of the signature is what makes that lift possible."""
    import inspect

    assert list(inspect.signature(classify_hand_back).parameters) == ["text"]


def test_a_truthful_completion_is_not_a_false_completion():
    """The defect is claiming done while the project is NOT completed. 134 of the 181
    committed run logs stop on `completed`; counting those would make the rate
    dominated by runs that did exactly the right thing."""
    key, reply = hand_back_outcome("completion_claim", project_is_completed=True)
    assert key == "terminal_completed"
    assert reply is None

    key, reply = hand_back_outcome("completion_claim", project_is_completed=False)
    assert key == "false_completion"
    assert reply is not None and "research_query" in reply


def test_hand_back_outcome_wires_every_class():
    assert hand_back_outcome("step", project_is_completed=False) == ("step", "Yes.")
    assert hand_back_outcome("silent", project_is_completed=False) == ("silent", None)


def test_terminal_reason_mirrors_should_continue_run_precedence():
    """should_continue_run returns a bare bool for four reasons and only two are
    defects. These must agree on order or the counts attribute the wrong cause."""
    done = {"project": {"status": "completed"}}
    assert terminal_reason(research=done, nudges_used=0, max_nudges=40, mcp_unavailable=False) == "completed"
    # mcp_unavailable outranks everything, exactly as should_continue_run has it
    assert terminal_reason(research=done, nudges_used=0, max_nudges=40, mcp_unavailable=True) == "mcp_unavailable"
    assert terminal_reason(research=None, nudges_used=40, max_nudges=40, mcp_unavailable=False) == "budget"
    assert terminal_reason(research=None, nudges_used=1, max_nudges=40, mcp_unavailable=False) == "no_progress"

    # and only the two defect reasons are counted
    assert COUNTED_TERMINAL_REASONS == {"budget", "no_progress"}
    assert "completed" not in COUNTED_TERMINAL_REASONS
    assert "mcp_unavailable" not in COUNTED_TERMINAL_REASONS


def test_project_completed_still_short_circuits_should_continue_run():
    """The card notes the completion-claim-while-completed path was unreachable because
    this gate fires first. Classification now happens ABOVE the gate, so it IS
    reachable — which is exactly why hand_back_outcome must not call it a defect."""
    assert should_continue_run(
        research={"project": {"status": "completed"}},
        nudges_used=0,
        max_nudges=40,
        tool_count=5,
        tool_count_at_last_nudge=0,
    ) is False


SKILLS = Path(__file__).resolve().parents[4] / "packages/engine/plugin/skills"

# A hand-back literal as a SKILL.md instructs the model to emit it: quoted in
# backticks, starting with the lead-in. Anchored on the lead-in so a prose fragment
# like "end with `Continue?`" is not read as a literal, while a malformed literal
# (`Next: foo — continue?`) still is, and still has to classify.
HAND_BACK_LITERAL_RE = re.compile(r"`((?:Next: |Research complete)[^`]*)`")


def test_every_shipped_hand_back_literal_classifies():
    """Binds the classifier's literal to the prose the skills actually emit.

    Any skill can close the main thread's turn, so every SKILL.md is scanned, not
    only research/SKILL.md: init-project and question-selection carry the literal
    since PR #2649, and #2292 adds it to research. It fires when a closing line
    appears with wording classify_hand_back does not match — markdown emphasis
    alone (`**Research complete.**`) already fails the literal. That is the case
    in which `step: 0` looks correct on every surface while the classifier is
    silently broken, and nothing else in the suite can tell the two apart.
    """
    assert SKILLS.is_dir(), SKILLS
    seen = 0
    for skill_md in sorted(SKILLS.glob("*/SKILL.md")):
        for ln in skill_md.read_text(encoding="utf-8").splitlines():
            for literal in HAND_BACK_LITERAL_RE.findall(ln):
                seen += 1
                assert classify_hand_back(literal) in ("step", "completion_claim"), (
                    f"{skill_md.parent.name}/SKILL.md emits a closing line the "
                    f"classifier does not match, so `step` will stay 0 and read as "
                    f"expected: {ln!r}"
                )
    assert seen >= 2, "init-project and question-selection carry the literal today"
