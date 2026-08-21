"""Unit tests for the hosted-feedback transcript adapter + its detector wiring
(issue #1558). All input is SYNTHETIC Claude-Code-shaped JSONL written here by
hand — never a real feedback bundle (bundle content must not enter the repo;
root CLAUDE.md, docs/alpha-feedback-guide.md)."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.feedback_transcript_adapter import adapt_bundle_transcript
from e2e.guardrail_shadow_report import (
    format_feedback_report,
    scan_feedback_bundle,
    scan_feedback_dir,
)


def _write_jsonl(path: Path, records: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


def _assistant(tool_use_blocks: list[dict], *, session_id: str = "s1") -> dict:
    return {
        "type": "assistant",
        "sessionId": session_id,
        "message": {"role": "assistant", "content": tool_use_blocks},
    }


def _user_result(blocks: list[dict], *, session_id: str = "s1") -> dict:
    return {
        "type": "user",
        "sessionId": session_id,
        "message": {"role": "user", "content": blocks},
    }


def test_tool_use_block_becomes_one_entry(tmp_path):
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [
        _assistant([
            {"type": "text", "text": "thinking out loud"},
            {"type": "tool_use", "id": "tu1", "name": "research_append",
             "input": {"section": "assertions", "op": "append"}},
        ]),
    ])
    out = adapt_bundle_transcript(log)
    assert len(out["tool_calls"]) == 1
    entry = out["tool_calls"][0]
    assert entry["tool"] == "research_append"
    assert entry["args"] == {"section": "assertions", "op": "append"}


def test_is_error_joins_from_matching_tool_result(tmp_path):
    """is_error on a tool_result may be absent, explicitly false, or true — all
    three occur in real transcripts (explicit false is the most common). bool()
    reads each correctly; a missing key must read as success, not be left unset
    (the #999 trap)."""
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [
        _assistant([
            {"type": "tool_use", "id": "ok", "name": "record_search", "input": {}},
            {"type": "tool_use", "id": "plain", "name": "record_search", "input": {}},
            {"type": "tool_use", "id": "bad", "name": "record_search", "input": {}},
        ]),
        _user_result([
            {"type": "tool_result", "tool_use_id": "ok", "content": "hits"},  # no is_error key
            {"type": "tool_result", "tool_use_id": "plain", "content": "ok", "is_error": False},
            {"type": "tool_result", "tool_use_id": "bad", "content": "boom", "is_error": True},
        ]),
    ])
    out = adapt_bundle_transcript(log)
    assert out["tool_calls"][0]["is_error"] is False  # missing key -> success
    assert out["tool_calls"][1]["is_error"] is False   # explicit false -> success
    assert out["tool_calls"][2]["is_error"] is True    # explicit true -> error


def test_truncation_note_line_sets_truncated(tmp_path):
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [
        {"type": "_truncation_note", "dropped_leading_entries": 12},
        _assistant([{"type": "tool_use", "id": "t", "name": "record_read", "input": {}}]),
    ])
    out = adapt_bundle_transcript(log)
    assert out["truncated"] is True
    assert len(out["tool_calls"]) == 1  # the note is not itself a tool call


def test_no_truncation_note_stays_false(tmp_path):
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [_assistant([{"type": "tool_use", "id": "t", "name": "x", "input": {}}])])
    assert adapt_bundle_transcript(log)["truncated"] is False


def test_forked_session_ids_are_all_returned(tmp_path):
    """A resumed session can fork its id — return both, first-seen order, so a
    caller never assumes one transcript is one session."""
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [
        _assistant([{"type": "tool_use", "id": "a", "name": "x", "input": {}}], session_id="s1"),
        _assistant([{"type": "tool_use", "id": "b", "name": "y", "input": {}}], session_id="s2"),
    ])
    assert adapt_bundle_transcript(log)["session_ids"] == ["s1", "s2"]


