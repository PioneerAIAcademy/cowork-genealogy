#!/usr/bin/env python3
r"""U22: the corpus figures behind the prototype report's measurement 3 and its
corrections 2 and 4 to the architecture review (stdlib only, no network).

Usage: python3 apps/server/dev/review_figures_runlogs.py <root> [checkpoint|external|spill ...]

<root> holds eval/runlogs/e2e/<fixture>/run-<ts>.json. Each recorded figure was
taken at a commit, and the corpus has grown since, so extract that commit's corpus
and pass its root:
    git archive <sha> eval/runlogs/e2e | tar -x -C <dir>
With no section named, all three run.

checkpoint  Measurement 3, recorded at e18d99b10: 51 instrumented runs, 8,898 calls,
            0 over 1,800 s; segments n=947, p99 1,488 s, 4 over 1,800 s.
            Instrumented = every usage.timeline row is [t, kind, names] (three elements).
            A call is an `assistant` row naming a tool, paired FIFO per tool name to
            the next `tool_result` row naming it; its duration is the difference.
            (LIFO pairs the same count and also finds 0 over the ceiling; only the
            individual maxima move.) A segment starts at a `Skill:<name>` or `Agent`
            on an `assistant` row only (each also appears on its `tool_result` row),
            and ends at the next start or, for a run's last, at its last timeline
            event. Percentiles are nearest-rank.
external    Correction 2, at d016032e5: tool calls whose result carries text a third
            party wrote (the EXTERNAL set below), over all calls and over MCP calls.
            The figure first recorded, 5,554, came from a set never written down;
            this set gives 5,234 (ruled 2026-10-10).
spill       Correction 4, at e18d99b10: `Read`s of the CLI's oversized-output spill
            (`.../tool-results/...`, 739) over filesystem operations (FS_OPS, 6,247),
            and the runs that read one (66 of 161). Paths are compared with `\`
            replaced by `/`: a posix-only match drops every Windows run (678).
            Also printed: tool calls of any kind whose JSON-encoded args contain
            `claude-resume` (0 at e18d99b10) — a call count, not a path count.
"""
from __future__ import annotations

import glob
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

CEILING = 1800.0
# Results carrying text a third party wrote: a record's indexed or transcribed
# contents, a scan or its OCR, the community-edited wiki or Family Tree, Wikipedia,
# the web. FamilySearch-curated metadata (catalog, collections, volumes, image
# listings, places, curated external links) and project/ledger tools are not in it.
EXTERNAL = frozenset({
    "record_search", "record_read", "fulltext_search", "rank_search_matches", "sidecar_read",
    "image_transcribe", "image_read",
    "wiki_search", "wiki_read", "wiki_place_page", "wikipedia_search",
    "person_read", "person_search", "person_ancestors",
    "record_person_matches", "person_record_matches", "person_person_matches", "record_record_matches",
    "WebFetch", "WebSearch",
})
FS_OPS = frozenset({"Read", "Grep", "Glob", "Write", "Edit"})
SPILL = "/tool-results/"
SECTIONS = ("checkpoint", "external", "spill")


def load_runs(root):
    paths = [p for p in sorted(glob.glob(os.path.join(root, "eval/runlogs/e2e/*/run-*.json")))
             if re.search(r"run-[0-9_-]+\.json$", p)]
    runs = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            runs.append((os.path.relpath(p, root), json.load(f)))
    return runs


def nearest_rank(vals, p):
    v = sorted(vals)
    return v[max(0, math.ceil(p * len(v)) - 1)] if v else float("nan")


def bare(tool):
    """(name, is_mcp): `mcp__<server>__<name>` under any server spelling, else as is."""
    if tool.startswith("mcp__"):
        return tool.rsplit("__", 1)[-1], True
    return tool, False


def checkpoint(runs):
    calls, segments, unpaired = [], [], 0
    timelines = [(rel, (d.get("usage") or {}).get("timeline") or []) for rel, d in runs]
    instrumented = [(rel, tl) for rel, tl in timelines if tl and all(len(row) == 3 for row in tl)]
    for _rel, tl in instrumented:
        open_ = defaultdict(list)
        starts = []
        for t, kind, names in tl:
            for n in names:
                if kind == "assistant":
                    open_[n].append(t)
                    if n.startswith("Skill:") or n == "Agent":
                        starts.append(t)
                elif kind == "tool_result":
                    if open_[n]:
                        calls.append((t - open_[n].pop(0), n))
                    else:
                        unpaired += 1
        end = tl[-1][0]
        segments += [(starts[i + 1] if i + 1 < len(starts) else end) - s for i, s in enumerate(starts)]
    longest = max(calls) if calls else (0.0, None)
    agent = [c for c in calls if c[1] == "Agent"]
    return {
        "runs": len(runs), "fixtures": len({rel.split(os.sep)[-2] for rel, _ in runs}),
        "instrumented": len(instrumented), "calls": len(calls), "unpaired_results": unpaired,
        "calls_over": sum(1 for c in calls if c[0] > CEILING), "longest_call": longest,
        "longest_delegation": max(agent) if agent else (0.0, None),
        "segments": len(segments),
        "seg_median": nearest_rank(segments, .5), "seg_p95": nearest_rank(segments, .95),
        "seg_p99": nearest_rank(segments, .99), "seg_max": max(segments, default=float("nan")),
        "seg_over": sorted(s for s in segments if s > CEILING),
    }


