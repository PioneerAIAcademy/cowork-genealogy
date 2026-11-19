// The merge's claim warnings (#3032 Stage 1b, Decision 13): what a merge leaves
// the claims in, against what stood before it, collapsed ids rewritten to the
// survivor so an old finding is not raised again.
import { describe, expect, it } from "vitest";
import { mergeClaimWarnings } from "../../src/validation/merge-claim-warnings.js";

const P = (id: string) => ({ id, gender: "Male", names: [{ id: `N${id}`, given: id, surname: "F" }] });
const birth = (label: string, subject: string, date: string) => ({
  claim: label, proof_tier: "probable", supporting_assertion_ids: [], fact: { subject, fact_type: "Birth", date },
});
const ps = (id: string, claims: object[]) => ({ id, question_id: `q_${id}`, tier: "probable", claims });
const remap = (r: any, map: Record<string, string>) =>
  JSON.parse(Object.entries(map).reduce((t, [c, s]) => t.split(`"${c}"`).join(`"${s}"`), JSON.stringify(r)));
const run = (research: any, tree: any, merged: any, merges: Array<[string, string]>) =>
  mergeClaimWarnings({ research, tree }, { research: remap(research, Object.fromEntries(merges.map(([s, c]) => [c, s]))), tree: merged }, merges);
const twoPersons = { persons: [P("I1"), P("I5")], relationships: [] };
const onePerson = { persons: [P("I1")], relationships: [] };

describe("mergeClaimWarnings", () => {
  it("raises a vitals conflict the merge creates, with ids stable across a retry", () => {
    const research = { proof_summaries: [ps("ps_1", [birth("b1", "I1", "1850")]), ps("ps_2", [birth("b2", "I5", "1860")])] };
    const first = run(research, twoPersons, onePerson, [["I1", "I5"]]);
    expect(first.map((w) => w.issueType)).toEqual(["claims-one-per-slot", "claims-one-per-slot"]);
    expect(first.every((w) => w.personId === "I1")).toBe(true);
    expect(run(research, twoPersons, onePerson, [["I1", "I5"]]).map((w) => w.warningId)).toEqual(first.map((w) => w.warningId));
  });

  it("a rule-2 vitals conflict already standing on the collapsed person is not re-raised after the merge", () => {
    const research = { proof_summaries: [ps("ps_1", [birth("b1", "I5", "1850"), birth("b2", "I5", "1860")])] };
    expect(run(research, twoPersons, onePerson, [["I1", "I5"]])).toEqual([]);
  });

  it("a rule-12 shortfall already standing is not re-raised; one the merge creates is", () => {
    const mk = (deniedTo: string) => ({
      assertions: [{ id: "a_001", record_id: "rec1", source_id: "src_001", record_role: "principal", fact_type: "birth", value: "1850", date: "1850", record_basis: "stated" }],
      person_evidence: [{ id: "pe_1", assertion_id: "a_001", person_id: "I1", confidence: "confident", superseded_by: null }],
      proof_summaries: [{
        id: "ps_1", question_id: "q_1", tier: "proved", claims: [
          { claim: "birth", proof_tier: "proved", supporting_assertion_ids: ["a_001"], fact: { subject: "I1", fact_type: "Birth", date: "1850" } },
          { claim: "not them", proof_tier: "probable", polarity: "denied", supporting_assertion_ids: ["a_001"], identity: { record_id: "rec1", party: "principal", person: deniedTo } },
        ],
      }],
    });
    const created = run(mk("I5"), twoPersons, onePerson, [["I1", "I5"]]);
    expect(created.map((w) => w.issueType)).toEqual(["claims-proved-identity"]);
    // Denied to the survivor already: the shortfall stood before the merge.
    expect(run(mk("I1"), twoPersons, onePerson, [["I1", "I5"]])).toEqual([]);
  });

  it("raises a ruled-out pair the merge re-creates, but not one that already stood", () => {
    const research = { proof_summaries: [ps("ps_1", [{ claim: "not I3", proof_tier: "disproved", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent: "I3", child: "I1" } }])] };
    const before = { persons: [P("I1"), P("I3"), P("I4")], relationships: [{ id: "R1", type: "ParentChild", parent: "I4", child: "I1" }] };
    const after = { persons: [P("I1"), P("I3")], relationships: [{ id: "R1", type: "ParentChild", parent: "I3", child: "I1" }] };
    expect(run(research, before, after, [["I3", "I4"]]).map((w) => w.warningId)).toEqual(["mergeRuledOut|R1"]);
    const stood = { ...before, relationships: [{ id: "R1", type: "ParentChild", parent: "I3", child: "I1" }] };
    expect(run(research, stood, after, [["I3", "I4"]])).toEqual([]);
  });

  it("a ruled-out edge already standing on the collapsed person raises nothing, whichever duplicate the merge keeps", () => {
    const research = { proof_summaries: [ps("ps_1", [{ claim: "not C", proof_tier: "disproved", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent: "I7", child: "I1" } }])] };
    const r1 = { id: "R1", type: "ParentChild", parent: "I7", child: "I1" };
    const r2 = { id: "R2", type: "ParentChild", parent: "I8", child: "I1" };
    for (const [edges, kept] of [[[r1, r2], "R1"], [[r2, r1], "R2"]] as const) {
      const before = { persons: [P("I1"), P("I7"), P("I8")], relationships: [...edges] };
      const after = { persons: [P("I1"), P("I8")], relationships: [{ id: kept, type: "ParentChild", parent: "I8", child: "I1" }] };
      expect(run(research, before, after, [["I8", "I7"]])).toEqual([]);
    }
  });

  it("a claim label naming the collapsed id does not re-raise an old finding", () => {
    const research = { proof_summaries: [ps("ps_1", [birth("born I5 1850", "I5", "1850"), birth("born I5 1860", "I5", "1860")])] };
    expect(run(research, twoPersons, onePerson, [["I1", "I5"]])).toEqual([]);
  });

  it("raises nothing with no claims", () => {
    expect(run({ proof_summaries: [] }, twoPersons, onePerson, [["I1", "I5"]])).toEqual([]);
  });

  it("a label with an apostrophe does not re-raise a polarity finding that already stood", () => {
    const idn = (claim: string, person: string) => ({
      claim, proof_tier: "probable", supporting_assertion_ids: [], identity: { record_id: "rec1", party: "principal", person },
    });
    const research = { proof_summaries: [ps("ps_1", [idn("Mary's record", "I5"), idn("other", "I4")])] };
    const before = { persons: [P("I4"), P("I5"), P("I6")], relationships: [] };
    const after = { persons: [P("I4"), P("I6")], relationships: [] };
    expect(run(research, before, after, [["I6", "I5"]])).toEqual([]);
  });

  it("with several merges, a warning names the survivor its claims concern, not the first", () => {
    const pc = (claim: string, parent: string, extra: object = {}) => ({
      claim, proof_tier: "probable", supporting_assertion_ids: [], relationship: { type: "ParentChild", parent, child: "I7" }, ...extra,
    });
    const research = { proof_summaries: [ps("ps_1", [pc("father", "I8")]), ps("ps_2", [pc("not him", "I9", { polarity: "denied" })])] };
    const before = { persons: [P("I1"), P("I2"), P("I7"), P("I8"), P("I9")], relationships: [] };
    const after = { persons: [P("I1"), P("I7"), P("I8")], relationships: [] };
    const out = run(research, before, after, [["I1", "I2"], ["I8", "I9"]]);
    expect(out.map((w) => [w.issueType, w.personId])).toEqual([["claims-polarity", "I8"]]);
  });
});
