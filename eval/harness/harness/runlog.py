"""Assemble and validate run logs against run-log.schema.json.

v1: N=1 only. The aggregated outcome mirrors runs[0].outcome and flaky is
always False. Multi-run aggregation moves here when v2 lights up.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
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


@dataclass
class ValidatorResult:
    # None when no validators ran (aborted-before-validators case); True
    # when all passed; False when any failed.
    passed: bool | None
    results: list[dict[str, Any]]


@dataclass
class JudgeResult:
    skipped: bool
    dimensions: list[dict[str, Any]]
    judge_cost_usd: float
    error: str | None = None
    # Judge-layer tokens, kept separate from the run-level totals so the
    # spec §11 cache-hit-rate diagnostic (cached / input on the SKILL side)
    # isn't muddied by judge tokens.
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


def _now_utc_filename_safe() -> str:
    """Return current UTC time as YYYY-MM-DDTHH-MM-SS-fffZ — filename-safe.

    Includes millisecond resolution to avoid collisions when two run logs
    land in the same second. Once v2 parallel execution lands, this is the
    primary protection against `<root>/unit/<skill>/<model>/<ts>.json`
    name collisions; today it's also useful for back-to-back `--all` runs.
    """
    now = datetime.now(timezone.utc)
    # %f gives microseconds; truncate to milliseconds (3 digits) for sanity
    # and stable filenames.
    millis = now.strftime("%f")[:3]
    return now.strftime(f"%Y-%m-%dT%H-%M-%S-{millis}Z")


def aggregate_per_run_outcome(per_run: list[str]) -> str:
    """Aggregate per-run outcomes per unit-test-spec.md §7.

    Rules:
      - Any `aborted` → `aborted` (failure to converge is itself a signal)
      - Otherwise modal outcome with ties resolving toward the lower score
        (fail < partial < pass)
    """
    if not per_run:
        raise RunlogAssemblyError("no per-run outcomes to aggregate")
    if "aborted" in per_run:
        return "aborted"
    return _modal_with_tiebreak_down(per_run, _OUTCOME_RANK)


# Outcome and dimension scoring share the same fail < partial < pass order.
_OUTCOME_RANK = {"fail": 0, "partial": 1, "pass": 2}


def _modal_with_tiebreak_down(values: list[str], rank: dict[str, int]) -> str:
    """Return the modal value; on a tie, return the lowest-ranked candidate.

    Used by both outcome aggregation and per-dimension aggregation.
    """
    if not values:
        raise ValueError("empty values list")
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    max_count = max(counts.values())
    winners = [v for v, c in counts.items() if c == max_count]
    if len(winners) == 1:
        return winners[0]
    # Tie: pick the lowest-ranked (worst) outcome among the winners.
    return min(winners, key=lambda v: rank.get(v, 999))


def aggregate_dimensions(
    runs: list["SingleRun"],
) -> list[dict[str, Any]]:
    """Compute aggregated dimensions across runs per spec §7.

    For each (source, name) key, the aggregated score is the modal score
    across all runs (ties resolve toward lower score). The rationale is
    taken from one of the runs that contributed the modal score.

    Runs whose judge was skipped contribute nothing.
    """
    if not runs:
        return []
    # Collect per-run dimensions, grouped by (source, name).
    bucket: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in runs:
        if r.judge.skipped:
            continue
        for d in r.judge.dimensions:
            key = (d.get("source", ""), d.get("name", ""))
            bucket.setdefault(key, []).append(d)

    aggregated: list[dict[str, Any]] = []
    for key, dims in bucket.items():
        scores = [d.get("score", "fail") for d in dims]
        modal = _modal_with_tiebreak_down(scores, _OUTCOME_RANK)
        # Pick a rationale from one of the runs that scored modally.
        modal_dim = next(d for d in dims if d.get("score") == modal)
        aggregated.append({
            "source": key[0],
            "name": key[1],
            "score": modal,
            "rationale": modal_dim.get("rationale", ""),
        })
    return aggregated


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
    """Per unit-test-spec.md §6 four-rule definition of `activated`.

    Rule 3 ("MCP tool calls characteristic of the skill's workflow")
    requires the tool be in the skill's `allowed-tools` frontmatter — an
    incidental call to an unrelated MCP tool does not count.

    Rule 4 ("skill invoked + substantive response") filters out the
    one-line routing-acknowledgement case from spec §6. `other_skill_names`
    is the set of *all* skill directory names except the one under test;
    when supplied, a short response that mentions any of them is treated
    as routing-only. When omitted, falls back to the legacy
    sentence/word-count thresholds (compatible with older callers).
    """
    if file_changes:
        for f_diff in file_changes.values():
            if f_diff and f_diff.get("sections_modified"):
                return True

    if files_created:
        return True

    allowed_tools = (skill_frontmatter or {}).get("allowed-tools", []) or []
    if tool_calls and _has_characteristic_tool_call(tool_calls, allowed_tools):
        return True

    if skill in skills_invoked and _is_substantive(
        text_response, other_skill_names=other_skill_names
    ):
        return True

    return False


def _has_characteristic_tool_call(
    tool_calls: list[dict[str, Any]], allowed_tools: list[str]
) -> bool:
    """True iff any tool call is in the skill's allowed-tools frontmatter.

    Mock tools are namespaced as `mcp__genealogy__<bare>`; we compare the
    bare suffix against the frontmatter list (which uses bare names).
    """
    if not allowed_tools:
        return False
    allowed_set = set(allowed_tools)
    for call in tool_calls:
        bare = call.get("tool", "").split("__")[-1]
        if bare in allowed_set:
            return True
    return False


# Pattern: split on one or more sentence-ending punctuators followed by
# whitespace, end of string, or another quote. Counts segments with content.
_SENTENCE_SPLIT = re.compile(r"[.!?]+(?:\s+|$)")

# Thresholds for `_is_substantive`. Not in the spec — they're empirical
# guards against false-positive activation. The spec says only "more than a
# one-sentence acknowledgement"; we interpret that as multi-sentence AND
# non-trivial total length, because "OK. Done." technically has 2 sentences
# but is plainly an acknowledgement. Tuned against the seed corpus; revisit
# if junior reviewers consistently disagree with `activated` on negative
# tests.
_SUBSTANTIVE_MIN_SENTENCES = 2
_SUBSTANTIVE_MIN_WORDS = 10


def _is_substantive(
    text: str, *, other_skill_names: set[str] | None = None
) -> bool:
    """A response is substantive unless it's a routing acknowledgement.

    Spec §6 rule 4's concern is the "I see you're asking about X, but Y
    skill handles this" pattern — a short reply that punts to another
    skill. v1.4 changes the heuristic from "≥2 sentences AND ≥10 words"
    (which over-filtered legitimate concise outputs like
    convert-dates → "1850-03-15" or translation → "Patrick, son of John")
    to **"non-empty AND not pattern-matching as routing to another skill."**

    Routing pattern: the response mentions any name from
    `other_skill_names` (the set of skills *other than* the one under test).
    When that set isn't supplied, fall back to the legacy threshold so
    older test code keeps working.
    """
    if not text or not text.strip():
        return False

    if other_skill_names is None:
        # Legacy path — used by tests that don't thread the skill set.
        segments = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
        return (
            len(segments) >= _SUBSTANTIVE_MIN_SENTENCES
            and len(text.split()) >= _SUBSTANTIVE_MIN_WORDS
        )

    # Skill-name-aware path. Short responses that mention another skill
    # are treated as routing acknowledgements. Long responses are always
    # substantive — even if they mention another skill, they're doing
    # real work alongside the mention.
    if len(text.split()) >= _SUBSTANTIVE_MIN_WORDS_LONG:
        return True
    text_lower = text.lower()
    for other in other_skill_names:
        if other.lower() in text_lower:
            return False
    return True


_SUBSTANTIVE_MIN_WORDS_LONG = 30  # responses this long are substantive even
                                  # if they mention another skill name


def assemble_run_log(
    *,
    test_id: str,
    skill: str,
    test_type: str,
    expected_outcome: str,
    scenario: str | None,
    mcp_fixtures: list[str],
    harness_version: str,
    model: str,
    judge_model: str,
    rubric_hash: str,
    judge_prompt_hash: str,
    runs: list[SingleRun],
    timestamp: str | None = None,
) -> dict[str, Any]:
    if not runs:
        raise RunlogAssemblyError("at least one run required")

    per_run_outcomes = [r.outcome for r in runs]
    aggregated = aggregate_per_run_outcome(per_run_outcomes)
    flaky = len(set(per_run_outcomes)) > 1

    # xfail/xpass reframing per unit-test-spec.md §7: an xfail-marked test
    # that resolves to fail is reported as xfail (expected, not a regression);
    # one that resolves to pass is reported as xpass (unexpected — investigate
    # whether the marker should be removed). Aborted runs stay aborted.
    outcome = aggregated
    if expected_outcome == "xfail":
        if aggregated == "fail":
            outcome = "xfail"
        elif aggregated == "pass":
            outcome = "xpass"

    # Aggregated dimensions: modal score per (source, name) across runs.
    # N=1 reduces to runs[0]'s dimensions; N>1 picks the modal answer.
    aggregated_dims = aggregate_dimensions(runs)

    totals = {
        "duration_ms": sum(r.duration_ms for r in runs),
        # Skill-side tokens; judge tokens are tracked separately below.
        "input_tokens": sum(r.input_tokens for r in runs),
        "cached_input_tokens": sum(r.cached_input_tokens for r in runs),
        "output_tokens": sum(r.output_tokens for r in runs),
        "judge_input_tokens": sum(r.judge.input_tokens for r in runs),
        "judge_cached_input_tokens": sum(r.judge.cached_input_tokens for r in runs),
        "judge_output_tokens": sum(r.judge.output_tokens for r in runs),
        "skill_cost_usd": sum(r.skill_cost_usd for r in runs),
        "judge_cost_usd": sum(r.judge.judge_cost_usd for r in runs),
        "total_cost_usd": sum(r.skill_cost_usd + r.judge.judge_cost_usd for r in runs),
    }

    # Filename-safe ISO 8601: UTC Z suffix, no colons. Matches the
    # eval/CLAUDE.md convention (YYYY-MM-DD-HH-MM-SS) and round-trips through
    # filesystems that disallow colons.
    ts = timestamp or _now_utc_filename_safe()

    runs_block = []
    for i, r in enumerate(runs):
        runs_block.append(
            {
                "run_index": i,
                "run_id": f"run_{test_id}_{ts}_{i}",
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
        "skill": skill,
        "test_type": test_type,
        "expected_outcome": expected_outcome,
        "timestamp": ts,
        "harness_version": harness_version,
        "model": model,
        "judge_model": judge_model,
        "rubric_hash": rubric_hash,
        "judge_prompt_hash": judge_prompt_hash,
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


@lru_cache(maxsize=1)
def _validator():
    schema = json.loads((SCHEMAS_DIR / "run-log.schema.json").read_text())
    enums = json.loads((SCHEMAS_DIR / "enums.schema.json").read_text())
    registry = Registry().with_resource(
        uri="enums.schema.json",
        resource=Resource.from_contents(enums),
    )
    return jsonschema.Draft202012Validator(schema, registry=registry)


def validate_run_log(log: dict[str, Any]) -> None:
    """Raise jsonschema.ValidationError if log doesn't match the schema."""
    _validator().validate(log)


