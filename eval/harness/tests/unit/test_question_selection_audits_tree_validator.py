"""Direct tests for `test_new_question_marks_audits_tree` (#4430).

Nothing under `validators/` is collected by `make harness-test`; without these
the writer half of the audit marker would be checked only inside a paid
question-selection run.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_question_selection import (  # noqa: E402
    test_new_question_marks_audits_tree as check_audit,
)


def _q(qid, **kw):
    return {"id": qid, "question": "Do independent records confirm that John is Anton's father?", **kw}


def _states(before_qs, after_qs):
    return {"research_json": {"questions": before_qs}}, {"research_json": {"questions": after_qs}}


def _test(*tags):
    return {"tags": list(tags)}


def test_audit_tag_passes_a_marked_question():
    check_audit(*_states([], [_q("q_001", audits_tree=True)]), _test("audits-tree"))


@pytest.mark.parametrize("patch", [{}, {"audits_tree": False}, {"audits_tree": "true"}, {"audits_tree": None},
                                   {"audits_tree": 1}])
def test_audit_tag_fails_an_unmarked_question(patch):
    with pytest.raises(AssertionError, match="q_002"):
        check_audit(*_states([_q("q_001")], [_q("q_001"), _q("q_002", **patch)]), _test("audits-tree"))


@pytest.mark.parametrize("patch", [{}, {"audits_tree": False}])
def test_not_audit_tag_passes_an_unmarked_question(patch):
    check_audit(*_states([], [_q("q_001", **patch)]), _test("not-audits-tree"))


def test_not_audit_tag_fails_a_marked_question():
    with pytest.raises(AssertionError, match="q_001"):
        check_audit(*_states([], [_q("q_001", audits_tree=True)]), _test("not-audits-tree"))


def test_only_new_questions_are_judged():
    check_audit(*_states([_q("q_001")], [_q("q_001"), _q("q_002", audits_tree=True)]), _test("audits-tree"))


def test_skips_untagged_and_unwritten():
    with pytest.raises(pytest.skip.Exception):
        check_audit(*_states([], [_q("q_001")]), _test())
    with pytest.raises(pytest.skip.Exception):
        check_audit(*_states([], []), _test("audits-tree"))
