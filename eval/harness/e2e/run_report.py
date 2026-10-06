"""`make e2e-report` — one readable `.txt` per e2e run log.

An e2e fixture folder (`eval/runlogs/e2e/<slug>/`) holds every run of one
research case as flat files sharing a `run-<timestamp>` name. The run log is
JSON. This writes the facts a reader wants about one run as plain text, into
`eval/runlogs/e2e/<slug>/reports/<run-stem>.txt`: the verdict and recall, what
it cost and how long it took, the main researcher's spending and busiest
moment, every helper launch, and which expected findings were recovered. The
orchestrator writes one after every run; `make e2e-report` backfills older
runs. Reports are regenerable from the log and gitignored.

**One run per file, no comparison** — a report is a fact about one run.

**The grade stays hidden until the run is graded.** A genealogist grades each
run blind with `/grade-e2e-run`, and spec §7.4 forbids showing the judge's
verdict anywhere on the path from run to grade — `run_e2e.py` withholds it from
the console for the same reason. So until the run's `.ann.json` exists the
report carries only harness facts (stop reason, compliance, a judge error);
verdict, recall and per-finding results appear once it is graded. `make
e2e-report` re-renders a hidden report when its annotation has appeared.

**Where each number comes from**, so a figure lifted out of a report can be
traced:

- *cost* is `usage.total_cost_usd`, the SDK's own figure; an aborted run has
  none by design (spec §8.1.2), so it falls back to `total_cost_usd_estimated`,
  then to the flat table over the main thread's tokens, each labelled as an
  estimate;
  *whole-run estimate* is `usage.whole_run_cost_usd_estimated`, main thread plus
  every helper on the repo's flat Sonnet table (`e2e/pricing.py`, 1-hour cache
  write). Each helper's *cost* is that same flat table over its own `usage`, so
  a helper on a cheaper model is over-priced here until per-model pricing lands.
- *wall* is `usage.wall_clock_seconds` (active time, sleep excluded).
- the main researcher's *busiest moment* is
  `usage.thread_windows.main.peak_window_tokens`; its *squeezes* count the
  timeline's `system:compact_boundary` rows.
- a helper's *busiest moment* / *squeezes* / *models* are
  `subagents[].peak_window_tokens` / `compactions` / `models`.

A run written before a field existed says "not recorded" — never a 0, which
would read as "free" or "read nothing".

Zero API spend — pure formatting over committed run logs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from e2e import pricing
from e2e.agent_spend_report import collect
from e2e.result import axes_from_runlog
from e2e.runlog_selection import all_result_jsons

REPORTS_DIRNAME = "reports"
GRADE_HIDDEN = "grade hidden until this run is graded"
_NOT_RECORDED = "not recorded"


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _money(value: Any) -> str:
    return f"${value:.2f}" if _is_num(value) else _NOT_RECORDED


def _num(value: Any) -> str:
    return f"{value:,}" if isinstance(value, int) and not isinstance(value, bool) else _NOT_RECORDED


def _tokens(value: Any) -> str:
    return f"{value:,} tokens" if isinstance(value, int) and not isinstance(value, bool) else _NOT_RECORDED


def _minutes(seconds: Any) -> str:
    return f"{seconds / 60:.1f} min" if _is_num(seconds) else _NOT_RECORDED


def _cost_line(usage: dict[str, Any]) -> str:
    recorded = usage.get("total_cost_usd")
    if _is_num(recorded):
        return f"{_money(recorded)}   (the SDK's own figure)"
    estimated = usage.get("total_cost_usd_estimated")
    if _is_num(estimated):
        return f"{_money(estimated)}   (ESTIMATE — no recorded cost on an aborted run)"
    main = pricing.estimate_cost_usd(usage.get("usage"))
    if main is not None:
        return f"{_money(main)}   (ESTIMATE, main thread only — no recorded cost on an aborted run)"
    return _NOT_RECORDED


def _main_squeezes(usage: dict[str, Any]) -> int | None:
    """Compaction boundaries on the main thread's timeline, or None if no timeline."""
    timeline = usage.get("timeline")
    if not isinstance(timeline, list) or not timeline:
        return None
    return sum(
        1 for row in timeline
        if isinstance(row, list) and len(row) > 1 and row[1] == "system:compact_boundary"
    )


