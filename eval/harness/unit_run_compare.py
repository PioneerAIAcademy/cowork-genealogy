"""`make unit-compare` — one unit run against the run before it, printed.

`make unit-report` describes one run. This answers the next question: *did it
get cheaper, faster, or leaner, and what changed to cause it?* By default it
takes a skill's two newest run logs (by the timestamp inside each log, so a
`scratch_` run and a `v1_` candidate sort together); `--before`/`--after` pick
any two.

**Only tests present in both runs are compared**, and the summary totals cover
only those. A one-test scratch run against a thirteen-test suite would
otherwise read as a 92% saving.

**"Changed between them"** is read from the two logs' `snapshot` blocks — the
hash of every file each run depended on (skill or agent body, tests, rubric,
fixtures). A cost move with no changed file is the run-to-run wobble, and the
wobble itself is not measured yet: a change smaller than it is luck.

Zero API spend — pure formatting over run logs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from skill_latency_report import UNIT_RUNLOGS
from unit_run_report import run_logs

SHOW_CHANGED_FILES = 12


def _load(path: Path) -> dict[str, Any] | None:
    try:
        log = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return log if isinstance(log, dict) and isinstance(log.get("tests"), list) else None


def latest_two(paths: list[Path]) -> list[tuple[Path, dict[str, Any]]]:
    """The two newest readable run logs, oldest first, by their own timestamp."""
    loaded = [(p, log) for p in paths if (log := _load(p)) is not None]
    loaded.sort(key=lambda pl: (str(pl[1].get("timestamp") or ""), pl[0].name))
    return loaded[-2:]


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _peak(test: dict[str, Any]) -> int | None:
    """The tallest single read across a test's runs and threads, or None."""
    peaks: list[int] = []
    for run in test.get("runs") or []:
        if not isinstance(run, dict):
            continue
        blocks = [run.get("main_thread")] + list(run.get("subagents") or [])
        for block in blocks:
            if isinstance(block, dict) and isinstance(block.get("peak_window_tokens"), int):
                peaks.append(block["peak_window_tokens"])
    return max(peaks) if peaks else None


