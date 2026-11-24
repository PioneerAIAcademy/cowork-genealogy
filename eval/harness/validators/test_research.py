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

import re
import json
import string

import pytest

from validators_lib import bare_ark_id, bare_tool_name
from validators_lib import new_log_entries as _new_log_entries
from validators_lib import check_no_gate_stop
from validators_lib import existing_plan_changes, new_plan_ids
from validators_lib import response_strings

_ROUTES_TO_PREFIX = "routes-to:"
_DELIVERABLE_PREFIX = "deliverable:"


def _data_tag(test: dict, prefix: str) -> str | None:
    found = _data_tag_values(test, prefix)
    assert len(found) <= 1, (
        f"a test may declare at most one {prefix}<name> tag; got: {found}"
    )
    value = found[0] if found else None
    if value is not None:
        assert value, f"empty {prefix} tag value — fill in the skill name or remove the tag"
    return value


def _expected_skill(test: dict) -> str | None:
    return _data_tag(test, _ROUTES_TO_PREFIX)


def _deliverable(test: dict) -> str | None:
    """The agent that owns a bounded deliverable, named by a ``deliverable:<agent>``
    tag. A no-project test's first hand-off (``routes-to:``) is init-project, so the
    owner it hands to next needs a tag of its own."""
    return _data_tag(test, _DELIVERABLE_PREFIX)


