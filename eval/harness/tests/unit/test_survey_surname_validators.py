"""Direct tests for the survey-surname validators.

Same reason as `test_search_wikipedia_validators.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

Issue #3414 moved the deliverable from a `surname-survey-*.md` written with
`Write` to the `notes` of one `survey_surname` log entry ending with the
pre-1880 hedge sentence. Each check below is proven in both directions: it
passes on a well-formed entry and fails on each planted defect, so a validator
that asserts nothing cannot pass this file.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect them here.
from test_survey_surname import (  # noqa: E402
    HEDGE,
    test_household_grouping_and_slave_schedule as check_grouping,
    test_negative_makes_no_write as check_negative,
    test_one_log_entry_appended as check_one_entry,
    test_table_has_rubric_columns as check_columns,
)

_TABLE_1850 = """# Dixon households, Virginia, 1850

## 1850 - United States Census, 1850

| Census Year | County | Head of Household | Other Dixon Members | Record ARK | Ruled Out |
|---|---|---|---|---|---|
| 1850 | Ohio | Edmund Dixon | Mary Dixon (b. 1805) | ark:/61903/1:1:XJQV-1850-A | |
| 1850 | Rockingham | William Dixon | | ark:/61903/1:1:XJQV-1850-C | |

## 1850 - United States Census (Slave Schedule), 1850

