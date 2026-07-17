"""Python side of the shared tree-gate vectors.

`docs/specs/schemas/tree-gate-vectors.json` pins the agreement between the
three tree.gedcomx.json validity gates. This module asserts the two
Python-side gates — the JSON Schema and the fixture gate's structural
mirror — behave exactly as each vector declares; the engine's
`gate-vectors.test.ts` covers the runtime validator against the same file.
A gate change that shifts any verdict fails here, forcing the vectors (and
therefore a review of the other gates) to move in the same PR.
"""

from __future__ import annotations

import json

import pytest

from e2e.validate_fixture import tree_integrity_errors
from harness.schema_validator import SCHEMAS_DIR, validate_tree_gedcomx_json


VECTORS = json.loads(
    (SCHEMAS_DIR / "tree-gate-vectors.json").read_text(encoding="utf-8")
)["vectors"]


def _ids() -> list[str]:
    return [v["name"] for v in VECTORS]


def test_the_battery_carries_both_controls():
    """A checker that silently no-ops passes everything; one that crashes
    fails everything. Only a battery holding both a passes-all and a
    fails-all vector can tell either apart from a working gate."""
    expectations = {tuple(v["expect"][g] for g in ("schema", "integrity")) for v in VECTORS}
    assert (True, True) in expectations
    assert (False, False) in expectations


@pytest.mark.parametrize("vector", VECTORS, ids=_ids())
def test_json_schema_gate_matches_the_vector(vector):
    errors = validate_tree_gedcomx_json(vector["tree"])
    assert (not errors) == vector["expect"]["schema"], errors


@pytest.mark.parametrize("vector", VECTORS, ids=_ids())
def test_integrity_gate_matches_the_vector(vector):
    errors = tree_integrity_errors(vector["tree"], "vector")
    assert (not errors) == vector["expect"]["integrity"], errors
