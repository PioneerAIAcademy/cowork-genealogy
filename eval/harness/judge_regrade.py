"""Regrade committed unit run logs against the current judge prompt + model.

A judge-prompt edit (`eval/harness/judge/prompt.md`) does not change what the
skill under test produced — only how that output is graded. Re-running every
touched skill would cost roughly $95 of skill spend to answer a question that
needs no skill run: did the current prompt change the scores? This target
answers it for roughly $5 of judge-only spend, which is why rule 2b now blocks
on a judge-prompt mismatch — the gate has a cheap satisfaction path.

Hard requirement: **the judge prompt is re-rendered from disk on every call.**
Nothing stores or replays a rendered prompt. A regrade target that reads a
cached prompt body would certify a prose-only judge edit as a no-op without
noticing. `render_judge_prompt_for_test` reads `JUDGE_PROMPT_PATH` directly
rather than going through `judge.judge_prompt_template()`'s `@lru_cache`.

The regrade refuses on a run log that is **skill-side stale** (snapshot
disagrees with disk). Those logs are governed by rule 2 — they owe a paid
`make eval-skill` run, not a regrade — and quietly rewriting their scores
against a prompt the skill never saw would produce an incoherent artifact.

Scratch mode (`--runlogs-root <dir>`) is the exception, and it never writes a
committed log: it regrades copies under `<dir>/<skill>/` with both refusals
waived, so a judge-input change that stales the snapshot without moving the
prompt hash (a scenario judge-brief.md, issue #2478) can be A/B'd.
`--scenario` narrows the copies to tests on those scenarios and `--slot readme`
forces each scenario's README into the judge slot. One fresh dir per pass.

CLI (from eval/harness/):
  uv run python -m judge_regrade                      # live regrade every eligible
  uv run python -m judge_regrade --skill citation     # one skill only
  uv run python -m judge_regrade --dry-run            # render+hash, no model call
  uv run python -m judge_regrade --runlogs-root <dir> --scenario <name> [--slot readme]
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import inspect
import json
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from harness import judge, loader, rubric, snapshot, validator_runner
from harness.auth import resolve_auth
from harness.judge import (
    DEFAULT_JUDGE_MODEL,
    JUDGE_PROMPT_PATH,
    JudgeError,
    render_prompt_parts,
)
from harness.loader import InvalidTestError
from harness.orchestrator import (
    DEFAULT_SKILLS,
    _compute_outcome,
    _run_judge,
    build_judge_grade_kwargs,
    flag_routing_negative_judge_fail,
)
from harness.scenario_brief import (
    ScenarioBrief,
    load_scenario_brief,
    readme_fallback_warning,
)
from harness.warning_kinds import validate_warning_kinds
from harness.workspace import build_workspace, snapshot_files
from harness.outcomes import aggregate_per_run_outcome
from harness.runlog import _replace_with_retry, validate_run_log
from harness.versioning import latest_full_skill_runlog

REPO_ROOT = Path(__file__).resolve().parents[2]
UNIT_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "unit"
TESTS_UNIT = REPO_ROOT / "eval" / "tests" / "unit"
SCENARIOS = REPO_ROOT / "eval" / "fixtures" / "scenarios"
MCP_FIXTURES = REPO_ROOT / "eval" / "fixtures" / "mcp"

#: Skills with no unit test corpus; their run-log dirs exist but no gate applies.
#: Mirrors `check_runlogs.RUNLOG_GATE_EXEMPT_SKILLS`.
RUNLOG_GATE_EXEMPT_SKILLS = frozenset({"forget-and-rederive"})


# ---- Collection -----------------------------------------------------------


@dataclass
class RegradeTarget:
    skill: str
    path: Path
    log: dict[str, Any]
    reason_refused: str | None = None  # if non-None, skip at regrade time


@dataclass
class RegradeResult:
    skill: str
    path: Path
    runs_regraded: int = 0
    tests_scored_moved: list[str] = field(default_factory=list)
    tests_outcome_moved: list[tuple[str, str, str]] = field(default_factory=list)  # (test_id, old, new)
    fallback_scenarios: set[str] = field(default_factory=set)
    error: str | None = None


def _latest_full_skill_runlog(skill_dir: Path) -> tuple[str, dict[str, Any]] | None:
    """The log rule 2b grades (`versioning.latest_full_skill_runlog`), or None
    when the directory is absent or the log is unreadable. Ordered by landing on
    `origin/main`, which stands in for the BASE_SHA CI orders by."""
    if not skill_dir.is_dir():
        return None
    try:
        return latest_full_skill_runlog(skill_dir, "origin/main")
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def _skill_side_stale(log: dict[str, Any]) -> bool:
    """True iff the log's snapshot disagrees with the working tree."""
    snap = log.get("snapshot") or {}
    diffs = snapshot.diff_snapshot_vs_disk(snap, REPO_ROOT)
    return len(diffs) > 0


