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
    declined_skip_items,
    held_wiki_titles,
    test_not_reached_lists_declined_skips as _declined_fn,
    test_not_reached_lists_uncaptured_handoffs as _handoff_fn,
    test_not_reached_wiki_title_is_page_title as _wiki_fn,
    uncaptured_handoff_ids,
)

_SCENARIOS = Path(__file__).resolve().parents[3] / "fixtures" / "scenarios"
_HANDOFF_TEST = {"tags": ["research-exhaustiveness", "not-reached-handoff"]}
_WIKI_TEST = {"tags": ["research-exhaustiveness", "not-reached-wiki"]}
_DECLINED_TEST = {"tags": ["research-exhaustiveness", "not-reached-skipped-item"]}


def _research(scenario: str) -> dict:
    return json.loads((_SCENARIOS / scenario / "research.json").read_text(encoding="utf-8"))


HANDOFF_BEFORE = _research("recent-birth-handoff-agent-closed")
WIKI_BEFORE = _research("recent-birth-wiki-untouched")
DECLINED_BEFORE = _research("flynn-skip-user-declined")


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


def _handed_twice() -> dict:
    """The same URL handed to the user again after the agent's closer."""
    research = copy.deepcopy(HANDOFF_BEFORE)
    again = copy.deepcopy(next(e for e in research["log"] if e["id"] == "log_008"))
    again["id"] = "log_010"
    research["log"].append(again)
    return research


def test_a_repeated_handoff_is_a_handoff_not_a_closer():
    assert uncaptured_handoff_ids(_handed_twice(), "q_001") == ["log_008", "log_010"]


def test_both_listings_of_a_repeated_handoff_pass():
    before = _handed_twice()
    _run(_handoff_fn, before, _declared(before, [_handoff("log_008"), _handoff("log_010")]), _HANDOFF_TEST)


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
    for fn in (_handoff_fn, _wiki_fn, _declined_fn):
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


def _skipped(description: str) -> dict:
    return {"kind": "skipped_plan_item", "log_entry_id": None, "wiki_title": None, "description": description}


def _wrapped_up(before: dict, not_reached: list[dict]) -> dict:
    after = _declared(before, not_reached)
    q = after["questions"][0]
    q["status"] = before["questions"][0]["status"]
    q["search_stop"].update(stopped_because="resources_spent", stop_criteria=None)
    return after


_NEWSPAPER = {"kind": "skipped_plan_item", "log_entry_id": None, "wiki_title": None,
              "description": "Pottsville Republican newspaper obituary (pli_010): microfilm only, not reachable."}


def test_scenario_has_the_struck_and_the_inaccessible_item():
    assert [i["id"] for i in declined_skip_items(DECLINED_BEFORE, "q_001")] == ["pli_009", "pli_010"]


@pytest.mark.parametrize("description", [
    "Naturalization (pli_009) not searched: the researcher declined it.",
    "Thomas Flynn's naturalization papers, 1850-1880: struck by the researcher.",
    "pli_009 skipped at the researcher's request.",
])
def test_declined_skip_listed_passes(description):
    after = _declared(DECLINED_BEFORE, [_skipped(description), _NEWSPAPER])
    _run(_declined_fn, DECLINED_BEFORE, after, _DECLINED_TEST)


def test_declined_skip_listed_on_a_wrap_up_passes():
    after = _wrapped_up(DECLINED_BEFORE, [_skipped("Naturalization search declined by the researcher."), _NEWSPAPER])
    _run(_declined_fn, DECLINED_BEFORE, after, _DECLINED_TEST)


def test_an_inaccessible_item_may_be_listed_under_the_exceptions_kind():
    """On a declaration §3's exception lists an inaccessible source under its own
    kind, so the newspaper item passes as `browse_only` — the other direction
    of requiring an entry for it at all."""
    exception_entry = {**_NEWSPAPER, "kind": "browse_only"}
    after = _declared(DECLINED_BEFORE, [_skipped("Naturalization (pli_009) declined."), exception_entry])
    _run(_declined_fn, DECLINED_BEFORE, after, _DECLINED_TEST)


@pytest.mark.parametrize("not_reached", [
    pytest.param([], id="missing"),
    pytest.param([{**_skipped("Naturalization search declined."), "kind": "deferred"}, _NEWSPAPER], id="wrong-kind"),
    pytest.param([_skipped("1870-1900 census (pli_007) skipped."), _NEWSPAPER], id="names-another-item"),
    pytest.param([_skipped("pli_0090 skipped."), _NEWSPAPER], id="id-inside-a-longer-id"),
    pytest.param([_skipped("Naturalization (pli_009) declined.")], id="inaccessible-missing"),
    pytest.param([{**_skipped("Naturalization (pli_009) declined."), "log_entry_id": "log_006"}, _NEWSPAPER],
                 id="log-entry-id-not-null"),
    pytest.param([_skipped("Naturalization (pli_009) declined."), {**_NEWSPAPER, "wiki_title": "Pennsylvania_Vital_Records"}],
                 id="wiki-title-not-null"),
])
def test_declined_skip_check_fails(not_reached):
    with pytest.raises(AssertionError):
        _run(_declined_fn, DECLINED_BEFORE, _declared(DECLINED_BEFORE, not_reached), _DECLINED_TEST)


def test_declined_skip_check_fails_on_a_wrap_up_without_it():
    with pytest.raises(AssertionError):
        _run(_declined_fn, DECLINED_BEFORE, _wrapped_up(DECLINED_BEFORE, [_NEWSPAPER]), _DECLINED_TEST)


def test_declined_skip_check_fails_when_question_never_written():
    with pytest.raises(AssertionError):
        _run(_declined_fn, DECLINED_BEFORE, copy.deepcopy(DECLINED_BEFORE), _DECLINED_TEST)


def test_a_skip_with_no_category_is_not_required():
    before = copy.deepcopy(DECLINED_BEFORE)
    item = next(i for p in before["plans"] for i in p["items"] if i["id"] == "pli_009")
    del item["skip_category"]
    assert [i["id"] for i in declined_skip_items(before, "q_001")] == ["pli_010"]


def test_a_no_coverage_skip_is_required():
    before = copy.deepcopy(DECLINED_BEFORE)
    item = next(i for p in before["plans"] for i in p["items"] if i["id"] == "pli_009")
    item["skip_category"] = "no_coverage"
    assert [i["id"] for i in declined_skip_items(before, "q_001")] == ["pli_009", "pli_010"]


def test_a_declined_item_awaiting_an_upload_is_not_required():
    before = copy.deepcopy(DECLINED_BEFORE)
    before["log"].append({
        "id": "log_099", "plan_item_id": "pli_009", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Thomas_Flynn",
                          "capture_received": False},
    })
    assert [i["id"] for i in declined_skip_items(before, "q_001")] == ["pli_010"]
    after = _declared(before, [{**_handoff("log_099"), "description": "Ancestry naturalization search, handed to the user."},
                               _NEWSPAPER])
    _run(_declined_fn, before, after, _DECLINED_TEST)
