"""`make feedback-profile` — where a hosted session's time and money went, per
session, per agent, per main-thread skill and per tool, read from feedback bundles.

A bundle carries, under `_feedback/`, the parent transcript (`session-log.jsonl`,
plus `sessions/<sid>/session-log.jsonl` for any other session) and each subagent's
transcript beside it (`subagents/agent-<id>.jsonl` and its `.meta.json`). A zip
argument has its `_feedback/` members unpacked into a new temporary directory of
its own, removed on exit; nothing in a bundle is imported or run, and nothing
read from one is committed (`docs/alpha-feedback-guide.md`).

How each figure is measured:

- A session is its events merged across bundles by `uuid`; an agent run is its
  longest transcript across bundles. A run is missing when no bundle carries its
  transcript: one a bundle lists as dropped, or a main-thread `Agent`/`Task`
  call with no error result that neither its `toolUseId` nor the `agentId` its
  result names ties to a transcript. A call refused before it ran errors.
- A gap over `PAUSE_S` between consecutive events is a sandbox pause, except a
  gap that ends when an agent returns — an `Agent`/`Task` result or a background
  agent's `<task-notification>` — which is agent time less that agent's own
  pauses, a gap that ends on a model message whose content covers it
  (`GEN_CHARS_PER_S`), and a gap that ends on an API error (a `<synthetic>`
  placeholder), which is the request still waiting on the API. Active time is
  everything that is not a pause.
- Agent wait is main-thread active time that ends when an agent returns;
  api-error wait is the active time those over-threshold API-error gaps add.
- A `<synthetic>` message is not a model call: it is neither counted nor timed.
- A tool call's latency runs from the call to its result. A call after an agent
  launch in the same message waits for that agent, so its clock starts at the
  agent's return; a window that holds a pause has no latency.
- A model message is priced from its LAST usage line: a transcript streams one
  line per content block, and a subagent's first line undercounts output tokens.
- A compaction is a "This session is being continued" prompt.
- Main-thread work belongs to the skill loaded last, until the next `Skill` call.
- A cache rewrite is the first main-thread call after an agent returns reading
  at least `REWRITE_MIN_TOKENS` less than the previous call's context held; the
  shortfall's write price above a read is its cost. The first call after a
  compaction is never one: no cache read could serve the new context.

Run from eval/harness/:
  uv run python -m e2e.feedback_profile ~/Downloads/feedback-<ts>.zip [--since ISO] [--json PATH]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import statistics
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path, PurePath
from typing import Any

from e2e import pricing
from e2e.feedback_transcript_adapter import _bare_agent, _group_dirs, _parse_meta
from e2e.subagent_capture import parse_jsonl, transcript_agent_id

PAUSE_S = 600
GEN_CHARS_PER_S = 50
BIG_RESULT_CHARS = 50_000
# A call reading 1-3 tokens less than the last one held is the cache boundary
# moving; a rewrite misses at least the smallest cacheable prompt.
REWRITE_MIN_TOKENS = 1_024
TOP_N = 10
AGENT_TOOLS = ("Agent", "Task")
COMPACTION_PREFIX = "This session is being continued"
SYNTHETIC_MODEL = "<synthetic>"
BEFORE_ANY_SKILL = "(before any skill)"

_BUILD_ID = re.compile(r'buildId\\?"\s*:\s*\\?"([^"\\]+)')
_TASK_ID = re.compile(r"<task-id>([^<]+)</task-id>")
_AGENT_ID = re.compile(r"agentId: ([A-Za-z0-9]+)")
_DROPPED_AGENT = re.compile(r"(?:sessions/([^/]+)/)?subagents/agent-([^/\s]+)\.jsonl")
_IMAGE_KEYS = ("imageId", "ark", "memoryArtifactUrl", "file")


def parse_when(stamp: Any) -> float | None:
    """Epoch seconds for an ISO date or datetime, UTC when no zone is given."""
    if not isinstance(stamp, str):
        return None
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.timestamp()


def _iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


# ── finding and unpacking bundles ────────────────────────────────────────────


def _bundles_in(root: Path) -> list[Path]:
    if (root / "_feedback").is_dir():
        return [root]
    return sorted(c for c in root.iterdir() if c.is_dir() and (c / "_feedback").is_dir())


def member_target(name: str, dest: PurePath) -> PurePath | None:
    """Where zip member `name` is written under `dest`, or None when it is skipped.

    Backslashes become separators (a zip made on Windows uses them) and empty,
    `.` and `..` parts are dropped. Only a file under a `_feedback` folder is
    kept. A name that is absolute or UNC is skipped, and so is one with a `:` in
    any part: on Windows a part carrying a drive (`D:`, `D:evil.txt`) restarts the
    path on that drive, and `x:y` names a stream. A target that resolves outside
    `dest` is skipped too. A pure `dest` is joined but not resolved, so the
    Windows rules are checked on every OS."""
    posix = name.replace("\\", "/")
    parts = [p for p in posix.split("/") if p not in ("", ".", "..")]
    if posix.endswith("/") or "_feedback" not in parts[:-1]:
        return None
    if posix.startswith("/") or any(":" in p for p in parts):
        return None
    target = dest.joinpath(*parts)
    if isinstance(dest, Path) and not target.resolve().is_relative_to(dest.resolve()):
        return None
    return target


def extract_zip(zip_path: Path, stack: ExitStack) -> Path:
    """Unpack `zip_path`'s `_feedback/` members into a new temporary directory,
    which `stack` removes on exit. Members are written one by one, each where
    `member_target` puts it, rather than with `extractall`."""
    dest = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="feedback-profile-")))
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            target = member_target(info.filename, dest)
            if target is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as out:
                shutil.copyfileobj(src, out)
    return dest


def resolve_inputs(args: list[str], stack: ExitStack) -> list[tuple[str, Path]]:
    """`(bundle name, bundle dir)` for every bundle the arguments name: a zip, one
    unpacked bundle, or a folder of them. Raises ValueError for an argument that
    holds none, so a typo never reads as an empty corpus."""
    bundles: list[tuple[str, Path]] = []
    for raw in args:
        path = Path(raw).expanduser()
        if path.is_file():
            try:
                root = extract_zip(path, stack)
            except zipfile.BadZipFile as exc:
                raise ValueError(f"{raw}: not a zip ({exc})") from exc
            found = [(path.stem if b == root else b.name, b) for b in _bundles_in(root)]
        elif path.is_dir():
            found = [(b.name, b) for b in _bundles_in(path)]
        else:
            raise ValueError(f"{raw}: no such file or directory")
        if not found:
            raise ValueError(f"{raw}: no feedback bundle in it (no _feedback/ folder; name a zip itself)")
        bundles += found
    return bundles


def load_bundles(bundles: list[tuple[str, Path]]) -> dict[str, Any]:
    """Every session's events, merged by uuid, and every agent's longest transcript."""
    sessions: dict[str, dict[str, dict]] = defaultdict(dict)
    session_bundles: dict[str, set[str]] = defaultdict(set)
    truncated: dict[str, set[str]] = defaultdict(set)
    agents: dict[str, dict[str, Any]] = {}
    dropped: list[tuple[str | None, str]] = []
    for name, path in bundles:
        active_sid = None
        for index, (group, parent_path, subagents_dir) in enumerate(_group_dirs(path)):
            group_sid = None if index == 0 else group
            if parent_path.is_file():
                cut = False
                seen: set[str] = set()
                for row in parse_jsonl(parent_path, errors="replace"):
                    if row.get("type") == "_truncation_note":
                        cut = True
                        continue
                    sid, uuid = row.get("sessionId"), row.get("uuid")
                    if isinstance(sid, str) and isinstance(uuid, str):
                        sessions[sid][uuid] = row
                        seen.add(sid)
                        group_sid = sid
                for sid in seen:
                    session_bundles[sid].add(name)
                    if cut:
                        truncated[sid].add(name)
            if index == 0:
                active_sid = group_sid
            if subagents_dir.is_dir():
                for path_ in sorted(subagents_dir.glob("agent-*.jsonl")):
                    aid = transcript_agent_id(path_)
                    if aid is None:
                        continue
                    rows = parse_jsonl(path_, errors="replace")
                    if aid not in agents or len(rows) > len(agents[aid]["rows"]):
                        meta = _parse_meta(path_.with_suffix(".meta.json")) or {}
                        agents[aid] = {"rows": rows, "meta": meta, "session": group_sid}
        meta = _parse_meta(path / "_feedback" / "feedback.json") or {}
        entries = meta.get("dropped_transcripts")
        for entry in entries if isinstance(entries, list) else []:
            match = _DROPPED_AGENT.search(entry) if isinstance(entry, str) else None
            if match:
                dropped.append((match.group(1) or active_sid, match.group(2)))
    missing: dict[str, set[str]] = defaultdict(set)
    for sid, aid in dropped:
        if sid and aid not in agents:
            missing[sid].add(aid)
    return {"bundles": sorted({name for name, _path in bundles}), "sessions": sessions,
            "session_bundles": session_bundles, "truncated": truncated, "agents": agents,
            "missing": missing}


# ── one thread: a session's main thread or one agent run ─────────────────────


def _short(name: Any) -> str:
    return name.split("__")[-1] if isinstance(name, str) else "?"


def _result_size(content: Any) -> tuple[int, int]:
    if isinstance(content, str):
        return len(content), 0
    chars = images = 0
    for block in content if isinstance(content, list) else []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            chars += len(block.get("text") or "")
        elif block.get("type") == "image":
            images += len(json.dumps(block.get("source") or {}))
        else:
            chars += len(json.dumps(block))
    return chars, images


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return " ".join(b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text")


def _returned_agents(row: dict, tool_uses: dict[str, dict]) -> list[str] | None:
    """The keys of the agents whose return `row` carries, or None when it carries
    none: an `Agent`/`Task` result, keyed by its tool_use id, or a background
    agent's `<task-notification>`, keyed by its task id. A `run_in_background`
    launch's result counts too: it can come back only when the agent dies."""
    if row.get("type") != "user":
        return None
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    content = message.get("content")
    if isinstance(content, list):
        keys = [b["tool_use_id"] for b in content
                if isinstance(b, dict) and b.get("type") == "tool_result"
                and isinstance(b.get("tool_use_id"), str)
                and (tool_uses.get(b["tool_use_id"]) or {}).get("name") in AGENT_TOOLS]
        return keys or None
    if isinstance(content, str) and content.startswith("<task-notification>"):
        match = _TASK_ID.search(content)
        return [match.group(1)] if match else None
    return None


