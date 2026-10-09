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

CLI (from eval/harness/):
  uv run python -m judge_regrade                      # live regrade every eligible
  uv run python -m judge_regrade --skill citation     # one skill only
  uv run python -m judge_regrade --dry-run            # render+hash, no model call
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from harness import judge, loader, rubric, snapshot
from harness.auth import resolve_auth
from harness.judge import (
    DEFAULT_JUDGE_MODEL,
    JUDGE_PROMPT_PATH,
    JudgeError,
    grade,
    render_prompt_parts,
)
from harness.loader import InvalidTestError
from harness.orchestrator import (
    _compute_outcome,
    _negative_judge_context,
    _summarize_before_state,
    _summarize_changes,
    flag_routing_negative_judge_fail,
)
from harness.outcomes import aggregate_per_run_outcome
from harness.runlog import _replace_with_retry, validate_run_log
from harness.versioning import classify

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
    error: str | None = None


def _latest_full_skill_runlog(skill_dir: Path) -> tuple[str, dict[str, Any]] | None:
    """Return (filename, parsed_log) for the newest released or candidate log.

    Mirrors `check_runlogs.latest_full_skill_runlog` without pulling the
    whole script in as a dependency.
    """
    if not skill_dir.is_dir():
        return None
    candidates: list[tuple[tuple[int, str], Path]] = []
    for p in skill_dir.glob("v*.json"):
        if p.name.endswith(".ann.json"):
            continue
        kind, version, _ts = classify(p.name)
        if kind == "released":
            # Prefer released; sort to the end so it wins max().
            candidates.append(((version, "zzz"), p))
        elif kind == "candidate":
            candidates.append(((version, p.name), p))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])
    path = candidates[-1][1]
    try:
        return (path.name, json.loads(path.read_text(encoding="utf-8")))
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
) -> list[RegradeTarget]:
    """Enumerate every skill's latest full run log; classify each.

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
        stored_hash = log.get("judge_prompt_hash") or ""
        if stored_hash == current_hash:
            # Not stale on prompt — nothing to regrade.
            continue
        path = skill_dir / filename
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
# The issue body's trace: eight of eleven slots come out of the run log; three
# come off disk. The function below rebuilds every input `judge.grade` needs
# from a committed run entry, by re-reading disk for `rubric`, `scenario_readme`,
# `judge_context`, `user_message` and the before-state (research + tree), and
# splicing predicate-matched tool responses from `eval/fixtures/mcp/`.


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


def _load_scenario_readme(scenario: str | None) -> str:
    if not scenario:
        return ""
    path = SCENARIOS / scenario / "README.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _load_before_snapshot(scenario: str | None) -> dict[str, Any]:
    """Rebuild the before-snapshot `_summarize_before_state` reads.

    It reads only two keys of the before-snapshot: the scenario's
    `research.json` and its `tree.gedcomx.json`. Returns an empty dict for a
    scenario-less test (empty before-state renders as "(none)").
    """
    if not scenario:
        return {}
    sdir = SCENARIOS / scenario
    out: dict[str, Any] = {}
    research_path = sdir / "research.json"
    tree_path = sdir / "tree.gedcomx.json"
    if research_path.exists():
        try:
            out["research.json"] = json.loads(research_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    if tree_path.exists():
        try:
            out["tree.gedcomx.json"] = json.loads(tree_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    return out


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


def _harness_observations_from_warnings(warnings: list[dict[str, Any]]) -> list[str]:
    """Extract `prose_observation` entries from `runs[].output.warnings[]`.

    The trap this works around: `as_dicts` in `validator_runner.py` drops
    reporting-only validator results, so tier-2 observations never reach
    `runs[].validators.results` — they live only in output.warnings[].
    """
    out: list[str] = []
    for w in warnings or []:
        if (w or {}).get("kind") == "prose_observation":
            obs = w.get("observation") or w.get("message") or ""
            if obs:
                out.append(obs)
    return out


def _validator_failure_strings(validators_block: dict[str, Any]) -> list[str]:
    """Human-readable summaries for the judge prompt's `validator_failures` slot."""
    results = (validators_block or {}).get("results") or []
    out: list[str] = []
    for r in results:
        if r.get("passed") is False:
            name = r.get("name") or "unknown"
            err = r.get("error") or ""
            out.append(f"{name}: {err}" if err else name)
    return out


def _failed_validator_names(validators_block: dict[str, Any]) -> frozenset[str]:
    """Validator names (bare) for `_compute_outcome`'s `failed_validators` arg."""
    results = (validators_block or {}).get("results") or []
    return frozenset(
        r.get("name") or "unknown"
        for r in results
        if r.get("passed") is False
    )


