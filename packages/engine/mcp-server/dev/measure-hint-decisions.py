"""How often the search-hints agent's own accepts and rejects are wrong (issue #4590).

FamilySearch's resolved record matches are the answer key, so nobody labels
anything: a match a person ACCEPTED is a record attached to that tree person,
and the agent rejecting it is a false reject; a match a person REJECTED is a
record ruled out, and the agent accepting it is a false accept.

The cases are the e2e fixtures' `source_pid` persons (every accepted and
rejected match on each) plus, because rejected matches are rare, every relative
in a fixture's `unstripped-tree.gedcomx.json` that has at least one rejected
match. A case holds at most --cap hints: every rejected match first, then the
accepted ones in a stable order.

How the agent is fed: the agent body of packages/engine/plugin/agents/search-hints.md
runs as the system prompt of an Agent SDK session, on the model and effort
given, holding only the agent's own tools, against the real MCP server
(build/index.js) — record_read, image_transcribe, tree_query, the log writes are
all live. Exactly one tool is rewritten, after it runs, by a PostToolUse hook:

- person_record_matches returns the case's answer-key list, every status
  rewritten to "pending", in place of what FamilySearch has pending.
- person_read has every source that cites a record under review removed: an
  accepted match is an attached source, so the attached list is the answer.

The scratch project is the fixture's unstripped tree (else project_create from
the PID) with the same sources removed, and the fixture's empty
starting-research.json. The delegation is a researcher's direct request, so no
plan item is held.

The verdict on a hint is its logged outcome (positive = accept, negative =
reject); a hint with no log entry takes its verdict from the return's line for
it (not enough information, already linked), else it is "unreported".

Usage, from the repo root (needs `make engine-build` and `make e2e-login`):

  uv run --project eval/harness python packages/engine/mcp-server/dev/measure-hint-decisions.py \
      key  --out <dir>                          # the answer key: <dir>/key.json
  uv run ... run --out <dir> --model claude-haiku-5-5 --effort medium [--limit N] [--jobs 4]
  uv run ... report --out <dir>

Everything is written under --out: key.json, runs/<model>-<effort>.jsonl (one
line per case, appended, so a re-run skips the cases already done) and
workspaces/. These hold FamilySearch record data; never commit them.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from claude_agent_sdk import (  # noqa: E402
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402

from e2e.mcp_health import genealogy_mcp_config  # noqa: E402
from harness.auth import env_for_sdk, resolve_auth  # noqa: E402

ENTRY = REPO / "packages" / "engine" / "mcp-server" / "build" / "index.js"
AGENT = REPO / "packages" / "engine" / "plugin" / "agents" / "search-hints.md"
E2E = REPO / "eval" / "tests" / "e2e"
PID_RE = re.compile(r"^[A-Z0-9]{4}-[A-Z0-9]{2,4}$")
PERSONA_RE = re.compile(r"1:1:([A-Z0-9]{4}-[A-Z0-9]{3,5})")
SERVER = "mcp__genealogy__"


def bare(ark: str) -> str | None:
    m = PERSONA_RE.search(ark or "")
    return m.group(1) if m else None


def agent_spec() -> tuple[str, list[str]]:
    text = AGENT.read_text(encoding="utf-8")
    _, front, body = text.split("---", 2)
    tools = [t for t in re.findall(r"^\s*-\s*(mcp__\S+)", front, re.M) if t.startswith(SERVER)]
    return body.strip(), tools


# ── the answer key ─────────────────────────────────────────────────────────


class Mcp:
    """One stdio client on the built server, for the key and project_create."""

    async def __aenter__(self) -> "Mcp":
        self._cm = stdio_client(StdioServerParameters(command="node", args=[str(ENTRY)]))
        r, w = await self._cm.__aenter__()
        self._s = ClientSession(r, w)
        await self._s.__aenter__()
        await self._s.initialize()
        return self

    async def __aexit__(self, *a: Any) -> None:
        await self._s.__aexit__(*a)
        await self._cm.__aexit__(*a)

    async def call(self, name: str, args: dict[str, Any]) -> Any:
        res = await self._s.call_tool(name, args)
        text = "".join(getattr(c, "text", "") for c in res.content)
        if res.isError:
            raise RuntimeError(text[:300])
        return json.loads(text)


async def matches(mcp: Mcp, pid: str) -> dict[str, list[dict[str, Any]]]:
    out = await mcp.call(
        "person_record_matches",
        {"id": pid, "status": ["accepted", "rejected"], "minConfidence": 1, "count": 50},
    )
    by: dict[str, list[dict[str, Any]]] = {"accepted": [], "rejected": []}
    for m in out.get("matches") or []:
        if m.get("status") in by and bare(m.get("ark", "")):
            by[m["status"]].append(m)
    return by


async def build_key(out: Path) -> None:
    subjects: dict[str, str] = {}
    relatives: dict[str, str] = {}
    for fx in sorted(E2E.glob("*/fixture.json")):
        slug = fx.parent.name
        pid = json.loads(fx.read_text(encoding="utf-8")).get("source_pid") or ""
        if PID_RE.match(pid) and pid not in subjects:
            subjects[pid] = slug
        tree = fx.parent / "unstripped-tree.gedcomx.json"
        if tree.exists():
            for p in json.loads(tree.read_text(encoding="utf-8")).get("persons") or []:
                if PID_RE.match(p.get("id", "")) and str(p.get("living")).lower() != "true":
                    relatives.setdefault(p["id"], slug)
    cases: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    async with Mcp() as mcp:
        todo = [(pid, slug, "subject") for pid, slug in subjects.items()]
        todo += [(pid, slug, "relative") for pid, slug in relatives.items() if pid not in subjects]
        for i, (pid, slug, role) in enumerate(todo):
            try:
                by = await matches(mcp, pid)
            except Exception as e:  # noqa: BLE001
                errors.append({"pid": pid, "slug": slug, "error": str(e)[:200]})
                continue
            if role == "relative" and not by["rejected"]:
                continue
            if by["accepted"] or by["rejected"]:
                cases.append({"pid": pid, "slug": slug, "role": role, **by})
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}", file=sys.stderr)
    out.mkdir(parents=True, exist_ok=True)
    (out / "key.json").write_text(
        json.dumps({"built": time.strftime("%Y-%m-%d"), "cases": cases, "errors": errors}, indent=1),
        encoding="utf-8",
    )
    print(
        f"{len(cases)} cases, {sum(len(c['accepted']) for c in cases)} accepted, "
        f"{sum(len(c['rejected']) for c in cases)} rejected, {len(errors)} errors"
    )


def hints_for(case: dict[str, Any], cap: int) -> list[dict[str, Any]]:
    rej = [{**m, "truth": "rejected"} for m in case["rejected"]]
    acc = sorted(case["accepted"], key=lambda m: hashlib.sha1(m["ark"].encode()).hexdigest())
    acc = [{**m, "truth": "accepted"} for m in acc]
    return (rej + acc)[:cap]


# ── one case ───────────────────────────────────────────────────────────────


def strip_sources(tree: dict[str, Any], pids: set[str]) -> int:
    before = len(tree.get("sources") or [])
    tree["sources"] = [
        s for s in tree.get("sources") or [] if not any(p in json.dumps(s) for p in pids)
    ]
    gone = before - len(tree["sources"])
    kept = {s.get("id") for s in tree["sources"]}

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k == "sources" and isinstance(v, list) and o is not tree:
                    o[k] = [r for r in v if (r.get("id") if isinstance(r, dict) else r) in kept]
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(tree)
    return gone


async def make_project(ws: Path, case: dict[str, Any], pids: set[str], mcp: Mcp) -> str:
    if ws.exists():
        shutil.rmtree(ws)
    fx = E2E / case["slug"]
    tree_file = fx / "unstripped-tree.gedcomx.json"
    if tree_file.exists():
        ws.mkdir(parents=True)
        shutil.copy(fx / "starting-research.json", ws / "research.json")
        tree = json.loads(tree_file.read_text(encoding="utf-8"))
        origin = "unstripped-tree"
    else:
        await mcp.call(
            "project_create",
            {
                "projectPath": str(ws),
                "personId": case["pid"],
                "objective": f"Review the FamilySearch hints on {case['pid']}.",
            },
        )
        tree = json.loads((ws / "tree.gedcomx.json").read_text(encoding="utf-8"))
        origin = "project_create"
    strip_sources(tree, pids)
    path = ws / "tree.gedcomx.json"
    mode = path.stat().st_mode if path.exists() else None
    if mode is not None:
        path.chmod(mode | 0o200)
    path.write_text(json.dumps(tree, indent=1, ensure_ascii=False), encoding="utf-8")
    if mode is not None:
        path.chmod(mode)
    return origin


def person_name(ws: Path, pid: str) -> str:
    tree = json.loads((ws / "tree.gedcomx.json").read_text(encoding="utf-8"))
    for p in tree.get("persons") or []:
        if p.get("id") == pid and p.get("names"):
            n = p["names"][0]
            return " ".join(x for x in (n.get("given"), n.get("surname")) if x) or pid
    return pid


def response_text(resp: Any) -> str:
    if isinstance(resp, str):
        return resp
    if isinstance(resp, list):
        return "".join(c.get("text", "") for c in resp if isinstance(c, dict))
    if isinstance(resp, dict):
        if "content" in resp:
            return response_text(resp["content"])
        return json.dumps(resp)
    return ""


def as_response(resp: Any, payload: Any) -> Any:
    """`payload` in the same shape the tool's own response came in."""
    text = json.dumps(payload)
    if isinstance(resp, list):
        return [{"type": "text", "text": text}]
    if isinstance(resp, dict) and "content" in resp:
        return {**resp, "content": [{"type": "text", "text": text}]}
    return text


