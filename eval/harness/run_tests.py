"""Harness CLI entry point per unit-test-spec.md and the user's CLI spec.

Selection modes (mutually exclusive except --tag, which repeats):
  --test <id>     Run a single test by ut_ id
  --skill <name>  Run every test under eval/tests/unit/<skill>/
  --all           Run every test in eval/tests/unit/
  --tag <name>    Repeat to AND-filter; selects across the whole corpus

Exit codes:
  0  every selected test resolved to pass / partial / xfail
  1  the harness itself crashed, OR any test resolved to fail or xpass
  2  any test was aborted via `not_runnable` (test corpus issue)
  3  any test was aborted for an execution reason
     (max_turns / wall clock / tool calls / tokens / error)

No-args invocation prints help and exits 0.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Iterator

from harness.auth import AuthError, resolve_auth
from harness.loader import InvalidTestError, TestSpec, load_test
from harness.orchestrator import (
    OrchestratorPaths,
    REPO_ROOT,
    run_one_test,
)
from harness.runlog import write_run_log


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_tests.py",
        description=(
            "GeneFun unit-test harness. Run a single test, a single skill, "
            "the whole suite, or every test matching a tag.\n\n"
            "Note: tests run serially in v1. At ~30s/test the full suite "
            "(230-460 tests) takes 2-4 hours. Parallel execution lands in v2; "
            "until then use --skill or --tag to scope CI gates appropriately."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument(
        "--test", help="Run the single test with this ut_ id."
    )
    selection.add_argument(
        "--skill", help="Run every test under eval/tests/unit/<skill>/."
    )
    selection.add_argument(
        "--all",
        action="store_true",
        help="Run every test in the suite.",
    )
    parser.add_argument(
        "--tag",
        action="append",
        default=[],
        help="Filter by tag. May be repeated; all tags must match (AND).",
    )
    parser.add_argument(
        "--tests-dir",
        type=Path,
        default=None,
        help="Override the tests directory (default: <repo>/eval/tests/unit).",
    )
    parser.add_argument(
        "--runlogs-root",
        type=Path,
        default=None,
        help=(
            "Override the run-log output root (default: <repo>/eval/runlogs). "
            "Useful for ephemeral runs that shouldn't pollute the checked-in "
            "tree."
        ),
    )
    parser.add_argument(
        "--max-cost-usd",
        type=float,
        default=50.0,
        help="Suite-level budget cap in USD. Remaining tests are skipped when "
        "cumulative cost exceeds this. Default: 50.",
    )
    parser.add_argument(
        "--max-wall-clock-seconds",
        type=int,
        default=14400,
        help="Suite-level wall-clock cap in seconds. Default: 14400 (4 hours).",
    )
    return parser


def _select_tests(args, tests_dir: Path) -> list[TestSpec]:
    """Translate CLI flags into a list of TestSpecs."""
    if args.test:
        return _find_by_id(args.test, tests_dir)

    if args.skill:
        return _collect_specs(tests_dir / args.skill, tags=args.tag)

    if args.all or args.tag:
        return _collect_specs(tests_dir, tags=args.tag)

    return []


def _iter_test_files(root: Path) -> Iterator[Path]:
    if not root.exists():
        return
    for path in sorted(root.rglob("*.json")):
        if path.name == "rubric.md":
            continue
        yield path


def _collect_specs(root: Path, *, tags: list[str]) -> list[TestSpec]:
    out: list[TestSpec] = []
    for path in _iter_test_files(root):
        try:
            spec = load_test(path)
        except InvalidTestError as e:
            print(f"  ! skipping {path.relative_to(REPO_ROOT)}: {e}", file=sys.stderr)
            continue
        if tags and not all(t in spec.tags for t in tags):
            continue
        out.append(spec)
    return out


def _find_by_id(test_id: str, root: Path) -> list[TestSpec]:
    for path in _iter_test_files(root):
        try:
            spec = load_test(path)
        except InvalidTestError:
            continue
        if spec.id == test_id:
            return [spec]
    return []


def _format_path(path: Path) -> str:
    """Render a run-log path relative to REPO_ROOT when possible, absolute
    otherwise. Custom --runlogs-root values can sit outside the repo
    (e.g., a tmp dir in tests); calling .relative_to(REPO_ROOT) on those
    would raise."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _print_summary(rows: list[dict]) -> None:
    print()
    print(f"{'TEST ID':<40} {'SKILL':<24} {'OUTCOME':<10} RUN LOG")
    print("-" * 96)
    for row in rows:
        print(
            f"{row['test_id']:<40} {row['skill']:<24} {row['outcome']:<10} {row['path']}"
        )
    print()


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    argv = sys.argv[1:] if argv is None else argv

    if not argv:
        parser.print_help()
        return 0

    args = parser.parse_args(argv)

    tests_dir = args.tests_dir or (REPO_ROOT / "eval/tests/unit")
    paths_kwargs = {"tests_dir": tests_dir}
    if args.runlogs_root is not None:
        paths_kwargs["runlogs_root"] = args.runlogs_root
    paths = OrchestratorPaths(**paths_kwargs)

    specs = _select_tests(args, tests_dir)
    if not specs:
        # Treat empty selection as a corpus issue (exit 2). A typo in
        # --skill or --tag would otherwise silently green a CI gate.
        print(
            "No tests matched the selection. Check --test / --skill / --tag.",
            file=sys.stderr,
        )
        return 2

    try:
        auth = resolve_auth()
    except AuthError as e:
        print(f"Auth error: {e}", file=sys.stderr)
        return 1

    print(f"Auth: {auth.detail}")
    # SDK-version probe (spec §15 known-risks): permission_mode="dontAsk"
    # has to be re-verified per SDK release.
    from harness.skill_runner import _check_sdk_version
    if (sdk_warning := _check_sdk_version()):
        print(f"  WARNING: {sdk_warning}", file=sys.stderr)
    if auth.skill_runner_mode == "subscription" and not auth.api_key:
        print(
            "  WARNING: subscription mode is selected for skill execution, "
            "but the judge layer needs ANTHROPIC_API_KEY to run.\n"
            "  Set ANTHROPIC_API_KEY in your environment or in "
            "eval/.env before the suite finishes — otherwise every test\n"
            "  will end with the judge skipped and outcomes only reflect "
            "validators.",
            file=sys.stderr,
        )
    # Large-suite variance warning: temperature=0 isn't exposed by the
    # current claude-agent-sdk, so model nondeterminism leaks into single-
    # run outcomes. Mostly fine for PR gates; matters for description-
    # optimizer / golden-set work where pass-rate deltas drive decisions.
    if args.all and len(specs) > 20:
        print(
            "  NOTE: temperature=0 is not enforceable on the current SDK; "
            "single-run variance is unavoidable. For description-optimizer "
            "passes or golden-set calibration, bump runs_per_test on the "
            "tests being scored (spec §7).",
            file=sys.stderr,
        )
    print(f"Running {len(specs)} test(s)...")
    print()

    rows: list[dict] = []
    saw_not_runnable = False
    saw_exec_abort = False
    saw_fail_or_xpass = False
    saw_budget_skip = False

    suite_start = time.perf_counter()
    cumulative_cost = 0.0
    # Conservative seed for the median estimator before any test has run.
    # The wiki-lookup e2e runs at ~$0.08; using $0.10 errs on the high side
    # so the pre-check is unlikely to greenlight a multi-run that would
    # blow past the cap.
    _SEED_AVG_COST_USD = 0.10
    # Track per-test costs so we can use the median over the last K runs
    # for the projection. A cumulative mean was vulnerable to one early
    # outlier extrapolating high enough to stall the whole suite; median
    # is robust to that.
    _COST_WINDOW = 5
    recent_costs: list[float] = []

    for spec in specs:
        elapsed = time.perf_counter() - suite_start
        # Estimate the next test's cost as runs_per_test × median(recent K)
        # — floored at the conservative seed so an unusually cheap run
        # can't ratchet the cap to permit spending.
        if recent_costs:
            sorted_window = sorted(recent_costs[-_COST_WINDOW:])
            mid = len(sorted_window) // 2
            if len(sorted_window) % 2 == 0:
                median = (sorted_window[mid - 1] + sorted_window[mid]) / 2
            else:
                median = sorted_window[mid]
            avg_cost = max(median, _SEED_AVG_COST_USD)
        else:
            avg_cost = _SEED_AVG_COST_USD
        projected_cost = cumulative_cost + (spec.runs_per_test * avg_cost)
        if projected_cost > args.max_cost_usd:
            print(
                f"  ! suite cost cap ${args.max_cost_usd:.2f} would be "
                f"exceeded by ut_{spec.id} "
                f"(N={spec.runs_per_test} × avg ${avg_cost:.4f} = "
                f"${projected_cost:.4f}); skipping remaining tests",
                file=sys.stderr,
            )
            saw_budget_skip = True
            break
        if elapsed >= args.max_wall_clock_seconds:
            print(
                f"  ! suite wall-clock cap {args.max_wall_clock_seconds}s reached "
                f"at {elapsed:.0f}s; skipping remaining tests",
                file=sys.stderr,
            )
            saw_budget_skip = True
            break

        print(f"  - {spec.id} ({spec.skill}) ...", flush=True)
        try:
            log = run_one_test(spec, auth=auth, paths=paths)
        except Exception as e:  # noqa: BLE001 — last-resort guard
            print(f"    ✗ HARNESS ERROR: {type(e).__name__}: {e}", file=sys.stderr)
            return 1

        path = write_run_log(log, runlogs_root=paths.runlogs_root)
        outcome = log["outcome"]
        this_cost = float(log["totals"].get("total_cost_usd") or 0.0)
        cumulative_cost += this_cost
        recent_costs.append(this_cost)

        if outcome == "aborted":
            reason = log["runs"][0].get("aborted_reason")
            if reason == "not_runnable":
                saw_not_runnable = True
            else:
                saw_exec_abort = True
        elif outcome in {"fail", "xpass"}:
            saw_fail_or_xpass = True
        rows.append(
            {
                "test_id": spec.id,
                "skill": spec.skill,
                "outcome": outcome,
                "path": _format_path(path),
            }
        )

    elapsed_total = time.perf_counter() - suite_start
    print(
        f"\nSuite totals: {len(rows)} test(s) run, ${cumulative_cost:.4f} spent, "
        f"{elapsed_total:.1f}s elapsed."
    )
    if saw_budget_skip:
        print("Some tests skipped due to suite-level budget cap.")

    _print_summary(rows)

    # Precedence: harness crashes already returned above. Among test-level
    # outcomes, surface the most actionable signal: fail/xpass first
    # (regressions and stale xfail markers), then not_runnable (corpus
    # issue), then exec aborts (infrastructure issue). Multiple categories
    # can hold simultaneously; we pick the strongest exit code.
    if saw_fail_or_xpass:
        return 1
    if saw_not_runnable:
        return 2
    if saw_exec_abort:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