def test_routes_to_expected_skill(skills_invoked, builtin_tool_calls, test):
    """The router's first hand-off must match the ``routes-to:`` tag.

    A hand-off is a ``Skill`` call or a main-thread agent spawn, read in call
    order by ``handoffs``: a callee converted from a skill to an agent is
    reached by spawn and never appears in ``skills_invoked`` (issue #2825).
    The skill under test appears in the list when the model reached it
    through a ``Skill`` call, and -- since issue #3116 -- also when it was
    entered as a slash command, where it is recorded first.
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
    no-research-json-yet case (ut_research_008, a positive routing test).

    The user asks to "set up a project and begin", but with no research.json
    the correct move is to route to init-project, not to scaffold a project
    inline. The invariant is what this validator pins, whatever the test's own
    grading says: with an empty folder the state-safe outcomes are
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


_NEW_PROJECT_CALLEES = ("init-project", "tree-survey")


def test_no_init_project_on_existing_project(before_state, skills_invoked, builtin_tool_calls):
    """Ungated: with a research.json already present, no hand-off may go to a
    new-project callee (``init-project`` or ``tree-survey``).

    SKILL.md's routing row for "No research.json at all" says "With one present,
    do NOT invoke it". Checked over every hand-off rather than the first, and
    regardless of whether ``project_context`` was called: in research v32 the
    router spawned ``init-project`` on ``mid-research-flynn`` and only then read
    the project (issue #3766), so a "did it read the project?" check passes that
    run.
    """
    from harness.skill_runner import handoffs

    if before_state.get("research_json") is None:
        pytest.skip("no research.json before the run")
    handed = handoffs(skills_invoked, builtin_tool_calls)
    wrong = [s for s in handed if s in _NEW_PROJECT_CALLEES]
    assert not wrong, (
        f"research.json existed before the run, but the router handed off to {wrong}, "
        f"which start a new project. handoffs={handed}"
    )


def test_reads_project_state_before_routing(before_state, tool_calls, test):
    """Tag-gated (``reads-project-first``): with a research.json present, the run
    calls ``project_context``.

    Catches a router that decides without reading the project at all — research
    v32's ut_research_004 asked for a FamilySearch person ID and stopped, with no
    hand-off for ``test_no_init_project_on_existing_project`` to see (issue #3766).

    Presence, not order: ``tool_calls`` carries no caller and is a separate list
    from the spawns in ``builtin_tool_calls``, so the two cannot be ordered. Tag
    only a test with no ``run_agents``: every spawn is then denied and any
    ``project_context`` call is the router's. Not ungated, because a bounded
    request legitimately skips the read (SKILL.md, "Bounded request or job").
    """
    if "reads-project-first" not in test.get("tags", []):
        pytest.skip("not a reads-project-first test")
    assert before_state.get("research_json") is not None, (
        "a reads-project-first test needs a scenario with a research.json; this one "
        "had none. Scenario drift — fix the fixture rather than the skill."
    )
    called = [c for c in tool_calls or [] if bare_tool_name(str(c.get("tool") or "")) == "project_context"]
    assert called, (
        "research.json existed before the run, but the router never called "
        "project_context, so it routed or asked without reading the project. "
        f"tools called: {[bare_tool_name(str(c.get('tool') or '')) for c in tool_calls or []]}"
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
    denies but records, and which only this check sees. A shortcut in a later
    turn is cut off by the stop and never reaches the record. Both call mechanisms
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
    search-images on others, answers directly from project_context on
    others), but the state-harm invariant holds under every one of those
    routes and is what we assert.

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


def test_hint_review_runs_once(skills_invoked, builtin_tool_calls, tool_calls, test):
    """A hint review is one step (research/SKILL.md, "Hint review"): search-hints
    decides and logs the hints itself, and the router relays it and ends the
    turn. A second spawn in the same run could only carry verdicts the researcher
    never stated, and the router logging the hints itself skips the agent.

    Tag-gated on ``hint-review-once``. The test's search-hints stub returns a
    realistic review with its decisions logged.
    """
    from harness.skill_runner import handoffs

    if "hint-review-once" not in test.get("tags", []):
        pytest.skip("not a hint-review test")
    spawns = [h for h in handoffs(skills_invoked, builtin_tool_calls) if h == "search-hints"]
    assert len(spawns) == 1, (
        f"search-hints was handed off {len(spawns)} time(s); the router spawns it once and "
        "ends the turn on its report"
    )
    logs = [c for c in (tool_calls or []) if str(c.get("tool", "")).endswith("__research_log_append")]
    assert not logs, (
        f"the router logged {len(logs)} entry/entries itself after a hint review; search-hints "
        "logs its own decisions"
    )


# The search tools a router must not call itself for a record that is already
# attached: each spends a paid call to re-find what the project holds.
_SEARCH_MCP_TOOLS = frozenset({
    "record_search", "person_search", "fulltext_search", "collections_search",
    "volume_search", "image_search", "external_links_search", "catalog_search",
})


def test_reads_attachments_before_searching(test, tool_calls, attempted_mcp_calls):
    """Tag-gated (``attached-first``). Issue #2813 item 4.

    "Never search for a record that is already attached" yourself.

    Graded on the router's own MCP calls: it runs no search itself. It may learn
    what is attached from ``project_context``'s ``attachedSources`` (the sources
    ``project_create`` stored), from a ``person_read`` / ``source_attachments``
    read, or from a search-records hand-off whose return reports the record as
    attached (lead, 2026-11-24); which one is not graded. That the reply names the
    attached record is the judge's to grade.
    """
    if "attached-first" not in test.get("tags", []):
        pytest.skip("not an attached-first test")

    bare = lambda c: (c.get("tool") or "").rsplit("__", 1)[-1]
    called = [bare(c) for c in (tool_calls or []) if isinstance(c, dict)]
    # ATTEMPTED calls count too. `tool_calls` records only successful dispatches
    # (conftest.py), so a search whose args miss every fixture predicate lands in
    # `attempted_mcp_calls` instead -- and reading only the first list would let
    # the exact behaviour this test forbids pass silently.
    attempted = [bare(c) for c in (attempted_mcp_calls or []) if isinstance(c, dict)]

    searched = [t for t in called + attempted if t in _SEARCH_MCP_TOOLS]
    assert not searched, (
        "The requested record is already attached, so searching for it spends a paid "
        f"call to re-find what the project holds. Search tools called: {searched}"
    )


# ── Moved from test_research_exhaustiveness.py (issue #2738) ───────────


def test_no_gate_stop(before_state, after_state, test):
    """Tag-gated: when the test expects the router to decline an
    exhaustiveness request (near-miss negative), no question should
    transition to `exhaustive_declared` or write a stop-gate `stopped_because`."""
    if "no-exhaustive-declaration" not in test.get("tags", []):
        pytest.skip("not a no-exhaustive-declaration scenario")
    if before_state.get("research_json") is None or after_state.get("research_json") is None:
        pytest.skip("missing research.json for diff")
    bad = check_no_gate_stop(before_state, after_state)
    assert not bad, "Unexpected stop-gate write:\n  - " + "\n  - ".join(bad)

# ---------------------------------------------------------------------------
# `keeps-waiting-page` tag
# ---------------------------------------------------------------------------


def test_keeps_waiting_page(before_state, after_state, tool_calls, builtin_tool_calls, test):
    """Tag-gated: a read page of a held record goes to record-structurer in one
    spawn, which keeps it. The router does not keep it itself, and writes no
    source and no assertion for it."""
    if "keeps-waiting-page" not in test.get("tags", []):
        pytest.skip("not a keeps-waiting-page test")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    waiting = [s["id"] for s in before.get("sources", []) if s.get("image_ark") and not s.get("transcription")]
    assert waiting, "The scenario has no source waiting for its page."

    spawns = [
        c for c in (builtin_tool_calls or [])
        if isinstance(c, dict) and (c.get("args") or {}).get("subagent_type") == "record-structurer"
    ]
    assert len(spawns) == 1, (
        f"Expected one record-structurer spawn for the waiting page; got {len(spawns)}."
    )
    kept_here = [
        c for c in (tool_calls or [])
        if isinstance(c, dict)
        and bare_tool_name(c.get("tool") or "") == "extraction_append"
        and (c.get("args") or {}).get("attachWaitingPages") is True
    ]
    assert not kept_here, "The router kept the page itself; record-structurer keeps it."
    assert len(after.get("sources", [])) == len(before.get("sources", [])), (
        "The router wrote a new source for the waiting page."
    )
    assert len(after.get("assertions", [])) == len(before.get("assertions", [])), (
        "The router wrote an assertion for the waiting page."
    )


# ---------------------------------------------------------------------------
# `negative-status-question` tag (issue #3112)
# ---------------------------------------------------------------------------

# Every research.json id prefix, as `ID_PREFIXES` in
# packages/engine/mcp-server/src/validation/validator.ts declares it (validators
# cannot import the TypeScript; tests/unit/test_status_question_validator.py pins
# the two in step). Plus the tree ids `project_context` hands over (`I1`, `S3`...),
# the kind every measured miss copied from the projection.
_PROJECT_ID_PREFIXES = (
    "rp_", "q_", "pl_", "pli_", "log_", "src_", "a_", "pe_", "rj_", "c_",
    "h_", "t_", "ps_", "ev_", "loc_", "ns_", "hv_",
)
_TREE_ID_PATTERN = r"[FINRS]\d+"
_PROJECT_ID_RE = re.compile(
    r"\b(?:(?:" + "|".join(re.escape(p) for p in _PROJECT_ID_PREFIXES) + r")\d+|" + _TREE_ID_PATTERN + r")\b"
)
_PROJECT_FILES = ("research.json", "tree.gedcomx.json")
_SHAPED_LINE_RE = re.compile(r"^\s*(?:#|\||[-*+]\s|\d+[.)]\s)", re.MULTILINE)


def test_status_question_answered_from_project_context_only(
    tool_calls, builtin_tool_calls, before_state, after_state, text_response, test
):
    """Tag-gated (negative-status-question): a `"where are we?"` request is
    answered by the main thread in one plain paragraph from `project_context`,
    per the lead's 2026-10-06 ruling (issue #3112).

    Deterministic assertions, each a hard assert:

      1. `project_context` was called (a deferred schema loaded through
         ToolSearch still records the call under its qualified name).
      2. No `Read` or `Grep` of `research.json` or `tree.gedcomx.json`: the
         projection is the read path.
      3. No subagent spawn (`Agent` or `Task`): the status answer is the main
         thread's own paragraph.
      4. No `research_append` call: a status question writes nothing.
      5. The main thread's text is one plain paragraph: no line break (so no
         lead-in line and no second paragraph), no heading, list or table line,
         no bold, and no closing question. `text_response` joins every
         main-thread turn, so a narration line before the `project_context`
         call fails this check exactly as a lead-in line does.
      6. No identifier in the reply: no research.json id (`<prefix>_<digits>`
         for any prefix the schema defines) and no tree id (`I1`, `S3`).

    `project_context` is ALWAYS_LOAD, so assertion 1 can hold even with the
    description clause removed; assertions 5 and 6 are the ones that track the
    clause.
    """
    from harness.skill_runner import SPAWN_TOOL_NAMES

    if "negative-status-question" not in test.get("tags", []):
        pytest.skip("not a negative-status-question scenario")

    pc_calls = [c for c in (tool_calls or []) if bare_tool_name(str(c.get("tool") or "")) == "project_context"]
    assert pc_calls, (
        "status question must call project_context — the tool's description "
        "instructs the main thread to answer from it"
    )

    forbidden_reads = []
    for c in (builtin_tool_calls or []):
        if (c.get("tool") or "") not in ("Read", "Grep"):
            continue
        args = c.get("args") or {}
        path = str(args.get("file_path") or args.get("path") or "")
        # A Grep over a directory reaches the file through its `glob` filter.
        glob = str(args.get("glob") or "")
        if path.endswith(_PROJECT_FILES) or any(name in glob for name in _PROJECT_FILES):
            forbidden_reads.append(f"{c.get('tool')} {path} {glob}".strip())
    assert not forbidden_reads, (
        "status question must not read the raw project files; got: "
        f"{forbidden_reads}"
    )

    # Every main-thread spawn, named or not: `spawned_agents()` skips a
    # general-purpose spawn (no `subagent_type`), which is still a delegation.
    spawns = [
        (c.get("args") or {}).get("subagent_type") or "general-purpose"
        for c in (builtin_tool_calls or [])
        if c.get("tool") in SPAWN_TOOL_NAMES and "agent_id" not in c
    ]
    assert not spawns, (
        f"status question must be answered by the main thread, not delegated; got {spawns}"
    )

    appends = [c for c in (tool_calls or []) if bare_tool_name(str(c.get("tool") or "")) == "research_append"]
    assert not appends, (
        "status question must not write to research.json; got "
        f"{len(appends)} research_append call(s)"
    )

    body = (text_response or "").strip()
    shape = []
    if "\n" in body:
        shape.append(f"{len([ln for ln in body.splitlines() if ln.strip()])} lines")
    if _SHAPED_LINE_RE.search(body):
        shape.append("a heading, list or table line")
    if "**" in body:
        shape.append("bold")
    if body.endswith("?"):
        shape.append("a closing question")
    assert body and not shape, (
        "status answer must be ONE plain paragraph with no lead-in, headings, "
        f"tables, lists, bold or closing question; got: {shape or ['an empty reply']}"
    )

    hits = _PROJECT_ID_RE.findall(text_response or "")
    assert not hits, (
        "status answer must contain no project identifiers; found: "
        f"{sorted(set(hits))}"
    )


# ---------------------------------------------------------------------------
# Tree ids in any reply (issue #4669)
# ---------------------------------------------------------------------------

# A FamilySearch ID (PID) is the one identifier narration may show. Its halves
# can look like a tree id (`K835-R12`, `F123-ABC`), so PID-shaped tokens are
# removed before the tree-id search, unless both halves are tree ids: a range
# such as `I1-I5` or `I100-I200` is still caught. Links, and record or image ids
# written without `ark:/`, are removed first: an image id's third part
# (`3:1:939K-8LJ5-F9`) can look like a tree id too.
_LINK_RE = re.compile(r"(?:https?://|ark:/)\S+|\b\d:\d:\S+")
_PID_TOKEN_RE = re.compile(r"\b([A-Za-z0-9]{4})-([A-Za-z0-9]{3,4})\b")
_TREE_ID_RE = re.compile(r"\b" + _TREE_ID_PATTERN + r"\b")
_WHOLE_TREE_ID_RE = re.compile(_TREE_ID_PATTERN)


def _drop_pid(m: re.Match) -> str:
    if _WHOLE_TREE_ID_RE.fullmatch(m.group(1)) and _WHOLE_TREE_ID_RE.fullmatch(m.group(2)):
        return m.group(0)
    return " "


def tree_ids_named(text: str | None) -> list[str]:
    """The tree ids (`I13`, `S2`, `F4`...) a reply names, distinct and sorted."""
    return sorted(set(_TREE_ID_RE.findall(_PID_TOKEN_RE.sub(_drop_pid, _LINK_RE.sub(" ", text or "")))))


def test_reply_names_no_tree_id(text_response):
    """Every research test: the main thread never names a tree id.

    A tester read "she is in the tree as I13" as meaningless. The lead ruled
    (2026-11-19) that a person's FamilySearch ID may be shown instead; tree ids,
    source ids and ARKs stay banned. No exemption for a tree id the user typed.
    """
    hits = tree_ids_named(text_response)
    assert not hits, (
        "the reply names tree ids, which mean nothing to the user; name the "
        f"person, adding the FamilySearch ID when needed. Found: {hits}"
    )


# ── Moved from test_research_plan.py (issue #2116) ─────────────────────
#
# `ut_research_rpn` (formerly `ut_research_plan_003`) moved here when the
# research-plan skill was deleted. Validators load by suite name, so its
# tag-gated invariants move with it; `research-plan-no-new-plan` stays gated in
# test_research_plan.py too, for that suite's review tests.


def test_no_new_plan(before_state, after_state, test):
    """Tag-gated (``research-plan-no-new-plan``): no new ``pl_`` entry."""
    if "research-plan-no-new-plan" not in test.get("tags", []):
        pytest.skip("not a research-plan-no-new-plan scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new_plans = new_plan_ids(before, after)
    assert not new_plans, (
        f"a new plan was written where none was asked for; new plan IDs: {new_plans}"
    )


def test_no_plan_writes_when_resolved(before_state, after_state, test):
    """Tag-gated: on a question whose `search_stop.stopped_because` is
    already a stop-gate value, no run may add or change anything in `plans[]`.

    Covers the gap the other two leave. `test_no_new_plan` catches a whole
    new `pl_` and the universal `test_no_entries_deleted` catches removals;
    neither sees an item **appended to an existing plan** or an existing item
    **edited in place**. Either rewrites the GPS audit trail the declaration
    rests on — and appending to `pl_002` is the obvious way to write a plan
    without creating one.

    This is one of two routing-independent gates for `ut_research_rpn`
    (formerly `ut_research_plan_003`; `grade_on_invariant`): whichever skill ends up handling the prompt, no run
    may leave a mark on `plans[]`. Its companion
    `test_resolved_question_not_reopened` guards the question's own state —
    `status`, `search_stop`, `project.status` — which this one does
    not look at and which is the likelier harm on that prompt. Both are gated
    on the same tag; neither is sufficient alone.
    """
    if "no-plan-writes-when-resolved" not in test.get("tags", []):
        pytest.skip("not a no-plan-writes-when-resolved scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    errors = existing_plan_changes(before, after)
    assert not errors, (
        "a plan was written to a question whose search is already declared "
        "exhaustive:\n  - " + "\n  - ".join(errors)
    )


def test_resolved_question_not_reopened(before_state, after_state, test):
    """Tag-gated: the resolved question's own state must survive untouched.

    Companion to `test_no_plan_writes_when_resolved`, and the more important
    half. That one guards `plans[]`; this guards the fields the ut_003 prompt
    actually tempts the skill to change.

    Why it has to exist here rather than being covered already: the universal
    `test_ownership_table` / `test_tree_ownership_table` **skip themselves on
    negative tests**, and their docstring gives the reason — "a negative test
    where the skill *does* wrongly activate already fails on the routing
    check." `grade_on_invariant: true` is precisely the flag that removes that
    routing check (`orchestrator.py` returns "pass" the moment validators
    pass), so for this test the premise behind the skip is void and nothing
    replaces it. Verified against the real fixture: with a writer-tool call
    present, flipping `q_001` back to open, un-declaring exhaustiveness,
    reopening `project.status`, or rewriting the question text all scored a
    clean pass before this check existed.

    That is the harm the prompt invites. "The probate search came up empty —
    are we done?" tempts reopening the question far more than it tempts adding
    a plan item, and reopening silently undoes a completed GPS proof: the
    declaration and the proof summary both cite the negative probate result.

    Deliberately narrow. A blanket "questions[] must not change" would
    false-fail the legitimate routes — `question-selection` may append a
    follow-on question, which the explanation names as a legitimate answer.
    So this names the specific deltas that are never legitimate here: the
    target question's `status` and `search_stop`, and
    `project.status`. Same shape as
    `test_search_external_sites.py::test_no_external_search_or_log_on_routeaway_negative`.

    Only a writer the test lets run can trip it: every agent spawn a test does
    not name in `execution.run_agents` is denied. ut_research_rpn runs
    `research-plan` and `question-selection`, so a reopen by `proof-conclusion`
    is not observable there.
    """
    if "no-plan-writes-when-resolved" not in test.get("tags", []):
        pytest.skip("not a no-plan-writes-when-resolved scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    def _resolved(research: dict) -> dict:
        return {
            q.get("id"): q
            for q in (research.get("questions") or [])
            if q.get("status") == "resolved"
            or (q.get("search_stop") or {}).get("stopped_because") in {"question_answered", "record_exhausted", "nothing_further_reachable"}
        }

    before_q = _resolved(before)
    if not before_q:
        pytest.skip("no resolved/declared question in the before-state")

    errors: list[str] = []
    after_q = {q.get("id"): q for q in (after.get("questions") or [])}
    for qid, was in before_q.items():
        now = after_q.get(qid)
        if now is None:
            errors.append(f"{qid}: resolved question DELETED")
            continue
        for field in ("status", "search_stop", "question",
                      "resolution_assertion_ids", "resolved"):
            if was.get(field) != now.get(field):
                errors.append(
                    f"{qid}: '{field}' changed {was.get(field)!r} -> "
                    f"{now.get(field)!r} on a question whose search is "
                    f"already declared exhaustive"
                )

    before_status = (before.get("project") or {}).get("status")
    after_status = (after.get("project") or {}).get("status")
    if before_status != after_status:
        errors.append(
            f"project.status changed {before_status!r} -> {after_status!r}"
        )

    assert not errors, (
        "the resolved question's own state was modified:\n  - "
        + "\n  - ".join(errors)
    )

_DELEGATION_FOCUS_TAG = "asserts-delegation-focus"


def _spawn_prompts(builtin_tool_calls, callee: str) -> list[str]:
    """Recorded spawn prompts for ``callee``, read from the hook records.

    Keyed on ``args.subagent_type`` rather than the tool name: committed logs
    record ``"Agent"``, and an older CLI named the same tool ``"Task"``.
    """
    prompts = []
    for call in builtin_tool_calls or []:
        args = call.get("args") or {}
        if args.get("subagent_type") == callee:
            prompts.append(args.get("prompt") or "")
    return prompts


# tag -> (callee, field, value pattern) lines its spawn prompt must carry.
_SPAWN_FIELD_TAGS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "delegates-user-present-no": (("person-evidence", "userPresent", r"no"),),
    "delegates-user-present-no-external": (("search-external-sites", "userPresent", r"no"),),
    "delegates-qs-user-present-no": (("question-selection", "userPresent", r"no"),),
    "delegates-wrap-up": (
        ("research-plan", "planItemIds", r".*pli_\w+"),
        ("research-exhaustiveness", "wrapUp", r"yes"),
        ("proof-conclusion", "wrapUp", r"yes"),
    ),
}


def test_spawn_carries_its_step_mode_fields(test, builtin_tool_calls):
    """Tag-gated (``delegates-user-present-no``,
    ``delegates-user-present-no-external``, ``delegates-qs-user-present-no``,
    ``delegates-wrap-up``). The fields research/SKILL.md's spawn rule passes on a
    "Keep going." or "Wrap it up." turn, or in an autonomous run, sit in the spawn prompt, which the judge cannot see, so they are
    read from the hook records. A field is matched as ``name: value`` on any
    line, case-insensitively, with optional backticks around either side."""
    rules = [r for tag in (test.get("tags") or []) for r in _SPAWN_FIELD_TAGS.get(tag, ())]
    if not rules:
        pytest.skip("not a spawn-field test")
    problems = []
    for callee, field, value in rules:
        prompts = _spawn_prompts(builtin_tool_calls, callee)
        if not prompts:
            problems.append(f"no spawn of '{callee}' to carry {field}")
            continue
        # A router writes these fields in whatever markup the turn is in:
        # `**userPresent:** no`, `"userPresent": "no"` and `planItemIds=pli_001`
        # are all the field being passed, and the first form was failing. So
        # backticks, asterisks and quotes are allowed around either side, and
        # `=` counts as well as `:`. Still rejected, because the field name is
        # anchored and the value ends on a word boundary: `userPresentation: no`,
        # `**wrapUp:** no` where `wrapUp: yes` was required, and a value like
        # `nobody` or `yesterday` that merely starts with the one wanted.
        pattern = re.compile(
            rf"(?<![A-Za-z]){re.escape(field)}[`*\"']*\s*[:=][`*\"']*\s*[`*\"']*(?:{value})\b",
            re.IGNORECASE,
        )
        if not any(pattern.search(p) for p in prompts):
            problems.append(f"'{callee}' spawn lacks {field}: {value}")
    assert not problems, "; ".join(problems)


def test_delegation_names_focus_and_target(test, builtin_tool_calls):
    """The spawn the router actually sent names ``focus:`` and ``target_id:``.

    research/SKILL.md's Second-opinion section requires both on the gps-mentor
    delegation. Both sit verbatim in the recorded spawn args, so they are read
    from the hook records rather than left to the judge, which cannot see them
    and has scored a spawn 3/3 on prose alone. Matched case-insensitively: the
    agent reads "Focus: on-demand. Target_id: project." as both named, and a
    case-sensitive match failed exactly that spawn.
    """
    if _DELEGATION_FOCUS_TAG not in (test.get("tags") or []):
        pytest.skip("not a delegation-focus test")
    expected = _expected_skill(test)
    assert expected and expected != "stop", (
        f"{_DELEGATION_FOCUS_TAG} needs a routes-to:<callee> tag naming the "
        f"callee whose delegation is asserted; got {expected!r}"
    )
    prompts = _spawn_prompts(builtin_tool_calls, expected)
    assert prompts, (
        f"No recorded spawn of '{expected}' to assert a delegation on. "
        f"Either the router never spawned it, or the spawn args stopped "
        f"carrying subagent_type."
    )
    missing = [
        field
        for field in ("focus:", "target_id:")
        if not any(field in p.lower() for p in prompts)
    ]
    assert not missing, (
        f"The '{expected}' delegation omits {missing}. research/SKILL.md "
        f"requires the delegation message to name the focus and the target_id. "
        f"Prompts seen: {[p[:160] for p in prompts]}"
    )


def _agent_spawns(builtin_tool_calls) -> list[dict]:
    """Main-thread ``Agent`` spawns, read from the hook records.

    Keyed on ``args.subagent_type`` rather than the tool name: committed logs
    record ``"Agent"``, and an older CLI named the same tool ``"Task"``, so a
    name-based match could miss whole runs and pass vacuously.

    ``agent_id``'s ABSENCE is what marks the main thread: it is present only
    when the hook fired inside a subagent. Membership, never truthiness, which
    is the same rule ``harness.skill_runner.spawned_agents`` applies. A
    general-purpose spawn carries no ``subagent_type`` and is skipped: it spawned
    no named agent, so there is nothing here to hold to the rule.
    """
    return [
        call for call in builtin_tool_calls or []
        if (call.get("args") or {}).get("subagent_type")
        and "agent_id" not in call

    ]


def _backgrounded(args: dict) -> bool | None:
    """``run_in_background`` as the model sent it: True, False, or None if absent.

    The value arrives as a real bool on some paths and as its string spelling on
    others, so both are read. Anything else is treated as absent rather than
    guessed at.
    """
    if "run_in_background" not in args:
        return None
    raw = args["run_in_background"]
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        lowered = raw.strip().lower()
        if lowered in ("true", "1"):
            return True
        if lowered in ("false", "0"):
            return False
    return None


def test_every_agent_spawn_runs_in_the_foreground(test, builtin_tool_calls, skills_invoked):
    """Decision 27: every ``@plugin:`` spawn carries ``run_in_background: false``.

    A step has to finish inside its own turn. A backgrounded spawn returns
    immediately and the turn ends with the step still running, so the report the
    researcher gets describes nothing and the "Continue with ...?" line offers
    the step after one that never happened.

    Read from the hook records, which hold the model's OWN input before
    `foreground_rewrite` rewrites it. Asserting after the rewrite would pass on
    every run whether the router asked for it or not -- the rewrite is a
    backstop, and this is the check that the prose works without it.

    An absent field fails: the SDK's default is background, so saying nothing is
    saying background.

    **What the committed corpus says.** Recent `research` logs already carry
    ``"False"`` on nearly every spawn (v33 47/47, v35 42/42, v36 46/46; two
    absent in each of v32 and v34), so this is not a check that today's router
    fails wholesale -- it is one that pins behaviour the prose now requires.
    Replayed over the older v9 it does fail.
    """
    # The rule is the router's. When /research never ran, the main thread spawned
    # the agent itself (the triggering tests mined in #4027), and nothing told it
    # to ask for the foreground.
    if "research" not in (skills_invoked or []):
        pytest.skip("the router was not entered")
    spawns = _agent_spawns(builtin_tool_calls)
    if not spawns:
        pytest.skip("no Agent spawn in this run")
    offenders = []
    for call in spawns:
        args = call.get("args") or {}
        if _backgrounded(args) is not False:
            offenders.append(
                f"{args.get('subagent_type')}: run_in_background="
                f"{args.get('run_in_background', '<absent>')!r}"
            )
    assert not offenders, (
        "These spawns did not ask for the foreground: "
        + "; ".join(offenders)
        + ". research/SKILL.md requires `run_in_background: false` on every "
        "spawn (decision 27); an absent field means background."
    )


def _hosted_listing(tool_calls) -> dict:
    """The hosted answer ``project_list`` gave the router, read from the call log."""
    for call in tool_calls or []:
        if bare_tool_name(str(call.get("tool") or "")) == "project_list":
            response = call.get("response")
            if isinstance(response, dict) and response.get("mode") == "hosted":
                return response
    return {}


def _project_context_paths(tool_calls) -> list:
    """The ``projectPath`` of every ``project_context`` call, None where a call sent none."""
    return [
        (c.get("args") or {}).get("projectPath")
        for c in tool_calls or []
        if bare_tool_name(str(c.get("tool") or "")) == "project_context"
    ]


def _listed_paths_named(listing: dict, handoff: str) -> list[str]:
    """The listed projects' paths that ``handoff`` names."""
    listed = [p.get("projectPath") for p in listing.get("projects") or [] if p.get("projectPath")]
    return [p for p in listed if p in handoff]


