/**
 * The objective's target record leads the plan (issue #2030). The parser and
 * the plan verdict, both directions: the shapes feedback #1945 measured are
 * refused, and the legitimate variants a parser this loose could trip on are
 * accepted or left alone.
 */

import { describe, it, expect } from "vitest";
import { objectiveTarget, objectiveTargetLeadError } from "../../src/utils/objective-target.js";

const KONGSBERG_OBJECTIVE =
  "Find the birth or baptism record of Hoval Hansen, also known as Haaval Hansen or Håval Ziener, " +
  "born approximately 1780 in Kongsberg, Norway, and died in Trysil, Norway 18 August 1860.";

const T = "Trysil, Hedmark, Norway";
const K = "Kongsberg, Buskerud, Norway";

function item(id: string, sequence: number, jurisdiction: string, over: Record<string, unknown> = {}) {
  return { id, sequence, record_type: "church", jurisdiction, fallback_for: null, ...over };
}
const plan = (items: unknown[]) => ({ id: "pl_001", question_id: "q_001", items });

describe("objectiveTarget — reading the objective", () => {
  it("takes the place of the target event, not the death place or the person", () => {
    expect(objectiveTarget(KONGSBERG_OBJECTIVE)).toEqual({
      event: "baptism",
      place: "kongsberg",
      otherPlaces: ["trysil"],
    });
  });

  it("reads a census place after 'of'", () => {
    const t = objectiveTarget(
      "Who was the wife of Job Purnell, and who was their child, as recorded in the 1851 Census of Trowbridge, Wiltshire, England?",
    );
    expect(t).toMatchObject({ event: "census", place: "trowbridge" });
  });

  it("is null when the objective names an event but no record", () => {
    expect(
      objectiveTarget("Did Anna Macek and her husband of Rohovládova Bělá have a son named František, baptized 1867?"),
    ).toBeNull();
  });

  it("is null when the objective names a record but not its place", () => {
    expect(
      objectiveTarget("Using Kentucky death certificates, what were the date and place of death of Elijah Wilkins?"),
    ).toBeNull();
  });

  it("is null for a missing or non-string objective", () => {
    expect(objectiveTarget(undefined)).toBeNull();
    expect(objectiveTarget("")).toBeNull();
    expect(objectiveTarget(42)).toBeNull();
  });

  it("folds accents, so an unaccented jurisdiction still matches", () => {
    const t = objectiveTarget("Find the baptism record of Maria, christened 1853 in Bojnice, Slovakia.");
    expect(t?.place).toBe("bojnice");
    const accented = objectiveTarget("Find the baptism record of Jan, baptized 1893 in Šútovo, Slovakia.");
    expect(accented?.place).toBe("sutovo");
  });
});

describe("objectiveTargetLeadError — refused", () => {
  const t = objectiveTarget(KONGSBERG_OBJECTIVE)!;

  it("refuses the measured #1945 plan: Trysil burial first, Kongsberg baptism third", () => {
    const err = objectiveTargetLeadError(
      plan([item("pli_001", 1, T), item("pli_002", 2, T, { fallback_for: "pli_001" }), item("pli_003", 3, K)]),
      t,
    );
    expect(err).toMatch(/pli_003 \(sequence 3\) is sequenced behind pli_001/);
    expect(err).toMatch(/Give pli_003 sequence 1/);
  });

  it("refuses a target that is a fallback_for a Trysil item", () => {
    const err = objectiveTargetLeadError(
      plan([item("pli_001", 1, T), item("pli_002", 2, K, { fallback_for: "pli_001" })]),
      t,
    );
    expect(err).toBeTruthy();
  });

  it("refuses a lead item labelled with the bare country", () => {
    expect(objectiveTargetLeadError(plan([item("pli_001", 1, "Norway"), item("pli_002", 2, K)]), t)).toBeTruthy();
  });

  it("does not count an item naming both places as the target", () => {
    const err = objectiveTargetLeadError(
      plan([item("pli_001", 1, `${T}; ${K}`), item("pli_002", 2, K)]),
      t,
    );
    expect(err).toMatch(/pli_002/);
  });

  it("refuses a target filed behind an item at sequence 0", () => {
    expect(
      objectiveTargetLeadError(plan([item("pli_001", 0, T), item("pli_002", 5, K)]), t),
    ).toBeTruthy();
  });
});

describe("objectiveTargetLeadError — accepted", () => {
  const t = objectiveTarget(KONGSBERG_OBJECTIVE)!;

  it("accepts the target at sequence 1", () => {
    expect(objectiveTargetLeadError(plan([item("pli_001", 1, K), item("pli_002", 2, T)]), t)).toBeNull();
  });

  it("accepts a reflowed jurisdiction and a vital_record type", () => {
    expect(
      objectiveTargetLeadError(
        plan([item("pli_001", 1, "Kongsberg (Buskerud), Norway", { record_type: "vital_record" }), item("pli_002", 2, T)]),
        t,
      ),
    ).toBeNull();
  });

  it("accepts a target whose fallback is another target item", () => {
    expect(
      objectiveTargetLeadError(
        plan([
          item("pli_001", 1, K),
          item("pli_002", 2, K, { record_type: "vital_record", fallback_for: "pli_001" }),
          item("pli_003", 3, T),
        ]),
        t,
      ),
    ).toBeNull();
  });

  it("is silent when no item targets the record at the place, so a misread objective cannot refuse", () => {
    expect(objectiveTargetLeadError(plan([item("pli_001", 1, T), item("pli_002", 2, "Oslo, Norway")]), t)).toBeNull();
  });

  it("is silent on an empty plan", () => {
    expect(objectiveTargetLeadError(plan([]), t)).toBeNull();
  });
});
