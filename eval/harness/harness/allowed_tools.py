"""Compute per-skill allowed_tools list per unit-test-spec.md §15.

Each skill's SKILL.md frontmatter declares which MCP tools it may call.
The harness derives the SDK's `allowed_tools` from that declaration plus a
baseline of filesystem tools, plus the frontmatter `tools:` of every plugin
agent the skill delegates to via `@plugin:<name>`, plus — only for the
sub-skills a test names in `execution.run_skills` — the `allowed-tools:`
of each such `Skill("<name>")` callee. All three run in the same session,
so a tool missing from the union is denied by the SDK at call time (in
addition to the after-the-fact universal validator).

The agent union is unconditional; the sub-skill union is opt-in per test.
The asymmetry is deliberate and explained at the call site.

**This narrowing is a harness construct, not a product behavior.** Neither
production path builds a per-skill allowlist: the hosted control plane
passes `permission_mode="bypassPermissions"` with no `allowed_tools` at all
(`apps/server/app/agent/real_agent.py`), and Cowork loads the plugin whole,
so a real session holds every MCP tool the server advertises. A skill's
`allowed-tools` frontmatter narrows what it *should* reach for, not what
the session *has*. The harness narrows for real to keep tests honest about
that declaration — which is why a gap here shows up as a test-only failure
with no product symptom, and why the fix is measured against production
rather than against what feels safe (issue #1012).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from harness.snapshot import agent_refs_in_text
from harness.workspace import DEFAULT_PLUGIN_AGENTS

# Sub-skill delegation in a SKILL.md body: `Skill("<name>")`.
#
# Deliberately NOT placed alongside `agent_refs_in_text` in snapshot.py.
# That module's scanners have a TS twin in eval/app/lib/snapshot.ts because
# build_snapshot uses them, and adding a scanner there implies embedding the
# callee's SKILL.md in the caller's snapshot — which would flip
# search-records' run log inactive on any edit to its four callees. Whether
# that churn buys eval signal is the same question that removed
# `packages/engine/mcp-server/src/**` from the snapshot; it is deliberately
# left open here (see the PR for #1012) rather than answered by a helper's
# placement. The allowlist is this scanner's only consumer, so it lives here.
#
# Both quote styles are accepted. The corpus only uses double quotes today,
# but a single-quoted call would otherwise miss silently and hand the callee
# an allowlist without its own tools — the exact failure this closes.
_SKILL_REF_RE = re.compile(r"""Skill\(\s*['"]([a-z0-9-]+)['"]\s*\)""")


def compute_allowed_tools(
    skill_name: str,
    skills_dir: Path,
    *,
    mcp_server_name: str = "genealogy",
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
    run_skills: set[str] | None = None,
) -> list[str]:
    """Return the allowed_tools list for the SDK when running this skill.

    Composes:
      - Baseline filesystem tools (Read, Glob, Grep, Skill)
      - Write/Edit always — skills may need to write a markdown file
        (search-wikipedia), update research.json (most others), or modify
        tree.gedcomx.json (tree-edit). A previous version maintained a
        hardcoded no-write set, but it was a parallel source of truth
        that drifted from the ownership table. Layer-1 defense against
        misuse comes from test_universal.test_ownership_table for
        research.json writes, and the disallowed-tools backstop
        (Bash/WebFetch/etc.) for dangerous host tools. Read-only skills
        that don't write to anything simply ignore Write/Edit at runtime;
        granting them adds no risk.
      - Task always — plugin subagents are staged into every workspace
        (workspace.build_workspace) and a skill delegates only when its
        SKILL.md instructs it to, so no per-test flag gates delegation.
      - Every MCP tool from the skill's `allowed-tools` frontmatter,
        qualified to `mcp__<server>__<tool>` form.
      - Every tool from the frontmatter `tools:` of each plugin agent the
        skill's SKILL.md references via `@plugin:<name>` — a delegated
        agent's MCP calls go through the same session allow/deny lists, so
        they must be in the union or the SDK denies them.
      - Every tool from the `allowed-tools:` of each sub-skill named in
        `run_skills` (from the test's `execution.run_skills`). Same reason —
        a `Skill()` callee runs in this session — but opt-in per test; see
        the WHY OPT-IN note at the call site.
    """
    skill_md = skills_dir / skill_name / "SKILL.md"
    fm = load_skill_frontmatter(skill_md)
    declared = list(fm.get("allowed-tools", []) or [])

    baseline = ["Read", "Glob", "Grep", "Write", "Edit", "Skill", "Task"]

    # Union in the tools of every referenced plugin agent. Referenced-only
    # (not every staged agent) keeps the allowlist tight: an agent the skill
    # never delegates to contributes nothing, so a skill wrongly calling
    # that agent's tools directly is still denied.
    for agent in agent_refs_for_skill(skill_md):
        agent_md = Path(agents_dir) / f"{agent}.md"
        agent_fm = load_skill_frontmatter(agent_md)
        declared.extend(agent_fm.get("tools", []) or [])

    # Union in the tools of each sub-skill this test declares it will really
    # run, via `execution.run_skills`.
    #
    # `Skill()` is not a subprocess and not a subagent — it loads the callee's
    # instructions into the SAME conversation, so the callee's tool calls are
    # checked against THIS allowlist. Without the union the callee is denied
    # its own tools, and the observed failure mode is not an error: the model
    # improvises. ut_search_records_018 spent weeks green while
    # search-external-sites, holding none of `place_search` /
    # `external_links_search`, invented an Ancestry URL from prose that was
    # missing `name_x=ps_ps` — the phonetic-match parameter that is the entire
    # reason the escalation exists (issue #1012).
    #
    # WHY OPT-IN, rather than unioning every `Skill("<name>")` in the body.
    # Permission is only half of what a call needs: a tool the mock never
    # registered does not exist, and the callee's first call to it trips the
    # Phase 2 gate and aborts the CALLER's test with `unmatched_tool_call`.
    # search-records names four callees but any given test drives at most one,
    # so unconditional unioning would arm that abort on all 24 tests to serve
    # the one that wants it — converting today's quiet wrong-answer into a
    # nondeterministic $6.75 suite re-run. Opt-in keeps the blast radius at
    # the test that asked for it and leaves every other test byte-identical.
    # It is also the honest reading of "decide what a test must declare
    # before its callee may really run": the declaration is this field.
    #
    # ONE HOP ONLY. search-records is currently the sole skill that delegates
    # via Skill(), and none of its four callees (project-status,
    # record-extraction, research-plan, search-external-sites) delegate
    # further, so the graph is one level deep and cannot cycle. If a callee
    # ever starts delegating, make this recursive AND add a visited-set cycle
    # guard — do not just add a second hop, which pushes the same bug one
    # level down where it is harder to see.
    declarable = set(skill_refs_for_skill(skill_md))
    for callee in sorted(run_skills or ()):
        if callee not in declarable:
            raise ValueError(
                f"{skill_name!r} declares run_skills={callee!r}, but its "
                f"SKILL.md never invokes Skill({callee!r}). Delegation the "
                f"skill cannot perform would grant tools nothing will use. "
                f"Callees found: {sorted(declarable) or 'none'}"
            )
        callee_fm = load_skill_frontmatter(skills_dir / callee / "SKILL.md")
        declared.extend(callee_fm.get("allowed-tools", []) or [])

    tools: list[str] = list(baseline)
    for entry in declared:
        # Allow callers to either declare bare names ("wikipedia_search")
        # or pre-qualified names ("mcp__genealogy__wikipedia_search").
        # Agent frontmatter also lists built-in tools (capitalized, e.g.
        # "Read") — pass those through unqualified.
        if "__" in entry:
            qualified = entry
        elif entry[:1].isupper():
            qualified = entry
        else:
            qualified = f"mcp__{mcp_server_name}__{entry}"
        if qualified not in tools:
            tools.append(qualified)

    return tools


def declared_skill_tools(skill_name: str, skills_dir: Path) -> set[str]:
    """The BARE tool names a skill declares in its own `allowed-tools`.

    Deliberately excludes the agent-union that `compute_allowed_tools` adds —
    that is the whole point. The two sets answer different questions:

      compute_allowed_tools  → "what may reach the SDK in this session?"
                               (superset: the skill's tools + its subagents')
      declared_skill_tools   → "what did this skill claim for ITSELF?"

    The gap between them is exactly the set a skill holds only because a
    subagent needs it — which the skill itself must not call. The per-context
    policy (harness/context_policy.py) uses this to tell a legitimate direct
    call from a boundary violation: `search-images` declares `image_read` and
    browses pages itself, while `record-extraction` does not declare it and
    holds it only via `@plugin:image-reader`, so its router must delegate.
    """
    fm = load_skill_frontmatter(skills_dir / skill_name / "SKILL.md")
    return {
        entry.rsplit("__", 1)[-1] if "__" in entry else entry
        for entry in (fm.get("allowed-tools", []) or [])
    }


def agent_refs_for_skill(skill_md: Path) -> list[str]:
    """Sorted unique plugin-agent names a SKILL.md references via
    `@plugin:<name>`. Empty for a missing file."""
    if not skill_md.exists():
        return []
    return agent_refs_in_text(skill_md.read_text(encoding="utf-8"))


def skill_refs_in_text(text: str) -> list[str]:
    """Sorted unique sub-skill names invoked as `Skill("<name>")`."""
    return sorted(set(_SKILL_REF_RE.findall(text)))


def skill_refs_for_skill(skill_md: Path) -> list[str]:
    """Sorted unique sub-skill names a SKILL.md delegates to via
    `Skill("<name>")`. Empty for a missing file.

    A skill naming *itself* is filtered out: several SKILL.md bodies quote
    their own invocation when describing how a caller reaches them, and
    self-inclusion would be a no-op that muddies the union's intent.
    """
    if not skill_md.exists():
        return []
    own_name = skill_md.parent.name
    return [n for n in skill_refs_in_text(skill_md.read_text(encoding="utf-8"))
            if n != own_name]


def uncovered_callee_fixtures(
    skill_name: str,
    skills_dir: Path,
    *,
    stubbed_skills: set[str],
    registered_tools: set[str],
) -> list[tuple[str, str]]:
    """Tools an un-stubbed callee will need that no fixture registered.

    Returns sorted `(callee, tool)` pairs. Empty means the test is safe to run.

    The union makes a callee's tools *permitted*; only a fixture makes them
    *exist*. Miss the second and the callee's first real call trips the
    Phase 2 uncovered-tool-call gate, which aborts the CALLER's test with
    `unmatched_tool_call` — a confusing failure 20 turns and ~$0.50 in,
    pointing at the wrong skill. Called before the run so a missing fixture
    is an authoring error at second zero instead.

    Fixtures stay explicitly declared per test rather than auto-loaded from a
    per-skill default set. Auto-loading would let a test pass on fixtures it
    never named, and a later change to the default set would alter that
    test's behavior with no diff in the test file — the same invisible
    coupling that left `record_read` unstocked across 18 of 20 search tests.
    The cost is that a test author must know the callee's tools; this check
    is what pays it back.

    A stubbed callee needs nothing: it never executes, so it never calls a
    tool. That is why the message names stubbing as the fix — for most tests
    it is the right one, since the callee has its own unit suite.
    """
    # Live tools run the real compiled MCP server against the workspace, so
    # they are registered unconditionally and have no fixture to stock. Imported
    # lazily: mock_mcp pulls in claude_agent_sdk at module scope, and this
    # module is imported by tooling that has no reason to load the SDK.
    from harness.mock_mcp import LIVE_TOOLS

    missing: set[tuple[str, str]] = set()
    for callee in skill_refs_for_skill(skills_dir / skill_name / "SKILL.md"):
        if callee in stubbed_skills:
            continue
        callee_fm = load_skill_frontmatter(skills_dir / callee / "SKILL.md")
        for entry in callee_fm.get("allowed-tools", []) or []:
            bare = entry.rsplit("__", 1)[-1] if "__" in entry else entry
            if bare[:1].isupper():
                continue  # built-in (Read, Write); not fixture-backed
            if bare in LIVE_TOOLS:
                continue  # served by the real compiled server, always present
            if bare not in registered_tools:
                missing.add((callee, bare))
    return sorted(missing)


def format_uncovered_callee_fixtures(
    test_id: str, missing: list[tuple[str, str]]
) -> str:
    """Human-facing message for `uncovered_callee_fixtures` output."""
    by_callee: dict[str, list[str]] = {}
    for callee, tool in missing:
        by_callee.setdefault(callee, []).append(tool)
    lines = [
        f"{test_id}: a sub-skill is allowed to run but its tools have no fixtures."
    ]
    for callee, tools in sorted(by_callee.items()):
        lines.append(f"  {callee} will call: {', '.join(sorted(tools))}")
    lines.append(
        "Either stock a fixture for each tool above, or stub the callee with "
        '`"execution": {"stub_skills": [{"skill": "<name>", "response": "..."}]}`. '
        "Stubbing is usually right — the callee has its own unit suite, and "
        "running it here spends turns on coverage that already exists."
    )
    return "\n".join(lines)


def load_skill_frontmatter(skill_md: Path) -> dict[str, Any]:
    """Parse the YAML frontmatter from a skill's SKILL.md.

    Also works on plugin agent .md files — same frontmatter convention.

    Returns an empty dict for missing files, missing frontmatter blocks, or
    YAML parse errors — the harness treats absence as "no constraints" so
    a half-written skill doesn't break the suite.

    Public helper so the orchestrator and call-time allowlist computation
    share one source of truth instead of duplicating the parser.
    """
    if not skill_md.exists():
        return {}
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    try:
        return yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return {}


# Backwards-compatible alias for any callers still importing the private form.
_load_frontmatter = load_skill_frontmatter
