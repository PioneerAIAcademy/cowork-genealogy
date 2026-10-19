"""Unit tests for harness.dates — the shared 4-digit-year extractor.

`harness/dates.py` was the only module under `harness/` with no direct test
(PR #2498 review). The two properties no other test exercised are the ones a
migration silently breaks: the `\b` word-boundary (a lookaround caller narrows
if it moves here) and the range bounds. `e2e/author._birth_year`'s
`standard_date`-before-`date` precedence and its `date` fallback are covered
here too — issue #2330 names the precedence as an invariant to preserve, yet
inverting the field order and dropping the fallback both survived the full
suite before this file existed.
"""

from __future__ import annotations

import pytest

from harness.dates import EMBEDDED_YEAR_RE, extract_year
from e2e.author import _birth_year


# --- range bounds: the union range is 1000-2099 -----------------------------

@pytest.mark.parametrize(
    "text, expected",
    [
        ("born 1000", "1000"),   # lower bound in
        ("born 1999", "1999"),
        ("born 2000", "2000"),
        ("born 2099", "2099"),   # upper bound in
    ],
)
def test_years_in_range_match(text, expected):
    assert extract_year(text) == expected


@pytest.mark.parametrize("text", ["born 0999", "born 2100", "born 999", "born 21000"])
def test_years_out_of_range_do_not_match(text):
    assert extract_year(text) is None


# --- word-boundary semantics: `\b`, not a lookaround ------------------------

@pytest.mark.parametrize("text", ["12May1879", "28Sep1817", "the 1850s", "1900s"])
def test_year_abutting_a_word_char_does_not_match(text):
    """`\\b` cannot match a year touching a letter or trailing digit-group.
    A lookaround copy `(?<!\\d)...(?!\\d)` (e.g. test_timeline._YEAR_RE) WOULD
    match these — the property that narrows if such a caller migrates here."""
    assert extract_year(text) is None


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Abt 1850", "1850"),
        ("1850", "1850"),
        ("~1850", "1850"),
        ("1850-03-14", "1850"),
        ("1850-03", "1850"),
        ("est. 1902, Ohio", "1902"),
    ],
)
def test_year_delimited_by_non_word_chars_matches(text, expected):
    assert extract_year(text) == expected


def test_first_year_wins():
    assert extract_year("married 1901, born 1875") == "1901"


@pytest.mark.parametrize("text", [None, ""])
def test_falsy_input_returns_none(text):
    assert extract_year(text) is None


def test_no_year_returns_none():
    assert extract_year("no digits here") is None


def test_reexport_is_identity_equal():
    """validators_lib re-exports the canonical objects, not copies — so
    `from validators_lib import extract_year` callers get this exact code."""
    from validators import validators_lib

    assert validators_lib.extract_year is extract_year
    assert validators_lib.EMBEDDED_YEAR_RE is EMBEDDED_YEAR_RE


# --- author._birth_year: precedence, fallback, int coercion -----------------

def _person_with_birth(**fact_fields):
    return {"facts": [{"type": "Birth", **fact_fields}]}


def test_birth_year_prefers_standard_date_over_date():
    """Issue #2330 invariant: `standard_date` is read before `date`. When they
    disagree, the standard_date year wins."""
    person = _person_with_birth(standard_date="1850", date="1860")
    assert _birth_year(person) == 1850


def test_birth_year_falls_back_to_date():
    person = _person_with_birth(standard_date=None, date="1872")
    assert _birth_year(person) == 1872


def test_birth_year_returns_int_not_str():
    year = _birth_year(_person_with_birth(standard_date="1850"))
    assert year == 1850
    assert isinstance(year, int)


def test_birth_year_none_when_no_birth_fact():
    person = {"facts": [{"type": "Residence", "date": "1880"}]}
    assert _birth_year(person) is None


def test_birth_year_none_when_no_year_on_birth_fact():
    assert _birth_year(_person_with_birth(date="unknown")) is None


@pytest.mark.parametrize("fact_type", ["Birth", "Christening", "Baptism"])
def test_birth_year_reads_all_birth_fact_types(fact_type):
    person = {"facts": [{"type": fact_type, "standard_date": "1855"}]}
    assert _birth_year(person) == 1855
