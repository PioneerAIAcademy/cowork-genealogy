"""Unit tests for e2e.result — result schema and artifact writing."""

from __future__ import annotations

import dataclasses
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from e2e.result import (
    HARNESS_SCHEMA_VERSION,
    E2eResult,
    axes_from_runlog,
    detector_era_runlog,
    is_committable_run,
    overall_outcome,
    runlog_prefix,
    timestamp_slug,
    write_result_files,
)
from e2e.runlog_selection import all_result_jsons


def committed_e2e_runlogs() -> list[tuple[Path, dict]]:
    """Every committed e2e run log, paired with its parsed payload.

    Discovery goes through `runlog_selection.all_result_jsons` — the same
    filter every corpus reader uses — so a change to what counts as a
    committed result reaches these tests instead of leaving a private glob
    behind to drift.
    """
    paths = all_result_jsons()
    if not paths:
        pytest.skip("no committed e2e runlogs in this checkout")
    return [(p, json.loads(p.read_text(encoding="utf-8"))) for p in paths]


def test_timestamp_slug_is_filesystem_safe():
    t = datetime(2026, 5, 26, 14, 30, 45, tzinfo=timezone.utc)
    slug = timestamp_slug(t)
    assert slug == "2026-05-26_14-30-45"
    # No characters that would need shell escaping
    assert all(c.isalnum() or c in "-_" for c in slug)


def test_write_result_files_creates_all_artifacts(tmp_path: Path):
    runlog_dir = tmp_path / "runlogs" / "smith-parents-1850"
    result = E2eResult(
        test_id="smith-parents-1850",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
        judge_output={"verdict": "pass", "recall_required": 1.0},
        usage={"total_cost_usd": 3.40},
        tool_calls=[{"tool": "mcp__genealogy__tree_read", "args": {}, "response_summary": "..."}],
        tags={"question_type": "parents"},
    )
    paths = write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        final_tree={"persons": [{"id": "p1"}]},
        final_research={"project": {"status": "completed"}},
        timestamp="2026-05-26_14-30-45",
    )

    assert paths["result"].exists()
    assert paths["tree"].exists()
    assert paths["research"].exists()

    # Result is valid JSON with expected fields
    payload = json.loads(paths["result"].read_text(encoding="utf-8"))
    assert payload["test_id"] == "smith-parents-1850"
    assert payload["verdict"] == "pass"
    assert payload["stop_reason"] == "completed"
    assert payload["tags"]["question_type"] == "parents"
    assert payload["tool_calls"][0]["tool"] == "mcp__genealogy__tree_read"


def test_write_result_files_serializes_blocked_context_calls(tmp_path: Path):
    """The denied main-thread `extraction_append` (#942) reaches the runlog JSON.

    `test_e2e_context_block.py` proves the deny is DECIDED and threaded out of
    `_run_agent`; this closes the other end — that the `E2eResult` field is
    carried through `asdict()` into the committed `run-<ts>.json`, kept as a
    separate array from `blocked_tree_reads` (they are denied by different
    guards, spec §6.1.1). Together the two tests cover the whole path without a
    full `run_e2e_test` run.
    """
    runlog_dir = tmp_path / "runlogs" / "smith-parents-1850"
    result = E2eResult(
        test_id="smith-parents-1850",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
        judge_output={"verdict": "pass"},
        usage={},
        blocked_tree_reads=[{"tool": "person_read", "args": {"personId": "X"}}],
        blocked_context_calls=[
            {
                "tool": "extraction_append",
                "args": {"assertions": [], "sources": []},
                "blocked_by": "context",
            }
        ],
    )
    paths = write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        final_tree=None,
        final_research=None,
        timestamp="2026-05-26_14-30-45",
    )

    payload = json.loads(paths["result"].read_text(encoding="utf-8"))
    assert payload["blocked_context_calls"] == [
        {
            "tool": "extraction_append",
            "args": {"assertions": [], "sources": []},
            "blocked_by": "context",
        }
    ]
    # The two guards stay in distinct arrays — a write denied by the context
    # policy must not be conflated with a denied live-tree read.
    assert payload["blocked_tree_reads"] == [
        {"tool": "person_read", "args": {"personId": "X"}}
    ]