def _is_api_error(row: dict) -> bool:
    """The placeholder Claude Code writes when a request fails."""
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    return row.get("type") == "assistant" and message.get("model") == SYNTHETIC_MODEL \
        and row.get("isApiErrorMessage") is True


def _covers_gap(row: dict, gap: float) -> bool:
    """A gap that ends on an assistant line carrying content to fill it is a long
    generation, not a pause."""
    if row.get("type") != "assistant":
        return False
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    content = message.get("content")
    chars = 0
    for block in content if isinstance(content, list) else []:
        if isinstance(block, dict):
            chars += len(block.get("thinking") or "") + len(block.get("text") or "") \
                + len(json.dumps(block.get("input") or {}))
    return chars >= GEN_CHARS_PER_S * gap


def _tokens(usage: dict, field: str) -> int:
    raw = usage.get(field)
    return raw if isinstance(raw, int) else 0


def _rewrite_cost(tokens: int, usage: dict, model: Any) -> float:
    """What `tokens` cost as cache writes, at this message's 5m/1h mix, above
    what reading them would have."""
    writes = _tokens(usage, "cache_creation_input_tokens")
    split = usage.get("cache_creation") if isinstance(usage.get("cache_creation"), dict) else {}
    one_hour = _tokens(split, "ephemeral_1h_input_tokens")
    share = one_hour / writes if writes else 0.0
    write = pricing.estimate_message_cost(
        {"cache_creation_input_tokens": tokens,
         "cache_creation": {"ephemeral_1h_input_tokens": round(tokens * share)}}, model)
    read = pricing.estimate_message_cost({"cache_read_input_tokens": tokens}, model)
    return write - read if write is not None and read is not None else 0.0


