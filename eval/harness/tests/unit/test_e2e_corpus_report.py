"""Unit tests for e2e.corpus_report — three-axis totals over committed runs."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from e2e.corpus_report import (
    VIOLATION_ARMS,
    classify,
    format_report,
    main,
    run_timestamp,
    tally,
    violations_of,
)
from e2e.runlog_paths import all_result_jsons
from harness.skill_invocation import (
    find_effects_without_invocation,
    find_missing_mentor_verdicts,
    find_person_evidence_missing_same_person,
)


def _write(dir_: Path, name: str, payload: dict) -> Path:
    path = dir_ / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_tally_counts_each_axis_independently(tmp_path: Path):
    paths = [
        # v1 run: recovered the answer but bypassed a guardrail.
        _write(tmp_path, "run-1.json", {
            "harness_schema_version": 1,
            "verdict": "pass", "compliance": "fail", "outcome": "fail",
        }),
        # v1 clean pass.
        _write(tmp_path, "run-2.json", {
            "harness_schema_version": 1,
            "verdict": "pass", "compliance": "pass", "outcome": "pass",
        }),
        # Pre-detector run: never checked.
        _write(tmp_path, "run-3.json", {"verdict": "partial"}),
    ]
    recall, compliance, gate, problems, _arms, _fix = tally(paths)

    assert recall == {"pass": 2, "partial": 1}
    assert compliance == {"fail": 1, "pass": 1, "not_checked": 1}
    assert gate == {"fail": 1, "pass": 1, "partial": 1}
    assert problems == []


def test_not_checked_is_never_folded_into_the_gate_pass_count(tmp_path: Path):
    """The whole point of the third compliance value. An unchecked run is an
    unknown, and counting it as clean would reinstate the uninterpretable
    aggregate issue #972 was filed about."""
    paths = [
        _write(tmp_path, f"run-{i}.json", {"verdict": "pass"}) for i in range(3)
    ]
    recall, compliance, gate, _, _arms, _fix = tally(paths)

    assert compliance == {"not_checked": 3}
    assert compliance.get("pass", 0) == 0, "unchecked must not read as clean"

    out = format_report(recall, compliance, gate, n_runs=3)
    assert "3 not_checked" in out
    assert "unknown compliance" in out


def test_tally_reports_unreadable_files_instead_of_crashing(tmp_path: Path):
    good = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    bad = tmp_path / "run-2.json"
    bad.write_text("{not json", encoding="utf-8")

    recall, _compliance, _gate, problems, _arms, _fix = tally([good, bad])
    assert recall == {"pass": 1}
    assert len(problems) == 1
    assert "run-2.json" in problems[0]


def test_format_report_omits_the_note_when_everything_was_checked(tmp_path: Path):
    paths = [
        _write(tmp_path, "run-1.json", {
            "harness_schema_version": 1,
            "verdict": "pass", "compliance": "pass", "outcome": "pass",
        })
    ]
    recall, compliance, gate, _, _arms, _fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=1)
    assert "unknown compliance" not in out
    assert "1 pass" in out


# ── violation detail + concentration (issue #1176) ───────────────────────────


def test_violations_read_from_both_runlog_vintages():
    """v1+ carries the list at the top level; pre-v1 nests it under
    judge_output. A reader that knows only one shape silently under-counts the
    other era, which is how a hand-computed window goes wrong."""
    v1 = {"harness_schema_version": 1, "guardrail_bypass_violations": ["a", "b"]}
    pre_v1 = {"judge_output": {"guardrail_bypass_violations": ["c"]}}
    assert violations_of(v1) == ["a", "b"]
    assert violations_of(pre_v1) == ["c"]
    assert violations_of({"verdict": "pass"}) == []