def test_malformed_and_blank_lines_do_not_raise(tmp_path):
    log = tmp_path / "session-log.jsonl"
    log.write_text(
        json.dumps(_assistant([{"type": "tool_use", "id": "t", "name": "x", "input": {}}]))
        + "\n\n{ this is not json\n",
        encoding="utf-8",
    )
    out = adapt_bundle_transcript(log)  # must not raise
    assert len(out["tool_calls"]) == 1


def test_scan_feedback_bundle_runs_both_detectors_and_counts(tmp_path):
    """Wiring: a bundle dir with a transcript + research.json yields tool/Skill
    counts, the truncated flag, and both detectors' finding lists."""
    bundle = tmp_path / "some-tester-slug"
    (bundle / "_feedback").mkdir(parents=True)
    _write_jsonl(bundle / "_feedback" / "session-log.jsonl", [
        _assistant([{"type": "tool_use", "id": "s", "name": "Skill",
                     "input": {"skill": "proof-conclusion"}}]),
        _assistant([{"type": "tool_use", "id": "r", "name": "record_search", "input": {}}]),
    ])
    (bundle / "research.json").write_text("{}", encoding="utf-8")

    result = scan_feedback_bundle(bundle)
    assert result["bundle"] == "some-tester-slug"
    assert result["has_transcript"] is True
    assert result["truncated"] is False
    assert result["tool_call_count"] == 2
    assert result["skill_call_count"] == 1  # the Skill call, not record_search
    assert isinstance(result["unguarded_writes"], list)
    assert isinstance(result["missing_mentor_verdicts"], list)


def test_scan_feedback_bundle_cowork_no_transcript(tmp_path):
    """A Cowork bundle carries research.json but no transcript — the
    research.json-only detector still runs; the transcript-only one is empty."""
    bundle = tmp_path / "cowork-slug"
    bundle.mkdir()
    (bundle / "research.json").write_text("{}", encoding="utf-8")
    result = scan_feedback_bundle(bundle)
    assert result["has_transcript"] is False
    assert result["tool_call_count"] == 0
    assert result["unguarded_writes"] == []
    assert isinstance(result["missing_mentor_verdicts"], list)


def test_transcript_is_read_from_the_feedback_subdir(tmp_path):
    """Both producers write the transcript to `_feedback/session-log.jsonl`
    (feedback-case-spec.md §2.2), and `unzip -d` preserves that layout. Reading
    the bundle root instead would report has_transcript=False on every real
    bundle — a silent zero, the failure this feature exists to catch (#1558)."""
    bundle = tmp_path / "feedback-2026-08-01T10-00-00Z"
    (bundle / "_feedback").mkdir(parents=True)
    _write_jsonl(bundle / "_feedback" / "session-log.jsonl", [
        _assistant([{"type": "tool_use", "id": "t", "name": "record_search", "input": {}}]),
    ])
    (bundle / "research.json").write_text("{}", encoding="utf-8")
    result = scan_feedback_bundle(bundle)
    assert result["has_transcript"] is True
    assert result["tool_call_count"] == 1


def test_unreadable_research_json_is_flagged_not_counted_as_clean(tmp_path):
    """A missing or unparseable research.json must not read as "0 findings" —
    that is indistinguishable from a clean bundle. It is flagged
    (has_research / research_unreadable) so the report can show it and drop it
    from the mentor-verdict denominator."""
    # Unreadable (invalid JSON) research.json, no transcript.
    bad = tmp_path / "bad-research"
    bad.mkdir()
    (bad / "research.json").write_text("{not json", encoding="utf-8")
    r_bad = scan_feedback_bundle(bad)
    assert r_bad["has_research"] is True
    assert r_bad["research_unreadable"] is True
    assert r_bad["missing_mentor_verdicts"] == []

    # Missing research.json entirely.
    missing = tmp_path / "no-research"
    (missing / "_feedback").mkdir(parents=True)
    _write_jsonl(missing / "_feedback" / "session-log.jsonl", [
        _assistant([{"type": "tool_use", "id": "t", "name": "record_search", "input": {}}]),
    ])
    r_missing = scan_feedback_bundle(missing)
    assert r_missing["has_research"] is False
    assert r_missing["research_unreadable"] is False


