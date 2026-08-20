"""Tests for harness.allowed_tools — per-skill declared-tool computation.

The session grants every registered MCP tool (issue #1748). The declared
set computed by ``compute_allowed_tools`` is advisory: it feeds the
``test_tool_allowlist`` validator (which warns but does not gate) and the
``ValueError`` guard on ``run_skills``. These tests verify the declared
set is accurate, NOT that it narrows the SDK session.
"""

from pathlib import Path

import pytest

from harness.allowed_tools import compute_allowed_tools


REPO_ROOT = Path(__file__).resolve().parents[4]
PLUGIN_SKILLS = REPO_ROOT / "packages/engine/plugin/skills"


def test_search_wikipedia_includes_wikipedia_search():
    tools = compute_allowed_tools("search-wikipedia", PLUGIN_SKILLS)
    assert "mcp__genealogy__wikipedia_search" in tools
    assert "Read" in tools
    assert "Write" in tools
    assert "Skill" in tools


def test_baseline_always_present():
    tools = compute_allowed_tools("search-wikipedia", PLUGIN_SKILLS)
    for required in ("Read", "Glob", "Grep", "Skill"):
        assert required in tools


def test_baseline_always_includes_write_and_edit(tmp_path):
    """v1.3: Write/Edit are always in the baseline. The previous
    hardcoded no-write set drifted from the ownership table and was
    redundant with the universal ownership validator. See allowed_tools.py
    for the rationale."""
    skill = tmp_path / "translation"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: translation\nallowed-tools: []\n---\n# Translation", encoding="utf-8"
    )
    tools = compute_allowed_tools("translation", tmp_path)
    assert "Write" in tools
    assert "Edit" in tools
    assert "Read" in tools


def test_already_qualified_mcp_tool_passed_through(tmp_path):
    skill = tmp_path / "x"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: x\nallowed-tools:\n  - mcp__custom__special\n  - bare_tool\n---", encoding="utf-8"
    )
    tools = compute_allowed_tools("x", tmp_path)
    assert "mcp__custom__special" in tools
    assert "mcp__genealogy__bare_tool" in tools


def test_missing_skill_md_returns_baseline(tmp_path):
    (tmp_path / "noskill").mkdir()
    tools = compute_allowed_tools("noskill", tmp_path)
    assert "Read" in tools
    assert "Skill" in tools
    # No MCP tools because no frontmatter
    assert not any(t.startswith("mcp__") for t in tools)


def test_no_frontmatter_returns_baseline(tmp_path):
    skill = tmp_path / "no-fm"
    skill.mkdir()
    (skill / "SKILL.md").write_text("# No frontmatter here\nJust body content.", encoding="utf-8")
    tools = compute_allowed_tools("no-fm", tmp_path)
    assert "Read" in tools
    assert not any(t.startswith("mcp__") for t in tools)


# --- Task + plugin-agent tool union ----------------------------------------


def test_task_always_in_baseline():
    tools = compute_allowed_tools("search-wikipedia", PLUGIN_SKILLS)
    assert "Task" in tools


def _make_skill_and_agent(tmp_path, *, body: str):
    skills = tmp_path / "skills"
    skill = skills / "router"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        f"---\nname: router\nallowed-tools:\n  - record_search\n---\n{body}",
        encoding="utf-8",
    )
    agents = tmp_path / "agents"
    agents.mkdir()
    (agents / "spike-echo.md").write_text(
        "---\nname: spike-echo\nmodel: claude-haiku-4-5\ntools:\n"
        "  - Read\n  - wikipedia_search\n---\nAgent body.\n",
        encoding="utf-8",
    )
    return skills, agents


def test_referenced_agent_tools_unioned(tmp_path):
    """A skill that delegates via @plugin:<name> gets the agent's MCP tools
    in its allowlist — the subagent's calls must not be denied."""
    skills, agents = _make_skill_and_agent(
        tmp_path, body="Delegate to `@plugin:spike-echo` for the lookup.\n"
    )
    tools = compute_allowed_tools("router", skills, agents_dir=agents)
    assert "mcp__genealogy__record_search" in tools  # skill's own frontmatter
    assert "mcp__genealogy__wikipedia_search" in tools  # unioned from agent
    assert "Read" in tools  # agent's builtin entry passes through unqualified
    assert "mcp__genealogy__Read" not in tools


def test_unreferenced_agent_tools_not_unioned(tmp_path):
    """Agents the skill never references contribute nothing to the
    declared set — the advisory validator only warns on the skill's
    own + referenced tools."""
    skills, agents = _make_skill_and_agent(tmp_path, body="No delegation.\n")
    tools = compute_allowed_tools("router", skills, agents_dir=agents)
    assert "mcp__genealogy__wikipedia_search" not in tools