def test_write_result_files_defaults_blocked_context_calls_to_empty(tmp_path: Path):
    """A clean run writes an empty array, not a missing key — a reader can always
    index `blocked_context_calls` without a KeyError."""
    runlog_dir = tmp_path / "runlogs" / "clean-run"
    result = E2eResult(
        test_id="clean-run",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
        judge_output={"verdict": "pass"},
        usage={},
    )
    paths = write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        final_tree=None,
        final_research=None,
        timestamp="2026-05-26_14-30-45",
    )

    payload = json.loads(paths["result"].read_text(encoding="utf-8"))
    assert payload["blocked_context_calls"] == []


def test_write_result_files_handles_missing_tree_and_research(tmp_path: Path):
    """If the agent crashed before producing tree/research, we still get
    the result file."""
    runlog_dir = tmp_path / "runlogs" / "crashed-test"
    result = E2eResult(
        test_id="crashed-test",
        captured_at="2026-05-26_14-30-45",
        verdict="skipped",
        stop_reason="error",
        error="boom",
    )
    paths = write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        final_tree=None,
        final_research=None,
        timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].exists()
    assert not paths["tree"].exists()
    assert not paths["research"].exists()


def test_is_committable_run_graded_verdicts():
    for v in ("pass", "partial", "fail", "ungraded"):
        assert is_committable_run(v) is True
    for v in ("skipped", "aborted", ""):
        assert is_committable_run(v) is False


def test_runlog_prefix_graded_vs_scratch():
    assert runlog_prefix("pass") == "run-"
    assert runlog_prefix("partial") == "run-"
    assert runlog_prefix("fail") == "run-"
    assert runlog_prefix("ungraded") == "run-"
    assert runlog_prefix("skipped") == "scratch_"


def test_passing_run_uses_committable_run_prefix(tmp_path: Path):
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name == "run-2026-05-26_14-30-45.json"
    assert paths["result"].exists()


def test_gradeable_non_pass_run_uses_committable_run_prefix(tmp_path: Path):
    """partial and fail produced a tree, so they commit as run-<ts>.* (retained
    signal, and gradeable) — not scratch."""
    for verdict in ("partial", "fail"):
        result = E2eResult(
            test_id="t", captured_at="2026-05-26_14-30-45",
            verdict=verdict, stop_reason="natural_end",
        )
        paths = write_result_files(
            result=result, runlog_dir=tmp_path,
            final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
        )
        assert paths["result"].name == "run-2026-05-26_14-30-45.json", verdict


def test_skipped_run_uses_gitignored_scratch_prefix(tmp_path: Path):
    """A skipped run (judge never ran, no tree to grade) is named scratch_* so
    .gitignore keeps it out of version control."""
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="skipped", stop_reason="error",
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name == "scratch_2026-05-26_14-30-45.json"


def test_write_result_files_creates_runlog_dir(tmp_path: Path):
    """The runlog_dir is created if it doesn't exist (parents=True)."""
    runlog_dir = tmp_path / "deeply" / "nested" / "runlogs" / "id"
    assert not runlog_dir.exists()
    result = E2eResult(
        test_id="id",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
    )
    write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        final_tree=None,
        final_research=None,
    )
    assert runlog_dir.is_dir()


# --- The three axes (GitHub issue #972) -------------------------------------
#
# A run that gets the genealogy completely right and one that gets it wrong
# used to read identically: any guardrail violation overwrote the top-level
# verdict with "fail" and buried the judge's real result inside judge_output.


def test_clean_run_derives_pass_compliance_and_gate():
    r = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
    )
    assert (r.verdict, r.compliance, r.outcome) == ("pass", "pass", "pass")


def test_guardrail_bypass_does_not_touch_the_genealogical_verdict():
    """The literal defect in issue #972 — isabel-carvajal-daughter's shape.

    Recall was 1.0/1.0 and the judge said `pass`; the run bypassed
    `same_person` and `conflict-resolution`. Both facts must survive.
    """
    r = E2eResult(
        test_id="isabel-carvajal-daughter", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
        guardrail_bypass_violations=["'same_person' was never called for 'I1'"],
    )
    assert r.verdict == "pass", "the judge's genealogical result must survive"
    assert r.compliance == "fail"
    assert r.outcome == "fail", "the combined gate still fails the run"


@pytest.mark.parametrize(
    "verdict,violations,expected_outcome",
    [
        ("pass", [], "pass"),
        ("partial", [], "partial"),
        ("fail", [], "fail"),
        ("ungraded", [], "ungraded"),
        ("skipped", [], "skipped"),
        ("pass", ["v"], "fail"),
        ("partial", ["v"], "fail"),
        ("fail", ["v"], "fail"),
        ("ungraded", ["v"], "fail"),
        ("skipped", ["v"], "fail"),
    ],
)
def test_outcome_derivation_table(verdict, violations, expected_outcome):
    r = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict=verdict, stop_reason="completed",
        guardrail_bypass_violations=violations,
    )
    assert r.outcome == expected_outcome
    assert r.verdict == verdict, "verdict is never rewritten by compliance"


