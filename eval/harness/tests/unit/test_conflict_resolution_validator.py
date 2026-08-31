"""Direct tests for the V6 and V2 conflict-resolution validators (issue #1972).

Same reason as `test_proof_conclusion_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise appear
only inside a paid per-skill run.

The last two tests replay the five committed run logs through both validators.
Synthetic dicts prove the branch logic and the re-derivation script proves the
rule's arithmetic, but neither asserts the validators fire on the real data — a
shape slip between `after_state["research_json"]` and the run log's
`file_changes` shape passes both halves and is caught only here.
"""

import glob
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the test_*/report_* prefixes on purpose: pyproject sets
# `python_functions = ["test_*", "report_*"]`, so an imported validator keeps
# being collected as a test here and errors on its missing harness fixtures.
from test_conflict_resolution import (  # noqa: E402
    report_resolution_word_caps as check_word_caps,
    test_at_most_one_conflict_analysis_modified as check_one_per_turn,
)

_REPO = Path(__file__).resolve().parents[4]  # eval/harness/tests/unit -> repo root
_CORPUS = sorted(
    p for p in glob.glob(str(_REPO / "eval/runlogs/unit/conflict-resolution/v1_*.json"))
    if not p.endswith(".ann.json")
)


def _conflict(cid, **kw):
    base = {
        "id": cid,
        "status": "unresolved",
        "independence_analysis": None,
        "weighing_analysis": None,
        "preferred_assertion_id": None,
        "resolution_rationale": None,
        "competing_assertion_ids": ["a_001", "a_002"],
    }
    base.update(kw)
    return base


def _states(before_conflicts, after_conflicts):
    return (
        {"research_json": {"conflicts": before_conflicts}},
        {"research_json": {"conflicts": after_conflicts}},
    )


def _words(n):
    return " ".join(["word"] * n)


# --- V6 -----------------------------------------------------------------

def test_v6_one_conflict_resolved_passes():
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [_conflict("c_001", status="resolved", resolution_rationale="x"), _conflict("c_002")],
    )
    check_one_per_turn(before, after)


def test_v6_two_conflicts_resolved_fails_naming_both():
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [
            _conflict("c_001", status="resolved", resolution_rationale="x"),
            _conflict("c_002", status="resolved", resolution_rationale="y"),
        ],
    )
    with pytest.raises(AssertionError) as e:
        check_one_per_turn(before, after)
    assert "c_001" in str(e.value) and "c_002" in str(e.value)


def test_v6_creating_an_empty_conflict_is_not_resolution():
    """Identification is explicitly unrestricted -- a created entry with all five
    analysis fields at their template defaults must not count."""
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", status="resolved", resolution_rationale="x"), _conflict("c_003")],
    )
    check_one_per_turn(before, after)


def test_v6_creating_an_already_resolved_conflict_counts():
    """The bypass: nothing stops a create arriving already resolved, so a run
    could resolve one and create-and-resolve a second in one turn."""
    before, after = _states(
        [_conflict("c_001")],
        [
            _conflict("c_001", status="resolved", resolution_rationale="x"),
            _conflict("c_003", status="resolved", resolution_rationale="y"),
        ],
    )
    with pytest.raises(AssertionError) as e:
        check_one_per_turn(before, after)
    assert "c_003" in str(e.value)


def test_v6_skips_without_research_json():
    with pytest.raises(pytest.skip.Exception):
        check_one_per_turn({"research_json": None}, {"research_json": None})


# --- V2 -----------------------------------------------------------------

def test_v2_rationale_inside_the_band_is_not_observed():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", resolution_rationale=_words(260))],
    )
    check_word_caps(before, after)


def test_v2_long_rationale_on_two_way_conflict_is_observed():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", resolution_rationale=_words(400))],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    assert "400 words" in str(e.value)


def test_v2_three_way_conflict_escapes_the_rationale_cap():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001",
                   resolution_rationale=_words(400),
                   competing_assertion_ids=["a_001", "a_002", "a_003"])],
    )
    check_word_caps(before, after)