def test_referenced_but_missing_agent_is_ignored(tmp_path):
    """A dangling @plugin: ref (no agent file) must not crash or widen."""
    skills, agents = _make_skill_and_agent(
        tmp_path, body="Delegate to `@plugin:ghost`.\n"
    )
    tools = compute_allowed_tools("router", skills, agents_dir=agents)
    assert "mcp__genealogy__record_search" in tools
    assert not any(t == "mcp__genealogy__ghost" for t in tools)


# --- image-reader-opus: the union must actually pick up the real files -----
#
# The image-reader-opus design's first draft put the
# discoverability pointer in agents/image-reader.md (an agent body), which
# compute_allowed_tools never scans — only a SKILL.md is scanned for
# @plugin:<name> references. That placement bug would have made
# image-reader-opus's image_read grant unreachable in the unit harness while
# looking correct on a read-through. These tests exercise the union against
# the real repo files rather than trusting the placement was right.


def test_record_extraction_unions_image_reader_opus_image_read():
    tools = compute_allowed_tools("record-extraction", PLUGIN_SKILLS)
    assert "mcp__genealogy__image_read" in tools


def test_search_images_unions_image_reader_opus_image_read():
    tools = compute_allowed_tools("search-images", PLUGIN_SKILLS)
    assert "mcp__genealogy__image_read" in tools


# --- Sub-skill union (issue #1012) -----------------------------------------
#
# `Skill("<name>")` loads the callee's instructions into the SAME conversation,
# so the callee's tool calls are checked against the CALLER's allowlist. Before
# this union, search-external-sites ran inside search-records holding neither
# place_search nor external_links_search — and the failure was silent: the model
# invented an Ancestry URL from prose rather than erroring. These run against
# the real plugin files, not a tmp_path fixture, because the bug was a real gap
# between two real skills and a synthetic pair would not have caught it.


def test_skill_refs_finds_every_declared_callee():
    from harness.allowed_tools import skill_refs_for_skill

    callees = skill_refs_for_skill(PLUGIN_SKILLS / "search-records" / "SKILL.md")
    assert callees == [
        "project-status",
        "record-extraction",
        "research-plan",
        "search-external-sites",
    ]


def test_skill_refs_accepts_both_quote_styles():
    """Extraction only — `skill_refs_in_text` has no self-filter to exercise.

    Named `..._and_drops_self` until 2026-08-09, which claimed coverage it did
    not have: the self-filter lives in `skill_refs_for_skill`, one level up,
    and deleting it left this test green. `test_self_reference_is_dropped`
    below is the one that actually covers it.
    """
    from harness.allowed_tools import skill_refs_in_text

    assert skill_refs_in_text('call Skill("a-skill") then Skill(\'b-skill\')') == [
        "a-skill",
        "b-skill",
    ]
    assert skill_refs_in_text("Skill( \"spaced\" )") == ["spaced"]
    assert skill_refs_in_text("prose about Skill and skills") == []


def test_self_reference_is_dropped(tmp_path):
    """`skill_refs_for_skill` drops a skill naming itself, and keeps the rest.

    No plugin body does this today, so the filter can only be covered by a
    constructed file — which is precisely why it went untested. The name comes
    from the parent directory, so the fixture has to be a real directory.
    """
    from harness.allowed_tools import skill_refs_for_skill

    skill = tmp_path / "search-records"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        '---\nname: search-records\n---\n'
        'Reachable via Skill("search-records") from the router.\n'
        'Hands off with Skill("record-extraction") and Skill("research-plan").\n',
        encoding="utf-8",
    )

    assert skill_refs_for_skill(skill / "SKILL.md") == [
        "record-extraction",
        "research-plan",
    ]


def test_skill_refs_for_missing_file_is_empty(tmp_path):
    from harness.allowed_tools import skill_refs_for_skill

    assert skill_refs_for_skill(tmp_path / "absent" / "SKILL.md") == []


def test_run_skills_callee_brings_its_own_agents_tools():
    """The union follows the AGENT axis one level down, not just the skill's.

    `record-extraction` delegates to `@plugin:record-extractor`. Union only its
    `allowed-tools` and the callee runs holding eight fewer tools than it does
    standalone — and the failure is silent improvisation, not an error, which
    is the whole bug #1012 closed one level up (#1225 review).

    Asserted against the real plugin rather than a synthetic pair: the gap was
    between two real files, and a constructed fixture would have passed while
    production drifted.
    """
    as_callee = set(
        compute_allowed_tools(
            "search-records", PLUGIN_SKILLS, run_skills={"record-extraction"}
        )
    )
    standalone = set(compute_allowed_tools("record-extraction", PLUGIN_SKILLS))

    assert "mcp__genealogy__extraction_append" in as_callee
    assert not (standalone - as_callee), (
        "a run_skills callee must hold every tool it holds standalone; "
        f"missing: {sorted(t.split('__')[-1] for t in standalone - as_callee)}"
    )


