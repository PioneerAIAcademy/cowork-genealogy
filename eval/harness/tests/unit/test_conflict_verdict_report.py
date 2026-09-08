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

from conflict_verdict_report import (  # noqa: E402
    VERDICT_FIELDS,
    conflicting_verdicts,
    format_report,
    scenario_conflicts,
)

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
    """A scenario whose conflict starts `unresolved` with no preferred assertion —
    the shape every shipped conflict fixture has, since a fixture that started
    resolved would give the skill nothing to do."""
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


def test_the_shipped_flynn_fixture_still_supplies_the_fallback_value(scenarios):
    """The one real-corpus fact worth asserting: fixtures do not rotate.

    The effective reading is only able to see anything because the scenario
    supplies a starting `status`. A fixture that omitted the field would make the
    fallback resolve `None` and the report would be back to comparing absences.
    """
    conflicts = scenario_conflicts("flynn-multi-conflict", _EVAL / "fixtures" / "scenarios")
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

@pytest.mark.parametrize(
    "runlog",
    [
        {},
        {"tests": None},
        {"tests": [{"test_id": "ut_a"}]},                       # no scenario, no runs
        {"tests": [_test_entry("ut_a", "s_demo", [{"no": "id"}])]},
        {"tests": [_test_entry("ut_a", "s_missing", [_mod("c_001", status="x")])]},
    ],
)
def test_malformed_or_partial_run_logs_do_not_raise(runlog, scenarios):
    conflicting_verdicts(runlog, scenarios)


def test_an_unparseable_scenario_fixture_yields_no_fallback_rather_than_raising(tmp_path):
    d = tmp_path / "s_bad"
    d.mkdir()
    (d / "research.json").write_text("{not json", encoding="utf-8")
    assert scenario_conflicts("s_bad", tmp_path) == {}


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
                          conflicting_verdicts(runlog, scenarios))])
    for expected in ("ut_a", "ut_b", "c_001", "s_demo", "conflict-resolution"):
        assert expected in out, f"{expected!r} missing from the report:\n{out}"


def test_the_clean_report_warns_that_a_naive_scan_also_reads_clean():
    """A green scan is the exact output the blind implementation produces, so
    the clean message has to say which reading produced it — otherwise the
    report is indistinguishable from the bug it was written to avoid."""
    out = format_report([("conflict-resolution", "v1_x.json", [])])
    assert "EFFECTIVE" in out
    assert "reports zero" in out