def test_axes_are_persisted_and_judge_output_is_left_alone(tmp_path: Path):
    """The violations belong at the top level, not stuffed into judge_output —
    `interpret-e2e-result` is forbidden to read judge_output at all."""
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
        judge_output={"verdict": "pass", "recall_required": 1.0},
        guardrail_bypass_violations=["'same_person' was never called for 'I1'"],
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree={"persons": []}, final_research={},
        timestamp="2026-05-26_14-30-45",
    )
    payload = json.loads(paths["result"].read_text(encoding="utf-8"))
    assert payload["verdict"] == "pass"
    assert payload["compliance"] == "fail"
    assert payload["outcome"] == "fail"
    assert payload["guardrail_bypass_violations"] == [
        "'same_person' was never called for 'I1'"
    ]
    assert payload["harness_schema_version"] == HARNESS_SCHEMA_VERSION
    assert "guardrail_bypass_violations" not in payload["judge_output"]


def test_a_judgeless_run_with_violations_stays_a_scratch_run(tmp_path: Path):
    """`runlog_prefix` keys on the genealogical verdict, so a run with nothing
    to grade is not force-committed just because the guardrail check fired.
    Before the split it was, which put an ungradeable run in front of the
    same-PR grading gate."""
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="skipped", stop_reason="error",
        guardrail_bypass_violations=["'person-evidence' was never invoked"],
    )
    assert result.outcome == "fail"
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree=None, final_research=None,
        timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name.startswith("scratch_")


def test_ungraded_verdict_derives_correct_axes():
    """An ungraded run (judge exception) has a tree but was never graded.
    It is committable (run- prefix) and its outcome passes through as
    'ungraded' when compliance is clean."""
    r = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="ungraded", stop_reason="completed",
    )
    assert r.compliance == "pass"
    assert r.outcome == "ungraded"
    assert is_committable_run(r.verdict) is True
    assert runlog_prefix(r.verdict) == "run-"


def test_ungraded_run_with_violations_is_still_committed(tmp_path: Path):
    """An ungraded run with violations stays committable — the tree exists
    and can be re-graded, unlike a skipped run which has no tree."""
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="ungraded", stop_reason="completed",
        guardrail_bypass_violations=["'person-evidence' was never invoked"],
    )
    assert result.outcome == "fail"
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree={"persons": []}, final_research={},
        timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name.startswith("run-")


# --- axes_from_runlog: reading the pre-#972 corpus --------------------------


def test_axes_from_runlog_reads_the_new_shape():
    data = {
        "harness_schema_version": 1,
        "verdict": "pass", "compliance": "fail", "outcome": "fail",
    }
    assert axes_from_runlog(data) == ("pass", "fail", "fail")


def test_axes_from_runlog_derives_a_missing_outcome_rather_than_raising():
    """A partially-written or future-shaped log must not blow up a reporter."""
    data = {"harness_schema_version": 1, "verdict": "partial", "compliance": "pass"}
    assert axes_from_runlog(data) == ("partial", "pass", "partial")


def test_axes_from_runlog_recovers_the_buried_verdict_from_a_legacy_log():
    """4 of the 5 committed logs in this shape are genealogically `pass`
    presented as `fail` — the whole reason the issue was filed."""
    data = {
        "verdict": "fail",  # the clobbered top-level value
        "guardrail_shadow_violations": [],
        "judge_output": {
            "verdict": "pass",
            "guardrail_bypass_violations": ["'same_person' was never called"],
        },
    }
    assert axes_from_runlog(data) == ("pass", "fail", "fail")


def test_axes_from_runlog_tolerates_a_legacy_log_whose_judge_never_ran():
    """`--skip-judge` plus a violation: judge_output carries no verdict."""
    data = {
        "verdict": "fail",
        "guardrail_shadow_violations": [],
        "judge_output": {"guardrail_bypass_violations": ["v"]},
    }
    assert axes_from_runlog(data) == ("skipped", "fail", "fail")


def test_axes_from_runlog_calls_pre_detector_runs_not_checked():
    """106 of 122 committed runs predate the detector. Reporting them `pass`
    would launder unknowns into confident passes."""
    data = {"verdict": "pass", "judge_output": {"verdict": "pass"}}
    assert axes_from_runlog(data) == ("pass", "not_checked", "pass")


