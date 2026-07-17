"""Compute per-skill allowed_tools list per unit-test-spec.md §15.

Each skill's SKILL.md frontmatter declares which MCP tools it may call.
The harness derives the SDK's `allowed_tools` from that declaration plus a
baseline of filesystem tools, plus the frontmatter `tools:` of every plugin
agent the skill delegates to via `@plugin:<name>` (the delegated agent's
MCP calls run in the same session and must not be denied by the
skill-frontmatter-derived allowlist). Calls outside the union are rejected
by the SDK at call time (in addition to the after-the-fact universal
validator).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from harness.snapshot import agent_refs_in_text
from harness.workspace import DEFAULT_PLUGIN_AGENTS


def compute_allowed_tools(
    skill_name: str,
    skills_dir: Path,
    *,
    mcp_server_name: str = "genealogy",
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
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
