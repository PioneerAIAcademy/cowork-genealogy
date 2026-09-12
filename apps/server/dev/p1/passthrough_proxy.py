#!/usr/bin/env python3
"""A logging pass-through in front of https://api.anthropic.com — P3b's wire tap.

Used in-process by `probe_gateway_path.py` (one instance per proxy arm) and runnable
standalone. Every request the CLI sends to ``ANTHROPIC_BASE_URL=http://127.0.0.1:<port>``
is forwarded unchanged — method, path with its query string, headers, body — to
``https://api.anthropic.com`` over a fresh TLS connection, and the upstream response
is streamed back byte for byte (status, headers, SSE frames as they arrive). Nothing
is rewritten, so the log shows exactly what a gateway standing in that position
would receive from the CLI.

ONE JSON line per request is appended to ``--log``:

  seq, ts, method, path, status, ttfb_ms, duration_ms
  anthropic_beta              the request's anthropic-beta header value (None if absent)
  anthropic_version           the anthropic-version header value
  x_api_key_present           bool — the value is never written
  authorization_present       bool — likewise
  request_header_names        sorted header names
  body_bytes, body_json       size; whether the body parsed as a JSON object
  model, stream, max_tokens
  system_preview              first 100 chars of the system prompt's text
  user_preview                first 80 chars of the last user message's text
  tools                       len(body["tools"]) or None
  tool_types                  {type: count} over body["tools"] ("custom" when untyped)
  tool_names_sample           the first 5 tool names
  mcp_tools                   count of tool names starting with "mcp__"
  tool_search_tool            any tool whose type starts with "tool_search_tool"
  tool_reference_blocks       count of {"type": "tool_reference"} blocks anywhere in the body
  cache_control_present       bool
  cache_control               [{"at": "<json path>", "ttl": "1h" | "5m" | None}, ...]
  cache_control_ttls          sorted distinct ttl values ("<absent>" for a block that sets none)
  response_bytes, response_content_type
  response_tool_reference_mentions   occurrences of "tool_reference" in the response bytes
  error                       upstream failure text (the client got a 502)

    uv run python -m dev.p1.passthrough_proxy --log FILE [--host 127.0.0.1] [--port 0]
                                              [--upstream api.anthropic.com]

Stdlib only. Hop-by-hop headers are not forwarded (RFC 7230 §6.1); ``Host`` and
``Content-Length`` are set for the upstream leg by http.client.
"""
from __future__ import annotations

import argparse
import http.client
import json
import ssl
import sys
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

DEFAULT_UPSTREAM = "api.anthropic.com"
UPSTREAM_TIMEOUT_S = 600.0     # per socket read; SSE pings keep a live stream well inside it
CHUNK = 64 * 1024
TTL_ABSENT = "<absent>"
_TOOL_REFERENCE = b"tool_reference"

_DROP_REQUEST_HEADERS = frozenset({
    "host", "content-length", "transfer-encoding", "connection", "keep-alive",
    "proxy-connection", "te", "trailer", "upgrade",
})
_DROP_RESPONSE_HEADERS = frozenset({
    "content-length", "transfer-encoding", "connection", "keep-alive", "trailer", "upgrade",
})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


# ── body summary ────────────────────────────────────────────────────────


def find_cache_control(node: Any, path: str = "$") -> list[dict[str, Any]]:
    """Every dict carrying a ``cache_control`` key, with its JSON path and ttl."""
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        cc = node.get("cache_control")
        if isinstance(cc, dict):
            found.append({"at": path, "ttl": cc.get("ttl"), "type": cc.get("type")})
        for key, value in node.items():
            if key != "cache_control":
                found.extend(find_cache_control(value, f"{path}.{key}"))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            found.extend(find_cache_control(value, f"{path}[{i}]"))
    return found


def count_blocks(node: Any, block_type: str) -> int:
    """Dicts anywhere under ``node`` whose ``type`` equals ``block_type``."""
    if isinstance(node, dict):
        own = 1 if node.get("type") == block_type else 0
        return own + sum(count_blocks(v, block_type) for v in node.values())
    if isinstance(node, list):
        return sum(count_blocks(v, block_type) for v in node)
    return 0


