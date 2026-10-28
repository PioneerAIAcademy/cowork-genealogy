"""Direct tests for the naming-not-evidence validator (issue #3251).

`testpaths = ["tests"]` keeps validators/ out of `make harness-test`, so these
are the only place its pass/fail set is checked without a paid run. The judge
cannot grade this point on `flynn-naming-pattern-parentage`: the planted
h_002 notes sit in the state it reads, and it quoted them as the run's own
narrative in six of six graded runs."""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_proof_conclusion import test_naming_custom_not_cited as check  # noqa: E402

TAGGED = {"type": "positive", "tags": ["naming-not-evidence"]}


def _after(narrative):
    return {
        "research_json": {
            "proof_summaries": [
                {"id": "ps_001", "question_id": "q_001", "narrative_markdown": narrative}
            ]
        }
    }


CLEAN = (
    "Three independent original sources support Thomas Flynn as Patrick's father. "
    "St. Patrick's register records two baptisms naming Patrick Flynn and Mary Doyle "
    "as parents.\nMaternity is not proved."
)


@pytest.mark.parametrize(
    "narrative",
    [
        CLEAN,
        CLEAN + " Naming patterns are not evidence of parentage and were not considered.",
        CLEAN + "\nNaming customs were excluded from this analysis.",
    ],
)
def test_accepts_a_narrative_that_leaves_naming_out_or_only_excludes_it(narrative):
    check(_after(narrative), [], "", TAGGED)


@pytest.mark.parametrize(
    "sentence",
    [
        "The Irish naming pattern is strong circumstantial support that Thomas and Bridget were his parents.",
        "Under the Irish naming convention a first daughter is named for the maternal grandmother.",
        "Naming patterns are not evidence, but the names Thomas and Bridget are consistent with them.",
        "His daughter was named for her paternal grandmother.",
        "Bridget Flynn would be the maternal grandmother of Patrick's daughter.",
        "The research notes invoke a naming\nconvention to argue for Thomas and Bridget.",
        "The naming tradition points to Patrick's own mother.",
    ],
)
def test_rejects_a_narrative_that_describes_the_custom(sentence):
    with pytest.raises(AssertionError, match="naming custom"):
        check(_after(CLEAN + " " + sentence), [], "", TAGGED)


def test_rejects_a_naming_argument_in_the_reply_only():
    reply = "Done. The naming pattern suggests Bridget was his mother."
    with pytest.raises(AssertionError, match="naming custom"):
        check(_after(CLEAN), [], reply, TAGGED)


def test_rejects_a_missing_summary():
    with pytest.raises(AssertionError, match="no proof_summaries entry"):
        check({"research_json": {"proof_summaries": []}}, [], "", TAGGED)


def test_skips_when_untagged():
    with pytest.raises(pytest.skip.Exception):
        check(_after("The naming pattern proves it."), [], "", {"type": "positive", "tags": ["proof"]})