def test_uncovered_callee_fixtures_sees_the_callees_agent_tools(tmp_path):
    """Grant and preflight must widen by the same rule.

    Granting a tool the fixture check never looks at recreates "permission is
    not existence": the call resolves to nothing and aborts the CALLER twenty
    turns in, naming the wrong skill.
    """
    from harness.allowed_tools import uncovered_callee_fixtures

    caller = tmp_path / "caller"
    caller.mkdir()
    (caller / "SKILL.md").write_text(
        '---\nname: caller\nallowed-tools: []\n---\nHands off via Skill("callee").\n',
        encoding="utf-8",
    )
    callee = tmp_path / "callee"
    callee.mkdir()
    (callee / "SKILL.md").write_text(
        "---\nname: callee\nallowed-tools: [own_tool]\n---\n"
        "Delegates to @plugin:helper for the heavy lifting.\n",
        encoding="utf-8",
    )
    agents = tmp_path / "agents"
    agents.mkdir()
    (agents / "helper.md").write_text(
        "---\nname: helper\ntools:\n  - agent_only_tool\n---\nHelper.\n",
        encoding="utf-8",
    )

    missing = uncovered_callee_fixtures(
        "caller",
        tmp_path,
        stubbed_skills=set(),
        registered_tools={"own_tool"},
        agents_dir=agents,
    )
    assert missing == [("callee", "agent_only_tool")]


def test_callee_tools_absent_until_the_test_opts_in():
    """Opt-in, not automatic: every test that does not declare `run_skills`
    keeps the declared set it had before #1012.

    The session grants all tools regardless (issue #1748), but
    `uncovered_callee_fixtures` still uses the declared set for its
    preflight — an unstocked callee would abort the run 20 turns in.
    """
    tools = compute_allowed_tools("search-records", PLUGIN_SKILLS)
    assert "mcp__genealogy__place_search" not in tools
    assert "mcp__genealogy__external_links_search" not in tools


def test_opting_in_unions_that_callees_tools():
    tools = compute_allowed_tools(
        "search-records", PLUGIN_SKILLS, run_skills={"search-external-sites"}
    )
    # The two search-external-sites needs and search-records lacks.
    assert "mcp__genealogy__place_search" in tools
    assert "mcp__genealogy__external_links_search" in tools
    # The caller's own tools survive the union.
    assert "mcp__genealogy__record_search" in tools


def test_opting_in_to_one_callee_does_not_grant_another():
    tools = compute_allowed_tools(
        "search-records", PLUGIN_SKILLS, run_skills={"search-external-sites"}
    )
    # volume_search belongs to research-plan / record-extraction, not to
    # search-external-sites. Declaring one callee must not widen to the rest.
    assert "mcp__genealogy__volume_search" not in tools


def test_declaring_a_callee_the_skill_never_invokes_is_an_error():
    with pytest.raises(ValueError, match="never invokes"):
        compute_allowed_tools(
            "search-records", PLUGIN_SKILLS, run_skills={"timeline"}
        )


# --- Preflight: permission is not existence --------------------------------


def test_preflight_flags_a_live_callee_with_no_fixtures():
    from harness.allowed_tools import uncovered_callee_fixtures

    missing = uncovered_callee_fixtures(
        "search-records",
        PLUGIN_SKILLS,
        stubbed_skills=set(),
        registered_tools={"record_search"},
    )
    pairs = {(c, t) for c, t in missing if c == "search-external-sites"}
    assert ("search-external-sites", "place_search") in pairs
    assert ("search-external-sites", "external_links_search") in pairs


