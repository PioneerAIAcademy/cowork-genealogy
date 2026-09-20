#!/usr/bin/env python3
"""D18's artifact: one fixture graded on both sides -- the e2e harness's committed run and
the prototype worker's -- by one instrument, now.

    uv run python proto/compare.py --fixture <slug> --session <id> [--runlog <path>]
                                   [--out <dir>] [--model <id>] [--pg-dsn ...] [--s3-endpoint ...]

Both sides are graded by ``eval/harness/e2e/grade_files.py`` in this run, including the
harness's: the verdict sitting in a committed run log came from a judge call at another
time, on another judge build, and the whole point of the comparison is that one judge
grades both trees under the same conditions. The committed verdict is printed beside the
fresh one so a drift is visible rather than assumed away.

The harness side is a COMMITTED run -- ``eval/runlogs/e2e/<fixture>/run-*.json`` and its
``.final-tree.gedcomx.json`` / ``.final-research.json`` siblings, the latest by name
unless ``--runlog`` names one. It is not re-run here; its date is printed, and a
comparison against a run from another week is still useful so long as the reader knows.

Both sides are graded against the fixture's CURRENT expected findings, so the date those
were last committed is printed too: when they were amended after the harness ran, a
finding "only the prototype recovered" may be one the harness was never asked to find,
and the output says so.

Exit 0 when both sides graded; 1 when a grading failed; 2 when an input is missing (the
fixture, a run log, the session).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from proto import audit, export, grade  # noqa: E402

ROOT = export.ROOT
E2E_DIR = grade.E2E_DIR
RUNLOGS = ROOT / "eval" / "runlogs" / "e2e"

#: ``run-<YYYY-MM-DD>_<HH-MM-SS>.json`` -- a committed result, not its ``.ann.json`` or
#: ``.final-*`` siblings and not a ``scratch_`` log (which is what an ungradeable run is
#: written as; see eval/harness/e2e/result.py ``runlog_prefix``).
RUN_DATE = re.compile(r"^run-(\d{4}-\d{2}-\d{2})_")

#: The turn columns the prototype's record is built from. ``cost_usd`` and ``num_turns``
#: are the COMPLETING attempt's, so a turn resumed after a kill reports 0 for both.
TURN_COLUMNS = ("cost_usd", "num_turns", "duration_ms", "nudges")
TURNS_SQL = f"SELECT {', '.join(TURN_COLUMNS)} FROM turns WHERE session_id = %s ORDER BY enqueued_at"


@dataclass(frozen=True)
class Side:
    """One graded side of the comparison. Which side it is comes from the row it is
    rendered on, not from the object."""
    source: str
    verdict: str
    labels: dict[str, str] = field(default_factory=dict)
    record: str = "(no record)"
    committed_verdict: str | None = None


# -- pure seams ---------------------------------------------------------------------------


def is_result_json(path: Path) -> bool:
    """True for a committed ``run-<ts>.json``, excluding its siblings -- the same rule
    ``eval/harness/e2e/runlog_selection.py`` applies (duplicated, not imported: the
    harness is a separate environment)."""
    name = path.name
    return (
        name.startswith("run-")
        and name.endswith(".json")
        and not name.endswith(".ann.json")
        and ".final-" not in name
    )


def committed_runlogs(fixture: str, *, runlogs_root: Path = RUNLOGS) -> list[Path]:
    """Every committed run for the fixture, oldest first (the timestamp sorts by name)."""
    d = Path(runlogs_root) / fixture
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.is_file() and is_result_json(p))


def resolve_runlog(
    fixture: str, explicit: str | Path | None, *, runlogs_root: Path = RUNLOGS
) -> Path | None:
    """``--runlog`` when given (it must exist), else the latest committed run, else None."""
    if explicit:
        path = Path(explicit)
        return path if path.is_file() else None
    found = committed_runlogs(fixture, runlogs_root=runlogs_root)
    return found[-1] if found else None


def runlog_siblings(runlog: Path) -> tuple[Path, Path]:
    """``(final tree, final research)`` beside a committed run log."""
    stem = runlog.name[: -len(".json")]
    return (
        runlog.with_name(f"{stem}.final-tree.gedcomx.json"),
        runlog.with_name(f"{stem}.final-research.json"),
    )


def runlog_date(runlog: Path) -> str:
    """The run's date off its filename, so a comparison against an old run says so."""
    match = RUN_DATE.match(runlog.name)
    return match.group(1) if match else "(undated)"


