"""Unit tests for the provenance report."""

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "provenance_report",
    Path(__file__).resolve().parents[2] / "provenance_report.py",
)
provenance_report = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(provenance_report)

candidate_identifiers = provenance_report.candidate_identifiers


def test_finds_a_bare_collection_id():
    assert "1417683" in candidate_identifiers("the 1880 census, collection 1417683")


def test_finds_an_ark():
    got = candidate_identifiers("cited ark:/61903/1:1:VRNT-7M3 as the source")
    assert "ark:/61903/1:1:VRNT-7M3" in got


def test_strips_trailing_punctuation_from_an_ark():
    """A citation ends the ARK with a full stop. Without the trim every cited
    ARK looks untraceable, which is most of them."""
    got = candidate_identifiers("see ark:/61903/1:1:VRNT-7M3.")
    assert "ark:/61903/1:1:VRNT-7M3" in got
    assert "ark:/61903/1:1:VRNT-7M3." not in got


def test_ignores_years():
    """Four digits is a year. Requiring years to trace flagged 442 legitimate
    derivations across 89 test-pairs — the check fired on almost everything."""
    got = candidate_identifiers("born 1844, died 1901, census 1880")
    assert got == set()


def test_ignores_a_number_inside_an_identifier_it_already_captured():
    """The digits inside an ARK must not also surface as a bare number."""
    got = candidate_identifiers("ark:/61903/1:1:VRNT-7M3")
    assert got == {"ark:/61903/1:1:VRNT-7M3"}


def test_five_digit_numbers_are_candidates():
    assert "18503" in candidate_identifiers("Will Book 18503")


def test_empty_text_yields_nothing():
    assert candidate_identifiers("") == set()


def test_scan_reads_the_real_corpus_and_finds_dimension_keys():
    """Reads committed run logs, not a synthetic fixture. A hand-written fixture
    cannot catch a wrong field path — `file_changes` lives under
    `runs[].output`, and a scan pointed elsewhere returns a clean zero and every
    synthetic test still passes."""
    findings = provenance_report.scan()
    assert isinstance(findings, dict)
    # The corpus is known to contain fabricated collection ids (issue #1332).
    # Assert a floor, never an exact count — run logs are pruned and added.
    total = sum(len(v) for v in findings.values())
    assert total > 0, "scan found nothing at all — check the file_changes path"
