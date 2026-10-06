"""`make e2e-report` — one readable `.txt` per e2e run log.

An e2e fixture folder (`eval/runlogs/e2e/<slug>/`) holds every run of one
research case as flat files sharing a `run-<timestamp>` name. The run log is
JSON. This writes the facts a reader wants about one run as plain text, into
`eval/runlogs/e2e/<slug>/reports/<run-stem>.txt`: the verdict and recall, what
it cost and how long it took, the main researcher's spending and busiest
moment, every helper launch, and which expected findings were recovered. The
orchestrator writes one after every run; `make e2e-report` backfills. Only the
newest five runs per fixture keep a report (the run logs themselves are all
kept). Reports are regenerable from the log and gitignored.

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
import re
from pathlib import Path
from typing import Any

from e2e import pricing
from e2e.agent_spend_report import collect
from e2e.result import axes_from_runlog
from e2e.runlog_selection import all_result_jsons

REPORTS_DIRNAME = "reports"
#: Reports kept per fixture — the same depth as the unit side's candidates
#: (`versioning.DEFAULT_KEEP_CANDIDATES`). Run logs themselves are never pruned:
#: grading gates and judge calibration read old runs.
KEEP_REPORTS = 5
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


def run_cost(usage: dict[str, Any]) -> tuple[float | None, str]:
    """`(dollars, basis)` for a run: recorded, else the abort-path estimate,
    else the flat table over the main thread's tokens. Never blended."""
    recorded = usage.get("total_cost_usd")
    if _is_num(recorded):
        return float(recorded), "the SDK's own figure"
    estimated = usage.get("total_cost_usd_estimated")
    if _is_num(estimated):
        return float(estimated), "ESTIMATE — no recorded cost on an aborted run"
    main = pricing.estimate_cost_usd(usage.get("usage"))
    if main is not None:
        return main, "ESTIMATE, main thread only — no recorded cost on an aborted run"
    return None, ""


def _cost_line(usage: dict[str, Any]) -> str:
    value, basis = run_cost(usage)
    return f"{_money(value)}   ({basis})" if value is not None else _NOT_RECORDED


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


_AGENT_ID = re.compile(r"agentId:\s*([0-9a-f]{6,})")
_DURATION_MS = re.compile(r"duration_ms:\s*(\d+)")


def agent_call_durations(log: dict[str, Any]) -> dict[str, float]:
    """`{agentId: seconds}` from each Agent call's own `<usage>` trailer.

    The CLI appends `agentId: <id> … duration_ms: <n>` to every subagent's
    return, and the run log keeps it in `tool_calls[].response_summary` — so a
    run captured before `subagents[].duration_seconds` existed still has each
    helper's time. Joined to a helper by its transcript name
    (`agent-<id>.jsonl`). Not durable: the 14-day capture strip drops
    `response_summary`.
    """
    out: dict[str, float] = {}
    for call in log.get("tool_calls") or []:
        if not isinstance(call, dict) or str(call.get("tool")) not in ("Agent", "Task"):
            continue
        summary = call.get("response_summary")
        if not isinstance(summary, str):
            continue
        ident, ms = _AGENT_ID.search(summary), _DURATION_MS.search(summary)
        if ident and ms:
            out[ident.group(1)] = int(ms.group(1)) / 1000
    return out


def helper_seconds(sub: dict[str, Any], durations: dict[str, float]) -> float | None:
    """A helper's running time: its own transcript span, else the CLI's figure."""
    own = sub.get("duration_seconds")
    if _is_num(own):
        return float(own)
    transcript = sub.get("transcript")
    if isinstance(transcript, str) and transcript.startswith("agent-"):
        return durations.get(transcript[len("agent-"):].removesuffix(".jsonl"))
    return None


def per_type_seconds(log: dict[str, Any]) -> dict[str, list[float]]:
    """Each helper type's recorded running times, for the rollup and comparison."""
    durations = agent_call_durations(log)
    out: dict[str, list[float]] = {}
    for sub in log.get("subagents") or []:
        if isinstance(sub, dict):
            seconds = helper_seconds(sub, durations)
            if seconds is not None:
                out.setdefault(sub.get("agent_type") or "unnamed helper", []).append(seconds)
    return out


