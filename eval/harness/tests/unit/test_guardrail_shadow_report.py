"""Unit tests for e2e.guardrail_shadow_report — the retroactive §7
shadow-window calibration tool (docs/specs/guardrail-enforcement-spec.md,
GitHub issue #911).

Pure filesystem + aggregation logic over synthetic result JSONs written to
tmp_path. `find_unguarded_protected_writes` itself is already covered by
test_skill_invocation.py; these tests are about correctly discovering,
loading, and aggregating across a corpus of files.
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.guardrail_shadow_report import (
    _is_result_json,
    all_result_jsons,
    format_citation_nulling,
    format_conflict_unpersisted,
    format_detail,
    format_summary,
    format_provenance,
    format_provenance_replay,
    replay_provenance,
    scan_citation_nulling,
    scan_conflict_unpersisted,
    scan_corpus,
    scan_provenance,
    scan_one,
)
from harness.skill_invocation import (
    CITATION_NULLING_KIND,
    CONFLICT_UNPERSISTED_KIND,
    PERSON_EVIDENCE_DENY_KIND,
)


def _write_run(dir_, name, tool_calls):
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / name).write_text(json.dumps({"tool_calls": tool_calls}), encoding="utf-8")
    return dir_ / name


def _unguarded_write():
    return {
        "tool": "mcp__genealogy__research_append",
        "args": {"section": "person_evidence", "op": "append", "entry": {"person_id": "I1"}},
    }


# --- _is_result_json ----------------------------------------------------


def test_is_result_json_accepts_a_run_file(tmp_path):
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.json") is True


def test_is_result_json_rejects_ann_and_final_and_transcript(tmp_path):
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.ann.json") is False
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.final-research.json") is False
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.final-tree.gedcomx.json") is False
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.transcript.md") is False


def test_is_result_json_rejects_scratch(tmp_path):
    assert _is_result_json(tmp_path / "scratch_2026-07-27_20-01-40.json") is False


# --- scan_one / scan_corpus ------------------------------------------------


def test_scan_one_finds_a_violation_and_tags_it_with_the_source_file(tmp_path, monkeypatch):
    import e2e.guardrail_shadow_report as mod

    monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    path = _write_run(tmp_path / "eval" / "runlogs" / "e2e" / "fixture-a", "run-x.json", [_unguarded_write()])

    violations = scan_one(path, window=40)
    assert len(violations) == 1
    assert violations[0]["required_skill"] == "person-evidence"
    assert violations[0]["fixture"] == "fixture-a"
    assert "fixture-a" in violations[0]["file"]


def test_scan_one_finds_nothing_on_a_clean_run(tmp_path):
    path = _write_run(
        tmp_path,
        "run-x.json",
        [
            {"tool": "Skill", "args": {"skill": "person-evidence"}},
            _unguarded_write(),
        ],
    )
    assert scan_one(path, window=40) == []


def test_scan_corpus_aggregates_across_multiple_windows_and_files(tmp_path):
    p1 = _write_run(tmp_path / "f1", "run-x.json", [_unguarded_write()])
    p2 = _write_run(
        tmp_path / "f2",
        "run-y.json",
        [{"tool": "Skill", "args": {"skill": "person-evidence"}}] + [_unguarded_write()] * 2,
    )
    by_window = scan_corpus([p1, p2], windows=[1, 40])
    # window=1: the Skill call in p2 is only 1 call before the FIRST unguarded
    # write, not the second -> p2 contributes 1 violation; p1 contributes 1.
    assert len(by_window[1]) == 2
    # window=40: p2's Skill call covers both of its writes -> only p1's violation remains.
    assert len(by_window[40]) == 1


def test_scan_corpus_skips_unreadable_files_without_crashing(tmp_path, capsys):
    bad = tmp_path / "f1" / "run-bad.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("not json", encoding="utf-8")
    good = _write_run(tmp_path / "f2", "run-good.json", [_unguarded_write()])

    by_window = scan_corpus([bad, good], windows=[40])
    assert len(by_window[40]) == 1
    assert "skip" in capsys.readouterr().err


# --- formatting --------------------------------------------------------


def test_format_summary_reports_per_window_counts_and_skill_breakdown():
    by_window = {
        40: [
            {"required_skill": "person-evidence", "file": "a"},
            {"required_skill": "person-evidence", "file": "b"},
            {"required_skill": "proof-conclusion", "file": "a"},
        ]
    }
    out = format_summary(by_window, n_runs=2)
    assert "person-evidence=2" in out
    assert "proof-conclusion=1" in out


def test_format_summary_handles_a_window_with_no_violations():
    out = format_summary({40: []}, n_runs=5)
    assert "(none)" in out


def test_format_detail_lists_every_violation():
    violations = [
        {"fixture": "f1", "index": 3, "tool": "mcp__genealogy__research_append", "required_skill": "person-evidence", "question_id": None},
    ]
    out = format_detail(violations)
    assert "f1" in out and "person-evidence" in out


def test_format_detail_empty_list():
    assert "none" in format_detail([])


# --- scan_provenance / format_provenance (issue #963 stored shadow entries) ---
# These are READ from each run's stored `guardrail_shadow_violations`, not
# replayed from tool_calls: the #963 check depends on the seed tree and on what
# the live hook could see, neither of which a committed log lets you recompute.


def _write_result(dir_, name, violations):
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / name).write_text(
        json.dumps({"tool_calls": [], "guardrail_shadow_violations": violations}),
        encoding="utf-8",
    )
    return dir_ / name


def _provenance_entry(pid="I1", index=3):
    return {
        "index": index,
        "tool": "research_append",
        "required_skill": "person-evidence",
        "question_id": None,
        "detail": f"person_evidence link written for new tree person(s) {pid} with no prior same_person",
    }


def test_scan_provenance_picks_up_stored_entries(tmp_path):
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry()])
    out = scan_provenance([p])
    assert len(out) == 1
    assert out[0]["fixture"] == "fx"
    assert "I1" in out[0]["detail"]


def test_scan_provenance_ignores_section_7_entries():
    """The two sources share one list; only the hook's entries carry `detail`,
    so a §7 recency violation must not be counted as a #963 provenance gap."""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / "fx"
        section7 = {
            "index": 1,
            "tool": "mcp__genealogy__research_append",
            "required_skill": "proof-conclusion",
            "question_id": "q_001",
        }
        p = _write_result(d, "run-1.json", [section7, _provenance_entry()])
        out = scan_provenance([p])
    assert len(out) == 1
    assert out[0]["required_skill"] == "person-evidence"


