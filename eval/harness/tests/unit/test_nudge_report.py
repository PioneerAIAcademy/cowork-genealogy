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

from e2e.nudge_report import EXCERPT_CHARS, _tail, classify, counter_totals, format_report, scan

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
            {"kind": "assistant", "text": "Plan written. Handing off to `search-records`.",
             "tool_calls_before": 2},
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
    # Free prose naming a next step is NOT a hand-back: #2292 specifies a literal
    # closing line and this fixture does not carry it. Under the old ANNOUNCE_RE this
    # asserted True, which is exactly the free-prose matching the lead set aside.
    assert nudge.hand_back == "silent"


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


def test_seam_is_other_when_nothing_matches_and_hand_back_class_is_independent():
    seam, hand_back = classify("Something entirely unrelated to any artifact.", "")
    assert seam == "other"
    assert hand_back == "silent"
    # The two axes are orthogonal: an unclassifiable seam can still carry a
    # well-formed hand-back, and that pairing is the interesting one.
    seam, hand_back = classify("Unrelated prose. Next: person-evidence. Continue?", "")
    assert seam == "other"
    assert hand_back == "step"
    # Free prose that merely NAMES the next step is not a hand-back — this is the
    # case the old ANNOUNCE_RE counted and #2292's literal form does not.
    seam, hand_back = classify("Unrelated prose. Proceeding to person-evidence.", "")
    assert hand_back == "silent"


def test_classify_uses_the_untruncated_text_not_the_printed_excerpt():
    """`classify_hand_back` tests `"Next: " in t`, which a 240-char suffix cut does not
    survive once the step description is long enough to push `Next: ` out of the tail.

    With an ordinary step name ("research-plan") `Next: ` sits ~30 chars from the end
    and the tail keeps it, so this is cheap insurance rather than a live defect — but
    the cost of being wrong is a class that differs between the harness and the report
    for the same run, which is the one thing a shared predicate exists to prevent.
    """
    long_step = "review the 1900 census household composition and " * 6  # > EXCERPT_CHARS
    full = f"Next: {long_step}. Continue?"
    assert len(full) > EXCERPT_CHARS
    assert "Next: " not in _tail(full), "premise: the cut must drop the lead-in"

    _, from_full = classify(_tail(full), "", full_text=full)
    assert from_full == "step"

    # The bug this guards: classifying the printed tail alone loses the lead-in.
    _, from_tail_only = classify(_tail(full), "")
    assert from_tail_only == "silent"


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


def test_scan_classifies_the_untruncated_text_not_the_printed_tail(tmp_path):
    """Through `scan()`, the production path — not `classify()` directly.

    An earlier version of this fix computed the untruncated text and then forgot to
    pass it, so the report still classified the 240-char tail while a direct-call
    test passed. A test that bypasses the real path proves nothing about it.
    """
    long_step = "review the 1900 census household composition and " * 6
    p = _write_run(
        tmp_path,
        narration=[
            {"kind": "assistant", "text": f"Next: {long_step}. Continue?",
             "tool_calls_before": 1},
            {"kind": "harness", "text": NUDGE, "tool_calls_before": 1},
        ],
        tool_calls=[{"tool": "mcp__genealogy__research_append"}],
    )
    (nudge,) = scan([p])
    assert "Next: " not in nudge.excerpt, "premise: the printed tail drops the lead-in"
    assert nudge.hand_back == "step"


def test_scan_ignores_text_that_a_tool_call_landed_after(tmp_path):
    """The orchestrator only classifies the last words when nothing ran after them.
    The report must agree, or the same run gets two classes."""
    p = _write_run(
        tmp_path,
        narration=[
            {"kind": "assistant", "text": "Next: research-plan. Continue?",
             "tool_calls_before": 1},
            {"kind": "harness", "text": NUDGE, "tool_calls_before": 3},
        ],
        tool_calls=[{"tool": "a"}, {"tool": "b"}, {"tool": "c"}],
    )
    (nudge,) = scan([p])
    assert nudge.hand_back == "silent"
