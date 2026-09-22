"""Guard: `research.schema.json`'s transcription_truncated rule must reject.

Two constraints live on `$defs/source.transcription_truncated` (#2457 B1/B2
ruling 2026-09-19): the property is `const: true` (the persisted marker is
`true` or absent — never `false`), and an `if`/`then` requires a non-empty
`transcription` (matching `\\S`) whenever the marker is present. Both arms carry
vitest suites over the runtime validator (`validator.ts`) and the write boundary
(`research-append.ts`); the JSON-Schema arm — loaded by `schema_validator.py`
into the harness's `Draft202012Validator`, which grades every fixture and
after-state under `make harness-test` — carried none.

That gap was not theoretical: no committed fixture builds a truncated source, so
deleting the `const`/`if`/`then` from both schema trees left `make engine-test`
and `make harness-test` entirely green. A check that cannot fail reads as
coverage and is worse than no check at all (CLAUDE.md, "A new lint must be proven
to fail").

These vectors are synthetic on purpose — a fixture-derived one would vanish the
next time the fixture is fixed, which is how such holes open — and each satisfies
`required` and every other field constraint, so nothing BUT the transcription_truncated
rule can refuse them.
"""

from __future__ import annotations

import copy

import pytest

from harness.schema_validator import validate_research_json

_SOURCE = {
    "id": "src_001",
    "gedcomx_source_description_id": "S1",
    "citation": "Test citation.",
    "repository": "FamilySearch",
    "url": None,
    "source_classification": "original",
    "access_date": "2026-01-01",
    "log_entry_id": None,
    "citation_detail": {
        "who": "w", "what": "w", "when_created": "1850",
        "when_accessed": "2026-01-01", "where": "w", "where_within": "w",
    },
    "transcription": "Row 1: Anna Schreck, age 42 — first half of the page",
    "transcription_truncated": True,
    "image_filename": "images/004884748_02613.jpg",
}


class _Omit:
    pass


_OMIT = _Omit()


def _research(**source_overrides) -> dict:
    source = copy.deepcopy(_SOURCE)
    for key, value in source_overrides.items():
        if value is _OMIT:
            source.pop(key, None)
        else:
            source[key] = value
    return {
        "project": {
            "id": "rp_001", "objective": "Test", "status": "active",
            "created": "2026-01-01", "updated": "2026-01-01",
        },
        "questions": [], "plans": [], "log": [],
        "sources": [source],
        "assertions": [], "person_evidence": [], "conflicts": [],
        "hypotheses": [], "timelines": [], "proof_summaries": [], "evaluations": [],
    }


def test_true_beside_real_partial_text_is_accepted():
    assert validate_research_json(_research()) == []


def test_absent_marker_is_accepted():
    # Absent = not established; nothing to enforce.
    assert validate_research_json(_research(transcription_truncated=_OMIT)) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"transcription": ""},                 # then: transcription must match \S
        {"transcription": "   \n  "},          # whitespace-only fails \S too
        {"transcription": None},               # then: transcription must be a string
    ],
)
def test_true_beside_empty_or_null_transcription_is_rejected(overrides):
    errors = validate_research_json(_research(**overrides))
    assert errors, (
        f"{overrides} was accepted — the transcription_truncated if/then in "
        f"docs/specs/schemas/research.schema.json is missing or inert"
    )


def test_a_persisted_false_is_rejected():
    # The marker is true-or-absent; `false` is never a document value (const: true).
    errors = validate_research_json(_research(transcription_truncated=False))
    assert errors, (
        "transcription_truncated: false was accepted — the `const: true` on "
        "$defs/source.transcription_truncated is missing or inert"
    )
