"""Deterministic routing validator for the research orchestrator.

Tag-gated on ``routing`` (the AST-recognized gate tag) and
``routes-to:<skill-name>`` (the data tag naming the expected callee).
Asserts the router's first hand-off — a ``Skill`` call or an agent spawn,
read by ``handoffs`` — matches the expected callee.

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


def test_routes_to_expected_skill(skills_invoked, builtin_tool_calls, test):
    """The router's first hand-off must match the ``routes-to:`` tag.

    A hand-off is a ``Skill`` call or a main-thread agent spawn, read in call
    order by ``handoffs``: a callee converted from a skill to an agent is
    reached by spawn and never appears in ``skills_invoked`` (issue #2825).
    The skill under test appears in the list when the model reached it
    through a ``Skill`` call and not when it was entered as a slash command.
    Both shapes are filtered the same way below.  Whether the skill under
    test ran at all is gated by the harness (``orchestrator.py``), not here.

    Graded deterministically rather than by the LLM judge because the hook
    records are ground truth: the PreToolUse hook fires on the real call, so
    a response that only *narrates* a hand-off ("I'll now invoke
    question-selection") cannot satisfy it.
    """
    from harness.skill_runner import handoffs

    if "routing" not in test.get("tags", []):
        pytest.skip("not a routing test")
    expected = _expected_skill(test)
    if expected is None:
        pytest.skip("routing tag present but no routes-to: data tag")
    handed = handoffs(skills_invoked, builtin_tool_calls)
    skill_under_test = test.get("skill", "")
    if skill_under_test in handed:
        tail = handed[handed.index(skill_under_test) + 1 :]
    else:
        tail = list(handed)
    delegations = [s for s in tail if s != skill_under_test]
    if expected == "stop":
        assert not delegations, (
            "Router should stop without handing off when project is "
            f"completed. handoffs={handed}"
        )
    else:
        assert delegations, (
            f"Router should hand off to '{expected}' but made no "
            f"Skill call or agent spawn. handoffs={handed}"
        )
        assert delegations[0] == expected, (
            f"Router's first hand-off should be '{expected}', "
            f"got '{delegations[0]}'. "
            f"Full list: {handed}"
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


def _paired_names() -> set[str]:
    """Names that ship BOTH as a skill directory and as a plugin agent file.

    Derived rather than listed so a fourth pair is covered without a second
    edit. The derivation is asserted non-empty at the call site: a tree move
    would otherwise make the check below vacuous and green.
    """
    from pathlib import Path

    plugin = Path(__file__).resolve().parents[3] / "packages" / "engine" / "plugin"
    skills = {p.name for p in (plugin / "skills").iterdir() if p.is_dir()}
    agents = {p.stem for p in (plugin / "agents").glob("*.md")}
    return skills & agents


def test_mentor_gate_spawned(test, builtin_tool_calls):
    """On a ``requires:gps-mentor`` test, the main thread must spawn gps-mentor.

    The research orchestrator's routing table requires a proof-critique via
    ``gps-mentor`` before continuing research when a proof summary exists with
    no evaluation.  The judge cannot see ``builtin_tool_calls`` (issue #2686),
    so it credits a run that narrates the gate without spawning the agent.
    This validator checks the ground truth directly.
    """
    from harness.skill_runner import spawned_agents

    if "requires:gps-mentor" not in test.get("tags", []):
        pytest.skip("not a requires:gps-mentor test")

    agents = spawned_agents(builtin_tool_calls)
    assert "gps-mentor" in agents, (
        "The mentor gate requires a gps-mentor agent spawn, but none was "
        f"found in builtin_tool_calls. spawned_agents={agents}"
    )


def test_no_paired_skill_shortcut(test, skills_invoked, builtin_tool_calls):
    """On a ``no-shortcut`` test, no paired row may be reached at all.

    ``test_routes_to_expected_skill`` asserts only the FIRST delegation, and it
    reads ``skills_invoked``, which ``skill_runner.py:654`` gates on
    ``tool_name == "Skill"``. So a router that spawns
    ``Agent(@plugin:proof-conclusion)`` and then calls
    ``Skill(question-selection)`` satisfies it — ``delegations[0]`` is the
    expected name — while doing the exact thing ut_research_015 exists to
    forbid. Both call mechanisms are checked here because the routing table
    now reaches these three rows by spawn and the rest by ``Skill``.
    """
    from harness.skill_runner import spawned_agents

    if "no-shortcut" not in test.get("tags", []):
        pytest.skip("not a no-shortcut test")

    paired = _paired_names()
    assert "proof-conclusion" in paired, (
        "paired-name derivation found no `proof-conclusion` under "
        "packages/engine/plugin — the plugin tree moved and this check would "
        f"pass vacuously. Found: {sorted(paired)}"
    )

    allowed = _expected_skill(test)
    reached = [
        (kind, name)
        for kind, names in (
            ("Agent", spawned_agents(builtin_tool_calls)),
            ("Skill", list(skills_invoked)),
        )
        for name in names
        if name in paired and name != allowed and name != test.get("skill", "")
    ]
    assert not reached, (
        "the router reached a paired row on a no-shortcut test: "
        + ", ".join(f"{kind}({name})" for kind, name in reached)
        + ". A user naming a downstream skill is a destination, not a "
        "shortcut — the router must re-derive state and walk the table from "
        f"the top. Expected route: {allowed!r}. "
        f"spawned_agents={spawned_agents(builtin_tool_calls)} "
        f"skills_invoked={list(skills_invoked)}"
    )
