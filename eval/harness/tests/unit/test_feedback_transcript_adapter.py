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

    # Valid JSON of the wrong TYPE. Nothing validates research.json on its way
    # into a bundle (`_redact_living` rewrites only tree.gedcomx.json and calls
    # itself "a privacy filter, not a validator"), so this is reachable. A TRUTHY
    # non-dict is the one that used to raise AttributeError out of
    # `find_missing_mentor_verdicts` and take every other bundle's result with
    # it — `research or {}` absorbs the falsy ones, so `[]` alone would not have
    # caught the crash. Both must flag rather than read as a clean zero.
    for name, payload in [
        ("nonempty-list", '[{"question_id": "q_001"}]'),  # crashed before the guard
        ("json-string", '"not a research document"'),  # crashed before the guard
        ("number", "42"),  # crashed before the guard
        ("empty-list", "[]"),  # falsy: never crashed, still not a research doc
    ]:
        wrong = tmp_path / f"wrong-type-{name}"
        wrong.mkdir()
        (wrong / "research.json").write_text(payload, encoding="utf-8")
        r_wrong = scan_feedback_bundle(wrong)
        assert r_wrong["has_research"] is True, name
        assert r_wrong["research_unreadable"] is True, name
        assert r_wrong["missing_mentor_verdicts"] == [], name


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


# ── the feedback window must equal the e2e shadow window (#1484 comparison) ───

def test_feedback_window_matches_the_e2e_shadow_window():
    """`_FEEDBACK_WINDOW` is a copied literal, not an import: importing the
    orchestrator would drag in the Claude Agent SDK, which this module is
    deliberately free of. Copying means the two can drift silently, and the
    report's own footer promises a comparison against the e2e baseline that a
    divergence would quietly invalidate. Read the orchestrator's source as text
    instead — no import, no SDK, and no line number to go stale."""
    from e2e.guardrail_shadow_report import _FEEDBACK_WINDOW

    src = Path(__file__).parents[2] / "e2e" / "orchestrator.py"
    assert (
        f"GUARDRAIL_SHADOW_WINDOW = {_FEEDBACK_WINDOW}\n"
        in src.read_text(encoding="utf-8")
    ), (
        f"_FEEDBACK_WINDOW ({_FEEDBACK_WINDOW}) no longer matches "
        f"GUARDRAIL_SHADOW_WINDOW in e2e/orchestrator.py — the #1484 e2e "
        f"baseline comparison is only meaningful at one window."
    )


def _bundle(tmp_path, name, submitted, platform="web"):
    b = tmp_path / name
    (b / "_feedback").mkdir(parents=True)
    (b / "_feedback" / "feedback.json").write_text(
        json.dumps({"submitted_at": submitted, "platform": platform}), encoding="utf-8"
    )
    (b / "research.json").write_text('{"questions": []}', encoding="utf-8")
    return b


def test_agent_owned_arms_are_labelled_from_the_bundle_date_not_globally(tmp_path):
    """The arm labels must be decided per bundle, in BOTH directions.

    A blanket "0 by construction" is wrong for the corpus this tool exists to
    scan: the proof-conclusion split merged 2026-08-21 and the newest feedback
    issue is 2026-08-20, so over every real bundle the write came from the MAIN
    thread, un-denied and in the transcript. Telling #1054's reader to discard
    that count discards the number the issue exists to produce."""
    pre = scan_feedback_bundle(_bundle(tmp_path, "feedback-2026-08-14T10-00-00Z",
                                       "2026-08-14T10:00:00Z"))
    post = scan_feedback_bundle(_bundle(tmp_path, "feedback-2026-08-24T10-00-00Z",
                                        "2026-08-24T10:00:00Z"))
    assert pre["submitted"] == "2026-08-14"
    # Both agent-owned arms, not just proof-conclusion: research-exhaustiveness
    # became a pair on 2026-08-23 and is in exactly the same position.
    assert pre["arms"] == {"proof-conclusion": "live", "research-exhaustiveness": "live"}
    assert post["arms"] == {
        "proof-conclusion": "unknown",
        "research-exhaustiveness": "unknown",
    }

    report = format_feedback_report([pre, post])
    # The date is printed per bundle, so a reader can check the label themselves.
    assert "submitted=2026-08-14" in report and "submitted=2026-08-24" in report
    # Only the post-split bundle is tagged.
    pre_line = next(ln for ln in report.split("\n") if "feedback-2026-08-14" in ln and "platform=" in ln)
    post_line = next(ln for ln in report.split("\n") if "feedback-2026-08-24" in ln and "platform=" in ln)
    assert "plugin era unknown" not in pre_line
    assert "plugin era unknown for: proof-conclusion, research-exhaustiveness" in post_line
    # Pinned as ONE CONTIGUOUS PHRASE, not a bag of substrings: a scattered
    # match let a footer asserting the OPPOSITE pass while containing every
    # individual term.
    assert "so those counts are real measurements" in report
    assert "so 0 there is NOT evidence" in report
    # And the retracted global claim must not come back.
    assert "BY CONSTRUCTION" not in report


def test_undated_bundle_is_labelled_unknown_never_assumed_live(tmp_path):
    """No date means the era cannot be decided, and the safe direction is
    `unknown` — claiming `live` would assert a measurement nobody can support."""
    b = tmp_path / "no-date-at-all"
    (b / "_feedback").mkdir(parents=True)
    (b / "research.json").write_text("{}", encoding="utf-8")
    r = scan_feedback_bundle(b)
    assert r["submitted"] is None
    assert set(r["arms"].values()) == {"unknown"}


