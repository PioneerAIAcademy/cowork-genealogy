#!/usr/bin/env python3
"""Acceptance criteria 3 and 4 (docs/plan/search-agent-prototype.md, "Acceptance"), read
off a session's ``tool_calls`` rows -- the deny-and-log query as one command.

    uv run python proto/audit.py [--session <id>] [--turn <id>] [--pg-dsn ...] [--anchor /project] [--ceiling-s 1800]

Criterion 3: zero ``Bash`` rows that executed (pool removal means zero ``Bash`` rows at
all) and zero project-file reads the hook allowed; denied attempts are expected and
reported as their own count. Criterion 4: every completed call's duration, and the
longest against the step ceiling. An allowed row with no duration is a call that was in
flight when its attempt was killed, or one that never returned -- reported, not failed.
Beside them: allowed calls by tool (MCP prefixes stripped, the person_* tools always
listed) and every decision that is neither allow nor deny (``halt``, ``delivered``).
Exit 1 when criterion 3 fails; 2 when Postgres is unreachable.
"""

from __future__ import annotations

import argparse
import posixpath
import sys
from collections import Counter
from dataclasses import dataclass
from typing import Any

import psycopg

READ_TOOLS = frozenset({"Read", "Grep", "Glob"})
COLUMNS = ("turn_id", "agent_type", "tool_name", "input_path", "decision", "duration_ms")
PERSON_TOOLS = ("person_read", "person_search", "person_ancestors", "person_record_matches",
                "person_person_matches", "person_quality")


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
    allowed_by_tool: dict[str, int]
    other_decisions: dict[str, int]

    @property
    def criterion_3_ok(self) -> bool:
        return self.bash_executed == 0 and self.project_reads_allowed == 0


def under(path: str | None, anchor: str) -> bool:
    """Whether ``path`` lands inside ``anchor`` once ``..`` is folded; a relative path is
    resolved against the anchor, the agent's working directory."""
    if not path:
        return False
    # normpath keeps a leading ``//``, which the kernel reads as ``/``.
    root = "/" + posixpath.normpath(anchor).lstrip("/")
    full = "/" + posixpath.normpath(posixpath.join(root, path)).lstrip("/")
    return full == root or full.startswith(root.rstrip("/") + "/")


def bare(tool_name: str) -> str:
    """The tool's name under any MCP server spelling: ``mcp__<server>__person_read`` -> ``person_read``."""
    return tool_name.rsplit("__", 1)[-1] if tool_name.startswith("mcp__") else tool_name


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
        allowed_by_tool=dict(Counter(bare(str(r.get("tool_name"))) for r in allowed)),
        other_decisions=dict(Counter(str(d) for r in rows if (d := r.get("decision")) not in ("allow", "deny"))),
    )


def load(dsn: str, session_id: str | None, turn_id: str | None = None) -> list[dict[str, Any]]:
    sql = f"SELECT {', '.join(COLUMNS)} FROM tool_calls"
    where = [(col, val) for col, val in (("session_id", session_id), ("turn_id", turn_id)) if val]
    if where:
        sql += " WHERE " + " AND ".join(f"{col} = %s" for col, _ in where)
    params = tuple(val for _, val in where)
    with psycopg.connect(dsn) as conn:
        return [dict(zip(COLUMNS, row)) for row in conn.execute(sql + " ORDER BY id", params).fetchall()]


def report(a: Audit, *, ceiling_s: float, session_id: str | None, turn_id: str | None = None) -> str:
    scope = ", ".join(s for s in (session_id and f"session {session_id}", turn_id and f"turn {turn_id}") if s)
    scope = scope or "every session"
    person = ", ".join(f"{t} {a.allowed_by_tool.get(t, 0)}" for t in PERSON_TOOLS)
    others = ", ".join(f"{k} {v}" for k, v in sorted(a.allowed_by_tool.items()) if k not in PERSON_TOOLS)
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
    lines += [
        "",
        f"allowed by tool  {person}",
        f"                 {others or '(no other tool)'}",
        "other decisions  " + (", ".join(f"{k} {v}" for k, v in sorted(a.other_decisions.items())) or "none"),
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--session", default=None, help="session id; default: every session's rows")
    p.add_argument("--turn", default=None, help="turn id; narrows to that turn's rows")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--anchor", default="/project", help="the project anchor the reads are judged against")
    p.add_argument("--ceiling-s", type=float, default=1800.0)
    args = p.parse_args(argv)
    try:
        rows = load(args.pg_dsn, args.session, args.turn)
    except psycopg.Error as exc:
        print(f"audit: postgres unreachable ({type(exc).__name__}: {exc}); on compose run `make proto-up` "
              "first; on the rehearsal check the bastion's RDS forward and PGPASSFILE", file=sys.stderr)
        return 2
    a = audit(rows, anchor=args.anchor)
    print(report(a, ceiling_s=args.ceiling_s, session_id=args.session, turn_id=args.turn))
    return 0 if a.criterion_3_ok else 1


if __name__ == "__main__":
    sys.exit(main())