async def run_case(
    case: dict[str, Any], hints: list[dict[str, Any]], args: argparse.Namespace, mcp: Mcp
) -> dict[str, Any]:
    body, tools = agent_spec()
    pid = case["pid"]
    pids = {bare(h["ark"]) for h in hints} - {None}
    ws = Path(args.out) / "workspaces" / f"{args.model}-{args.effort}" / f"{case['slug']}__{pid}"
    origin = await make_project(ws, case, pids, mcp)
    image_of: dict[str, str] = {}
    events: list[dict[str, Any]] = []
    served = {
        "queryArk": f"ark:/61903/4:1:{pid}",
        "resultCount": len(hints),
        "returned": len(hints),
        "title": f"Matches for ark:/61903/4:1:{pid}",
        "matches": [
            {k: v for k, v in h.items() if k not in ("truth", "status")} | {"status": "pending"}
            for h in hints
        ],
    }

    async def post(inp: dict[str, Any], _id: str | None, _ctx: Any) -> dict[str, Any]:
        name = inp.get("tool_name", "").removeprefix(SERVER)
        ti, resp = inp.get("tool_input") or {}, inp.get("tool_response")
        if name == "person_record_matches":
            asked = str(ti.get("id", ""))
            payload = served if pid in asked else {**served, "resultCount": 0, "returned": 0, "matches": []}
            events.append({"rewrote": name, "id": asked, "status": ti.get("status")})
            return {"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedMCPToolOutput": as_response(resp, payload)}}
        if name == "person_read":
            try:
                doc = json.loads(response_text(resp))
            except ValueError:
                return {}
            gone = strip_sources(doc, pids)
            events.append({"rewrote": name, "id": ti.get("personId"), "sources_removed": gone})
            return {"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedMCPToolOutput": as_response(resp, doc)}}
        if name == "record_read":
            m = re.search(r'"imageArk"\s*:\s*"([^"]+)"', response_text(resp))
            if m and bare(str(ti.get("recordId", ""))):
                image_of[bare(str(ti["recordId"]))] = m.group(1)
        return {}

    options = ClaudeAgentOptions(
        cwd=str(ws),
        setting_sources=[],
        system_prompt=body,
        tools=[],
        allowed_tools=tools,
        mcp_servers=genealogy_mcp_config(ENTRY),
        strict_mcp_config=True,
        permission_mode="dontAsk",
        model=args.model,
        effort=args.effort,
        max_turns=80,
        env=env_for_sdk(resolve_auth(), tool_search=False),
        hooks={"PostToolUse": [HookMatcher(matcher=f"{SERVER}.*", hooks=[post])]},
    )
    delegation = (
        f"Review the hints on {person_name(ws, pid)} ({pid}).\n\n"
        f"personId: {pid}\nprojectPath: {ws}"
    )
    calls: list[dict[str, Any]] = []
    text: list[str] = []
    result: ResultMessage | None = None
    t0 = time.monotonic()
    error = None
    try:
        async for msg in query(prompt=delegation, options=options):
            if isinstance(msg, AssistantMessage):
                for b in msg.content:
                    if isinstance(b, ToolUseBlock):
                        calls.append({"tool": b.name.removeprefix(SERVER), "input": b.input})
                    elif isinstance(b, TextBlock):
                        text.append(b.text)
            elif isinstance(msg, ResultMessage):
                result = msg
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"[:400]
    elapsed = time.monotonic() - t0
    final = (result.result if result and result.result else "\n".join(text)) or ""
    return {
        "slug": case["slug"],
        "pid": pid,
        "role": case["role"],
        "model": args.model,
        "effort": args.effort,
        "project_origin": origin,
        "hints": judge(hints, ws, final, calls, image_of),
        "cost_usd": getattr(result, "total_cost_usd", None),
        "seconds": round(elapsed, 1),
        "turns": getattr(result, "num_turns", None),
        "tool_counts": dict(Counter(c["tool"] for c in calls)),
        "hook_events": events,
        "final": final,
        "error": error or (None if result and not result.is_error else f"result error: {getattr(result, 'subtype', None)}"),
    }


