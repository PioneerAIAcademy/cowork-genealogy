"""Direct tests for the timeline `census-from-wiki` validator (issue #2261).

Same reason as the sibling `test_convert_dates_validators.py`: `pyproject.toml`
sets `testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and this validator's real pass/fail set would otherwise
appear only inside a paid per-skill run. These exist to satisfy CLAUDE.md's
"a new lint must be proven to fail" rule — the check is exercised against a
state that must PASS and each state that must FIRE, so it is known to work
before it gates anything.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as the sibling validator tests.
from test_timeline import (  # noqa: E402
    test_census_years_read_from_wiki as check_census_from_wiki,
)

# A faithful-enough slice of the England_Census page: it lists the English
# decennial years and does NOT list the US-only years 1860/1870.
ENGLAND_PAGE = (
    "# England Census\n"
    "1801 1811 1821 1831 1841 1851 1861 1871 1881 1891 1901 1911 1921 1931\n"
    "The first census listing people by name was taken in 1841."
)

BEFORE = {"research_json": {"timelines": []}}


def _wiki_call(url=None, content=ENGLAND_PAGE):
    url = url or "https://www.familysearch.org/en/wiki/England_Census"
    return {
        "tool": "mcp__genealogy__wiki_read",
        "args": {"url": url},
        "response": {"url": url, "content": content},
    }


def _after(gaps):
    return {
        "research_json": {
            "assertions": [],
            "timelines": [{"id": "tl_1", "events": [], "gaps": gaps}],
        }
    }


TAGGED = {"tags": ["census-from-wiki"]}

# England census gaps: 1841, 1861, 1871 undocumented (1851 was documented).
ENGLAND_GAPS = [
    {"start": "1841", "end": "1841", "expected_events": ["England census 1841"], "severity": "high"},
    {"start": "1861", "end": "1861", "expected_events": ["England census 1861"], "severity": "high"},
    {"start": "1871", "end": "1871", "expected_events": ["England census 1871"], "severity": "medium"},
]


def test_passes_on_wiki_derived_non_us_years():
    """The intended-correct state: a wiki_read for England_Census, and every
    expected census year (1841/1861/1871) is on the page and outside the US
    set. Must NOT raise."""
    check_census_from_wiki(BEFORE, _after(ENGLAND_GAPS), [_wiki_call()], TAGGED)


def test_passes_on_underscore_joined_census_year_tokens():
    """Regression for the second paid run of #2261: the skill named the gaps
    `census_1841` / `census_1861` / `census_1871` (year joined to the record type
    by an underscore) rather than "1841 census". The underscore is a `\\w`
    character, so a `\\b`-anchored year regex found no boundary before the digits
    and reported zero census years — failing a correct timeline. The year regex
    must extract the year regardless of an adjacent letter/underscore. Must NOT
    raise."""
    underscore_gaps = [
        {"start": "~1838", "end": "1851",
         "expected_events": ["baptism", "census_1841"], "severity": "high"},
        {"start": "1851", "end": "1859",
         "expected_events": ["occupation_records"], "severity": "medium"},
        {"start": "1859", "end": "1874",
         "expected_events": ["census_1861", "census_1871"], "severity": "high"},
        {"start": "1874", "end": "1874",
         "expected_events": ["burial"], "severity": "low"},
    ]
    check_census_from_wiki(BEFORE, _after(underscore_gaps), [_wiki_call()], TAGGED)


def test_fires_when_no_census_page_fetched():
    """No wiki_read to a *_Census page → assertion (1) fires."""
    with pytest.raises(AssertionError):
        check_census_from_wiki(BEFORE, _after(ENGLAND_GAPS), [], TAGGED)


def test_fires_when_only_us_years_expected():
    """The exact defect the issue targets: the timeline listed US federal years
    (1860/1870) for an England life. They are absent from the England page and
    all fall in the US set → assertion (2) fires."""
    us_gaps = [
        {"start": "1860", "end": "1860", "expected_events": ["census 1860"], "severity": "high"},
        {"start": "1870", "end": "1870", "expected_events": ["census 1870"], "severity": "high"},
    ]
    with pytest.raises(AssertionError):
        check_census_from_wiki(BEFORE, _after(us_gaps), [_wiki_call()], TAGGED)


def test_fires_when_expected_year_absent_from_page():
    """A census year the fetched page does not list (1861 with a page that only
    goes to 1851) → assertion (2) 'absent from page' fires."""
    short_page = "# England Census\n1801 1811 1821 1831 1841 1851\n"
    with pytest.raises(AssertionError):
        check_census_from_wiki(
            BEFORE, _after(ENGLAND_GAPS), [_wiki_call(content=short_page)], TAGGED
        )


def test_skips_when_not_tagged():
    """Untagged tests are not gated by this check."""
    with pytest.raises(pytest.skip.Exception):
        check_census_from_wiki(BEFORE, _after(ENGLAND_GAPS), [_wiki_call()], {"tags": ["timeline"]})
