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

    ``skills_invoked`` is populated from ``Skill`` tool calls only, so the
    skill under test appears in it when the model reached it through such a
    call and not when it was entered as a slash command.  Both shapes are
    filtered the same way below.  Whether the skill under test ran at all is
    gated by the harness (``orchestrator.py``), not here.

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
    if skill_under_test in skills_invoked:
        tail = skills_invoked[skills_invoked.index(skill_under_test) + 1 :]
    else:
        tail = list(skills_invoked)
    delegations = [s for s in tail if s != skill_under_test]
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


def test_creates_no_project_when_none_exists(before_state, after_state, test):
    """Tag-gated (``research-vs-init-project``) no-harm invariant for the
    no-research-json-yet negative (ut_research_008).

    The user asks to "set up a project and begin", but with no research.json
    the correct move is to route to init-project, not to scaffold a project
    inline. This is why _008 is graded on the invariant (``grade_on_invariant``)
    rather than on routing: with an empty folder the state-safe outcomes are
    several — auto-route to init-project, or load research and decline via
    AskUserQuestion — and the routing check fails the (correct) decline. The
    routing-independent gate is that NO project is created: research.json must
    not exist after the run. Mirrors
    test_citation.py::test_does_not_add_new_source_entries and
    test_conflict_resolution.py::test_creates_no_new_conflict — a pure tag-gate,
    so it never touches any other research test.
    """
    if "research-vs-init-project" not in test.get("tags", []):
        pytest.skip("not a research-vs-init-project scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    assert before is None, (
        "ut_research_008 expects the empty-folder-no-project scenario, which "
        "has no research.json before the run; one was present. Scenario drift — "
        "fix the fixture rather than the skill."
    )
    assert after is None, (
        "research scaffolded a project inline for a no-research-json request; "
        "creating the project is init-project's job. A research.json exists in "
        "the output where none did before — it must route to init-project."
    )