def _image_key(args: dict) -> str | None:
    """The page an `image_transcribe` call read, its ARK spelled one way."""
    for key in _IMAGE_KEYS:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            value = value.strip()
            if "ark:/61903/" in value:
                value = value.split("ark:/61903/", 1)[1]
            for prefix in ("3:1:", "3:2:"):
                if value.startswith(prefix):
                    value = value[len(prefix):]
            return value
    return None


def analyze(rows: list[dict], agent_paused: dict[str, float] | None = None) -> dict[str, Any]:
    """One thread's time split, model calls, tool calls, compactions and timeline.

    `agent_paused` maps an agent's tool_use id and its agent id to the seconds
    that agent was itself paused, for the gaps that end when it returns."""
    agent_paused = agent_paused or {}
    events = sorted(((t, d) for d in rows if (t := parse_when(d.get("timestamp"))) is not None),
                    key=lambda e: e[0])
    msgs: dict[str, dict[str, Any]] = {}
    tool_uses: dict[str, dict[str, Any]] = {}
    results: dict[str, dict[str, Any]] = {}
    timeline: list[tuple[float, str, dict]] = []
    compactions = 0
    active = paused = agent_wait = api_error_wait = 0.0
    pauses: list[tuple[float, float]] = []
    builds: set[str] = set()
    prev_t: float | None = None
    agent_returned = compacted = False
    for t, d in events:
        returned = _returned_agents(d, tool_uses)
        if prev_t is not None:
            gap = t - prev_t
            if gap > PAUSE_S:
                if returned is not None:
                    own = min(gap, max(agent_paused.get(k, 0.0) for k in returned))
                    paused += own
                    active += gap - own
                    agent_wait += gap - own
                    if own:
                        pauses.append((prev_t, t))
                elif _is_api_error(d):
                    active += gap
                    api_error_wait += gap
                elif _covers_gap(d, gap):
                    active += gap
                else:
                    paused += gap
                    pauses.append((prev_t, t))
            else:
                active += gap
                if returned is not None:
                    agent_wait += gap
        message = d.get("message") if isinstance(d.get("message"), dict) else {}
        content = message.get("content")
        if d.get("type") == "user":
            if returned is not None:
                agent_returned = True
            if isinstance(content, str):
                if content.startswith(COMPACTION_PREFIX):
                    compactions += 1
                    compacted = True
                timeline.append((t, "prompt", {"text": content[:300]}))
            elif isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_result" and isinstance(block.get("tool_use_id"), str):
                        chars, image_chars = _result_size(block.get("content"))
                        text = _result_text(block.get("content"))
                        builds.update(_BUILD_ID.findall(text))
                        launch = (tool_uses.get(block["tool_use_id"]) or {}).get("name") in AGENT_TOOLS
                        agent_id = _AGENT_ID.search(text) if launch else None
                        results[block["tool_use_id"]] = {
                            "t": t, "chars": chars, "image_chars": image_chars,
                            "is_error": bool(block.get("is_error")), "head": text[:400],
                            "agent_id": agent_id.group(1) if agent_id else None}
                    elif block.get("type") == "text" and \
                            (block.get("text") or "").startswith(COMPACTION_PREFIX):
                        compactions += 1
                        compacted = True
        elif d.get("type") == "assistant":
            mid = next((v for v in (message.get("id"), d.get("uuid")) if isinstance(v, str) and v), str(t))
            m = msgs.get(mid)
            if m is None:
                m = msgs[mid] = {"start": prev_t if prev_t is not None else t, "usage": {},
                                 "model": message.get("model"), "stop": None, "thinking_chars": 0,
                                 "text_chars": 0, "tools": [], "after_agent": agent_returned,
                                 "after_compaction": compacted}
                agent_returned = compacted = False
            m["end"] = t
            if isinstance(message.get("usage"), dict) and message["usage"]:
                m["usage"] = message["usage"]
            if message.get("stop_reason"):
                m["stop"] = message["stop_reason"]
            for block in content if isinstance(content, list) else []:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "thinking":
                    m["thinking_chars"] += len(block.get("thinking") or "")
                elif block.get("type") == "text":
                    m["text_chars"] += len(block.get("text") or "")
                elif block.get("type") == "tool_use" and isinstance(block.get("id"), str):
                    args = block.get("input") if isinstance(block.get("input"), dict) else {}
                    tool_uses[block["id"]] = {
                        "t": t, "name": _short(block.get("name")), "input": args,
                        "args": json.dumps(args, ensure_ascii=False, sort_keys=True)}
                    m["tools"].append(block["id"])
        prev_t = t

    held_by: dict[str, list[str]] = {}
    for m in msgs.values():
        launched: list[str] = []
        for tid in m["tools"]:
            if tool_uses[tid]["name"] in AGENT_TOOLS:
                launched.append(tid)
            else:
                held_by[tid] = list(launched)

    def tool_latency(tid: str, use: dict, r: dict | None) -> float | None:
        """Result less call time. A call after an agent launch in the same message
        waits for that agent, so its clock starts at the agent's return, unless
        its own result came back first. None when the window holds a pause."""
        if r is None:
            return None
        start = max([use["t"], *(results[a]["t"] for a in held_by.get(tid, ())
                                 if a in results and results[a]["t"] <= r["t"])])
        if any(a < r["t"] and b > start for a, b in pauses):
            return None
        return r["t"] - start

    calls = []
    for tid, use in tool_uses.items():
        r = results.get(tid)
        calls.append({"id": tid, "name": use["name"], "t": use["t"], "input": use["input"],
                      "args": use["args"], "latency": tool_latency(tid, use, r),
                      "result_chars": r["chars"] if r else None,
                      "image_chars": r["image_chars"] if r else 0,
                      "is_error": r["is_error"] if r else None, "result_head": r["head"] if r else None,
                      "agent_id": r["agent_id"] if r else None})
    model_calls = []
    prev_ctx = 0
    pending = compacted = False
    for mid, m in msgs.items():
        pending = pending or m["after_agent"]
        compacted = compacted or m["after_compaction"]
        if m["model"] == SYNTHETIC_MODEL:
            continue
        u = m["usage"]
        ctx = sum(_tokens(u, f) for f in ("input_tokens", "cache_creation_input_tokens",
                                          "cache_read_input_tokens"))
        latency = m["end"] - m["start"]
        covered = m["thinking_chars"] + m["text_chars"] >= GEN_CHARS_PER_S * latency
        rewritten, rewrite_cost = 0, 0.0
        if ctx:
            shortfall = prev_ctx - _tokens(u, "cache_read_input_tokens")
            if pending and not compacted and prev_ctx and shortfall >= REWRITE_MIN_TOKENS:
                rewritten = min(_tokens(u, "cache_creation_input_tokens"), shortfall)
                rewrite_cost = _rewrite_cost(rewritten, u, m["model"])
            pending = compacted = False
            prev_ctx = ctx
        cost = pricing.estimate_message_cost(u, m["model"])
        out = _tokens(u, "output_tokens")
        model_calls.append({
            "id": mid, "t": m["end"], "latency": latency if (latency <= PAUSE_S or covered) else None,
            "out": out, "ctx": ctx, "model": m["model"], "stop": m["stop"], "cost": cost,
            "unpriced": cost is None and (ctx > 0 or out > 0),
            "rewritten": rewritten, "rewrite_cost": rewrite_cost,
            "tool_names": [tool_uses[x]["name"] for x in m["tools"]]})
    for mc in model_calls:
        timeline.append((mc["t"], "model", mc))
    for c in calls:
        timeline.append((c["t"] + 0.0001, "tool", c))
    timeline.sort(key=lambda x: x[0])
    return {"start": events[0][0] if events else None, "end": events[-1][0] if events else None,
            "active_s": active, "paused_s": paused, "agent_wait_s": agent_wait,
            "api_error_wait_s": api_error_wait,
            "model_calls": model_calls, "tool_calls": calls, "compactions": compactions,
            "timeline": timeline, "engine_builds": sorted(builds),
            "cost": sum(mc["cost"] or 0.0 for mc in model_calls)}