def test_scan_provenance_tolerates_runs_written_before_the_check(tmp_path):
    """A pre-#963 log has no such entries; it contributes nothing rather than
    erroring."""
    p = _write_result(tmp_path / "fx", "run-1.json", [])
    assert scan_provenance([p]) == []


def test_scan_provenance_skips_unreadable_file(tmp_path, capsys):
    d = tmp_path / "fx"
    d.mkdir(parents=True, exist_ok=True)
    bad = d / "run-1.json"
    bad.write_text("{ not json", encoding="utf-8")
    assert scan_provenance([bad]) == []
    assert "skip" in capsys.readouterr().err


def test_format_provenance_counts_runs_not_just_entries(tmp_path):
    a = _write_result(tmp_path / "fx1", "run-1.json", [_provenance_entry("I1"), _provenance_entry("I2")])
    b = _write_result(tmp_path / "fx2", "run-1.json", [_provenance_entry("I3")])
    text = format_provenance(scan_provenance([a, b]))
    assert "3 person_evidence link(s)" in text
    assert "across 2 run(s)" in text


# --- scan_citation_nulling / format_citation_nulling (issue #1133) ------------
# The #1133 citation-nulling class ALSO carries `detail`, so it must be told
# apart from the #963 provenance gaps by its `kind` key — else the shadow
# fire-rate measurement the graduation decision is gated on double-counts.


def _citation_entry(sid="src_001"):
    return {
        "index": -1,
        "tool": "research.json",
        "required_skill": "citation",
        "question_id": "q_001",
        "kind": CITATION_NULLING_KIND,
        "detail": f"concluded source {sid} (via assertion a_001, proof_summary ps_001) has a null/empty citation string",
    }


def test_scan_citation_nulling_picks_up_only_citation_entries(tmp_path):
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _citation_entry()])
    out = scan_citation_nulling([p])
    assert len(out) == 1
    assert out[0]["kind"] == CITATION_NULLING_KIND
    assert out[0]["fixture"] == "fx"


def test_scan_provenance_excludes_citation_entries(tmp_path):
    """A citation-nulling entry carries `detail` too, but must NOT be counted as
    a #963 person_evidence-provenance gap."""
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _citation_entry()])
    prov = scan_provenance([p])
    assert len(prov) == 1
    assert prov[0]["required_skill"] == "person-evidence"


def test_format_citation_nulling_counts_runs_not_just_entries(tmp_path):
    a = _write_result(tmp_path / "fx1", "run-1.json", [_citation_entry("src_001"), _citation_entry("src_002")])
    b = _write_result(tmp_path / "fx2", "run-1.json", [_citation_entry("src_003")])
    text = format_citation_nulling(scan_citation_nulling([a, b]))
    assert "3 concluded source(s)" in text
    assert "across 2 run(s)" in text


