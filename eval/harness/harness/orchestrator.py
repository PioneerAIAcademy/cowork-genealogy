"""Per-test orchestrator — runs the runnability gate, executes the skill,
runs validators and the judge, and assembles the run log.

v1: N=1, no parallel execution, no suite-budget guard, no sidecar text files.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from harness.allowed_tools import compute_allowed_tools, load_skill_frontmatter
from harness.leakage import flag_verdict_shaped_criteria
from harness.auth import AuthConfig
from harness.diff import diff_research_json, diff_tree_gedcomx
from harness.judge import (
    DEFAULT_JUDGE_MODEL,
    JudgeError,
    JudgeOutput,
    grade,
    judge_prompt_hash,
)
from harness.loader import TestSpec
from harness.rubric import Rubric, parse_rubric
from harness.runlog import (
    JudgeResult,
    SingleRun,
    ValidatorResult,
    assemble_run_log,
    derive_activated,
)
from harness.runnability import RunnabilityResult, check_runnable
from harness.skill_runner import DEFAULT_MODEL, run_skill
from harness.validator_runner import as_dicts, run_validators
from harness.workspace import build_workspace, cleanup_session_store, snapshot_files


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SCENARIOS = REPO_ROOT / "eval/fixtures/scenarios"
DEFAULT_FIXTURES = REPO_ROOT / "eval/fixtures/mcp"
DEFAULT_SKILLS = REPO_ROOT / "plugin/skills"
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
        return _md_version("genefun-eval-harness")
    except PackageNotFoundError:
        pass

    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    if pyproject.exists():
        try:
            import tomllib  # Python 3.11+
        except ImportError:  # pragma: no cover — Python < 3.11
            return "unknown"
        try:
            data = tomllib.loads(pyproject.read_text())
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


def run_one_test(
    spec: TestSpec,
    *,
    auth: AuthConfig,
    paths: OrchestratorPaths | None = None,
    model: str = DEFAULT_MODEL,
    judge_model: str = DEFAULT_JUDGE_MODEL,
) -> dict[str, Any]:
    """Run a single test through the v1 pipeline; return the run log dict.

    This is a thin sync wrapper that drives the async skill runner via
    asyncio.run. The CLI uses this directly.
    """
    paths = paths or OrchestratorPaths()
    return asyncio.run(
        _run_one_test_async(
            spec=spec, auth=auth, paths=paths, model=model, judge_model=judge_model
        )
    )


async def _run_one_test_async(
    *,
    spec: TestSpec,
    auth: AuthConfig,
    paths: OrchestratorPaths,
    model: str,
    judge_model: str,
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
        return _aborted_log(
            spec=spec,
            reason="not_runnable",
            detail=gate.reason or "runnability gate blocked the test",
            model=model,
            judge_model=judge_model,
            rubric_hash=_safe_rubric_hash(spec, paths),
        )

    rubric = parse_rubric(
        (paths.tests_dir / spec.skill / "rubric.md").read_text()
    )
    skill_frontmatter = load_skill_frontmatter(
        paths.skills_dir / spec.skill / "SKILL.md"
    )
    scenario_readme = _load_scenario_readme(paths.scenarios_dir, spec.scenario)
    skill_baseline = compute_allowed_tools(spec.skill, paths.skills_dir)

    runs: list[SingleRun] = []
    for run_index in range(spec.runs_per_test):
        runs.append(
            await _execute_single_run(
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
        )

    return assemble_run_log(
        test_id=spec.id,
        skill=spec.skill,
        test_type=spec.type,
        expected_outcome=spec.expected_outcome,
        scenario=spec.scenario,
        mcp_fixtures=spec.mcp_fixtures,
        harness_version=HARNESS_VERSION,
        model=model,
        judge_model=judge_model,
        rubric_hash=rubric.content_hash,
        judge_prompt_hash=judge_prompt_hash(),
        runs=runs,
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
    multi-run aggregation in assemble_run_log."""

    # --- Workspace + skill execution ------------------------------------
    with tempfile.TemporaryDirectory(prefix=f"eval-{spec.id}-{run_index}-") as tmp:
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
                allowed_tools_override=skill_baseline,
            )

            after_snapshot = snapshot_files(workspace)
        finally:
            # Always clean up the SDK's session-store entry so long runs
            # don't accumulate orphans under ~/.claude/projects/.
            cleanup_session_store(workspace)

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

    # Set of every *other* skill name in the plugin/skills/ directory —
    # used by rule 4 to detect "routing to another skill" patterns in
    # short responses without false-flagging legitimate concise outputs.
    other_skill_names = {
        d.name for d in paths.skills_dir.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name != spec.skill
    }

    activated = derive_activated(
        skill=spec.skill,
        skills_invoked=result.skills_invoked,
        tool_calls=result.tool_calls,
        file_changes=file_changes,
        files_created=files_created,
        text_response=result.text_response,
        skill_frontmatter=skill_frontmatter,
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
    )
    validators_passed = all(r.passed for r in validator_results)

    # --- Judge ----------------------------------------------------------
    if validators_passed and result.aborted_reason is None:
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

    return SingleRun(
        outcome=outcome,
        aborted_reason=result.aborted_reason,
        duration_ms=result.duration_ms,
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
                    "matched": c["matched"],
                    "response_fixture": c.get("response_fixture"),
                }
                for c in result.tool_calls
            ],
            "files_created": files_created,
            **({"file_changes": file_changes} if file_changes else {}),
            **(
                {"criteria_leakage_flags": leakage_flags}
                if (leakage_flags := flag_verdict_shaped_criteria(
                    spec.additional_criteria
                ))
                else {}
            ),
            **(
                {"warnings": warnings}
                if (warnings := _build_warnings(
                    result.tool_calls,
                    rubric=rubric,
                    skill_frontmatter=skill_frontmatter,
                ))
                else {}
            ),
        },
        validators=ValidatorResult(
            passed=validators_passed, results=as_dicts(validator_results)
        ),
        judge=judge_result,
    )


