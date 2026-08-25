"""Deterministic routing validator for the research orchestrator.

Tag-gated on ``routes-to:<skill-name>`` (parsed from ``test.tags``).
Asserts the first entry in ``skills_invoked`` matches the expected sub-skill.

``routes-to:stop`` is the special case where the router should finish
without invoking any sub-skill (e.g., project already completed).

See ``eval/tests/unit/research/README.md`` for the tag convention and
what is / is not covered.
"""

from __future__ import annotations

import pytest


def _expected_skill(test: dict) -> str | None:
    for tag in test.get("tags", []):
        if tag.startswith("routes-to:"):
            return tag.split(":", 1)[1]
    return None


def test_routes_to_expected_skill(skills_invoked, test):
    """The router's first ``Skill`` call must match the ``routes-to:`` tag.

    Graded deterministically rather than by the LLM judge because
    ``skills_invoked`` is ground truth: the PreToolUse hook fires on the
    real ``Skill`` call, so a response that only *narrates* a hand-off
    ("I'll now invoke question-selection") cannot satisfy it.
    """
    expected = _expected_skill(test)
    if expected is None:
        pytest.skip("no routes-to: tag")
    if expected == "stop":
        assert not skills_invoked, (
            "Router should stop without invoking any sub-skill when "
            f"project is completed. skills_invoked={skills_invoked}"
        )
    else:
        assert skills_invoked, (
            f"Router should invoke Skill('{expected}') but made no "
            "Skill call at all."
        )
        assert skills_invoked[0] == expected, (
            f"Router's first Skill call should be '{expected}', "
            f"got '{skills_invoked[0]}'. "
            f"Full list: {skills_invoked}"
        )