def collect_regradeable_logs(
    root: Path = UNIT_RUNLOGS,
    *,
    only_skill: str | None = None,
    scratch: bool = False,
) -> list[RegradeTarget]:
    """Enumerate every skill's latest full run log; classify each.

    With `scratch=True` both filters are waived and every latest log is
    returned unrefused. A scratch regrade writes copies outside the committed
    tree, so it may measure a judge-input change (a scenario brief) that stales
    the snapshot without moving the prompt hash; it never certifies anything.

    A log is **regradeable** iff:
      1. its `judge_prompt_hash` != the current judge prompt's hash, AND
      2. its snapshot is active against the working tree (no skill-side drift).

    A log that fails (1) is skipped (prompt is already current).
    A log that fails (2) is RETURNED with `reason_refused` set — the caller
    reports it rather than silently regrading against stale inputs.
    """
    current_hash = judge.judge_prompt_hash()
    out: list[RegradeTarget] = []
    for skill_dir in sorted(root.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill = skill_dir.name
        if only_skill is not None and skill != only_skill:
            continue
        if skill in RUNLOG_GATE_EXEMPT_SKILLS:
            continue
        latest = _latest_full_skill_runlog(skill_dir)
        if latest is None:
            continue
        filename, log = latest
        path = skill_dir / filename
        if scratch:
            out.append(RegradeTarget(skill=skill, path=path, log=log))
            continue
        stored_hash = log.get("judge_prompt_hash") or ""
        if stored_hash == current_hash:
            # Not stale on prompt — nothing to regrade.
            continue
        if _skill_side_stale(log):
            out.append(
                RegradeTarget(
                    skill=skill,
                    path=path,
                    log=log,
                    reason_refused=(
                        "skill-side snapshot stale — owes `make eval-skill` "
                        "(rule 2), cannot be regraded"
                    ),
                )
            )
            continue
        out.append(RegradeTarget(skill=skill, path=path, log=log))
    return out


# ---- Per-test prompt reconstruction (B6) ----------------------------------
#
# Reconstruct the exact kwargs a live run would pass to `grade()` by funnelling
# every call through the same `orchestrator.build_judge_grade_kwargs` the live
# path uses. Hand-rebuilding `grade()`'s inputs in a second place is what
# produces the drift this PR exists to prevent: a full rubric on a negative
# test, empty `skills_invoked` on a direct test, "name: error" validator
# strings where production sends bare names. Disk reads here are limited to
# the three slots the run log does not carry (rubric, scenario brief or its
# README fallback, before-state) and the predicate-matched tool-response splice.


def _load_test_spec(skill: str, test_id: str) -> loader.TestSpec:
    """Load the TestSpec whose `id` matches `test_id` under the skill dir.

    Raises FileNotFoundError if no match. A corrupt test JSON raises
    InvalidTestError (not swallowed — a bug in the test corpus should surface,
    not silently skip the test).
    """
    skill_tests_dir = TESTS_UNIT / skill
    for p in skill_tests_dir.glob("*.json"):
        try:
            spec = loader.load_test(p)
        except InvalidTestError:
            # One corrupt file in the skill dir shouldn't block regrading
            # the other tests — but let any other exception propagate.
            continue
        if spec.id == test_id:
            return spec
    raise FileNotFoundError(
        f"No test spec with id={test_id!r} found under {skill_tests_dir}"
    )


def _load_rubric(skill: str) -> rubric.Rubric:
    rubric_path = TESTS_UNIT / skill / "rubric.md"
    text = rubric_path.read_text(encoding="utf-8") if rubric_path.exists() else None
    return rubric.parse_rubric_or_empty(skill, text)


def _load_scenario_brief(
    scenario: str | None, *, force_readme: bool = False
) -> ScenarioBrief:
    """The judge's scenario text, through the loader the live path uses."""
    return load_scenario_brief(SCENARIOS, scenario, force_readme=force_readme)


def _load_before_snapshot(scenario: str | None) -> dict[str, Any]:
    """Rebuild the before-snapshot exactly as a live run takes it.

    Stages the scenario with `workspace.build_workspace` and reads it back with
    `workspace.snapshot_files`, the two calls the orchestrator makes before the
    skill runs. A hand-built copy of that snapshot once used the file names as
    keys (`"research.json"`) where `_summarize_before_state` reads
    `"research_json"`, so every regraded prompt carried a `(none)` before-state
    the live run never sent (issue #2478). Returns an empty dict for a
    scenario-less test (empty before-state renders as "(none)").
    """
    if not scenario:
        return {}
    sdir = SCENARIOS / scenario
    stamp = tuple(
        (f.as_posix(), f.stat().st_mtime_ns, f.stat().st_size)
        for f in sorted(sdir.rglob("*")) if f.is_file()
    ) if sdir.is_dir() else ()
    key = (str(SCENARIOS), scenario, stamp)
    if key not in _BEFORE_SNAPSHOT_CACHE:
        _BEFORE_SNAPSHOT_CACHE[key] = _stage_before_snapshot(scenario)
    return _BEFORE_SNAPSHOT_CACHE[key]


#: One staging per scenario per process. Keyed on every file's mtime, so a
#: fixture edited mid-process is staged again.
_BEFORE_SNAPSHOT_CACHE: dict[tuple, dict[str, Any]] = {}


def _stage_before_snapshot(scenario: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="regrade-before-") as tmp:
        build_workspace(
            scenario_name=scenario,
            scenarios_dir=SCENARIOS,
            skills_dir=DEFAULT_SKILLS,
            target_dir=Path(tmp),
            stage_skills=False,
        )
        return snapshot_files(Path(tmp))


def _splice_tool_responses(tool_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rebuild `response` on predicate-matched calls whose log entry omits it.

    The run-log schema allows `response` to be absent on `matched.kind=="predicate"`
    calls because the engine can recover it from `response_fixture + matched.index`
    at that commit. The regrader does that recovery here so the judge prompt
    sees the same tool-call bodies the original run showed it.

    Real `matched.kind` values (`mock_mcp.py`): `"predicate"`, `"live"`, `"none"`.
    `response_fixture` is at the tool_call top level (not under `matched`).
    """
    out: list[dict[str, Any]] = []
    for call in tool_calls:
        c = copy.deepcopy(call)
        matched = c.get("matched") or {}
        fixture_name = c.get("response_fixture")
        if (
            matched.get("kind") == "predicate"
            and "response" not in c
            and fixture_name
            and "index" in matched
        ):
            fx_path = MCP_FIXTURES / f"{fixture_name}.json"
            if fx_path.exists():
                try:
                    fx = json.loads(fx_path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    fx = None
                if isinstance(fx, dict):
                    resp = fx.get("response")
                    if isinstance(resp, list):
                        idx = matched.get("index")
                        if isinstance(idx, int) and 0 <= idx < len(resp):
                            c["response"] = resp[idx]
                    elif resp is not None:
                        c["response"] = resp
        out.append(c)
    return out


def _split_observations_from_warnings(
    warnings: list[dict[str, Any]], skill: str
) -> tuple[list[str], list[str]]:
    """Partition `prose_observation` entries into (response, state) by signature.

    A live run splits tier-2 observations using `_run_module`'s state-derived
    rule in `validator_runner.py`: a `report_*` whose parameters draw only
    from `_STATE_ARGS` AND include at least one of before_state/after_state
    is state-derived. The regrade recovers the SAME partition by re-importing
    the validator modules (`validators/test_universal.py` and
    `validators/test_<skill>.py`) and inspecting each named function's
    signature. A warning that names a function the modules do not expose
    (deleted since the log was written, or a skill with no own-module file)
    falls back to the response slot — the orchestrator's conservative default.

    Returns (response_observations, state_observations) with the same semantics
    as `validator_runner.split_observations`.
    """
    vdir = REPO_ROOT / "eval/harness/validators"
    mods = []
    try:
        mods.append(
            validator_runner._import_validator_module(
                vdir / "test_universal.py", "regrade_universal"
            )
        )
    except (OSError, ImportError, RuntimeError):
        pass
    own = vdir / f"test_{skill.replace('-', '_')}.py"
    if own.exists():
        try:
            mods.append(
                validator_runner._import_validator_module(
                    own, f"regrade_{skill.replace('-', '_')}"
                )
            )
        except (OSError, ImportError, RuntimeError):
            pass
    response_obs: list[str] = []
    state_obs: list[str] = []
    for w in warnings or []:
        if (w or {}).get("kind") != "prose_observation":
            continue
        obs = w.get("observation") or w.get("message") or ""
        if not obs:
            continue
        fname = w.get("check") or w.get("name") or ""
        fn = next(
            (getattr(m, fname, None) for m in mods if hasattr(m, fname)),
            None,
        )
        if fn is None:
            # Validator function not found in any imported module — fall back
            # to the response slot (orchestrator's `_run_module` would have
            # recorded no `state_derived` flag either).
            response_obs.append(obs)
            continue
        params = set(inspect.signature(fn).parameters)
        is_state = (
            bool(params)
            and params <= validator_runner._STATE_ARGS
            and bool(params & validator_runner._READS_STATE)
        )
        (state_obs if is_state else response_obs).append(obs)
    return response_obs, state_obs


def _gating_validator_failure_names(validators_block: dict[str, Any]) -> list[str]:
    """Bare names of gating (non-reporting) validator failures, in order.

    Mirrors the live path in `orchestrator._execute_test`:
      `[r.name for r in validator_results if not r.passed and not r.reporting_only]`.
    The judge prompt renders this list as `- {name}` bullets (see
    `judge.render_prompt_parts::failures_text`) — a "name: error" string here
    is drift from the live render, which is exactly what this PR fixes.
    """
    results = (validators_block or {}).get("results") or []
    return [
        r.get("name") or "unknown"
        for r in results
        if r.get("passed") is False and not r.get("reporting_only", False)
    ]


def _failed_validator_names(validators_block: dict[str, Any]) -> frozenset[str]:
    """Validator names (bare) for `_compute_outcome`'s `failed_validators` arg.

    Includes reporting-only failures too (they can still signal outcome shape
    for callers that use the frozenset for `_COMMISSION_VALIDATORS` membership
    tests), where the judge-prompt slot filters them out.
    """
    results = (validators_block or {}).get("results") or []
    return frozenset(
        r.get("name") or "unknown"
        for r in results
        if r.get("passed") is False
    )


def _build_result_namespace(
    run_entry: dict[str, Any],
    tool_calls: list[dict[str, Any]],
) -> SimpleNamespace:
    """Shape run-log fields as the `result` protocol `_run_judge` reads.

    `tool_calls` is already spliced by the caller (`_splice_tool_responses`)
    so predicate-matched calls carry the response the judge saw at the time.
    `slash_entry_skill` is not persisted on the run log — None is the
    right value for a regrade; a slash-command test gets its initial entry
    marked only when the live runner captures it.
    """
    output = run_entry.get("output") or {}
    return SimpleNamespace(
        text_response=output.get("text_response") or "",
        tool_calls=tool_calls,
        skills_invoked=output.get("skills_invoked") or [],
        builtin_tool_calls=output.get("builtin_tool_calls") or [],
        agent_returns=output.get("agent_returns") or [],
        slash_entry_skill=None,
    )


def _build_grade_kwargs_for_run_entry(
    log: dict[str, Any],
    test_entry: dict[str, Any],
    run_entry: dict[str, Any],
    *,
    force_readme: bool = False,
) -> dict[str, Any]:
    """Return the kwargs a live `grade()` call would receive for this test run."""
    skill = log["skill"]
    test_id = test_entry["test_id"]
    spec = _load_test_spec(skill, test_id)
    rub = _load_rubric(skill)
    scenario = spec.scenario if hasattr(spec, "scenario") else None
    scenario_readme = _load_scenario_brief(scenario, force_readme=force_readme).text
    before_snapshot = _load_before_snapshot(scenario)

    output = run_entry.get("output") or {}
    tool_calls = _splice_tool_responses(output.get("tool_calls") or [])
    file_changes = output.get("file_changes") or []
    warnings = output.get("warnings") or []
    harness_observations, state_observations = _split_observations_from_warnings(
        warnings, skill
    )
    validator_failures = _gating_validator_failure_names(
        run_entry.get("validators") or {}
    )

    result = _build_result_namespace(run_entry, tool_calls)
    return build_judge_grade_kwargs(
        spec=spec,
        rubric=rub,
        scenario_readme=scenario_readme,
        result=result,
        file_changes=file_changes,
        before_snapshot=before_snapshot,
        validator_failures=validator_failures,
        harness_observations=harness_observations,
        state_observations=state_observations,
    )


def render_judge_prompt_for_test(
    log: dict[str, Any],
    test_entry: dict[str, Any],
    run_entry: dict[str, Any],
    *,
    repo_root: Path = REPO_ROOT,
    force_readme: bool = False,
) -> str:
    """Reconstruct the judge prompt for one test run — reads disk, bypasses cache.

    Shapes grade()'s kwargs through `orchestrator.build_judge_grade_kwargs` —
    the same helper the live path calls — so the prompt a DRY render hashes is
    byte-identical to the one a live run would send. Rebuilding the kwargs here
    is the drift PR #3290's first review found; funnelling both paths through
    one builder is how it is prevented.

    Returns `prefix + suffix` concatenated. Clears `judge.judge_prompt_template`'s
    @lru_cache before every call so the body is re-read from disk — nothing
    gets to serve a stored prompt.
    """
    # Enforce the "re-render from disk, never store/replay" invariant:
    # judge.judge_prompt_template is @lru_cache(maxsize=1), and render_prompt_parts
    # pulls the template through it. A regrade that reads a cached body would
    # certify a prose-only judge edit as a no-op without noticing. Clearing the
    # cache before every call forces a fresh disk read inside render_prompt_parts.
    # The hot judge path is unaffected — it re-caches on the next call and
    # amortizes across tests within one grade() invocation.
    judge.judge_prompt_template.cache_clear()

    kwargs = _build_grade_kwargs_for_run_entry(
        log, test_entry, run_entry, force_readme=force_readme
    )
    prefix, suffix = render_prompt_parts(**kwargs)
    return prefix + suffix


def hash_rendered_prompt(prompt_text: str) -> str:
    return hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()


# ---- Live regrade ---------------------------------------------------------


def _strip_prior_coerced_warnings(warnings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove `coerced_routing_negative_to_na` entries before re-flagging.

    `flag_routing_negative_judge_fail` appends unconditionally; without this
    strip a regrade would double-append on every pass. The function is
    idempotent given a cleaned input.
    """
    return [w for w in (warnings or []) if (w or {}).get("kind") != "coerced_routing_negative_to_na"]


_NO_BRIEF_KINDS = frozenset({"scenario_readme_fallback", "scenario_brief_missing"})


def _rederive_fallback_warning(
    warnings: list[dict[str, Any]], brief: ScenarioBrief
) -> list[dict[str, Any]]:
    """Replace any no-brief entry with one from the current loader.

    A regrade keeps each run's original warnings, so a log regraded after its
    scenario gained a judge brief would otherwise still say the judge read the
    README. The regraded prompt is what the entry describes, so it is derived
    from the brief the regrade actually rendered.
    """
    out = [w for w in (warnings or []) if (w or {}).get("kind") not in _NO_BRIEF_KINDS]
    if (fallback := readme_fallback_warning(brief)) is not None:
        out.append(fallback)
    validate_warning_kinds(out)
    return out


def _judge_was_skipped(run_entry: dict[str, Any]) -> bool:
    """True iff the live run never produced judge dimensions.

    Field is `judge.skipped`, not `judge_skipped`. A hand-rolled top-level
    `judge_skipped` would silently never fire — one of the small fixes in this
    PR's second review round. `aborted_reason` is covered too, since the live
    orchestrator skips the judge whenever the run aborted.
    """
    if run_entry.get("aborted_reason"):
        return True
    return bool((run_entry.get("judge") or {}).get("skipped"))


def regrade_run_log(
    path: Path,
    *,
    force_readme: bool = False,
    scratch_root: Path | None = None,
) -> RegradeResult:
    """Live regrade one run log in place; return a summary of what moved.

    With `scratch_root`, `path` must be a scratch copy under it: the committed
    log is never the file a scratch regrade writes.
    """
    if scratch_root is not None and not _is_under(path, scratch_root):
        raise ValueError(
            f"scratch regrade refused to write {path}: not under {scratch_root}"
        )
    result = RegradeResult(skill="", path=path)
    try:
        log = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
        result.error = f"could not read: {e}"
        return result
    result.skill = log.get("skill", "")

    auth = resolve_auth()

    for test_entry in log.get("tests") or []:
        test_id = test_entry.get("test_id") or "?"
        try:
            spec = _load_test_spec(result.skill, test_id)
        except FileNotFoundError:
            # Test file deleted since the log was written; skip.
            continue
        rub = _load_rubric(result.skill)
        scenario = spec.scenario if hasattr(spec, "scenario") else None
        brief = _load_scenario_brief(scenario, force_readme=force_readme)
        scenario_readme = brief.text
        before_snapshot = _load_before_snapshot(scenario)
        if brief.lacks_brief:
            result.fallback_scenarios.add(brief.scenario or "")

        old_outcome = test_entry.get("outcome")
        new_outcomes: list[str] = []

        for run_entry in test_entry.get("runs") or []:
            if _judge_was_skipped(run_entry):
                # The original run skipped the judge (abort before judging,
                # or `judge.skipped` set); respect that — a regrade doesn't
                # resurrect it.
                continue
            # Several fields live under `output`, not at the run-entry top:
            # `activated`, `skills_invoked`, `text_response`, `tool_calls`,
            # `file_changes`, `builtin_tool_calls`, `warnings`, `agent_returns`.
            # Reading them off the top of `run_entry` returns None/[] and
            # silently flips every routed positive test to fail downstream.
            output = run_entry.get("output") or {}
            tool_calls = _splice_tool_responses(output.get("tool_calls") or [])
            skills_invoked = output.get("skills_invoked") or []
            file_changes = output.get("file_changes") or []
            activated = bool(output.get("activated"))
            builtin_tool_calls = output.get("builtin_tool_calls") or []
            warnings = _rederive_fallback_warning(
                _strip_prior_coerced_warnings(output.get("warnings") or []), brief
            )
            harness_observations, state_observations = (
                _split_observations_from_warnings(warnings, result.skill)
            )
            validators_block = run_entry.get("validators") or {}
            # Judge prompt gets bare gating-failure names; _compute_outcome
            # takes the frozenset including reporting-only failures.
            validator_failure_names = _gating_validator_failure_names(validators_block)
            failed_validator_names = _failed_validator_names(validators_block)

            try:
                judge_out = _run_judge(
                    spec=spec,
                    rubric=rub,
                    scenario_readme=scenario_readme,
                    result=_build_result_namespace(run_entry, tool_calls),
                    file_changes=file_changes,
                    before_snapshot=before_snapshot,
                    auth=auth,
                    judge_model=DEFAULT_JUDGE_MODEL,
                    validator_failures=validator_failure_names,
                    harness_observations=harness_observations,
                    state_observations=state_observations,
                )
            except JudgeError as e:
                result.error = f"test {test_id} run {run_entry.get('run_index')}: {e}"
                return result

            # Overwrite the judge block and refresh outcome.
            fresh_dimensions = judge_out.dimensions
            # Re-run post-judge pipeline.
            flag_routing_negative_judge_fail(
                fresh_dimensions,
                spec=spec,
                activated=activated,
                skills_invoked=skills_invoked,
                warnings=warnings,
            )
            run_entry.setdefault("output", {})["warnings"] = warnings

            validators_passed = bool(validators_block.get("passed", True))
            # `agents_spawned` is NOT persisted on the run log — it's an
            # orchestrator-local field whose `None` value is the "routed test"
            # discriminator (`is None` not falsy). A direct-arm test's spawn
            # names come from the orchestrator state the log doesn't carry, so
            # for a routed test we pass None; for a direct test we fall back to
            # [spec.skill], mirroring the direct arm's happy path. If reality
            # disagrees _compute_outcome returns "fail", which is correct for
            # a direct test that failed to spawn.
            if spec.is_direct:
                agents_spawned: list[str] | None = [spec.skill]
            else:
                agents_spawned = None
            new_outcome = _compute_outcome(
                spec=spec,
                validators_passed=validators_passed,
                failed_validators=failed_validator_names,
                judge_dimensions=fresh_dimensions,
                aborted_reason=run_entry.get("aborted_reason"),
                activated=activated,
                skills_invoked=skills_invoked,
                judge_skipped=False,
                agents_spawned=agents_spawned,
                builtin_tool_calls=builtin_tool_calls,
            )
            new_outcomes.append(new_outcome)

            judge_block = run_entry.setdefault("judge", {})
            judge_block["dimensions"] = fresh_dimensions
            judge_block["judge_cost_usd"] = judge_out.cost_usd
            judge_block["input_tokens"] = judge_out.input_tokens
            judge_block["cached_input_tokens"] = judge_out.cached_input_tokens
            judge_block["output_tokens"] = judge_out.output_tokens
            judge_block["skipped"] = False
            run_entry["outcome"] = new_outcome
            result.runs_regraded += 1

        # Reuse the project's canonical aggregator rather than inventing a
        # ranking; keeps the regrade's per-test outcome identical to a fresh
        # suite's (modal with tiebreak-down semantics).
        if new_outcomes:
            aggregated = aggregate_per_run_outcome(new_outcomes)
            if aggregated != old_outcome:
                result.tests_outcome_moved.append(
                    (test_id, old_outcome or "", aggregated)
                )
                test_entry["outcome"] = aggregated

    # Stamp envelope.
    log["judge_prompt_hash"] = judge.judge_prompt_hash()
    log["judge_model"] = DEFAULT_JUDGE_MODEL
    # Validate before writing — a schema violation introduced by the regrade
    # (e.g. a judge dimension shape the model emitted that the writer doesn't
    # strip) must surface here, not get persisted. The project convention is
    # tempfile + os.replace for every run-log write (`runlog._replace_with_retry`)
    # so a crash mid-write cannot corrupt the committed artifact.
    # Not on a scratch copy: it is never committed, and a stale log written
    # before a later schema field (which only scratch mode reaches) cannot
    # validate against today's schema for reasons unrelated to the regrade.
    if scratch_root is None:
        validate_run_log(log)
    tmp = path.parent / (path.name + ".tmp")
    tmp.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")
    _replace_with_retry(tmp, path)
    return result


# ---- Dry-run (no model call) ----------------------------------------------


def dry_run(
    target: RegradeTarget,
    *,
    force_readme: bool = False,
    fallbacks: set[str] | None = None,
    skipped: list[str] | None = None,
) -> dict[str, str]:
    """Render every test's judge prompt and return `{test_id: sha256}`.

    Pure disk reads, zero model calls, zero cost. Used by `make harness-test`
    to prove the renderer reads from disk (edit a rubric and every hash moves).
    Scenarios whose prompt had no judge brief are added to `fallbacks`.
    """
    out: dict[str, str] = {}
    scenarios = _scenario_index(target.skill) if fallbacks is not None else {}
    for test_entry in target.log.get("tests") or []:
        for run_entry in test_entry.get("runs") or []:
            try:
                text = render_judge_prompt_for_test(
                    target.log, test_entry, run_entry, force_readme=force_readme
                )
            except FileNotFoundError:
                # Test file deleted since the log was written: the live regrade
                # skips it too. Only a stale log, which scratch mode reaches,
                # can name one; outside scratch mode it still raises.
                if skipped is None:
                    raise
                skipped.append(test_entry.get("test_id") or "?")
                break
            key = f"{test_entry['test_id']}/{run_entry.get('run_index', 0)}"
            out[key] = hash_rendered_prompt(text)
            if fallbacks is not None:
                brief = _load_scenario_brief(
                    scenarios.get(test_entry["test_id"]), force_readme=force_readme
                )
                if brief.lacks_brief:
                    fallbacks.add(brief.scenario or "")
            # First run only: a test's runs render the same prompt by design.
            break
    return out


# ---- Scratch mode ---------------------------------------------------------
#
# An A/B on a judge input (issue #2478: README against judge brief) needs the
# same committed runs graded twice under different inputs, with neither pass
# touching the committed log and no pass regrading another's output.


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


class ScratchDirNotEmpty(Exception):
    pass


def _scenario_index(skill: str) -> dict[str, str | None]:
    """`{test_id: scenario}` for every test in the skill dir, each file loaded once.

    `_load_test_spec` schema-validates every file in the dir per lookup, so
    calling it per test is quadratic; the scratch filter and the fallback count
    need only the scenario, so they read it from one pass.
    """
    out: dict[str, str | None] = {}
    for p in (TESTS_UNIT / skill).glob("*.json"):
        try:
            spec = loader.load_test(p)
        except InvalidTestError:
            continue
        out[spec.id] = spec.scenario
    return out


def filter_to_scenarios(
    target: RegradeTarget, only_scenarios: set[str] | None
) -> RegradeTarget | None:
    """A deep copy of `target` keeping only tests on `only_scenarios` (all when
    None); None when no test survives. Never writes."""
    log = copy.deepcopy(target.log)
    if only_scenarios is not None:
        scenarios = _scenario_index(target.skill)
        log["tests"] = [
            t for t in log.get("tests") or []
            if scenarios.get(t.get("test_id") or "") in only_scenarios
        ]
    if not log.get("tests"):
        return None
    return RegradeTarget(skill=target.skill, path=target.path, log=log)


def copy_to_scratch(
    target: RegradeTarget,
    scratch_root: Path,
    *,
    only_scenarios: set[str] | None = None,
) -> RegradeTarget | None:
    """Copy one committed log under `scratch_root/<skill>/`, keeping only the
    tests on `only_scenarios` when given. Returns the scratch target, or None
    when no test survives the filter.

    Always copies fresh from the committed log, and refuses a `<skill>/` dir
    that already holds a log, so a pass can never regrade another pass's output.
    """
    dest_dir = scratch_root / target.skill
    if dest_dir.is_dir() and any(dest_dir.glob("*.json")):
        raise ScratchDirNotEmpty(
            f"{dest_dir} already holds a run log; use a fresh --runlogs-root per pass"
        )
    filtered = filter_to_scenarios(target, only_scenarios)
    if filtered is None:
        return None
    log = filtered.log
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / target.path.name
    dest.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")
    return RegradeTarget(skill=target.skill, path=dest, log=log)


def _print_fallback_summary(fallbacks: set[str]) -> None:
    if fallbacks:
        print(
            f"  {len(fallbacks)} scenario(s) graded without a judge brief "
            f"(README or nothing): {', '.join(sorted(fallbacks))}"
        )


# ---- CLI ------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    # Windows cp1252 can't encode the arrow characters this module prints; the
    # Windows-based genealogist team sees UnicodeEncodeError otherwise. Guarded
    # by tests/unit/test_encoding_lint.py (see check_runlogs.py for the pattern).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill", help="Only regrade this skill (default: every eligible)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Render + hash every judge prompt; no model call. Used by make harness-test.",
    )
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--runlogs-root",
        type=Path,
        help=(
            "Scratch mode: regrade COPIES of the latest committed logs under this "
            "dir, waiving the stale-snapshot refusal and the current-hash skip. "
            "Never writes a committed log. One fresh dir per pass."
        ),
    )
    parser.add_argument(
        "--scenario",
        action="append",
        help="Scratch mode only: keep only tests on this scenario (repeatable).",
    )
    parser.add_argument(
        "--slot",
        choices=("brief", "readme"),
        default="brief",
        help="Scratch mode only: 'readme' forces each scenario's README into the judge slot.",
    )
    args = parser.parse_args(argv)
    scratch_root: Path | None = args.runlogs_root
    if scratch_root is None and (args.scenario or args.slot != "brief"):
        parser.error("--scenario and --slot readme require --runlogs-root")
    force_readme = args.slot == "readme"
    only_scenarios = set(args.scenario) if args.scenario else None

    if scratch_root is not None:
        return _main_scratch(
            scratch_root,
            only_skill=args.skill,
            only_scenarios=only_scenarios,
            force_readme=force_readme,
            dry=args.dry_run,
            verbose=args.verbose,
        )

    targets = collect_regradeable_logs(only_skill=args.skill)
    if not targets:
        if args.skill:
            print(
                f"No regradeable run log for skill={args.skill!r} "
                "(already current OR no committed log OR skill-side stale).",
                file=sys.stderr,
            )
        else:
            print("All committed run logs are already on the current judge prompt.")
        return 0

    refused = [t for t in targets if t.reason_refused is not None]
    eligible = [t for t in targets if t.reason_refused is None]

    for t in refused:
        print(f"  REFUSED {t.skill}: {t.reason_refused}  ({t.path.name})", file=sys.stderr)

    if args.dry_run:
        fallbacks: set[str] = set()
        for t in eligible:
            hashes = dry_run(t, fallbacks=fallbacks)
            print(f"  {t.skill}: {len(hashes)} prompt(s) rendered, hashes computed")
            if args.verbose:
                for k, h in sorted(hashes.items()):
                    print(f"    {k} -> {h[:12]}")
        _print_fallback_summary(fallbacks)
        return 0

    exit_code = 0
    fallbacks = set()
    for t in eligible:
        result = regrade_run_log(t.path)
        if result.error:
            print(f"  ERROR {t.skill}: {result.error}", file=sys.stderr)
            exit_code = 1
            continue
        moved = [f"{tid} ({old}->{new})" for tid, old, new in result.tests_outcome_moved]
        suffix = f"; outcomes moved: {', '.join(moved)}" if moved else ""
        print(f"  {t.skill}: {result.runs_regraded} run(s) regraded{suffix}")
        fallbacks |= result.fallback_scenarios
    _print_fallback_summary(fallbacks)
    return exit_code