# ── could_not_adapt vs quiet-session distinction (#1558 item 3) ───────────────

def _protected_write(*, block_id: str = "w") -> dict:
    """A `research_append` op the guardrail owns (proof_summaries) with no prior
    Skill call — fires `find_unguarded_protected_writes` exactly once."""
    return {"type": "tool_use", "id": block_id, "name": "research_append",
            "input": {"section": "proof_summaries", "op": "add",
                      "entry": {"id": "ps_001"}}}


def _mentor_gap_research() -> dict:
    """A resolved question whose proof summary carries no proof-critique verdict —
    `find_missing_mentor_verdicts` reports exactly one gap."""
    return {
        "questions": [{"id": "q_001", "status": "resolved"}],
        "proof_summaries": [{"id": "ps_001", "question_id": "q_001"}],
        "evaluations": [],
    }


def test_could_not_adapt_distinguishes_shape_mismatch_from_quiet_session(tmp_path):
    """A transcript whose lines carry no `message.content` list (a shape the
    adapter can't walk) is flagged could_not_adapt; a session that adapted fine
    but simply made no tool calls is NOT — an empty tool_calls can't tell them
    apart, this flag can (#1558 item 3)."""
    # Shape mismatch: lines are dicts, but none has message.content.
    bad = tmp_path / "unadaptable"
    (bad / "_feedback").mkdir(parents=True)
    _write_jsonl(bad / "_feedback" / "session-log.jsonl", [
        {"type": "summary", "summary": "no content list here"},
        {"type": "user", "message": {"role": "user"}},  # message present, content absent
    ])
    r_bad = scan_feedback_bundle(bad)
    assert r_bad["has_transcript"] is True
    assert r_bad["could_not_adapt"] is True
    assert r_bad["tool_call_count"] == 0

    # Quiet session: adaptable records present, just no tool_use blocks.
    quiet = tmp_path / "quiet"
    (quiet / "_feedback").mkdir(parents=True)
    _write_jsonl(quiet / "_feedback" / "session-log.jsonl", [
        {"type": "user", "message": {"content": [{"type": "text", "text": "hi"}]}},
        _assistant([{"type": "text", "text": "hello"}]),
    ])
    r_quiet = scan_feedback_bundle(quiet)
    assert r_quiet["has_transcript"] is True
    assert r_quiet["could_not_adapt"] is False
    assert r_quiet["tool_call_count"] == 0


# ── scan_feedback_dir: platform mapping + selection ──────────────────────────

def test_scan_feedback_dir_maps_platform_by_bundle_name(tmp_path):
    """`platforms` maps a bundle DIR NAME to its platform (the feedback issue's
    `Platform:` line — not in the bundle). Unmapped bundles get None; a dir with
    neither a transcript nor a research.json is skipped entirely."""
    web = tmp_path / "feedback-web-01"
    (web / "_feedback").mkdir(parents=True)
    _write_jsonl(web / "_feedback" / "session-log.jsonl", [_assistant([_protected_write()])])
    (web / "research.json").write_text("{}", encoding="utf-8")

    darwin = tmp_path / "feedback-desktop-02"
    darwin.mkdir()
    (darwin / "research.json").write_text("{}", encoding="utf-8")

    unmapped = tmp_path / "feedback-unknown-03"
    unmapped.mkdir()
    (unmapped / "research.json").write_text("{}", encoding="utf-8")

    (tmp_path / "not-a-bundle").mkdir()  # neither file -> skipped

    results = scan_feedback_dir(
        tmp_path, platforms={"feedback-web-01": "web", "feedback-desktop-02": "darwin"}
    )
    by_name = {r["bundle"]: r for r in results}
    assert set(by_name) == {"feedback-web-01", "feedback-desktop-02", "feedback-unknown-03"}
    assert by_name["feedback-web-01"]["platform"] == "web"
    assert by_name["feedback-desktop-02"]["platform"] == "darwin"
    assert by_name["feedback-unknown-03"]["platform"] is None


