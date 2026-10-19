#!/usr/bin/env python3
"""Attribute user-visible text in hosted feedback bundles to its source.

Reads every ``feedback-*.zip`` in a directory (default ``~/Downloads``), extracts
only the session logs (no images, uploads or result sidecars), deduplicates by
``sessionId`` keeping the largest log per session, and prints:

- main-thread assistant text by the skill active at the time (the last ``Skill``
  tool call seen on the main thread), with chars per invocation and the share of
  each skill's text that was its turn-final reply rather than mid-turn narration;
- subagent assistant text by ``agentType`` from ``_feedback/subagents/*.meta.json``;
- a split of everything the model generated (text / thinking / tool-call
  arguments) and an estimate of what share of active wall clock that is, at the
  per-token rate the proof-conclusion agent cites.

Numbers in PLAN.md (lay mode) were derived with this script on 2026-09-18.

Usage: python3 apps/server/dev/feedback_text_by_source.py [~/Downloads]
"""
from __future__ import annotations

import collections
import glob
import json
import os
import statistics
import sys
import tempfile
import zipfile
from datetime import datetime

SECONDS_PER_TOKEN = 0.018  # agents/proof-conclusion.md: ~16-20 ms/token
CHARS_PER_TOKEN = 4.0
GAP_CAP_S = 600  # a gap longer than this is human think time, not the run


def extract(zips_dir: str, out_dir: str) -> list[str]:
    """Unzip session logs only; return the bundle directories."""
    bundles = []
    for z in sorted(glob.glob(os.path.join(zips_dir, "feedback-*.zip"))):
        name = os.path.basename(z)[:-4]
        dest = os.path.join(out_dir, name)
        os.makedirs(dest, exist_ok=True)
        with zipfile.ZipFile(z) as zf:
            for member in zf.namelist():
                norm = member.replace("\\", "/")
                if norm.startswith("_feedback/"):
                    zf.extract(member, dest)
        bundles.append(dest)
    return bundles