| Census Year | County | Slaveholder | Record ARK |
|---|---|---|---|
| 1850 | Ohio | Edmund Dixon | ark:/61903/1:1:XJQV-1850-SL |
"""
_NOTES = _TABLE_1850 + "\n" + HEDGE + "\n"

POSITIVE = {"type": "positive", "tags": ["survey", "household-grouping"]}
NEGATIVE = {"type": "negative", "tags": ["routing", "negative"]}
EMPTY = {"research_json": {"log": []}, "files": {}}


def _entry(n=1, **over):
    e = {
        "id": f"log_{n:03d}",
        "plan_item_id": None,
        "performed": "2026-10-15T00:00:00.000Z",
        "tool": "survey_surname",
        "query": {"surname": "Dixon", "place": "Virginia", "yearSpan": "1850-1850"},
        "outcome": "positive",
        "results_examined": 2,
        "external_site": None,
        "results_ref": None,
        "notes": _NOTES,
    }
    e.update(over)
    return e


def _page(n):
    return _entry(n, tool="record_search", notes="Surveyed Dixon in Virginia 1850 census.",
                  results_ref="results/log_page.json")


def _state(entries, files=None):
    return {"research_json": {"log": entries}, "files": files or {}}


def _run(fn, **kw):
    try:
        fn(**kw)
    except pytest.skip.Exception:
        return "skipped"
    return "passed"


def _expect_failure(fn, match, **kw):
    with pytest.raises(AssertionError, match=match):
        fn(**kw)


# --- test_one_log_entry_appended -----------------------------------------

def test_one_entry_passes_alongside_search_pages_and_staged_results():
    after = _state([_page(1), _entry(2)],
                   files={"results/log_page.json": "{}", "results/.staging/u1.json": "{}"})
    assert _run(check_one_entry, before_state=EMPTY, after_state=after, test=POSITIVE) == "passed"


def test_one_entry_tolerates_trailing_whitespace():
    after = _state([_entry(notes=_NOTES.rstrip() + "\n\n  ")])
    assert _run(check_one_entry, before_state=EMPTY, after_state=after, test=POSITIVE) == "passed"


def test_one_entry_skips_negative():
    assert _run(check_one_entry, before_state=EMPTY, after_state=EMPTY, test=NEGATIVE) == "skipped"


@pytest.mark.parametrize(
    "after, match",
    [
        (_state([_page(1)]), "exactly one new survey_surname"),
        (_state([_entry(1), _entry(2)]), "exactly one new survey_surname"),
        (_state([_entry(plan_item_id="pli_001")]), "plan_item_id"),
        (_state([_entry(query={"surname": "Dixon", "place": "Virginia"})]), "yearSpan"),
        (_state([_entry(query=None)]), "lacks"),
        (_state([_entry(results_ref="results/log_001.json")]), "staged ref"),
        (_state([_entry(outcome="negative")]), "outcome"),
        (_state([_entry(notes=None)]), "must carry the table"),
        (_state([_entry(notes=_TABLE_1850)]), "hedge sentence"),
        (_state([_entry(notes=_NOTES + "\nReview the table.\n")]), "hedge sentence"),
        (_state([_entry(notes=_TABLE_1850 + HEDGE.replace("are not stated", "are unstated"))]),
         "hedge sentence"),
        (_state([_entry()], files={"surname-survey-dixon-virginia.md": _NOTES}), "not a file"),
        (_state([_entry()], files={"results/surname-survey-dixon-virginia.md": _NOTES}),
         "not a file"),
    ],
    ids=["no-entry", "two-entries", "plan-item", "query-no-span", "query-null",
         "staged-ref", "negative-outcome", "null-notes", "no-hedge", "text-after-hedge",
         "paraphrased-hedge", "loose-file", "loose-file-in-results"],
)
def test_one_entry_fails(after, match):
    _expect_failure(check_one_entry, match, before_state=EMPTY, after_state=after, test=POSITIVE)


def test_one_entry_ignores_entries_already_in_the_log():
    before = _state([_entry(1)])
    after = _state([_entry(1), _entry(2)])
    assert _run(check_one_entry, before_state=before, after_state=after, test=POSITIVE) == "passed"


# --- test_negative_makes_no_write ----------------------------------------

def test_negative_passes_on_a_clean_hand_back():
    assert _run(check_negative, builtin_tool_calls=[], before_state=EMPTY,
                after_state=EMPTY, test=NEGATIVE) == "passed"


@pytest.mark.parametrize(
    "after, builtins, match",
    [
        (_state([_page(1)]), [], "log nothing"),
        (_state([_entry()]), [], "log nothing"),
        (_state([], files={"surname-survey-dixon.md": "x"}), [], "create no file"),
        (_state([], files={"results/surname-survey-dixon.md": "x"}), [], "create no file"),
        (EMPTY, [{"tool": "Write", "args": {"file_path": "x.md"}}], "Write"),
    ],
    ids=["search-page", "table-entry", "file", "file-in-results", "write-call"],
)
def test_negative_fails(after, builtins, match):
    _expect_failure(check_negative, match, builtin_tool_calls=builtins,
                    before_state=EMPTY, after_state=after, test=NEGATIVE)


# --- table readers: notes, never files or the reply ----------------------

def test_table_checks_read_the_entry_notes():
    after = _state([_page(1), _entry(2)])
    assert _run(check_grouping, before_state=EMPTY, after_state=after, test=POSITIVE) == "passed"
    assert _run(check_columns, before_state=EMPTY, after_state=after, test=POSITIVE) == "passed"


def test_table_checks_ignore_a_loose_file():
    """The old deliverable must not satisfy the new readers."""
    after = _state([], files={"surname-survey-dixon-virginia.md": _NOTES})
    _expect_failure(check_grouping, "no single survey_surname", before_state=EMPTY,
                    after_state=after, test=POSITIVE)
    _expect_failure(check_columns, "no single survey_surname", before_state=EMPTY,
                    after_state=after, test=POSITIVE)


def test_grouping_fails_when_shared_ark_split():
    split = _NOTES.replace(
        "| Mary Dixon (b. 1805) |",
        "| |",
    ).replace(
        "| 1850 | Rockingham |",
        "| 1850 | Ohio | Mary Dixon | | ark:/61903/1:1:XJQV-1850-B | |\n| 1850 | Rockingham |",
    )
    _expect_failure(check_grouping, "one household row", before_state=EMPTY,
                    after_state=_state([_entry(notes=split)]), test=POSITIVE)


def test_columns_fail_without_ruled_out():
    bad = _NOTES.replace(" Ruled Out |", "").replace("|---|---|---|---|---|---|", "|---|---|---|---|---|")
    _expect_failure(check_columns, "lacks", before_state=EMPTY,
                    after_state=_state([_entry(notes=bad)]), test=POSITIVE)