def _tests(log: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {t["test_id"]: t for t in log["tests"] if isinstance(t, dict) and "test_id" in t}


def changed_files(before: dict[str, Any], after: dict[str, Any]) -> list[str] | None:
    """Files whose snapshot hash differs, was added or was removed; None if unknown."""
    a, b = before.get("snapshot"), after.get("snapshot")
    if not isinstance(a, dict) or not isinstance(b, dict):
        return None
    out = []
    for key in sorted(set(a) | set(b)):
        if key not in a:
            out.append(f"{key} (new)")
        elif key not in b:
            out.append(f"{key} (gone)")
        elif a[key] != b[key]:
            out.append(key)
    return out


def _pct(before: float, after: float) -> str:
    return f"{100 * (after - before) / before:+.0f}%" if before else "--"


def _arrow(before: Any, after: Any, fmt) -> str:
    left = fmt(before) if _is_num(before) else "--"
    right = fmt(after) if _is_num(after) else "--"
    return f"{left} -> {right}"


def compare(before: dict[str, Any], b_name: str, after: dict[str, Any], a_name: str) -> str:
    skill = after.get("skill") or before.get("skill") or "?"
    out = [
        f"{skill} — {before.get('timestamp', '?')}  vs  {after.get('timestamp', '?')}",
        f"before: {b_name}  ({before.get('model', '?')})",
        f"after:  {a_name}  ({after.get('model', '?')})",
    ]
    changed = changed_files(before, after)
    if changed is None:
        out.append("changed between them: unknown (a log carries no snapshot)")
    elif not changed:
        out.append("changed between them: nothing — any move below is run-to-run wobble")
    else:
        out.append(f"changed between them: {len(changed)} file(s)")
        out.extend(f"  {c}" for c in changed[:SHOW_CHANGED_FILES])
        if len(changed) > SHOW_CHANGED_FILES:
            out.append(f"  … and {len(changed) - SHOW_CHANGED_FILES} more")
    out.append("")

    tb, ta = _tests(before), _tests(after)
    common = [tid for tid in ta if tid in tb]
    out.append(
        f"{'test':<26} {'result':<17} {'cost':<19} {'change':>6}  "
        f"{'turns':<8} {'seconds':<12} busiest moment"
    )
    sum_b = sum_a = 0.0
    dearer = cheaper = 0
    result_changes: list[str] = []
    for tid in common:
        x, y = tb[tid].get("totals") or {}, ta[tid].get("totals") or {}
        cb, ca = x.get("skill_cost_usd"), y.get("skill_cost_usd")
        if _is_num(cb) and _is_num(ca):
            sum_b += cb
            sum_a += ca
            dearer += ca > cb
            cheaper += ca < cb
        ob, oa = tb[tid].get("outcome", "?"), ta[tid].get("outcome", "?")
        if ob != oa:
            result_changes.append(f"{tid}: {ob} -> {oa}")
        out.append(
            f"{tid:<26} {ob + ' -> ' + oa:<17} "
            f"{_arrow(cb, ca, lambda v: f'${v:.3f}'):<19} "
            f"{_pct(cb, ca) if _is_num(cb) and _is_num(ca) else '--':>6}  "
            f"{_arrow(x.get('num_turns'), y.get('num_turns'), str):<8} "
            f"{_arrow(x.get('wall_clock_ms'), y.get('wall_clock_ms'), lambda v: f'{v / 1000:.0f}'):<12} "
            f"{_arrow(_peak(tb[tid]), _peak(ta[tid]), lambda v: f'{v:,}')}"
        )
    only_b = [t for t in tb if t not in ta]
    only_a = [t for t in ta if t not in tb]
    if only_b:
        out.append(f"only in before ({len(only_b)}): {', '.join(only_b)}")
    if only_a:
        out.append(f"only in after ({len(only_a)}): {', '.join(only_a)}")

    out.append("")
    out.append(f"SUMMARY  (the {len(common)} test(s) in both runs only)")
    if common:
        out.append(f"  agent cost       ${sum_b:.3f} -> ${sum_a:.3f}  ({_pct(sum_b, sum_a)})")
        out.append(f"  dearer {dearer} · cheaper {cheaper} · unchanged {len(common) - dearer - cheaper}")
        out.append(
            "  results changed  " + ("; ".join(result_changes) if result_changes else "none")
        )
    else:
        out.append("  no test appears in both runs — nothing to compare")
    out.append("  wobble           not measured yet — a change smaller than it is luck")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skill", help="compare this skill's two newest run logs")
    parser.add_argument("--before", type=Path, help="an explicit earlier run log")
    parser.add_argument("--after", type=Path, help="an explicit later run log")
    args = parser.parse_args(argv)

    if args.before or args.after:
        if not (args.before and args.after):
            print("Give both --before and --after, or neither.")
            return 2
        pair = [(args.before, _load(args.before)), (args.after, _load(args.after))]
        if any(log is None for _, log in pair):
            print("A run log could not be read: " + ", ".join(str(p) for p, log in pair if log is None))
            return 2
    elif args.skill:
        if not (UNIT_RUNLOGS / args.skill).is_dir():
            print(f"No unit run logs folder for {args.skill!r} under {UNIT_RUNLOGS}.")
            return 2
        pair = latest_two(run_logs(args.skill))
        if len(pair) < 2:
            print(f"{args.skill!r} has fewer than two readable run logs — nothing to compare.")
            return 2
    else:
        print("Name a skill (SKILL=<name>) or two logs (BEFORE=... AFTER=...).")
        return 2
    (b_path, before), (a_path, after) = pair
    print(compare(before, b_path.name, after, a_path.name), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
