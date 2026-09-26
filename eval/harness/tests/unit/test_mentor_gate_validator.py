"""Prove the ``test_mentor_gate_spawned`` validator both ways (issue #2686).

The validator asserts that a ``requires:gps-mentor`` test actually spawned the
``gps-mentor`` agent.  It must:

- FAIL when no ``gps-mentor`` spawn appears in ``builtin_tool_calls``.
- PASS when a ``gps-mentor`` spawn appears, regardless of the ``description``.
- SKIP when the test does not carry the ``requires:gps-mentor`` tag.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "eval" / "harness" / "validators"))


def _validator_mod():
    path = REPO_ROOT / "eval" / "harness" / "validators" / "test_research.py"
    spec = importlib.util.spec_from_file_location("_mentor_gate_test_research", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _spawn(name, description="default description", **extra):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": "p", "description": description}, **extra}


TAGGED_TEST = {"skill": "research", "tags": ["core-trigger", "requires:gps-mentor"]}
UNTAGGED_TEST = {"skill": "research", "tags": ["core-trigger"]}


# --- FAIL: no gps-mentor spawn ---


def test_fails_when_no_gps_mentor_spawned():
    """No gps-mentor in builtin_tool_calls — validator must fail."""
    calls = [
        _spawn("research-plan"),
        {"tool": "Skill", "args": {"skill": "question-selection"}},
        {"tool": "Read", "args": {}},
    ]
    with pytest.raises(AssertionError, match="gps-mentor agent spawn"):
        _validator_mod().test_mentor_gate_spawned(TAGGED_TEST, calls)


def test_fails_on_empty_builtin_tool_calls():
    """Empty call list — validator must fail."""
    with pytest.raises(AssertionError, match="gps-mentor agent spawn"):
        _validator_mod().test_mentor_gate_spawned(TAGGED_TEST, [])


# --- PASS: gps-mentor spawned ---


def test_passes_when_gps_mentor_spawned():
    """Standard gps-mentor spawn — validator must pass."""
    calls = [_spawn("gps-mentor", description="GPS mentor proof-critique for ps_001")]
    _validator_mod().test_mentor_gate_spawned(TAGGED_TEST, calls)


def test_passes_with_different_description():
    """gps-mentor spawn with a non-standard description — must still pass.

    The validator gates on ``subagent_type``, not on the description string.
    """
    calls = [_spawn("gps-mentor", description="Run the mentor gate on the existing proof")]
    _validator_mod().test_mentor_gate_spawned(TAGGED_TEST, calls)


def test_passes_when_gps_mentor_among_other_spawns():
    """gps-mentor spawn mixed with other calls — must pass."""
    calls = [
        _spawn("research-plan"),
        {"tool": "Read", "args": {}},
        _spawn("gps-mentor", description="proof-critique"),
        {"tool": "Skill", "args": {"skill": "search-records"}},
    ]
    _validator_mod().test_mentor_gate_spawned(TAGGED_TEST, calls)


# --- SKIP: untagged test ---


def test_skips_when_tag_absent():
    """A test without ``requires:gps-mentor`` must be skipped, not failed."""
    with pytest.raises(pytest.skip.Exception):
        _validator_mod().test_mentor_gate_spawned(UNTAGGED_TEST, [])


# --- FAIL: nested spawn does not count ---


def test_fails_when_gps_mentor_is_a_nested_spawn():
    """A gps-mentor spawn inside a subagent (``agent_id`` present) is not a
    main-thread spawn and must not satisfy the check."""
    calls = [_spawn("gps-mentor", agent_id="a1")]
    with pytest.raises(AssertionError, match="gps-mentor agent spawn"):
        _validator_mod().test_mentor_gate_spawned(TAGGED_TEST, calls)
