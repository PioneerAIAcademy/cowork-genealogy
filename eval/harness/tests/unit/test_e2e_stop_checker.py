"""Unit tests for e2e.stop_checker — JSON reads + stop_reason derivation."""

from __future__ import annotations

import json
import re
from pathlib import Path

from e2e.stop_checker import (
    classify_hand_back,
    derive_stop_reason,
    project_completed,
    read_research_json,
    read_tree_json,
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


def test_read_tree_json_returns_none_for_a_json_array(tmp_path: Path):
    """A tree parsing to an ARRAY is not None, so without the isinstance guard it
    passed every `is None` test its three callers make and then raised
    AttributeError on `.get(...)`. Same guard `read_research_json` documents."""
    (tmp_path / "tree.gedcomx.json").write_text("[1, 2]", encoding="utf-8")
    assert read_tree_json(tmp_path) is None


def test_read_tree_json_returns_none_on_invalid_utf8(tmp_path: Path):
    """`UnicodeDecodeError` is a ValueError, not an OSError, so a tree written in
    cp1252 -- the Windows default, and this team runs on Windows -- propagated
    out of every caller instead of degrading. `collect_post_hoc_shadow` reads
    this file on the paid e2e path, where a raise aborts the run before any
    result file is written.

    Written as raw bytes because the point is a file this process would not have
    produced."""
    (tmp_path / "tree.gedcomx.json").write_bytes(
        json.dumps({"persons": [{"id": "I1", "place": "Od\u00e9ssa"}]}, ensure_ascii=False).encode("cp1252")
    )
    assert read_tree_json(tmp_path) is None


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


def test_derive_stop_reason_host_slept():
    assert (
        derive_stop_reason(sdk_aborted_reason="host_slept", research=None)
        == "host_slept"
    )


def test_derive_stop_reason_host_slept_beats_completed():
    """#2974: like mcp_unavailable, a slept host must outrank a self-declared
    `completed` — the sleep consumed the budget, so whatever status the run left
    is not a graded outcome."""
    assert (
        derive_stop_reason(
            sdk_aborted_reason="host_slept",
            research={"project": {"status": "completed"}},
        )
        == "host_slept"
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
    """Form only: whether a completion claim is true is the caller's question."""
    import inspect

    assert list(inspect.signature(classify_hand_back).parameters) == ["text"]


SKILLS = Path(__file__).resolve().parents[4] / "packages/engine/plugin/skills"

# A hand-back literal as a SKILL.md instructs the model to emit it: quoted in
# backticks, starting with the lead-in. Anchored on the lead-in so a prose fragment
# like "end with `Continue?`" is not read as a literal, while a malformed literal
# (`Next: foo — continue?`) still is, and still has to classify.
HAND_BACK_LITERAL_RE = re.compile(r"`((?:Next: |Research complete)[^`]*)`")


def test_every_shipped_hand_back_literal_classifies():
    """Binds the classifier's literal to the prose the skills actually emit.

    Any skill can close the main thread's turn, so every SKILL.md is scanned, not
    only research/SKILL.md. It fires when a closing line appears with wording
    classify_hand_back does not match — markdown emphasis alone
    (`**Research complete.**`) already fails the literal. That is the case in
    which `step: 0` looks correct on every surface while the classifier is
    silently broken, and nothing else in the suite can tell the two apart.

    **The expected count is now ZERO, and that is the assertion.** This used to
    require `seen >= 2`, naming init-project and question-selection, which carried
    the literal since PR #2649. PR #2870 retired it outright ("Prose is
    flaky; the Stop hook is the mechanism") and both bodies
    dropped it, so the old floor pinned exactly the population the ruling deletes.
    Requiring zero is what makes a re-introduction fail here rather than pass
    silently.

    The loop above therefore has no input today, so it cannot be this test's
    coverage of the classifier — `test_classify_hand_back_one_case_per_class` and
    its siblings own that, and the classifier itself stays, because the committed
    e2e run logs that predate the ruling still contain the literal and are still
    read.
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
    assert seen == 0, (
        f"{seen} shipped SKILL.md still emit the retired `Next: … Continue?` hand-back "
        f"literal. PR #2870 retired it — the Stop hook is the mechanism now, and "
        f"a body that stops to ask is a stall."
    )


# ── step mode's offer line (section F) ──────────────────────────────────────────


def test_classify_hand_back_reads_step_modes_offer():
    """Every step turn ends on this line, and the host reads it to pick the next
    reply, so a run log that miscounts it misreports the whole mechanism."""
    assert classify_hand_back("The report.\n\nContinue with running the searches?") == "step_offer"
    assert classify_hand_back("Continue with wrapping up?") == "step_offer"
    # Normalised first, so a line split across the TextBlock still matches.
    assert classify_hand_back("report\n  Continue with   writing the conclusion?") == "step_offer"


def test_an_ordinary_closing_question_is_not_an_offer():
    """The lead is what discriminates. Without it every step that ended by asking
    the researcher something would be counted as an offer, and the host would
    reply to a question only they can answer."""
    for text in (
        "What was her maiden name?",
        "I found three records. Which should I follow?",
        "Shall I continue?",
        "Continue?",
    ):
        assert classify_hand_back(text) == "silent", text


def test_a_completion_claim_still_wins_over_an_offer():
    assert classify_hand_back("Continue with the conclusion? Research complete.") == "completion_claim"


def test_step_offer_wins_over_the_retired_literal_where_they_overlap():
    """`_STEP_OFFER_TAIL` is bare "?", which every ". Continue?" also ends with, so
    a text carrying both leads matches both arms. The live line wins; the
    "Next: " literal is retired and kept only as telemetry."""
    # A GENUINE overlap: ends with ". Continue?" (the retired tail) AND carries
    # "Continue with " (the live lead). An earlier version of this test used a
    # text ending "...the searches?", which matches only the live arm, so
    # swapping the arms left it passing and it proved nothing.
    both = "Next: research-plan. Continue with planning. Continue?"
    assert classify_hand_back(both) == "step_offer"
    # And the retired literal alone still reads as `step`, unchanged.
    assert classify_hand_back("Next: research-plan. Continue?") == "step"

# --- external_collection_keys (#2995) ----------------------------------------


def _write_collections(tmp_path: Path, doc) -> None:
    (tmp_path / "external-collections.json").write_text(
        doc if isinstance(doc, str) else json.dumps(doc), encoding="utf-8"
    )


def test_external_collection_keys_are_the_sorted_ancestry_keys_per_place(tmp_path: Path):
    from e2e.stop_checker import read_external_collection_keys

    _write_collections(tmp_path, {"places": {
        "Pennsylvania, United States": {"rows": [
            {"key": "ancestry:7163"}, {"key": "https://www.hsp.org/"}, {"key": "ancestry:1276"},
        ]},
        "Venango, Pennsylvania, United States": {"rows": []},
    }})
    assert read_external_collection_keys(tmp_path) == {
        "Pennsylvania, United States": ["ancestry:1276", "ancestry:7163"],
        "Venango, Pennsylvania, United States": [],
    }


def test_external_collection_keys_is_empty_when_missing_or_unusable(tmp_path: Path):
    from e2e.stop_checker import read_external_collection_keys

    assert read_external_collection_keys(tmp_path) == {}
    for bad, expected in (
        ("{not json", {}),
        ("[1]", {}),
        (json.dumps({"places": []}), {}),
        (json.dumps({"places": {"P": {"rows": "x"}}}), {"P": []}),
        (json.dumps({"places": {"P": "x"}}), {"P": []}),
        (json.dumps({"places": {"P": {"rows": ["x", {"key": 7}, {"key": "ancestry:1"}]}}}), {"P": ["ancestry:1"]}),
    ):
        _write_collections(tmp_path, bad)
        assert read_external_collection_keys(tmp_path) == expected, bad
