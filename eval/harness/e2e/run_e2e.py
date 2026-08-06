"""CLI entry point for the e2e harness.

Usage (run from eval/harness/):

  uv run python -m e2e.run_e2e --test <fixture-id>

Or from the repo root with PYTHONPATH set:

  PYTHONPATH=eval/harness python -m e2e.run_e2e --test <fixture-id>

**One fixture per invocation, by design.** There is deliberately no
full-suite flag and no tag sweep: a run costs 20-60 minutes and $3-10, so a
10-fixture sweep is 4-10 hours and $30-100. Anyone who genuinely needs a
batch drives it with a shell loop and budgets for it explicitly, rather than
having a one-word flag make that spend easy to trigger by accident.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from e2e.orchestrator import (
    DEFAULT_FIXTURES_ROOT,
    DEFAULT_MCP_SERVER_ENTRY,
    DEFAULT_PLUGIN_SKILLS,
    DEFAULT_RUNLOG_ROOT,
    run_e2e_test,
)
from e2e.env import ENV_FILE, load_env_file, stage_openrouter_key
from e2e.report import print_rollup
from e2e.result import E2eResult, is_committable_run


# Judge auth from eval/.env. Lives in e2e.env so calibrate_judge can share it
# without importing this module (which pulls in claude_agent_sdk via
# e2e.orchestrator). Re-exported here: the agent run uses the Claude Agent SDK's
# own auth and is unaffected, which is why the symptom of a missing key is
# "agent ran, judge skipped".
_ENV_FILE = ENV_FILE  # back-compat alias


def _print_compliance(result: E2eResult) -> None:
    """Surface the guardrail axis — a harness fact, not a judge grade.

    This is the one axis it is safe to print here (see `_run_one` on why the
    judge's own output is not): it says whether the GPS guardrail skills
    actually ran, which is orthogonal to how well the research went and is not
    something the grader scores.
    """
    if result.compliance == "pass":
        print("  compliance: pass    (all GPS guardrail skills invoked)")
        return
    n = len(result.guardrail_bypass_violations)
    print(f"  compliance: FAIL    ({n} guardrail bypass{'' if n == 1 else 'es'})")
    for violation in result.guardrail_bypass_violations:
        text = violation if len(violation) <= 150 else violation[:147] + "..."
        print(f"    - {text}")


# The verdicts that mean the judge actually reached a conclusion.
#
# A deliberate local literal, NOT an import from result.py. Gradedness and
# committability are two different axes — the lead's own words on PR #1239 —
# and result.py's set is the *committability* one. #1239 widens it to include
# `ungraded`, so importing it would silently make a judge crash count as
# "graded" the moment that lands. Keeping this separate is what lets the block
# in `_run_one` stay correct both before and after.
_GRADED_VERDICTS = ("pass", "partial", "fail")


def is_ungraded(result: E2eResult) -> bool:
    """Whether the judge failed to reach a conclusion on this run.

    Independent of whether the run is *committable*. Today the two coincide;
    after #1239 a judge crash is committable (the tree exists and can be
    re-graded later) while still being ungraded, and an operator needs telling
    about it either way.
    """
    return result.verdict not in _GRADED_VERDICTS


def ungradeable_reason(result: E2eResult, *, skip_judge: bool = False) -> str:
    """Why a run produced no grade (#1245).

    The message used to be a single fixed string, "the judge didn't run, so
    there's nothing to grade or commit". For a judge crash that lands directly
    under `stop_reason: completed`, and the pair reads as "this run succeeded
    and produced nothing". Three different causes printed identically, so a
    batch of 19 gave an operator no way to tell a broken environment from runs
    that genuinely failed — which is what issue #1245 was reported as.

    **Blindness-safe** (spec §7.4, and the same line `_run_one` walks above):
    this reads only whether `judge_output` carries an `error` key, never a
    grade field. A judge crash is a harness fact, like `stop_reason` and
    `compliance`, not a genealogical conclusion. The prohibition in
    `result.py` on reading `judge_output` binds `interpret-e2e-result`, whose
    job is explaining what the agent recovered; it is not a blanket ban.

    Pure and free of I/O so every arm is testable — `_run_one` cannot be, since
    it drives a live 20-to-60-minute run.
    """
    judge_error = (result.judge_output or {}).get("error")
    if judge_error:
        return (
            f"the judge itself failed ({judge_error}) — the agent's work is "
            "intact, so this is worth re-running"
        )
    if skip_judge:
        return "--skip-judge was passed, so no grade was requested"
    return (
        "the agent produced no final tree for the judge to grade — see "
        "stop_reason above for how it ended"
    )


async def _run_one(fixture_dir: Path, **kwargs) -> E2eResult:
    print(f"\n=== Running {fixture_dir.name} ===")
    result, paths = await run_e2e_test(fixture_dir=fixture_dir, **kwargs)

    # DELIBERATELY NOT PRINTED: the judge's `verdict`, its `proof_quality`
    # score, or the combined `outcome` (which reveals the verdict whenever
    # compliance is clean). The person who runs a fixture is usually the same
    # person who then grades it with /grade-e2e-run, and spec §7.4 wants that
    # grade drawn blind — printing the grade here anchors it before they
    # start. `stop_reason` and `compliance` are harness facts and are safe;
    # everything else is what /interpret-e2e-result exists to walk them
    # through, from the final tree rather than from the judge (issue #972).
    print(f"  stop_reason: {result.stop_reason}")
    _print_compliance(result)
    print(f"  result: {paths['result']}")
    # Two independent axes, reported separately (#1245). Fusing them is what
    # made a judge crash unreadable: "the judge didn't run" was printed as a
    # property of the scratch prefix, so the two causes that share that prefix
    # were indistinguishable. After #1239 they stop coinciding entirely — a
    # judge crash becomes committable while still being ungraded — and a single
    # `if committable` branch would then say nothing at all about the crash.
    if is_ungraded(result):
        print(
            f"  no grade: "
            f"{ungradeable_reason(result, skip_judge=bool(kwargs.get('skip_judge')))}"
        )
    if is_committable_run(result.verdict):
        print(
            "  Next: /interpret-e2e-result to see what it recovered, then "
            "/grade-e2e-run to grade it.\n"
            "  Commit the run log + its .ann.json together before landing."
        )
    else:
        print("  (scratch run — gitignored)")
    return result


def main(argv: list[str] | None = None) -> int:
    load_env_file()  # make ANTHROPIC_API_KEY from eval/.env available to the judge
    stage_openrouter_key()  # bridge OPENROUTER_API_KEY -> ~/.familysearch-mcp/config.json for the MCP subprocess (spec §6.5)
    parser = argparse.ArgumentParser(
        prog="e2e.run_e2e",
        description="Run one e2e test against the GPS research flow.",
    )
    parser.add_argument(
        "--test",
        required=True,
        help="Fixture id (slug) under eval/tests/e2e/. One fixture per run — "
             "there is no suite or tag sweep (see the module docstring).",
    )
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
    parser.add_argument(
        "--effort-level",
        choices=["low", "medium", "high", "xhigh", "max"],
        default="high",
        help=(
            "Pin the run's reasoning effort via a project-level setting "
            "(.claude/settings.json effortLevel). Session-wide. Default: high "
            "(matches Cowork). setting_sources=['project'] already isolates from "
            "the user's effortLevel, and CLAUDE_EFFORT is output-only, so this is "
            "the sole working effort lever. Vary it to test whether a runaway-"
            "thinking subagent freeze clears (see subagents[].runaway_thinking)."
        ),
    )
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=None,
        help=(
            "Cap the model's output budget via CLAUDE_CODE_MAX_OUTPUT_TOKENS "
            "(session-wide). Default: unset = the CLI default (sonnet-5 -> 32000). "
            "This env var IS inherited from the launching shell, so pass it "
            "explicitly for reproducible runs. Lower it (e.g. 16000, 8000) to test "
            "whether it bounds a subagent that fills the output budget with "
            "thinking. Recorded in the runlog."
        ),
    )
    parser.add_argument(
        "--agent-model",
        default=None,
        help=(
            "Override the model for BOTH the parent agent and every staged "
            "subagent (rewrites each agent's `.md` model pin). Default: unset = "
            "fixture default parent (claude-sonnet-4-6) + each subagent's own pin "
            "(record-extractor = claude-sonnet-5). Set e.g. claude-sonnet-4-6 to "
            "run the whole flow under Cowork's model and test whether the "
            "sonnet-5 record-extractor freeze reproduces. Recorded in the runlog."
        ),
    )
    args = parser.parse_args(argv)

    fixtures_root: Path = args.fixtures_root
    if not fixtures_root.exists():
        print(f"Fixtures root does not exist: {fixtures_root}", file=sys.stderr)
        return 2

    fixture_dir = fixtures_root / args.test
    if not fixture_dir.exists():
        print(f"Fixture not found: {fixture_dir}", file=sys.stderr)
        return 2

    kwargs = {
        "runlog_root": args.runlog_root,
        "mcp_server_entry": args.mcp_server_entry,
        "skills_dir": args.skills_dir,
        "skip_judge": args.skip_judge,
        "resume_on_stall": args.resume_on_stall,
        "effort_level": args.effort_level,
        "max_output_tokens": args.max_output_tokens,
        "agent_model": args.agent_model,
    }

    results: list[E2eResult] = []
    try:
        results.append(asyncio.run(_run_one(fixture_dir, **kwargs)))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as e:  # noqa: BLE001 — report, then fall through to a nonzero exit
        print(f"  ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    print()
    print_rollup(results)
    # Exit nonzero if the test failed or aborted. Keyed on the combined gate,
    # which preserves the pre-#972 behavior exactly: a guardrail bypass used to
    # force `verdict = "fail"`, and now forces `outcome = "fail"` instead.
    # Verified against all 122 committed runs — the gate distribution is
    # byte-identical to the old fused verdict's.
    failed = sum(1 for r in results if r.outcome in {"fail", "skipped"})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