def test_absent_violations_are_distinguished_from_an_explicit_empty_list(tmp_path: Path):
    """Absent means `not_checked`; an explicit [] means checked-and-clean.

    `violations_of` returns [] for both — which is safe ONLY because the
    compliance axis, not this count, is what carries the distinction. That is
    the invariant worth pinning: if a rate were ever computed from the violation
    count instead, 17 unknowns would silently become 17 passes.
    """
    absent = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    empty = _write(tmp_path, "run-2.json", {
        "harness_schema_version": 1, "verdict": "pass",
        "compliance": "pass", "outcome": "pass",
        "guardrail_bypass_violations": [],
    })
    assert violations_of(json.loads(absent.read_text(encoding="utf-8"))) == []
    assert violations_of(json.loads(empty.read_text(encoding="utf-8"))) == []

    counts = tally([absent, empty])
    assert counts.compliance == {"not_checked": 1, "pass": 1}
    assert counts.arms == {}


def _detector_messages() -> list[str]:
    """Every message shape `check_guardrail_compliance` can currently emit.

    Driven through the real detectors rather than hand-typed, because a
    hand-typed approximation is exactly what let two live arms sit unmapped:
    reword a message in `skill_invocation.py` and a hand-written probe keeps
    passing while every violation of that arm silently reclassifies to `other`.
    """
    tree = {"persons": [{"id": "I1", "facts": [{"type": "Birth", "primary": True}]}]}
    return [
        *find_effects_without_invocation(
            [],
            {
                "questions": [{"exhaustive_declaration": {"declared": True}}],
                "person_evidence": [],
                # `status`, NOT `resolution` — `_is_conflict_resolution_product`
                # keys on `status == "resolved"` or a CONFLICT_ANALYSIS_FIELDS
                # entry, so a `resolution` key fires nothing and this arm goes
                # silently uncovered. That is the defect this whole helper is
                # here to prevent, and it got in anyway.
                "conflicts": [{"status": "resolved", "weighing_analysis": "x"}],
                "proof_summaries": [{"id": "ps1"}],
            },
            tree,
        ),
        *find_person_evidence_missing_same_person(
            [], {"person_evidence": [{"person_id": "I1", "record_persona_id": "r1"}]}, tree
        ),
        *find_missing_mentor_verdicts(
            {
                "questions": [{"status": "resolved", "proof_summary_id": "ps1"}],
                "proof_summaries": [{"id": "ps1"}],
                "evaluations": [],
            }
        ),
    ]


def test_every_live_detector_message_maps_to_a_named_arm():
    """`other` must mean DRIFT, not "an arm nobody got around to mapping".

    The comment above VIOLATION_ARMS tells the reader that anything in `other`
    is a message that was reworded. That is only true if every arm the detector
    can emit today is mapped — `person-evidence` and `proof-critique` were not,
    so a bypass of the mandatory gps-mentor gate would have surfaced as an
    unnamed bucket indistinguishable from drift.
    """
    messages = _detector_messages()
    unmapped = [m for m in messages if classify(m) == "other"]
    assert not unmapped, f"live detector messages landing in `other`: {unmapped}"

    # Both directions, so neither list can quietly outgrow the other. Asserting
    # a >= count instead would pass while an arm silently stopped firing — which
    # is exactly what a `>= 5` written against 6 arms did.
    covered = {classify(m) for m in messages}
    declared = {arm for _probe, arm in VIOLATION_ARMS}
    assert covered == declared, (
        f"arms declared but never exercised: {declared - covered}; "
        f"exercised but not declared: {covered - declared}"
    )


def test_classify_falls_back_rather_than_dropping():
    # A genuinely reworded/new arm must surface, not vanish.
    assert classify("some new arm nobody mapped") == "other"


def test_tally_counts_violations_by_arm_and_by_fixture(tmp_path: Path):
    loud = tmp_path / "loud-fixture"
    quiet = tmp_path / "quiet-fixture"
    loud.mkdir()
    quiet.mkdir()
    paths = [
        _write(loud, "run-1.json", {
            "judge_output": {"guardrail_bypass_violations": [
                "'same_person' was never called", "'same_person' was never called",
                "'proof-conclusion' was never invoked",
            ]},
        }),
        _write(quiet, "run-2.json", {
            "judge_output": {"guardrail_bypass_violations": [
                "'conflict-resolution' was never invoked",
            ]},
        }),
    ]
    _, _, _, _, arms, per_fixture = tally(paths)
    assert arms == {"same_person (per person)": 2, "proof-conclusion": 1,
                    "conflict-resolution": 1}
    assert per_fixture == {"loud-fixture": 3, "quiet-fixture": 1}