def skill_segments(sid: str, thread: dict[str, Any]) -> list[dict[str, Any]]:
    """The main thread cut where a skill loads: each piece belongs to the skill
    loaded last (a `Skill` call or a `<command-name>` prompt)."""
    segments: list[dict[str, Any]] = []
    seg: dict[str, Any] | None = None
    skill = BEFORE_ANY_SKILL

    def open_segment(t: float) -> dict[str, Any]:
        new = {"session": sid, "skill": skill, "start": t, "model_calls": [], "tool_calls": [],
               "compactions": 0}
        segments.append(new)
        return new

    for t, kind, x in thread["timeline"]:
        if kind == "tool" and x["name"] == "Skill":
            skill = str(x["input"].get("skill") or "?").split(":")[-1]
            seg = open_segment(t)
            continue
        if kind == "prompt" and "<command-name>" in x["text"]:
            skill = x["text"].split("<command-name>")[1].split("</command-name>")[0] \
                .lstrip("/").split(":")[-1]
            seg = open_segment(t)
            continue
        if seg is None:
            seg = open_segment(t)
        if kind == "model":
            seg["model_calls"].append(x)
        elif kind == "tool":
            seg["tool_calls"].append(x)
        elif x["text"].startswith(COMPACTION_PREFIX):
            seg["compactions"] += 1
    return segments


