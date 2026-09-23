#!/usr/bin/env python3
"""Host-side FamilySearch token broker for the prototype stack: the worker asks it for a
bearer at the START of every attempt, so a turn redelivered after a step-ceiling kill
gets a live token instead of the one its first attempt read.

    make proto-token-broker            # foreground; Ctrl-C to stop
    FS_TOKEN_URL=http://host.docker.internal:8790/token make proto-up

Why a broker and not a refresher loop (D17, 2026-09-23). A FamilySearch refresh REVOKES
the previous access token at once (measured: the old token answered 200, then 401 three
seconds after a forced refresh, while the new one answered 200). So refreshing while an
attempt holds a token kills that attempt's FamilySearch calls -- which is what voided the
first D17 re-run -- and never refreshing lets the token expire under a long turn, which a
two-ceiling turn did the same day. The only safe moment is the start of an attempt, when
the previous attempt holding the token is already dead. The worker's ``bearer_token``
calls ``GET /token`` exactly then.

``GET /token`` runs the engine's ``dev/fs-token.ts --min-life <m>`` and answers the token
as text/plain: the stored token as it stands when it has more than ``m`` minutes (plus
the auth module's five-minute buffer) of life, else a fresh one. ``m`` defaults to the
step ceiling in minutes (``READ_TIMEOUT_S``, 1800 s -> 30), so an attempt's token
outlives the attempt. Calls are serialised, so two attempts starting together never
refresh twice. The residual: two turns IN FLIGHT at once (the shim keeps two POSTs open)
share one grant, and a refresh for the second revokes the first's token -- acceptable at
one patron, and the reason a real grant owner must mint per attempt, not per patron.

Binds 127.0.0.1 only: the worker reaches it through ``host.docker.internal`` (compose's
``host-gateway``), and nothing off the machine can ask it for the operator's token. The
token is never logged. Failure is 503 with fs-token's reason, and the worker then falls
back to the token file.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENGINE_DIR = REPO / "packages" / "engine" / "mcp-server"
DEFAULT_PORT = 8790


def min_life_minutes(env: dict[str, str] | os._Environ[str]) -> str:
    """``PROTO_TOKEN_MIN_LIFE`` when set, else the step ceiling in minutes."""
    explicit = env.get("PROTO_TOKEN_MIN_LIFE")
    if explicit:
        return explicit
    return str(int(float(env.get("READ_TIMEOUT_S") or 1800) // 60))


def fetch_token(min_life: str, engine_dir: Path = ENGINE_DIR) -> tuple[str, str]:
    """``(token, error)``: exactly one is non-empty."""
    proc = subprocess.run(
        ["npx", "tsx", "dev/fs-token.ts", "--min-life", min_life],
        cwd=engine_dir, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    token = proc.stdout.strip()
    if proc.returncode == 0 and token:
        return token, ""
    return "", (proc.stderr.strip() or f"fs-token exited {proc.returncode} with no token")


def make_handler(fetch, min_life: str):
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 -- http.server's name
            if self.path.split("?", 1)[0] != "/token":
                self.send_error(404)
                return
            with lock:
                token, error = fetch(min_life)
            body = (token or error).encode("utf-8")
            self.send_response(200 if token else 503)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            print(f"token_broker: GET /token -> {'200' if token else '503 ' + error[:160]}", file=sys.stderr)

        def log_message(self, fmt: str, *args) -> None:  # the token is never logged
            pass

    return Handler


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--min-life", default=None, help="minutes (default: PROTO_TOKEN_MIN_LIFE, else READ_TIMEOUT_S/60)")
    args = p.parse_args(argv)
    min_life = args.min_life or min_life_minutes(os.environ)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(fetch_token, min_life))
    print(f"token_broker: http://127.0.0.1:{args.port}/token (min-life {min_life} min); "
          f"start the stack with FS_TOKEN_URL=http://host.docker.internal:{args.port}/token", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
