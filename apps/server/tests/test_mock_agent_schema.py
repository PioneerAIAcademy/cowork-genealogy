"""The mock agent's `research.json` validates against research.schema.json.

The mock is what every local dev and every demo session sees, and it hand-writes
the document rather than going through the writer tools — so nothing was
checking it. Both emitted states were invalid when this test was written: the
init document omitted the required `evaluations`, and the post-search document
carried `performed: "2026-06-06"` against an `iso_datetime` pattern that
requires a full timestamp. The engine validator would not have caught the
second one either — it pattern-checks only the `iso_date` fields it lists.

Both states matter. `_simulate_search` re-reads from disk and appends, so a
document can be valid at init and invalid one turn later.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from app.agent.mock_agent import MockAgent

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = REPO_ROOT / "docs" / "specs" / "schemas"


def _validator() -> Draft202012Validator:
    """research.schema.json with its enums.schema.json $refs resolvable.

    Same wiring as eval/harness/harness/schema_validator.py.
    """
    enums = json.loads((SCHEMAS / "enums.schema.json").read_text(encoding="utf-8"))
    registry = Registry().with_resource(
        uri="enums.schema.json",
        resource=Resource.from_contents(enums),
    )
    schema = json.loads((SCHEMAS / "research.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=registry)


def _errors(doc: dict) -> list[str]:
    return [
        f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}"
        for e in sorted(_validator().iter_errors(doc), key=lambda e: list(e.path))
    ]


async def _turn(agent: MockAgent, text: str) -> None:
    async for _ in agent.handle_turn(text):
        pass


@pytest.mark.asyncio
async def test_mock_agent_documents_validate(tmp_path: Path) -> None:
    agent = MockAgent(tmp_path)

    # Drive the scripted interview: greet → experience → subscriptions →
    # objective, which is the turn that writes research.json.
    await _turn(agent, "hello")
    await _turn(agent, "intermediate")
    await _turn(agent, "Ancestry")
    await _turn(agent, "Identify the parents of Patrick Flynn")

    research = tmp_path / "research.json"
    assert research.exists(), "the objective turn wrote no research.json"

    init_doc = json.loads(research.read_text(encoding="utf-8"))
    assert _errors(init_doc) == [], "init document is invalid"

    await _turn(agent, "search records")

    post_doc = json.loads(research.read_text(encoding="utf-8"))
    assert post_doc["log"], "the search turn appended no log entry — test is vacuous"
    assert _errors(post_doc) == [], "post-search document is invalid"
