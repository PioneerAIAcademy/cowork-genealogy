"""Harness CLI entry point per unit-test-spec.md and the user's CLI spec.

Selection modes (mutually exclusive except --tag, which repeats):
  --test <id>     Run a single test by ut_ id
  --skill <name>  Run every test under eval/tests/unit/<skill>/
  --tag <name>    Repeat to AND-filter; selects across the whole corpus

Exit codes:
  0  every selected test resolved to pass / partial / xfail
  1  the harness itself crashed, OR any test resolved to fail or xpass
  2  any test was aborted for a test-corpus reason
     (`not_runnable` — missing scenario, invalid test JSON, OR calling a tool
     that doesn't exist at all — Type 1 unmatched_tool_call)
  3  any test was aborted for an execution reason
     (max_turns / wall clock / tool calls / tokens / error)

Note on unmatched tool calls (Phase 2):
  - Type 1 (tool doesn't exist): aborts with unmatched_tool_call (exit 2)
  - Type 2 (wrong args to existing tool): continues to judge (exit 1)
    The test gets fixture_not_found errors and the judge typically fails it
    on the Tool Arguments dimension.

No-args invocation prints help and exits 0.
--list-skills prints every skill directory with at least one runnable
test JSON and exits 0.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Iterator

from harness.auth import AuthError, resolve_auth
from harness.loader import InvalidTestError, TestSpec, load_test
from harness.orchestrator import (
    HARNESS_VERSION,
    OrchestratorPaths,
    REPO_ROOT,
    run_one_test,
)
from harness.runlog import build_run_log, write_run_log
from harness.skill_runner import DEFAULT_MODEL
from harness.snapshot import build_snapshot, hash_file
from harness.versioning import (
    is_releasable_invocation,
    next_filename_for,
    now_utc_filename_timestamp,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_tests.py",
        description=(
            "Cowork Genealogy unit-test harness. Run a single test, a single skill, "
            "or every test matching a tag.\n\n"
            "Note: tests run serially in v1 (~30s/test). Scope CI gates with "
            "--skill or --tag; running the full corpus at once is reserved for "
            "release-time validation via a shell loop over skills."
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
    parser.add_argument(
        "--tag",
        action="append",
        default=[],
        help="Filter by tag. May be repeated; all tags must match (AND).",
    )
    parser.add_argument(
        "--list-skills",
        action="store_true",
        help="List every skill directory that has at least one runnable "
        "test JSON, then exit.",
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
    parser.add_argument(
        "--concurrency",
        type=int,
        default=None,
        help=(
            "How many tests to run in parallel. Default: RAM-aware — about "
            "one slot per 2 GiB of system RAM, floored at 4 and capped at 8 "
            "(a 16 GiB machine resolves to 8). Tests are I/O-bound (each slot "
            "is mostly a Claude SDK subprocess waiting on the API), so the "
            "ceiling is RAM and API rate limits, not CPU cores. Pass a higher "
            "value on a big box, or 1 to force serial execution."
        ),
    )
    return parser


def _total_ram_gb() -> float | None:
    """Best-effort total physical RAM in GiB, cross-platform, stdlib only.

    Returns None when it can't be determined (caller falls back to the
    floor). POSIX (macOS/Linux) uses sysconf; Windows uses
    GlobalMemoryStatusEx via ctypes.
    """
    try:  # POSIX: macOS, Linux
        return (
            os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        ) / (1024 ** 3)
    except (ValueError, OSError, AttributeError):
        pass
    try:  # Windows
        import ctypes

        class _MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = _MemoryStatusEx()
        stat.dwLength = ctypes.sizeof(_MemoryStatusEx)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return stat.ullTotalPhys / (1024 ** 3)
    except (ImportError, OSError, AttributeError):
        pass
    return None


# Each concurrent slot is mostly a Claude SDK subprocess (~0.4 GiB RSS)
# blocked on the Anthropic API — the work is I/O-bound, so RAM and API rate
# limits, not CPU cores, set the ceiling. eval/CLAUDE.md notes that too many
# concurrent SDK subprocesses trigger SIGKILL under memory pressure. Heuristic:
# ~1 slot per 2 GiB of RAM, floored at 4 and capped at 8 (16 GiB -> 8).
_MIN_AUTO_CONCURRENCY = 4
_MAX_AUTO_CONCURRENCY = 8
_GB_PER_SLOT = 2.0


def _resolve_concurrency(requested: int | None) -> tuple[int, str]:
    """Return (concurrency, source) where source is 'flag' or 'auto'."""
    if requested is not None and requested > 0:
        return requested, "flag"
    ram = _total_ram_gb()
    if ram is None:
        return _MIN_AUTO_CONCURRENCY, "auto"
    by_ram = int(ram // _GB_PER_SLOT)
    return (
        max(_MIN_AUTO_CONCURRENCY, min(_MAX_AUTO_CONCURRENCY, by_ram)),
        "auto",
    )


def _select_tests(args, tests_dir: Path) -> list[TestSpec]:
    """Translate CLI flags into a list of TestSpecs."""
    if args.test:
        return _find_by_id(args.test, tests_dir)

    if args.skill:
        return _collect_specs(tests_dir / args.skill, tags=args.tag)

    if args.tag:
        return _collect_specs(tests_dir, tags=args.tag)

    return []


def _iter_test_files(root: Path) -> Iterator[Path]:
    if not root.exists():
        return
    for path in sorted(root.rglob("*.json")):
        if path.name == "rubric.md":
            continue
        yield path


def _list_skills(tests_dir: Path) -> list[str]:
    """Return sorted skill directory names under tests_dir that contain at
    least one runnable test JSON."""
    if not tests_dir.exists():
        return []
    out: list[str] = []
    for child in sorted(tests_dir.iterdir()):
        if child.is_dir() and next(_iter_test_files(child), None) is not None:
            out.append(child.name)
    return out


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
    print(f"{'TEST ID':<40} {'SKILL':<24} {'OUTCOME':<10}")
    print("-" * 76)
    for row in rows:
        print(
            f"{row['test_id']:<40} {row['skill']:<24} {row['outcome']:<10}"
        )
    print()


def _check_mcp_build_fresh() -> list[tuple[Path, str]]:
    """Verify mcp-server build artifacts exist and are at least as new as
    their TypeScript sources.

    The harness loads compiled JS from packages/engine/mcp-server/build/ when skills call
    MCP tools (e.g., validate_research_schema). A stale or missing build
    surfaces as a `build not found` error inside the tool response, which
    looks like a skill failure rather than an environment problem. Fail
    fast with a clear remediation instead.

    Returns a list of (ts_path, reason) for stale or missing artifacts.
    Empty list means the build is fresh.
    """
    src_root = REPO_ROOT / "packages" / "engine" / "mcp-server" / "src"
    build_root = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build"
    if not src_root.exists():
        return []

    stale: list[tuple[Path, str]] = []
    for ts_path in src_root.rglob("*.ts"):
        if ts_path.name.endswith(".d.ts"):
            continue
        rel = ts_path.relative_to(src_root).with_suffix(".js")
        js_path = build_root / rel
        if not js_path.exists():
            stale.append((ts_path, "missing"))
        elif js_path.stat().st_mtime < ts_path.stat().st_mtime:
            stale.append((ts_path, "outdated"))
    return stale


def _classify_invocation(args) -> tuple[str, bool]:
    """Return (mode, has_tag_filter). mode ∈ {test, skill, tag}."""
    has_tag_filter = bool(args.tag)
    if args.test:
        return ("test", has_tag_filter)
    if args.skill:
        return ("skill", has_tag_filter)
    if has_tag_filter:
        return ("tag", True)
    return ("skill", has_tag_filter)  # shouldn't reach; defended at top of main


def main(argv: list[str] | None = None) -> int:
    # Windows consoles default to a legacy codepage (cp1252) that can't
    # encode the non-ASCII characters in our status output (e.g. the "→"
    # in the run-log summary line). Force UTF-8 so a run never dies with
    # UnicodeEncodeError mid-print.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8")

    parser = _build_parser()
    argv = sys.argv[1:] if argv is None else argv

    if not argv:
        parser.print_help()
        return 0

    args = parser.parse_args(argv)

    tests_dir = args.tests_dir or (REPO_ROOT / "eval/tests/unit")

    if args.list_skills:
        skills = _list_skills(tests_dir)
        if not skills:
            print(
                f"No skills with runnable tests found under {tests_dir}.",
                file=sys.stderr,
            )
            return 2
        print("Skills with runnable tests:")
        for name in skills:
            print(f"  {name}")
        return 0

    stale = _check_mcp_build_fresh()
    if stale:
        print(
            "ERROR: mcp-server build is stale or missing. The harness loads "
            "compiled JS from packages/engine/mcp-server/build/ when skills call MCP tools; "
            "running against stale artifacts produces misleading test "
            "failures.",
            file=sys.stderr,
        )
        for ts, reason in stale[:5]:
            print(
                f"  - {ts.relative_to(REPO_ROOT)} ({reason})",
                file=sys.stderr,
            )
        if len(stale) > 5:
            print(f"  ... and {len(stale) - 5} more", file=sys.stderr)
        print(
            "\nFix: cd packages/engine/mcp-server && npm run build\n"
            "     (or: make eval-skill SKILL=<name>, which rebuilds first)",
            file=sys.stderr,
        )
        return 2

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
    # SDK-version probe (spec §15 known-risks): disallowed_tools enforcement
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
    if len(specs) > 20:
        print(
            "  NOTE: temperature=0 is not enforceable on the current SDK; "
            "single-run variance is unavoidable. For description-optimizer "
            "passes or golden-set calibration, bump runs_per_test on the "
            "tests being scored (spec §7).",
            file=sys.stderr,
        )
    mode, has_tag_filter = _classify_invocation(args)
    releasable = is_releasable_invocation(mode=mode, has_tag_filter=has_tag_filter)
    invocation_timestamp = now_utc_filename_timestamp()
    print(
        f"Invocation: mode={mode}, releasable={releasable}, "
        f"timestamp={invocation_timestamp}"
    )
    print(f"Running {len(specs)} test(s)...")
    print()

    rows: list[dict] = []
    saw_corpus_issue = False
    saw_exec_abort = False
    saw_fail_or_xpass = False
    saw_budget_skip = False

    suite_start = time.perf_counter()
    cumulative_cost = 0.0
    _SEED_AVG_COST_USD = 0.10
    _COST_WINDOW = 5
    recent_costs: list[float] = []

    concurrency, conc_source = _resolve_concurrency(args.concurrency)
    concurrency = min(concurrency, len(specs))
    print(
        f"Concurrency: {concurrency} "
        f"({'--concurrency' if conc_source == 'flag' else 'auto from RAM'})"
    )

    # Accumulate test entries grouped by skill. After all tests have run,
    # we write one run log per skill — paths under
    # eval/runlogs/unit/<skill>/ (no model dir; model lives in the
    # envelope and the skill's SKILL.md frontmatter).
    per_skill_entries: dict[str, list[dict]] = {}

    def _avg_cost() -> float:
        if not recent_costs:
            return _SEED_AVG_COST_USD
        window = sorted(recent_costs[-_COST_WINDOW:])
        mid = len(window) // 2
        if len(window) % 2 == 0:
            median = (window[mid - 1] + window[mid]) / 2
        else:
            median = window[mid]
        return max(median, _SEED_AVG_COST_USD)

    # Tests run through a bounded thread pool. Each worker calls run_one_test,
    # which owns its own event loop (asyncio.run), TemporaryDirectory
    # workspace, and SDK subprocess — so concurrent runs are hermetic and
    # never share workspace state. We submit lazily (top up only as slots
    # free) so the suite-level cost/wall-clock caps can still halt submission
    # of not-yet-started tests; in-flight tests are allowed to finish.
    results_by_index: dict[int, dict] = {}
    harness_error: Exception | None = None
    # Reversed so list.pop() yields specs in selection order.
    pending = list(reversed(list(enumerate(specs))))
    stop_submitting = False
    total = len(specs)
    done_n = 0

    def _budget_blocks_next(spec) -> bool:
        """True (and flips stop_submitting) when a suite cap would be
        crossed by submitting this spec. Accounting is approximate under
        concurrency — in-flight cost isn't yet in cumulative_cost — but the
        caps are safety nets, not precise meters."""
        nonlocal stop_submitting, saw_budget_skip
        elapsed = time.perf_counter() - suite_start
        if elapsed >= args.max_wall_clock_seconds:
            print(
                f"  ! suite wall-clock cap {args.max_wall_clock_seconds}s "
                f"reached at {elapsed:.0f}s; not starting more tests",
                file=sys.stderr,
            )
            stop_submitting = True
            saw_budget_skip = True
            return True
        projected = cumulative_cost + (spec.runs_per_test * _avg_cost())
        if projected > args.max_cost_usd:
            print(
                f"  ! suite cost cap ${args.max_cost_usd:.2f} would be "
                f"exceeded by {spec.id} (projected ${projected:.4f}); "
                f"not starting more tests",
                file=sys.stderr,
            )
            stop_submitting = True
            saw_budget_skip = True
            return True
        return False

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        inflight: dict = {}

        def _fill() -> None:
            while not stop_submitting and len(inflight) < concurrency and pending:
                idx, spec = pending[-1]
                if _budget_blocks_next(spec):
                    return
                pending.pop()
                fut = ex.submit(
                    run_one_test,
                    spec,
                    auth=auth,
                    paths=paths,
                    timestamp=invocation_timestamp,
                )
                inflight[fut] = (idx, spec)

        _fill()
        while inflight:
            completed, _ = wait(inflight, return_when=FIRST_COMPLETED)
            for fut in completed:
                idx, spec = inflight.pop(fut)
                try:
                    entry = fut.result()
                except Exception as e:  # noqa: BLE001 — last-resort guard
                    harness_error = e
                    stop_submitting = True
                    print(
                        f"    ✗ HARNESS ERROR in {spec.id}: "
                        f"{type(e).__name__}: {e}",
                        file=sys.stderr,
                    )
                    continue

                done_n += 1
                outcome = entry["outcome"]
                this_cost = float(entry["totals"].get("total_cost_usd") or 0.0)
                cumulative_cost += this_cost
                recent_costs.append(this_cost)
                results_by_index[idx] = entry

                if outcome == "aborted":
                    reason = entry["runs"][0].get("aborted_reason")
                    # not_runnable (pre-execution gate) and Type 1
                    # unmatched_tool_call (calling a tool that doesn't exist)
                    # are test-corpus issues — exit 2. Every other abort reason
                    # is an execution failure — exit 3. Note (Phase 2): Type 2
                    # unmatched_tool_call (wrong args to existing tool) no
                    # longer aborts; it continues to judge and fails (exit 1).
                    if reason in ("not_runnable", "unmatched_tool_call"):
                        saw_corpus_issue = True
                    else:
                        saw_exec_abort = True
                elif outcome in {"fail", "xpass"}:
                    saw_fail_or_xpass = True

                dur = float(entry["totals"].get("duration_ms") or 0.0) / 1000.0
                mark = "✓" if outcome in {"pass", "partial", "xfail"} else "✗"
                print(
                    f"  {mark} [{done_n}/{total}] {spec.id} ({spec.skill}) "
                    f"— {outcome} ({dur:.0f}s skill)",
                    flush=True,
                )
            _fill()

    # A harness exception is fatal regardless of the other results.
    if harness_error is not None:
        return 1

    # Rebuild per-skill entries + summary rows in selection order (completion
    # order is nondeterministic under concurrency). Specs skipped by a budget
    # cap have no entry and are simply absent.
    for idx, spec in enumerate(specs):
        entry = results_by_index.get(idx)
        if entry is None:
            continue
        per_skill_entries.setdefault(spec.skill, []).append(entry)
        rows.append(
            {
                "test_id": spec.id,
                "skill": spec.skill,
                "outcome": entry["outcome"],
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

    # --- Write one run log per skill --------------------------------------
    judge_prompt_path = REPO_ROOT / "eval" / "harness" / "judge" / "prompt.md"
    judge_hash = hash_file("eval/harness/judge/prompt.md", judge_prompt_path)
    written_paths: list[Path] = []
    for skill, entries in per_skill_entries.items():
        skill_runlog_dir = paths.runlogs_root / "unit" / skill
        filename, version = next_filename_for(
            skill_runlog_dir=skill_runlog_dir,
            releasable=releasable,
            timestamp=invocation_timestamp,
        )
        snapshot = build_snapshot(skill=skill, repo_root=REPO_ROOT)
        log = build_run_log(
            skill=skill,
            version=version,
            released=False,
            releasable=releasable,
            invocation=mode,
            timestamp=invocation_timestamp,
            harness_version=HARNESS_VERSION,
            model=DEFAULT_MODEL,
            judge_prompt_hash=judge_hash,
            snapshot=snapshot,
            tests=entries,
        )
        path = write_run_log(
            log, runlogs_root=paths.runlogs_root, filename=filename
        )
        written_paths.append(path)
        print(f"  → wrote {_format_path(path)} ({len(entries)} test(s))")

    # Precedence: harness crashes already returned above. Among test-level
    # outcomes, surface the most actionable signal: fail/xpass first
    # (regressions and stale xfail markers), then corpus issues
    # (not_runnable), then exec aborts (infrastructure issue). Multiple
    # categories can hold simultaneously; we pick the strongest exit code.
    if saw_fail_or_xpass:
        return 1
    if saw_corpus_issue:
        return 2
    if saw_exec_abort:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
