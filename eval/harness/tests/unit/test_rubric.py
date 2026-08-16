"""Tests for harness.rubric — parsing skill rubric.md files."""

from pathlib import Path

import pytest

from harness.rubric import (
    InvalidRubricError,
    Rubric,
    empty_rubric,
    parse_rubric,
    parse_rubric_or_empty,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
# Use citation/ as the real-rubric fixture. search-familysearch-wiki's rubric is
# being deleted as part of the criteria-demotion rollout; citation
# stays because it encodes Evidence Explained craft.
CITATION_RUBRIC = REPO_ROOT / "eval/tests/unit/citation/rubric.md"


MINIMAL_RUBRIC = """\
# my-skill

What this rubric grades.

## Dimension A

What A evaluates.

- **pass:** A is good
- **partial:** A is okay
- **fail:** A is bad
"""


THREE_DIM_RUBRIC = """\
# my-skill

Lead paragraph.

## Alpha

Alpha description.

- **pass:** alpha pass
- **partial:** alpha partial
- **fail:** alpha fail

## Beta

Beta description.

- **pass:** beta pass
- **partial:** beta partial
- **fail:** beta fail

## Gamma

Gamma description.

- **pass:** gamma pass
- **partial:** not applicable — this dimension is binary
- **fail:** gamma fail
"""


def test_parse_real_citation_rubric():
    r = parse_rubric(CITATION_RUBRIC.read_text(encoding="utf-8"))
    assert r.skill == "Citation Rubric"
    assert len(r.dimensions) == 5
    names = [d.name for d in r.dimensions]
    assert "Evidence Explained compliance" in names
    for d in r.dimensions:
        assert d.pass_criteria
        assert d.partial_criteria
        assert d.fail_criteria


def test_empty_rubric_helper():
    r = empty_rubric("my-skill")
    assert r.skill == "my-skill"
    assert r.dimensions == []
    assert r.raw == ""


def test_parse_or_empty_handles_missing_file():
    r = parse_rubric_or_empty("my-skill", None)
    assert r.dimensions == []
    assert r.skill == "my-skill"


def test_parse_or_empty_handles_whitespace_only_file():
    r = parse_rubric_or_empty("my-skill", "   \n\n  ")
    assert r.dimensions == []


def test_parse_or_empty_delegates_to_strict_parser_when_populated():
    r = parse_rubric_or_empty("ignored-when-text-present", MINIMAL_RUBRIC)
    assert r.skill == "my-skill"  # H1 from the file wins
    assert len(r.dimensions) == 1


def test_parse_minimal():
    r = parse_rubric(MINIMAL_RUBRIC)
    assert r.skill == "my-skill"
    assert len(r.dimensions) == 1
    d = r.dimensions[0]
    assert d.name == "Dimension A"
    assert d.pass_criteria == "A is good"
    assert d.partial_criteria == "A is okay"
    assert d.fail_criteria == "A is bad"


def test_parse_three_dimensions():
    r = parse_rubric(THREE_DIM_RUBRIC)
    assert [d.name for d in r.dimensions] == ["Alpha", "Beta", "Gamma"]
    assert r.dimensions[2].partial_criteria.startswith("not applicable")


def test_rejects_missing_h1():
    bad = MINIMAL_RUBRIC.replace("# my-skill", "no h1 here")
    with pytest.raises(InvalidRubricError):
        parse_rubric(bad)


def test_rejects_missing_pass_bullet():
    bad = MINIMAL_RUBRIC.replace("- **pass:** A is good\n", "")
    with pytest.raises(InvalidRubricError):
        parse_rubric(bad)


def test_rejects_missing_partial_bullet():
    bad = MINIMAL_RUBRIC.replace("- **partial:** A is okay\n", "")
    with pytest.raises(InvalidRubricError):
        parse_rubric(bad)


def test_rejects_missing_fail_bullet():
    bad = MINIMAL_RUBRIC.replace("- **fail:** A is bad\n", "")
    with pytest.raises(InvalidRubricError):
        parse_rubric(bad)


def test_rejects_zero_dimensions_in_strict_path():
    """The strict parser still rejects a non-empty file with no H2s — the
    opt-in path is via parse_rubric_or_empty, not by accepting malformed
    rubrics in parse_rubric directly."""
    bad = "# skill\n\nNo dimensions here.\n"
    with pytest.raises(InvalidRubricError):
        parse_rubric(bad)


def test_rejects_more_than_five_dimensions():
    """Spec §7: rubric capped at 5 dimensions."""
    six_dim = "# skill\n\nBody.\n\n" + "".join(
        f"## D{i}\n\nx\n\n- **pass:** p\n- **partial:** m\n- **fail:** f\n\n"
        for i in range(6)
    )
    with pytest.raises(InvalidRubricError, match="caps at 5"):
        parse_rubric(six_dim)


def test_accepts_exactly_five_dimensions():
    five_dim = "# skill\n\nBody.\n\n" + "".join(
        f"## D{i}\n\nx\n\n- **pass:** p\n- **partial:** m\n- **fail:** f\n\n"
        for i in range(5)
    )
    r = parse_rubric(five_dim)
    assert len(r.dimensions) == 5


def test_content_hash_stable_across_whitespace_runs():
    r1 = parse_rubric(MINIMAL_RUBRIC)
    r2 = parse_rubric(MINIMAL_RUBRIC)
    assert r1.content_hash == r2.content_hash
    assert len(r1.content_hash) == 64  # sha256 hex


def test_content_hash_changes_when_text_changes():
    r1 = parse_rubric(MINIMAL_RUBRIC)
    r2 = parse_rubric(MINIMAL_RUBRIC.replace("A is good", "A is great"))
    assert r1.content_hash != r2.content_hash


def test_dimension_names_returns_case_sensitive_set():
    r = parse_rubric(THREE_DIM_RUBRIC)
    assert r.dimension_names() == frozenset({"Alpha", "Beta", "Gamma"})
    # A re-cased variant is not a member — judge._extract_dimensions relies
    # on this to reject re-cased names rather than silently accept them (#1361).
    assert "alpha" not in r.dimension_names()
    assert "ALPHA" not in r.dimension_names()


def test_dimension_names_empty_for_empty_rubric():
    r = empty_rubric("my-skill")
    assert r.dimension_names() == frozenset()


# --- covered_by (issue #1668) ---------------------------------------------

from harness.rubric import (  # noqa: E402
    COVERED_BY_PREFIX,
    covered_dimension_entries,
    parse_rubric,
    split_covered_dimensions,
)


def _rubric_text(covered: str | None = None) -> str:
    line = f"\n- **covered_by:** {covered}" if covered else ""
    return (
        "# demo-skill\n\n"
        "## Evidence type accuracy\n\n"
        "Does the classification hold.\n\n"
        "- **pass:** right\n"
        "- **partial:** partly\n"
        f"- **fail:** wrong{line}\n\n"
        "## Narrative quality\n\n"
        "Reads well.\n\n"
        "- **pass:** yes\n"
        "- **partial:** partly\n"
        "- **fail:** no\n"
    )


def test_covered_by_is_parsed_when_present():
    r = parse_rubric(_rubric_text("test_expected_classifications"))
    assert r.dimensions[0].covered_by == "test_expected_classifications"


def test_covered_by_is_none_when_absent():
    r = parse_rubric(_rubric_text())
    assert r.dimensions[0].covered_by is None
    assert r.dimensions[1].covered_by is None


def test_covered_by_is_optional_so_every_existing_rubric_still_parses():
    """The pass/partial/fail bullets stay REQUIRED; this one does not. Every
    rubric in the corpus predates it."""
    r = parse_rubric(_rubric_text())
    assert len(r.dimensions) == 2


def test_split_retires_a_dimension_whose_validator_passed():
    r = parse_rubric(_rubric_text("test_expected_classifications"))
    judge_rubric, retired = split_covered_dimensions(
        r, {"test_expected_classifications"}
    )
    assert [d.name for d in judge_rubric.dimensions] == ["Narrative quality"]
    assert [d.name for d in retired] == ["Evidence type accuracy"]


def test_split_keeps_the_dimension_when_its_validator_FAILED():
    """A failing validator did not answer the dimension, so the judge still has
    to. Retiring on a failure would convert a real defect into a silent null."""
    r = parse_rubric(_rubric_text("test_expected_classifications"))
    judge_rubric, retired = split_covered_dimensions(r, set())
    assert len(judge_rubric.dimensions) == 2
    assert retired == []


def test_split_is_a_noop_without_any_covered_by():
    r = parse_rubric(_rubric_text())
    judge_rubric, retired = split_covered_dimensions(r, {"anything"})
    assert judge_rubric is r
    assert retired == []


def test_retired_entries_are_null_and_carry_the_marker():
    r = parse_rubric(_rubric_text("test_expected_classifications"))
    _, retired = split_covered_dimensions(r, {"test_expected_classifications"})
    entries = covered_dimension_entries(retired)
    assert entries[0]["score"] is None
    assert entries[0]["source"] == "rubric"
    assert entries[0]["rationale"].startswith(COVERED_BY_PREFIX)
    assert "test_expected_classifications" in entries[0]["rationale"]
