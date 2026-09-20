#!/usr/bin/env python3
"""Acceptance criteria 3 and 4 (docs/plan/search-agent-prototype.md, "Acceptance"), read
off a session's ``tool_calls`` rows -- the deny-and-log query as one command.

    uv run python proto/audit.py [--session <id>] [--pg-dsn ...] [--anchor /project] [--ceiling-s 1800]

Criterion 3: zero ``Bash`` rows that executed (pool removal means zero ``Bash`` rows at
all) and zero project-file reads the hook allowed; denied attempts are expected and
reported as their own count. Criterion 4: every completed call's duration, and the
longest against the step ceiling. An allowed row with no duration is a call that was in
flight when its attempt was killed, or one that never returned -- reported, not failed.
Exit 1 when criterion 3 fails; 2 when Postgres is unreachable.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass
from typing import Any

import psycopg

READ_TOOLS = frozenset({"Read", "Grep", "Glob"})
COLUMNS = ("turn_id", "agent_type", "tool_name", "input_path", "decision", "duration_ms")


@dataclass(frozen=True)
class Audit:
    rows: int
    bash_executed: int
    project_reads_allowed: int
    denied: dict[str, int]
    completed: int
    without_duration: int
    longest: tuple[str, int] | None
    p50_ms: int | None

    @property
    def criterion_3_ok(self) -> bool:
        return self.bash_executed == 0 and self.project_reads_allowed == 0


def under(path: str | None, anchor: str) -> bool:
    if not path:
        return False
    root = anchor.rstrip("/") or "/"
    return path == root or path.startswith(root + "/")


def audit(rows: list[dict[str, Any]], *, anchor: str) -> Audit:
    allowed = [r for r in rows if r.get("decision") == "allow"]
    durations = sorted(
        ((str(r.get("tool_name")), int(r["duration_ms"])) for r in allowed if r.get("duration_ms") is not None),
        key=lambda t: t[1],
    )
    return Audit(
        rows=len(rows),
        bash_executed=sum(1 for r in allowed if r.get("tool_name") == "Bash"),
        project_reads_allowed=sum(
            1 for r in allowed if r.get("tool_name") in READ_TOOLS and under(r.get("input_path"), anchor)
        ),
        denied=dict(Counter(str(r.get("tool_name")) for r in rows if r.get("decision") == "deny")),
        completed=len(durations),
        without_duration=len(allowed) - len(durations),
        longest=durations[-1] if durations else None,
        p50_ms=durations[len(durations) // 2][1] if durations else None,
    )


def load(dsn: str, session_id: str | None) -> list[dict[str, Any]]:
    sql = f"SELECT {', '.join(COLUMNS)} FROM tool_calls"
    params: tuple = ()
    if session_id:
        sql += " WHERE session_id = %s"
        params = (session_id,)
    with psycopg.connect(dsn) as conn:
        return [dict(zip(COLUMNS, row)) for row in conn.execute(sql + " ORDER BY id", params).fetchall()]


def report(a: Audit, *, ceiling_s: float, session_id: str | None) -> str:
    scope = f"session {session_id}" if session_id else "every session"
    lines = [
        f"tool_calls rows ({scope}): {a.rows}",
        "",
        f"criterion 3  Bash calls that executed            {a.bash_executed}",
        f"             project-file reads the hook allowed {a.project_reads_allowed}",
        f"             denied attempts                     {sum(a.denied.values())}"
        + (f"  ({', '.join(f'{k} {v}' for k, v in sorted(a.denied.items()))})" if a.denied else ""),
        f"             -> {'PASS' if a.criterion_3_ok else 'FAIL'}",
        "",
        f"criterion 4  completed calls with a duration     {a.completed}",
        f"             allowed calls without one           {a.without_duration}"
        + ("  (in flight at a kill, or never returned)" if a.without_duration else ""),
    ]
    if a.longest:
        name, ms = a.longest
        lines.append(f"             longest                             {ms} ms  {name}  (ceiling {ceiling_s:.0f} s)")
        lines.append(f"             p50                                 {a.p50_ms} ms")
        lines.append(f"             -> {'no call ran unbounded' if ms < ceiling_s * 1000 else 'a call reached the ceiling'}")
    else:
        lines.append("             -> no completed call carries a duration")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--session", default=None, help="session id; default: every session's rows")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--anchor", default="/project", help="the project anchor the reads are judged against")
    p.add_argument("--ceiling-s", type=float, default=1800.0)
    args = p.parse_args(argv)
    try:
        rows = load(args.pg_dsn, args.session)
    except psycopg.Error as exc:
        print(f"audit: postgres unreachable ({type(exc).__name__}: {exc}); run `make proto-up` first", file=sys.stderr)
        return 2
    a = audit(rows, anchor=args.anchor)
    print(report(a, ceiling_s=args.ceiling_s, session_id=args.session))
    return 0 if a.criterion_3_ok else 1


if __name__ == "__main__":
    sys.exit(main())
