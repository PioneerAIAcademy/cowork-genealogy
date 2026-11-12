"""`test_verification_reads_the_tree` accepts a served `tree_query` as well as a
Read of tree.gedcomx.json. tree-edit reads the tree through `tree_query`
(agents/tree-edit.md), so a Read-only check could never pass a correct run
(issue #4384; the v5 tree-edit run failed ut_tree_edit_001 twice on it).

Both directions: the planted defects must fail, and each legitimate way of
reading the tree must pass.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_tree_edit import (  # noqa: E402
    test_verification_reads_the_tree as check_reads_tree,
)

TAGGED = {"tags": ["tree-edit", "reads-tree"]}
SERVED = {"ok": True, "persons": [{"id": "I1"}]}


def _query(response, prefix="mcp__genealogy__"):
    return {"tool": f"{prefix}tree_query", "args": {}, "response": response}


@pytest.mark.parametrize("prefix", [
    "mcp__genealogy__",
    "mcp__remote-devices__Genealogy_Research__",
    "mcp__Genealogy_Research__",
])
def test_a_served_tree_query_passes_under_every_server_spelling(prefix):
    check_reads_tree([_query(SERVED, prefix)], [], TAGGED)


def test_a_stringified_response_still_counts():
    import json
    check_reads_tree([_query(json.dumps(SERVED))], [], TAGGED)


@pytest.mark.parametrize("path", [
    "/ws/tree.gedcomx.json",
    "C:" + chr(92) + "ws" + chr(92) + "tree.gedcomx.json",
])
def test_a_read_of_the_tree_file_passes(path):
    check_reads_tree([], [{"tool": "Read", "args": {"file_path": path}}], TAGGED)


@pytest.mark.parametrize("tool_calls,builtin", [
    ([_query({"ok": False, "persons": [{"id": "I1"}]})], []),
    ([_query({"ok": True, "persons": []})], []),
    ([_query(None)], []),
    ([], []),
    ([], [{"tool": "Read", "args": {"file_path": "/ws/research.json"}}]),
    ([{"tool": "mcp__genealogy__person_read", "response": SERVED}], []),
])
def test_a_report_without_reading_the_tree_fails(tool_calls, builtin):
    with pytest.raises(AssertionError, match="without reading"):
        check_reads_tree(tool_calls, builtin, TAGGED)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_reads_tree([], [], {"tags": ["tree-edit"]})
