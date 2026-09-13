"""Helpers shared by the D1–2 probes (`probe_bash_deny`, `probe_registration`,
and `dev/probe_agent_binding.py`'s prototype arms).

Nothing here spawns a session or touches the network: fixture seeding, the
turn cap every probe passes, and the flatteners that turn SDK message blocks
into the excerpts the verdict tables print.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/_probe_common.py -> parents[4] = repo
REPO = Path(__file__).resolve().parents[4]
FIXTURE_DIR = REPO / "eval" / "fixtures" / "scenarios" / "empty-project-just-created"
FIXTURE_FILES = ("research.json", "tree.gedcomx.json")

# ClaudeAgentOptions.max_turns for every probe session: one tool call, its
# result, one reply — plus a single retry. A session that hits it ends with
# ResultMessage.subtype == "error_max_turns", which the verdicts read as VOID.
MAX_TURNS = 3

EXCERPT = 300


def seed_project(project: Path) -> Path:
    """Copy the empty-project fixture into ``project`` and return it."""
    project.mkdir(parents=True, exist_ok=True)
    for name in FIXTURE_FILES:
        shutil.copyfile(FIXTURE_DIR / name, project / name)
    return project


def result_text(content: Any) -> str:
    """Flatten a ToolResultBlock's content (str | list[dict] | None) to text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            parts.append(str(item.get("text") if item.get("type") == "text" else item))
        else:
            parts.append(str(item))
    return "\n".join(parts)


def one_line(text: str, limit: int = EXCERPT) -> str:
    return " ".join(text.split())[:limit]


def usage_summary(result: Any) -> dict[str, Any]:
    """The token/cost fields of a ResultMessage, as plain values."""
    usage = getattr(result, "usage", None) or {}
    return {
        "total_cost_usd": getattr(result, "total_cost_usd", None),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "cache_read_input_tokens": usage.get("cache_read_input_tokens"),
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens"),
        "num_turns": getattr(result, "num_turns", None),
        "duration_ms": getattr(result, "duration_ms", None),
    }
