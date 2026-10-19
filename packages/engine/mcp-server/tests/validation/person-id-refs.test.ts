import { describe, it, expect } from "vitest";
import {
  iteratePersonIdRefs,
  PERSON_ID_REF_FIELDS,
} from "../../src/validation/person-id-refs.js";

describe("person-id-refs walker", () => {
  function researchWithAllFields() {
    return {
      project: { subject_person_ids: ["I1", "I2"] },
      person_evidence: [
        { id: "pe_001", person_id: "I3" },
        { id: "pe_002", person_id: null }, // falsy → skipped
      ],
      timelines: [{ id: "t_001", person_ids: ["I4", "I5"] }],
      known_holdings: [{ id: "kh_001", relates_to_person_ids: ["I6"] }],
      proof_summaries: [
        {
          id: "ps_001",
          claims: [
            {
              claim: "paternity",
              relationship: { type: "ParentChild", parent: "I7", child: "I8" },
            },
          ],
        },
      ],
    };
  }

  it("yields every populated person-id reference, skipping a falsy person_evidence id", () => {
    const refs = [...iteratePersonIdRefs(researchWithAllFields())];
    expect(refs.map((r) => r.pid)).toEqual([
      "I3", "I1", "I2", "I4", "I5", "I6", "I7", "I8",
    ]);
  });

  it("only ever yields fields declared in PERSON_ID_REF_FIELDS (no drift)", () => {
    const refs = [...iteratePersonIdRefs(researchWithAllFields())];
    const yielded = new Set(refs.map((r) => r.field));
    // Every yielded field is a declared field …
    for (const f of yielded) {
      expect(PERSON_ID_REF_FIELDS).toContain(f);
    }
    // … and the fixture exercises all four declared fields.
    expect([...yielded].sort()).toEqual([...PERSON_ID_REF_FIELDS].sort());
  });

  it("`set` rewrites the reference in place (the remap path)", () => {
    const research = researchWithAllFields();
    for (const ref of iteratePersonIdRefs(research)) {
      if (ref.pid === "I4") ref.set("I99");
    }
    expect(research.timelines[0].person_ids).toEqual(["I99", "I5"]);
  });

  it("`set` rewrites a proof_summaries claim's relationship endpoint in place", () => {
    const research = researchWithAllFields();
    for (const ref of iteratePersonIdRefs(research)) {
      if (ref.pid === "I7") ref.set("I99");
    }
    expect(research.proof_summaries[0].claims[0].relationship).toEqual({
      type: "ParentChild",
      parent: "I99",
      child: "I8",
    });
  });

  it("skips a malformed proof_summaries entry, claim, or relationship without throwing", () => {
    const research = {
      proof_summaries: [
        null,
        { claims: null },
        { claims: [null, "not-an-object", { relationship: null }, { relationship: "I2" }] },
        { claims: [{ relationship: { parent: "I9", child: null } }] },
      ],
    };
    const refs = [...iteratePersonIdRefs(research)];
    expect(refs.map((r) => r.pid)).toEqual(["I9"]);
  });
});
