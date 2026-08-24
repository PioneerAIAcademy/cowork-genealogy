"""Pytest fixtures so validator files can run standalone.

Spec §8: "Developers can also run validators standalone with
`pytest eval/harness/validators/ -v` for debugging."

Each validator function declares some subset of `before_state`,
`after_state`, `tool_calls`, `skill_frontmatter`. The harness's
validator_runner supplies these per-test; pytest needs them as fixtures
when running outside the harness.

The defaults here are empty/None — exercising a single validator under
pytest means overriding the fixture(s) you care about. Example:

    # test_my_skill.py
    @pytest.fixture
    def after_state():
        return {
            "research_json": {...},
            "tree_gedcomx_json": None,
            "files": {},
            "skill_frontmatter": {"name": "my-skill", "allowed-tools": []},
        }

    def test_my_check(after_state, tool_calls):
        ...

Real harness invocations don't use these defaults — they pass concrete
state via `run_validators(...)`.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def before_state() -> dict:
    return {
        "research_json": None,
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


@pytest.fixture
def after_state() -> dict:
    return {
        "research_json": None,
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


@pytest.fixture
def tool_calls() -> list:
    return []


@pytest.fixture
def skills_invoked() -> list:
    """Skills the run delegated to, in call order, from the PreToolUse hook.

    `run_validators` has supplied this all along; conftest had not, so any
    validator declaring it errored under a standalone `pytest validators/`
    with "fixture not found" — which is what `test_tree_edit.py`'s
    `test_check_warnings_runs_after_any_tree_write` (deep dive #1657) does
    today. Empty is the no-delegation case, so it is also the right
    standalone default.
    """
    return []


@pytest.fixture
def blocked_context_calls() -> list:
    """Main-thread calls to subagent-only tools, denied by the PreToolUse hook.

    Empty is the healthy case, so it is also the right standalone default.
    """
    return []


@pytest.fixture
def blocked_protected_writes() -> list:
    """Raw writes to an existing research.json/tree.gedcomx.json, denied by the
    PreToolUse hook (issue #1493).

    Empty is the healthy case, so it is also the right standalone default.
    """
    return []


@pytest.fixture
def skill_frontmatter() -> dict:
    return {}
