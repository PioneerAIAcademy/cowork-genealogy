"""Choosing which committed e2e runs a corpus reader should look at.

Every reader over `eval/runlogs/e2e/*/run-<ts>.json` needs the same two
decisions — which files count as results, and how far back to go — so they
live here rather than being re-derived per report.

**Why a default window at all.** The repo changes fast enough that a run more
than a fortnight old often describes behaviour that has since been fixed, so a
whole-corpus average silently mixes eras and reads as a current measurement.
That has already bitten twice, and both times the fix was applied by hand:

  - #1104 baselined the routing-seam stall on "the 34 committed e2e runlogs
    dated 2026-07-25 -> 07-31" — a hand-rolled 7-day window — and required
    success to be "measured on a comparable run set".
  - #1085 wrote the rule down after #1006 applied a check retroactively and
    produced 445 violations that "may be measuring its own introduction date".

So: default to 14 days, and make every report *say* which window it used and
how many runs that was. `--since all` opts back into the whole corpus.

The default is per-report, not global. `guardrail_shadow_report` passes
`default="all"`: its whole job is a retroactive replay to *choose* a window
size (#911), and `all_result_jsons` exists precisely because that calibration
wants maximum sample size — a freshness cutoff there would silently shrink the
sample it is trying to measure. Freshness is right for `corpus_report` and
`latency_report`, which report on current behaviour.

This is a *query* window, not a retention rule. Nothing here deletes anything:
the e2e corpus is kept in full precisely because it is the corpus that gets
mined (`make e2e-corpus`, `make e2e-guardrail-shadow`, and the open
corpus-mining issues). See GitHub issue #985.
"""

from __future__ import annotations

import argparse
import re
from datetime import date, datetime, timedelta
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_DIR.parents[1]
E2E_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e"

#: Runs newer than this are "current" for corpus-wide analysis.
DEFAULT_SINCE_DAYS = 14

_RUN_DATE_RE = re.compile(r"run-(\d{4}-\d{2}-\d{2})_")


def is_result_json(p: Path) -> bool:
    """True for a committed `run-<ts>.json`, excluding its siblings."""
    n = p.name
    return (
        n.startswith("run-")
        and n.endswith(".json")
        and not n.endswith(".ann.json")
        and ".final-" not in n
    )


def run_date(p: Path) -> date | None:
    """The run's date, parsed from its filename. None if unparseable."""
    m = _RUN_DATE_RE.match(p.name)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").date()
    except ValueError:
        return None


def all_result_jsons() -> list[Path]:
    """EVERY committed run, not just the latest per fixture — calibration
    wants maximum sample size, unlike latency_report's "latest only" (which
    exists to avoid stale per-fixture latency numbers, a different goal)."""
    if not E2E_RUNLOGS.is_dir():
        return []
    out: list[Path] = []
    for d in sorted(E2E_RUNLOGS.iterdir()):
        if d.is_dir():
            out.extend(sorted(p for p in d.iterdir() if is_result_json(p)))
    return out


def result_jsons_for(test_slug: str) -> list[Path]:
    d = E2E_RUNLOGS / test_slug
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if is_result_json(p))


def parse_since(value: str | None) -> date | None:
    """Resolve a `--since` value to a cutoff date. None means no cutoff.

    Accepts `all` (no cutoff), an integer number of days, or `YYYY-MM-DD`.

    Wired in as argparse's `type=`, so a bad value is a usage error at parse
    time — on *every* invocation, not only the code paths that go on to use the
    cutoff. Calling it by hand after `parse_args()` would raise
    `ArgumentTypeError` where nothing catches it, i.e. a traceback.
    """
    if value is None:
        value = str(DEFAULT_SINCE_DAYS)
    v = value.strip().lower()
    if v == "all":
        return None
    if v.isdigit():
        return date.today() - timedelta(days=int(v))
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"--since expects 'all', a number of days, or YYYY-MM-DD; got {value!r}"
        ) from exc


def filter_since(paths: list[Path], cutoff: date | None) -> list[Path]:
    """Keep runs dated on/after `cutoff`. A run whose filename carries no
    parseable date is KEPT — dropping it would silently shrink the sample on
    a naming change, which is the failure mode this module exists to avoid."""
    if cutoff is None:
        return list(paths)
    return [p for p in paths if (d := run_date(p)) is None or d >= cutoff]


def add_since_arg(ap: argparse.ArgumentParser, *, default: str = str(DEFAULT_SINCE_DAYS)) -> None:
    """Add `--since`, already converted to a cutoff date (or None for 'all').

    `default` is a *string*, so argparse runs it through the same converter —
    one code path for supplied and defaulted values alike. Pass `default="all"`
    for a report whose job is a whole-corpus replay.
    """
    ap.add_argument(
        "--since",
        metavar="WINDOW",
        type=parse_since,
        default=default,
        help=(
            f"only runs from the last N days (default: {default}), "
            "or YYYY-MM-DD, or 'all' for the whole corpus"
        ),
    )


def describe_window(cutoff: date | None, *, n_runs: int, n_total: int) -> str:
    """One line naming the window and the sample, for a report's own output.

    Printed by every reader so a number is never read as a whole-corpus
    measurement when it isn't one.
    """
    if cutoff is None:
        return f"Window: entire corpus ({n_runs} run(s))."
    dropped = n_total - n_runs
    return (
        f"Window: runs on/after {cutoff.isoformat()} — {n_runs} of {n_total} run(s), "
        f"{dropped} older run(s) excluded. Pass --since all for the whole corpus."
    )
