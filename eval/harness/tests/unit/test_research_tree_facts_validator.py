"""Direct tests for `test_research.test_deliverable_spawn_carries_the_tree_facts` (#4381).

The validator runs only on a test tagged `delegates-tree-facts`. The session must hold a
`tree_query` call, and it reads the callee's spawn prompts against the project subject's
tree facts in the after state: every fact year and leading place word must appear, and no
year may appear that is in none of those facts, the session's `tree_query` responses, the
user's message and the objective.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_deliverable_spawn_carries_the_tree_facts as validator  # noqa: E402

QUERIED = [{"tool": "mcp__genealogy__tree_query", "args": {"projectPath": "/p", "personIds": ["I1"]}, "response": {}}]


def check(test, spawns, state, calls=QUERIED):
    validator(test=test, builtin_tool_calls=spawns, tool_calls=calls, after_state=state)

ASK = "For Patrick Flynn, FamilySearch ID LZNY-BRF, can you tell me what took him to Pennsylvania, where he apparently died?"
TEST = {"skill": "research", "user_message": f"/research {ASK}",
        "tags": ["routing", "routes-to:init-project", "bounded-after-init",
                 "deliverable:historical-context", "delegates-tree-facts"]}
FLYNN = {
    "research_json": {"project": {"subject_person_ids": ["I1"]}},
    "tree_gedcomx_json": {"persons": [
        {"id": "I1", "facts": [
            {"type": "Birth", "date": "~1845", "place": "Ireland"},
            {"type": "Death", "date": "1908", "standard_date": "+1908",
             "place": "Schuylkill County, Pennsylvania, United States"},
        ]},
        {"id": "I2", "facts": [{"type": "Birth", "date": "1871", "place": "Boston, Massachusetts"}]},
    ]},
}
EMPTY = {
    "research_json": {"project": {
        "subject_person_ids": ["I1"],
        "objective": "Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, died 1908 in Schuylkill County, PA",
    }},
    "tree_gedcomx_json": {"persons": [{"id": "I1"}]},
}


def _spawn(agent: str, prompt: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent, "prompt": prompt}}


def _prompt(facts: str) -> str:
    return f"projectPath: /tmp/eval-ut_research_ia2-1-1-abcdefgh\nmessage: \"{ASK}\"\ntree: {facts}"


@pytest.mark.parametrize("facts", [
    "born ~1845 in Ireland; died 1908 in Schuylkill County, Pennsylvania",
    "Birth: about 1845, Ireland.\nDeath: 1908,\n  Schuylkill, PA",
    "born c. 1845 in ireland, died 1908 in SCHUYLKILL",
], ids=["plain", "reflowed-and-short", "case"])
def test_passes_when_the_places_and_years_are_carried(facts):
    check(TEST, [_spawn("historical-context", _prompt(facts))], FLYNN)


def test_passes_as_json():
    prompt = json.dumps({"message": ASK, "facts": [{"date": "~1845", "place": "Ireland"},
                                                    {"date": "1908", "place": "Schuylkill County, PA"}]})
    check(TEST, [_spawn("historical-context", prompt)], FLYNN)


@pytest.mark.parametrize("facts, missing", [
    ("born in Ireland; died 1908 in Schuylkill County", "1845"),
    ("born ~1845; died 1908 in Schuylkill County", "Ireland"),
    ("born ~1845 in Ireland; died 1908 in Pennsylvania", "Schuylkill"),
    ("born ~1845 in Ireland; died in Schuylkill County", "1908"),
    ("the tree holds nothing for him", "1845"),
], ids=["no-birth-year", "no-birth-place", "no-death-county", "no-death-year", "none"])
def test_fails_when_a_fact_is_not_carried(facts, missing):
    with pytest.raises(AssertionError, match=missing):
        check(TEST, [_spawn("historical-context", _prompt(facts))], FLYNN)


def test_fails_on_a_year_the_tree_does_not_hold():
    with pytest.raises(AssertionError, match="1852"):
        check(TEST, [_spawn("historical-context", _prompt(
            "born ~1845 in Ireland, likely left in the Famine (1845-1852); died 1908 in Schuylkill County"))], FLYNN)


def test_another_persons_years_are_not_the_subjects():
    with pytest.raises(AssertionError, match="1871"):
        check(TEST, [_spawn("historical-context", _prompt(
            "born ~1845 in Ireland; died 1908 in Schuylkill County; a son born 1871 in Boston"))], FLYNN)


_SON = {"persons": [{"id": "I2", "name": "John Flynn", "facts": [
    {"type": "Birth", "date": "1871", "place": "Boston, Massachusetts"}]}]}


@pytest.mark.parametrize("response", [
    _SON,
    json.dumps(_SON),
    [{"type": "text", "text": json.dumps(_SON)}],
], ids=["dict", "json-string", "content-list"])
def test_a_year_tree_query_returned_is_allowed(response):
    calls = [{"tool": "mcp__genealogy__tree_query", "args": {"projectPath": "/p", "personIds": ["I1", "I2"]},
              "response": response}]
    check(TEST, [_spawn("historical-context", _prompt(
        "born ~1845 in Ireland; died 1908 in Schuylkill County; a son born 1871 in Boston"))], FLYNN, calls)


def test_a_year_from_another_tool_is_not_allowed():
    calls = [*QUERIED, {"tool": "mcp__genealogy__project_context", "args": {"projectPath": "/p"}, "response": _SON}]
    with pytest.raises(AssertionError, match="1871"):
        check(TEST, [_spawn("historical-context", _prompt(
            "born ~1845 in Ireland; died 1908 in Schuylkill County; a son born 1871 in Boston"))], FLYNN, calls)


def test_a_year_in_the_users_message_is_allowed():
    test = {**TEST, "user_message": TEST["user_message"].replace("died?", "died in 1908? He came in 1868.")}
    check(test, [_spawn("historical-context", _prompt(
        "born ~1845 in Ireland; arrived 1868; died 1908 in Schuylkill County"))], FLYNN)


EMPTY_TEST = {"skill": "research", "user_message": "/research For Patrick Flynn's children, can you explain what could be behind their migration patterns?",
              "tags": ["routing", "routes-to:historical-context", "delegates-tree-facts"]}


def test_an_empty_tree_passes_a_prompt_saying_so():
    check(EMPTY_TEST, [_spawn("historical-context", "projectPath: /p\nThe tree holds no places or years for them.")], EMPTY)


def test_an_empty_tree_allows_the_objectives_years():
    check(EMPTY_TEST, [_spawn("historical-context",
                              "projectPath: /p\ntree_query returned none. The project objective states he was "
                              "born ca. 1845 in Pennsylvania and died 1908 in Schuylkill County, PA.")], EMPTY)


def test_an_empty_tree_fails_a_year_beyond_the_objective():
    with pytest.raises(AssertionError, match="1852"):
        check(EMPTY_TEST, [_spawn("historical-context",
                                  "projectPath: /p\nThe objective says born ca. 1845; the Famine ran to 1852.")], EMPTY)


@pytest.mark.parametrize("prompt", [
    "projectPath: /p\nTree data: The project's subject is Patrick Flynn (I1), born ca. 1845 in Pennsylvania, "
    "died 1908 in Schuylkill County, PA.",
    "projectPath: /p\nProject context:\n- Subject: Patrick Flynn, Male, born ca. 1845 in Pennsylvania, died 1908\n"
    "- Objective: identify his parents",
    "projectPath: /p\nProject objective: identify his parents.\n\nborn ca. 1845 in Pennsylvania, died 1908",
], ids=["as-tree-data", "objective-on-another-line", "after-a-blank-line"])
def test_objective_years_not_named_as_the_objectives_fail(prompt):
    """The first two are the shapes of a branch run before the skill sentence named
    the objective and of main's router on ia1."""
    with pytest.raises(AssertionError, match="without naming them as the objective's"):
        check(EMPTY_TEST, [_spawn("historical-context", prompt)], EMPTY)


