"""Read a captured MCP server's own stderr, bounded, for an abort message.

GitHub issue #1301. The CLI writes each MCP server's stderr into its own
per-connection JSONL log -- the SDK's `stderr:` callback never receives it
(independently verified 2026-08-18 against claude-agent-sdk 0.1.81 with a stub
that wrote one marker line and exited non-zero: the callback list stayed
empty while this log carried the marker verbatim). Log path, one per session:
``<cache-root>/<cwd-slug>/mcp-logs-<server_name>/<ISO-timestamp>.jsonl``, one
JSON object per line, a captured line arriving as
``{"error": "Server stderr: <the server's line>\\n", ...}``.

Shared between `preflight.py` and `orchestrator.py` (chesworthrm's review of
this PR): the two callers previously carried independent copies kept in sync
by eye, guarded only by an AST-comparison test -- the same shape
`test_write_lockdown_parity.py` exists to catch, after a POSIX-only path
split made one copy a silent no-op on Windows between #914 and #984. `rule 3`
("the filesystem read lives in the two callers, not `mcp_health.py`") asked
only that this stay out of that module; it does not require two copies, and
both callers already live in this same package.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

# An unbounded capture buries the actionable line -- the defect #941's review
# fixed once already (a WARN that interpolated every server's whole tools
# array).
_STDERR_MAX_LINES = 20
_STDERR_MAX_CHARS = 200


def read_mcp_stderr_lines(
    *, cwd: Path, server_name: str, since: float,
    max_lines: int = _STDERR_MAX_LINES, max_chars: int = _STDERR_MAX_CHARS,
) -> tuple[list[str], str]:
    """(lines, dir_looked_in). Best-effort: any failure -> ([], dir_looked_in).

    Never raises. A missing cache-root env var, a missing directory, an
    unreadable file, a line that isn't valid JSON, or an unrecognized
    `sys.platform` all degrade to an empty capture -- the caller then prints
    today's unchanged message plus `dir_looked_in`, per rule 2: an empty
    capture must never read as "the server said nothing" when it might mean
    "we didn't know where to look."
    """
    try:
        if sys.platform == "win32":
            base = os.environ.get("LOCALAPPDATA")
            if not base:
                return [], "(LOCALAPPDATA not set)"
            cache_root = Path(base) / "claude-cli-nodejs" / "Cache"
        elif sys.platform == "darwin":
            cache_root = Path.home() / "Library" / "Caches" / "claude-cli-nodejs"
        else:
            xdg = os.environ.get("XDG_CACHE_HOME")
            cache_root = Path(xdg) / "claude-cli-nodejs" if xdg else (
                Path.home() / ".cache" / "claude-cli-nodejs"
            )

        # The CLI slugs the cwd IT resolved, not the one it was handed: on
        # macOS Node's process.cwd() reports /private/var/... where Python's
        # tempfile hands us /var/... (issue #1301 review, chesworthrm -- 49 of
        # 157 committed e2e run logs are macOS). Try the literal path first,
        # then the resolved one; on Windows/Linux Path.cwd() is already
        # resolved, so the two candidates collapse to one and behaviour is
        # unchanged there. `workspace` here is a raw `tempfile` path, exactly
        # the case that exposed this.
        log_dirs: list[Path] = []
        for candidate in (Path(cwd), Path(cwd).resolve()):
            slug = re.sub(r"[^A-Za-z0-9]", "-", str(candidate))
            d = cache_root / slug / f"mcp-logs-{server_name}"
            if d not in log_dirs:
                log_dirs.append(d)
        dir_looked_in = " or ".join(str(d) for d in log_dirs)

        # Small bounded retry: the CLI's JSONL append can lag the moment its
        # control protocol reports "failed" by up to a couple hundred ms
        # (measured live, issue #1301 -- the very first end-to-end run of this
        # feature missed the capture on attempt 1 and found it on attempt 2).
        # Still "best-effort" per rule 2: on the last attempt an empty result
        # is returned exactly as before, just after trying a little harder.
        lines: list[str] = []
        for attempt in range(3):
            if attempt > 0:
                time.sleep(0.3)
            log_dir = next((d for d in log_dirs if d.is_dir()), None)
            if log_dir is None:
                continue
            candidates = [
                p for p in log_dir.glob("*.jsonl")
                if p.stat().st_mtime >= since
            ]
            if not candidates:
                continue
            newest = max(candidates, key=lambda p: (p.stat().st_mtime, p.name))

            for raw_line in newest.read_text(encoding="utf-8").splitlines():
                if not raw_line.strip():
                    continue
                try:
                    row = json.loads(raw_line)
                except (json.JSONDecodeError, ValueError):
                    continue
                error = row.get("error") if isinstance(row, dict) else None
                if isinstance(error, str) and error.startswith("Server stderr: "):
                    # One JSONL row is one *write*, not one line: a Node
                    # crash arrives as a single row carrying its whole
                    # stack trace (measured: 599 chars, 13 newlines).
                    # Split before bounding, or max_lines never engages
                    # and max_chars cuts the trace mid-frame (chesworthrm's
                    # review of this PR).
                    body = error[len("Server stderr: "):]
                    for text in body.split("\n"):
                        if text.strip():
                            lines.append(text[:max_chars])
            if lines:
                break

        dropped = len(lines) - max_lines
        kept = lines[-max_lines:]
        if dropped > 0:
            kept.append(f"(… {dropped} earlier lines dropped)")
        return kept, dir_looked_in
    except Exception:  # noqa: BLE001 — best-effort capture must never raise
        return [], dir_looked_in if "dir_looked_in" in locals() else "(unresolved)"
