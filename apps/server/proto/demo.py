#!/usr/bin/env python3
"""D19 ``make proto-demo``: seed a fixture, post its research question, run one real turn to
``turn_done``, then print the acceptance evidence -- each query as SQL with its bound ids,
followed by the rows it returned, so any of them can be re-run in psql against the compose
Postgres. No browser, no kill (the kill-resume run is D17; ``make proto-kill`` is its scripted
D14 arm). Billed: one research turn.

    uv run python proto/demo.py [--fixture bagley-father-1884] [--prompt ...] [--session <id>]
                                [--deadline-s 3900] [--base ...] [--pg-dsn ...] [--s3-endpoint ...]

``--fixture`` is anything ``proto/seed.py`` accepts; the opening prompt is the e2e harness's
own message for the fixture, ``/research --autonomous <researcher_question>``, unless
``--prompt`` overrides it verbatim (a unit scenario has no question, so it needs
``--prompt``). The recipe also exports ``BLOCKED_TOOLS`` -- the harness's tree-read block --
so the run is the research workflow, not a lookup of the answer the live tree still holds. ``--session`` skips the seed and drives an existing seeded session.

The deadline defaults to two shim ceilings plus slack (``READ_TIMEOUT_S`` is 1800 s per
attempt, on which the shim kills the worker and requeues at once -- a turn past 1800 s is
resumed by design, and a one-ceiling deadline would report FAIL as attempt 2 began). The
printed ``receive_count`` says whether the shim intervened.

Exit 0 when ``turn_done`` arrived, criterion 3 is PASS and no FamilySearch tool answered with
the reconnect instruction (an expired token voids the run, as D17 says); 1 otherwise; 2 when
the stack is not up or there is no prompt.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import psycopg

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from proto import audit, seed, turn  # noqa: E402

DEFAULT_FIXTURE = "bagley-father-1884"
DEFAULT_DEADLINE_S = 3900.0  # 2 x the shim's 1800 s per-attempt ceiling, plus slack
# What the engine's auth module actually says when the bearer is missing, expired or rejected
# (src/auth/refresh.ts, the hosted message) -- not turn.REAUTH, whose `log ?in|authenticat`
# also matches "the Login family" and "Authenticated copy" in record text.
REAUTH = re.compile(r"Call the login tool|Reconnect FamilySearch|unauthori[sz]ed|\b401\b", re.I)
# Transient web-tier faults a 65-minute poll must ride out rather than die on.
TRANSIENT = (httpx.HTTPError, ValueError, KeyError)

Query = tuple[str, str, tuple]


# -- pure seams -------------------------------------------------------------------------------


def opening_prompt(meta: dict, override: str | None) -> str:
    """``--prompt`` wins, verbatim; else the harness's message for the fixture's
    ``researcher_question`` (eval/harness/e2e/orchestrator.py: ``/research --autonomous …``,
    which is what the corpus the run is compared to was driven with); else there is nothing
    to post and the caller exits 2."""
    if override and override.strip():
        return override.strip()
    q = meta.get("researcher_question")
    if isinstance(q, str) and q.strip():
        return f"/research --autonomous {q.strip()}"
    raise ValueError("no opening prompt: the fixture has no researcher_question; pass --prompt")


def section_counts_sql() -> str:
    """Length of every array-typed top-level key of the project's research.json -- no section
    list to maintain, so a delegation writing person_evidence shows up beside an extraction
    writing sources and assertions."""
    return (
        "SELECT k AS section, jsonb_array_length(d.doc->k) AS n "
        "FROM documents d, jsonb_object_keys(d.doc) AS k "
        "WHERE d.project_id = %s AND d.name = 'research.json' AND jsonb_typeof(d.doc->k) = 'array' "
        "ORDER BY k"
    )


def acceptance_queries(turn_id: str, session_id: str, project_id: str) -> list[Query]:
    """The labelled read-only queries behind criteria 1, 2 and the D18 token figures.
    Criteria 3 and 4 come from ``audit.py`` (its own report), the reauth void check from
    ``reauth_hits``."""
    return [
        ("criterion 1: the turns row (receive_count >= 2 on a killed run; completed_at set)",
         "SELECT receive_count, claimed_at, completed_at, outcome, cost_usd, num_turns, duration_ms, nudges "
         "FROM turns WHERE turn_id = %s", (turn_id,)),
        ("criterion 2: research.json section sizes after the turn (compare with the baseline above)",
         section_counts_sql(), (project_id,)),
        ("criterion 2: the session's event kinds (session-wide; equals the turn's on a fresh seed)",
         "SELECT kind, count(*) AS n FROM session_events WHERE session_id = %s GROUP BY kind ORDER BY n DESC, kind",
         (session_id,)),
        ("criterion 2: the turn's tool calls by tool and decision",
         "SELECT tool_name, decision, count(*) AS n, max(duration_ms) AS max_ms FROM tool_calls "
         "WHERE turn_id = %s GROUP BY tool_name, decision ORDER BY n DESC, tool_name", (turn_id,)),
        ("tokens (D18): the turn's usage columns",
         f"SELECT {', '.join(turn.TOKEN_COLUMNS)} FROM turns WHERE turn_id = %s", (turn_id,)),
    ]


def render_query(label: str, sql: str, params: tuple, rows: list[tuple]) -> str:
    """The label, the SQL with its params substituted (quoted) so it pastes into psql, then one
    line per row -- or ``(no rows)``."""
    values = iter(params)
    shown = re.sub(r"%s", lambda _m: "'" + str(next(values)).replace("'", "''") + "'", sql)
    lines = [f"-- {label}", shown]
    if rows:
        lines.extend("   " + "  ".join(str(v) for v in row) for row in rows)
    else:
        lines.append("   (no rows)")
    return "\n".join(lines)


def nudges_line(nudges: int | None, cap: str | None) -> str:
    """``nudges  <n>  (cap <AUTONOMOUS_MAX_NUDGES or "off">)`` -- whether the D18 arm's Stop
    hook vetoed anything on this turn (``turns.nudges``) and the cap the worker ran under."""
    cap_text = (cap or "").strip()
    shown = cap_text if cap_text and cap_text != "0" else "off"
    return f"nudges      {nudges if nudges is not None else '?'}  (cap {shown})"


def verdict(turn_done: bool, criterion_3_ok: bool, reauth: bool) -> int:
    """0 only when the turn finished, criterion 3 held, and no tool answered with the reconnect
    instruction."""
    return 0 if (turn_done and criterion_3_ok and not reauth) else 1


# -- postgres ---------------------------------------------------------------------------------


def rows(dsn: str, sql: str, params: tuple) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute(sql, params).fetchall()


def reauth_hits(dsn: str, session_id: str, since_seq: int) -> list[str]:
    """tool_result summaries after ``since_seq`` matching ``REAUTH`` -- what a FamilySearch tool
    answers when its bearer is empty or rejected."""
    found = rows(dsn, "SELECT payload->>'summary' FROM session_events WHERE session_id = %s AND seq > %s "
                      "AND kind = 'tool_result' ORDER BY seq", (session_id, since_seq))
    return [s or "" for (s,) in found if REAUTH.search(s or "")]


def reply_text(dsn: str, session_id: str, turn_id: str) -> tuple[int, str]:
    """``(user_msg seq, the turn's text events joined)`` -- the query turn.py uses."""
    user_seq = rows(dsn, "SELECT max(seq) FROM session_events WHERE session_id = %s AND kind = 'user_msg' "
                         "AND payload->>'turn_id' = %s", (session_id, turn_id))
    since = (user_seq[0][0] if user_seq and user_seq[0][0] is not None else 0)
    texts = rows(dsn, "SELECT payload->>'text' FROM session_events WHERE session_id = %s AND kind = 'text' "
                      "AND seq > %s ORDER BY seq", (session_id, since))
    return since, " ".join(t or "" for (t,) in texts)


def wait_turn_done(client: httpx.Client, base: str, session_id: str, turn_id: str, deadline_s: float) -> float:
    """``turn.wait_turn_done`` with transient web-tier faults retried until the deadline;
    ``elapsed_s``. Raises ``TimeoutError`` at the deadline."""
    t0 = time.monotonic()
    while True:
        remaining = deadline_s - (time.monotonic() - t0)
        if remaining <= 0:
            raise TimeoutError(f"no turn_done for {turn_id} within {deadline_s:.0f}s")
        try:
            _seq, _w = turn.wait_turn_done(client, base, session_id, turn_id, remaining)
            return time.monotonic() - t0
        except TRANSIENT as exc:
            print(f"            transient {type(exc).__name__} from the tier; retrying", file=sys.stderr)
            time.sleep(2.0)


# -- the run ----------------------------------------------------------------------------------


def preflight(base: str, dsn: str) -> str | None:
    try:
        health = httpx.get(f"{base}/api/health", timeout=5.0).json()
        rows(dsn, "SELECT 1", ())
    except Exception as exc:  # noqa: BLE001
        return f"stack not up ({type(exc).__name__}: {exc}); run `make proto-up` first"
    if health.get("queue") == "NullQueue":
        return "the tier has no queue (NullQueue): nothing would run the turn"
    return None


def seed_session(args: argparse.Namespace) -> tuple[str, str, dict]:
    """Seed the fixture and open a session on it; ``(session_id, project_id, fixture meta)``."""
    fixture = seed.resolve_fixture(args.fixture)
    files = seed.plan_files(fixture)
    project_id = args.project_id or seed.default_project_id(fixture)
    meta = seed.fixture_meta(fixture)
    title = args.title or meta.get("name") or fixture.name
    rc = seed.seed(files, project_id=project_id, pg_dsn=args.pg_dsn, s3_endpoint=args.s3_endpoint)
    if rc != 0:
        raise RuntimeError(f"seed exited {rc}")
    r = httpx.post(f"{args.base}/api/sessions", json={"title": title, "project_id": project_id}, timeout=10.0)
    r.raise_for_status()
    return r.json()["id"], project_id, meta


def existing_session(args: argparse.Namespace) -> tuple[str, str, dict]:
    found = rows(args.pg_dsn, "SELECT project_id FROM sessions WHERE session_id = %s", (args.session,))
    if not found:
        raise RuntimeError(f"no session {args.session!r} in sessions")
    meta: dict = {}
    if args.fixture_given:
        meta = seed.fixture_meta(seed.resolve_fixture(args.fixture))
    return args.session, found[0][0], meta


def run(args: argparse.Namespace) -> int:
    problem = preflight(args.base, args.pg_dsn)
    if problem:
        print(f"demo: {problem}", file=sys.stderr)
        return 2

    try:
        session_id, project_id, meta = existing_session(args) if args.session else seed_session(args)
        prompt = opening_prompt(meta, args.prompt)
    except (FileNotFoundError, ValueError, RuntimeError, httpx.HTTPError) as exc:
        print(f"demo: {exc}", file=sys.stderr)
        return 2

    print(f"session_id  {session_id}")
    print(f"project_id  {project_id}")
    print(f"prompt      {prompt}")
    print()
    print(render_query("baseline: research.json section sizes before the turn", section_counts_sql(),
                       (project_id,), rows(args.pg_dsn, section_counts_sql(), (project_id,))))
    print()

    with httpx.Client(timeout=30.0) as client:
        try:
            turn_id = turn.post_message(client, args.base, session_id, prompt)
        except httpx.HTTPError as exc:
            print(f"demo: posting the prompt failed ({type(exc).__name__}: {exc}); is the queue up?", file=sys.stderr)
            return 2
        print(f"turn_id     {turn_id}  (posted; waiting up to {args.deadline_s:.0f}s for turn_done)")
        try:
            wall = wait_turn_done(client, args.base, session_id, turn_id, args.deadline_s)
            done = True
            print(f"turn_done   after {wall:.0f}s")
        except TimeoutError as exc:
            done = False
            print(f"turn_done   FAIL  {exc}  (the turn may still be running; re-run the queries below)")

    since, reply = reply_text(args.pg_dsn, session_id, turn_id)
    print()
    print("reply:")
    print(reply or "   (no text events yet)")
    print()
    nudged = rows(args.pg_dsn, "SELECT nudges FROM turns WHERE turn_id = %s", (turn_id,))
    print(nudges_line(nudged[0][0] if nudged else None, os.environ.get("AUTONOMOUS_MAX_NUDGES")))
    print()

    for label, sql, params in acceptance_queries(turn_id, session_id, project_id):
        print(render_query(label, sql, params, rows(args.pg_dsn, sql, params)))
        print()

    # This turn's rows only: on a reused --session a prior turn's Bash row must not fail this run.
    a = audit.audit([r for r in audit.load(args.pg_dsn, session_id) if r["turn_id"] == turn_id], anchor=args.anchor)
    print("-- criteria 3 and 4: proto/audit.py over this turn's tool_calls rows")
    print(audit.report(a, ceiling_s=args.ceiling_s, session_id=f"{session_id}, turn {turn_id}"))
    print()

    hits = reauth_hits(args.pg_dsn, session_id, since)
    if hits:
        print("VOID: a FamilySearch tool answered with the reconnect instruction (the token expired) --")
        print("      make proto-token, then a new session")
        for h in hits[:3]:
            print(f"      {h[:160]!r}")
        print()

    code = verdict(done, a.criterion_3_ok, bool(hits))
    print(f"demo: {'PASS' if code == 0 else 'FAIL'}  turn_done={done} criterion_3={'PASS' if a.criterion_3_ok else 'FAIL'} "
          f"reauth_hits={len(hits)}  (make proto-audit SESSION={session_id} re-runs criteria 3 and 4)")
    return code


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--fixture", default=None, help=f"e2e fixture name, scenario name, or a directory (default {DEFAULT_FIXTURE})")
    p.add_argument("--project-id", default=None, help="default proj_<fixture>_<6 hex>")
    p.add_argument("--title", default=None, help="session title; default the fixture's name")
    p.add_argument("--prompt", default=None, help="the opening prompt; default the fixture's researcher_question")
    p.add_argument("--session", default=None, help="drive this seeded session instead of seeding (proto/seed.py)")
    p.add_argument("--base", default="http://127.0.0.1:8085")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--s3-endpoint", default="http://localhost:9000")
    p.add_argument("--deadline-s", type=float, default=DEFAULT_DEADLINE_S, help="wall clock before turn_done is a FAIL")
    p.add_argument("--anchor", default="/project", help="the project anchor audit.py judges reads against")
    p.add_argument("--ceiling-s", type=float, default=1800.0, help="the per-call step ceiling for criterion 4")
    args = p.parse_args(argv)
    args.fixture_given = args.fixture is not None
    args.fixture = args.fixture or DEFAULT_FIXTURE
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
