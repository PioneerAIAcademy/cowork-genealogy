"""Direct tests for tree-edit's `reads-tree` validator (issues #4484, #4384).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`; without this file the check is proven only
inside a paid per-skill run. tree-edit holds no `Read` and reads the tree only
through `tree_query`, so the check passes on a `tree_query` that was served
(`ok` with persons) and that covered I1, and fails on anything else, a `Read`
of the tree included.

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
SERVED = {"ok": True, "persons": [{"id": "I1"}]}
FAILS = "without a served tree_query covering I1"


def _test() -> dict:
    return json.loads(_TEST_FILE.read_text(encoding="utf-8"))["test"]


def _query(args=None, response=SERVED, prefix="mcp__genealogy__", key="args") -> dict:
    return {
        "tool": f"{prefix}tree_query",
        key: {"projectPath": "/tmp/ws", **(args or {})},
        "response": response,
    }


def test_the_test_carries_the_tag():
    assert "reads-tree" in _test()["tags"]


@pytest.mark.parametrize("prefix", [
    "mcp__genealogy__",
    "mcp__remote-devices__Genealogy_Research__",
    "mcp__Genealogy_Research__",
])
def test_a_served_query_naming_i1_passes_under_every_server_spelling(prefix):
    check_reads_tree([_query({"personIds": ["I1"]}, prefix=prefix)], _test())


def test_a_stringified_response_still_counts():
    check_reads_tree([_query({"personIds": ["I1"]}, response=json.dumps(SERVED))], _test())


def test_a_whole_tree_query_passes():
    check_reads_tree([_query({"factTypes": ["Birth"]})], _test())


def test_an_empty_person_list_passes():
    check_reads_tree([_query({"personIds": []})], _test())


def test_args_under_input_pass():
    check_reads_tree([_query({"personIds": ["I1"]}, key="input")], _test())


@pytest.mark.parametrize("response", [
    {"ok": False, "persons": [{"id": "I1"}]},
    {"ok": True, "persons": []},
    None,
])
def test_an_unserved_query_fails(response):
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree([_query({"personIds": ["I1"]}, response=response)], _test())


def test_no_calls_fails():
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree([], _test())


def test_another_tool_with_a_served_response_fails():
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree([{"tool": "mcp__genealogy__person_read", "response": SERVED}], _test())


def test_a_query_of_another_person_only_fails():
    calls = [_query({"personIds": ["I2"]}, response={"ok": True, "persons": [{"id": "I2"}]})]
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree(calls, _test())


def test_a_read_of_the_tree_file_fails():
    calls = [{"tool": "Read", "args": {"file_path": "/tmp/ws/tree.gedcomx.json"}}]
    with pytest.raises(AssertionError, match=FAILS):
        check_reads_tree(calls, _test())


def test_skips_without_the_tag():
    test = dict(_test(), tags=["tree-edit", "no-op-edit"])
    with pytest.raises(pytest.skip.Exception):
        check_reads_tree([], test)
