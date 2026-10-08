"""Test helpers for U7's SigV4 client (proto/enqueue.py), shared by test_proto_enqueue.py
and test_proto_web.py: ``verify_sigv4``, a stdlib re-derivation of a SigV4 signature from
the bytes a server RECEIVED (it never calls botocore, so a wire test cannot pass because
the signer agrees with itself), and ``Capture``, a 127.0.0.1 server that records them.
"""

from __future__ import annotations

import hashlib
import hmac
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def verify_sigv4(method: str, path: str, headers: Any, body: bytes, secret: str,
                 region: str, service: str) -> bool:
    """Re-derive a SigV4 signature from what was received; stdlib only, never botocore.
    ``headers`` is any (name, value) iterable or mapping; names compare case-insensitively."""
    items = headers.items() if hasattr(headers, "items") else headers
    lower: dict[str, str] = {}
    for name, value in items:
        lower[name.lower()] = str(value)
    auth = lower.get("authorization", "")
    if not auth.startswith("AWS4-HMAC-SHA256 "):
        return False
    fields = dict(part.strip().split("=", 1) for part in auth[len("AWS4-HMAC-SHA256 "):].split(","))
    access, date, scope_region, scope_service, terminator = fields["Credential"].split("/")
    if (scope_region, scope_service, terminator) != (region, service, "aws4_request"):
        return False
    signed = fields["SignedHeaders"].split(";")
    if "host" not in signed or "x-amz-date" not in signed:
        return False
    if "x-amz-security-token" in lower and "x-amz-security-token" not in signed:
        return False
    if any(name not in lower for name in signed):
        return False
    amz_date = lower["x-amz-date"]
    if not amz_date.startswith(date):
        return False
    canonical_headers = "".join(f"{name}:{' '.join(lower[name].split())}\n" for name in signed)
    canonical = "\n".join([
        method, path or "/", "", canonical_headers, ";".join(signed), hashlib.sha256(body).hexdigest(),
    ])
    scope = f"{date}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode("utf-8")).hexdigest()])
    key = _hmac(_hmac(_hmac(_hmac(("AWS4" + secret).encode("utf-8"), date), region), service), "aws4_request")
    expected = hmac.new(key, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, fields["Signature"])


# ── a capture server ───────────────────────────────────────────────────────────────


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class Capture:
    """127.0.0.1 HTTP server recording each request and answering ``status``/``reply``."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.status = 200
        self.reply = "<SendMessageResponse><SendMessageResult><MessageId>m1</MessageId></SendMessageResult></SendMessageResponse>"
        capture = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                capture.requests.append({"method": "POST", "path": self.path,
                                         "headers": list(self.headers.items()), "body": body})
                data = capture.reply.encode("utf-8")
                self.send_response(capture.status)
                self.send_header("Content-Type", "text/xml")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args: Any) -> None:
                pass

        self.server = QuietServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
