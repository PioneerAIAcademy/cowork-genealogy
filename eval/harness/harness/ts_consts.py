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


def strip_ts_comments(source: str) -> str:
    """`source` with `//` and `/* */` comments removed; string literals kept.

    Comments go before any bracket matching, so a `]` or a quoted word inside a
    comment can neither end a list early nor be read as a member.
    """
    out: list[str] = []
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        if ch in "\"'`":
            j = i + 1
            while j < n and source[j] != ch:
                j += 2 if source[j] == "\\" else 1
            out.append(source[i : j + 1])
            i = j + 1
        elif source.startswith("//", i):
            j = source.find("\n", i)
            i = n if j == -1 else j
        elif source.startswith("/*", i):
            j = source.find("*/", i + 2)
            i = n if j == -1 else j + 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def ts_string_list(name: str, path: Path = TOOL_RESULT_TS) -> list[str]:
    """The string members of `export const <name> = [...] as const;` in `path`.

    Raises when the declaration is missing or holds no strings, so a renamed or
    reshaped constant fails loudly rather than reading as an empty list.
    """
    source = strip_ts_comments(path.read_text(encoding="utf-8"))
    m = re.search(rf"export const {name}\b[^=]*=\s*\[(.*?)\]", source, re.S)
    if m is None:
        raise RuntimeError(f"`{name}` not found in {path}")
    members = re.findall(r'"([^"]+)"', m.group(1))
    if not members:
        raise RuntimeError(f"`{name}` in {path} parsed to no string members")
    return members
