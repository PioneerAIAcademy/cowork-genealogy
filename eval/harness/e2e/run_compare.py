"""`make e2e-compare` — two runs of one e2e fixture, side by side.

By default the fixture's two newest runs; `--before`/`--after` pick any two.
The comparison is printed and saved as the next numbered file in
`eval/runlogs/e2e/<slug>/comparison/` (`01_comparison.txt`, `02_…`), so the
highest number is always the latest. Only the newest five are kept; the folder
is gitignored.

It compares what the run cost and how it spent it — cost, wall clock, turns,
tool calls, the main researcher's busiest moment and squeezes, and each helper
type's launches, cost, time and busiest moment. **The judge's verdict and
recall appear only when both runs are graded**: a genealogist grades each run
blind (spec §7.4), and a comparison file in the fixture folder would otherwise
hand them the grade.

"plugin skills + agents" compares the runs' `skills_hash` (the staged
`skills/**` and `agents/*.md`), and "run settings that differ" lists the
recorded `usage` settings (model, effort, caps, …) that moved. Neither covers
MCP tool code, the fixture or the harness, so "same" there does not mean
nothing changed.

Zero API spend — pure formatting over run logs.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from e2e.agent_spend_report import collect
from e2e.result import axes_from_runlog
from e2e.run_report import KEEP_REPORTS, per_type_seconds, run_cost
from e2e.runlog_selection import all_result_jsons

COMPARISON_DIRNAME = "comparison"
#: Run settings recorded in `usage` that change what a run does or costs.
_SETTINGS = (
    "agent_model", "subagent_model_override", "effort_level", "max_output_tokens",
    "caps", "betas", "deny_project_reads", "deny_shell", "person_evidence_guard",
    "resume_on_stall", "cli_version",
)
_NUMBERED = re.compile(r"^(\d+)_comparison\.txt$")


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _pct(before: Any, after: Any) -> str:
    if _is_num(before) and _is_num(after) and before:
        change = round(100 * (after - before) / before)
        return f"{change:+d}%" if change else "0%"
    return ""


def _fmt(value: Any, kind: str) -> str:
    if not _is_num(value):
        return "--"
    if kind == "$":
        return f"${value:.2f}"
    if kind == "min":
        return f"{value / 60:.1f} min"
    if kind == "s":
        return f"{value:.0f} s"
    if kind == "f":
        return f"{value:.2f}"
    return f"{value:,}" if isinstance(value, int) else f"{value:,.0f}"


def _row(label: str, before: Any, after: Any, kind: str = "n") -> str:
    return f"  {label:<24} {_fmt(before, kind):>12} -> {_fmt(after, kind):<12} {_pct(before, after):>6}"


def _facts(log: dict[str, Any], path: Path) -> dict[str, Any]:
    usage = log.get("usage") if isinstance(log.get("usage"), dict) else {}
    windows = usage.get("thread_windows") if isinstance(usage.get("thread_windows"), dict) else {}
    main = windows.get("main") if isinstance(windows.get("main"), dict) else {}
    timeline = usage.get("timeline") if isinstance(usage.get("timeline"), list) else None
    per_agent, _ = collect([path])
    seconds = per_type_seconds(log)
    for kind, bucket in per_agent.items():
        bucket["durations"] = seconds.get(kind, [])
    helper_cost = sum(sum(b["costs"]) for b in per_agent.values())
    helper_time = sum(sum(v) for v in seconds.values())
    none_ran = log.get("subagent_capture_status") == "matched_no_transcripts" and not log.get("subagents")
    return {
        "cost": run_cost(usage)[0],
        "wall": usage.get("wall_clock_seconds"),
        "turns": usage.get("num_turns"),
        "tool_calls": len(log["tool_calls"]) if isinstance(log.get("tool_calls"), list) else None,
        "main_peak": main.get("peak_window_tokens"),
        "main_squeezes": (
            sum(1 for r in timeline if isinstance(r, list) and len(r) > 1
                and r[1] == "system:compact_boundary")
            if timeline else None
        ),
        "launches": sum(b["spawns"] for b in per_agent.values()) or (0 if none_ran else None),
        "helper_cost": helper_cost if any(b["costs"] for b in per_agent.values()) else None,
        "helper_time": helper_time if seconds else None,
        "per_agent": per_agent,
        "graded": (path.parent / f"{path.stem}.ann.json").exists(),
    }


def compare(before: dict[str, Any], b_path: Path, after: dict[str, Any], a_path: Path) -> str:
    fb, fa = _facts(before, b_path), _facts(after, a_path)
    ub = before.get("usage") if isinstance(before.get("usage"), dict) else {}
    ua = after.get("usage") if isinstance(after.get("usage"), dict) else {}
    out = [f"{after.get('test_id') or before.get('test_id') or '?'} — run comparison", ""]
    for label, log, u in (("before", before, ub), ("after ", after, ua)):
        out.append(
            f"{label}: {log.get('captured_at', '?')}  · git {str(log.get('git_sha') or '?')[:9]}"
            f" · {u.get('agent_model') or 'model ?'} · effort {u.get('effort_level') or '?'}"
        )
    sb, sa = before.get("skills_hash"), after.get("skills_hash")
    skills = "unknown" if not (sb and sa) else ("same" if sb == sa else "CHANGED")
    out.append(f"plugin skills + agents: {skills}")
    differing = [
        f"{key} {ub.get(key)!r} -> {ua.get(key)!r}"
        for key in _SETTINGS
        if ub.get(key) != ua.get(key)
    ]
    out.append("run settings that differ: " + ("; ".join(differing) if differing else "none"))
    out.append(
        "  (MCP tool code, the fixture and the harness are not covered — same skills is not"
        " the same as nothing changed)"
    )
    out.append("")

    out.append("RESULT")
    out.append(f"  {'stop reason':<24} {str(before.get('stop_reason')):>12} -> {after.get('stop_reason')}")
    out.append(f"  {'compliance':<24} {axes_from_runlog(before)[1]:>12} -> {axes_from_runlog(after)[1]}")
    if fb["graded"] and fa["graded"]:
        jb = before.get("judge_output") if isinstance(before.get("judge_output"), dict) else {}
        ja = after.get("judge_output") if isinstance(after.get("judge_output"), dict) else {}
        out.append(f"  {'verdict':<24} {axes_from_runlog(before)[0]:>12} -> {axes_from_runlog(after)[0]}")
        out.append(_row("recall required", jb.get("recall_required"), ja.get("recall_required"), "f"))
    else:
        out.append("  (grade hidden — both runs must be graded first; spec §7.4)")
    out.append("")

    out.append("COST AND TIME")
    out.append(_row("cost", fb["cost"], fa["cost"], "$"))
    out.append(_row("wall clock", fb["wall"], fa["wall"], "min"))
    out.append(_row("main turns", fb["turns"], fa["turns"]))
    out.append(_row("tool calls", fb["tool_calls"], fa["tool_calls"]))
    out.append(_row("main busiest moment", fb["main_peak"], fa["main_peak"]))
    out.append(_row("main squeezes", fb["main_squeezes"], fa["main_squeezes"]))
    out.append(_row("helper launches", fb["launches"], fa["launches"]))
    out.append(_row("helper cost (flat)", fb["helper_cost"], fa["helper_cost"], "$"))
    out.append(_row("helper time (summed)", fb["helper_time"], fa["helper_time"], "min"))
    out.append("")

    out.append("BY HELPER TYPE")
    out.append(f"  {'helper':<24} {'launches':>9}   {'cost (flat)':>17}   {'time':>17}   {'busiest':>19}")
    kinds = sorted(set(fb["per_agent"]) | set(fa["per_agent"]))
    if not kinds:
        out.append("  no helper data in either run")
    for kind in kinds:
        b, a = fb["per_agent"].get(kind), fa["per_agent"].get(kind)

        def _v(bucket, key, agg):
            return agg(bucket[key]) if bucket and bucket[key] else None

        out.append(
            f"  {kind:<24} {(b or {}).get('spawns', 0):>4} -> {(a or {}).get('spawns', 0):<2}"
            f"   {_fmt(_v(b, 'costs', sum), '$'):>7} -> {_fmt(_v(a, 'costs', sum), '$'):<7}"
            f"   {_fmt(_v(b, 'durations', sum), 's'):>7} -> {_fmt(_v(a, 'durations', sum), 's'):<7}"
            f"   {_fmt(_v(b, 'peaks', max), 'n'):>8} -> {_fmt(_v(a, 'peaks', max), 'n'):<8}"
        )
    out.append("")
    out.append("  -- means not recorded in that run (older runs predate the field).")
    return "\n".join(out) + "\n"


def next_comparison_path(fixture_dir: Path) -> Path:
    folder = fixture_dir / COMPARISON_DIRNAME
    numbers = [int(m.group(1)) for p in folder.glob("*_comparison.txt") if (m := _NUMBERED.match(p.name))]
    return folder / f"{(max(numbers) + 1 if numbers else 1):02d}_comparison.txt"


def keep_newest_comparisons(fixture_dir: Path, keep: int = KEEP_REPORTS) -> list[Path]:
    folder = fixture_dir / COMPARISON_DIRNAME
    numbered = sorted(
        (int(m.group(1)), p) for p in folder.glob("*_comparison.txt") if (m := _NUMBERED.match(p.name))
    )
    removed = [p for _, p in numbered[:-keep]] if keep else [p for _, p in numbered]
    for p in removed:
        p.unlink(missing_ok=True)
    return removed


def _load(path: Path) -> dict[str, Any] | None:
    try:
        log = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return log if isinstance(log, dict) and "usage" in log else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--test", help="fixture slug: compare its two newest runs")
    parser.add_argument("--before", type=Path, help="an explicit earlier run log")
    parser.add_argument("--after", type=Path, help="an explicit later run log")
    args = parser.parse_args(argv)

    if args.before or args.after:
        if not (args.before and args.after):
            print("Give both BEFORE= and AFTER=, or neither.")
            return 2
        pair = [args.before, args.after]
    elif args.test:
        runs = sorted(p for p in all_result_jsons() if p.parent.name == args.test)
        if len(runs) < 2:
            print(f"{args.test!r} has {len(runs)} run(s) — a comparison needs two.")
            return 2
        pair = runs[-2:]
    else:
        print("Name a fixture (TEST=<slug>) or two runs (BEFORE=... AFTER=...).")
        return 2
    logs = [_load(p) for p in pair]
    if any(log is None for log in logs):
        print("A run log could not be read: " + ", ".join(str(p) for p, l in zip(pair, logs) if l is None))
        return 2
    text = compare(logs[0], pair[0], logs[1], pair[1])
    target = next_comparison_path(pair[1].parent)
    target.parent.mkdir(exist_ok=True)
    target.write_text(text, encoding="utf-8")
    keep_newest_comparisons(pair[1].parent)
    print(text, end="")
    print(f"\nsaved: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
