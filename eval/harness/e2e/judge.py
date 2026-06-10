"""Run the e2e judge against (research_question, expected_findings, final_tree).

Uses the Anthropic SDK directly — the judge is a one-shot
classification call, not an agentic flow.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import anthropic


DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_MAX_TOKENS = 4096


def _load_prompt_template() -> str:
    return (Path(__file__).parent / "judge_prompt.md").read_text(encoding="utf-8")


def _render_prompt(
    *,
    research_question: str,
    expected_findings: dict[str, Any],
    final_tree: dict[str, Any] | None,
) -> str:
    template = _load_prompt_template()
    return (
        template
        .replace("{{RESEARCH_QUESTION}}", research_question)
        .replace("{{EXPECTED_FINDINGS}}", json.dumps(expected_findings, indent=2))
        .replace("{{FINAL_TREE}}", json.dumps(final_tree or {}, indent=2))
    )


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort: grab the first JSON object from the model's output.

    The prompt instructs the model to emit only JSON, but real models
    occasionally wrap it in a fence or preface it with prose. Strip a
    code-fence if present, then find the outermost {...}.
    """
    cleaned = text.strip()
    fence = re.match(r"```(?:json)?\s*\n(.*?)\n```\s*$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # Fall back: scan for the first balanced {...} span.
    start = cleaned.find("{")
    if start == -1:
        raise ValueError("judge returned no JSON object")
    depth = 0
    for i in range(start, len(cleaned)):
        c = cleaned[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return json.loads(cleaned[start : i + 1])
    raise ValueError("judge returned unbalanced JSON")


def run_judge(
    *,
    research_question: str,
    expected_findings: dict[str, Any],
    final_tree: dict[str, Any] | None,
    model: str = DEFAULT_JUDGE_MODEL,
    client: anthropic.Anthropic | None = None,
) -> dict[str, Any]:
    """Call the judge model and return structured grading output."""
    prompt = _render_prompt(
        research_question=research_question,
        expected_findings=expected_findings,
        final_tree=final_tree,
    )
    client = client or anthropic.Anthropic()
    msg = client.messages.create(
        model=model,
        max_tokens=DEFAULT_MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(
        block.text for block in msg.content if getattr(block, "type", None) == "text"
    )
    return _extract_json(text)