def external(runs):
    total = mcp = ext = ext_mcp = 0
    per = Counter()
    for _rel, d in runs:
        for c in d.get("tool_calls") or []:
            name, is_mcp = bare(c.get("tool") or "")
            total += 1
            mcp += is_mcp
            # A bare genealogy name with no server prefix never reached the server.
            if name in EXTERNAL and (is_mcp or name in ("WebFetch", "WebSearch")):
                ext += 1
                ext_mcp += is_mcp
                per[name] += 1
    return {"runs": len(runs), "calls": total, "mcp_calls": mcp, "external": ext,
            "external_mcp": ext_mcp, "per_tool": per.most_common()}


def spill(runs):
    ops = reads = spills = posix_only = resume = 0
    runs_with = set()
    for rel, d in runs:
        for c in d.get("tool_calls") or []:
            tool, args = c.get("tool"), c.get("args") or {}
            if "claude-resume" in json.dumps(args):
                resume += 1
            if tool not in FS_OPS:
                continue
            ops += 1
            if tool != "Read":
                continue
            reads += 1
            path = str(args.get("file_path") or "")
            if SPILL in path.replace("\\", "/"):
                spills += 1
                runs_with.add(rel)
            if SPILL in path:
                posix_only += 1
    return {"runs": len(runs), "fs_ops": ops, "reads": reads, "spill_reads": spills,
            "spill_reads_posix_only": posix_only, "runs_with_spill": len(runs_with),
            "claude_resume_calls": resume}


def main(root, sections):
    runs = load_runs(root)
    if not runs:
        sys.exit(f"no run logs at {root}/eval/runlogs/e2e/*/run-<ts>.json; pass the extracted corpus root")
    print(f"run logs read: {len(runs)} (eval/runlogs/e2e/*/run-<ts>.json under {root})")
    if "checkpoint" in sections:
        r = checkpoint(runs)
        print("\n== measurement 3: where to checkpoint ==")
        print(f"{r['runs']} run logs / {r['fixtures']} fixtures; {r['instrumented']} carry the three-element timeline")
        print(f"paired calls {r['calls']:,} (unpaired results {r['unpaired_results']}); over {CEILING:,.0f} s: {r['calls_over']}")
        print(f"longest call {r['longest_call'][0]:,.1f} s ({r['longest_call'][1]}); longest delegation {r['longest_delegation'][0]:,.1f} s")
        print(f"skill/agent segments n={r['segments']} median {r['seg_median']:,.0f} p95 {r['seg_p95']:,.0f} "
              f"p99 {r['seg_p99']:,.0f} max {r['seg_max']:,.0f} s; over {CEILING:,.0f} s: {len(r['seg_over'])} "
              f"({', '.join(f'{s:,.0f}' for s in reversed(r['seg_over']))})")
    if "external" in sections:
        r = external(runs)
        print("\n== correction 2: externally authored content ==")
        print(f"{r['external']:,} of {r['calls']:,} tool calls ({r['external'] / r['calls']:.1%}); "
              f"MCP {r['external_mcp']:,} of {r['mcp_calls']:,} ({r['external_mcp'] / r['mcp_calls']:.1%}); "
              f"{r['external'] / r['runs']:.1f} per run over {r['runs']} runs")
        print("by tool: " + ", ".join(f"{n} {k:,}" for n, k in r["per_tool"]))
    if "spill" in sections:
        r = spill(runs)
        print("\n== correction 4: oversized-output spill reads ==")
        print(f"{r['spill_reads']:,} spill reads of {r['fs_ops']:,} filesystem operations "
              f"({r['spill_reads'] / r['fs_ops']:.1%}; {r['reads']:,} Reads); "
              f"{r['runs_with_spill']} of {r['runs']} runs; posix-only match {r['spill_reads_posix_only']:,}; "
              f"calls whose args mention claude-resume: {r['claude_resume_calls']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    root = args[0] if args else "."
    wanted = args[1:] or list(SECTIONS)
    unknown = [s for s in wanted if s not in SECTIONS]
    if unknown:
        sys.exit(f"unknown section(s) {unknown}; choose from {SECTIONS}")
    main(root, wanted)
