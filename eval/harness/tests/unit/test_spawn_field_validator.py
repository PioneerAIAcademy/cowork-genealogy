"""`test_spawn_carries_its_step_mode_fields` — the fields a "Keep going." or
"Wrap it up." turn passes in a spawn prompt.

Both directions: the fields pass in the spellings a router writes, and a spawn
missing one, carrying the wrong value, or not happening at all fails. The
failure tests assert the exception TYPE, as `test_foreground_spawn_validator.py`
does, so a validator that had gone vacuous cannot pass as a skip.
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
    test_spawn_carries_its_step_mode_fields as validator,
)

KEEP_GOING = {"tags": ["routing", "delegates-user-present-no"]}
WRAP_UP = {"tags": ["routing", "delegates-wrap-up"]}


def _spawn(callee: str, prompt: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": callee, "prompt": prompt}}


def _wrap_up(**overrides) -> list[dict]:
    prompts = {
        "research-plan": "The researcher is wrapping up.\nplanItemIds: pli_003, pli_004",
        "research-exhaustiveness": "questionId: q_001\nwrapUp: yes",
        "proof-conclusion": "questionId: q_001\nwrapUp: yes",
        **overrides,
    }
    return [_spawn(c, p) for c, p in prompts.items() if p is not None]


def _expect_fail(test, calls) -> str:
    with pytest.raises(BaseException) as excinfo:
        validator(test, calls)
    assert excinfo.typename == "AssertionError", excinfo.typename
    return str(excinfo.value)


@pytest.mark.parametrize(
    "line",
    [
        "userPresent: no",
        "`userPresent: no`",
        "userpresent:no",
        "userPresent: `no`",
        # Spellings a router actually writes, which the first form rejected: bold
        # markdown around the field, a JSON-ish pair, and `=` instead of `:` (a
        # committed run writes `planItemIds=pli_001`).
        "**userPresent:** no",
        '"userPresent": "no"',
        "userPresent=no",
        "**`userPresent`**: **no**",
    ],
)
def test_user_present_no_passes_in_every_spelling(line):
    validator(KEEP_GOING, [_spawn("person-evidence", f"a_001, a_002\n{line}")])


def test_user_present_yes_fails():
    assert "userPresent" in _expect_fail(
        KEEP_GOING, [_spawn("person-evidence", "a_001\nuserPresent: yes")]
    )


@pytest.mark.parametrize("line", ["userPresent: nobody", "userPresent: yesterday"])
def test_a_value_that_only_starts_with_the_one_wanted_fails(line):
    """Widening the markup must not widen the VALUE: the match still ends on a word
    boundary, so `nobody` is not `no`."""
    _expect_fail(KEEP_GOING, [_spawn("person-evidence", line)])


@pytest.mark.parametrize("line", ["userPresentation: no", "theUserPresent: no"])
def test_a_field_whose_NAME_merely_contains_the_one_wanted_fails(line):
    """The field name is anchored at both ends, so a longer name is a different field."""
    _expect_fail(KEEP_GOING, [_spawn("person-evidence", line)])


def test_no_person_evidence_spawn_fails_rather_than_skips():
    assert "no spawn" in _expect_fail(KEEP_GOING, [_spawn("research-plan", "userPresent: no")])


def test_a_full_wrap_up_passes():
    validator(WRAP_UP, _wrap_up())


def test_a_wrap_up_in_the_markup_a_router_writes_passes():
    validator(WRAP_UP, _wrap_up(**{
        "research-plan": "planItemIds=pli_001",
        "research-exhaustiveness": "**wrapUp:** yes",
        "proof-conclusion": '"wrapUp": "yes"',
    }))


@pytest.mark.parametrize(
    "callee,prompt",
    [
        ("research-plan", "The researcher is wrapping up."),
        ("research-exhaustiveness", "questionId: q_001"),
        ("proof-conclusion", "questionId: q_001\nwrapUp: no"),
        ("proof-conclusion", "questionId: q_001\n**wrapUp:** no"),
        ("proof-conclusion", None),
    ],
)
def test_a_wrap_up_missing_any_field_fails(callee, prompt):
    assert callee in _expect_fail(WRAP_UP, _wrap_up(**{callee: prompt}))


def test_an_untagged_test_is_skipped():
    with pytest.raises(BaseException) as excinfo:
        validator({"tags": ["routing"]}, [])
    assert excinfo.typename == "Skipped"