def _first_handoff_args(callee: str | None, builtin_tool_calls) -> str | None:
    """The first main-thread hand-off to ``callee``, a ``Skill`` call or a spawn,
    as JSON text; None when there is none."""
    from harness.skill_runner import read_skill_tool_input

    for call in builtin_tool_calls or []:
        if "agent_id" in call:
            continue
        args = call.get("args") or {}
        name = read_skill_tool_input(args)[0] if call.get("tool") == "Skill" else args.get("subagent_type")
        if name == callee:
            return json.dumps(args)
    return None


def _quote_and_space_normal(text: str) -> str:
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    return " ".join(text.split())


def test_person_evidence_spawn_carries_the_users_words(test, builtin_tool_calls):
    """Tag-gated (``delegates-verbatim``). research/SKILL.md sends some bounded asks
    to their owner with the message copied verbatim: a researcher who doubts or
    denies that a record is this person to person-evidence (#3601), where a hedge
    relayed as a "no" becomes a rejection the researcher never made; an interpretive
    ask to historical-context (#4381). The callee is the ``deliverable:`` tag, else
    the ``routes-to:`` tag, else person-evidence. The spawn prompt is invisible to
    the judge, so it is read from the hook records. The user message without
    ``/research`` must appear in at least one of the callee's spawn prompts, with
    whitespace collapsed and straight and curly quotes made equal on both sides."""
    if "delegates-verbatim" not in (test.get("tags") or []):
        pytest.skip("not a delegates-verbatim test")
    callee = _deliverable(test) or _expected_skill(test) or "person-evidence"
    message = re.sub(r"^/research\b", "", (test.get("user_message") or "").strip()).strip()
    assert message, "the test has no user message to relay"
    prompts = _spawn_prompts(builtin_tool_calls, callee)
    assert prompts, f"no {callee} spawn to carry the user's words"
    wanted = _quote_and_space_normal(message)
    assert any(wanted in _quote_and_space_normal(p) for p in prompts), (
        f"no {callee} spawn carries the user's message verbatim.\n"
        f"  message: {message!r}\n  prompts: {[p[:400] for p in prompts]!r}"
    )


_YEAR = re.compile(r"\b(1[5-9]\d\d|20\d\d)s?\b")
_PLACE_TAIL = re.compile(r"\s+(?:county|parish|township)$", re.I)


def _subject_fact_marks(state: dict) -> tuple[set[str], set[str]]:
    """The years, and the leading place words, of the project subject's tree facts:
    each fact's `date` and `standard_date` years, and the first comma-separated part
    of its `place` with a trailing County/Parish/Township dropped."""
    research = state.get("research_json") or {}
    tree = state.get("tree_gedcomx_json") or state.get("tree_gedcomx") or {}
    subjects = set((research.get("project") or {}).get("subject_person_ids") or [])
    years: set[str] = set()
    places: set[str] = set()
    for person in tree.get("persons") or []:
        if not isinstance(person, dict) or person.get("id") not in subjects:
            continue
        for fact in person.get("facts") or []:
            if not isinstance(fact, dict):
                continue
            years.update(_YEAR.findall(f"{fact.get('date') or ''} {fact.get('standard_date') or ''}"))
            lead = _PLACE_TAIL.sub("", str(fact.get("place") or "").split(",")[0].strip())
            if lead:
                places.add(lead)
    return years, places


def _historical_context_of(response) -> dict | None:
    """A ``project_context`` response's ``historicalContext``, whether logged as an
    object, as JSON text, or as the MCP content list holding that text."""
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except ValueError:
            return None
    if isinstance(response, list):
        for item in response:
            found = _historical_context_of(item.get("text") if isinstance(item, dict) else item)
            if found:
                return found
        return None
    if isinstance(response, dict):
        if isinstance(response.get("historicalContext"), dict):
            return response["historicalContext"]
        for key in ("content", "text", "result"):
            if key in response and (found := _historical_context_of(response[key])):
                return found
    return None


def test_deliverable_spawn_carries_the_tree_facts(test, builtin_tool_calls, tool_calls, after_state):
    """Tag-gated (``delegates-tree-facts``), issue #4381. research/SKILL.md has the
    router hand historical-context ``project_context``'s ``historicalContext.prompt``,
    the tree's places and years written out by the tool, and never a place or year
    the tree does not hold. The session must hold a ``tree_query`` call or a
    ``project_context`` call that returned ``historicalContext``. Read from the
    callee's spawn prompts (the ``deliverable:`` tag, else ``routes-to:``), against
    the project subject's tree facts in the after state: every fact year and leading
    place word appears, and no year appears that is in none of those facts, the
    session's ``tree_query`` responses and ``historicalContext`` prompt, the user's
    message and the project objective. A year only the objective holds must be named
    as the objective's at least once in the prompt that gives it: on a line saying
    "objective", or under a heading line (one ending in a colon) that does. Places are
    checked one way only: telling an invented place from a real one would need a
    gazetteer."""
    if "delegates-tree-facts" not in (test.get("tags") or []):
        pytest.skip("not a delegates-tree-facts test")
    callee = _deliverable(test) or _expected_skill(test)
    assert callee, "delegates-tree-facts needs a deliverable: or routes-to: tag naming the callee"
    prompts = _spawn_prompts(builtin_tool_calls, callee)
    assert prompts, f"no {callee} spawn to carry the tree's places and years"
    queries = [
        c for c in tool_calls or []
        if isinstance(c, dict) and bare_tool_name(c.get("tool") or "") in ("tree_query", "project_context")
    ]
    assert any(
        bare_tool_name(c.get("tool") or "") == "tree_query" or _historical_context_of(c.get("response"))
        for c in queries
    ), (
        f"the session makes no tree_query call and no project_context call returning historicalContext, "
        f"so what {callee} was handed was not read from the tree"
    )
    text = " ".join(prompts)
    years, places = _subject_fact_marks(after_state or {})
    missing = sorted(y for y in years if not re.search(rf"\b{y}\b", text))
    missing += sorted(p for p in places if p.lower() not in text.lower())
    assert not missing, (
        f"no {callee} spawn names {missing}, which the subject's tree facts hold"
    )
    objective = ((after_state or {}).get("research_json") or {}).get("project") or {}
    objective_years = set(_YEAR.findall(str(objective.get("objective") or "")))
    sourced = years | set(_YEAR.findall(test.get("user_message") or ""))
    sourced |= {
        y for c in queries if bare_tool_name(c.get("tool") or "") == "tree_query"
        for s in response_strings(c.get("response")) for y in _YEAR.findall(s)
    }
    sourced |= {
        y for c in queries if (hc := _historical_context_of(c.get("response")))
        for y in _YEAR.findall(str(hc.get("prompt") or ""))
    }
    invented = sorted(set(_YEAR.findall(text)) - sourced - objective_years)
    assert not invented, (
        f"a {callee} spawn names the year(s) {invented}, which none of the subject's "
        f"tree facts ({sorted(years)}), the tree_query responses, the user's message "
        f"and the project objective hold"
    )
    unnamed = sorted(_unnamed_objective_years(prompts, objective_years - sourced))
    assert not unnamed, (
        f"a {callee} spawn gives the year(s) {unnamed}, which only the project objective "
        f"holds, without naming them as the objective's"
    )


_HEADING_LINE = re.compile(r"^\s*(?:#{1,6}\s.*|\*\*[^*]+\*\*:?|.*:(?:\*\*)?)\s*$")


def _unnamed_objective_years(prompts: list[str], only_objective: set[str]) -> set[str]:
    unnamed: set[str] = set()
    for prompt in prompts:
        heading = ""
        under = False
        given: set[str] = set()
        named: set[str] = set()
        for line in prompt.splitlines():
            if not line.strip():
                if under:
                    heading = ""
                continue
            found = set(_YEAR.findall(line)) & only_objective
            given |= found
            if "objective" in line.lower() or "objective" in heading:
                named |= found
            if _HEADING_LINE.match(line):
                heading, under = line.lower(), False
            else:
                under = True
        unnamed |= given - named
    return unnamed


def test_reply_relays_the_overview(test, text_response):
    """Tag-gated (``relays-overview``), Richard on #4381, 2026-11-17: from
    historical-context the router relays everything above its
    ``### Search implications`` heading (the narrative and its Sources consulted
    list) and not that block, which names agents for the main thread."""
    if "relays-overview" not in (test.get("tags") or []):
        pytest.skip("not a relays-overview test")
    reply = (text_response or "").lower()
    assert re.search(r"(?m)^\W*sources consulted\W*$", reply), (
        "the reply does not relay the overview's Sources consulted list"
    )
    assert "search implications" not in reply, (
        "the reply relays historical-context's Search implications block, which is for the main thread"
    )


def test_new_person_starts_at_new_project_path(test, tool_calls, builtin_tool_calls):
    """Tag-gated (``uses-new-project-path``). The hosted ``project_list`` answer
    lists no project about the message's person, so the first hand-off names
    ``newProjectPath`` and no listed project's path."""
    if "uses-new-project-path" not in (test.get("tags") or []):
        pytest.skip("not a new-project-path test")
    listing = _hosted_listing(tool_calls)
    new_path = listing.get("newProjectPath")
    assert new_path, f"the router never received a hosted project_list answer with a newProjectPath: {listing}"
    callee = _expected_skill(test)
    handoff = _first_handoff_args(callee, builtin_tool_calls)
    assert handoff is not None, f"no hand-off to '{callee}' to read a projectPath from"
    assert new_path in handoff, f"the '{callee}' hand-off must name newProjectPath {new_path!r}; got {handoff[:300]}"
    named = _listed_paths_named(listing, handoff)
    assert not named, f"the '{callee}' hand-off names a listed project's path {named}: {handoff[:300]}"


