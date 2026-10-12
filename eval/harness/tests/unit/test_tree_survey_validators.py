"""Direct tests for the tree-survey validators.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected by `make harness-test`; without these, a validator's real pass/fail
set would only appear inside a paid per-skill run. Each check is shown failing
on a planted defect and passing on a legitimate variant (CLAUDE.md, "a new lint
must be proven to fail").
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect the imported
# validators as tests of this module.
import test_tree_survey as v  # noqa: E402

check_once = v.test_tree_gaps_called_once_with_the_delegations_person
check_no_search = v.test_no_search_on_a_tree_with_no_holes
check_no_repeat = v.test_no_call_is_made_twice
check_prose = v.test_no_identifier_after_the_summary_separator
check_ids = v.test_suggestions_are_holes_at_most_five_and_distinct
check_first = v.test_the_hole_with_a_fitting_hint_ranks_first


def call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


def gaps_call(fixture="tree-gaps-many-holes", person="TGAP-ROT"):
    """A tree_gaps call as the orchestrator records it, with the fixture it was served."""
    return {
        "tool": "mcp__genealogy__tree_gaps",
        "args": {"personId": person},
        "response_fixture": fixture,
    }


def survey_test(*, tags=("survey",), person="TGAP-ROT"):
    # The shape the orchestrator threads in: the inner `test` block plus
    # `user_message` (the delegation on a direct test). It carries no
    # `mcp_fixtures`; the served fixture is read off each tool call.
    return {
        "skill": "tree-survey",
        "tags": list(tags),
        "user_message": f"What should I research?\n\npersonId: {person}",
    }


def reply(text):
    return [{"subagent_type": "tree-survey", "text": text}]


GOOD = (
    "TGAP-H3A: Who were the parents of Samuel Weis, born about 1830 in Lancaster?\n"
    "TGAP-H2A: Who were the parents of Hannah Pruitt, born about 1862 in Lancaster?\n"
    "Read 8 generations up and 4 down.\n"
    "Run init-project with that ID and question.\n"
    "---\n"
    "Two people look like good places to start. Pick one."
)


def test_once_passes_on_one_call_and_fails_on_none_or_two():
    t = survey_test()
    check_once([gaps_call()], t)
    with pytest.raises(AssertionError):
        check_once([], t)
    with pytest.raises(AssertionError):
        check_once([gaps_call(), gaps_call()], t)


def test_once_fails_when_the_delegations_person_is_not_used():
    with pytest.raises(AssertionError):
        check_once([gaps_call(person="OTHER-123")], survey_test())
    # A delegation that names no person: no argument is required.
    t = survey_test()
    t["user_message"] = "What should I research in my tree?"
    check_once([call("tree_gaps")], t)


def test_no_search_fires_on_a_search_and_accepts_tree_gaps_alone():
    t = survey_test(tags=("survey", "no-holes"))
    check_no_search([gaps_call()], t)
    for tool in ("record_search", "person_quality", "person_record_matches", "collections_search", "place_search"):
        with pytest.raises(AssertionError):
            check_no_search([gaps_call(), call(tool, x=1)], t)
    # Skipped on a test that has holes.
    with pytest.raises(pytest.skip.Exception):
        check_no_search([call("record_search", surname="x")], survey_test())


def test_no_repeat_fires_on_an_identical_call_and_accepts_different_args():
    t = survey_test()
    check_no_repeat([call("record_search", surname="A"), call("record_search", surname="B")], t)
    with pytest.raises(AssertionError):
        check_no_repeat([call("record_search", surname="A"), call("record_search", surname="A")], t)


def test_prose_fires_on_an_identifier_and_accepts_plain_words():
    t = survey_test()
    check_prose(reply(GOOD), None, t)
    with pytest.raises(AssertionError):
        check_prose(reply(GOOD.replace("Pick one.", "Pick TGAP-H3A.")), None, t)
    with pytest.raises(AssertionError):
        check_prose(reply(GOOD.replace("Pick one.", "Pick LZJW-C31.")), None, t)


def test_a_year_range_in_the_prose_is_not_an_identifier():
    check_prose(reply(GOOD.replace("Pick one.", "He lived 1850-1919. Pick one.")), None, survey_test())


def test_ids_pass_for_hole_people_and_fail_for_a_stray_or_a_sixth_or_a_repeat():
    t = survey_test()
    calls = [gaps_call()]
    check_ids(calls, reply(GOOD), None, t)
    with pytest.raises(AssertionError):
        check_ids(calls, reply(GOOD.replace("TGAP-H2A", "TGAP-ZZZ")), None, t)  # not a hole
    repeat = "\n".join(f"TGAP-H{n}A: q" for n in (1, 1, 2, 3))
    with pytest.raises(AssertionError):
        check_ids(calls, reply(repeat + "\n---\nprose"), None, t)  # a person twice
    six = "\n".join(f"{i}: q" for i in ("TGAP-H1A", "TGAP-H1B", "TGAP-H2A", "TGAP-H3A", "TGAP-H4A", "TGAP-H5B"))
    with pytest.raises(AssertionError):
        check_ids(calls, reply(six + "\n---\nprose"), None, t)  # six people
    # A spouse of a couple hole is a legitimate suggested person.
    check_ids(calls, reply("TGAP-H5B: q\n---\nprose"), None, t)


def test_a_mention_of_an_id_that_is_not_a_suggestion_line_is_not_counted():
    # The hint to the caller names the id again; a bold or numbered lead still counts.
    text = (
        "**1. TGAP-H3A** Who were the parents of Samuel Weis?\n"
        "- TGAP-H2A: Who were the parents of Hannah Pruitt?\n"
        "When you pick one, run init-project with person ID TGAP-H3A.\n"
        "---\nprose"
    )
    check_ids([gaps_call()], reply(text), None, survey_test())


def test_ids_fail_when_no_tree_gaps_fixture_was_served():
    with pytest.raises(AssertionError):
        check_ids([], reply(GOOD), None, survey_test())


def test_ids_skipped_on_a_tree_with_no_holes():
    with pytest.raises(pytest.skip.Exception):
        check_ids([], reply("x\n---\ny"), None, survey_test(tags=("survey", "no-holes")))


def test_ranking_fires_unless_the_fitting_hint_is_first():
    t = survey_test(tags=("survey", "many-holes"))
    check_first(reply(GOOD), None, t)
    with pytest.raises(AssertionError):
        check_first(reply("TGAP-H1B: q\nTGAP-H3A: q\n---\nprose"), None, t)  # a nearer hole first
    with pytest.raises(AssertionError):
        check_first(reply("no identifier here\n---\nprose"), None, t)
    with pytest.raises(pytest.skip.Exception):
        check_first(reply(GOOD), None, survey_test())
