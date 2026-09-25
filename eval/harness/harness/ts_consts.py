"""Read a string-list constant out of the engine's TypeScript source.

The one reader of `export const <NAME> = [...] as const;` for Python code that
must follow an engine list rather than restate it: the writer-tool vocabulary
(`e2e/writer_attribution_report.py`) and the `OK_FALSE_IS_FAILURE` drift test
(`tests/unit/test_mock_mcp.py`). One copy, so a change to the declaration's
shape breaks both readers the same way instead of one of them silently.
"""

from __future__ import annotations

import re
from pathlib import Path

#: `packages/engine/mcp-server/src/tool-result.ts`.
TOOL_RESULT_TS = (
    Path(__file__).resolve().parents[3]
    / "packages" / "engine" / "mcp-server" / "src" / "tool-result.ts"
)


def ts_string_list(name: str, path: Path = TOOL_RESULT_TS) -> list[str]:
    """The string members of `export const <name> = [...] as const;` in `path`.

    Raises when the declaration is missing or holds no strings, so a renamed or
    reshaped constant fails loudly rather than reading as an empty list.
    """
    source = path.read_text(encoding="utf-8")
    m = re.search(rf"export const {name}\b[^=]*= \[(.*?)\]", source, re.S)
    if m is None:
        raise RuntimeError(f"`{name}` not found in {path}")
    # Line comments first, so a quoted word inside one is not read as a member.
    body = re.sub(r"//[^\n]*", "", m.group(1))
    members = re.findall(r'"([^"]+)"', body)
    if not members:
        raise RuntimeError(f"`{name}` in {path} parsed to no string members")
    return members