#: An ISO date git prints with ``%cs``; anything else is not compared.
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def findings_changed(fixture: str, *, e2e_dir: Path = E2E_DIR, root: Path = ROOT) -> str:
    """The date the fixture's ``expected-findings.json`` was last committed, or
    ``(unknown)``.

    Both sides are graded against the CURRENT expected findings, so a finding amended or
    added after the harness ran lands in "only the prototype recovered" with nothing to
    say the harness was never asked to find it. 49 of the 105 fixtures with a committed
    run have findings committed after their latest run (measured 2026-09-20), and no
    committed run log carries the ``findings_hash`` that would settle it, so the dates
    are what there is.
    """
    path = Path(e2e_dir) / fixture / "expected-findings.json"
    try:
        rel = path.relative_to(root)
    except ValueError:
        rel = path
    try:
        proc = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", str(rel)],
            cwd=root, text=True, encoding="utf-8", capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return "(unknown)"
    out = proc.stdout.strip()
    return out if proc.returncode == 0 and ISO_DATE.match(out) else "(unknown)"


def amended_after(run_date: str, findings_date: str) -> bool:
    """True only when both are real dates and the findings are the later one. ISO dates
    sort as strings."""
    return bool(
        ISO_DATE.match(run_date) and ISO_DATE.match(findings_date) and findings_date > run_date
    )


AMENDED_WARNING = (
    "the fixture's expected findings were amended after this harness run; a finding only "
    "the prototype recovered may be one the harness was never asked to find."
)


def expected_findings(fixture: str, *, e2e_dir: Path = E2E_DIR) -> dict[str, Any] | None:
    path = Path(e2e_dir) / fixture / "expected-findings.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def labels_of(judge_output: dict[str, Any] | None) -> dict[str, str]:
    entries = (judge_output or {}).get("per_finding")
    if not isinstance(entries, list):
        return {}
    return {
        str(e.get("finding_id")): str(e.get("matched"))
        for e in entries
        if isinstance(e, dict)
    }


def ordered_rows(expected: dict[str, Any], *sides: Side | None) -> list[tuple[str, str]]:
    """``(finding_id, title)`` in fixture order, then any id a side graded that the
    fixture does not list -- a stray grade is shown, never dropped."""
    rows: list[tuple[str, str]] = []
    seen: set[str] = set()
    for finding in (expected.get("findings") or []):
        if not isinstance(finding, dict):
            continue
        fid = str(finding.get("id"))
        title = " ".join(str(finding.get("description") or "").split()) or "(no description)"
        rows.append((fid, title))
        seen.add(fid)
    for side in sides:
        for fid in sorted((side.labels if side else {})):
            if fid not in seen:
                seen.add(fid)
                rows.append((fid, "(not an expected finding -- graded anyway)"))
    return rows


def recovered(side: Side | None) -> set[str]:
    """The finding ids a side actually recovered -- ``matched: "true"`` only. A
    ``partial`` is shown in the table but is not a recovery."""
    return {fid for fid, label in (side.labels if side else {}).items() if label == "true"}


def _money(value: Any) -> str:
    try:
        return f"${float(value):.2f}"
    except (TypeError, ValueError):
        return "$?"


def _seconds(ms: Any) -> str:
    try:
        return f"{float(ms) / 1000:.0f} s"
    except (TypeError, ValueError):
        return "? s"


def _total(rows: list[tuple], index: int) -> Any:
    values = [r[index] for r in rows if r[index] is not None]
    return sum(values) if values else None


def harness_record(data: dict[str, Any]) -> str:
    """Cost, wall clock and tool calls, off a committed run log's own usage block."""
    usage = data.get("usage") or {}
    return (
        f"{_money(usage.get('total_cost_usd'))}  {_seconds(usage.get('duration_ms'))}  "
        f"{len(data.get('tool_calls') or [])} tool calls  "
        f"{usage.get('num_turns', '?')} SDK turns  {usage.get('continue_nudges', '?')} nudges"
    )


#: Appended to the prototype's record when a turn ran but recorded no cost. Without it
#: the row prints ``$0.00`` / ``0 SDK turns`` beside the harness's real figures and reads
#: as a 100% cost advantage, which is the one number the comparison exists to show.
UNDER_REPORTED = "  (cost/SDK turns under-reported: a resumed turn records its completing attempt only)"