def _secs(value: Any) -> str:
    if not _is_num(value):
        return "--"
    return f"{value / 60:.1f} min" if value >= 120 else f"{value:.0f} s"


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

    main_tokens = usage.get("usage") if isinstance(usage.get("usage"), dict) else {}
    windows = usage.get("thread_windows") if isinstance(usage.get("thread_windows"), dict) else {}
    main_window = windows.get("main") if isinstance(windows.get("main"), dict) else {}
    squeezes = _main_squeezes(usage)
    main_cost = pricing.estimate_cost_usd(main_tokens) if main_tokens else None
    out += [
        "",
        "MAIN RESEARCHER",
        f"  tokens           read new {_num(main_tokens.get('input_tokens'))}"
        f" · re-read {_num(main_tokens.get('cache_read_input_tokens'))}"
        f" · cached {_num(main_tokens.get('cache_creation_input_tokens'))}"
        f" · wrote {_num(main_tokens.get('output_tokens'))}",
        f"  cost             {_money(main_cost) if main_cost is not None else _NOT_RECORDED}   (flat Sonnet table)",
        f"  turns            {_num(usage.get('num_turns'))}"
        f"   · tool calls {len(log['tool_calls']) if isinstance(log.get('tool_calls'), list) else _NOT_RECORDED}",
        f"  busiest moment   {_tokens(main_window.get('peak_window_tokens'))}"
        f"   · squeezed {squeezes if squeezes is not None else _NOT_RECORDED}",
    ]

    subs = [s for s in log.get("subagents") or [] if isinstance(s, dict)]
    status = log.get("subagent_capture_status") or "unknown"
    durations = agent_call_durations(log)
    out += ["", "HELPERS (in launch order)"]
    helper_costs: list[float] = []
    helper_times: list[float] = []
    tallest: tuple[int, str] | None = None
    helper_squeezes = 0
    if not subs:
        out.append(f"  none recorded (capture status: {status})")
    else:
        out.append(
            f"  {'#':>3}  {'helper':<26} {'turns':>5} {'cost':>8} {'time':>9}"
            f" {'busiest':>9} {'squeezed':>9}  model / flags"
        )
        for i, sub in enumerate(subs):
            kind = sub.get("agent_type") or "unnamed helper"
            cost = _helper_cost(sub)
            seconds = helper_seconds(sub, durations)
            peak = sub.get("peak_window_tokens")
            compactions = sub.get("compactions")
            squeezed = len(compactions) if isinstance(compactions, list) else None
            flags = [f for f in ("runaway_thinking", "hit_output_cap") if sub.get(f)]
            if cost is not None:
                helper_costs.append(cost)
            if seconds is not None:
                helper_times.append(seconds)
            if isinstance(peak, int) and (tallest is None or peak > tallest[0]):
                tallest = (peak, kind)
            helper_squeezes += squeezed or 0
            out.append(
                f"  {i + 1:>3}  {kind:<26} {_num(sub.get('num_assistant_turns')):>5} "
                f"{_money(cost) if cost is not None else '--':>8} "
                f"{_secs(seconds):>9} "
                f"{_num(peak) if isinstance(peak, int) else '--':>9} "
                f"{squeezed if squeezed is not None else '--':>9}  "
                f"{_models(sub)}{'  ' + ', '.join(flags) if flags else ''}"
            )
        if not helper_costs:
            out.append("  (no helper carries token counts — this run predates per-helper metering)")

    # --- SUMMARY -----------------------------------------------------------
    out += ["", "SUMMARY"]
    value, basis = run_cost(usage)
    out.append(f"  run cost         {_money(value) if value is not None else _NOT_RECORDED}"
               f"{'   (' + basis + ')' if value is not None else ''}")
    out.append(f"  wall clock       {_minutes(usage.get('wall_clock_seconds'))}"
               f"   (slept {_minutes(usage.get('slept_seconds'))}, judge {_minutes(usage.get('judge_seconds'))})")
    whole = usage.get("whole_run_cost_usd_estimated")
    if _is_num(whole) and main_cost is not None and status == "captured" and helper_costs:
        helpers_total = sum(helper_costs)
        out.append(
            f"  who spent it     main {_money(main_cost)} ({100 * main_cost / whole:.0f}%)"
            f" · helpers {_money(helpers_total)} ({100 * helpers_total / whole:.0f}%)"
            f"   of the {_money(whole)} whole-run flat estimate"
        )
    elif status == "matched_no_transcripts" and not subs:
        out.append("  who spent it     main 100% — no helper ran")
    else:
        out.append(f"  who spent it     {_NOT_RECORDED} (helper costs not captured for this run)")
    if helper_times:
        out.append(
            f"  helper time      {_secs(sum(helper_times))} summed over {len(helper_times)} launch(es)"
            "   (helpers can overlap, so this is not a share of wall clock)"
        )
    else:
        out.append(f"  helper time      {_NOT_RECORDED}")
    main_peak = main_window.get("peak_window_tokens")
    candidates = ([(main_peak, "main researcher")] if isinstance(main_peak, int) else []) + (
        [tallest] if tallest else []
    )
    if candidates:
        top = max(candidates)
        out.append(f"  busiest moment   {top[0]:,} tokens ({top[1]})")
    else:
        out.append(f"  busiest moment   {_NOT_RECORDED}")
    out.append(
        f"  squeezes         main {squeezes if squeezes is not None else _NOT_RECORDED}"
        f" · helpers {helper_squeezes if subs else _NOT_RECORDED}"
    )
    if per_agent:
        seconds_by_type = per_type_seconds(log)
        out.append("")
        out.append(f"  {'by helper type':<26} {'launches':>8} {'cost (flat)':>12} {'time':>10}")
        for kind, b in sorted(per_agent.items(), key=lambda kv: -sum(kv[1]["costs"])):
            cost = _money(sum(b["costs"])) if b["costs"] else "--"
            secs = seconds_by_type.get(kind)
            out.append(f"  {kind:<26} {b['spawns']:>8} {cost:>12} {_secs(sum(secs)) if secs else '--':>10}")

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
        if not log_path.name.startswith("run-"):
            # A `scratch_` run is a crash or skip — gitignored, never graded,
            # and outside the newest-five retention. No report.
            continue
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
        keep_newest_reports(log_path.parent)
    return written, skipped, unreadable


