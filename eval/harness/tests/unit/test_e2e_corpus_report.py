"""Unit tests for e2e.corpus_report — three-axis totals over committed runs."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from e2e.corpus_report import (
    VIOLATION_ARMS,
    RecomputeTally,
    classify,
    format_recompute,
    format_report,
    main,
    recompute_tally,
    spend_tally,
    tally,
    violations_of,
)
from e2e.pricing import estimate_cost_usd
from e2e.runlog_selection import all_result_jsons, is_result_json, run_date
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
    recall, compliance, gate, problems, _arms, _fix, _bash = tally(paths)

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
    recall, compliance, gate, _, _arms, _fix, _bash = tally(paths)

    assert compliance == {"not_checked": 3}
    assert compliance.get("pass", 0) == 0, "unchecked must not read as clean"

    out = format_report(recall, compliance, gate, n_runs=3)
    assert "3 not_checked" in out
    assert "unknown compliance" in out


def test_tally_reports_unreadable_files_instead_of_crashing(tmp_path: Path):
    good = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    bad = tmp_path / "run-2.json"
    bad.write_text("{not json", encoding="utf-8")

    recall, _compliance, _gate, problems, _arms, _fix, _bash = tally([good, bad])
    assert recall == {"pass": 1}
    assert len(problems) == 1
    assert "run-2.json" in problems[0]


def test_tally_survives_a_log_whose_bytes_are_not_utf_8(tmp_path: Path):
    """The test above only covers invalid JSON, which `json.JSONDecodeError`
    already caught. This covers the corruption the corpus actually produces.

    `read_text(encoding="utf-8")` decodes before `json` sees the bytes, so a
    write interrupted mid-character raises `UnicodeDecodeError` — a `ValueError`,
    and neither an `OSError` nor a `json.JSONDecodeError`. Without it in the
    tuple one bad file aborts the whole sweep with a traceback instead of being
    named and skipped.

    This half was fixed in the #1485 review and left unguarded, which mattered
    more than it looks: `judge_report.py`'s guard cites this function as its
    precedent, so an unguarded precedent is one a later tidy-up silently
    un-fixes. Caught in round 3.
    """
    good = _write(tmp_path, "run-1.json", {"verdict": "pass"})
    bad = tmp_path / "run-2.json"
    # Valid JSON up to the point the bytes stop being UTF-8 — the shape a write
    # interrupted mid-character leaves behind, not a syntactically broken file.
    bad.write_bytes(b'{"verdict": "pass", "note": "\xff\xfe"}')

    recall, _compliance, _gate, problems, _arms, _fix, _bash = tally([good, bad])
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
    recall, compliance, gate, _, _arms, _fix, _bash = tally(paths)
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
    _, _, _, _, arms, per_fixture, _bash = tally(paths)
    assert arms == {"same_person (per person)": 2, "proof-conclusion": 1,
                    "conflict-resolution": 1}
    assert per_fixture == {"loud-fixture": 3, "quiet-fixture": 1}


def test_report_refuses_a_rate_when_nothing_is_decidable(tmp_path: Path):
    """The corpus today. A percentage here would assert 17 unknowns ran clean."""
    paths = [_write(tmp_path, f"run-{i}.json", {"verdict": "pass"}) for i in range(3)]
    recall, compliance, gate, _, arms, fix, _bash = tally(paths)
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
    recall, compliance, gate, _, arms, fix, _bash = tally(paths)
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
    recall, compliance, gate, _, arms, fix, _bash = tally(paths)
    out = format_report(recall, compliance, gate, n_runs=2, arms=arms, per_fixture=fix)
    assert "concentration:" in out
    assert "hog" in out
    assert "alone accounts for" in out


def test_concentration_names_what_the_top_n_cap_withheld(tmp_path: Path):
    """A truncated list that does not say it is truncated reads as the complete
    set of contributors — which is how a three-fixture headline gets quoted off
    a corpus with many more. The tail is summarised, never silently dropped."""
    paths = []
    for i, n in enumerate([9, 4, 3, 2, 2]):
        d = tmp_path / f"fx{i}"
        d.mkdir()
        paths.append(_write(d, f"run-{i}.json", {
            "harness_schema_version": 1, "compliance": "fail",
            "verdict": "pass", "outcome": "fail",
            "guardrail_bypass_violations": ["'same_person' x"] * n,
        }))
    _, compliance, gate, _, arms, fix, _bash = tally(paths)
    out = format_report(Counter(), compliance, gate, n_runs=5, arms=arms, per_fixture=fix)

    assert "fx0" in out and "fx1" in out and "fx2" in out
    # 5 contributors, 3 named — the other two carry 4 of 20 violations (20%).
    assert "… 2 further fixture(s) not shown, 4 violation(s) (20%)" in out
    assert "fx3" not in out and "fx4" not in out


def test_concentration_is_silent_when_nothing_was_withheld(tmp_path: Path):
    """The counterpart: the line must not appear when the list IS complete, or
    it becomes noise that trains the reader to skip the real disclosure."""
    paths = []
    for i, n in enumerate([5, 3]):
        d = tmp_path / f"fx{i}"
        d.mkdir()
        paths.append(_write(d, f"run-{i}.json", {
            "harness_schema_version": 1, "compliance": "fail",
            "verdict": "pass", "outcome": "fail",
            "guardrail_bypass_violations": ["'same_person' x"] * n,
        }))
    _, compliance, gate, _, arms, fix, _bash = tally(paths)
    out = format_report(Counter(), compliance, gate, n_runs=2, arms=arms, per_fixture=fix)
    assert "not shown" not in out


def test_corpus_membership_rejects_the_sidecars_that_share_a_run_stem():
    """`.ann` / `.final-*` siblings would triple the denominator. This bit a
    hand-written analysis of exactly this corpus."""
    assert is_result_json(Path("run-2026-07-30_18-09-08.json"))
    assert not is_result_json(Path("run-2026-07-30_18-09-08.ann.json"))
    assert not is_result_json(Path("run-2026-07-30_18-09-08.final-tree.gedcomx.json"))
    assert not is_result_json(Path("summary.json"))


def test_every_corpus_member_yields_a_run_date():
    """The other direction of the pair above, over the REAL committed corpus.

    `filter_since` KEEPS a run whose filename carries no parseable date, so a
    naming change cannot silently shrink a window — but it would then pin every
    such run inside every window, which is the same reporting error pointed the
    other way. Membership and datability must agree by construction, and this is
    what says so over the live corpus rather than a fixture.
    """
    undated = [p.name for p in all_result_jsons() if run_date(p) is None]
    assert not undated, f"corpus members with no parseable date: {undated}"


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
    carry a denominator inflated by files that contributed to nothing.

    The fixture's date must stay inside `main([])`'s default 14-day window
    (`since_window.DEFAULT_SINCE_DAYS`) or this test starts failing on the
    calendar rather than on a real regression — a hardcoded date here once
    aged out from under it. Two days back leaves margin either side of
    "today" without depending on it being any particular day."""
    today = datetime.now()
    stamp = (today - timedelta(days=2)).strftime("%Y-%m-%d")
    fixture = tmp_path / "fx"
    fixture.mkdir()
    good = _write(fixture, f"run-{stamp}_10-00-00.json", {"verdict": "pass"})
    bad = fixture / f"run-{stamp}_11-00-00.json"
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


