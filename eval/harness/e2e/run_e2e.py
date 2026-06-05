"""CLI entry point for the e2e harness.

Usage (run from eval/harness/):

  uv run python -m e2e.run_e2e --test <fixture-id>
  uv run python -m e2e.run_e2e --tag <tag>

Or from the repo root with PYTHONPATH set:

  PYTHONPATH=eval/harness python -m e2e.run_e2e --test <fixture-id>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Iterable

from e2e.orchestrator import (
    DEFAULT_FIXTURES_ROOT,
    DEFAULT_MCP_SERVER_ENTRY,
    DEFAULT_PLUGIN_SKILLS,
    DEFAULT_RUNLOG_ROOT,
    run_e2e_test,
)
from e2e.report import print_rollup
from e2e.result import E2eResult


def _list_fixture_dirs(fixtures_root: Path) -> list[Path]:
    return sorted(
        p for p in fixtures_root.iterdir()
        if p.is_dir() and (p / "fixture.json").exists()
    )


def _filter_by_tag(fixture_dirs: Iterable[Path], tag: str) -> list[Path]:
    """Keep fixtures whose tags contain the given tag value (any dimension)."""
    matched = []
    for d in fixture_dirs:
        meta = json.loads((d / "fixture.json").read_text())
        tag_values = set((meta.get("tags") or {}).values())
        if tag in tag_values:
            matched.append(d)
    return matched


async def _run_one(fixture_dir: Path, **kwargs) -> E2eResult:
    print(f"\n=== Running {fixture_dir.name} ===")
    result, paths = await run_e2e_test(fixture_dir=fixture_dir, **kwargs)
    print(f"  verdict: {result.verdict}    stop_reason: {result.stop_reason}")
    print(f"  result: {paths['result']}")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.run_e2e",
        description="Run one or more e2e tests against the GPS research flow.",
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--test", help="Fixture id (slug) under eval/tests/e2e/")
    target.add_argument("--tag", help="Run fixtures with this tag value (any dimension)")
    parser.add_argument(
        "--fixtures-root",
        type=Path,
        default=DEFAULT_FIXTURES_ROOT,
        help=f"Default: {DEFAULT_FIXTURES_ROOT}",
    )
    parser.add_argument(
        "--runlog-root",
        type=Path,
        default=DEFAULT_RUNLOG_ROOT,
        help=f"Default: {DEFAULT_RUNLOG_ROOT}",
    )
    parser.add_argument(
        "--mcp-server-entry",
        type=Path,
        default=DEFAULT_MCP_SERVER_ENTRY,
        help=f"Path to the built MCP server. Default: {DEFAULT_MCP_SERVER_ENTRY}",
    )
    parser.add_argument(
        "--skills-dir",
        type=Path,
        default=DEFAULT_PLUGIN_SKILLS,
        help=f"Default: {DEFAULT_PLUGIN_SKILLS}",
    )
    parser.add_argument(
        "--skip-judge",
        action="store_true",
        help="Skip the judge step (writes result with verdict=skipped)",
    )
    args = parser.parse_args(argv)

    fixtures_root: Path = args.fixtures_root
    if not fixtures_root.exists():
        print(f"Fixtures root does not exist: {fixtures_root}", file=sys.stderr)
        return 2

    if args.test:
        fixture_dirs = [fixtures_root / args.test]
        if not fixture_dirs[0].exists():
            print(f"Fixture not found: {fixture_dirs[0]}", file=sys.stderr)
            return 2
    else:  # --tag
        fixture_dirs = _filter_by_tag(_list_fixture_dirs(fixtures_root), args.tag)

    if not fixture_dirs:
        print("No fixtures matched.", file=sys.stderr)
        return 2

    kwargs = {
        "runlog_root": args.runlog_root,
        "mcp_server_entry": args.mcp_server_entry,
        "skills_dir": args.skills_dir,
        "skip_judge": args.skip_judge,
    }

    results: list[E2eResult] = []
    for fixture_dir in fixture_dirs:
        try:
            result = asyncio.run(_run_one(fixture_dir, **kwargs))
            results.append(result)
        except KeyboardInterrupt:
            print("\nInterrupted.", file=sys.stderr)
            return 130
        except Exception as e:  # noqa: BLE001 — keep the suite running
            print(f"  ERROR: {type(e).__name__}: {e}", file=sys.stderr)

    print()
    print_rollup(results)
    # Exit nonzero if any test failed or aborted.
    failed = sum(1 for r in results if r.verdict in {"fail", "skipped"})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
