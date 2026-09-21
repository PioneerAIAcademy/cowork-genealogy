#!/usr/bin/env python3
"""D18: grade a prototype session's project with the e2e harness's own judge.

    uv run python proto/grade.py --session <id> [--fixture <slug>] [--out <dir>]
                                 [--json <path>] [--model <id>] [--pg-dsn ...] [--s3-endpoint ...]

The session's project is exported to files by ``export.py`` (the same export ``make
proto-export`` runs -- not a second copy of it), then handed to
``eval/harness/e2e/grade_files.py``, which loads the fixture through the orchestrator's
own loader and runs ``run_judge`` + ``apply_avoid_guard`` exactly as a harness run does.

``apps/server`` and ``eval/harness`` are separate environments -- the harness pins the
Agent SDK and the Anthropic SDK, this one does not -- so the harness module is a
subprocess in *its* venv (``cd eval/harness && uv run python -m e2e.grade_files ...``),
the same reason ``seed.py`` shells to ``npx tsx``.

Without ``--fixture`` the slug is derived from the project id: ``proto-seed`` names
projects ``proj_<fixture>_<6 hex>``. A project named any other way, or one whose slug
names no fixture, is refused with the ``--fixture`` to pass instead.

Exit codes are ``grade_files``' own (0 whatever the verdict, 1 when the judge failed,
2 on a missing input); 2 when the session is unknown, Postgres is unreachable or the
fixture cannot be derived; 1 when the export fails.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

import psycopg

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from proto import export, seed  # noqa: E402

ROOT = export.ROOT
HARNESS_DIR = ROOT / "eval" / "harness"
E2E_DIR = seed.E2E_DIR

#: ``seed.default_project_id``: ``proj_`` + the fixture directory's name (sanitised,
#: truncated to 32) + ``_`` + 6 hex. The slug is cut at the LAST ``_<6 hex>``, so a
#: fixture name that itself contains one (``deed_abc123``) keeps it -- greedy ``.+`` and
#: the ``$`` each do that on their own, and only dropping BOTH cuts it at the first. What
#: ``$`` alone binds is the tail: without it ``proj_<slug>_<6 hex><junk>`` is taken as a
#: project id. ``^`` binds nothing under ``.match()``. (Measured, not read off the
#: pattern: mutations M13, M13b and L5.)
PROJECT_ID = re.compile(r"^proj_(?P<slug>.+)_[0-9a-f]{6}$")


def derive_fixture(project_id: str, *, e2e_dir: Path = E2E_DIR) -> str | None:
    """The e2e fixture slug a ``proto-seed`` project id names, or None.

    None covers all three refusals: an id that is not ``proj_<slug>_<6 hex>`` at all, one
    whose slug names no fixture directory (a unit scenario, a hand-picked ``--project-id``),
    and one whose slug was truncated at 32 characters by ``seed.default_project_id``.
    """
    match = PROJECT_ID.match(project_id or "")
    if not match:
        return None
    slug = match.group("slug")
    return slug if (Path(e2e_dir) / slug / "fixture.json").is_file() else None


def grade_files_argv(
    fixture: str,
    tree: Path,
    research: Path | None = None,
    *,
    json_out: Path | None = None,
    model: str | None = None,
) -> list[str]:
    """The harness command, run from ``eval/harness`` in the harness's own venv."""
    argv = ["uv", "run", "python", "-m", "e2e.grade_files", "--fixture", fixture, "--tree", str(tree)]
    if research is not None:
        argv += ["--research", str(research)]
    if json_out is not None:
        argv += ["--json", str(json_out)]
    if model:
        argv += ["--model", model]
    return argv


def run_grade_files(argv: list[str], *, echo: bool = True) -> subprocess.CompletedProcess:
    """Run the harness module in its own environment; relay its output."""
    proc = subprocess.run(
        argv, cwd=HARNESS_DIR, text=True, encoding="utf-8", capture_output=True,
    )
    if echo:
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
    return proc


def exported_documents(out_dir: Path, project_id: str) -> tuple[Path, Path]:
    """``(tree, research)`` where ``export.py`` lands a project's two documents."""
    project_dir = export.export_dir(out_dir, project_id)
    return project_dir / "tree.gedcomx.json", project_dir / "research.json"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--session", required=True, help="the web-tier session id (proto/seed.py, proto/demo.py)")
    p.add_argument("--fixture", default=None, help="e2e fixture slug; default derived from the project id")
    p.add_argument("--out", default=str(export.DEFAULT_OUT), help=f"parent of <project_id>/ (default {export.DEFAULT_OUT})")
    p.add_argument("--json", dest="json_out", default=None, help="write the raw judge output here")
    p.add_argument("--model", default=None, help="judge model; default the fixture's")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--s3-endpoint", default="http://localhost:9000")
    args = p.parse_args(argv)

    try:
        project_id = export.resolve_project(args.pg_dsn, args.session)
    except psycopg.Error as exc:
        print(f"grade: postgres unreachable ({type(exc).__name__}: {exc}); run `make proto-up` first", file=sys.stderr)
        return 2
    if project_id is None:
        print(f"grade: no session {args.session!r} in sessions", file=sys.stderr)
        return 2

    fixture = args.fixture or derive_fixture(project_id)
    if not fixture:
        print(
            f"grade: cannot tell which fixture {project_id!r} came from (proto-seed names projects "
            f"proj_<fixture>_<6 hex>, and the slug must name a directory under {E2E_DIR}); "
            f"pass FIXTURE=<slug>",
            file=sys.stderr,
        )
        return 2

    out_dir = Path(args.out).resolve()
    tree, research = exported_documents(out_dir, project_id)
    print(f"session_id  {args.session}")
    print(f"project_id  {project_id}")
    print(f"fixture     {fixture}{'' if args.fixture else '  (derived from the project id)'}")
    print(f"tree        {tree}")
    print(f"research    {research}")
    print()

    if export.export(project_id, out_dir=out_dir, pg_dsn=args.pg_dsn, s3_endpoint=args.s3_endpoint):
        print("grade: the export failed; nothing to grade", file=sys.stderr)
        return 1
    print()

    return run_grade_files(
        grade_files_argv(
            fixture, tree, research,
            json_out=Path(args.json_out) if args.json_out else None,
            model=args.model,
        )
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
