"""The mock agent's emitted documents validate against their JSON Schemas.

The mock is what every local dev and every demo session sees, and it hand-writes
both documents rather than going through the writer tools — so nothing was
checking either. Both `research.json` states were invalid when this test was
written: the init document omitted the required `evaluations`, and the
post-search document carried `performed: "2026-06-06"` against an `iso_datetime`
pattern that requires a full timestamp. The engine validator would not have
caught the second one either — it pattern-checks only the `iso_date` fields it
lists.

`tree.gedcomx.json` is checked for the same reason: `_init_project` writes it
from an inline literal, and every `$def` in tree-gedcomx.schema.json (and its
root) is `additionalProperties: false`, so one invented key makes a document
every engine writer tool refuses to touch.

Both research states matter. `_simulate_search` re-reads from disk and appends,
so a document can be valid at init and invalid one turn later.
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


def _registry() -> Registry:
    """Holds enums.schema.json so the $refs in BOTH schemas resolve.

    Same wiring as eval/harness/harness/schema_validator.py — and shared for
    the same reason: tree-gedcomx.schema.json $refs `gender` and the three
    `*_recommended` enums out of that file, so a validator built without the
    registry raises an unresolvable-reference error rather than validating.
    """
    enums = json.loads((SCHEMAS / "enums.schema.json").read_text(encoding="utf-8"))
    return Registry().with_resource(
        uri="enums.schema.json",
        resource=Resource.from_contents(enums),
    )


def _validator() -> Draft202012Validator:
    schema = json.loads((SCHEMAS / "research.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=_registry())


def _tree_validator() -> Draft202012Validator:
    schema = json.loads((SCHEMAS / "tree-gedcomx.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=_registry())


def _errors(doc: dict, validator: Draft202012Validator | None = None) -> list[str]:
    validator = validator or _validator()
    return [
        f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}"
        for e in sorted(validator.iter_errors(doc), key=lambda e: list(e.path))
    ]


async def _turn(agent: MockAgent, text: str) -> None:
    async for _ in agent.handle_turn(text):
        pass


@pytest.mark.asyncio
async def test_mock_agent_documents_validate(tmp_path: Path) -> None:
    agent = MockAgent(tmp_path)

    # Drive the scripted onboarding: greet → objective, which is the turn that
    # writes research.json. There is deliberately no experience turn and no
    # access turn — the real skill asks nothing about the researcher, and this
    # mock stands in for production.
    await _turn(agent, "hello")
    await _turn(agent, "Identify the parents of Patrick Flynn")

    research = tmp_path / "research.json"
    assert research.exists(), "the objective turn wrote no research.json"

    init_doc = json.loads(research.read_text(encoding="utf-8"))
    assert _errors(init_doc) == [], "init document is invalid"

    # Schema-validity alone cannot catch a regression here: absent, `[]` and
    # `["none"]` are all valid, so the guard has to be on absence specifically.
    # `["none"]` asserts the researcher told us they have nothing, the opposite
    # of the current assumption that access is available.
    profile = init_doc["researcher_profile"]
    assert "subscriptions" not in profile, (
        "researcher_profile.subscriptions must be ABSENT — site access is no "
        "longer asked, so nothing may default it. Got: "
        f"{profile.get('subscriptions')!r}"
    )

    tree = tmp_path / "tree.gedcomx.json"
    assert tree.exists(), "the objective turn wrote no tree.gedcomx.json"
    tree_doc = json.loads(tree.read_text(encoding="utf-8"))
    assert tree_doc["persons"], "the mock tree has no persons — test is vacuous"
    assert _errors(tree_doc, _tree_validator()) == [], "tree.gedcomx.json is invalid"

    await _turn(agent, "search records")

    post_doc = json.loads(research.read_text(encoding="utf-8"))
    assert post_doc["log"], "the search turn appended no log entry — test is vacuous"
    assert _errors(post_doc) == [], "post-search document is invalid"


# --- Ids must stay unique on a PRE-SEEDED project -----------------------------
#
# Found in a browser, not here: open the sample project on `make server-mock`, send one
# message, and React logs "Encountered two children with the same key, src_002" — and
# warns the rows "may be duplicated and/or omitted", so the viewer can silently drop a
# real one. The cause was `_load_state` returning a hardcoded `log_seq: 1` for a seeded
# project, so the first turn minted ids the sample already contained.

SEED_SAMPLE = REPO_ROOT / "apps" / "server" / "app" / "seed" / "sample_project" / "research.json"


def _seed_into(dir_: Path) -> None:
    """Copy the shipped sample project in, which is what `Open a sample project` does."""
    (dir_ / "research.json").write_text(SEED_SAMPLE.read_text(encoding="utf-8"), encoding="utf-8")


def test_the_seeded_counter_clears_every_id_family_not_just_the_log(tmp_path: Path) -> None:
    """The sample holds 7 log entries, 5 sources and 15 assertions.

    One counter mints all three (`log_{seq}`, `src_{seq}`, `a_{seq}` from the SAME seq),
    so clearing the log's 7 is not enough — `a_008` through `a_015` would still collide.
    The answer is 15. This asserts the MAX across families, which is the whole point;
    asserting 7 would pass a counter that still corrupts assertions.
    """
    _seed_into(tmp_path)
    assert MockAgent(tmp_path)._seeded_seq() == 15


def test_a_seeded_project_survives_a_turn_without_duplicate_ids(tmp_path: Path) -> None:
    """The browser symptom, as a test. Two turns, because the bug produced a fresh
    collision on each one (src_002 then src_003)."""
    _seed_into(tmp_path)
    agent = MockAgent(tmp_path)
    import asyncio

    async def drive() -> None:
        await _turn(agent, "find me a death record for Patrick Flynn")
        await _turn(agent, "now find his parents")

    asyncio.run(drive())

    doc = json.loads((tmp_path / "research.json").read_text(encoding="utf-8"))
    for section in ("log", "sources", "assertions"):
        ids = [r["id"] for r in doc.get(section) or []]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        assert not dupes, f"{section} has duplicate ids after two mock turns: {dupes}"


def test_the_counter_is_zero_rather_than_an_error_on_an_unreadable_project(tmp_path: Path) -> None:
    """Runs at agent start-up. A mock that cannot read a malformed project should still
    greet rather than 500, so this falls back rather than raising."""
    (tmp_path / "research.json").write_text("{ not json", encoding="utf-8")
    assert MockAgent(tmp_path)._seeded_seq() == 0