def _helper_cost(sub: dict[str, Any]) -> float | None:
    usage = sub.get("usage")
    return pricing.estimate_cost_usd(usage) if isinstance(usage, dict) else None


def _models(block: dict[str, Any]) -> str:
    models = block.get("models")
    if not isinstance(models, list):
        return _NOT_RECORDED
    return ", ".join(m for m in models if isinstance(m, str)) or "none"


def render(
    log: dict[str, Any],
    name: str,
    *,
    graded: bool,
    per_agent: dict[str, dict[str, Any]] | None = None,
) -> str:
    """The report text. `graded` decides whether verdict-bearing fields show;
    `per_agent` is `agent_spend_report.collect([log])`'s rollup for this run."""
    usage = log.get("usage") if isinstance(log.get("usage"), dict) else {}
    judge = log.get("judge_output") if isinstance(log.get("judge_output"), dict) else {}
    verdict, compliance, _outcome = axes_from_runlog(log)
    out = [
        f"{log.get('test_id', '?')} — e2e run {log.get('captured_at', '?')}",
        f"log: {name} · git {str(log.get('git_sha') or '?')[:9]}"
        f" · model {usage.get('agent_model') or _NOT_RECORDED}"
        f" · effort {usage.get('effort_level') or _NOT_RECORDED}",
        "",
        "RESULT",
        f"  stop reason      {log.get('stop_reason', '?')}",
        f"  compliance       {compliance}",
    ]
    if log.get("error"):
        out.append(f"  run error        {log['error']}")
    if judge.get("error"):
        out.append(f"  judge error      {judge['error']}")
    if graded:
        out.append(f"  verdict          {verdict}")
        out.append(
            f"  recall required  {judge.get('recall_required', _NOT_RECORDED)}"
            f"   · recall total {judge.get('recall_total', _NOT_RECORDED)}"
        )
    else:
        out.append(f"  ({GRADE_HIDDEN} — spec §7.4; grade it with /grade-e2e-run)")

    out += [
        "",
        "COST AND TIME",
        f"  cost             {_cost_line(usage)}",
        f"  whole-run est.   {_money(usage.get('whole_run_cost_usd_estimated'))}"
        "   (main + every helper, flat Sonnet table)",
        f"  wall clock       {_minutes(usage.get('wall_clock_seconds'))}"
        f"   (slept {_minutes(usage.get('slept_seconds'))}, judge {_minutes(usage.get('judge_seconds'))})",
        f"  main turns       {_num(usage.get('num_turns'))}"
        f"   · tool calls {len(log['tool_calls']) if isinstance(log.get('tool_calls'), list) else _NOT_RECORDED}",
    ]

    main_tokens = usage.get("usage") if isinstance(usage.get("usage"), dict) else {}
    windows = usage.get("thread_windows") if isinstance(usage.get("thread_windows"), dict) else {}
    main_window = windows.get("main") if isinstance(windows.get("main"), dict) else {}
    squeezes = _main_squeezes(usage)
    out += [
        "",
        "MAIN RESEARCHER",
        f"  tokens           read new {_num(main_tokens.get('input_tokens'))}"
        f" · re-read {_num(main_tokens.get('cache_read_input_tokens'))}"
        f" · cached {_num(main_tokens.get('cache_creation_input_tokens'))}"
        f" · wrote {_num(main_tokens.get('output_tokens'))}",
        f"  busiest moment   {_tokens(main_window.get('peak_window_tokens'))}"
        f"   · squeezed {squeezes if squeezes is not None else _NOT_RECORDED}",
    ]

    subs = log.get("subagents")
    out += ["", "HELPERS"]
    if not isinstance(subs, list) or not subs:
        status = log.get("subagent_capture_status") or "unknown"
        out.append(f"  none recorded (capture status: {status})")
    else:
        out.append(f"  {'#':>3}  {'helper':<26} {'turns':>5} {'cost':>8} {'busiest':>9} {'squeezed':>9}  model / flags")
        for i, sub in enumerate(s for s in subs if isinstance(s, dict)):
            kind = sub.get("agent_type") or "unnamed helper"
            cost = _helper_cost(sub)
            peak = sub.get("peak_window_tokens")
            compactions = sub.get("compactions")
            squeezed = len(compactions) if isinstance(compactions, list) else None
            flags = [f for f in ("runaway_thinking", "hit_output_cap") if sub.get(f)]
            out.append(
                f"  {i + 1:>3}  {kind:<26} {_num(sub.get('num_assistant_turns')):>5} "
                f"{_money(cost) if cost is not None else '--':>8} "
                f"{_num(peak) if isinstance(peak, int) else '--':>9} "
                f"{squeezed if squeezed is not None else '--':>9}  "
                f"{_models(sub)}{'  ' + ', '.join(flags) if flags else ''}"
            )
        if not any(isinstance(s, dict) and isinstance(s.get("usage"), dict) for s in subs):
            out.append("  (no helper carries token counts — this run predates per-helper metering)")
        if per_agent:
            out.append("")
            out.append("  by helper type   launches   cost (flat Sonnet table)")
            for kind, b in sorted(per_agent.items(), key=lambda kv: -sum(kv[1]["costs"])):
                cost = _money(sum(b["costs"])) if b["costs"] else "--"
                out.append(f"  {kind:<26} {b['spawns']:>6}   {cost:>8}")

    if not graded:
        return "\n".join(out) + "\n"
    findings = judge.get("per_finding")
    out += ["", "EXPECTED FINDINGS (the judge's reading)"]
    if isinstance(findings, list) and findings:
        for f in findings:
            if isinstance(f, dict):
                out.append(f"  {str(f.get('finding_id', '?')):<6} matched: {f.get('matched', '?')}")
    else:
        out.append(f"  {_NOT_RECORDED} (the run was not judged)")
    return "\n".join(out) + "\n"


