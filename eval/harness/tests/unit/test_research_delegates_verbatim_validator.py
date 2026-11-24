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


# --- #4381: the callee is the deliverable: tag, else routes-to:, else person-evidence ---

ASK = "For Patrick Flynn's children, can you explain what could be behind their migration patterns?"
ROUTED = {"skill": "research", "tags": ["routing", "routes-to:historical-context", "delegates-verbatim"],
          "user_message": f"/research {ASK}"}
AFTER_INIT = {"skill": "research", "user_message": f"/research {ASK}",
              "tags": ["routing", "routes-to:init-project", "bounded-after-init",
                       "deliverable:historical-context", "delegates-verbatim"]}


@pytest.mark.parametrize("test", [ROUTED, AFTER_INIT], ids=["routes-to", "deliverable"])
def test_a_historical_context_spawn_carrying_the_message_passes(test):
    check(test, [_spawn("init-project", _prompt("set up the project")), _spawn("historical-context", _prompt(ASK))])


@pytest.mark.parametrize("test", [ROUTED, AFTER_INIT], ids=["routes-to", "deliverable"])
def test_a_historical_context_spawn_paraphrasing_it_fails(test):
    with pytest.raises(AssertionError, match="no historical-context spawn carries"):
        check(test, [_spawn("historical-context", _prompt("Why did the Flynn children move?"))])


def test_the_deliverable_tag_wins_over_routes_to():
    """Under deliverable:historical-context, init-project carrying the words is not enough."""
    with pytest.raises(AssertionError, match="no historical-context spawn"):
        check(AFTER_INIT, [_spawn("init-project", _prompt(ASK))])


@pytest.mark.parametrize("test", [ROUTED, AFTER_INIT], ids=["routes-to", "deliverable"])
def test_a_person_evidence_spawn_does_not_satisfy_a_historical_context_test(test):
    with pytest.raises(AssertionError, match="no historical-context spawn"):
        check(test, [_spawn("person-evidence", _prompt(ASK))])


def test_no_routing_tag_still_reads_person_evidence():
    check({**TEST, "tags": ["delegates-verbatim"]}, [_spawn("person-evidence", _prompt(WORDS))])


def test_two_deliverable_tags_are_an_error():
    test = {**AFTER_INIT, "tags": [*AFTER_INIT["tags"], "deliverable:locality-guide"]}
    with pytest.raises(AssertionError, match="at most one deliverable:"):
        check(test, [_spawn("historical-context", _prompt(ASK))])
