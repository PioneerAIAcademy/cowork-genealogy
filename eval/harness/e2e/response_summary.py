"""Decode a committed run log's `tool_calls[].response_summary`.

Two readers need the same thing: the JSON document inside a `response_summary`,
whichever of the two committed envelopes it arrived in. `ranked_read_report.py`
had the only copy (`_unwrap`); `advisory_report.py` reads the same field, so the
decoder lives here and both import it rather than keeping two copies that can
drift apart.
"""

from __future__ import annotations

import json
from typing import Any

# The per-string truncation suffix `_summarize_response` (harness/judge.py)
# appends when a captured string runs long. A `validation.warnings` note sits at
# the END of a research_append/research_log_append response, so a summary cut
# before it loses the note entirely — which is `not-observable`, distinct from a
# note that never fired. The two search notes sit before `results` and survive.
TRUNCATION_MARKER = "[truncated by harness"


def unwrap(summary: str) -> dict | None:
    """The document inside a `response_summary`, or None.

    Handles both committed envelopes: `[{...document...}]` (what a tool
    returning structured content produces) and `[{"type": "text", "text":
    "{...}"}]` (what `research_log_append` produces). Descends at most two
    levels so a malformed capture cannot loop.
    """
    try:
        value: Any = json.loads(summary)
    except (TypeError, ValueError):
        return None
    for _ in range(3):
        if isinstance(value, list):
            value = value[0] if value else None
            continue
        if isinstance(value, dict):
            text = value.get("text")
            if value.get("type") == "text" and isinstance(text, str):
                try:
                    value = json.loads(text)
                except ValueError:
                    return None
                continue
            return value
        return None
    return value if isinstance(value, dict) else None
