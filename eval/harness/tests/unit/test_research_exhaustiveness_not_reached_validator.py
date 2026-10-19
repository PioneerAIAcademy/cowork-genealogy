"""Direct tests for the research-exhaustiveness `not_reached` checks (issue #2539).

Same reason as the sibling refusal-validator tests: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's pass/fail set otherwise appears only
inside a paid per-skill run.

Each case builds an after-state from the real scenario the unit test runs on,
so a scenario edit that moves the expected ids fails here, not in a paid run.
Every call expected to pass or assert goes through `_run`, which turns a skip
into a failure.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased: pyproject.toml collects `test_*`, so the names imported as-is would
# be collected here with fixtures pytest cannot supply.
from test_research_exhaustiveness import (  # noqa: E402
    held_wiki_titles,
    test_not_reached_lists_uncaptured_handoffs as _handoff_fn,
    test_not_reached_wiki_title_is_page_title as _wiki_fn,
    uncaptured_handoff_ids,
)

_SCENARIOS = Path(__file__).resolve().parents[3] / "fixtures" / "scenarios"
_HANDOFF_TEST = {"tags": ["research-exhaustiveness", "not-reached-handoff"]}
_WIKI_TEST = {"tags": ["research-exhaustiveness", "not-reached-wiki"]}


def _research(scenario: str) -> dict:
    return json.loads((_SCENARIOS / scenario / "research.json").read_text(encoding="utf-8"))


HANDOFF_BEFORE = _research("recent-birth-handoff-agent-closed")
WIKI_BEFORE = _research("recent-birth-wiki-untouched")


def _declared(before: dict, not_reached: list[dict]) -> dict:
    after = copy.deepcopy(before)
    q = after["questions"][0]
    q["status"] = "exhaustive_declared"
    q["search_stop"] = {
        "stopped_because": "nothing_further_reachable",
        "justification": "Parents established; remaining sources unreachable.",
        "log_entry_ids": ["log_001", "log_002", "log_003"],
        "stop_criteria": {k: "met" for k in (
            "goal_alignment", "repository_breadth", "original_substitution",
            "independent_verification", "evidence_class", "conflict_resolution", "overturn_risk")},
        "not_reached": not_reached,
    }
    return after


def _handoff(log_id: str) -> dict:
    return {"kind": "handed_to_user", "log_entry_id": log_id, "wiki_title": None,
            "description": "Newspapers.com 1936 birth announcement search, handed to the user."}


def _wiki(title) -> dict:
    return {"kind": "wiki_named_untouched", "log_entry_id": None, "wiki_title": title,
            "description": "Utah school census, held offline."}


def _run(fn, before: dict, after: dict, test: dict) -> None:
    try:
        fn({"research_json": before}, {"research_json": after}, test)
    except pytest.skip.Exception as exc:  # a skip here is a broken gate, not a pass
        pytest.fail(f"check skipped instead of running: {exc}")


def test_scenario_has_exactly_the_agent_closed_handoff():
    assert uncaptured_handoff_ids(HANDOFF_BEFORE, "q_001") == ["log_008"]


def test_capture_on_a_later_entry_closes_the_handoff():
    research = copy.deepcopy(HANDOFF_BEFORE)
    research["log"][-1]["external_site"]["capture_received"] = True
    assert uncaptured_handoff_ids(research, "q_001") == []


def test_capture_on_an_earlier_entry_does_not_close_it():
    research = copy.deepcopy(HANDOFF_BEFORE)
    closer = research["log"].pop()
    closer["external_site"]["capture_received"] = True
    research["log"].insert(0, closer)
    assert uncaptured_handoff_ids(research, "q_001") == ["log_008"]


def test_handoff_listed_under_its_own_id_passes():
    _run(_handoff_fn, HANDOFF_BEFORE, _declared(HANDOFF_BEFORE, [_handoff("log_008")]), _HANDOFF_TEST)


@pytest.mark.parametrize("not_reached", [
    pytest.param([_handoff("log_009")], id="cites-the-closer"),
    pytest.param([], id="missing"),
    pytest.param([{**_handoff("log_008"), "kind": "paywalled"}], id="wrong-kind"),
    pytest.param([_handoff("log_008"), {**_handoff("log_009"), "kind": "nil_search"}], id="closer-cited-as-nil-search"),
])
def test_handoff_check_fails(not_reached):
    with pytest.raises(AssertionError):
        _run(_handoff_fn, HANDOFF_BEFORE, _declared(HANDOFF_BEFORE, not_reached), _HANDOFF_TEST)


def test_handoff_check_fails_when_question_never_written():
    with pytest.raises(AssertionError):
        _run(_handoff_fn, HANDOFF_BEFORE, copy.deepcopy(HANDOFF_BEFORE), _HANDOFF_TEST)


def test_scenario_holds_one_wiki_page():
    assert held_wiki_titles(WIKI_BEFORE) == {"utah online genealogy records"}


@pytest.mark.parametrize("title", [
    "Utah_Online_Genealogy_Records",
    "Utah Online Genealogy Records",
    "Utah_Online_Genealogy%20Records",
    "Utah_Online_Genealogy_Records#Offline_Records",
])
def test_wiki_page_title_passes(title):
    _run(_wiki_fn, WIKI_BEFORE, _declared(WIKI_BEFORE, [_wiki(title)]), _WIKI_TEST)


@pytest.mark.parametrize("not_reached", [
    pytest.param([_wiki("online_records")], id="section-enum"),
    pytest.param([_wiki("Utah_Vital_Records")], id="page-not-read"),
    pytest.param([_wiki("  ")], id="blank"),
    pytest.param([_wiki(None)], id="null"),
    pytest.param([], id="missing"),
])
def test_wiki_check_fails(not_reached):
    with pytest.raises(AssertionError):
        _run(_wiki_fn, WIKI_BEFORE, _declared(WIKI_BEFORE, not_reached), _WIKI_TEST)


def test_wiki_check_fails_when_question_never_written():
    with pytest.raises(AssertionError):
        _run(_wiki_fn, WIKI_BEFORE, copy.deepcopy(WIKI_BEFORE), _WIKI_TEST)


def test_checks_skip_without_their_tag():
    after = _declared(HANDOFF_BEFORE, [])
    for fn in (_handoff_fn, _wiki_fn):
        with pytest.raises(pytest.skip.Exception):
            fn({"research_json": HANDOFF_BEFORE}, {"research_json": after}, {"tags": []})


def test_null_urls_do_not_close_each_other():
    research = copy.deepcopy(HANDOFF_BEFORE)
    for entry in research["log"][-2:]:
        entry["external_site"]["url_generated"] = None
    research["log"][-1]["external_site"]["capture_received"] = True
    assert uncaptured_handoff_ids(research, "q_001") == []


def test_capture_on_another_questions_item_is_out_of_scope():
    research = copy.deepcopy(HANDOFF_BEFORE)
    research["log"][-1]["plan_item_id"] = "pli_other_question"
    research["log"][-1]["external_site"]["capture_received"] = True
    assert uncaptured_handoff_ids(research, "q_001") == ["log_008"]
