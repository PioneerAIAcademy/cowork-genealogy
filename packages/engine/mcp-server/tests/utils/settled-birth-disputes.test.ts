import { describe, it, expect } from "vitest";
import { settledBirthDisputes } from "../../src/utils/settled-birth-disputes.js";

const RECORD = "ark:/61903/1:1:MDEF";
const CENSUS = "ark:/61903/1:1:MXHY";

function assertion(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    source_id: "src_001",
    record_id: RECORD,
    record_role: "deceased",
    record_persona_id: null,
    fact_type: "name",
    value: "Patrick Flynn",
    ...over,
  };
}

function tree(birth: Record<string, unknown> | null = { type: "Birth", date: "~1845", place: "Ireland" }) {
  return {
    persons: [{ id: "I1", names: [{ given: "Patrick", surname: "Flynn" }], facts: birth ? [birth] : [] }],
  };
}

function research(conflict: Record<string, unknown> | null, extra: any[] = []) {
  return {
    assertions: [
      assertion("a_011"),
      assertion("a_012", { fact_type: "birth", value: "Born in Pennsylvania", place: "Pennsylvania", date: "1857" }),
      assertion("a_002", {
        record_id: CENSUS,
        source_id: "src_002",
        record_role: "child_1",
        fact_type: "birth",
        value: "Born in Ireland",
        place: "Ireland",
        date: "1845",
      }),
      ...extra,
    ],
    conflicts: conflict ? [{ id: "c_001", conflict_type: "fact", ...conflict }] : [],
  };
}

const PLACE_RESOLVED = {
  disputed_attribute: "birthplace",
  competing_assertion_ids: ["a_002", "a_012"],
  status: "resolved",
  preferred_assertion_id: "a_002",
};

describe("settledBirthDisputes", () => {
  it("names a birth place a resolved conflict set aside", () => {
    const out = settledBirthDisputes(research(PLACE_RESOLVED), tree(), "a_011", "I1");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'c_001'");
    expect(out[0]).toContain("birth place");
    expect(out[0]).toContain('"Pennsylvania"');
    expect(out[0]).toContain("'a_012'");
  });

  it("names a birth date a weighed moot conflict set aside", () => {
    const moot = {
      disputed_attribute: "Birth Year",
      competing_assertion_ids: ["a_002", "a_012"],
      status: "moot",
      independence_analysis: "Two informants.",
      weighing_analysis: "The certificate's informant was not present.",
    };
    const out = settledBirthDisputes(research(moot), tree(), "a_012", "I1");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("birth date");
    expect(out[0]).toContain('"1857"');
  });

  it("says nothing while the conflict is unresolved", () => {
    const open = { ...PLACE_RESOLVED, status: "unresolved", preferred_assertion_id: null };
    expect(settledBirthDisputes(research(open), tree(), "a_011", "I1")).toEqual([]);
  });

  it("says nothing with no conflict at all", () => {
    expect(settledBirthDisputes(research(null), tree(), "a_011", "I1")).toEqual([]);
  });

  it("says nothing for the record whose value the conflict preferred", () => {
    expect(settledBirthDisputes(research(PLACE_RESOLVED), tree(), "a_002", "I1")).toEqual([]);
  });

  it("says nothing when the set-aside value agrees with the tree person's birth", () => {
    const out = settledBirthDisputes(
      research(PLACE_RESOLVED),
      tree({ type: "Birth", date: "~1845", place: "Pennsylvania, United States" }),
      "a_011",
      "I1",
    );
    expect(out).toEqual([]);
  });

  it("says nothing for a moot conflict that was not weighed", () => {
    const thin = {
      disputed_attribute: "birthplace",
      competing_assertion_ids: ["a_002", "a_012"],
      status: "moot",
      independence_analysis: " ",
      weighing_analysis: null,
    };
    expect(settledBirthDisputes(research(thin), tree(), "a_011", "I1")).toEqual([]);
  });

  it("says nothing for a moot conflict whose record person an identity conflict doubts", () => {
    const moot = {
      disputed_attribute: "birthplace",
      competing_assertion_ids: ["a_002", "a_012"],
      status: "moot",
      independence_analysis: "Two informants.",
      weighing_analysis: "Different men.",
    };
    const doc = research(moot);
    expect(settledBirthDisputes(doc, tree(), "a_011", "I1")).toHaveLength(1);
    doc.conflicts.push({
      id: "c_002",
      conflict_type: "identity",
      competing_assertion_ids: ["a_011"],
      status: "unresolved",
    } as any);
    expect(settledBirthDisputes(doc, tree(), "a_011", "I1")).toEqual([]);
  });

  it("says nothing for another party of the same record", () => {
    const informant = assertion("a_013", { record_role: "informant", value: "John Brennan" });
    expect(settledBirthDisputes(research(PLACE_RESOLVED, [informant]), tree(), "a_013", "I1")).toEqual([]);
  });

  it("says nothing when the tree person has no Birth fact or the assertion is unknown", () => {
    expect(settledBirthDisputes(research(PLACE_RESOLVED), tree(null), "a_011", "I1")).toEqual([]);
    expect(settledBirthDisputes(research(PLACE_RESOLVED), tree(), "a_999", "I1")).toEqual([]);
  });
});
