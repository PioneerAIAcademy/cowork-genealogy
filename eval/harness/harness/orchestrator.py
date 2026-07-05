"""Per-test orchestrator — runs the runnability gate, executes the skill,
runs validators and the judge, and assembles the run log.

v1: N=1, no parallel execution, no suite-budget guard, no sidecar text files.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from harness.allowed_tools import compute_allowed_tools, load_skill_frontmatter
from harness.auth import AuthConfig
from harness.fixtures import load_fixtures
from harness.diff import diff_research_json, diff_tree_gedcomx
from harness.judge import (
    DEFAULT_JUDGE_MODEL,
    JudgeError,
    JudgeOutput,
    _summarize_response,
    grade,
)
from harness.loader import TestSpec
from harness.rubric import Rubric, empty_rubric, parse_rubric_or_empty
from harness.runlog import (
    JudgeResult,
    SingleRun,
    ValidatorResult,
    assemble_test_entry,
    derive_activated,
)
from harness.runnability import RunnabilityResult, check_runnable
from harness.skill_runner import (
    DEFAULT_MODEL,
    DEFAULT_SDK_MESSAGE_SILENCE_SECONDS,
    SkillRunResult,
    run_skill,
)
from harness.validator_runner import as_dicts, run_validators
from harness.workspace import build_workspace, cleanup_session_store, snapshot_files


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SCENARIOS = REPO_ROOT / "eval/fixtures/scenarios"
DEFAULT_FIXTURES = REPO_ROOT / "eval/fixtures/mcp"
DEFAULT_SKILLS = REPO_ROOT / "packages/engine/plugin/skills"
DEFAULT_TESTS = REPO_ROOT / "eval/tests/unit"
DEFAULT_VALIDATORS = REPO_ROOT / "eval/harness/validators"
DEFAULT_RUNLOGS = REPO_ROOT / "eval/runlogs"


def _read_harness_version() -> str:
    """Read the harness version from the single source of truth.

    Spec §10 uses `harness_version` in the run log to invalidate
    apples-to-apples comparison across harness versions. A hardcoded
    literal goes stale silently. We prefer `importlib.metadata` (works
    when the package is properly installed), but uv's default workflow
    doesn't install this repo as a distribution — so we fall back to
    parsing pyproject.toml directly. Either way, edit one file
    (`pyproject.toml`) to bump the version.
    """
    from importlib.metadata import PackageNotFoundError, version as _md_version
    try:
        return _md_version("cowork-genealogy-eval-harness")
    except PackageNotFoundError:
        pass

    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    if pyproject.exists():
        try:
            import tomllib  # Python 3.11+
        except ImportError:  # pragma: no cover — Python < 3.11
            return "unknown"
        try:
            data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
            return data.get("project", {}).get("version", "unknown")
        except Exception:  # noqa: BLE001 — best-effort
            return "unknown"
    return "unknown"


HARNESS_VERSION = _read_harness_version()


@dataclass
class OrchestratorPaths:
    scenarios_dir: Path = DEFAULT_SCENARIOS
    fixtures_dir: Path = DEFAULT_FIXTURES
    skills_dir: Path = DEFAULT_SKILLS
    tests_dir: Path = DEFAULT_TESTS
    validators_dir: Path = DEFAULT_VALIDATORS
    runlogs_root: Path = DEFAULT_RUNLOGS


# Validators that assert the persisted project files are valid (schema-
# conformant, references resolve). A test that declares its scenario broken
# on purpose (`intentionally_invalid: true`) expects these to fail — the
# invalid input is the whole point — so they are not counted against such a
# test. Behavioural validators (allowlist, append-only, …) still apply.
FILE_VALIDITY_VALIDATORS = frozenset(
    {
        "test_research_json_validates_schema",
        "test_tree_gedcomx_json_validates_schema",
        "test_id_references_resolve",
    }
)


def compute_validators_passed(validator_results, *, intentionally_invalid: bool) -> bool:
    """True when no validator failed.

    When the test's scenario is intentionally invalid, the file-validity
    validators are expected to fail and are ignored; every other validator
    still counts.
    """
    return all(
        r.passed
        for r in validator_results
        if not (intentionally_invalid and r.name in FILE_VALIDITY_VALIDATORS)
    )


def run_one_test(
    spec: TestSpec,
    *,
    auth: AuthConfig,
    paths: OrchestratorPaths | None = None,
    model: str = DEFAULT_MODEL,
    judge_model: str = DEFAULT_JUDGE_MODEL,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Run a single test; return the per-test entry dict for the envelope.

    The harness CLI batches multiple test entries into one multi-test run
    log (one per skill in this invocation). The `timestamp` is the
    envelope's timestamp; it's embedded into per-run `run_id`s for
    traceability. Pass `None` to generate one inline (single-test calls
    in tests).
    """
    paths = paths or OrchestratorPaths()
    from harness.versioning import now_utc_filename_timestamp
    ts = timestamp or now_utc_filename_timestamp()
    return asyncio.run(
        _run_one_test_async(
            spec=spec,
            auth=auth,
            paths=paths,
            model=model,
            judge_model=judge_model,
            timestamp=ts,
        )
    )


