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


def writer_tool_sets(artifact: str, plane: str = UNIT_PLANE) -> dict[str, set[str]]:
    """`section -> permitted writer TOOL names`, for the rows `plane` can enforce.

    The companion to `writer_sets`, which answers "which skill may cause this
    write". This answers "which tool may perform it", and the two are separate
    authorizations because some writes are safe *whoever* asks for them: a tool
    that can only permute person ids cannot assert a `match_score`, rewrite an
    objective, or regenerate a timeline, so the guarantee the `callers` list
    protects survives granting it broadly.

    The manifest already uses that reasoning one row over — `person_evidence`'s
    `requires` records that the record-extraction lane is held off the section
    "by tool identity: `extraction_append` does not accept it."

    Keyed on the same `enforceableAt` filter as `writer_sets`: a row this plane
    cannot enforce contributes no tools, so a caller cannot be authorized on a
    plane the row never claimed.
    """
    sets: dict[str, set[str]] = {}
    for row in rows(artifact):
        if plane not in (row.get("enforceableAt") or []):
            continue
        sets[row["section"]] = set(row.get("writerTools") or [])
    return sets


def agent_name(identifier: str) -> str | None:
    """`agent:citation` -> `citation`; a skill id -> None. Mirror of `skill_name`."""
    if identifier.startswith(_AGENT_PREFIX):
        return identifier[len(_AGENT_PREFIX) :]
    return None


def writer_sets(
    artifact: str,
    plane: str = UNIT_PLANE,
    *,
    subject: str | None = None,
) -> dict[str, set[str]]:
    """`section -> permitted writer names`, for the rows `plane` can enforce.

    Bare names, because that is what the unit validator has to compare against:
    it reads the suite subject's frontmatter `name`.

    **The agent rule (issue #2799).** The unit plane keys on one name — the
    suite's subject — and has no view of which agent made any *other* call. So
    an `agent:<n>` caller resolves to `<n>` when `<n>` IS `subject`, and is
    dropped otherwise. The suite is that agent; `load_suite_frontmatter` reads
    its `name` off `agents/<n>.md`, and the comparison the validator makes is
    then exactly as sound as it is for a skill. Without this, every positive
    test in a converted suite fails ownership on its own legitimate writes.

    **Why dropping the others is safe now, when it never was before.** This
    used to raise on any agent caller, because dropping one silently denied
    that agent's legitimate writes and nothing else would have noticed. What
    changed is not the risk but where the guarantee lives: every unit-plane
    agent caller must now ship `agents/<n>.md` AND own an
    `eval/tests/unit/<n>/` suite, checked against the filesystem by
    `test_a_unit_plane_agent_caller_is_a_suite_subject`. So an agent dropped
    here is always one that IS authorizable — on its own suite, where it is the
    subject — and never one that has been left with no route to authorization.
    Raising instead would fire on every OTHER suite's run, since `citation` is
    not their subject.

    That check is free and runs on every push; this function is reached only
    inside a paid eval run. Keeping the structural rule in the free tier and
    the resolution here is the same split the module docstring already
    describes.
    """
    sets: dict[str, set[str]] = {}
    for row in rows(artifact):
        if plane not in (row.get("enforceableAt") or []):
            continue
        section = row["section"]
        callers = row.get("callers") or []
        resolved = set()
        for c in callers:
            name = skill_name(c)
            if name is None and plane == UNIT_PLANE and agent_name(c) == subject:
                name = subject
            if name is not None:
                resolved.add(name)
        sets[section] = resolved
    return sets
