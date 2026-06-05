import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub the network resolver; keep the real mapWithConcurrency.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn() };
});

import {
  toSimplified,
  toGedcomX,
  standardizePlaces,
  toSimplifiedStandardized,
} from "../../src/utils/gedcomx-convert.js";
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";
import type {
  GedcomX,
  SimplifiedFact,
  SimplifiedGedcomX,
} from "../../src/types/gedcomx.js";

const mockResolve = vi.mocked(resolveStandardPlace);

beforeEach(() => {
  mockResolve.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toSimplified — standard_place from raw normalized (pure)", () => {
  function simplifyOneFact(place: {
    original?: string;
    normalized?: { value: string; lang?: string }[];
  }): SimplifiedFact {
    const doc = toSimplified({
      persons: [
        { id: "I1", facts: [{ type: "http://gedcomx.org/Birth", place }] },
      ],
    } as GedcomX);
    return doc.persons![0]!.facts![0]!;
  }

  it("prefers the English normalized value", () => {
    const fact = simplifyOneFact({
      original: "Paris",
      normalized: [
        { value: "Paris, Frankreich", lang: "de" },
        { value: "Paris, France", lang: "en" },
      ],
    });
    expect(fact.place).toBe("Paris");
    expect(fact.standard_place).toBe("Paris, France");
  });

  it("falls back to the first value when no English entry exists", () => {
    const fact = simplifyOneFact({
      original: "Köln",
      normalized: [{ value: "Köln, Deutschland", lang: "de" }],
    });
    expect(fact.standard_place).toBe("Köln, Deutschland");
  });

  it("omits standard_place when there is no normalized value", () => {
    const fact = simplifyOneFact({ original: "Some Farm" });
    expect(fact.place).toBe("Some Farm");
    expect(fact.standard_place).toBeUndefined();
  });
});

describe("toGedcomX — standard_place is a dropped sidecar", () => {
  it("does not round-trip standard_place back into raw GedcomX", () => {
    const simplified: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          facts: [
            { type: "Birth", place: "Paris", standard_place: "Paris, France" },
          ],
        },
      ],
    };
    const full = toGedcomX(simplified);
    expect(full.persons![0]!.facts![0]!.place).toEqual({ original: "Paris" });
    expect(JSON.stringify(full)).not.toContain("standard_place");
  });
});

describe("standardizePlaces", () => {
  it("dedups identical place strings to a single resolution", async () => {
    mockResolve.mockResolvedValue("Kentucky, United States");
    const facts: SimplifiedFact[] = [
      { place: "Ky" },
      { place: "ky" }, // normalized key dedups with "Ky"
      { place: "Ky" },
    ];
    await standardizePlaces(facts);
    expect(facts.every((f) => f.standard_place === "Kentucky, United States")).toBe(
      true,
    );
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("skips facts with no place or an existing standard_place", async () => {
    mockResolve.mockResolvedValue("X");
    const facts: SimplifiedFact[] = [
      { place: "A", standard_place: "Already standardized" },
      { value: "no place at all" },
    ];
    await standardizePlaces(facts);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(facts[0]!.standard_place).toBe("Already standardized");
  });

  it("leaves standard_place empty when the resolver returns null", async () => {
    mockResolve.mockResolvedValue(null);
    const facts: SimplifiedFact[] = [{ place: "Nowhere in particular" }];
    await standardizePlaces(facts);
    expect(facts[0]!.standard_place).toBeUndefined();
  });

  it("never throws when the resolver rejects (best-effort)", async () => {
    mockResolve.mockRejectedValue(new Error("network down"));
    const facts: SimplifiedFact[] = [{ place: "Paris" }];
    await expect(standardizePlaces(facts)).resolves.toBeUndefined();
    expect(facts[0]!.standard_place).toBeUndefined();
  });

  it("caps distinct places at the soft cap and logs the overflow", async () => {
    mockResolve.mockImplementation(async (t: string) => `STD:${t}`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const facts: SimplifiedFact[] = Array.from({ length: 60 }, (_, i) => ({
      place: `place-${i}`,
    }));
    await standardizePlaces(facts);
    const resolved = facts.filter((f) => f.standard_place).length;
    expect(resolved).toBe(50);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

describe("toSimplifiedStandardized — hybrid", () => {
  it("uses normalized when present and only resolves free-text places", async () => {
    mockResolve.mockResolvedValue("RESOLVED PLACE");
    const gx: GedcomX = {
      persons: [
        {
          id: "I1",
          facts: [
            {
              type: "http://gedcomx.org/Birth",
              place: {
                original: "Paris",
                normalized: [{ value: "Paris, France", lang: "en" }],
              },
            },
            { type: "http://gedcomx.org/Death", place: { original: "Freetext" } },
          ],
        },
      ],
    };
    const doc = await toSimplifiedStandardized(gx);
    const facts = doc.persons![0]!.facts!;
    expect(facts[0]!.standard_place).toBe("Paris, France"); // from normalized
    expect(facts[1]!.standard_place).toBe("RESOLVED PLACE"); // from resolver
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith("Freetext");
  });
});
