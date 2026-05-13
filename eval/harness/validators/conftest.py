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
def skill_frontmatter() -> dict:
    return {}