def test_no_project_reads_no_wrong_project_path(test, tool_calls, builtin_tool_calls):
    """Tag-gated (``no-wrong-project-path``). The hosted ``project_list`` answer
    gives a ``newProjectPath``, so the router reads project state there or not at
    all, never at another path, the working folder included. The first hand-off
    goes to tree-survey, which takes no ``projectPath``, so it names neither
    ``newProjectPath`` nor a listed project's path."""
    if "no-wrong-project-path" not in (test.get("tags") or []):
        pytest.skip("not a no-wrong-project-path test")
    listing = _hosted_listing(tool_calls)
    new_path = listing.get("newProjectPath")
    assert new_path, f"the router never received a hosted project_list answer with a newProjectPath: {listing}"
    read_paths = _project_context_paths(tool_calls)
    other = [p for p in read_paths if p != new_path]
    assert not other, f"project_context was called at a path other than newProjectPath {new_path!r}: {other}"
    callee = _expected_skill(test)
    handoff = _first_handoff_args(callee, builtin_tool_calls)
    assert handoff is not None, f"no hand-off to '{callee}'"
    assert new_path not in handoff, f"the '{callee}' hand-off names newProjectPath {new_path!r}: {handoff[:300]}"
    named = _listed_paths_named(listing, handoff)
    assert not named, f"the '{callee}' hand-off names a listed project's path {named}: {handoff[:300]}"


def test_named_subject_continues_the_listed_project(test, tool_calls, builtin_tool_calls, text_response):
    """Tag-gated (``uses-listed-project``). The message names the one listed
    project's subject, so the router reads that project, the first hand-off names
    its ``projectPath``, and the reply that ends the turn ends with its
    ``projectUrl``."""
    if "uses-listed-project" not in (test.get("tags") or []):
        pytest.skip("not a listed-project test")
    projects = _hosted_listing(tool_calls).get("projects") or []
    assert len(projects) == 1, f"expected a hosted project_list answer listing one project; got {projects}"
    path, url = projects[0].get("projectPath"), projects[0].get("projectUrl")
    read_paths = _project_context_paths(tool_calls)
    assert path in read_paths, f"project_context was never called with the listed projectPath {path!r}: {read_paths}"
    callee = _expected_skill(test)
    handoff = _first_handoff_args(callee, builtin_tool_calls)
    assert handoff is not None and path in handoff, (
        f"the '{callee}' hand-off must name {path!r}; got {(handoff or '')[:300]}"
    )
    lines = [line.strip() for line in (text_response or "").splitlines() if line.strip()]
    assert lines and url in lines[-1], f"the reply that ends the turn must end with {url!r}; its last line: {lines[-1:]}"


def test_bounded_transcription_is_delivered_in_place(
    skills_invoked, builtin_tool_calls, tool_calls, test
):
    """Tag-gated (``transcribes-in-place``). Since #2490 retired the image-reader
    agent, a bounded transcription is the router's own deliverable: it calls
    ``image_transcribe`` with a ``projectPath``, and reads the staged page with
    ``sidecar_read`` on the ``staged.resultsRef`` that call returned, before
    showing it. No hand-off is a transcription hand-off, and a compound ask
    delivers only its first deliverable this turn (step mode, plan section H),
    so there must be none at all."""
    from harness.skill_runner import handoffs

    if "transcribes-in-place" not in test.get("tags", []):
        pytest.skip("not an in-place transcription test")
    transcribes = [
        c for c in (tool_calls or [])
        if bare_tool_name(c.get("tool", "")) == "image_transcribe"
    ]
    assert transcribes, "the bounded transcription never called image_transcribe"
    assert all((c.get("args") or {}).get("projectPath") for c in transcribes), (
        "image_transcribe was called without a projectPath, so nothing was staged"
    )
    refs = {
        ((c.get("response") or {}).get("staged") or {}).get("resultsRef")
        for c in transcribes
    } - {None}
    assert refs, "no image_transcribe call staged its page (no staged.resultsRef came back)"
    # sidecar_read corrects a near-copy of a staged ref (`locateStagedRef`), so a
    # read under a mistyped ref still served the staged page when it answered with
    # that page's length.
    staged_chars = {
        ((c.get("response") or {}).get("digest") or {}).get("chars") for c in transcribes
    } - {None}

    def _reads_staged_page(call: dict) -> bool:
        args = call.get("args") or {}
        if args.get("ref") in refs or set(args.get("refs") or []) & refs:
            return True
        response = call.get("response") or {}
        ref = str(args.get("ref") or "")
        near_copy = any(
            len(ref) == len(r) and sum(a != b for a, b in zip(ref, r)) <= 2 for r in refs
        )
        return (
            near_copy
            and response.get("ok") is True
            and response.get("totalChars") in staged_chars
        )

    read = [
        c for c in (tool_calls or [])
        if bare_tool_name(c.get("tool", "")) == "sidecar_read" and _reads_staged_page(c)
    ]
    assert read, (
        f"the staged page was never read: no sidecar_read on {sorted(refs)}, so "
        "the reply cannot have shown the transcription"
    )
    skill_under_test = test.get("skill")
    delegations = [
        s for s in handoffs(skills_invoked, builtin_tool_calls) if s != skill_under_test
    ]
    assert not delegations, (
        f"a bounded transcription hands off to nothing; got {delegations}"
    )


_READING_TAG = "index-vs-reading"
_INDEX_READING_PREFIX = "index-reading:"
_MACHINE_READING_PREFIX = "machine-reading:"
_ON_LINE_PREFIX = "on-line:"
_AS_WRITTEN_PREFIX = "as-written:"
_AGREED_PREFIX_PREFIX = "agreed-prefix:"
_SURNAME_PREFIX = "surname:"
# `index-reading:blank` is an index entry with no given name at all.
_BLANK_INDEX = re.compile(
    r"\b(no|blank|without|empty|missing|omits?|left\s+out)\b[^.\n]{0,60}\bgiven[\s-]?name"
    r"|\bgiven[\s-]?name\b[^.\n]{0,60}\b(blank|empty|missing|not\s+indexed|left\s+(it\s+)?blank|absent)",
    re.IGNORECASE,
)
# A single machine reading overruling the index, or a repeat pass counted as agreement.
_VERDICT = re.compile(
    r"\bis\s+clear\b|\bimage\s+(is|was)\s+clear\b"
    r"|\bindex\s+(is|was)\s+(wrong|an\s+error|a\s+misread)"
    r"|\bbadly\s+misread|\bpoor\s+attempt"
    r"|\bboth\b[^.\n]*\bagree"
    r"|(?<!not\s)(?<!n't\s)(?<!be\s)(?<!un)(?<!not\sa\s)(?<!not\san\s)\bconfirmed\b"
    r"|\bmore\s+(?:plausible|likely|accurate)\s+reading\b"
    r"|(?<!transcription of the )(?<!transcript of the )(?<!reading of the )(?<!OCR of the )"
    r"\b(?:image|scan)\s+reads\b"
    r"|\bas\s+written\s+on\s+(?:the\s+)?(?:page|image|scan)\b"
    r"|\bindex(?:er)?\s+(?:got\s+it\s+wrong|(?:is|was)\s+(?:incorrect|mistaken))"
    r"|\benumerator\s+wrote\s*:?\s*[\"'“‘]"
    r"|\b(?:correct|true|actual)\s+(?:given\s+)?name\s+(?:is|was)\s+[\"'“‘]?\w"
    r"|\bboth\b[^.\n]*\bmatch(?:es|ed)?\b",
    re.IGNORECASE,
)
# The index called a misread, with nothing denying it between the two words.
_INDEX_MISREAD = re.compile(
    r"\bindex(?:er|ing)?\b(?P<gap>(?:\s+[\w'-]+){0,5}?)\s+misread", re.IGNORECASE
)
# "no doubt", "without question" affirm what follows; they never deny it.
_AFFIRMING = re.compile(r"\b(?:no|without|beyond)\s+(?:a\s+)?(?:doubt|question)\b", re.IGNORECASE)
_GAP_NEGATION = re.compile(r"\b(?:not|never|no)\b|n't\b", re.IGNORECASE)
_NEGATION_WORD = re.compile(r"^(?:not|never|no|cannot|can't|won't|don't|isn't|wasn't)$", re.IGNORECASE)


# "as written on the page" sent to be checked ("to verify the given name as written on the
# page, check the image") asks the researcher to look; it claims nothing.
_TO_CHECK = re.compile(r"\b(?:verify|check|confirm|see|look|compare)\w*\b", re.IGNORECASE)

# "confirmed" is a verdict only about a reading: "the upload is confirmed" is not one.
_ABOUT_A_READING = re.compile(r"\b(?:read\w*|names?|line|transcri\w*|index\w*|spell\w*|given)\b", re.IGNORECASE)


def _clause_around(text: str, start: int, end: int) -> str:
    left = _CLAUSE_BREAK.split(text[:start])[-1]
    right = _CLAUSE_BREAK.split(text[end:])[0]
    return left + text[start:end] + right


def _negated_just_before(text: str, start: int, words: int = 4) -> bool:
    """A negation among the last few words before `start`, in the same clause:
    "I can't say the index is wrong" denies the verdict. Adjacent only, so a
    negation earlier in a long clause cannot excuse a verdict after it."""
    clause = _AFFIRMING.sub(" ", _CLAUSE_BREAK.split(text[:start])[-1])
    return any(_NEGATION_WORD.match(w.strip("\"'*_")) for w in clause.split()[-words:])
# A record's name folded into another record's.
_FOLDED = re.compile(r"\brendering\s+of\b|\bvariant\s+of\b|\bsplit\b", re.IGNORECASE)
# A fold named only to deny it ("neither can be called a variant of the other") is not one.
_NEGATED_CLAUSE = re.compile(r"\b(?:not|neither|nor|never|no|none|cannot)\b|n't\b", re.IGNORECASE)
_CLAUSE_BREAK = re.compile(r"[.!?;:\n—,]")
_SEARCH_CALLEES = ("search-records", "search-images", "search-full-text")
# `_field_values` stops a value at `*`, which is the wildcard this check looks for.
_GIVEN_FIELD = re.compile(
    r"(?<![A-Za-z])(?:given(?:[\s_-]?names?)?|first[\s_-]?name)[`*\"']*\s*[:=][\s`*\"']*"
    r"(?P<v>[A-Za-z][\w*?-]*)",
    re.IGNORECASE,
)


def _one_tag_value(test: dict, prefix: str) -> str | None:
    return _data_tag(test, prefix)


def test_index_and_machine_reading_shown_side_by_side(test, text_response):
    """Tag-gated (``index-vs-reading``), issue #4578. When a record's index and a
    single machine reading of its page disagree, the reply shows both, names the
    line on the image, and calls neither the answer: no "the image is clear", no
    "the index misread it", and no second pass of the same page counted as
    agreement. Requiring the machine reading too is what stops a reply that hides
    it from passing. With an ``as-written:`` tag, the reply also reports that
    record's name as written, never as a rendering or variant of another record's.

    Proven both ways in ``tests/unit/test_research_index_vs_reading_validator.py``.
    """
    if _READING_TAG not in test.get("tags", []):
        pytest.skip(f"not an {_READING_TAG} test")
    reply = _MD_LINK.sub(r"\1", text_response or "").replace("*", "").replace("_", " ")
    index = _one_tag_value(test, _INDEX_READING_PREFIX)
    machine = _one_tag_value(test, _MACHINE_READING_PREFIX)
    line = _one_tag_value(test, _ON_LINE_PREFIX)
    assert index and machine and line, (
        f"an {_READING_TAG} test names {_INDEX_READING_PREFIX}, {_MACHINE_READING_PREFIX} "
        f"and {_ON_LINE_PREFIX} tags; got {test.get('tags')}"
    )
    problems = []
    if index == "blank":
        if not _BLANK_INDEX.search(reply):
            problems.append("it never says the index gives no given name")
    elif not re.search(rf"\b{re.escape(index)}\b", reply, re.IGNORECASE):
        problems.append(f"it never shows the index reading {index!r}")
    if not re.search(rf"\b{re.escape(machine)}\b", reply, re.IGNORECASE):
        problems.append(f"it never shows the machine reading {machine!r}")
    if not re.search(rf"\bline\s*(no\.?|number|#)?\s*{re.escape(line)}\b", reply, re.IGNORECASE):
        problems.append(f"it never points to line {line} on the image")
    verdicts = sorted(
        {m.group(0) for m in _VERDICT.finditer(reply)
         if not _negated_just_before(reply, m.start())
         and not (m.group(0).lower().startswith("as")
                  and _TO_CHECK.search(_CLAUSE_BREAK.split(reply[:m.start()])[-1]))
         and (m.group(0).lower() != "confirmed"
              or (not _NEGATED_CLAUSE.search(_AFFIRMING.sub(" ", _CLAUSE_BREAK.split(reply[:m.start()])[-1]))
                  and _ABOUT_A_READING.search(_clause_around(reply, m.start(), m.end()))))}
        | {m.group(0) for m in _INDEX_MISREAD.finditer(reply)
           if not _GAP_NEGATION.search(m.group("gap"))
           and not _negated_just_before(reply, m.start())}
    )
    if verdicts:
        problems.append(f"it gives a verdict one machine reading cannot support: {verdicts}")
    written = _one_tag_value(test, _AS_WRITTEN_PREFIX)
    if written:
        if not re.search(r"\s+".join(map(re.escape, written.split())), reply, re.IGNORECASE):
            problems.append(f"it never reports the name as written, {written!r}")
        folded = sorted({
            m.group(0) for m in _FOLDED.finditer(reply)
            if not _NEGATED_CLAUSE.search(_AFFIRMING.sub(" ", _CLAUSE_BREAK.split(reply[:m.start()])[-1]))
        })
        if folded:
            problems.append(f"it folds a record's name into another's: {folded}")
    assert not problems, (
        "a single machine reading must be shown beside the index reading, never "
        "over it: " + "; ".join(problems)
    )


