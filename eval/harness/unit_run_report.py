"""`make unit-report` — one readable `.txt` per unit run log.

A unit run log (`eval/runlogs/unit/<agent>/v1_<timestamp>.json`) already holds
everything a reader wants per test — result, turns, cost by model, seconds — but
as JSON. This writes the same facts as plain text beside it, in
`eval/runlogs/unit/<agent>/reports/<log-stem>.txt`, one file per run log, so a
run can be read without opening the JSON. `run_tests.py` writes one after every
run; `make unit-report` backfills older logs. Reports are regenerable from the
log and gitignored, and a report lives exactly as long as its run log — when
the harness prunes a candidate beyond the newest five, its report goes too.

**One run per file, no comparison.** A report is a fact about one run, so a
later run can never rewrite it. Comparing two runs is separate work.

**Where each number comes from**, so a figure lifted out of a report can be
traced:

- *cost by model* is the run's `model_usage[<model>].costUSD` — the Agent SDK's
  own figure, priced at **that model's** rate (checked 2026-10-06 against
  `check-warnings/v1_2026-10-02_16-46-15.json`: tokens x rate reproduces it for
  both the Sonnet and the Haiku line). A small Haiku line on most tests is the
  CLI's own housekeeping, not the agent under test.
- *agent cost* is the run's `skill_cost_usd`; *judge cost* is
  `judge.judge_cost_usd`. The summary's totals are the log's own `totals`.
- *agent time* is the SDK's `duration_ms`; a test's *wall clock* is `ended_at -
  started_at`, which also covers the judge. Tests run side by side, so the
  summary's *suite wall clock* is the log's own makespan (`totals.wall_clock_ms`),
  never the sum of the per-test clocks.
- *busiest moment* is the tallest single pile a thread read, with its
  compaction count and models: `main_thread` for the parent session (where a
  routed test's skill runs) and `subagents[]` for each helper (on a direct-arm
  test, the agent under test). A log written before that capture existed, or a
  run that aborted before it, says so — it never shows a 0.

Zero API spend — pure formatting over committed run logs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from skill_latency_report import UNIT_RUNLOGS

REPORTS_DIRNAME = "reports"


def is_run_log(path: Path) -> bool:
    """A unit run log file, not an annotation or an in-progress partial."""
    name = path.name
    return (
        path.suffix == ".json"
        and not name.endswith(".ann.json")
        and not name.startswith(".partial_")
    )


def run_logs(skill: str | None = None, root: Path = UNIT_RUNLOGS) -> list[Path]:
    dirs = [root / skill] if skill else sorted(p for p in root.iterdir() if p.is_dir())
    out: list[Path] = []
    for d in dirs:
        if d.is_dir():
            out.extend(sorted(p for p in d.iterdir() if p.is_file() and is_run_log(p)))
    return out


def txt_path_for(log: Path) -> Path:
    return log.parent / REPORTS_DIRNAME / f"{log.stem}.txt"


def _money(value: Any) -> str:
    return f"${value:.4f}" if isinstance(value, (int, float)) and not isinstance(value, bool) else "--"


def _seconds(ms: Any) -> str:
    return f"{ms / 1000:.1f} s" if isinstance(ms, (int, float)) and not isinstance(ms, bool) else "--"


def _num(value: Any) -> str:
    return f"{value:,}" if isinstance(value, int) and not isinstance(value, bool) else "--"


def _wall_ms(run: dict[str, Any]) -> float | None:
    start, end = run.get("started_at"), run.get("ended_at")
    if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end >= start:
        return (end - start) * 1000
    return None


def _meter_text(block: dict[str, Any]) -> str:
    compactions = block.get("compactions")
    squeezed = len(compactions) if isinstance(compactions, list) else "--"
    models = block.get("models")
    model_text = ", ".join(m for m in models if isinstance(m, str)) if isinstance(models, list) else ""
    return (
        f"{_num(block.get('peak_window_tokens'))} tokens"
        f"  (squeezed {squeezed}{', ' + model_text if model_text else ''})"
    )


def _context_lines(run: dict[str, Any]) -> list[str]:
    """Busiest moment for the main thread and for each helper, labelled.

    On a routed test the skill runs on the main thread; on a direct-arm test
    the main thread is only the relay and the agent under test is the helper.
    """
    main = run.get("main_thread")
    subs = run.get("subagents")
    if not isinstance(main, dict) and not isinstance(subs, list):
        if run.get("aborted_reason"):
            return ["  busiest moment   not recorded (the run aborted before the capture)"]
        return ["  busiest moment   not recorded (this log predates the capture)"]
    lines = ["  busiest moment"]
    if isinstance(main, dict):
        lines.append(f"    main thread    {_meter_text(main)}")
    else:
        lines.append("    main thread    not captured")
    if isinstance(subs, list):
        helpers = [s for s in subs if isinstance(s, dict)]
        for sub in helpers:
            name = sub.get("agent_type") or "unnamed helper"
            lines.append(f"    helper         {_meter_text(sub)}  {name}")
        if not helpers:
            status = run.get("subagent_capture_status") or "unknown"
            lines.append(f"    helpers        none captured (capture status: {status})")
    return lines


def _run_lines(run: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if run.get("aborted_reason"):
        lines.append(f"  aborted          {run['aborted_reason']}")
    lines.append(f"  turns            {_num(run.get('num_turns'))}")
    usage = run.get("model_usage")
    if isinstance(usage, dict) and usage:
        for i, (model, entry) in enumerate(usage.items()):
            cost = entry.get("costUSD") if isinstance(entry, dict) else None
            label = "cost by model" if i == 0 else ""
            lines.append(f"  {label:<16} {_money(cost):>9}   {model}")
    lines.append(f"  agent cost       {_money(run.get('skill_cost_usd')):>9}")
    judge = run.get("judge") if isinstance(run.get("judge"), dict) else {}
    lines.append(f"  judge cost       {_money(judge.get('judge_cost_usd')):>9}")
    lines.append(f"  agent time       {_seconds(run.get('duration_ms'))}")
    lines.append(f"  judge time       {_seconds(judge.get('duration_ms'))}")
    lines.append(f"  wall clock       {_seconds(_wall_ms(run))}")
    lines.extend(_context_lines(run))
    return lines


def render(log: dict[str, Any], name: str) -> str:
    tests = [t for t in log.get("tests") or [] if isinstance(t, dict)]
    out = [
        f"{log.get('skill', '?')} — unit run {log.get('timestamp', '?')}",
        f"log: {name} · model: {log.get('model', '?')} · invocation: "
        f"{log.get('invocation', '?')} · {len(tests)} test(s)",
        "",
    ]

    outcomes: dict[str, int] = {}
    by_model: dict[str, float] = {}
    walls: list[float] = []
    peaks: list[tuple[int, str]] = []
    squeezed = measured = 0
    for test in tests:
        outcome = str(test.get("outcome", "?"))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
        out.append(f"{test.get('test_id', '?')}  {outcome}")
        runs = [r for r in test.get("runs") or [] if isinstance(r, dict)]
        for i, run in enumerate(runs):
            if len(runs) > 1:
                out.append(f"  -- run {i + 1} of {len(runs)}: {run.get('outcome', '?')}")
            out.extend(_run_lines(run))
            usage = run.get("model_usage")
            if isinstance(usage, dict):
                for model, entry in usage.items():
                    cost = entry.get("costUSD") if isinstance(entry, dict) else None
                    if isinstance(cost, (int, float)):
                        by_model[model] = by_model.get(model, 0.0) + cost
            wall = _wall_ms(run)
            if wall is not None:
                walls.append(wall)
            blocks = []
            if isinstance(run.get("main_thread"), dict):
                blocks.append(("main thread", run["main_thread"]))
            if isinstance(run.get("subagents"), list):
                blocks.extend(
                    (str(s.get("agent_type") or "unnamed helper"), s)
                    for s in run["subagents"] if isinstance(s, dict)
                )
            for who, block in blocks:
                peak = block.get("peak_window_tokens")
                if isinstance(peak, int) and not isinstance(peak, bool):
                    measured += 1
                    peaks.append((peak, who))
                    if block.get("compactions"):
                        squeezed += 1
        out.append("")

    totals = log.get("totals") if isinstance(log.get("totals"), dict) else {}
    out.append("SUMMARY")
    counts = " · ".join(f"{n} {k}" for k, n in sorted(outcomes.items()))
    out.append(f"  tests            {len(tests)}   ({counts})")
    out.append(f"  agent cost       {_money(totals.get('skill_cost_usd')):>9}")
    out.append(f"  judge cost       {_money(totals.get('judge_cost_usd')):>9}")
    out.append(f"  total cost       {_money(totals.get('total_cost_usd')):>9}")
    for i, (model, cost) in enumerate(sorted(by_model.items(), key=lambda kv: -kv[1])):
        label = "cost by model" if i == 0 else ""
        out.append(f"  {label:<16} {_money(cost):>9}   {model}")
    out.append(f"  turns            {_num(totals.get('num_turns'))}")
    # Tests run side by side, so the suite's elapsed time is the log's own
    # makespan (`totals.wall_clock_ms`), not the sum of the per-test clocks.
    out.append(f"  suite wall clock {_seconds(totals.get('wall_clock_ms'))}   (tests run side by side)")
    if walls:
        out.append(f"  average per test {sum(walls) / len(walls) / 1000:.1f} s   (each test's own wall clock)")
    if peaks:
        top, who = max(peaks)
        out.append(
            f"  busiest moment   {top:,} tokens ({who}) · squeezed {squeezed} of {measured} thread(s) measured"
        )
    else:
        out.append("  busiest moment   not recorded in this log")
    return "\n".join(out) + "\n"


def prune_orphan_reports(skill_dir: Path) -> list[Path]:
    """Delete reports whose run log no longer exists. Returns what was removed.

    A report lives exactly as long as its run log: the harness keeps the newest
    candidates and every released log (`runlog.prune_old_candidates`), so
    mirroring the log's existence applies that same retention here without
    restating it.
    """
    reports = skill_dir / REPORTS_DIRNAME
    if not reports.is_dir():
        return []
    removed = []
    for txt in sorted(reports.glob("*.txt")):
        if not (skill_dir / f"{txt.stem}.json").exists():
            txt.unlink(missing_ok=True)
            removed.append(txt)
    return removed


def write_reports(paths: list[Path], force: bool = False) -> tuple[list[Path], list[Path], list[Path]]:
    """`(written, skipped_existing, unreadable)`."""
    written: list[Path] = []
    skipped: list[Path] = []
    unreadable: list[Path] = []
    for log_path in paths:
        target = txt_path_for(log_path)
        if target.exists() and not force:
            skipped.append(target)
            continue
        try:
            log = json.loads(log_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            unreadable.append(log_path)
            continue
        if not isinstance(log, dict) or not isinstance(log.get("tests"), list):
            unreadable.append(log_path)
            continue
        target.parent.mkdir(exist_ok=True)
        target.write_text(render(log, log_path.name), encoding="utf-8")
        written.append(target)
    return written, skipped, unreadable


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skill", help="one agent/skill folder, else every one")
    parser.add_argument("--force", action="store_true", help="rewrite reports that already exist")
    args = parser.parse_args(argv)

    if args.skill and not (UNIT_RUNLOGS / args.skill).is_dir():
        print(f"No unit run logs folder for {args.skill!r} under {UNIT_RUNLOGS}.")
        return 2
    paths = run_logs(args.skill)
    if not paths:
        print("No unit run logs found — nothing written.")
        return 2
    written, skipped, unreadable = write_reports(paths, force=args.force)
    pruned = [p for d in sorted({p.parent for p in paths}) for p in prune_orphan_reports(d)]
    for p in written:
        print(f"wrote   {p.relative_to(UNIT_RUNLOGS.parent.parent.parent)}")
    print(
        f"{len(written)} written, {len(skipped)} already existed"
        f"{' (FORCE=1 rewrites them)' if skipped else ''}, {len(unreadable)} unreadable."
    )
    for p in unreadable:
        print(f"  unreadable: {p}")
    if pruned:
        print(f"{len(pruned)} report(s) removed whose run log no longer exists.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
