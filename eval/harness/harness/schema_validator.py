"""Shared jsonschema validators for research.json and tree.gedcomx.json.

Spec §8: "Validators must use jsonschema against the schema files rather
than reimplementing field/type checks in Python." This module centralises
the wiring (loading schemas, building a referencing registry for the
shared enums.schema.json) so the universal validator and the runnability
gate use one source of truth.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema
from referencing import Registry, Resource


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMAS_DIR = REPO_ROOT / "docs/specs/schemas"


@lru_cache(maxsize=1)
def _registry() -> Registry:
    """A registry containing enums.schema.json so the $refs in
    research.schema.json and tree-gedcomx.schema.json resolve."""
    enums = json.loads((SCHEMAS_DIR / "enums.schema.json").read_text())
    return Registry().with_resource(
        uri="enums.schema.json",
        resource=Resource.from_contents(enums),
    )


@lru_cache(maxsize=1)
def _research_validator() -> jsonschema.Draft202012Validator:
    schema = json.loads((SCHEMAS_DIR / "research.schema.json").read_text())
    return jsonschema.Draft202012Validator(schema, registry=_registry())


@lru_cache(maxsize=1)
def _tree_gedcomx_validator() -> jsonschema.Draft202012Validator:
    schema = json.loads((SCHEMAS_DIR / "tree-gedcomx.schema.json").read_text())
    return jsonschema.Draft202012Validator(schema, registry=_registry())


def validate_research_json(data: dict[str, Any]) -> list[str]:
    """Return a list of error messages (empty when valid).

    Returning a list keeps the caller in charge of how to report errors
    (assert vs. collect vs. raise) and how many to surface.
    """
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in _research_validator().iter_errors(data)
    ]


def validate_tree_gedcomx_json(data: dict[str, Any]) -> list[str]:
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in _tree_gedcomx_validator().iter_errors(data)
    ]