# ── format_feedback_report ───────────────────────────────────────────────────

def test_format_feedback_report_prints_raw_records_and_platform(tmp_path):
    """The report prints each unguarded-write record (not just a count — a
    triager needs to see WHICH write, #1558 item 3) and the caller-supplied
    platform."""
    bundle = tmp_path / "feedback-web-01"
    (bundle / "_feedback").mkdir(parents=True)
    _write_jsonl(bundle / "_feedback" / "session-log.jsonl", [_assistant([_protected_write()])])
    (bundle / "research.json").write_text("{}", encoding="utf-8")

    results = scan_feedback_dir(tmp_path, platforms={"feedback-web-01": "web"})
    report = format_feedback_report(results)
    assert "platform=web" in report
    # The raw record row from format_detail: fixture name + the owning skill.
    assert "feedback-web-01" in report
    assert "needs=proof-conclusion" in report
    assert "tool=research_append" in report
    # Zero Skill calls before a protected write -> the shape-mismatch warning.
    assert "Skill-shape mismatch" in report


def test_format_feedback_report_excludes_could_not_adapt_from_denominator(tmp_path):
    """An unadaptable transcript is tagged [could not adapt] and kept OUT of the
    attributable-transcript denominator; a clean one counts."""
    good = tmp_path / "good-01"
    (good / "_feedback").mkdir(parents=True)
    _write_jsonl(good / "_feedback" / "session-log.jsonl", [_assistant([_protected_write()])])
    (good / "research.json").write_text("{}", encoding="utf-8")

    bad = tmp_path / "bad-02"
    (bad / "_feedback").mkdir(parents=True)
    _write_jsonl(bad / "_feedback" / "session-log.jsonl", [
        {"type": "summary", "summary": "no content"},
    ])
    (bad / "research.json").write_text("{}", encoding="utf-8")

    report = format_feedback_report(scan_feedback_dir(tmp_path))
    assert "[could not adapt]" in report
    # 1 attributable transcript (good-01), the unadaptable one excluded.
    assert "across 1 attributable transcript(s)" in report
    assert "1 could not adapt, excluded" in report


# ── _submitted_research: committed baseline beats a mutated working tree ──────

def test_scan_reads_submitted_research_not_a_mutated_working_tree(tmp_path):
    """`make feedback-case` git-inits the case dir; the agent mutates
    research.json as it works. The scanner must read the COMMITTED baseline (what
    the tester submitted), so a mentor-verdict gap present at submission is still
    found even after the working tree wrote it away."""
    import os
    import shutil
    import subprocess

    if shutil.which("git") is None:  # pragma: no cover - git present in CI
        import pytest
        pytest.skip("git not available")

    bundle = tmp_path / "git-bundle"
    bundle.mkdir()
    research = bundle / "research.json"
    research.write_text(json.dumps(_mentor_gap_research()), encoding="utf-8")

    env = {**os.environ,
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    run = lambda *a: subprocess.run(  # noqa: E731
        ["git", "-C", str(bundle), *a], check=True, capture_output=True,
        text=True, encoding="utf-8", env=env,
    )
    run("init", "-q")
    run("add", "research.json")
    run("commit", "-q", "-m", "submitted")

    # Working tree "fixes" the gap: add the proof-critique verdict.
    fixed = _mentor_gap_research()
    fixed["evaluations"] = [{"focus": "proof-critique", "target_id": "ps_001"}]
    research.write_text(json.dumps(fixed), encoding="utf-8")

    result = scan_feedback_bundle(bundle)
    # Baseline (submitted) still had the gap -> one finding, despite the fix on disk.
    assert len(result["missing_mentor_verdicts"]) == 1
    assert "ps_001" in result["missing_mentor_verdicts"][0]
