/**
 * A record's own page disputing its index (#4286): the dispute groups, the
 * literal both-readings check ruling 10's proof rule uses, and the disagreement
 * check that opens no conflict for a pair inside one group.
 */

import { describe, it, expect } from "vitest";
import { disputeGroups, liveSuccessorId } from "../../src/utils/page-disputes.js";
import { namesEveryReading } from "../../src/tools/research-append.js";
import { unregisteredDisagreements } from "../../src/utils/question-state.js";

const a = (id: string, more: Record<string, unknown> = {}) => ({
  id, source_id: "src_001", record_id: "rec1", record_role: "principal", fact_type: "birth", value: "1850",
  information_quality: "primary", informant: "x", informant_proximity: "self", record_basis: "stated",
  extracted_for_question_ids: ["q_001"], ...more,
});

describe("disputeGroups", () => {
  it("groups each disputed index assertion with its readings", () => {
    const g = disputeGroups({ assertions: [a("a_001"), a("a_002", { value: "1851 [?]", disputes_assertion_id: "a_001" })] });
    expect([...g.keys()]).toEqual(["a_001"]);
    expect(g.get("a_001")!.disputers.map((d) => d.id)).toEqual(["a_002"]);
  });

  it("follows a retired target to its successor", () => {
    const research = {
      assertions: [
        a("a_001", { superseded_by: "a_003" }),
        a("a_002", { value: "1851 [?]", disputes_assertion_id: "a_001" }),
        a("a_003"),
      ],
    };
    expect([...disputeGroups(research).keys()]).toEqual(["a_003"]);
  });

  it("does not loop on a superseded_by cycle", () => {
    const byId = new Map<string, any>([["a_001", { superseded_by: "a_002" }], ["a_002", { superseded_by: "a_001" }]]);
    expect(["a_001", "a_002"]).toContain(liveSuccessorId("a_001", byId));
  });
});

describe("namesEveryReading", () => {
  it("is true when both readings appear as words", () => {
    expect(namesEveryReading("The index gives Harriet; the page reads Hattie.", ["Harriet", "Hattie [?]"])).toBe(true);
  });

  it("is false when only one appears", () => {
    expect(namesEveryReading("Harriet Curtis, aged 14.", ["Harriet", "Hattie [?]"])).toBe(false);
  });

  it("does not count a reading inside another word: Ann is not named by Anna", () => {
    expect(namesEveryReading("The page reads Anna.", ["Ann", "Anna [?]"])).toBe(false);
    expect(namesEveryReading("The index reads Ann, the page Anna.", ["Ann", "Anna [?]"])).toBe(true);
  });

  it("does not count a shorter reading inside the longer one that holds it", () => {
    expect(namesEveryReading("The page reads Harriet Ann.", ["Harriet", "Harriet Ann [?]"])).toBe(false);
    expect(namesEveryReading("The index reads Harriet; the page reads Harriet Ann.", ["Harriet", "Harriet Ann [?]"])).toBe(true);
  });

  it("reads letters beyond ASCII as part of a word", () => {
    expect(namesEveryReading("Index: José. Page: Jose.", ["José", "Jose [?]"])).toBe(true);
    expect(namesEveryReading("Index: Jönsson; page: Jonsson.", ["Jönsson", "Jonsson [?]"])).toBe(true);
    expect(namesEveryReading("Index: Josés only.", ["José", "Jose [?]"])).toBe(false);
  });

  it("ignores case and spacing", () => {
    expect(namesEveryReading("index  HARRIET, page hattie", ["Harriet", "Hattie [?]"])).toBe(true);
  });

  it("is not satisfied by a paraphrase", () => {
    expect(namesEveryReading("The page gives a different name.", ["Harriet", "Hattie [?]"])).toBe(false);
  });
});

describe("unregisteredDisagreements", () => {
  const research = (assertions: any[]) => ({
    assertions,
    person_evidence: assertions.map((x, i) => ({ id: `pe_00${i + 1}`, assertion_id: x.id, person_id: "I1", superseded_by: null })),
    conflicts: [],
  });

  it("reports two records disagreeing on a birth year", () => {
    const r = research([a("a_001", { date: "1850" }), a("a_002", { source_id: "src_002", record_id: "rec2", value: "1860", date: "1860" })]);
    expect(unregisteredDisagreements(r, new Set(["a_001", "a_002"]))).toHaveLength(1);
  });

  it("does not report a page disputing its own index, nor two readings of one dispute", () => {
    const r = research([
      a("a_001", { date: "1850" }),
      a("a_002", { value: "1860 [?]", date: "1860", disputes_assertion_id: "a_001" }),
      a("a_003", { value: "1861", date: "1861", disputes_assertion_id: "a_001" }),
    ]);
    expect(unregisteredDisagreements(r, new Set(["a_001", "a_002", "a_003"]))).toEqual([]);
  });
});