def test_v2_escape_reads_competing_ids_from_after_state_not_the_diff():
    """The 17-vs-32 regression.

    A run almost never writes competing_assertion_ids -- it is absent from
    changed_fields on 0 of the 32 over-cap writes in the corpus. An
    implementation that looks for it among the changed fields sees nothing,
    concludes "fewer than three", and the escape never applies. Here the field is
    unchanged between before and after AND has three entries: the escape must
    still apply.
    """
    three = ["a_001", "a_002", "a_003"]
    before, after = _states(
        [_conflict("c_001", competing_assertion_ids=three)],
        [_conflict("c_001", competing_assertion_ids=three,
                   resolution_rationale=_words(400))],
    )
    check_word_caps(before, after)


def test_v2_long_weighing_is_observed():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", weighing_analysis=_words(215))],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    assert "215 words" in str(e.value)


def test_v2_covers_newly_created_conflicts():
    """V2's population is wider than V6's on purpose: a conflict the run authored
    is exactly what a word cap is for."""
    before, after = _states(
        [],
        [_conflict("c_003", resolution_rationale=_words(400))],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    assert "c_003" in str(e.value)


# --- Corpus replay ------------------------------------------------------

def _replay(validator):
    """Run one validator over every run in the committed corpus.

    Run logs carry no after_state, so it is reconstructed the way issue #1972
    prescribes: the scenario fixture's conflicts overlaid with changed_fields.
    """
    fired = []
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            fixture = _REPO / "eval/fixtures/scenarios" / str(t.get("scenario")) / "research.json"
            if not fixture.exists():
                continue
            base = json.loads(fixture.read_text(encoding="utf-8")).get("conflicts", [])
            for r in t.get("runs", []):
                diff = (((r.get("output") or {}).get("file_changes") or {})
                        .get("research.json") or {}).get("diff") or {}
                modified = (diff.get("conflicts") or {}).get("modified") or []
                if not modified:
                    continue
                before = {"research_json": {"conflicts": base}}
                after_conflicts = [dict(c) for c in base]
                by_id = {c["id"]: c for c in after_conflicts}
                for m in modified:
                    entry = by_id.get(m.get("id"))
                    if entry is None:
                        continue
                    for field, change in (m.get("changed_fields") or {}).items():
                        entry[field] = change.get("after")
                after = {"research_json": {"conflicts": after_conflicts}}
                try:
                    validator(before, after)
                except AssertionError as e:
                    fired.append((Path(path).name, t["test_id"], str(e)))
                except pytest.skip.Exception:
                    pass
    return fired


@pytest.mark.skipif(not _CORPUS, reason="no committed conflict-resolution run logs")
def test_v6_fires_on_the_known_corpus_violations_and_nothing_else():
    fired = _replay(check_one_per_turn)
    assert {(f, t) for f, t, _ in fired} == {
        ("v1_2026-08-18_15-37-43.json", "ut_conflict_resolution_002"),
        ("v1_2026-08-18_19-42-11.json", "ut_conflict_resolution_002"),
    }, f"unexpected V6 firing set: {[(f, t) for f, t, _ in fired]}"


@pytest.mark.skipif(not _CORPUS, reason="no committed conflict-resolution run logs")
def test_v2_reports_the_measured_counts_on_the_corpus():
    """Pins the bands to what they actually report: 7 of 13 weighing writes over
    the 200 cap, and 12 of 17 rationale writes over the 250 cap on conflicts
    where the three-or-more-way escape cannot apply.
    """
    fired = _replay(check_word_caps)
    # Only the validator's own observation lines. pytest's assertion rewriting
    # appends an "assert not [...]" repr that repeats every message, so a naive
    # splitlines() double-counts each observation.
    lines = [ln.strip() for _, _, msg in fired for ln in msg.splitlines()
             if ln.strip().startswith("conflicts[")]
    weighing = [ln for ln in lines if "weighing_analysis" in ln]
    rationale = [ln for ln in lines if "resolution_rationale" in ln]
    assert len(weighing) == 7, f"expected 7 weighing observations, got {len(weighing)}"
    assert len(rationale) == 12, f"expected 12 rationale observations, got {len(rationale)}"