def proto_record(turn_rows: list[tuple], tool_call_rows: list[dict[str, Any]]) -> str:
    """The same four numbers off the prototype's own rows: ``turns`` summed over the
    session, and ``tool_calls`` counted. ``cost_usd`` and ``num_turns`` are each turn's
    COMPLETING attempt, so a turn resumed after a kill reports **0** for both -- not NULL,
    so they render as ``$0.00`` and ``0 SDK turns`` rather than ``$?``. A row with a
    duration and no cost is marked on the line itself."""
    a = audit.audit(tool_call_rows, anchor="/project")
    cost = _total(turn_rows, 0)
    turns = _total(turn_rows, 1)
    line = (
        f"{_money(cost)}  {_seconds(_total(turn_rows, 2))}  "
        f"{a.rows} tool calls  {turns if turns is not None else '?'} SDK turns  "
        f"{_total(turn_rows, 3) if _total(turn_rows, 3) is not None else '?'} nudges"
    )
    return line + UNDER_REPORTED if any(r[2] and not r[0] for r in turn_rows) else line


#: A committed run log records ``agent_model`` but not which judge model graded it, so a
#: disagreement cannot be attributed to a changed judge pin rather than to judge sampling.
DISAGREES = "  <- the fresh grading DISAGREES (the run log does not record which judge model graded it)"


def render(fixture: str, expected: dict[str, Any], harness: Side | None, proto: Side | None) -> str:
    """The D18 table: a row per expected finding with each side's label, then the summary."""
    pairs = (("harness", harness), ("prototype", proto))
    lines = [f"fixture     {fixture}"]
    for name, side in pairs:
        lines.append(f"{name:<10}  {side.source if side else '(not graded)'}")
    lines.append("")

    rows = ordered_rows(expected, harness, proto)
    header = f"{'finding':<10}  {'harness':<12}  {'prototype':<12}  title"
    lines.append(header)
    lines.append("-" * len(header))
    if not rows:
        lines.append("(the fixture lists no expected findings)")
    for fid, title in rows:
        h = (harness.labels if harness else {}).get(fid, "-")
        p = (proto.labels if proto else {}).get(fid, "-")
        lines.append(f"{fid:<10}  {h:<12}  {p:<12}  {title}")
    lines.append("-" * len(header))
    lines.append(
        f"{'verdict':<10}  {(harness.verdict if harness else '-'):<12}  "
        f"{(proto.verdict if proto else '-')}"
    )
    for name, side in pairs:
        if side is None:
            continue
        lines.append(f"{'record':<10}  {name:<12}  {side.record}")
        if side.committed_verdict is not None:
            lines.append(
                f"{'':<10}  {'':<12}  its own log recorded verdict {side.committed_verdict!r}"
                f"{'' if side.committed_verdict == side.verdict else DISAGREES}"
            )
    lines.append("")

    h_only = sorted(recovered(harness) - recovered(proto))
    p_only = sorted(recovered(proto) - recovered(harness))
    lines.append(f"only the harness recovered:    {', '.join(h_only) if h_only else '(none)'}")
    lines.append(f"only the prototype recovered:  {', '.join(p_only) if p_only else '(none)'}")
    return "\n".join(lines)


# -- postgres -----------------------------------------------------------------------------


def turn_rows(dsn: str, session_id: str) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute(TURNS_SQL, (session_id,)).fetchall()


# -- the run ------------------------------------------------------------------------------


def read_judge_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def grade_side(
    fixture: str, tree: Path, research: Path | None, json_out: Path, *, model: str | None, label: str
) -> dict[str, Any] | None:
    """Run the harness grader on one side's files; None when it did not produce a grading."""
    print(f"-- grading the {label} side")
    proc = grade.run_grade_files(
        grade.grade_files_argv(fixture, tree, research, json_out=json_out, model=model)
    )
    print()
    return read_judge_json(json_out) if proc.returncode == 0 else None