async def _run_one_test_async(
    *,
    spec: TestSpec,
    auth: AuthConfig,
    paths: OrchestratorPaths,
    model: str,
    judge_model: str,
    timestamp: str,
) -> dict[str, Any]:
    # --- Runnability gate -----------------------------------------------
    gate = check_runnable(
        spec,
        scenarios_dir=paths.scenarios_dir,
        fixtures_dir=paths.fixtures_dir,
        skills_dir=paths.skills_dir,
        tests_dir=paths.tests_dir,
    )
    if not gate.runnable:
        return _aborted_entry(
            spec=spec,
            reason="not_runnable",
            detail=gate.reason or "runnability gate blocked the test",
            timestamp=timestamp,
        )

    rubric_path = paths.tests_dir / spec.skill / "rubric.md"
    rubric = parse_rubric_or_empty(
        spec.skill,
        rubric_path.read_text(encoding="utf-8") if rubric_path.exists() else None,
    )
    skill_frontmatter = load_skill_frontmatter(
        paths.skills_dir / spec.skill / "SKILL.md"
    )
    # Honor the `model:` field in SKILL.md frontmatter when set (matches
    # Claude Code skill-frontmatter semantics: turn-scoped model override
    # per code.claude.com/docs/en/skills). Falls back to the CLI-provided
    # `model` arg (which defaults to DEFAULT_MODEL) when the field is
    # absent or empty.
    skill_model = skill_frontmatter.get("model")
    if isinstance(skill_model, str) and skill_model.strip():
        model = skill_model.strip()
    scenario_readme = _load_scenario_readme(paths.scenarios_dir, spec.scenario)
    skill_baseline = compute_allowed_tools(spec.skill, paths.skills_dir)

    # Negative tests may route to a different skill whose MCP tools
    # differ from the skill under test's allowed-tools.  The test author
    # provides mcp_fixtures to cover those calls — ensure the fixture
    # tools are allowed so calls reach the mock server instead of being
    # denied by the allowlist.
    if spec.type == "negative" and spec.mcp_fixtures:
        neg_fixtures = load_fixtures(spec.mcp_fixtures, paths.fixtures_dir)
        fixture_tools = {f"mcp__genealogy__{f['tool']}" for f in neg_fixtures}
        skill_baseline = list(set(skill_baseline) | fixture_tools)

    runs: list[SingleRun] = []
    n_runs = spec.runs_per_test
    # Per-run progress. Only emitted for multi-run tests (runs_per_test > 1).
    # Policy pins runs_per_test to 1, so in the normal path this stays silent
    # and the suite's per-test completion line (run_tests.py) is the live
    # signal — that line is the one that stays readable when the thread pool
    # interleaves output from concurrent tests. The detail here (which sub-run,
    # skill vs. judge/validators split) is retained for any future multi-run
    # variance work. Transient retries within a run still log to stderr from
    # _execute_skill_with_retry.
    for run_index in range(n_runs):
        if n_runs > 1:
            print(
                f"      {spec.id} run {run_index + 1}/{n_runs} (cap "
                f"{spec.execution.get('max_wall_clock_seconds', 300)}s) ...",
                flush=True,
            )
        _run_start = time.perf_counter()
        single = await _execute_single_run(
            run_index=run_index,
            spec=spec,
            paths=paths,
            rubric=rubric,
            skill_frontmatter=skill_frontmatter,
            scenario_readme=scenario_readme,
            skill_baseline=skill_baseline,
            auth=auth,
            model=model,
            judge_model=judge_model,
        )
        runs.append(single)
        if n_runs > 1:
            _elapsed = time.perf_counter() - _run_start
            _skill_s = single.duration_ms / 1000.0
            # Remainder is judge + validators + diffing (all post-skill work).
            _post_s = max(0.0, _elapsed - _skill_s)
            _tag = single.aborted_reason or single.outcome
            print(
                f"      {spec.id} run {run_index + 1}/{n_runs} -> {_tag} "
                f"({_elapsed:.0f}s = {_skill_s:.0f}s skill + "
                f"{_post_s:.0f}s judge/validators)",
                flush=True,
            )

    return assemble_test_entry(
        test_id=spec.id,
        test_type=spec.type,
        expected_outcome=spec.expected_outcome,
        scenario=spec.scenario,
        mcp_fixtures=spec.mcp_fixtures,
        runs=runs,
        timestamp_for_run_id=timestamp,
    )


def _routing_short_circuit_skills(spec: TestSpec) -> set[str] | None:
    """The skills whose invocation seals a negative test's routing verdict.

    Once any of these is invoked via the Skill tool, run_skill stops the run
    (the downstream skill never executes) — see skill_runner. Returns None for
    positive tests and for out-of-scope negatives (`correct_skill: []`), which
    must run normally to be graded.
    """
    if spec.type != "negative":
        return None
    correct = (spec.negative or {}).get("correct_skill", [])
    return set(correct) or None


