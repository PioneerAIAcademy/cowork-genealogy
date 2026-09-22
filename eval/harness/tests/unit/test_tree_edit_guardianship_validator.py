"""Direct tests for tree-edit's guardianship leading-reading validator.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and this check's real pass/fail set would otherwise
appear only inside a paid per-skill run.

Every reply below is **verbatim** from a captured `ut_tree_edit_014` run --
the five committed run logs plus the three scratch runs of 2026-09-22 filed
on issue #2449. Nothing is tidied: the em dashes, the bold markers and the
table pipes are what the model actually emitted, and they are what the
splitter has to survive.

The violating reply is `v1_2026-09-15_05-34-57`, whose human annotation
upheld Correctness 1 and Completeness 1 -- "That reverses the required
determination." It weights the readings twice, once in a comparison table
and once in prose, which is why both units are pinned separately.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as test_init_project_validator.py.
from test_tree_edit import (  # noqa: E402
    test_step_reading_leads_when_the_surname_is_unresolved as check_leads,
)


TAGS = {"tags": ["tree-edit", "relationship-accuracy", "guardianship",
                 "step-relation", "relationship-subtype", "issue-1900"]}

# --- verbatim from v1_2026-09-15_05-34-57 (the inverted run) ----------

_INVERTED_TABLE_ROW = '| **Uncle by marriage** (favoured) | "Watts" is Nancy\'s **maiden** name | Children are likely her brother\'s orphans; Ridley is their uncle by marriage |'

_INVERTED_PROSE = "Everything you have recorded points toward Nancy's maiden name being Watts — she appears as *Nancy Watts* before the November 1820 marriage. That makes the **uncle-by-marriage reading the favoured one**: a Watts father (probably Nancy's brother or father) died, and the Amherst County court appointed Ridley — a new son-in-law of the family, an adult householder — to manage the minors' property. That is exactly the routine purpose a county guardianship bond served in Virginia."

# --- verbatim from v1_2026-09-14_18-51-07 (a passing run) -------------

_BOTH_WEIGHED_TOGETHER = "The bond does not distinguish these. What resolves it is **Nancy's earlier history**: if she has a maiden name other than Watts, the stepparent reading leads; if Watts is her maiden name, the uncle-by-marriage hypothesis stays open."


def test_fires_on_the_observed_prose_inversion():
    """The sentence the annotator failed the run for."""
    with pytest.raises(AssertionError, match="favoured one"):
        check_leads(_INVERTED_PROSE, TAGS)


def test_fires_on_the_observed_table_row_alone():
    """The same run weighted the readings a second time, in a table.

    Pinned separately so a regression that reached only prose still reds.
    """
    with pytest.raises(AssertionError, match="uncle-by-marriage"):
        check_leads(_INVERTED_TABLE_ROW, TAGS)


def test_passes_on_a_row_whose_cells_qualify_each_other():
    """Constructed, not captured -- no run in the corpus has this shape yet.

    A row is held whole because sentence-splitting inside one can cut "not
    favoured" away from the clause that qualifies it, leaving a fragment
    that names uncle beside a lead marker with no step in sight. This row
    is correct and must pass; under a splitter that breaks rows on
    sentence punctuation it fires spuriously.
    """
    check_leads(
        "| **Uncle by marriage** | not favoured. The step reading leads. |",
        TAGS,
    )


def test_passes_when_one_sentence_ranks_step_above_uncle():
    """Constructed, not captured -- and the reason the `not step` arm exists.

    No unit in any captured reply names both readings beside a lead marker,
    so nothing in the corpus exercises this arm. But it is the most natural
    way to write the correct answer in one breath, and without the arm the
    check reds it.
    """
    check_leads(
        "The step reading leads over the uncle-by-marriage alternative, "
        "which the bond does not rule out.",
        TAGS,
    )


def test_passes_when_both_readings_are_weighed_together():
    """Prove the other direction, per CLAUDE.md.

    This line names uncle AND a lead marker AND step, all in one sentence --
    the shape of a correct answer that holds the question open. A check that
    fired on "uncle near a lead word" would red every good run.
    """
    check_leads(_BOTH_WEIGHED_TOGETHER, TAGS)


def test_passes_when_uncle_is_named_without_being_favoured():
    """Naming the alternative is required by the reference, not a fault."""
    check_leads(
        "The step reading leads. The uncle-by-marriage reading is not yet "
        "ruled out; her prior marriage would settle it.",
        TAGS,
    )


def test_fires_when_step_is_named_only_in_a_different_sentence():
    """The guard is per-unit, not per-document.

    A reply that favours uncle in one breath and mentions step somewhere
    else entirely has still inverted the weighting. A document-level
    "does the word step appear" check would pass this.
    """
    with pytest.raises(AssertionError, match="favoured"):
        check_leads(
            "The uncle-by-marriage reading is favoured here. A stepfather "
            "would also be appointed guardian in the ordinary course.",
            TAGS,
        )


def test_skips_a_test_without_the_guardianship_tag():
    """Tag-gated: no other tree-edit test discusses either reading, so an
    ungated version would scan replies that cannot satisfy it."""
    with pytest.raises(pytest.skip.Exception):
        check_leads(_INVERTED_PROSE, {"tags": ["tree-edit", "merge"]})


def test_skips_an_empty_reply():
    """A run that said nothing is a different defect, owned elsewhere."""
    with pytest.raises(pytest.skip.Exception):
        check_leads("   ", TAGS)
