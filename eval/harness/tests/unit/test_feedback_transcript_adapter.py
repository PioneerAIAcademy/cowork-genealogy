"""Unit tests for the hosted-feedback transcript adapter + its detector wiring
(issue #1558). All input is SYNTHETIC Claude-Code-shaped JSONL written here by
hand — never a real feedback bundle (bundle content must not enter the repo;
root CLAUDE.md, docs/alpha-feedback-guide.md)."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.feedback_transcript_adapter import adapt_bundle_transcript
from e2e.guardrail_shadow_report import scan_feedback_bundle


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
    """The #999 trap: is_error is present on a tool_result only when true, so a
    missing key must read as success (False), not be left unset."""
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [
        _assistant([
            {"type": "tool_use", "id": "ok", "name": "record_search", "input": {}},
            {"type": "tool_use", "id": "bad", "name": "record_search", "input": {}},
        ]),
        _user_result([
            {"type": "tool_result", "tool_use_id": "ok", "content": "hits"},  # no is_error key
            {"type": "tool_result", "tool_use_id": "bad", "content": "boom", "is_error": True},
        ]),
    ])
    out = adapt_bundle_transcript(log)
    by_tool = {(e["tool"], i): e for i, e in enumerate(out["tool_calls"])}
    assert out["tool_calls"][0]["is_error"] is False  # missing key -> success
    assert out["tool_calls"][1]["is_error"] is True    # explicit true -> error
    assert by_tool  # silence unused


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