LINE_RE = re.compile(
    r"1:1:([A-Z0-9]{4}-[A-Z0-9]{3,5})[^\n]{0,60}?\b(accept|reject|not enough information|already linked)\b",
    re.I,
)


def judge(
    hints: list[dict[str, Any]], ws: Path, final: str, calls: list[dict[str, Any]], image_of: dict[str, str]
) -> list[dict[str, Any]]:
    research = json.loads((ws / "research.json").read_text(encoding="utf-8"))
    logged: dict[str, str] = {}
    for e in research.get("log") or []:
        if e.get("tool") != "person_record_matches":
            continue
        q = e.get("query") or {}
        p = bare(str(q.get("recordId", ""))) or bare(e.get("notes") or "")
        if p and e.get("outcome") in ("positive", "negative"):
            logged[p] = "accept" if e["outcome"] == "positive" else "reject"
    said = {m.group(1): m.group(2).lower() for m in LINE_RE.finditer(final)}
    transcribed = {str(c["input"].get("ark", "")) for c in calls if c["tool"] == "image_transcribe"}
    read = {bare(str(c["input"].get("recordId", ""))) for c in calls if c["tool"] == "record_read"}
    out = []
    for h in hints:
        p = bare(h["ark"])
        verdict = logged.get(p) or {"not enough information": "nei", "already linked": "linked"}.get(
            said.get(p, ""), said.get(p) or "unreported"
        )
        img = image_of.get(p)
        out.append(
            {
                "ark": h["ark"],
                "truth": h["truth"],
                "confidence": h.get("confidence"),
                "title": h.get("title"),
                "verdict": verdict,
                "said": said.get(p),
                "record_read": p in read,
                "has_image": bool(img),
                "image_read": bool(img) and any(bare(img) == bare(t) or img.split("/")[-1] in t for t in transcribed),
            }
        )
    return out