def txt_path_for(log: Path) -> Path:
    return log.parent / REPORTS_DIRNAME / f"{log.stem}.txt"


def _ann_path_for(log: Path) -> Path:
    return log.parent / f"{log.stem}.ann.json"


def _is_hidden(report: Path) -> bool:
    try:
        return GRADE_HIDDEN in report.read_text(encoding="utf-8")
    except OSError:
        return False


def write_reports(paths: list[Path], force: bool = False) -> tuple[list[Path], list[Path], list[Path]]:
    """`(written, skipped_existing, unreadable)`."""
    written: list[Path] = []
    skipped: list[Path] = []
    unreadable: list[Path] = []
    for log_path in paths:
        target = txt_path_for(log_path)
        graded = _ann_path_for(log_path).exists()
        if target.exists() and not force and not (graded and _is_hidden(target)):
            skipped.append(target)
            continue
        try:
            log = json.loads(log_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            unreadable.append(log_path)
            continue
        if not isinstance(log, dict) or "usage" not in log:
            unreadable.append(log_path)
            continue
        per_agent, _counters = collect([log_path])
        target.parent.mkdir(exist_ok=True)
        target.write_text(
            render(log, log_path.name, graded=graded, per_agent=per_agent), encoding="utf-8"
        )
        written.append(target)
    return written, skipped, unreadable


def prune_orphan_reports(fixture_dir: Path) -> list[Path]:
    """Delete reports whose run log no longer exists. Returns what was removed.

    Backfill only (`make e2e-report`): no tooling deletes e2e run logs today, so
    this is housekeeping for a hand-deleted run, not a retention rule.
    """
    reports = fixture_dir / REPORTS_DIRNAME
    if not reports.is_dir():
        return []
    removed = []
    for txt in sorted(reports.glob("*.txt")):
        if not (fixture_dir / f"{txt.stem}.json").exists():
            txt.unlink(missing_ok=True)
            removed.append(txt)
    return removed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--test", help="one fixture slug, else every fixture")
    parser.add_argument("--force", action="store_true", help="rewrite reports that already exist")
    args = parser.parse_args(argv)

    paths = all_result_jsons()
    if args.test:
        paths = [p for p in paths if p.parent.name == args.test]
        if not paths:
            print(f"No committed run logs for fixture {args.test!r}.")
            return 2
    if not paths:
        print("No e2e run logs found — nothing written.")
        return 2
    written, skipped, unreadable = write_reports(paths, force=args.force)
    pruned = [p for d in sorted({p.parent for p in paths}) for p in prune_orphan_reports(d)]
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