# ── §6's Bash gap: the close-condition nothing used to watch ─────────────────


def test_the_census_watches_the_files_the_lockdown_protects():
    """`WATCHED_PROJECT_FILES` is deliberately not spelled
    `PROTECTED_PROJECT_FILES` — that name belongs to the three enforcement
    copies `test_write_lockdown_parity.py` compares, and this module has no
    predicate to compare. The cost of the different name is that a third
    protected file could be added there and silently not counted here, which is
    the one drift that would make this census quietly under-report. So it is
    pinned to a registered copy instead.
    """
    from e2e.corpus_report import WATCHED_PROJECT_FILES
    from e2e.orchestrator import PROTECTED_PROJECT_FILES

    assert set(WATCHED_PROJECT_FILES) == set(PROTECTED_PROJECT_FILES)


def _bash_run(dir_: Path, name: str, *commands: str) -> Path:
    return _write(dir_, name, {
        "harness_schema_version": 1, "verdict": "pass",
        "compliance": "pass", "outcome": "pass",
        "guardrail_bypass_violations": [],
        "tool_calls": [
            {"tool": "Bash", "args": {"command": c}, "response_summary": ""}
            for c in commands
        ],
    })


def test_bash_hits_are_split_into_reads_and_write_shapes(tmp_path: Path):
    """The count alone cannot answer §6's close-condition. `cat file` and
    `cat > file` both name a protected path; only the second is the thing the
    spec says to close the gap on."""
    fixture = tmp_path / "some-fixture"
    fixture.mkdir()
    paths = [_bash_run(
        fixture, "run-1.json",
        "cat /tmp/wk/research.json",                       # read
        "grep '\"id\"' /tmp/wk/tree.gedcomx.json | head",  # read, has a pipe
        "ls -la /tmp/wk 2>/dev/null && cat /tmp/wk/research.json",  # read, has a `>`
        "cat > /tmp/wk/tree.gedcomx.json << 'EOF'\n{}\nEOF",        # WRITE
        "echo hello",                                      # names nothing
    )]
    counts = tally(paths)

    assert len(counts.bash) == 4, "every Bash call naming a protected file counts"
    writes = [h for h in counts.bash if h.shape]
    assert [h.shape for h in writes] == ["redirect"]
    assert writes[0].fixture == "some-fixture"
    assert writes[0].runlog == "run-1.json"


