"""Elastic Beanstalk worker-tier probe.

A WSGI app that logs everything sqsd sends it, sleeps SLEEP_S seconds, and then
answers 200. Stdlib only. `python application.py` (the Procfile path) serves it
with a threaded wsgiref server on $PORT (8000, which the platform's nginx proxies
to); the module-level `application` callable is also what the platform's default
gunicorn command (`application:application`) would import if the Procfile were
dropped.

Every log line is one JSON object on stdout (-> /var/log/web.stdout.log):
  listening    process start: host, port, sleep_s and where it came from
  start        a POST arrived: every X-Aws-Sqsd-* header, user agent, body
  end          the sleep finished; 200 is about to be written
  client_gone  the 200 could not be written: the caller closed the connection
               (sqsd gave up at InactivityTimeout, or nginx dropped it)
  access       wsgiref's access line, kept on stdout so one stream tells the story
  shutdown     SIGTERM/SIGINT received (a deploy or a termination)

A POST body of {"sleep_s": N} overrides SLEEP_S for that one message, so the
pipeline can be confirmed with a 5 s message before the 1500 s run.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import socketserver
import sys
import threading
import time
from datetime import datetime, timezone
from wsgiref.simple_server import ServerHandler, WSGIRequestHandler, WSGIServer, make_server

DEFAULT_SLEEP_S = 1500
BODY_LOG_LIMIT = 2000
SQSD_ENV_PREFIX = "HTTP_X_AWS_SQSD_"

_shutdown_reason = "serve_forever returned"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def log(ev: str, **fields) -> None:
    rec = {
        "ev": ev,
        "ts": _now(),
        "pid": os.getpid(),
        "thread": threading.current_thread().name,
    }
    rec.update(fields)
    print(json.dumps(rec), flush=True)


def _sleep_setting() -> tuple[float, str]:
    raw = os.environ.get("SLEEP_S")
    if raw is None:
        return DEFAULT_SLEEP_S, "default"
    try:
        return max(0.0, float(raw)), "env"
    except ValueError:
        log("bad_sleep_s", value=raw)
        return DEFAULT_SLEEP_S, "default"


def _body_sleep_override(text: str) -> float | None:
    try:
        parsed = json.loads(text) if text.strip() else None
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    value = parsed.get("sleep_s")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0.0, float(value))


def _sqsd_headers(environ) -> dict[str, str]:
    # WSGI folds header names to HTTP_UPPER_WITH_UNDERSCORES; the names below are
    # reconstructed (X-Aws-Sqsd-Receive-Count), so an attribute's original case
    # and any underscore-vs-hyphen distinction are lost here. The raw key is kept
    # alongside so nothing is hidden.
    out: dict[str, str] = {}
    for key, value in environ.items():
        if key.startswith(SQSD_ENV_PREFIX):
            name = "X-Aws-Sqsd-" + key[len(SQSD_ENV_PREFIX) :].replace("_", "-").title()
            out[name] = value
    return out


def _receive_count(environ) -> int | None:
    raw = environ.get(SQSD_ENV_PREFIX + "RECEIVE_COUNT")
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "")
    path = environ.get("PATH_INFO", "")
    if method == "GET":
        start_response("200 OK", [("Content-Type", "application/json")])
        return [b'{"ok": true}\n']
    if method != "POST":
        start_response("405 Method Not Allowed", [("Content-Type", "text/plain")])
        return [b"POST only\n"]

    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    body = environ["wsgi.input"].read(length) if length > 0 else b""
    text = body.decode("utf-8", "replace")

    sleep_s, source = _sleep_setting()
    override = _body_sleep_override(text)
    if override is not None:
        sleep_s, source = override, "body"

    msgid = environ.get(SQSD_ENV_PREFIX + "MSGID")
    receive_count = _receive_count(environ)
    started = time.monotonic()
    log(
        "start",
        msgid=msgid,
        receive_count=receive_count,
        method=method,
        path=path,
        query=environ.get("QUERY_STRING", ""),
        sqsd_headers=_sqsd_headers(environ),
        user_agent=environ.get("HTTP_USER_AGENT"),
        content_type=environ.get("CONTENT_TYPE"),
        content_length=length,
        remote_addr=environ.get("REMOTE_ADDR"),
        forwarded_for=environ.get("HTTP_X_FORWARDED_FOR"),
        body=text[:BODY_LOG_LIMIT],
        sleep_s=sleep_s,
        sleep_s_source=source,
    )
    time.sleep(sleep_s)
    elapsed_s = round(time.monotonic() - started, 3)
    log("end", msgid=msgid, receive_count=receive_count, elapsed_s=elapsed_s)

    reply = {"ok": True, "msgid": msgid, "receive_count": receive_count, "slept_s": sleep_s, "elapsed_s": elapsed_s}
    start_response("200 OK", [("Content-Type", "application/json")])
    return [json.dumps(reply).encode("utf-8") + b"\n"]


class ProbeServerHandler(ServerHandler):
    """Make an abandoned handler visible in web.stdout.log.

    A single small write to a socket whose peer has already closed *succeeds*
    (the RST only fails the next write), and wsgiref swallows the failures it
    does see. So peek at the socket before writing the response, and also log
    the write error if one surfaces.
    """

    def _peer_closed(self) -> bool:
        sock = getattr(getattr(self, "request_handler", None), "connection", None)
        if sock is None:
            return False
        try:
            sock.setblocking(False)
            try:
                return sock.recv(1, socket.MSG_PEEK) == b""
            finally:
                sock.setblocking(True)
        except BlockingIOError:
            return False  # open, nothing to read: the peer is still waiting
        except OSError:
            return True

    def finish_response(self):
        msgid = self.environ.get(SQSD_ENV_PREFIX + "MSGID")
        receive_count = _receive_count(self.environ)
        if self._peer_closed():
            log("client_gone", msgid=msgid, receive_count=receive_count, detected="peek_before_write")
        try:
            super().finish_response()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError) as exc:
            log("client_gone", msgid=msgid, receive_count=receive_count, detected="write", error=type(exc).__name__)
            raise


class ProbeRequestHandler(WSGIRequestHandler):
    def log_message(self, fmt, *args):
        log("access", client=self.address_string(), line=fmt % args)

    def handle(self):
        # Same as WSGIRequestHandler.handle (CPython 3.12) with our ServerHandler.
        self.raw_requestline = self.rfile.readline(65537)
        if len(self.raw_requestline) > 65536:
            self.requestline = ""
            self.request_version = ""
            self.command = ""
            self.send_error(414)
            return
        if not self.parse_request():
            return
        handler = ProbeServerHandler(
            self.rfile, self.wfile, self.get_stderr(), self.get_environ(), multithread=True
        )
        handler.request_handler = self
        handler.run(self.server.get_app())


class ThreadingWSGIServer(socketserver.ThreadingMixIn, WSGIServer):
    # sqsd keeps HttpConnections POSTs in flight; a single-threaded server would
    # serialise them and distort every timing this probe exists to measure.
    daemon_threads = True


def _on_signal(signum, _frame):
    global _shutdown_reason
    _shutdown_reason = signal.Signals(signum).name
    raise SystemExit(0)


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    server = make_server(host, port, application, server_class=ThreadingWSGIServer, handler_class=ProbeRequestHandler)
    sleep_s, source = _sleep_setting()
    log(
        "listening",
        host=host,
        port=port,
        sleep_s=sleep_s,
        sleep_s_source=source,
        python=sys.version.split()[0],
    )
    try:
        server.serve_forever()
    finally:
        log("shutdown", reason=_shutdown_reason, active_threads=threading.active_count() - 1)
        server.server_close()


if __name__ == "__main__":
    main()
