// Conclusion status (docs/plan/conclusion-tree.md Decision 6) over the shared
// vectors in docs/specs/schemas/conclusion-status-vectors.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conclusionStatus, setAsideParents } from "../../src/utils/conclusion-status.js";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "conclusion-status-vectors.json"), "utf-8"),
);

describe("conclusion status vectors", () => {
  it.each<[string, any]>(vectors.cases.map((c: any) => [c.name, c]))("%s", (_name: string, c: any) => {
    const rows = conclusionStatus(c.research, c.tree, c.startingTree);
    if (c.expectRowCount !== undefined) expect(rows).toHaveLength(c.expectRowCount);
    for (const want of c.expect) {
      const row = rows.find(
        (r) => JSON.stringify(r.holder) === JSON.stringify(want.holder) && (want.factId === undefined || r.factId === want.factId),
      );
      expect(row, `no row for ${JSON.stringify(want.holder)}`).toBeDefined();
      expect(row).toMatchObject(want);
    }
  });
});

describe("setAsideParents (Decision 26)", () => {
  const male = (id: string) => ({ id, gender: "Male", names: [{ id: `N${id}`, given: id }] });
  const tree = {
    persons: [male("I1"), male("I2"), male("I3"), male("I6")],
    relationships: [
      { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
      { id: "R2", type: "ParentChild", parent: "I3", child: "I1" },
      { id: "R3", type: "ParentChild", parent: "I6", child: "I1" },
      { id: "R4", type: "ParentChild", parent: "I2", child: "I6", subtype: "Adoptive" },
    ],
  };
  const research = {
  proof_summaries: [
    {
      id: "ps_001",
      question_id: "q_001",
      tier: "probable",
      claims: [
        { claim: "father", proof_tier: "probable", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent: "I3", child: "I1" } },
        { claim: "not Thomas", proof_tier: "possible", polarity: "denied", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent: "I2", child: "I1" } },
      ],
    },
  ],
};

  it("lists a set-aside parent and a ruled-out one, never the winner or an unclaimed parent", () => {
    const ruledOut = { claim: "not James", proof_tier: "disproved", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent: "I6", child: "I1" } };
    const r = { proof_summaries: [{ ...research.proof_summaries[0], claims: [...research.proof_summaries[0].claims, ruledOut] }] };
    expect(setAsideParents(r, tree)).toEqual(new Map([["I1", new Set(["I2", "I6"])]]));
  });

  it("leaves an unclaimed rival beside the winner in: it has no verdict, so it still competes", () => {
    expect([...(setAsideParents(research, tree).get("I1") ?? [])]).toEqual(["I2"]);
  });

  it("keeps a weak parent counted when the claimed winner has no edge in the tree", () => {
    const noWinnerEdge = { ...tree, relationships: tree.relationships.filter((r) => r.parent !== "I3") };
    expect(setAsideParents(research, noWinnerEdge).size).toBe(0);
  });

  it("needs the winner's edge to be biological, and finds a later winner whose edge is in the tree", () => {
    const adoptive = { ...tree, relationships: tree.relationships.map((r) => (r.parent === "I3" ? { ...r, subtype: "Adoptive" } : r)) };
    expect(setAsideParents(research, adoptive).size).toBe(0);
    const stale = { claim: "father (stale)", proof_tier: "probable", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent: "I7", child: "I1" } };
    const r = { proof_summaries: [{ ...research.proof_summaries[0], claims: [stale, ...research.proof_summaries[0].claims] }] };
    const t = { ...tree, persons: [...tree.persons, male("I7")] };
    expect([...(setAsideParents(r, t).get("I1") ?? [])]).toEqual(["I2"]);
  });

  it("is empty with no summaries, no claims, or no research at all", () => {
    expect(setAsideParents({}, tree).size).toBe(0);
    expect(setAsideParents({ proof_summaries: [{ id: "ps_001", claims: [] }] }, tree).size).toBe(0);
    expect(setAsideParents(null, tree).size).toBe(0);
  });
});