async def _execute_single_run(
    *,
    run_index: int,
    spec: TestSpec,
    paths: OrchestratorPaths,
    rubric,
    skill_frontmatter: dict[str, Any],
    scenario_readme: str,
    skill_baseline: list[str],
    auth: AuthConfig,
    model: str,
    judge_model: str,
) -> SingleRun:
    """One run of the skill + validators + judge. Returned to the caller for
    multi-run aggregation in assemble_test_entry."""

    # Epoch bracket for the whole single run (skill + validators + judge),
    # so the run log can report true per-skill makespan under concurrency.
    _started_at = time.time()

    # --- Workspace + skill execution ------------------------------------
    # Negative tests are graded on the routing decision, not on the routed-to
    # skill's execution (see _compute_outcome). Tell run_skill to stop as soon
    # as the correct alternative skill is invoked, so the suite doesn't pay for
    # that skill's full (often very expensive) workload.
    routing_short_circuit = _routing_short_circuit_skills(spec)
    result, before_snapshot, after_snapshot = await _execute_skill_with_retry(
        run_index=run_index,
        spec=spec,
        paths=paths,
        skill_baseline=skill_baseline,
        auth=auth,
        model=model,
        routing_short_circuit_skills=routing_short_circuit,
    )

    # --- Uncovered tool-call gate (Phase 2) -----------------------------
    # When a tool call doesn't match any fixture predicate, distinguish:
    #
    # Type 1: Tool doesn't exist at all (e.g., calling "nonexistent_tool")
    #         → ABORT with unmatched_tool_call (test corpus issue, exit 2)
    #         The test needs a fixture for a tool that should exist, or the
    #         LLM hallucinated a tool name that will never exist.
    #
    # Type 2: Tool exists but args don't match any fixture (OR tool exists
    #         but was denied by the allowlist)
    #         → CONTINUE to judge (LLM mistake, exit 1)
    #         The skill gets a fixture_not_found error from the mock. The
    #         judge evaluates the skill's behavior when faced with tool
    #         errors and typically fails on Tool Arguments. Warnings flag
    #         which fixtures need to be added or corrected.
    #
    # Phase 2 filters out Type 2 from the abort — only Type 1 stops the run.
    if result.aborted_reason is None:
        covered = _predicate_matched_count(result.tool_calls)
        if len(result.attempted_mcp_calls) > covered:
            # At least one call didn't match a fixture. Check if any attempted
            # call is to a tool that doesn't exist in the mock server.
            # If a tool doesn't exist in registered_mcp_tools, there's no
            # handler for it, so the call can't possibly have reached the mock.
            for call in result.attempted_mcp_calls:
                tool_name = call["tool"].removeprefix("mcp__genealogy__")
                if tool_name not in result.registered_mcp_tools:
                    # Type 1: tool doesn't exist at all — abort
                    result.aborted_reason = "unmatched_tool_call"
                    break
            # Type 2 calls (wrong args to existing tools, or denied by allowlist)
            # fall through without aborting. Warnings are added by _build_warnings.

    # --- Diffs ----------------------------------------------------------
    research_diff = diff_research_json(
        before_snapshot["research_json"], after_snapshot["research_json"]
    )
    tree_diff = diff_tree_gedcomx(
        before_snapshot["tree_gedcomx_json"], after_snapshot["tree_gedcomx_json"]
    )
    files_created = sorted(
        set(after_snapshot["files"]) - set(before_snapshot["files"])
    )

    file_changes = (
        {"research.json": research_diff}
        if research_diff["sections_modified"]
        else {}
    )
    if tree_diff:
        file_changes["tree.gedcomx.json"] = tree_diff
    file_changes = file_changes or None

    # Set of every *other* skill name in the packages/engine/plugin/skills/ directory —
    # used by rule 4 to detect "routing to another skill" patterns in
    # short responses without false-flagging legitimate concise outputs.
    other_skill_names = {
        d.name for d in paths.skills_dir.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name != spec.skill
    }

    activated = derive_activated(
        skill=spec.skill,
        skills_invoked=result.skills_invoked,
        file_changes=file_changes,
        files_created=files_created,
        text_response=result.text_response,
        other_skill_names=other_skill_names,
    )

    # --- Validators -----------------------------------------------------
    validator_results = run_validators(
        skill=spec.skill,
        validators_dir=paths.validators_dir,
        before_state={
            "research_json": before_snapshot["research_json"],
            "tree_gedcomx_json": before_snapshot["tree_gedcomx_json"],
            "tree_gedcomx": before_snapshot["tree_gedcomx_json"],
            "files": before_snapshot["files"],
            "skill_frontmatter": skill_frontmatter,
        },
        after_state={
            "research_json": after_snapshot["research_json"],
            "tree_gedcomx_json": after_snapshot["tree_gedcomx_json"],
            "tree_gedcomx": after_snapshot["tree_gedcomx_json"],
            "files": after_snapshot["files"],
            "skill_frontmatter": skill_frontmatter,
        },
        tool_calls=result.tool_calls,
        skill_frontmatter=skill_frontmatter,
        test=spec.raw.get("test", {}),
    )
    validators_passed = compute_validators_passed(
        validator_results, intentionally_invalid=spec.intentionally_invalid
    )

    # --- Judge ----------------------------------------------------------
    if validators_passed and result.aborted_reason is None:
        _judge_start = time.perf_counter()
        try:
            judge_output = _run_judge(
                spec=spec,
                rubric=rubric,
                scenario_readme=scenario_readme,
                result=result,
                file_changes=file_changes,
                auth=auth,
                judge_model=judge_model,
            )
        except JudgeError as e:
            # Missing API key, model returned no tool_use, parse failure,
            # transient API error. Record the failure and continue so a
            # bad judge call doesn't abort the whole suite.
            judge_result = JudgeResult(
                skipped=True, dimensions=[], judge_cost_usd=0.0,
                error=f"JudgeError: {e}",
            )
        except Exception as e:  # noqa: BLE001 — defensive
            judge_result = JudgeResult(
                skipped=True, dimensions=[], judge_cost_usd=0.0,
                error=f"{type(e).__name__}: {e}",
            )
        else:
            judge_result = JudgeResult(
                skipped=False,
                dimensions=judge_output.dimensions,
                judge_cost_usd=judge_output.cost_usd,
                input_tokens=judge_output.input_tokens,
                cached_input_tokens=judge_output.cached_input_tokens,
                output_tokens=judge_output.output_tokens,
            )
        # Records judge wall-clock on every attempted branch (success or
        # error). The skipped branch below leaves the 0.0 default.
        judge_result.duration_ms = (time.perf_counter() - _judge_start) * 1000.0
    else:
        judge_result = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)

    had_substantive_effect = bool(
        file_changes or files_created or result.tool_calls
    )
    outcome = _compute_outcome(
        spec=spec,
        validators_passed=validators_passed,
        judge_dimensions=judge_result.dimensions,
        aborted_reason=result.aborted_reason,
        activated=activated,
        skills_invoked=result.skills_invoked,
        had_substantive_effect=had_substantive_effect,
        judge_skipped=judge_result.skipped,
    )

    usage = result.usage or {}
    sdk_usage = usage.get("usage") or {}
    skill_input = int(sdk_usage.get("input_tokens") or 0)
    skill_cached = int(sdk_usage.get("cache_read_input_tokens") or 0)
    skill_output = int(sdk_usage.get("output_tokens") or 0)
    # SDK timing (present only when a ResultMessage arrived — i.e. not on a
    # wall-clock / stream-silence abort, where these stay 0).
    skill_duration_api_ms = float(usage.get("duration_api_ms") or 0.0)
    skill_num_turns = int(usage.get("num_turns") or 0)
    _ended_at = time.time()

    return SingleRun(
        outcome=outcome,
        aborted_reason=result.aborted_reason,
        duration_ms=result.duration_ms,
        duration_api_ms=skill_duration_api_ms,
        num_turns=skill_num_turns,
        started_at=_started_at,
        ended_at=_ended_at,
        skill_attempts=result.attempts,
        # Run-level tokens are SKILL ONLY. Judge tokens live on the
        # judge block so the spec §11 cache-hit-rate diagnostic
        # (cached/input on the skill side) stays meaningful.
        input_tokens=skill_input,
        cached_input_tokens=skill_cached,
        output_tokens=skill_output,
        skill_cost_usd=float(usage.get("total_cost_usd") or 0.0),
        output={
            "text_response": result.text_response,
            "activated": activated,
            "skills_invoked": result.skills_invoked,
            "tool_calls": [
                {
                    "tool": c["tool"],
                    "args": c["args"],
                    "expected_args": c.get("expected_args"),
                    "matched": c["matched"],
                    "response_fixture": c.get("response_fixture"),
                }
                for c in result.tool_calls
            ],
            "files_created": files_created,
            **({"file_changes": file_changes} if file_changes else {}),
            **(
                {"warnings": warnings}
                if (warnings := _build_warnings(
                    result.tool_calls,
                    rubric=rubric,
                    skill_frontmatter=skill_frontmatter,
                    attempted_mcp_calls=result.attempted_mcp_calls,
                ))
                else {}
            ),
        },
        validators=ValidatorResult(
            passed=validators_passed, results=as_dicts(validator_results)
        ),
        judge=judge_result,
    )