def render_judge_prompt_for_test(
    log: dict[str, Any],
    test_entry: dict[str, Any],
    run_entry: dict[str, Any],
    *,
    repo_root: Path = REPO_ROOT,
) -> str:
    """Reconstruct the judge prompt for one test run — reads disk, bypasses cache.

    Signature differs from PLAN.md v3 (which said `(log, run_index, test_index,
    repo_root)`): we pass the dict objects directly rather than indices, since
    the caller already has them from the per-test loop. Same resolved behavior;
    cleaner call sites.

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

    skill = log["skill"]
    test_id = test_entry["test_id"]
    spec = _load_test_spec(skill, test_id)
    rub = _load_rubric(skill)
    scenario = spec.scenario if hasattr(spec, "scenario") else None
    scenario_readme = _load_scenario_readme(scenario)
    before_snapshot = _load_before_snapshot(scenario)

    # judge_context: test's own list from spec, plus _negative_judge_context
    # framing if the test is negative.
    if spec.negative is not None:
        judge_context = _negative_judge_context(spec)
    else:
        judge_context = list(spec.judge_context or [])

    output = run_entry.get("output") or {}
    tool_calls = _splice_tool_responses(output.get("tool_calls") or [])
    skills_invoked = output.get("skills_invoked") or []
    text_response = output.get("text_response") or ""
    file_changes = output.get("file_changes") or []
    warnings = output.get("warnings") or []
    harness_observations = _harness_observations_from_warnings(warnings)

    validators = run_entry.get("validators") or {}
    validator_failures = _validator_failure_strings(validators)

    file_changes_summary = _summarize_changes(
        file_changes, tool_calls, include_content=bool(spec.judge_reads_files)
    )
    before_state = _summarize_before_state(before_snapshot)

    prefix, suffix = render_prompt_parts(
        rubric=rub,
        judge_context=judge_context,
        scenario_readme=scenario_readme,
        user_message=spec.user_message,
        skills_invoked=skills_invoked,
        text_response=text_response,
        file_changes_summary=file_changes_summary,
        tool_calls=tool_calls,
        before_state=before_state,
        validator_failures=validator_failures,
        harness_observations=harness_observations,
        state_observations=None,
    )
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


def regrade_run_log(path: Path) -> RegradeResult:
    """Live regrade one run log in place; return a summary of what moved."""
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
        scenario_readme = _load_scenario_readme(scenario)
        before_snapshot = _load_before_snapshot(scenario)
        if spec.negative is not None:
            judge_context = _negative_judge_context(spec)
        else:
            judge_context = list(spec.judge_context or [])
        before_state = _summarize_before_state(before_snapshot)

        old_outcome = test_entry.get("outcome")
        new_outcomes: list[str] = []

        for run_entry in test_entry.get("runs") or []:
            if run_entry.get("judge_skipped"):
                # The original run skipped the judge (e.g. validator failure
                # before judging); respect that — a regrade doesn't resurrect it.
                continue
            # Several fields live under `output`, not at the run-entry top:
            # `activated`, `skills_invoked`, `text_response`, `tool_calls`,
            # `file_changes`, `builtin_tool_calls`, `warnings`. Reading them off
            # the top of `run_entry` returns None/[] and silently flips every
            # routed positive test to fail downstream.
            output = run_entry.get("output") or {}
            tool_calls = _splice_tool_responses(output.get("tool_calls") or [])
            skills_invoked = output.get("skills_invoked") or []
            text_response = output.get("text_response") or ""
            file_changes = output.get("file_changes") or []
            activated = bool(output.get("activated"))
            builtin_tool_calls = output.get("builtin_tool_calls") or []
            warnings = _strip_prior_coerced_warnings(output.get("warnings") or [])
            harness_observations = _harness_observations_from_warnings(warnings)
            validators_block = run_entry.get("validators") or {}
            # Two shapes: the judge prompt wants readable "name: error" lines;
            # _compute_outcome wants the bare names as a frozenset.
            validator_failure_lines = _validator_failure_strings(validators_block)
            failed_validator_names = _failed_validator_names(validators_block)
            file_changes_summary = _summarize_changes(
                file_changes, tool_calls, include_content=bool(spec.judge_reads_files)
            )

            try:
                judge_out = grade(
                    rubric=rub,
                    judge_context=judge_context,
                    scenario_readme=scenario_readme,
                    user_message=spec.user_message,
                    skills_invoked=skills_invoked,
                    text_response=text_response,
                    file_changes_summary=file_changes_summary,
                    tool_calls=tool_calls,
                    auth=auth,
                    model=DEFAULT_JUDGE_MODEL,
                    before_state=before_state,
                    validator_failures=validator_failure_lines,
                    harness_observations=harness_observations,
                    state_observations=None,
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
    validate_run_log(log)
    tmp = path.parent / (path.name + ".tmp")
    tmp.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")
    _replace_with_retry(tmp, path)
    return result


# ---- Dry-run (no model call) ----------------------------------------------


def dry_run(target: RegradeTarget) -> dict[str, str]:
    """Render every test's judge prompt and return `{test_id: sha256}`.

    Pure disk reads — zero model calls, zero cost. Used by `make harness-test`
    to prove the renderer reads from disk (edit a rubric → every hash moves).
    """
    out: dict[str, str] = {}
    for test_entry in target.log.get("tests") or []:
        for run_entry in test_entry.get("runs") or []:
            text = render_judge_prompt_for_test(target.log, test_entry, run_entry)
            key = f"{test_entry['test_id']}/{run_entry.get('run_index', 0)}"
            out[key] = hash_rendered_prompt(text)
            # First run only — a test's runs render the same prompt by design.
            break
    return out


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
    args = parser.parse_args(argv)

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
        for t in eligible:
            hashes = dry_run(t)
            print(f"  {t.skill}: {len(hashes)} prompt(s) rendered, hashes computed")
            if args.verbose:
                for k, h in sorted(hashes.items()):
                    print(f"    {k} -> {h[:12]}")
        return 0

    exit_code = 0
    for t in eligible:
        result = regrade_run_log(t.path)
        if result.error:
            print(f"  ERROR {t.skill}: {result.error}", file=sys.stderr)
            exit_code = 1
            continue
        moved = [f"{tid} ({old}->{new})" for tid, old, new in result.tests_outcome_moved]
        suffix = f"; outcomes moved: {', '.join(moved)}" if moved else ""
        print(f"  {t.skill}: {result.runs_regraded} run(s) regraded{suffix}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
