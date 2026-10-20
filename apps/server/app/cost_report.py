"""Claude API cost of the hosted alpha, from two tables.

``api_calls`` holds every Messages API call the credential proxy relayed, so its daily
total is the whole bill and should match the Anthropic Console. ``turn_costs`` holds what
each sandbox reported after a turn; only sandboxes from the 2026-10-12 build on report,
but only they know their build and the Stop hook's continuations.

Run on the control plane, which holds DATABASE_URL: ``make alpha-costs`` (``DAYS=N``).
Locally it reads whatever database ``get_settings`` points at.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import case, distinct, func
from sqlmodel import Session, select

from .agent.spend import TOKEN_CLASSES, rates_for
from .db import get_engine
from .models import ApiCall, TurnCost, User, utcnow
from .sessions import SESSION_MAX_AGE

NOT_REPORTED = "(not reported)"
_OLD_S = int(SESSION_MAX_AGE.total_seconds())


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


def _age(seconds: int) -> str:
    hours = seconds / 3600
    return f"{hours:.0f}h" if hours < 48 else f"{hours / 24:.1f}d"


def _calls(session: Session, cutoff: datetime, emails: dict[str, str],
           top: int) -> tuple[str, list[str]]:
    """The summary line and tables for every call. Aggregated in the database, which holds
    a row per call."""
    since = ApiCall.created >= cutoff
    spent = func.sum(ApiCall.cost_usd)
    cost, n, sessions = session.exec(select(
        spent, func.count(), func.count(distinct(ApiCall.project_id)),
    ).where(since)).one()
    summary = f"Every call the proxy relayed: {n:,} calls, {sessions} sessions, ${cost or 0:,.2f}."
    if not n:
        return summary, []

    day = func.date(ApiCall.created)
    context = (ApiCall.input_tokens + ApiCall.cache_creation_input_tokens
               + ApiCall.cache_read_input_tokens)
    old = case((ApiCall.session_age_s > _OLD_S, ApiCall.cost_usd), else_=0.0)
    days = session.exec(select(
        day, spent, func.count(), func.sum(context),
        func.sum(ApiCall.output_tokens), func.count(distinct(ApiCall.project_id)),
        func.count(distinct(ApiCall.user_id)), func.sum(old),
    ).where(since).group_by(day).order_by(day)).all()
    out = ["", "Every call, by day (should match the Anthropic Console)"] + _table(
        ["day", "cost", "calls", "$/call", "context/call", "output/call", "sessions", "users",
         f"over {_OLD_S // 3600}h"],
        [[str(d), f"${c:,.2f}", k, f"${c / k:,.3f}", round(ctx / k), round(o / k), s, u,
          f"${old_cost:,.2f}"]
         for d, c, k, ctx, o, s, u, old_cost in days],
    )

    models = session.exec(select(
        ApiCall.model, spent, func.count(),
        func.sum(ApiCall.input_tokens), func.sum(ApiCall.cache_creation_input_tokens),
        func.sum(ApiCall.cache_read_input_tokens), func.sum(ApiCall.output_tokens),
    ).where(since).group_by(ApiCall.model).order_by(spent.desc())).all()
    out += ["", "Every call, by model"] + _table(
        ["model", "cost", "calls", "% of cost"],
        [[m or "(none)", f"${c:,.2f}", k, round(100 * c / (cost or 1))] for m, c, k, *_ in models],
    )

    # The agent is the body's `# ` heading verbatim, not its file name: compare with
    # `make e2e-agent-spend` through `grep -m1 '^# ' packages/engine/plugin/agents/*.md`.
    # Split by the effort each request asked for, so sessions born under different T4.1
    # settings are not averaged together (null = no `output_config.effort` on the call).
    agents = session.exec(select(
        ApiCall.agent, ApiCall.effort, spent, func.count(), func.sum(context),
        func.sum(ApiCall.output_tokens),
    ).where(since).group_by(ApiCall.agent, ApiCall.effort).order_by(spent.desc())).all()
    out += ["", "Every call, by agent and effort (main = the main thread)"] + _table(
        ["agent", "effort", "cost", "calls", "% of cost", "context/call", "output/call"],
        [[a or "(none)", e or "-", f"${c:,.2f}", k, round(100 * c / (cost or 1)), round(ctx / k),
          round(o / k)]
         for a, e, c, k, ctx, o in agents],
    )

    priced = [0.0] * len(TOKEN_CLASSES)
    for m, _, _, *tokens in models:
        rates = rates_for(m)
        for i, (name, t) in enumerate(zip(TOKEN_CLASSES, tokens)):
            priced[i] += t / 1_000_000 * rates[name]
    whole = sum(priced) or 1
    out += ["", "Every call, by token type"] + _table(
        ["tokens", "cost", "% of cost"],
        [[name.replace("_", " "), f"${p:,.2f}", round(100 * p / whole)]
         for name, p in zip(TOKEN_CLASSES, priced)],
    )

    worst = session.exec(select(
        ApiCall.project_id, ApiCall.user_id, spent, func.count(),
        func.max(ApiCall.session_age_s), func.max(ApiCall.created),
    ).where(since).group_by(ApiCall.project_id, ApiCall.user_id)
        .order_by(spent.desc()).limit(top)).all()
    out += ["", f"Every call, the {len(worst)} most expensive sessions"] + _table(
        ["session", "cost", "calls", "user", "age", "last call"],
        [[pid, f"${c:,.2f}", k, emails.get(uid, uid), _age(age), last.strftime("%Y-%m-%d %H:%M")]
         for pid, uid, c, k, age, last in worst],
    )
    return summary, out


def render(rows: list[TurnCost], emails: dict[str, str], calls: tuple[str, list[str]],
           days: int, top: int) -> str:
    summary, call_lines = calls
    total = sum(r.cost_usd for r in rows)
    out = [f"Claude API cost, hosted alpha: last {days} days (UTC), today included.", summary,
           f"Turns the sandboxes reported: {len(rows)} turns, "
           f"{len({r.project_id for r in rows})} sessions, ${total:,.2f}.", *call_lines]
    if not rows:
        return "\n".join(out)

    by_day: dict[str, list[TurnCost]] = defaultdict(list)
    by_build: dict[str, list[TurnCost]] = defaultdict(list)
    by_session: dict[str, list[TurnCost]] = defaultdict(list)
    for r in rows:
        by_day[r.created.strftime("%Y-%m-%d")].append(r)
        by_build[_short(r.build)].append(r)
        by_session[r.project_id].append(r)

    out += ["", "Turns, by day"] + _table(
        ["day", "cost", "sessions", "users", "turns", "continuations"],
        [[day, f"${sum(r.cost_usd for r in g):,.2f}", len({r.project_id for r in g}),
          len({r.user_id for r in g}), len(g), _continuations(g)]
         for day, g in sorted(by_day.items())],
    )

    builds = sorted(by_build.items(), key=lambda kv: min(r.created for r in kv[1]))
    out += ["", "Turns, by build (the sandbox's code; a session stays on the build it started on)"] + _table(
        ["build", "first turn", "last turn", "cost", "sessions", "$/session", "turns", "continuations"],
        [[b, min(r.created for r in g).strftime("%Y-%m-%d"), max(r.created for r in g).strftime("%Y-%m-%d"),
          f"${sum(r.cost_usd for r in g):,.2f}", len({r.project_id for r in g}),
          f"${sum(r.cost_usd for r in g) / len({r.project_id for r in g}):,.2f}", len(g), _continuations(g)]
         for b, g in builds],
    )

    sessions = sorted(by_session.items(), key=lambda kv: -sum(r.cost_usd for r in kv[1]))[:top]
    out += ["", f"Turns, the {len(sessions)} most expensive sessions"] + _table(
        ["session", "cost", "turns", "continuations", "build", "user", "first turn"],
        [[pid, f"${sum(r.cost_usd for r in g):,.2f}", len(g), _continuations(g),
          _short(g[0].build), emails.get(g[0].user_id, g[0].user_id),
          min(r.created for r in g).strftime("%Y-%m-%d %H:%M")]
         for pid, g in sessions],
    )
    return "\n".join(out)


def load(days: int, top: int = 10, now: datetime | None = None
         ) -> tuple[list[TurnCost], dict[str, str], tuple[str, list[str]]]:
    # Whole UTC days, today included, so every day's row compares with the Console's.
    start = (now or utcnow()) - timedelta(days=days - 1)
    cutoff = start.replace(hour=0, minute=0, second=0, microsecond=0)
    with Session(get_engine()) as session:
        rows = list(session.exec(select(TurnCost).where(TurnCost.created >= cutoff)).all())
        emails = {u.id: u.email for u in session.exec(select(User)).all()}
        calls = _calls(session, cutoff, emails, top)
    return rows, emails, calls


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args(argv)
    if args.days < 1 or args.top < 1:
        parser.error("--days and --top must be at least 1")
    rows, emails, calls = load(args.days, args.top)
    print(render(rows, emails, calls, args.days, args.top))


if __name__ == "__main__":
    main()