def test_a_2_dev_null_redirect_is_not_read_as_a_write(tmp_path: Path):
    """The redirect shape must key on the protected path being the TARGET.
    Nearly every read in the corpus carries `2>/dev/null`, so a bare `>` probe
    would report the whole read population as writes and be ignored."""
    from e2e.corpus_report import write_shape

    assert write_shape("cat /tmp/wk/research.json 2>/dev/null") is None
    assert write_shape("wc -l /tmp/wk/research.json") is None
    assert write_shape("python3 -c \"import json; json.load(open('/w/research.json'))\"") is None
    assert write_shape("cat > /w/research.json << 'EOF'") == "redirect"
    assert write_shape("tee /w/tree.gedcomx.json") == "tee"
    assert write_shape("mv /tmp/x.json /w/research.json") == "mv/cp"
    assert write_shape("sed -i 's/a/b/' /w/research.json") == "sed -i"
    assert write_shape("python3 -c \"json.dump(d, open('/w/research.json','w'))\"") == "python write"


def test_the_bash_census_prints_even_when_nothing_was_found(tmp_path: Path):
    """A close-condition that prints nothing when clean is indistinguishable
    from a counter that stopped running — the state this counter replaced."""
    out = format_report(Counter({"pass": 1}), Counter({"pass": 1}), Counter({"pass": 1}),
                        n_runs=1, bash=[])
    assert "bash protected-file access: 0 call(s)" in out
    assert "write-shaped: none" in out


def test_a_write_shaped_hit_is_named_in_the_report(tmp_path: Path):
    fixture = tmp_path / "victor-spenard-parents"
    fixture.mkdir()
    counts = tally([_bash_run(fixture, "run-9.json", "cat > /w/tree.gedcomx.json << 'EOF'")])
    out = format_report(counts.recall, counts.compliance, counts.gate,
                        n_runs=1, bash=counts.bash)

    assert "write-shaped: 1" in out
    assert "victor-spenard-parents/run-9.json" in out
    assert "[redirect]" in out


def test_a_runlog_without_tool_calls_contributes_nothing(tmp_path: Path):
    """A crash before the first turn has no `tool_calls`. That is an absence,
    not a parse problem — it must not land in `problems` and shrink the run
    count the other axes are printed over."""
    fixture = tmp_path / "crashed"
    fixture.mkdir()
    counts = tally([_write(fixture, "run-1.json", {"verdict": "fail"})])
    assert counts.bash == []
    assert counts.problems == []


# ── --since (issue #1176): the window must not move on a typo ────────────────


