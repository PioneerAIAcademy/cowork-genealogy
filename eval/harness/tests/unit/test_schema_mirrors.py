"""The two schema trees must stay byte-identical.

`docs/specs/schemas/` is the source the harness validates against;
`packages/schema/schemas/` is the mirror the web workbench consumes
(per CLAUDE.md, every schema change edits both). Nothing else enforced
that — `harness.schema_validator` reads only the docs copy, so a
divergence would be invisible to every gate. This test is the audit's
one-line `cmp`.
"""

from __future__ import annotations

import pytest

from harness.schema_validator import REPO_ROOT, SCHEMAS_DIR


MIRROR_DIR = REPO_ROOT / "packages" / "schema" / "schemas"


def _schema_names() -> list[str]:
    return sorted(p.name for p in SCHEMAS_DIR.glob("*.schema.json"))


def test_every_schema_is_mirrored():
    mirrored = sorted(p.name for p in MIRROR_DIR.glob("*.schema.json"))
    assert _schema_names() == mirrored


@pytest.mark.parametrize("name", _schema_names())
def test_mirror_is_byte_identical(name: str):
    assert (SCHEMAS_DIR / name).read_bytes() == (MIRROR_DIR / name).read_bytes(), (
        f"{name} differs between docs/specs/schemas/ and packages/schema/schemas/ — "
        f"schema changes must edit both trees (see CLAUDE.md)"
    )