_BRIEF_TAG = "brief-no-disputed-reading"
# A sentence that holds the reading as one in doubt, not as her name.
_IN_DOUBT = re.compile(
    r"\b(?:disput\w*|in\s+doubt|unconfirmed|uncertain|proposed\s+reading"
    r"|machine\s+(?:reading|transcription)"
    r"|no\s+(?:linked\s+)?name\s+assertion|not\s+(?:confirmed|supported))\b",
    re.IGNORECASE,
)


def _sentence_around(text: str, start: int, end: int) -> str:
    left = max(text.rfind(c, 0, start) for c in ".!?\n")
    rights = [i for i in (text.find(c, end) for c in ".!?\n") if i != -1]
    return text[left + 1: min(rights) if rights else len(text)]


def test_search_brief_never_carries_the_disputed_reading(test, builtin_tool_calls):
    """Tag-gated (``brief-no-disputed-reading``), issue #4578. A name only a machine
    reading gives is not the subject's name: no search spawn (search-records,
    search-images, search-full-text) writes it as a given name, beside the surname or
    in a given-name field, and a given name a brief does search on is the wildcard on
    the prefix every reading agrees on (``agreed-prefix:``). The disputed reading may
    still appear in a brief as a reading in doubt. The test asks for a search, so a
    run that briefs none fails rather than passing with nothing checked.

    Spawn prompts are read from the hook records, because the judge cannot see them
    (``_spawn_prompts``). Proven both ways in
    ``tests/unit/test_research_index_vs_reading_validator.py``.
    """
    if _BRIEF_TAG not in test.get("tags", []):
        pytest.skip(f"not a {_BRIEF_TAG} test")
    machine = _one_tag_value(test, _MACHINE_READING_PREFIX)
    surname = _one_tag_value(test, _SURNAME_PREFIX)
    prefix = _one_tag_value(test, _AGREED_PREFIX_PREFIX)
    assert machine and surname and prefix, (
        f"an {_READING_TAG} test names {_MACHINE_READING_PREFIX}, {_SURNAME_PREFIX} and "
        f"{_AGREED_PREFIX_PREFIX} tags; got {test.get('tags')}"
    )
    m, s = re.escape(machine), re.escape(surname)
    as_name = re.compile(rf"\b{m}\s+{s}\b|\b{s},?\s+{m}\b", re.IGNORECASE)
    briefs = [(c, p) for c in _SEARCH_CALLEES for p in _spawn_prompts(builtin_tool_calls, c)]
    assert briefs, (
        f"the test asks for a search, but no {', '.join(_SEARCH_CALLEES)} spawn was "
        "briefed, so there is no brief to check"
    )
    problems = []
    for callee, prompt in briefs:
        if any(
            not _IN_DOUBT.search(_sentence_around(prompt, hit.start(), hit.end()))
            for hit in as_name.finditer(prompt)
        ):
            problems.append(f"{callee} was briefed with {machine!r} as the subject's name")
        for g in _GIVEN_FIELD.finditer(prompt):
            if g.group("v").lower() == machine.lower() and not _IN_DOUBT.search(
                _sentence_around(prompt, g.start(), g.end())
            ):
                problems.append(
                    f"{callee} was briefed to search the given name {machine!r}, not {prefix!r}"
                )
    wildcard = re.compile(rf"(?<![A-Za-z]){re.escape(prefix)}", re.IGNORECASE)
    if not any(wildcard.search(prompt) for _, prompt in briefs):
        problems.append(f"no brief searches the given name as {prefix!r}, so the name was dropped")
    assert not problems, (
        "a name only a machine reading gives is a reading in doubt, not the subject's "
        "name: " + "; ".join(problems)
    )


def test_reply_never_names_the_subject_by_the_disputed_reading(test, text_response, builtin_tool_calls):
    """Tag-gated (``brief-no-disputed-reading``), issue #4578. What the researcher
    sees, the reply and each search spawn's ``description`` (the task's label),
    names the subject by the machine reading only as a reading in doubt: the rule
    ``test_search_brief_never_carries_the_disputed_reading`` applies to the prompt.
    Feedback #4510: "Why are you searching for 'Anthony'?"

    Proven both ways in ``tests/unit/test_research_index_vs_reading_validator.py``.
    """
    if _BRIEF_TAG not in test.get("tags", []):
        pytest.skip(f"not a {_BRIEF_TAG} test")
    machine = _one_tag_value(test, _MACHINE_READING_PREFIX)
    surname = _one_tag_value(test, _SURNAME_PREFIX)
    assert machine and surname, (
        f"a {_BRIEF_TAG} test names {_MACHINE_READING_PREFIX} and {_SURNAME_PREFIX} tags; "
        f"got {test.get('tags')}"
    )
    m, s = re.escape(machine), re.escape(surname)
    as_name = re.compile(rf"\b{m}\s+{s}\b|\b{s},?\s+{m}\b", re.IGNORECASE)
    texts = [("the reply", (text_response or "").replace("*", ""))] + [
        (
            f"the {(c.get('args') or {}).get('subagent_type')} task label",
            str((c.get("args") or {}).get("description") or ""),
        )
        for c in builtin_tool_calls or []
        if (c.get("args") or {}).get("subagent_type") in _SEARCH_CALLEES
    ]
    named = sorted({
        where for where, text in texts for hit in as_name.finditer(text)
        if not _IN_DOUBT.search(_sentence_around(text, hit.start(), hit.end()))
    })
    assert not named, (
        f"{', '.join(named)} names the subject {machine!r}, a reading in doubt, as her name"
    )


def test_bounded_first_message_runs_its_deliverable_after_init_project(
    skills_invoked, builtin_tool_calls, agent_returns, text_response, after_state, test
):
    """Tag-gated (``bounded-after-init``). A bounded ask with a PID and no project
    creates the project and runs its deliverable in the same turn (plan section H,
    issue #2813; #4381 for an interpretive ask): the hand-offs are init-project then
    the deliverable's owner — the ``deliverable:`` tag, else search-records —
    repeats allowed and nothing else; init-project made the project; a search is
    handed the subject's tree id, not the FamilySearch ID; no step denial cut it
    short; the reply drops init-project's next-step sentence; and it ends on an
    offer. Which step it offers is the router's call: 2 of 6 scratch runs offered
    "setting up the project" when the router was told to, so a fixed label is not
    pinned.

    A gate denial and a stub's reply both come back as the spawn's result, so a
    denial is told apart by its text, which carries the gate's own reason."""
    from harness.skill_runner import handoffs, load_step_boundary

    if "bounded-after-init" not in test.get("tags", []):
        pytest.skip("not a bounded-first-message test")
    owner = _deliverable(test) or "search-records"
    skill_under_test = test.get("skill")
    taken: list[str] = []
    for name in handoffs(skills_invoked, builtin_tool_calls):
        if name != skill_under_test and name not in taken:
            taken.append(name)
    assert taken == ["init-project", owner], (
        f"a bounded ask with no project hands off to init-project, then "
        f"{owner}, and nothing else; got {taken}"
    )
    research = after_state.get("research_json")
    tree = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx") or {}
    assert research is not None, f"init-project made no project, yet the turn went on to {owner}"
    problems = [
        p for p in (_handed_subject(prompt, tree, research)[1]
                    for prompt in _spawn_prompts(builtin_tool_calls, "search-records")) if p
    ]
    assert not problems, "; ".join(problems)
    boundary = load_step_boundary()
    denial = boundary._DENY_REASON.split("{", 1)[0].strip()
    denied = [
        r.get("subagent_type") for r in (agent_returns or [])
        if denial in (r.get("text") or "")
    ]
    assert not denied, f"the step boundary denied {denied} in the turn that created the project"
    assert "first research question" not in (text_response or ""), (
        "the reply relays init-project's next-step sentence, which a bounded turn leaves out"
    )
    lines = [line.strip() for line in (text_response or "").splitlines() if line.strip()]
    assert boundary.offered_step(text_response) is not None, (
        f"the reply does not end on a \"Continue with …?\" offer: {lines[-1:]}"
    )


def test_bounded_plan_first_message_stops_after_init_project(
    skills_invoked, builtin_tool_calls, text_response, after_state, test
):
    """Tag-gated (``bounded-plan-after-init``). A bounded research-plan ask with a
    PID and no project runs init-project and nothing else, then ends on "Continue
    with `setting up the project`?" (issue #2813, lead 2026-11-10): the researcher
    confirms the question before anything is planned, because question-selection
    is where feedback #4237 drifted. The project exists with no question or plan.
    Unlike the record ask, the reply may keep init-project's next-step sentence:
    on a plan ask the next step is the first research question."""
    from harness.skill_runner import handoffs, load_step_boundary

    if "bounded-plan-after-init" not in test.get("tags", []):
        pytest.skip("not a bounded-plan-first-message test")
    skill_under_test = test.get("skill")
    taken: list[str] = []
    for name in handoffs(skills_invoked, builtin_tool_calls):
        if name != skill_under_test and name not in taken:
            taken.append(name)
    assert taken == ["init-project"], (
        f"a bounded plan ask with no project hands off to init-project and nothing "
        f"else; got {taken}"
    )
    research = after_state.get("research_json")
    assert research is not None, "init-project made no project"
    written = [s for s in ("questions", "plans") if research.get(s)]
    assert not written, f"the turn that created the project wrote {written}"
    lines = [line.strip() for line in (text_response or "").splitlines() if line.strip()]
    offered = load_step_boundary().offered_step(text_response)
    assert offered == "setup", (
        f"the reply must end on \"Continue with `setting up the project`?\"; "
        f"it offers {offered!r}: {lines[-1:]}"
    )


_HANDS_PLAN_ITEM_TAG = "asserts-delegation-plan-item"


def test_delegation_hands_plan_item_verbatim(test, builtin_tool_calls, before_state):
    """Tag-gated: the spawn of ``search-records`` carries a ``plan_item:`` block
    that parses to exactly the plan item research.json holds for the item named.

    research/SKILL.md has the router hand over the plan item it already queried,
    verbatim and unread, so the agent can skip its own research_query (issue
    #3581). Equality of the parsed block against the scenario's own item is what
    separates "verbatim" from "summarised" or "judged"; the judge sees neither.
    """
    if _HANDS_PLAN_ITEM_TAG not in (test.get("tags") or []):
        pytest.skip("not a delegation-plan-item test")
    expected = _expected_skill(test)
    assert expected == "search-records", (
        f"{_HANDS_PLAN_ITEM_TAG} needs routes-to:search-records; got {expected!r}"
    )
    prompts = _spawn_prompts(builtin_tool_calls, expected)
    assert prompts, "No recorded spawn of 'search-records' to assert a delegation on."
    research = before_state.get("research_json") or {}
    parents_question = _PARENTS_QUESTION_TAG in (test.get("tags") or [])
    question_text = {q.get("id"): q.get("question") or "" for q in research.get("questions", []) if isinstance(q, dict)}
    items = []
    plan_of = {}
    question_of = {}
    for plan in research.get("plans", []):
        if plan.get("status") != "active":
            continue
        for item in plan.get("items", []):
            if item.get("status") in ("planned", "in_progress"):
                items.append(item)
                plan_of[item["id"]] = plan["id"]
                question_of[item["id"]] = plan.get("question_id")
    assert items, "Scenario drift: no active plan item to hand over."
    by_id = {i["id"]: i for i in items}
    problems = []
    for prompt in prompts:
        handed, problem = _handed_plan_item(prompt)
        if problem:
            problems.append(problem)
            continue
        item = by_id.get(handed.get("id"))
        if item is None:
            problems.append(
                f"plan_item block hands {handed.get('id')!r}, not an open item of an active plan {sorted(by_id)}"
            )
            continue
        if plan_of[item["id"]] not in prompt:
            problems.append(
                f"does not hand the parent plan id {plan_of[item['id']]} for {item['id']}"
            )
        if handed != item:
            missing = object()  # a dropped key whose value was null must still be named
            diff = sorted(
                k for k in set(item) | set(handed)
                if item.get(k, missing) != handed.get(k, missing)
            )
            problems.append(f"plan_item for {item['id']} is not verbatim; differs on {diff}")
        tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx") or {}
        subject, problem = _handed_subject(prompt, tree, research)
        if problem:
            problems.append(f"{problem} for {item['id']}")
            continue
        if parents_question:
            qid = question_of.get(item["id"])
            assert _ASKS_ABOUT_A_PARENT.search(question_text.get(qid, "")), (
                f"Scenario drift: {_PARENTS_QUESTION_TAG} is set, but {item['id']} serves "
                f"{qid!r}, which does not ask about a parent: {question_text.get(qid, '')!r}"
            )
        problems.extend(_handed_parents_problems(subject, tree, parents_question))
    assert not problems, "; ".join(problems)


