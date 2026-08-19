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

import argparse
import asyncio
import json
import os
import re
import sys
import threading
import time
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

# Extra grace for tearing the CLI down, on top of the ceiling above. The SDK's
# own shutdown is already bounded — stdin EOF, 5s, SIGTERM, 5s, SIGKILL
# (claude_agent_sdk/_internal/transport/subprocess_cli.py) — so ~10s covers it;
# 15 leaves room for the loop's own async-generator and executor shutdown. See
# _live_mcp_status for why this needs to be a separate budget.
_MCP_TEARDOWN_GRACE_S = 15.0


# FamilySearch refresh tokens hard-expire ~24h after login. We can't read
# that deadline from the token file, but the file's age is a faithful proxy
# (it's written at login). Warn when the token is old enough that a long run
# (caps allow up to 60 min) might cross the 24h boundary mid-flight.
_TOKEN_MAX_AGE_HOURS = 24.0
_TOKEN_WARN_AGE_HOURS = 22.0

# Bounds for _read_mcp_stderr_lines (issue #1301, rule 1). An unbounded capture
# buries the actionable line — the defect #941's review fixed once already
# (a WARN that interpolated every server's whole tools array).
_STDERR_MAX_LINES = 20
_STDERR_MAX_CHARS = 200


def _read_mcp_stderr_lines(
    *, cwd: Path, server_name: str, since: float,
    max_lines: int = _STDERR_MAX_LINES, max_chars: int = _STDERR_MAX_CHARS,
) -> tuple[list[str], str]:
    """(lines, dir_looked_in). Best-effort: any failure -> ([], dir_looked_in).

    The CLI writes each MCP server's stderr into its own per-connection JSONL
    log — the SDK's `stderr:` callback never receives it (independently
    verified 2026-08-18 against claude-agent-sdk 0.1.81 with a stub that wrote
    one marker line and exited non-zero: the callback list stayed empty while
    this log carried the marker verbatim). Log path, one per session:
    ``<cache-root>/<cwd-slug>/mcp-logs-<server_name>/<ISO-timestamp>.jsonl``,
    one JSON object per line, a captured line arriving as
    ``{"error": "Server stderr: <the server's line>\\n", ...}``.

    Never raises. A missing cache-root env var, a missing directory, an
    unreadable file, a line that isn't valid JSON, or an unrecognized
    `sys.platform` all degrade to an empty capture — the caller then prints
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

        cwd_slug = re.sub(r"[^A-Za-z0-9]", "-", str(cwd))
        log_dir = cache_root / cwd_slug / f"mcp-logs-{server_name}"
        dir_looked_in = str(log_dir)

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
            if not log_dir.is_dir():
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
                    # The CLI's own value carries a trailing "\n" (confirmed
                    # live, issue #1301 §0) -- strip it or it reads as a stray
                    # blank line wherever this gets interpolated into a
                    # sentence.
                    text = error[len("Server stderr: "):].rstrip("\n")
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


def _run_bounded(work: Callable[[], Any], budget: float) -> Any:
    """Run `work()` on a thread we can walk away from after `budget` seconds.

    A HARD wall, and it has to live outside the event loop. `asyncio.wait_for`
    bounds only the coroutine it wraps; `asyncio.run` then performs its own loop
    shutdown — cancel-all-tasks, `shutdown_asyncgens`,
    `shutdown_default_executor` — entirely OUTSIDE that budget. Measured
    2026-08-05 against a deliberately hanging stdio MCP server (accepts the
    connection, never speaks): the check returned the right FAIL but took 132.7s
    against a 90s ceiling, +42.7s of it after the coroutine had already settled.
    A ceiling a run can overshoot by half again is the "preflight that hangs"
    `_MCP_CHECK_TIMEOUT_S` exists to prevent, and no timeout *inside* the loop
    can fix it, because the overrun IS the loop's teardown. Wrapping
    `asyncio.timeout` around the coroutine would miss it for the same reason.

    A pathologically hung `node` child can therefore outlive the join. That is
    the deliberate trade: the SDK's own shutdown escalates to SIGKILL
    (`claude_agent_sdk/_internal/transport/subprocess_cli.py`), this process is
    about to exit anyway, and a leaked child is strictly better than a preflight
    that never returns — an operator can act on a FAIL.

    Exceptions are re-raised on the caller's thread so the arms in
    `_check_mcp_connection` still see the real type (`_Unprovable`,
    `TimeoutError`, anything else).
    """
    result: list[Any] = []
    failure: list[BaseException] = []

    def _run() -> None:
        try:
            result.append(work())
        except BaseException as e:  # noqa: BLE001 — re-raised on the caller's thread
            failure.append(e)

    worker = threading.Thread(target=_run, name="e2e-preflight-mcp", daemon=True)
    worker.start()
    worker.join(timeout=budget)
    if worker.is_alive():
        raise TimeoutError(
            f"the MCP status check did not return within {budget:.0f}s"
        )
    if failure:
        raise failure[0]
    return result[0]


def _live_mcp_status(entry: Path | str | None = None) -> Any:
    """Ask the running CLI for live MCP status. One spawn, zero model tokens.

    `entry` is the MCP server script to spawn — `None` resolves to `MCP_BUILD`
    at call time (not as a parameter default), so a test's
    `monkeypatch.setattr(pf, "MCP_BUILD", ...)` is still honored (issue #1301).

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

    resolved_entry = entry if entry is not None else MCP_BUILD

    load_env_file()  # the run's judge does this; the CLI needs the same key
    try:
        agent_env = env_for_sdk(resolve_auth())
    except AuthError as e:
        raise _Unprovable(f"no usable Anthropic credential: {e}") from e

    options = ClaudeAgentOptions(
        mcp_servers=genealogy_mcp_config(resolved_entry),
        env=agent_env,
        # Prove THIS config and nothing else. Without it the CLI merges
        # file/user/local-scoped MCP config on top of the block above, and this
        # repo's own `.mcp.json` registers a server under the same `genealogy`
        # key — so a check that looked green could be green about a DIFFERENT
        # server than the run spawns. That is the exact bug class this module's
        # docstring claims to close, which makes it the one place it must not be
        # left to chance. (`strict_mcp_config` scopes MCP resolution only; it is
        # not a settings-source switch.)
        strict_mcp_config=True,
    )

    async def _ask() -> Any:
        async with ClaudeSDKClient(options=options) as client:
            while True:
                response = await client.get_mcp_status()
                servers = (response or {}).get("mcpServers")
                entry = find_server_entry(servers)
                # A settled answer is a PRESENT entry reading something other
                # than `pending`. An absent one is not settled: the CLI
                # populates its server list asynchronously, so returning on the
                # first read that lacks us races that population and FAILs a
                # healthy server — telling the operator to rebuild something
                # that works. Poll absence exactly like `pending`; a genuinely
                # unregistered server still FAILs, via the ceiling below.
                if entry is not None and entry.get("status") != "pending":
                    return servers
                await asyncio.sleep(_MCP_POLL_INTERVAL_S)

    # Two nested budgets, and both are needed: `wait_for` is what turns a server
    # stuck on `pending` into the FAIL an operator can act on, while the wall
    # around it is what keeps the loop's own teardown from overrunning that
    # ceiling. See _run_bounded for the measurement behind the outer one.
    return _run_bounded(
        lambda: asyncio.run(asyncio.wait_for(_ask(), timeout=_MCP_CHECK_TIMEOUT_S)),
        _MCP_CHECK_TIMEOUT_S + _MCP_TEARDOWN_GRACE_S,
    )


def _check_mcp_connection(
    status_getter: Callable[[], Any] | None = None,
    *,
    entry: Path | str | None = None,
    log_reader: Callable[[float], tuple[list[str], str]] | None = None,
) -> tuple[str, str]:
    """Prove the genealogy MCP server answers, in a real CLI session.

    `status_getter` is injectable so every arm below is unit-testable without
    spawning a CLI — unchanged by issue #1301, still zero-arg, still returns a
    bare server list.

    `entry` (issue #1301) is the MCP server script to spawn, resolved to
    `MCP_BUILD` at call time (not as a parameter default) so a test's
    `monkeypatch.setattr(pf, "MCP_BUILD", ...)` is still honored. `log_reader`
    is the (since -> (lines, dir)) callable that reads the CLI's per-server
    stderr log — kept as a separate parameter from `status_getter` per the
    issue's own instruction, so mcp_health.py stays pure and this file owns
    the filesystem read. Both default to today's behavior (no capture).
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

    resolved_entry = entry if entry is not None else MCP_BUILD

    # started_at is written only by the default getter — an injected
    # status_getter (every existing test) never touches it, so it stays 0.0
    # and log_reader(0.0) is simply never called on that path unless a test
    # also injects log_reader explicitly (the new arms in test_e2e_preflight.py
    # do exactly that, to test the FAIL-text threading without a real clock).
    started_at = [0.0]

    def _default_getter() -> Any:
        started_at[0] = time.time()
        return _live_mcp_status(resolved_entry)

    getter = status_getter or _default_getter
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
        lines, log_dir = log_reader(started_at[0]) if log_reader else ([], None)
        captured = f" Captured server stderr:\n{chr(10).join(lines)}" if lines else (
            f" (no server stderr captured; looked in {log_dir})" if log_dir else ""
        )
        return (
            "FAIL",
            f"The genealogy MCP server never reported a settled status within "
            f"{_MCP_CHECK_TIMEOUT_S:.0f}s (+{_MCP_TEARDOWN_GRACE_S:.0f}s to shut "
            "down) — it stayed 'pending', or the CLI "
            "never listed it at all. A server that hangs instead of failing "
            "blocks session start: an e2e run would die on 'Control request "
            "timeout: initialize' after ~60s. Check that "
            f"`node {resolved_entry}` starts and speaks MCP on stdio.{captured}",
        )
    except Exception as e:  # noqa: BLE001 — a preflight must report, never crash
        return (
            "FAIL",
            f"Could not ask the CLI for MCP status: {type(e).__name__}: {e}",
        )

    health = classify_server_status(servers)
    if health == "connected":
        server_entry = find_server_entry(servers) or {}
        tools = server_entry.get("tools") or []
        return (
            "OK",
            f"Genealogy MCP server connected ({len(tools)} tools advertised)",
        )
    if health == "unavailable":
        # Quotes the server's own error text when the CLI supplied one — the
        # whole point of asking the CLI rather than checking a file. Preflight
        # wording, not the run's: nothing has been attempted yet, so "re-run the
        # test" and "run make e2e-preflight" would be nonsense here.
        lines, log_dir = log_reader(started_at[0]) if log_reader else ([], None)
        cause = unavailable_cause(find_server_entry(servers), server_stderr=lines or None)
        if not lines and log_dir:
            cause += f" (no server stderr captured; looked in {log_dir})"
        return (
            "FAIL",
            f"{cause}. An e2e run would "
            "have no genealogy tools at all — it would burn a live-FamilySearch "
            "session producing nothing. Fix this before running: check that "
            f"`node {resolved_entry}` starts and stays up, and rebuild with "
            "`make engine-build` if it doesn't.",
        )
    # Report the status, NOT the payload. `servers` carries each connected
    # server's full `tools` array — every name and description — so
    # interpolating it buried the actionable sentence under ~47 tool schemas.
    reported = (find_server_entry(servers) or {}).get("status") or "not listed"
    return (
        "WARN",
        f"The {GENEALOGY_SERVER_NAME!r} MCP server is still connecting "
        f"(status {reported!r}, not yet 'connected'). Not a failure — but the "
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


def _read_stderr_for() -> Callable[[float], tuple[list[str], str]]:
    """A `since -> (lines, dir)` closure over this process's own cwd.

    `read_mcp_stderr_lines` keys its lookup on `cwd` and `server_name`, not on
    which server script was spawned, so this factory takes no arguments —
    preflight has no "workspace" concept the way the orchestrator does; the
    CLI's cwd-slug is derived from the invoking process's own cwd (confirmed
    live, issue #1301 §0).
    """
    def _read(since: float) -> tuple[list[str], str]:
        return _read_mcp_stderr_lines(
            cwd=Path.cwd(), server_name=GENEALOGY_SERVER_NAME, since=since,
        )

    return _read


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mcp-server-entry",
        type=Path,
        default=None,
        help="MCP server script to spawn for check 5 (default: the built "
        "production server). Same flag as run_e2e's, for pointing preflight "
        "at a stub without touching MCP_BUILD.",
    )
    args = parser.parse_args(argv if argv is not None else [])

    print("=== E2E preflight ===\n")
    statuses = []
    for name, check in CHECKS:
        if check is _check_mcp_connection:
            status, detail = check(
                entry=args.mcp_server_entry, log_reader=_read_stderr_for()
            )
        else:
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
    # Explicit, not main()'s None-default: main() treats a bare `None` as "no
    # args" (empty list) rather than "fall back to real sys.argv" — the
    # opposite of argparse's own convention — specifically so that calling
    # main() bare from a test under pytest's own argv doesn't choke on
    # unrelated pytest flags (issue #1301). The real CLI entry point must
    # therefore pass sys.argv explicitly to still see its own flags.
    sys.exit(main(sys.argv[1:]))
