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

## One window, and a cadence-free reading

The count is the `--since` window, defaulting to 28 days rather than the shared
`DEFAULT_SINCE_DAYS` of 14: the panel's unit of comparison is the month, and a
fortnight cannot hold the "at least 4 runs" the acceptance check asks for. Pass
`SINCE=all` for a fixture's whole history — the all-time counts (6/6/5/4 when the
panel was chosen) are a different number from the trailing-month ones, and it is
the trailing one that says whether the bet is working.

Alongside it, each fixture's last run and how many days ago. **Deliberately not
anchored to a calendar week.** The panel is filed whenever the lead runs
`/file-e2e-panel`, not on a Monday schedule, so "did it run this ISO week" would
answer a question the cadence does not ask — and would read as a miss on a
Tuesday batch that ran fine on the Friday before.

## An empty window is a result, not a failure

Exit 0 with every fixture at zero is the honest report on a stretch where nobody
ran the panel, and it is the state this file was written in. Only an unknown fixture — a
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


@dataclass(frozen=True)
class FixtureRow:
    slug: str
    in_window: list[Path]
    all_runs: list[Path]

    @property
    def last_run(self) -> Path | None:
        return self.all_runs[-1] if self.all_runs else None

    @property
    def days_since(self) -> int | None:
        p = self.last_run
        d = run_date(p) if p is not None else None
        return (date.today() - d).days if d is not None else None


def scan(
    slugs: tuple[str, ...] | list[str],
    *,
    cutoff: date | None,
) -> list[FixtureRow]:
    """One row per fixture. Reads filenames only — never opens a run log."""
    return [
        FixtureRow(
            slug=slug,
            in_window=filter_since(runs := result_jsons_for(slug), cutoff),
            all_runs=runs,
        )
        for slug in slugs
    ]


def format_report(rows: list[FixtureRow]) -> str:
    lines = ["Panel runs", ""]
    width = max((len(r.slug) for r in rows), default=0)
    for row in rows:
        if (n := row.days_since) is None:
            last = "never run"
        else:
            last = f"last {row.last_run.name.removeprefix('run-')[:10]} ({n}d ago)"
        lines.append(f"  {row.slug.ljust(width)}  {len(row.in_window):>2} in window   {last}")

    if not any(r.in_window for r in rows):
        lines += [
            "",
            "  No panel fixture has run inside the window. That is the report, not an",
            "  error — file the next batch with /file-e2e-panel.",
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
    rows = scan(slugs, cutoff=args.since)

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
    print(format_report(rows))
    print()
    print(describe_window(args.since, n_runs=total_in_window, n_total=total_all))
    return 0


if __name__ == "__main__":
    sys.exit(main())
