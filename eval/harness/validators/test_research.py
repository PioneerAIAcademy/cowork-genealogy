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
import pytest

from validators_lib import bare_tool_name
from validators_lib import new_log_entries as _new_log_entries
from validators_lib import check_no_gate_stop
from validators_lib import existing_plan_changes, new_plan_ids

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


def test_hint_review_stops_for_the_researchers_verdicts(skills_invoked, builtin_tool_calls, tool_calls, test):
    """After a hint triage the router relays it and stops: whether to accept a
    hint is the researcher's call (research/SKILL.md, "Hint review"). Spawning
    search-hints a second time in the same run can only carry verdicts the
    researcher never stated, and logging the hints itself skips the agent.

    Tag-gated on ``stops-for-verdicts``. The test's search-hints stub returns a
    realistic triage ending in "Awaiting verdicts", so the pull toward a second
    spawn is real (issue #2029).
    """
    from harness.skill_runner import handoffs

    if "stops-for-verdicts" not in test.get("tags", []):
        pytest.skip("not a hint-review stop test")
    spawns = [h for h in handoffs(skills_invoked, builtin_tool_calls) if h == "search-hints"]
    assert len(spawns) == 1, (
        f"search-hints was handed off {len(spawns)} time(s); the router spawns it once for "
        "triage and then stops for the researcher's verdicts"
    )
    logs = [c for c in (tool_calls or []) if str(c.get("tool", "")).endswith("__research_log_append")]
    assert not logs, (
        f"the router logged {len(logs)} entry/entries itself after a hint triage; verdicts are "
        "the researcher's, and recording them is search-hints' second spawn"
    )


# The search steps a bounded request must not reach when the answer is already
# attached. MCP side and delegation side are listed separately because the rule
# is defeated by either: an inline `record_search` and a hand-off to
# `search-records` both spend a paid call to re-find what the project holds.
_SEARCH_MCP_TOOLS = frozenset({
    "record_search", "person_search", "fulltext_search", "collections_search",
    "volume_search", "image_search", "external_links_search", "catalog_search",
})
# Derived from the skills tree, not recalled: an omission here is silent, because a
# hand-off to a step missing from this set passes the assertion below.
_SEARCH_STEPS = frozenset({
    "search-records", "search-images", "search-familysearch-wiki",
    "search-full-text", "search-external-sites", "search-wikipedia",
    # Not reachable from the router's table today, but it searches: it tabulates
    # households across a place's censuses. Listed because reachability changes and
    # the comment above is right that an omission here is silent.
    "survey-surname",
})