# --- conflict-unpersisted bucket (issue #1317) -------------------------------
# Mirrors the citation-nulling trio: its own scan_ picks up only its kind, it is
# excluded from the #963 provenance bucket (it also carries `detail`), and its
# formatter counts runs not entries. Without these the scan_/format_/exclusion
# added by this PR were mutation-provable dead (senior review of #1438).


def _conflict_entry(psid="ps_001"):
    return {
        "index": -1,
        "tool": "research.json",
        "required_skill": "conflict-resolution",
        "question_id": "q_001",
        "kind": CONFLICT_UNPERSISTED_KIND,
        "detail": f"proof_summary {psid} (question q_001) relies on a resolved conflict",
    }


def test_scan_conflict_unpersisted_picks_up_only_conflict_entries(tmp_path):
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _conflict_entry()])
    out = scan_conflict_unpersisted([p])
    assert len(out) == 1
    assert out[0]["kind"] == CONFLICT_UNPERSISTED_KIND


def test_scan_provenance_excludes_conflict_unpersisted_entries(tmp_path):
    """A conflict-unpersisted entry carries `detail` too, but must NOT be counted
    as a #963 person_evidence-provenance gap (the double-count bug 62e1baa3 fixed
    once already, guarded here so a merge can't reintroduce it)."""
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _conflict_entry()])
    prov = scan_provenance([p])
    assert len(prov) == 1
    assert prov[0]["required_skill"] == "person-evidence"


def test_format_conflict_unpersisted_counts_runs_not_just_entries(tmp_path):
    a = _write_result(tmp_path / "fx1", "run-1.json", [_conflict_entry("ps_001"), _conflict_entry("ps_002")])
    b = _write_result(tmp_path / "fx2", "run-1.json", [_conflict_entry("ps_003")])
    text = format_conflict_unpersisted(scan_conflict_unpersisted([a, b]))
    assert "3 concluded question(s)" in text
    assert "across 2 run(s)" in text


# --- deny-mode entries must not pollute the shadow measurement (issue #1231) --


def _deny_entry(pid="I1"):
    """What the hook stores for a run launched with --person-evidence-guard deny."""
    return _provenance_entry(pid) | {"kind": PERSON_EVIDENCE_DENY_KIND}


def test_scan_provenance_excludes_deny_mode_entries(tmp_path):
    """`scan_provenance` selects on key shape and never reads the run's mode, so
    without a `kind` discriminator a deny-mode run lands in `SINCE=all`
    indistinguishably from a shadow run — and inflated, since the valve permits
    several denials plus a release for ONE logical gap. That is the number
    prereq 1 is supposed to read."""
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _deny_entry()])
    prov = scan_provenance([p])
    assert len(prov) == 1
    assert "kind" not in prov[0]


# --- replay_provenance (issue #1231: a baseline over the pre-hook corpus) -----
# The stored entries above only exist for runs made AFTER #1178 merged. Replay
# recomputes the same check from `tool_calls` + the fixture's committed seed
# tree, which is what makes the 144 pre-hook runs readable at all, and what lets
# a candidate rule variant be scored before it ships.


def _write_replay_run(root, slug, name, tool_calls):
    d = root / "eval" / "runlogs" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(json.dumps({"tool_calls": tool_calls}), encoding="utf-8")
    return d / name


def _write_fixture(root, slug, person_ids):
    d = root / "eval" / "tests" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": p} for p in person_ids]}), encoding="utf-8"
    )
    return d


def _pe_write(person_id="I1"):
    return {
        "tool": "mcp__genealogy__research_append",
        "args": {"section": "person_evidence", "op": "append", "entry": {"person_id": person_id}},
    }


def _same_person_call(pid1="p_9", pid2="I1"):
    return {"tool": "mcp__genealogy__same_person", "args": {"primaryId1": pid1, "primaryId2": pid2}}


def test_replay_provenance_flags_unscored_new_person(tmp_path):
    fixtures = _write_fixture(tmp_path, "fx", ["KN19-Q19"]).parent
    p = _write_replay_run(tmp_path, "fx", "run-1.json", [_pe_write("I1")])
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert len(rep.violations) == 1
    assert rep.violations[0]["fixture"] == "fx"
    assert "I1" in rep.violations[0]["detail"]
    assert rep.runs_scanned == 1
    assert rep.runs_linking == 1
    assert rep.skipped == []


def test_replay_provenance_clean_when_same_person_precedes_the_link(tmp_path):
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    p = _write_replay_run(tmp_path, "fx", "run-1.json", [_same_person_call(), _pe_write("I1")])
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert rep.violations == []
    assert rep.runs_linking == 1  # still counts toward the denominator