def test_since_rejects_a_malformed_window(capsys):
    """A window that moves on a typo is the defect this report exists to retire,
    so the value is rejected rather than the runs. `parse_since` is wired as
    argparse's `type=`, so this fires on every invocation — including the ones
    that would go on to ignore the cutoff."""
    for bad in ("2026-07-27_20:00:00", "07-27-2026", "2026-13-01", "yesterday"):
        with pytest.raises(SystemExit) as e:
            main(["--since", bad])
        assert e.value.code == 2
    assert "'all', a number of days, or YYYY-MM-DD" in capsys.readouterr().err


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
        assert main(["--since", "2027-01-01"]) == 1
        assert "on/after 2027-01-01" in capsys.readouterr().err

        cr.all_result_jsons = lambda: []
        assert main(["--since", "2027-01-01"]) == 1
        err = capsys.readouterr().err
        assert "No committed runs found." in err
        assert "on/after" not in err
    finally:
        cr.all_result_jsons = orig


def test_since_is_inclusive_of_its_own_date(tmp_path: Path, capsys):
    """`--since` names a detector's ship date, so a run ON that date is inside
    the window. The boundary is the whole reason a window is quotable at all."""
    import e2e.corpus_report as cr
    fixture = tmp_path / "fx"
    fixture.mkdir()
    early = _write(fixture, "run-2026-07-26_19-59-59.json", {"verdict": "pass"})
    exact = _write(fixture, "run-2026-07-27_00-00-00.json", {"verdict": "fail"})

    orig = cr.all_result_jsons
    cr.all_result_jsons = lambda: [early, exact]
    try:
        assert main(["--since", "2026-07-27"]) == 0
    finally:
        cr.all_result_jsons = orig
    out = capsys.readouterr().out
    assert "Window: runs on/after 2026-07-27 — 1 of 2 run(s)" in out
    assert "1 fail" in out


def test_a_windowed_report_says_so_where_it_states_a_denominator():
    """`describe_window` names the window once, above the report. The rate line
    still has to scope its own refusal, or "no run has a decidable compliance
    axis" reads as a claim about the whole corpus when it is about 14 days."""
    windowed = format_report(
        Counter({"pass": 1}), Counter({"not_checked": 1}), Counter({"pass": 1}),
        n_runs=1, windowed=True,
    )
    whole = format_report(
        Counter({"pass": 1}), Counter({"not_checked": 1}), Counter({"pass": 1}),
        n_runs=1, windowed=False,
    )
    assert "in this window" in windowed and "in the corpus" not in windowed
    assert "in the corpus" in whole and "in this window" not in whole
    # The window itself is `describe_window`'s to name — stating it twice
    # invites the two lines to disagree.
    assert "Window:" not in windowed

# --- issue #1484: --recompute, the spend split, and the cost estimator ------


_MENTOR_GAP_RESEARCH = {
    # A resolved question whose proof_summary carries no gps-mentor proof-critique
    # verdict — the shape `find_missing_mentor_verdicts` fires on (mirrors the
    # `_detector_messages` helper above, so it tracks the real detector).
    "questions": [{"status": "resolved", "proof_summary_id": "ps1"}],
    "proof_summaries": [{"id": "ps1"}],
    "evaluations": [],
}


def _run_with_sidecars(runs_dir: Path, slug: str, final_research: dict, final_tree: dict,
                       *, stored_violations=None) -> Path:
    """A committed-run layout: run-1.json + its final-research / final-tree
    sidecars, under a per-slug dir. `stored_violations=None` means the run
    predates the detector — no `guardrail_bypass_violations` field at all."""
    d = runs_dir / slug
    d.mkdir(parents=True, exist_ok=True)
    payload: dict = {"tool_calls": []}
    if stored_violations is not None:
        payload["guardrail_bypass_violations"] = stored_violations
    run = _write(d, "run-1.json", payload)
    _write(d, "run-1.final-research.json", final_research)
    _write(d, "run-1.final-tree.gedcomx.json", final_tree)
    return run


def test_recompute_recovers_violations_a_stored_only_read_counts_as_zero(tmp_path: Path):
    runs, fixtures = tmp_path / "runs", tmp_path / "fixtures"
    run = _run_with_sidecars(runs, "myfix", _MENTOR_GAP_RESEARCH, {"persons": []})
    (fixtures / "myfix").mkdir(parents=True)
    _write(fixtures / "myfix", "starting-tree.gedcomx.json", {"persons": []})

    # Default (stored) path: no guardrail_bypass_violations field -> zero.
    assert sum(tally([run]).arms.values()) == 0

    # --recompute path: the mentor-verdict gap is recovered from the sidecars.
    rt = recompute_tally([run], fixtures_root=fixtures)
    assert rt.scanned == 1
    assert rt.skipped == []
    assert sum(rt.arms.values()) > 0
    assert rt.arms.get("mentor verdict", 0) > 0
    # Recompute found MORE than stored (which was absent) -> not a regression.
    assert rt.regressed == []