def test_axes_from_runlog_calls_a_detector_era_clean_run_not_checked_too():
    """The fingerprint proves the detector was PRESENT, not that it was
    complete. The one committed run in this shape (bagley-father-1884)
    predates the `same_person` arm added because of it, and replaying today's
    checks against it finds a violation — so `pass` would be a known-false
    pass."""
    data = {"verdict": "pass", "guardrail_shadow_violations": []}
    assert axes_from_runlog(data) == ("pass", "not_checked", "pass")
    assert detector_era_runlog(data) is True


def test_detector_era_runlog_is_false_for_pre_detector_and_v1_logs():
    assert detector_era_runlog({"verdict": "pass"}) is False
    assert (
        detector_era_runlog(
            {"harness_schema_version": 1, "guardrail_shadow_violations": []}
        )
        is False
    ), "v1+ logs carry `compliance` directly; the fingerprint is meaningless there"


# --- The fingerprint is load-bearing; pin it --------------------------------


def test_the_fingerprint_field_still_exists_on_the_dataclass():
    """The structural half of the guarantee, and the one that actually bites.

    `detector_era_runlog` reads `guardrail_shadow_violations`, a
    `default_factory` field that landed in the same commit as the §4.4
    detector (25e61c9f). Its presence in a persisted runlog is the ONLY signal
    distinguishing "this log's writer had the detector" for the pre-v1 corpus:
    `usage.cli_version` is absent or null in every committed run, and nothing
    records a git sha.

    That field is documented as SHADOW MODE ONLY and is expected to be retired
    when §4.1 graduates (issue #911). This asserts the removal is a loud
    failure rather than a silent reclassification of every pre-v1 log.
    """
    names = {f.name for f in dataclasses.fields(E2eResult)}
    assert "guardrail_shadow_violations" in names, (
        "removing this field breaks axes_from_runlog's ability to date "
        "pre-v1 runlogs — read detector_era_runlog before deleting it"
    )


def test_the_known_detector_era_runlogs_are_still_identified():
    """The corpus half: the runs whose vintage was verified by hand.

    A SUBSET assertion, deliberately. Every e2e run committed before this
    schema version ships is also pre-v1 and also carries the fingerprint, so
    the set grows whenever someone lands a new run — an equality assertion
    here fails on an unrelated PR (it did, on this one). What must not change
    is that these six stop being recognized.
    """
    fingerprinted = set()
    for path, data in committed_e2e_runlogs():
        if detector_era_runlog(data):
            fingerprinted.add(path.parent.name)

    known_detector_era = {
        "amelia-gioiello-marriage",
        "bagley-father-1884",
        "estefania-zambrana-son",
        "eulogia-gatica-burial",
        "isabel-carvajal-daughter",
        "mary-dwyer-father",
    }
    assert known_detector_era <= fingerprinted


def test_no_pre_v1_runlog_is_reported_compliance_pass():
    """Corollary of the above, and the correction that matters most: every
    **pre-v1** log resolves to `fail` or `not_checked`, never a bare `pass`.
    The only run that could have claimed `pass` (bagley-father-1884) is one we
    can demonstrate was non-compliant.

    Scoped to pre-v1 logs deliberately: a v1+ log (`harness_schema_version`
    present) is allowed to report a genuine `compliance == "pass"` — that's
    the whole point of separating compliance from the pre-v1 conflation this
    test is about. Skip those here rather than asserting something false
    about them.
    """
    for path, data in committed_e2e_runlogs():
        if "harness_schema_version" in data:
            continue
        _verdict, compliance, _outcome = axes_from_runlog(data)
        assert compliance in {"fail", "not_checked"}, path


def test_the_gate_reproduces_todays_fused_verdict_across_the_pre_v1_corpus():
    """Behavior-preservation proof for the exit-code change, scoped to the
    **pre-v1** corpus that existed when the split landed.

    Before the split, a guardrail bypass forced `verdict = "fail"` and the
    exit code keyed on that. Now it forces `outcome = "fail"` and the exit
    code keys on THAT. Over every committed PRE-V1 run the two distributions
    must be identical — otherwise this refactor silently changed which runs
    fail CI.

    Deliberately excludes v1+ logs (`harness_schema_version` present): for
    those, `verdict` and `outcome` are SUPPOSED to diverge whenever compliance
    fails but the judge's own verdict is `pass`/`partial` — that divergence is
    the entire reason `verdict`/`compliance`/`outcome` were split apart in the
    first place. Asserting `outcome == verdict` for v1+ data would re-impose
    the pre-split conflation on the very data the split exists to distinguish.
    v1+ logs get their own fusing-correctness proof in
    `test_v1_plus_runlogs_have_an_internally_consistent_outcome` below,
    instead of no proof at all.
    """
    for path, data in committed_e2e_runlogs():
        if "harness_schema_version" in data:
            continue
        _verdict, _compliance, outcome = axes_from_runlog(data)
        assert outcome == data["verdict"], (
            f"{path}: gate disagrees with the pre-split fused verdict"
        )