def run(args: argparse.Namespace) -> int:
    expected = expected_findings(args.fixture)
    if expected is None:
        print(f"compare: no fixture {args.fixture!r} under {E2E_DIR}", file=sys.stderr)
        return 2

    # RUNLOGS by name, not as a default argument: the default binds at import and the
    # tests point this at a temp corpus.
    runlog = resolve_runlog(args.fixture, args.runlog, runlogs_root=RUNLOGS)
    if runlog is None:
        where = args.runlog or (RUNLOGS / args.fixture)
        print(
            f"compare: no committed harness run to compare against ({where}). "
            f"Pass RUNLOG=<path> to name one, or run the fixture through `make e2e-run`.",
            file=sys.stderr,
        )
        return 2
    h_tree, h_research = runlog_siblings(runlog)
    if not h_tree.is_file():
        print(f"compare: {runlog.name} has no {h_tree.name} beside it; nothing to grade", file=sys.stderr)
        return 2

    # Read the log before anything is graded: an explicit --runlog is only checked here,
    # and a mistyped path would otherwise grade another fixture's tree against this
    # fixture's findings and render it as the harness side.
    committed = json.loads(runlog.read_text(encoding="utf-8"))
    if args.runlog and str(committed.get("test_id")) != args.fixture:
        print(
            f"compare: {runlog.name} is a run of {committed.get('test_id')!r}, not {args.fixture!r}",
            file=sys.stderr,
        )
        return 2

    try:
        project_id = export.resolve_project(args.pg_dsn, args.session)
    except psycopg.Error as exc:
        print(f"compare: postgres unreachable ({type(exc).__name__}: {exc}); run `make proto-up` first", file=sys.stderr)
        return 2
    if project_id is None:
        print(f"compare: no session {args.session!r} in sessions", file=sys.stderr)
        return 2

    out_dir = Path(args.out).resolve()
    judge_dir = out_dir / f"compare-{args.fixture}"
    judge_dir.mkdir(parents=True, exist_ok=True)
    p_tree, p_research = grade.exported_documents(out_dir, project_id)

    run_date = runlog_date(runlog)
    findings_date = findings_changed(args.fixture)
    print(f"fixture     {args.fixture}  (expected findings last changed {findings_date})")
    print(f"harness     {runlog}  (run {run_date}; committed, not re-run here)")
    print(f"prototype   {args.session}  ->  {project_id}")
    print(f"judge json  {judge_dir}")
    print()

    if export.export(project_id, out_dir=out_dir, pg_dsn=args.pg_dsn, s3_endpoint=args.s3_endpoint):
        print("compare: the prototype export failed; nothing to grade on that side", file=sys.stderr)
        return 1
    print()

    h_out = grade_side(
        args.fixture, h_tree, h_research if h_research.is_file() else None,
        judge_dir / "harness.judge.json", model=args.model, label="harness",
    )
    p_out = grade_side(
        args.fixture, p_tree, p_research if p_research.is_file() else None,
        judge_dir / "prototype.judge.json", model=args.model, label="prototype",
    )

    harness_side = None if h_out is None else Side(
        source=f"{runlog.name}  (run {runlog_date(runlog)}, committed)",
        verdict=str(h_out.get("verdict") or "?"),
        labels=labels_of(h_out),
        record=harness_record(committed),
        committed_verdict=str((committed.get("judge_output") or {}).get("verdict") or "?"),
    )
    proto_side = None if p_out is None else Side(
        source=f"{args.session}  ->  {project_id}",
        verdict=str(p_out.get("verdict") or "?"),
        labels=labels_of(p_out),
        record=proto_record(
            turn_rows(args.pg_dsn, args.session),
            audit.load(args.pg_dsn, args.session),
        ),
    )

    print(render(args.fixture, expected, harness_side, proto_side))
    print()
    if amended_after(run_date, findings_date):
        print(f"CAVEAT: {AMENDED_WARNING}")
        print()
    if not (harness_side and proto_side):
        ungraded = [
            name for name, side in (("harness", harness_side), ("prototype", proto_side))
            if side is None
        ]
        print(
            f"NOT a comparison: the {' and '.join(ungraded)} "
            f"{'side' if len(ungraded) == 1 else 'sides'} produced no grading, so nothing"
        )
        print("above puts two gradings side by side. The error is above; re-run once fixed.")
        return 1
    print("Both sides were graded by eval/harness/e2e/grade_files.py in this run. The harness")
    print("side is a committed run log, not a fresh research run -- re-run it with")
    print(f"`make e2e-run TEST={args.fixture}` if a same-week comparison is wanted.")
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--fixture", required=True, help="e2e fixture slug, graded on both sides")
    p.add_argument("--session", required=True, help="the prototype session to grade (proto/demo.py)")
    p.add_argument("--runlog", default=None, help="a committed run log; default the fixture's latest")
    p.add_argument("--out", default=str(export.DEFAULT_OUT), help=f"parent of <project_id>/ (default {export.DEFAULT_OUT})")
    p.add_argument("--model", default=None, help="judge model for BOTH sides; default the fixture's")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--s3-endpoint", default="http://localhost:9000")
    return run(p.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
