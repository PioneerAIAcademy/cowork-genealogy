"""Direct tests for tree-edit's namesake-citation validator (issue #4170).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`. The check passes when no fact is added to
I1 and the reply names person-evidence in any wording, and fails on a reply
naming no owner, on an added fact, and on a failed spawn whose runtime text
lists every agent (issue #3935).

The passing reply is the one quoted in #4170, from the #4150 practice run that
the old `hand back … person-evidence` regex failed although the judge scored it
3; the issue elides one clause, filled in here.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
_REPO = _HARNESS.parents[1]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect the validator
# itself (same pattern as test_tree_edit_guardianship_validator.py).
from test_tree_edit import test_namesake_citation_refused_and_handed_back as check_handback  # noqa: E402

_TEST_FILE = _REPO / "eval" / "tests" / "unit" / "tree-edit" / "namesake-citation-hand-back.json"
_TREE = _REPO / "eval" / "fixtures" / "scenarios" / "namesake-planted-absent-spouse" / "tree.gedcomx.json"

_ISSUE_4170_REPLY = (
    "No edit was made. The tree tool refused to add the residence to I1. I1 has a recorded "
    "namesake (`ns_001`) and nothing in the 1860 census ties it to him. The person-evidence "
    "agent owns that link. It needs to tie the 1860 census record to I1 first, for example by "
    "linking another household member who is already in the tree."
)
_HANDBACK_LINE_REPLY = (
    "No edit was made: tree_edit refused the residence on I1 because of namesake ns_001.\n"
    "Hand-back: person-evidence — tie the 1860 census link to I1 or lower it."
)
_NO_OWNER_REPLY = (
    "No edit was made. The tree tool refused to add the residence to I1 because I1 has a "
    "recorded namesake (`ns_001`)."
)
_FAILED_SPAWN_TEXT = (
    "Agent type 'tree-edit' failed to start. Available agents: person-evidence, tree-edit, "
    "search-records, proof-conclusion."
)


def _test() -> dict:
    return json.loads(_TEST_FILE.read_text(encoding="utf-8"))["test"]


def _state(extra_facts: list | None = None) -> dict:
    tree = json.loads(_TREE.read_text(encoding="utf-8"))
    if extra_facts:
        tree = copy.deepcopy(tree)
        person = next(p for p in tree["persons"] if p["id"] == "I1")
        person.setdefault("facts", []).extend(extra_facts)
    return {"tree_gedcomx_json": tree}


def _returns(text: str, is_error: bool = False) -> list[dict]:
    entry = {"subagent_type": "tree-edit", "text": text}
    if is_error:
        entry["is_error"] = True
    return [entry]


def _check(reply: str, after: dict | None = None, returns: list[dict] | None = None, test: dict | None = None):
    check_handback(
        _state(),
        after or _state(),
        "",
        test or _test(),
        agent_returns=returns if returns is not None else _returns(reply),
    )


def test_the_test_carries_the_tag():
    assert "namesake-citation" in _test()["tags"]


def test_passes_on_the_issue_4170_reply():
    _check(_ISSUE_4170_REPLY)


def test_passes_on_a_hand_back_line():
    _check(_HANDBACK_LINE_REPLY)


def test_fails_when_no_owner_is_named():
    with pytest.raises(AssertionError, match="does not name person-evidence"):
        _check(_NO_OWNER_REPLY)


def test_fails_when_a_fact_is_added_to_i1():
    residence = {"id": "F9", "type": "Residence", "date": "1860", "place": "Cumru, Berks, Pennsylvania"}
    with pytest.raises(AssertionError, match="facts were added to I1"):
        _check(_ISSUE_4170_REPLY, after=_state([residence]))


def test_fails_on_a_failed_spawn_listing_every_agent():
    with pytest.raises(AssertionError, match="does not name person-evidence"):
        _check("", returns=_returns(_FAILED_SPAWN_TEXT, is_error=True))


def test_skips_without_the_tag():
    test = dict(_test(), tags=["namesake"])
    with pytest.raises(pytest.skip.Exception):
        _check(_ISSUE_4170_REPLY, test=test)
