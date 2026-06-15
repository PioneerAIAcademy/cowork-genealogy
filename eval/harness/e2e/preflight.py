"""Preflight check — verify a machine is ready to run e2e tests.

E2e prerequisites each fail *deep* in a run with a different error (a
missing FS token surfaces mid-run; an unbuilt server fails at spawn; a
missing API key fails at the judge). With many contributors that's the
same handful of setup questions over and over. This check green-lights
all of them up front, so a contributor knows they're ready before
spending 20–60 minutes (and $3–10) on a run.

Checks, in order:
  1. FamilySearch token   — ~/.familysearch-mcp/tokens.json exists
  2. Built MCP server     — packages/engine/mcp-server/build/index.js exists
  3. Anthropic API key    — ANTHROPIC_API_KEY in env or eval/.env
  4. Harness deps synced  — claude_agent_sdk + anthropic importable

Read-only and offline — it does NOT call FamilySearch or Anthropic; it
only checks that the pieces are in place.

Usage (from eval/harness/):  uv run python -m e2e.preflight
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
FS_TOKENS = Path.home() / ".familysearch-mcp" / "tokens.json"
MCP_BUILD = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build" / "index.js"
ENV_FILE = REPO_ROOT / "eval" / ".env"


def _check_fs_token() -> tuple[bool, str]:
    if FS_TOKENS.exists():
        return True, f"FamilySearch token present ({FS_TOKENS})"
    return (
        False,
        "No FamilySearch token. Log in via the `login` MCP tool in Claude Code "
        f"so {FS_TOKENS} is written. (Tokens last ~24h — re-login if a long run "
        "spans that.)",
    )


def _check_mcp_build() -> tuple[bool, str]:
    if MCP_BUILD.exists():
        return True, "MCP server is built (build/index.js present)"
    return (
        False,
        "MCP server not built. Run `npm install && npm run build` in "
        "packages/engine/mcp-server/ (Windows: Setup.bat does this).",
    )


def _check_api_key() -> tuple[bool, str]:
    import os

    if os.environ.get("ANTHROPIC_API_KEY"):
        return True, "ANTHROPIC_API_KEY set in the environment"
    # Match the harness: a key in eval/.env counts.
    try:
        from dotenv import dotenv_values

        if ENV_FILE.exists() and dotenv_values(ENV_FILE).get("ANTHROPIC_API_KEY"):
            return True, f"ANTHROPIC_API_KEY found in {ENV_FILE}"
    except ImportError:
        pass
    return (
        False,
        "No ANTHROPIC_API_KEY. Set it in the environment or in eval/.env "
        "(Setup.bat prompts for it). The judge needs it.",
    )


def _check_harness_deps() -> tuple[bool, str]:
    missing = []
    for mod in ("claude_agent_sdk", "anthropic"):
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        return (
            False,
            f"Harness dependency not importable: {', '.join(missing)}. "
            "Run `uv sync` in eval/harness/.",
        )
    return True, "Harness dependencies importable (claude_agent_sdk, anthropic)"


CHECKS = [
    ("FamilySearch login", _check_fs_token),
    ("Built MCP server", _check_mcp_build),
    ("Anthropic API key", _check_api_key),
    ("Harness deps synced", _check_harness_deps),
]


def main(argv: list[str] | None = None) -> int:
    print("=== E2E preflight ===\n")
    all_ok = True
    for name, check in CHECKS:
        ok, detail = check()
        mark = "OK  " if ok else "FAIL"
        print(f"[{mark}] {name}: {detail}\n")
        all_ok = all_ok and ok

    if all_ok:
        print("All checks passed — you're ready to run e2e tests.")
        return 0
    print("Some checks FAILED (above). Fix them before running an e2e test.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
