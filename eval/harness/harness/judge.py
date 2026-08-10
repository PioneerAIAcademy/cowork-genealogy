"""LLM judge — grades skill output against the base + skill + per-test rubric.

Uses the Anthropic SDK directly (not the Claude Agent SDK) so we have tight
control over the tool_use schema. Forced `submit_grading` tool_use produces
structured output without prose-parsing brittleness.

Pricing for cost accounting is centralized in harness.judge.JUDGE_PRICING so
the rates can be edited in one place when Anthropic updates them.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import anthropic

from harness.auth import AuthConfig
from harness.rubric import Rubric


HARNESS_DIR = Path(__file__).resolve().parents[1]
JUDGE_PROMPT_PATH = HARNESS_DIR / "judge" / "prompt.md"

DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"
# Pin the judge's first sample to greedy decoding so one transcript grades the
# same way run to run. Scope matters: only the *judge* is pinned. The skill run
# under test still samples freely (claude-agent-sdk exposes no temperature), so
# this removes grading jitter, not test-outcome jitter. Greedy decoding narrows
# variance; it is not a determinism guarantee.
#
# Model-gated: Haiku 4.5 accepts sampling params. The e2e judge's Opus 4.8 does
# not — `temperature` is removed on the Opus 4.7/4.8 family and returns a 400,
# so that judge cannot be pinned at all (see e2e/judge.py).
JUDGE_TEMPERATURE = 0.0
JUDGE_PRICING = {
    # Per-million-token prices as of January 2026 list price. Update here
    # when Anthropic publishes new rates; the judge will pick them up.
    "claude-haiku-4-5-20251001": {"input": 1.0, "output": 5.0, "cached_input": 0.10},
    # Sonnet 4.6 — included so a harness invoked with --judge-model
    # claude-sonnet-4-6 doesn't silently report $0 cost.
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0, "cached_input": 0.30},
    # Opus 4.7 — same rationale; cost is much higher but the table prevents
    # silent under-reporting.
    "claude-opus-4-7": {"input": 15.0, "output": 75.0, "cached_input": 1.50},
}

# When the chosen judge model isn't in JUDGE_PRICING, fall back to these
# rates (conservatively Sonnet-class) and warn at first encounter. Better
# to over-estimate than to under-estimate by zero.
_FALLBACK_PRICING = {"input": 3.0, "output": 15.0, "cached_input": 0.30}
_warned_about_pricing: set[str] = set()


GRADING_TOOL = {
    "name": "submit_grading",
    "description": "Submit the structured grading for this skill execution.",
    "input_schema": {
        "type": "object",
        "required": ["dimensions"],
        "additionalProperties": False,
        "properties": {
            "dimensions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["source", "name", "score", "rationale"],
                    "additionalProperties": False,
                    "properties": {
                        "source": {"enum": ["base", "rubric"]},
                        "name": {"type": "string"},
                        # Tool Arguments may be null (N/A) when zero MCP
                        # calls happened. Correctness and Completeness
                        # must be 1/2/3 — validated post-hoc in
                        # _extract_dimensions.
                        "score": {
                            "anyOf": [
                                {"enum": [1, 2, 3]},
                                {"type": "null"},
                            ]
                        },
                        "rationale": {"type": "string", "minLength": 20},
                    },
                },
            }
        },
    },
}

# Base dimensions the judge is required to emit. Tool Arguments may be
# null when zero MCP calls happened; the others must always be 1/2/3.
_REQUIRED_BASE_DIMENSIONS = ("Correctness", "Completeness", "Tool Arguments")
_NULLABLE_BASE_DIMENSIONS = ("Tool Arguments",)

# The fields a grading dimension may carry — derived from the tool schema so
# it stays in sync. Used to strip any extra keys a judge model emits (Sonnet 5
# adds a null `index`) before the run-log's strict schema rejects them.
_GRADING_DIM_KEYS = frozenset(
    GRADING_TOOL["input_schema"]["properties"]["dimensions"]["items"]["properties"]
)


class JudgeError(Exception):
    pass


@dataclass
class JudgeOutput:
    dimensions: list[dict[str, Any]]
    cost_usd: float
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    prompt_hash: str
    # Advisories from _extract_dimensions: a dropped unknown/duplicate
    # dimension (#1361). Empty on the common path. Shape matches the
    # run-log's generic `output.warnings[]` (kind + additionalProperties),
    # NOT the judge_results schema (additionalProperties:false, no
    # warnings field) — the caller folds these into output.warnings.
    warnings: list[dict[str, Any]] = field(default_factory=list)


@lru_cache(maxsize=1)
def judge_prompt_template() -> str:
    return JUDGE_PROMPT_PATH.read_text(encoding="utf-8")


def judge_prompt_hash() -> str:
    return hashlib.sha256(judge_prompt_template().encode("utf-8")).hexdigest()


_RESPONSE_STRING_MAX = 2000
_RESPONSE_ARRAY_SAMPLE = 3
_RESPONSE_MAX_DEPTH = 8  # guard against pathological nested responses


def _summarize_response(
    response: Any, _depth: int = 0, *, string_max: int = _RESPONSE_STRING_MAX
) -> Any:
    """Produce a tight summary of a tool response for the judge prompt.

    Full responses can be thousands of tokens of census data. We bound the
    prompt size while preserving enough context for the judge to grade
    tool-usage quality.

    - dicts: keep keys; recurse on values
    - lists: keep length + first N items (recursed), with an explicit
      "_summary_truncated" marker so the judge doesn't mistake the
      summary for the actual response
    - strings: truncate to `string_max` with an explicit
      "[truncated by harness for prompt size; full length N chars]" suffix
    - everything else: passed through
    - depth cap: at _RESPONSE_MAX_DEPTH, replace nested content with a
      "_truncated_for_depth" marker so a fixture that recurses cannot
      hang the judge call

    `string_max` overrides the per-string truncation length. The default
    (_RESPONSE_STRING_MAX) suits noisy tool payloads; callers summarizing
    a graded deliverable written to a file (see orchestrator._summarize_changes)
    pass a larger value so e.g. a full proof narrative, including its
    citations, survives.
    """
    if _depth >= _RESPONSE_MAX_DEPTH:
        return {"_truncated_for_depth": True, "_max_depth": _RESPONSE_MAX_DEPTH}
    if response is None:
        return None
    if isinstance(response, dict):
        return {
            k: _summarize_response(v, _depth + 1, string_max=string_max)
            for k, v in response.items()
        }
    if isinstance(response, list):
        if len(response) <= _RESPONSE_ARRAY_SAMPLE:
            return [
                _summarize_response(x, _depth + 1, string_max=string_max)
                for x in response
            ]
        sample = [
            _summarize_response(x, _depth + 1, string_max=string_max)
            for x in response[:_RESPONSE_ARRAY_SAMPLE]
        ]
        return {
            "_summary_truncated": True,
            "_full_length": len(response),
            "_first_n": sample,
        }
    if isinstance(response, str) and len(response) > string_max:
        full_len = len(response)
        return (
            response[:string_max]
            + f" [truncated by harness for prompt size; full length {full_len} chars]"
        )
    return response


def render_prompt(
    *,
    rubric: Rubric,
    judge_context: list[str],
    scenario_readme: str,
    user_message: str,
    skills_invoked: list[str],
    text_response: str,
    file_changes_summary: str,
    tool_calls: list[dict[str, Any]],
    before_state: str = "(none)",
) -> str:
    """Fill the judge prompt template slots into one flat string.

    Retained for tests that just want the final text. The harness's
    `grade()` uses `render_prompt_parts()` instead so the stable prefix
    can be marked cacheable for prompt caching (spec §11).
    """
    prefix, suffix = render_prompt_parts(
        rubric=rubric,
        judge_context=judge_context,
        scenario_readme=scenario_readme,
        user_message=user_message,
        skills_invoked=skills_invoked,
        text_response=text_response,
        file_changes_summary=file_changes_summary,
        tool_calls=tool_calls,
        before_state=before_state,
    )
    return prefix + suffix


def render_prompt_parts(
    *,
    rubric: Rubric,
    judge_context: list[str],
    scenario_readme: str,
    user_message: str,
    skills_invoked: list[str],
    text_response: str,
    file_changes_summary: str,
    tool_calls: list[dict[str, Any]],
    before_state: str = "(none)",
) -> tuple[str, str]:
    """Render the prompt as (stable_prefix, varying_suffix).

    Stable prefix: system preamble + skill rubric. Identical across all
    tests for a single skill, so caching it as one block lets the
    Anthropic prompt cache hit on the second + subsequent tests in a
    batched skill run (spec §11 targets 50%+ judge cache hits at N=1).

    Varying suffix: per-test context, scenario, user message, skill
    output, tool calls. Naturally cache-cold.
    """
    if rubric.dimensions:
        rubric_text = rubric.raw
    else:
        rubric_text = "(none — base dimensions only)"
    ctx_block = (
        "\n".join(f"- {c}" for c in judge_context)
        if judge_context
        else "(none)"
    )
    skills_text = ", ".join(skills_invoked) if skills_invoked else "(none)"
    tool_calls_text = _render_tool_calls_with_size_guard(tool_calls)

    stable_slots = {
        "rubric": rubric_text,
    }
    varying_slots = {
        "judge_context": ctx_block,
        "before_state": before_state or "(none)",
        "scenario_readme": scenario_readme or "(stateless test)",
        "user_message": user_message,
        "skills_invoked": skills_text,
        "text_response": text_response or "(empty)",
        "file_changes_summary": file_changes_summary or "(no file changes)",
        "tool_calls": tool_calls_text,
    }

    template = judge_prompt_template()
    # The template has a clear boundary after the rubric section, before
    # the first per-test slot — see judge/prompt.md. Split there so the
    # stable prefix can be cached.
    #
    # This marker must name the first heading whose section contains a
    # VARYING slot, and nothing above it may contain one. Everything
    # before the marker is substituted from `stable_slots` ({rubric}
    # only) and everything after from `varying_slots`; an unmatched slot
    # is passed through verbatim by the `m.group(0)` fallback below. So a
    # marker set too late silently ships a prompt containing the literal
    # text "{user_message}" and puts cache_control on per-test content.
    # It was "# Per-test context" until that section moved down beside
    # "How to report" (#1403), which left "# Before-state" first.
    # Pinned by test_render_prompt_parts_splits_at_context_boundary and
    # test_render_prompt_parts_leaves_no_unsubstituted_slot.
    split_marker = "# Before-state"
    if split_marker not in template:
        # Defensive fallback: if the template structure changes, render
        # everything as one big varying slot. Loses caching but stays
        # correct.
        slots = {**stable_slots, **varying_slots}
        return "", _SLOT_RE.sub(
            lambda m: slots.get(m.group(1), m.group(0)), template
        )

    prefix_template, suffix_template = template.split(split_marker, 1)
    suffix_template = split_marker + suffix_template

    prefix = _SLOT_RE.sub(
        lambda m: stable_slots.get(m.group(1), m.group(0)),
        prefix_template,
    )
    suffix = _SLOT_RE.sub(
        lambda m: varying_slots.get(m.group(1), m.group(0)),
        suffix_template,
    )
    return prefix, suffix


_SLOT_RE = re.compile(r"\{([a-z_]+)\}")


# Total-prompt-size guard for the tool_calls slot. Even with per-response
# summarization, many calls × moderate sizes can blow past Haiku's context.
# Once the rendered tool_calls block exceeds this many characters, the
# harness drops oldest tool calls and appends a "_dropped_for_size" marker
# so reviewers can see truncation happened. ~50K chars ≈ ~12K tokens, well
# under Haiku's window even with the rest of the prompt.
_TOOL_CALLS_MAX_CHARS = 50_000


def _render_tool_calls_with_size_guard(tool_calls: list[dict[str, Any]]) -> str:
    """Render the tool_calls slot with a total-size cap.

    If the JSON rendering exceeds _TOOL_CALLS_MAX_CHARS, repeatedly drop
    the oldest call until under the cap, prepending a marker that records
    how many were dropped. Worst case (single call still too large), keep
    the most recent one and accept the overage.
    """
    if not tool_calls:
        return "(none)"

    def _render(calls: list[dict[str, Any]], dropped: int) -> str:
        body = json.dumps(
            [
                {
                    "tool": c["tool"],
                    "args": c["args"],
                    "expected_args": c.get("expected_args"),
                    "matched": c["matched"],
                    "response_summary": _summarize_response(c.get("response")),
                }
                for c in calls
            ],
            indent=2,
        )
        if dropped:
            return (
                f"(_dropped_for_size: {dropped} earliest tool calls "
                f"dropped to keep prompt under {_TOOL_CALLS_MAX_CHARS} chars)\n"
                + body
            )
        return body

    rendered = _render(tool_calls, 0)
    if len(rendered) <= _TOOL_CALLS_MAX_CHARS:
        return rendered

    calls = list(tool_calls)
    dropped = 0
    while len(calls) > 1 and len(rendered) > _TOOL_CALLS_MAX_CHARS:
        calls.pop(0)
        dropped += 1
        rendered = _render(calls, dropped)
    return rendered


def _grading_tool_for_rubric(rubric: Rubric) -> dict[str, Any]:
    """Build the submit_grading tool schema for one grading call.

    Constrains `name` to this rubric's known set — base dimensions union
    this skill's rubric dimension names — via a JSON-schema `enum`. This
    is UNENFORCED steering, not a guarantee: tool_use input is not
    validated against its schema without strict mode (see the comment on
    `_GRADING_DIM_KEYS` above), so the model can still emit a name outside
    the enum — Haiku draws do, routinely (#1361). It reduces how often
    that happens; the drop-with-warning behavior in `_extract_dimensions`
    is what actually guarantees a clean, schema-safe result.
    """
    valid_names = sorted(set(_REQUIRED_BASE_DIMENSIONS) | rubric.dimension_names())
    tool = copy.deepcopy(GRADING_TOOL)
    tool["input_schema"]["properties"]["dimensions"]["items"]["properties"]["name"] = {
        "type": "string",
        "enum": valid_names,
    }
    return tool


def grade(
    *,
    rubric: Rubric,
    judge_context: list[str],
    scenario_readme: str,
    user_message: str,
    skills_invoked: list[str],
    text_response: str,
    file_changes_summary: str,
    tool_calls: list[dict[str, Any]],
    auth: AuthConfig,
    model: str = DEFAULT_JUDGE_MODEL,
    before_state: str = "(none)",
) -> JudgeOutput:
    """Run the judge and return structured dimensions + cost."""
    prefix, suffix = render_prompt_parts(
        rubric=rubric,
        judge_context=judge_context,
        scenario_readme=scenario_readme,
        user_message=user_message,
        skills_invoked=skills_invoked,
        text_response=text_response,
        file_changes_summary=file_changes_summary,
        tool_calls=tool_calls,
        before_state=before_state,
    )

    client = _make_client(auth)
    grading_tool = _grading_tool_for_rubric(rubric)

    # Judge output is non-deterministic: the model occasionally emits a
    # malformed submit_grading call (dimensions not a list, >1 tool_use, or a
    # null on a non-nullable base dimension). Those are transient — a fresh
    # sample almost always parses — so re-sample the create+extract a few times
    # before giving up rather than failing the whole test on one bad draw.
    # (A max_tokens clip is NOT transient: re-sampling won't help, so surface
    # it immediately so the operator bumps the cap.)
    #
    # Only the first attempt is pinned to JUDGE_TEMPERATURE. Re-samples
    # deliberately fall back to default sampling: at temperature=0 a retry
    # re-decodes the identical prompt to the identical malformed output, so
    # pinning every attempt would collapse this recovery loop into three copies
    # of one bad draw. Pinned when it can be, sampled when it has to be.
    last_parse_error: JudgeError | None = None
    for attempt in range(3):
        response = _create_message_with_retry(
            client=client,
            model=model,
            prefix=prefix,
            suffix=suffix,
            grading_tool=grading_tool,
            temperature=JUDGE_TEMPERATURE if attempt == 0 else None,
        )
        if response.stop_reason == "max_tokens":
            raise JudgeError(
                "judge response hit max_tokens — tool_use input was clipped. "
                "Bump max_tokens (currently 4096) or shorten rubric/criteria."
            )
        try:
            dimensions, extraction_warnings = _extract_dimensions(
                response, rubric, tool_calls=tool_calls
            )
            break
        except JudgeError as e:
            last_parse_error = e
            continue
    else:
        raise last_parse_error  # exhausted re-samples on malformed judge output

    cost = _compute_cost(response, model)
    usage = response.usage
    return JudgeOutput(
        dimensions=dimensions,
        warnings=extraction_warnings,
        cost_usd=cost,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        cached_input_tokens=(
            getattr(usage, "cache_read_input_tokens", 0) or 0
        ),
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        prompt_hash=judge_prompt_hash(),
    )


def _create_message_with_retry(
    *, client, model, prefix, suffix, grading_tool, temperature=None, _attempts=3
):
    """Call Anthropic with retry-with-backoff on transient errors.

    Wraps client.messages.create so a 529 overload or rate-limit response
    doesn't abort one test out of the suite. Returns the response on
    success; raises JudgeError after _attempts exhausted with the last
    error captured.

    Splits the prompt into a cacheable prefix (rubric, stable per skill)
    and a varying suffix (per-test content). cache_control: ephemeral on
    the prefix lets the second+ test in a batched skill run hit the
    Anthropic prompt cache (spec §11 targets 50%+ at N=1).

    `grading_tool` is the per-rubric submit_grading schema from
    `_grading_tool_for_rubric` — required, not defaulted to the module-level
    `GRADING_TOOL`, so a caller can't silently grade against the wrong
    rubric's enum steering.

    `temperature=None` omits the parameter entirely rather than sending the
    API's default value — the caller asks for default sampling without this
    module having to hardcode what that default currently is.
    """
    import time as _time

    sampling_kwargs: dict[str, Any] = {}
    if temperature is not None:
        sampling_kwargs["temperature"] = temperature

    delay = 1.0
    last_error: Exception | None = None
    for attempt in range(_attempts):
        try:
            return client.messages.create(
                model=model,
                max_tokens=4096,
                tools=[grading_tool],
                tool_choice={"type": "tool", "name": "submit_grading"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prefix,
                                "cache_control": {"type": "ephemeral"},
                            },
                            {"type": "text", "text": suffix},
                        ],
                    }
                ],
                **sampling_kwargs,
            )
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            last_error = e
            # Retry on 529 overload, 429 rate limit, or any connection
            # error. Other status codes (4xx auth/invalid) won't be fixed
            # by retrying — fail fast.
            status = getattr(e, "status_code", None)
            if status not in (429, 529) and not isinstance(
                e, anthropic.APIConnectionError
            ):
                raise JudgeError(f"judge API call failed: {e}") from e
            if attempt + 1 >= _attempts:
                break
            _time.sleep(delay)
            delay *= 2

    raise JudgeError(
        f"judge API call failed after {_attempts} attempts: {last_error}"
    )


def _make_client(auth: AuthConfig) -> anthropic.Anthropic:
    """Build the Anthropic SDK client.

    The judge always uses an API key — the Anthropic SDK has no
    subscription path. `auth.api_key` is set by `resolve_auth` whenever
    a key is available (regardless of skill_runner_mode); if it's None,
    the operator never configured one and the judge can't run.
    """
    if auth.api_key:
        return anthropic.Anthropic(api_key=auth.api_key)
    import os
    if os.environ.get("ANTHROPIC_API_KEY"):
        # Defensive — should be picked up by resolve_auth, but if the env
        # changed since the AuthConfig was built, use what's there.
        return anthropic.Anthropic()
    raise JudgeError(
        "The judge requires an Anthropic API key. Subscription auth "
        "alone is not enough for the judge layer. Set ANTHROPIC_API_KEY "
        "in eval/.env or in your shell."
    )


def _extract_dimensions(
    response, rubric: Rubric, *, tool_calls: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse and validate the judge's submit_grading tool_use.

    `rubric` supplies the authoritative set of valid `source: "rubric"`
    dimension names for this skill (#1361) — every call site already holds
    one (`grade()` takes it as a parameter), so this is a threading change,
    not new plumbing. `tool_calls` is the run's MCP call list, threaded the
    same way for the Tool Arguments N/A rule below (#1406).

    `tool_calls` is deliberately a REQUIRED keyword argument with no
    default. A default of `[]` would read as "this run made zero MCP tool
    calls" at every call site that had not been updated — silently firing
    the N/A coercion across the whole corpus, including the replay test
    that exists to measure it.

    Returns `(dimensions, warnings)`. Two different failure shapes here,
    by design (#1361):

    - **Structural garbage still raises JudgeError**, entering grade()'s
      3-attempt resample loop: a `source` outside {"base","rubric"}, or a
      non-string `name`. Both are unrecoverable downstream — a drifted
      `source` sails past every check below untouched and then fails
      run-log-schema validation at flush time (judge_dimension.source is
      `enum: ["base","rubric"]`, and judge_results is
      additionalProperties:false — docs/specs/schemas/run-log.schema.json),
      crashing the *entire* run log, not just this test; a non-string
      `name` would raise a bare (non-JudgeError) TypeError when hashed
      below, which escapes the resample loop entirely. Neither has been
      observed in the committed run-log corpus (see
      test_corpus_replay_never_raises_on_committed_run_logs) — this is a
      defensive floor, not a fix for something that fires in practice.
    - **An unknown rubric name or a repeated (source, name) pair is
      dropped, not raised.** A first cut of this fix raised JudgeError for
      both (#1361's literal AC1/AC3), and replaying it against every
      committed run log's real judge output showed why that is wrong: the
      judge re-types rubric headings from raw markdown and routinely
      truncates or re-cases them (e.g. `## Score discipline (advisory)` ->
      "Score discipline"), and on a handful of tests invents one every
      single run because the rubric has no matching heading at all. Since
      `_compute_outcome` fails a positive test outright whenever the judge
      layer never produced dimensions (`judge_skipped=True`), and the
      resample loop can't rescue a *prompt-correlated* mistake (attempt 0
      is temperature-pinned and the model repeats its own mistake),
      raising here would convert correct skill output into a recorded
      `fail`. Measured against the committed run-log corpus, resolving
      each run's rubric.md snapshot to the text actually in force at run
      time (a sha256 digest snapshot is resolved against git history, not
      assumed to match today's on-disk file): one test drops on every
      historical draw (research-plan's FAN-pivot test,
      ut_research_plan_007, 5/5) and 21 more drop on at least one draw (22
      tests total; see test_corpus_replay_never_raises_on_committed_run_logs).
      Dropping the offending entry and recording why in the returned warnings list
      (surfaced by the caller as `output.warnings` — see grade()) keeps
      the run gradable on its real dimensions while still surfacing the
      judge's naming failure for a human to read, rather than either
      silently accepting it (the pre-#1361 defect) or silently failing
      the skill for it (what a hard raise would do here).
    """
    tool_uses = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
    if len(tool_uses) != 1:
        raise JudgeError(
            f"expected exactly one submit_grading tool_use; got {len(tool_uses)}"
        )
    tu = tool_uses[0]
    if tu.name != "submit_grading":
        raise JudgeError(f"unexpected tool_use name: {tu.name}")
    dims = tu.input.get("dimensions", [])
    if not isinstance(dims, list):
        raise JudgeError("submit_grading.dimensions is not a list")

    # Project each dimension to the known field set. The grading-tool schema
    # is additionalProperties:False, but that is NOT enforced on tool_use
    # input without strict mode, so a model can emit extra fields — Sonnet 5
    # adds an `index` key to array items. The run-log schema
    # (additionalProperties:False on dimensions) then rejects the whole run
    # log, crashing the entire suite at flush time. Keep only the fields we
    # consume and persist so the judge is robust to any model's extras.
    dims = [
        {k: v for k, v in d.items() if k in _GRADING_DIM_KEYS}
        for d in dims
        if isinstance(d, dict)
    ]

    # Coerce string null markers to None — the model occasionally returns "N/A"
    # or "null" as a string despite the tool schema specifying {type: null}.
    _NULL_STRINGS = {"null", "n/a", "N/A", "na", "NA"}
    for d in dims:
        if isinstance(d.get("score"), str) and d["score"] in _NULL_STRINGS:
            d["score"] = None

    # Structural garbage: raise, don't drop-with-warning. See the
    # docstring's "Structural garbage still raises" note. Checked before
    # the duplicate pass below builds a (source, name) tuple key, so a
    # non-string name can't reach a hashing operation as a bare TypeError.
    for d in dims:
        source = d.get("source")
        if source not in ("base", "rubric"):
            raise JudgeError(
                f"judge emitted a dimension with invalid source {source!r}; "
                f"must be 'base' or 'rubric'"
            )
        name = d.get("name")
        if not isinstance(name, str):
            raise JudgeError(
                f"judge emitted a dimension with a non-string name {name!r} "
                f"(source={source!r})"
            )

    # Drop a duplicate (source, name) pair beyond its first occurrence,
    # recording a warning rather than failing the run (#1361). Keeping the
    # first occurrence and dropping the rest keeps the annotation join key
    # `(test_id, dimension_source, dimension_name)` unique without
    # discarding the whole run. Historically the paired scores always
    # agreed, but nothing guarantees that, so this no longer trusts
    # agreement — it always drops the repeat.
    warnings: list[dict[str, Any]] = []
    seen_dim_keys: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for d in dims:
        dim_key = (d["source"], d["name"])
        if dim_key in seen_dim_keys:
            warnings.append({
                "kind": "dropped_duplicate_dimension",
                "advisory": (
                    f"judge emitted dimension source={d['source']!r} "
                    f"name={d['name']!r} more than once in this run; kept "
                    "the first occurrence and dropped this one"
                ),
                "source": d["source"],
                "name": d["name"],
                # The dropped draw's own score/rationale, not the survivor's
                # — otherwise a dropped fail (score 1) or partial (score 2)
                # vanishes from judge_dimensions with no trace, and
                # orchestrator._compute_outcome's `scores = [d["score"] for
                # d in judge_dimensions]` can silently flip the outcome
                # (fail/partial -> a more lenient one) since the dropped
                # entry no longer contributes to that list (#1361 review).
                # `.get()`, not `[...]`: a dimension missing "score" or
                # "rationale" entirely is a separate, pre-existing gap this
                # warning must not crash on while recording it.
                "score": d.get("score"),
                "rationale": d.get("rationale"),
            })
            continue
        seen_dim_keys.add(dim_key)
        deduped.append(d)
    dims = deduped

    # Drop a source:"rubric" dimension name that isn't in the parsed
    # rubric.md, recording a warning rather than failing the run (#1361).
    # Invented names, a rubric sub-heading misread as a dimension, and a
    # truncated/re-cased variant of a real name (e.g. "Assertion Atomicity"
    # vs the real "Assertion atomicity") all land here. The comparison is
    # exact-string / case-sensitive by design and the name is never
    # normalized to its nearest real match — silently coercing it would
    # hide a judge that isn't following the rubric verbatim, which is
    # itself worth knowing even though it's no longer fatal.
    # `_grading_tool_for_rubric` narrows the model's tool-schema `name`
    # enum toward the valid set, but that's unenforced steering (tool_use
    # input isn't schema-validated without strict mode) — this drop is the
    # actual guarantee.
    # The same drop for an invented `source: "base"` name. The rubric pass
    # below only inspects source=="rubric", and the required-base check
    # further down only verifies the three ARE PRESENT — it never rejects a
    # fourth. So a judge that emits {"source": "base", "name":
    # "Thoroughness", "score": 1} sails through, and that 1 reaches
    # _compute_outcome's fail gate.
    #
    # This has never happened: across the committed corpus's 5418
    # base-sourced dimensions, zero carry a name outside the required three.
    # It is a floor, not a fix for something observed — added because the
    # asymmetry is not defensible once noticed, and because the invented-name
    # guarantee this module advertises was only ever true of rubric names.
    kept_base: list[dict[str, Any]] = []
    for d in dims:
        if d["source"] == "base" and d["name"] not in _REQUIRED_BASE_DIMENSIONS:
            warnings.append({
                "kind": "dropped_unknown_base_dimension",
                "advisory": (
                    f"judge emitted base dimension {d['name']!r}, which is not "
                    f"one of the required base dimensions; dropped it. Valid "
                    f"base dimensions: {sorted(_REQUIRED_BASE_DIMENSIONS)}"
                ),
                "name": d["name"],
                "valid_names": sorted(_REQUIRED_BASE_DIMENSIONS),
                "score": d.get("score"),
                "rationale": d.get("rationale"),
            })
            continue
        kept_base.append(d)
    dims = kept_base

    valid_rubric_names = rubric.dimension_names()
    kept: list[dict[str, Any]] = []
    for d in dims:
        if d["source"] == "rubric" and d["name"] not in valid_rubric_names:
            warnings.append({
                "kind": "dropped_unknown_rubric_dimension",
                "advisory": (
                    f"judge emitted rubric dimension {d['name']!r}, not "
                    f"found in the {rubric.skill!r} rubric; dropped it. "
                    f"Valid rubric dimensions: {sorted(valid_rubric_names)}"
                ),
                "name": d["name"],
                "valid_names": sorted(valid_rubric_names),
                # See the duplicate-warning dict above: preserve the
                # dropped draw's own score/rationale so a dropped fail/
                # partial can't silently disappear from the outcome
                # computation with no trace (#1361 review).
                "score": d.get("score"),
                "rationale": d.get("rationale"),
            })
            continue
        kept.append(d)
    dims = kept

    # Enforce the Tool Arguments N/A rule instead of asking for it (#1406).
    #
    # judge/prompt.md states it as an instruction: "the test made zero MCP
    # tool calls. Report `score: null`." The caller already knows the
    # answer — `grade()` takes `tool_calls` and renders it into the very
    # prompt that asks the question — so a run that made no MCP calls has
    # no arguments to grade and `null` is the only truthful value. The
    # judge ignores the rule some fraction of the time: measured over the
    # 43 search-records run logs that were ever in main's own tree, 4
    # entries scored an integer with zero tool calls (`ut_search_records_003`
    # in v1_2026-08-01_13-11-14 and v1_2026-08-06_01-03-04, `_005` in
    # v1_2026-06-23_07-06-12 and v1_2026-07-23_08-43-26).
    #
    # Coerce with a warning, never raise — the shape #1361 settled on. A
    # raise enters grade()'s 3-attempt resample loop, attempt 0 is
    # temperature-pinned so the model repeats a prompt-correlated mistake,
    # and a judge that never produces dimensions sets judge_skipped=True,
    # which _compute_outcome turns into a hard `fail`. Coerce rather than
    # drop, because annotations key on (test_id, dimension_source,
    # dimension_name) and dropping the entry would fork that join key.
    #
    # KNOWN CONSEQUENCE, deliberate: _compute_outcome has two `1 in scores`
    # gates — orchestrator.py's positive-test gate, and the out-of-scope
    # negative gate for `correct_skill: []` tests, where the judge's base
    # dimensions are the only outcome signal. Coercing a 1 to null on
    # either shape turns a recorded `fail` into `pass`. That is intended:
    # a Tool Arguments score on a run with no tool calls grades something
    # that does not exist, and "the skill did work it should not have" or
    # "a required action never happened" belong on Correctness/Completeness
    # per prompt.md's negative-test and Correctness sections.
    #
    # It applies to a 2 as well as a 1, so it can also turn `partial` into
    # `pass` via _compute_outcome's `if 2 in scores` gate. Same reasoning,
    # same intent — there is nothing to deduct for on a run with no tool
    # calls, at any band. Pinned by
    # test_na_rule_coercion_flips_a_positive_test_outcome,
    # test_na_rule_coercion_flips_a_positive_test_from_partial and
    # test_na_rule_coercion_flips_an_out_of_scope_negative_outcome.
    if not tool_calls:
        for d in dims:
            if (
                d.get("source") == "base"
                and d.get("name") == "Tool Arguments"
                and d.get("score") is not None
            ):
                warnings.append({
                    "kind": "coerced_tool_arguments_to_na",
                    "advisory": (
                        f"judge scored Tool Arguments {d['score']!r} on a run "
                        f"that made zero MCP tool calls; coerced to null per "
                        f"the N/A rule in judge/prompt.md"
                    ),
                    "name": d["name"],
                    # The score the judge tried to emit, and its reasoning —
                    # preserved for the same reason #1361 preserves a dropped
                    # dimension's: a silently-vanished 1 or 2 is exactly what
                    # makes this class of defect untrendable.
                    "score": d.get("score"),
                    "rationale": d.get("rationale"),
                })
                # Rewrite the rationale too, following
                # orchestrator.apply_deterministic_deference — the established
                # pattern here for overriding a judge score after the fact.
                # A null score sitting next to a rationale still arguing about
                # specific tool arguments reads as a harness bug to whoever
                # opens the run log, and the CRUD UI never surfaces
                # output.warnings, so the annotator correcting this dimension
                # would otherwise see only the stale text.
                orig = d.get("rationale") or ""
                d["rationale"] = (
                    f"[coerced-to-na] the run made zero MCP tool calls, so "
                    f"Tool Arguments is N/A; the judge's {d['score']!r} was "
                    f"coerced to null. Original judge rationale: {orig}"
                )
                d["score"] = None

    # Enforce per-base-dimension null policy. The grading-tool schema
    # accepts null on every score; that flexibility exists for Tool
    # Arguments. We reject null on Correctness/Completeness here so the
    # judge can't silently skip a substantive base dimension. The
    # rubric-name-drop pass above never touches a base dimension (it only
    # inspects source=="rubric"), but a duplicate base dimension IS a drop
    # candidate in the dedup pass, and that changes behavior relative to
    # main: main's base_by_name dict comprehension (below) silently kept
    # whichever duplicate came LAST; the dedup pass above now keeps the
    # FIRST and drops the rest with a warning instead. Deliberate, pinned
    # by test_extract_dimensions_drops_duplicate_base_dimension — not an
    # oversight, and not a no-op relative to pre-#1361 behavior.
    base_by_name = {
        d.get("name"): d for d in dims if d.get("source") == "base"
    }
    for name in _REQUIRED_BASE_DIMENSIONS:
        d = base_by_name.get(name)
        if d is None:
            raise JudgeError(f"judge omitted required base dimension: {name}")
        if d.get("score") is None and name not in _NULLABLE_BASE_DIMENSIONS:
            raise JudgeError(
                f"base dimension '{name}' returned null score; only "
                f"{_NULLABLE_BASE_DIMENSIONS} may be null (N/A)"
            )
    return dims, warnings


def _compute_cost(response, model: str) -> float:
    pricing = JUDGE_PRICING.get(model)
    if not pricing:
        # Unknown model — warn once per model so the operator can update
        # JUDGE_PRICING. Fall back to the conservative default rather than
        # zero so suite totals don't silently understate cost.
        import sys
        if model not in _warned_about_pricing:
            _warned_about_pricing.add(model)
            print(
                f"WARNING: judge model {model!r} is not in JUDGE_PRICING; "
                f"falling back to conservative default rates. Cost figures "
                f"are approximate. Add {model!r} to harness/judge.py "
                f"JUDGE_PRICING to make them exact.",
                file=sys.stderr,
            )
        pricing = _FALLBACK_PRICING
    usage = response.usage
    inp = getattr(usage, "input_tokens", 0) or 0
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    out = getattr(usage, "output_tokens", 0) or 0
    return (
        (inp - cached) * pricing["input"] / 1_000_000
        + cached * pricing["cached_input"] / 1_000_000
        + out * pricing["output"] / 1_000_000
    )
