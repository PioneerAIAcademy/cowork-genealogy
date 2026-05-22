"""Assemble and validate multi-test run logs.

Schema v2: one run log per harness invocation, per skill. Wraps a list
of per-test entries in an envelope carrying version + snapshot +
metadata. See docs/plan/eval-runlog-versioning.md.

Pieces this module exposes:

  - `assemble_test_entry(...)` — produce the per-test dict that goes
    inside the envelope's `tests[]`.
  - `build_run_log(...)` — wrap per-test entries in the envelope.
  - `write_run_log(...)` — write to `<runlogs_root>/unit/<skill>/<filename>`.
  - `derive_activated(...)` — the §6 four-rule definition reused by the
    orchestrator.
  - `aggregate_dimensions(...)` / `aggregate_per_run_outcome(...)` —
    multi-run aggregation reused by the orchestrator.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema
from referencing import Registry, Resource


HARNESS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_DIR.parents[1]
SCHEMAS_DIR = REPO_ROOT / "docs/specs/schemas"


class RunlogAssemblyError(Exception):
    pass


class RunlogCollisionError(Exception):
    """Raised when write_run_log would overwrite an existing run log.

    Second-level timestamps can collide on back-to-back runs. Erroring
    loudly preserves prior runs and tells the operator to wait a second.
    """


@dataclass
class ValidatorResult:
    passed: bool | None
    results: list[dict[str, Any]]


@dataclass
class JudgeResult:
    skipped: bool
    dimensions: list[dict[str, Any]]
    judge_cost_usd: float
    error: str | None = None
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class SingleRun:
    outcome: str  # pass | partial | fail | aborted
    aborted_reason: str | None
    duration_ms: float
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    skill_cost_usd: float
    output: dict[str, Any]
    validators: ValidatorResult
    judge: JudgeResult


# ---- Aggregation helpers -------------------------------------------------


_OUTCOME_RANK = {"fail": 0, "partial": 1, "pass": 2}
# None (N/A) ranks above pass so it never wins a tie against a real score.
# All-null buckets are handled separately in aggregate_dimensions and don't
# rely on this rank.
_DIMENSION_RANK = {1: 1, 2: 2, 3: 3, None: 4}


def aggregate_per_run_outcome(per_run: list[str]) -> str:
    """Aggregate per-run outcomes per unit-test-spec.md §7."""
    if not per_run:
        raise RunlogAssemblyError("no per-run outcomes to aggregate")
    if "aborted" in per_run:
        return "aborted"
    return _modal_with_tiebreak_down(per_run, _OUTCOME_RANK)


def _modal_with_tiebreak_down(values, rank):
    if not values:
        raise ValueError("empty values list")
    counts: dict = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    max_count = max(counts.values())
    winners = [v for v, c in counts.items() if c == max_count]
    if len(winners) == 1:
        return winners[0]
    return min(winners, key=lambda v: rank.get(v, 999))


def aggregate_dimensions(runs: list[SingleRun]) -> list[dict[str, Any]]:
    """Modal per-dimension score across runs (ties resolve down).

    A dimension may have score=None (N/A) — currently only the Tool
    Arguments base dimension uses this, when a test made zero MCP tool
    calls. All-None buckets aggregate to None; mixed buckets fall back
    to standard modal logic with None ranking above pass so a real
    score wins any tie.
    """
    if not runs:
        return []
    bucket: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in runs:
        if r.judge.skipped:
            continue
        for d in r.judge.dimensions:
            key = (d.get("source", ""), d.get("name", ""))
            bucket.setdefault(key, []).append(d)

    aggregated: list[dict[str, Any]] = []
    for key, dims in bucket.items():
        scores = [d.get("score") for d in dims]
        if all(s is None for s in scores):
            modal = None
        else:
            modal = _modal_with_tiebreak_down(scores, _DIMENSION_RANK)
        modal_dim = next(d for d in dims if d.get("score") == modal)
        aggregated.append(
            {
                "source": key[0],
                "name": key[1],
                "score": modal,
                "rationale": modal_dim.get("rationale", ""),
            }
        )
    return aggregated


# ---- Activated derivation (spec §6) --------------------------------------


def derive_activated(
    *,
    skill: str,
    skills_invoked: list[str],
    tool_calls: list[dict[str, Any]],
    file_changes: dict[str, Any] | None,
    files_created: list[str],
    text_response: str,
    skill_frontmatter: dict[str, Any] | None = None,
    other_skill_names: set[str] | None = None,
) -> bool:
    """Per unit-test-spec.md §6 four-rule definition."""
    allowed_tools = (skill_frontmatter or {}).get("allowed-tools", []) or []
    has_char_tool = bool(
        tool_calls and _has_characteristic_tool_call(tool_calls, allowed_tools)
    )

    # Rules 1-2: file changes / files created only indicate activation
    # when there is corroborating evidence the skill under test ran
    # (it appears in skills_invoked or made a characteristic tool call).
    # Without this guard, a different skill's file output during a
    # correctly-routed negative test is mis-attributed to the skill
    # under test.
    skill_ran = skill in skills_invoked or has_char_tool

    if skill_ran:
        if file_changes:
            for f_diff in file_changes.values():
                if f_diff and f_diff.get("sections_modified"):
                    return True

        if files_created:
            return True

    # Rule 3: characteristic tool call
    if has_char_tool:
        return True

    # Rule 4: substantive response when skill was invoked
    if skill in skills_invoked and _is_substantive(
        text_response, other_skill_names=other_skill_names
    ):
        return True

    return False


def _has_characteristic_tool_call(
    tool_calls: list[dict[str, Any]], allowed_tools: list[str]
) -> bool:
    if not allowed_tools:
        return False
    allowed_set = set(allowed_tools)
    for call in tool_calls:
        bare = call.get("tool", "").split("__")[-1]
        if bare in allowed_set:
            return True
    return False


_SENTENCE_SPLIT = re.compile(r"[.!?]+(?:\s+|$)")
_SUBSTANTIVE_MIN_SENTENCES = 2
_SUBSTANTIVE_MIN_WORDS = 10
_SUBSTANTIVE_MIN_WORDS_LONG = 30
_ROUTING_FALLBACK_LOG: list[dict[str, Any]] = []


def _is_substantive(
    text: str, *, other_skill_names: set[str] | None = None
) -> bool:
    if not text or not text.strip():
        return False

    if other_skill_names is None:
        segments = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
        return (
            len(segments) >= _SUBSTANTIVE_MIN_SENTENCES
            and len(text.split()) >= _SUBSTANTIVE_MIN_WORDS
        )

    if len(text.split()) >= _SUBSTANTIVE_MIN_WORDS_LONG:
        return True
    for other in other_skill_names:
        pattern = re.compile(r"\b" + re.escape(other) + r"\b", re.IGNORECASE)
        if pattern.search(text):
            _ROUTING_FALLBACK_LOG.append(
                {"matched_skill": other, "text_excerpt": text[:200]}
            )
            return False
    return True


def get_routing_fallback_log() -> list[dict[str, Any]]:
    return list(_ROUTING_FALLBACK_LOG)


# ---- Per-test entry assembly ---------------------------------------------


def assemble_test_entry(
    *,
    test_id: str,
    test_type: str,
    expected_outcome: str,
    scenario: str | None,
    mcp_fixtures: list[str],
    runs: list[SingleRun],
    timestamp_for_run_id: str,
) -> dict[str, Any]:
    """Build a per-test entry for the multi-test run log envelope.

    `timestamp_for_run_id` is the envelope's timestamp — embedded into
    each run's `run_id` for traceability. Does not include any envelope
    metadata (skill, model, harness_version, etc.) — those go on the
    envelope, not duplicated per test.
    """
    if not runs:
        raise RunlogAssemblyError("at least one run required")

    per_run_outcomes = [r.outcome for r in runs]
    aggregated = aggregate_per_run_outcome(per_run_outcomes)
    flaky = len(set(per_run_outcomes)) > 1

    outcome = aggregated
    if expected_outcome == "xfail":
        if aggregated == "fail":
            outcome = "xfail"
        elif aggregated == "pass":
            outcome = "xpass"

    aggregated_dims = aggregate_dimensions(runs)

    totals = {
        "duration_ms": sum(r.duration_ms for r in runs),
        "input_tokens": sum(r.input_tokens for r in runs),
        "cached_input_tokens": sum(r.cached_input_tokens for r in runs),
        "output_tokens": sum(r.output_tokens for r in runs),
        "judge_input_tokens": sum(r.judge.input_tokens for r in runs),
        "judge_cached_input_tokens": sum(r.judge.cached_input_tokens for r in runs),
        "judge_output_tokens": sum(r.judge.output_tokens for r in runs),
        "skill_cost_usd": sum(r.skill_cost_usd for r in runs),
        "judge_cost_usd": sum(r.judge.judge_cost_usd for r in runs),
        "total_cost_usd": sum(
            r.skill_cost_usd + r.judge.judge_cost_usd for r in runs
        ),
    }

    runs_block = []
    for i, r in enumerate(runs):
        runs_block.append(
            {
                "run_index": i,
                "run_id": f"run_{test_id}_{timestamp_for_run_id}_{i}",
                "outcome": r.outcome,
                "aborted_reason": r.aborted_reason,
                "duration_ms": r.duration_ms,
                "input_tokens": r.input_tokens,
                "cached_input_tokens": r.cached_input_tokens,
                "output_tokens": r.output_tokens,
                "skill_cost_usd": r.skill_cost_usd,
                "output": r.output,
                "validators": {
                    "passed": r.validators.passed,
                    "results": r.validators.results,
                },
                "judge": {
                    "skipped": r.judge.skipped,
                    "dimensions": r.judge.dimensions,
                    "judge_cost_usd": r.judge.judge_cost_usd,
                    "error": r.judge.error,
                    "input_tokens": r.judge.input_tokens,
                    "cached_input_tokens": r.judge.cached_input_tokens,
                    "output_tokens": r.judge.output_tokens,
                },
            }
        )

    return {
        "test_id": test_id,
        "test_type": test_type,
        "expected_outcome": expected_outcome,
        "scenario": scenario,
        "mcp_fixtures": mcp_fixtures,
        "outcome": outcome,
        "flaky": flaky,
        "outcome_summary": {
            "per_run_outcomes": per_run_outcomes,
            "aggregated_dimensions": aggregated_dims,
        },
        "totals": totals,
        "runs": runs_block,
    }


# ---- Run-log envelope -----------------------------------------------------


_TOTALS_KEYS = (
    "duration_ms",
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "judge_input_tokens",
    "judge_cached_input_tokens",
    "judge_output_tokens",
    "skill_cost_usd",
    "judge_cost_usd",
    "total_cost_usd",
)


def build_run_log(
    *,
    schema_version: int = 2,
    skill: str,
    version: int | None,
    released: bool,
    releasable: bool,
    invocation: str,
    timestamp: str,
    harness_version: str,
    model: str,
    judge_prompt_hash: str,
    snapshot: dict[str, str],
    tests: list[dict[str, Any]],
) -> dict[str, Any]:
    """Wrap per-test entries in the run-log envelope.

    `tests` is a list of dicts produced by `assemble_test_entry()`. The
    envelope's `totals` is the per-key sum across the tests' totals.
    """
    totals = {k: 0 for k in _TOTALS_KEYS}
    for entry in tests:
        t = entry.get("totals") or {}
        for k in _TOTALS_KEYS:
            totals[k] += t.get(k, 0) or 0

    return {
        "schema_version": schema_version,
        "skill": skill,
        "version": version,
        "released": released,
        "releasable": releasable,
        "invocation": invocation,
        "timestamp": timestamp,
        "harness_version": harness_version,
        "model": model,
        "judge_prompt_hash": judge_prompt_hash,
        "snapshot": snapshot,
        "tests": tests,
        "totals": totals,
    }


# ---- Schema validation ----------------------------------------------------


@lru_cache(maxsize=1)
def _validator():
    schema = json.loads((SCHEMAS_DIR / "run-log.schema.json").read_text())
    enums_path = SCHEMAS_DIR / "enums.schema.json"
    registry = Registry()
    if enums_path.exists():
        registry = registry.with_resource(
            uri="enums.schema.json",
            resource=Resource.from_contents(json.loads(enums_path.read_text())),
        )
    return jsonschema.Draft202012Validator(schema, registry=registry)


def validate_run_log(log: dict[str, Any]) -> None:
    """Raise jsonschema.ValidationError if log doesn't match the v2 schema."""
    _validator().validate(log)