def _main_scratch(
    scratch_root: Path,
    *,
    only_skill: str | None,
    only_scenarios: set[str] | None,
    force_readme: bool,
    dry: bool,
    verbose: bool,
) -> int:
    if not scratch_root.is_absolute():
        print(
            f"--runlogs-root must be an absolute path (got {scratch_root}); the "
            "make recipe runs from eval/harness, so a relative path lands there.",
            file=sys.stderr,
        )
        return 2
    unknown = sorted(s for s in (only_scenarios or set()) if not (SCENARIOS / s).is_dir())
    if unknown:
        print(f"--scenario names no scenario directory: {', '.join(unknown)}", file=sys.stderr)
        return 2
    targets = collect_regradeable_logs(UNIT_RUNLOGS, only_skill=only_skill, scratch=True)
    if not dry:
        # Refuse a reused pass dir before the first paid judge call, not midway.
        occupied = [
            str(scratch_root / t.skill) for t in targets
            if (scratch_root / t.skill).is_dir() and any((scratch_root / t.skill).glob("*.json"))
        ]
        if occupied:
            print(
                f"scratch dir already holds run logs: {', '.join(occupied)}; "
                "use a fresh --runlogs-root per pass",
                file=sys.stderr,
            )
            return 1
    fallbacks: set[str] = set()
    rendered = 0
    regraded = 0
    exit_code = 0
    for t in targets:
        if dry:
            filtered = filter_to_scenarios(t, only_scenarios)
            if filtered is None:
                continue
            gone: list[str] = []
            hashes = dry_run(
                filtered, force_readme=force_readme, fallbacks=fallbacks, skipped=gone
            )
            rendered += len(hashes)
            note = f"; skipped {len(gone)} deleted test(s): {', '.join(gone)}" if gone else ""
            print(f"  {t.skill}: {len(hashes)} prompt(s) rendered, hashes computed{note}")
            if verbose:
                for k, h in sorted(hashes.items()):
                    print(f"    {k} -> {h[:12]}")
            continue
        copy = copy_to_scratch(t, scratch_root, only_scenarios=only_scenarios)
        if copy is None:
            continue
        try:
            result = regrade_run_log(
                copy.path, force_readme=force_readme, scratch_root=scratch_root
            )
        except Exception:
            copy.path.unlink(missing_ok=True)
            raise
        if result.error:
            # The copy still holds the committed scores; leaving it would let a
            # comparison read them as this pass's result.
            copy.path.unlink(missing_ok=True)
            print(f"  ERROR {t.skill}: {result.error} (scratch copy removed)", file=sys.stderr)
            exit_code = 1
            continue
        regraded += result.runs_regraded
        print(
            f"  {t.skill}: {result.runs_regraded} run(s) regraded into "
            f"{copy.path}"
        )
        fallbacks |= result.fallback_scenarios
    if dry:
        print(f"  {rendered} prompt(s) rendered in total")
    else:
        print(f"  {regraded} run(s) regraded in total")
    _print_fallback_summary(fallbacks)
    if (rendered if dry else regraded) == 0:
        print("Nothing was rendered or regraded: no test matched.", file=sys.stderr)
        return 1
    return exit_code

if __name__ == "__main__":
    sys.exit(main())
