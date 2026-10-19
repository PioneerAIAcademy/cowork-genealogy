"""The corpus-measuring scripts must read both spellings of the basis field.

`evidence_type` (direct | indirect | negative) became `record_basis`
(stated | inferred | absent) on 2026-09-18. The committed run logs under
`eval/runlogs/` are deliberately NOT migrated -- they record what an agent did
on a date, and rewriting them falsifies that. Two committed scripts measure that
corpus and their figures are quoted in shipped specs:

  * scripts/measure_negative_evidence.py -> guardrail-enforcement-spec.md section 4
  * scripts/count_supported_floor.py     -> research-append-tool-spec.md section 5

A reader that understood only the new spelling would return ~zero on the frozen
corpus and read as a real finding rather than as a broken instrument.
"""

from __future__ import annotations

from harness.record_basis import LEGACY_RECORD_BASIS, record_basis_of


def test_reads_the_current_spelling():
    assert record_basis_of({"record_basis": "stated"}) == "stated"
    assert record_basis_of({"record_basis": "inferred"}) == "inferred"
    assert record_basis_of({"record_basis": "absent"}) == "absent"


def test_maps_every_retired_value():
    assert record_basis_of({"evidence_type": "direct"}) == "stated"
    assert record_basis_of({"evidence_type": "indirect"}) == "inferred"
    assert record_basis_of({"evidence_type": "negative"}) == "absent"


def test_the_retired_value_set_is_mapped_whole():
    # A fourth retired value added without a replacement would otherwise read
    # as covered by the three spot-checks above.
    assert sorted(LEGACY_RECORD_BASIS) == ["direct", "indirect", "negative"]
    assert set(LEGACY_RECORD_BASIS.values()) == {"stated", "inferred", "absent"}


def test_current_spelling_wins_on_a_half_migrated_object():
    # The realistic mixed state. The new field is the one every writer and the
    # validator enforce, so it is authoritative.
    assert (
        record_basis_of({"record_basis": "stated", "evidence_type": "negative"})
        == "stated"
    )


def test_returns_none_rather_than_guessing():
    # Callers compare against a literal, so None reads as "not an absence" --
    # the same answer an unclassified assertion got before this existed.
    assert record_basis_of({}) is None
    assert record_basis_of(None) is None
    assert record_basis_of("not a mapping") is None
    assert record_basis_of([1, 2, 3]) is None
    assert record_basis_of({"evidence_type": None}) is None
    assert record_basis_of({"evidence_type": 42}) is None


def test_does_not_translate_an_unrecognized_value():
    # A value in neither enum is a document defect, not something to pass
    # through to a caller's equality check.
    assert record_basis_of({"evidence_type": "no_evidence"}) is None
    assert record_basis_of({"record_basis": "direct"}) is None


def test_counts_a_mixed_corpus_the_way_the_scripts_need():
    # The shape the two scripts actually face: run logs in the retired spelling
    # beside fixtures in the new one. A reader that saw only one would halve it.
    corpus = [
        {"evidence_type": "negative"},
        {"record_basis": "absent"},
        {"evidence_type": "direct"},
        {"record_basis": "stated"},
        {"fact_type": "birth"},
    ]
    assert sum(1 for a in corpus if record_basis_of(a) == "absent") == 2
    assert sum(1 for a in corpus if record_basis_of(a) == "stated") == 2
