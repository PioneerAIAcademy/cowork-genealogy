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

from harness.allowed_tools import (
    compute_allowed_tools,
    format_uncovered_callee_fixtures,
    uncovered_callee_fixtures,
    declared_skill_tools,
    load_skill_frontmatter,
)
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
from harness.skill_stubs import parse_stub_skills
from harness.skill_runner import (
    DEFAULT_MODEL,
    DEFAULT_SDK_MESSAGE_SILENCE_SECONDS,
    SKILL_TOOL_NAME_KEYS,
    SkillRunResult,
    run_skill,
)
from harness.validator_runner import as_dicts, run_validators, split_observations
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
        "test_project_files_pass_full_validation",
        "test_no_duplicate_tree_ids",
    }
)


def compute_validators_passed(validator_results, *, intentionally_invalid: bool) -> bool:
    """True when no gating validator failed.

    Tier-2 (reporting_only) results are observations, never gates — they are
    skipped here. When the test's scenario is intentionally invalid, the
    file-validity validators are expected to fail and are also ignored; every
    other gating validator still counts.
    """
    return all(
        r.passed
        for r in validator_results
        if not r.reporting_only  # tier-2 never gates (issue #1749)
        and not (intentionally_invalid and r.name in FILE_VALIDITY_VALIDATORS)
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
        validators_dir=paths.validators_dir,
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

    # Sub-skills this test declares it will really run (`execution.run_skills`).
    # Their tools join the allowlist; every other `Skill()` callee named in the
    # body is left un-unioned, so an undeclared delegation behaves exactly as it
    # did before this field existed. See allowed_tools.compute_allowed_tools.
    run_skills = set(spec.execution.get("run_skills") or [])
    skill_baseline = compute_allowed_tools(
        spec.skill, paths.skills_dir, run_skills=run_skills
    )

    # Permission is not existence: the union lets the callee call its tools,
    # but only a fixture makes them resolvable. Without this gate the first
    # such call trips the Phase 2 uncovered-tool-call check below and aborts
    # the CALLER's test ~20 turns in, naming the wrong skill. Fail here
    # instead, before a single token is spent.
    if run_skills:
        declared_fixtures = load_fixtures(spec.mcp_fixtures, paths.fixtures_dir)
        missing = uncovered_callee_fixtures(
            spec.skill,
            paths.skills_dir,
            stubbed_skills=set(parse_stub_skills(spec.execution)),
            registered_tools={f["tool"] for f in declared_fixtures},
        )
        # Only the callees this test opted into can actually run.
        missing = [(c, t) for c, t in missing if c in run_skills]
        if missing:
            raise ValueError(format_uncovered_callee_fixtures(spec.id, missing))

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

    mode, gates = grading_mode_for(spec)
    return assemble_test_entry(
        test_id=spec.id,
        test_type=spec.type,
        expected_outcome=spec.expected_outcome,
        scenario=spec.scenario,
        mcp_fixtures=spec.mcp_fixtures,
        runs=runs,
        timestamp_for_run_id=timestamp,
        grading_mode=mode,
        dimensions_gate_outcome=gates,
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


def _stub_skills(spec: TestSpec) -> dict[str, str | None] | None:
    """Sub-skills a POSITIVE test declares it doesn't want executed.

    Opt-in per test via `execution.stub_skills`, in either the bare-deny or the
    canned-response form — see harness/skill_stubs.py for which to pick and why
    (it turns on whether the CALLER reads the result, not on the callee).

    Assert the hand-off with a `skills_invoked` validator; do not leave it to
    the judge, which reads a transcript and can misread it.
    """
    return parse_stub_skills(spec.execution) or None


# Field names inside one `modelUsage` entry, as the CLI emits them.
_MODEL_USAGE_FIELDS = (
    "inputTokens",
    "cacheReadInputTokens",
    "cacheCreationInputTokens",
    "outputTokens",
)


def _skill_tokens(usage: dict[str, Any]) -> tuple[int, int, int, int, dict[str, Any]]:
    """Token counts for one skill run: (input, cache_read, cache_write, output, per-model).

    Read from `model_usage` — the SDK's per-model ledger — and NOT from
    `usage`, which the CLI documents as possibly carrying a per-turn main-loop
    value rather than a session total. The two disagree by however much work a
    plugin agent did: a subagent runs on its own `model:` pin and gets its own
    `model_usage` key, while `usage` reports only the thread that spawned it.
    `total_cost_usd` covers the same calls as `model_usage`, so this is also the
    only reading that reconciles with the cost the run log already records.

    Measured before this existed: pricing each committed run log's own tokens
    against its own cost put the 21 skills whose runs spawned no agent between
    1.50x and 2.53x (median 1.78x; the spread is the uncaptured cache writes),
    while every skill that did spawn one sat above that range —
    `record-extraction` 3.90x, `research-exhaustiveness` 4.91x (against 1.75x on
    the same fixtures one run earlier, before it became a skill-agent pair) and
    `proof-conclusion` 6.58x. The jump is the agent's tokens, billed and
    uncounted. Read a single ratio with the spread in mind: only a value clear
    of 2.53x says anything on its own.

    The e2e harness does NOT have this defect and must not be "fixed" to match:
    all 78 committed e2e runs carrying a usable cost spawned an agent, and they
    price at median 0.90x of recorded — pricing.py's own calibration figure —
    where a main-thread-only count would put them near the 0.15-0.20x the unit
    harness's paired skills show. Its `usage` block is already a session total.

    Falls back to `usage` when `model_usage` is absent — an older CLI, or the
    abort path where no ResultMessage arrived. The fallback cannot report cache
    writes (that key is not in `usage` at all), so it returns 0 for them rather
    than inventing a number.
    """
    per_model = usage.get("model_usage")
    if isinstance(per_model, dict) and per_model:
        totals = []
        for field in _MODEL_USAGE_FIELDS:
            total = 0
            for entry in per_model.values():
                if isinstance(entry, dict):
                    raw = entry.get(field)
                    if isinstance(raw, int) and not isinstance(raw, bool):
                        total += raw
            totals.append(total)
        return (*totals, per_model)

    sdk_usage = usage.get("usage") or {}
    return (
        int(sdk_usage.get("input_tokens") or 0),
        int(sdk_usage.get("cache_read_input_tokens") or 0),
        0,
        int(sdk_usage.get("output_tokens") or 0),
        {},
    )


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
        stub_skills=_stub_skills(spec),
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

    # --- Extract usage early — validators may need num_turns / output_tokens
    # (tier-2 reporting, issue #1749). Previously extracted after validators
    # at the run-log assembly step; moved here so both sites use the same
    # locals. _skill_tokens is pure so calling it twice would also work.
    _usage = result.usage or {}
    _num_turns = int(_usage.get("num_turns") or 0)
    _, _, _, _output_tokens, _ = _skill_tokens(_usage)

    # --- Validators -----------------------------------------------------
    validator_results = run_validators(
        skill=spec.skill,
        validators_dir=paths.validators_dir,
        text_response=result.text_response or "",
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
        blocked_context_calls=result.blocked_context_calls,
        blocked_protected_writes=result.blocked_protected_writes,
        attempted_mcp_calls=result.attempted_mcp_calls,
        skill_frontmatter=skill_frontmatter,
        skills_invoked=result.skills_invoked,
        activated=activated,
        num_turns=_num_turns,
        output_tokens=_output_tokens,
        aborted_reason=result.aborted_reason,
        test={
            **spec.raw.get("test", {}),
            # Top-level validator-facing block threaded in alongside the
            # inner test metadata: deterministic classification ground
            # truth for test_expected_classifications
            # (unit-test-spec.md §5.10).
            "expected_classifications": spec.raw.get(
                "expected_classifications", []
            ),
            # Also threaded in: `execution`, so test_tool_allowlist can widen
            # by the same `run_skills` rule the session allowlist used. A
            # callee's calls land in this run's tool_calls log, and without
            # the declaration the validator reads a legal hand-off as a
            # violation (issue #1012).
            "execution": spec.execution,
        },
    )
    validators_passed = compute_validators_passed(
        validator_results, intentionally_invalid=spec.intentionally_invalid
    )

    # --- Split gating vs reporting validator results (issue #1749) --------
    # Gating failures (tier 1, test_*): pass r.name — existing behavior.
    validator_failures = [
        r.name for r in validator_results
        if not r.passed and not r.reporting_only
    ]
    # Reporting observations (tier 2, report_*): pass r.error (the
    # observation text), NOT r.name (which is a verdict). The function name
    # goes only to the run log for traceability, never the judge.
    harness_observations = split_observations(validator_results)
    # For _build_warnings: (name, observation) tuples so the run log records
    # which report_* function fired.
    _harness_observation_pairs = [
        (r.name, r.error) for r in validator_results
        if r.reporting_only and not r.passed and r.error
    ]

    # --- Judge ----------------------------------------------------------
    # Advisories from _extract_dimensions (a dropped unknown/duplicate
    # dimension, #1361) — populated only on the successful branch below.
    # judge_results (the `judge` field) has no warnings property of its own
    # (additionalProperties:false — docs/specs/schemas/run-log.schema.json)
    # so these are folded into the SKILL-level `output.warnings` instead,
    # via _build_warnings below, alongside its other advisory kinds.
    judge_dimension_warnings: list[dict[str, Any]] = []
    if validators_passed and result.aborted_reason is None:
        _judge_start = time.perf_counter()
        try:
            judge_output = _run_judge(
                # Failures only — a passing list is a conclusion, and the judge
                # grades a conclusion by agreeing with it.
                validator_failures=validator_failures,
                harness_observations=harness_observations,
                spec=spec,
                rubric=rubric,
                scenario_readme=scenario_readme,
                result=result,
                file_changes=file_changes,
                before_snapshot=before_snapshot,
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
            judge_dimension_warnings = judge_output.warnings
        # Records judge wall-clock on every attempted branch (success or
        # error). The skipped branch below leaves the 0.0 default.
        judge_result.duration_ms = (time.perf_counter() - _judge_start) * 1000.0
    else:
        judge_result = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)

    # Deterministic-validator deference: a passing expected_classifications
    # check floors the classification judge-dimensions so a fuzzy re-grade can't
    # override verified ground truth (the dominant flap source). Runs before the
    # outcome is computed so the floored scores drive pass/partial/fail.
    apply_deterministic_deference(
        judge_result.dimensions,
        validator_results,
        has_expected_classifications=bool(spec.raw.get("expected_classifications")),
    )

    # A judge FAIL on a correctly-routed negative test is REPORTED, not floored:
    # the corpus says the judge is usually right (20 of 24 human-confirmed), and
    # these dimensions never gated the outcome anyway.
    flag_routing_negative_judge_fail(
        judge_result.dimensions,
        spec=spec,
        activated=activated,
        skills_invoked=result.skills_invoked,
        warnings=judge_dimension_warnings,
    )

    outcome = _compute_outcome(
        spec=spec,
        validators_passed=validators_passed,
        failed_validators=frozenset(
            r.name for r in validator_results if not r.passed
        ),
        judge_dimensions=judge_result.dimensions,
        aborted_reason=result.aborted_reason,
        activated=activated,
        skills_invoked=result.skills_invoked,
        judge_skipped=judge_result.skipped,
    )

    skill_input, skill_cached, skill_cache_write, skill_output, per_model = (
        _skill_tokens(_usage)
    )
    # SDK timing (present only when a ResultMessage arrived — i.e. not on a
    # wall-clock / stream-silence abort, where these stay 0).
    skill_duration_api_ms = float(_usage.get("duration_api_ms") or 0.0)
    skill_num_turns = _num_turns
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
        # Run-level tokens are SKILL ONLY, and cover every model the run
        # touched — the main thread plus any plugin agent it delegated to.
        # Judge tokens live on the judge block so the spec's cache-hit-rate
        # diagnostic — cached / (cached + input) on the skill side — stays
        # meaningful. Those two counts are disjoint (input excludes cache
        # reads), so the rate is a share of their sum; see unit-test-spec.md
        # § Run Log Format.
        input_tokens=skill_input,
        cached_input_tokens=skill_cached,
        cache_creation_input_tokens=skill_cache_write,
        output_tokens=skill_output,
        model_usage=per_model,
        skill_cost_usd=float(_usage.get("total_cost_usd") or 0.0),
        output={
            "text_response": result.text_response,
            "activated": activated,
            "skills_invoked": result.skills_invoked,
            "tool_calls": [_tool_call_entry(c) for c in result.tool_calls],
            "files_created": files_created,
            # Omitted when empty so a run that called no built-in tool writes
            # the same run_output it always has — this field appearing is
            # itself the signal that something was read.
            **(
                {"builtin_tool_calls": result.builtin_tool_calls}
                if result.builtin_tool_calls
                else {}
            ),
            **({"file_changes": file_changes} if file_changes else {}),
            **(
                {"warnings": warnings}
                if (warnings := _build_warnings(
                    result.tool_calls,
                    rubric=rubric,
                    skill_frontmatter=skill_frontmatter,
                    attempted_mcp_calls=result.attempted_mcp_calls,
                    unread_skill_calls=result.unread_skill_calls,
                    judge_warnings=judge_dimension_warnings,
                    harness_observations=_harness_observation_pairs,
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

_ALWAYS_RETRYABLE_ABORTS = {"error", "sdk_stream_silence"}


def _is_zero_progress_timeout(result) -> bool:
    """A `max_wall_clock_seconds` abort where the run never got going.

    Reads `usage["num_turns"]`, which on this path is set by the timeout
    handler in `skill_runner` from a counter incremented per AssistantMessage
    as they stream — NOT from the SDK's ResultMessage. That distinction is the
    whole correctness of this guard: `usage` is otherwise populated only in
    the ResultMessage branch, and a wall-clock timeout cancels the consumer
    before that message arrives, so every wall-clock abort would look like
    zero progress and EVERY slow test would be retried — burning the full cap
    once per attempt (1500s x 3) at 3x the tokens. Caught in review before
    that shipped; do not re-derive this from `duration_api_ms`, which is
    genuinely unavailable here.

    Zero turns means the whole budget went by without the model answering
    once: the subprocess stalled during startup, which is the
    `Control request timeout: initialize` failure the `error` path already
    retries, arriving under a different name because the wall-clock watchdog
    fired first.

    Observed 2026-08-15: two tests aborted at 1888s and 1908s against a 1500s
    cap having never started, and were lost from a paid suite run. A third hit
    the same stall, surfaced as `error`, was retried, and passed.

    Deliberately narrow: a run that timed out mid-work has turns, so it stays
    non-retryable and does not burn its budget twice.
    """
    if result.aborted_reason != "max_wall_clock_seconds":
        return False
    # Explicit 0, not falsy: a MISSING `num_turns` means the timeout handler
    # that records it did not run, so we cannot tell a stall from slow work —
    # and the safe answer there is "don't retry". Fails closed, so if that
    # handler is ever removed this guard quietly reverts to the old
    # never-retry behaviour instead of silently retrying every slow test.
    return (result.usage or {}).get("num_turns") == 0


def _is_retryable_abort(result) -> bool:
    """Whether a failed skill run should be retried (see the two helpers and
    `_execute_skill_with_retry`'s docstring)."""
    if result.aborted_reason in _ALWAYS_RETRYABLE_ABORTS:
        return True
    return _is_zero_progress_timeout(result)


async def _execute_skill_with_retry(
    *,
    run_index: int,
    spec: TestSpec,
    paths: OrchestratorPaths,
    skill_baseline: list[str],
    auth: AuthConfig,
    model: str,
    routing_short_circuit_skills: set[str] | None = None,
    stub_skills: dict[str, str | None] | None = None,
    attempts: int = DEFAULT_SKILL_RUN_ATTEMPTS,
    base_delay: float = 1.0,
) -> tuple[SkillRunResult, dict[str, Any], dict[str, Any]]:
    """Build a fresh workspace and run the skill, retrying transient
    failures with exponential backoff. See `_is_retryable_abort`.

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
    `max_input_tokens_per_turn`) are NOT retried — a retry would just burn
    the same budget — so they return on the first attempt. The Agent SDK
    collapses every other failure into `is_error`/exceptions without the
    clean HTTP status codes the judge path discriminates on, so a genuinely
    non-transient error is retried too; the cost is bounded (`attempts`
    tries plus a few seconds of backoff).

    3. `max_wall_clock_seconds` **with zero progress** — see
       `_is_zero_progress_timeout`. A wall-clock abort is normally a slow
       test and stays non-retryable; one that burned the whole budget
       without a single turn never started, which is the same transient
       class as (1) and (2).

    Returns (SkillRunResult, before_snapshot, after_snapshot).
    """
    delay = base_delay
    result: SkillRunResult | None = None
    before_snapshot: dict[str, Any] = {}
    after_snapshot: dict[str, Any] = {}
    for attempt in range(attempts):
        attempt_completed = False
        try:
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
                        stub_skills=stub_skills,
                        # The skill's OWN declaration, not skill_baseline (which
                        # unions in its subagents' tools). The gap between the two
                        # is what the per-context policy guards.
                        declared_tools=declared_skill_tools(
                            spec.skill, paths.skills_dir
                        ),
                    )
                    after_snapshot = snapshot_files(workspace)
                    attempt_completed = True
                finally:
                    # Always clean up the SDK's session-store entry so long
                    # runs don't accumulate orphans under ~/.claude/projects/.
                    cleanup_session_store(workspace)
        except RecursionError:
            # Windows-only stdlib footgun: tempfile.TemporaryDirectory's
            # _rmtree/onexc recovery treats a locked *file* PermissionError as
            # "maybe this is actually a directory" and retries _rmtree on it,
            # which recurses forever when the file is genuinely locked (a
            # lingering subprocess handle) rather than a directory.
            # ignore_cleanup_errors=True does not cover this path -- it only
            # suppresses the `else` branch for non-Permission/FileNotFound
            # exceptions. By this point build_workspace/run_skill already
            # completed and before_snapshot/result/after_snapshot are
            # populated above; only the tempdir's own removal failed. Same
            # rationale as ignore_cleanup_errors itself: a leaked temp dir is
            # strictly better than discarding an already-computed result.
            #
            # Re-raised unless the attempt already produced a result. Without
            # that guard this `except` also swallows a RecursionError raised
            # from build_workspace/run_skill INSIDE the block, and the loop then
            # returns the PREVIOUS attempt's result stamped with this attempt's
            # number — silently, with no exception and no warning (#1735 review).
            if not attempt_completed:
                raise

        if not _is_retryable_abort(result) or attempt + 1 >= attempts:
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
    unread_skill_calls: list[list[str]] | None = None,
    judge_warnings: list[dict[str, Any]] | None = None,
    harness_observations: list[tuple[str, str]] | None = None,
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
    - unread skill call when a Skill tool call carried the invoked skill's
      name under a key the harness doesn't read, meaning the SDK's Skill
      contract moved and `skills_invoked` is undercounting.
    - dropped judge dimension (`dropped_unknown_rubric_dimension` /
      `dropped_duplicate_dimension`, #1361) — passed in already-built by
      the caller from `JudgeOutput.warnings`, since building them requires
      the judge's raw tool_use output, which this function never sees.
      Same drop-not-fail rationale as the tool-usage dimension above: v1.8
      demoted that check from a hard gate to a warning for the same
      reason — a naming mismatch shouldn't cost the whole test.
    """
    warnings: list[dict[str, Any]] = list(judge_warnings or [])

    # Skill-tool contract drift. Without this the failure is invisible:
    # skills_invoked stays empty, every routing verdict reads "never
    # activated", and the suite fails as if the skills regressed.
    if unread_skill_calls:
        observed = sorted({key for keys in unread_skill_calls for key in keys})
        warnings.append({
            "kind": "unread_skill_call",
            "advisory": (
                f"{len(unread_skill_calls)} Skill tool call(s) carried no "
                f"{' or '.join(repr(k) for k in SKILL_TOOL_NAME_KEYS)} input "
                f"key; keys seen: {observed or '(none)'}. The SDK's Skill-tool "
                "contract has changed — skills_invoked is undercounting and "
                "activation/routing grades are unreliable until "
                "SKILL_TOOL_NAME_KEYS in skill_runner.py is updated."
            ),
            "observed_keys": observed,
        })

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

    # Tier-2 reporting observations (issue #1749). The function name goes in
    # the run log for traceability ("check"); the observation text goes to
    # the reviewer. Neither the name nor the text reaches the judge — only
    # harness_observations (the anonymous text list) is passed to the judge
    # prompt, and that happens in _run_judge, not here.
    for check_name, obs_text in (harness_observations or []):
        warnings.append({
            "kind": "prose_observation",
            "check": check_name,
            "observation": obs_text,
        })

    return warnings


# Judge dimensions whose subject is checked deterministically by the
# `test_expected_classifications` validator (it verifies evidence_type,
# informant_proximity, and information_quality on the declared
# (record_role, fact_type) pairs). When that validator PASSES, the LLM judge
# must not FAIL these dimensions on the same classifications — a fail there is
# the judge contradicting verified ground truth (the recurring census
# direct/indirect inversion, and the death-cert evidence-type flip). This is the
# single biggest source of run-to-run flap: the deterministic check is stable,
# the fuzzy re-grade is not (record-extraction tool-boundary work, 2026-07-16).
_CLASSIFICATION_DIMENSIONS = frozenset(
    {"Evidence type accuracy", "Informant identification"}
)

# Base dimensions floored on a correctly-routed negative test. On a negative
# test with a non-empty `correct_skill`, `_compute_outcome` decides pass/fail
# from routing alone and the judge runs base-only and diagnostically — so a
# FAIL here grades the routed-to skill's work, which this test does not own.
# The judge does it anyway: "No such routing occurred" while the transcript's
# own Skills-invoked block names an accepted skill, across 9 tests in 5 skills.
# Prose was tried twice (PRs #589 and #1564) and it recurs, so defer instead.
_ROUTING_DIAGNOSTIC_DIMENSIONS = frozenset({"Correctness", "Completeness"})


def apply_deterministic_deference(dimensions, validator_results, *, has_expected_classifications):
    """Floor the classification judge-dimensions at partial(2) when the
    deterministic `test_expected_classifications` validator verified the declared
    classifications as correct — a judge FAIL there contradicts verified ground
    truth. Partial is still permitted (the judge may see a real issue on an
    assertion the validator did not declare); only the false FAIL is removed.
    Mutates + returns `dimensions`. No-op when the test declares no
    expected_classifications, the validator did not pass, or the judge was
    skipped (empty dimensions)."""
    if not has_expected_classifications or not dimensions:
        return dimensions
    ec_passed = any(
        getattr(r, "name", None) == "test_expected_classifications"
        and getattr(r, "passed", False)
        for r in validator_results
    )
    if not ec_passed:
        return dimensions
    for dd in dimensions:
        if dd.get("name") in _CLASSIFICATION_DIMENSIONS and dd.get("score") == 1:
            orig = dd.get("rationale") or ""
            dd["score"] = 2
            dd["rationale"] = (
                "[deterministic-deference] the expected_classifications validator "
                "verified the declared classifications as correct, so this dimension "
                "cannot FAIL on them — floored from the judge's 1 to 2 (partial). "
                "Original judge rationale: " + orig
            )
    return dimensions


def flag_routing_negative_judge_fail(
    dimensions, *, spec, activated, skills_invoked, warnings=None
):
    """Report a judge FAIL on a correctly-routed negative test. Change no score.

    This used to FLOOR Correctness/Completeness from 1 to 2 here, on the theory
    that the judge was grading the routed-to skill's execution rather than
    anything this test owns. **The corpus says the opposite.** Replaying the
    floor's own guards over the 121 committed unit run logs and joining to the
    annotations: 24 cells were floor-eligible with a judge 1, and a human
    confirmed that 1 on **20 of them**. All 14 cells where the skill produced
    non-empty output (102-14,123 chars) were confirmed, with rationales naming
    the case the old docstring called a rare corner ("instead of declining and
    routing to convert-dates, it performed the date conversion itself") — the
    smallest of them, 102 chars, is a fabricated completion claim ("Saved as
    kirchenbuch.md") on a run that created no file.

    **There is still no mechanical discriminator, and gating on empty output is
    worse than deleting.** All 4 overrides had `text_response == ""` and
    `num_turns == 0` — but so did 6 of the 20 confirmations, and the same test
    (`ut_search_records_003`) carries that identical empty/zero-turn signature in
    all 8 of its eligible cells: confirmed in two run logs, overridden in two
    others. So a floor gated on empty output would have fired on 10 cells and
    been wrong on 6. The floor's real defect was not picking the wrong signal; it
    was that no signal exists.

    Deleting gives up nothing measurable: `_compute_outcome` decides a
    negative-with-`correct_skill` purely on routing, so no score this function
    could change has ever moved a test's outcome.

    What remains is the warning, which is the half that was actually load-bearing
    and which nobody could see: its kind was never registered in
    `run_tests.py::_JUDGE_WARNING_KINDS`, so it printed nowhere. It is registered
    now. A judge 1 here is worth a human's eye — it is either the skill doing the
    work inline (a real defect this suite would otherwise miss) or the judge
    misreading a clean decline.

    Returns `dimensions` unmodified; appends to `warnings` when given. No-op
    unless the test is negative with a non-empty `correct_skill`, the skill under
    test did not activate, and an accepted skill is in `skills_invoked`.
    """
    if not dimensions:
        return dimensions
    negative = spec.negative or {}
    if negative.get("grade_on_invariant"):
        return dimensions
    if activated:
        return dimensions
    # The `any()` check below is the only guard needed, and it is load-bearing
    # for three cases at once — do not "clarify" it by adding separate guards.
    # Each of these leaves `correct` empty, and `any()` over an empty sequence
    # is False:
    #   - a POSITIVE test (the schema forbids it a `negative` block at all),
    #   - an OUT-OF-SCOPE negative (`correct_skill: []`), which must not be
    #     floored because its base dimensions genuinely DO gate the outcome in
    #     `_compute_outcome`,
    #   - a negative that routed nowhere acceptable.
    # A `if not correct:` and a `spec.type != "negative"` guard were both tried
    # here; both were unreachable, and each made its own test unable to fail.
    correct = negative.get("correct_skill", [])
    if not any(s in (skills_invoked or []) for s in correct):
        return dimensions
    for dd in dimensions:
        if dd.get("name") in _ROUTING_DIAGNOSTIC_DIMENSIONS and dd.get("score") == 1:
            if warnings is not None:
                warnings.append({
                    "kind": "routing_negative_judge_fail",
                    "advisory": (
                        f"judge scored {dd['name']} 1 on a negative test whose "
                        f"outcome is decided by routing. Across the committed "
                        f"corpus a human confirmed this 1 in 20 of 24 such "
                        f"cells, so read it before overriding it: if the skill "
                        f"under test carried out its own task inline, the 1 is "
                        f"right and the routing pass is hiding a real defect."
                    ),
                    "name": dd["name"],
                    "score": dd.get("score"),
                    "rationale": dd.get("rationale") or "",
                })
    return dimensions


# Deterministic execution-cap aborts that a validator FAILURE dominates in the
# recorded outcome (issue #1866 V7). A run that wrote a section it doesn't own
# and then hit its wall-clock cap is a skill defect, not a timeout — recording
# it `aborted` tells every reader (eval/CLAUDE.md "Reading an `aborted` row")
# that it "says nothing about the skill", which is how ut_research_plan_016's
# two failed validators stayed invisible.
#
# Only these three are dominated. `unmatched_tool_call` is a test-corpus problem
# (exit 2) and the two transient reasons (`error`, `sdk_stream_silence`) drive
# the exit-code split and the suite breaker (`_TRANSIENT_ABORT_REASONS`,
# run_tests.py) — demoting either would report an environment failure as a skill
# regression. `not_runnable` never reaches this function (`_aborted_entry`).
# `max_input_tokens_per_turn` is a fourth deterministic cap of the same class,
# left out and staying out: now that a demotion is gated on a failed COMMISSION
# validator (below), which cap fired no longer carries the classification weight,
# so the fourth cap adds nothing here (johnmarkpeterbrown's ruling, #1866).
_VALIDATOR_DOMINATED_ABORTS = frozenset(
    {"max_wall_clock_seconds", "max_turns", "max_tool_calls"}
)


# Validators whose FAILURE means the run actively DID something wrong — wrote to a
# section it does not own, or bypassed the writer tools to touch a protected file.
# A deterministic execution cap (`_VALIDATOR_DOMINATED_ABORTS`) truncates a run
# mid-write: it can only make the run FAIL TO DO something (an omission), never make
# it DO something wrong (a commission). So only a failed commission validator proves
# a defect the timeout cannot explain, and only then is an abort demoted to `fail`
# (issue #1866 V7, johnmarkpeterbrown's ruling).
#
# An ALLOW-LIST, deliberately: it fails in the safe direction. A validator nobody
# has classified is absent here, so its failure under a cap leaves the run `aborted`
# — the pre-V7 behaviour — rather than risking a real regression being filed against
# a run the clock killed. That is the exact mis-file (pointed the other way) V7 exists
# to prevent: on the committed corpus the blanket rule demoted 3 of 4 cap-aborts whose
# only failing validators were omissions (record_extraction_018/020's "no new
# assertion…", person_evidence_022's "never invoked check-warnings"). Membership is
# intentionally minimal — the universal forbidden-write checks, which a timeout cannot
# trip; extend it as validators are classified, never by complementing the omission set.
#
# `test_commission_validators_are_all_collected` fails if a name here stops matching a
# real validator: a silent rename would quietly stop demoting it (the lead's condition).
_COMMISSION_VALIDATORS = frozenset(
    {
        "test_ownership_table",
        "test_tree_ownership_table",
        "test_no_raw_writes_to_protected_files",
        "test_project_file_changes_route_through_writer_tools",
    }
)


#: Keys the mock adds to a fixture's response AFTER matching and BEFORE logging
#: (`mock_mcp.py` ~461/477/501). Their presence means the logged response is not
#: the stored fixture, so `response_fixture` + `matched.index` cannot rebuild it
#: — `staged.resultsRef` in particular comes from `randomUUID()` and exists in no
#: commit.
_MOCK_ENRICHED_KEYS = ("staged", "ranked", "rankingSkipped")


def _is_mock_enriched(response: Any) -> bool:
    """Whether the mock rewrote this response after choosing its fixture."""
    return isinstance(response, dict) and any(
        k in response for k in _MOCK_ENRICHED_KEYS
    )


def _tool_call_entry(c: dict[str, Any]) -> dict[str, Any]:
    """One `output.tool_calls` entry, keeping the response the mock already captured.

    The mock has always recorded it — `mock_mcp.py`'s call-log docstring lists
    `"response"` as a key and all five `call_log.append` sites set it — and this
    projection dropped it on the way into the run log. So no post-hoc analysis
    of a committed run log could answer "what did the skill actually see?", and
    the warn-only `person_evidence` guardrail (#1550) could not be calibrated
    from the unit tier at all. Measured 2026-08-24: 2,812 tool calls across the
    August-2x run logs, zero carrying a response.

    **Kept where the content exists nowhere else** (lead, 2026-08-24): most
    `predicate` matches are recoverable from `response_fixture` plus
    `matched.index` at that commit, so re-storing those bytes duplicates what git
    already holds — and shrinking run logs is why `schema_version` 3 exists.
    `live` and `none` calls have no such source, and `live` is the case the named
    use (`research_append`) needs.

    **But "recoverable" is not true of every predicate match, so it is tested
    rather than assumed.** The mock ENRICHES a matched fixture response after
    selecting it and before logging it (`mock_mcp.py`: `staged` ~461, `ranked`
    ~477, `rankingSkipped` ~501, all above `entry["response"] = response` at
    ~506). An enriched response is therefore NOT the stored fixture, and
    `staged.resultsRef` is not reconstructable at all — `results-staging.ts`
    builds it from `randomUUID()`, so no commit holds that value. Up to 420 committed
    predicate calls are in this state — the ones passing a `projectPath`, which
    all three enrichment paths require (`staged` gates on it directly,
    `rankingSkipped` on its presence, `ranked` on `staged`). Eligibility, not
    confirmed enrichment, so it is a tight upper bound; the other 167
    `external_links_search` calls pass none and are the plain-predicate case the
    rule correctly omits.

    So the rule keys on the RESPONSE, not on `matched.kind` alone: an enriched
    response is kept whatever its kind. Keyed on the enrichment markers rather
    than on a list of the three tools that have them today, so a fourth tool
    gaining staging is covered without editing this function — a tool list would
    silently drop it.
    """
    entry = {
        "tool": c["tool"],
        "args": c["args"],
        "expected_args": c.get("expected_args"),
        "matched": c["matched"],
        "response_fixture": c.get("response_fixture"),
    }
    response = c.get("response")
    kind = (c.get("matched") or {}).get("kind")
    if kind in ("live", "none") or _is_mock_enriched(response):
        entry["response"] = response
    return entry


def grading_mode_for(spec: TestSpec) -> tuple[str, bool]:
    """What decides this test's outcome, and whether the judge dimensions do.

    Returns `(grading_mode, dimensions_gate_outcome)` for the run log, so a
    reader of the raw JSON can tell a designed contradiction from a broken one.

    This is the defect issue #1000 was filed on: `ut_search_records_005`
    reported `outcome: "pass"` beside `Correctness = 1` with a rationale
    describing an outright routing failure, and a reviewer concluded from the
    run log that the harness miscomputes negative outcomes — a confident,
    incorrect correctness claim inside a PR approval. The outcome was right; the
    run log simply never said the dimensions were diagnostic. It renders them
    identically to a positive test's, where a 1 genuinely does force a fail.

    The three modes mirror `_compute_outcome`'s branches exactly, and must keep
    mirroring them — `test_grading_mode_matches_what_compute_outcome_does`
    drives the real function with a dimension scored 1 and asserts the outcome
    flips iff `dimensions_gate_outcome` is True, so this cannot drift into a
    comfortable lie without a test going red:

    - `"invariant"` — `negative.grade_on_invariant`. `_compute_outcome` returns
      `pass` on the tag-gated validator alone. Dimensions never gate.
    - `"routing"` — a negative with a non-empty `correct_skill`. The verdict is
      the routing decision; the judge runs base-only and diagnostically.
    - `"dimensions"` — positive tests, and out-of-scope negatives
      (`correct_skill: []`), where "no skill fired" holds whether the model
      cleanly declined or answered the request itself, so the base dimensions
      are the only thing telling those apart and they DO gate.
    """
    if spec.type == "positive":
        return "dimensions", True
    negative = spec.negative or {}
    if negative.get("grade_on_invariant"):
        return "invariant", False
    if negative.get("correct_skill", []) == []:
        return "dimensions", True
    return "routing", False


def _compute_outcome(
    *,
    spec: TestSpec,
    validators_passed: bool,
    failed_validators: frozenset[str] = frozenset(),
    judge_dimensions: list[dict[str, Any]],
    aborted_reason: str | None,
    activated: bool,
    skills_invoked: list[str],
    judge_skipped: bool = False,
) -> str:
    """v1 per-run outcome per spec §7.

    `judge_skipped` is True iff the judge layer didn't grade (validators
    failed OR judge raised an error). For positive tests, when validators
    passed but the judge was still skipped, that's a judge-crash path —
    the run can't be scored as pass because spec §7 says pass requires
    "every judge dimension scored pass" and zero dimensions can't satisfy
    that. Negative tests with a non-empty `correct_skill` are routing-
    determined (see the negative branch), so a skipped judge doesn't gate
    them; out-of-scope negatives (`correct_skill: []`) have no routing
    signal and are judge-gated, so a skipped judge fails them too.

    A COMMISSION-validator failure dominates a deterministic execution-cap abort
    (issue #1866 V7): `aborted` normally short-circuits, but a run that failed a
    validator in `_COMMISSION_VALIDATORS` AND hit one of
    `_VALIDATOR_DOMINATED_ABORTS` is recorded `fail`, so a real defect isn't filed
    under a timeout. Scoped to commission validators, not any failed validator: a
    cap truncates a run mid-write, so an omission-only failure ("expected X, got
    none") is the timeout's doing, not the skill's, and stays `aborted`. The
    `aborted_reason` field stays populated on the SingleRun either way — only
    `outcome` changes.
    """
    if aborted_reason:
        if (
            failed_validators & _COMMISSION_VALIDATORS
            and aborted_reason in _VALIDATOR_DOMINATED_ABORTS
        ):
            return "fail"
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
        # vacuously (see docs/specs/unit-test-spec.md).
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
    before_snapshot: dict[str, Any] | None = None,
    auth: AuthConfig,
    judge_model: str,
    validator_failures: list[str] | None = None,
    harness_observations: list[str] | None = None,
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
        before_state=_summarize_before_state(before_snapshot),
        validator_failures=validator_failures,
        harness_observations=harness_observations,
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
        f"Conversely, if {spec.skill} instead carried out its own task, or "
        f"produced substantive output when it should have declined or stayed "
        f"silent, score Correctness and Completeness as fail (1) — polished "
        f"output for the wrong behavior is still a failure, not a pass.",
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
    #
    # `array_sample=None` on this path only. The block's own header calls this
    # "the persisted artifact — grade this", and the default cap of 3 was
    # applying at every depth, so a nested `items[]` inside one added entry was
    # cut to its first three while the entry list itself looked complete — a
    # plan with 9 items showed 3, under a heading telling the judge it was
    # looking at the artifact. The tool-response and before-state paths keep the
    # cap: there the first few hits show argument quality and the rest is noise.
    # `_CHANGES_STRING_MAX` and the overall prompt bound still apply.
    content_lines = [
        "",
        "Content written to files (the persisted artifact — grade this, not just the chat reply):",
    ]
    for fname, fdiff in file_changes.items():
        for section, sdiff in fdiff.get("diff", {}).items():
            for entry in sdiff.get("added", []):
                summarized = _summarize_response(
                    entry, string_max=_CHANGES_STRING_MAX, array_sample=None
                )
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
                    after_values, string_max=_CHANGES_STRING_MAX, array_sample=None
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


# Caps for the before-state block. Per-field cap is generous enough to carry
# a full citation/source note; the overall cap bounds the judge prompt against
# a large pre-existing project.
_BEFORE_STATE_STRING_MAX = 4_000
_BEFORE_STATE_MAX_CHARS = 40_000


def _summarize_before_state_sources(sources: Any) -> dict[str, Any]:
    """Summarize one before-state source array for the judge, keeping the
    COMPLETE list of ids.

    The judge uses the before-state block to check "references an id that isn't
    on file" / "fabricated a source" claims, and that check is only sound if it
    can see *every* id that was on file. The generic `_summarize_response`
    samples a list down to its first `_RESPONSE_ARRAY_SAMPLE` (=3) entries —
    which silently dropped the 4th+ source and made the judge (and human
    annotators reading the same block) flag a correctly-cited later source
    (`src_004` / `S4`) as fabricated. That is the exact failure this block was
    written to prevent. So emit the full id list explicitly, and summarize the
    heavy per-source content (citations, notes) one source at a time.

    Summarizing **per source** rather than handing the array to
    `_summarize_response` is the point: the sampler only truncates the container
    it is given, so a list of 9 comes back as 3 while 9 separate calls come back
    as 9. Fixing this for the ids alone (a37a7fe4 / c7f56c3c) left the misgrade
    alive in a subtler form — the judge could see `src_006` in `all_ids`, find no
    citation for it in the detail, and call a correctly-cited source fabricated
    anyway. That is ut_research_plan_001's recurring base-Correctness 2. Per-string
    truncation and the depth cap still apply inside each source, and the caller's
    `_BEFORE_STATE_MAX_CHARS` trim still bounds the block — dropping detail,
    never ids.
    """
    items = sources if isinstance(sources, list) else []
    ids = [s["id"] for s in items if isinstance(s, dict) and s.get("id")]
    return {
        "count": len(items),
        "all_ids": ids,
        "detail": [
            _summarize_response(s, string_max=_BEFORE_STATE_STRING_MAX)
            for s in items
        ],
    }


def _resolve_assertion(
    assertion_id: Any, index: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Resolve one assertion id to the compact value the judge needs.

    A conflict stores ids; the judge grades a claim (a URL parameter, a
    narrated place) against the *value* those ids carry, never against the id
    itself. So resolve `preferred_assertion_id` / `competing_assertion_ids`
    through `assertions[]` to the fields that decide a grade. A referenced id
    absent from `assertions[]` (dangling ref — they exist in fixtures) renders
    as `_unresolved` rather than crashing the whole before-state render.
    """
    a = index.get(assertion_id)
    if a is None:
        return {"id": assertion_id, "_unresolved": True}
    return {
        k: a[k]
        for k in ("id", "fact_type", "value", "structured_value", "place", "date")
        if k in a
    }


# Heavy per-conflict prose the prompt-size budget may drop (never the ids or
# the resolved values, which are what make a "no conflict on file" claim
# checkable).
_CONFLICT_HEAVY_FIELDS = (
    "independence_analysis",
    "weighing_analysis",
    "resolution_rationale",
    "description",
)


def _summarize_before_state_conflicts(
    conflicts: Any, assertions: Any
) -> dict[str, Any]:
    """Summarize the conflicts on file before the skill ran, resolving each
    conflict's assertion references to their values.

    Same discipline as `_summarize_before_state_sources`: the COMPLETE id list
    is the ground truth for a "no conflict on file" existence check and is never
    clipped; the per-conflict `detail` carries the resolved preferred/competing
    values (what a grade actually turns on) plus the structural fields, and the
    heavy prose (`_CONFLICT_HEAVY_FIELDS`) is what the caller's size budget trims.

    Not the verdict: the resolved values are handed over and the rubric decides,
    exactly as the sources block hands over ids without asserting groundedness.
    A rendered conflict makes an "encoded X, no conflict on file" claim checkable
    against what was actually contested (#1902 / #1956).
    """
    items = conflicts if isinstance(conflicts, list) else []
    assertion_list = assertions if isinstance(assertions, list) else []
    index = {
        a["id"]: a
        for a in assertion_list
        if isinstance(a, dict) and a.get("id")
    }
    ids = [c["id"] for c in items if isinstance(c, dict) and c.get("id")]

    detail: list[dict[str, Any]] = []
    for c in items:
        if not isinstance(c, dict):
            continue
        entry: dict[str, Any] = {
            "id": c.get("id"),
            "conflict_type": c.get("conflict_type"),
            "status": c.get("status"),
            "disputed_attribute": c.get("disputed_attribute"),
            "identity_question": c.get("identity_question"),
            "preferred": _resolve_assertion(c.get("preferred_assertion_id"), index)
            if c.get("preferred_assertion_id")
            else None,
            "competing": [
                _resolve_assertion(cid, index)
                for cid in (c.get("competing_assertion_ids") or [])
            ],
        }
        for k in _CONFLICT_HEAVY_FIELDS:
            if c.get(k):
                entry[k] = _summarize_response(
                    c[k], string_max=_BEFORE_STATE_STRING_MAX
                )
        detail.append(entry)

    return {"count": len(items), "all_ids": ids, "detail": detail}


def _detail_ids(summary: dict[str, Any]) -> list[str]:
    """Ids positionally aligned with `summary["detail"]`, for naming drops.

    `all_ids` skips entries with no `id`, so it cannot be zipped against
    `detail` (which keeps every entry). Rebuild from the detail itself and
    label an id-less entry by position, so the omission note can still point at
    something a reader can find.
    """
    out: list[str] = []
    for i, entry in enumerate(summary.get("detail") or []):
        sid = entry.get("id") if isinstance(entry, dict) else None
        out.append(sid or f"<entry #{i + 1}, no id>")
    return out


def _summarize_before_state(before_snapshot: dict[str, Any] | None) -> str:
    """Render the source entries that existed BEFORE the skill ran, so the
    judge can mechanically check "not on file" / "fabricated" claims.

    The judge has produced fabrication-class citation failures — asserting
    that on-file source text was absent or invented — when it had no view of
    the pre-existing state. Surfacing the before-run `sources` (research.json,
    `src_` ids) and source descriptions (tree.gedcomx.json, `S` ids) makes
    such claims checkable against what was actually on file.

    The complete `count` + `all_ids` for every block is rendered first and is
    never truncated — that is the existence-check ground truth, and clipping it
    is exactly what revived the fabrication misgrade (ut_validate_schema_007/008).
    The `_BEFORE_STATE_MAX_CHARS` prompt-size cap is spent only on the expendable
    heavy `detail` sample, which is dropped (never the ids) when the budget runs
    out. Returns "(none)" when there was no prior state (e.g. an empty-project
    scenario) — itself the correct signal: nothing was on file, so any
    "altered/removed an existing source" claim is unfounded.
    """
    if not before_snapshot:
        return "(none)"
    research = before_snapshot.get("research_json")
    tree = before_snapshot.get("tree_gedcomx_json")
    research_sources = research.get("sources") if isinstance(research, dict) else None
    tree_sources = tree.get("sources") if isinstance(tree, dict) else None
    conflicts = research.get("conflicts") if isinstance(research, dict) else None
    assertions = research.get("assertions") if isinstance(research, dict) else None

    labelled: list[tuple[str, dict[str, Any]]] = []
    if research_sources:
        labelled.append(
            (
                "research.json sources on file before this run (src_ ids)",
                _summarize_before_state_sources(research_sources),
            )
        )
    if tree_sources:
        labelled.append(
            (
                "tree.gedcomx.json source descriptions on file before this run "
                "(S ids)",
                _summarize_before_state_sources(tree_sources),
            )
        )
    if conflicts:
        # Same shape ({count, all_ids, detail}) as a sources block, so it flows
        # through the id-section and the shared-budget detail loop below
        # unchanged — the conflicts detail is trimmed by the same
        # _BEFORE_STATE_MAX_CHARS accounting, never before the sources.
        labelled.append(
            (
                "research.json conflicts on file before this run (c_ ids; "
                "preferred/competing assertions resolved to their values)",
                _summarize_before_state_conflicts(conflicts, assertions),
            )
        )
    if not labelled:
        return "(none)"

    # ids first — complete and never clipped (see docstring).
    id_blocks = [
        f"{label}:\n"
        + json.dumps(
            {"count": summary["count"], "all_ids": summary["all_ids"]},
            ensure_ascii=False,
            indent=2,
        )
        for label, summary in labelled
    ]
    id_section = "\n\n".join(id_blocks)

    # heavy per-source detail after — this is what the prompt-size cap trims.
    #
    # Drop whole sources rather than slicing the rendered string. A raw
    # `[:budget]` cut lands mid-object, so the last source renders half-written
    # and the ones after it vanish with no trace — while their ids are still
    # listed above, complete. That is exactly the state that makes the judge
    # call a correctly-cited source fabricated (the bug this block exists to
    # prevent, relocated to large projects). Naming the dropped ids turns a
    # silent gap into a stated one the judge can reason about.
    #
    # Sources are skipped individually, not truncated at the first overflow, so
    # a small late source can survive while a larger earlier one is dropped.
    # That packs more citations into the budget; the omission note names
    # whatever was left out, so which ones went is never a guess.
    #
    # The note itself is appended after the budget is spent, so the block can
    # exceed `_BEFORE_STATE_MAX_CHARS` by roughly the length of the dropped-id
    # list. Deliberate: the note is what stops the judge reading an omission as
    # a fabrication, and dropping it to stay under a soft prompt-size cap would
    # reintroduce the bug the cap is not there to cause.
    budget = _BEFORE_STATE_MAX_CHARS - len(id_section)
    detail_blocks: list[str] = []
    dropped: list[str] = []
    remaining = budget
    for label, summary in labelled:
        header = f"{label} — per-source detail (heavy fields truncated):\n"
        kept: list[Any] = []
        for entry, sid in zip(summary["detail"], _detail_ids(summary)):
            candidate = json.dumps(kept + [entry], ensure_ascii=False, indent=2)
            if len(header) + len(candidate) > remaining:
                dropped.append(sid)
                continue
            kept.append(entry)
        block = header + json.dumps(kept, ensure_ascii=False, indent=2)
        detail_blocks.append(block)
        remaining -= len(block) + 2  # the "\n\n" join

    detail_section = "\n\n".join(detail_blocks)
    if dropped:
        detail_section += (
            f"\n\n[per-source detail omitted for prompt size: "
            f"{', '.join(dropped)}. Their ids ARE listed above and they WERE on "
            f"file — the absence of their detail here is a harness size limit, "
            f"not evidence that they are missing or fabricated.]"
        )
    return id_section + "\n\n" + detail_section


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
    # The aborted path carries the two grading fields too. `spec` is in hand, and
    # by this PR's own semantics an ABSENT `grading_mode` means "this run log
    # predates the field" — so omitting it here would make a fresh run log
    # misrepresent its aborted tests as old ones. 11 aborted entries across 6
    # committed logs, so the path is live, not theoretical.
    mode, gates = grading_mode_for(spec)
    return assemble_test_entry(
        test_id=spec.id,
        test_type=spec.type,
        expected_outcome=spec.expected_outcome,
        scenario=spec.scenario,
        mcp_fixtures=spec.mcp_fixtures,
        runs=[single_run],
        timestamp_for_run_id=timestamp,
        grading_mode=mode,
        dimensions_gate_outcome=gates,
    )
