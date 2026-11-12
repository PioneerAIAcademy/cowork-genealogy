"""Direct tests for tree-edit's `reads-tree` validator (issue #4484).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`; without this file the check is proven only
inside a paid per-skill run. Since PR #4218 tree-edit holds no `Read` and reads
the tree only through `tree_query`, so the check passes on a `tree_query` call
that covers I1 and fails on anything else, a `Read` of the tree included.
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


def _test() -> dict:
    return json.loads(_TEST_FILE.read_text(encoding="utf-8"))["test"]


def _query(args: dict, tool: str = "mcp__genealogy__tree_query", key: str = "args") -> dict:
    return {"tool": tool, key: {"projectPath": "/tmp/ws", **args}}


def test_the_test_carries_the_tag():
    assert "reads-tree" in _test()["tags"]


def test_passes_on_a_tree_query_naming_i1():
    check_reads_tree([_query({"personIds": ["I1"]})], _test())


def test_passes_on_a_whole_tree_query():
    check_reads_tree([_query({"factTypes": ["Birth"]})], _test())


def test_passes_on_an_empty_person_list():
    check_reads_tree([_query({"personIds": []})], _test())


def test_passes_under_the_bridged_spelling():
    check_reads_tree(
        [_query({"personIds": ["I1"]}, tool="mcp__remote-devices__Genealogy_Research__tree_query")],
        _test(),
    )


def test_passes_with_args_under_input():
    check_reads_tree([_query({"personIds": ["I1"]}, key="input")], _test())


def test_fails_with_no_calls():
    with pytest.raises(AssertionError, match="without a tree_query call covering I1"):
        check_reads_tree([], _test())


def test_fails_on_a_read_of_the_tree_file():
    calls = [{"tool": "Read", "args": {"file_path": "/tmp/ws/tree.gedcomx.json"}}]
    with pytest.raises(AssertionError, match="without a tree_query call covering I1"):
        check_reads_tree(calls, _test())


def test_fails_on_a_tree_query_of_another_person_only():
    with pytest.raises(AssertionError, match="without a tree_query call covering I1"):
        check_reads_tree([_query({"personIds": ["I2"]})], _test())


def test_skips_without_the_tag():
    test = dict(_test(), tags=["tree-edit", "no-op-edit"])
    with pytest.raises(pytest.skip.Exception):
        check_reads_tree([], test)
