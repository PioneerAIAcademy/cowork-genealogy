"""Direct tests for tree-edit's `reads-tree` validator (issues #4484, #4384).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`; without this file the check is proven only
inside a paid per-skill run. tree-edit holds no `Read` and reads the tree only
through `tree_query`, so the check passes on a `tree_query` whose answer was
`ok` and returned I1 with fact F1, and fails on anything else, a `Read` of the
tree included. It reads the answer, never the call's arguments (chesworthrm,
issue #4484, 2026-11-17).

Both directions: the planted defects must fail, and each legitimate way of
reading the tree must pass.
"""

import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect the validator
# itself (same pattern as test_tree_edit_guardianship_validator.py).
from test_tree_edit import test_verification_reads_the_tree as check_reads_tree  # noqa: E402

_TEST_FILE = _HARNESS.parents[1] / "eval" / "tests" / "unit" / "tree-edit" / "add-birth-fact.json"
I1_WITH_F1 = {"id": "I1", "facts": [{"id": "F1", "type": "Birth", "place": "Ireland"}]}
SERVED = {"ok": True, "persons": [I1_WITH_F1]}
FAILS = "without a served tree_query returning I1 with F1"


def _test() -> dict:
    return json.loads(_TEST_FILE.read_text(encoding="utf-8"))["test"]


def _query(args=None, response=SERVED, prefix="mcp__genealogy__") -> dict:
    return {
        "tool": f"{prefix}tree_query",
        "args": {"projectPath": "/tmp/ws", **(args or {})},
        "response": response,
    }


def test_the_test_carries_the_tag():
    assert "reads-tree" in _test()["tags"]


@pytest.mark.parametrize("args", [
    pytest.param({"personIds": ["I1"]}, id="named"),
    pytest.param({}, id="whole-tree"),
    pytest.param({"personIds": []}, id="empty-person-list"),
])
def test_i1_with_f1_returned_passes(args):
    check_reads_tree([_query(args)], _test())


def test_the_committed_runs_birth_filter_passes():
    response = {"ok": True, "persons": [I1_WITH_F1, {"id": "I2", "facts": [{"id": "F3"}]}]}
    check_reads_tree([_query({"factTypes": ["Birth"]}, response=response)], _test())


def test_a_familysearch_id_lookup_returning_i1_with_f1_passes():
    check_reads_tree([_query({"personIds": ["LZX1-ABC"]})], _test())


@pytest.mark.parametrize("prefix", [
    "mcp__genealogy__",
    "mcp__remote-devices__Genealogy_Research__",
    "mcp__Genealogy_Research__",
])
def test_passes_under_every_server_spelling(prefix):
    check_reads_tree([_query({"personIds": ["I1"]}, prefix=prefix)], _test())


def test_a_stringified_response_still_counts():
    check_reads_tree([_query({"personIds": ["I1"]}, response=json.dumps(SERVED))], _test())


def test_a_later_good_call_passes_after_a_bad_one():
    bad = _query({"personIds": ["I2"]}, response={"ok": True, "persons": [{"id": "I2", "facts": []}]})
    check_reads_tree([bad, _query({"personIds": ["I1"]})], _test())


@pytest.mark.parametrize("response", [
    pytest.param({"ok": True, "persons": [{"id": "I2", "facts": [{"id": "F3"}]}], "missingPersonIds": ["I1"]},
                 id="i1-only-in-missingPersonIds"),
    pytest.param({"ok": True, "persons": [{"id": "I1", "facts": [{"id": "F2", "type": "Death"}]}]},
                 id="death-filter-drops-f1"),
    pytest.param({"ok": False, "persons": [I1_WITH_F1]}, id="ok-false"),
    pytest.param({"ok": True, "persons": [{"id": "I2", "facts": [{"id": "F1"}]}]}, id="i2-only-even-with-an-f1"),
    pytest.param({"ok": True, "persons": [{"id": "I1"}]}, id="i1-with-no-facts"),
    pytest.param({"ok": True, "persons": []}, id="no-persons"),
    pytest.param(None, id="no-response"),
    pytest.param({"ok": True, "persons": 5}, id="persons-not-a-list"),
    pytest.param({"ok": True, "persons": "I1"}, id="persons-a-string"),
    pytest.param({"ok": True, "persons": [{"id": "I1", "facts": "F1"}]}, id="facts-a-string"),
    pytest.param({"ok": True, "persons": [{"id": "I1", "facts": 7}]}, id="facts-not-a-list"),
])
def test_an_answer_without_i1_and_f1_fails(response):
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree([_query({"personIds": ["I1", "I2"]}, response=response)], _test())


def test_no_calls_fails():
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree([], _test())


def test_another_tool_with_a_served_response_fails():
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree([{"tool": "mcp__genealogy__person_read", "response": SERVED}], _test())


def test_a_read_of_the_tree_file_fails():
    calls = [{"tool": "Read", "args": {"file_path": "/tmp/ws/tree.gedcomx.json"}}]
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree(calls, _test())


def test_skips_without_the_tag():
    test = dict(_test(), tags=["tree-edit", "no-op-edit"])
    with pytest.raises(pytest.skip.Exception):
        check_reads_tree([], test)
