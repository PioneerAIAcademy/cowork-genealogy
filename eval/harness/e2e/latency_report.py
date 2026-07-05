"""Latency-breakdown analyzer for e2e runs — the Phase 0 measurement tool.

The e2e roadmap's Phase 0 asks one question before any behaviour tuning is
sized: **of a run's wall-clock, how much is the model generating (thinking +
text + tool-use decisions — i.e. time inside the Anthropic API) versus tools
executing versus local orchestration?** The answer decides which levers matter
(fewer turns / less output per turn vs. faster tools).

The raw material is already captured by the orchestrator and persisted into the
committed result JSON (see e2e/result.py):

  - ``usage.duration_ms``      — the SDK's own total wall-clock for the agent loop
  - ``usage.duration_api_ms``  — cumulative time awaiting the model API
  - ``usage.num_turns``        — assistant turns
  - ``usage.usage.output_tokens`` (and input / cache counters)
  - ``usage.timeline``         — ``[[elapsed_s, kind], ...]`` per SDK message,
                                 kind ∈ {assistant, tool_result, system:*, result}
                                 (added after 2026-06; older runs lack it)

This module is pure analysis on top of that — it adds **no** instrumentation to
a run. ``analyze_result`` is a pure function (unit-tested without a live run);
the CLI locates committed runs and prints a per-run block + a comparison table.

CLI (from eval/harness/):
  uv run python -m e2e.latency_report --test kenneth-quass-death
  uv run python -m e2e.latency_report --all
  uv run python -m e2e.latency_report --all --markdown > table.md
  uv run python -m e2e.latency_report path/to/run-<ts>.json [more.json ...]

Two independent decompositions are reported so they corroborate:
  1. usage-based  — duration_api_ms / duration_ms  (SDK-internal, always present)
  2. timeline-based — sum of inter-message gaps bucketed by the *later* message's
     kind (assistant → model time, tool_result → tool time, system:* → overhead)
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
E2E_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e"


def _bare_tool_name(tool: str) -> str:
    """`mcp__genealogy__record_search` -> `record_search`; passthrough otherwise."""
    return tool.split("__")[-1] if tool else tool


@dataclass
class LatencyBreakdown:
    """Decision-grade latency summary for one e2e run."""

    test_id: str
    verdict: str
    stop_reason: str
    source_file: str | None = None

    # Totals (seconds). wall_clock_s prefers the harness monotonic clock
    # (excludes system sleep); duration_s is the SDK's own total. They differ
    # only by orchestration overhead outside the SDK loop.
    wall_clock_s: float = 0.0
    duration_s: float = 0.0
    api_s: float = 0.0

    # The headline: fraction of the SDK's own total spent awaiting the model.
    # Uses duration_api_ms / duration_ms — both SDK-internal, so internally
    # consistent regardless of harness-side overhead.
    api_pct: float | None = None

    num_turns: int | None = None
    n_tool_calls: int = 0

    # Token counters (from usage.usage).
    output_tokens: int | None = None
    input_tokens: int | None = None
    cache_read_input_tokens: int | None = None
    cache_creation_input_tokens: int | None = None
    output_tokens_per_turn: float | None = None

    total_cost_usd: float | None = None

    # Bare-tool-name -> count, most-common first (as a list of pairs so it is
    # JSON/round-trip friendly).
    tool_counts: list[tuple[str, int]] = field(default_factory=list)

    # Timeline-derived decomposition (None when the run predates the timeline).
    #
    # Only `tool_result`-terminated gaps are reliably tool-execution time. The
    # rest ("non-tool") is model generation PLUS any stall/resume idle — the two
    # are indistinguishable inside a single session, so we do not split them
    # here (an earlier 3-bucket model/overhead split mis-scored interim
    # `system:status` messages emitted mid-generation as "overhead"). What is
    # robust and decision-relevant is: tool time is tiny; everything else is not
    # reclaimable by faster/batched tools.
    timeline_present: bool = False
    timeline_span_s: float | None = None
    tool_time_s: float | None = None
    non_tool_time_s: float | None = None
    tool_time_pct: float | None = None
    # Wall-clock outside the timeline span (stalls/resumes/judge/setup). Large
    # only for runs that stalled + resumed; idle, not model or tool work.
    stall_s: float | None = None
    # Slowest single generation gaps (gaps ending at an assistant message):
    # [(elapsed_s_at_end, gap_s), ...], longest first — the longest single
    # model deliberations.
    slowest_gen_gaps: list[tuple[float, float]] = field(default_factory=list)


def _timeline_decomposition(timeline: list[list[Any]]) -> dict[str, Any]:
    """Split inter-message wall-clock gaps into tool-execution vs everything-else.

    A gap ending at a ``tool_result`` message is a tool executing between the
    preceding tool-use and its result — the one bucket the timeline measures
    cleanly. Every other gap (ending at ``assistant`` or ``system:*``) is the
    model generating or, on a stalled run, idle resume time; those are not
    separable from a single session's timeline and are lumped as "non-tool".
    Gaps ending at an ``assistant`` message are additionally surfaced as the
    longest single model deliberations.
    """
    tool = non_tool = 0.0
    gen_gaps: list[tuple[float, float]] = []
    prev_t: float | None = None
    first_t: float | None = None
    last_t: float | None = None
    for entry in timeline:
        # entry is [elapsed_seconds, kind]
        t = float(entry[0])
        kind = str(entry[1])
        if first_t is None:
            first_t = t
        last_t = t
        if prev_t is not None:
            gap = t - prev_t
            if gap < 0:
                gap = 0.0
            if kind == "tool_result":
                tool += gap
            else:
                non_tool += gap
                if kind == "assistant":
                    gen_gaps.append((round(t, 1), round(gap, 1)))
        prev_t = t
    span = (last_t - first_t) if (first_t is not None and last_t is not None) else 0.0
    total = tool + non_tool
    gen_gaps.sort(key=lambda p: p[1], reverse=True)
    return {
        "timeline_span_s": round(span, 1),
        "tool_time_s": round(tool, 1),
        "non_tool_time_s": round(non_tool, 1),
        "tool_time_pct": (tool / total) if total > 0 else None,
        "slowest_gen_gaps": gen_gaps[:5],
    }


def analyze_result(result: dict[str, Any], source_file: str | None = None) -> LatencyBreakdown:
    """Derive a LatencyBreakdown from a parsed e2e result dict (pure)."""
    usage = result.get("usage") or {}
    inner = usage.get("usage") if isinstance(usage.get("usage"), dict) else {}

    duration_ms = usage.get("duration_ms")
    duration_api_ms = usage.get("duration_api_ms")
    duration_s = (duration_ms / 1000.0) if duration_ms else 0.0
    api_s = (duration_api_ms / 1000.0) if duration_api_ms else 0.0
    wall_clock_s = usage.get("wall_clock_seconds") or duration_s
    api_pct = (
        (duration_api_ms / duration_ms)
        if (duration_api_ms and duration_ms)
        else None
    )

    num_turns = usage.get("num_turns")
    output_tokens = inner.get("output_tokens")
    out_per_turn = (
        (output_tokens / num_turns) if (output_tokens and num_turns) else None
    )

    tool_calls = result.get("tool_calls") or []
    counts = Counter(_bare_tool_name(c.get("tool", "")) for c in tool_calls)

    bd = LatencyBreakdown(
        test_id=result.get("test_id", "?"),
        verdict=result.get("verdict", "?"),
        stop_reason=result.get("stop_reason", "?"),
        source_file=source_file,
        wall_clock_s=round(float(wall_clock_s), 1),
        duration_s=round(duration_s, 1),
        api_s=round(api_s, 1),
        api_pct=api_pct,
        num_turns=num_turns,
        n_tool_calls=len(tool_calls),
        output_tokens=output_tokens,
        input_tokens=inner.get("input_tokens"),
        cache_read_input_tokens=inner.get("cache_read_input_tokens"),
        cache_creation_input_tokens=inner.get("cache_creation_input_tokens"),
        output_tokens_per_turn=(round(out_per_turn, 1) if out_per_turn else None),
        total_cost_usd=usage.get("total_cost_usd"),
        tool_counts=counts.most_common(),
    )

    timeline = usage.get("timeline")
    if isinstance(timeline, list) and timeline:
        bd.timeline_present = True
        d = _timeline_decomposition(timeline)
        bd.timeline_span_s = d["timeline_span_s"]
        bd.tool_time_s = d["tool_time_s"]
        bd.non_tool_time_s = d["non_tool_time_s"]
        bd.tool_time_pct = d["tool_time_pct"]
        bd.slowest_gen_gaps = d["slowest_gen_gaps"]
        # Wall-clock beyond the timeline span is stall/resume/judge idle.
        if bd.timeline_span_s is not None:
            bd.stall_s = round(max(0.0, bd.wall_clock_s - bd.timeline_span_s), 1)

    return bd


# --- Presentation -----------------------------------------------------------

def _fmt_pct(x: float | None) -> str:
    return f"{x * 100:.1f}%" if x is not None else "n/a"


def _fmt_min(seconds: float | None) -> str:
    return f"{seconds / 60:.1f}m" if seconds else "n/a"


def format_breakdown(bd: LatencyBreakdown) -> str:
    """A per-run human block."""
    lines = [
        f"=== {bd.test_id}  ({bd.verdict} / {bd.stop_reason}) ===",
        f"  wall-clock:      {_fmt_min(bd.wall_clock_s)}  ({bd.wall_clock_s:.0f}s)",
        f"  model API time:  {_fmt_min(bd.api_s)}  = {_fmt_pct(bd.api_pct)} of active SDK loop",
        f"  turns:           {bd.num_turns}     tool calls: {bd.n_tool_calls}",
        f"  output tokens:   {bd.output_tokens}   ({bd.output_tokens_per_turn}/turn)"
        if bd.output_tokens
        else "  output tokens:   n/a",
        f"  cache read:      {bd.cache_read_input_tokens}   cost: ${bd.total_cost_usd}",
    ]
    if bd.timeline_present:
        # tool execution is the only reclaimable-by-tooling bucket; everything
        # else is model generation (+ any stall idle).
        lines.append(
            f"  tool execution:  {_fmt_min(bd.tool_time_s)} "
            f"({_fmt_pct(bd.tool_time_pct)} of timeline)  <- reclaimable ceiling for faster/batched tools"
        )
        lines.append(
            f"  non-tool time:   {_fmt_min(bd.non_tool_time_s)}  (model generation across turns)"
        )
        if bd.stall_s and bd.stall_s > 60:
            lines.append(
                f"  stall/idle:      {_fmt_min(bd.stall_s)}  (outside timeline span — stall/resume/judge, not model or tool)"
            )
        if bd.slowest_gen_gaps:
            gaps = ", ".join(f"{g:.0f}s@{t:.0f}s" for t, g in bd.slowest_gen_gaps)
            lines.append(f"  slowest gen gaps: {gaps}")
    top = ", ".join(f"{n}:{k}" for n, k in bd.tool_counts[:8])
    lines.append(f"  top tools:       {top}")
    return "\n".join(lines)


def format_markdown_table(bds: list[LatencyBreakdown]) -> str:
    """A comparison table across runs (Markdown)."""
    header = (
        "| fixture | verdict | wall | model-API % | turns | out tok | tok/turn | cost |\n"
        "|---|---|---|---|---|---|---|---|"
    )
    rows = []
    for bd in bds:
        rows.append(
            f"| {bd.test_id} | {bd.verdict} | {_fmt_min(bd.wall_clock_s)} | "
            f"{_fmt_pct(bd.api_pct)} | {bd.num_turns} | {bd.output_tokens} | "
            f"{bd.output_tokens_per_turn} | ${bd.total_cost_usd:.2f} |"
            if bd.total_cost_usd is not None
            else f"| {bd.test_id} | {bd.verdict} | {_fmt_min(bd.wall_clock_s)} | "
            f"{_fmt_pct(bd.api_pct)} | {bd.num_turns} | {bd.output_tokens} | "
            f"{bd.output_tokens_per_turn} | n/a |"
        )
    return "\n".join([header, *rows])


# --- Run discovery + CLI ----------------------------------------------------

def _is_result_json(p: Path) -> bool:
    """A committed structured result, not its tree/research/ann siblings."""
    name = p.name
    return (
        name.startswith("run-")
        and name.endswith(".json")
        and not name.endswith(".ann.json")
        and ".final-" not in name
    )


def latest_run_for(test_slug: str) -> Path | None:
    d = E2E_RUNLOGS / test_slug
    if not d.is_dir():
        return None
    runs = sorted(p for p in d.iterdir() if _is_result_json(p))
    return runs[-1] if runs else None


def all_latest_runs() -> list[Path]:
    if not E2E_RUNLOGS.is_dir():
        return []
    out = []
    for d in sorted(E2E_RUNLOGS.iterdir()):
        if d.is_dir():
            r = latest_run_for(d.name)
            if r:
                out.append(r)
    return out


def _load(path: Path) -> LatencyBreakdown:
    data = json.loads(path.read_text(encoding="utf-8"))
    return analyze_result(data, source_file=str(path))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="e2e latency breakdown (Phase 0).")
    ap.add_argument("files", nargs="*", help="explicit result JSON paths")
    ap.add_argument("--test", help="latest committed run for this fixture slug")
    ap.add_argument("--all", action="store_true", help="latest run per fixture")
    ap.add_argument("--markdown", action="store_true", help="emit a Markdown table")
    args = ap.parse_args(argv)

    paths: list[Path] = [Path(f) for f in args.files]
    if args.test:
        r = latest_run_for(args.test)
        if not r:
            print(f"No committed run found for '{args.test}'.", file=sys.stderr)
            return 1
        paths.append(r)
    if args.all:
        paths.extend(all_latest_runs())
    if not paths:
        print("Nothing to analyze. Pass files, --test <slug>, or --all.", file=sys.stderr)
        return 1

    bds = [_load(p) for p in paths]

    if args.markdown:
        print(format_markdown_table(bds))
    else:
        for bd in bds:
            print(format_breakdown(bd))
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
