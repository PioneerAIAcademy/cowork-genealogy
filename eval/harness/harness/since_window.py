"""The freshness window every run-log reader shares.

A run log more than a fortnight old usually describes behaviour that has since
been fixed, so a report that averages over the whole corpus silently mixes eras
and reads as a current measurement. Every reader therefore windows to
`DEFAULT_SINCE_DAYS` by default and *says* which window it used; `--since all`
opts back in deliberately.

This applies to **both** corpora — `eval/runlogs/e2e/run-<ts>.json` and
`eval/runlogs/unit/<skill>/v{N}_<ts>.json` — which is why the window primitives
live here rather than beside either one's discovery helpers.

**Not** a retention rule. Nothing here deletes anything, and retention is keyed
on *rank* (keep the newest K per skill, `harness/versioning.py`) precisely
because an age-based *deletion* would drop the only run log for a skill nobody
touched that month and break `check_runlogs` rule 2 on the next edit. Ageing a
run out of a *query* is safe; ageing it out of the *corpus* is not. See GitHub
issue #985.
"""

from __future__ import annotations

import argparse
import re
from datetime import date, datetime, timedelta
from pathlib import Path

#: Runs newer than this are "current" for reporting purposes.
DEFAULT_SINCE_DAYS = 14

# Matches the date in either corpus's filename: `run-2026-07-31_13-02-13.json`
# and `v1_2026-07-31_12-57-04.json` alike. A released `v{N}.json` carries no
# date and is never aged out.
_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def run_date(p: Path) -> date | None:
    """The run's date, parsed from its filename. None if it carries none."""
    m = _DATE_RE.search(p.name)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").date()
    except ValueError:
        return None


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
    parseable date is KEPT — dropping it would silently shrink the sample on a
    naming change (and would age out released `v{N}.json`), which is the
    failure mode this module exists to avoid."""
    if cutoff is None:
        return list(paths)
    return [p for p in paths if (d := run_date(p)) is None or d >= cutoff]


def add_since_arg(
    ap: argparse.ArgumentParser, *, default: str = str(DEFAULT_SINCE_DAYS)
) -> None:
    """Add `--since`, already converted to a cutoff date (or None for 'all').

    `default` is a *string*, so argparse runs it through the same converter —
    one code path for supplied and defaulted values alike.
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
    measurement when it isn't one, and so an omitted-but-stale subject is
    visibly omitted rather than silently absent.
    """
    if cutoff is None:
        return f"Window: entire corpus ({n_runs} run(s))."
    dropped = n_total - n_runs
    return (
        f"Window: runs on/after {cutoff.isoformat()} — {n_runs} of {n_total} run(s), "
        f"{dropped} older run(s) excluded. Pass --since all for the whole corpus."
    )
