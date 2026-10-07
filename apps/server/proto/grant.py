#!/usr/bin/env python3
"""U3 ``make proto-grant``: store an encrypted FamilySearch grant for a dev-login patron.

    uv run python proto/grant.py [--email dev@localhost] [--pg-dsn ...] [--port 1837]

The worker bears the turn's project owner's grant (``familysearch_tokens``), so a compose
stack needs one for the patron whose projects it runs -- by default ``dev@localhost``, the
dev-login email that owns every seeded project. This runs the same PKCE sign-in the web
tier's ``/callback`` does, on the dev key, through a one-shot loopback listener on
``127.0.0.1:<port>`` (the dev key's only registered redirect is
``http://127.0.0.1:1837/callback``), then ``upsert_user`` and ``PgStore.store_grant`` --
the write lock included. From then on the web tier refreshes the grant between attempts.

It is a second sign-in, so it does not revoke the desktop login's token (U2 measured it).
It prints no token. Run it after ``make proto-up`` (its ``migrate`` service applies
``009_grant_session.sql``, which ``store_grant`` writes) and again after a
``proto-down -v``. Part of the re-run kit, never deployed. Exit 0 when the grant is
stored, 1 when the sign-in failed, 2 when the listener or Postgres is unavailable.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

PROTO_DIR = Path(__file__).resolve().parent
if str(PROTO_DIR) not in sys.path:
    sys.path.insert(0, str(PROTO_DIR))

DEFAULT_PORT = 1837
DEFAULT_PG_DSN = "postgresql://postgres:proto@localhost:5434/proto"


async def handle_callback(
    params: dict[str, list[str]], *, state: str, verifier: str, store: Any, email: str,
) -> tuple[int, str]:
    """One ``/callback`` query: the state checked first, then the code exchanged and the
    grant stored (ciphertext only) for ``email``'s user. ``(status, message)``; the message
    never carries a token."""
    from web import auth

    if (params.get("state") or [""])[0] != state:
        return 400, "OAuth state mismatch; run make proto-grant again"
    code = (params.get("code") or [""])[0]
    if not code:
        return 400, f"no code in the callback ({(params.get('error') or ['no error'])[0]})"
    token_json = await auth.exchange_code(code, verifier)
    if token_json is None:
        return 502, "the token exchange failed; run make proto-grant again"
    user = await store.upsert_user(email, None)
    refresh = token_json.get("refresh_token")
    await store.store_grant(
        user.id,
        auth.encrypt(token_json["access_token"]),
        auth.encrypt(refresh) if isinstance(refresh, str) and refresh else None,
        auth.expires_at_from(token_json),
    )
    return 200, f"grant stored for {user.email} (user {user.id})"


def serve_once(port: int, on_callback) -> tuple[int, str]:
    """Answer requests on 127.0.0.1:``port`` until one ``/callback`` arrives; its result."""
    result: dict[str, tuple[int, str]] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - http.server's name
            url = urlparse(self.path)
            if url.path != "/callback":
                self.send_error(404)
                return
            status, message = on_callback(parse_qs(url.query))
            result["done"] = (status, message)
            body = f"<p>{message}</p><p>You can close this tab.</p>".encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: Any) -> None:  # the query carries the code
            pass

    with HTTPServer(("127.0.0.1", port), Handler) as server:
        while "done" not in result:
            server.handle_request()
    return result["done"]


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--email", default="dev@localhost", help="the dev-login patron the grant belongs to")
    p.add_argument("--pg-dsn", default=DEFAULT_PG_DSN)
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help="the registered redirect's port")
    p.add_argument("--no-browser", action="store_true", help="print the sign-in URL without opening it")
    args = p.parse_args(argv)
    # redirect_uri() is PUBLIC_URL + /callback; it must be the dev key's registration.
    os.environ["PUBLIC_URL"] = f"http://127.0.0.1:{args.port}"
    from web import auth
    from web.app import PgStore

    store = PgStore(args.pg_dsn)
    verifier, challenge = auth.pkce()
    state = secrets.token_urlsafe(16)
    url = auth.authorize_url(challenge, state)

    def on_callback(params: dict[str, list[str]]) -> tuple[int, str]:
        try:
            return asyncio.run(handle_callback(params, state=state, verifier=verifier, store=store,
                                               email=args.email))
        except Exception as exc:  # noqa: BLE001 - reported, never a traceback with the query in it
            return 500, (f"could not store the grant ({type(exc).__name__}); is the stack up and the "
                         "schema migrated (make proto-up)?")

    print(f"sign in at: {url}", file=sys.stderr)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        status, message = serve_once(args.port, on_callback)
    except OSError as exc:
        print(f"proto-grant: cannot listen on 127.0.0.1:{args.port} ({exc}); stop "
              "docker-compose.fs-signin.yml or `make e2e-login` while this runs", file=sys.stderr)
        return 2
    print(message if status == 200 else f"proto-grant: {message}", file=sys.stdout if status == 200 else sys.stderr)
    if status == 200:
        return 0
    return 2 if status == 500 else 1


if __name__ == "__main__":
    sys.exit(main())