@pytest.mark.parametrize("prompt", [
    'projectPath: /p\nProject objective: "Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, '
    'died 1908 in Schuylkill County, PA."',
    "projectPath: /p\nProject objective:\nIdentify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania,\n"
    "died 1908 in Schuylkill County, PA",
    "projectPath: /p\nFrom the OBJECTIVE: born c. 1845; d. 1908.",
    'projectPath: /p\nProject objective: "Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, '
    'died 1908 in Schuylkill County, PA."\n\nExplain what children of a man born ca. 1845 in Pennsylvania, '
    "dying in Schuylkill County, would have experienced.",
], ids=["same-line", "under-a-heading", "case", "named-once-then-reused"])
def test_objective_years_named_as_the_objectives_pass(prompt):
    check(EMPTY_TEST, [_spawn("historical-context", prompt)], EMPTY)


def test_an_objective_year_the_tree_also_holds_needs_no_label():
    state = {**FLYNN, "research_json": {"project": {
        "subject_person_ids": ["I1"], "objective": "Find where Patrick Flynn, born 1845, died in 1908"}}}
    check(TEST, [_spawn("historical-context", _prompt(
        "born ~1845 in Ireland; died 1908 in Schuylkill County"))], state)


def test_an_objective_year_is_not_allowed_when_the_objective_lacks_it():
    no_objective = {**EMPTY, "research_json": {"project": {"subject_person_ids": ["I1"]}}}
    with pytest.raises(AssertionError, match="1845"):
        check(EMPTY_TEST, [_spawn("historical-context", "projectPath: /p\nborn ca. 1845")], no_objective)


