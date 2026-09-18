"""The worker's project-read denial, pure and stdlib-only.

The prototype agent has no project folder: ``cwd`` is an empty anchor and the project
lives in Postgres behind the MCP tools. A ``Read``/``Grep``/``Glob`` under that anchor is
therefore always a mistake, and the deny reason names the tool that replaces it. Ported
from the e2e harness's ``project_read_denied`` (``eval/harness/e2e/orchestrator.py``),
which the worker cannot import; the three cases are the same:

- a read under ``project_root`` is denied, with the MCP route in the reason;
- a read under ``<project_root>/.claude/`` is allowed;
- a read under ``<config_root>/projects/**/tool-results/**`` is allowed -- that is where
  the CLI spills an oversized tool result for the model to read back.

The hook that calls this lives in ``options.py``; the tests in
``apps/server/tests/test_proto_worker.py``.
"""

from __future__ import annotations

import os
import posixpath
import re

# The read tools inspected, and the argument each names its target in. Grep/Glob's
# ``path`` is optional and defaults to the working directory -- which IS the anchor.
PROJECT_READ_TOOLS = {"Read": "file_path", "Grep": "path", "Glob": "path"}


def _basename(value: str) -> str:
    return value.replace("\\", "/").rsplit("/", 1)[-1]


def normalise_path(value: str, *, cwd: str) -> str:
    """``value`` as a forward-slash, absolute, ``..``-free path (relative to ``cwd``)."""
    text = str(value).replace("\\", "/")
    if text.startswith("~"):
        text = os.path.expanduser(text).replace("\\", "/")
    if not (text.startswith("/") or re.match(r"^[A-Za-z]:/", text)):
        text = cwd.replace("\\", "/").rstrip("/") + "/" + text
    return posixpath.normpath(text)


def _real(path: str) -> str:
    """Symlinks resolved, for comparison only; the recorded path keeps the model's spelling."""
    return os.path.realpath(path).replace("\\", "/")


def _under(path: str, root: str) -> bool:
    p, r = os.path.normcase(path), os.path.normcase(root.rstrip("/"))
    return p == r or p.startswith(r + os.sep)


def read_target(tool_name: str, tool_input: dict | None, *, cwd: str) -> str | None:
    """The normalised path a Read/Grep/Glob call reads, or None for any other tool."""
    key = PROJECT_READ_TOOLS.get(tool_name)
    if key is None:
        return None
    raw = (tool_input or {}).get(key)
    return normalise_path(str(raw) if raw else cwd, cwd=cwd)


def read_route(target: str, root: str) -> str:
    """The MCP tool that replaces a direct read of ``target`` under ``root``."""
    if _under(target, root + "/results"):
        return "record_read({recordId, resultsRef})"
    if _under(target, root + "/evaluations") or _under(target, root + "/uploads"):
        return "sidecar_read({projectPath, ref})"
    if _basename(target) == "research.json":
        return "research_query"
    return "project_context"


def project_read_denied(
    tool_name: str,
    tool_input: dict | None,
    *,
    cwd: str | os.PathLike[str],
    project_root: str | os.PathLike[str],
    config_root: str | os.PathLike[str],
) -> str | None:
    """Why a Read/Grep/Glob of the project anchor is denied, or None to allow it."""
    cwd_s = str(cwd)
    target = read_target(tool_name, tool_input, cwd=cwd_s)
    if target is None:
        return None
    root = normalise_path(str(project_root), cwd=cwd_s)
    spill_root = normalise_path(str(config_root), cwd=cwd_s) + "/projects"
    t_r, root_r, spill_r = _real(target), _real(root), _real(spill_root)
    if _under(t_r, spill_r):
        rest = t_r[len(spill_r):].strip("/").split("/")
        if "tool-results" in rest:
            return None
    if not _under(t_r, root_r) or _under(t_r, root_r + "/.claude"):
        return None
    rel = t_r[len(root_r):].strip("/") or "the project root"
    return (
        f"{tool_name} on {rel} is disabled in this run — the project folder is "
        "not readable directly. Read it through the MCP tools instead: "
        f"{read_route(t_r, root_r)}."
    )