def test_one_bad_encoding_does_not_take_down_the_whole_scan(tmp_path):
    """`UnicodeDecodeError` is a `ValueError`, so neither `json.JSONDecodeError`
    nor `parse_jsonl`'s `OSError` catches it. One cp1252 byte in one bundle used
    to lose every other bundle's result — the Windows genealogist team is the
    population (CLAUDE.md, encoding section)."""
    bad_res = tmp_path / "bad-research"
    (bad_res / "_feedback").mkdir(parents=True)
    (bad_res / "research.json").write_bytes('{"a": "se\u00f1or"}'.encode("cp1252"))

    bad_tx = tmp_path / "bad-transcript"
    (bad_tx / "_feedback").mkdir(parents=True)
    (bad_tx / "_feedback" / "session-log.jsonl").write_bytes(
        '{"sessionId": "s", "message": {"content": []}}\n// se\u00f1or'.encode("cp1252")
    )
    (bad_tx / "research.json").write_text("{}", encoding="utf-8")

    healthy = _bundle(tmp_path, "feedback-2026-08-14T10-00-00Z", "2026-08-14T10:00:00Z")

    results = scan_feedback_dir(tmp_path)
    by_name = {r["bundle"]: r for r in results}
    assert by_name["bad-research"]["research_unreadable"] is True
    assert by_name["bad-transcript"]["transcript_unreadable"] is True
    # The whole point: the healthy sibling still produced a result.
    assert by_name[healthy.name]["research_unreadable"] is False
    assert len(results) == 3


def test_totals_are_reported_per_platform_never_only_combined(tmp_path):
    """#1558's ruling: "separate columns; never a combined number." Tagging each
    ROW with its platform and then folding every platform into one total is
    still a combined number."""
    web = scan_feedback_bundle(_bundle(tmp_path, "feedback-2026-08-14T10-00-00Z",
                                       "2026-08-14T10:00:00Z", platform="web"))
    mac = scan_feedback_bundle(_bundle(tmp_path, "feedback-2026-08-15T10-00-00Z",
                                       "2026-08-15T10:00:00Z", platform="darwin"))
    report = format_feedback_report([web, mac])
    assert "By platform" in report
    assert "  web: unguarded-write" in report
    assert "  darwin: unguarded-write" in report


def test_platform_comes_from_the_bundle_when_no_mapping_is_given(tmp_path):
    """Both producers write `platform` into `_feedback/feedback.json` (`"web"`
    server-side, `process.platform` on the desktop), so it IS in the bundle.
    `--platforms` stays as the override, not the only source."""
    b = _bundle(tmp_path, "feedback-2026-08-14T10-00-00Z", "2026-08-14T10:00:00Z",
                platform="darwin")
    assert scan_feedback_bundle(b)["platform"] == "darwin"
    # An explicit mapping still wins.
    assert scan_feedback_bundle(b, platform="web")["platform"] == "web"


def test_no_project_write_does_not_manufacture_a_violation(tmp_path):
    """`did_not_land` has two clauses and the second reads `response_summary`
    for the no-project answer (issue #1695) — deliberately the ONE failure that
    does NOT set `is_error` (`tool-result.ts`), with twelve tools on that return
    shape since Phase 1b. Hardwiring `response_summary: None` in the adapter made
    that clause unfirable over a bundle, so a `research_append` that wrote
    NOTHING was counted as a landed protected write. That function's own
    docstring names the consequence: "manufactures a violation"."""
    from harness.skill_invocation import did_not_land, find_unguarded_protected_writes

    log = tmp_path / "session-log.jsonl"
    # The envelope shape the orchestrator stores verbatim under 500 chars, where
    # the tool's document is an escaped string — so the BARE name is what
    # matches, never '"no_project"'.
    envelope = [{"type": "text", "text": json.dumps({"reason": "no_project"})}]
    _write_jsonl(log, [
        _assistant([{
            "type": "tool_use", "id": "t1",
            "name": "mcp__genealogy__research_append",
            "input": {"section": "proof_summaries", "question_id": "q_001",
                      "entries": [{}]},
        }]),
        # No `is_error` key at all: that is the point of the no-project answer.
        {"type": "user", "sessionId": "s1", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": envelope}
        ]}},
    ])
    adapted = adapt_bundle_transcript(log)
    entry = adapted["tool_calls"][0]

    assert entry["is_error"] is False, "no-project deliberately does not set is_error"
    assert entry["response_summary"] is not None, (
        "response_summary must carry the tool_result content, or did_not_land's "
        "no-project clause can never fire over a bundle"
    )
    assert did_not_land(entry) is True
    assert find_unguarded_protected_writes(adapted["tool_calls"], window=40) == [], (
        "a write that never landed was counted as a bypass"
    )


def test_response_summary_survives_a_plain_string_result(tmp_path):
    """Real transcripts carry `content` as a bare string as well as a block
    list; both must reach `did_not_land` rather than only the list shape."""
    log = tmp_path / "session-log.jsonl"
    _write_jsonl(log, [
        _assistant([{"type": "tool_use", "id": "t1", "name": "record_search", "input": {}}]),
        {"type": "user", "sessionId": "s1", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "plain text result"}
        ]}},
    ])
    assert adapt_bundle_transcript(log)["tool_calls"][0]["response_summary"] == "plain text result"
