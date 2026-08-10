"""Unit tests for the continue-nudge seam reader (issue #1104).

The behaviour worth pinning is the two-source union. `narration` replaced
`<run>.transcript.md` in #1238, so at the time of writing the newer field
covers 2 of 145 committed runs while the transcripts hold 20 of the 23 nudge
events. A reader that understands only one source silently reports a fraction
of the corpus and looks like it worked — which is exactly the failure these
tests exist to catch.
"""

from __future__ import annotations

import json

from e2e.nudge_report import classify, counter_totals, format_report, scan

NUDGE = "continue-nudge 1/20: agent yielded before project.status=='completed'; instructing it to resume the loop."


def _write_run(tmp_path, *, narration=None, tool_calls=None, transcript=None,
               continue_nudges=None, stem="run-2026-08-09_00-00-00"):
    """A committed-run pair on disk: `<slug>/run-<ts>.json` (+ optional transcript)."""
    slug = tmp_path / "some-fixture"
    slug.mkdir(parents=True, exist_ok=True)
    result = slug / f"{stem}.json"
    doc = {"narration": narration or [], "tool_calls": tool_calls or []}
    if continue_nudges is not None:
        doc["usage"] = {"continue_nudges": continue_nudges}
    result.write_text(json.dumps(doc), encoding="utf-8")
    if transcript is not None:
        result.with_suffix(".transcript.md").write_text(transcript, encoding="utf-8")
    return result


def test_reads_a_nudge_from_narration_with_the_tool_it_yielded_after(tmp_path):
    p = _write_run(
        tmp_path,
        narration=[
            {"kind": "assistant", "text": "Plan written. Handing off to `search-records`."},
            {"kind": "harness", "text": NUDGE, "tool_calls_before": 2},
        ],
        tool_calls=[{"tool": "mcp__genealogy__research_query"}, {"tool": "mcp__genealogy__research_append"}],
    )
    (nudge,) = scan([p])
    assert nudge.index == 1 and nudge.cap == 20
    assert nudge.source == "narration"
    # tool_calls_before is an index INTO tool_calls, so the call it yielded
    # after is the one before it — off-by-one here silently misattributes
    # every seam in the report.
    assert nudge.after_tool == "mcp__genealogy__research_append"
    assert nudge.seam == "plan-written"
    assert nudge.announced is True


def test_falls_back_to_the_transcript_when_narration_has_no_nudge(tmp_path):
    p = _write_run(
        tmp_path,
        narration=[{"kind": "assistant", "text": "irrelevant"}],
        transcript=(
            "## Trace\n\n"
            "Locality guide persisted for Varazdin County.\n\n"
            f"**[HARNESS]** {NUDGE}\n"
        ),
    )
    (nudge,) = scan([p])
    assert nudge.source == "transcript"
    assert nudge.seam == "locality-persisted"
    # No tool markers exist in that format; the field must stay empty rather
    # than guess, or the report invents attributions it cannot support.
    assert nudge.after_tool == ""


def test_a_run_is_read_from_one_source_only(tmp_path):
    """Both sources present must not double-count the same yield."""
    p = _write_run(
        tmp_path,
        narration=[
            {"kind": "assistant", "text": "Plan written."},
            {"kind": "harness", "text": NUDGE, "tool_calls_before": 1},
        ],
        tool_calls=[{"tool": "mcp__genealogy__research_append"}],
        transcript=f"## Trace\n\nPlan written.\n\n**[HARNESS]** {NUDGE}\n",
    )
    assert len(scan([p])) == 1


def test_a_harness_line_that_is_not_a_nudge_is_ignored(tmp_path):
    p = _write_run(
        tmp_path,
        transcript="## Trace\n\nwork\n\n**[HARNESS]** run resumed after a transient error.\n",
        narration=[],
    )
    assert scan([p]) == []


def test_seam_is_other_when_nothing_matches_and_announcement_is_independent():
    seam, announced = classify("Something entirely unrelated to any artifact.", "")
    assert seam == "other"
    assert announced is False
    # The two axes are orthogonal: an unclassifiable seam can still carry the
    # forbidden announcement, and that pairing is the interesting one.
    seam, announced = classify("Unrelated prose. Proceeding to person-evidence.", "")
    assert seam == "other"
    assert announced is True


def test_empty_corpus_reports_a_result_rather_than_looking_broken():
    out = format_report([], n_runs=12)
    assert "No continue-nudges" in out
    assert "real result" in out


def test_unreadable_nudges_are_never_reported_as_a_clean_loop(tmp_path):
    """The bug this exists to stop: 91 of 98 nudged runs keep neither source.

    A run whose only record of the yield is `usage.continue_nudges` used to
    print "every run in the window completed its loop without the Stop hook
    re-instructing it" — the exact opposite of what happened. Live example:
    `make e2e-nudges TEST=william-ferber-origins`, whose five committed runs
    recorded sixteen nudges and none of which has a transcript.
    """
    p = _write_run(tmp_path, continue_nudges=9)
    assert scan([p]) == []
    assert counter_totals([p]) == (9, 1)

    out = format_report([], n_runs=1, recorded=counter_totals([p]))
    assert "9 nudge(s) in 1 of 1 run(s)" in out
    assert "NOT ONE is attributable" in out
    assert "completed its loop" not in out


def test_the_attributed_count_names_the_runs_it_could_not_read(tmp_path):
    """The headline is a sample, and has to say by how much."""
    readable = _write_run(
        tmp_path,
        narration=[
            {"kind": "assistant", "text": "Plan written."},
            {"kind": "harness", "text": NUDGE, "tool_calls_before": 1},
        ],
        tool_calls=[{"tool": "mcp__genealogy__research_append"}],
        continue_nudges=1,
    )
    blind = _write_run(tmp_path, continue_nudges=7, stem="run-2026-08-09_11-11-11")

    paths = [readable, blind]
    out = format_report(scan(paths), n_runs=2, recorded=counter_totals(paths))
    assert "ATTRIBUTED 1 of the 8" in out
    assert "1 nudged run(s) carry neither" in out


def test_counter_totals_ignores_runs_that_never_nudged(tmp_path):
    clean = _write_run(tmp_path, continue_nudges=0)
    unstamped = _write_run(tmp_path, stem="run-2026-08-09_22-22-22")
    assert counter_totals([clean, unstamped]) == (0, 0)