# ── the profile ──────────────────────────────────────────────────────────────


def _median(xs: list[float | None]) -> float | None:
    known = [x for x in xs if x is not None]
    return statistics.median(known) if known else None


def build_profile(corpus: dict[str, Any], since: float | None = None) -> dict[str, Any]:
    """Every table the report prints, as plain data (also what `--json` writes)."""
    agents = corpus["agents"]
    agent_paused: dict[str, float] = {}
    agent_threads: dict[str, dict] = {}

    def deepest_first(aid: str) -> int:
        depth = agents[aid]["meta"].get("spawnDepth")
        return -depth if isinstance(depth, int) else -1

    for aid in sorted(agents, key=deepest_first):
        thread = analyze(agents[aid]["rows"], agent_paused)
        agent_threads[aid] = thread
        agent_paused[aid] = thread["paused_s"]
        tool_use_id = agents[aid]["meta"].get("toolUseId")
        if isinstance(tool_use_id, str):
            agent_paused[tool_use_id] = thread["paused_s"]

    def in_window(end: float | None) -> bool:
        return end is not None and (since is None or end >= since)

    transcript_calls = {a["meta"].get("toolUseId") for a in agents.values()}
    threads: list[tuple[str, dict]] = []
    agent_parent: dict[str, str] = {}
    sessions_out = []
    segments: list[dict] = []
    excluded_sessions = 0
    for sid, by_uuid in corpus["sessions"].items():
        thread = analyze(list(by_uuid.values()), agent_paused)
        for c in thread["tool_calls"]:
            if c["name"] in AGENT_TOOLS:
                agent_parent[c["id"]] = sid
        if not in_window(thread["end"]):
            excluded_sessions += 1
            continue
        threads.append((f"main {sid[:8]}", thread))
        segments += [s for s in skill_segments(sid, thread)
                     if s["model_calls"] and in_window(s["model_calls"][-1]["t"])]
        rewrites = [mc for mc in thread["model_calls"] if mc["rewritten"]]
        unanswered = {c["agent_id"] or c["id"] for c in thread["tool_calls"]
                      if c["name"] in AGENT_TOOLS and c["is_error"] is not True
                      and c["id"] not in transcript_calls and c["agent_id"] not in agents}
        sessions_out.append({
            "session": sid, "bundles": sorted(corpus["session_bundles"][sid]),
            "engine_builds": thread["engine_builds"],
            "start": _iso(thread["start"]), "end": _iso(thread["end"]),
            "active_min": round(thread["active_s"] / 60, 1),
            "agent_wait_min": round(thread["agent_wait_s"] / 60, 1),
            "api_error_wait_min": round(thread["api_error_wait_s"] / 60, 1),
            "paused_min": round(thread["paused_s"] / 60, 1),
            "main_cost": round(thread["cost"], 2), "main_model_calls": len(thread["model_calls"]),
            "compactions": thread["compactions"], "cache_rewrites": len(rewrites),
            "cache_rewrite_cost": round(sum(mc["rewrite_cost"] for mc in rewrites), 2),
            "agent_runs": 0,
            "missing_agent_transcripts": len(corpus["missing"].get(sid, set()) | unanswered),
            "log_truncated_in": sorted(corpus["truncated"].get(sid, ())),
        })
    by_session = {s["session"]: s for s in sessions_out}

    runs: dict[str, list[dict]] = defaultdict(list)
    excluded_runs = 0
    for aid, agent in agents.items():
        thread = agent_threads[aid]
        if not in_window(thread["end"]):
            excluded_runs += 1
            continue
        meta = agent["meta"]
        atype = _bare_agent(meta.get("agentType") or "?")
        sid = agent_parent.get(meta.get("toolUseId")) or agent["session"]
        if sid in by_session:
            by_session[sid]["agent_runs"] += 1
        threads.append((f"{atype} {aid[:8]}", thread))
        runs[atype].append(thread)

    agents_out = []
    for atype, rs in runs.items():
        active = [r["active_s"] for r in rs]
        costs = [r["cost"] for r in rs]
        mcs = [mc for r in rs for mc in r["model_calls"]]
        tcs = [c for r in rs for c in r["tool_calls"]]
        agents_out.append({
            "agent_type": atype, "runs": len(rs),
            "active_min_total": round(sum(active) / 60, 1),
            "active_min_p50": round(_median(active) / 60, 1), "active_min_max": round(max(active) / 60, 1),
            "cost_total": round(sum(costs), 2), "cost_p50": round(_median(costs), 2),
            "cost_max": round(max(costs), 2), "output_tokens": sum(mc["out"] for mc in mcs),
            "tool_errors": sum(1 for c in tcs if c["is_error"]),
            "capped_turns": sum(1 for mc in mcs if mc["stop"] == "max_tokens"),
            "big_results": sum(1 for c in tcs if (c["result_chars"] or 0) > BIG_RESULT_CHARS)})
    agents_out.sort(key=lambda a: -a["cost_total"])

    skills: dict[str, list[dict]] = defaultdict(list)
    for seg in segments:
        skills[seg["skill"]].append(seg)
    skills_out = sorted(({
        "skill": skill, "segments": len(segs),
        "cost": round(sum(mc["cost"] or 0.0 for s in segs for mc in s["model_calls"]), 2),
        "model_min": round(sum(mc["latency"] or 0 for s in segs for mc in s["model_calls"]) / 60, 1),
        "compactions": sum(s["compactions"] for s in segs)} for skill, segs in skills.items()),
        key=lambda s: -s["cost"])

    all_calls = [(where, c) for where, th in threads for c in th["tool_calls"]]
    all_models = [(where, mc) for where, th in threads for mc in th["model_calls"]]
    by_tool: dict[str, list[dict]] = defaultdict(list)
    for _where, c in all_calls:
        by_tool[c["name"]].append(c)
    tools_out = sorted(({
        "tool": name, "calls": len(cs), "errors": sum(1 for c in cs if c["is_error"]),
        "result_chars_total": sum(c["result_chars"] or 0 for c in cs),
        "result_chars_p50": _round(_median([c["result_chars"] for c in cs]), None),
        "result_chars_max": max((c["result_chars"] or 0 for c in cs), default=0),
        "latency_p50_s": _round(_median([c["latency"] for c in cs])),
        "latency_max_s": _round(max((c["latency"] for c in cs if c["latency"] is not None), default=None)),
        "big_results": sum(1 for c in cs if (c["result_chars"] or 0) > BIG_RESULT_CHARS),
    } for name, cs in by_tool.items()), key=lambda t: -t["result_chars_total"])

    return {
        "since": _iso(since), "bundles": corpus["bundles"],
        "excluded_sessions": excluded_sessions, "excluded_agent_runs": excluded_runs,
        "sessions": sorted(sessions_out, key=lambda s: s["start"] or ""),
        "agents": agents_out, "skills": skills_out, "tools": tools_out,
        "top": _top_lists(all_calls, all_models, threads),
        "unpriced_model_calls": dict(Counter(str(mc["model"]) for _w, mc in all_models if mc["unpriced"])),
    }