def test_report_refuses_a_rate_when_nothing_is_decidable(tmp_path: Path):
    """The corpus today. A percentage here would assert 17 unknowns ran clean."""
    paths = [_write(tmp_path, f"run-{i}.json", {"verdict": "pass"}) for i in range(3)]
    recall, compliance, gate, _, arms, fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=3, arms=arms, per_fixture=fix)
    assert "NOT MEASURABLE" in out
    assert "%" not in out.split("runs w/ >=1 violation:")[1]
    # No `--since` was passed, so the refusal must not claim a window scoped it.
    assert "in the corpus" in out
    assert "in this window" not in out


def test_report_calls_an_all_fail_decidable_set_a_floor_not_a_rate(tmp_path: Path):
    """12/12 is not "100% of runs violate" — no run is known clean."""
    paths = [
        _write(tmp_path, "run-1.json", {
            "judge_output": {"verdict": "pass",
                             "guardrail_bypass_violations": ["'same_person' missing"]},
        })
    ]
    recall, compliance, gate, _, arms, fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=1, arms=arms, per_fixture=fix)
    assert "floor on incidence, not a rate" in out


def test_report_flags_a_dominant_fixture_so_the_next_outlier_self_discloses(
    tmp_path: Path,
):
    """The reason this exists: the critique hand-wrote "excluding
    jimmie-jewel-neal", which describes one outlier and no future one."""
    hog, other = tmp_path / "hog", tmp_path / "other"
    hog.mkdir()
    other.mkdir()
    paths = [
        _write(hog, "run-1.json", {"harness_schema_version": 1, "compliance": "fail",
                                   "verdict": "pass", "outcome": "fail",
                                   "guardrail_bypass_violations": ["'same_person' x"] * 8}),
        _write(other, "run-2.json", {"harness_schema_version": 1, "compliance": "fail",
                                     "verdict": "pass", "outcome": "fail",
                                     "guardrail_bypass_violations": ["'same_person' x"]}),
    ]
    recall, compliance, gate, _, arms, fix = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=2, arms=arms, per_fixture=fix)
    assert "concentration:" in out
    assert "hog" in out
    assert "alone accounts for" in out


def test_run_timestamp_rejects_the_sidecars_that_share_a_run_stem(tmp_path: Path):
    """`.ann` / `.final-*` siblings would triple the denominator. This bit a
    hand-written analysis of exactly this corpus."""
    assert run_timestamp(Path("run-2026-07-30_18-09-08.json")) == "2026-07-30_18-09-08"
    assert run_timestamp(Path("run-2026-07-30_18-09-08.ann.json")) is None
    assert run_timestamp(Path("run-2026-07-30_18-09-08.final-tree.gedcomx.json")) is None
    assert run_timestamp(Path("summary.json")) is None


def test_every_corpus_member_yields_a_run_timestamp():
    """The other direction of the pair above, over the REAL committed corpus.

    `run_timestamp` defers membership to `is_result_json` and only parses the
    stem, so these two must agree by construction. This catches the case that
    breaks `--since` silently: a committed runlog that counts as a corpus member
    but whose name `RUN_STEM` cannot parse would be dropped from every windowed
    report while still inflating the unwindowed one.
    """
    unparseable = [p.name for p in all_result_jsons() if run_timestamp(p) is None]
    assert not unparseable, f"corpus members with no parseable timestamp: {unparseable}"


# ── the report's denominators (issue #1176 follow-ups) ───────────────────────


def test_format_report_survives_arms_without_per_fixture():
    """`arms` and `per_fixture` default independently, so the signature can
    express a combination that used to raise IndexError out of the concentration
    block. A report that crashes on a partial call is a report nobody can reuse.
    """
    out = format_report(
        Counter({"pass": 1}), Counter({"fail": 1}), Counter({"fail": 1}),
        n_runs=1, arms=Counter({"same_person (per person)": 3}),
    )
    assert "violations:" in out


