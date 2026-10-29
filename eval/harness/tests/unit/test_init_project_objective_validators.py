"""Direct tests for init-project's objective validators (#3384).

`pyproject.toml` collects nothing under `validators/`, so without these the
checks would first run inside a paid per-skill eval. `project_create` is
written before the read, so a caller with only an ID names the subject by it
and the tool stores the name; a defaulted objective's report carries one fixed
ask, and a stated one never does.
"""

import sys
from pathlib import Path

import pytest

_HARNESS_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS_ROOT))
sys.path.insert(0, str(_HARNESS_ROOT / "validators"))

from test_init_project import (  # noqa: E402
    _DEFAULT_OBJECTIVE,
    test_defaulted_objective_asks_what_to_learn as check_ask,
    test_objective_and_title_name_the_subject_not_their_id as check_no_id,
    test_objective_kept_in_the_users_words as check_words,
    test_objective_names_the_subject as check_names,
)

ASK = (
    "You did not say what you want to find out, so the project starts with a general goal: "
    "build out the tree and find its gaps. Tell me what you most want to learn, and the "
    "research will focus there."
)


def _create(person_id="LZNY-BRF", resolved="LZNY-BRF", ok=True):
    return {
        "tool": "mcp__genealogy__project_create",
        "args": {"projectPath": "/w", "objective": "o", "personId": person_id},
        "response": {"ok": ok, "subject": {"id": "I1", "familySearchId": resolved, "name": "Patrick Flynn"}},
    }


def _after(objective, title=None):
    project = {"objective": objective, **({"title": title} if title else {})}
    return {"research_json": {"project": project}}


def _fails(fn, *args):
    with pytest.raises(AssertionError) as e:
        fn(*args)
    return str(e.value)


# --- no bare ID is stored -----------------------------------------------------

@pytest.mark.parametrize(
    "objective,title",
    [
        ("Identify the parents of LZNY-BRF.", None),
        ("Identify the parents of Patrick Flynn.", "LZNY-BRF general research"),
        ("Find FamilySearch ID lzny-brf's parents", None),
        ("Identify the parents of OLDX-001.", None),
    ],
    ids=["objective", "title", "labelled-any-case", "requested-merged-id"],
)
def test_a_bare_id_left_in_the_objective_or_title_fails(objective, title):
    calls = [_create(person_id="OLDX-001")]
    assert "by ID" in _fails(check_no_id, _after(objective, title), calls)


@pytest.mark.parametrize(
    "objective,title",
    [
        ("Identify the parents of Patrick Flynn.", "Patrick Flynn's parents"),
        ("Identify the parents of Patrick Flynn (LZNY-BRF).", "Patrick Flynn (FamilySearch ID LZNY-BRF)"),
        (_DEFAULT_OBJECTIVE, None),
        ("Trace XLZNY-BRF and LZNY-BRFX", None),
    ],
    ids=["named", "id-in-parentheses", "default", "longer-tokens"],
)
def test_a_named_objective_passes(objective, title):
    check_no_id(_after(objective, title), [_create()])


@pytest.mark.parametrize("calls", [[], [_create(ok=False)]], ids=["no-create", "refused-create"])
def test_the_id_check_skips_without_a_successful_create(calls):
    with pytest.raises(pytest.skip.Exception):
        check_no_id(_after("Identify the parents of LZNY-BRF."), calls)


# --- the tagged test names the subject ----------------------------------------

TAGGED = {"tags": ["objective-names-subject"]}


def test_an_objective_without_the_name_fails():
    for objective in ("Identify his parents.", "Identify the parents of the subject."):
        assert "does not name Patrick Flynn" in _fails(check_names, _after(objective), [_create()], TAGGED)


def test_an_objective_with_the_name_passes_in_any_case():
    check_names(_after("Identify the parents of PATRICK FLYNN."), [_create()], TAGGED)


def test_the_name_check_skips_untagged():
    with pytest.raises(pytest.skip.Exception):
        check_names(_after("Identify his parents."), [_create()], {"tags": []})


# --- the defaulted ask --------------------------------------------------------

POSITIVE = {"type": "positive", "skill": "init-project", "tags": []}


def _reply(text):
    return [{"subagent_type": "init-project", "text": text}]


def test_a_defaulted_objective_with_the_ask_passes_reflowed():
    reply = "Project created.\n---\n" + ASK.replace("Tell me what you most", "TELL me  what you\nmost")
    check_ask(_after(_DEFAULT_OBJECTIVE), [_create()], "", POSITIVE, _reply(reply))


def test_a_defaulted_objective_without_the_ask_fails():
    reply = "Project created.\n---\nThe objective was not stated, so a general goal was set."
    assert "never asks" in _fails(check_ask, _after(_DEFAULT_OBJECTIVE), [_create()], "", POSITIVE, _reply(reply))


def test_a_stated_objective_with_the_ask_fails():
    reply = "Project created.\n---\n" + ASK
    message = _fails(check_ask, _after("Identify the parents of Patrick Flynn."), [_create()], "", POSITIVE, _reply(reply))
    assert "asks for one" in message


def test_a_stated_objective_without_the_ask_passes():
    check_ask(_after("Identify the parents of Patrick Flynn."), [_create()], "", POSITIVE, _reply("Project created."))


def test_a_direct_test_grades_the_agents_return_not_the_relay():
    direct = {**POSITIVE, "delegation": "Start a project for LZNY-BRF.\n\nprojectPath: <workspace>"}
    with pytest.raises(AssertionError, match="never asks"):
        check_ask(_after(_DEFAULT_OBJECTIVE), [_create()], ASK, direct, _reply("Project created."))


@pytest.mark.parametrize(
    "test,calls",
    [({**POSITIVE, "type": "negative"}, [_create()]), (POSITIVE, []), (POSITIVE, [_create(ok=False)])],
    ids=["negative", "no-create", "refused-create"],
)
def test_the_ask_check_skips_without_a_created_project(test, calls):
    with pytest.raises(pytest.skip.Exception):
        check_ask(_after(_DEFAULT_OBJECTIVE), calls, "", test, _reply(""))


# --- the user's words admit the subject's name --------------------------------

STATED = {"tags": ["objective-stated"], "delegation": "Start a project for LZNY-BRF. I want to identify his parents."}


def test_the_subjects_name_is_not_an_added_word():
    check_words(_after("Identify the parents of Patrick Flynn."), STATED, [_create()])


def test_an_added_direction_still_fails_beside_the_name():
    message = _fails(check_words, _after("Identify the Irish parents of Patrick Flynn."), STATED, [_create()])
    assert "irish" in message


def test_without_a_create_the_name_is_an_added_word():
    assert "flynn" in _fails(check_words, _after("Identify the parents of Patrick Flynn."), STATED, [])