DEFAULT_SKILL_RUN_ATTEMPTS = 3


async def _execute_skill_with_retry(
    *,
    run_index: int,
    spec: TestSpec,
    paths: OrchestratorPaths,
    skill_baseline: list[str],
    auth: AuthConfig,
    model: str,
    routing_short_circuit_skills: set[str] | None = None,
    attempts: int = DEFAULT_SKILL_RUN_ATTEMPTS,
    base_delay: float = 1.0,
) -> tuple[SkillRunResult, dict[str, Any], dict[str, Any]]:
    """Build a fresh workspace and run the skill, retrying transient
    failures with exponential backoff.

    Two transient-failure modes are retried:

    1. `aborted_reason="error"` — the Agent SDK occasionally fails a run
       before it ever reaches the model (zero input tokens, an
       API/connection hiccup at the SDK boundary).
    2. `aborted_reason="sdk_stream_silence"` — the watchdog in
       `skill_runner._consume_messages` fired because no message
       arrived within `sdk_message_silence_seconds`. This is an
       upstream API stall mid-generation (initialize succeeded, some
       work happened, then generation hung). The next attempt gets a
       fresh subprocess and a different cold-start path, so retry
       converts most of these into clean runs.

    This mirrors the judge's retry-with-backoff
    (`harness.judge._create_message_with_retry`).

    Each attempt gets its own TemporaryDirectory and a fresh
    `build_workspace`, so a retry can never run against state a failed
    attempt left behind — the retry is hermetic whether the failure was
    pre-flight or mid-run.

    Deterministic execution-cap aborts (`max_turns`, `max_tool_calls`,
    `max_wall_clock_seconds`, `max_input_tokens_per_turn`) are NOT
    retried — a retry would just burn the same budget — so they return
    on the first attempt. The Agent SDK collapses every other failure
    into `is_error`/exceptions without the clean HTTP status codes the
    judge path discriminates on, so a genuinely non-transient error is
    retried too; the cost is bounded (`attempts` tries plus a few
    seconds of backoff).

    Returns (SkillRunResult, before_snapshot, after_snapshot).
    """
    RETRYABLE_ABORT_REASONS = {"error", "sdk_stream_silence"}
    delay = base_delay
    result: SkillRunResult | None = None
    before_snapshot: dict[str, Any] = {}
    after_snapshot: dict[str, Any] = {}
    for attempt in range(attempts):
        with tempfile.TemporaryDirectory(
            prefix=f"eval-{spec.id}-{run_index}-{attempt}-",
            ignore_cleanup_errors=True,
        ) as tmp:
            workspace = Path(tmp)
            try:
                build_workspace(
                    scenario_name=spec.scenario,
                    scenarios_dir=paths.scenarios_dir,
                    skills_dir=paths.skills_dir,
                    target_dir=workspace,
                )
                before_snapshot = snapshot_files(workspace)
                result = await run_skill(
                    user_message=spec.user_message,
                    workspace=workspace,
                    fixture_names=spec.mcp_fixtures,
                    fixtures_dir=paths.fixtures_dir,
                    auth=auth,
                    model=model,
                    max_turns=spec.execution.get("max_turns", 20),
                    max_wall_clock_seconds=spec.execution.get(
                        "max_wall_clock_seconds", 300
                    ),
                    max_tool_calls=spec.execution.get("max_tool_calls", 50),
                    max_input_tokens_per_turn=spec.execution.get(
                        "max_input_tokens_per_turn", 200_000
                    ),
                    sdk_message_silence_seconds=spec.execution.get(
                        "sdk_message_silence_seconds",
                        DEFAULT_SDK_MESSAGE_SILENCE_SECONDS,
                    ),
                    allowed_tools_override=skill_baseline,
                    routing_short_circuit_skills=routing_short_circuit_skills,
                )
                after_snapshot = snapshot_files(workspace)
            finally:
                # Always clean up the SDK's session-store entry so long
                # runs don't accumulate orphans under ~/.claude/projects/.
                cleanup_session_store(workspace)

        if (
            result.aborted_reason not in RETRYABLE_ABORT_REASONS
            or attempt + 1 >= attempts
        ):
            # Record how many attempts this run took so the stall tax is
            # visible per-run in the log (1 = clean first try).
            result.attempts = attempt + 1
            return result, before_snapshot, after_snapshot

        print(
            f"WARNING: skill run for {spec.id} aborted with "
            f"{result.aborted_reason!r} ({result.error!r}); retrying "
            f"(attempt {attempt + 2}/{attempts})",
            file=sys.stderr,
        )
        await asyncio.sleep(delay)
        delay *= 2

    # Unreachable: the final attempt always returns above. Present so
    # type-checkers see a definite return.
    return result, before_snapshot, after_snapshot


