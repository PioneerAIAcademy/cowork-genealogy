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
import os
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


# eval/.env holds ANTHROPIC_API_KEY (written by Setup.bat). The judge talks
# to the Anthropic API directly via the SDK, which reads ANTHROPIC_API_KEY
# from the process env — so without this the judge fails to authenticate
# and every run comes back verdict=skipped. The agent run itself uses the
# Claude Agent SDK's own auth and is unaffected, which is why the symptom
# is "agent ran, judge skipped". A key already set in the shell wins.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(env_file: Path = _ENV_FILE) -> None:
    """Load keys from eval/.env into os.environ without overriding the shell."""
    if not env_file.exists():
        return
    try:
        from dotenv import dotenv_values
    except ImportError:
        return
    for key, value in dotenv_values(env_file).items():
        if value is not None and not os.environ.get(key):
            os.environ[key] = value


def _list_fixture_dirs(fixtures_root: Path) -> list[Path]:
    return sorted(
        p for p in fixtures_root.iterdir()
        if p.is_dir() and (p / "fixture.json").exists()
    )


def _filter_by_tag(fixture_dirs: Iterable[Path], tag: str) -> list[Path]:
    """Keep fixtures whose tags contain the given tag value (any dimension)."""
    matched = []
    for d in fixture_dirs:
        meta = json.loads((d / "fixture.json").read_text(encoding="utf-8"))
        tag_values = set((meta.get("tags") or {}).values())
        if tag in tag_values:
            matched.append(d)
    return matched


def _print_proof_quality(result: E2eResult) -> None:
    """Surface the judge's advisory proof-quality grade directly under the
    verdict. The verdict is recall-only (did the final tree recover the
    answer), so a ``pass`` can hide a missing or weak proof conclusion — this
    line makes that visible. ``score`` is 1|2|3, or null (printed ``n/a``)
    when no proof_summary was written, e.g. proof-conclusion never completed.
    Advisory only: it never changes the verdict (judge_prompt.md Task 2)."""
    pq = (result.judge_output or {}).get("proof_quality")
    if not isinstance(pq, dict):
        return  # judge skipped or emitted no proof-quality block
    score = pq.get("score")
    if score is None:
        reason = (pq.get("rationale") or "no proof summary written").strip()
        if len(reason) > 100:
            reason = reason[:97] + "..."
        print(f"  proof_quality: n/a    ({reason})")
    else:
        print(
            f"  proof_quality: {score}/3    "
            f"exhaustiveness={pq.get('exhaustiveness')} "
            f"conflicts={pq.get('conflicts_addressed')} "
            f"corroboration={pq.get('corroboration')} "
            f"tier={pq.get('tier_appropriate')}"
        )


async def _run_one(fixture_dir: Path, **kwargs) -> E2eResult:
    print(f"\n=== Running {fixture_dir.name} ===")
    result, paths = await run_e2e_test(fixture_dir=fixture_dir, **kwargs)
    print(f"  verdict: {result.verdict}    stop_reason: {result.stop_reason}")
    _print_proof_quality(result)
    print(f"  result: {paths['result']}")
    if result.verdict != "pass":
        print(
            "  (scratch run — gitignored; only a passing run validates the "
            "fixture and is committed)"
        )
    return result


def main(argv: list[str] | None = None) -> int:
    load_env_file()  # make ANTHROPIC_API_KEY from eval/.env available to the judge
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
    parser.add_argument(
        "--resume-on-stall",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "On a no-progress stall (see progress_stall_seconds), tear down the "
            "hung query and resume the session — but only in a provably-safe "
            "state (no in-flight tool call), else fail fast. ON by default "
            "(the safe-state gate means the worst case is a clean fail-fast, "
            "not a double-applied write); pass --no-resume-on-stall to disable."
        ),
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
        "resume_on_stall": args.resume_on_stall,
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
