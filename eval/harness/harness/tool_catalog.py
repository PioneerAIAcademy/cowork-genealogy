"""Build a `{tool_name: description}` map from the production MCP server's
TypeScript source so the eval mock can advertise the real descriptions
Claude sees in production.

Why: eval/production parity. In production the SDK reads each tool's
`description` (telling Claude what the tool does and when to call it); in
eval the mock used to advertise a generic "Mock <name> — fixture-backed.",
which gave Claude less context than production users see. Argument
quality and tool selection are graded by the LLM judge — pulling the
real description here keeps that grading honest.

Approach: regex-parse `packages/engine/mcp-server/src/tools/*.ts`. The pattern is uniform
in this codebase: each tool exports a schema with
`name: "<tool_name>",\n  description:\n    "..." [+ "..." ...]`.
On any parse failure or missing tool, the mock falls back to its generic
stub — degrades gracefully rather than failing the run.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable


# Capture group 1: tool name (snake_case identifier).
# Capture group 2: the right-hand-side of `description:` up to the
# `inputSchema:` field that always follows. The boundary is anchored on
# `inputSchema:` rather than `,` because real descriptions can contain
# punctuation (`;`, `,`) inside their string literals. Non-greedy so
# multiple schemas in one file each get their own match.
_SCHEMA_NAME_DESCRIPTION = re.compile(
    r'name:\s*"([a-z][a-z0-9_]*)"\s*,\s*description:\s*(.+?),\s*inputSchema',
    re.DOTALL,
)

# A description's right-hand-side is one or more double-quoted string
# literals joined by `+`. Pull each "...", strip quotes, concatenate.
# Doesn't support escape sequences beyond \" and \\ — adequate for the
# current source. If a tool uses backticks or template strings, the
# fallback kicks in.
_STRING_LITERAL = re.compile(r'"((?:[^"\\]|\\.)*)"')


def _parse_description(rhs: str) -> str | None:
    """Extract a Python string from the TS expression on the rhs of
    `description: ...`. Handles single-string and concatenated forms.
    Returns None if no string literal can be parsed."""
    parts = _STRING_LITERAL.findall(rhs)
    if not parts:
        return None
    # Unescape the basic escapes TS may emit.
    joined = "".join(p.replace('\\"', '"').replace("\\\\", "\\") for p in parts)
    return joined.strip()


def parse_tool_file(text: str) -> dict[str, str]:
    """Extract {tool_name: description} from one TS source file."""
    out: dict[str, str] = {}
    for match in _SCHEMA_NAME_DESCRIPTION.finditer(text):
        name = match.group(1)
        rhs = match.group(2)
        description = _parse_description(rhs)
        if description:
            out[name] = description
    return out


def load_tool_catalog(tools_dir: Path) -> dict[str, str]:
    """Scan a directory of TS tool files and return the merged catalog.

    Silently skips files that fail to parse — a tool with an unexpected
    schema shape simply won't get a real description; the mock falls
    back to its generic stub for that tool.
    """
    catalog: dict[str, str] = {}
    if not tools_dir.is_dir():
        return catalog
    for path in sorted(tools_dir.glob("*.ts")):
        try:
            text = path.read_text()
        except OSError:
            continue
        catalog.update(parse_tool_file(text))
    return catalog


def default_tools_dir() -> Path:
    """Path to packages/engine/mcp-server/src/tools/ relative to the repo root.

    The harness sits at eval/harness/; tools live at packages/engine/mcp-server/src/tools/.
    Both are under the same repo root.
    """
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / "packages" / "engine" / "mcp-server" / "src" / "tools"


def tool_names(catalog: dict[str, str]) -> Iterable[str]:
    """Convenience: catalog keys, sorted."""
    return sorted(catalog.keys())
