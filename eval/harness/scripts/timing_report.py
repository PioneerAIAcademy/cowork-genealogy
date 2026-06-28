#!/usr/bin/env python3
"""Weekly timing review: scan the latest run log per skill and surface where
the eval suite spends its time.

Read-only. Reads the timing instrumentation persisted by the harness
(`duration_ms`, `duration_api_ms`, `num_turns`, `judge.duration_ms`,
`skill_attempts`, and the envelope `wall_clock_ms`) and reports:

  - a per-skill table (makespan vs summed skill work, API%, cost),
  - the slowest tests across all skills, flagged by *why* they are slow,
  - a totals line.

Flags:
  LONG    duration >= --long-seconds (default 300) — a makespan long pole.
  RETRY   skill_attempts > 1 — transient stall/error retries (the stall tax).
  LOCAL?  API% < 90 — wall-clock not explained by model time (local/stall
          overhead); investigate the harness, not the skill.

"Latest" per skill = the envelope with the most recent `timestamp` field
(scratch_/candidate/released all considered). Pre-instrumentation run logs
lack the timing fields; those columns show as `-` rather than failing.

Usage:
    uv run python -m scripts.timing_report [--runlogs-root DIR] [--top N]
                                           [--long-seconds S]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _latest_envelope_per_skill(unit_dir: Path) -> dict[str, dict]:
    """Map skill -> the parsed envelope with the newest `timestamp`."""
    latest: dict[str, tuple[str, dict]] = {}
    if not unit_dir.exists():
        return {}
    for jf in sorted(unit_dir.glob("*/*.json")):
        if jf.name.endswith(".ann.json"):
            continue
        try:
            env = json.loads(jf.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        skill = env.get("skill")
        ts = env.get("timestamp", "")
        if not skill:
            continue
        if skill not in latest or ts > latest[skill][0]:
            latest[skill] = (ts, env)
    return {s: env for s, (ts, env) in latest.items()}


def _num(d: dict, key: str):
    v = d.get(key)
    return v if isinstance(v, (int, float)) else None


def _collect_rows(envelopes: dict[str, dict]) -> list[dict]:
    rows: list[dict] = []
    for skill, env in envelopes.items():
        for t in env.get("tests", []):
            for r in t.get("runs", []):
                dur = _num(r, "duration_ms")
                api = _num(r, "duration_api_ms")
                rows.append(
                    {
                        "skill": skill,
                        "test_id": t.get("test_id", "?"),
                        "outcome": t.get("outcome", "?"),
                        "dur_s": (dur / 1000.0) if dur is not None else None,
                        # api==0 means no ResultMessage (aborted or routing
                        # short-circuit), i.e. no API timing — report as "no
                        # data" (None), not a misleading 0% / LOCAL? flag.
                        "api_pct": (api / dur * 100.0) if (dur and api) else None,
                        "turns": _num(r, "num_turns"),
                        "attempts": r.get("skill_attempts", 1),
                        "judge_s": (_num(r.get("judge", {}), "duration_ms") or 0) / 1000.0,
                    }
                )
    return rows


def _fmt(v, spec: str, dash: str = "-") -> str:
    return format(v, spec) if isinstance(v, (int, float)) else dash


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runlogs-root", type=Path, default=REPO_ROOT / "eval" / "runlogs")
    ap.add_argument("--top", type=int, default=20, help="How many slowest tests to list.")
    ap.add_argument("--long-seconds", type=float, default=300.0,
                    help="Flag tests at/above this duration as LONG.")
    args = ap.parse_args(argv)

    unit_dir = args.runlogs_root / "unit"
    envelopes = _latest_envelope_per_skill(unit_dir)
    if not envelopes:
        print(f"No run logs found under {unit_dir}", file=sys.stderr)
        return 1

    rows = _collect_rows(envelopes)

    # --- Per-skill table -------------------------------------------------
    print("Per-skill (latest run log):")
    print(f"  {'skill':24} {'tests':>5} {'makespan':>9} {'skillwork':>10} "
          f"{'API%':>5} {'retries':>7} {'cost$':>7}")
    print("  " + "-" * 74)
    tot_work = tot_cost = 0.0
    tot_tests = tot_retries = 0
    for skill in sorted(envelopes):
        tot = envelopes[skill].get("totals", {})
        skrows = [r for r in rows if r["skill"] == skill]
        work = sum(r["dur_s"] or 0 for r in skrows)
        makespan = (_num(tot, "wall_clock_ms") or 0) / 1000.0
        api = _num(tot, "duration_api_ms")
        api_pct = (api / (work * 1000) * 100.0) if (api and work) else None
        retries = sum(max(0, (r["attempts"] or 1) - 1) for r in skrows)
        cost = _num(tot, "total_cost_usd") or 0.0
        tot_work += work; tot_cost += cost; tot_tests += len(skrows); tot_retries += retries
        print(f"  {skill:24} {len(skrows):5} {_fmt(makespan,'9.0f')}s "
              f"{_fmt(work,'9.0f')}s {_fmt(api_pct,'5.0f')} {retries:7} "
              f"{cost:7.2f}")
    print("  " + "-" * 74)
    print(f"  {'TOTAL':24} {tot_tests:5} {'':>9} {tot_work:9.0f}s "
          f"{'':>5} {tot_retries:7} {tot_cost:7.2f}")

    # --- Slowest tests, with the reason -----------------------------------
    timed = [r for r in rows if r["dur_s"] is not None]
    timed.sort(key=lambda r: r["dur_s"], reverse=True)
    print(f"\nSlowest {min(args.top, len(timed))} tests "
          f"(of {len(timed)} timed):")
    print(f"  {'dur_s':>6} {'turns':>5} {'API%':>5} {'try':>3} {'judge_s':>7}  "
          f"{'flags':<14} outcome  skill/test")
    for r in timed[: args.top]:
        flags = []
        if r["dur_s"] >= args.long_seconds:
            flags.append("LONG")
        if (r["attempts"] or 1) > 1:
            flags.append("RETRY")
        if r["api_pct"] is not None and r["api_pct"] < 90:
            flags.append("LOCAL?")
        print(f"  {r['dur_s']:6.0f} {_fmt(r['turns'],'5'):>5} "
              f"{_fmt(r['api_pct'],'5.0f'):>5} {r['attempts']:3} "
              f"{r['judge_s']:7.1f}  {','.join(flags):<14} "
              f"{r['outcome']:8} {r['skill']}/{r['test_id']}")

    no_timing = [r for r in rows if r["dur_s"] is None]
    if no_timing:
        skills = sorted({r["skill"] for r in no_timing})
        print(f"\nNote: {len(no_timing)} run(s) lack timing fields "
              f"(pre-instrumentation run logs): {', '.join(skills)}. "
              f"Re-run those skills to populate them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
