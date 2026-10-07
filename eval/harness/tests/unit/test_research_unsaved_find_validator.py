"""Direct tests for `test_an_unsaved_find_is_named` (issue #2813 item 5, clause 4).

The validator lives in `validators/test_universal.py`, not in a per-skill file:
`validator_runner.py:174-184` imports only `test_universal.py` and
`test_<skill>.py`, so a validator in `test_research.py` could run in the
`research` suite and nowhere else.

It is DORMANT: no eval scenario carries the `unsaved-extraction` tag. The
population is a turn that extracts, and no turn in the `research` suite makes a
writer call. A scenario under `eval/tests/unit/record-extraction/` would arm
blocking Rule 10 (`ut_record_extraction_g4k` still carries `expected_outcome:
xfail`) and Rule 6, on a suite that has never had a zero fail run.

Without these direct cases the validator would be an unfalsifiable check that
reads as coverage, the failure mode CLAUDE.md § "A new lint must be proven to
fail" is about. They run free under `make harness-test`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

from test_universal import (  # noqa: E402
    _unsaved_finds,
    test_an_unsaved_find_is_named as validator,
)

TAGGED = {"tags": ["unsaved-extraction"]}


def _state(log=None, assertions=None):
    return {"research_json": {"log": list(log or []), "assertions": list(assertions or [])}}


# SCHEMA-SHAPED. `query` is a required OBJECT (research.schema.json
# $defs.log_entry) and every one of the 330 committed log entries is a dict. An
# earlier version of this file used a string here, which let the validator pass
# its own tests while being unable to match anything in production.
def _entry(eid="log_1", outcome="positive", query=None):
    return {
        "id": eid,
        "outcome": outcome,
        "query": query if query is not None else {
            "surname": "Driscoll",
            "given": "Cornelius",
            "collection": "1880 Census",
        },
        "plan_item_id": "pi_1",
    }


def test_naming_the_record_passes():
    validator(
        TAGGED,
        _state(),
        _state(log=[_entry()]),
        "I found the 1880 census Cornelius Driscoll entry but could not save it.",
    )


def test_not_naming_the_record_fails():
    with pytest.raises(AssertionError, match="AS UNSAVED"):
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
        "Found: 1880 census cornelius driscoll, not yet attached to his profile.",
        "The search turned up a match for Driscoll; the extraction step did not\n"
        "run, so nothing was saved for him yet.",
        "Unsaved: log_1 - the 1880 census hit for Cornelius.",
        "Found an 1880 census hit for Cornelius Driscoll; not attached yet.",
    ],
)
def test_legitimate_phrasings_are_accepted(reply):
    validator(TAGGED, _state(), _state(log=[_entry()]), reply)


def test_a_dict_query_is_matched_on_its_person_values_not_its_repr():
    """The regression that shipped once: str(dict) can never substring-match a
    natural reply, so the validator silently rejected every legitimate one."""
    entry = _entry(query={"surname": "Brady", "given": "Cornelius",
                          "collection": "Catholic Parish Registers, King's County, Ireland"})
    # Names the person, paraphrases the record -- the normal, correct shape.
    validator(TAGGED, _state(), _state(log=[entry]),
              "I found an 1880 census record for Cornelius Brady but the extraction "
              "did not finish, so nothing was saved to his profile yet.")
    # Names neither.
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(), _state(log=[entry]),
                  "An extraction did not finish. Shall I try again?")


def test_drives_a_real_committed_fixture_entry():
    """Guards against the fixture and production diverging again: the query here
    is read out of a committed scenario, not written by hand."""
    import json as _json
    # Walk up rather than index a fixed depth: parents[3] lands on eval/, not the
    # repo root, and a hardcoded index silently finds nothing if the tree moves.
    here = Path(__file__).resolve()
    root = next(
        (q for q in here.parents if (q / "eval/fixtures/scenarios").is_dir()), None
    )
    assert root is not None, "could not locate eval/fixtures/scenarios from this file"
    entry = None
    for f in sorted((root / "eval/fixtures/scenarios").glob("*/research.json")):
        for e in (_json.loads(f.read_text(encoding="utf-8")).get("log") or []):
            q = e.get("query")
            if isinstance(q, dict) and q.get("surname"):
                entry = dict(e, outcome="positive")
                break
        if entry:
            break
    assert entry is not None, "no committed log entry with a surname -- fixture drift"
    surname = entry["query"]["surname"]
    validator(TAGGED, _state(), _state(log=[entry]),
              f"Found a record for {surname}; it was not saved.")
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(), _state(log=[entry]), "An extraction did not finish.")


def test_a_reply_that_claims_it_was_saved_fails():
    """Clause 4 is "named AS UNSAVED". Mentioning the record while claiming it was
    saved is the overclaim search-records/SKILL.md:684 forbids, and it used to pass."""
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(), _state(log=[_entry()]),
                  "Saved to Cornelius Driscoll: 1880 census household. All done!")


def test_a_different_saved_records_id_does_not_exonerate_this_one():
    """`"log_1" in "log_10"` used to pass. Real ids run log_001..log_010+."""
    with pytest.raises(AssertionError):
        # The reply DOES carry an unsaved marker, so the only thing that can make
        # this pass is the id match. Without that isolation the test passed under
        # both implementations and discriminated nothing.
        validator(TAGGED, _state(), _state(log=[_entry(eid="log_1", query={})]),
                  "Record log_10 was not saved.")


# --- review round 2: overclaims that used to pass -----------------------------
@pytest.mark.parametrize(
    "reply",
    [
        # marker in a DIFFERENT sentence, about a different thing
        "Saved to Cornelius Driscoll: 1880 census. I have not yet looked for his wife.",
        # routine wording from the "candidates, not verdicts" rule
        "Saved to Cornelius Driscoll: 1880 census. Want me to look at another candidate?",
        "Saved to Cornelius Driscoll: 1880 census. Nothing pending.",
        "Saved to Cornelius Driscoll: 1880 census. The save never failed to complete.",
    ],
)
def test_a_marker_in_another_clause_does_not_excuse_an_overclaim(reply):
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(), _state(log=[_entry()]), reply)


def test_two_unsaved_finds_need_two_namings():
    """One marker anywhere used to satisfy both entries."""
    a = _entry(eid="log_1", query={"surname": "Driscoll", "given": "Cornelius"})
    b = _entry(eid="log_2", query={"surname": "Flynn", "given": "Mary"})
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(), _state(log=[a, b]),
                  "I could not save the Cornelius Driscoll find. Mary Flynn turned up too.")
    validator(TAGGED, _state(), _state(log=[a, b]),
              "I could not save the Cornelius Driscoll find. "
              "The Mary Flynn record was not saved either.")


@pytest.mark.parametrize(
    "needle,reply",
    [("Ward", "We are working toward the 1880 census."),
     ("Ann", "I planned the next step."),
     ("Al", "Shall I continue?")],
)
def test_a_name_is_not_matched_as_a_substring(needle, reply):
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(),
                  _state(log=[_entry(query={"surname": needle})]),
                  reply + " It was not saved.")


def test_a_different_person_does_not_name_this_one():
    with pytest.raises(AssertionError):
        validator(TAGGED, _state(),
                  _state(log=[_entry(query={"surname": "Driscoll", "given": "Mary"})]),
                  "Saved to Cornelius Driscoll: 1880 census; nothing else was saved.")


@pytest.mark.parametrize(
    "query,reply",
    [({"keywords": "Driscoll homestead claim"},
      "The Driscoll homestead claim hit was not saved."),
     ({"recordId": "ABCD-123"}, "Record ABCD-123 could not be saved.")],
)
def test_a_query_with_no_person_key_can_still_be_named(query, reply):
    """12 of 263 positive/partial fixture entries name no person. Before this they
    could be satisfied only by the internal log id."""
    validator(TAGGED, _state(), _state(log=[_entry(query=query)]), reply)


@pytest.mark.parametrize(
    "surname,reply",
    [("Ó Briain", "The O Briain record was not saved."),
     ("Mc Carthy", "The McCarthy record was not saved.")],
)
def test_names_are_matched_after_folding(surname, reply):
    validator(TAGGED, _state(), _state(log=[_entry(query={"surname": surname})]), reply)


def test_the_validator_loads_the_way_the_runner_loads_it():
    """Regression: validator_runner._import_validator_module puts the validators
    dir on sys.path only for the duration of the import and removes it in a
    `finally`. A deferred `from validators_lib import ...` inside a validator
    therefore raises ModuleNotFoundError at CALL time, not import time, which is
    invisible to a direct pytest run that already has the dir on sys.path.

    This shipped once and failed ut_research_016 in a paid run.
    """
    import sys
    from harness.validator_runner import _import_validator_module

    root = next(
        q for q in Path(__file__).resolve().parents
        if (q / "eval/harness/validators").is_dir()
    )
    vdir = root / "eval/harness/validators"
    saved = [p for p in sys.path if p == str(vdir)]
    for p in saved:
        sys.path.remove(p)
    # sys.modules too, or the deferred import is served from cache and this test
    # passes WITH the bug in place. It did, on the first attempt.
    cached = {k: sys.modules.pop(k) for k in ("validators_lib",) if k in sys.modules}
    try:
        mod = _import_validator_module(vdir / "test_universal.py", "probe_universal")
        assert str(vdir) not in sys.path, "runner left the dir on sys.path"
        with pytest.raises(pytest.skip.Exception):
            mod.test_an_unsaved_find_is_named(
                {"tags": []}, _state(), _state(log=[_entry()]), "x"
            )
        mod.test_an_unsaved_find_is_named(
            TAGGED, _state(), _state(log=[_entry()]),
            "The Cornelius Driscoll find was not saved.",
        )
    finally:
        sys.path.extend(saved)
        sys.modules.update(cached)