def test_reads_attachments_before_searching(
    test, tool_calls, attempted_mcp_calls, skills_invoked, builtin_tool_calls
):
    """Tag-gated (``attached-first``). Issue #2813 item 4.

    "Before any search, read the person's attached sources and relatives. Never
    search for a record that is already attached."

    Graded on the MCP call log and the hand-off list rather than on the reply,
    for the reason the routing validator gives: a turn that only NARRATES having
    checked ("I'll first look at what's already attached") cannot satisfy it.

    This is the assertion the unit suite could not previously make. Neither
    ``person_read`` nor ``source_attachments`` is in ``mock_mcp.LIVE_TOOLS``, so
    the mock registers them only for a test that declares fixtures; a body that
    skipped the rule entirely passed every unit test in the suite.
    """
    from harness.skill_runner import handoffs

    if "attached-first" not in test.get("tags", []):
        pytest.skip("not an attached-first test")

    bare = lambda c: (c.get("tool") or "").rsplit("__", 1)[-1]
    called = [bare(c) for c in (tool_calls or []) if isinstance(c, dict)]
    # ATTEMPTED calls count too. `tool_calls` records only successful dispatches
    # (conftest.py), so a search whose args miss every fixture predicate lands in
    # `attempted_mcp_calls` instead -- and reading only the first list would let
    # the exact behaviour this test forbids pass silently.
    attempted = [bare(c) for c in (attempted_mcp_calls or []) if isinstance(c, dict)]
    read_first = {"person_read", "source_attachments"} & set(called)
    assert read_first, (
        "The router must read what is already attached before routing a request "
        "anywhere. Neither person_read nor source_attachments was called. "
        f"MCP calls={called}"
    )

    searched = [t for t in called + attempted if t in _SEARCH_MCP_TOOLS]
    assert not searched, (
        "The requested record is already attached, so searching for it spends a paid "
        f"call to re-find what the project holds. Search tools called: {searched}"
    )

    handed = handoffs(skills_invoked, builtin_tool_calls)
    search_steps = [s for s in handed if s in _SEARCH_STEPS]
    assert not search_steps, (
        "Handing off to a search step re-finds an already-attached record just as an "
        f"inline search call would. Hand-offs: {handed}"
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

_DELIVERS_PREFIX = "delivers:"


def test_every_bounded_deliverable_is_handed_off(skills_invoked, builtin_tool_calls, test):
    """Tag-gated (``delivers:<skill>``, one per deliverable). Issue #2813 item 1.

    ``routes-to:`` asserts the FIRST hand-off and permits only one tag, so on a
    COMPOUND bounded ask it grades nothing about the second deliverable: a turn
    that delivers the first and silently drops the second passes it. That is the
    exact pre-change behaviour this rule exists to remove, which is why a separate
    assertion is needed rather than a second ``routes-to:``.

    Order-independent among the deliverables, because the body imposes none ("two
    hand-offs, each to the step that owns it ... ends when the last one is met").
    What it does forbid is the FIRST hand-off being something off the list, which is
    how the job path shows up. WHICH step that is depends on the project: with no
    questions it is ``question-selection``; with a question and no localities entry
    it is ``locality-guide``; with a localities entry it is ``research-plan``. A
    scenario whose job-path head is itself a ``delivers:`` target cannot
    discriminate, so pick one where it is not.
    """
    from harness.skill_runner import handoffs

    expected = [t[len(_DELIVERS_PREFIX):] for t in (test.get("tags") or [])
                if t.startswith(_DELIVERS_PREFIX)]
    if not expected:
        pytest.skip("not a delivers: test")
    assert all(expected), f"empty {_DELIVERS_PREFIX} tag value — name the skill or remove the tag"

    handed = handoffs(skills_invoked, builtin_tool_calls)
    # Strip the skill under test the way test_routes_to_expected_skill does: it is
    # recorded first when entered as a slash command (issue #3116), so a raw
    # handed[0] is "research" and the first-hand-off assertion below would fail on
    # every real run. A claim audit caught this before a paid run did.
    # The skill under test is recorded first when entered as a slash command
    # (issue #3116), so a raw handed[0] is "research" and the assert below would
    # fail on every real run. Filtering is enough; test_routes_to_expected_skill's
    # extra slice is redundant beside it.
    skill_under_test = test.get("skill")
    delegations = [s for s in handed if s != skill_under_test]

    missing = [e for e in expected if e not in delegations]
    assert not missing, (
        "a compound bounded ask must hand off for EVERY deliverable it names. "
        f"Never handed off: {missing}. Hand-offs seen: {delegations}. Delivering one and "
        "dropping the rest is the behaviour the one-or-more rule replaced."
    )
    assert delegations and delegations[0] in expected, (
        f"the first hand-off must be one of the deliverables {expected}, got "
        f"{delegations[0] if delegations else 'none'}. A hand-off off that list is the job "
        "path, which a bounded request must not enter."
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
    "rp_", "kh_", "q_", "pl_", "pli_", "log_", "src_", "a_", "pe_", "rj_", "c_",
    "h_", "t_", "ps_", "ev_", "loc_", "ns_",
)
_PROJECT_ID_RE = re.compile(
    r"\b(?:(?:" + "|".join(re.escape(p) for p in _PROJECT_ID_PREFIXES) + r")\d+|[FINRS]\d+)\b"
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


_ENDS_WITH_DELIVERY_TAG = "ends-with-delivery"
_DELIVERED_TOOL = "research_delivered"


def test_a_bounded_turn_ends_with_the_delivery_signal(tool_calls, test):
    """Tag-gated (``ends-with-delivery``). Issue #2813 item 1, the enforcement half.

    The skill body telling the model to "end your turn" is not what ends it. On the
    hosted plane an SDK Stop hook VETOES a voluntary stop while the project objective
    is incomplete and nudges the agent onward; the only arm that lets a bounded turn
    stop is `delivered`, set when the model calls `research_delivered`
    (`apps/server/app/agent/real_agent.py`, `should_continue_run`). A bounded turn that
    ends without the call is answered and then nudged back into more research -- the
    alpha report behind this test.

    Gated on its own tag, NOT on `bounded-request`: `ut_research_023` carries that tag
    and is the `--autonomous` carve-out, where the router must run the job and must NOT
    deliver. One tag for "is bounded", another for "must end with the signal".

    Nothing asserted this before, and the tool was advertised nowhere in this harness,
    so every unit run graded the skill on prose it had no way to act on.
    """
    tags = test.get("tags") or []
    if _ENDS_WITH_DELIVERY_TAG not in tags:
        pytest.skip(f"not an {_ENDS_WITH_DELIVERY_TAG} test")

    # `bare_tool_name(...) == `, not `.endswith(...)`: the suffix form accepts a
    # LOOKALIKE -- `mcp__genealogy__not_research_delivered` ends with the name and
    # satisfied this. The helper strips whichever of the three server spellings the
    # run exposed, so all of them and the bare name still match (clack391, #3372).
    first = next(
        (i for i, c in enumerate(tool_calls)
         if bare_tool_name(str(c.get("tool", ""))) == _DELIVERED_TOOL),
        None,
    )
    assert first is not None, (
        f"a bounded turn must end by calling `{_DELIVERED_TOOL}`; it never did. "
        f"Tools called: {sorted({str(c.get('tool')) for c in tool_calls})}. "
        "Without it the hosted PreToolUse arm never halts the turn, the nudge arm sees an "
        "incomplete objective, and the agent is pushed on into more research -- which is "
        "what the researcher reports as 'it would not stop'."
    )

    # The FIRST call, and no MCP call after it. `tool_calls` is the mock's MCP dispatch
    # log only, so a built-in `Skill`/`Agent` hand-off AFTER the delivery is invisible
    # here -- seeing it needs a shared order across both lists, which neither carries.
    # The hosted arm halts on the first MAIN-THREAD
    # call, so that is where the turn actually ends and whose summary the researcher
    # reads. Asserting only "called somewhere" accepted
    # research_delivered -> record_search -> research_append: deliver-then-keep-
    # researching, the exact regression this test exists to catch, invisible here because
    # the tool is inert in this harness.
    after = [str(c.get("tool")) for c in tool_calls[first + 1:]]
    assert not after, (
        f"`{_DELIVERED_TOOL}` must be the LAST tool call of the turn; {len(after)} "
        f"follow it: {after}. On the hosted plane the first main-thread call halts the "
        "turn, so anything queued after it never runs and never reaches the researcher."
    )

    # `[first]`, though the assertion above makes it provably the same element as
    # `[-1]`: no input can distinguish the two once "nothing follows it" holds, and
    # swapping them reds no test. Written as `first` because it states the rule the
    # hosted plane actually follows -- it halts on the FIRST main-thread call -- and
    # it stays correct if the last-call assertion is ever relaxed.
    summary = (tool_calls[first].get("args") or {}).get("summary")
    assert isinstance(summary, str) and summary.strip(), (
        f"`{_DELIVERED_TOOL}` needs a one-sentence summary naming what was delivered; "
        f"got {summary!r}. Read from the FIRST call, which is the one the hosted plane "
        "halts on and puts in front of the stop reason -- an empty summary there is what "
        "the researcher reads, however well-formed a later call might be."
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

    Keyed on ``args.subagent_type`` rather than the tool name: the recorded
    name is ``None`` for an Agent spawn in this harness, so a name-based
    match finds nothing and the assertion below would pass vacuously.
    """
    prompts = []
    for call in builtin_tool_calls or []:
        args = call.get("args") or {}
        if args.get("subagent_type") == callee:
            prompts.append(args.get("prompt") or "")
    return prompts


def test_delegation_names_focus_and_target(test, builtin_tool_calls):
    """The spawn the router actually sent names ``focus:`` and ``target_id:``.

    research/SKILL.md's Second-opinion section requires both on the gps-mentor
    delegation. Both sit verbatim in the recorded spawn args, so they are read
    from the hook records rather than left to the judge, which cannot see them
    and has scored a spawn 3/3 on prose alone.
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
        if not any(field in p for p in prompts)
    ]
    assert not missing, (
        f"The '{expected}' delegation omits {missing}. research/SKILL.md "
        f"requires the delegation message to name the focus and the target_id. "
        f"Prompts seen: {[p[:160] for p in prompts]}"
    )
