"""Direct tests for `test_new_question_carries_question_kind`.

Nothing under `validators/` is collected by `make harness-test`; without these
the writer half of issue #1830 item 1 would be checked only inside a paid
question-selection run.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_question_selection import (  # noqa: E402
    test_new_question_carries_question_kind as check_kind,
)


def _q(qid, **kw):
    return {"id": qid, "question": "Who were the children of Lewis Reese?", **kw}


def _states(before_qs, after_qs):
    return {"research_json": {"questions": before_qs}}, {"research_json": {"questions": after_qs}}


@pytest.mark.parametrize("kind", ["enumerative", "targeted"])
def test_passes_a_new_question_with_a_kind(kind):
    check_kind(*_states([], [_q("q_001", question_kind=kind)]))


@pytest.mark.parametrize("patch", [{}, {"question_kind": None}, {"question_kind": ""},
                                   {"question_kind": "enumeration"}])
def test_fails_a_new_question_without_a_valid_kind(patch):
    with pytest.raises(AssertionError, match="q_002"):
        check_kind(*_states([_q("q_001")], [_q("q_001"), _q("q_002", **patch)]))


def test_ignores_pre_existing_questions_without_a_kind():
    """Questions written before the field existed are not the writer's to fix."""
    old = _q("q_001")
    check_kind(*_states([old], [old, _q("q_002", question_kind="targeted")]))


def test_passes_when_no_question_was_written():
    old = _q("q_001")
    check_kind(*_states([old], [old]))


def test_skips_without_research_json():
    with pytest.raises(pytest.skip.Exception):
        check_kind({}, {"research_json": {"questions": []}})