def test_v1_plus_runlogs_have_an_internally_consistent_outcome():
    """The v1+ counterpart to the proof above.

    `outcome` is never checked against the raw `verdict` field here — for
    v1+ logs the two are allowed to differ by design (see the previous
    test's docstring). What must always hold instead is that `outcome` is
    the correct FUSION of `verdict` and `compliance`: `fail` whenever
    compliance failed, else the verdict, exactly as `overall_outcome`
    defines it. This is what would catch a future regression in the fusing
    logic itself (e.g. `E2eResult.__post_init__` computing it wrong before
    a log is written).

    The persisted `data["outcome"]` is compared, NOT the one
    `axes_from_runlog` returns. That function falls back to
    `overall_outcome(...)` when the key is missing or empty, so asserting
    against its return value would compare the fallback to itself and pass
    unconditionally on exactly the malformed log this test exists to catch.
    """
    checked = 0
    for path, data in committed_e2e_runlogs():
        if "harness_schema_version" not in data:
            continue
        verdict, compliance, _derived = axes_from_runlog(data)
        assert data.get("outcome") == overall_outcome(verdict, compliance), path
        checked += 1

    # This test is meaningless if it silently checked zero logs — if that
    # ever happens, the premise (v1+ logs exist in the committed corpus) has
    # changed and this test needs a second look, not a silent pass.
    assert checked > 0, "no v1+ runlogs found in the committed corpus"


# ---- narration (replaced .transcript.md, 2026-08-03) ----------------------


def test_assistant_narration_persisted(tmp_path: Path):
    """The agent's prose between tool calls survives into the committed run
    log, in order, anchored to its position in `tool_calls`.

    This is the whole reason the transcript could be dropped: 93% of that file
    re-rendered `tool_calls`, but the narration lived nowhere else, and
    diagnosing a mid-loop yield (issue #1104) needs it *in position*.
    """
    result = E2eResult(
        test_id="t",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
        tool_calls=[
            {"tool": "a", "args": {}, "response_summary": "x"},
            {"tool": "b", "args": {}, "response_summary": "y"},
        ],
        narration=[
            {"tool_calls_before": 0, "kind": "assistant", "text": "routing to question-selection"},
            {"tool_calls_before": 1, "kind": "blocked", "text": "`person_read` denied"},
            {"tool_calls_before": 2, "kind": "harness", "text": "continue-nudge 1/20"},
        ],
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    payload = json.loads(paths["result"].read_text(encoding="utf-8"))

    assert [n["kind"] for n in payload["narration"]] == ["assistant", "blocked", "harness"]
    assert [n["tool_calls_before"] for n in payload["narration"]] == [0, 1, 2]
    assert payload["narration"][0]["text"] == "routing to question-selection"


def test_narration_is_not_interleaved_into_tool_calls(tmp_path: Path):
    """`tool_calls` keeps its specced {tool, args, response_summary} shape and
    its length.

    Interleaving narration into it would break two shipped skills that do
    `tc['tool']` over every entry, inflate `n_tool_calls` in the latency
    report, and — worst — shift the *index* windows
    find_unguarded_protected_writes() and recently_succeeded() compute, which
    would silently change the §7 shadow-window violation rate between old and
    new runs.
    """
    result = E2eResult(
        test_id="t",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
        tool_calls=[{"tool": "a", "args": {}, "response_summary": "x", "is_error": False}],
        narration=[{"tool_calls_before": 0, "kind": "assistant", "text": "hi"}],
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    payload = json.loads(paths["result"].read_text(encoding="utf-8"))

    assert len(payload["tool_calls"]) == 1
    assert set(payload["tool_calls"][0]) == {
        "tool",
        "args",
        "response_summary",
        "is_error",
    }


def test_no_transcript_artifact_is_written(tmp_path: Path):
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path,
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    assert "transcript" not in paths
    assert list(tmp_path.glob("*.transcript.md")) == []
