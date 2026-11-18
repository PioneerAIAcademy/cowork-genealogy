// Decision 34's helpers: which claims cover a fact, and which primaries each rule names.
import { describe, expect, it } from "vitest";
import { clearUnclaimedPrimary, primaryFacts, probableClaims, unclaimedPrimarySet } from "../../src/utils/primary-claim.js";

const birth = (date: string, tier = "probable", extra: object = {}) => ({
  claim: `birth ${date}`, proof_tier: tier, supporting_assertion_ids: [], fact: { subject: "I1", fact_type: "Birth", date }, ...extra,
});
const research = (claims: object[]) => ({ proof_summaries: [{ id: "ps_001", claims }] });
const tree = (facts: object[], coupleFacts: object[] = []) => ({
  persons: [{ id: "I1", facts }, { id: "I2", facts: [] }],
  relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: coupleFacts }],
});

describe("probableClaims", () => {
  it("keeps affirmed claims at probable or better, never a denial, a disproof or a weaker tier", () => {
    const kept = probableClaims(research([
      birth("1850"), birth("1851", "proved"), birth("1852", "possible"),
      birth("1853", "probable", { polarity: "denied" }), birth("1854", "disproved"),
    ]));
    expect(kept.map((c) => c.fact.date)).toEqual(["1850", "1851"]);
  });
});

describe("primaryFacts", () => {
  it("lists person and Couple primaries with their holders", () => {
    const t = tree([{ id: "F1", type: "Birth", primary: true }, { id: "F2", type: "Death" }], [{ id: "F9", type: "Marriage", primary: true }]);
    expect(primaryFacts(t).map((x) => [x.holder, x.fact.id])).toEqual([[{ personId: "I1" }, "F1"], [{ relationshipId: "R1" }, "F9"]]);
  });
});

describe("unclaimedPrimarySet", () => {
  const f = (over: object = {}) => ({ id: "F1", type: "Birth", date: "1850", ...over });
  it("names a newly set primary no claim covers, and not one a claim covers", () => {
    expect(unclaimedPrimarySet(tree([f()]), tree([f({ primary: true })]), research([]))).toHaveLength(1);
    expect(unclaimedPrimarySet(tree([f()]), tree([f({ primary: true })]), research([birth("1850")]))).toEqual([]);
  });
  it("names a claimed primary moved off its claim, never an unclaimed one corrected", () => {
    const claimed = research([birth("1850")]);
    expect(unclaimedPrimarySet(tree([f({ primary: true })]), tree([f({ primary: true, date: "1851" })]), claimed)).toHaveLength(1);
    expect(unclaimedPrimarySet(tree([f({ primary: true })]), tree([f({ primary: true, date: "1851" })]), research([]))).toEqual([]);
  });
});

describe("clearUnclaimedPrimary", () => {
  it("clears a fact a pre-call claim covered and none covers after, and undoes", () => {
    const before = tree([{ id: "F1", type: "Birth", date: "1850", primary: true }]);
    const after = structuredClone(before);
    const r = clearUnclaimedPrimary(research([birth("1850")]), research([birth("1850", "possible")]), before, after);
    expect(r.mutated).toBe(true);
    expect(after.persons[0].facts[0]).not.toHaveProperty("primary");
    r.undo();
    expect((after.persons[0].facts[0] as any).primary).toBe(true);
  });
  it("leaves a primary no pre-call claim covered", () => {
    const before = tree([{ id: "F1", type: "Birth", date: "1850", primary: true }]);
    const after = structuredClone(before);
    expect(clearUnclaimedPrimary(research([]), research([]), before, after).mutated).toBe(false);
    expect(clearUnclaimedPrimary(research([birth("1860")]), research([]), before, after).mutated).toBe(false);
  });
});
