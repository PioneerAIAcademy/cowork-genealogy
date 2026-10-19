#!/usr/bin/env python3
"""P3c–P3l — what an Anthropic-Messages gateway keeps of the requests Claude Code sends.

Plan: "P3. Bedrock feature parity" in ``docs/plan/search-agent-prototype.md``, P3c–P3l.
Each check is one direct ``/v1/messages`` request (or a short series) against ``--base``,
the gateway's route root, e.g. ``http://127.0.0.1:3939/bedrock`` for a local
agentgateway carrying tap-agentgateway's ``/bedrock`` route. Nothing here starts the
CLI; ``passthrough_proxy.py --upstream http://host:port`` records what the CLI itself
sends.

    uv run python -m dev.p1.probe_gateway_parity --base URL [--token KEY] [--out FILE]
        [--only NAME ...] [--context-1m] [--cache-ttl] [--list]

Checks (the plan section each re-measures):

    messages          a plain call answers in Messages shape                      P3c
    streaming         first body byte well before the last; text/event-stream     P3f
    model_ids         which ids reach Bedrock: us.* and the bare ids agents send   P3h
    betas             each flag Claude Code sends, alone                          P3d/P3e
    tool_reference    a ToolSearch result's tool_reference block parses           P3e/P3f
    image             an image inside a tool_result is read                       P3j
    body_limit        conversations holding 1..N page scans (~1 MB base64 each)    P3l
    stop_reasons      max_tokens, stop_sequence, an unknown model's error          P3l
    tool_choice       a forced tool_choice reaches the model                      P3l
    context_1m        a ~269k-token prompt (opt-in: --context-1m, ~$1)            P3j
    cache_ttl         a 1h cache point survives a 6m40s gap (opt-in: --cache-ttl)  P3j

Verdicts: PASS (behaves as the Anthropic API does), FAIL (it does not; the evidence says
how), INFO (a measurement with no single right answer). Exit 0 when nothing FAILs, 1
when something does, 2 on bad arguments or an unreachable gateway.

Default spend is cents: the image and body_limit checks send ~1-3k image tokens per
scan. Stdlib only.
"""
from __future__ import annotations

import argparse
import base64
import http.client
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[4]
SCAN = (REPO / "eval" / "tests" / "e2e" / "frederick-curtiss-munson-parents" / "provided-documents"
        / "ancestry-brooklyn-city-directory-1888-jared-munson.png")
SONNET = "us.anthropic.claude-sonnet-4-6"
HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
# The ids Claude Code sends: the main and small models as configured, and the plugin
# agents' frontmatter ids, which the CLI passes verbatim (P3h).
MODEL_IDS = (SONNET, HAIKU, "claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-sonnet-5")
# Every anthropic-beta Claude Code 2.1.282 sent through a gateway on 2026-09-25, plus
# Bedrock's own tool-search flag.
BETAS = ("claude-code-20250219", "interleaved-thinking-2025-05-14", "thinking-token-count-2026-05-13",
         "context-management-2025-06-27", "prompt-caching-scope-2026-01-05", "advisor-tool-2026-03-01",
         "effort-2025-11-24", "afk-mode-2026-01-31", "advanced-tool-use-2025-11-20",
         "structured-outputs-2025-12-15", "context-1m-2025-08-07", "extended-cache-ttl-2025-04-11",
         "tool-search-tool-2025-10-19")
TIMEOUT_S = 600.0


class Gateway:
    def __init__(self, base: str, token: str | None) -> None:
        u = urlsplit(base)
        if u.scheme not in ("http", "https") or not u.hostname:
            raise ValueError(f"--base must be http[s]://host[:port]/prefix, not {base!r}")
        self.scheme, self.host = u.scheme, u.hostname
        self.port = u.port or (443 if u.scheme == "https" else 80)
        self.prefix = u.path.rstrip("/")
        self.token = token

    def post(self, body: dict[str, Any], *, beta: str | None = None) -> tuple[int, str | None, bytes, float | None, float]:
        """``(status, content_type, body, first_body_byte_s, total_s)``."""
        cls = http.client.HTTPSConnection if self.scheme == "https" else http.client.HTTPConnection
        conn = cls(self.host, self.port, timeout=TIMEOUT_S)
        headers = {"content-type": "application/json", "anthropic-version": "2023-06-01"}
        if beta:
            headers["anthropic-beta"] = beta
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        t0 = time.monotonic()
        try:
            conn.request("POST", f"{self.prefix}/v1/messages", body=json.dumps(body), headers=headers)
            resp = conn.getresponse()
            chunks, first = [], None
            while True:
                chunk = resp.read1(65536)
                if not chunk:
                    break
                if first is None:
                    first = time.monotonic() - t0
                chunks.append(chunk)
            return resp.status, resp.getheader("content-type"), b"".join(chunks), first, time.monotonic() - t0
        finally:
            conn.close()


