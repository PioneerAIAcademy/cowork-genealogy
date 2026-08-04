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
    runlog_prefix,
    timestamp_slug,
    write_result_files,
)


def test_timestamp_slug_is_filesystem_safe():
    t = datetime(2026, 5, 26, 14, 30, 45, tzinfo=timezone.utc)
    slug = timestamp_slug(t)
    assert slug == "2026-05-26_14-30-45"
    # No characters that would need shell escaping
    assert all(c.isalnum() or c in "-_" for c in slug)


def test_write_result_files_creates_all_four_artifacts(tmp_path: Path):
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
        transcript="# transcript\n",
        final_tree={"persons": [{"id": "p1"}]},
        final_research={"project": {"status": "completed"}},
        timestamp="2026-05-26_14-30-45",
    )

    assert paths["result"].exists()
    assert paths["transcript"].exists()
    assert paths["tree"].exists()
    assert paths["research"].exists()

    # Result is valid JSON with expected fields
    payload = json.loads(paths["result"].read_text(encoding="utf-8"))
    assert payload["test_id"] == "smith-parents-1850"
    assert payload["verdict"] == "pass"
    assert payload["stop_reason"] == "completed"
    assert payload["tags"]["question_type"] == "parents"
    assert payload["tool_calls"][0]["tool"] == "mcp__genealogy__tree_read"


def test_write_result_files_handles_missing_tree_and_research(tmp_path: Path):
    """If the agent crashed before producing tree/research, we still get
    the result+transcript files."""
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
        transcript="",
        final_tree=None,
        final_research=None,
        timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].exists()
    assert paths["transcript"].exists()
    assert not paths["tree"].exists()
    assert not paths["research"].exists()


def test_is_committable_run_graded_verdicts():
    for v in ("pass", "partial", "fail"):
        assert is_committable_run(v) is True
    for v in ("skipped", "aborted", ""):
        assert is_committable_run(v) is False


def test_runlog_prefix_graded_vs_scratch():
    assert runlog_prefix("pass") == "run-"
    assert runlog_prefix("partial") == "run-"
    assert runlog_prefix("fail") == "run-"
    assert runlog_prefix("skipped") == "scratch_"


def test_passing_run_uses_committable_run_prefix(tmp_path: Path):
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path, transcript="",
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
            result=result, runlog_dir=tmp_path, transcript="",
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
        result=result, runlog_dir=tmp_path, transcript="",
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name == "scratch_2026-05-26_14-30-45.json"
    assert paths["transcript"].name == "scratch_2026-05-26_14-30-45.transcript.md"


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
        transcript="",
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
        ("skipped", [], "skipped"),
        ("pass", ["v"], "fail"),
        ("partial", ["v"], "fail"),
        ("fail", ["v"], "fail"),
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
        result=result, runlog_dir=tmp_path, transcript="",
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
        result=result, runlog_dir=tmp_path, transcript="",
        final_tree=None, final_research=None,
        timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name.startswith("scratch_")


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
    runlogs = Path(__file__).resolve().parents[3] / "runlogs" / "e2e"
    if not runlogs.is_dir():
        pytest.skip("no committed e2e runlogs in this checkout")

    fingerprinted = set()
    for path in runlogs.glob("*/run-*.json"):
        if ".final-" in path.name or path.name.endswith(".ann.json"):
            continue
        if detector_era_runlog(json.loads(path.read_text(encoding="utf-8"))):
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


def test_no_committed_runlog_is_reported_compliance_pass():
    """Corollary of the above, and the correction that matters most: every
    pre-v1 log resolves to `fail` or `not_checked`, never a bare `pass`. The
    only run that could have claimed `pass` (bagley-father-1884) is one we can
    demonstrate was non-compliant."""
    runlogs = Path(__file__).resolve().parents[3] / "runlogs" / "e2e"
    if not runlogs.is_dir():
        pytest.skip("no committed e2e runlogs in this checkout")

    for path in runlogs.glob("*/run-*.json"):
        if ".final-" in path.name or path.name.endswith(".ann.json"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        _verdict, compliance, _outcome = axes_from_runlog(data)
        assert compliance in {"fail", "not_checked"}, path


def test_the_gate_reproduces_todays_fused_verdict_across_the_whole_corpus():
    """Behavior-preservation proof for the exit-code change.

    Before the split, a guardrail bypass forced `verdict = "fail"` and the
    exit code keyed on that. Now it forces `outcome = "fail"` and the exit
    code keys on THAT. Over every committed run the two distributions must be
    identical — otherwise this refactor silently changed which runs fail CI.
    """
    runlogs = Path(__file__).resolve().parents[3] / "runlogs" / "e2e"
    if not runlogs.is_dir():
        pytest.skip("no committed e2e runlogs in this checkout")

    for path in runlogs.glob("*/run-*.json"):
        if ".final-" in path.name or path.name.endswith(".ann.json"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        _verdict, _compliance, outcome = axes_from_runlog(data)
        assert outcome == data["verdict"], (
            f"{path}: gate disagrees with the pre-split fused verdict"
        )