def _predicate_matched_count(tool_calls: list[dict[str, Any]]) -> int:
    """Count covered MCP calls — those that matched a fixture predicate or
    were handled by a live tool. Calls with `matched.kind == "none"`
    (fixture_not_found) and calls denied before reaching the mock are not
    counted."""
    return sum(1 for c in tool_calls if c["matched"]["kind"] in ("predicate", "live"))


def _build_warnings(
    tool_calls: list[dict[str, Any]],
    rubric=None,
    skill_frontmatter: dict[str, Any] | None = None,
    attempted_mcp_calls: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Surface run-time advisories the judge / reviewer should see.

    Flags:
    - missing tool-usage rubric dimension when the skill actually called
      MCP tools but its rubric has no dimension covering tool quality
      (v1.8: demoted from runnability gate to per-run warning so a
      rubric author's naming choice doesn't block the test outright)
    - uncovered tool call when the skill emitted more MCP calls than
      matched a fixture predicate or were handled by a live tool.
      Phase 2: only Type 1 (tool doesn't exist) aborts; Type 2 (wrong
      args to existing tool) continues to judge. This warning carries
      the call detail so the reviewer can see which fixtures need to be
      added or corrected.
    """
    warnings: list[dict[str, Any]] = []

    # Tool-usage rubric advisory: the skill actually called an MCP tool,
    # but no rubric dimension name suggests it's being graded.
    if rubric is not None and tool_calls and (skill_frontmatter or {}).get("allowed-tools"):
        from harness.runnability import has_tool_usage_dimension, TOOL_DIMENSION_KEYWORDS
        called_mcp = any(c.get("tool", "").startswith("mcp__") for c in tool_calls)
        if called_mcp and not has_tool_usage_dimension(rubric.dimensions):
            warnings.append({
                "kind": "missing_tool_usage_dimension",
                "advisory": (
                    "Skill called MCP tools but the rubric has no dimension "
                    "name suggesting tool-usage coverage (matched against "
                    f"keywords: {list(TOOL_DIMENSION_KEYWORDS)}). The judge "
                    "will grade other dimensions but won't score tool work "
                    "explicitly. Consider adding a tool-usage dimension or "
                    "renaming an existing one."
                ),
            })

    # Uncovered tool-call advisory: the skill emitted more MCP calls than
    # matched a fixture predicate. Mirrors the orchestrator's abort gate;
    # carries the attempted-call detail the abort reason alone can't.
    attempted = attempted_mcp_calls or []
    covered = _predicate_matched_count(tool_calls)
    if len(attempted) > covered:
        warnings.append({
            "kind": "uncovered_tool_call",
            "advisory": (
                f"{len(attempted) - covered} of {len(attempted)} MCP tool "
                "call(s) matched no fixture predicate — the skill ran against "
                "a fixture_not_found or denied/unknown-tool error. Add or fix "
                "an mcp_fixture whose args match the call."
            ),
            "attempted": attempted,
        })

    return warnings


def _compute_outcome(
    *,
    spec: TestSpec,
    validators_passed: bool,
    judge_dimensions: list[dict[str, Any]],
    aborted_reason: str | None,
    activated: bool,
    skills_invoked: list[str],
    had_substantive_effect: bool = False,
    judge_skipped: bool = False,
) -> str:
    """v1 per-run outcome per spec §7.

    `had_substantive_effect` is True iff *any* substantive side effect
    occurred in the workspace (file changes, files created, or MCP tool
    calls). Used for negative tests with `correct_skill: []`, where the
    rule is "no skill should fire" — a routing-only Skill call that
    declines without effect is allowed per spec §6 ("a one-line response
    that names a different skill and stops" is not activation).

    `judge_skipped` is True iff the judge layer didn't grade (validators
    failed OR judge raised an error). For positive tests, when validators
    passed but the judge was still skipped, that's a judge-crash path —
    the run can't be scored as pass because spec §7 says pass requires
    "every judge dimension scored pass" and zero dimensions can't satisfy
    that. Negative tests with a non-empty `correct_skill` are routing-
    determined (see the negative branch), so a skipped judge doesn't gate
    them; out-of-scope negatives (`correct_skill: []`) have no routing
    signal and are judge-gated, so a skipped judge fails them too.
    """
    if aborted_reason:
        return "aborted"
    if not validators_passed:
        return "fail"

    # Judge-crash path: validators passed but judge raised (missing API
    # key, transient API error, parse failure, etc.). For positive tests,
    # empty dimensions would otherwise fall through to "pass" by default —
    # a silent green on a real failure. Spec §7: pass requires every
    # dimension to score pass; zero dimensions doesn't satisfy that. Fail
    # explicitly. Negative tests are routing-determined (see the negative
    # branch below) — their judge call is base-only and diagnostic, so a
    # judge crash doesn't gate their outcome.
    if judge_skipped and spec.type == "positive":
        return "fail"

    if spec.type == "positive":
        if not activated:
            return "fail"
        # Spec §7: positive tests must have the skill under test in
        # skills_invoked. Substantive file writes or characteristic tool
        # calls feed `activated` but don't substitute for the skill
        # actually firing through the Skill tool — otherwise a positive
        # test "passes" any time Claude happens to write a file, even
        # if Claude routed to the wrong skill or no skill at all.
        #
        # KNOWN RISK: On Linux, the Agent SDK has historically had
        # skill-discovery bugs (testing-plan Appendix F, issue #268) that
        # can leave skills_invoked empty even when the skill ran. We
        # accept the false-fail there in v1.x and rely on the run log's
        # empty `skills_invoked` field as the diagnostic. Tracked in
        # docs/specs/unit-test-spec-v2.md for v2 fidelity work.
        if spec.skill not in skills_invoked:
            return "fail"
    else:  # negative
        # Invariant grading (opt-in via `negative.grade_on_invariant`).
        # The test is graded SOLELY on its deterministic invariant
        # validator(s), which already gated above: reaching this point
        # means not-aborted AND validators_passed. Routing and activation
        # are intentionally NOT gated — for a routing-flaky negative where
        # every plausible route is state-safe (e.g. citation
        # refuse-new-source), the skill may or may not fire, but no run
        # may harm state, and the validator is what enforces that. The
        # invariant must be backed by a tag-gated validator that actually
        # runs; a `grade_on_invariant` test with no such validator passes
        # vacuously (see docs/plan/invariant-grading.md).
        if (spec.negative or {}).get("grade_on_invariant"):
            return "pass"
        # Fail iff the skill under test ACTIVATED. A bare entry in
        # skills_invoked (Claude tried the Skill tool, the skill declined
        # without effect) is not activation per spec §6 — "a one-line
        # response that names a different skill and stops" is the
        # specific non-activation pattern. `activated` already encodes
        # the four-rule definition, so test that directly.
        if activated:
            return "fail"
        correct = (spec.negative or {}).get("correct_skill", [])
        if correct == []:
            # Out-of-scope test. Spec §6 step 2 literal: "pass requires
            # skills_invoked is also []." NO skill should be invoked — not
            # even one that declines.
            if skills_invoked:
                return "fail"
            # Unlike a `correct_skill: ["x"]` test, there is no routing
            # signal here: "no skill fired" holds whether the model
            # cleanly declined OR answered the out-of-scope request
            # itself. The judge's base dimensions — graded with negative
            # framing (see `_negative_judge_context`) — are the only
            # thing that tells those two apart, so for an out-of-scope
            # test they DO gate the outcome. A skipped judge leaves that
            # gate unverified: fail rather than green-light an unchecked
            # run.
            if judge_skipped:
                return "fail"
            # Spec §7: negative tests have no `partial` outcome, so only
            # the fail threshold (a dimension scored 1) applies.
            if 1 in [d["score"] for d in judge_dimensions]:
                return "fail"
            return "pass"
        # Non-empty `correct_skill`: the negative test's purpose is the
        # routing decision. Spec §6's grading sequence is routing-based,
        # and spec §7 states "negative tests don't have rubric
        # dimensions." Once the skill under test didn't activate and an
        # acceptable alternative fired, the test has succeeded — the
        # alternative skill's own execution quality is its positive
        # tests' concern, not this test's. The judge runs base-only and
        # diagnostically (see `_run_judge`); its scores must NOT flip a
        # correctly-routed test.
        if not any(s in skills_invoked for s in correct):
            # Skill didn't fire, but didn't route to an acceptable
            # alternative — the correct_skill array was not satisfied.
            return "fail"
        return "pass"

    # Positive tests only: judge dimensions gate the outcome.
    scores = [d["score"] for d in judge_dimensions]
    # Per-dimension scores are integers 1-3 (1=fail, 2=partial, 3=pass).
    # The run-log-level outcome that this function returns is a string
    # enum (pass/partial/fail/aborted/etc.) — different concept.
    if 1 in scores:
        return "fail"
    if 2 in scores:
        return "partial"
    return "pass"


def _run_judge(
    *,
    spec: TestSpec,
    rubric: Rubric,
    scenario_readme: str,
    result,
    file_changes,
    auth: AuthConfig,
    judge_model: str,
) -> JudgeOutput:
    # Negative tests: the skill correctly declines, so there is no craft
    # output to grade against the skill's rubric. Spec §7 — "negative
    # tests don't have rubric dimensions." Grade base dimensions only,
    # with framing (see `_negative_judge_context`) so the judge scores the
    # quality of the decline/routing decision instead of penalizing the
    # skill for not carrying out its own task. Without this, the judge
    # grades the declining response against the full craft rubric and
    # scores every dimension 1.
    if spec.type == "negative":
        judge_rubric: Rubric = empty_rubric(spec.skill)
        judge_context = _negative_judge_context(spec)
    else:
        judge_rubric = rubric
        judge_context = spec.judge_context
    return grade(
        rubric=judge_rubric,
        judge_context=judge_context,
        scenario_readme=scenario_readme,
        user_message=spec.user_message,
        skills_invoked=result.skills_invoked,
        text_response=result.text_response,
        file_changes_summary=_summarize_changes(
            file_changes, result.tool_calls, include_content=spec.judge_reads_files
        ),
        tool_calls=result.tool_calls,
        auth=auth,
        model=judge_model,
    )


def _negative_judge_context(spec: TestSpec) -> list[str]:
    """Build the judge_context lines for a negative test.

    A negative test passes when the skill under test correctly declines
    to act. The judge grades base dimensions only (empty rubric — see
    `_run_judge`); without framing it would read the declining response
    as an incomplete attempt at the skill's task and score Correctness /
    Completeness as failures. These leading lines tell it that a clean,
    correctly-routed decline is the pass condition. The test's own
    `judge_context` (spec §6 step 3 "additional criteria") is appended
    after the framing.
    """
    correct = (spec.negative or {}).get("correct_skill", [])
    if correct:
        routing = "decline and route the user to: " + ", ".join(correct)
    else:
        routing = (
            "decline without invoking any skill — the request is out of "
            "scope for every skill"
        )
    return [
        f"This is a NEGATIVE test. Correct behavior is for the skill under "
        f"test ({spec.skill}) to NOT perform its own task here — it should "
        f"{routing}.",
        f"Grade Correctness and Completeness on the quality of that "
        f"decline/routing decision: a clear, accurate decline is a full "
        f"pass. Do NOT penalize the response for not carrying out "
        f"{spec.skill}'s task — not doing it is the correct outcome here.",
        *spec.judge_context,
    ]


# Caps for the opt-in content block (test.judge_reads_files). The per-field
# cap is generous enough to carry a full proof narrative including its
# citations; the overall cap bounds the judge prompt against many large writes.
_CHANGES_STRING_MAX = 12_000
_CHANGES_MAX_CHARS = 50_000


def _summarize_changes(file_changes, tool_calls, *, include_content: bool = False) -> str:
    if not file_changes:
        return "(no research.json or tree.gedcomx.json changes)"
    lines = []
    for fname, fdiff in file_changes.items():
        sections = ", ".join(fdiff.get("sections_modified", []))
        lines.append(f"{fname}: modified sections [{sections}]")
        for section, sdiff in fdiff.get("diff", {}).items():
            added = len(sdiff.get("added", []))
            modified = len(sdiff.get("modified", []))
            deleted = len(sdiff.get("deleted", []))
            lines.append(
                f"  {section}: +{added} added, ~{modified} modified, -{deleted} deleted"
            )
    if not include_content:
        # Default for every test/skill: counts only, unchanged legacy behavior.
        return "\n".join(lines)

    # Opt-in (test.judge_reads_files): append the actual written content so the
    # judge can grade a deliverable persisted to a file rather than echoed in
    # the chat reply (e.g. proof-conclusion's narrative_markdown). Per-field and
    # overall truncation bound the judge prompt.
    content_lines = [
        "",
        "Content written to files (the persisted artifact — grade this, not just the chat reply):",
    ]
    for fname, fdiff in file_changes.items():
        for section, sdiff in fdiff.get("diff", {}).items():
            for entry in sdiff.get("added", []):
                summarized = _summarize_response(entry, string_max=_CHANGES_STRING_MAX)
                content_lines.append(
                    f"  {fname} / {section} (added): "
                    f"{json.dumps(summarized, ensure_ascii=False)}"
                )
            for entry in sdiff.get("modified", []):
                eid = entry.get("id")
                after_values = {
                    field: change.get("after")
                    for field, change in entry.get("changed_fields", {}).items()
                }
                summarized = _summarize_response(
                    after_values, string_max=_CHANGES_STRING_MAX
                )
                content_lines.append(
                    f"  {fname} / {section} (modified {eid}, new values): "
                    f"{json.dumps(summarized, ensure_ascii=False)}"
                )
            deleted_ids = [e.get("id") for e in sdiff.get("deleted", [])]
            if deleted_ids:
                content_lines.append(f"  {fname} / {section} (deleted): {deleted_ids}")

    content_block = "\n".join(content_lines)
    if len(content_block) > _CHANGES_MAX_CHARS:
        content_block = (
            content_block[:_CHANGES_MAX_CHARS]
            + f"\n  [content truncated by harness for prompt size; "
            f"full length {len(content_block)} chars]"
        )
    return "\n".join(lines) + "\n" + content_block


def _load_scenario_readme(scenarios_dir: Path, scenario: str | None) -> str:
    if not scenario:
        return ""
    readme = scenarios_dir / scenario / "README.md"
    if not readme.exists():
        return ""
    return readme.read_text(encoding="utf-8")


def _aborted_entry(
    *,
    spec: TestSpec,
    reason: str,
    detail: str,
    timestamp: str,
) -> dict[str, Any]:
    """Build a test entry for a test that aborted before execution.

    Validators didn't run (runnability gate caught it pre-workspace).
    Schema accepts `passed=None` — neither True (vacuous) nor False
    (misleading) honestly represents "did not run."
    """
    single_run = SingleRun(
        outcome="aborted",
        aborted_reason=reason,
        duration_ms=0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={
            "text_response": f"(aborted: {detail})",
            "activated": False,
            "skills_invoked": [],
            "tool_calls": [],
            "files_created": [],
        },
        validators=ValidatorResult(passed=None, results=[]),
        judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0),
    )
    return assemble_test_entry(
        test_id=spec.id,
        test_type=spec.type,
        expected_outcome=spec.expected_outcome,
        scenario=spec.scenario,
        mcp_fixtures=spec.mcp_fixtures,
        runs=[single_run],
        timestamp_for_run_id=timestamp,
    )
