"""Run the e2e judge against (research_question, expected_findings, final_tree, final_research).

Uses the Anthropic SDK directly — the judge is a one-shot
classification call, not an agentic flow. Grading the semantic
equivalence of persons / dates / places is the core judgment, so the
default judge model is Opus; a fixture may override it via
fixture.json::model.judge (cheaper models for a future sweep).

The judge grades **two distinct axes** (see docs/specs/e2e-test-spec.md §7):

1. **Recall** — did the agent recover the stripped findings? Graded from
   `final_tree` only (the tree is the deliverable). This is the
   **verdict** (`pass` / `partial` / `fail`): objective, reproducible,
   what the roll-up reports.
2. **Proof quality** — is the agent's GPS proof statement sound? Graded
   from `final_research.proof_summaries`. This is an **advisory score**
   (1–3, or null when no proof summary exists). It NEVER gates the
   verdict — a recall-perfect run with a weak proof statement still
   `pass`es, it just carries a low `proof_quality`. Recall is the
   objective axis; proof quality is the subjective one, so we don't let
   the shakier signal flip the firmer one.

The judge is forced to emit JSON conforming to JUDGE_OUTPUT_SCHEMA via
the Messages API's structured-output format. The parsed object is then
validated against the required keys and fails loud on violation — there
is no silent best-effort fallback, because a malformed verdict that
"parses" is worse than a visible harness error.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import anthropic


DEFAULT_JUDGE_MODEL = "claude-opus-4-8"
DEFAULT_MAX_TOKENS = 4096


class JudgeOutputError(ValueError):
    """The judge returned output that does not satisfy the contract."""


# Structured-output schema the judge model is constrained to. Mirrors the
# shape documented in judge_prompt.md and e2e-test-spec.md §7.2. Note: the
# Messages API structured-output subset does not support numeric bounds
# (minimum/maximum), so the recall floats are shape/type-checked only, not
# range-checked — the verdict (not the recall fraction) is what the harness
# keys off, so an out-of-range recall is informational, not load-bearing.
JUDGE_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "per_finding": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "finding_id": {"type": "string"},
                    "matched": {"type": "string", "enum": ["true", "partial", "false"]},
                    "agent_evidence": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": ["finding_id", "matched", "agent_evidence", "notes"],
            },
        },
        "recall_required": {"type": "number"},
        "recall_total": {"type": "number"},
        "verdict": {"type": "string", "enum": ["pass", "partial", "fail"]},
        "rationale": {"type": "string"},
        # Advisory proof-quality axis — graded from final_research's proof
        # statement, NOT from the tree. Never gates `verdict`. `score` is
        # null when the agent wrote no proof summary to grade.
        "proof_quality": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "score": {"type": ["integer", "null"], "enum": [1, 2, 3, None]},
                "exhaustiveness": {"type": "string", "enum": ["yes", "partial", "no", "na"]},
                "conflicts_addressed": {"type": "string", "enum": ["yes", "partial", "no", "na"]},
                "corroboration": {"type": "string", "enum": ["independent", "single_source", "na"]},
                "tier_appropriate": {"type": "string", "enum": ["yes", "no", "na"]},
                "rationale": {"type": "string"},
            },
            "required": [
                "score",
                "exhaustiveness",
                "conflicts_addressed",
                "corroboration",
                "tier_appropriate",
                "rationale",
            ],
        },
    },
    "required": [
        "per_finding",
        "recall_required",
        "recall_total",
        "verdict",
        "rationale",
        "proof_quality",
    ],
}

# The top-level keys every judge response must carry. Belt-and-suspenders
# alongside the structured-output schema: if a future SDK/model path ever
# returns text that bypasses schema enforcement, this catches it loudly.
_REQUIRED_KEYS = frozenset(JUDGE_OUTPUT_SCHEMA["required"])


def _load_prompt_template() -> str:
    return (Path(__file__).parent / "judge_prompt.md").read_text(encoding="utf-8")


def _proof_summaries(final_research: dict[str, Any] | None) -> list[Any]:
    """The proof statements to grade for proof quality.

    Only `proof_summaries` is relevant — that's where GPS conclusions
    live (research-schema-spec.md §5.11). We don't feed the whole
    research.json (it's large and mostly irrelevant to grading the
    written proof).
    """
    if not final_research:
        return []
    return final_research.get("proof_summaries") or []


def _render_prompt(
    *,
    research_question: str,
    expected_findings: dict[str, Any],
    final_tree: dict[str, Any] | None,
    final_research: dict[str, Any] | None,
) -> str:
    template = _load_prompt_template()
    return (
        template
        .replace("{{RESEARCH_QUESTION}}", research_question)
        .replace("{{EXPECTED_FINDINGS}}", json.dumps(expected_findings, indent=2))
        .replace("{{FINAL_TREE}}", json.dumps(final_tree or {}, indent=2))
        .replace(
            "{{PROOF_SUMMARIES}}",
            json.dumps(_proof_summaries(final_research), indent=2),
        )
    )


def _validate_judge_output(parsed: Any) -> dict[str, Any]:
    """Validate the parsed judge object against the contract; fail loud.

    Structured output already constrains the model to JUDGE_OUTPUT_SCHEMA,
    so this is a second gate, not the primary one — but a malformed verdict
    that silently "parses" is worse than a visible error, so any violation
    raises JudgeOutputError rather than being coerced.
    """
    if not isinstance(parsed, dict):
        raise JudgeOutputError(
            f"judge output is {type(parsed).__name__}, expected a JSON object"
        )
    missing = _REQUIRED_KEYS - parsed.keys()
    if missing:
        raise JudgeOutputError(
            f"judge output missing required keys: {sorted(missing)}"
        )
    if parsed["verdict"] not in {"pass", "partial", "fail"}:
        raise JudgeOutputError(
            f"judge verdict {parsed['verdict']!r} is not pass/partial/fail"
        )
    if not isinstance(parsed["per_finding"], list):
        raise JudgeOutputError("judge output 'per_finding' is not a list")
    pq = parsed["proof_quality"]
    if not isinstance(pq, dict) or "score" not in pq:
        raise JudgeOutputError("judge output 'proof_quality' missing or malformed")
    if pq["score"] not in (1, 2, 3, None):
        raise JudgeOutputError(
            f"proof_quality.score {pq['score']!r} is not 1/2/3/null"
        )
    return parsed


def run_judge(
    *,
    research_question: str,
    expected_findings: dict[str, Any],
    final_tree: dict[str, Any] | None,
    final_research: dict[str, Any] | None = None,
    model: str = DEFAULT_JUDGE_MODEL,
    client: anthropic.Anthropic | None = None,
) -> dict[str, Any]:
    """Call the judge model and return validated structured grading output.

    Grades recall from `final_tree` (the verdict) and proof quality from
    `final_research`'s proof summaries (an advisory score that never gates
    the verdict). The model is constrained to JUDGE_OUTPUT_SCHEMA via the
    Messages API structured-output format, so the first text block is valid
    JSON conforming to the schema. We still validate the required keys and
    raise JudgeOutputError on any violation — no silent fallback.
    """
    prompt = _render_prompt(
        research_question=research_question,
        expected_findings=expected_findings,
        final_tree=final_tree,
        final_research=final_research,
    )
    client = client or anthropic.Anthropic()
    msg = client.messages.create(
        model=model,
        max_tokens=DEFAULT_MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
        output_config={
            "format": {
                "type": "json_schema",
                "schema": JUDGE_OUTPUT_SCHEMA,
            }
        },
    )
    text = "".join(
        block.text for block in msg.content if getattr(block, "type", None) == "text"
    )
    if not text.strip():
        raise JudgeOutputError(
            f"judge returned no text content (stop_reason={msg.stop_reason!r})"
        )
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        # Structured output guarantees valid JSON; reaching here means the
        # API contract changed or the response was truncated (max_tokens).
        raise JudgeOutputError(
            f"judge output was not valid JSON (stop_reason={msg.stop_reason!r}): {e}"
        ) from e
    return _validate_judge_output(parsed)
