"""Weekly unit-test health report (issue #3733): tests below the 95% pass bar, and
tests that are consistently partial. Reads committed run logs only — no model call.

Each test is judged on its **first** run in each committed log. A fail-retry
happens only after a fail, so counting retries would skew the rate.

A test is below the bar when its first-run fail count `k` out of `n` logs would
happen less than 10% of the time for a test passing 95% of its runs: 2 fails for
5–10 logs, 3 for 11–20. It is consistently partial when at least half its first
runs are `partial`. Fewer than 5 first runs says nothing either way.

Not a gate. The lead runs it weekly and files an issue for each test it lists.

CLI (from eval/harness/):
  uv run python -m eval_health_report [--skill <name>] [--window 20]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from math import comb
from pathlib import Path
from typing import Any

from skill_latency_report import UNIT_RUNLOGS

BAR = 0.95
ALPHA = 0.10
MIN_LOGS = 5
DEFAULT_WINDOW = 20


def fail_threshold(n: int) -> int:
    """The fewest first-run fails in `n` logs that a 95% test produces < 10% of the time."""
    p = 1 - BAR
    for k in range(1, n + 1):
        tail = sum(comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(k, n + 1))
        if tail < ALPHA:
            return k
    return n + 1


@dataclass
class TestHealth:
    skill: str
    test_id: str
    n: int = 0
    fails: int = 0
    partials: int = 0
    newest_fail: str | None = None
    partial_dims: Counter = field(default_factory=Counter)

    def below_bar(self) -> bool:
        return self.n >= MIN_LOGS and self.fails >= fail_threshold(self.n)

    def mostly_partial(self) -> bool:
        return self.n >= MIN_LOGS and 2 * self.partials >= self.n


def load_logs(skill_dir: Path) -> list[dict[str, Any]]:
    """Every committed full-skill log in a suite, oldest first.

    Ordered by the envelope's `timestamp`, since a released `v{N}.json` carries
    none in its filename. A log whose timestamp is already kept is the same run
    committed twice (a released log beside its candidate) and counts once.
    """
    logs: dict[str, dict[str, Any]] = {}
    for p in sorted(skill_dir.glob("v*.json")):
        if p.name.endswith(".ann.json"):
            continue
        try:
            log = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        ts = str(log.get("timestamp") or "")
        if ts and ts not in logs:
            logs[ts] = log
    return [logs[ts] for ts in sorted(logs)]


def analyze(skill: str, logs: list[dict[str, Any]]) -> list[TestHealth]:
    by_id: dict[str, TestHealth] = {}
    for log in logs:
        for t in log.get("tests") or []:
            runs = t.get("runs") or []
            if not runs:
                continue
            first = runs[0]
            outcome = first.get("outcome")
            if outcome not in ("pass", "partial", "fail"):
                continue
            h = by_id.setdefault(t.get("test_id", "?"), TestHealth(skill, t.get("test_id", "?")))
            h.n += 1
            if outcome == "fail":
                h.fails += 1
                h.newest_fail = str(log.get("timestamp") or "")[:10]
            elif outcome == "partial":
                h.partials += 1
                for d in (first.get("judge") or {}).get("dimensions") or []:
                    if d.get("score") == 2:
                        h.partial_dims[d.get("name", "?")] += 1
    return list(by_id.values())


def open_issues(test_id: str) -> str:
    """Open issues whose text names `test_id`, as '#1 #2'. Raises on any gh failure."""
    out = subprocess.run(
        ["gh", "issue", "list", "--state", "open", "--search", f'"{test_id}"',
         "--json", "number", "--jq", ".[].number"],
        cwd=UNIT_RUNLOGS.parents[2], capture_output=True, text=True,
        encoding="utf-8", timeout=30, check=True,
    ).stdout.split()
    return " ".join(f"#{n}" for n in out) or "-"


def render(suites: list[tuple[str, int, list[dict[str, Any]]]], health: list[TestHealth],
           window: int, issues: bool) -> str:
    out = [
        f"Unit test health — first runs in each suite's last {window} committed logs "
        f"(bar {BAR:.0%})",
        "Committed logs read optimistic: rule 6 keeps out every log in which a test "
        "failed its retries. A test left out is not proof of health.",
        "",
    ]
    for skill, total, logs in suites:
        span = (f"{str(logs[0].get('timestamp'))[:10]} .. {str(logs[-1].get('timestamp'))[:10]}"
                if logs else "-")
        out.append(f"  {skill:<28} {len(logs):>2} of {total:>2} logs  {span}")

    lookup = (lambda tid: "")
    if issues:
        try:
            cache: dict[str, str] = {}
            listed = [h for h in health if h.below_bar() or h.mostly_partial()]
            for h in listed:
                cache[h.test_id] = open_issues(h.test_id)
            lookup = (lambda tid: cache.get(tid, ""))
        except (OSError, subprocess.SubprocessError) as e:
            out += ["", f"Open issues: unavailable ({type(e).__name__}); listing without them."]

    below = sorted((h for h in health if h.below_bar()), key=lambda h: -h.fails / h.n)
    out += ["", f"BELOW THE BAR ({len(below)})"]
    for h in below:
        out.append(
            f"  {h.skill:<24} {h.test_id:<34} {h.fails:>2}/{h.n:<2} fail "
            f"(listed at {fail_threshold(h.n)})  newest {h.newest_fail}  {lookup(h.test_id)}"
        )

    partial = sorted((h for h in health if h.mostly_partial()), key=lambda h: -h.partials / h.n)
    out += ["", f"CONSISTENTLY PARTIAL ({len(partial)})"]
    for h in partial:
        dims = ", ".join(f"{name} ({c})" for name, c in h.partial_dims.most_common(2)) or "-"
        out.append(
            f"  {h.skill:<24} {h.test_id:<34} {h.partials:>2}/{h.n:<2} partial  "
            f"scored 2: {dims}  {lookup(h.test_id)}"
        )

    thin = [h for h in health if h.n < MIN_LOGS]
    out += ["", f"Too few first runs to judge (under {MIN_LOGS}): {len(thin)} test(s)."]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--skill", help="one suite; default every suite")
    ap.add_argument("--window", type=int, default=DEFAULT_WINDOW,
                    help=f"newest committed logs per suite (default {DEFAULT_WINDOW})")
    ap.add_argument("--no-issues", action="store_true", help="skip the open-issues lookup")
    ap.add_argument("--runlogs-dir", type=Path, default=UNIT_RUNLOGS, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.window < 1:
        ap.error("--window must be at least 1")

    root: Path = args.runlogs_dir
    if not root.is_dir():
        print(f"No unit run logs at {root}.", file=sys.stderr)
        return 1
    skills = sorted(d.name for d in root.iterdir() if d.is_dir())
    # A suite whose tests were deleted (its skill retired) still has run logs.
    tests_root = root.parent.parent / "tests" / "unit"
    retired = [s for s in skills if tests_root.is_dir() and not (tests_root / s).is_dir()]
    skills = [s for s in skills if s not in retired]
    if args.skill:
        if args.skill not in skills:
            print(f"Unknown or retired suite {args.skill!r}.", file=sys.stderr)
            return 2
        skills = [args.skill]

    suites = []
    health: list[TestHealth] = []
    for skill in skills:
        every = load_logs(root / skill)
        logs = every[-args.window:]
        if not logs:
            continue
        suites.append((skill, len(every), logs))
        health += analyze(skill, logs)

    print(render(suites, health, args.window, issues=not args.no_issues), end="")
    if retired and not args.skill:
        print(f"Retired suites skipped (run logs, no tests): {', '.join(retired)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
