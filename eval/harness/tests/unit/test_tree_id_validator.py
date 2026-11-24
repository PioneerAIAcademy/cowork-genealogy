"""The research suite's tree-id validator, proved in both directions (issue #4669).

A tester read "she is in the tree as I13" as meaningless. The validator fails a
reply naming a tree id, and must not fail one naming a FamilySearch ID (PID),
whose halves can look like a tree id.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import (  # noqa: E402
    _PROJECT_ID_RE,
    tree_ids_named,
)
from test_research import test_reply_names_no_tree_id as no_tree_id  # noqa: E402


@pytest.mark.parametrize(
    ("reply", "expected"),
    [
        ("Zeruiah Phipps, 24, is Benjamin's sister — she is in the tree as I13.", ["I13"]),
        ("The census and the will (S1 and S3) agree.", ["S1", "S3"]),
        ("His death fact F2 has no date.", ["F2"]),
        ("The couple R4 and the name N7.", ["N7", "R4"]),
        ("Persons I1-I5 are the children.", ["I1", "I5"]),
        ("Persons I1–I5 are the children.", ["I1", "I5"]),
        ("(I1)", ["I1"]),
        ("Mary (K835-34K) is I2 in the tree.", ["I2"]),
        # A known, accepted false positive: nothing like it is in any committed reply.
        ("She entered on an F1 visa.", ["F1"]),
    ],
)
def test_a_reply_naming_a_tree_id_fails(reply, expected):
    assert tree_ids_named(reply) == expected
    with pytest.raises(AssertionError, match="names tree ids"):
        no_tree_id(reply)


@pytest.mark.parametrize(
    "reply",
    [
        "Zeruiah Phipps (KHCM-61R) is Benjamin's sister.",
        "Her FamilySearch ID is K835-34K.",
        "Two men named John: K835-R12 and F123-ABC.",
        "Lowercase k835-r12 still reads as a FamilySearch ID.",
        "I think she was born in 1880.",
        "I",
        "Henry VIII and Louis XIV",
        "the record ark:/61903/4:1:94Z5-N1F",
        "",
        None,
    ],
)
def test_a_reply_without_a_tree_id_passes(reply):
    assert tree_ids_named(reply) == []
    no_tree_id(reply)


def test_the_status_question_regex_is_unchanged():
    """`_PROJECT_ID_RE` is now built from the shared tree-id piece; the
    status-question check must match exactly what it matched before."""
    text = "q_001 src_002 I13 S2 F4 N1 R9 ps_001 hv_3 KHCM-61R Henry VIII"
    assert _PROJECT_ID_RE.findall(text) == [
        "q_001", "src_002", "I13", "S2", "F4", "N1", "R9", "ps_001", "hv_3",
    ]
