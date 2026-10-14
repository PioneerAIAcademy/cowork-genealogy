"""Agent-specific validators for the image-reader agent.

image-reader wraps ONE `image_transcribe` call and returns text. When the call
throws, its body requires `NOT READ: <imageId>` and the exact error, quoted, so
the caller can act on it. The hard image cap (#3010) is the throw whose text
carries the caller's next steps — log the browse partial, move to other routes,
name the unfinished browse with its link — and image-reader holds none of the
tools to do them itself, so relaying the text is the whole job.

The expected text is read from the fixture, which
`packages/engine/mcp-server/tests/packaging/image-cap-fixture.test.ts` pins to
the refusal `browse-budget.ts` throws.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

CAP_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "fixtures" / "mcp" / "image-transcribe-cap-reached.json"
)


def _cap_fixture() -> dict:
    return json.loads(CAP_FIXTURE.read_text(encoding="utf-8"))


def test_cap_refusal_relayed_to_the_caller(tool_calls, text_response, test, agent_returns=None):
    """On a refused read the agent returns NOT READ, the refused image's link and
    the refusal's instructions to the caller, makes one call, and invents no page."""
    from harness.skill_runner import subject_reply_text

    if "cap-refusal" not in test.get("tags", []):
        pytest.skip("not an image-cap refusal test")
    fixture = _cap_fixture()
    image_id = fixture["args"]["imageId"]
    error = fixture["response"]["error"]
    link = re.search(r"https://\S+?(?=\))", error).group(0)

    calls = [c for c in (tool_calls or []) if c.get("tool", "").endswith("image_transcribe")]
    assert len(calls) == 1, f"expected exactly one image_transcribe call, got {len(calls)}"

    reply = subject_reply_text(agent_returns, text_response, test.get("skill") or "", test)
    assert f"NOT READ: {image_id}" in reply, "the return lacks the NOT READ line for the refused image"
    assert "Image cap reached" in reply, "the return does not quote the cap refusal"
    assert link in reply, f"the return drops the refused image's link {link}"
    for instruction in ("research_log_append", "partial", "final summary"):
        assert instruction in reply, (
            f"the return drops the refusal's '{instruction}' instruction, which only the caller can carry out"
        )
    for label in ("**Transcription:**", "**Extracted facts:**"):
        assert label not in reply, f"the return presents a {label} section for an image that was never read"
