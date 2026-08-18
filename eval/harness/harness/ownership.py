"""The shared ownership declaration: who may write each project-document section.

`docs/specs/schemas/ownership.json` replaced a pair of dict literals that lived
inside `validators/test_universal.py`. The literals described themselves as the
"single source of truth for which skills are allowed to write each research.json
section", and they were: a truth held in a pytest validator, in a tier that runs
in neither Cowork nor the hosted path — and, even in the harness, only inside a
paid per-skill eval run.

This module is the one loader. The universal validator reads its enforced writer
sets from here; `tests/unit/test_ownership_manifest.py` freezes those same sets
against the values the literals carried, so that deleting an owner reddens a test
instead of silently widening what is allowed.

**Deliberately no fallback.** A missing or malformed manifest raises. The
alternative — degrade to an empty mapping — turns default-deny into
default-allow, which is a check that reports success while enforcing nothing.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = REPO_ROOT / "docs" / "specs" / "schemas" / "ownership.json"

RESEARCH_JSON = "research.json"
TREE_GEDCOMX_JSON = "tree.gedcomx.json"

#: The plane this harness's universal ownership validator enforces on.
UNIT_PLANE = "unit"

_SKILL_PREFIX = "skill:"
_AGENT_PREFIX = "agent:"


class OwnershipManifestError(RuntimeError):
    """The manifest is absent, unparseable, or declares something incoherent."""


@lru_cache(maxsize=1)
def load_manifest() -> dict[str, Any]:
    """Parse `ownership.json`. Raises rather than degrading to an empty table."""
    try:
        raw = MANIFEST_PATH.read_text(encoding="utf-8")
    except OSError as exc:  # pragma: no cover - exercised by deleting the file
        raise OwnershipManifestError(
            f"ownership manifest not found at {MANIFEST_PATH} — the ownership checks "
            f"cannot run without it, and passing without it would report coverage "
            f"that does not exist"
        ) from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OwnershipManifestError(f"{MANIFEST_PATH} is not valid JSON: {exc}") from exc
    if not isinstance(data.get("rows"), list):
        raise OwnershipManifestError(f"{MANIFEST_PATH} has no `rows` array")
    return data


def rows(artifact: str | None = None) -> list[dict[str, Any]]:
    """Every row, optionally narrowed to one artifact."""
    all_rows = load_manifest()["rows"]
    if artifact is None:
        return list(all_rows)
    return [r for r in all_rows if r.get("artifact") == artifact]


def skill_name(identifier: str) -> str | None:
    """`skill:record-extraction` -> `record-extraction`; an agent id -> None."""
    if identifier.startswith(_SKILL_PREFIX):
        return identifier[len(_SKILL_PREFIX) :]
    return None


def writer_sets(artifact: str, plane: str = UNIT_PLANE) -> dict[str, set[str]]:
    """`section -> permitted skill names`, for the rows `plane` can enforce.

    Bare skill names, because that is what the unit validator has to compare
    against: it reads the calling skill's `SKILL.md` frontmatter `name`, and has
    no view of which agent made a call.

    A row naming an **agent** caller therefore cannot be expressed on the unit
    plane, and declaring it enforceable there would silently deny that agent's
    legitimate writes. That is a declaration error, so it raises here rather than
    being dropped — `evaluations` is exactly this shape, and its row carries
    `enforceableAt: []` for this reason.
    """
    sets: dict[str, set[str]] = {}
    for row in rows(artifact):
        if plane not in (row.get("enforceableAt") or []):
            continue
        section = row["section"]
        callers = row.get("callers") or []
        agents = [c for c in callers if c.startswith(_AGENT_PREFIX)]
        if agents and plane == UNIT_PLANE:
            raise OwnershipManifestError(
                f"{artifact} section '{section}' is declared enforceable at '{plane}' but "
                f"names agent caller(s) {agents}. The unit plane keys on the calling "
                f"skill's frontmatter name and cannot see an agent, so enforcing this row "
                f"there would deny the owner's own writes."
            )
        sets[section] = {
            name for name in (skill_name(c) for c in callers) if name is not None
        }
    return sets
