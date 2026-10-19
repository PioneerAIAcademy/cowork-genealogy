"""Read an assertion's basis field across the 2026-09-18 rename.

`evidence_type` (direct | indirect | negative) became `record_basis`
(stated | inferred | absent). The committed run logs under `eval/runlogs/` are
deliberately NOT migrated: they record what an agent did on a date, and
rewriting them falsifies that record. So any script that measures the corpus has
to understand both spellings, or its figures silently collapse toward zero and
read as a finding rather than as a broken instrument.

Two committed scripts are in exactly that position, and both back figures quoted
in shipped specs:

  * ``scripts/measure_negative_evidence.py`` -> ``guardrail-enforcement-spec.md``
  * ``scripts/count_supported_floor.py``     -> ``research-append-tool-spec.md``

This is the Python twin of ``packages/engine/mcp-server/src/utils/record-basis.ts``,
which does the same job for `research.json` documents in users' project folders.
Two copies rather than one shared module because the engine and the harness are
separate runtimes with no import path between them -- the same reason CLAUDE.md
gives for duplicating structures across the MCP/skill boundary.
"""

from __future__ import annotations

from collections.abc import Mapping

#: Retired ``evidence_type`` values and what each became. ``direct``/``indirect``
#: were mechanical all along -- "the record stated it" versus "we inferred it" --
#: and the new names say so. ``negative`` -> ``absent`` keeps its meaning: the
#: value was expected and the record did not carry it.
LEGACY_RECORD_BASIS: dict[str, str] = {
    "direct": "stated",
    "indirect": "inferred",
    "negative": "absent",
}

_CURRENT = frozenset({"stated", "inferred", "absent"})


def record_basis_of(assertion: object) -> str | None:
    """Return the assertion's ``record_basis``, or ``None``.

    ``None`` rather than a default: every caller compares against a literal, so
    ``None`` reads as "not an absence" -- the same answer an assertion carrying
    no classification got before this existed. Defaulting would invent a
    classification the document never made.

    A value in neither enum also yields ``None``. It is a document defect the
    validator already reports, and passing it through would let it reach a
    caller's equality check.
    """
    if not isinstance(assertion, Mapping):
        return None

    # The new field wins on a half-migrated document: it is the one the
    # validator and every writer tool enforce.
    current = assertion.get("record_basis")
    if isinstance(current, str) and current in _CURRENT:
        return current

    legacy = assertion.get("evidence_type")
    if isinstance(legacy, str):
        return LEGACY_RECORD_BASIS.get(legacy)
    return None
