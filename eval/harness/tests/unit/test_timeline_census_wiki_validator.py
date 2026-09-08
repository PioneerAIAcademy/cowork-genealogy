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
    test_us_1890_never_expected as check_us_1890_backstop,
)

# A faithful-enough slice of the England_Census page: it lists the English
# decennial years and does NOT list the US-only years 1860/1870.
ENGLAND_PAGE = (
    "# England Census\n"
    "1801 1811 1821 1831 1841 1851 1861 1871 1881 1891 1901 1911 1921 1931\n"
    "The first census listing people by name was taken in 1841."
)

US_URL = "https://www.familysearch.org/en/wiki/United_States_Census"
# The real US page lists 1890 as an available collection even though the
# returns were destroyed (ADR-0012) — which is exactly why the 1890 backstop
# reads expected_events, not the page.
US_PAGE = (
    "# United States Census\n"
    "1790 1800 1810 1820 1830 1840 1850 1860 1870 1880 1890 1900 1910 1920 1930 1940\n"
)
IRELAND_URL = "https://www.familysearch.org/en/wiki/Ireland_Census"
# Ireland enumerated 1821-1911; it never had a 1921 census (that year is on the
# England page), which the contamination test relies on.
IRELAND_PAGE = "# Ireland Census\n1821 1831 1841 1851 1861 1871 1881 1891 1901 1911\n"

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


def test_passes_on_mixed_marriage_and_census_gap():
    """Finding #2: a gap naming both a marriage and a census must not count the
    marriage year as a census year. `["marriage 1859", "census 1861"]` on a
    correct England timeline must NOT raise — the old joined-blob extraction
    raised a false 'absent from page' on 1859."""
    mixed = [{"start": "1859", "end": "1861",
              "expected_events": ["marriage 1859", "census 1861"], "severity": "high"}]
    check_census_from_wiki(BEFORE, _after(mixed), [_wiki_call()], TAGGED)


def test_passes_on_single_entry_with_bounding_years():
    """Finding A: a single census entry that also mentions bounding years must
    count only the census year. `"1861 England census enumeration (married 1859,
    died 1874)"` on a correct England timeline must NOT raise — per-entry
    extraction that pulled every year flagged 1859/1874 as absent census years."""
    gap = [{"start": "1859", "end": "1874",
            "expected_events": ["1861 England census enumeration (married 1859, died 1874)"],
            "severity": "high"}]
    check_census_from_wiki(BEFORE, _after(gap), [_wiki_call()], TAGGED)


def test_fires_on_cross_country_page_contamination():
    """Finding #3: a year attributed to Ireland that is absent from the Ireland
    page but present on another fetched page (England's 1921) must be caught.
    The old concatenated-page check passed this — 1921 is on the England page
    and is non-US — while the per-jurisdiction check fires."""
    gaps = [{"start": "1911", "end": "1921",
             "expected_events": ["Ireland census 1921"], "severity": "high"}]
    calls = [_wiki_call(IRELAND_URL, IRELAND_PAGE), _wiki_call()]  # Ireland + England
    with pytest.raises(AssertionError, match="1921"):
        check_census_from_wiki(BEFORE, _after(gaps), calls, TAGGED)


def test_us_1890_backstop_fires_and_is_scoped():
    """Finding #7: an expected US 1890 census event trips the deterministic
    backstop, and the guard is scoped to the US-1890 fact — it does NOT fire on
    a non-US 1890 census even when US census evidence is present in the run."""
    positive = {"type": "positive"}
    # Unattributed 1890 in a run where a US census page was fetched -> fires.
    us_gap = [{"start": "1885", "end": "1895",
               "expected_events": ["1890 census"], "severity": "high"}]
    with pytest.raises(AssertionError, match="1890"):
        check_us_1890_backstop(BEFORE, _after(us_gap), [_wiki_call(US_URL, US_PAGE)], positive)
    # A 1890 census named for a non-US jurisdiction, with the US page also
    # fetched, must NOT fire the US backstop (scope check).
    other_gap = [{"start": "1885", "end": "1895",
                  "expected_events": ["Ireland census 1890"], "severity": "high"}]
    check_us_1890_backstop(
        BEFORE, _after(other_gap),
        [_wiki_call(US_URL, US_PAGE), _wiki_call(IRELAND_URL, IRELAND_PAGE)], positive)


def test_us_1890_backstop_fires_when_no_census_page_fetched():
    """Finding B: the schedule-revert regression — the model skips the census
    lookup and re-emits an unattributed `1890_census` from memory. With no
    fetched census page the guard must still fire (an unattributed 1890 census
    with no fetched evidence is never evidence-backed). Before the fix the guard
    was silent here, so the two failures arrived together and neither was caught."""
    positive = {"type": "positive"}
    gap = [{"start": "1885", "end": "1895",
            "expected_events": ["1890_census"], "severity": "high"}]
    with pytest.raises(AssertionError, match="1890"):
        check_us_1890_backstop(BEFORE, _after(gap), [], positive)  # no wiki_read at all


def test_fires_when_no_census_page_fetched():
    """census_reads arm: no wiki_read to a *_Census page fires it. `match=` pins
    THIS assertion — without it the `absent` arm fires first and would mask a
    neutered census_reads check (finding C)."""
    with pytest.raises(AssertionError, match="must call wiki_read"):
        check_census_from_wiki(BEFORE, _after(ENGLAND_GAPS), [], TAGGED)


def test_fires_when_no_census_year_named():
    """census_years arm: a census-from-wiki timeline whose gaps name no census
    year at all fires it. Pins the census_years assertion (finding C) — a census
    page is fetched so census_reads passes, and the gap has no census entry."""
    gap = [{"start": "1841", "end": "1851",
            "expected_events": ["baptism", "burial"], "severity": "high"}]
    with pytest.raises(AssertionError, match="produced no census gap"):
        check_census_from_wiki(BEFORE, _after(gap), [_wiki_call()], TAGGED)


def test_fires_when_all_census_years_are_us_federal():
    """non_us arm: when the only census years are US federal years and they are
    on the fetched US page (so the `absent` arm passes), the non_us assertion is
    the one that fires. Pins non_us (finding C) — unreachable as a failure with
    the England fixture alone, so it needs the US page + US years."""
    gap = [{"start": "1895", "end": "1915",
            "expected_events": ["1900 census", "1910 census"], "severity": "high"}]
    with pytest.raises(AssertionError, match="US federal year"):
        check_census_from_wiki(BEFORE, _after(gap), [_wiki_call(US_URL, US_PAGE)], TAGGED)


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
    """absent arm: a census year the fetched page does not list (1861/1871 with a
    page that only goes to 1851) fires it. `match=` pins THIS assertion (finding
    C)."""
    short_page = "# England Census\n1801 1811 1821 1831 1841 1851\n"
    with pytest.raises(AssertionError, match="not found on the fetched census page"):
        check_census_from_wiki(
            BEFORE, _after(ENGLAND_GAPS), [_wiki_call(content=short_page)], TAGGED
        )


def test_skips_when_not_tagged():
    """Untagged tests are not gated by this check."""
    with pytest.raises(pytest.skip.Exception):
        check_census_from_wiki(BEFORE, _after(ENGLAND_GAPS), [_wiki_call()], {"tags": ["timeline"]})