async def run(args: argparse.Namespace) -> None:
    out = Path(args.out)
    key = json.loads((out / "key.json").read_text(encoding="utf-8"))
    cases = key["cases"]
    if args.slug:
        cases = [c for c in cases if c["slug"] in args.slug or c["pid"] in args.slug]
    if args.limit:
        cases = cases[: args.limit]
    runs = out / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    log = runs / f"{args.model}-{args.effort}.jsonl"
    done = set()
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            if not r.get("error"):
                done.add((r["slug"], r["pid"]))
    todo = [c for c in cases if (c["slug"], c["pid"]) not in done]
    print(f"{len(todo)} cases to run ({len(done)} already done) -> {log}", file=sys.stderr)
    sem = asyncio.Semaphore(args.jobs)
    lock = asyncio.Lock()
    async with Mcp() as mcp:

        async def one(c: dict[str, Any]) -> None:
            async with sem:
                try:
                    r = await run_case(c, hints_for(c, args.cap), args, mcp)
                except Exception as e:  # noqa: BLE001
                    r = {"slug": c["slug"], "pid": c["pid"], "role": c["role"], "error": f"{type(e).__name__}: {e}"[:400], "hints": []}
                async with lock:
                    with log.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")
                v = Counter(h["verdict"] for h in r.get("hints", []))
                print(f"  {c['slug']} {c['pid']}: {dict(v)} ${r.get('cost_usd')} {r.get('seconds')}s {r.get('error') or ''}", file=sys.stderr)

        await asyncio.gather(*(one(c) for c in todo))