def _json(raw: bytes) -> dict[str, Any]:
    try:
        doc = json.loads(raw)
    except ValueError:
        return {"_raw": raw[:300].decode("utf-8", "replace")}
    return doc if isinstance(doc, dict) else {"_raw": str(doc)[:300]}


def _events(raw: bytes) -> list[dict[str, Any]]:
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        if line.startswith("data: "):
            try:
                out.append(json.loads(line[6:]))
            except ValueError:
                pass
    return out


def _error(doc: dict[str, Any]) -> str | None:
    err = doc.get("error")
    if isinstance(err, dict):
        return f"{err.get('type')}: {str(err.get('message'))[:160]}"
    return doc.get("_raw")


def _msg(text: str) -> list[dict[str, Any]]:
    return [{"role": "user", "content": text}]


def _scan_b64() -> str:
    return base64.b64encode(SCAN.read_bytes()).decode("ascii")


def _scan_conversation(n: int, img: str) -> list[dict[str, Any]]:
    msgs = _msg(f"Read page scans img_1..img_{n} one at a time, then say how many you read.")
    for i in range(1, n + 1):
        msgs += [
            {"role": "assistant", "content": [{"type": "tool_use", "id": f"toolu_{i}", "name": "image_read",
                                                "input": {"imageRef": f"img_{i}"}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"toolu_{i}", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img}},
                {"type": "text", "text": f"imageRef img_{i}: Brooklyn city directory, 1888."}]}]},
        ]
    return msgs


IMAGE_TOOL = [{"name": "image_read", "description": "Read a page scan.",
               "input_schema": {"type": "object", "properties": {"imageRef": {"type": "string"}},
                                "required": ["imageRef"]}}]
NOTE_TOOLS = [{"name": "record_note", "description": "Save a note.",
               "input_schema": {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]}},
              {"name": "other_tool", "description": "Unrelated.", "input_schema": {"type": "object", "properties": {}}}]


# ── checks: each returns (verdict, evidence) ─────────────────────────────────────────


def check_messages(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    status, ctype, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 5, "messages": _msg("Reply with exactly: ok")})
    doc = _json(raw)
    ok = status == 200 and doc.get("type") == "message" and isinstance(doc.get("content"), list)
    return ("PASS" if ok else "FAIL"), {"status": status, "content_type": ctype, "type": doc.get("type"),
                                        "object": doc.get("object"), "error": _error(doc)}


def check_streaming(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    status, ctype, raw, first, total = gw.post({"model": SONNET, "max_tokens": 1500, "stream": True,
                                                "messages": _msg("Count from 1 to 300, one number per line.")})
    evs = [e.get("type") for e in _events(raw)]
    buffered = first is not None and total > 0 and first >= 0.8 * total
    ok = status == 200 and "message_start" in evs and "message_stop" in evs and not buffered \
        and (ctype or "").startswith("text/event-stream")
    return ("PASS" if ok else "FAIL"), {"status": status, "content_type": ctype,
                                        "first_body_byte_s": round(first or 0, 2), "total_s": round(total, 2),
                                        "buffered": buffered, "events": len(evs)}


def check_model_ids(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    got = {}
    for model in MODEL_IDS:
        status, _, raw, _, _ = gw.post({"model": model, "max_tokens": 5, "messages": _msg("hi")})
        doc = _json(raw)
        got[model] = {"status": status, "served_as": doc.get("model"), "error": _error(doc) if status != 200 else None}
    return "INFO", got


def check_betas(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    got = {}
    for beta in BETAS:
        status, _, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 5, "messages": _msg("hi")}, beta=beta)
        got[beta] = status if status == 200 else f"{status} {_error(_json(raw))}"
    return "INFO", got


def check_tool_reference(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    tools = [{"name": "ToolSearch", "description": "Find and load deferred tool schemas.",
              "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
             {"name": "mcp__genealogy__convert_calendar", "description": "Convert a date between calendars.",
              "input_schema": {"type": "object", "properties": {"date": {"type": "string"}}}, "defer_loading": True}]
    msgs = _msg("Convert 1751-03-24 from Julian to Gregorian.") + [
        {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_ts", "name": "ToolSearch",
                                            "input": {"query": "convert_calendar"}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_ts", "content": [
            {"type": "tool_reference", "tool_name": "mcp__genealogy__convert_calendar"}]}]},
    ]
    status, _, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 200, "tools": tools, "messages": msgs})
    doc = _json(raw)
    return ("PASS" if status == 200 else "FAIL"), {
        "status": status, "error": _error(doc) if status != 200 else None,
        "reply": [(b.get("type"), b.get("name")) for b in doc.get("content", []) if isinstance(b, dict)]}


