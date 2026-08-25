"""Pytest fixtures so validator files can run standalone.

Spec §8: "Developers can also run validators standalone with
`pytest eval/harness/validators/ -v` for debugging."

Each validator function declares some subset of the arguments the harness
injects. The harness's validator_runner supplies these per-test; pytest needs
them as fixtures when running outside the harness.

**This file must define a fixture for every key in `validator_runner.py`'s
`available_args`.** A missing one does not fail loudly — it errors only the
validators that declare it, and only under standalone pytest, which CI never
runs (`pyproject.toml` sets `testpaths = ["tests"]`, so `make harness-test`
never collects this directory). `test`, `skills_invoked` and
`attempted_mcp_calls` were absent for months that way, erroring all 15
validators in `test_search_wikipedia.py` on the exact command §8 documents.
When you add an arg there, add its fixture here.

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

import sys
from pathlib import Path

import pytest

# `validator_runner._run_module` puts this directory on `sys.path` before
# importing a validator, so `from validators_lib import ...` resolves under the
# harness. Standalone pytest does not, so 11 of the validator files failed to
# import at collection time on the same command §8 documents. Same class of gap
# as the missing fixtures below, one layer up: the harness path worked, the
# documented debugging path did not, and nothing failed loudly because
# `pyproject.toml` pins `testpaths = ["tests"]` so CI never collects here.
sys.path.insert(0, str(Path(__file__).resolve().parent))


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


@pytest.fixture
def test() -> dict:
    """The parsed test JSON's inner `test` block, plus the validator-facing
    top-level blocks the orchestrator threads in.

    Empty is the right standalone default: every validator that declares this
    reads `test["tags"]` to decide whether it applies, and an empty dict makes
    a tag-gated check skip rather than fire on state it was never given.
    """
    return {}


@pytest.fixture
def skills_invoked() -> list:
    """Every skill invoked through the SDK's `Skill` tool, in call order.

    Empty is the healthy default for a validator asserting a skill did NOT
    delegate; one asserting a required hand-off should override it.
    """
    return []


@pytest.fixture
def attempted_mcp_calls() -> list:
    """MCP calls the model emitted that never reached a fixture match, denied
    by policy, fixture caps or aborts.

    Distinct from `tool_calls`, which records only successful dispatches.
    Empty is the healthy case, so it is also the right standalone default.
    """
    return []


@pytest.fixture
def text_response() -> str:
    """Every assistant text block concatenated, not the final reply alone.

    Empty is the right standalone default for the same reason the lists above
    default empty: a validator asserting a reply does NOT contain something
    should pass on no reply, and one asserting it does should be exercised by
    overriding this fixture with the text under test.
    """
    return ""