def _build_warnings(
    tool_calls: list[dict[str, Any]],
    rubric=None,
    skill_frontmatter: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Surface run-time advisories the judge / reviewer should see.

    Flags:
    - queue_reused tool calls (fixture queue exhausted; reuse signals
      a fixture-coverage gap)
    - missing tool-usage rubric dimension when the skill actually called
      MCP tools but its rubric has no dimension covering tool quality
      (v1.8: demoted from runnability gate to per-run warning so a
      rubric author's naming choice doesn't block the test outright)
    """
    warnings: list[dict[str, Any]] = []
    for call in tool_calls:
        if call.get("matched", {}).get("kind") == "queue_reused":
            warnings.append({
                "kind": "queue_reused",
                "tool": call.get("tool", ""),
                "advisory": (
                    "Fixture queue was exhausted; the last response was "
                    "reused for this call. Likely a fixture-coverage gap "
                    "— add another fixture for this tool if the skill is "
                    "expected to receive different responses across calls."
                ),
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
    failed OR judge raised an error). When validators passed but the
    judge was still skipped, that's a judge-crash path — the run can't
    be scored as pass because spec §7 says pass requires "every judge
    dimension scored pass" and zero dimensions can't satisfy that.
    """
    if aborted_reason:
        return "aborted"
    if not validators_passed:
        return "fail"

    # Judge-crash path: validators passed but judge raised (missing API
    # key, transient API error, parse failure, etc.). Empty dimensions
    # would otherwise fall through to "pass" by default — a silent green
    # on a real failure. Spec §7: pass requires every dimension to score
    # pass; zero dimensions doesn't satisfy that. Fail explicitly.
    if judge_skipped:
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
            # Spec §6 step 2 literal: "pass requires skills_invoked is
            # also []." For out-of-scope user messages, NO skill should
            # be invoked at all — not even one that declines. The §6
            # rule-4 "routing-without-effect is allowed" carveout
            # applies to the skill UNDER TEST having `activated=False`;
            # it doesn't extend to other skills being tried unsuccessfully.
            if skills_invoked:
                return "fail"
        else:
            if not any(s in skills_invoked for s in correct):
                # Skill didn't fire, but didn't suggest a correct alternative.
                # Spec §6 step 3 — additional_criteria + judge dimensions can
                # still grade the decline quality. We mark this as a fail
                # because the correct_skill array was not satisfied.
                return "fail"

    scores = [d["score"] for d in judge_dimensions]
    if "fail" in scores:
        return "fail"
    if "partial" in scores:
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
    return grade(
        rubric=rubric,
        additional_criteria=spec.additional_criteria,
        scenario_readme=scenario_readme,
        user_message=spec.user_message,
        skills_invoked=result.skills_invoked,
        text_response=result.text_response,
        file_changes_summary=_summarize_changes(file_changes, result.tool_calls),
        tool_calls=result.tool_calls,
        auth=auth,
        model=judge_model,
    )


def _summarize_changes(file_changes, tool_calls) -> str:
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
    return "\n".join(lines)


def _load_scenario_readme(scenarios_dir: Path, scenario: str | None) -> str:
    if not scenario:
        return ""
    readme = scenarios_dir / scenario / "README.md"
    if not readme.exists():
        return ""
    return readme.read_text()


def _safe_rubric_hash(spec: TestSpec, paths: OrchestratorPaths) -> str:
    """Best-effort rubric hash for aborted-run logs (rubric may be missing).

    Returns the SHA-256 of "<rubric missing>" sentinel when the rubric is
    absent or malformed — distinct from a real rubric and collision-free
    across runs (the previous all-zeros placeholder collided across every
    aborted run of any skill).
    """
    rubric_path = paths.tests_dir / spec.skill / "rubric.md"
    if not rubric_path.exists():
        return _MISSING_RUBRIC_HASH
    try:
        return parse_rubric(rubric_path.read_text()).content_hash
    except Exception:
        return _MALFORMED_RUBRIC_HASH


import hashlib as _hashlib  # local alias; orchestrator otherwise doesn't need it

_MISSING_RUBRIC_HASH = _hashlib.sha256(b"<rubric missing>").hexdigest()
_MALFORMED_RUBRIC_HASH = _hashlib.sha256(b"<rubric malformed>").hexdigest()


def _aborted_log(
    *,
    spec: TestSpec,
    reason: str,
    detail: str,
    model: str,
    judge_model: str,
    rubric_hash: str,
) -> dict[str, Any]:
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
        # Validators did not run (the runnability gate caught the test
        # before workspace setup). v1.6: passed=None — neither True
        # (vacuous) nor False (misleading) is honest; schema accepts null.
        validators=ValidatorResult(passed=None, results=[]),
        judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0),
    )
    return assemble_run_log(
        test_id=spec.id,
        skill=spec.skill,
        test_type=spec.type,
        expected_outcome=spec.expected_outcome,
        scenario=spec.scenario,
        mcp_fixtures=spec.mcp_fixtures,
        harness_version=HARNESS_VERSION,
        model=model,
        judge_model=judge_model,
        rubric_hash=rubric_hash,
        judge_prompt_hash=judge_prompt_hash(),
        runs=[single_run],
    )
