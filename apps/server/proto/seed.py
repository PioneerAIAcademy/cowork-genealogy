#!/usr/bin/env python3
"""D17 prep: load a fixture's project into the prototype's Postgres/S3 store and open a
web-tier session on it, so a real run starts from a known research.json and tree.

    uv run python proto/seed.py --fixture bagley-father-1884 [--project-id proj_x] [--title ...]
                                [--base http://127.0.0.1:8085] [--pg-dsn ...] [--s3-endpoint ...]

``--fixture`` names an e2e fixture (``eval/tests/e2e/<name>``: ``starting-research.json``
and ``starting-tree.gedcomx.json`` become ``research.json`` and ``tree.gedcomx.json``; the
expectations, the unstripped tree and the notes stay behind), a unit scenario
(``eval/fixtures/scenarios/<name>``: ``research.json``, ``tree.gedcomx.json``, ``results/``,
``images/``), or a directory in either layout. The files go through
``PgS3ProjectStore`` (``dev/seed-project.ts``, the same writes the tools make) and the
session comes from ``POST /api/sessions`` with the project id, so the SPA lists it.
Prints the session id and, for an e2e fixture, its research question -- the opening
prompt for the run.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
ENGINE_DIR = ROOT / "packages" / "engine" / "mcp-server"
E2E_DIR = ROOT / "eval" / "tests" / "e2e"
SCENARIO_DIR = ROOT / "eval" / "fixtures" / "scenarios"
ANCHOR = "/project"

E2E_RENAMES = {"starting-research.json": "research.json", "starting-tree.gedcomx.json": "tree.gedcomx.json"}
E2E_SKIP = frozenset({"expected-findings.json", "fixture.json", "README.md"})
SCENARIO_SKIP = frozenset({"README.md"})


def resolve_fixture(name: str, *, e2e_dir: Path = E2E_DIR, scenario_dir: Path = SCENARIO_DIR) -> Path:
    """A directory as given, else ``<e2e>/<name>``, else ``<scenarios>/<name>``."""
    p = Path(name)
    if p.is_dir():
        return p.resolve()
    for base in (e2e_dir, scenario_dir):
        if (base / name).is_dir():
            return (base / name).resolve()
    raise FileNotFoundError(f"no fixture {name!r}: not a directory, not under {e2e_dir} or {scenario_dir}")


def plan_files(fixture: Path) -> list[tuple[str, Path]]:
    """``(ref, path)`` for every project file the fixture holds, in ref order. An e2e
    fixture is recognised by its ``starting-research.json``."""
    e2e = (fixture / "starting-research.json").is_file()
    out: list[tuple[str, Path]] = []
    for path in sorted(p for p in fixture.rglob("*") if p.is_file()):
        rel = path.relative_to(fixture).as_posix()
        if any(part.startswith(".") or part == "__pycache__" for part in rel.split("/")):
            continue
        if e2e:
            if rel in E2E_SKIP or rel.startswith("unstripped-"):
                continue
            rel = E2E_RENAMES.get(rel, rel)
        elif rel in SCENARIO_SKIP:
            continue
        out.append((rel, path))
    if not any(ref == "research.json" for ref, _ in out):
        raise ValueError(f"{fixture}: no research.json (or starting-research.json) to seed")
    return sorted(out)


def fixture_meta(fixture: Path) -> dict:
    meta = fixture / "fixture.json"
    if meta.is_file():
        try:
            return json.loads(meta.read_text(encoding="utf-8"))
        except ValueError:
            return {}
    return {}


def default_project_id(fixture: Path) -> str:
    stem = "".join(c if c.isalnum() or c in "._-" else "-" for c in fixture.name)[:32]
    return f"proj_{stem}_{uuid.uuid4().hex[:6]}"


def seed(files: list[tuple[str, Path]], *, project_id: str, pg_dsn: str, s3_endpoint: str) -> int:
    manifest = {"projectId": project_id, "anchorPath": ANCHOR,
                "files": [{"ref": ref, "path": str(path)} for ref, path in files]}
    env = {**os.environ, "PROTO_PG_DSN": pg_dsn, "PROTO_S3_ENDPOINT": s3_endpoint}
    proc = subprocess.run(
        ["npx", "tsx", "dev/seed-project.ts"], cwd=ENGINE_DIR, input=json.dumps(manifest),
        text=True, encoding="utf-8", env=env, capture_output=True,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--fixture", required=True, help="e2e fixture name, scenario name, or a directory")
    p.add_argument("--project-id", default=None, help="default proj_<fixture>_<6 hex>")
    p.add_argument("--title", default=None, help="session title; default the fixture's name")
    p.add_argument("--base", default="http://127.0.0.1:8085")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--s3-endpoint", default="http://localhost:9000")
    args = p.parse_args(argv)

    try:
        fixture = resolve_fixture(args.fixture)
        files = plan_files(fixture)
    except (FileNotFoundError, ValueError) as exc:
        print(f"seed: {exc}", file=sys.stderr)
        return 2
    project_id = args.project_id or default_project_id(fixture)
    meta = fixture_meta(fixture)
    title = args.title or meta.get("name") or fixture.name

    try:
        httpx.get(f"{args.base}/api/health", timeout=5.0).raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"seed: web tier not up at {args.base} ({type(exc).__name__}: {exc}); run `make proto-up` first",
              file=sys.stderr)
        return 2

    rc = seed(files, project_id=project_id, pg_dsn=args.pg_dsn, s3_endpoint=args.s3_endpoint)
    if rc != 0:
        return rc
    r = httpx.post(f"{args.base}/api/sessions", json={"title": title, "project_id": project_id}, timeout=10.0)
    r.raise_for_status()
    session = r.json()
    print()
    print(f"session_id  {session['id']}")
    print(f"project_id  {project_id}")
    print(f"title       {title}")
    if meta.get("researcher_question"):
        print(f"prompt      {meta['researcher_question']}")
    print("open the SPA (make web-proto, http://127.0.0.1:5173) and pick the session by title")
    return 0


if __name__ == "__main__":
    sys.exit(main())
