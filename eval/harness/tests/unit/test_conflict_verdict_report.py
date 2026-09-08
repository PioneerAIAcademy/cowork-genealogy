"""Tests for the contradictory-conflict-verdicts report (issue #1972 V7).

The load-bearing test is `test_the_literal_reading_is_blind_and_the_effective_one_is_not`.
Everything else pins grouping edges around it.

**Why these fixtures are synthetic when a real contradiction exists in the
corpus.** Three committed conflict-resolution logs carry
`flynn-multi-conflict/c_002` written two ways (measured 2026-09-08). Asserting
against them would be the stronger evidence and the weaker test: candidate
retention keeps only the newest 5 per skill, so those three rotate out and the
assertion would go green with nothing fixed — the same corpus-rotation trap that
has invalidated pinned figures here before. So the durable half is pinned
synthetically, and the one real-corpus fact asserted below is the shipped
SCENARIO fixture, which does not rotate.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from conflict_verdict_report import LogScan  # noqa: E402
from conflict_verdict_report import (  # noqa: E402
    VERDICT_FIELDS,
    SkillNotFound,
    _runlogs,
    format_report,
    load_scenario_conflicts,
    main,
    scan_runlog,
)


def conflicting_verdicts(runlog, scenarios_dir):
    """The findings alone, which is what most tests below assert on."""
    return scan_runlog(runlog, scenarios_dir).findings

_EVAL = Path(__file__).resolve().parents[3]


# --- fixture builders --------------------------------------------------------

def _test_entry(test_id, scenario, modified):
    return {
        "test_id": test_id,
        "scenario": scenario,
        "runs": [
            {
                "output": {
                    "file_changes": {
                        "research.json": {"diff": {"conflicts": {"modified": modified}}}
                    }
                }
            }
        ],
    }


def _mod(cid, **after):
    """A `modified` entry writing only the named fields."""
    return {
        "id": cid,
        "changed_fields": {k: {"before": None, "after": v} for k, v in after.items()},
    }


@pytest.fixture
def scenarios(tmp_path):
    """A scenario whose conflict starts `unresolved` with no preferred assertion.

    This is the MINORITY shape repo-wide and the majority within the
    conflict-resolution suite: measured 2026-09-08 over the 95 scenario fixtures,
    33 of 42 conflicts start `resolved` with a non-null `preferred_assertion_id`
    and only 9 start `unresolved`. An earlier version of this docstring claimed
    the opposite; it was wrong, and the correction matters because it makes
    `s_started_resolved` in
    `test_defaulting_an_unwritten_field_to_None_is_not_a_shortcut` the majority
    production shape rather than a hypothetical — that test guards a live case.
    """
    d = tmp_path / "s_demo"
    d.mkdir()
    (d / "research.json").write_text(
        json.dumps(
            {"conflicts": [{"id": "c_001", "status": "unresolved",
                            "preferred_assertion_id": None}]}
        ),
        encoding="utf-8",
    )
    return tmp_path


# --- the finding -------------------------------------------------------------

def _grouped(runlog, read):
    """Group `(scenario, conflict id)` -> set of verdicts, under a pluggable
    reading. The two counterfactual readings below differ from the shipped one
    only in `read`, so the comparison is of the reading and nothing else."""
    groups = {}
    for t in runlog["tests"]:
        for run in t["runs"]:
            entries = run["output"]["file_changes"]["research.json"]["diff"]["conflicts"]["modified"]
            for e in entries:
                v = read(e.get("changed_fields") or {})
                if v is not None:
                    groups.setdefault((t["scenario"], e["id"]), set()).add(v)
    return [k for k, vs in groups.items() if len(vs) > 1]


def _read_literal(cf):
    """The naive reading, implemented here rather than described so the gap
    cannot be argued about: `changed_fields` only, as issue #1972 V7's "where to
    look" line reads.

    A conflict this run wrote no verdict field for yields NO verdict to compare,
    so it is skipped — which is the honest form of the naive reading and exactly
    why it scores zero on the real corpus. (Coercing the unwritten field to
    `None` instead is a *third* reading; it happens to catch this case and
    false-positives on others, which
    `test_defaulting_an_unwritten_field_to_None_is_not_a_shortcut` pins.)
    """
    if not any(f in cf for f in VERDICT_FIELDS):
        return None
    return tuple(cf[f]["after"] if f in cf else None for f in VERDICT_FIELDS)


def _read_coerce_none(cf):
    """The tempting shortcut: skip the fixture read and call an unwritten field
    `None`."""
    return tuple(cf[f]["after"] if f in cf else None for f in VERDICT_FIELDS)


def test_the_literal_reading_is_blind_and_the_effective_one_is_not(scenarios):
    """The whole point of the module.

    Two tests reach opposite verdicts on one conflict. The resolver writes
    `status`; the decliner correctly writes only its rationale and leaves
    `status` at the fixture's `unresolved`. So the disagreement exists in the
    post-run state and is absent from the diffs — a `changed_fields`-only scan
    reports a clean corpus.
    """
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo",
                        [_mod("c_001", status="resolved",
                              preferred_assertion_id="a_001")]),
            # Declines to resolve: touches neither verdict field.
            _test_entry("ut_b", "s_demo",
                        [_mod("c_001", resolution_rationale="evidence is too thin")]),
        ]
    }

    # POSITIVE CONTROL FIRST. Without it `== []` below means "blind, OR broken,
    # OR not implemented" — replacing `_read_literal`'s body with `return None`
    # left this test green, which made the module's entire reason for existing
    # rest on an assertion that could not fail.
    both_wrote_status = {
        "tests": [
            _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved")]),
            _test_entry("ut_b", "s_demo", [_mod("c_001", status="rejected")]),
        ]
    }
    assert _grouped(both_wrote_status, _read_literal), (
        "the literal reading cannot find a contradiction even when BOTH tests "
        "write status — it is inert, so the assertion below proves nothing"
    )

    assert _grouped(runlog, _read_literal) == [], (
        "the naive reading found the contradiction, so this fixture no longer "
        "reproduces the trap the module exists for"
    )

    found = conflicting_verdicts(runlog, scenarios)
    assert len(found) == 1, f"effective reading missed the contradiction: {found}"
    assert found[0]["scenario"] == "s_demo"
    assert found[0]["conflict_id"] == "c_001"
    assert set(found[0]["verdicts"]) == {
        ("resolved", "a_001"),
        ("unresolved", None),
    }, found[0]["verdicts"]


def test_defaulting_an_unwritten_field_to_None_is_not_a_shortcut(tmp_path):
    """Why the fixture read is load-bearing and not merely tidier.

    Calling an unwritten field `None` gets the flynn case right by accident,
    because that fixture starts `unresolved`/`None`. On a conflict whose starting
    status is anything else it reports two tests that AGREE — the report's hits
    are triaged by hand, so a false positive costs a genealogist's time and
    teaches them to stop reading it.
    """
    d = tmp_path / "s_started_resolved"
    d.mkdir()
    (d / "research.json").write_text(
        json.dumps(
            {"conflicts": [{"id": "c_001", "status": "resolved",
                            "preferred_assertion_id": "a_001"}]}
        ),
        encoding="utf-8",
    )
    # Both runs leave the verdict at what the fixture already said; one happens
    # to rewrite it identically, the other only adds narrative.
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_started_resolved",
                        [_mod("c_001", status="resolved",
                              preferred_assertion_id="a_001")]),
            _test_entry("ut_b", "s_started_resolved",
                        [_mod("c_001", weighing_analysis="restated the weighing")]),
        ]
    }

    assert _grouped(runlog, _read_coerce_none), (
        "the None-defaulting shortcut no longer false-positives here, so this "
        "test no longer justifies reading the fixture"
    )
    assert conflicting_verdicts(runlog, tmp_path) == [], (
        "two runs that agree with the fixture's starting verdict were reported "
        "as contradicting each other"
    )


def test_the_shipped_flynn_fixture_still_supplies_the_fallback_value():
    """The one real-corpus fact worth asserting: fixtures do not rotate.

    The effective reading is only able to see anything because the scenario
    supplies a starting `status`. A fixture that omitted the field would make the
    fallback resolve `None` and the report would be back to comparing absences.
    """
    conflicts, resolved = load_scenario_conflicts(
        "flynn-multi-conflict", _EVAL / "fixtures" / "scenarios"
    )
    assert resolved, "flynn-multi-conflict/research.json is unreadable"
    assert conflicts, "flynn-multi-conflict has no conflicts[] — did it move?"
    for cid, c in conflicts.items():
        assert "status" in c, f"{cid} has no starting status; the fallback is blind"


# --- grouping edges ----------------------------------------------------------

def test_two_tests_reaching_the_SAME_verdict_is_not_a_finding(scenarios):
    """Several tests exercising one conflict is normal and expected — only
    disagreement is reportable."""
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved",
                                                preferred_assertion_id="a_001")]),
            _test_entry("ut_b", "s_demo", [_mod("c_001", status="resolved",
                                                preferred_assertion_id="a_001")]),
        ]
    }
    assert conflicting_verdicts(runlog, scenarios) == []


def test_one_test_alone_cannot_contradict_anything(scenarios):
    runlog = {"tests": [_test_entry("ut_a", "s_demo",
                                    [_mod("c_001", status="resolved")])]}
    assert conflicting_verdicts(runlog, scenarios) == []


def test_the_same_conflict_id_in_DIFFERENT_scenarios_is_not_a_finding(scenarios):
    """Ids are scenario-local: `c_001` in two fixtures is two different
    conflicts resting on different evidence, so opposite verdicts are correct.
    Grouping on the id alone would report every one of them."""
    other = scenarios / "s_other"
    other.mkdir()
    (other / "research.json").write_text(
        json.dumps({"conflicts": [{"id": "c_001", "status": "unresolved"}]}),
        encoding="utf-8",
    )
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved")]),
            _test_entry("ut_b", "s_other", [_mod("c_001", status="rejected")]),
        ]
    }
    assert conflicting_verdicts(runlog, scenarios) == []


def test_agreeing_on_status_but_not_on_the_winner_is_a_finding(scenarios):
    """`status` alone is not the verdict. Both runs resolve the conflict and pick
    a different assertion — reading only `status` calls that consistent."""
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved",
                                                preferred_assertion_id="a_001")]),
            _test_entry("ut_b", "s_demo", [_mod("c_001", status="resolved",
                                                preferred_assertion_id="a_002")]),
        ]
    }
    found = conflicting_verdicts(runlog, scenarios)
    assert len(found) == 1, f"disagreement on the winner was not reported: {found}"


# --- robustness: a report must not die on one bad input ----------------------

def _run(output):
    """One test entry with a raw `output`, for the shapes `_test_entry` cannot
    express."""
    return {"tests": [{"test_id": "ut_a", "scenario": "s_demo",
                       "runs": [{"output": output}]}]}


@pytest.mark.parametrize(
    "runlog",
    [
        {},
        {"tests": None},
        {"tests": [{"test_id": "ut_a"}]},                       # no scenario, no runs
        {"tests": ["not a dict"]},
        {"tests": [_test_entry("ut_a", "s_demo", [{"no": "id"}])]},
        {"tests": [_test_entry("ut_a", "s_missing", [_mod("c_001", status="x")])]},
        # `file_changes: None` is the MAJORITY real shape — 1168 of the 2216 runs
        # across the 135 committed logs, vs 1048 carrying a dict (measured
        # 2026-09-08). `_test_entry` cannot build it, so nothing here covered the
        # single most common input the scan receives.
        _run({"file_changes": None}),
        _run({}),
        _run(None),
        # A dict with no `research.json` key: 25 real occurrences.
        _run({"file_changes": {"tree.gedcomx.json": {"diff": {}}}}),
        # Non-dict where a dict is expected, at each level.
        _run({"file_changes": {"research.json": {"diff": {"conflicts": []}}}}),
        _run({"file_changes": {"research.json": {"diff": {"conflicts":
                                                          {"modified": "nope"}}}}}),
    ],
)
def test_malformed_or_partial_run_logs_yield_no_findings_and_do_not_raise(
    runlog, scenarios
):
    """Asserting the RETURN, not merely that nothing raised.

    A bare call proves only that Python ran: dropping the `or {}` that absorbs a
    `None` `file_changes` left the old version of this test green while the CLI
    died with `KeyError` on the first committed log.
    """
    assert conflicting_verdicts(runlog, scenarios) == []


def test_an_unparseable_scenario_fixture_yields_no_fallback_rather_than_raising(tmp_path):
    d = tmp_path / "s_bad"
    d.mkdir()
    (d / "research.json").write_text("{not json", encoding="utf-8")
    assert load_scenario_conflicts("s_bad", tmp_path) == ({}, False)


def test_a_readable_fixture_reports_itself_resolved(tmp_path):
    """The polarity half: if `resolved` were always False the report would warn
    on every scan and the warning would stop meaning anything."""
    d = tmp_path / "s_ok"
    d.mkdir()
    (d / "research.json").write_text(
        json.dumps({"conflicts": [{"id": "c_001", "status": "unresolved"}]}),
        encoding="utf-8",
    )
    conflicts, resolved = load_scenario_conflicts("s_ok", tmp_path)
    assert resolved is True and "c_001" in conflicts


# --- the operator-facing half ------------------------------------------------

def test_the_report_names_the_disagreeing_tests(scenarios):
    """A hit is triaged by a genealogist, who needs to know which two tests to
    open. A count alone is unactionable."""
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved",
                                                preferred_assertion_id="a_001")]),
            _test_entry("ut_b", "s_demo",
                        [_mod("c_001", resolution_rationale="too thin")]),
        ]
    }
    out = format_report([("conflict-resolution", "v1_x.json",
                          scan_runlog(runlog, scenarios))])
    for expected in ("ut_a", "ut_b", "c_001", "s_demo", "conflict-resolution"):
        assert expected in out, f"{expected!r} missing from the report:\n{out}"


def test_the_clean_report_warns_that_a_naive_scan_also_reads_clean():
    """A green scan is the exact output the blind implementation produces, so
    the clean message has to say which reading produced it — otherwise the
    report is indistinguishable from the bug it was written to avoid."""
    out = format_report([("conflict-resolution", "v1_x.json", LogScan())])
    assert "EFFECTIVE" in out
    assert "reports zero" in out


# --- silent-zero guards -------------------------------------------------------
#
# Every test below pins a way this report reads GREEN while looking at nothing.
# All four were live and reproduced before they were closed; a report whose
# payload is "no contradictions" is worth only as much as its denominator.


def test_an_unknown_skill_is_an_error_not_an_empty_clean_scan():
    """`--skill conflict_resolution` — underscore for the real hyphen — used to
    print the full clean-scan message for the one skill carrying every known
    contradiction, and exit 0. The typo is a plausible one and the output was
    indistinguishable from a genuine pass."""
    with pytest.raises(SkillNotFound) as e:
        _runlogs("conflict_resolution")
    # The message has to make the fix obvious, so it names what does exist.
    assert "conflict-resolution" in str(e.value)

    assert main(["--skill", "conflict_resolution"]) == 2, (
        "an unknown skill must not exit 0; a green exit code on a typo is the "
        "silent zero this guards"
    )
    assert main(["--skill", "conflict-resolution"]) == 0


def test_a_scan_that_read_no_conflict_writes_says_so_loudly(scenarios):
    """The shape-drift guard, and the one that would have caught a renamed diff
    key. `RUN LOGS SCANNED` alone cannot: 128 of the 135 committed logs carry no
    conflict write, so a full denominator is the normal state and says nothing
    about whether anything was read."""
    drifted = {
        "tests": [
            {
                "test_id": "ut_a",
                "scenario": "s_demo",
                # `fileChanges` instead of `file_changes` — i.e. any future
                # run-log shape change.
                "runs": [{"output": {"fileChanges": {"research.json": {}}}}],
            }
        ]
    }
    scan = scan_runlog(drifted, scenarios)
    assert scan.groups == 0
    out = format_report([("conflict-resolution", "v1_x.json", scan)])
    assert "GROUPS EXAMINED: 0" in out
    assert "proves NOTHING" in out, out


def test_a_populated_scan_reports_a_nonzero_group_count(scenarios):
    """Polarity for the test above: if `groups` were always 0 the warning would
    fire on every scan and stop being read."""
    runlog = {"tests": [_test_entry("ut_a", "s_demo",
                                    [_mod("c_001", status="resolved")])]}
    scan = scan_runlog(runlog, scenarios)
    assert scan.groups == 1
    out = format_report([("conflict-resolution", "v1_x.json", scan)])
    assert "GROUPS EXAMINED: 1" in out
    assert "proves NOTHING" not in out


def test_an_unreadable_run_log_is_named_not_dropped_from_the_denominator():
    """A truncated log used to leave numerator and denominator both, so the
    corpus silently shrank. A `--test` interrupted mid-write does this."""
    out = format_report([], [Path("eval/runlogs/unit/x/v1_truncated.json")])
    assert "UNREADABLE RUN LOGS: 1" in out
    assert "v1_truncated.json" in out


def test_a_scenario_whose_fixture_is_missing_is_named_and_its_findings_flagged(tmp_path):
    """The subtlest of the four. With no fixture, `effective_verdict` falls back
    to `None` for every unwritten field — which IS `_read_coerce_none`, the
    reading `test_defaulting_an_unwritten_field_to_None_is_not_a_shortcut`
    forbids. So a renamed scenario directory silently switches the report to a
    reading it declares wrong, manufacturing exactly that false positive with
    nothing in the output to say so.

    It is not hypothetical: `empty-folder-no-project` already ships with no
    `research.json` and is referenced by tests.
    """
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_gone", [_mod("c_001", status="resolved",
                                                preferred_assertion_id="a_001")]),
            _test_entry("ut_b", "s_gone", [_mod("c_001", weighing_analysis="...")]),
        ]
    }
    scan = scan_runlog(runlog, tmp_path)  # no s_gone/ directory exists
    assert scan.unresolved_scenarios == {"s_gone"}
    assert scan.findings and scan.findings[0]["fixture_unavailable"] is True

    out = format_report([("conflict-resolution", "v1_x.json", scan)])
    assert "SCENARIOS WITH NO READABLE FIXTURE: 1" in out
    assert "s_gone" in out
    assert "fixture unavailable" in out


def test_a_readable_fixture_leaves_no_warning(scenarios):
    """Polarity: the warning must not fire on the normal path."""
    runlog = {"tests": [_test_entry("ut_a", "s_demo",
                                    [_mod("c_001", status="resolved")])]}
    scan = scan_runlog(runlog, scenarios)
    assert scan.unresolved_scenarios == set()
    assert "NO READABLE FIXTURE" not in format_report(
        [("conflict-resolution", "v1_x.json", scan)]
    )


# --- what the gate actually gates on -----------------------------------------


def test_one_test_flip_flopping_across_its_runs_is_reported_as_that(scenarios):
    """The gate is two distinct VERDICTS, not two distinct tests, and the report
    has to name which case it found — telling a genealogist "two tests disagree"
    when one test disagreed with itself sends them looking for a second test that
    does not exist.

    Structurally latent today (`runs_per_test` is pinned to 1, so every committed
    test entry has exactly one run) and live the moment anyone runs with repeats.
    """
    two_runs = _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved")])
    two_runs["runs"].append(
        _test_entry("ut_a", "s_demo", [_mod("c_001", status="rejected")])["runs"][0]
    )
    found = scan_runlog({"tests": [two_runs]}, scenarios).findings
    assert len(found) == 1
    assert found[0]["kind"] == "one test flip-flopped across its runs"

    out = format_report([("conflict-resolution", "v1_x.json",
                          scan_runlog({"tests": [two_runs]}, scenarios))])
    assert "flip-flopped" in out


def test_two_tests_disagreeing_is_labelled_as_that(scenarios):
    """Polarity for the label above."""
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo", [_mod("c_001", status="resolved")]),
            _test_entry("ut_b", "s_demo", [_mod("c_001", status="rejected")]),
        ]
    }
    assert scan_runlog(runlog, scenarios).findings[0]["kind"] == "two tests disagree"


def test_a_conflict_created_outright_is_scanned_too(scenarios):
    """`diff.conflicts.added` carries a DIFFERENT shape from `modified` — the
    whole object rather than `{id, changed_fields}` — so a conflict a test
    creates with a verdict attached was invisible, with nothing to distinguish
    that from agreement."""
    runlog = {
        "tests": [
            {
                "test_id": "ut_a",
                "scenario": "s_demo",
                "runs": [
                    {
                        "output": {
                            "file_changes": {
                                "research.json": {
                                    "diff": {
                                        "conflicts": {
                                            "added": [
                                                {"id": "c_new",
                                                 "status": "resolved",
                                                 "preferred_assertion_id": "a_009"}
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    }
                ],
            },
            _test_entry("ut_b", "s_demo", [_mod("c_new", status="rejected",
                                                preferred_assertion_id="a_010")]),
        ]
    }
    found = scan_runlog(runlog, scenarios).findings
    assert len(found) == 1, f"the added arm was not scanned: {found}"
    assert found[0]["conflict_id"] == "c_new"


def test_two_tests_with_no_scenario_are_not_merged_together(scenarios):
    """Keying an absent scenario to the empty string put every unnamed test's
    conflicts in one bucket — the cross-scenario false positive that
    `test_the_same_conflict_id_in_DIFFERENT_scenarios_is_not_a_finding` guards
    against, reached through the branch it does not cover."""
    runlog = {
        "tests": [
            _test_entry("ut_a", None, [_mod("c_001", status="resolved")]),
            _test_entry("ut_b", None, [_mod("c_001", status="rejected")]),
        ]
    }
    assert scan_runlog(runlog, scenarios).findings == []


def test_an_unhashable_after_value_does_not_crash_the_scan(scenarios):
    """Verdicts are dict keys. A malformed log carrying a list `after` raised
    `TypeError` from outside `main`'s handler and killed the whole corpus scan
    over one bad entry."""
    runlog = {
        "tests": [
            _test_entry("ut_a", "s_demo",
                        [{"id": "c_001",
                          "changed_fields": {"status": {"after": ["resolved"]}}}]),
            _test_entry("ut_b", "s_demo", [_mod("c_001", status="rejected")]),
        ]
    }
    found = scan_runlog(runlog, scenarios).findings
    assert len(found) == 1, "the unhashable entry was dropped rather than compared"


def test_an_empty_scenario_name_reports_no_fallback_and_reads_no_stray_file(tmp_path):
    """`load_scenario_conflicts("")` must not claim a resolved fixture.

    Two things ride on the early return, and a mutation flipping its flag to
    `True` was invisible through `scan_runlog` (which guards on `if scenario and
    not resolved`, so it never reads the flag for an unnamed scenario) — hence
    this direct test of the function's own contract.

    The guard is also not merely an optimisation: without it the path collapses
    to `<scenarios_dir>/research.json`, so a stray file sitting there would be
    read as though it were the scenario's own fixture.
    """
    (tmp_path / "research.json").write_text(
        json.dumps({"conflicts": [{"id": "c_stray", "status": "resolved"}]}),
        encoding="utf-8",
    )
    conflicts, resolved = load_scenario_conflicts("", tmp_path)
    assert resolved is False, "an unnamed scenario must not report a usable fixture"
    assert conflicts == {}, f"read a stray file as a scenario fixture: {conflicts}"


# --- the discovery seam, end to end ------------------------------------------
#
# Everything above passes an explicit `scenarios_dir` and a literal run log, so
# none of it touched `_runlogs` -> `_load` -> `scan_runlog` -> `format_report` ->
# print. That left the seam mutable in silence: making `main` never call the scan
# at all printed a full-denominator clean report over the real 135-log corpus,
# indistinguishable from a genuinely clean one, with every test still green.


@pytest.fixture
def corpus(tmp_path, monkeypatch):
    """A miniature run-log tree + scenario tree, wired in through the module's
    own globals so `main` reaches them by its real discovery path."""
    import conflict_verdict_report as mod

    unit = tmp_path / "runlogs" / "unit" / "conflict-resolution"
    unit.mkdir(parents=True)
    scen = tmp_path / "scenarios" / "s_demo"
    scen.mkdir(parents=True)
    (scen / "research.json").write_text(
        json.dumps(
            {"conflicts": [{"id": "c_001", "status": "unresolved",
                            "preferred_assertion_id": None}]}
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "RUNLOGS_UNIT", tmp_path / "runlogs" / "unit")
    monkeypatch.setattr(mod, "SCENARIOS", tmp_path / "scenarios")
    return unit


def _write(path, runlog):
    path.write_text(json.dumps(runlog), encoding="utf-8")


_CONTRADICTORY = {
    "tests": [
        {"test_id": "ut_a", "scenario": "s_demo", "outcome": "pass",
         "runs": [{"output": {"file_changes": {"research.json": {"diff": {"conflicts": {
             "modified": [{"id": "c_001", "changed_fields": {
                 "status": {"before": "unresolved", "after": "resolved"},
                 "preferred_assertion_id": {"before": None, "after": "a_001"}}}]}}}}}}]},
        {"test_id": "ut_b", "scenario": "s_demo", "outcome": "partial",
         "runs": [{"output": {"file_changes": {"research.json": {"diff": {"conflicts": {
             "modified": [{"id": "c_001", "changed_fields": {
                 "resolution_rationale": {"before": None, "after": "too thin"}}}]}}}}}}]},
    ]
}


def test_main_finds_a_contradiction_through_its_real_discovery_path(corpus, capsys):
    """The end-to-end guard. Making `main` skip the scan, or `_runlogs` return
    nothing, prints a confident clean report — so the seam needs a positive
    case, not only the exit code."""
    _write(corpus / "v1_2026-01-01_00-00-00.json", _CONTRADICTORY)

    assert main([]) == 0
    out = capsys.readouterr().out
    assert "s_demo / c_001" in out, out
    assert "1 contradiction(s) in 1 of 1 run log(s)" in out, out
    # The verdict VALUES, not just the ids: a printer that dropped them lost the
    # whole triage payload while the ids still matched.
    assert "status='resolved'" in out and "preferred_assertion_id='a_001'" in out, out
    assert "status='unresolved'" in out and "preferred_assertion_id=None" in out, out
    assert "GROUPS EXAMINED: 1" in out


def test_a_non_pass_writer_is_labelled_so_triage_can_start(corpus, capsys):
    """A hit where the suite already flagged one side is a different triage from
    one where both sides passed. 9 of the 31 conflict-writing entries in the real
    corpus are partial or fail."""
    _write(corpus / "v1_2026-01-01_00-00-00.json", _CONTRADICTORY)
    main([])
    out = capsys.readouterr().out
    assert "ut_b [partial]" in out, out
    # Asserting the absence of "[pass]" rather than of "ut_a [partial]": the
    # latter is satisfied by labelling ut_a "[pass]", so a mutation that tags
    # EVERY writer left it green while the labels became noise.
    assert "[pass]" not in out, f"a passing writer must not be labelled: {out}"


def test_scratch_and_annotation_files_are_not_scanned(corpus, capsys):
    """`scratch_*` is partial and gitignored; `*.ann.json` is an annotation, not
    a run log. Relaxing the single-dot filter reads annotations as run logs."""
    _write(corpus / "scratch_2026-01-01_00-00-00.json", _CONTRADICTORY)
    _write(corpus / "v1_2026-01-01_00-00-00.ann.json", _CONTRADICTORY)
    main([])
    out = capsys.readouterr().out
    assert "RUN LOGS SCANNED: 0" in out, out
    assert "proves NOTHING" in out, out


def test_one_unreadable_log_is_named_and_the_others_still_scan(corpus, capsys):
    """A truncated log must cost one row, not the corpus."""
    _write(corpus / "v1_2026-01-01_00-00-00.json", _CONTRADICTORY)
    (corpus / "v2_2026-01-02_00-00-00.json").write_text("{truncated", encoding="utf-8")
    assert main([]) == 0
    out = capsys.readouterr().out
    assert "1 contradiction(s)" in out, out
    assert "UNREADABLE RUN LOGS: 1" in out and "v2_2026-01-02" in out, out


def test_a_structurally_odd_log_costs_one_row_not_the_whole_scan(corpus, capsys):
    """It parses as JSON but violates the schema, so it raises from inside the
    scan rather than from `_load`. Without the broad catch this killed every
    remaining log in the corpus."""
    _write(corpus / "v1_2026-01-01_00-00-00.json", _CONTRADICTORY)
    # `diff` a list rather than an object: `.get` on it raises AttributeError
    # from inside `_writes`. (Several other odd shapes — `tests` or `runs` as a
    # dict — are absorbed by the isinstance guards instead, which is why this
    # one is chosen: it is a shape that genuinely reaches the raise.)
    _write(
        corpus / "v2_2026-01-02_00-00-00.json",
        {"tests": [{"test_id": "ut_x", "scenario": "s_demo",
                    "runs": [{"output": {"file_changes": {"research.json":
                                                          {"diff": ["x"]}}}}]}]},
    )

    assert main([]) == 0
    out = capsys.readouterr().out
    assert "1 contradiction(s)" in out, "the good log was lost with the bad one"
    assert "UNREADABLE RUN LOGS: 1" in out and "AttributeError" in out, out


def test_an_absent_runlog_root_is_an_error_not_a_clean_scan(tmp_path, monkeypatch):
    """`provenance_report.py` guards this; unguarded it was a bare
    FileNotFoundError traceback."""
    import conflict_verdict_report as mod

    monkeypatch.setattr(mod, "RUNLOGS_UNIT", tmp_path / "nope")
    assert main([]) == 2
