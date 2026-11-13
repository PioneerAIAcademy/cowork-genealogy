"""Direct tests for research's hand-back routing validator (issue #4358).

`testpaths` excludes `validators/`, which is why these cases live here. A failure
case asserts the exception TYPE: the validator skips on an untagged test, and a
`pytest.raises(AssertionError)` around a skip would skip the caller instead.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = next(q for q in Path(__file__).resolve().parents if (q / "eval/harness/validators").is_dir())
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import test_handback_routing_follows_the_step_group as check  # noqa: E402

SPAWNS = {"tags": ["routing", "handback-spawns:search-external-sites"]}
NO_SPAWN = {"tags": ["routing", "handback-no-spawn:research-plan"]}


def _spawn(agent: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent, "prompt": "go", "run_in_background": "False"}}


def _fail(*args) -> str:
    with pytest.raises(BaseException) as excinfo:
        check(*args)
    assert excinfo.typename == "AssertionError", (
        f"expected the validator to FAIL, got {excinfo.typename}; a skip here passes vacuously"
    )
    return str(excinfo.value)


def test_same_group_spawn_passes():
    check(SPAWNS, [_spawn("search-records"), _spawn("search-external-sites")])


def test_missing_same_group_spawn_fails():
    assert "was not spawned" in _fail(SPAWNS, [_spawn("search-records")])


def test_a_sub_thread_spawn_does_not_count():
    sub = _spawn("search-external-sites") | {"agent_id": "a1"}
    assert "was not spawned" in _fail(SPAWNS, [_spawn("search-records"), sub])


def test_cross_group_spawn_fails():
    assert "mid-turn" in _fail(NO_SPAWN, [_spawn("search-records"), _spawn("research-plan")])


def test_cross_group_not_spawned_passes():
    check(NO_SPAWN, [_spawn("search-records")])


def test_untagged_test_skips():
    with pytest.raises(BaseException) as excinfo:
        check({"tags": ["routing"]}, [])
    assert excinfo.typename == "Skipped"
