"""Compute per-skill allowed_tools list per unit-test-spec.md §15.

Each skill's SKILL.md frontmatter declares which MCP tools it may call.
The harness derives the SDK's `allowed_tools` from that declaration plus a
baseline of filesystem tools. Calls outside the union are rejected by the
SDK at call time (in addition to the after-the-fact universal validator).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def compute_allowed_tools(
    skill_name: str,
    skills_dir: Path,
    *,
    mcp_server_name: str = "genealogy",
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
      - Every MCP tool from the skill's `allowed-tools` frontmatter,
        qualified to `mcp__<server>__<tool>` form.
    """
    fm = load_skill_frontmatter(skills_dir / skill_name / "SKILL.md")
    declared = fm.get("allowed-tools", []) or []

    baseline = ["Read", "Glob", "Grep", "Write", "Edit", "Skill"]

    mcp_tools: list[str] = []
    for entry in declared:
        # Allow callers to either declare bare names ("wikipedia_search")
        # or pre-qualified names ("mcp__genealogy__wikipedia_search").
        if "__" in entry:
            mcp_tools.append(entry)
        else:
            mcp_tools.append(f"mcp__{mcp_server_name}__{entry}")

    return baseline + mcp_tools


def load_skill_frontmatter(skill_md: Path) -> dict[str, Any]:
    """Parse the YAML frontmatter from a skill's SKILL.md.

    Returns an empty dict for missing files, missing frontmatter blocks, or
    YAML parse errors — the harness treats absence as "no constraints" so
    a half-written skill doesn't break the suite.

    Public helper so the orchestrator and call-time allowlist computation
    share one source of truth instead of duplicating the parser.
    """
    if not skill_md.exists():
        return {}
    text = skill_md.read_text()
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
