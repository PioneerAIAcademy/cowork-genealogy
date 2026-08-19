"""Direct tests for the conflict-blocks-proved validator.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards, and why it is deterministic rather than judge-graded: across
four runs on 2026-08-19 this single test flip-flopped while the skill produced
three different behaviours on the same fixture — concluding at `probable`,
declining and persisting nothing, and resolving the blocking conflict itself
before concluding. Each was graded on judge nuance. The rule below is the lead's
2026-08-19 ruling made mechanical: an unresolved conflict on an IDENTIFYING
attribute blocks the conclusion at every tier (correlation presupposes
identity), the blocked attempt is recorded at `not_proved`, and the question
stays open.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_proof_conclusion import test_conflict_blocks_proved as check  # noqa: E402

TAGGED = {"type": "positive", "tags": ["conflict-blocks-proved"]}
UNTAGGED = {"type": "positive", "tags": ["proof"]}


def _after(summaries, question=None):
    return {
        "research_json": {
            "proof_summaries": summaries,
            "questions": [question or {"id": "q_001", "status": "open"}],
        }
    }


def _ps(tier):
    return {"id": "ps_001", "question_id": "q_001", "tier": tier}


def test_accepts_a_not_proved_record_of_the_blocked_attempt():
    check(_after([_ps("not_proved")]), TAGGED)


@pytest.mark.parametrize("tier", ["proved", "probable", "possible"])
def test_rejects_every_tier_that_concludes(tier):
    """`probable` is the one that matters: it is what the skill wrote twice,
    and what an earlier version of this check explicitly allowed by testing
    only for `proved`."""
    with pytest.raises(AssertionError, match="identifying attribute"):
        check(_after([_ps(tier)]), TAGGED)


def test_rejects_a_silent_decline():
    """Persisting nothing loses the reasoning — the blocked attempt is itself
    a research finding."""
    with pytest.raises(AssertionError, match="recorded nothing"):
        check(_after([]), TAGGED)


def test_rejects_resolving_the_question_anyway():
    with pytest.raises(AssertionError, match="marked q_001 resolved"):
        check(
            _after([_ps("not_proved")], {"id": "q_001", "status": "resolved"}),
            TAGGED,
        )


def test_ignores_another_questions_summary():
    """Only q_001 is under this fixture's rule."""
    other = {"id": "ps_002", "question_id": "q_002", "tier": "proved"}
    with pytest.raises(AssertionError, match="recorded nothing"):
        check(_after([other]), TAGGED)


def test_skips_when_the_tag_is_absent():
    with pytest.raises(BaseException) as exc:  # pytest.skip raises Skipped
        check(_after([_ps("proved")]), UNTAGGED)
    assert "not a conflict-blocks-proved scenario" in str(exc.value)


# ── bounded conclusions: tiered high enough to reach the tree ──

from test_proof_conclusion import (  # noqa: E402
    test_bounded_conclusion_is_tiered_and_encoded as bounded,
)

BOUNDED = {"type": "positive", "tags": ["bounded-conclusion"]}


def _state(tier, death_fact):
    facts = [{"type": "Birth", "date": "1805"}]
    if death_fact is not None:
        facts.append(death_fact)
    return {
        "research_json": {
            "proof_summaries": [{"id": "ps_001", "question_id": "q_001", "tier": tier}]
        },
        "tree_gedcomx_json": {"persons": [{"id": "I1", "facts": facts}]},
    }


DEATH = {"type": "Death", "date": "after 1870, before 1885"}


def test_accepts_probable_with_an_encoded_bracket():
    bounded(_state("probable", DEATH), BOUNDED)


def test_rejects_the_not_proved_collapse():
    with pytest.raises(AssertionError, match="strength of what CAN be established"):
        bounded(_state("not_proved", None), BOUNDED)


def test_rejects_possible_because_it_can_never_reach_the_tree():
    """The half that made the old fixture unsatisfiable: `possible` is below
    the encoding threshold, so accepting it while requiring the encoded fact
    asked for two things that cannot both happen."""
    with pytest.raises(AssertionError, match="strength of what CAN be established"):
        bounded(_state("possible", DEATH), BOUNDED)


def test_rejects_a_conclusion_that_never_reached_the_tree():
    with pytest.raises(AssertionError, match="no Death fact on I1"):
        bounded(_state("probable", None), BOUNDED)


def test_rejects_a_death_fact_with_no_bracket():
    with pytest.raises(AssertionError, match="carries no date"):
        bounded(_state("probable", {"type": "Death"}), BOUNDED)


def test_bounded_check_skips_when_untagged():
    with pytest.raises(BaseException) as exc:
        bounded(_state("not_proved", None), {"type": "positive", "tags": []})
    assert "not a bounded-conclusion scenario" in str(exc.value)
