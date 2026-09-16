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
