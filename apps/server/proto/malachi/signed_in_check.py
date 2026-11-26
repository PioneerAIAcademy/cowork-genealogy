"""Tool calls through the real door, signed in as one user: the last step of `make malachi-check`.

Run inside the web image (``malachi.sh check`` binds this file) when the env file names
``CHECK_EMAIL``. Every other check stops at the door: the containers are healthy, the pages
answer, and a call with no sign-in is refused. None of them shows that a signed-in user's
tool call works on this build and this configuration.

It writes one connector token for the user, good for two minutes and stored only as its
sha256, calls three read-only tools on the tool server with it, and deletes it. The token is
never printed. It stays out of ``web/`` so it does not ship in the web bundle.

    python signed_in_check.py --email a@example.com --url http://tools:8787/mcp

What it does not show: a search, a ranking or a page read. Each needs a FamilySearch session,
which ends within a day and which only the user can renew, and each writes to a project.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sys
from typing import Any

import psycopg

from web import connector_auth

# The marker on the row, so a run removes what an interrupted one left behind.
CLIENT_ID = "malachi-check"
TOKEN_LIFETIME_S = 120
CALL_TIMEOUT_S = 60.0

USER_SQL = "SELECT id, blocked_at FROM users WHERE lower(email) = lower(%s)"
MINT_SQL = (
    "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) "
    "VALUES (%s, %s, %s, %s, now() + make_interval(secs => %s))"
)
CLEAR_SQL = "DELETE FROM connector_tokens WHERE client_id = %s"


def clear(dsn: str) -> None:
    with psycopg.connect(dsn) as conn:
        conn.execute(CLEAR_SQL, (CLIENT_ID,))


def mint(dsn: str, email: str) -> str | None:
    """A fresh token for ``email``'s user, or None when no such user exists."""
    token = secrets.token_urlsafe(32)
    with psycopg.connect(dsn) as conn:
        row = conn.execute(USER_SQL, (email,)).fetchone()
        if row is None:
            return None
        conn.execute(CLEAR_SQL, (CLIENT_ID,))
        conn.execute(MINT_SQL, (connector_auth.sha256_hex(token), row[0], CLIENT_ID, [connector_auth.SCOPE],
                                TOKEN_LIFETIME_S))
    return token


def _text(result: Any) -> str:
    return "\n".join(getattr(block, "text", "") for block in result.content)


def _parsed(result: Any) -> dict[str, Any]:
    try:
        value = json.loads(_text(result))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def line(name: str, result: Any, detail: str) -> tuple[bool, str]:
    """One call's verdict. A tool error fails the check whatever it says: these three tools
    answer a signed-in user without FamilySearch, so none has a refusal that is normal."""
    if result.isError:
        return False, f"signed in: {name} answered an error: {_text(result)[:300]}"
    return True, f"signed in: {name} {detail}"


async def calls(url: str, token: str) -> list[tuple[bool, str]]:
    """``(passed, line)`` for each call, in order. A refusal at the door (no FamilySearch
    token on file, a blocked user) raises out of ``initialize`` and is one failed line."""
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    out: list[tuple[bool, str]] = []

    def note(name: str, result: Any, detail: str) -> None:
        out.append(line(name, result, detail))

    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(CALL_TIMEOUT_S)) as http:
            async with streamable_http_client(url, http_client=http) as (read, write, _):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    listed = await client.call_tool("project_list", {})
                    projects = _parsed(listed).get("projects") or []
                    note("project_list", listed, f"({len(projects)} projects)")
                    status = await client.call_tool("auth_status", {})
                    session = "live" if _parsed(status).get("loggedIn") else "ended, so the user must sign in again"
                    note("auth_status", status, f"(FamilySearch session {session})")
                    if not listed.isError and projects:
                        path = str(projects[0].get("projectPath") or "")
                        context = await client.call_tool("project_context", {"projectPath": path})
                        note("project_context", context, "(the first project opens)")
    except BaseException as exc:  # noqa: BLE001 -- the MCP client raises refusals inside an ExceptionGroup
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        out.append((False, f"signed in: the door refused the check's token or the call failed: {_describe(exc)}"))
    return out


def _describe(exc: BaseException) -> str:
    """The innermost messages of ``exc``'s tree, statuses included, without any header."""
    import httpx

    found: list[str] = []
    stack: list[BaseException] = [exc]
    seen: set[int] = set()
    while stack:
        current = stack.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        inner = list(getattr(current, "exceptions", ()) or ())
        if isinstance(current, httpx.HTTPStatusError):
            found.append(f"HTTP {current.response.status_code}")
        elif not inner:
            found.append(f"{type(current).__name__}: {str(current)[:200]}")
        stack.extend(inner)
        stack.extend(e for e in (current.__cause__, current.__context__) if e is not None)
    return "; ".join(dict.fromkeys(found)) or type(exc).__name__


def run(dsn: str, url: str, email: str) -> list[tuple[bool, str]]:
    token = mint(dsn, email)
    if token is None:
        return [(False, f"signed in: no user {email}: they must connect from Claude once first")]
    try:
        return asyncio.run(calls(url, token))
    finally:
        clear(dsn)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--url", required=True)
    args = parser.parse_args(argv)
    lines = run(os.environ["PG_DSN"], args.url, args.email)
    for passed, line in lines:
        print(f"  {'ok  ' if passed else 'FAIL'}  {line}")  # malachi.sh's ok() and bad()
    return 0 if all(passed for passed, _ in lines) else 1


if __name__ == "__main__":
    sys.exit(main())
