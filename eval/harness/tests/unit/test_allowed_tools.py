"""Tests for harness.allowed_tools — per-skill tool allowlist computation."""

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
        "---\nname: translation\nallowed-tools: []\n---\n# Translation"
    )
    tools = compute_allowed_tools("translation", tmp_path)
    assert "Write" in tools
    assert "Edit" in tools
    assert "Read" in tools


def test_already_qualified_mcp_tool_passed_through(tmp_path):
    skill = tmp_path / "x"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: x\nallowed-tools:\n  - mcp__custom__special\n  - bare_tool\n---"
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
    (skill / "SKILL.md").write_text("# No frontmatter here\nJust body content.")
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
    """Agents the skill never references contribute nothing — keeps the
    allowlist tight so direct out-of-frontmatter calls are still denied."""
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


def test_skill_refs_accepts_both_quote_styles_and_drops_self():
    from harness.allowed_tools import skill_refs_in_text

    assert skill_refs_in_text('call Skill("a-skill") then Skill(\'b-skill\')') == [
        "a-skill",
        "b-skill",
    ]
    assert skill_refs_in_text("Skill( \"spaced\" )") == ["spaced"]
    assert skill_refs_in_text("prose about Skill and skills") == []


def test_callee_tools_absent_until_the_test_opts_in():
    """Opt-in, not automatic: every test that does not declare `run_skills`
    keeps the allowlist it had before #1012.

    Unioning all four of search-records' callees unconditionally would let any
    of them reach a tool with no fixture, tripping the Phase 2 gate and
    aborting the CALLER's test — arming a nondeterministic failure on 24 tests
    to serve the one that wants it.
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
    from harness.allowed_tools import uncovered_callee_fixtures

    missing = uncovered_callee_fixtures(
        "search-records",
        PLUGIN_SKILLS,
        stubbed_skills=set(),
        registered_tools={
            "record_search",
            "place_search",
            "external_links_search",
            "research_append",
            "research_log_append",
        },
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