# `plan_item:` as a field, not inside `plan_item_id` or `plan_items`.
_PLAN_ITEM_BLOCK = re.compile(r"(?<![A-Za-z_])plan_item(?![A-Za-z_])[`*\"']*\s*[:=]")
# Router prompts write the id line as `planItemId:`, `Plan item ID:` or
# `plan_item_id:`; `planItemIds:` (a disposal list) is a different field.
_PLAN_ITEM_ID_NAME = r"plan[\s_]*item[\s_]*id(?!s)"


def _handed_plan_item(prompt: str) -> tuple[dict | None, str | None]:
    """The one plan item a search spawn hands over, read from its `plan_item:`
    JSON block, or why it hands no single item: no block, two blocks, a block
    that is not a JSON object, two id lines, or an id line naming another item.
    A prompt with no id line is fine: the block's own `"id"` names the item."""
    blocks = list(_PLAN_ITEM_BLOCK.finditer(prompt))
    if len(blocks) > 1:
        return None, f"carries {len(blocks)} plan_item blocks; a spawn hands one item: {prompt[:160]!r}"
    brace = prompt.find("{", blocks[0].end()) if blocks else -1
    if brace == -1:
        return None, f"no plan_item JSON block: {prompt[:160]!r}"
    try:
        handed, _ = json.JSONDecoder().raw_decode(prompt[brace:])
    except ValueError:
        return None, "plan_item block is not valid JSON"
    if not isinstance(handed, dict):
        return None, "plan_item block is not a JSON object"
    ids = _field_values(prompt, "planItemId", name_regex=_PLAN_ITEM_ID_NAME)
    if len(ids) > 1:
        return None, f"carries {len(ids)} plan item id lines {ids}; a spawn hands one item"
    if ids and ids[0] != handed.get("id"):
        return None, f"id line names {ids[0]!r} but the plan_item block is {handed.get('id')!r}"
    return handed, None


_FANS_OUT_TAG = "fans-out-plan-items"
_RELAYED_WORDS = 6


def _words(text: str) -> list[str]:
    words = (w.strip(string.punctuation) for w in _quote_and_space_normal(text).lower().split())
    return [w for w in words if w]


def _word_runs(words: list[str], n: int) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


def test_search_spawns_cover_each_open_item(test, builtin_tool_calls, before_state):
    """Tag-gated (``fans-out-plan-items``). On a job, research/SKILL.md's search
    step dispatches one search agent per open item of the active plan, each
    handed that one item and never the researcher's words (issue #4441). Read
    from the hook records: one search-records spawn per open item with no
    ``fallback_for``, the handed ids equal to those items, and no spawn carrying
    6 or more consecutive words of the user message. Whether the spawns share
    one assistant message is not checked: no record says which message a spawn
    came from."""
    if _FANS_OUT_TAG not in (test.get("tags") or []):
        pytest.skip("not a fans-out test")
    research = before_state.get("research_json") or {}
    expected = sorted(
        item["id"]
        for plan in research.get("plans", [])
        if plan.get("status") == "active"
        for item in plan.get("items", [])
        if item.get("status") in ("planned", "in_progress") and not item.get("fallback_for")
    )
    assert len(expected) > 1, f"Scenario drift: a fans-out test needs two or more open items; got {expected}"
    prompts = _spawn_prompts(builtin_tool_calls, "search-records")
    problems = []
    if len(prompts) != len(expected):
        problems.append(f"{len(prompts)} search-records spawns for {len(expected)} open plan items {expected}")
    handed = sorted(str((_handed_plan_item(p)[0] or {}).get("id")) for p in prompts)
    if handed != expected:
        problems.append(f"handed plan items {handed}, open plan items {expected}")
    message = re.sub(r"^/research\b", "", (test.get("user_message") or "").strip())
    banned = _word_runs(_words(message), _RELAYED_WORDS)
    for prompt in prompts:
        if banned & _word_runs(_words(prompt), _RELAYED_WORDS):
            problems.append(
                f"a search-records spawn carries {_RELAYED_WORDS}+ consecutive words of the researcher's message: {prompt[:160]!r}"
            )
    assert not problems, "; ".join(problems)


def _handed_subject(prompt: str, tree: dict, research: dict) -> tuple[dict | None, str | None]:
    """The `subject:` JSON block a spawn prompt hands over, or the reason it
    hands none a reader can use: no block, a block that is not JSON, a
    `subjectId` that is not a person in the tree, or no `names`."""
    subject_ids = [p.get("id") for p in tree.get("persons", [])] or (
        (research.get("project") or {}).get("subject_person_ids") or []
    )
    match = re.search(r"subject:\s*", prompt)
    sbrace = prompt.find("{", match.end()) if match else -1
    if sbrace == -1:
        return None, f"no subject JSON block: {prompt[:160]!r}"
    try:
        subject, _ = json.JSONDecoder().raw_decode(prompt[sbrace:])
    except ValueError:
        return None, "subject block is not valid JSON"
    if subject.get("subjectId") not in subject_ids:
        return None, f"subject.subjectId {subject.get('subjectId')!r} is not a person in the tree {subject_ids}"
    if not subject.get("names"):
        return None, "subject block carries no names"
    return subject, None


_PARENTS_QUESTION_TAG = "parents-question"
_ASKS_ABOUT_A_PARENT = re.compile(r"\b(?:parents?|parentage|father|mother)\b|\b(?:son|daughter|child) of\b", re.I)


def _handed_parents_problems(subject: dict, tree: dict, parents_question: bool = False) -> list[str]:
    """The subject block names the subject's parents in the tree when it has one
    or two, and none when it has more than two (two candidate couples mean the
    parents are themselves in question) or when the search serves a question
    about his parentage, who a parent was or whether someone was his father or
    mother, since there they are what the search tests (research/SKILL.md)."""
    sid = subject.get("subjectId")
    if parents_question:
        return [f"subject.parents is handed for {sid} on a search for his parents; leave it out"] if subject.get("parents") else []
    parents = sorted(
        {
            r.get("parent")
            for r in tree.get("relationships") or []
            if isinstance(r, dict) and r.get("type") == "ParentChild" and r.get("child") == sid and r.get("parent")
        }
    )
    handed = subject.get("parents")
    if len(parents) > 2:
        return [f"subject.parents is handed for {sid}, who has {len(parents)} parents in the tree; leave it out"] if handed else []
    if not parents:
        return []
    ids = sorted({p.get("personId") for p in handed or [] if isinstance(p, dict)})
    if ids != parents:
        return [f"subject.parents names {ids}, not {sid}'s parents in the tree {parents}"]
    return []


_HANDS_SUBJECT_TAG = "hands-subject"


def test_delegation_hands_subject(test, builtin_tool_calls, before_state):
    """Tag-gated: the spawn of ``search-images`` carries the ``subject:`` block
    (issue #3363): with no subject it can record no namesake. Whether the block
    names the parents is checked on ``asserts-delegation-plan-item``, whose
    scenario gives the subject two; a browse-only scenario gives none."""
    if _HANDS_SUBJECT_TAG not in (test.get("tags") or []):
        pytest.skip("not a hands-subject test")
    prompts = _spawn_prompts(builtin_tool_calls, "search-images")
    assert prompts, "No recorded spawn of 'search-images' to assert a delegation on."
    research = before_state.get("research_json") or {}
    tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx") or {}
    problems = [p for p in (_handed_subject(prompt, tree, research)[1] for prompt in prompts) if p]
    assert not problems, "; ".join(problems)


_SETUP_ORDER_TAG = "attached-records-setup"


def test_attached_records_setup_order(tool_calls, test, before_state):
    """Tag-gated (``attached-records-setup``): the router runs the attached-
    records step for a subject — ``extraction_append({ personId })``, then
    ``timeline_build`` after it — on a job's "Objective but no questions" row and
    on the bounded "a timeline for a person" ask (issue #3516 PR D).

    Checked per subject: each person extracted is built after it, for the same
    subject. ``timeline_build``'s own contract accepts "a tree person id or the
    FamilySearch id a tree person links to" (timeline-build.ts), so the router
    is free to spell the two calls' ``personId`` differently for the same
    person (e.g. the FamilySearch id on the extract, the tree id on the build,
    once the earlier call's result surfaces it) — canonicalize both to the
    person's bare FamilySearch id via the scenario's tree before comparing,
    rather than requiring an identical literal string. Orders only the two MCP
    calls. ``tool_calls`` (the mock's MCP log) and ``builtin_tool_calls`` (the
    hook's) share no ordering, so "both before the first question-selection" is
    not checked here: on a job test it rests on ``execution.stop_at_stub`` and
    ``routes-to:question-selection``.
    """
    if _SETUP_ORDER_TAG not in (test.get("tags") or []):
        pytest.skip(f"not an {_SETUP_ORDER_TAG} test")

    tree = before_state.get("tree_gedcomx_json") or {}
    by_tree_id = {
        p.get("id"): bare_ark_id(p["ark"])
        for p in tree.get("persons") or []
        if isinstance(p, dict) and isinstance(p.get("ark"), str) and p["ark"].strip()
    }

    def person(c):
        pid = (c.get("args") or {}).get("personId")
        pid = pid.strip() if isinstance(pid, str) else ""
        if not pid:
            return ""
        return by_tree_id.get(pid, bare_ark_id(pid))

    first_extract: dict[str, int] = {}
    builds: dict[str, list[int]] = {}
    for i, c in enumerate(tool_calls or []):
        name = bare_tool_name(str(c.get("tool", "")))
        pid = person(c)
        if name == "extraction_append" and pid:
            first_extract.setdefault(pid, i)
        elif name == "timeline_build" and pid:
            builds.setdefault(pid, []).append(i)
    assert first_extract, (
        "the attached-records step must call extraction_append with personId; it never did. "
        f"extraction_append calls: {[c.get('args') for c in tool_calls or [] if bare_tool_name(str(c.get('tool', ''))) == 'extraction_append']}"
    )
    unbuilt = {pid: at for pid, at in first_extract.items() if not any(b > at for b in builds.get(pid, []))}
    assert not unbuilt, (
        "each subject's timeline_build must follow its extraction_append({ personId }) for the same personId; "
        f"no later timeline_build for {sorted(unbuilt)}. extraction_append(personId) at {first_extract}, "
        f"timeline_build at {builds}"
    )


_HINTS_HANDOFF_TAG = "asserts-hints-handoff"
_HINTS_PID = re.compile(r"hints on (\S+) before")


def test_hints_item_handoff_carries_its_ids(test, builtin_tool_calls, before_state):
    """Tag-gated: the spawn of ``search-hints`` for a planned ``fs_hints`` item
    carries the item's ``planItemId``, its plan's ``planId``, and the
    ``personId`` read out of the item's rationale (issue #3153). Without the
    item id search-hints writes no status, and the item is routed to it again
    on every pass. The judge sees no spawn prompt, so this is the only check.
    """
    if _HINTS_HANDOFF_TAG not in (test.get("tags") or []):
        pytest.skip("not a hints-handoff test")
    research = before_state.get("research_json") or {}
    held = [
        (plan["id"], item)
        for plan in research.get("plans", [])
        if plan.get("status") == "active"
        for item in plan.get("items", [])
        if item.get("record_type") == "fs_hints" and item.get("status") == "planned"
    ]
    assert held, "Scenario drift: no planned fs_hints item on an active plan."
    plan_id, item = held[0]
    pid = _HINTS_PID.search(item.get("rationale") or "")
    assert pid, f"Scenario drift: {item['id']}'s rationale names no FamilySearch id."
    prompts = _spawn_prompts(builtin_tool_calls, "search-hints")
    assert prompts, "No recorded spawn of 'search-hints' to assert a hand-off on."
    wanted = {"planItemId": item["id"], "planId": plan_id, "personId": pid.group(1)}
    missing = [
        f"{name} {value}"
        for name, value in wanted.items()
        if not any(re.search(rf"\b{re.escape(value)}\b", p) for p in prompts)
    ]
    assert not missing, f"the search-hints hand-off does not carry {', '.join(missing)}"


# ── Search-hit review (issue #3522) ─────────────────────────────────────

# `reviews-hits:<log_id>:<hitIndex,...|all>` names the hits the message asks for;
# `extracts-hit:<hitRef>` names a Match the yes-path extracts. Data tags, like
# `routes-to:`; each validator is gated on a literal tag beside them.
_REVIEWS_HITS_PREFIX = "reviews-hits:"
_EXTRACTS_HIT_PREFIX = "extracts-hit:"
_HIT_REF_RE = re.compile(r"results/(?P<log>log_\d+)\.json#(?P<hit>[A-Za-z0-9:/_-]+)")
_COUNT_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
_EXTRACT_COUNT_RE = re.compile(
    r"extracting\s+(?:the\s+)?(?:(?P<count>\d+|" + "|".join(_COUNT_WORDS) + r")\s+)?"
    r"match(?P<plural>es)?\b",
    re.IGNORECASE,
)
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_SEGMENT_BREAK = re.compile(r"\n|(?<=[.:;!?])\s+|[\"“”()\[\]]")
_YEAR_RANGE = re.compile(r"\d{4}\s*[-–—]\s*\d{4}(?!\d)")
_RECORD_WORD = re.compile(
    r"\b(records?|registrations?|registers?|census(es)?|church|court|births|deaths|"
    r"marriages|baptisms|christenings|burials|probate|land|tax|military|index|books|"
    r"parish|civil|vital|immigration|passengers?|naturali[sz]ations?|cemeter(y|ies)|"
    r"newspapers)\b",
    re.IGNORECASE,
)
_REPOSITORY_WORD = re.compile(r"\b(archives?|library|museum|office|society)\b", re.IGNORECASE)
_GENERIC_RECORD_WORD = re.compile(r"\b(records?|registers?|index|books)\b", re.IGNORECASE)
_PLACE_CONNECTORS = frozenset(
    {"of", "and", "the", "de", "la", "del", "des", "du", "van", "von", "upon", "y", "e", "da", "do", "di"}
)


