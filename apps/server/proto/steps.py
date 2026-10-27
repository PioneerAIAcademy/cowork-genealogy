#!/usr/bin/env python3
"""Step mode's measures: what a researcher waits, what a step costs, and what they
answered (decision 28, acceptance item 11).

    uv run python proto/steps.py [--pg-dsn ...] [--session <id>] [--since-days N]

Three tables over ``turns``, which carries ``step`` and ``mode`` from
``015_turn_step.sql``:

  wait     ``completed_at - enqueued_at`` per step, p50 and p90. The headline:
           how long a researcher waits for one response. Not
           ``completed_at - claimed_at`` -- ``claimed_at`` is reset on every
           claim and redelivery is the normal resume path, so that measures only
           the last attempt.

  spend    per step, priced from the four token columns through the worker's own
           ``price_usd``. **Not** ``turns.cost_usd``: that is the ResultMessage's
           figure for the attempt that COMPLETED the turn, so every killed or
           redelivered attempt's spend is missing from it. The token columns are
           summed over ``session_entries`` by ``TURN_USAGE_SQL`` at close and do
           include them.

  replies  what the researcher (or the host under "Keep going") sent next, per
           step. This is the one that says whether the step boundary is costing
           or saving: a step whose next message is almost always "Continue."
           is a pause nobody needed, and the share that stops at the "not
           exhaustive" choice is the whole offset in the plan's Costs section.

**Wrap-up turns are left out of the per-step figures** and reported on their own
line: ``mode = 'wrapup'`` runs several steps in one turn, so attributing its wait
or spend to the one step it opened with would overstate that step. A host reply
under "Keep going" is an ordinary one-step turn and counts.

Reads only. Safe against a live stack.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import psycopg  # noqa: E402

from app.agent.spend import price_usd  # noqa: E402
from proto.worker.options import load_step_boundary  # noqa: E402

DEFAULT_DSN = os.environ.get("PG_DSN", "postgresql://postgres:proto@localhost:5434/proto")

# One row per closed turn that ran a step. `next_text` is the message of the next
# turn on the same session by `enqueued_at` -- the reply this step's boundary got.
# A LATERAL join rather than a window function: the reply is the FIRST later turn,
# and `LIMIT 1` inside the join says that directly.
ROWS_SQL = """
SELECT t.step,
       t.mode,
       EXTRACT(EPOCH FROM (t.completed_at - t.enqueued_at)) AS wait_s,
       t.input_tokens, t.cache_creation_tokens, t.cache_read_tokens, t.output_tokens,
       nxt.message ->> 'text'   AS next_text,
       (nxt.message ->> 'auto') AS next_auto
  FROM turns t
  LEFT JOIN LATERAL (
       SELECT n.message
         FROM turns n
        WHERE n.session_id = t.session_id
          AND n.enqueued_at > t.enqueued_at
          -- A held `auto` reply the researcher's own message displaced closes
          -- `superseded`. It was never sent, so crediting it would report a
          -- boundary as answered by a reply nobody saw.
          AND n.outcome IS DISTINCT FROM 'superseded'
        ORDER BY n.enqueued_at
        LIMIT 1
  ) nxt ON TRUE
 WHERE t.step IS NOT NULL
   AND t.completed_at IS NOT NULL
   AND (%(session)s::text IS NULL OR t.session_id = %(session)s)
   AND (%(since)s::int IS NULL OR t.enqueued_at > now() - make_interval(days => %(since)s))
 ORDER BY t.step, t.enqueued_at