@pytest.mark.parametrize("calls", [
    [],
    None,
    [{"tool": "mcp__genealogy__project_context", "args": {"projectPath": "/p"}, "response": {}}],
], ids=["no-calls", "none", "project-context-only"])
def test_no_tree_query_call_fails(calls):
    """Main's router on ia1: it read project_context, never tree_query, and handed over the
    objective's years, which the other halves of this check allow."""
    with pytest.raises(AssertionError, match="no tree_query call"):
        check(EMPTY_TEST, [_spawn("historical-context",
                                  "projectPath: /p\nborn ca. 1845 in Pennsylvania, died 1908 (objective)")], EMPTY, calls)


@pytest.mark.parametrize("tool", ["mcp__remote-devices__Genealogy_Research__tree_query",
                                  "mcp__Genealogy_Research__tree_query", "tree_query"])
def test_tree_query_under_any_server_spelling_passes(tool):
    check(EMPTY_TEST, [_spawn("historical-context", "projectPath: /p\nThe tree holds nothing for them.")], EMPTY,
          [{"tool": tool, "args": {"projectPath": "/p"}, "response": {}}])


def test_no_spawn_of_the_callee_fails():
    with pytest.raises(AssertionError, match="no historical-context spawn"):
        check(TEST, [_spawn("init-project", _prompt("born ~1845 in Ireland; died 1908 in Schuylkill County"))], FLYNN)


def test_only_the_callee_spawn_is_read():
    with pytest.raises(AssertionError, match="1845"):
        check(TEST, [_spawn("init-project", _prompt("born ~1845 in Ireland; died 1908 in Schuylkill County")),
                     _spawn("historical-context", _prompt("no facts"))], FLYNN)


def test_two_deliverable_tags_are_an_error():
    test = {**TEST, "tags": [*TEST["tags"], "deliverable:locality-guide"]}
    with pytest.raises(AssertionError, match="at most one deliverable:"):
        check(test, [], FLYNN)


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check({**TEST, "tags": ["routing", "routes-to:init-project"]}, [], FLYNN)
