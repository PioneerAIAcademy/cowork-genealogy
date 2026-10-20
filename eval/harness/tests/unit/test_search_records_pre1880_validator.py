"""Direct tests for the search-records pre-1880 census household validator.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards now (issue #3054): `research_log_append` refuses a note that
states a pre-1880 census household's structure as fact, and that rule lives
only in the tool (its tests: `tests/tools/pre1880-census-hedge.test.ts`; that
the eval write path applies it: `test_mock_mcp.py`). The validator checks the
part the model can still get wrong, the recovery: every refused search is
logged afterwards.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_pre1880_census_structure_marked_inferred as check,
)

TAGGED = {"tags": ["search", "census", "pre-1880-census-household"]}
UNTAGGED = {"tags": ["search", "census"]}

# What the tool sends for REAL_REFUSED below, logged against its staged 1860 search.
REFUSAL = {
    "ok": False,
    "errors": [
        "This note describes a pre-1880 US census household (the staged search's 1860 US "
        "census rows) but states the family structure as fact (\"household contains Henry "
        "and Margaret Ackerman\"). 1850/1860/1870 censuses have NO relationship-to-head "
        "column, so the structure is an inference from surname, ages and listing order -- "
        "as are any ParentChild/Couple edges on the record, which the indexer inferred the "
        "same way. Say so in the note, e.g. \"...in one dwelling; family structure inferred "
        "from surname, ages and order, not stated.\" Then re-send."
    ],
}
OK = {"ok": True, "logId": "log_002"}


def append(args, response):
    return {"tool": "mcp__genealogy__research_log_append", "args": args, "response": response}


def op(ref="results/.staging/a.json", notes="note", **extra):
    return {"tool": "record_search", "outcome": "positive", "stagedResultsRef": ref, "notes": notes, **extra}


# ut_search_records_027 (scratch 2026-10-12_11-55-22, run 3), verbatim: refused,
# then re-sent hedged with the same staged handle.
REAL_REFUSED = op(
    "results/.staging/f0316543.json",
    "1 result: George Ackerman, Bucks County, PA — household contains Henry and Margaret "
    "Ackerman only; no Catherine indexed.",
)
REAL_RELOGGED = op(
    "results/.staging/f0316543.json",
    "1 result: George Ackerman in one dwelling with Henry and Margaret Ackerman in Bucks "
    "County, PA; family structure inferred from surname, ages and listing order, not stated.",
)


def test_untagged_skips():
    with pytest.raises(pytest.skip.Exception):
        check([append(REAL_REFUSED, REFUSAL)], UNTAGGED)


def test_no_census_refusal_skips():
    with pytest.raises(pytest.skip.Exception):
        check([append(REAL_RELOGGED, OK)], TAGGED)


def test_a_refusal_for_another_reason_is_not_this_check():
    other = {"ok": False, "errors": ["stagedResultsRef does not exist"]}
    with pytest.raises(pytest.skip.Exception):
        check([append(op(), other)], TAGGED)


def test_the_real_027_recovery_passes():
    check([append(REAL_REFUSED, REFUSAL), append(REAL_RELOGGED, OK)], TAGGED)


def test_a_refused_search_never_relogged_fails():
    with pytest.raises(AssertionError, match="f0316543"):
        check([append(REAL_REFUSED, REFUSAL)], TAGGED)


def test_a_relog_that_also_fails_does_not_count():
    with pytest.raises(AssertionError):
        check([append(REAL_REFUSED, REFUSAL), append(REAL_REFUSED, REFUSAL)], TAGGED)


def test_a_log_before_the_refusal_does_not_count():
    with pytest.raises(AssertionError):
        check([append(REAL_RELOGGED, OK), append(REAL_REFUSED, REFUSAL)], TAGGED)


def test_every_op_of_a_refused_batch_must_be_relogged():
    """A batch is all-or-nothing, so the refusal dropped both ops."""
    batch = {"ops": [op("results/.staging/a.json"), op("results/.staging/b.json")]}
    calls = [append(batch, REFUSAL), append(op("results/.staging/a.json"), OK)]
    with pytest.raises(AssertionError, match="b.json"):
        check(calls, TAGGED)
    calls.append(append({"ops": [op("results/.staging/b.json")]}, {"ok": True, "results": []}))
    check(calls, TAGGED)


def test_an_unstaged_op_matches_on_tool_and_query():
    q = {"surname": "Flynn", "residencePlace": "Pennsylvania"}
    refused = {"tool": "record_search", "outcome": "positive", "query": q, "notes": "x"}
    check([append(refused, REFUSAL), append(dict(refused, notes="hedged"), OK)], TAGGED)
    with pytest.raises(AssertionError):
        check([append(refused, REFUSAL), append(dict(refused, query={"surname": "Flinn"}), OK)], TAGGED)


def test_a_stringified_ops_list_is_read():
    import json

    batch = {"ops": json.dumps([op("results/.staging/a.json")])}
    check([append(batch, REFUSAL), append(op("results/.staging/a.json"), OK)], TAGGED)