_STRAIGHT_QUOTES = str.maketrans("\u2018\u2019\u201c\u201d", "''\"\"")
_UNCONFIRMED = re.compile(
    r"\b(unconfirmed|unverified|not (been )?(confirmed|verified)|could(n't| not) (confirm|verify))\b",
    re.IGNORECASE,
)


def _field_values(prompt: str, field: str, *, name_regex: str | None = None) -> list[str]:
    """Every value written for ``field`` in a spawn prompt, in any markup the
    router uses: ``field: v``, ``**field:** v``, ``"field": "v"``, ``field=v``,
    and in prose, where a value can end a sentence or a parenthesis
    (``target: I1.``, ``(target: I1)``), so trailing ``.`` and ``)`` are dropped.
    ``name_regex``, when given, matches the field name instead of ``field``,
    case-insensitively, for a field routers spell several ways."""
    name = name_regex or re.escape(field)
    pattern = re.compile(
        rf"(?<![A-Za-z]){name}[`*\"']*\s*[:=][`*\"']*\s*[`*\"']*(?P<v>[^\s`*\"',;}}\]]+)",
        re.IGNORECASE if name_regex else 0,
    )
    values = (m.group("v").rstrip(".)") for m in pattern.finditer(prompt))
    return [v for v in values if v]


def _data_tag_values(test: dict, prefix: str) -> list[str]:
    return [t[len(prefix):] for t in (test.get("tags") or []) if t.startswith(prefix)]


def _requested_hit_refs(test: dict, before_state: dict) -> list[tuple[str, str]]:
    """(log_id, bare hit id) for each hit the message asks for, from the sidecar
    the scenario holds, skipping a hit with no transcript as the router does."""
    found = _data_tag_values(test, _REVIEWS_HITS_PREFIX)
    assert len(found) == 1, f"a hit-review test names its hits in one {_REVIEWS_HITS_PREFIX} tag; got {found}"
    log_id, _, which = found[0].partition(":")
    raw = ((before_state or {}).get("files") or {}).get(f"results/{log_id}.json")
    assert raw, f"Scenario drift: no results/{log_id}.json to list the hits from."
    rows = json.loads(raw)["payload"]["results"]
    indices = range(1, len(rows) + 1) if which == "all" else [int(i) for i in which.split(",")]
    assert all(1 <= i <= len(rows) for i in indices), (
        f"Scenario drift: results/{log_id}.json holds {len(rows)} hits; the test asks for {which}."
    )
    return [
        (log_id, bare_ark_id(rows[i - 1]["id"]))
        for i in indices
        if isinstance(rows[i - 1].get("textDocument"), str) and rows[i - 1]["textDocument"]
    ]


def test_search_hit_review_spawns_one_agent_per_hit(test, builtin_tool_calls, before_state, text_response):
    """Tag-gated (``reviews-search-hits``). research/SKILL.md's "Search-hit review":
    one ``evaluate-search-results`` spawn per requested hit, each naming
    ``projectPath``, its own ``hitRef`` and a tree person as ``target``, and a
    last line that offers ``extracting the N Matches`` with N the spawn count.

    The test's stub returns a Match, not yet extracted, for every spawn, so every
    spawn is a Match to offer. The spawn prompts are read from the hook records,
    which the judge cannot see. A hitRef is compared by its log and bare hit id,
    so either spelling of the id passes. The 5-per-message width is not checked:
    no run record says which message a spawn came from.
    """
    from harness.skill_runner import load_step_boundary, spawn_prompts

    if "reviews-search-hits" not in (test.get("tags") or []):
        pytest.skip("not a search-hit review test")
    expected = _requested_hit_refs(test, before_state)
    assert expected, "Scenario drift: none of the requested hits carries a transcript."
    tree = (before_state or {}).get("tree_gedcomx_json") or {}
    person_ids = {p.get("id") for p in tree.get("persons", [])} - {None}
    prompts = spawn_prompts(builtin_tool_calls, "evaluate-search-results")
    assert prompts, "No recorded spawn of 'evaluate-search-results' to assert the review on."

    problems = []
    spawned: list[tuple[str, str]] = []
    for n, prompt in enumerate(prompts, 1):
        refs = {
            (m.group("log"), bare_ark_id(m.group("hit")))
            for m in _HIT_REF_RE.finditer(prompt)
            if m.group("hit") != "hits"
        }
        if len(refs) != 1:
            problems.append(f"spawn {n} names {len(refs)} hit refs {sorted(refs)}; one agent judges one hit")
        spawned.extend(refs)
        if not _field_values(prompt, "projectPath"):
            problems.append(f"spawn {n} names no projectPath")
        targets = _field_values(prompt, "target")
        if not any(t in person_ids for t in targets):
            problems.append(f"spawn {n} names no tree person as target (got {targets})")
    duplicates = sorted({r for r in spawned if spawned.count(r) > 1})
    if duplicates:
        problems.append(f"hits spawned more than once: {duplicates}")
    missing = sorted(set(expected) - set(spawned))
    extra = sorted(set(spawned) - set(expected))
    if missing or extra:
        problems.append(f"spawned hits differ from the {len(expected)} asked for: missing {missing}, not asked for {extra}")
    if len(prompts) != len(expected):
        problems.append(f"{len(prompts)} spawns for {len(expected)} hits")

    boundary = load_step_boundary()
    lines = [
        line.strip() for line in (text_response or "").splitlines()
        if line.strip() and not boundary._LINK_ONLY_RE.match(line.strip())
    ]
    if boundary.offered_step(text_response) != "extract-matches":
        problems.append(f"the last line does not offer extracting the Matches: {lines[-1:]}")
    else:
        found = _EXTRACT_COUNT_RE.search(lines[-1])
        word = (found.group("count") or "").lower() if found else ""
        count = int(word) if word.isdigit() else _COUNT_WORDS.get(word)
        if count is None and found and not found.group("plural"):
            count = 1
        if count != len(prompts):
            problems.append(f"the offer counts {count} Matches for {len(prompts)} returned: {lines[-1]!r}")
    assert not problems, "; ".join(problems)


def test_search_hit_review_yes_extracts_the_matches(test, builtin_tool_calls):
    """Tag-gated (``extracts-reviewed-matches``). The yes to a search-hit
    review's offer is one ``record-structurer`` spawn with one source per Match:
    ``recordId`` the hit's id, in either spelling, and ``resultsRef`` the hitRef,
    verbatim (research/SKILL.md, "Search-hit review")."""
    from harness.skill_runner import spawn_prompts

    if "extracts-reviewed-matches" not in (test.get("tags") or []):
        pytest.skip("not a search-hit extraction test")
    wanted = _data_tag_values(test, _EXTRACTS_HIT_PREFIX)
    assert wanted, f"an extracts-reviewed-matches test names each Match in an {_EXTRACTS_HIT_PREFIX} tag"
    prompts = spawn_prompts(builtin_tool_calls, "record-structurer")
    assert len(prompts) == 1, f"record-structurer was spawned {len(prompts)} time(s); the yes is one spawn for every Match"
    prompt = prompts[0]
    record_ids = sorted({bare_ark_id(v) for v in _field_values(prompt, "recordId")})
    results_refs = sorted(set(_field_values(prompt, "resultsRef")))
    want_ids = sorted({bare_ark_id(ref.partition("#")[2]) for ref in wanted})
    assert record_ids == want_ids, f"the sources' recordIds {record_ids} are not the Matches' hit ids {want_ids}"
    assert results_refs == sorted(wanted), f"the sources' resultsRefs {results_refs} are not the hitRefs {sorted(wanted)}"


_HANDBACK_SPAWNS_PREFIX = "handback-spawns:"
_HANDBACK_NO_SPAWN_PREFIX = "handback-no-spawn:"


def test_handback_routing_follows_the_step_group(test, builtin_tool_calls):
    """Tag-gated (``handback-spawns:<agent>`` / ``handback-no-spawn:<agent>``).
    research/SKILL.md's search step routes an agent return's ``Hand-back: <owner>``
    line by step group (issue #4358): an owner in the returning agent's group is
    spawned in the same turn; any other owner is named in the report and not
    spawned. Read from the hook records, which the judge cannot see."""
    from harness.skill_runner import spawn_prompts

    spawns = _data_tag_values(test, _HANDBACK_SPAWNS_PREFIX)
    refused = _data_tag_values(test, _HANDBACK_NO_SPAWN_PREFIX)
    if not spawns and not refused:
        pytest.skip("not a hand-back routing test")
    problems = []
    for agent in spawns:
        if not spawn_prompts(builtin_tool_calls, agent):
            problems.append(f"the Hand-back to {agent} was not spawned")
    for agent in refused:
        if spawn_prompts(builtin_tool_calls, agent):
            problems.append(f"{agent} is in another step group and was spawned mid-turn")
    assert not problems, "; ".join(problems)


def _marked_unconfirmed(reply: str, title: str) -> bool:
    """True when a sentence of the reply holding `title` also says it is unconfirmed, which
    the sources sentence allows ("otherwise say it is unconfirmed"). A sentence, not a
    line: a markdown paragraph is one line, and a hedge elsewhere in it is not this one."""
    wanted = _normalised_title(title)
    return any(
        wanted in _normalised_title(sentence) and _UNCONFIRMED.search(sentence)
        for sentence in re.split(r"\n|(?<=[.!?])\s+", re.sub(r"[*_`]", "", _MD_LINK.sub(r"\1", reply)))
    )


def _title_start(first_field: str) -> str:
    """The trailing run of a title's first field that reads as a place or title: words
    that start with a capital, a digit or an apostrophe-led capital, joined by
    connectors ("Isle of Man"), with no connector leading. Prose before it is cut, so
    "Start with Kenya" yields "Kenya" and "…was strengthened over time" yields ""."""
    kept: list[str] = []
    for word in reversed(first_field.split()):
        if word[:1].isupper() or word[:1].isdigit() or word.casefold() in _PLACE_CONNECTORS:
            kept.append(word)
        else:
            break
    while kept and kept[-1].casefold() in _PLACE_CONNECTORS:
        kept.pop()
    return " ".join(reversed(kept))


def _normalised_title(text: str) -> str:
    text = re.sub(r"[–—]", "-", text.casefold()).translate(_STRAIGHT_QUOTES)
    return re.sub(r"\s*-\s*", "-", re.sub(r"\s+", " ", text)).strip(" ,")


def _collection_title_candidates(reply: str) -> list[str]:
    """Runs of reply text shaped like a FamilySearch collection title: from the
    segment's first capital, holding a comma and a record word, through a year range.
    The first field is cut to its title-shaped tail (`_title_start`), so sentence prose
    before a comma is not read as a title. A run whose first field names a repository
    (an archive, library, museum, office or society) is a repository recommendation,
    not a collection, and is dropped. A two-field run ("Kenya Records, 1888–1960") is a
    heading unless it names a specific record type, not just records or registers."""
    reply = re.sub(r"[*_`]", "", _MD_LINK.sub(r"\1", reply))
    found = []
    for segment in _SEGMENT_BREAK.split(reply):
        start = re.search(r"[A-Z]", segment)
        if not start:
            continue
        run = segment[start.start():]
        years = _YEAR_RANGE.search(run)
        if not years:
            continue
        run = run[: years.end()]
        if "," not in run:
            continue
        first, rest = run.split(",", 1)
        first = _title_start(first)
        second = rest.strip()[:1]
        if not first or not (second.isupper() or second.isdigit()):
            continue
        run = f"{first},{rest}"
        if not _RECORD_WORD.search(run) or _REPOSITORY_WORD.search(first):
            continue
        if "," not in rest and not _RECORD_WORD.search(_GENERIC_RECORD_WORD.sub("", run)):
            continue
        found.append(run)
    return found


def _returned_collection_titles(tool_calls) -> list[str]:
    titles = []
    for call in tool_calls or []:
        if bare_tool_name(str(call.get("tool", ""))) != "collections_search":
            continue
        response = call.get("response")
        if isinstance(response, str):
            try:
                response = json.loads(response)
            except ValueError:
                continue
        if not isinstance(response, dict):
            continue
        for result in response.get("results") or []:
            if isinstance(result, dict) and result.get("title"):
                titles.append(result["title"])
    return titles


def test_names_collections_only_from_search(text_response, tool_calls, test):
    """Tag-gated (``names-collections-only-from-search``), issue #4011: a reply names a
    FamilySearch collection only when a ``collections_search`` result in the session
    returned it. The Kenya alpha session listed "Kenya, Civil Registration, deaths
    1904–1967" as searchable from memory; FamilySearch has no Kenya collections.

    Precision over recall: a title with no record word, no year range or no comma is not
    seen, and a non-FamilySearch repository is excluded by its first field. Proven both
    ways in ``tests/unit/test_research_collections_from_search_validator.py``.
    """
    if "names-collections-only-from-search" not in test.get("tags", []):
        pytest.skip("not a names-collections-only-from-search test")
    returned = [_normalised_title(t) for t in _returned_collection_titles(tool_calls)]
    unreturned = [
        candidate
        for candidate in _collection_title_candidates(text_response or "")
        if not _marked_unconfirmed(text_response or "", candidate)
        and not any(
            _normalised_title(candidate).endswith(title) or title.endswith(_normalised_title(candidate))
            for title in returned
        )
    ]
    assert not unreturned, (
        f"the reply names FamilySearch collection title(s) no collections_search result "
        f"returned: {unreturned}. Returned titles: {returned or 'none'}. Name a collection "
        "only from a collections_search result, or say it is unconfirmed."
    )


