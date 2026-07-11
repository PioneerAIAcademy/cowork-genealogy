import { describe, it, expect } from "vitest";

import { sanitizeTree } from "../../src/validation/tree-sanitize.js";
import { validateGedcomx } from "../../src/validation/validator.js";
import { createReport } from "../../src/validation/types.js";

const clean = () => ({
  persons: [
    {
      id: "I1",
      living: false,
      gender: "Male",
      names: [{ id: "N1", preferred: true, given: "John", surname: "Smith" }],
      facts: [{ id: "F1", type: "Birth", date: "1900", sources: [{ ref: "S1", quality: 0 }] }],
    },
  ],
  relationships: [],
  sources: [{ id: "S1", title: "1900 Census" }],
});

const runtimeErrors = (tree: unknown): string[] => {
  const report = createReport();
  validateGedcomx(tree, report);
  return report.errors.map((e) => e.message);
};

describe("sanitizeTree", () => {
  it("returns a clean tree untouched, with zero warnings", () => {
    const input = clean();
    const { tree, warnings } = sanitizeTree(input);
    expect(warnings).toEqual([]);
    expect(tree).toEqual(input);
    expect(tree).not.toBe(input); // deep copy — the input is never mutated
  });

  it("heals the legacy shapes main's own pipeline wrote, and the result validates", () => {
    // A composite of everything found in real run-produced trees: the old
    // mergeNames' preferred:false, primary:false, person-level sources, the
    // old spec-mandated top-level places, agent-invented fact keys, a string
    // quality, and a fact with no id.
    const legacy: any = clean();
    legacy.places = [{ id: "P1", name: "Ogden, Utah" }];
    legacy.persons[0].sources = [{ ref: "S1" }];
    legacy.persons[0].names.push({
      id: "N2", preferred: false, given: "Jack", surname: "Smith",
    });
    legacy.persons[0].facts.push(
      { id: "F2", type: "Death", primary: false, date_certainty: "high" },
      { type: "Burial", sources: [{ ref: "S1", quality: "2" }] },
    );

    const { tree, warnings } = sanitizeTree(legacy) as any;

    expect(tree.places).toBeUndefined();
    expect(tree.persons[0].sources).toBeUndefined();
    expect("preferred" in tree.persons[0].names[1]).toBe(false);
    expect("primary" in tree.persons[0].facts[1]).toBe(false);
    expect("date_certainty" in tree.persons[0].facts[1]).toBe(false);
    expect(tree.persons[0].facts[2].id).toBe("F3"); // minted past F1/F2
    expect(tree.persons[0].facts[2].sources[0].quality).toBe(2); // "2" -> 2

    expect(runtimeErrors(legacy).length).toBeGreaterThan(0); // was broken
    expect(runtimeErrors(tree)).toEqual([]); // healed

    // One narratable warning per healed class.
    expect(warnings.some((w: string) => w.includes("places section"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("person-level source reference"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("'preferred: false'"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("'primary: false'"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("'date_certainty'"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("assigned F ids"))).toBe(true);
    expect(warnings.some((w: string) => w.includes("string quality"))).toBe(true);
  });

  it("drops quality values that are not QUAY integers 0-3", () => {
    const legacy: any = clean();
    legacy.persons[0].facts[0].sources[0].quality = 7;
    const { tree, warnings } = sanitizeTree(legacy) as any;
    expect("quality" in tree.persons[0].facts[0].sources[0]).toBe(false);
    expect(warnings.some((w: string) => w.includes("not integers 0-3"))).toBe(true);
  });

  it("heals preferred:false inside Couple facts' owners too", () => {
    const legacy: any = clean();
    legacy.persons.push({
      id: "I2", living: false, gender: "Female",
      names: [{ id: "N9", given: "Mary", surname: "Jones" }],
    });
    legacy.relationships = [{
      id: "R1", type: "Couple", person1: "I1", person2: "I2",
      facts: [{ id: "F9", type: "Marriage", primary: false, quality: "junk" }],
    }];
    const { tree } = sanitizeTree(legacy) as any;
    const fact = tree.relationships[0].facts[0];
    expect("primary" in fact).toBe(false);
    expect("quality" in fact).toBe(false); // unknown fact key, pruned
    expect(runtimeErrors(tree)).toEqual([]);
  });

  it("does NOT heal the ambiguous problems — they still fail validation", () => {
    const broken: any = clean();
    // dangling ref, swapped endpoint keys, duplicate ids: no safe auto-repair
    broken.relationships = [
      { id: "R1", type: "ParentChild", person1: "I1", person2: "I1" },
      { id: "R2", type: "ParentChild", parent: "I1", child: "GONE-1" },
    ];
    broken.persons.push(structuredClone(broken.persons[0]));
    const { tree } = sanitizeTree(broken) as any;
    expect(tree.relationships[0].person1).toBe("I1"); // endpoints untouched
    expect(tree.relationships[1].child).toBe("GONE-1"); // dangler untouched
    expect(tree.persons).toHaveLength(2); // duplicate untouched
    expect(runtimeErrors(tree).length).toBeGreaterThan(0);
  });

  it("never invents a section: a corrupt non-array persons stays broken", () => {
    // Healing a truncated file into a "valid" empty tree would be silent
    // data loss — the validator must keep reporting it.
    const corrupt: any = { persons: "oops", relationships: [], sources: [] };
    const { tree, warnings } = sanitizeTree(corrupt) as any;
    expect(tree.persons).toBe("oops");
    expect(warnings).toEqual([]);
    expect(runtimeErrors(tree).some((m) => m.includes("must be an array"))).toBe(true);
  });
});
