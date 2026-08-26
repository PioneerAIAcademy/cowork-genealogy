"""Deterministic routing validator for the research orchestrator.

Tag-gated on ``routing`` (the AST-recognized gate tag) and
``routes-to:<skill-name>`` (the data tag naming the expected callee).
Asserts the router's first delegation in ``skills_invoked`` matches the
expected sub-skill.

``routes-to:stop`` is the special case where the router should finish
without invoking any sub-skill (e.g., project already completed).

See ``eval/tests/unit/research/README.md`` for the tag convention and
what is / is not covered.
"""

from __future__ import annotations

import pytest

_ROUTES_TO_PREFIX = "routes-to:"


def _expected_skill(test: dict) -> str | None:
    prefix = _ROUTES_TO_PREFIX
    found = [t[len(prefix):] for t in (test.get("tags") or []) if t.startswith(prefix)]
    assert len(found) <= 1, (
        f"a test may declare at most one {prefix}<name> tag; got: {found}"
    )
    value = found[0] if found else None
    if value is not None:
        assert value, f"empty {prefix} tag value — fill in the skill name or remove the tag"
    return value


def test_routes_to_expected_skill(skills_invoked, test):
    """The router's first sub-skill delegation must match the ``routes-to:`` tag.

    ``skills_invoked`` records nested ``Skill`` calls made during the run,
    not the entry-point activation.  For routing tests the skill under test
    is the entry point, so it does not appear in the list — only its
    delegated sub-skills do.

    Graded deterministically rather than by the LLM judge because
    ``skills_invoked`` is ground truth: the PreToolUse hook fires on the
    real ``Skill`` call, so a response that only *narrates* a hand-off
    ("I'll now invoke question-selection") cannot satisfy it.
    """
    if "routing" not in test.get("tags", []):
        pytest.skip("not a routing test")
    expected = _expected_skill(test)
    if expected is None:
        pytest.skip("routing tag present but no routes-to: data tag")
    skill_under_test = test.get("skill", "")
    delegations = [s for s in skills_invoked if s != skill_under_test]
    if expected == "stop":
        assert not delegations, (
            "Router should stop without invoking any sub-skill when "
            f"project is completed. skills_invoked={skills_invoked}"
        )
    else:
        assert delegations, (
            f"Router should invoke Skill('{expected}') but made no "
            f"sub-skill call. skills_invoked={skills_invoked}"
        )
        assert delegations[0] == expected, (
            f"Router's first sub-skill call should be '{expected}', "
            f"got '{delegations[0]}'. "
            f"Full list: {skills_invoked}"
        )