def test_a_single_fixture_corpus_does_not_call_itself_an_outlier(tmp_path: Path):
    """`make e2e-corpus TEST=<slug>` has one contributing fixture, so the leader
    trivially holds 100%. A dominance NOTE that always fires teaches its reader
    to skip it, costing the real outlier its disclosure."""
    solo = tmp_path / "only-fixture"
    solo.mkdir()
    paths = [_write(solo, "run-1.json", {
        "judge_output": {"guardrail_bypass_violations": ["'same_person' x"] * 4},
    })]
    counts = tally(paths)
    out = format_report(
        counts.recall, counts.compliance, counts.gate,
        n_runs=1, arms=counts.arms, per_fixture=counts.per_fixture,
    )
    assert "concentration:" not in out
    assert "alone accounts for" not in out


def test_an_even_split_is_not_called_a_dominant_fixture():
    """Two fixtures at one violation each is the ABSENCE of concentration.

    It fired before because the printed percentage was rounded (`.0%`) while the
    threshold tested the raw ratio against 0.5 — so the same displayed "50%"
    could read as dominant or not depending on invisible decimals.
    """
    out = format_report(
        Counter({"pass": 2}), Counter({"fail": 2}), Counter({"fail": 2}),
        n_runs=2, arms=Counter({"same_person (per person)": 2}),
        per_fixture=Counter({"a": 1, "b": 1}),
    )
    assert "concentration:" in out
    assert "alone accounts for" not in out


def test_violation_total_is_reported_over_decidable_runs():
    """Pairing 49 violations with every run in scope invites 49/30, but a
    `not_checked` run cannot contribute one — its field is absent, which is why
    it is unknown. "recorded none", not "had none": absence of evidence."""
    out = format_report(
        Counter({"pass": 30}), Counter({"fail": 13, "not_checked": 17}),
        Counter({"fail": 13}), n_runs=30,
        arms=Counter({"same_person (per person)": 49}),
        per_fixture=Counter({"a": 30, "b": 19}),
    )
    assert "49 across 13 decidable run(s); 17 unknown recorded none" in out
    assert "across 30 run(s)" not in out


def test_violation_scope_falls_back_when_nothing_is_decidable():
    """The corpus state 1c/1d construct. `0 decidable run(s)` would be a
    denominator of zero dressed as a scope statement."""
    out = format_report(
        Counter({"pass": 2}), Counter({"not_checked": 2}), Counter({"pass": 2}),
        n_runs=2, arms=Counter({"other": 3}), per_fixture=Counter({"a": 2, "b": 1}),
    )
    assert "3 across 2 run(s)" in out
    assert "decidable" not in out.split("violations:")[1].split("\n")[0]


def test_unreadable_runlogs_are_excluded_from_the_headline_count(tmp_path: Path, capsys):
    """A skip line goes to stderr, so a report piped to a file would otherwise
    carry a denominator inflated by files that contributed to nothing."""
    fixture = tmp_path / "fx"
    fixture.mkdir()
    good = _write(fixture, "run-2026-07-28_10-00-00.json", {"verdict": "pass"})
    bad = fixture / "run-2026-07-28_11-00-00.json"
    bad.write_text("{not json", encoding="utf-8")

    import e2e.corpus_report as cr
    orig = cr.all_result_jsons
    cr.all_result_jsons = lambda: [good, bad]
    try:
        assert main([]) == 0
    finally:
        cr.all_result_jsons = orig
    out = capsys.readouterr()
    assert "1 committed run(s) (1 unreadable, excluded)" in out.out
    assert "skip" in out.err


def test_tally_survives_a_runlog_whose_judge_output_is_not_an_object(tmp_path: Path):
    """One malformed log must be reported, not abort the whole corpus report.

    Two shapes, two outcomes, and the split moved once `axes_from_runlog` grew
    its own `isinstance` guard:

    - A non-dict `judge_output` (`42`, `"x"`, `[1]`) no longer raises at all. The
      resolver handles it, so the run is COUNTED as an ordinary `not_checked`
      rather than discarded — the right call, since its verdict is still
      readable and dropping it would shrink a denominator over a shape we can
      read fine.
    - A top-level non-dict runlog (a bare JSON list) still raises `AttributeError`
      on `data.get`, before any guard, and that is what `problems` is for.

    So the broadened `except` still earns its place; the resolver guard just
    narrowed what has to reach it.
    """
    good = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    non_dict_judge = _write(tmp_path, "run-2.json", {"verdict": "pass", "judge_output": 42})
    counts = tally([good, non_dict_judge])
    assert counts.problems == [], "a readable verdict must not be discarded"
    assert counts.compliance == {"not_checked": 2}

    bare_list = tmp_path / "run-3.json"
    bare_list.write_text("[1, 2]", encoding="utf-8")
    counts = tally([good, bare_list])
    assert counts.recall == {"pass": 1}
    assert len(counts.problems) == 1
    assert "run-3.json" in counts.problems[0]


