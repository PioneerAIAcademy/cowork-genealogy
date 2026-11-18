import { describe, expect, it } from "vitest";
import { claimCoversEdge, claimCoversFact, nearMiss, sameClaimObject } from "../../src/utils/claim-join.js";

const fact = (subject: unknown, fact_type: string, extra: Record<string, unknown> = {}) => ({
  claim: "c",
  proof_tier: "probable",
  supporting_assertion_ids: ["a_001"],
  fact: { subject, fact_type, ...extra },
});
const rel = (relationship: Record<string, unknown>) => ({
  claim: "r",
  proof_tier: "probable",
  supporting_assertion_ids: ["a_001"],
  relationship,
});

describe("claim-join: Decision 31's one join", () => {
  it("a claim omitting higher jurisdictions is the same object", () => {
    const a = fact("I1", "Birth", { date: "1879", place: "Boston, Suffolk, Massachusetts" });
    const b = fact("I1", "Birth", { date: "1879", place: "Boston" });
    expect(sameClaimObject(a, b)).toBe(true);
    expect(claimCoversFact(b, ["I1"], { type: "Birth", date: "1879", place: "Boston, Suffolk, Massachusetts" })).toBe(true);
  });

  it("a finer place is not covered by a coarser claim, nor is a different place", () => {
    const coarse = fact("I1", "Birth", { place: "Massachusetts" });
    expect(claimCoversFact(coarse, ["I1"], { type: "Birth", place: "Boston, Suffolk, Massachusetts" })).toBe(false);
    expect(sameClaimObject(fact("I1", "Birth", { place: "Boston" }), fact("I1", "Birth", { place: "Salem" }))).toBe(false);
  });

  it("25 Nov 1879 and 1880 are not one object, and the near miss names both", () => {
    const a = fact("I1", "Birth", { date: "25 Nov 1879" });
    const b = fact("I1", "Birth", { date: "1880" });
    expect(sameClaimObject(a, b)).toBe(false);
    expect(nearMiss(a, b)).toEqual({ a: "25 Nov 1879", b: "1880" });
    expect(claimCoversFact(a, ["I1"], { type: "Birth", standard_date: "1880" })).toBe(false);
  });

  it("a claim copied from a fact's written date or place covers it beside a different standard form", () => {
    expect(claimCoversFact(fact("I1", "Birth", { date: "about 1882" }), ["I1"], { type: "Birth", date: "about 1882", standard_date: "1882" })).toBe(true);
    expect(claimCoversFact(fact("I1", "Birth", { date: "1882" }), ["I1"], { type: "Birth", date: "about 1882", standard_date: "1882" })).toBe(true);
    const tree = { type: "Birth", place: "Berks County, Pennsylvania", standard_place: "Berks, Pennsylvania, United States" };
    expect(claimCoversFact(fact("I1", "Birth", { place: "Berks County, Pennsylvania" }), ["I1"], tree)).toBe(true);
    expect(claimCoversFact(fact("I1", "Birth", { place: "Lancaster, Pennsylvania" }), ["I1"], tree)).toBe(false);
  });

  it("an ISO and a written form of one date are the same", () => {
    expect(sameClaimObject(fact("I1", "Death", { date: "1913-01-14" }), fact("I1", "Death", { date: "14 January 1913" }))).toBe(true);
    expect(claimCoversFact(fact("I1", "Death", { date: "+1913-01-14" }), ["I1"], { type: "Death", date: "14 Jan 1913" })).toBe(true);
    expect(nearMiss(fact("I1", "Death", { date: "1913-01-14" }), fact("I1", "Death", { date: "14 January 1913" }))).toBeNull();
  });

  it("an untyped and a Biological ParentChild claim on one pair are the same object", () => {
    const a = rel({ type: "ParentChild", parent: "I2", child: "I1" });
    const b = rel({ type: "ParentChild", parent: "I2", child: "I1", subtype: "Biological" });
    expect(sameClaimObject(a, b)).toBe(true);
    expect(claimCoversEdge(a, { id: "R1", type: "ParentChild", parent: "I2", child: "I1", subtype: "Step" })).toBe(true);
    expect(sameClaimObject(a, rel({ type: "ParentChild", parent: "I1", child: "I2" }))).toBe(false);
  });

  it("a Step and a Biological claim on one pair are not the same object", () => {
    const step = rel({ type: "ParentChild", parent: "I2", child: "I1", subtype: "Step" });
    const bio = rel({ type: "ParentChild", parent: "I2", child: "I1", subtype: "Biological" });
    expect(sameClaimObject(step, bio)).toBe(false);
    expect(sameClaimObject(step, rel({ type: "ParentChild", parent: "I2", child: "I1" }))).toBe(false);
    expect(claimCoversEdge(step, { type: "ParentChild", parent: "I2", child: "I1", subtype: "Biological" })).toBe(true);
  });

  it("a Couple's pair is unordered, for claims, edges and couple facts", () => {
    const a = rel({ type: "Couple", person1: "I1", person2: "I2" });
    const b = rel({ type: "Couple", person1: "I2", person2: "I1" });
    expect(sameClaimObject(a, b)).toBe(true);
    expect(claimCoversEdge(a, { type: "Couple", person1: "I2", person2: "I1" })).toBe(true);
    const m = fact({ person1: "I2", person2: "I1" }, "marriage", { date: "1 Feb 1868" });
    expect(claimCoversFact(m, ["I1", "I2"], { type: "Marriage", date: "1 Feb 1868" })).toBe(true);
  });

  it("findings never share an object, and names compare folded", () => {
    const f = { claim: "f", proof_tier: "probable", supporting_assertion_ids: [], finding: { finding_type: "absence", statement: "x" } };
    expect(sameClaimObject(f, f)).toBe(false);
    const n1 = { claim: "n", proof_tier: "probable", supporting_assertion_ids: [], name: { person: "I1", given: "José", surname: "Pérez" } };
    const n2 = { claim: "n", proof_tier: "probable", supporting_assertion_ids: [], name: { person: "I1", given: "jose", surname: "PEREZ" } };
    expect(sameClaimObject(n1, n2)).toBe(true);
  });

  it("a record identity matches on record and party; same_as on the pair", () => {
    const i = (identity: Record<string, unknown>) => ({ claim: "i", proof_tier: "probable", supporting_assertion_ids: [], identity });
    expect(sameClaimObject(i({ person: "I1", record_id: "r1", party: "child" }), i({ person: "I2", record_id: "r1", party: "child" }))).toBe(true);
    expect(sameClaimObject(i({ person: "I1", same_as: "I2" }), i({ person: "I2", same_as: "I1" }))).toBe(true);
    expect(sameClaimObject(i({ person: "I1", same_as: "I2" }), i({ person: "I1", record_id: "r1", party: "child" }))).toBe(false);
  });
});
