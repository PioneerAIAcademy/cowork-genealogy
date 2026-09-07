"""Standing weekly e2e panel: who ran this ISO week, and how often lately.

The e2e tier is the only measurement of the whole research loop, and it has one
operator. Runs per ISO week over the seven weeks to 2026-09-07: 43, 37, 12, 4, 4,
1, 1 — so every corpus report opens with a two-run window and month-over-month
comparison is impossible. The answer is a standing panel of four fixtures run
every week, filed one issue per run by `/file-e2e-panel`.

This is that panel's scoreboard, and the reason it is a module rather than an
`ls` pipeline in the skill: **no existing reader prints runs-per-fixture-per-
window.** `corpus_report`'s `concentration:` block counts *violations* per
fixture, and its window line carries one total across the corpus. The issue's own
acceptance check — "each panel fixture has at least 4 runs dated in the month" —
is not answerable with what was here before.

Pure analysis over committed run JSONs: no live run, no API spend, same posture
as `corpus_report.py`, `nudge_report.py` and `latency_report.py`.

## Two windows, deliberately

**Coverage** is this ISO week (Monday-anchored) and ignores `--since` entirely —
"did the panel run this week" has exactly one meaningful window, and making it
configurable would let a caller ask a question the panel's cadence cannot answer.

**The count** is the `--since` window, defaulting to 28 days rather than the
shared `DEFAULT_SINCE_DAYS` of 14: the panel's unit of comparison is the month,
and a fortnight cannot hold the "at least 4 runs" the acceptance check asks for.
Pass `SINCE=all` for a fixture's whole history — note that the all-time counts
(6/6/5/4 when the panel was chosen) are a different number from the trailing-month
counts, and it is the trailing one that says whether the bet is working.

## An empty window is a result, not a failure

Exit 0 with every fixture at zero is the honest report on a week nobody ran the
panel, and it is the state this file was written in. Only an unknown fixture — a
`--test` slug with no committed runs at all — exits 1, which is also what puts
this reader on the branch-scope caveat's empty-corpus path.

CLI (from eval/harness/):
  uv run python -m e2e.panel_report
  uv run python -m e2e.panel_report --since all
  uv run python -m e2e.panel_report --test spriggs-parents-1898
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from e2e.runlog_selection import (
    add_since_arg,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
    run_date,
)

#: The standing panel. Fixed, so the same fixtures repeat and a trend is
#: readable — fixture difficulty varies enormously (one fixture alone carries
#: 13% of all corpus violations), so a month's aggregate is comparable to the
#: next month's only if the mix is constant. These four had the deepest run
#: history when the panel was chosen, so a baseline existed from day one.
#:
#: `test_e2e_panel_report.py` asserts every slug here resolves under
#: `eval/tests/e2e/` and that `.claude/skills/file-e2e-panel/SKILL.md` names
#: exactly these — the panel is stated in two places and nothing else compares
#: them.
PANEL: tuple[str, ...] = (
    "spriggs-parents-1898",
    "hannah-earnest-children",
    "anders-monsen-ancestry",
    "cruz-corona-ancestry",
)

#: Four weeks. See "Two windows, deliberately" above for why this is not the
#: shared 14-day default.
PANEL_SINCE_DAYS = 28


def iso_week_start(today: date | None = None) -> date:
    """The Monday of `today`'s ISO week."""
    d = today or date.today()
    return d - timedelta(days=d.weekday())


@dataclass(frozen=True)
class FixtureRow:
    slug: str
    this_week: list[Path]
    in_window: list[Path]
    all_runs: list[Path]

    @property
    def covered(self) -> bool:
        return bool(self.this_week)


def scan(
    slugs: tuple[str, ...] | list[str],
    *,
    cutoff: date | None,
    week_start: date,
) -> list[FixtureRow]:
    """One row per fixture. Reads filenames only — never opens a run log."""
    rows: list[FixtureRow] = []
    for slug in slugs:
        runs = result_jsons_for(slug)
        this_week = [p for p in runs if (d := run_date(p)) is not None and d >= week_start]
        rows.append(
            FixtureRow(
                slug=slug,
                this_week=this_week,
                in_window=filter_since(runs, cutoff),
                all_runs=runs,
            )
        )
    return rows


def format_report(rows: list[FixtureRow], *, week_start: date) -> str:
    iso = week_start.isocalendar()
    covered = [r for r in rows if r.covered]
    lines = [
        f"Panel coverage — ISO week {iso.year}-W{iso.week:02d} "
        f"(from Monday {week_start.isoformat()})",
        f"  {len(covered)} of {len(rows)} panel fixture(s) have a run this week.",
        "",
    ]
    width = max((len(r.slug) for r in rows), default=0)
    for row in rows:
        if row.covered:
            mark = f"ran {row.this_week[-1].name}"
        else:
            mark = "NOT RUN this week"
        lines.append(f"  {row.slug.ljust(width)}  {len(row.in_window):>2} in window   {mark}")

    if not covered:
        lines += [
            "",
            "  Every panel fixture is unrun this week. That is the report, not an error —",
            "  file the week's issues with /file-e2e-panel.",
        ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Standing weekly e2e panel: which panel fixtures ran this ISO week, "
            "and each one's run count in the window."
        ),
    )
    parser.add_argument(
        "--test",
        default=None,
        help="Only this fixture slug, whether or not it is on the panel.",
    )
    add_since_arg(parser, default=str(PANEL_SINCE_DAYS))
    args = parser.parse_args(argv)

    slugs = [args.test] if args.test else list(PANEL)
    week_start = iso_week_start()
    rows = scan(slugs, cutoff=args.since, week_start=week_start)

    total_all = sum(len(r.all_runs) for r in rows)
    if args.test and not total_all:
        # An unknown fixture: the caller named something that has never run, so
        # there is nothing to report and the branch-scope caveat is exactly the
        # thing they need (the runs may exist on a ref this checkout lacks).
        #
        # Deliberately NOT applied to the panel path. "None of the four ran"
        # is this reader's headline finding, not a broken read — exiting
        # non-zero there would make the weekly skill treat its own answer as a
        # tool failure. A fixture directory holding only `.ann.json` and
        # `.final-*` siblings lands here too, and is likewise a real 0.
        print(f"No committed runs found for {args.test}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    total_in_window = sum(len(r.in_window) for r in rows)
    print(format_report(rows, week_start=week_start))
    print()
    print(describe_window(args.since, n_runs=total_in_window, n_total=total_all))
    return 0


if __name__ == "__main__":
    sys.exit(main())