def test_a_violation_free_corpus_produces_empty_counters(tmp_path: Path):
    """tally's contract: both counters are empty when nothing was violated. A
    zero-valued entry per fixture is not the same as no entry."""
    fixture = tmp_path / "clean-fixture"
    fixture.mkdir()
    paths = [_write(fixture, "run-1.json", {
        "harness_schema_version": 1, "verdict": "pass",
        "compliance": "pass", "outcome": "pass",
        "guardrail_bypass_violations": [],
    })]
    counts = tally(paths)
    assert counts.arms == {}
    assert counts.per_fixture == {}


# ── --since (issue #1176): the window must not move on a typo ────────────────


def test_since_rejects_a_malformed_timestamp(capsys):
    """Unvalidated, `--since` is a lexicographic compare against a filename
    stem: `2026-07-27_20:00:00` silently DROPS a 20:30 run and
    `2026-07-27-20-00-00` silently KEEPS a 19:00 one, both under a header
    asserting the window asked for. Reject the value, not the runs."""
    for bad in ("2026-7-27_20-00-00", "2026-07-27_20:00:00", "2026-07-27-20-00-00"):
        with pytest.raises(SystemExit) as e:
            main(["--since", bad])
        assert e.value.code == 2
    assert "YYYY-MM-DD_HH-MM-SS" in capsys.readouterr().err


def test_since_reports_an_empty_window_distinctly_from_an_empty_corpus(
    tmp_path: Path, capsys
):
    """An empty corpus reported as an empty window sends the reader hunting for
    a window bug that isn't there — and vice versa."""
    import e2e.corpus_report as cr
    fixture = tmp_path / "fx"
    fixture.mkdir()
    run = _write(fixture, "run-2026-07-28_10-00-00.json", {"verdict": "pass"})

    orig = cr.all_result_jsons
    try:
        cr.all_result_jsons = lambda: [run]
        assert main(["--since", "2027-01-01_00-00-00"]) == 1
        assert "at or after 2027-01-01_00-00-00" in capsys.readouterr().err

        cr.all_result_jsons = lambda: []
        assert main(["--since", "2027-01-01_00-00-00"]) == 1
        err = capsys.readouterr().err
        assert "No committed runs found." in err
        assert "at or after" not in err
    finally:
        cr.all_result_jsons = orig


def test_since_is_inclusive_of_its_own_timestamp(tmp_path: Path, capsys):
    """Pins existing behavior across 1b's rewrite of the filter: `--since` names
    a detector's ship date, so the run AT that timestamp is inside the window."""
    import e2e.corpus_report as cr
    fixture = tmp_path / "fx"
    fixture.mkdir()
    early = _write(fixture, "run-2026-07-27_19-59-59.json", {"verdict": "pass"})
    exact = _write(fixture, "run-2026-07-27_20-00-00.json", {"verdict": "fail"})

    orig = cr.all_result_jsons
    cr.all_result_jsons = lambda: [early, exact]
    try:
        assert main(["--since", "2026-07-27_20-00-00"]) == 0
    finally:
        cr.all_result_jsons = orig
    out = capsys.readouterr().out
    assert "1 committed run(s) since 2026-07-27_20-00-00" in out
    assert "1 fail" in out


def test_since_scope_line_names_the_window():
    """Pins existing behavior across 1m's edits to the same function: a windowed
    report must say so, or its numbers get quoted as the whole corpus."""
    out = format_report(
        Counter({"pass": 1}), Counter({"pass": 1}), Counter({"pass": 1}),
        n_runs=1, since="2026-07-27_20-00-00",
    )
    assert out.startswith("1 committed run(s) since 2026-07-27_20-00-00")