def test_recompute_surfaces_a_run_where_stored_exceeds_recomputed(tmp_path: Path):
    """The mary-mcandrew-son case (#1340): a run recorded a violation today's
    detector clears. It must be NAMED as a detector correction, not absorbed into
    the aggregate where the report would read as if recompute only ever finds
    MORE. Clean research/tree recompute to zero; the stored field says one."""
    runs, fixtures = tmp_path / "runs", tmp_path / "fixtures"
    run = _run_with_sidecars(
        runs, "fixed",
        {"proof_summaries": [], "evaluations": []}, {"persons": []},
        stored_violations=["a violation a contemporaneous checker recorded"],
    )
    (fixtures / "fixed").mkdir(parents=True)
    _write(fixtures / "fixed", "starting-tree.gedcomx.json", {"persons": []})

    rt = recompute_tally([run], fixtures_root=fixtures)
    assert sum(rt.arms.values()) == 0          # today's detector: clean
    assert len(rt.regressed) == 1
    assert "stored 1 -> recomputed 0" in rt.regressed[0]

    out = format_recompute(Counter(), rt)
    assert "clears a violation the run recorded" in out
    assert "detector correction, not a corpus change" in out
    # The falsified claim must be gone in both directions.
    assert "stored is a floor" not in out
    assert "the real count" not in out


def test_recompute_arm_order_breaks_ties_alphabetically():
    """Equal-count arms must order deterministically. Sorting a set by count
    alone leaves ties to hash-seed-dependent iteration order, which makes the
    report undiffable — and byte-identical output is #1484's regression check."""
    rt = RecomputeTally(
        arms=Counter({"zebra": 2, "alpha": 2, "mango": 2}),
        per_fixture=Counter(), scanned=3, skipped=[], regressed=[],
    )
    out = format_recompute(Counter(), rt)
    assert out.index("alpha") < out.index("mango") < out.index("zebra")


def test_recompute_skips_a_run_whose_fixture_has_no_seed_tree(tmp_path: Path):
    runs, fixtures = tmp_path / "runs", tmp_path / "fixtures"
    run = _run_with_sidecars(runs, "noseed", _MENTOR_GAP_RESEARCH, {"persons": []})
    fixtures.mkdir()  # no noseed/ dir -> no starting-tree.gedcomx.json to read

    rt = recompute_tally([run], fixtures_root=fixtures)
    # Named skip, excluded from both counts, never counted as zero.
    assert rt.scanned == 0
    assert sum(rt.arms.values()) == 0
    assert len(rt.skipped) == 1
    assert "starting-tree" in rt.skipped[0]


def test_estimate_cost_is_a_number_with_token_counts_and_none_without():
    assert estimate_cost_usd({"input_tokens": 1000, "output_tokens": 2000}) > 0
    # None / empty / a dict with none of the priced fields -> None, never 0.0:
    # a 0.0 would read as a free run and re-introduce the hidden-spend defect.
    assert estimate_cost_usd(None) is None
    assert estimate_cost_usd({}) is None
    assert estimate_cost_usd({"unrelated": 5}) is None


def test_spend_separates_recorded_estimated_and_unrecoverable(tmp_path: Path):
    recorded = _write(tmp_path, "run-1.json",
                      {"usage": {"total_cost_usd": 4.0, "usage": {"input_tokens": 1}}})
    estimable = _write(tmp_path, "run-2.json",
                       {"usage": {"total_cost_usd": None, "usage": {"input_tokens": 1000}}})
    tokenless = _write(tmp_path, "run-3.json",
                       {"usage": {"total_cost_usd": None}})
    spend = spend_tally([recorded, estimable, tokenless])
    assert (spend.recorded_n, spend.estimated_n, spend.neither_n) == (1, 1, 1)
    assert spend.recorded == 4.0
    assert spend.estimated > 0
