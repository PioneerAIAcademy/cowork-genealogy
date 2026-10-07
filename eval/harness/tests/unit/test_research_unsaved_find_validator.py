"""Direct tests for `test_an_unsaved_find_is_named` (issue #2813 item 5, clause 4).

These exist because the validator is DORMANT in every eval suite. Its population —
a turn that saves, or fails to — lives in `record-extraction`'s suite, which no
scenario can join while Rule 10 blocks on `ut_record_extraction_g4k`'s
`expected_outcome: xfail` (issue #2173). The `research` suite cannot host it: all
ten of its tests are routing/boundary tests and the skill under test is a router
holding no writer tool, so nothing there ever writes.

Without these, the validator would be an unfalsifiable check that reads as
coverage — the failure mode CLAUDE.md § "A new lint must be proven to fail" is
about. They run free under `make harness-test`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

from test_research import (  # noqa: E402
    _unsaved_finds,
    test_an_unsaved_find_is_named as validator,
)

TAGGED = {"tags": ["unsaved-extraction"]}


def _state(log=None, assertions=None):
    return {"research_json": {"log": list(log or []), "assertions": list(assertions or [])}}


def _entry(eid="log_1", outcome="positive", query="1880 census Cornelius Driscoll"):
    return {"id": eid, "outcome": outcome, "query": query, "plan_item_id": "pi_1"}


def test_naming_the_record_passes():
    validator(
        TAGGED,
        _state(),
        _state(log=[_entry()]),
        "I found the 1880 census Cornelius Driscoll entry but could not save it.",
    )


def test_not_naming_the_record_fails():
    with pytest.raises(AssertionError, match="does not name"):
        validator(
            TAGGED,
            _state(),
            _state(log=[_entry()]),
            "An extraction did not finish. Shall I try again?",
        )


def test_an_orphan_already_in_before_state_skips():
    """The 11-scenario case: mid-research state, not an interruption."""
    pre = _state(log=[_entry()])
    with pytest.raises(pytest.skip.Exception):
        validator(TAGGED, pre, pre, "Here is the plan.")


def test_an_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        validator({"tags": []}, _state(), _state(log=[_entry()]), "anything")


def test_a_saved_find_skips():
    """Referenced by an assertion -> saved -> clause 4 does not apply."""
    with pytest.raises(pytest.skip.Exception):
        validator(
            TAGGED,
            _state(),
            _state(log=[_entry()], assertions=[{"id": "a_1", "log_entry_id": "log_1"}]),
            "Saved to Cornelius Driscoll: 1880 census.",
        )


@pytest.mark.parametrize("outcome", ["negative", "error"])
def test_a_nil_or_errored_search_is_not_an_unsaved_find(outcome):
    assert _unsaved_finds(_state(), _state(log=[_entry(outcome=outcome)])) == []


@pytest.mark.parametrize(
    "assertions",
    [
        [{"id": "a_1"}],                      # key absent
        [{"id": "a_1", "log_entry_id": None}],  # explicit null
    ],
)
def test_absent_and_null_log_entry_id_both_count_as_unreferenced(assertions):
    """`log_entry_id` is optional AND nullable, and both shapes must still leave
    the entry reported as unsaved.

    CHARACTERISATION, not a discriminating guard -- stated plainly because the
    earlier wording here claimed more than the test delivers. Dropping the
    truthiness filter on `log_entry_id` is an EQUIVALENT MUTANT: it only puts
    `None` into `referenced`, and since log-entry ids are non-null strings the
    verdict is identical, so this test passes either way. What it does pin is
    that neither shape raises and neither is mistaken for a saved find -- the
    `.get()` could be rewritten as `a["log_entry_id"]`, which would KeyError on
    the first case.
    """
    found = _unsaved_finds(_state(), _state(log=[_entry()], assertions=assertions))
    assert [e["id"] for e in found] == ["log_1"]


def test_the_section_is_log_not_research_log():
    """Guards the exact slip the plan made twice: `research_log` does not exist,
    and reading it returns [] forever -- a permanent silent skip."""
    wrong = {"research_json": {"research_log": [_entry()], "assertions": []}}
    assert _unsaved_finds(_state(), wrong) == []
    assert _unsaved_finds(_state(), _state(log=[_entry()])) != []


# The other direction: a guard fails two ways, and breaking the predicate only
# tests one of them. These are legitimate replies the check must NOT reject.
@pytest.mark.parametrize(
    "reply",
    [
        "I found the 1880 Census Cornelius Driscoll record but could not save it.",
        "Found: 1880 census cornelius driscoll — not yet attached to his profile.",
        "The search turned up a match (1880 census Cornelius Driscoll); the\n"
        "extraction step did not run, so nothing was saved for him yet.",
        "Unsaved: log_1 — the 1880 census hit for Cornelius.",
    ],
)
def test_legitimate_phrasings_are_accepted(reply):
    validator(TAGGED, _state(), _state(log=[_entry()]), reply)
