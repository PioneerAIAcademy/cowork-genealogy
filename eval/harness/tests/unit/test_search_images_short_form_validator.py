"""Proof cases for search-images' `test_short_form_row_reaches_return` (#4587).

`pyproject.toml` collects only `tests/`, so a validator's pass/fail set is
otherwise seen only inside a paid suite run. The check is a floor: it fails a
return that drops the 1821 Elizabeth's row and passes one that carries it, even
when the row is dismissed, as the incident's own return did. The incident text
below is that return's tail, from the #4567 feedback bundle.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_images import (  # noqa: E402
    test_short_form_row_reaches_return as check_short_form,
)

_TEST = {"skill": "search-images", "tags": ["short-form"], "delegation": "x"}

_INCIDENT_TAIL = """\
**Eliza entries (any father):** Only one. ELIZA, daughter, born 30 Jul 1822, christened 4 Aug 1822, father JOHN LEE and mother ELIZABETH, serial 05476-7 (009113284_00716). No Eliza Mary appears.

**Lee entries with father JAMES (all fathers named James Lee):**
- ELIZABETH, daughter, born 29 Sep 1821, christened 13 Oct 1822, mother MARIA, serial 06132-2 (009113284_00716). Closest to "Eliza", but the given name is Elizabeth.
- HENRY, son, born 13 Oct 1822, christened 10 Nov 1822, mother MARY ANN, serial 06345-8 (009113284_00717).
"""


def _run(tail: str) -> None:
    text = "Record set: St. Marylebone, image group 009113284.\n---\n" + tail
    check_short_form(
        tool_calls=[],
        text_response="",
        test=_TEST,
        agent_returns=[{"subagent_type": "search-images", "text": text}],
    )


def test_fails_when_the_elizabeth_row_is_missing():
    with pytest.raises(AssertionError, match="1821 Elizabeth"):
        _run("**Eliza entries:** Only one. ELIZA, born 30 Jul 1822, father JOHN LEE, 05476-7.\n")


def test_fails_on_a_bare_name_and_year():
    with pytest.raises(AssertionError, match="1821 Elizabeth"):
        _run("Candidates: Elizabeth (1821), daughter of James Lee.\n")


def test_fails_when_the_row_sits_only_above_the_rule():
    text = (
        "ELIZABETH, born 29 Sep 1821, mother MARIA, 06132-2\n---\n"
        "No Eliza with a father James was found.\n"
    )
    with pytest.raises(AssertionError):
        check_short_form(
            tool_calls=[], text_response="", test=_TEST,
            agent_returns=[{"subagent_type": "search-images", "text": text}],
        )


def test_passes_on_an_iso_date_and_the_mother():
    _run("Candidate for Eliza: Elizabeth Lee, b. 1821-09-29, parents James and Maria Lee (009113284_00716).\n")


def test_passes_on_a_month_first_date_and_the_serial():
    _run("| Elizabeth | September 29, 1821 | James Lee | 06132-2 |\n")


def test_passes_on_the_incident_return_by_design():
    _run(_INCIDENT_TAIL)


def test_skips_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        check_short_form(
            tool_calls=[], text_response="", test={"skill": "search-images", "tags": []},
            agent_returns=[],
        )
