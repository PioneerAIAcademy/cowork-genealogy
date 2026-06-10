"""LLM judge — grades skill output against the base + skill + per-test rubric.

Uses the Anthropic SDK directly (not the Claude Agent SDK) so we have tight
control over the tool_use schema. Forced `submit_grading` tool_use produces
structured output without prose-parsing brittleness.

Pricing for cost accounting is centralized in harness.judge.JUDGE_PRICING so
the rates can be edited in one place when Anthropic updates them.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import anthropic

from harness.auth import AuthConfig
from harness.rubric import Rubric


HARNESS_DIR = Path(__file__).resolve().parents[1]
JUDGE_PROMPT_PATH = HARNESS_DIR / "judge" / "prompt.md"

DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"
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


@lru_cache(maxsize=1)
def judge_prompt_template() -> str:
    return JUDGE_PROMPT_PATH.read_text(encoding="utf-8")


def judge_prompt_hash() -> str:
    return hashlib.sha256(judge_prompt_template().encode("utf-8")).hexdigest()


_RESPONSE_STRING_MAX = 2000
_RESPONSE_ARRAY_SAMPLE = 3
_RESPONSE_MAX_DEPTH = 8  # guard against pathological nested responses


def _summarize_response(response: Any, _depth: int = 0) -> Any:
    """Produce a tight summary of a tool response for the judge prompt.

    Full responses can be thousands of tokens of census data. We bound the
    prompt size while preserving enough context for the judge to grade
    tool-usage quality.

    - dicts: keep keys; recurse on values
    - lists: keep length + first N items (recursed), with an explicit
      "_summary_truncated" marker so the judge doesn't mistake the
      summary for the actual response
    - strings: truncate to _RESPONSE_STRING_MAX with an explicit
      "[truncated by harness for prompt size; full length N chars]" suffix
    - everything else: passed through
    - depth cap: at _RESPONSE_MAX_DEPTH, replace nested content with a
      "_truncated_for_depth" marker so a fixture that recurses cannot
      hang the judge call
    """
    if _depth >= _RESPONSE_MAX_DEPTH:
        return {"_truncated_for_depth": True, "_max_depth": _RESPONSE_MAX_DEPTH}
    if response is None:
        return None
    if isinstance(response, dict):
        return {
            k: _summarize_response(v, _depth + 1) for k, v in response.items()
        }
    if isinstance(response, list):
        if len(response) <= _RESPONSE_ARRAY_SAMPLE:
            return [_summarize_response(x, _depth + 1) for x in response]
        sample = [
            _summarize_response(x, _depth + 1)
            for x in response[:_RESPONSE_ARRAY_SAMPLE]
        ]
        return {
            "_summary_truncated": True,
            "_full_length": len(response),
            "_first_n": sample,
        }
    if isinstance(response, str) and len(response) > _RESPONSE_STRING_MAX:
        full_len = len(response)
        return (
            response[:_RESPONSE_STRING_MAX]
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
        "scenario_readme": scenario_readme or "(stateless test)",
        "user_message": user_message,
        "skills_invoked": skills_text,
        "text_response": text_response or "(empty)",
        "file_changes_summary": file_changes_summary or "(no file changes)",
        "tool_calls": tool_calls_text,
    }

    template = judge_prompt_template()
    # The template has a clear boundary after the rubric section, before
    # the per-test context — see judge/prompt.md. Split there so the
    # stable prefix can be cached.
    split_marker = "# Per-test context"
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
    )

    client = _make_client(auth)
    response = _create_message_with_retry(
        client=client,
        model=model,
        prefix=prefix,
        suffix=suffix,
    )

    # If max_tokens clipped the response, the tool_use input may be a
    # truncated JSON fragment — _extract_dimensions will then fail with a
    # confusing parse-style error. Surface the truncation directly so the
    # operator knows to bump max_tokens (or shorten dimensions).
    if response.stop_reason == "max_tokens":
        raise JudgeError(
            "judge response hit max_tokens — tool_use input was clipped. "
            "Bump max_tokens (currently 4096) or shorten rubric/criteria."
        )

    dimensions = _extract_dimensions(response)
    cost = _compute_cost(response, model)
    usage = response.usage
    return JudgeOutput(
        dimensions=dimensions,
        cost_usd=cost,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        cached_input_tokens=(
            getattr(usage, "cache_read_input_tokens", 0) or 0
        ),
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        prompt_hash=judge_prompt_hash(),
    )


def _create_message_with_retry(*, client, model, prefix, suffix, _attempts=3):
    """Call Anthropic with retry-with-backoff on transient errors.

    Wraps client.messages.create so a 529 overload or rate-limit response
    doesn't abort one test out of the suite. Returns the response on
    success; raises JudgeError after _attempts exhausted with the last
    error captured.

    Splits the prompt into a cacheable prefix (rubric, stable per skill)
    and a varying suffix (per-test content). cache_control: ephemeral on
    the prefix lets the second+ test in a batched skill run hit the
    Anthropic prompt cache (spec §11 targets 50%+ at N=1).
    """
    import time as _time

    delay = 1.0
    last_error: Exception | None = None
    for attempt in range(_attempts):
        try:
            return client.messages.create(
                model=model,
                max_tokens=4096,
                tools=[GRADING_TOOL],
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


def _extract_dimensions(response) -> list[dict[str, Any]]:
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

    # Enforce per-base-dimension null policy. The grading-tool schema
    # accepts null on every score; that flexibility exists for Tool
    # Arguments. We reject null on Correctness/Completeness here so the
    # judge can't silently skip a substantive base dimension.
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
    return dims


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
