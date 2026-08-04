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
  5. MCP server connects  — the CLI reports the genealogy server `connected`

Checks 1-4 are static: they read files and import modules. **Check 5 is not**
— it spawns a local Claude Code CLI, which spawns the MCP server, and asks the
CLI for the live connection status. Nothing here calls FamilySearch, and
nothing sends a prompt to a model, so check 5 costs **zero model tokens**; but
this module is no longer "read-only and offline" as it once claimed.

Check 5 exists because checks 1-4 measure the wrong thing. Issue #941:
genealogists lost three e2e runs (60-90 min each) to a genealogy MCP server
that did not connect *while preflight showed all systems green* — because a
green preflight validated the configuration and never proved the connection.

Usage (from eval/harness/):  uv run python -m e2e.preflight
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Callable

from e2e.mcp_health import (
    GENEALOGY_SERVER_NAME,
    classify_server_status,
    find_server_entry,
    genealogy_mcp_config,
    unavailable_cause,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FS_TOKENS = Path.home() / ".familysearch-mcp" / "tokens.json"
MCP_BUILD = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build" / "index.js"
ENV_FILE = REPO_ROOT / "eval" / ".env"

# Ceiling on the whole live connection check, CLI spawn included, because a
# preflight that hangs is worse than one that lies: an operator can act on a
# FAIL. Measured on a warm dev box (2026-08-04): the client spawn alone is
# ~10-15s, a healthy genealogy server settles to `connected` (47 tools) at
# ~25s end to end, and a server that dies at startup settles to `failed` at
# ~4s. So failures are fast and only a pathological hang waits this out; the
# margin above 25s is for a cold `node` start on a slower machine, where a
# false FAIL would send someone chasing an MCP bug that isn't there.
_MCP_CHECK_TIMEOUT_S = 90.0

# How often to re-ask while the server is still connecting. See _live_mcp_status.
_MCP_POLL_INTERVAL_S = 0.5


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


class _Unprovable(Exception):
    """A prerequisite of the live check is missing — NOT an MCP failure.

    Reported as its own status rather than folded into a FAIL, because
    misattributing an auth or dependency problem to the MCP server would
    recreate issue #941's confusion in mirror image.
    """


def _live_mcp_status() -> Any:
    """Ask the running CLI for live MCP status. One spawn, zero model tokens.

    Uses `ClaudeSDKClient` (streaming mode) because `get_mcp_status()` is a
    control-protocol request and the one-shot `query()` the run itself uses
    cannot issue one. No prompt is ever sent, so no model is invoked.

    **Polls until the status settles.** A single read right after `connect()`
    is worthless: measured 2026-08-04, both a healthy server and one that dies
    instantly report `pending` on the first call, because the CLI answers
    control requests while its MCP connects are still in flight. Polling
    separates them — healthy reaches `connected` (47 tools) at ~25s, a dead
    stub reaches `failed` at ~4s with `MCP error -32000: Connection closed`.
    Reading once would have made this check pass everything, which is the
    failure mode #941 is about.

    Every SDK/auth import is deliberately **lazy**: check 4 exists to report a
    missing `claude_agent_sdk` as a friendly FAIL, and a module-level import
    here would instead crash `python -m e2e.preflight` with a traceback.

    The client is built from the same `genealogy_mcp_config()` **and the same
    `env_for_sdk(resolve_auth())`** the run uses (orchestrator.py). Both halves
    matter: preflight is standalone and never loads `eval/.env` into the
    environment, so without the env the CLI would be spawned with credentials
    the run would not have used — and a failure caused by that would be
    reported as an MCP problem.
    """
    try:
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

        from harness.auth import AuthError, env_for_sdk, resolve_auth

        from e2e.env import load_env_file
    except ImportError as e:  # pragma: no cover — check 4 reports this first
        raise _Unprovable(f"harness dependency not importable: {e}") from e

    load_env_file()  # the run's judge does this; the CLI needs the same key
    try:
        agent_env = env_for_sdk(resolve_auth())
    except AuthError as e:
        raise _Unprovable(f"no usable Anthropic credential: {e}") from e

    options = ClaudeAgentOptions(
        mcp_servers=genealogy_mcp_config(MCP_BUILD),
        env=agent_env,
    )

    async def _ask() -> Any:
        async with ClaudeSDKClient(options=options) as client:
            while True:
                response = await client.get_mcp_status()
                servers = (response or {}).get("mcpServers")
                entry = find_server_entry(servers)
                # Anything other than `pending` is a settled answer — including
                # the server being absent from the list entirely.
                if entry is None or entry.get("status") != "pending":
                    return servers
                await asyncio.sleep(_MCP_POLL_INTERVAL_S)

    return asyncio.run(asyncio.wait_for(_ask(), timeout=_MCP_CHECK_TIMEOUT_S))


def _check_mcp_connection(
    status_getter: Callable[[], Any] | None = None,
) -> tuple[str, str]:
    """Prove the genealogy MCP server answers, in a real CLI session.

    `status_getter` is injectable so every arm below is unit-testable without
    spawning a CLI.
    """
    # Prerequisites first. A CLI session needs the build, a credential and the
    # SDK; without them this check cannot distinguish "MCP is broken" from
    # "nothing could have run". SKIP is safe here *only* because each of these
    # has already reported FAIL, so the exit code is already non-zero.
    for label, check in (
        ("Built MCP server", _check_mcp_build),
        ("Anthropic API key", _check_api_key),
        ("Harness deps synced", _check_harness_deps),
    ):
        if check()[0] == "FAIL":
            return (
                "SKIP",
                f"Not attempted — the '{label}' check above failed. Fix that "
                "first; the MCP connection cannot be proved without it.",
            )

    getter = status_getter or _live_mcp_status
    try:
        servers = getter()
    except _Unprovable as e:
        # WARN, not SKIP: nothing else failed, so a SKIP would let the run
        # print "All checks passed" while the connection stayed unproven —
        # which is the exact promise #941 says preflight must keep.
        return (
            "WARN",
            f"Connection UNPROVEN — {e}. This is not an MCP failure; the check "
            "could not be attempted. Green here does not mean ready.",
        )
    except (asyncio.TimeoutError, TimeoutError):
        return (
            "FAIL",
            f"The genealogy MCP server never finished connecting within "
            f"{_MCP_CHECK_TIMEOUT_S:.0f}s (it stayed 'pending'). A server that "
            "hangs instead of failing blocks session start — an e2e run would "
            "die on 'Control request timeout: initialize' after ~60s. Check that "
            f"`node {MCP_BUILD}` starts and speaks MCP on stdio.",
        )
    except Exception as e:  # noqa: BLE001 — a preflight must report, never crash
        return (
            "FAIL",
            f"Could not ask the CLI for MCP status: {type(e).__name__}: {e}",
        )

    health = classify_server_status(servers)
    if health == "connected":
        entry = find_server_entry(servers) or {}
        tools = entry.get("tools") or []
        return (
            "OK",
            f"Genealogy MCP server connected ({len(tools)} tools advertised)",
        )
    if health == "unavailable":
        # Quotes the server's own error text when the CLI supplied one — the
        # whole point of asking the CLI rather than checking a file. Preflight
        # wording, not the run's: nothing has been attempted yet, so "re-run the
        # test" and "run make e2e-preflight" would be nonsense here.
        return (
            "FAIL",
            f"{unavailable_cause(find_server_entry(servers))}. An e2e run would "
            "have no genealogy tools at all — it would burn a live-FamilySearch "
            "session producing nothing. Fix this before running: check that "
            f"`node {MCP_BUILD}` starts and stays up, and rebuild with "
            "`make engine-build` if it doesn't.",
        )
    return (
        "WARN",
        f"The {GENEALOGY_SERVER_NAME!r} MCP server is still connecting "
        f"(status not yet 'connected'): {servers!r}. Not a failure — but the "
        "connection is unproven, so re-run this check before a long run.",
    )


CHECKS = [
    ("FamilySearch login", _check_fs_token),
    ("Built MCP server", _check_mcp_build),
    ("Anthropic API key", _check_api_key),
    ("Harness deps synced", _check_harness_deps),
    # Last: it is the only check that spawns a process, and it depends on the
    # three above having passed.
    ("MCP server connects", _check_mcp_connection),
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