_ITALIC_SPAN = re.compile(r"(?<![*\w])([*_])(?!\1)([^*_\n]+?)(?<![*_\s])\1(?![*\w])")


def _italic_titles(reply: str) -> list[str]:
    """Italic runs shaped like a work's title: four or more words, three of them
    capitalised. Bold, and short emphasis such as *unconfirmed* or *not*, are not seen."""
    titles = []
    for match in _ITALIC_SPAN.finditer(_MD_LINK.sub(r"\1", reply)):
        words = match.group(2).split()
        if len(words) >= 4 and sum(w[:1].isupper() for w in words) >= 3:
            titles.append(match.group(2).strip())
    return titles


def _tool_result_text(tool_calls) -> str:
    return _normalised_title(" ".join(s for call in tool_calls or [] for s in response_strings(call.get("response"))))


def test_names_works_only_from_tool_results(text_response, tool_calls, test):
    """Tag-gated (``names-collections-only-from-search``), issue #4011 as widened by the
    lead on 2026-11-02 from issue #4125: a reply names a book, register or other cited
    work only when a tool result in the session contains it. The #4125 reply named
    Ayling's 1895 *Revised Register…* for the wrong war, and no tool had returned it.

    Sees only titles set in italics, the way a reply cites a work. A title in plain
    text or quotes, or a footnote naming a work without italics, passes: that half is
    measured by the hosted replays, not here. Proven both ways in
    ``tests/unit/test_research_collections_from_search_validator.py``.
    """
    if "names-collections-only-from-search" not in test.get("tags", []):
        pytest.skip("not a names-collections-only-from-search test")
    returned = _tool_result_text(tool_calls)
    unreturned = [
        t
        for t in _italic_titles(text_response or "")
        if _normalised_title(t) not in returned and not _marked_unconfirmed(text_response or "", t)
    ]
    assert not unreturned, (
        f"the reply names work(s) no tool result in the session contains: {unreturned}. "
        "Name a source, collection, book or citation only if a tool result returned it, "
        "or say it is unconfirmed."
    )


# ---------------------------------------------------------------------------
# `claims-no-hypothesis-write` tag
# ---------------------------------------------------------------------------

_WRITTEN = r"(?:registered|recorded|written|created|tracked|logged|on\s+record)"
_HYPOTHESIS_WRITTEN_RE = re.compile(
    r"formal tracking entry"
    r"|\bhypothes[ie]s\b(?:\s+h_\d+)?\s+(?:(?:has|have)\s+(?:now\s+)?been|is|are|was|were)"
    rf"\s+(?:now\s+)?{_WRITTEN}\b"
    r"|\bhypothes[ie]s\b(?:\s+h_\d+)?\s+(?:now\s+)?on\s+record\b"
    rf"|\bnow\s+(?:{_WRITTEN}\s+as\s+an?\s+(?:\w+\s+)?hypothesis"
    r"|an?\s+(?:registered|recorded|tracked)\s+hypothesis)\b"
    r"|\bI(?:['’]ve|\s+have)?\s+(?:now\s+)?(?:registered|recorded|created|written|logged)"
    r"\s+(?:the|a|this|that)\s+(?:\w+\s+)?hypothesis\b"
    r"|\b(?:registered|recorded|created)\b[^.\n]{0,80}?\bas\s+h_\d+\b",
    re.IGNORECASE,
)
_CLAUSE_BOUNDARY_RE = re.compile(r"[.;:!?\n,—–]")
_CONDITION_OR_NEGATION_RE = re.compile(
    r"\b(?:when|if|whether|once|until|before|after|unless|no|not|never|cannot)\b|n['’]t\b",
    re.IGNORECASE,
)


def _hypothesis_written_claim(reply: str) -> str | None:
    for m in _HYPOTHESIS_WRITTEN_RE.finditer(reply):
        start = max((b.end() for b in _CLAUSE_BOUNDARY_RE.finditer(reply, 0, m.start())), default=0)
        if not _CONDITION_OR_NEGATION_RE.search(reply[start:m.start()]):
            return m.group(0)
    return None


def test_reply_does_not_claim_hypothesis_written(text_response, test):
    """Tag-gated (``claims-no-hypothesis-write``), issue #4432: the router only hands
    the inference to hypothesis-tracking, so a reply that says the hypothesis now
    exists overclaims. The judge passed ``v49.json`` run 4's "now has a formal
    tracking entry" under a judge_context that names that very phrase.

    A hand-off described by its purpose ("handed off to register it as a
    hypothesis"), and a claim whose own clause carries a negation ("no sibling
    hypothesis has been registered") or a condition ("when", "if", "whether",
    "once") all pass, as does "now recorded" said of anything but a hypothesis.
    Proven both ways in ``tests/unit/test_research_hypothesis_written_validator.py``.
    """
    if "claims-no-hypothesis-write" not in test.get("tags", []):
        pytest.skip("not a claims-no-hypothesis-write test")
    claim = _hypothesis_written_claim(text_response or "")
    assert claim is None, (
        f"the reply claims the hypothesis now exists: {claim!r}. The router only "
        "handed it to hypothesis-tracking; describe the hand-off by its purpose."
    )


# ── Issue #4348: relaying an every-mention survey hand-back ───────────────

_SURVEY_RELAY_TAG = "every-mention-survey-relay"

_FORBIDDEN_COMPLETENESS_PATTERNS = [
    re.compile(r"\bevery\s+(?:\w+\s+)?(?:occurrence|mention|instance)s?\b", re.IGNORECASE),
    re.compile(r"\ball\s+(?:the\s+)?(?:\w+\s+)?(?:occurrences|mentions|instances)\b", re.IGNORECASE),
    re.compile(r"\bcomplete\s+(?:index|list|record|survey|set)\b", re.IGNORECASE),
    # Deliberately `survey`, never `search`: "the search is complete" (the three
    # record_search calls finished) is ordinary workflow narration, not a claim
    # about the surname's coverage -- only "survey" names the coverage claim.
    re.compile(r"\bsurvey\b[^.]{0,40}\b(is|was)\b[^.]{0,20}\b(complete|exhaustive)\b", re.IGNORECASE),
    re.compile(r"\b(complete(d)?|exhaustive)\b[^.]{0,40}\bsurvey\b", re.IGNORECASE),
]

_SEARCH_TARGET_PATTERNS = _FORBIDDEN_COMPLETENESS_PATTERNS[:2]
_SENTENCE_BOUNDARY_RE = re.compile(r"[.;:!?\n]|—")
_SEARCH_VERB_RE = re.compile(
    r"\b(?:(?:search|look|survey|dispatch)(?:ing|ed)|scann(?:ing|ed)|quer(?:ying|ied)"
    r"|to\s+(?:search|look|survey|scan|dispatch|query))\b",
    re.IGNORECASE,
)
_ACHIEVED_RE = re.compile(
    r"\b(?:found|find(?:s|ing)?|captured?|cover(?:s|ed|ing)?|accounted|returned|located|identified|turned\s+up)\b",
    re.IGNORECASE,
)


_SURVEY_CLAIM_PATTERNS = _FORBIDDEN_COMPLETENESS_PATTERNS[3:]


def _completeness_claims(body: str) -> list[str]:
    hits = []
    for i, pattern in enumerate(_FORBIDDEN_COMPLETENESS_PATTERNS):
        for m in pattern.finditer(body):
            if i < len(_SEARCH_TARGET_PATTERNS) and _is_search_target(body, m):
                continue
            if pattern in _SURVEY_CLAIM_PATTERNS and _is_open_question(body, m):
                continue
            hits.append(pattern.pattern)
            break
    return hits


def _is_open_question(body: str, m: re.Match) -> bool:
    """"check whether this survey is exhaustive" asks; it does not claim. A
    whether/if earlier in the clause, with no comma between, makes it a question."""
    start = max((b.end() for b in _SENTENCE_BOUNDARY_RE.finditer(body, 0, m.start())), default=0)
    return re.search(r"\b(?:whether|if)\b[^,]*$", body[start:m.start()], re.IGNORECASE) is not None


def _is_search_target(body: str, m: re.Match) -> bool:
    start = max((b.end() for b in _SENTENCE_BOUNDARY_RE.finditer(body, 0, m.start())), default=0)
    before = body[start:m.start()]
    if not re.search(r"\bfor\s+$", before, re.IGNORECASE):
        return False
    verbs = list(_SEARCH_VERB_RE.finditer(before))
    return bool(verbs) and _ACHIEVED_RE.search(before[verbs[-1].end():]) is None


_FORBIDDEN_LOCALITY_PATTERN = re.compile(
    r"\b(?:W[oó]jtowa|Pagorzyna)\b[^.]{0,60}\bno\s+(?:\w+\s+){0,2}"
    r"(?:entries|records|occurrences|mentions|hits)\b",
    re.IGNORECASE,
)

_REQUIRED_CAVEAT_PATTERNS = [
    re.compile(r"\b(godparents?|witness(?:es)?)\b", re.IGNORECASE),
    # Anchored on the caveat's CONTENT (the index can't separate the parishes),
    # not just the place names: any correct relay names the parishes it searched
    # in its setup sentence, so a bare place-name match passes even when the
    # caveat sentence itself is dropped -- exactly the production incident
    # issue #4348 is about ("Wojtowa and Pagorzyna: no entries appear...").
    re.compile(
        r"(?:doesn'?t|does\s+not|don'?t|do\s+not|can'?t|cannot)\s+(?:be\s+)?"
        r"(?:say|tell|separate|distinguish|identify|determine|confirm|capture"
        r"|break\s+(?:\w+\s+){0,3}down|state(?:d)?\s+separately)"
        r"[^.]{0,80}\b(?:parish|parishes|W[oó]jtowa|Pagorzyna)\b"
        r"|\b(?:parish|parishes|W[oó]jtowa|Pagorzyna)\b[^.]{0,80}"
        r"(?:doesn'?t|does\s+not|don'?t|do\s+not|can'?t|cannot)\s+(?:be\s+|mean\s+)?"
        r"(?:say|tell|separate|distinguish|identify|determine|confirm|capture|mean"
        r"|break\s+(?:\w+\s+){0,3}down|state(?:d)?\s+separately)",
        re.IGNORECASE,
    ),
]

_FORBIDDEN_READINESS_PATTERNS = [
    re.compile(r"\bready\s+for\s+extraction\b", re.IGNORECASE),
    re.compile(r"\bready\s+to\s+be\s+worked\s+through\b", re.IGNORECASE),
    re.compile(r"\bready\s+to\s+be\s+linked\b", re.IGNORECASE),
]


def test_survey_handback_relay_has_no_completeness_claim(text_response, test):
    """Issue #4348, research/SKILL.md relay rule. Relaying a search-records (or
    search-images) hand-back that answers a survey of every occurrence/mention
    of a surname must never call it complete or "every occurrence," must keep
    the hand-back's own coverage caveats, and must not claim the hits are
    ready for extraction, ready to be worked through, or ready to be linked
    to tree persons as a set.

    Tag-gated on `every-mention-survey-relay`. Checked on `text_response`
    (every main-thread turn's text, joined) because the relay is the router's
    own narration of a stubbed search-records return, not a tool call the hook
    records -- there is nothing else deterministic to read it from.
    """
    if _SURVEY_RELAY_TAG not in (test.get("tags") or []):
        pytest.skip("not a survey-handback-relay test")

    body = text_response or ""
    assert body, "the router produced no text to relay the survey hand-back"

    completeness_hits = _completeness_claims(body)
    assert not completeness_hits, (
        "the reply calls the survey complete or claims every occurrence/mention "
        f"was found; matched: {completeness_hits}"
    )

    assert not _FORBIDDEN_LOCALITY_PATTERN.search(body), (
        "the reply makes a negative finding about a parish the index cannot separate"
    )

    readiness_hits = [p.pattern for p in _FORBIDDEN_READINESS_PATTERNS if p.search(body)]
    assert not readiness_hits, (
        "the reply claims the survey hits are ready for extraction, ready to be "
        f"worked through, or ready to be linked as a set; matched: {readiness_hits}"
    )

    missing_caveats = [p.pattern for p in _REQUIRED_CAVEAT_PATTERNS if not p.search(body)]
    assert not missing_caveats, (
        "the reply dropped a coverage caveat from the search-records hand-back "
        "(expected both the godparent/witness gap and the parish-separation gap); "
        f"missing: {missing_caveats}"
    )


def test_no_inline_transcription_of_a_reindex(tool_calls, test):
    """Tag-gated (``no-inline-transcribe``, #4141). A re-index of one page, or a
    comparison of a page with its FamilySearch index, is search-images' job: the
    router hands it over and never reads the page itself. The first-hand-off
    check alone passes a router that transcribed and compared inline and then
    spawned. search-images is stubbed in these tests, so every image_transcribe
    call in the log is the main thread's."""
    if "no-inline-transcribe" not in test.get("tags", []):
        pytest.skip("not a no-inline-transcribe test")
    inline = [c for c in (tool_calls or []) if bare_tool_name(c.get("tool", "")) == "image_transcribe"]
    assert not inline, (
        f"the router transcribed the page itself ({len(inline)} image_transcribe call(s)); "
        "a re-index goes to search-images with the message verbatim"
    )