def check_image(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    msgs = _scan_conversation(1, _scan_b64())
    msgs[0] = {"role": "user", "content": "Read page scan img_1 and name the surnames on it."}
    status, _, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 200, "tools": IMAGE_TOOL, "messages": msgs})
    doc = _json(raw)
    text = " ".join(b.get("text", "") for b in doc.get("content", []) if isinstance(b, dict))
    ok = status == 200 and "Mul" in text  # the page is the MUL… section (Muller, Mulligan, Mullin)
    return ("PASS" if ok else "FAIL"), {"status": status, "input_tokens": (doc.get("usage") or {}).get("input_tokens"),
                                        "reply": text[:200], "error": _error(doc) if status != 200 else None}


def check_body_limit(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    img, rows = _scan_b64(), []
    for n in range(1, args.max_scans + 1):
        body = {"model": SONNET, "max_tokens": 20, "tools": IMAGE_TOOL, "messages": _scan_conversation(n, img)}
        size = len(json.dumps(body))
        status, ctype, raw, _, _ = gw.post(body)
        rows.append({"scans": n, "body_bytes": size, "status": status, "content_type": ctype,
                     "error": None if status == 200 else raw[:120].decode("utf-8", "replace")})
    ok = all(r["status"] == 200 for r in rows)
    return ("PASS" if ok else "FAIL"), {"rows": rows}


def check_stop_reasons(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    out: dict[str, Any] = {}
    status, _, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 10,
                                    "messages": _msg("Write a long essay about parish registers.")})
    out["max_tokens"] = {"status": status, "stop_reason": _json(raw).get("stop_reason")}
    status, _, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 200, "stop_sequences": ["BANANA"],
                                    "messages": _msg("Write the words: apple cherry BANANA grape, then stop.")})
    doc = _json(raw)
    out["stop_sequence"] = {"status": status, "stop_reason": doc.get("stop_reason"), "stop_sequence": doc.get("stop_sequence")}
    status, ctype, raw, _, _ = gw.post({"model": "us.anthropic.claude-does-not-exist", "max_tokens": 5,
                                        "messages": _msg("hi"), "stream": True})
    out["unknown_model_stream"] = {"status": status, "content_type": ctype, "error": _error(_json(raw))}
    ok = (out["max_tokens"]["stop_reason"] == "max_tokens"
          and out["stop_sequence"]["stop_reason"] == "stop_sequence" and out["stop_sequence"]["stop_sequence"] == "BANANA"
          and 400 <= out["unknown_model_stream"]["status"] < 500
          and (out["unknown_model_stream"]["error"] or "").startswith("invalid_request_error"))
    return ("PASS" if ok else "FAIL"), out


