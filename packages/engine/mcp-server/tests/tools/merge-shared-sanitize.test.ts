import { describe, it, expect } from "vitest";
import { sanitizeCandidate } from "../../src/tools/merge-shared.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

describe("sanitizeCandidate — record-only field stripping", () => {
  it("strips resource_type and coverage from source descriptions", () => {
    const candidate: SimplifiedGedcomX = {
      persons: [
        { id: "I1", gender: "Male", names: [{ id: "N1", given: "J", surname: "S" }] },
      ],
      relationships: [],
      sources: [
        {
          id: "S1",
          resource_type: "DigitalArtifact",
          title: "Some Record",
          coverage: {
            standard_place: "Utah, United States",
            place_rep_id: "place-123",
            date_range: "+1850/+1860",
            record_type: "Census",
          },
        },
      ],
    };
    const { candidate: cleaned, warnings } = sanitizeCandidate(candidate);
    expect(cleaned.sources?.[0]?.resource_type).toBeUndefined();
    expect(cleaned.sources?.[0]?.coverage).toBeUndefined();
    expect(cleaned.sources?.[0]?.title).toBe("Some Record");
    expect(warnings.some((w) => w.includes("resource_type/coverage"))).toBe(true);
  });

  it("strips principal from persons", () => {
    const candidate: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          principal: true,
          gender: "Male",
          names: [{ id: "N1", given: "J", surname: "S" }],
        },
        {
          id: "I2",
          gender: "Female",
          names: [{ id: "N2", given: "M", surname: "S" }],
        },
      ],
      relationships: [],
      sources: [],
    };
    const { candidate: cleaned, warnings } = sanitizeCandidate(candidate);
    expect(cleaned.persons?.[0]?.principal).toBeUndefined();
    expect(cleaned.persons?.[1]?.principal).toBeUndefined();
    expect(warnings.some((w) => w.includes("principal"))).toBe(true);
  });

  it("does not warn when no record-only fields are present", () => {
    const candidate: SimplifiedGedcomX = {
      persons: [
        { id: "I1", gender: "Male", names: [{ id: "N1", given: "J", surname: "S" }] },
      ],
      relationships: [],
      sources: [{ id: "S1", title: "Plain Source" }],
    };
    const { warnings } = sanitizeCandidate(candidate);
    expect(warnings.filter((w) => w.includes("resource_type") || w.includes("principal"))).toEqual([]);
  });

  it("does not mutate the original candidate", () => {
    const candidate: SimplifiedGedcomX = {
      persons: [
        { id: "I1", principal: true, gender: "Male", names: [{ id: "N1", given: "J", surname: "S" }] },
      ],
      relationships: [],
      sources: [
        { id: "S1", resource_type: "DigitalArtifact", title: "T", coverage: { record_type: "Census" } },
      ],
    };
    sanitizeCandidate(candidate);
    expect(candidate.persons?.[0]?.principal).toBe(true);
    expect(candidate.sources?.[0]?.resource_type).toBe("DigitalArtifact");
  });
});

describe("sanitizeCandidate — person-level source refs (#2696)", () => {
  const run = (sources: unknown) =>
    sanitizeCandidate({
      persons: [{ id: "P1", gender: "Male", names: [{ id: "N1", given: "A", surname: "B" }], sources } as any],
      sources: [{ id: "S1", title: "Census" }],
    });

  it("keeps a well-formed ref that names a candidate source, with no warning", () => {
    const { candidate, warnings } = run([{ ref: "S1", page: "p. 3", quality: 2 }]);
    expect(candidate.persons![0].sources).toEqual([{ ref: "S1", page: "p. 3", quality: 2 }]);
    expect(warnings).toEqual([]);
  });

  it.each([
    ["a dangling ref", [{ ref: "S9" }]],
    ["an {id, title} entry (hand-written record_read fixtures)", [{ id: "S1", title: "Census" }]],
    ["a ref carrying tags", [{ ref: "S1", tags: ["Name"] }]],
    ["a string quality", [{ ref: "S1", quality: "2" }]],
    ["a non-array value", "S1"],
  ])("drops %s with a counted warning, never rejecting the candidate", (_label, sources) => {
    const { candidate, warnings } = run(sources);
    expect("sources" in candidate.persons![0]).toBe(false);
    expect(warnings.some((w) => /dropped 1 person-level source reference/.test(w))).toBe(true);
  });

  it("keeps the good refs and drops only the bad ones in a mixed list", () => {
    const { candidate, warnings } = run([{ ref: "S1" }, { ref: "S9" }]);
    expect(candidate.persons![0].sources).toEqual([{ ref: "S1" }]);
    expect(warnings.some((w) => /dropped 1 person-level/.test(w))).toBe(true);
  });
});

describe("sanitizeCandidate — a compacted record_read answer (#4415)", () => {
  it("fills the fields the tree requires and builds a source from the citation", () => {
    const { candidate, warnings } = sanitizeCandidate({
      persons: [
        { id: "a", names: [{ given: "Ann" }], facts: [{ type: "Birth", date: "1850" }] },
        { id: "b", gender: "Male", names: [{ surname: "Ross" }] },
      ],
      relationships: [
        { type: "Couple", person1: "a", person2: "b" },
        { type: "ParentChild", parent: "a", child: "gone" },
      ],
      citation: '"Ohio, Deaths, 1908-1953", <i>FamilySearch</i>, Ann Ross.',
      recordUrl: "https://www.familysearch.org/ark:/61903/1:2:QQ",
    } as any);
    expect(candidate.persons![0]).toMatchObject({
      gender: "Unknown",
      names: [{ id: "n_0_0", given: "Ann", surname: "" }],
      facts: [{ id: "f_0_0" }],
    });
    expect(candidate.persons![1].names![0]).toMatchObject({ id: "n_1_0", given: "", surname: "Ross" });
    expect(candidate.relationships).toEqual([{ id: "r_0", type: "Couple", person1: "a", person2: "b" }]);
    expect(candidate.sources).toEqual([
      {
        id: "S1",
        title: "Ohio, Deaths, 1908-1953",
        citation: '"Ohio, Deaths, 1908-1953", <i>FamilySearch</i>, Ann Ross.',
        url: "https://www.familysearch.org/ark:/61903/1:2:QQ",
      },
    ]);
    expect(warnings.some((w) => w.includes("naming a person not in"))).toBe(true);
    expect(warnings.some((w) => w.includes('gender "Unknown"'))).toBe(true);
  });

  it("drops the comma FamilySearch puts inside the quoted title", () => {
    const { candidate } = sanitizeCandidate({
      persons: [],
      citation: '"United States Census, 1860," database, FamilySearch, Schuylkill County.',
    } as any);
    expect(candidate.sources?.[0]?.title).toBe("United States Census, 1860");
  });

  it("never writes a url key when the answer has no recordUrl", () => {
    const { candidate } = sanitizeCandidate({ persons: [], collectionTitle: "United States Census, 1860" } as any);
    expect(candidate.sources).toEqual([{ id: "S1", title: "United States Census, 1860" }]);
  });
});
