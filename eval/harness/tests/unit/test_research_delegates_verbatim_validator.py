"""Direct tests for `test_research.test_person_evidence_spawn_carries_the_users_words`.

The validator runs only on a test tagged `delegates-verbatim` (issue #3601).
`testpaths` excludes `validators/`, which is why these cases live here. Each call
record is in the shape `skill_runner.builtin_call_record` writes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_person_evidence_spawn_carries_the_users_words as check  # noqa: E402

WORDS = (
    "I'm not sure the Patrick Flynn in the 1870 and 1880 Schuylkill censuses is my Patrick "
    "— that one was born in Pennsylvania about 1832."
)
TEST = {
    "skill": "research",
    "tags": ["routing", "routes-to:person-evidence", "delegates-verbatim"],
    "user_message": f"/research {WORDS}",
}


def _spawn(agent: str, prompt: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent, "prompt": prompt}}


def _prompt(words: str) -> str:
    return f"projectPath: /p\nThe researcher said: \"{words}\"\nEvaluate the link to I1."


def test_passes_when_the_message_is_quoted_whole():
    check(TEST, [_spawn("person-evidence", _prompt(WORDS))])


def test_passes_when_the_message_is_reflowed_across_lines():
    check(TEST, [_spawn("person-evidence", _prompt(WORDS.replace(" is my ", "\n  is my ")))])


def test_passes_with_a_curly_apostrophe():
    check(TEST, [_spawn("person-evidence", _prompt(WORDS.replace("I'm", "I’m")))])


def test_passes_a_json_shaped_prompt():
    check(TEST, [_spawn("person-evidence", json.dumps({"researcher_message": WORDS}, ensure_ascii=False))])


def test_passes_when_a_later_spawn_carries_it():
    check(TEST, [_spawn("person-evidence", _prompt("doubts I3")), _spawn("person-evidence", _prompt(WORDS))])


@pytest.mark.parametrize(
    "prompt",
    [
        _prompt("The researcher says the 1880 Patrick Flynn is not their Patrick."),
        _prompt(WORDS.replace("I'm not sure ", "")),
        _prompt(WORDS.replace(" — that one was born in Pennsylvania about 1832.", "")),
        _prompt(WORDS.replace("1832", "1845")),
        _prompt(WORDS.replace(" — ", " - ")),
        "projectPath: /p\nEvaluate the link to I1.",
    ],
    ids=["paraphrased-as-a-no", "hedge-dropped", "tail-dropped", "year-changed", "dash-changed", "no-words"],
)
def test_fails_when_the_message_is_not_carried_verbatim(prompt):
    with pytest.raises(BaseException, match="verbatim") as excinfo:
        check(TEST, [_spawn("person-evidence", prompt)])
    assert excinfo.typename == "AssertionError", excinfo.typename


def test_fails_when_only_another_agent_carries_it():
    with pytest.raises(BaseException, match="no person-evidence spawn") as excinfo:
        check(TEST, [_spawn("tree-edit", _prompt(WORDS))])
    assert excinfo.typename == "AssertionError", excinfo.typename


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check({**TEST, "tags": ["routing", "routes-to:person-evidence"]}, [])