def _text_preview(content: Any, limit: int) -> str | None:
    """The first text of a string-or-block-list content, whitespace-collapsed."""
    if isinstance(content, str):
        return " ".join(content.split())[:limit]
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                return " ".join(block["text"].split())[:limit]
    return None


def summarize_body(raw: bytes) -> dict[str, Any]:
    out: dict[str, Any] = {
        "body_bytes": len(raw), "body_json": False, "model": None, "stream": None,
        "max_tokens": None, "system_preview": None, "user_preview": None, "tools": None, "tool_types": None, "tool_names_sample": None,
        "mcp_tools": None, "tool_search_tool": None, "tool_reference_blocks": None,
        "cache_control_present": None, "cache_control": None, "cache_control_ttls": None,
    }
    if not raw:
        return out
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return out
    if not isinstance(body, dict):
        return out
    out["body_json"] = True
    out["model"] = body.get("model")
    out["stream"] = body.get("stream")
    out["max_tokens"] = body.get("max_tokens")
    out["system_preview"] = _text_preview(body.get("system"), 100)
    users = [m for m in (body.get("messages") or []) if isinstance(m, dict)
             and m.get("role") == "user"]
    out["user_preview"] = _text_preview(users[-1].get("content"), 80) if users else None
    tools = body.get("tools")
    if isinstance(tools, list):
        dicts = [t for t in tools if isinstance(t, dict)]
        names = [str(t["name"]) for t in dicts if t.get("name") is not None]
        types = Counter(str(t.get("type") or "custom") for t in dicts)
        out["tools"] = len(tools)
        out["tool_types"] = dict(types)
        out["tool_names_sample"] = names[:5]
        out["mcp_tools"] = sum(n.startswith("mcp__") for n in names)
        out["tool_search_tool"] = any(k.startswith("tool_search_tool") for k in types)
    out["tool_reference_blocks"] = count_blocks(body, "tool_reference")
    cc = find_cache_control(body)
    out["cache_control_present"] = bool(cc)
    out["cache_control"] = [{"at": c["at"], "ttl": c["ttl"]} for c in cc]
    out["cache_control_ttls"] = sorted({TTL_ABSENT if c["ttl"] is None else str(c["ttl"])
                                        for c in cc})
    return out


# ── server ──────────────────────────────────────────────────────────────


class PassthroughServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], log_path: Path, *,
                 upstream: str = DEFAULT_UPSTREAM,
                 upstream_timeout: float = UPSTREAM_TIMEOUT_S) -> None:
        super().__init__(address, PassthroughHandler)
        self.log_path = log_path
        self.upstream = upstream
        self.upstream_timeout = upstream_timeout
        self.ssl_context = ssl.create_default_context()
        self._lock = threading.Lock()
        self._seq = 0

    @property
    def port(self) -> int:
        return int(self.server_address[1])

    def next_seq(self) -> int:
        with self._lock:
            self._seq += 1
            return self._seq

    def log(self, record: dict[str, Any]) -> None:
        line = json.dumps(record, ensure_ascii=False, default=str)
        with self._lock:
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")


class PassthroughHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: PassthroughServer

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        """The JSON log is the record; stderr stays quiet."""

    def _read_request_body(self) -> bytes:
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            parts: list[bytes] = []
            while True:
                size = int(self.rfile.readline().strip().split(b";")[0] or b"0", 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass
                    break
                parts.append(self.rfile.read(size))
                self.rfile.readline()
            return b"".join(parts)
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length > 0 else b""

    def _send_json(self, status: int, doc: dict[str, Any]) -> None:
        payload = json.dumps(doc).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def _handle(self) -> None:
        t0 = time.monotonic()
        raw = self._read_request_body()
        record: dict[str, Any] = {
            "seq": self.server.next_seq(), "ts": _now_iso(),
            "method": self.command, "path": self.path,
            "anthropic_beta": self.headers.get("anthropic-beta"),
            "anthropic_version": self.headers.get("anthropic-version"),
            "x_api_key_present": self.headers.get("x-api-key") is not None,
            "authorization_present": self.headers.get("authorization") is not None,
            "request_header_names": sorted({k.lower() for k in self.headers.keys()}),
            **summarize_body(raw),
            "status": None, "ttfb_ms": None, "duration_ms": None,
            "response_bytes": 0, "response_content_type": None,
            "response_tool_reference_mentions": 0, "error": None,
        }
        forward = {k: v for k, v in self.headers.items()
                   if k.lower() not in _DROP_REQUEST_HEADERS}
        forward["Host"] = self.server.upstream
        conn = http.client.HTTPSConnection(self.server.upstream, 443,
                                           timeout=self.server.upstream_timeout,
                                           context=self.server.ssl_context)
        try:
            conn.request(self.command, self.path, body=raw or None, headers=forward)
            resp = conn.getresponse()
        except Exception as exc:  # noqa: BLE001 - any upstream failure is a 502 + a log line
            conn.close()
            record["error"] = f"{type(exc).__name__}: {exc}"
            record["status"] = 502
            record["duration_ms"] = round((time.monotonic() - t0) * 1000)
            self._send_json(502, {"type": "error", "error": {
                "type": "api_error", "message": f"passthrough upstream failure: {record['error']}"}})
            self.server.log(record)
            return
        record["status"] = resp.status
        record["ttfb_ms"] = round((time.monotonic() - t0) * 1000)
        record["response_content_type"] = resp.getheader("Content-Type")
        try:
            # send_response_only: send_response() would add its own Server/Date on
            # top of the upstream's.
            self.send_response_only(resp.status, resp.reason)
            for key, value in resp.getheaders():
                if key.lower() not in _DROP_RESPONSE_HEADERS:
                    self.send_header(key, value)
            length = resp.getheader("Content-Length")
            chunked_out = resp.chunked or length is None
            if chunked_out:
                self.send_header("Transfer-Encoding", "chunked")
            else:
                self.send_header("Content-Length", length)
            self.end_headers()
            self.wfile.flush()
            total = mentions = 0
            tail = b""
            while True:
                chunk = resp.read1(CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                # `tail` is shorter than the needle, so every match in tail+chunk ends
                # inside chunk: boundary-spanning hits count once, nothing twice.
                mentions += (tail + chunk).count(_TOOL_REFERENCE)
                tail = chunk[-(len(_TOOL_REFERENCE) - 1):]
                if chunked_out:
                    self.wfile.write(f"{len(chunk):x}\r\n".encode("ascii") + chunk + b"\r\n")
                else:
                    self.wfile.write(chunk)
                self.wfile.flush()
            if chunked_out:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            record["response_bytes"] = total
            record["response_tool_reference_mentions"] = mentions
        except (BrokenPipeError, ConnectionResetError) as exc:
            record["error"] = f"client closed: {type(exc).__name__}"
            self.close_connection = True
        finally:
            conn.close()
        record["duration_ms"] = round((time.monotonic() - t0) * 1000)
        self.server.log(record)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = _handle


# ── in-process use ──────────────────────────────────────────────────────


def start_proxy(log_path: Path, *, host: str = "127.0.0.1", port: int = 0,
                upstream: str = DEFAULT_UPSTREAM) -> tuple[PassthroughServer, threading.Thread]:
    """Bind (port 0 = any free port), serve on a daemon thread, return both."""
    server = PassthroughServer((host, port), log_path, upstream=upstream)
    thread = threading.Thread(target=server.serve_forever, name="passthrough-proxy", daemon=True)
    thread.start()
    return server, thread


def stop_proxy(server: PassthroughServer, thread: threading.Thread) -> None:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def read_log(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            rows.append({"unparsed": line[:200]})
    return rows


# ── standalone ──────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.passthrough_proxy",
        description="Logging pass-through to https://api.anthropic.com: point "
                    "ANTHROPIC_BASE_URL at it and read one JSON line per request off --log.",
    )
    p.add_argument("--log", required=True, help="JSONL file to append one line per request to")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=0, help="0 = any free port (printed)")
    p.add_argument("--upstream", default=DEFAULT_UPSTREAM, help="HTTPS host to forward to")
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    log_path = Path(args.log).expanduser().resolve()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    server, thread = start_proxy(log_path, host=args.host, port=args.port, upstream=args.upstream)
    print(f"listening on http://{args.host}:{server.port} -> https://{args.upstream}  "
          f"log: {log_path}", flush=True)
    try:
        while thread.is_alive():
            thread.join(timeout=1)
    except KeyboardInterrupt:
        pass
    finally:
        stop_proxy(server, thread)
    return 0


if __name__ == "__main__":
    sys.exit(main())