def check_tool_choice(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    out = {}
    for tc in ({"type": "tool", "name": "record_note"}, {"type": "any"}):
        status, _, raw, _, _ = gw.post({"model": SONNET, "max_tokens": 300, "tools": NOTE_TOOLS, "tool_choice": tc,
                                        "messages": _msg("Hello! How are you today?")})
        doc = _json(raw)
        out[tc["type"]] = {"status": status, "stop_reason": doc.get("stop_reason"),
                           "blocks": [b.get("type") for b in doc.get("content", []) if isinstance(b, dict)]}
    ok = all(v["stop_reason"] == "tool_use" for v in out.values())
    return ("PASS" if ok else "FAIL"), out


def check_context_1m(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    para = "Parish register entry %d: baptism of a child to John and Mary Smith, witnesses Thomas Brown and Ann Green. "
    text = "".join(para % i for i in range(9000)) + "\nWhat is the number of the last entry above? Reply with the number only."
    status, _, raw, _, total = gw.post({"model": SONNET, "max_tokens": 20, "messages": _msg(text)})
    doc = _json(raw)
    reply = " ".join(b.get("text", "") for b in doc.get("content", []) if isinstance(b, dict))
    ok = status == 200 and "8999" in reply
    return ("PASS" if ok else "FAIL"), {"status": status, "input_tokens": (doc.get("usage") or {}).get("input_tokens"),
                                        "reply": reply[:40], "total_s": round(total, 1), "error": _error(doc) if status != 200 else None}


def check_cache_ttl(gw: Gateway, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    system = [{"type": "text", "text": ("You are a careful genealogist. " * 900) + f" Probe {time.time_ns()}.",
               "cache_control": {"type": "ephemeral", "ttl": "1h"}}]
    body = {"model": SONNET, "max_tokens": 5, "system": system, "messages": _msg("Reply with exactly: ok")}
    calls = []
    for label, wait in (("write", 0), ("read_1s", 1), ("read_6m40s", 400)):
        time.sleep(wait)
        status, _, raw, _, _ = gw.post(body, beta="extended-cache-ttl-2025-04-11")
        usage = _json(raw).get("usage") or {}
        calls.append({"call": label, "status": status, "cache_read": usage.get("cache_read_input_tokens"),
                      "cache_write": usage.get("cache_creation_input_tokens")})
    ok = (calls[-1]["cache_read"] or 0) > 0
    return ("PASS" if ok else "FAIL"), {"calls": calls}


CHECKS: dict[str, Callable[[Gateway, argparse.Namespace], tuple[str, dict[str, Any]]]] = {
    "messages": check_messages, "streaming": check_streaming, "model_ids": check_model_ids, "betas": check_betas,
    "tool_reference": check_tool_reference, "image": check_image, "body_limit": check_body_limit,
    "stop_reasons": check_stop_reasons, "tool_choice": check_tool_choice,
    "context_1m": check_context_1m, "cache_ttl": check_cache_ttl,
}
OPT_IN = {"context_1m": "context_1m", "cache_ttl": "cache_ttl"}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m dev.p1.probe_gateway_parity",
                                description="What an Anthropic-Messages gateway keeps of Claude Code's requests (P3c–P3l).")
    p.add_argument("--base", help="gateway route root, e.g. http://127.0.0.1:3939/bedrock")
    p.add_argument("--token", default=None, help="consumer key, sent as Authorization: Bearer (never logged)")
    p.add_argument("--out", default=None, help="write the evidence JSON here")
    p.add_argument("--only", nargs="+", default=None, metavar="NAME", help="run only these checks")
    p.add_argument("--max-scans", type=int, default=3, help="body_limit: largest scan count (default 3)")
    p.add_argument("--context-1m", action="store_true", help="also run the ~269k-token check (~$1)")
    p.add_argument("--cache-ttl", action="store_true", help="also run the 1h-TTL check (takes ~7 minutes)")
    p.add_argument("--list", action="store_true", help="print the check names and exit")
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.list:
        print("\n".join(f"{n}{'  (opt-in)' if n in OPT_IN else ''}" for n in CHECKS))
        return 0
    if not args.base:
        parser.error("--base is required")
    if args.max_scans < 1:
        parser.error("--max-scans must be at least 1")
    unknown = sorted(set(args.only or ()) - set(CHECKS))
    if unknown:
        parser.error(f"unknown check(s) {unknown}; --list shows {sorted(CHECKS)}")
    names = list(args.only) if args.only else [n for n in CHECKS if n not in OPT_IN or getattr(args, OPT_IN[n])]
    try:
        gw = Gateway(args.base, args.token)
    except ValueError as exc:
        parser.error(str(exc))
    results: dict[str, Any] = {}
    for name in names:
        try:
            verdict, evidence = CHECKS[name](gw, args)
        except (OSError, http.client.HTTPException) as exc:
            if name == names[0]:
                print(f"gateway unreachable at {args.base}: {exc}", file=sys.stderr)
                return 2
            verdict, evidence = "FAIL", {"exception": f"{type(exc).__name__}: {exc}"}
        results[name] = {"verdict": verdict, "evidence": evidence}
        print(f"{name:<15} {verdict:<5} {json.dumps(evidence, ensure_ascii=False)[:220]}", flush=True)
    if args.out:
        doc = {"measured_at": datetime.now(timezone.utc).isoformat(), "base": args.base, "checks": results}
        Path(args.out).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    fails = [n for n, r in results.items() if r["verdict"] == "FAIL"]
    print(f"\n{len(results)} checks: {len(results) - len(fails)} not failing, {len(fails)} FAIL {fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
