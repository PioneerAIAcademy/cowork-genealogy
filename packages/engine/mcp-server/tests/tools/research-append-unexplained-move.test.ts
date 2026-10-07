import { describe, it, expect } from "vitest";
import { unexplainedMoveInvariants, placeCountry } from "../../src/tools/research-append.js";

// A household attested in England whose candidate census places it in Tennessee
// (#2537, ut_person_evidence_g7m). The research side holds the record's
// residence assertion; the tree side holds the person's Residence facts.
function project(opts: { treeResidence?: string; recordPlace?: string; weakLinkSource?: boolean } = {}) {
  const research: any = {
    sources: [
      { id: "src_001", gedcomx_source_description_id: "S10" },
      { id: "src_009", gedcomx_source_description_id: "S9" },
    ],
    assertions: [
      { id: "a_001", source_id: "src_001", record_id: "ark:TN70", record_role: "head", fact_type: "name", value: "William Weller" },
      { id: "a_002", source_id: "src_001", record_id: "ark:TN70", record_role: "head", fact_type: "residence", place: opts.recordPlace ?? "Maury, Tennessee, United States" },
      { id: "a_009", source_id: "src_009", record_id: "ark:TN60", record_role: "head", fact_type: "residence", place: "Maury, Tennessee, United States" },
    ],
    person_evidence: [] as any[],
  };
  const facts: any[] = [{ id: "F1", type: "Birth", date: "~1825", place: "Horsham, Sussex, England" }];
  if (opts.treeResidence !== undefined) {
    facts.push({ id: "F2", type: "Residence", date: "1861", place: opts.treeResidence, sources: [{ ref: "S1" }] });
  }
  if (opts.weakLinkSource) {
    facts.push({ id: "F3", type: "Residence", date: "1860", place: "Maury, Tennessee, United States", sources: [{ ref: "S9" }] });
    research.person_evidence.push({ id: "pe_009", assertion_id: "a_009", person_id: "I1", confidence: "probable" });
  }
  const tree = { persons: [{ id: "I1", facts }], relationships: [], sources: [] };
  return { research, tree };
}
const link = (over: any = {}) => ({ id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "r", ...over });

describe("unexplainedMoveInvariants (#2537)", () => {
  it("refuses confident when the record's country differs from every attested residence", () => {
    const { research, tree } = project({ treeResidence: "Horsham, Sussex, England" });
    const out = unexplainedMoveInvariants(link(), research, tree);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("move_bridge");
    expect(out[0]).toContain("place_distance");
  });

  it("allows probable, and confident once move_bridge names what explains the move", () => {
    const { research, tree } = project({ treeResidence: "Horsham, Sussex, England" });
    expect(unexplainedMoveInvariants(link({ confidence: "probable" }), research, tree)).toEqual([]);
    expect(unexplainedMoveInvariants(link({ move_bridge: "Passenger list, Liverpool to New Orleans, 1866" }), research, tree)).toEqual([]);
    expect(unexplainedMoveInvariants(link({ move_bridge: "   " }), research, tree)).toHaveLength(1);
  });

  it("is silent with no attested residence, and on a same-country move", () => {
    expect(unexplainedMoveInvariants(link(), project().research, project().tree)).toEqual([]);
    const same = project({ treeResidence: "Knox, Tennessee, United States" });
    expect(unexplainedMoveInvariants(link(), same.research, same.tree)).toEqual([]);
    // a bare state and a state code are the United States
    const bare = project({ treeResidence: "Ohio", recordPlace: "East Orange, NJ" });
    expect(unexplainedMoveInvariants(link(), bare.research, bare.tree)).toEqual([]);
  });

  it("is silent when either side names no recognized country (fails open)", () => {
    const region = project({ treeResidence: "Stavanger" });
    expect(unexplainedMoveInvariants(link(), region.research, region.tree)).toEqual([]);
    const endonym = project({ treeResidence: "Manger, Hordaland, Norway", recordPlace: "Manger, Hordaland, Norge" });
    expect(unexplainedMoveInvariants(link(), endonym.research, endonym.tree)).toEqual([]);
  });

  it("does not let a residence resting only on a below-confident link vouch for the move", () => {
    const { research, tree } = project({ treeResidence: "Horsham, Sussex, England", weakLinkSource: true });
    expect(unexplainedMoveInvariants(link(), research, tree)).toHaveLength(1);
    research.person_evidence[0].confidence = "confident";
    expect(unexplainedMoveInvariants(link(), research, tree)).toEqual([]);
  });

  it("folds endonyms and border-shifting countries into groups, and reads an unknown last segment as no country", () => {
    expect(placeCountry("Manger, Hordaland, Norge")).toBe("scandinavia");
    expect(placeCountry("Horsham, Sussex, England")).toBe("british isles");
    expect(placeCountry("Horsham, Sussex, England, United Kingdom")).toBe("british isles");
    expect(placeCountry("Belfast, Antrim, Ireland")).toBe(placeCountry("Belfast, Antrim, Northern Ireland"));
    expect(placeCountry("Posen, Preußen")).toBe(placeCountry("Poznań, Polska"));
    expect(placeCountry("Nueva Italia, Michoacán, México")).toBe("mexico");
    expect(placeCountry("East Orange, NJ")).toBe("united states");
    expect(placeCountry("Rogaland")).toBeNull();
    expect(placeCountry(null)).toBeNull();
  });

  it("does not let the link under write vouch for itself once it sits in person_evidence", () => {
    const { research, tree } = project({ treeResidence: "Horsham, Sussex, England" });
    // a Tennessee Residence fact sourced from the very record being linked
    tree.persons[0].facts.push({ id: "F9", type: "Residence", date: "1870", place: "Maury, Tennessee, United States", sources: [{ ref: "S10" }] });
    const entry = link();
    research.person_evidence.push(entry); // research_append adds the entry before the invariants run
    expect(unexplainedMoveInvariants(entry, research, tree)).toHaveLength(1);
  });

  it("reads only the linked party's residence, falling back to the head's, never another party's", () => {
    const { research, tree } = project({ treeResidence: "Horsham, Sussex, England" });
    research.assertions = [
      { id: "a_001", source_id: "src_001", record_id: "ark:D1", record_role: "deceased", fact_type: "death", place: "Horsham, Sussex, England" },
      { id: "a_002", source_id: "src_001", record_id: "ark:D1", record_role: "informant", fact_type: "residence", place: "Chicago, Illinois" },
    ];
    expect(unexplainedMoveInvariants(link(), research, tree)).toEqual([]);
    // a household member with no residence of their own takes the head's
    const hh = project({ treeResidence: "Horsham, Sussex, England" });
    hh.research.assertions.push({ id: "a_005", source_id: "src_001", record_id: "ark:TN70", record_role: "wife", fact_type: "name", value: "Mary Weller" });
    expect(unexplainedMoveInvariants(link({ assertion_id: "a_005" }), hh.research, hh.tree)).toHaveLength(1);
  });

  it("counts a tree Census fact as an attested residence", () => {
    const { research, tree } = project({ treeResidence: "Horsham, Sussex, England" });
    tree.persons[0].facts.push({ id: "F8", type: "Census", date: "1860", place: "Knox, Tennessee, United States" });
    expect(unexplainedMoveInvariants(link(), research, tree)).toEqual([]);
  });
});