"""


def percentile(values: list[float], q: float) -> float | None:
    """Nearest-rank percentile. Computed here rather than in SQL so the wait and
    spend tables use ONE definition -- spend is priced in Python and could not be
    handed to `percentile_cont` without pricing in SQL too, which would be a
    second copy of the rate table."""
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, round(q * (len(ordered) - 1))))
    return ordered[idx]


def classify(text: str | None, boundary) -> str:
    """Which reply phrase a message is, or `typed`/`none`.

    Exact-phrase, through the boundary's own constants and its own normalizer,
    because that is what `step_mode` reads on the way in: a message that merely
    CONTAINS "keep going" started no job turn, and counting it as one would
    overstate how often the host's own replies carried a run.
    """
    if text is None:
        return "none (run ended)"
    said = boundary.normalize_reply(text)
    for phrase in (
        boundary.REPLY_CONTINUE,
        boundary.REPLY_KEEP_GOING,
        boundary.REPLY_WRAP_UP,
        boundary.REPLY_SEARCH_MORE,
    ):
        if said == boundary.normalize_reply(phrase):
            return phrase
    return "typed (something else)"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg-dsn", default=DEFAULT_DSN)
    ap.add_argument("--session", default=None, help="one session id; default every session")
    ap.add_argument("--since-days", type=int, default=None, help="only turns enqueued in the last N days")
    ap.add_argument("--json", action="store_true", help="emit the three tables as JSON")
    args = ap.parse_args()

    boundary = load_step_boundary()
    with psycopg.connect(args.pg_dsn) as conn, conn.cursor() as cur:
        cur.execute(ROWS_SQL, {"session": args.session, "since": args.since_days})
        rows = cur.fetchall()

    waits: dict[str, list[float]] = defaultdict(list)
    spends: dict[str, list[float]] = defaultdict(list)
    replies: dict[str, Counter] = defaultdict(Counter)
    wrapup = {"turns": 0, "waits": [], "spends": []}

    for step, mode, wait_s, inp, cw, cr, out, next_text, next_auto in rows:
        usd = price_usd((inp, cw, cr, out))
        if mode == "wrapup":
            # Several steps in one turn: counted, never attributed to `step`.
            wrapup["turns"] += 1
            if wait_s is not None:
                wrapup["waits"].append(float(wait_s))
            wrapup["spends"].append(usd)
            continue
        if wait_s is not None:
            waits[step].append(float(wait_s))
        spends[step].append(usd)
        label = classify(next_text, boundary)
        # Any reply the host sent, not only "Keep going.": it also sends "Wrap it up."
        # at a second planning round, and that is not the researcher's choice.
        if next_auto == "true":
            label += " (host)"
        replies[step][label] += 1

    report = {
        "turns": len(rows),
        "steps": sorted(set(waits) | set(spends)),
        "wait_s": {
            s: {"n": len(v), "p50": percentile(v, 0.5), "p90": percentile(v, 0.9)}
            for s, v in sorted(waits.items())
        },
        "spend_usd": {
            s: {
                "n": len(v),
                "p50": percentile(v, 0.5),
                "p90": percentile(v, 0.9),
                "total": round(sum(v), 4),
            }
            for s, v in sorted(spends.items())
        },
        "replies": {s: dict(c.most_common()) for s, c in sorted(replies.items())},
        "wrapup_turns": {
            "n": wrapup["turns"],
            "wait_p50": percentile(wrapup["waits"], 0.5),
            "spend_total": round(sum(wrapup["spends"]), 4),
        },
    }

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    if not rows:
        # Not an error, and said plainly: a prototype that has run no step turn
        # reports nothing, and a silent empty table reads like a measurement.
        print("no closed turns carry a step — nothing to report "
              "(turns.step is filled from step mode's first spawn)")
        return 0

    print(f"{len(rows)} closed step turn(s)\n")
    print(f"{'step':<22}{'n':>5}{'wait p50':>11}{'wait p90':>11}{'$ p50':>9}{'$ p90':>9}{'$ total':>10}")
    for step in report["steps"]:
        w = report["wait_s"].get(step, {})
        sp = report["spend_usd"].get(step, {})
        p50 = f"{w['p50']:.0f}s" if w.get("p50") is not None else "-"
        p90 = f"{w['p90']:.0f}s" if w.get("p90") is not None else "-"
        print(f"{step:<22}{sp.get('n', 0):>5}{p50:>11}{p90:>11}"
              f"{sp.get('p50', 0):>9.2f}{sp.get('p90', 0):>9.2f}{sp.get('total', 0):>10.2f}")

    print("\nthe reply each step's boundary got")
    for step in sorted(replies):
        total = sum(replies[step].values())
        parts = ", ".join(f"{label} {n} ({100 * n / total:.0f}%)" for label, n in replies[step].most_common())
        print(f"  {step:<20} {parts}")

    w = report["wrapup_turns"]
    if w["n"]:
        p50 = f"{w['wait_p50']:.0f}s" if w["wait_p50"] is not None else "-"
        print(f"\nwrap-up turns (several steps each, left out above): "
              f"{w['n']}, wait p50 {p50}, ${w['spend_total']:.2f} total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