def _round(value: float | None, digits: int | None = 1) -> float | None:
    return None if value is None else round(value, digits)


def _top_lists(all_calls, all_models, threads) -> dict[str, list[dict]]:
    slowest = sorted((x for x in all_models if x[1]["latency"] is not None),
                     key=lambda x: -x[1]["latency"])[:TOP_N]
    largest = sorted((x for x in all_calls if x[1]["result_chars"]),
                     key=lambda x: -x[1]["result_chars"])[:TOP_N]
    errors: Counter = Counter()
    for where, c in all_calls:
        if c["is_error"]:
            errors[(where, c["name"], " ".join((c["result_head"] or "").split())[:160])] += 1
    repeated = []
    for where, th in threads:
        counts = Counter((c["name"], c["args"]) for c in th["tool_calls"])
        repeated += [{"times": n, "where": where, "tool": tool, "args": args[:200]}
                     for (tool, args), n in counts.items() if n > 1]
    images: dict[str, list[str]] = defaultdict(list)
    for where, c in all_calls:
        if c["name"] == "image_transcribe" and c["is_error"] is False:
            key = _image_key(c["input"])
            if key:
                images[key].append(where)
    return {
        "slowest_model_calls": [
            {"latency_s": round(mc["latency"]), "where": w, "model": mc["model"], "out": mc["out"],
             "ctx": mc["ctx"], "tools": mc["tool_names"]} for w, mc in slowest],
        "largest_results": [
            {"chars": c["result_chars"], "where": w, "tool": c["name"], "args": c["args"][:160]}
            for w, c in largest],
        "error_heads": [
            {"times": n, "tool": tool, "where": where, "head": head}
            for (where, tool, head), n in errors.most_common(TOP_N)],
        "repeated_calls": sorted(repeated, key=lambda r: -r["times"])[:TOP_N],
        "images_transcribed_more_than_once": sorted(
            ({"times": len(ws), "image": key, "where": sorted(set(ws))}
             for key, ws in images.items() if len(ws) > 1), key=lambda r: -r["times"])[:TOP_N],
    }