# ---- Write to disk --------------------------------------------------------


_SIDECAR_TEXT_THRESHOLD = 100_000


def write_run_log(
    log: dict[str, Any],
    *,
    runlogs_root: Path,
    filename: str,
) -> Path:
    """Write `log` to `<runlogs_root>/unit/<skill>/<filename>`.

    Spills per-run `text_response` payloads >100KB to sidecar files
    under `runs/<run_id>.text.md` (replaces the string with `{"ref": ...}`).
    Validates against `run-log.schema.json` before writing.

    Raises `RunlogCollisionError` if the destination already exists —
    operators must wait one second and rerun or pick a non-conflicting
    timestamp.
    """
    skill = log["skill"]
    target_dir = Path(runlogs_root) / "unit" / skill
    target_dir.mkdir(parents=True, exist_ok=True)

    for test in log.get("tests", []):
        for run in test.get("runs", []):
            output = run.get("output") or {}
            text = output.get("text_response")
            if isinstance(text, str) and len(text) > _SIDECAR_TEXT_THRESHOLD:
                run_id = run.get("run_id", "unknown")
                safe = run_id.replace(":", "-").replace("/", "-")
                sidecar_rel = f"runs/{safe}.text.md"
                sidecar_abs = target_dir / sidecar_rel
                sidecar_abs.parent.mkdir(parents=True, exist_ok=True)
                sidecar_abs.write_text(text)
                output["text_response"] = {"ref": sidecar_rel}

    validate_run_log(log)
    out = target_dir / filename
    if out.exists():
        raise RunlogCollisionError(
            f"run log already exists at {out} — wait one second and rerun, "
            f"or pass an explicit non-conflicting timestamp."
        )
    out.write_text(json.dumps(log, indent=2))
    return out