# ── the report ─────────────────────────────────────────────────────────────


def report(args: argparse.Namespace) -> None:
    for log in sorted((Path(args.out) / "runs").glob("*.jsonl")):
        latest: dict[tuple[str, str], dict[str, Any]] = {}
        for line in log.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            latest[(r["slug"], r["pid"])] = r
        rows = list(latest.values())
        ok = [r for r in rows if not r.get("error")]
        print(f"\n== {log.stem}: {len(ok)} cases ran, {len(rows) - len(ok)} errored")
        for truth, wrong in (("accepted", "reject"), ("rejected", "accept")):
            hs = [h for r in ok for h in r["hints"] if h["truth"] == truth]
            v = Counter(h["verdict"] for h in hs)
            n = len(hs)
            persons = len({(r["slug"], r["pid"]) for r in ok if any(h["truth"] == truth for h in r["hints"])})
            pct = lambda k: f"{v[k]} ({100 * v[k] / n:.1f}%)" if n else "0"  # noqa: E731
            label = "false rejects" if wrong == "reject" else "false accepts"
            print(f"  {truth} matches reviewed: {n} on {persons} persons")
            print(f"    {label}: {pct(wrong)}   correct: {pct('accept' if truth == 'accepted' else 'reject')}"
                  f"   not enough information: {pct('nei')}   unreported: {pct('unreported')}   linked: {pct('linked')}")
            bad = [h for h in hs if h["verdict"] == wrong]
            if bad:
                print(f"    of the {label}: image read {sum(h['image_read'] for h in bad)}, "
                      f"index only with an image available {sum(h['has_image'] and not h['image_read'] for h in bad)}, "
                      f"no image {sum(not h['has_image'] for h in bad)}")
        costs = [r["cost_usd"] for r in ok if r.get("cost_usd") is not None]
        secs = [r["seconds"] for r in ok]
        if ok:
            print(f"  per person: ${sum(costs) / max(len(costs), 1):.3f} mean, {sum(secs) / len(secs):.0f}s mean;"
                  f" total ${sum(costs):.2f}")
        rewrites = sum(1 for r in ok if not any(e.get("rewrote") == "person_record_matches" for e in r.get("hook_events", [])))
        print(f"  cases where the agent never listed the hints: {rewrites}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["key", "run", "report"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="claude-haiku-5-5")
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--cap", type=int, default=10)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--slug", nargs="*", default=[])
    args = ap.parse_args()
    if args.cmd == "key":
        asyncio.run(build_key(Path(args.out)))
    elif args.cmd == "run":
        asyncio.run(run(args))
    else:
        report(args)


if __name__ == "__main__":
    main()