def test_replay_provenance_only_sees_calls_before_the_write(tmp_path):
    """The live hook cannot see a `same_person` issued after the write, so the
    replay must not either — link-then-score is a gap here and a pass for the
    post-run detector. This is the documented divergence, not a bug."""
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    p = _write_replay_run(tmp_path, "fx", "run-1.json", [_pe_write("I1"), _same_person_call()])
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert len(rep.violations) == 1


def test_replay_provenance_clean_for_seed_person_link(tmp_path):
    fixtures = _write_fixture(tmp_path, "fx", ["KN19-Q19"]).parent
    p = _write_replay_run(tmp_path, "fx", "run-1.json", [_pe_write("KN19-Q19")])
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert rep.violations == []
    assert rep.runs_linking == 1


def test_replay_provenance_reports_runs_with_no_committed_seed_tree(tmp_path):
    """One run in the corpus today (william-ferber-ancestry) has no fixture dir.
    Dropping it silently would read as "covered everything"; it is named."""
    fixtures = tmp_path / "eval" / "tests" / "e2e"
    fixtures.mkdir(parents=True, exist_ok=True)
    p = _write_replay_run(tmp_path, "gone", "run-1.json", [_pe_write("I1")])
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert rep.violations == []
    assert len(rep.skipped) == 1
    assert "gone" in rep.skipped[0]
    assert rep.runs_scanned == 0  # not scanned, so not in the denominator either


def test_replay_provenance_denominator_excludes_runs_that_link_nobody(tmp_path):
    """The fire RATE is the number the graduation decision reads, so the
    denominator is runs that link any person_evidence — not every run."""
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    _write_fixture(tmp_path, "fx2", [])
    linking = _write_replay_run(tmp_path, "fx", "run-1.json", [_pe_write("I1")])
    idle = _write_replay_run(tmp_path, "fx2", "run-1.json", [_same_person_call()])
    rep = replay_provenance([linking, idle], fixtures_root=fixtures)
    assert rep.runs_scanned == 2
    assert rep.runs_linking == 1
    assert len(rep.violations) == 1


def test_replay_provenance_ignores_a_write_that_never_landed(tmp_path):
    """A DENIED research_append still appears in `tool_calls`, with
    `is_error: true` (e2e-test-spec §8.1.1). Counting it would double-count every
    deny-mode gap — once for the blocked attempt and again for the retry — which
    inflates the very fire rate the graduation decision reads. Same success-gating
    the sibling detectors already apply, so an ordinary failed write is excluded
    too: it linked nobody."""
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    denied = _pe_write("I1") | {"is_error": True}
    p = _write_replay_run(tmp_path, "fx", "run-1.json", [denied])
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert rep.violations == []
    assert rep.runs_linking == 0  # nothing landed, so nothing to have a gap


def test_replay_provenance_counts_the_retry_after_a_denial_once(tmp_path):
    """The deny-mode shape end to end: blocked attempt, then an unscored retry
    that lands. Exactly one gap, not two."""
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    p = _write_replay_run(
        tmp_path, "fx", "run-1.json", [_pe_write("I1") | {"is_error": True}, _pe_write("I1")]
    )
    rep = replay_provenance([p], fixtures_root=fixtures)
    assert len(rep.violations) == 1
    assert rep.runs_linking == 1


def test_replay_provenance_reports_an_unreadable_run_log(tmp_path):
    """Same contract as a missing seed tree: named in `skipped`, never silently
    dropped. A corrupt log that only warns on stderr disappears from the printed
    summary, which then reads as "covered everything"."""
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    d = tmp_path / "eval" / "runlogs" / "e2e" / "fx"
    d.mkdir(parents=True, exist_ok=True)
    bad = d / "run-1.json"
    bad.write_text("{ not json", encoding="utf-8")
    rep = replay_provenance([bad], fixtures_root=fixtures)
    assert rep.violations == []
    assert len(rep.skipped) == 1
    assert "run-1.json" in rep.skipped[0]
    assert rep.runs_scanned == 0


def test_format_provenance_replay_reports_rate_against_the_denominator(tmp_path):
    fixtures = _write_fixture(tmp_path, "fx", []).parent
    a = _write_replay_run(tmp_path, "fx", "run-1.json", [_pe_write("I1")])
    _write_fixture(tmp_path, "fx2", [])
    b = _write_replay_run(tmp_path, "fx2", "run-1.json", [_pe_write("I2")])
    text = format_provenance_replay(replay_provenance([a, b], fixtures_root=fixtures))
    assert "2 of 2" in text  # runs with >=1 gap, out of runs that link anyone
    assert "lower bound" in text  # the same-turn caveat is stated, not implied