# ── the text report ──────────────────────────────────────────────────────────


def _table(headers: list[str], rows: list[list[str]]) -> list[str]:
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(headers)]

    def line(cells: list[str]) -> str:
        return "  ".join(c.ljust(w) if i == 0 else c.rjust(w)
                         for i, (c, w) in enumerate(zip(cells, widths))).rstrip()

    return ["  " + line(headers)] + ["  " + line(r) for r in rows]


def _n(value: Any) -> str:
    return "-" if value is None else f"{value:,}"


def _usd(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}"


def _mins(value: float | None) -> str:
    return "-" if value is None else f"{value:.1f}"


def format_report(profile: dict[str, Any]) -> str:
    sessions = profile["sessions"]
    lines = [
        f"Feedback profile: {len(profile['bundles'])} bundle(s), {len(sessions)} session(s), "
        f"{sum(a['runs'] for a in profile['agents'])} agent run(s)"
        + (f", ended on or after {profile['since']}" if profile["since"] else "")
        + (f" ({profile['excluded_sessions']} session(s) and {profile['excluded_agent_runs']} "
           f"agent run(s) ended earlier)" if profile["excluded_sessions"] or profile["excluded_agent_runs"] else ""),
        f"Time in minutes. A gap over {PAUSE_S // 60} min is a sandbox pause unless an agent's return, "
        f"an API error or a model call's output ends it. Agent wait is active time that ended when an "
        f"agent returned.",
        "Cost in USD at pricing.MODEL_RATES, each message's cache writes at its own 5m/1h split.",
        "",
        "SESSIONS (* = a bundle's copy of the log was trimmed oldest-first; missing = agent runs "
        "with no transcript, dropped by the bundle or never shipped, whose own pauses count as agent wait)",
    ]
    lines += _table(
        ["session", "bundles", "engine", "active", "agent wait", "api-error wait", "paused", "main $", "calls",
         "compactions", "agents", "missing", "rewrites", "rewrite $"],
        [[s["session"][:8] + ("*" if s["log_truncated_in"] else ""), str(len(s["bundles"])),
          ",".join(s["engine_builds"]) or "-", _mins(s["active_min"]), _mins(s["agent_wait_min"]),
          _mins(s["api_error_wait_min"]),
          _mins(s["paused_min"]), _usd(s["main_cost"]), _n(s["main_model_calls"]), _n(s["compactions"]),
          _n(s["agent_runs"]), _n(s["missing_agent_transcripts"]), _n(s["cache_rewrites"]),
          _usd(s["cache_rewrite_cost"])] for s in sessions])
    lines += [f"  api-error wait = gaps over {PAUSE_S // 60} min that ended on an API error (a <synthetic> "
              "placeholder): the request was still waiting on the API, so they count as active, not paused."]
    lines += ["  rewrites = main-thread calls after an agent returned that re-wrote the cached context, "
              "never the first call after a compaction; rewrite $ = their cost above a cache read.", "",
              "AGENTS BY TYPE (active min and $ as total/p50/max; capped = turns stopped at the "
              f"output cap, max_tokens; >50k = tool results over {BIG_RESULT_CHARS:,} chars)"]
    lines += _table(
        ["agent", "runs", "active min", "$", "output tok", "tool errors", "capped", ">50k"],
        [[a["agent_type"], _n(a["runs"]),
          f"{_mins(a['active_min_total'])}/{_mins(a['active_min_p50'])}/{_mins(a['active_min_max'])}",
          f"{_usd(a['cost_total'])}/{_usd(a['cost_p50'])}/{_usd(a['cost_max'])}", _n(a["output_tokens"]),
          _n(a["tool_errors"]), _n(a["capped_turns"]), _n(a["big_results"])] for a in profile["agents"]])
    lines += ["", "MAIN-THREAD SKILLS (sticky: a skill owns the main thread until the next Skill call)"]
    lines += _table(
        ["skill", "segments", "$", "model min", "compactions"],
        [[s["skill"], _n(s["segments"]), _usd(s["cost"]), _mins(s["model_min"]), _n(s["compactions"])]
         for s in profile["skills"]])
    lines += ["", "TOOLS (every thread; result chars and latency in seconds as p50/max; a call queued behind "
              "an agent is timed from the agent's return, and a call spanning a pause is not timed)"]
    lines += _table(
        ["tool", "calls", "errors", "result chars total", "result chars", "latency s", ">50k"],
        [[t["tool"], _n(t["calls"]), _n(t["errors"]), _n(t["result_chars_total"]),
          f"{_n(t['result_chars_p50'])}/{_n(t['result_chars_max'])}",
          f"{_mins(t['latency_p50_s'])}/{_mins(t['latency_max_s'])}", _n(t["big_results"])]
         for t in profile["tools"]])
    top = profile["top"]
    lines += ["", "SLOWEST MODEL CALLS"]
    lines += [f"  {m['latency_s']:>5} s  {m['where']}  {m['model']}  out {m['out']:,}  ctx {m['ctx']:,}"
              + (f"  -> {', '.join(m['tools'])}" if m["tools"] else "") for m in top["slowest_model_calls"]]
    lines += ["", "LARGEST RESULTS"]
    lines += [f"  {r['chars']:>9,} chars  {r['where']}  {r['tool']}  {r['args']}" for r in top["largest_results"]]
    lines += ["", "ERROR HEADS (times one thread got the same error from one tool)"]
    lines += [f"  {e['times']:>3}x  {e['tool']}  {e['where']}  {e['head']}" for e in top["error_heads"]]
    lines += ["", "REPEATED IDENTICAL CALLS (same tool and arguments within one thread)"]
    lines += [f"  {r['times']:>3}x  {r['where']}  {r['tool']}  {r['args']}" for r in top["repeated_calls"]]
    lines += ["", "IMAGES TRANSCRIBED MORE THAN ONCE"]
    lines += [f"  {i['times']:>3}x  {i['image']}  {', '.join(i['where'])}"
              for i in top["images_transcribed_more_than_once"]]
    if profile["unpriced_model_calls"]:
        lines += ["", "UNPRICED (no rate in pricing.MODEL_RATES, counted as $0): "
                  + ", ".join(f"{n} call(s) on {m}" for m, n in profile["unpriced_model_calls"].items())]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        prog="feedback_profile",
        description="Profile hosted feedback bundles per session, agent, main-thread skill and tool.")
    parser.add_argument("inputs", nargs="+", metavar="ZIP_OR_DIR",
                        help="a feedback zip, one unpacked bundle, or a folder of unpacked bundles")
    parser.add_argument("--since", metavar="ISO",
                        help="only sessions, agent runs and skill segments that ended at or after this "
                             "ISO date or datetime (UTC unless it names a zone)")
    parser.add_argument("--json", metavar="PATH", help="also write the profile as JSON to PATH")
    args = parser.parse_args(argv)
    since = None
    if args.since is not None:
        since = parse_when(args.since)
        if since is None:
            parser.error(f"--since {args.since!r} is not an ISO date or datetime")
    with ExitStack() as stack:
        try:
            bundles = resolve_inputs(args.inputs, stack)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        corpus = load_bundles(bundles)
        if not corpus["sessions"]:
            print(f"error: no session transcript in {len(bundles)} bundle(s) "
                  "(_feedback/session-log.jsonl or _feedback/sessions/)", file=sys.stderr)
            return 1
        profile = build_profile(corpus, since)
    if not profile["sessions"]:
        print(f"error: all {profile['excluded_sessions']} session(s) ended before --since "
              f"{args.since}", file=sys.stderr)
        return 1
    print(format_report(profile), end="")
    if args.json:
        Path(args.json).expanduser().write_text(json.dumps(profile, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
