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


# FamilySearch refresh tokens hard-expire ~24h after login. We can't read
# that deadline from the token file, but the file's age is a faithful proxy
# (it's written at login). Warn when the token is old enough that a long run
# (caps allow up to 60 min) might cross the 24h boundary mid-flight.
_TOKEN_MAX_AGE_HOURS = 24.0
_TOKEN_WARN_AGE_HOURS = 22.0


def _check_fs_token() -> tuple[str, str]:
    if not FS_TOKENS.exists():
        return (
            "FAIL",
            "No FamilySearch token. Run `make e2e-login` (or Login.bat) to log "
            f"in; it writes {FS_TOKENS}. The token is shared by all e2e runs "
            "and lasts ~24h.",
        )
    import time

    age_h = (time.time() - FS_TOKENS.stat().st_mtime) / 3600
    if age_h >= _TOKEN_MAX_AGE_HOURS:
        return (
            "FAIL",
            f"FamilySearch token is {age_h:.0f}h old — past the ~24h refresh "
            "limit. Re-run `make e2e-login` (or Login.bat) before running.",
        )
    if age_h >= _TOKEN_WARN_AGE_HOURS:
        return (
            "WARN",
            f"FamilySearch token is {age_h:.0f}h old (refresh limit ~24h). It "
            "may expire mid-run — consider `make e2e-login` first for a long run.",
        )
    return ("OK", f"FamilySearch token present, {age_h:.0f}h old ({FS_TOKENS})")


def _check_mcp_build() -> tuple[str, str]:
    if MCP_BUILD.exists():
        return "OK", "MCP server is built (build/index.js present)"
    return (
        "FAIL",
        "MCP server not built. Run `make engine-build` (or `npm install && "
        "npm run build` in packages/engine/mcp-server/; Windows: Setup.bat).",
    )


def _check_api_key() -> tuple[str, str]:
    import os

    if os.environ.get("ANTHROPIC_API_KEY"):
        return "OK", "ANTHROPIC_API_KEY set in the environment"
    # Match the harness: a key in eval/.env counts.
    try:
        from dotenv import dotenv_values

        if ENV_FILE.exists() and dotenv_values(ENV_FILE).get("ANTHROPIC_API_KEY"):
            return "OK", f"ANTHROPIC_API_KEY found in {ENV_FILE}"
    except ImportError:
        pass
    return (
        "FAIL",
        "No ANTHROPIC_API_KEY. Set it in the environment or in eval/.env "
        "(Setup.bat prompts for it). The judge needs it.",
    )


def _check_harness_deps() -> tuple[str, str]:
    missing = []
    for mod in ("claude_agent_sdk", "anthropic"):
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        return (
            "FAIL",
            f"Harness dependency not importable: {', '.join(missing)}. "
            "Run `uv sync` in eval/harness/.",
        )
    return "OK", "Harness dependencies importable (claude_agent_sdk, anthropic)"


CHECKS = [
    ("FamilySearch login", _check_fs_token),
    ("Built MCP server", _check_mcp_build),
    ("Anthropic API key", _check_api_key),
    ("Harness deps synced", _check_harness_deps),
]


def main(argv: list[str] | None = None) -> int:
    print("=== E2E preflight ===\n")
    statuses = []
    for name, check in CHECKS:
        status, detail = check()
        statuses.append(status)
        print(f"[{status:<4}] {name}: {detail}\n")

    if "FAIL" in statuses:
        print("Some checks FAILED (above). Fix them before running an e2e test.")
        return 1
    if "WARN" in statuses:
        print("Ready to run, with warnings (above) — review before a long run.")
        return 0
    print("All checks passed — you're ready to run e2e tests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
