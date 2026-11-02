"""Direct tests for `test_research_plan_hints_review_first`.

Issue #3906, the lead's 2026-10-29 ruling: the `fs_hints` review item leads the
plan on identity, parentage, birth, death and marriage questions whose person has
an `ark`, and an enumerative question gets none. Nothing under `validators/` is
collected by `make harness-test`.

Real-plan behaviour, replayed before this file was written: research-plan run log
`v16_2026-10-30_04-56-05` — `ut_research_plan_prof` (parentage, ZZKR-TH2) opens
with pli_001 `fs_hints` and passes; `ut_research_plan_subj` (baptism, ZZKR-BR1)
opens with a `church` item and fails, which is the pre-change wording.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_research_plan import (  # noqa: E402
    test_research_plan_hints_review_first as check_hints,
)

FIRST = {"tags": ["planning", "fs-hints-first"]}
NONE = {"tags": ["planning", "no-fs-hints"]}
UNTAGGED = {"tags": ["planning"]}

HINTS = "Review pending FamilySearch hints on ZZWK-EL1 before searching — an attached hint may already answer the question."


def _item(n, record_type, rationale="Search the county death register.", seq=None):
    return {"id": f"pli_{n:03d}", "sequence": n if seq is None else seq,
            "record_type": record_type, "rationale": rationale, "status": "planned"}


def _states(items, ark="ark:/61903/4:1:ZZWK-EL1", plan=True):
    q = {"id": "q_001", "status": "in_progress",
         "question": "When and where did Elijah Wilkins die?"}
    person = {"id": "I1", "names": [{"given": "Elijah", "surname": "Wilkins", "preferred": True}]}
    if ark:
        person["ark"] = ark
    tree = {"persons": [person]}
    research = {"project": {"subject_person_ids": ["I1"]}, "questions": [q], "plans": []}
    after = dict(research, plans=[{"id": "pl_001", "question_id": "q_001", "items": items}] if plan else [])
    return ({"research_json": research, "tree_gedcomx_json": tree},
            {"research_json": after})


def _check(items, test=FIRST, **kw):
    before, after = _states(items, **kw)
    check_hints(before, after, test)


# --- fs-hints-first ---------------------------------------------------------

def test_hints_item_at_one_naming_the_pid_passes():
    _check([_item(1, "fs_hints", HINTS), _item(2, "vital_record")])


def test_pid_match_ignores_case():
    _check([_item(1, "fs_hints", HINTS.replace("ZZWK-EL1", "zzwk-el1"))])


def test_hints_item_sharing_sequence_one_passes():
    _check([_item(1, "census"), _item(2, "fs_hints", HINTS, seq=1)])


def test_census_first_fails():
    with pytest.raises(AssertionError, match="pli_001 \\(census, sequence 1\\)"):
        _check([_item(1, "census"), _item(2, "vital_record")])


def test_hints_item_after_a_census_fails():
    with pytest.raises(AssertionError, match="fs_hints review at sequence 1"):
        _check([_item(1, "census"), _item(2, "fs_hints", HINTS)])


@pytest.mark.parametrize("seq", [2, 0])
def test_only_hints_item_off_sequence_one_fails(seq):
    with pytest.raises(AssertionError, match=f"sequence {seq}"):
        _check([_item(1, "fs_hints", HINTS, seq=seq)])


def test_wrong_pid_fails():
    with pytest.raises(AssertionError, match="names none of"):
        _check([_item(1, "fs_hints", HINTS.replace("ZZWK-EL1", "ZZKR-TH2"))])


def test_no_new_plan_fails():
    with pytest.raises(AssertionError, match="no new plan items"):
        _check([], plan=False)


# --- no-fs-hints ------------------------------------------------------------

def test_enumerative_plan_without_hints_passes():
    _check([_item(1, "census"), _item(2, "probate")], test=NONE)


def test_hints_item_on_enumerative_question_fails():
    with pytest.raises(AssertionError, match="no fs_hints item.*pli_001"):
        _check([_item(1, "fs_hints", HINTS), _item(2, "census")], test=NONE)


def test_negative_arm_with_no_new_plan_fails():
    with pytest.raises(AssertionError, match="no new plan items"):
        _check([], test=NONE, plan=False)


# --- drift and gating -------------------------------------------------------

@pytest.mark.parametrize("test", [FIRST, NONE])
def test_scenario_without_an_ark_fails(test):
    with pytest.raises(AssertionError, match="Scenario drift"):
        _check([_item(1, "census")], test=test, ark=None)


def test_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        _check([_item(1, "census")], test=UNTAGGED)