# Spec §10: when a single run's text_response exceeds 100 KB, the harness
# writes it to a sidecar file (`runs/<run_id>.text.md`) and replaces the
# inline string with `{"ref": "runs/<run_id>.text.md"}` so the JSON stays
# tractable for UI loads and git diffs.
_SIDECAR_TEXT_THRESHOLD = 100_000


def write_run_log(log: dict[str, Any], runlogs_root: Path) -> Path:
    """Write a run log to disk at the canonical path:
        <root>/unit/<skill>/<model>/<timestamp>.json

    Per-run text_response payloads exceeding 100 KB are spilled to a
    sidecar file and replaced with a `{"ref": "..."}` reference per
    spec §10.

    Validates against run-log.schema.json before writing so schema drift
    surfaces here instead of being silently committed to disk.
    """
    skill = log["skill"]
    model = log["model"]
    target_dir = Path(runlogs_root) / "unit" / skill / model
    target_dir.mkdir(parents=True, exist_ok=True)

    # Spill large text_response payloads to sidecar files. Mutate the log
    # in place — the schema's `anyOf` already permits both the inline
    # string form and the `{"ref": ...}` form.
    for run in log.get("runs", []):
        output = run.get("output") or {}
        text = output.get("text_response")
        if isinstance(text, str) and len(text) > _SIDECAR_TEXT_THRESHOLD:
            run_id = run.get("run_id", "unknown")
            # Slash-safe filename derived from run_id; run_id itself
            # contains colons via the ISO timestamp, so normalize.
            safe = run_id.replace(":", "-")
            sidecar_rel = f"runs/{safe}.text.md"
            sidecar_abs = target_dir / sidecar_rel
            sidecar_abs.parent.mkdir(parents=True, exist_ok=True)
            sidecar_abs.write_text(text)
            output["text_response"] = {"ref": sidecar_rel}

    validate_run_log(log)
    out = target_dir / f"{log['timestamp']}.json"
    out.write_text(json.dumps(log, indent=2, default=str))
    return out