def read_jsonl(path: str) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def session_id(path: str) -> str | None:
    for row in read_jsonl(path):
        if row.get("sessionId"):
            return row["sessionId"]
    return None


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main() -> None:
    zips_dir = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Downloads")
    work = tempfile.mkdtemp(prefix="feedback-text-")
    bundles = extract(zips_dir, work)

    best: dict[str, tuple[int, str]] = {}
    no_log = collections.Counter()
    for b in bundles:
        log = os.path.join(b, "_feedback", "session-log.jsonl")
        fb_path = os.path.join(b, "_feedback", "feedback.json")
        platform = None
        if os.path.exists(fb_path):
            with open(fb_path, encoding="utf-8") as fh:
                platform = json.load(fh).get("platform")
        if not os.path.exists(log):
            no_log[platform] += 1
            continue
        sid = session_id(log) or b
        size = os.path.getsize(log)
        if sid not in best or size > best[sid][0]:
            best[sid] = (size, b)

    skill_chars = collections.Counter()
    skill_inv = collections.Counter()
    skill_final = collections.Counter()
    agent_chars = collections.Counter()
    agent_runs = collections.Counter()
    gen = collections.Counter()  # text/thinking/tool args, main and sub
    active_s = 0.0
    final_lens: list[int] = []
    turns = 0

    for _sid, (_size, b) in best.items():
        rows = read_jsonl(os.path.join(b, "_feedback", "session-log.jsonl"))
        stamps = [ts(r["timestamp"]) for r in rows if r.get("timestamp")]
        active_s += sum(
            min((stamps[i + 1] - stamps[i]).total_seconds(), GAP_CAP_S)
            for i in range(len(stamps) - 1)
        )
        cur = "(none)"
        turn_blocks: list[tuple[str, str]] = []

        def flush() -> None:
            nonlocal turns
            if not turn_blocks:
                return
            turns += 1
            for i, (skill, text) in enumerate(turn_blocks):
                if i == len(turn_blocks) - 1:
                    skill_final[skill] += len(text)
                    final_lens.append(len(text))
            turn_blocks.clear()

        for r in rows:
            msg = r.get("message") or {}
            if r.get("type") == "user" and isinstance(msg.get("content"), str):
                flush()
            if r.get("type") != "assistant" or r.get("isSidechain"):
                continue
            for blk in msg.get("content") or []:
                if not isinstance(blk, dict):
                    continue
                kind = blk.get("type")
                if kind == "tool_use":
                    gen["main_tool_args"] += len(json.dumps(blk.get("input", {})))
                    if blk.get("name") == "Skill":
                        cur = str((blk.get("input") or {}).get("skill", "?"))
                        cur = cur.replace("genealogy-research:", "")
                        skill_inv[cur] += 1
                elif kind == "text":
                    t = blk.get("text", "")
                    skill_chars[cur] += len(t)
                    gen["main_text"] += len(t)
                    turn_blocks.append((cur, t))
                elif kind == "thinking":
                    gen["main_thinking"] += len(blk.get("thinking", ""))
        flush()

        for meta in glob.glob(os.path.join(b, "_feedback", "subagents", "*.meta.json")):
            with open(meta, encoding="utf-8") as fh:
                agent_type = json.load(fh).get("agentType", "?")
            agent_type = agent_type.replace("genealogy-research:", "")
            agent_runs[agent_type] += 1
            jl = meta.replace(".meta.json", ".jsonl")
            if not os.path.exists(jl):
                continue
            for r in read_jsonl(jl):
                if r.get("type") != "assistant":
                    continue
                for blk in (r.get("message") or {}).get("content") or []:
                    if not isinstance(blk, dict):
                        continue
                    kind = blk.get("type")
                    if kind == "text":
                        n = len(blk.get("text", ""))
                        agent_chars[agent_type] += n
                        gen["sub_text"] += n
                    elif kind == "thinking":
                        gen["sub_thinking"] += len(blk.get("thinking", ""))
                    elif kind == "tool_use":
                        gen["sub_tool_args"] += len(json.dumps(blk.get("input", {})))

    total_main = sum(skill_chars.values())
    total_sub = sum(agent_chars.values())
    print(f"bundles {len(bundles)}; without a session log by platform {dict(no_log)}")
    print(f"unique sessions {len(best)}; user turns {turns}")
    if final_lens:
        p90 = sorted(final_lens)[int(len(final_lens) * 0.9)]
        print(f"final reply chars: median {statistics.median(final_lens):.0f}, p90 {p90}")
    print(f"main-thread text {total_main}; subagent text {total_sub}; "
          f"subagent share {total_sub / max(1, total_main + total_sub):.0%}\n")

    print("SKILL (active on main thread)   chars  share  inv  chars/inv  final%")
    for k, v in skill_chars.most_common():
        print(f"{k:30s} {v:8d} {v / max(1, total_main):5.0%} {skill_inv[k]:4d} "
              f"{v // max(1, skill_inv[k]):8d}  {skill_final[k] / max(1, v):.0%}")

    print("\nAGENT                           chars  runs  chars/run")
    for k, v in agent_chars.most_common():
        print(f"{k:30s} {v:8d} {agent_runs[k]:4d} {v // max(1, agent_runs[k]):8d}")

    text = gen["main_text"] + gen["sub_text"]
    think = gen["main_thinking"] + gen["sub_thinking"]
    args = gen["main_tool_args"] + gen["sub_tool_args"]
    total = max(1, text + think + args)
    secs = lambda chars: chars / CHARS_PER_TOKEN * SECONDS_PER_TOKEN  # noqa: E731
    print(f"\nGENERATED: text {text} ({text / total:.0%})  thinking {think} "
          f"({think / total:.0%})  tool args {args} ({args / total:.0%})")
    if active_s:
        print(f"active wall clock {active_s / 3600:.1f} h; generation at "
              f"{SECONDS_PER_TOKEN * 1000:.0f} ms/token = {secs(total) / active_s:.0%} "
              f"(text {secs(text) / active_s:.0%}, thinking {secs(think) / active_s:.0%}, "
              f"tool args {secs(args) / active_s:.0%})")


if __name__ == "__main__":
    main()
