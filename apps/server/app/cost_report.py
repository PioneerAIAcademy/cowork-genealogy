"""Claude API cost of the hosted alpha, from ``turn_costs``: per day, per build, and the
most expensive sessions.

Run on the control plane, which holds DATABASE_URL: ``make alpha-costs`` (``DAYS=N``).
Locally it reads whatever database ``get_settings`` points at.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta

from sqlmodel import Session, select

from .db import get_engine
from .models import TurnCost, User, utcnow

NOT_REPORTED = "(not reported)"


def _short(build: str | None) -> str:
    if not build:
        return NOT_REPORTED
    sha, plus, rest = build.partition("+")
    return sha[:9] + plus + rest


def _continuations(rows: list[TurnCost]) -> int | str:
    known = [r.continuations for r in rows if r.continuations is not None]
    return sum(known) if known else "-"


def _table(header: list[str], body: list[list]) -> list[str]:
    """Money and counts right-aligned, text left-aligned, judged by the first row."""
    widths = [max(len(str(x)) for x in col) for col in zip(header, *body)]
    right = [isinstance(x, int) or str(x).startswith("$") or x == "-" for x in body[0]]
    fmt = lambda row: "  ".join(str(x).rjust(w) if r else str(x).ljust(w)  # noqa: E731
                                for x, w, r in zip(row, widths, right)).rstrip()
    return [fmt(header), *(fmt(r) for r in body)]


def render(rows: list[TurnCost], emails: dict[str, str], days: int, top: int = 10) -> str:
    total = sum(r.cost_usd for r in rows)
    out = [f"Claude API cost, hosted alpha: last {days} days (UTC). "
           f"{len(rows)} turns, {len({r.project_id for r in rows})} sessions, ${total:,.2f}."]
    if not rows:
        return out[0]

    by_day: dict[str, list[TurnCost]] = defaultdict(list)
    by_build: dict[str, list[TurnCost]] = defaultdict(list)
    by_session: dict[str, list[TurnCost]] = defaultdict(list)
    for r in rows:
        by_day[r.created.strftime("%Y-%m-%d")].append(r)
        by_build[_short(r.build)].append(r)
        by_session[r.project_id].append(r)

    out += ["", "By day"] + _table(
        ["day", "cost", "sessions", "users", "turns", "continuations"],
        [[day, f"${sum(r.cost_usd for r in g):,.2f}", len({r.project_id for r in g}),
          len({r.user_id for r in g}), len(g), _continuations(g)]
         for day, g in sorted(by_day.items())],
    )

    builds = sorted(by_build.items(), key=lambda kv: min(r.created for r in kv[1]))
    out += ["", "By build (the sandbox's code; a session stays on the build it started on)"] + _table(
        ["build", "first turn", "last turn", "cost", "sessions", "$/session", "turns", "continuations"],
        [[b, min(r.created for r in g).strftime("%Y-%m-%d"), max(r.created for r in g).strftime("%Y-%m-%d"),
          f"${sum(r.cost_usd for r in g):,.2f}", len({r.project_id for r in g}),
          f"${sum(r.cost_usd for r in g) / len({r.project_id for r in g}):,.2f}", len(g), _continuations(g)]
         for b, g in builds],
    )

    sessions = sorted(by_session.items(), key=lambda kv: -sum(r.cost_usd for r in kv[1]))[:top]
    out += ["", f"Top {len(sessions)} sessions"] + _table(
        ["session", "cost", "turns", "continuations", "build", "user", "first turn"],
        [[pid, f"${sum(r.cost_usd for r in g):,.2f}", len(g), _continuations(g),
          _short(g[0].build), emails.get(g[0].user_id, g[0].user_id),
          min(r.created for r in g).strftime("%Y-%m-%d %H:%M")]
         for pid, g in sessions],
    )
    return "\n".join(out)


def load(days: int, now: datetime | None = None) -> tuple[list[TurnCost], dict[str, str]]:
    cutoff = (now or utcnow()) - timedelta(days=days)
    with Session(get_engine()) as session:
        rows = list(session.exec(select(TurnCost).where(TurnCost.created >= cutoff)).all())
        emails = {u.id: u.email for u in session.exec(select(User)).all()}
    return rows, emails


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args(argv)
    if args.days < 1 or args.top < 1:
        parser.error("--days and --top must be at least 1")
    rows, emails = load(args.days)
    print(render(rows, emails, args.days, args.top))


if __name__ == "__main__":
    main()