def test_preflight_is_satisfied_once_the_fixtures_are_stocked():
    """Derives the stocked set from the callee's own frontmatter rather than
    hardcoding it.

    The hardcoded version went red the moment main granted the callee a new
    tool: #1521 added `collections_search` to search-external-sites so it can
    note FamilySearch's own holdings before recommending a competitor, and this
    test — which claims "the preflight is satisfied once the fixtures are
    stocked" — was still describing a two-tool callee. Neither change was
    wrong; they only broke together, and the test's own subject is that a
    complete set satisfies the preflight, not which tools happened to be in it
    on the day it was written.
    """
    from harness.allowed_tools import load_skill_frontmatter, uncovered_callee_fixtures

    callee_fm = load_skill_frontmatter(
        PLUGIN_SKILLS / "search-external-sites" / "SKILL.md"
    )
    stocked = {
        t.rsplit("__", 1)[-1] for t in (callee_fm.get("allowed-tools") or [])
    } | {"record_search"}
    assert "collections_search" in stocked, (
        "sanity: the callee's frontmatter should be the source of this set"
    )

    missing = uncovered_callee_fixtures(
        "search-records",
        PLUGIN_SKILLS,
        stubbed_skills=set(),
        registered_tools=stocked,
    )
    assert [(c, t) for c, t in missing if c == "search-external-sites"] == []


def test_preflight_ignores_a_stubbed_callee():
    """A stubbed callee never executes, so it never calls a tool and needs
    no fixtures. This is why ut_search_records_018 stays green unchanged."""
    from harness.allowed_tools import uncovered_callee_fixtures

    missing = uncovered_callee_fixtures(
        "search-records",
        PLUGIN_SKILLS,
        stubbed_skills={"search-external-sites"},
        registered_tools={"record_search"},
    )
    assert all(c != "search-external-sites" for c, _ in missing)


def test_preflight_message_names_both_remedies():
    from harness.allowed_tools import format_uncovered_callee_fixtures

    msg = format_uncovered_callee_fixtures(
        "ut_x_001", [("search-external-sites", "place_search")]
    )
    assert "ut_x_001" in msg
    assert "place_search" in msg
    assert "stub_skills" in msg


# --- Permissive grant (issue #1748) -------------------------------------------


def test_session_grants_every_registered_mcp_tool(tmp_path, monkeypatch):
    """The SDK session grants every registered MCP tool regardless of what
    the skill declares (issue #1748).  Reads the real ClaudeAgentOptions
    that run_skill passes to query — NOT a reimplementation of the grant
    logic.  Fails on main where per-skill narrowing still derives an
    extra_disallowed complement."""
    import asyncio

    from claude_agent_sdk import ResultMessage

    import harness.skill_runner as sr
    from harness.auth import AuthConfig
    from harness.mock_mcp import LIVE_TOOLS
    from harness.skill_runner import DISALLOWED_BACKSTOP

    class _Stream:
        """Minimal async iterator that yields a single ResultMessage."""

        def __init__(self, messages):
            self._m, self._i = messages, 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._i >= len(self._m):
                raise StopAsyncIteration
            self._i += 1
            return self._m[self._i - 1]

        async def aclose(self):
            return None

    seen: dict = {}

    def fake_query(**kw):
        seen["options"] = kw["options"]
        return _Stream([
            ResultMessage(
                subtype="result", duration_ms=1, duration_api_ms=1,
                is_error=False, num_turns=1, session_id="S1",
            )
        ])

    monkeypatch.setattr(sr, "query", fake_query)
    asyncio.run(sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(
            skill_runner_mode="api_key", api_key="x", detail="stub",
        ),
    ))
    options = seen["options"]

    # Every LIVE_TOOLS entry must be granted.
    for name in LIVE_TOOLS:
        q = f"mcp__genealogy__{name}"
        assert q in options.allowed_tools, f"{q} missing from the session grant"
        assert q not in options.disallowed_tools, (
            f"{q} in disallowed_tools — per-skill narrowing is back"
        )

    # Dangerous tools still blocked.
    assert sorted(options.disallowed_tools) == sorted(DISALLOWED_BACKSTOP)


# --- Advisory validator (issue #1748) ----------------------------------------


def test_tool_allowlist_validator_warns_instead_of_failing():
    """test_tool_allowlist is advisory: undeclared tools emit a warning,
    not an AssertionError. The session grants all tools (issue #1748)."""
    import warnings
    from validators.test_universal import test_tool_allowlist

    tool_calls = [
        {"tool": "mcp__genealogy__wikipedia_search", "args": {}},
        {"tool": "mcp__genealogy__undeclared_tool", "args": {}},
    ]
    frontmatter = {"name": "test-skill", "allowed-tools": ["wikipedia_search"]}
    test = {"type": "positive", "skill": "test-skill"}

    # Must NOT raise AssertionError.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        test_tool_allowlist(tool_calls, frontmatter, test, attempted_mcp_calls=[])

    # Must emit a warning naming the undeclared tool.
    msgs = [str(w.message) for w in caught]
    assert any("undeclared_tool" in m for m in msgs), (
        f"expected a warning about undeclared_tool; got: {msgs}"
    )
