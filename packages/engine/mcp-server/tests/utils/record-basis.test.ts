import { describe, it, expect } from "vitest";
import { recordBasisOf, LEGACY_RECORD_BASIS } from "../../src/utils/record-basis.js";

/**
 * The engine must keep reading `research.json` documents written before the
 * 2026-09-18 `evidence_type` -> `record_basis` rename (#2524).
 *
 * This is not a nicety. Project folders persist across sessions and the `.mcpb`
 * is installed on users' machines, so legacy documents are live input.
 * `materialize-facts.ts` decides what is written into the user's family tree by
 * asking whether an assertion is an absence; reading only the new key on a
 * legacy document returns `undefined`, and a "this person was NOT in this
 * record" assertion would then materialize as though the record had stated it.
 *
 * Schema-wise the legacy document is already tolerated —
 * `validation/introduced-errors.ts` (#1572) demotes pre-existing errors to
 * warnings — but that tolerance layer says nothing about code that reads a
 * VALUE, which is what this module is for.
 */
describe("recordBasisOf", () => {
  it("returns the new field when present", () => {
    expect(recordBasisOf({ record_basis: "stated" })).toBe("stated");
    expect(recordBasisOf({ record_basis: "inferred" })).toBe("inferred");
    expect(recordBasisOf({ record_basis: "absent" })).toBe("absent");
  });

  it("maps every retired value onto its replacement", () => {
    expect(recordBasisOf({ evidence_type: "direct" })).toBe("stated");
    expect(recordBasisOf({ evidence_type: "indirect" })).toBe("inferred");
    expect(recordBasisOf({ evidence_type: "negative" })).toBe("absent");
  });

  it("maps the whole retired value set, with nothing left unmapped", () => {
    // Guards the direction a spot-check misses: a fourth retired value added to
    // the map without a replacement would read as covered.
    expect(Object.keys(LEGACY_RECORD_BASIS).sort()).toEqual([
      "direct",
      "indirect",
      "negative",
    ]);
    for (const v of Object.values(LEGACY_RECORD_BASIS)) {
      expect(["stated", "inferred", "absent"]).toContain(v);
    }
  });

  it("prefers the new field when a document carries both", () => {
    // A half-migrated document is the realistic mixed state. The new field is
    // authoritative: it is what the validator and every writer enforce.
    expect(
      recordBasisOf({ record_basis: "stated", evidence_type: "negative" }),
    ).toBe("stated");
  });

  it("returns undefined rather than guessing when neither field is usable", () => {
    // The callers all compare against a literal, so `undefined` reads as "not
    // an absence" — the same answer they gave before this module existed for an
    // assertion carrying no classification at all. Defaulting to a value here
    // would invent a classification the document never made.
    expect(recordBasisOf({})).toBeUndefined();
    expect(recordBasisOf(null)).toBeUndefined();
    expect(recordBasisOf(undefined)).toBeUndefined();
    expect(recordBasisOf("not an object")).toBeUndefined();
    expect(recordBasisOf({ evidence_type: null })).toBeUndefined();
    expect(recordBasisOf({ evidence_type: 42 })).toBeUndefined();
    expect(recordBasisOf({ record_basis: null, evidence_type: "direct" })).toBe(
      "stated",
    );
  });

  it("does not translate an unrecognized value in either field", () => {
    // A value that is in neither enum is a document defect the validator
    // reports. Passing it through unchanged would let it reach a `===` compare;
    // returning undefined keeps it out of every gate.
    expect(recordBasisOf({ evidence_type: "no_evidence" })).toBeUndefined();
    expect(recordBasisOf({ record_basis: "direct" })).toBeUndefined();
  });
});