def newest_logs(paths: list[Path], keep: int = KEEP_REPORTS) -> list[Path]:
    """The `keep` newest run logs per fixture folder, by name.

    `run-YYYY-MM-DD_HH-MM-SS.json` sorts chronologically as text, and
    `all_result_jsons` admits only that shape (`scratch_` runs are excluded).
    """
    by_dir: dict[Path, list[Path]] = {}
    for p in paths:
        by_dir.setdefault(p.parent, []).append(p)
    return [p for d in sorted(by_dir) for p in sorted(by_dir[d])[-keep:]]


def keep_newest_reports(fixture_dir: Path, keep: int = KEEP_REPORTS) -> list[Path]:
    """Delete all but the `keep` newest `run-<ts>.txt` reports in `reports/`.

    Only `run-` reports count: a `scratch_` name sorts after every `run-` one,
    so counting it would evict real reports in favour of crashed runs.
    """
    reports = fixture_dir / REPORTS_DIRNAME
    if not reports.is_dir():
        return []
    runs = sorted(reports.glob("run-*.txt"))
    removed = runs[:-keep] if keep else runs
    for txt in removed:
        txt.unlink(missing_ok=True)
    return removed


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
    written, skipped, unreadable = write_reports(newest_logs(paths), force=args.force)
    pruned = [
        p
        for d in sorted({p.parent for p in paths})
        for p in prune_orphan_reports(d) + keep_newest_reports(d)
    ]
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
