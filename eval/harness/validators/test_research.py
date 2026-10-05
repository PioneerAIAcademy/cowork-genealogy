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

from validators_lib import new_log_entries as _new_log_entries

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
    """Plugin agents the research router spawns by ``@plugin:<name>``.

    Read from ``research/SKILL.md`` rather than intersecting skill and agent
    directories: since issue #2822 deleted the proof-conclusion routing skill,
    a spawned row need not have a skill twin, and the intersection silently
    dropped it. Derived rather than listed so a new spawned row is covered
    without a second edit. The derivation is asserted to contain
    ``proof-conclusion`` at the call site: a tree move would otherwise make
    the check below vacuous and green.
    """
    import re
    from pathlib import Path

    plugin = Path(__file__).resolve().parents[3] / "packages" / "engine" / "plugin"
    body = (plugin / "skills" / "research" / "SKILL.md").read_text(encoding="utf-8")
    agents = {p.stem for p in (plugin / "agents").glob("*.md")}
    return set(re.findall(r"@plugin:([a-z][a-z-]*)", body)) & agents


def test_no_paired_skill_shortcut(test, skills_invoked, builtin_tool_calls):
    """On a ``no-shortcut`` test, no paired row but the expected one may be reached.

    Such a test must set ``execution.stop_at_stub`` (the runnability gate
    requires it), so the harness ends the run once the turn of the router's
    first stubbed hand-off is over (#3119), and ``test_routes_to_expected_skill``
    asserts, in call order, that the hand-off is the expected one. So a paired
    row other than the expected one is either that first hand-off itself, which
    the routing check also fails, or one made later in that turn, which the stop
    denies but records, and which only this check sees. Both call mechanisms
    are checked because the routing table reaches its ``@plugin:`` rows by spawn
    and the rest by ``Skill``.
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


# ── Moved from test_search_images.py (issue #2268) ───────────────────────


def _new_result_sidecars(before_state, after_state) -> list[str]:
    """results/*.json paths present in after_state but not before."""
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}
    return sorted(
        path for path in after_files
        if path.startswith("results/")
        and path.endswith(".json")
        and path not in before_files
    )


def test_no_browse_or_writes_on_planning_request(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-browse-no-write): the search-images no-harm invariant
    for a planning/strategy request that should route to research-plan.

    search-images executes a browse and logs it; a pure planning question
    ("which unindexed record sets should I browse next?") must not cause a
    browse to be EXECUTED or anything to be persisted. This is the
    deterministic gate for the grade_on_invariant negative
    ut_research_016: which skill wins the route is a known-unstable
    model prior (the router picks research-plan directly on some runs,
    search-images on others, project-status on others), but the state-harm
    invariant holds under every one of those routes and is what we assert.

    Since the pair conversion (issue #2121) the redirect lives in
    agents/search-images.md's ROUTING section, not in SKILL.md: the routing
    skill delegates first and the AGENT holds volume_search and image_search,
    so the redirect must fire before the agent's first tool call or this
    invariant fails. That is the intended reading of a red here — a gate that
    moved into the agent but did not stay ahead of the tools.
    See docs/specs/unit-test-spec.md.

    Fails iff the run:
      - made a `volume_search` or `image_search` MCP call (a browse was
        executed), or
      - appended a new `log` entry (search-images logs every browse it
        runs; research-plan — the acceptable route — never writes `log`,
        so any new log entry means a search/browse skill actually ran), or
      - wrote a new `results/` sidecar file.

    Deliberately does NOT flag other research.json writes: routing to
    research-plan legitimately writes `plans`/`questions`, which is
    correct behavior, not harm.
    """
    if "no-browse-no-write" not in test.get("tags", []):
        pytest.skip("not a no-browse-no-write scenario")

    # 1. No browse executed.
    browsed = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] in ("volume_search", "image_search")
    ]
    assert not browsed, (
        "planning request must not execute a browse; got "
        f"{[(c.get('tool', '').split('__')[-1], c.get('args')) for c in browsed]}"
    )

    # 2. No new browse log entry (research-plan never writes `log`).
    new_entries = _new_log_entries(before_state, after_state)
    assert not new_entries, (
        "planning request must not append a browse log entry; new log "
        f"ids: {[e.get('id') for e in new_entries]}"
    )

    # 3. No new results/ sidecar file.
    sidecars = _new_result_sidecars(before_state, after_state)
    assert not sidecars, (
        f"planning request must not write a results/ sidecar; got: {sidecars}"
    )


def test_no_browse_executed_on_indexed_search(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-browse-on-indexed): the search-images no-harm invariant
    for an INDEXED name/date/place search that should route to search-records.

    A sibling of test_no_browse_or_writes_on_planning_request, not a copy, and
    the difference is the point. That one forbids ANY new `log` entry because
    its acceptable route (research-plan) never writes `log`. Here the
    acceptable route is search-records, which logs every search it runs — so a
    blanket no-log assertion would fail the correct behaviour, which is the
    second direction CLAUDE.md requires a guard be proven against. This asserts
    only what cannot be legitimate: that no browse was EXECUTED, and that
    nothing claimed one in the audit trail.

    The gate this backstops moved into agents/search-images.md's ROUTING
    section with the pair conversion (issue #2121). Measured on run
    v1_2026-09-22_01-41-09: the agent treated an indexed 1850-census request as
    a browse, and when the browse tools were not available appended a `log`
    entry with `tool: image_search` and told the user the browse "could not be
    conducted" because the tools were "unavailable in this session" — blaming
    the environment for a request it should have redirected. The judge scored
    that a fail on one run and a pass on five others; this makes it a one-line
    deterministic verdict instead of an opinion that moves between runs.

    Fails iff the run:
      - made a `volume_search` or `image_search` MCP call (a browse was
        executed), or
      - appended a new `log` entry whose `tool` names one of those (a browse
        was claimed in the audit trail, whether or not one ran).

    Deliberately does NOT flag a new `log` entry from search-records itself
    (`tool: record_search`), nor a `results/` sidecar: both are what the
    correct route legitimately produces.
    """
    if "no-browse-on-indexed" not in test.get("tags", []):
        pytest.skip("not a no-browse-on-indexed scenario")

    browsed = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] in ("volume_search", "image_search")
    ]
    assert not browsed, (
        "an indexed search must not execute a browse; got "
        f"{[(c.get('tool', '').split('__')[-1], c.get('args')) for c in browsed]}"
    )

    claimed = [
        e for e in _new_log_entries(before_state, after_state)
        if ("image_search" in (e.get("tool") or ""))
        or ("volume_search" in (e.get("tool") or ""))
    ]
    assert not claimed, (
        "an indexed search must not append a browse log entry; got "
        f"{[(e.get('id'), e.get('tool')) for e in claimed]}"
    )
