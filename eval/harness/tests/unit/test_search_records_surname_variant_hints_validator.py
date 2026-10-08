"""Direct tests for the search-records surnameVariantHints-followed validator.

Same reason as test_search_records_jurisdiction_hints_validator.py: pyproject.toml
sets testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears only
inside a paid per-skill run.

What it guards: issue #3054 -- when a record_search response carries
surnameVariantHints (a search that did not find its subject, on a -datter/-dotter
patronymic), a later record_search call must put one of the hinted abbreviated
forms in a surname field.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_surname_variant_hints_followed as check,
)


TAGGED = {"tags": ["search", "marriage", "surname-variant-hints-followed"]}
UNTAGGED = {"tags": ["search", "marriage"]}


def rs_call(args, response=None):
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": response or {}}


def hint_response(field="surname", searched="Halsteinsdatter"):
    stem = searched[: -len("datter")]
    return {
        "totalMatches": 0,
        "surnameVariantHints": {
            "fields": [
                {
                    "field": field,
                    "searched": searched,
                    "variants": [stem + "dr", stem + "dtr", stem + "d"],
                }
            ],
            "note": "...",
        },
        "results": [],
    }


FIRST_NIL = rs_call(
    {"givenName": "Unna", "surname": "Halsteinsdatter", "collectionId": "1468080"},
    hint_response(),
)


def test_no_calls_skips():
    with pytest.raises(pytest.skip.Exception):
        check([], TAGGED)


def test_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        check([FIRST_NIL], UNTAGGED)


def test_no_hint_returned_skips():
    calls = [rs_call({"surname": "Halsteinsdatter"}, {"totalMatches": 0, "results": []})]
    with pytest.raises(pytest.skip.Exception):
        check(calls, TAGGED)


# --- must FAIL -------------------------------------------------------------


def test_the_real_2026_07_21_miss_fails():
    """Given name varied, surname never: the production miss the test encodes."""
    calls = [FIRST_NIL] + [
        rs_call({"givenName": g, "surname": "Halsteinsdatter", "collectionId": "1468080"})
        for g in ("Urna", "Udna", "Una", "Anna")
    ] + [rs_call({"givenName": "Urna", "collectionId": "1468080", "recordCountry": "Norway"})]
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


def test_variant_only_in_surname_alt_fails():
    """The note says SAME field, not surnameAlt -- an alternate name is a union
    paired with its own given name, and the mock does not answer it."""
    calls = [
        FIRST_NIL,
        rs_call({"givenName": "Urna", "surname": "Halsteinsdatter", "surnameAlt": "Halsteinsdr"}),
    ]
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


def test_variant_only_in_given_name_fails():
    calls = [FIRST_NIL, rs_call({"givenName": "Halsteinsdr", "surname": "Halsteinsdatter"})]
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


def test_variant_tried_only_before_the_hint_does_not_count():
    """Ordering: a variant sent before any hint existed is not following it."""
    calls = [
        rs_call({"surname": "Halsteinsdr", "givenName": "Inna"}, {"totalMatches": 0, "results": []}),
        FIRST_NIL,
        rs_call({"surname": "Halsteinsdatter", "givenName": "Urna"}),
    ]
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


# --- must PASS -------------------------------------------------------------


def test_abbreviated_surname_on_the_next_call_passes():
    check([FIRST_NIL, rs_call({"givenName": "Urna", "surname": "Halsteinsdr"})], TAGGED)


def test_any_listed_form_and_any_casing_passes():
    check([FIRST_NIL, rs_call({"givenName": "Urna", "surname": " HALSTEINSDTR "})], TAGGED)


def test_role_swap_passes():
    """Hint on spouseSurname (the groom as principal), follow-up searches the bride
    as principal -- a legitimate way to act on it."""
    calls = [
        rs_call(
            {"surname": "Monsen", "spouseSurname": "Halsteinsdatter"},
            hint_response(field="spouseSurname"),
        ),
        rs_call({"givenName": "Urna", "surname": "Halsteinsdr"}),
    ]
    check(calls, TAGGED)


def test_same_field_spouse_shape_passes():
    calls = [
        rs_call(
            {"surname": "Monsen", "spouseSurname": "Halsteinsdatter"},
            hint_response(field="spouseSurname"),
        ),
        rs_call({"surname": "Monsen", "spouseGivenName": "Urna", "spouseSurname": "Halsteinsdr"}),
    ]
    check(calls, TAGGED)


def test_late_follow_up_after_a_parallel_pair_passes():
    """Two calls issued together before the hint was read, then the abbreviation
    on call 3. A 'next two calls' window would false-fail this."""
    calls = [
        FIRST_NIL,
        rs_call({"givenName": "Urna", "surname": "Halsteinsdatter"}),
        rs_call({"givenName": "Udna", "surname": "Halsteinsdatter"}),
        rs_call({"givenName": "Urna", "surname": "Halsteinsdr"}),
    ]
    check(calls, TAGGED)


def test_bare_tool_name_is_recognised():
    calls = [
        dict(FIRST_NIL, tool="record_search"),
        {"tool": "record_search", "args": {"surname": "Halsteinsdr"}, "response": {}},
    ]
    check(calls, TAGGED)
