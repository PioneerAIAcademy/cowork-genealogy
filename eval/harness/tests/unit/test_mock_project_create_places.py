"""The live project_create standardizes hand-entered places from the test's own
place_search fixtures, and never reaches the network.

project_create resolves every place in a hand-built tree through the anonymous
Places API. The mock installs a table built from the test's place_search
fixtures (`_place_table`) in the compiled resolver, so the run stays offline and
the answer is the one the test's own place_search would have given.
"""

import asyncio
import json
from pathlib import Path

import pytest

from harness.mock_mcp import _place_table, create_mock_server

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "mcp"
BOSTON = "Boston, Suffolk, Massachusetts, United States"


def _tree(place: str, standard_place: str | None = None) -> dict:
    fact = {"id": "F1", "type": "Birth", "date": "~1850", "place": place}
    if standard_place is not None:
        fact["standard_place"] = standard_place
    return {
        "persons": [{"id": "I1", "gender": "Male", "names": [{"id": "N1", "given": "Michael", "surname": "Brennan"}], "facts": [fact]}],
        "relationships": [],
        "sources": [],
    }


def _create(tmp_path: Path, tree: dict, fixture: dict | None) -> dict:
    """project_create through the mock, with at most one place_search fixture."""
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    names = []
    if fixture is not None:
        (fixtures / "place.json").write_text(json.dumps(fixture), encoding="utf-8")
        names = ["place"]
    workspace = tmp_path / "project"
    workspace.mkdir()
    _server, _log, tools = create_mock_server(names, fixtures, workspace=workspace)
    out = asyncio.run(tools["project_create"].handler({
        "projectPath": str(workspace), "objective": "x", "subjectPersonIds": ["I1"], "tree": tree,
    }))
    result = json.loads(out["content"][0]["text"])
    result["_written"] = json.loads((workspace / "tree.gedcomx.json").read_text(encoding="utf-8")) if result.get("ok") else None
    return result


def test_place_table_answers_from_the_fixture_with_its_own_matching():
    # The (predicate, response, source) triples create_mock_server threads to project_create.
    fx = json.loads((FIXTURES_DIR / "place-search-boston.json").read_text(encoding="utf-8"))
    predicated = [(fx["args"], fx["response"], "place-search-boston")]
    assert _place_table(predicated, {"tree": _tree("Boston, Massachusetts")}) == {"Boston, Massachusetts": BOSTON}
    assert _place_table(predicated, {"tree": _tree("Ballyowen")}) == {"Ballyowen": None}


# Each case below has an answer only the table can give, so neither passes if the
# resolver reaches the live Places API: no real place is called "Nowhere
# Testville", and a real Boston resolves there.
@pytest.mark.requires_engine_build
def test_a_place_resolves_from_the_fixture_alone(tmp_path):
    fx = json.loads((FIXTURES_DIR / "place-search-boston.json").read_text(encoding="utf-8"))
    fx["args"] = {"placeName": "Nowhere Testville"}
    out = _create(tmp_path, _tree("Nowhere Testville", "Somewhere Else"), fx)
    assert out["ok"] is True
    assert out["_written"]["persons"][0]["facts"][0]["standard_place"] == BOSTON
    assert any("was replaced by" in w for w in out["validation"]["warnings"])


@pytest.mark.requires_engine_build
def test_a_real_place_no_fixture_matches_is_left_unset(tmp_path):
    out = _create(tmp_path, _tree("Boston, Massachusetts", "Boston, Massachusetts, United States"), None)
    assert out["ok"] is True
    assert "standard_place" not in out["_written"]["persons"][0]["facts"][0]
